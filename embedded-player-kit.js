// embedded-player-kit.js — the page-world kit for embedded web players.
//
// An "embedded player" is a third-party page that plays audio inside its own
// WebContents while Parachord's own UI stays the app the user interacts with
// (Amazon Music's hidden player/search views today; the Bandcamp mini
// playbackWindow is a future consumer). Chromium's OS media integration
// follows the audio: the embedded page's media session becomes the app's
// ACTIVE session, so the OS surface is driven by the third-party page — on
// Linux a second `chromium` MPRIS player (with the page's full metadata)
// next to the native org.mpris.MediaPlayer2.parachord, on Windows/macOS the
// SMTC/Control Center entry the main renderer's #976 mediaSession feed can no
// longer win. Worse, OS media keys are delivered to that session: Chromium
// hands them to the page's own action handlers (or its default behavior,
// pausing the element directly) — playback changes behind Parachord's
// transport, and the poller, the scrobbler and the UI all desync.
//
// installMediaSessionHijack is the fix. Run at document-start in the page
// world, BEFORE the page's own scripts:
//   1. register OUR action handlers on the REAL navigator.mediaSession, so
//      OS keys routed to that session land in Parachord's transport instead:
//      onAction → the owning preload (postMessage bridge) → the
//      `embedded-player-media-key` IPC (main-process/ipc/embedded-player.js,
//      which validates the sender against its view registry) → the existing
//      `mpris-control` renderer channel, idempotent and
//      isDuplicateTransport-deduped there;
//   2. shadow navigator.mediaSession with an inert facade, so the page's own
//      metadata, action handlers and position pushes never reach Chromium's
//      OS integration. With no metadata, the session stops surfacing as a
//      competing OS player — same evidence as parachord#848: the main
//      renderer's audio never published a duplicate MPRIS entry until it set
//      mediaSession metadata.
//
// The handlers are registered on the real object BEFORE shadowing, from the
// same world the page would use, so whatever Chromium does with the page's
// own handlers it does with ours — there is no per-world session ambiguity
// to worry about.
//
// Sandbox constraint (identical to amazon-music-logic.js): this file is the
// single source of truth, but sandboxed preloads CANNOT require local
// modules — consumers inline a literal copy into their page-world stub, and
// tests/preload/embedded-player-kit.test.js +
// tests/resolver/amazon-player-preload.test.js fail the build if the copy
// drifts. Keep this function serialization-safe: no closure over module
// scope, no imports — only its arguments.
//
// The hijacked actions are play/pause/previoustrack/nexttrack/stop — the
// transport vocabulary the renderer's mpris-control handler understands.
// Seek actions are deliberately NOT hijacked: Parachord's OS surfaces report
// canSeek=false today (seek wiring is a documented follow-up), so routing a
// seek would be a lie; with no seekto handler registered, Chromium reports
// no seek support and DE widgets render read-only controls.
//
// Threat model: the onAction callback is page-forgeable (this is a
// third-party page we inject into). Accepted — the payload only carries
// idempotent transport actions, deduped on the renderer side.
//
// Follow-up (not in this file): mirroring Parachord's now-playing metadata
// into the embedded view's real session on macOS/Windows, so the OS widget
// shows the track instead of a generic app name while the embedded player
// owns the active session. Skipped on Linux by design (#848 policy: never
// feed Chromium's MPRIS there).

'use strict';

function installMediaSessionHijack(scope, onAction) {
  if (!scope || !scope.navigator || scope.__parachordMediaSessionHijack) return;
  const real = scope.navigator.mediaSession;
  if (!real) return;
  scope.__parachordMediaSessionHijack = true;
  const report = (action) => {
    try {
      if (typeof onAction === 'function') onAction(action);
    } catch {}
  };
  for (const action of ['play', 'pause', 'previoustrack', 'nexttrack', 'stop']) {
    try {
      real.setActionHandler(action, () => report(action));
    } catch {}
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
}

module.exports = { installMediaSessionHijack };
