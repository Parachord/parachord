// In-app Amazon Music player.
//
// Parachord runs on castlabs Electron, which ships a Widevine CDM. Playback
// and search are WebContentsViews on the main window with 0×0 bounds, so
// they cannot cover the app and there is no extra OS window. Sign-in is the
// only real window — the user has to see Amazon's page to pick a profile.

const path = require('path');
const HOME_URL = 'https://music.amazon.com/';
const PARTITION = 'persist:amazon-music';
const PRELOAD = path.join(__dirname, 'amazon-player-preload.js');
const {
  pageBlocksPlayback,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  readPersistedQuality,
  writePersistedQuality,
  acceptAmazonSearchAnchor,
  isAmazonPlayerChrome,
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  amazonSongSearchUrl,
  isAmazonSongResultItem,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonGqlFetchHeaders,
  playlistFromGql
} = require('./amazon-music-logic');

const HOOK_SCRIPT = `(() => {
  if (window.__parachordAmazonHook) return true;
  window.__parachordAmazonHook = true;
  window.__parachordAmazonMedia = null;
  const score = (m) => (!m ? 0 : (!m.paused ? 4 : 0) + (m.currentSrc ? 2 : 0) + (m.tagName === 'VIDEO' ? 1 : 0));
  const consider = (el) => {
    if (!el || (el.tagName !== 'VIDEO' && el.tagName !== 'AUDIO')) return;
    // The page also has an empty <audio>. Last-wins would latch onto that
    // and report PAUSED while the Widevine <video> is actually playing.
    if (score(el) >= score(window.__parachordAmazonMedia)) window.__parachordAmazonMedia = el;
  };
  document.addEventListener('play', (e) => consider(e.target), true);
  document.addEventListener('playing', (e) => consider(e.target), true);
  document.addEventListener('timeupdate', (e) => consider(e.target), true);
  const scan = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('video, audio').forEach(consider);
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) scan(el.shadowRoot); });
  };
  window.__parachordAmazonScan = () => scan(document);
  window.__parachordAmazonRead = () => {
    scan(document);
    const m = window.__parachordAmazonMedia;
    if (!m) return null;
    const d = Number.isFinite(m.duration) ? m.duration : 0;
    const asinOf = (href) => {
      const match = String(href || '').match(new RegExp('/tracks/([A-Z0-9]{10})', 'i'));
      return match ? match[1].toUpperCase() : null;
    };
    let playingAsin = null;
    const walkLinks = (root) => {
      if (!root || !root.querySelectorAll || playingAsin) return;
      root.querySelectorAll('a[href*="/tracks/"]').forEach((a) => {
        if (playingAsin) return;
        const ids = [];
        let el = a;
        for (let i = 0; el && i < 8; i++) {
          const id = el.getAttribute && el.getAttribute('data-testid');
          if (id) ids.push(id);
          el = el.parentElement || (el.getRootNode && el.getRootNode().host);
        }
        if (/miniplayer|nowplaying/i.test(ids.join(' '))) {
          playingAsin = asinOf(a.href || a.getAttribute('href'));
        }
      });
      if (!playingAsin) root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walkLinks(el.shadowRoot); });
    };
    walkLinks(document);
    return {
      positionMs: Math.round((m.currentTime || 0) * 1000),
      durationMs: d > 0 ? Math.round(d * 1000) : 0,
      paused: !!m.paused,
      ended: !!m.ended,
      state: m.ended ? 'FINISHED' : (m.paused ? 'PAUSED' : 'PLAYING'),
      href: location.href,
      playingAsin
    };
  };
  window.__parachordAmazonClickPlay = () => {
    const labelOf = (el) => (
      (el.getAttribute && (el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('icon-name'))) ||
      el.textContent ||
      ''
    );
    const buttons = [];
    const walk = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('button, music-button, music-playback-button, [role="button"], [icon-name="play"]').forEach((el) => buttons.push(el));
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
    };
    walk(document);
    const play = buttons.find((el) => /^play\\b/i.test(labelOf(el).trim()) && !/playlist/i.test(labelOf(el)));
    if (play) { play.click(); return 'clicked'; }
    const m = window.__parachordAmazonMedia;
    if (m && m.paused) {
      const p = m.play();
      if (p && p.catch) p.catch(() => {});
      return 'media';
    }
    return false;
  };
  return true;
})()`;

const SCRAPE_SCRIPT = `(() => {
  try {
  const isAmazonPlayerChrome = ${isAmazonPlayerChrome.toString()};
  const acceptAmazonSearchAnchor = ${acceptAmazonSearchAnchor.toString()};
  const isAmazonSongResultItem = ${isAmazonSongResultItem.toString()};
  const out = [];
  const seen = new Set();
  const links = [];
  const walk = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('a, [href*="/tracks/"], [primary-href*="/tracks/"], [data-href*="/tracks/"]').forEach((a) => links.push(a));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  };
  walk(document);
  const onSearch = /\\/search\\//.test(location.pathname) || /[?&]searchTerm=/.test(location.search);
  const debug = { anchors: links.length, withAsin: 0, rejected: 0, samples: [] };
  const ancestorIds = (el) => {
    const ids = [];
    let n = el;
    for (let i = 0; i < 16 && n; i++) {
      const id = n.getAttribute && n.getAttribute('data-testid');
      if (id) ids.push(id);
      const root = n.getRootNode && n.getRootNode();
      n = n.parentElement || (root && root.host) || null;
    }
    return ids;
  };
  for (const a of links) {
    const href = a.href || a.getAttribute('href') || a.getAttribute('primary-href') || a.getAttribute('data-href') || '';
    const track = href.match(/\\/tracks\\/([A-Z0-9]{10})/i);
    const queryAsin = href.match(/[?&]trackAsin=([A-Z0-9]{10})/i);
    const album = href.match(/\\/albums\\/([A-Z0-9]{10})/i);
    const asin = (track && track[1]) || (queryAsin && queryAsin[1]) || null;
    if (!asin) continue;
    debug.withAsin++;
    const ids = ancestorIds(a);
    if (!acceptAmazonSearchAnchor(ids, onSearch)) {
      debug.rejected++;
      if (debug.samples.length < 5) debug.samples.push({ href: href.slice(0, 140), ids: ids.slice(0, 4), text: (a.textContent || '').trim().slice(0, 80) });
      continue;
    }
    if (seen.has(asin.toUpperCase())) continue;
    seen.add(asin.toUpperCase());
    // The title link's own text is only the title. Artist and album are
    // sibling links (/artists/, /albums/) on the track row. closest() matches
    // the title <a> itself, so walk up until those siblings are in scope.
    let row = a.parentElement;
    for (let i = 0; i < 8 && row; i++) {
      if (row.querySelector && row.querySelector('a[href*="/artists/"]')) break;
      row = row.parentElement;
    }
    row = row || a.parentElement;
    const textOf = (el) => ((el && (el.getAttribute('aria-label') || el.textContent)) || '').trim();
    const artistLink = row && row.querySelector ? row.querySelector('a[href*="/artists/"]') : null;
    const albumLink = row && row.querySelector ? row.querySelector('a[href*="/albums/"]') : null;
    let title = textOf(a);
    let artist = textOf(artistLink);
    const by = title.match(/^(.+?)\\s+by\\s+(.+)$/i);
    if (by && !artist) { title = by[1].trim(); artist = by[2].trim(); }
    const rowText = (row && row.innerText) || '';
    const dur = rowText.match(/(\\d+)\\s*MIN(?:\\s*(\\d+)\\s*SEC)?/i);
    const duration = dur ? (parseInt(dur[1], 10) * 60 + (dur[2] ? parseInt(dur[2], 10) : 0)) : 0;
    out.push({
      asin: asin.toUpperCase(),
      title: title.slice(0, 200),
      artist: artist.slice(0, 200),
      album: textOf(albumLink).slice(0, 200),
      duration: duration,
      albumAsin: album ? album[1].toUpperCase() : (albumLink && (albumLink.href.match(/\\/albums\\/([A-Z0-9]{10})/i) || [])[1] || '').toUpperCase() || null
    });
    if (out.length >= 20) break;
  }
  // Result rows are <button data-testid="HorizontalItem,SearchResultsWidget_...">,
  // not /tracks/ anchors. The track ASIN is a descendant id (the like button),
  // distinct from the /artists/ ASIN.
  const items = [];
  const walkItems = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('[data-testid^="HorizontalItem,"]').forEach((el) => {
      if (isAmazonSongResultItem(el.getAttribute('data-testid'))) items.push(el);
    });
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walkItems(el.shadowRoot); });
  };
  walkItems(document);
  for (const item of items) {
    if (out.length >= 20) break;
    const label = item.getAttribute('aria-label') || '';
    const by = label.match(/^(.+?)\\s+by\\s+(.+)$/i);
    const titleEl = item.querySelector('[data-testid$="_Metadata_TrackTitle"], [data-testid="TrackItem_Title"]');
    const artistLink = item.querySelector('a[href*="/artists/"]');
    const title = ((titleEl && titleEl.textContent) || (by && by[1]) || '').trim();
    const artist = ((artistLink && artistLink.textContent) || (by && by[2]) || '').trim();
    const artistAsin = (((artistLink && (artistLink.href || artistLink.getAttribute('href'))) || '').match(/\\/artists\\/([A-Z0-9]{10})/i) || [])[1];
    let asin = null;
    const ids = [];
    const walkIds = (el) => {
      if (!el) return;
      if (el.id) ids.push(el.id);
      for (const c of el.children || []) walkIds(c);
      if (el.shadowRoot) walkIds(el.shadowRoot);
    };
    walkIds(item);
    for (const id of ids) {
      if (!/^B[A-Z0-9]{9}$/i.test(id)) continue;
      if (artistAsin && id.toUpperCase() === artistAsin.toUpperCase()) continue;
      asin = id.toUpperCase();
      break;
    }
    if (!asin || seen.has(asin) || !title) continue;
    seen.add(asin);
    out.push({ asin, title: title.slice(0, 200), artist: artist.slice(0, 200), album: '', duration: 0, albumAsin: null });
  }
  debug.items = items.length;
  return { href: location.href, tracks: out, debug };
  } catch (e) {
    return { href: location.href, tracks: [], debug: { error: String(e && (e.stack || e.message || e)) } };
  }
})()`;

// Replay fetch, evaluated in the page world of the search view. The page
// context supplies cookies (credentials: 'include') and the headers we copied
// from the request the page itself made (x-api-key, csrf-*, music-territory,
// x-amzn-*); the APQ hash in the body comes from that request too, so it is
// always current for this hornet deploy. firstLimit is raised so one request
// returns the whole playlist (the page asks for 100 per page).
const PLAYLIST_GQL_SCRIPT = (url, headers, body) => `(async () => {
  try {
    const r = await fetch(${JSON.stringify(url)}, {
      method: 'POST',
      credentials: 'include',
      headers: ${JSON.stringify(headers)},
      body: ${JSON.stringify(body)}
    });
    return { status: r.status, text: await r.text() };
  } catch (e) {
    return { error: String(e && (e.message || e)) };
  }
})()`;

function electron() {
  return require('electron');
}

function chromeUserAgent() {
  const chrome = (process.versions && process.versions.chrome) || '131.0.0.0';
  const platform = process.platform === 'win32'
    ? 'Windows NT 10.0; Win64; x64'
    : process.platform === 'linux'
      ? 'X11; Linux x86_64'
      : 'Macintosh; Intel Mac OS X 10_15_7';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chrome} Safari/537.36`;
}

function notReady(reason, message) {
  const err = new Error(message || reason);
  err.reason = reason;
  return err;
}

// loadURL resolves on did-finish-load, which on a stalled network can hang for
// the Chromium network-stack timeout (minutes). Every other step in this module
// is budgeted (search 16×400ms, play 20×400ms, playlist 40×500ms); the loads
// themselves are the one unbounded wait — and searchTracks and lookupPlaylist
// share enqueueSearch, so one hung page wedges both surfaces and queues every
// later search behind it. Race the load: the loser keeps loading in the
// renderer (the next loadURL aborts it, or the failure paths blank it), we
// just stop waiting. A load that fails this way is transient (offline, captive
// portal, stall), so it throws notReady('load-failed') — NOT an empty result,
// which the resolver would cache as a 30-day noMatch.
const LOAD_URL_TIMEOUT_MS = 30000;
async function loadURLBudgeted(page, url, timeoutMs = LOAD_URL_TIMEOUT_MS) {
  const loaded = page.loadURL(url);
  loaded.catch(() => {}); // a late rejection after the race lost must not be unhandled
  let timer = null;
  try {
    await Promise.race([
      loaded,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(notReady('load-failed', `Amazon Music page did not finish loading within ${timeoutMs}ms: ${url}`)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const amazonWebPlayer = {
  playerView: null,
  searchView: null,
  authWindow: null,
  host: null,
  searchChain: Promise.resolve(),
  emeProbed: null,
  currentAsin: null,
  playGeneration: 0,
  _onHostClosed: null,

  // castlabs Electron exposes electron.components. Stock Electron does not,
  // and the old --widevine-cdm-path switch does nothing there. EME probe is
  // the real playback gate; this only answers "does this binary have a CDM".
  cdmAvailable() {
    try {
      const { components } = electron();
      if (!components) return false;
      if (typeof components.status !== 'function') return true;
      const status = components.status() || {};
      const blob = JSON.stringify(status).toLowerCase();
      if (!blob || blob === '{}') return false;
      if (blob.includes('"status":"failed"') || blob.includes('component_update_error')) return false;
      return true;
    } catch {
      return false;
    }
  },

  session() {
    const { session } = electron();
    const ses = session.fromPartition(PARTITION);
    if (!ses.__parachordAmazonPerms) {
      ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(true));
      ses.setPermissionCheckHandler(() => true);
      ses.__parachordAmazonPerms = true;
    }
    return ses;
  },

  async hasAuthCookie() {
    try {
      const cookies = await this.session().cookies.get({});
      return cookies.some(c => c.value && /^(at-main|sess-at-main|at-acb)/.test(c.name));
    } catch {
      return false;
    }
  },

  // Ready means signed in AND a profile has been chosen. A window still on
  // the profile picker or the sign-in page is not ready, even if a cookie
  // from an earlier step is already set.
  async isSignedIn() {
    if (!(await this.hasAuthCookie())) return false;
    for (const target of [this.authWindow, this.playerView, this.searchView]) {
      if (!this.alive(target)) continue;
      if (pageBlocksPlayback(target.webContents.getURL())) return false;
    }
    return true;
  },

  setHost(win) {
    if (this.host && this._onHostClosed) {
      try { this.host.off('closed', this._onHostClosed); } catch { /* gone */ }
    }
    this.host = win && !win.isDestroyed() ? win : null;
    this._onHostClosed = null;
    if (!this.host) {
      this.destroyView(this.playerView);
      this.destroyView(this.searchView);
      this.playerView = null;
      this.searchView = null;
      return;
    }
    this._onHostClosed = () => this.setHost(null);
    this.host.on('closed', this._onHostClosed);
    this.collapse(this.playerView);
    this.collapse(this.searchView);
  },

  // The hidden player/search views get the full treatment: the preload's
  // visibility stub + __r trap, and the media-element HOOK_SCRIPT. The
  // sign-in window gets neither — it is the one visible Amazon page and must
  // behave like a normal browser window (real focus events, real
  // document.hidden, no tampering that Amazon's sign-in flows or bot
  // heuristics could trip over).
  webPreferences({ preload = PRELOAD } = {}) {
    return {
      partition: PARTITION,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      preload,
      webSecurity: true,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required'
    };
  },

  windowOptions(show) {
    return {
      width: 1100,
      height: 760,
      show: !!show,
      title: 'Amazon Music',
      backgroundColor: '#000000',
      skipTaskbar: !show,
      webPreferences: this.webPreferences()
    };
  },

  alive(target) {
    return !!(target && target.webContents && !target.webContents.isDestroyed());
  },

  attachContents(wc, { hook = true } = {}) {
    const harden = () => {
      try { wc.setUserAgent(chromeUserAgent()); } catch { /* destroyed */ }
    };
    harden();
    try { wc.setBackgroundThrottling(false); } catch { /* destroyed */ }
    wc.on('did-start-navigation', harden);
    if (hook) {
      wc.on('dom-ready', () => {
        wc.executeJavaScript(HOOK_SCRIPT).catch(() => {});
      });
    }
    return wc;
  },

  attachWindow(win) {
    // No media hook on the sign-in window: nothing plays there.
    this.attachContents(win.webContents, { hook: false });
    win.on('closed', () => {
      if (this.authWindow === win) this.authWindow = null;
    });
    return win;
  },

  // 0×0 so a view painted above the page still cannot cover Parachord.
  collapse(view) {
    if (!view) return;
    try { view.setBounds({ x: 0, y: 0, width: 0, height: 0 }); } catch { /* gone */ }
  },

  destroyView(view) {
    if (!view) return;
    try {
      if (this.host && !this.host.isDestroyed()) this.host.contentView.removeChildView(view);
    } catch { /* detached */ }
    try {
      if (view.webContents && !view.webContents.isDestroyed()) view.webContents.close();
    } catch { /* gone */ }
  },

  pageOf(view) {
    const wc = view.webContents;
    return {
      webContents: wc,
      loadURL: (url) => wc.loadURL(url),
      isDestroyed: () => !wc || wc.isDestroyed()
    };
  },

  appView() {
    const host = this.host;
    if (!host || host.isDestroyed()) return null;
    const kids = host.contentView.children || [];
    return kids.find(v => v && v.webContents && v.webContents.id === host.webContents.id) || null;
  },

  // Search rows do not mount in a 0×0 view (the widget collapses to
  // max-width: 0). Park the search view at a real size but left of the
  // window so it cannot cover Parachord. Do not attach the debugger.
  layoutSearch(view) {
    if (!view) return 'none';
    try {
      view.setBounds({ x: -1200, y: 0, width: 1100, height: 800 });
    } catch { /* gone */ }
    return 'offscreen';
  },

  ensureView(which) {
    const { WebContentsView } = electron();
    const key = which === 'search' ? 'searchView' : 'playerView';
    if (this.alive(this[key])) {
      this.collapse(this[key]);
      return this.pageOf(this[key]);
    }
    if (!this.host || this.host.isDestroyed()) {
      throw notReady('not-ready', 'Amazon Music player has no host window');
    }
    this.session();
    const view = new WebContentsView({ webPreferences: this.webPreferences() });
    this.attachContents(view.webContents);
    this.host.contentView.addChildView(view);
    this.collapse(view);
    this[key] = view;
    view.webContents.on('destroyed', () => {
      if (this[key] === view) this[key] = null;
    });
    return this.pageOf(view);
  },

  // Pause is not enough on a confirm timeout: the <video> may not exist yet,
  // then Amazon starts a few hundred ms later on top of the next resolver.
  // Blanking the document kills that late start.
  async haltPlayback() {
    this.currentAsin = null;
    await this.pause().catch(() => {});
    const view = this.playerView;
    if (!this.alive(view)) return { ok: false };
    this.collapse(view);
    try {
      const url = view.webContents.getURL();
      if (url && url !== 'about:blank') await view.webContents.loadURL('about:blank');
    } catch { /* gone */ }
    return { ok: true };
  },

  async ensureWindow(kind) {
    return this.ensureView(kind === 'search' ? 'search' : 'player');
  },

  async evalOn(win, script) {
    if (!this.alive(win)) throw new Error('Amazon Music web player window is closed');
    return win.webContents.executeJavaScript(script);
  },

  async probeEme() {
    if (!this.cdmAvailable()) return false;
    if (this.emeProbed === true) return true;
    try {
      const win = await this.ensureWindow('player', { show: false });
      const url = win.webContents.getURL();
      if (!url || url === 'about:blank') await loadURLBudgeted(win, HOME_URL);
      this.emeProbed = await this.evalOn(win, `(async () => {
        if (!navigator.requestMediaKeySystemAccess) return false;
        try {
          await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
            initDataTypes: ['cenc'],
            audioCapabilities: [
              { contentType: 'audio/mp4; codecs="mp4a.40.2"' },
              { contentType: 'audio/webm; codecs="opus"' }
            ]
          }]);
          return true;
        } catch (e) {
          return false;
        }
      })()`);
    } catch (error) {
      // A page that never loaded is a network condition, not a missing CDM —
      // let it surface as load-failed instead of "Widevine is not usable".
      if (error && error.reason === 'load-failed') throw error;
      this.emeProbed = false;
    }
    return this.emeProbed;
  },

  async openLogin() {
    const { BrowserWindow } = electron();
    let win = this.authWindow;
    if (!this.alive(win)) {
      this.session();
      const parent = this.host && !this.host.isDestroyed() ? this.host : null;
      win = this.attachWindow(new BrowserWindow({
        ...this.windowOptions(true),
        width: 980,
        height: 760,
        parent: parent || undefined,
        title: 'Sign in to Amazon Music',
        // No preload here: the visibility stub and __r trap are for the hidden
        // player views. This window is visible and must behave normally.
        webPreferences: this.webPreferences({ preload: null })
      }));
      this.authWindow = win;
      // Unbudgeted on purpose: this is the one window the user watches. A
      // stalled load here is visible (and recoverable by the user retrying),
      // and rejecting the openLogin promise at 30s would abandon a sign-in
      // flow that may still complete.
      await win.loadURL(HOME_URL);
    }
    win.show();
    win.focus();

    return new Promise((resolve) => {
      let settled = false;
      const finish = (signedIn) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve({ success: !!signedIn, signedIn: !!signedIn });
      };
      const timer = setInterval(async () => {
        if (win.isDestroyed()) return;
        const url = win.webContents.getURL();
        if (pageBlocksPlayback(url)) return;
        if (!(await this.hasAuthCookie())) return;
        if (!/music\.amazon\.com/i.test(url)) return;
        clearInterval(timer);
        setTimeout(() => {
          if (win && !win.isDestroyed()) win.close();
        }, 600);
        finish(true);
      }, 1000);
      win.on('closed', () => finish(false));
    });
  },

  enqueueSearch(fn) {
    const run = this.searchChain.then(fn, fn);
    this.searchChain = run.then(() => {}, () => {});
    return run;
  },

  async searchTracks(input) {
    const opts = typeof input === 'string' ? { query: input } : (input || {});
    const url = amazonSongSearchUrl(opts);
    if (!url) return [];
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search');
      const mode = await this.layoutSearch(this.searchView);
      console.log(`[Amazon] search mode=${mode} ${url}`);
      await loadURLBudgeted(win, url);
      let last = { tracks: [] };
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 400));
        const href = win.isDestroyed() ? '' : win.webContents.getURL();
        if (pageBlocksPlayback(href)) {
          console.warn(`[Amazon] search blocked: ${href}`);
          throw notReady('not-signed-in', 'Choose an Amazon Music profile');
        }
        try { last = await this.evalOn(win, SCRAPE_SCRIPT) || last; } catch (e) {
          if (i === 0 || i === 8) console.warn('[Amazon] scrape failed:', e && e.message);
        }
        const n = last && Array.isArray(last.tracks) ? last.tracks.length : 0;
        if (i === 0 || i === 4 || i === 8 || n > 0) {
          const sample = (last.tracks || []).slice(0, 3).map(t => `${t.artist || '?'} — ${t.title || '?'}`).join(' | ');
          const dbg = last.debug ? ` asinLinks=${last.debug.withAsin} rejected=${last.debug.rejected} anchors=${last.debug.anchors} items=${last.debug.items || 0}` : '';
          console.log(`[Amazon] search poll ${i} href=${href} tracks=${n}${sample ? ' ' + sample : ''}${dbg}`);
          if (n === 0 && last.debug && last.debug.error) {
            console.warn('[Amazon] scrape error', last.debug.error.split('\n')[0]);
          }
          if (n === 0 && last.debug && last.debug.samples && last.debug.samples.length) {
            console.log('[Amazon] rejected samples', JSON.stringify(last.debug.samples));
          }
        }
        if (n > 0) {
          // Title links render before the artist link. Returning early used
          // to attach title-only hits that the artist+title gate then dropped.
          if (last.tracks.some(t => t.artist) || i >= 12) {
            console.log(`[Amazon] search returning ${n} tracks`);
            this.collapse(this.searchView);
            return last.tracks;
          }
        }
      }
      try {
        const diag = await this.evalOn(win, `(() => {
          const item = document.querySelector('[data-testid="HorizontalItem,SearchResultsWidget_TopResults_TrackItem"]')
            || document.querySelector('[data-testid="HorizontalItem,SearchResultsWidget_Item"]');
          if (!item) return { missing: true };
          const attrs = [];
          const walk = (el, depth) => {
            if (!el || depth > 6 || attrs.length > 40) return;
            if (el.attributes) {
              for (const a of el.attributes) {
                const v = String(a.value);
                if (/asin|href|track|B0|primary|entity/i.test(a.name + v)) attrs.push(a.name + '=' + v.slice(0, 160));
              }
            }
            for (const c of el.children || []) walk(c, depth + 1);
            if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
          };
          walk(item, 0);
          return { testid: item.getAttribute('data-testid'), text: (item.innerText || '').slice(0, 180), attrs, html: (item.outerHTML || '').slice(0, 700) };
        })()`);
        console.log('[Amazon] search row markup', JSON.stringify(diag));
      } catch (e) {
        console.warn('[Amazon] search diag failed:', e && e.message);
      }
      this.collapse(this.searchView);
      return (last && Array.isArray(last.tracks)) ? last.tracks : [];
    });
  },

  // Import a playlist page (music.amazon.com/playlists/<id>) via the page's
  // own GraphQL. Hornet fetches the playlist with a persisted query (APQ)
  // whose hash renumbers on every redeploy, so nothing is hardcoded: the
  // playlist page is loaded in the (offscreen) search view, the gql request
  // the page itself makes is captured (URL, headers, APQ hash), and that exact
  // request is replayed from the page world with a bigger firstLimit — one
  // request returns the whole playlist, so no DOM scraping and no pagination.
  // Runs on the search chain: lookupPlaylist and searchTracks share the search
  // view, so they must not interleave page loads.
  async lookupPlaylist(rawUrl) {
    if (typeof rawUrl !== 'string' || !/^https:\/\/music\.amazon\.com\//i.test(rawUrl)) {
      throw notReady('not-ready', 'Not an Amazon Music playlist URL');
    }
    const playlistId = amazonPlaylistIdFromUrl(rawUrl);
    if (!playlistId) {
      throw notReady('not-ready', 'Not an Amazon Music playlist URL');
    }
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search');
      const mode = await this.layoutSearch(this.searchView);
      console.log(`[Amazon] playlist lookup mode=${mode} ${rawUrl}`);

      // Capture gql requests (bodies from onBeforeRequest, headers paired by
      // request id) while the page loads and fires playlistDetail itself.
      const ses = this.session();
      const gqlFilter = { urls: ['https://gql.music.amazon.com/*'] };
      const captured = [];
      const onRequest = (details, callback) => {
        try {
          if (details.uploadData && details.uploadData.length) {
            const body = details.uploadData.map(d => (d.bytes ? d.bytes.toString('utf8') : '')).join('');
            captured.push({ id: details.id, body });
          }
        } catch (e) { /* keep other requests flowing */ }
        callback({});
      };
      const onSendHeaders = (details, callback) => {
        const mine = captured.find(r => r.id === details.id);
        if (mine) mine.headers = details.requestHeaders;
        callback({ requestHeaders: details.requestHeaders });
      };
      try {
        try { ses.webRequest.onBeforeRequest(gqlFilter, onRequest); } catch { /* already registered */ }
        try { ses.webRequest.onBeforeSendHeaders(gqlFilter, onSendHeaders); } catch { /* already registered */ }

        await loadURLBudgeted(win, rawUrl);
        // Wait for the page's own playlistDetail request. Boot + query is
        // ~2-4s on a cold view; the poll window covers a slow load. The
        // entry must also have its headers (onBeforeSendHeaders fires
        // milliseconds after onBeforeRequest — accepting the body alone
        // races that) before we take it.
        let entry = null;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) {
            console.warn(`[Amazon] playlist blocked: ${href}`);
            throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          }
          entry = captured.find(r => r.headers && amazonPlaylistDetailRequest([r.body], playlistId));
          if (entry) break;
        }
        if (!entry) {
          // The page loaded but never asked for this playlist: deleted,
          // private, or not available in the user's territory.
          return null;
        }
        const request = amazonPlaylistDetailRequest([entry.body], playlistId);
        if (!request || !request.variables || typeof request.variables !== 'object') {
          throw notReady('lookup-failed', 'Unexpected Amazon playlist query shape');
        }

        // Replay the page's request with the whole playlist in one go. The
        // page asks for 100 tracks per request; firstLimit 500 matches the
        // import cap (bigger playlists are truncated there too).
        const headers = amazonGqlFetchHeaders(entry.headers);
        const body = {
          operationName: 'playlistDetail',
          variables: { ...request.variables, id: playlistId, firstLimit: 500 },
          extensions: request.extensions || {}
        };
        console.log(`[Amazon] playlist replaying playlistDetail via gql (${Object.keys(headers).length} headers)`);
        const replay = await this.evalOn(win, PLAYLIST_GQL_SCRIPT('https://gql.music.amazon.com/', headers, JSON.stringify(body)));
        if (!replay || replay.error) {
          throw notReady('lookup-failed', (replay && replay.error) || 'Amazon playlist query failed');
        }
        if (replay.status !== 200) {
          throw notReady('lookup-failed', `Amazon playlist query failed (${replay.status})`);
        }
        let parsed = null;
        try { parsed = JSON.parse(replay.text); } catch (e) { /* leave null */ }
        if (parsed && Array.isArray(parsed.errors) && parsed.errors.length && !(parsed.data && parsed.data.playlist)) {
          throw notReady('lookup-failed', String((parsed.errors[0] || {}).message || 'Amazon playlist query error'));
        }
        const playlist = playlistFromGql(parsed && parsed.data);
        console.log(`[Amazon] playlist lookup returning ${playlist ? playlist.tracks.length : 0} tracks "${playlist ? playlist.name : ''}"`);
        return playlist;
      } finally {
        try { ses.webRequest.onBeforeRequest(gqlFilter, null); } catch { /* none */ }
        try { ses.webRequest.onBeforeSendHeaders(gqlFilter, null); } catch { /* none */ }
        this.collapse(this.searchView);
      }
    });
  },


  async playByAsin({ asin, title, artist } = {}) {
    if (!asin) throw new Error('Amazon Music: no ASIN to play');
    if (!this.cdmAvailable()) {
      return { success: false, reason: 'no-cdm', error: 'This Parachord build has no Widevine CDM' };
    }
    if (!(await this.isSignedIn())) {
      return { success: false, reason: 'not-signed-in', error: 'Sign in and choose an Amazon Music profile' };
    }
    const eme = await this.probeEme();
    if (!eme) {
      // Not not-signed-in: prompting for login will not install a CDM.
      return {
        success: false,
        reason: 'playback-failed',
        error: 'Widevine is not usable yet. The CDM may still be downloading, or this build is not VMP-signed for Amazon.'
      };
    }
    const generation = ++this.playGeneration;
    const ownsPlay = () => this.playGeneration === generation && this.currentAsin === asin;
    const win = await this.ensureWindow('player');
    // A newer playByAsin may have started during ensureWindow. Do not claim
    // the player or its license listener if so — haltPlayback would blank the
    // track that just replaced us, and detaching the filter would drop theirs.
    if (this.playGeneration !== generation) return { success: false, reason: 'superseded' };
    this.collapse(this.playerView);
    this.currentAsin = asin;
    // Everything from here on is post-claim: if a newer playByAsin started
    // (our loadURL aborted by its loadURL, our confirm loop reading its media
    // element), that is supersession, not failure — report it instead of
    // throwing so the IPC wrapper does not halt the newer play.
    // A 400 from the license endpoint is Amazon refusing this build's
    // Widevine certificate (development VMP). Detect it instead of waiting
    // out a generic timeout. Region segment is NA/EU/FE, not only NA.
    // Detach only if this play still owns the listener.
    let licenseDenied = false;
    const ses = this.session();
    const licenseFilter = { urls: ['https://music.amazon.com/*/api/dmls/*'] };
    const onLicense = (details) => {
      if (details.statusCode === 400 && ownsPlay()) licenseDenied = true;
    };
    const detachLicense = () => {
      if (this.playGeneration !== generation) return;
      try { ses.webRequest.onCompleted(licenseFilter, null); } catch { /* none */ }
    };
    try { ses.webRequest.onCompleted(licenseFilter, onLicense); } catch { /* filter already registered */ }
    try {
    // Amazon's own result links use ?do=play. A bare /tracks/{asin} page
    // renders a Play button whose click() does not start Widevine; the query
    // does, once the document is attached (0×0 bounds — it must not cover the app).
    await loadURLBudgeted(win, `https://music.amazon.com/tracks/${encodeURIComponent(asin)}?do=play`);
    if (!ownsPlay()) return { success: false, reason: 'superseded' };
    const landed = win.webContents.getURL();
    if (pageBlocksPlayback(landed)) {
      await this.haltPlayback();
      return { success: false, reason: 'not-signed-in', error: 'Choose an Amazon Music profile, then try again' };
    }
    await this.evalOn(win, HOOK_SCRIPT).catch(() => {});
    const read = async () => {
      try {
        return await this.evalOn(win, `(() => {
          if (window.__parachordAmazonRead) {
            const s = window.__parachordAmazonRead();
            if (s && s.state === 'PLAYING') return s;
          }
          const v = document.querySelector('video');
          if (!v) return null;
          const d = Number.isFinite(v.duration) ? v.duration : 0;
          return {
            positionMs: Math.round((v.currentTime || 0) * 1000),
            durationMs: d > 0 ? Math.round(d * 1000) : 0,
            state: v.ended ? 'FINISHED' : (v.paused ? 'PAUSED' : 'PLAYING')
          };
        })()`);
      } catch { return null; }
    };
    // A development certificate still starts the element, then Amazon's
    // license 400 tears it down a few hundred milliseconds later. Don't
    // report success until playback has survived that window.
    let playingSince = 0;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      // Clicking B while A is still in this loop used to read B's media element
      // and report success for A. The superseded branch then paused B.
      if (!ownsPlay()) return { success: false, reason: 'superseded' };
      if (licenseDenied) break;
      const state = await read();
      const advancing = state && state.state === 'PLAYING' && state.positionMs > 0;
      if (advancing) {
        if (!playingSince) playingSince = Date.now();
        if (Date.now() - playingSince >= 1500 && ownsPlay()) {
          return { success: true, confirmed: true, asin, engine: 'web' };
        }
      } else {
        playingSince = 0;
      }
    }
    if (!ownsPlay()) return { success: false, reason: 'superseded' };
    // Never show or focus the player here, including during radio. A run of
    // unplayable tracks used to surface the page on every miss.
    if (shouldRevealPlayerOnFailure()) {
      throw new Error('Amazon playback failure must not reveal the player');
    }
    await this.haltPlayback();
    if (licenseDenied) {
      return {
        success: false,
        reason: 'playback-failed',
        error: 'Amazon refused the Widevine license. This build needs a production VMP signature.'
      };
    }
    return {
      success: false,
      reason: 'playback-failed',
      error: `In-app playback did not start for ${title || asin}${artist ? ' by ' + artist : ''}`
    };
    } catch (error) {
      if (!ownsPlay()) return { success: false, reason: 'superseded', error: error && error.message };
      throw error;
    } finally {
      detachLicense();
    }
  },

  async readState() {
    const win = this.playerView;
    if (!this.alive(win)) {
      return { state: 'EMPTY', asin: null, title: null, artist: null, positionMs: 0, durationMs: 0 };
    }
    let state = null;
    try { state = await this.evalOn(win, 'window.__parachordAmazonRead ? window.__parachordAmazonRead() : null'); }
    catch { state = null; }
    if (!state) {
      return { state: 'EMPTY', asin: null, title: null, artist: null, positionMs: 0, durationMs: 0 };
    }
    return {
      state: state.state,
      asin: reportedPlaybackAsin(state),
      title: null,
      artist: null,
      positionMs: state.positionMs || 0,
      durationMs: state.durationMs || 0
    };
  },

  async withMedia(expr) {
    const win = this.playerView;
    if (!this.alive(win)) return { ok: false };
    return this.evalOn(win, `(() => {
      const m = window.__parachordAmazonMedia;
      if (!m) return { ok: false };
      ${expr}
      return { ok: true };
    })()`);
  },

  async pause() {
    return this.withMedia('m.pause();');
  },

  async resume() {
    return this.withMedia('const p = m.play(); if (p && p.catch) p.catch(() => {});');
  },

  async stop() {
    return this.haltPlayback();
  },

  async seek(positionMs) {
    const seconds = Math.max(0, Number(positionMs) || 0) / 1000;
    return this.withMedia(`try { m.currentTime = ${seconds}; } catch (e) {}`);
  },

  async setVolume(volume01) {
    const v = Math.max(0, Math.min(1, Number(volume01) || 0));
    return this.withMedia(`m.volume = ${v};`);
  },

  async getPlaybackState() {
    return this.readState();
  },

  // Hornet keeps Audio Quality on playbackController (metro module, not a
  // window global). The player view is 0×0, so Amazon's own modal
  // is unreachable. Read and write the same store the modal writes.
  //
  // The store is never found by requiring modules — executing hornet module
  // factories out of order wedges the page (observed live). The preload trap
  // captures it passively when Amazon's own code requires the module; until
  // then the persisted playback-controller localStorage entry, which hornet
  // rehydrates from at boot, is the source of truth.
  //
  // `apply` is null for reads, or the quality fields to write.
  async withQualityController(apply) {
    // Do not expand the view here. Settings must not cover the app.
    const win = await this.ensureWindow('player', { show: false });
    let url = win.webContents.getURL();
    if (pageBlocksPlayback(url)) {
      const err = new Error('Sign in and choose an Amazon Music profile');
      err.reason = 'not-signed-in';
      throw err;
    }
    if (!url || url === 'about:blank') {
      await loadURLBudgeted(win, HOME_URL);
      url = win.webContents.getURL();
      if (pageBlocksPlayback(url)) {
        const err = new Error('Sign in and choose an Amazon Music profile');
        err.reason = 'not-signed-in';
        throw err;
      }
    }
    const script = `(() => {
      const readPersistedQuality = ${readPersistedQuality.toString()};
      const writePersistedQuality = ${writePersistedQuality.toString()};
      const apply = ${apply ? JSON.stringify(apply) : 'null'};
      const store = window.__parachordAmazonPlayback;
      const s = store && store.audioQualitySettings;
      if (s) {
        if (apply) {
          if (apply.streamingQuality) s.streamingQuality = apply.streamingQuality;
          if (apply.abrEnabled != null) s.abrEnabled = !!apply.abrEnabled;
        }
        const current = { streamingQuality: s.streamingQuality || null, abrEnabled: !!s.abrEnabled };
        // Mirror the store into the persisted entry: hornet's persistence
        // reaction does not notice a nested change while nothing is playing.
        writePersistedQuality(localStorage, current);
        return current;
      }
      const persisted = readPersistedQuality(localStorage);
      if (apply) {
        const wrote = writePersistedQuality(localStorage, apply);
        if (wrote) return readPersistedQuality(localStorage) || persisted;
      }
      return persisted || { streamingQuality: null, abrEnabled: true };
    })()`;
    const deadline = Date.now() + 12000;
    let last = null;
    while (Date.now() < deadline) {
      try { last = await this.evalOn(win, script); } catch { last = null; }
      if (last && last.streamingQuality) return last;
      await new Promise(r => setTimeout(r, 250));
    }
    return last;
  },

  async getQuality() {
    const current = await this.withQualityController(null);
    if (!current) return { success: false, reason: 'not-ready', error: 'Amazon Music quality settings are not available yet' };
    return {
      success: true,
      streamingQuality: normalizeStreamingQuality(current.streamingQuality) || current.streamingQuality || null,
      abrEnabled: !!current.abrEnabled,
      options: AMAZON_QUALITY_OPTIONS
    };
  },

  async setQuality({ streamingQuality, abrEnabled } = {}) {
    const apply = {};
    if (streamingQuality) apply.streamingQuality = streamingQuality;
    if (abrEnabled !== undefined) apply.abrEnabled = !!abrEnabled;
    if (!apply.streamingQuality && abrEnabled === undefined) {
      return { success: false, reason: 'invalid', error: 'Unknown Amazon Music audio quality' };
    }
    const current = await this.withQualityController(apply);
    if (!current) return { success: false, reason: 'not-ready', error: 'Amazon Music quality settings are not available yet' };
    return {
      success: true,
      streamingQuality: normalizeStreamingQuality(current.streamingQuality) || current.streamingQuality || apply.streamingQuality || null,
      abrEnabled: !!current.abrEnabled,
      options: AMAZON_QUALITY_OPTIONS
    };
  }
};

module.exports = amazonWebPlayer;
