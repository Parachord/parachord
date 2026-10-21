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
//   1. unless onAction is null, register OUR action handlers on the REAL
//      navigator.mediaSession, so OS keys routed to that session land in
//      Parachord's transport instead: onAction → the owning preload
//      (postMessage bridge) → the `embedded-player-media-key` IPC
//      (main-process/ipc/embedded-player.js, which validates the sender
//      against its view registry) → the existing `mpris-control` renderer
//      channel, idempotent and isDuplicateTransport-deduped there;
//   2. shadow navigator.mediaSession with an inert facade, so the page's own
//      metadata, action handlers and position pushes never reach Chromium's
//      OS integration.
//
// onAction is NULL only when a caller wants suppression without claiming
// the OS key path (an API option; the Amazon preload always registers — see
// the platform policy below).
//
// PLATFORM POLICY (live-verified on Linux, 2026-10 — three rounds): Chromium
// publishes its MPRIS entry whenever the view's session is ACTIVE (audio
// playing) — regardless of registered actions and metadata, and for ANY
// renderer audio. The kill is NOT page-level: main.js disables the
// MediaSession/InternalMediaSession/HardwareMediaKeyHandling features on
// Linux, so Chromium's OS media integration never exists there and the
// native org.mpris.MediaPlayer2.parachord player is the single surface (the
// kit's handlers are moot there but harmless). On macOS/Windows the session
// stays: SMTC/Control Center is the surface this kit feeds and receives
// keys through. The handlers are registered on every platform regardless —
// without them, a DE that routes media keys to a live session falls through
// to Chromium's default behavior (pausing the element directly, the desync
// this kit exists to prevent); with them, keys land in Parachord's
// transport, and the renderer's isDuplicateTransport guard absorbs a double
// delivery.
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
// The now-playing MIRROR (applyMediaSessionMirror) is the other half of the
// design: the embedded view's session is the app's ACTIVE session during
// playback, and with the page's metadata blocked the OS card falls back to
// the page's own label — "Amazon Music" (the document title; observed live
// on macOS, 2026-10). The mirror writes Parachord's now-playing to the real
// session the caller captured from installMediaSessionHijack — held in a
// closure, NOT on the window, so ordinary page code cannot reach it and
// re-register handlers or metadata over the hijack. (Full page-world
// isolation is not achievable: a determined script can still reach the real
// session through Navigator.prototype's getter, and mirror payloads cross the
// page world where page listeners can observe them — display data only, with
// artwork filtered https-only in main before it is ever sent. The main-side
// gates — player-view-only registration, playback-ownership, per-sender rate
// limit — bound what a hostile page can do.)
// Driven by main through the same renderer pushes native MPRIS uses (the
// mpris:update-* IPC), gated to the resolver that owns playback, and skipped
// on Linux (Chromium's OS media integration is disabled there — the
// disable-features block at the top of main.js; the native MPRIS player is
// the single surface).

'use strict';

// installMediaSessionHijack returns the REAL navigator.mediaSession object
// it captured (or null). The caller keeps the return value in a closure — it
// is deliberately NOT stashed on the scope/window: the page must not be able
// to reach the real session and re-register its own handlers or metadata over
// the hijack (a plain window property is page-writable). The marker
// (__parachordMediaSessionHijack) is non-writable and non-configurable for
// the same reason; it exists for the getStatus() preload probe only.
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

// Apply Parachord's now-playing to the embedded view's REAL session (the
// object RETURNED by installMediaSessionHijack and held in the caller's
// closure), behind the facade — the page can neither see nor reach the
// session, so it cannot interfere with these writes. `data` fields, all optional:
//   metadata:  { title, artist, album, artwork } | null (null clears)
//   playbackState: 'playing' | 'paused' | 'none'
//   position:  { duration, position, rate } — seconds; clamped to the duration
// Artwork is https-only (the OS fetches it; custom-protocol and file URLs
// render nothing), and a MediaMetadata the engine rejects degrades to
// text-only metadata rather than being dropped (the #976 pattern).
// The MediaMetadata CONSTRUCTOR is passed in (the page world's global) —
// applyMediaSessionMirror itself must stay serialization-safe with no bare
// global references. All three arguments come from the caller's closure.
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

module.exports = { installMediaSessionHijack, applyMediaSessionMirror };
