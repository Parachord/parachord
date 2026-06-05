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

// Diagnostic logger. Routes through main so messages appear in main's
// stdout/stderr even in packaged builds without DevTools — required for
// debugging external testers' machines (e.g. dyland84's Fedora, moop250's
// Arch). Cheap to keep in production: at most a few dozen messages per
// auth flow.
const debug = (msg) => {
  try {
    ipcRenderer.send('applemusic:auth-debug', String(msg));
  } catch (_) {
    /* preload IPC unavailable — nothing to log against */
  }
};

debug(`preload loaded at ${location.href}`);

// Poll for window.MusicKit to appear (MusicKit JS loads asynchronously after
// document ready). Once it's available, register a listener on
// authorizationStatusDidChange that IPCs main when isAuthorized flips true.
// Self-clears after first successful registration.
//
// parachord#834 — moop250's report on Arch Linux showed the preload was
// likely running but the auth-completed IPC never fired. Root-cause analysis
// (Phase 1, this commit) suggested the post-auth navigation back to
// beta.music.apple.com lands with MusicKit ALREADY authorized — our event
// listener attaches successfully but observes no transition (isAuthorized
// was already true at attach time), so we'd wait forever for an event that
// will never fire. Fix: synchronous check immediately after listener attach,
// firing auth-completed if isAuthorized is already true.
let pollIteration = 0;
const authReadyInterval = setInterval(() => {
  pollIteration++;
  try {
    if (typeof MusicKit === 'undefined') {
      // Quiet the per-tick log; surface every 10th iteration (5s) so we
      // can see if MusicKit just never appears (e.g. Apple changed their
      // bundle on this page).
      if (pollIteration % 10 === 0) {
        debug(`MusicKit still undefined after ${pollIteration} polls (${pollIteration * 500}ms)`);
      }
      return;
    }
    debug(`MusicKit defined on poll ${pollIteration}`);
    const instance = MusicKit.getInstance();
    if (!instance) {
      debug('MusicKit.getInstance() returned null/undefined — page may not have configured yet');
      return;
    }
    // Use the constant if available, fall back to the documented string
    // literal. Defensive against Apple renaming or removing the constant.
    const eventName = (MusicKit.Events && MusicKit.Events.authorizationStatusDidChange)
      || 'authorizationStatusDidChange';
    const initialAuth = !!instance.isAuthorized;
    debug(`attaching '${eventName}' listener. isAuthorized at attach: ${initialAuth}`);
    instance.addEventListener(eventName, () => {
      const auth = !!instance.isAuthorized;
      debug(`status-change event fired. isAuthorized=${auth}`);
      if (auth) {
        ipcRenderer.send('applemusic:auth-completed');
      }
    });
    // Synchronous already-authorized check (parachord#834 fix).
    //
    // The Cider-style listener-only approach detects state TRANSITIONS, not
    // current state. If MusicKit boots already-authorized (typical on a
    // post-auth-redirect navigation back to beta.music.apple.com where
    // session cookies were set during the sign-in flow on idmsa.apple.com),
    // there's no transition to observe and we're stuck. Cider's reference
    // implementation hides this by calling clearStorageData() before load,
    // which forces every auth to start unauthenticated — we deliberately
    // don't (preserves Spotify cookies on the shared default session), so
    // we have to handle the already-authorized case explicitly.
    if (initialAuth) {
      debug('isAuthorized=true at attach — firing auth-completed immediately');
      ipcRenderer.send('applemusic:auth-completed');
    }
    clearInterval(authReadyInterval);
  } catch (e) {
    debug(`auth-ready poll threw: ${e && e.message ? e.message : e}`);
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
      debug('signin button found — clicking + sending auth-window-ready');
      signin.click();
      ipcRenderer.send('applemusic:auth-window-ready');
      clearInterval(signinInterval);
    }
  } catch (e) {
    debug(`signin poll threw: ${e && e.message ? e.message : e}`);
  }
}, 500);

// Fallback: if the .signin selector never matches (Apple changes their DOM,
// user navigates directly to a sign-in URL, etc.), show the window anyway
// after 5 seconds so the user isn't staring at a blank screen.
setTimeout(() => {
  if (signinInterval) {
    debug('signin selector not found within 5s — showing window via fallback');
    ipcRenderer.send('applemusic:auth-window-ready');
    clearInterval(signinInterval);
  }
}, 5000);
