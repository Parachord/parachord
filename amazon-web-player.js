// In-app Amazon Music player.
//
// Parachord runs on castlabs Electron, which ships a Widevine CDM. A
// BrowserWindow loads music.amazon.com and Amazon's own page does the
// license exchange. No desktop app, no borrowed browser CDM, no separate
// Chrome process.
//
// Search uses a second hidden window on the same session so a lookup
// cannot navigate the window that is currently playing. Sign-in is not
// finished until the user also picks a profile — Amazon shows
// /identity/who-is-listening after login when the account has more than one.

const path = require('path');
const HOME_URL = 'https://music.amazon.com/';
const PARTITION = 'persist:amazon-music';
const PRELOAD = path.join(__dirname, 'amazon-player-preload.js');
const { pageBlocksPlayback } = require('./amazon-music-logic');

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
    return {
      positionMs: Math.round((m.currentTime || 0) * 1000),
      durationMs: d > 0 ? Math.round(d * 1000) : 0,
      paused: !!m.paused,
      ended: !!m.ended,
      state: m.ended ? 'FINISHED' : (m.paused ? 'PAUSED' : 'PLAYING'),
      href: location.href
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
  const out = [];
  const seen = new Set();
  const links = [];
  const walk = (root) => {
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll('a[href]').forEach((a) => links.push(a));
    root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
  };
  walk(document);
  for (const a of links) {
    const href = a.href || a.getAttribute('href') || '';
    const track = href.match(/\\/tracks\\/([A-Z0-9]{10})/i);
    const queryAsin = href.match(/[?&]trackAsin=([A-Z0-9]{10})/i);
    const album = href.match(/\\/albums\\/([A-Z0-9]{10})/i);
    const asin = (track && track[1]) || (queryAsin && queryAsin[1]) || null;
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);
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
  return { href: location.href, tracks: out };
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

const amazonWebPlayer = {
  playerWindow: null,
  searchWindow: null,
  authWindow: null,
  searchChain: Promise.resolve(),
  emeProbed: null,
  currentAsin: null,

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
    for (const win of [this.authWindow, this.playerWindow, this.searchWindow]) {
      if (!win || win.isDestroyed()) continue;
      if (pageBlocksPlayback(win.webContents.getURL())) return false;
    }
    return true;
  },

  windowOptions(show) {
    return {
      width: 1100,
      height: 760,
      show: !!show,
      title: 'Amazon Music',
      backgroundColor: '#000000',
      skipTaskbar: !show,
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: false,
        sandbox: false,
        preload: PRELOAD,
        webSecurity: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    };
  },

  attach(win) {
    const harden = () => {
      try { win.webContents.setUserAgent(chromeUserAgent()); } catch { /* destroyed */ }
    };
    harden();
    try { win.webContents.setBackgroundThrottling(false); } catch { /* destroyed */ }
    win.webContents.on('did-start-navigation', harden);
    win.webContents.on('dom-ready', () => {
      win.webContents.executeJavaScript(HOOK_SCRIPT).catch(() => {});
    });
    win.on('closed', () => {
      if (this.playerWindow === win) this.playerWindow = null;
      if (this.searchWindow === win) this.searchWindow = null;
      if (this.authWindow === win) this.authWindow = null;
    });
    return win;
  },

  // Chromium refuses Amazon's ?do=play autoplay in a hidden window, and
  // showInactive() is not enough either. show() at opacity 0 starts playback.
  // Focus is handed back to the main window so the invisible player does not
  // steal the user's place.
  presentPlayer(win, visible) {
    if (!win || win.isDestroyed()) return;
    try {
      win.setOpacity(visible ? 1 : 0);
      win.show();
      if (visible) {
        win.focus();
        return;
      }
      const { BrowserWindow } = electron();
      const main = BrowserWindow.getAllWindows().find(w => w !== win && w !== this.searchWindow && !w.isDestroyed());
      if (main) main.focus();
    } catch { /* destroyed */ }
  },

  async ensureWindow(kind, { show = false } = {}) {
    const { BrowserWindow } = electron();
    const current = kind === 'search' ? this.searchWindow : this.playerWindow;
    if (current && !current.isDestroyed()) {
      if (kind !== 'search') this.presentPlayer(current, show);
      else if (show) {
        current.show();
        current.focus();
      }
      return current;
    }
    this.session();
    const win = this.attach(new BrowserWindow(this.windowOptions(show)));
    if (kind === 'search') this.searchWindow = win;
    else {
      this.playerWindow = win;
      this.presentPlayer(win, show);
    }
    return win;
  },

  async evalOn(win, script) {
    if (!win || win.isDestroyed()) throw new Error('Amazon Music web player window is closed');
    return win.webContents.executeJavaScript(script);
  },

  async probeEme() {
    if (!this.cdmAvailable()) return false;
    if (this.emeProbed === true) return true;
    try {
      const win = await this.ensureWindow('player', { show: false });
      const url = win.webContents.getURL();
      if (!url || url === 'about:blank') await win.loadURL(HOME_URL);
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
    } catch {
      this.emeProbed = false;
    }
    return this.emeProbed;
  },

  async openLogin() {
    const { BrowserWindow } = electron();
    let win = this.authWindow;
    if (!win || win.isDestroyed()) {
      this.session();
      const parent = BrowserWindow.getAllWindows().find(w =>
        !w.isDestroyed() && w !== this.playerWindow && w !== this.searchWindow
      ) || null;
      win = this.attach(new BrowserWindow({
        ...this.windowOptions(true),
        width: 980,
        height: 760,
        parent: parent || undefined,
        title: 'Sign in to Amazon Music'
      }));
      this.authWindow = win;
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

  async searchTracks(query) {
    if (!query || !query.trim()) return [];
    if (!(await this.isSignedIn())) {
      throw notReady('not-signed-in', 'Sign in and choose an Amazon Music profile');
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search', { show: false });
      const url = `https://music.amazon.com/search/${encodeURIComponent(query.trim())}`;
      await win.loadURL(url);
      let last = { tracks: [] };
      for (let i = 0; i < 16; i++) {
        await new Promise(r => setTimeout(r, 400));
        const href = win.isDestroyed() ? '' : win.webContents.getURL();
        if (pageBlocksPlayback(href)) {
          throw notReady('not-signed-in', 'Choose an Amazon Music profile');
        }
        try { last = await this.evalOn(win, SCRAPE_SCRIPT) || last; } catch { /* page still loading */ }
        if (last && Array.isArray(last.tracks) && last.tracks.length > 0) {
          // Title links render before the artist link. Returning early used
          // to attach title-only hits that the artist+title gate then dropped.
          if (last.tracks.some(t => t.artist) || i >= 12) return last.tracks;
        }
      }
      return (last && Array.isArray(last.tracks)) ? last.tracks : [];
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
    const win = await this.ensureWindow('player', { show: false });
    this.presentPlayer(win, false);
    this.currentAsin = asin;
    // A 400 from the license endpoint is Amazon refusing this build's
    // Widevine certificate (development VMP). Detect it instead of waiting
    // out a generic timeout. Always detach the listener, including the
    // sign-in redirect return below.
    let licenseDenied = false;
    const ses = this.session();
    const licenseFilter = { urls: ['https://music.amazon.com/NA/api/dmls/*'] };
    const onLicense = (details) => {
      if (details.statusCode === 400) licenseDenied = true;
    };
    const detachLicense = () => {
      try { ses.webRequest.onCompleted(licenseFilter, null); } catch { /* none */ }
    };
    try { ses.webRequest.onCompleted(licenseFilter, onLicense); } catch { /* filter already registered */ }
    try {
    // Amazon's own result links use ?do=play. A bare /tracks/{asin} page
    // renders a Play button whose click() does not start Widevine; the query
    // does, once the window is shown (even at opacity 0).
    await win.loadURL(`https://music.amazon.com/tracks/${encodeURIComponent(asin)}?do=play`);
    const landed = win.webContents.getURL();
    if (pageBlocksPlayback(landed)) {
      this.presentPlayer(win, true);
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
      if (licenseDenied) break;
      const state = await read();
      const advancing = state && state.state === 'PLAYING' && state.positionMs > 0;
      if (advancing) {
        if (!playingSince) playingSince = Date.now();
        if (Date.now() - playingSince >= 1500) {
          return { success: true, confirmed: true, asin, engine: 'web' };
        }
      } else {
        playingSince = 0;
      }
    }
    await this.pause().catch(() => {});
    if (licenseDenied) {
      return {
        success: false,
        reason: 'playback-failed',
        error: 'Amazon refused the Widevine license. This build needs a production VMP signature.'
      };
    }
    // Show Amazon's own page so a subscription, region, or explicit-content
    // block is visible instead of a silent failure.
    this.presentPlayer(win, true);
    return {
      success: false,
      reason: 'playback-failed',
      error: `In-app playback did not start for ${title || asin}${artist ? ' by ' + artist : ''}`
    };
    } finally {
      detachLicense();
    }
  },

  async readState() {
    const win = this.playerWindow;
    if (!win || win.isDestroyed()) {
      return { state: 'EMPTY', asin: this.currentAsin, title: null, artist: null, positionMs: 0, durationMs: 0 };
    }
    let state = null;
    try { state = await this.evalOn(win, 'window.__parachordAmazonRead ? window.__parachordAmazonRead() : null'); }
    catch { state = null; }
    if (!state) {
      return { state: 'EMPTY', asin: this.currentAsin, title: null, artist: null, positionMs: 0, durationMs: 0 };
    }
    return {
      state: state.state,
      asin: this.currentAsin,
      title: null,
      artist: null,
      positionMs: state.positionMs || 0,
      durationMs: state.durationMs || 0
    };
  },

  async withMedia(expr) {
    const win = this.playerWindow;
    if (!win || win.isDestroyed()) return { ok: false };
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
    this.currentAsin = null;
    return this.withMedia('m.pause(); try { m.currentTime = 0; } catch (e) {}');
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
  }
};

module.exports = amazonWebPlayer;
