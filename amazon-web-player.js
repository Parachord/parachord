// In-app Amazon Music player. Same idea as MusicKit JS: Electron loads a
// Widevine CDM (borrowed from a Chromium browser — see main.js) and the
// official web player does DRM + decode. Parachord does not extract keys
// or reimplement the license protocol.
//
// Amazon may still reject a borrowed CDM (VMP / robustness). That comes
// back as a playback failure, not a silent success. The macOS desktop-app
// path remains the fallback when this engine cannot start.
//
// Search uses a second hidden window on the same session so a lookup
// cannot navigate the window that is currently playing.

const PARTITION = 'persist:amazon-music';
const HOME_URL = 'https://music.amazon.com/';
const CHROME_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const HOOK_SCRIPT = `(() => {
  if (window.__parachordAmazonHook) return true;
  window.__parachordAmazonHook = true;
  window.__parachordAmazonMedia = null;
  const consider = (el) => {
    if (!el) return;
    const tag = el.tagName;
    if (tag !== 'VIDEO' && tag !== 'AUDIO') return;
    window.__parachordAmazonMedia = el;
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
      state: m.ended ? 'FINISHED' : (m.paused ? 'PAUSED' : 'PLAYING')
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
      root.querySelectorAll('button, music-button, [role="button"]').forEach((el) => buttons.push(el));
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot); });
    };
    walk(document);
    const play = buttons.find((el) => /^play\\b/i.test(labelOf(el).trim()) && !/playlist/i.test(labelOf(el)));
    if (!play) return false;
    play.click();
    return true;
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
    const row = a.closest('music-image-row, [data-testid], li, article') || a.parentElement;
    const lines = ((row && row.innerText) || a.textContent || '')
      .split(/\\n+/).map((s) => s.trim()).filter(Boolean);
    let title = (a.getAttribute('aria-label') || lines[0] || a.textContent || '').trim();
    let artist = lines.length > 1 ? lines[1] : '';
    const by = title.match(/^(.+?)\s+by\s+(.+)$/i);
    if (by && !artist) { title = by[1].trim(); artist = by[2].trim(); }
    const albumName = lines.length > 2 ? lines[2] : '';
    out.push({
      asin: asin.toUpperCase(),
      title: title.slice(0, 200),
      artist: artist.slice(0, 200),
      album: albumName.slice(0, 200),
      duration: 0,
      albumAsin: album ? album[1].toUpperCase() : null
    });
    if (out.length >= 20) break;
  }
  return out;
})()`;

function electron() {
  return require('electron');
}

const amazonWebPlayer = {
  playerWindow: null,
  searchWindow: null,
  authWindow: null,
  searchChain: Promise.resolve(),
  emeProbed: null,
  currentAsin: null,

  cdmAvailable() {
    return !!(global.__parachordWidevineCdm && global.__parachordWidevineCdm.found);
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

  async isSignedIn() {
    try {
      const cookies = await this.session().cookies.get({});
      const hasSession = cookies.some(c => c.name === 'session-id' && c.value && /amazon\./.test(c.domain || ''));
      const hasAuth = cookies.some(c => /^(at-main|sess-at-main|x-main|at-acb|ubid-main)/.test(c.name) && c.value);
      return hasSession && hasAuth;
    } catch {
      return false;
    }
  },

  windowOptions(show) {
    return {
      width: 1100,
      height: 760,
      show: !!show,
      title: 'Amazon Music',
      backgroundColor: '#000000',
      webPreferences: {
        partition: PARTITION,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        webSecurity: true,
        backgroundThrottling: false,
        autoplayPolicy: 'no-user-gesture-required'
      }
    };
  },

  attach(win) {
    const harden = () => {
      try { win.webContents.setUserAgent(CHROME_UA); } catch { /* destroyed */ }
    };
    harden();
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

  async ensureWindow(kind, { show = false } = {}) {
    const { BrowserWindow } = electron();
    const current = kind === 'search' ? this.searchWindow : this.playerWindow;
    if (current && !current.isDestroyed()) {
      if (show) current.show();
      return current;
    }
    this.session();
    const win = this.attach(new BrowserWindow(this.windowOptions(show)));
    if (kind === 'search') this.searchWindow = win;
    else this.playerWindow = win;
    return win;
  },

  async evalOn(win, script) {
    if (!win || win.isDestroyed()) throw new Error('Amazon Music web player window is closed');
    return win.webContents.executeJavaScript(script);
  },

  async probeEme() {
    if (!this.cdmAvailable()) return false;
    if (this.emeProbed !== null) return this.emeProbed;
    try {
      const win = await this.ensureWindow('player', { show: false });
      if (win.webContents.getURL() === '' || win.webContents.getURL() === 'about:blank') {
        await win.loadURL(HOME_URL);
      }
      this.emeProbed = await this.evalOn(win, `(async () => {
        if (!navigator.requestMediaKeySystemAccess) return false;
        try {
          await navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
            initDataTypes: ['cenc'],
            audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }]
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
      const parent = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && w !== this.playerWindow && w !== this.searchWindow) || null;
      win = this.attach(new BrowserWindow({
        ...this.windowOptions(true),
        width: 900,
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
        if (await this.isSignedIn()) {
          clearInterval(timer);
          setTimeout(() => {
            if (win && !win.isDestroyed()) win.close();
          }, 600);
          finish(true);
        }
      }, 1000);
      win.on('closed', () => { finish(false); });
    });
  },

  enqueueSearch(fn) {
    const run = this.searchChain.then(fn, fn);
    this.searchChain = run.then(() => {}, () => {});
    return run;
  },

  async searchTracks(query) {
    if (!query || !query.trim()) return [];
    if (!this.cdmAvailable()) {
      const err = new Error('Widevine CDM not available');
      err.reason = 'no-cdm';
      throw err;
    }
    if (!(await this.isSignedIn())) {
      const err = new Error('Amazon Music web player is not signed in');
      err.reason = 'not-signed-in';
      throw err;
    }
    return this.enqueueSearch(async () => {
      const win = await this.ensureWindow('search', { show: false });
      const url = `https://music.amazon.com/search/${encodeURIComponent(query.trim())}`;
      await win.loadURL(url);
      await new Promise(r => setTimeout(r, 1800));
      await this.evalOn(win, HOOK_SCRIPT).catch(() => {});
      const tracks = await this.evalOn(win, SCRAPE_SCRIPT);
      return Array.isArray(tracks) ? tracks : [];
    });
  },

  async playByAsin({ asin, title, artist } = {}) {
    if (!asin) throw new Error('Amazon Music: no ASIN to play');
    if (!this.cdmAvailable()) {
      return { success: false, reason: 'no-cdm', error: 'Widevine CDM not available' };
    }
    if (!(await this.isSignedIn())) {
      return { success: false, reason: 'not-signed-in', error: 'Sign in to Amazon Music to play in-app' };
    }
    const eme = await this.probeEme();
    if (!eme) {
      return {
        success: false,
        reason: 'no-cdm',
        error: 'Widevine is not usable in this session. Amazon may require a VMP-signed CDM; use the desktop app on macOS.'
      };
    }
    const win = await this.ensureWindow('player', { show: false });
    this.currentAsin = asin;
    const url = `https://music.amazon.com/tracks/${encodeURIComponent(asin)}`;
    await win.loadURL(url);
    await this.evalOn(win, HOOK_SCRIPT).catch(() => {});
    // Give the SPA a moment to render the play control, then click it.
    let clicked = false;
    for (let i = 0; i < 10 && !clicked; i++) {
      await new Promise(r => setTimeout(r, 400));
      try { clicked = await this.evalOn(win, 'window.__parachordAmazonClickPlay ? window.__parachordAmazonClickPlay() : false'); }
      catch { clicked = false; }
    }
    let confirmed = false;
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 400));
      let state = null;
      try { state = await this.evalOn(win, 'window.__parachordAmazonRead ? window.__parachordAmazonRead() : null'); }
      catch { state = null; }
      if (state && state.state === 'PLAYING') { confirmed = true; break; }
    }
    if (!confirmed) {
      await this.pause().catch(() => {});
      return {
        success: false,
        reason: 'playback-failed',
        error: `In-app playback did not start for ${title || asin}${artist ? ' by ' + artist : ''}. Amazon may have rejected the Widevine CDM.`
      };
    }
    return { success: true, confirmed: true, asin, engine: 'web' };
  },

  async readState() {
    const win = this.playerWindow;
    if (!win || win.isDestroyed()) {
      return { state: 'EMPTY', asin: null, title: null, artist: null, positionMs: 0, durationMs: 0 };
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
