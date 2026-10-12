// Runs before music.amazon.com's scripts. Amazon pauses and tears down the
// Widevine element when the window blurs. The player window is opacity 0 and
// must not keep keyboard focus, so this page is told it is still visible.
(function () {
  const stop = (event) => {
    event.stopImmediatePropagation();
  };
  window.addEventListener('blur', stop, true);
  window.addEventListener('pagehide', stop, true);
  document.addEventListener('visibilitychange', stop, true);
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get() { return false; } });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get() { return 'visible'; } });
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) { /* already sealed */ }
})();
