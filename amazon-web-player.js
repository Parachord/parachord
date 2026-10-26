// In-app Amazon Music player.
//
// Parachord runs on castlabs Electron, which ships a Widevine CDM. Playback
// and search are WebContentsViews on the main window with 0×0 bounds, so
// they cannot cover the app and there is no extra OS window. Sign-in is the
// only real window — the user has to see Amazon's page to pick a profile.
//
// ── Amazon page contract ─────────────────────────────────────────────────────
// Everything in this module scrapes or hooks music.amazon.com (hornet), and
// hornet redeploys continuously. When playback/search breaks, check these
// assumptions first — they are the surfaces most likely to rot. Pure parsers
// live in amazon-music-logic.js (unit-tested); the scripts below serialize
// those functions into the page world.
//
//   URLs            /tracks/{10-char ASIN}, /albums/{ASIN}, /artists/{ASIN},
//                   /playlists/{id} and /my/playlists/{id},
//                   /search/{q}/songs (quoted terms; a loose combined query
//                   misses songs), /tracks/{asin}?do=play is what actually
//                   starts Widevine — a bare page's Play-button click() does not
//   Sign-in walls   /ap/signin, /identity/who-is-listening (pageBlocksPlayback)
//   Cookies         at-main|sess-at-main|at-acb — fast path only; the rendered
//                   page is ground truth (see isSignedIn)
//   Media element   the Widevine <video>; the page also has an empty <audio>
//                   decoy — HOOK_SCRIPT scores elements by paused/currentSrc/
//                   tagName so last-wins cannot latch onto it. The element's
//                   webkitAudioDecodedByteCount (demuxed compressed stream
//                   bytes — a Blink API, not a hornet surface) is what the
//                   poller pairs to measure the delivered bitrate
//   Search          the songs page (/search/<q>/songs) fires SpecSearchSeeMorePage
//                   with the exact searchText from the URL; the request is
//                   captured (URL, headers, APQ hash) and replayed verbatim,
//                   matched on variables.searchText — never the operation
//                   name — and parsed pure (searchTracksFromGql); a page that
//                   never searches is a structural failure (not-ready), an
//                   empty edges list is a real miss
//   GraphQL         gql.music.amazon.com, persisted query (APQ) whose sha256Hash
//                   renumbers per redeploy — capture the page's own
//                   playlistDetail / SpecSearchSeeMorePage requests and
//                   replay them, never hardcode it
//   Quality store   metro module playbackController (audioQualitySettings),
//                   captured by the window.__r trap in the preload; persisted
//                   fallback under a localStorage key containing
//                   'playback-controller'
//   Stream manifest the DASH MPD + init segments the page itself fetches,
//                   captured by the preload's passive fetch/XHR hook
//                   (installAmazonStreamCapture) and parsed by pure helpers
//                   in amazon-music-logic — packager output, not hornet DOM
//   License refusal  POST /*/api/dmls/ answering 400 = this build's VMP
//                   signature refused (development certificate)

const path = require('path');
const { registerEmbeddedPlayer } = require('./main-process/ipc/embedded-player');
const HOME_URL = 'https://music.amazon.com/';
const PARTITION = 'persist:amazon-music';
const PRELOAD = path.join(__dirname, 'amazon-player-preload.js');
const {
  pageBlocksPlayback,
  signInLanded,
  cdmStatusHealthy,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  readPersistedQuality,
  writePersistedQuality,
  amazonQualityFromStore,
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  amazonSongSearchUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonSpecSearchRequest,
  amazonAlbumSearchUrl,
  amazonAlbumAsinFromUrl,
  amazonAlbumDetailRequest,
  searchTracksFromGql,
  searchAlbumsFromGql,
  albumDetailFromGql,
  createSearchBreaker,
  paginatePlaylistTracks,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  mpdAudioRepresentations,
  flacStreamInfoFromInit,
  attachInitStreamInfo,
  pickMpdRepresentation,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
  isAmazonMusicPage,
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest
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
      playingAsin,
      // Demuxed compressed audio bytes (webkitAudioDecodedByteCount) — the
      // poller pairs consecutive reads of this counter to measure the actual
      // stream bitrate (stream-quality.js contract). Null when the element
      // exposes no counter, so those reads just never form pairs.
      audioDecodedBytes: (typeof m.webkitAudioDecodedByteCount === 'number' && m.webkitAudioDecodedByteCount >= 0)
        ? m.webkitAudioDecodedByteCount
        : null
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

// Replay fetch, evaluated in the page world of the search view. The page
// context supplies cookies (credentials: 'include') and the headers we copied
// from the request the page itself made (x-api-key, csrf-*, music-territory,
// x-amzn-*); the APQ hash in the body comes from that request too, so it is
// always current for this hornet deploy. The body is replayed VERBATIM —
// playlist pages and the songs search page both fire their own request for
// exactly what we asked, so there is nothing to rewrite.
const GQL_FETCH_SCRIPT = (url, headers, body) => `(async () => {
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

// Read the preload net hook's captured manifests + init segments from the
// player page. Init bytes are base64'd in the page world (executeJavaScript
// results must be JSON-serializable); manifests come back as text.
const READ_STREAM_CAPS_SCRIPT = `(() => {
  const caps = window.__parachordStreamCaps;
  if (!caps) return null;
  const b64 = (buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  };
  return {
    manifests: (caps.manifests || []).map((m) => ({ url: m.url, text: m.text })),
    inits: (caps.inits || []).map((i) => ({ url: i.url, b64: b64(i.bytes) }))
  };
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

// How long quality reads/writes wait for the __r trap to capture the live
// playbackController store. Live observation (2026-10, hornet 1.18x):
// storeCaptured stays false on track pages — hornet's factories appear to use
// a closure-scoped require, or the store materializes after require time — so
// this wait mostly times out. The persisted playback-controller localStorage
// entry is the working mechanism (hornet rehydrates from it at boot, i.e.
// "applies on the next track"); the live-store write is an opportunistic
// upgrade if a hornet deploy ever routes requires through the global __r.
// Keep this short so the settings panel does not spin on a first read.
const QUALITY_WAIT_MS = 3000;
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
  cookieWarned: false,
  // Circuit breaker for search's structural failures — a hornet rename of the
  // search operation makes every search burn the full capture window before
  // failing not-ready, serially on the search chain (starving playlist
  // imports too). After consecutive structural failures this opens and
  // searchTracks fails fast for a cooldown (createSearchBreaker in
  // amazon-music-logic.js, unit-tested there).
  searchBreaker: createSearchBreaker(),
  _onHostClosed: null,
  // Audio representations parsed from the captured DASH manifest (+ init
  // segment STREAMINFO), scoped to the current play: nulled when a play
  // claims the player, filled asynchronously by readStreamRepresentations,
  // keyed to that play's generation + ASIN so a late capture from a superseded
  // play cannot land on the new track.
  streamRepresentations: null,

  // castlabs Electron exposes electron.components. Stock Electron does not,
  // and the old --widevine-cdm-path switch does nothing there. EME probe is
  // the real playback gate; this only answers "does this binary have a CDM".
  cdmAvailable() {
    try {
      const { components } = electron();
      if (!components) return false;
      if (typeof components.status !== 'function') return true;
      // Read the status fields only (cdmStatusHealthy) - substring-matching the
      // whole status JSON used to disable Amazon when an unrelated value
      // mentioned "failed". Unrecognized shapes are optimistic; probeEme is
      // the gate that actually matters.
      return cdmStatusHealthy(components.status() || {});
    } catch {
      return false;
    }
  },

  session() {
    const { session } = electron();
    const ses = session.fromPartition(PARTITION);
    if (!ses.__parachordAmazonPerms) {
      // Allowlist, not a denylist. Playback needs no permission grant at all
      // (HTMLMediaElement and EME/Widevine are not gated by permission
      // handlers), so the hidden page gets fullscreen and nothing else. The
      // previous deny-list default-allowed everything it did not name -
      // including 'media', which is the umbrella getUserMedia permission for
      // camera/microphone on a hidden third-party page. Every denial is
      // logged once per permission name (checks fire often) so an unexpected
      // request is visible in the field without console spam.
      const allowed = new Set(['fullscreen']);
      const warned = new Set();
      const check = (permission) => {
        if (allowed.has(permission)) return true;
        if (!warned.has(permission)) {
          warned.add(permission);
          console.warn(`[Amazon] denied permission request: ${permission}`);
        }
        return false;
      };
      ses.setPermissionRequestHandler((_wc, permission, callback) => callback(check(permission)));
      ses.setPermissionCheckHandler((_wc, permission) => check(permission));
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
    if (await this.hasAuthCookie()) {
      // Only the sign-in window's URL is authoritative here. The player and
      // search views keep whatever URL their last navigation left behind — a
      // view that redirected to /ap/signin during an earlier failed search
      // stays there (nothing navigates it until a search/play runs, and those
      // refuse to while this returns false), so consulting them locked the
      // account out right after a successful sign-in. A genuinely dead
      // session is still caught mid-flight: search, lookup and play re-check
      // the URL after every load and throw not-signed-in on a redirect.
      const auth = this.authWindow;
      if (this.alive(auth) && pageBlocksPlayback(auth.webContents.getURL())) return false;
      return true;
    }
    // The auth-cookie names are an implementation detail Amazon can rotate;
    // when they do, hasAuthCookie matches nothing and every call looks
    // signed-out forever — including the sign-in flow's own completion gate,
    // which would strand openLogin. A rendered, non-sign-in music.amazon.com
    // page means the session is live: trust the page over the cookie list. A
    // stale-page false positive self-corrects on the next load — search and
    // play re-check the URL mid-flight and throw not-signed-in when Amazon
    // redirects to sign-in.
    for (const target of [this.authWindow, this.playerView, this.searchView]) {
      if (!this.alive(target)) continue;
      const url = target.webContents.getURL();
      if (/^https:\/\/music\.amazon\.com\//i.test(url) && !pageBlocksPlayback(url)) {
        if (!this.cookieWarned) {
          this.cookieWarned = true;
          console.warn('[Amazon] no auth cookie matched (at-main|sess-at-main|at-acb) but the page is signed in — Amazon may have rotated cookie names');
        }
        return true;
      }
    }
    return false;
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
    // A hidden page on the Amazon session must not spawn a visible window.
    // Electron's default is to create one, and that window would carry the
    // session cookies without the preload or the UA mask.
    try { wc.setWindowOpenHandler(() => ({ action: 'deny' })); } catch { /* destroyed */ }
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

  // Blank the search view when a search is done. The SPA would otherwise
  // keep running at full speed (backgroundThrottling is off), and a view
  // left parked on a sign-in wall poisons sign-in detection for the rest of
  // the session. Awaits the blank so the next queued page load (search or
  // playlist) cannot race it.
  async parkSearchView() {
    const view = this.searchView;
    if (!this.alive(view)) return;
    this.collapse(view);
    try {
      const url = view.webContents.getURL();
      if (url && url !== 'about:blank') await view.webContents.loadURL('about:blank');
    } catch { /* gone */ }
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
    // Only the PLAYER view joins the embedded-player registry: it is the view
    // that plays, so it is the only view whose hijacked media keys and
    // now-playing mirror are legitimate. The SEARCH view also runs live
    // Amazon pages (background resolution, playlist import) while another
    // resolver may be playing — a script there must not reach Parachord's
    // transport or the mirror. The isOwned gate further accepts keys only
    // while this player owns playback (currentAsin is non-null exactly
    // then).
    if (which !== 'search') {
      registerEmbeddedPlayer(view.webContents, {
        resolverId: 'amazonmusic',
        isOwned: () => !!this.currentAsin
      });
    }
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
  //
  // Generation-guarded. Pass the playGeneration you decided to stop. A halt
  // that captures this.playGeneration itself cannot fail that check — nothing
  // awaits between the read and the compare — so a skip that already claimed
  // the view made the old halt null currentAsin, pause, and blank the new
  // track. Omit expectedGeneration only for an explicit stop of whatever is
  // playing right now. The pause script still refuses a token mismatch, in
  // case a newer play claims during the await.
  async haltPlayback(expectedGeneration) {
    const scoped = Number.isFinite(expectedGeneration);
    if (scoped && this.playGeneration !== expectedGeneration) {
      return { ok: false, superseded: true };
    }
    const genAtStart = this.playGeneration;
    this.currentAsin = null;
    await this.pause(genAtStart).catch(() => {});
    const view = this.playerView;
    if (!this.alive(view)) return { ok: false };
    if (this.playGeneration !== genAtStart) return { ok: false, superseded: true };
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
      const win = await this.ensureWindow('player');
      // The home page can start its own media — autoplay is allowed and the page
      // is told it is visible — so a probe load is MUTED and parked again
      // afterward. A probe is a capability check, never an audible event, and
      // the page must not sit there mid-autoplay if the play aborts after us.
      let loadedHome = false;
      const genAtStart = this.playGeneration;
      try {
        const url = win.webContents.getURL();
        if (!url || url === 'about:blank') {
          try { win.webContents.setAudioMuted(true); } catch { /* gone */ }
          loadedHome = true;
          await loadURLBudgeted(win, HOME_URL);
        }
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
      } finally {
        if (loadedHome) {
          // Skip the park if a newer play claimed the player mid-probe (its
          // loadURL owns the view now); always restore the mute state.
          if (this.playGeneration === genAtStart) {
            try {
              const u = win.webContents.getURL();
              if (u && u !== 'about:blank') await win.webContents.loadURL('about:blank');
            } catch { /* gone */ }
          }
          try { win.webContents.setAudioMuted(false); } catch { /* gone */ }
        }
      }
    } catch (error) {
      // A page that never loaded is a network condition, not a missing CDM —
      // surface load-failed instead of caching "Widevine is not usable".
      if (error && error.reason === 'load-failed') throw error;
      this.emeProbed = false;
    }
    return this.emeProbed;
  },

  // Diagnostic for the preload: did the stub/trap/hijack actually run in the
  // live player page? null = no page loaded yet (fresh start, about:blank) or
  // the page could not be read; false on a loaded music.amazon.com page means
  // the preload did not run there — the exact failure mode that hid for weeks
  // behind the localStorage fallback. storeCaptured is opportunistic: it
  // flips true only if the page's own requires route through the global __r —
  // observed false on track pages (2026-10), where the persisted localStorage
  // entry is what quality actually uses. mediaSessionShim is the
  // navigator.mediaSession hijack (embedded-player-kit.js) — on a loaded track
  // page it must be true, or the page's session is driving the OS media
  // surface again.
  async preloadProbe() {
    const view = this.playerView;
    if (!this.alive(view)) return { stub: null, storeCaptured: null, mediaSessionShim: null };
    let url = '';
    try { url = view.webContents.getURL(); } catch { /* destroyed */ }
    if (!url || url === 'about:blank') return { stub: null, storeCaptured: null, mediaSessionShim: null };
    try {
      return await this.evalOn(view, `(() => ({
        stub: window.__parachordRequireTrap === true,
        storeCaptured: !!window.__parachordAmazonPlayback,
        mediaSessionShim: window.__parachordMediaSessionHijack === true,
        streamCapture: window.__parachordStreamCapture === true,
        streamManifests: (window.__parachordStreamCaps && window.__parachordStreamCaps.manifests || []).length,
        streamInits: (window.__parachordStreamCaps && window.__parachordStreamCaps.inits || []).length
      }))()`);
    } catch {
      return { stub: null, storeCaptured: null, mediaSessionShim: null };
    }
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
      let lastUrl = null;
      let stableTicks = 0;
      const finish = (signedIn) => {
        if (settled) return;
        settled = true;
        clearInterval(timer);
        resolve({ success: !!signedIn, signedIn: !!signedIn });
      };
      const timer = setInterval(async () => {
        if (win.isDestroyed()) return;
        const url = win.webContents.getURL();
        // Positive signal only (signInLanded): "not on a known wall" used to
        // close this window on a logged-out first paint of music.amazon.com/.
        // The cookie is one accepted signal, not a requirement — Amazon
        // rotating the cookie names must not leave this timer waiting forever;
        // a path off / or a third stable tick stands in for it.
        const hasCookie = await this.hasAuthCookie().catch(() => false);
        const verdict = signInLanded({ url, lastUrl, stableTicks, hasCookie });
        lastUrl = url;
        stableTicks = verdict.stableTicks;
        if (!verdict.landed) return;
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

  // Capture gql requests (bodies from onBeforeRequest, headers paired by
  // request id) while a page loads and fires its own queries. A registration
  // replaces any previous one — webRequest has a single listener slot per
  // method per session — and the search chain serializes searchTracks and
  // lookupPlaylist, so the two flows never interleave captures. Returns
  // { captured, detach } — detach in a finally so a stale capture does not
  // keep buffering every later page's gql bodies into a dead array.
  attachGqlCapture() {
    const ses = this.session();
    const gqlFilter = { urls: ['https://gql.music.amazon.com/*'] };
    const captured = [];
    const onRequest = (details, callback) => {
      try {
        if (details.uploadData && details.uploadData.length) {
          const body = details.uploadData.map(d => (d.bytes ? d.bytes.toString('utf8') : '')).join('');
          // Keep the URL the page itself used — replaying a hardcoded endpoint
          // rots the day Amazon puts a path or region segment on it.
          captured.push({ id: details.id, body, url: details.url });
        }
      } catch (e) { /* keep other requests flowing */ }
      callback({});
    };
    const onSendHeaders = (details, callback) => {
      const mine = captured.find(r => r.id === details.id);
      if (mine) mine.headers = details.requestHeaders;
      callback({ requestHeaders: details.requestHeaders });
    };
    try { ses.webRequest.onBeforeRequest(gqlFilter, onRequest); } catch { /* a second registration replaces */ }
    try { ses.webRequest.onBeforeSendHeaders(gqlFilter, onSendHeaders); } catch { /* a second registration replaces */ }
    const detach = () => {
      try { ses.webRequest.onBeforeRequest(gqlFilter, null); } catch { /* none */ }
      try { ses.webRequest.onBeforeSendHeaders(gqlFilter, null); } catch { /* none */ }
    };
    return { captured, detach };
  },

  // Replay a captured gql request from the page world of the search view.
  // The page context supplies cookies (credentials: 'include') and the
  // headers we copied from the request the page itself made; the APQ hash in
  // the body comes from that request too, so it is always current for this
  // hornet deploy. Returns { parsed } (the full response envelope) or
  // { error } — each flow decides which envelope shape it expects.
  async replayGql(win, entry, body) {
    const replayUrl = entry.url || 'https://gql.music.amazon.com/';
    const headers = amazonGqlFetchHeaders(entry.headers);
    const raw = JSON.stringify(body);
    const replay = await this.evalOn(win, GQL_FETCH_SCRIPT(replayUrl, headers, raw));
    if (!replay || replay.error) return { error: (replay && replay.error) || 'Amazon gql query failed' };
    if (replay.status !== 200) return { error: `Amazon gql query failed (${replay.status})` };
    let parsed = null;
    try { parsed = JSON.parse(replay.text); } catch (e) { /* leave null */ }
    if (!parsed) return { error: 'Amazon gql response was not JSON' };
    if (Array.isArray(parsed.errors) && parsed.errors.length && !parsed.data) {
      return { error: String((parsed.errors[0] || {}).message || 'Amazon gql query error') };
    }
    return { parsed };
  },

  // Shared runner for the spec searches — the songs tab (/search/<q>/songs)
  // fires the track-spec SpecSearchSeeMorePage, the albums tab (/search/<q>/
  // albums) the album spec; everything else about the flow is identical.
  // Search runs over the page's own GraphQL — the same capture-and-replay
  // pattern as lookupPlaylist. The tab page fires SpecSearchSeeMorePage with
  // our exact searchText; that request (URL, headers, APQ hash, variables) is
  // captured while the page loads and replayed verbatim, and the result is
  // parsed pure — no DOM scraping: no row-mount waits, no testid heuristics,
  // no like-button ASIN exclusion dance, and the rows carry cover art the DOM
  // never exposed. The request is matched on variables.searchText, not the
  // operation name, so a hornet rename of the operation cannot break it — and
  // only the requested spec is ever replayed: for tracks, an album/artist spec
  // edge must never import as a track (an album ASIN in the track slot passes
  // the confidence gate on self-titled releases).
  //
  // Structural failures (the page never searched, another spec searched but
  // ours never came, or the response carried no spec search envelope) throw
  // not-ready — never cached as a 30-day noMatch — and trip the shared search
  // breaker so a rename fails fast instead of burning the capture window on
  // every search of a resolution run. An envelope with empty edges IS a real
  // miss and returns []. Runs on the search chain: lookupPlaylist and the
  // searches share the search view, so they must not interleave page loads.
  async specSearch({ url, searchText, specType, parse, noun }) {
    if (this.searchBreaker && !this.searchBreaker.allows()) {
      const probe = this.searchBreaker.isProbe() ? ' (probing after cooldown)' : '';
      throw notReady('not-ready', `Amazon search is cooling down after repeated structural failures${probe}`);
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search');
      const mode = await this.layoutSearch(this.searchView);
      console.log(`[Amazon] search mode=${mode} ${url}`);
      const { captured, detach } = this.attachGqlCapture();
      const structural = (message) => {
        if (this.searchBreaker) {
          this.searchBreaker.recordFailure();
          const state = this.searchBreaker.state();
          if (state.open) console.warn(`[Amazon] search breaker open for ${Math.max(0, state.openUntil - Date.now())}ms (${state.failures} consecutive structural failures)`);
        }
        return notReady('not-ready', message);
      };
      try {
        await loadURLBudgeted(win, url);
        // Wait for the page's own search request (boot + query is ~1-3s on a
        // warm view; the poll window covers a slow load). The entry must also
        // have its headers — onBeforeSendHeaders fires milliseconds *after*
        // onBeforeRequest, so accepting the body alone races it. ALL
        // header-complete bodies go to the matcher each poll — the matcher
        // only ever accepts the wanted spec, so a different-spec request that
        // arrives first cannot win by first-arrival.
        let request = null;
        let entry = null;
        let otherSpecSeenAt = -1;
        for (let i = 0; i < 60 && !request; i++) {
          await new Promise(r => setTimeout(r, 250));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) {
            console.warn(`[Amazon] search blocked: ${href}`);
            throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          }
          const ready = captured.filter(r => r.headers);
          const bodies = ready.map(r => r.body);
          request = amazonSpecSearchRequest(bodies, searchText, { spec: specType });
          if (request) {
            entry = ready.find(r => amazonSpecSearchRequest([r.body], searchText, { spec: specType }));
            break;
          }
          // Another spec searched our text but ours has not arrived: give it
          // a short grace (the page may fire specs out of order), then
          // conclude structurally instead of burning the full window.
          if (otherSpecSeenAt < 0 && amazonSpecSearchRequest(bodies, searchText, { anySpec: true })) {
            otherSpecSeenAt = i;
            console.warn(`[Amazon] search: a non-${specType} spec searched for ${JSON.stringify(searchText)}; waiting briefly for the ${specType} spec`);
          }
          if (otherSpecSeenAt >= 0 && i - otherSpecSeenAt >= 8) break;
        }
        if (!request || !entry) {
          // The page loaded but never ran our search: a hornet rename of the
          // operation (or the search page itself), or an SPA failure. Log
          // what the page did fire so a rename reads as a rename instead of a
          // silent run of empty searches each cached as a 30-day noMatch.
          console.warn(`[Amazon] search: page never fired the ${specType} search for ${JSON.stringify(searchText)}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
          throw structural(`Amazon search page never issued its ${specType} search`);
        }
        if (!request.variables || typeof request.variables !== 'object') {
          throw structural('Unexpected Amazon search query shape');
        }

        // Replay the page's own request verbatim. (Capturing the page's own
        // response in the page world instead — the stream-capture pattern —
        // does NOT work here: hornet binds its fetch at module init, before
        // any preload-injected wrapper can install, so the page's own search
        // bypasses the wrapper (live-verified 2026-10; the stream capture only
        // survives because media segments are fetched seconds later, at play
        // time). The replay's cost is one request on top of the ~9 ops the
        // page load itself fires.)
        const outcome = await this.replayGql(win, entry, request);
        if (outcome.error) throw notReady('not-ready', outcome.error);
        const parsed = outcome.parsed;
        const { rows, envelope } = parse(parsed && parsed.data);
        if (!envelope) {
          // The response carried no spec search envelope: hornet renamed the
          // response field. A rename must surface as not-ready, not as a
          // cached miss.
          console.warn(`[Amazon] search response was not a spec search envelope for ${JSON.stringify(searchText)}`);
          throw structural('Amazon search response was not a spec search envelope');
        }
        if (this.searchBreaker) this.searchBreaker.recordSuccess();
        console.log(`[Amazon] search returning ${rows.length} ${noun} for ${JSON.stringify(searchText)}`);
        return rows;
      } finally {
        detach();
        await this.parkSearchView();
      }
    });
  },

  async searchTracks(input) {
    const opts = typeof input === 'string' ? { query: input } : (input || {});
    const spec = amazonSongSearchUrl(opts);
    if (!spec) return [];
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.specSearch({
      url: spec.url,
      searchText: spec.searchText,
      specType: 'track',
      noun: 'tracks',
      parse: (data) => {
        const { tracks, envelope } = searchTracksFromGql(data);
        return { rows: tracks, envelope };
      }
    });
  },

  // Album search for the album-page catalog fallback (the plugin's
  // capabilities.albumSearch): the albums tab of the same spec search, parsed
  // by searchAlbumsFromGql.
  async searchAlbums(input) {
    const opts = typeof input === 'string' ? { query: input } : (input || {});
    const spec = amazonAlbumSearchUrl(opts);
    if (!spec) return [];
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.specSearch({
      url: spec.url,
      searchText: spec.searchText,
      specType: 'album',
      noun: 'albums',
      parse: (data) => {
        const { albums, envelope } = searchAlbumsFromGql(data);
        return { rows: albums, envelope };
      }
    });
  },

  // Import a playlist page (music.amazon.com/playlists/<id>, /my/playlists/<id>
  // or /user-playlists/<id>) via the page's own GraphQL. Hornet fetches the
  // playlist with a persisted query (APQ) whose hash renumbers on every
  // redeploy, so nothing is hardcoded: the playlist page is loaded in the
  // (offscreen) search view, the gql request the page itself makes is captured
  // (URL, headers, APQ hash), and that exact request is replayed from the page
  // world verbatim. The server serves one page per request, so a longer
  // playlist continues via the playlist's own continuation: each response's
  // pageInfo.token (a composite continuation state) passed as the afterCursor
  // variable. Runs on the search chain: lookupPlaylist and searchTracks share
  // the search view, so they must not interleave page loads.
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
      const { captured, detach } = this.attachGqlCapture();
      try {
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
          // The page loaded but never asked for this playlist: deleted, private,
          // not available in the user's territory — or hornet renamed the
          // operation. Log what the page did fire so a rename reads as a rename
          // instead of "every playlist is deleted".
          console.warn(`[Amazon] playlist lookup: page never requested playlistDetail for ${playlistId}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
          return null;
        }
        const request = amazonPlaylistDetailRequest([entry.body], playlistId);
        if (!request || !request.variables || typeof request.variables !== 'object') {
          throw notReady('lookup-failed', 'Unexpected Amazon playlist query shape');
        }

        // Replay the page's own request, to the URL the page itself used,
        // VERBATIM — the page's own firstLimit (100). Raising firstLimit is
        // useless: the server serves one page per request however high the
        // limit (100 rows observed at firstLimit 500), and the pagination
        // block below follows the playlist's own continuation instead.
        // The playlist-specific gql-error rule stays here: errors are fatal
        // unless data.playlist came back (a null playlist with errors is the
        // deleted/private shape, which surfaces as "Playlist not found").
        const sendPlaylistQuery = async (body) => {
          if (win.isDestroyed()) return { error: 'search view closed' };
          const out = await this.replayGql(win, entry, body);
          if (out.error) return { error: out.error };
          const parsed = out.parsed;
          if (parsed && Array.isArray(parsed.errors) && parsed.errors.length && !(parsed.data && parsed.data.playlist)) {
            return { error: String((parsed.errors[0] || {}).message || 'Amazon playlist query error') };
          }
          return { parsed };
        };
        const pageUrl = win.isDestroyed() ? '' : win.webContents.getURL();
        if (!isAmazonMusicPage(pageUrl)) {
          throw notReady('not-ready', 'Amazon playlist page left music.amazon.com before replay');
        }
        console.log(`[Amazon] playlist replaying playlistDetail via gql`);
        const outcome = await sendPlaylistQuery(request);
        if (outcome.error) throw notReady('lookup-failed', outcome.error);
        // Follow the playlist's own pagination. The loop, its stop conditions
        // and its raw-edge progress checks live in paginatePlaylistTracks
        // (amazon-music-logic.js) where they are unit-tested — the poller
        // pattern. fetchPage replays the page's own request with the token as
        // afterCursor (live-verified 2026-10: the token is the only
        // continuation the server accepts; the Relay-style endCursor is a
        // decoy the server answers with page 1 for).
        const paginated = await paginatePlaylistTracks({
          firstPageData: outcome.parsed && outcome.parsed.data,
          fetchPage: async (token) => {
            if (win.isDestroyed()) return { error: 'search view closed' };
            const page = await sendPlaylistQuery({
              ...request,
              variables: { ...request.variables, afterCursor: token }
            });
            if (page.error) return { error: page.error };
            return { data: page.parsed && page.parsed.data };
          },
          log: (m) => console.log(`[Amazon] playlist ${m}`)
        });
        const playlist = paginated.playlist;
        if (playlist && playlist.trackCount > playlist.tracks.length) {
          // A shortfall is only a truncation when pages were left unfetched
          // (paginated.stop names why). When the server is out of pages
          // ('exhausted'), the missing rows are edges with node:null —
          // delisted tracks the response carries no data for at all; there is
          // nothing to import, and the natural end is not a failure.
          if (paginated.stop === 'exhausted') {
            console.log(`[Amazon] playlist complete: ${playlist.tracks.length} of ${playlist.trackCount} rows are importable (${playlist.trackCount - playlist.tracks.length} unavailable on Amazon)`);
          } else {
            console.warn(`[Amazon] playlist lookup truncated: got ${playlist.tracks.length} of ${playlist.trackCount} tracks (${paginated.stop})`);
          }
        }
        console.log(`[Amazon] playlist lookup returning ${playlist ? playlist.tracks.length : 0} tracks "${playlist ? playlist.name : ''}"`);
        return playlist;
      } finally {
        detach();
        await this.parkSearchView();
      }
    });
  },

  // Import an album page (music.amazon.com/albums/<ASIN>) via the page's own
  // GraphQL — the same capture-and-replay pattern as lookupPlaylist. The album
  // page fires AlbumDetailPage with variables.id = the ASIN; that request is
  // captured (URL, headers, APQ hash) and replayed verbatim from the page
  // world. Unlike playlistDetail the tracksConnection carries no pageInfo at
  // all (a 100-track album answers all 100 edges in one response —
  // live-verified 2026-10), so there is no continuation to follow: a
  // trackCount above the mapped rows is logged as a truncation. data.album
  // null is a legitimate not-found (deleted / other region) and returns null;
  // a response with no album field at all is a hornet rename and throws
  // lookup-failed instead of masquerading as a miss. Runs on the search
  // chain: album lookups share the search view with the searches and playlist
  // imports, so they must not interleave page loads.
  async lookupAlbum(rawUrl) {
    if (typeof rawUrl !== 'string' || !/^https:\/\/music\.amazon\.com\//i.test(rawUrl)) {
      throw notReady('not-ready', 'Not an Amazon Music album URL');
    }
    const asin = amazonAlbumAsinFromUrl(rawUrl);
    if (!asin) {
      throw notReady('not-ready', 'Not an Amazon Music album URL');
    }
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search');
      const mode = await this.layoutSearch(this.searchView);
      const url = `https://music.amazon.com/albums/${asin}`;
      console.log(`[Amazon] album lookup mode=${mode} ${url}`);

      // Capture gql requests (bodies from onBeforeRequest, headers paired by
      // request id) while the page loads and fires AlbumDetailPage itself.
      const { captured, detach } = this.attachGqlCapture();
      try {
        await loadURLBudgeted(win, url);
        // Wait for the page's own album-detail request. Boot + query is
        // ~2-4s on a cold view; the poll window covers a slow load. The
        // entry must also have its headers (onBeforeSendHeaders fires
        // milliseconds after onBeforeRequest — accepting the body alone
        // races that) before we take it.
        let entry = null;
        for (let i = 0; i < 40; i++) {
          await new Promise(r => setTimeout(r, 500));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) {
            console.warn(`[Amazon] album lookup blocked: ${href}`);
            throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          }
          entry = captured.find(r => r.headers && amazonAlbumDetailRequest([r.body], asin));
          if (entry) break;
        }
        if (!entry) {
          // The album-named op never came. Hedge a hornet rename: accept any
          // read request carrying our ASIN — a wrong-envelope replay then
          // surfaces as lookup-failed (loud) instead of a bogus miss.
          entry = captured.find(r => r.headers && amazonAlbumDetailRequest([r.body], asin, { anyName: true }));
        }
        if (!entry) {
          // The page loaded but never asked for this album: deleted, not
          // available in the user's territory — or hornet renamed the
          // operation. Log what the page did fire so a rename reads as a
          // rename instead of "every album is gone".
          console.warn(`[Amazon] album lookup: page never requested the album detail for ${asin}; gql operations seen: ${capturedOperationNames(captured.map(c => c.body)).join(', ') || 'none'}`);
          return null;
        }
        const request = amazonAlbumDetailRequest([entry.body], asin);
        if (!request || !request.variables || typeof request.variables !== 'object') {
          throw notReady('lookup-failed', 'Unexpected Amazon album query shape');
        }
        const pageUrl = win.isDestroyed() ? '' : win.webContents.getURL();
        if (!isAmazonMusicPage(pageUrl)) {
          throw notReady('not-ready', 'Amazon album page left music.amazon.com before replay');
        }
        console.log(`[Amazon] album replaying album detail via gql`);
        const outcome = await this.replayGql(win, entry, request);
        if (outcome.error) throw notReady('lookup-failed', outcome.error);
        const { album, envelope } = albumDetailFromGql(outcome.parsed && outcome.parsed.data);
        if (!envelope) {
          console.warn(`[Amazon] album lookup: response was not an album detail envelope for ${asin}`);
          throw notReady('lookup-failed', 'Amazon album response was not an album detail envelope');
        }
        if (album && album.trackCount > album.tracks.length) {
          console.warn(`[Amazon] album lookup truncated: got ${album.tracks.length} of ${album.trackCount} tracks`);
        }
        console.log(`[Amazon] album lookup returning ${album ? album.tracks.length : 0} tracks "${album ? album.name : ''}"`);
        return album;
      } finally {
        detach();
        await this.parkSearchView();
      }
    });
  },


  // Diagnostic (a developer tool, no UI): load one Amazon Music album page
  // (/albums/<ASIN>) or search page (/search/<text>/<tab>) in the search view
  // and record the gql operations it fires — the diagnostic the plugin's
  // album search and album lookup were built from, since those shapes are
  // only visible from a live signed-in session. Every operation is listed (name, endpoint,
  // redacted variables, header NAMES only: their values carry the session);
  // only the page's own read queries about its subject (gqlRequestIsAboutSubject)
  // are replayed once each, so their response shapes can be read, and those
  // responses are redacted and trimmed (redactGqlSample) before they leave
  // this function. Runs on the search chain like every other page load here.
  async debugCaptureGql(rawUrl) {
    const subject = gqlCaptureSubject(rawUrl);
    if (!subject) {
      throw notReady('not-ready', 'Pass a music.amazon.com album URL (/albums/<ASIN>) or search URL (/search/<text>/<tab>)');
    }
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search');
      await this.layoutSearch(this.searchView);
      const { captured, detach } = this.attachGqlCapture();
      try {
        await loadURLBudgeted(win, rawUrl);
        // Let the page fire its queries: stop after 3s with nothing new, at
        // most 20s.
        let lastCount = -1;
        let quietTicks = 0;
        for (let i = 0; i < 40 && quietTicks < 6; i++) {
          await new Promise(r => setTimeout(r, 500));
          const href = win.isDestroyed() ? '' : win.webContents.getURL();
          if (pageBlocksPlayback(href)) throw notReady('not-signed-in', 'Choose an Amazon Music profile');
          const count = captured.filter(r => r.headers).length;
          quietTicks = count === lastCount ? quietTicks + 1 : 0;
          lastCount = count;
        }
        const operations = [];
        for (const entry of captured.filter(r => r.headers)) {
          for (const req of gqlRequestsIn(entry.body)) {
            const op = summarizeGqlRequest(entry, req);
            if (gqlRequestIsAboutSubject(req, subject) && !win.isDestroyed()) {
              const out = await this.replayGql(win, entry, req);
              op.replayed = true;
              op.response = out.error ? { error: out.error } : redactGqlSample(out.parsed);
            }
            operations.push(op);
          }
        }
        console.log(`[Amazon] gql capture ${rawUrl}: ${operations.length} operation(s), ${operations.filter(o => o.replayed).length} replayed`);
        return {
          capturedAt: new Date().toISOString(),
          page: rawUrl,
          finalUrl: win.isDestroyed() ? null : win.webContents.getURL(),
          subject,
          operations
        };
      } finally {
        detach();
        await this.parkSearchView();
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
    this.streamRepresentations = null;
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
    try { ses.webRequest.onCompleted(licenseFilter, onLicense); } catch { /* a second registration replaces; generation guards the detach */ }
    try {
    // Amazon's own result links use ?do=play. A bare /tracks/{asin} page
    // renders a Play button whose click() does not start Widevine; the query
    // does, once the document is attached (0×0 bounds — it must not cover the app).
    await loadURLBudgeted(win, `https://music.amazon.com/tracks/${encodeURIComponent(asin)}?do=play`);
    if (!ownsPlay()) return { success: false, reason: 'superseded' };
    const landed = win.webContents.getURL();
    if (pageBlocksPlayback(landed)) {
      await this.haltPlayback(generation);
      return { success: false, reason: 'not-signed-in', playGeneration: generation, error: 'Choose an Amazon Music profile, then try again' };
    }
    await this.evalOn(win, HOOK_SCRIPT).catch(() => {});
    // Stamp only if this play still owns the view. A newer play's document
    // must not be tagged with our generation — that is what lets a stale
    // halt's pause no-op instead of pausing the replacement.
    if (!ownsPlay()) return { success: false, reason: 'superseded' };
    await this.evalOn(win, amazonPlayGenerationStamp(generation)).catch(() => {});
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
          // Kick (never await) the manifest/init capture that upgrades the
          // measured-bitrate streamQuality record with codec / sample rate /
          // bit depth / channels / tier. Playback is already confirmed; a
          // capture miss just leaves the bitrate-only record.
          void this.readStreamRepresentations({ generation, asin }).catch(() => {});
          return { success: true, confirmed: true, asin, engine: 'web' };
        }
      } else {
        playingSince = 0;
      }
    }
    if (!ownsPlay()) return { success: false, reason: 'superseded' };
    // Always false by design: playback failure must never reveal the hidden
    // player (a run of unplayable radio tracks used to show and focus it).
    // shouldRevealPlayerOnFailure + this throw is the regression guard — the
    // function is tested to stay false.
    if (shouldRevealPlayerOnFailure()) {
      throw new Error('Amazon playback failure must not reveal the player');
    }
    await this.haltPlayback(generation);
    if (licenseDenied) {
      return {
        success: false,
        reason: 'playback-failed',
        playGeneration: generation,
        error: 'Amazon refused the Widevine license. This build needs a production VMP signature.'
      };
    }
    return {
      success: false,
      reason: 'playback-failed',
      playGeneration: generation,
      error: `In-app playback did not start for ${title || asin}${artist ? ' by ' + artist : ''}`
    };
    } catch (error) {
      if (!ownsPlay()) return { success: false, reason: 'superseded', error: error && error.message };
      await this.haltPlayback(generation).catch(() => {});
      error.playGeneration = generation;
      throw error;
    } finally {
      detachLicense();
    }
  },

  async readState() {
    const win = this.playerView;
    if (!this.alive(win)) {
      return { state: 'EMPTY', asin: null, title: null, artist: null, positionMs: 0, durationMs: 0, audioDecodedBytes: null };
    }
    let state = null;
    try { state = await this.evalOn(win, 'window.__parachordAmazonRead ? window.__parachordAmazonRead() : null'); }
    catch { state = null; }
    if (!state) {
      return { state: 'EMPTY', asin: null, title: null, artist: null, positionMs: 0, durationMs: 0, audioDecodedBytes: null };
    }
    return {
      state: state.state,
      asin: reportedPlaybackAsin(state),
      title: null,
      artist: null,
      positionMs: state.positionMs || 0,
      durationMs: state.durationMs || 0,
      audioDecodedBytes: (typeof state.audioDecodedBytes === 'number' && Number.isFinite(state.audioDecodedBytes))
        ? state.audioDecodedBytes
        : null
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

  // expectedGeneration scopes the pause to the play that requested it (halt).
  // Omit it for a user pause — that should always hit the current element.
  async pause(expectedGeneration) {
    return this.withMedia(amazonMediaPauseExpr(expectedGeneration));
  },

  async resume() {
    return this.withMedia('const p = m.play(); if (p && p.catch) p.catch(() => {});');
  },

  async stop() {
    return this.haltPlayback();
  },

  // Full sign-out. The partition (persist:amazon-music) is Amazon-only, so a
  // whole-session clear is correctly scoped - no partial cookie-clear guessing
  // like the Apple flow needs. In-flight plays are superseded by the
  // generation bump instead of fighting the teardown.
  async signOut() {
    try { this.destroyView(this.playerView); } catch { /* gone */ }
    try { this.destroyView(this.searchView); } catch { /* gone */ }
    this.playerView = null;
    this.searchView = null;
    if (this.alive(this.authWindow)) {
      try { this.authWindow.close(); } catch { /* gone */ }
    }
    this.authWindow = null;
    this.currentAsin = null;
    this.playGeneration++;
    this.cookieWarned = false;
    this.searchChain = Promise.resolve();
    try {
      await this.session().clearStorageData();
    } catch (error) {
      return { success: false, error: String((error && error.message) || error) };
    }
    return { success: true };
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

  // Parse what the preload's net hook captured during playback startup — the
  // DASH manifest text and the small init segment responses — into audio
  // representations (codec / sample rate / bit depth / channels / bandwidth).
  // Fire-and-forget from playByAsin once playback is confirmed; generation-
  // and ASIN-guarded so a late read from a superseded play cannot land on the
  // new track. Every failure degrades to the bitrate-only quality record.
  async readStreamRepresentations({ generation, asin } = {}) {
    const view = this.playerView;
    if (!this.alive(view)) return;
    let caps = null;
    // The manifest is fetched before playback can advance, so it is already
    // captured by now; one short retry covers a clone().text() still settling.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { caps = await this.evalOn(view, READ_STREAM_CAPS_SCRIPT); } catch { caps = null; }
      if (caps && ((caps.manifests && caps.manifests.length) || (caps.inits && caps.inits.length))) break;
      if (attempt === 0) await new Promise(r => setTimeout(r, 1000));
    }
    if (!caps || !((caps.manifests && caps.manifests.length) || (caps.inits && caps.inits.length))) {
      console.log('[Amazon] stream quality: no manifest or init captured (no stream traffic, or the net hook did not run)');
      return;
    }
    const inits = [];
    for (const init of (caps.inits || [])) {
      let info = null;
      try { info = flacStreamInfoFromInit(Buffer.from(init.b64 || '', 'base64')); } catch { info = null; }
      if (info) inits.push({ url: init.url, ...info });
    }
    let reps = [];
    for (const m of (caps.manifests || [])) {
      try { reps = reps.concat(mpdAudioRepresentations(m.text, m.url)); } catch { /* keep what parsed */ }
    }
    // The same manifest can be captured more than once (Amazon's own autoplay
    // refetches it) — dedupe before pairing so one representation stays one.
    const seenRep = new Set();
    reps = reps.filter((r) => {
      const key = [r.id, r.bandwidth, r.sampleRate, r.bitDepth, r.codec].join('|');
      if (seenRep.has(key)) return false;
      seenRep.add(key);
      return true;
    });
    if (!reps.length && inits.length) {
      // No manifest (or an unrecognized one) but the init segments still carry
      // the FLAC facts — a dfla box is proof of codec and parameters on its own.
      reps = inits.map(i => ({
        id: null,
        codec: i.codec || null,
        mimeType: null,
        container: 'mp4',
        bandwidth: null,
        sampleRate: i.sampleRate || null,
        channels: i.channels || null,
        bitDepth: i.bitDepth || null,
        initializationUrl: i.url
      }));
    }
    // A manifest that yields no audio representations is a hornet/packager
    // change worth noticing in the field log — the first 160 chars say which.
    if (reps.length === 0 && caps.manifests && caps.manifests.length) {
      const sample = String(caps.manifests[caps.manifests.length - 1].text || '').slice(0, 160);
      console.warn(`[Amazon] stream quality: ${caps.manifests.length} manifest(s) captured but no audio representation parsed — head: ${sample}`);
      return;
    }
    const merged = attachInitStreamInfo(reps, inits);
    if (this.playGeneration === generation && this.currentAsin === asin) {
      this.streamRepresentations = merged;
      const summary = merged.map(r => `${r.codec || '?'}${r.sampleRate ? ' ' + r.sampleRate + 'Hz' : ''}${r.bitDepth ? ' ' + r.bitDepth + '-bit' : ''}${r.bandwidth ? ' ' + Math.round(r.bandwidth / 1000) + 'kbps' : ''}`);
      console.log(`[Amazon] stream quality: ${merged.length} representation(s) [${summary.join(' | ')}]`);
    }
  },

  // Stream parameters for the representation actually playing, keyed to the
  // measured bitrate (the poller passes its converged median). Read by the
  // poller when it builds the streamQuality record for progress events.
  streamInfo(kbps) {
    const reps = this.streamRepresentations;
    if (!reps || !reps.length) return null;
    const chosen = pickMpdRepresentation(reps, Number(kbps) || 0);
    if (!chosen) return null;
    const out = {};
    if (chosen.codec) out.codec = chosen.codec;
    if (chosen.container) out.container = chosen.container;
    if (chosen.sampleRate) out.sampleRate = chosen.sampleRate;
    if (chosen.bitDepth) out.bitDepth = chosen.bitDepth;
    if (chosen.channels) out.channels = chosen.channels;
    return out;
  },

  // Hornet keeps Audio Quality on playbackController (metro module, not a
  // window global). The player view is 0×0, so Amazon's own modal
  // is unreachable. Read and write the same store the modal writes.
  //
  // The store is never found by requiring modules — executing hornet module
  // factories out of order wedges the page (observed live). The preload's
  // passive __r trap would capture it if Amazon's code routed requires through
  // the global — live observation says it does not on track pages, so the
  // persisted playback-controller localStorage entry (which hornet rehydrates
  // from at boot — "applies on the next track") is the working mechanism, and
  // the trap is an opportunistic upgrade. getStatus's `preload.storeCaptured`
  // reports which path a page is on.
  //
  // `apply` is null for reads, or the quality fields to write.
  async withQualityController(apply) {
    // Do not expand the view here. Settings must not cover the app.
    const win = await this.ensureWindow('player');
    // Quality reads need a music.amazon.com document (localStorage is
    // origin-scoped). When the player is parked, the home page is loaded
    // MUTED — autoplay is allowed and the page is told it is visible, so an
    // unmuted home load could start audible playback from a settings read —
    // and parked again afterward. A real playback page is used as-is.
    let loadedHome = false;
    const genAtStart = this.playGeneration;
    try {
      let url = win.webContents.getURL();
      if (pageBlocksPlayback(url)) {
        throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
      }
      if (!url || url === 'about:blank') {
        try { win.webContents.setAudioMuted(true); } catch { /* gone */ }
        loadedHome = true;
        await loadURLBudgeted(win, HOME_URL);
        url = win.webContents.getURL();
        if (pageBlocksPlayback(url)) {
          throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
        }
      }
      const script = `(() => {
      const readPersistedQuality = ${readPersistedQuality.toString()};
      const writePersistedQuality = ${writePersistedQuality.toString()};
      const amazonQualityFromStore = ${amazonQualityFromStore.toString()};
      const apply = ${apply ? JSON.stringify(apply) : 'null'};
      const store = window.__parachordAmazonPlayback;
      const s = store && store.audioQualitySettings;
      if (s) {
        const step = amazonQualityFromStore(s, apply);
        // Persist only on a write, and only fields that are actually set.
        // A read used to mirror !!abrEnabled, which is false when the field
        // has not materialized, and that false was rehydrated at next boot.
        if (step && step.persist) writePersistedQuality(localStorage, step.persist);
        return step && step.report;
      }
      const persisted = readPersistedQuality(localStorage);
      if (apply) {
        const wrote = writePersistedQuality(localStorage, apply);
        if (wrote) return readPersistedQuality(localStorage) || persisted;
      }
      return persisted || { streamingQuality: null, abrEnabled: true };
    })()`;
      const deadline = Date.now() + QUALITY_WAIT_MS;
      let last = null;
      while (Date.now() < deadline) {
        try { last = await this.evalOn(win, script); } catch { last = null; }
        if (last && last.streamingQuality) return last;
        await new Promise(r => setTimeout(r, 250));
      }
      return last;
    } finally {
      if (loadedHome) {
        // Skip the park if a newer play claimed the player while we read (its
        // loadURL owns the view now); always restore the mute state.
        if (this.playGeneration === genAtStart) {
          try {
            const u = win.webContents.getURL();
            if (u && u !== 'about:blank') await win.webContents.loadURL('about:blank');
          } catch { /* gone */ }
        }
        try { win.webContents.setAudioMuted(false); } catch { /* gone */ }
      }
    }
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
    // Validate before writing anything into hornet's store: a bogus tier
    // written here is rehydrated from the persisted entry on every boot until
    // Amazon's own modal overwrites it. 'HD' maps to the tier the modal writes.
    const normalized = streamingQuality ? normalizeStreamingQuality(streamingQuality) : null;
    if (streamingQuality && !normalized) {
      return { success: false, reason: 'invalid', error: `Unknown Amazon Music audio quality: ${streamingQuality}` };
    }
    const apply = {};
    if (normalized) apply.streamingQuality = normalized;
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

// Exposed for tests: the page scripts serialize logic-module helpers with
// .toString(), and a helper that gains a closure (or a stray backtick in the
// template) breaks only inside the Amazon page. The smoke test evaluates them
// against a bare DOM stub so serialization breakage fails CI instead.
amazonWebPlayer._scripts = { HOOK_SCRIPT, READ_STREAM_CAPS_SCRIPT };

module.exports = amazonWebPlayer;
