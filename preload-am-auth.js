// Preload for the Apple Music auth BrowserWindow (parachord#834).
//
// We open beta.music.apple.com in a dedicated window so the user can sign in
// directly on Apple's real origin — that's the only configuration where
// MusicKit's auth handshake works reliably under Electron (the popup-from-
// custom-scheme-parent flow trips on Chromium's third-party storage
// partitioning, which Electron also gates separately with no public API).
//
// This preload runs INSIDE the auth window. Its job is to detect when sign-in
// completes (so main can harvest cookies) and to auto-click past Apple's
// landing screen so the user lands on the sign-in form, not the splash.
//
// nodeIntegration: true + contextIsolation: false in the auth window's
// webPreferences let us `require('electron')` directly here.

const { ipcRenderer } = require('electron');

// Poll for window.MusicKit to appear (MusicKit JS loads asynchronously after
// document ready). Once it's available, register a listener on
// authorizationStatusDidChange that IPCs main when isAuthorized flips true.
// Self-clears after first successful registration.
const authReadyInterval = setInterval(() => {
  try {
    if (typeof MusicKit === 'undefined') return;
    const instance = MusicKit.getInstance();
    if (!instance) return;
    instance.addEventListener(MusicKit.Events.authorizationStatusDidChange, () => {
      if (instance.isAuthorized) {
        ipcRenderer.send('applemusic:auth-completed');
      }
    });
    clearInterval(authReadyInterval);
  } catch (e) {
    // Swallow — MusicKit may not be fully initialized yet. Next tick.
  }
}, 500);

// Separate poll for the landing-page "Sign in" button. beta.music.apple.com
// shows a splash before the actual sign-in form; auto-clicking it skips
// straight to the form. Once we find the button, click it AND tell main the
// window is ready to show — that gates the BrowserWindow's show() so the user
// never sees the splash, only the sign-in form.
const signinInterval = setInterval(() => {
  try {
    const signin = document.querySelector('.signin') || document.querySelector('[data-testid="signin"]');
    if (signin) {
      signin.click();
      ipcRenderer.send('applemusic:auth-window-ready');
      clearInterval(signinInterval);
    }
  } catch (e) {
    // Swallow.
  }
}, 500);

// Fallback: if the .signin selector never matches (Apple changes their DOM,
// user navigates directly to a sign-in URL, etc.), show the window anyway
// after 5 seconds so the user isn't staring at a blank screen.
setTimeout(() => {
  if (signinInterval) {
    ipcRenderer.send('applemusic:auth-window-ready');
    clearInterval(signinInterval);
  }
}, 5000);
