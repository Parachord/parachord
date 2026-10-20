// Runs before music.amazon.com's scripts. Amazon pauses and tears down the
// Widevine element when the window blurs. The player view is 0×0 and must not
// keep keyboard focus, so the page is told it is still visible.
//
// It also installs the window.__r trap: hornet's playbackController lives in
// a Metro module whose id renumbers on every redeploy, and executing module
// factories to find it wedges the page — so the trap only observes requires
// that Amazon's own code makes and captures the store passively.
//
// SANDBOX CONSTRAINT (load-bearing): the Amazon views run with sandbox: true,
// and a sandboxed preload can only require 'electron'/'events'/'timers'/'url'
// — never local files. An earlier revision required ./amazon-music-logic here,
// which throws "module not found" and silently killed the ENTIRE preload: no
// trap, no visibility stub, with the localStorage quality fallback masking the
// damage (verified live on Electron 39 +wvcus). So installAmazonRequireTrap
// and installAmazonStreamCapture are inlined below as literal copies of the
// ones in amazon-music-logic.js, and
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

const PAGE_STUB = `(function () {
  const installAmazonRequireTrap = ${installAmazonRequireTrap.toString()};
  installAmazonRequireTrap(window);
  const installAmazonStreamCapture = ${installAmazonStreamCapture.toString()};
  installAmazonStreamCapture(window);
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

try {
  const { webFrame } = require('electron');
  webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: PAGE_STUB }]);
} catch (e) {
  // Isolation off, or webFrame unavailable: this world is the page.
  eval(PAGE_STUB);
}
