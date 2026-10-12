// Runs before music.amazon.com's scripts. Amazon pauses and tears down the
// Widevine element when the window blurs. The player view is 0×0 and must not
// keep keyboard focus, so the page is told it is still visible.
//
// contextIsolation puts this file in a different world from the page. Patching
// document here would not affect Amazon's scripts, so the stub is evaluated in
// the page world (isolated world 0).
const PAGE_STUB = `(function () {
  const stop = (event) => { event.stopImmediatePropagation(); };
  window.addEventListener('blur', stop, true);
  window.addEventListener('pagehide', stop, true);
  document.addEventListener('visibilitychange', stop, true);
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return 'visible'; } });
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) {}
})();`;

try {
  const { webFrame } = require('electron');
  webFrame.executeJavaScriptInIsolatedWorld(0, [{ code: PAGE_STUB }]);
} catch (e) {
  // Isolation off, or webFrame unavailable: this world is the page.
  eval(PAGE_STUB);
}
