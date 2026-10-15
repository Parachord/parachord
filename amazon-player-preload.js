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
// damage (verified live on Electron 39 +wvcus). So installAmazonRequireTrap is
// inlined below as a literal copy of the one in amazon-music-logic.js, and
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

const PAGE_STUB = `(function () {
  const installAmazonRequireTrap = ${installAmazonRequireTrap.toString()};
  installAmazonRequireTrap(window);
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
