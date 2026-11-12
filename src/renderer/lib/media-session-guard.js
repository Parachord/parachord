// src/renderer/lib/media-session-guard.js: Parachord keeps the main window's
// media-session transport actions (play, pause, next, previous).
//
// Apple's MusicKit JS runs in this renderer (configured at startup for catalog
// search, and the Apple Music engine when the native helper can't play). Its
// MediaSessionManager clears every action handler on navigator.mediaSession
// and installs its own, on configure and again on every capability change:
// play and pause go to MusicKit's own player, next and previous are dropped.
// After that, a Mac media key, the Control Center widget or the Windows media
// overlay never reached handlePlayPause. A key pressed during a MusicKit JS
// track resumed MusicKit directly, so the audio played and the progress bar
// moved while the playbar's button stayed on Play; during any other track the
// key went to MusicKit's idle player and did nothing (or resumed the last
// track MusicKit JS had played).
//
// claimMediaSessionActions installs Parachord's handlers through the session's
// own setActionHandler and then shadows that method on the session, so a later
// call for a claimed action (MusicKit's reset to undefined, or its own
// handler) is ignored. Other actions (seekforward, seekbackward, ...) still
// pass through. The returned release() puts the original method back and
// clears the claimed handlers.

const CLAIMED_ACTIONS = ['play', 'pause', 'nexttrack', 'previoustrack'];

function claimMediaSessionActions(session, handlers, { onRefused } = {}) {
  if (!session || typeof session.setActionHandler !== 'function') return () => {};
  // A second claim (a remount) shadows the original method, not our wrapper.
  const original = session.__parachordOriginalSetActionHandler || session.setActionHandler;
  const apply = (action, fn) => {
    try { original.call(session, action, fn); } catch (_e) { /* action unsupported here */ }
  };
  const claimed = new Set(CLAIMED_ACTIONS.filter((action) => typeof handlers[action] === 'function'));
  for (const action of claimed) apply(action, handlers[action]);

  const guarded = function setActionHandler(action, handler) {
    if (claimed.has(action)) {
      if (typeof onRefused === 'function') {
        try { onRefused(action); } catch (_e) { /* diagnostics only */ }
      }
      return undefined;
    }
    return original.call(session, action, handler);
  };
  try {
    Object.defineProperty(session, '__parachordOriginalSetActionHandler', { value: original, configurable: true, writable: true });
    Object.defineProperty(session, 'setActionHandler', { value: guarded, configurable: true, writable: true });
  } catch (_e) {
    // A session that can't be shadowed still gets our handlers; a later
    // script can replace them, as before.
  }

  return function release() {
    try {
      delete session.setActionHandler;
      delete session.__parachordOriginalSetActionHandler;
    } catch (_e) { /* best effort */ }
    // Deleting the own property exposes the prototype method again; a session
    // whose method was an own property to begin with gets it back here.
    if (session.setActionHandler !== original) {
      try { Object.defineProperty(session, 'setActionHandler', { value: original, configurable: true, writable: true }); } catch (_e) { /* best effort */ }
    }
    for (const action of claimed) apply(action, null);
  };
}

module.exports = { claimMediaSessionActions, CLAIMED_ACTIONS };
