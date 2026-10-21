// Runs before music.amazon.com's scripts. Amazon pauses and tears down the
// Widevine element when the window blurs. The player view is 0×0 and must not
// keep keyboard focus, so the page is told it is still visible.
//
// It also installs the window.__r trap: hornet's playbackController lives in
// a Metro module whose id renumbers on every redeploy, and executing module
// factories to find it wedges the page — so the trap only observes requires
// that Amazon's own code makes and captures the store passively.
//
// And it hijacks navigator.mediaSession (embedded-player-kit.js): Amazon's
// page is the only audio playing in the app during Amazon playback, so
// Chromium hands the OS media surface (MPRIS/SMTC/Control Center) and OS
// media keys to the page's own media session. Our handlers on the real
// session receive the keys and postMessage them here (registered on every
// platform — without them a DE can fall through to Chromium's default
// element control), the page's own metadata/handlers hit an inert facade and
// never reach the OS, and main's now-playing mirror (embedded-player-mirror,
// relayed below) writes Parachord's track into the real session so the OS
// card shows it.
//
// SANDBOX CONSTRAINT (load-bearing): the Amazon views run with sandbox: true,
// and a sandboxed preload can only require 'electron'/'events'/'timers'/'url'
// — never local files. An earlier revision required ./amazon-music-logic here,
// which throws "module not found" and silently killed the ENTIRE preload: no
// trap, no visibility stub, with the localStorage quality fallback masking the
// damage (verified live on Electron 39 +wvcus). So installAmazonRequireTrap
// and installAmazonStreamCapture are inlined below as literal copies of the
// ones in amazon-music-logic.js, installMediaSessionHijack of the one in
// embedded-player-kit.js, and
// tests/resolver/amazon-player-preload.test.js fails the build if the copies
// drift or if a local require ever comes back. Do not require local modules
// from this file.
//
// contextIsolation puts this file in a different world from the page. Patching
// document here would not affect Amazon's scripts, so the stub is evaluated in
// the page world (isolated world 0).

function installAmazonRequireTrap(scope) {
  if (scope.__parachordRequireTrap) return;
  scope.__parachordRequireTrap = true;
  let current = null;
  const consider = (mod, id) => {
    try {
      const pc = mod && mod.playbackController;
      if (pc && pc.audioQualitySettings) {
        scope.__parachordAmazonPlayback = pc;
        scope.__parachordAmazonPlaybackModuleId = id;
      }
    } catch (e) {}
  };
  const wrap = (require) => {
    if (typeof require !== 'function' || require.__parachordWrapped) return require;
    const wrapped = function () {
      const mod = require.apply(this, arguments);
      consider(mod, arguments[0]);
      return mod;
    };
    // Keep require's own properties (e.g. metro's require.async) reachable
    // through the wrapper.
    try { Object.setPrototypeOf(wrapped, require); } catch (e) {}
    try { Object.defineProperty(wrapped, '__parachordWrapped', { value: true }); } catch (e) {}
    return wrapped;
  };
  try {
    // The bundle exposes __r as a global assignment, which routes through the
    // setter; a var declaration in a later script leaves the property alone.
    // If __r was already assigned before the trap installs, wrap that value.
    if (typeof scope.__r === 'function') current = wrap(scope.__r);
    Object.defineProperty(scope, '__r', {
      configurable: true,
      get() { return current; },
      set(v) { current = wrap(v); return current; }
    });
  } catch (e) {}
}

function installAmazonStreamCapture(scope) {
  if (!scope || scope.__parachordStreamCapture) return;
  scope.__parachordStreamCapture = true;
  const caps = { manifests: [], inits: [] };
  scope.__parachordStreamCaps = caps;
  const MAX_MANIFESTS = 4;
  const MAX_MANIFEST_CHARS = 524288;
  const MAX_INITS = 8;
  const MAX_INIT_BYTES = 65536;
  const isManifest = (url) => /\.mpd(?:[?#]|$)/i.test(String(url || ''));
  const isInitCandidate = (url) => /\.(?:mp4|m4s|cmfv|cmfa|cmf|dash)(?:[?#]|$)/i.test(String(url || ''));
  const recordManifest = (url, text) => {
    try {
      if (!text || caps.manifests.length >= MAX_MANIFESTS) return;
      caps.manifests.push({ url: String(url), text: String(text).slice(0, MAX_MANIFEST_CHARS) });
    } catch (e) {}
  };
  const recordInit = (url, buf) => {
    try {
      const n = (buf && (buf.byteLength || buf.size)) || 0;
      if (!n || n > MAX_INIT_BYTES || caps.inits.length >= MAX_INITS) return;
      caps.inits.push({ url: String(url), bytes: buf });
    } catch (e) {}
  };
  const observeResponse = (url, res) => {
    try {
      if (!res || typeof res.clone !== 'function') return;
      if (isManifest(url)) {
        res.clone().text().then((t) => recordManifest(url, t), () => {});
      } else if (isInitCandidate(url)) {
        const len = Number(res.headers && res.headers.get && res.headers.get('content-length')) || 0;
        if (!len || len <= MAX_INIT_BYTES) res.clone().arrayBuffer().then((b) => recordInit(url, b), () => {});
      }
    } catch (e) {}
  };
  const urlOf = (input) => {
    try {
      if (typeof input === 'string') return input;
      if (input && typeof input.url === 'string') return input.url;
    } catch (e) {}
    return '';
  };
  try {
    const origFetch = scope.fetch;
    if (typeof origFetch === 'function' && !origFetch.__parachordWrapped) {
      const wrappedFetch = function () {
        const url = urlOf(arguments[0]);
        const p = origFetch.apply(this, arguments);
        try {
          if (p && typeof p.then === 'function' && (isManifest(url) || isInitCandidate(url))) {
            p.then((res) => { observeResponse(url, res); return res; }, () => {});
          }
        } catch (e) {}
        return p;
      };
      try { Object.setPrototypeOf(wrappedFetch, origFetch); } catch (e) {}
      try { Object.defineProperty(wrappedFetch, '__parachordWrapped', { value: true }); } catch (e) {}
      scope.fetch = wrappedFetch;
    }
  } catch (e) {}
  try {
    const OrigXHR = scope.XMLHttpRequest;
    if (typeof OrigXHR === 'function' && !OrigXHR.__parachordWrapped) {
      const WrappedXHR = function () {
        const xhr = new OrigXHR();
        let reqUrl = '';
        try {
          const openOrig = xhr.open;
          if (typeof openOrig === 'function') {
            xhr.open = function () {
              try { reqUrl = String(arguments[1] || ''); } catch (e) {}
              return openOrig.apply(this, arguments);
            };
          }
        } catch (e) {}
        try {
          xhr.addEventListener('load', function () {
            try {
              const rt = xhr.responseType;
              if (rt === '' || rt === 'text') {
                if (isManifest(reqUrl)) recordManifest(reqUrl, xhr.responseText);
              } else if (rt === 'arraybuffer' || rt === 'blob') {
                if (isInitCandidate(reqUrl)) recordInit(reqUrl, xhr.response);
              }
            } catch (e) {}
          });
        } catch (e) {}
        return xhr;
      };
      try { WrappedXHR.prototype = OrigXHR.prototype; } catch (e) {}
      try {
        Object.keys(OrigXHR).forEach((k) => {
          try { if (!(k in WrappedXHR)) WrappedXHR[k] = OrigXHR[k]; } catch (e) {}
        });
      } catch (e) {}
      try { Object.defineProperty(WrappedXHR, '__parachordWrapped', { value: true }); } catch (e) {}
      scope.XMLHttpRequest = WrappedXHR;
    }
  } catch (e) {}
}

function installMediaSessionHijack(scope, onAction) {
  if (!scope || !scope.navigator || scope.__parachordMediaSessionHijack) return null;
  const real = scope.navigator.mediaSession;
  if (!real) return null;
  try {
    Object.defineProperty(scope, '__parachordMediaSessionHijack', { value: true });
  } catch {
    scope.__parachordMediaSessionHijack = true;
  }
  if (typeof onAction === 'function') {
    const report = (action) => {
      try {
        onAction(action);
      } catch {}
    };
    for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) {
      try {
        real.setActionHandler(action, () => report(action));
      } catch {}
    }
  }
  // Inert facade. Every page-world write becomes a silent no-op that never
  // reaches Chromium; reads return inert defaults (or the page's own last
  // write for metadata/playbackState — plain object properties — so
  // read-back page code keeps working). 'mediaSession' in navigator stays
  // true, and the MediaMetadata constructor pages call before assigning
  // .metadata is left untouched.
  const facade = {
    metadata: null,
    playbackState: 'none',
    setActionHandler() {},
    setPositionState() {},
    setCameraActive() {},
    setMicrophoneActive() {}
  };
  try {
    Object.defineProperty(scope.navigator, 'mediaSession', {
      configurable: true,
      get() { return facade; }
    });
  } catch {}
  return real;
}

function applyMediaSessionMirror(real, data, MediaMetadataCtor) {
  if (!real || !data || typeof data !== 'object') return;
  try {
    if ('metadata' in data) {
      const m = data.metadata;
      if (!m) {
        real.metadata = null;
      } else if (typeof MediaMetadataCtor === 'function') {
        const base = {
          title: String(m.title || ''),
          artist: String(m.artist || ''),
          album: String(m.album || '')
        };
        const art = m.artwork && typeof m.artwork === 'string' && /^https:/i.test(m.artwork);
        try {
          real.metadata = new MediaMetadataCtor(art
            ? { title: base.title, artist: base.artist, album: base.album, artwork: [{ src: m.artwork, sizes: '512x512' }] }
            : base);
        } catch {
          try { real.metadata = new MediaMetadataCtor(base); } catch {}
        }
      }
    }
    if (data.playbackState === 'playing' || data.playbackState === 'paused' || data.playbackState === 'none') {
      try { real.playbackState = data.playbackState; } catch {}
    }
    if (data.position && Number(data.position.duration) > 0) {
      const duration = Number(data.position.duration);
      const position = Math.max(0, Math.min(Number(data.position.position) || 0, duration));
      try {
        real.setPositionState({
          duration,
          position,
          playbackRate: data.position.rate === 0 ? 0 : 1
        });
      } catch {}
    }
  } catch {}
}

const PAGE_STUB = `(function () {
  const installAmazonRequireTrap = ${installAmazonRequireTrap.toString()};
  installAmazonRequireTrap(window);
  const installAmazonStreamCapture = ${installAmazonStreamCapture.toString()};
  installAmazonStreamCapture(window);
  const installMediaSessionHijack = ${installMediaSessionHijack.toString()};
  // The hijack RETURNS the real session; the stub holds it in this closure.
  // It is deliberately NOT stashed on window — a plain window property is
  // page-writable, and the page must not be able to reach the real session
  // and re-register its own handlers or metadata over the hijack.
  const msReal = installMediaSessionHijack(window, (action) => {
    try {
      window.postMessage({ __parachordEmbeddedPlayer: { resolverId: 'amazonmusic', type: 'action', action: String(action) } }, '*');
    } catch (e) {}
  });
  const applyMediaSessionMirror = ${applyMediaSessionMirror.toString()};
  // Main → view now-playing mirror: the preload world (which owns ipcRenderer)
  // relays 'embedded-player-mirror' payloads as postMessage events; the stub
  // applies them to the real session behind the facade so the OS card shows
  // Parachord's track instead of the page's own label ("Amazon Music").
  // event.source === window drops messages from cross-origin iframes (they
  // can postMessage to the window too). The bridge is page-forgeable by
  // design — the payload only carries display metadata, and main filters the
  // artwork before it is ever sent.
  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const payload = event && event.data && event.data.__parachordEmbeddedPlayer;
      if (!payload || payload.type !== 'mirror') return;
      applyMediaSessionMirror(msReal, payload.data, window.MediaMetadata);
    } catch (e) {}
  });
  const stop = (event) => { event.stopImmediatePropagation(); };
  window.addEventListener('blur', stop, true);
  window.addEventListener('pagehide', stop, true);
  document.addEventListener('visibilitychange', stop, true);
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return 'visible'; } });
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) {}
  // Canary: this line in the view's console (DevTools on the player/search
  // view) proves the preload actually ran. Its absence is how you notice the
  // sandboxed-preload failure mode this file's header warns about.
  console.log('[Amazon] Parachord preload stub active');
})();`;

// Bridge for the media-session hijack: the page-world stub reports OS media
// keys that Chromium routed to this view's active session (through our
// handlers on the real navigator.mediaSession) as postMessage events, since
// the page world has no ipcRenderer. Forward them to main, which validates
// this view against its registry and funnels them into the renderer's
// existing mpris-control transport path. DOM events cross worlds under
// contextIsolation, so the page-world postMessage reaches this listener.
// The marker is page-forgeable by design — the payload only carries
// idempotent transport actions.
try {
  const { ipcRenderer } = require('electron');
  window.addEventListener('message', (event) => {
    try {
      // event.source === window: a cross-origin iframe inside the page can
      // postMessage to the window too — only same-window messages are ours.
      if (event.source !== window) return;
      const payload = event && event.data && event.data.__parachordEmbeddedPlayer;
      if (!payload || payload.type !== 'action' || !payload.action) return;
      ipcRenderer.send('embedded-player-media-key', {
        resolverId: String(payload.resolverId || ''),
        action: String(payload.action)
      });
    } catch (e) {}
  });
  // Main → view now-playing mirror (macOS/Windows; main gates the platform
  // and playback ownership). Relay to the page world, where the stub applies
  // it to the real session behind the facade.
  ipcRenderer.on('embedded-player-mirror', (event, data) => {
    try {
      window.postMessage({ __parachordEmbeddedPlayer: { type: 'mirror', data } }, '*');
    } catch (e) {}
  });
} catch (e) {}

try {
  const { webFrame } = require('electron');
  webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: PAGE_STUB }]);
} catch (e) {
  // Isolation off, or webFrame unavailable: this world is the page.
  eval(PAGE_STUB);
}
