// main-process/ipc/embedded-player.js — shared IPC for embedded web players
// (third-party pages playing audio in their own WebContents; Amazon Music's
// hidden views are the first consumer). The page-world half of this design
// lives in embedded-player-kit.js.
//
// The preloads of embedded-player views send hijacked mediaSession actions
// (OS media keys that Chromium routed to the view's active session) on
// `embedded-player-media-key`. Main validates the sender against the view
// registry (only views an owner module registered may send) and forwards the
// action into the EXISTING `mpris-control` renderer channel — the same path
// native MPRIS uses — so it arrives at the renderer's idempotent,
// isDuplicateTransport-deduped transport handler. One hardware keypress can
// now be delivered by several surfaces at once (native MPRIS, Chromium's
// embedded session, globalShortcuts); that dedupe guard was built for
// exactly this.
//
// Gated on the media-key-handling setting like globalShortcuts and MPRIS:
// a user who opted out of media-key capture opted out of Parachord responding
// to OS media keys, whichever surface delivered them.
//
// Dependency-injected ({ ipcMain, safeSendToRenderer, mediaKeysEnabled }) —
// no electron require, so jest drives the handler with fakes
// (tests/main-process/embedded-player-ipc.test.js).

'use strict';

// webContents.id → { resolverId, webContents }. Only registered views may
// send media-key events, and mirrors are delivered to a resolver's views
// through the same registry.
const registeredViews = new Map();

function registerEmbeddedPlayer(webContents, { resolverId } = {}) {
  if (!webContents || typeof webContents.id !== 'number') return;
  registeredViews.set(webContents.id, { resolverId: resolverId || 'unknown', webContents });
  try {
    webContents.once('destroyed', () => registeredViews.delete(webContents.id));
  } catch { /* already destroyed */ }
}

// mediaSession action name → mpris-control action name (the renderer's
// vocabulary). The kit only registers these five, so anything unmapped is a
// forged or stale payload and is dropped.
const ACTION_MAP = {
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  previoustrack: 'previous',
  nexttrack: 'next'
};

function registerEmbeddedPlayerIpc({ ipcMain, safeSendToRenderer, mediaKeysEnabled }) {
  ipcMain.on('embedded-player-media-key', (event, payload) => {
    const sender = event && event.sender;
    if (!sender || typeof sender.id !== 'number') return;
    const meta = registeredViews.get(sender.id);
    if (!meta) return;
    if (typeof mediaKeysEnabled === 'function' && !mediaKeysEnabled()) return;
    const action = payload && ACTION_MAP[payload.action];
    if (!action) return;
    safeSendToRenderer('mpris-control', { action, source: `embedded:${meta.resolverId}` });
  });
}

// Deliver a now-playing mirror payload to a resolver's live views (the
// preload relays it into the page world, where the kit's
// applyMediaSessionMirror writes the real session behind the facade).
// Destroyed views are pruned here — the registry's destroyed hook can miss
// views torn down while no one was sending.
function sendMirrorToEmbeddedPlayer(resolverId, payload) {
  for (const [id, entry] of registeredViews) {
    if (!entry || entry.resolverId !== resolverId) continue;
    const wc = entry.webContents;
    if (!wc || typeof wc.send !== 'function' || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) {
      registeredViews.delete(id);
      continue;
    }
    try {
      wc.send('embedded-player-mirror', payload);
    } catch (e) { /* destroyed mid-send */ }
  }
}

// Compose and forward the mirror feed from the renderer's existing
// mpris:update-* pushes (track change / play-pause / seek — the same events
// native MPRIS consumes; main.js calls both from the same handlers).
// Stateful on purpose: setPositionState needs the track's duration, which
// the position pushes don't carry — the last-seen track caches it.
//
//   sendMirror(payload)  — delivery (sendMirrorToEmbeddedPlayer bound to a
//                          resolver by the caller)
//   isOwned()            — gate: is the embedded resolver the one playing?
//                          (main binds this to the amazon player's
//                          currentAsin — non-null exactly while it owns
//                          playback)
//   enabled()           — optional extra gate (none today: the mirror runs on
//                          every platform — the #848 Linux exception is void)
function createEmbeddedPlayerMirror({ sendMirror, isOwned, enabled }) {
  const state = { trackId: null, duration: 0, position: 0, playbackState: 'paused' };
  const push = (payload) => {
    if (typeof sendMirror !== 'function') return;
    if (typeof isOwned === 'function' && !isOwned()) return;
    if (typeof enabled === 'function' && !enabled()) return;
    sendMirror(payload);
  };
  const positionPatch = () => (state.duration > 0
    ? { position: { duration: state.duration, position: state.position, rate: state.playbackState === 'playing' ? 1 : 0 } }
    : {});
  return {
    updateTrack(track) {
      const t = track && typeof track === 'object' ? track : null;
      const trackId = t ? String(t.id || t.title || '') : '';
      // The renderer fires update-track on every currentTrack IDENTITY churn —
      // during Amazon playback the poller's ~2s progress emits re-create the
      // object (duration repair, stream-quality attach). A same-track push
      // must NOT reset the position to 0: the OS card loops 0:00 → 0:02 →
      // reset at the poller's cadence (observed on macOS, 2026-10). The
      // native MPRIS player never touches position from updateTrack; mirror
      // that — only a REAL track change re-anchors the position.
      const trackChanged = trackId !== state.trackId;
      state.trackId = trackId;
      state.duration = t && Number(t.duration) > 0 ? Number(t.duration) : 0;
      if (trackChanged) state.position = 0;
      push({
        metadata: t ? {
          title: t.title || '',
          artist: t.artist || '',
          album: t.album || '',
          artwork: t.albumArt || null
        } : null,
        ...(trackChanged ? positionPatch() : {})
      });
    },
    updatePlaybackState(playbackState) {
      state.playbackState = playbackState === 'playing' ? 'playing' : 'paused';
      // playbackState only — no position patch. Nothing pushes position during
      // steady playback (position pushes are event-driven: seek, track
      // change), so the cached position is stale here, and the media
      // element's own clock is the card's anchor between pushes.
      push({ playbackState: state.playbackState });
    },
    updatePosition(seconds) {
      const p = Number(seconds);
      if (Number.isFinite(p) && p >= 0) state.position = p;
      const patch = positionPatch();
      if (Object.keys(patch).length) push(patch);
    }
  };
}

module.exports = { registerEmbeddedPlayer, registerEmbeddedPlayerIpc, sendMirrorToEmbeddedPlayer, createEmbeddedPlayerMirror };
