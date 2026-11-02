// main-process/ipc/embedded-player.js — shared IPC for embedded web players
// (third-party pages playing audio in their own WebContents; Amazon Music's
// hidden player view is the first consumer). The page-world half of this
// design lives in embedded-player-kit.js.
//
// SECURITY MODEL (PR review, 2026-10): the preload's page-world bridge is
// forgeable by design — any script in the embedded page (including
// cross-origin iframes posting to the window) can send a transport action or
// a mirror payload. What bounds that:
//   - only the PLAYER view is registered (not the search view, which loads
//     live Amazon pages during background resolution/import whatever is
//     playing) — registration happens in amazon-web-player.js ensureView;
//   - keys are accepted only while that resolver OWNS playback (the
//     registration's isOwned() — <provider-owned player state> (hornet-era example: amazonWebPlayer.currentAsin, deleted with the hornet player) is non-null
//     exactly while the Amazon player owns it), so a parked view cannot
//     drive another resolver's transport;
//   - a per-sender sliding-window rate limit caps transport spam;
//   - the worst case is transport only (play/pause/next/previous/stop),
//     idempotent and deduped on the renderer side.
// The preload additionally drops events whose source is not its own window
// (cross-origin iframes). The mirror payloads are display data only, and
// artwork is filtered https-only HERE in main — a file:// cover must never
// reach page-world listeners.
//
// The preloads of embedded-player views send hijacked mediaSession actions
// (OS media keys that Chromium routed to the view's active session) on
// `embedded-player-media-key`. Main validates the sender against the view
// registry, applies the ownership + rate gates, and forwards the action into
// the EXISTING `mpris-control` renderer channel — the same path native MPRIS
// uses — so it arrives at the renderer's idempotent,
// isDuplicateTransport-deduped transport handler. One hardware keypress can
// now be delivered by several surfaces at once (native MPRIS, Chromium's
// session, globalShortcuts); that dedupe guard was built for exactly this.
//
// Gated on the media-key-handling setting like globalShortcuts and MPRIS:
// a user who opted out of media-key capture opted out of Parachord responding
// to OS media keys, whichever surface delivered them.
//
// Dependency-injected ({ ipcMain, safeSendToRenderer, mediaKeysEnabled }) —
// no electron require, so jest drives the handler with fakes
// (tests/main-process/embedded-player-ipc.test.js).

'use strict';

// webContents.id → { resolverId, webContents, isOwned }. Only registered
// views may send media-key events, and mirrors are delivered to a resolver's
// views through the same registry.
const registeredViews = new Map();

function registerEmbeddedPlayer(webContents, { resolverId, isOwned } = {}) {
  if (!webContents || typeof webContents.id !== 'number') return;
  registeredViews.set(webContents.id, {
    resolverId: resolverId || 'unknown',
    webContents,
    isOwned: typeof isOwned === 'function' ? isOwned : null
  });
  try {
    webContents.once('destroyed', () => {
      registeredViews.delete(webContents.id);
      senderWindows.delete(webContents.id);
    });
  } catch { /* already destroyed */ }
}

// mediaSession action name → mpris-control action name (the renderer's
// vocabulary). The kit only registers these five, so anything else is a
// forged or stale payload and is dropped. Object.hasOwn (not a bare property
// read) so prototype keys ('constructor', 'toString', '__proto__') cannot
// slip through the allowlist.
const ACTION_MAP = {
  play: 'play',
  pause: 'pause',
  stop: 'stop',
  previoustrack: 'previous',
  nexttrack: 'next'
};

// Per-sender sliding window: a legit user skimming a playlist (or holding a
// key with key-repeat) produces a few actions a second; a page script spamming
// the bridge produces a burst. Past the cap the sender is dropped until the
// window slides — 3/s sustained is generous for fingers and still bounds a
// page burst by orders of magnitude.
const RATE_LIMIT_ACTIONS = 30;
const RATE_LIMIT_WINDOW_MS = 10000;
const senderWindows = new Map();

const rateLimited = (senderId) => {
  const now = Date.now();
  const window = (senderWindows.get(senderId) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (window.length >= RATE_LIMIT_ACTIONS) {
    senderWindows.set(senderId, window);
    return true;
  }
  window.push(now);
  senderWindows.set(senderId, window);
  return false;
};

function registerEmbeddedPlayerIpc({ ipcMain, safeSendToRenderer, mediaKeysEnabled }) {
  ipcMain.on('embedded-player-media-key', (event, payload) => {
    const sender = event && event.sender;
    if (!sender || typeof sender.id !== 'number') return;
    const meta = registeredViews.get(sender.id);
    if (!meta) return;
    // Only the resolver that owns playback may drive the transport — a parked
    // view (or a script in it) must not reach another resolver's transport.
    if (meta.isOwned && !meta.isOwned()) return;
    if (typeof mediaKeysEnabled === 'function' && !mediaKeysEnabled()) return;
    const action = payload && Object.hasOwn(ACTION_MAP, payload.action)
      ? ACTION_MAP[payload.action]
      : null;
    if (!action) return;
    if (rateLimited(sender.id)) return;
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
    } catch { /* destroyed mid-send */ }
  }
}

const HTTPS_URL = /^https:\/\//i;

// Compose and forward the mirror feed from the renderer's existing
// mpris:update-* pushes (track change / play-pause / seek — the same events
// native MPRIS consumes; main.js calls both from the same handlers).
// Stateful on purpose: setPositionState needs the track's duration, which
// the position pushes don't carry — the last-seen track caches it.
//
//   sendMirror(payload)  — delivery (sendMirrorToEmbeddedPlayer bound to a
//                          resolver by the caller)
//   isOwned()            — gate: is the embedded resolver the one playing?
//   enabled()            — platform gate; main.js passes the Linux skip
//                          (Chromium's OS media integration is disabled
//                          process-wide there — see the disable-features block
//                          at the top of main.js — so there is no entry to
//                          mirror into; the native MPRIS player is the single
//                          Linux surface)
//
// Position semantics (PR review, 2026-10): the renderer re-fires update-track
// on every currentTrack IDENTITY churn (~2s: the Amazon poller's progress
// emits re-create the object), so a position-0 push per churn loops the OS
// card's progress. But a bare state push with no position leaves a stale rate
// anchor. The rules:
//   - a REAL track change re-anchors (position 0, current rate);
//   - a same-track churn pushes metadata only — EXCEPT when the duration
//     first becomes known (> 0), which re-anchors with the cached position
//     (a search-resolved Amazon track starts at duration 0 and repairs
//     mid-play as a same-track churn);
//   - a REAL playback-state transition pushes playbackState plus a position
//     patch carrying the CACHED position and the matching rate (never 0
//     resets). The renderer pushes mpris:update-position alongside state
//     changes and seeks, so the cached position is real at those moments.
//   - repeated identical state pushes (the churn re-fires them) push nothing.
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
      const trackChanged = trackId !== state.trackId;
      const hadDuration = state.duration > 0;
      state.trackId = trackId;
      state.duration = t && Number(t.duration) > 0 ? Number(t.duration) : 0;
      if (trackChanged) state.position = 0;
      // Artwork is filtered HERE — the mirror payload crosses into the page
      // world (visible to the page's own listeners), so only https URLs ever
      // make the trip; a file:// cover path must not leak to page scripts.
      const payload = {
        metadata: t ? {
          title: t.title || '',
          artist: t.artist || '',
          album: t.album || '',
          artwork: t.albumArt && HTTPS_URL.test(String(t.albumArt)) ? t.albumArt : null
        } : null
      };
      if (trackChanged) {
        Object.assign(payload, positionPatch());
      } else if (!hadDuration && state.duration > 0) {
        // Duration first became known (the churned-in repair) — re-anchor so
        // the card has the right duration.
        Object.assign(payload, positionPatch());
      }
      push(payload);
    },
    updatePlaybackState(playbackState) {
      const next = playbackState === 'playing'
        ? 'playing'
        : (playbackState === 'stopped' || playbackState === 'none' ? 'none' : 'paused');
      if (next === state.playbackState) return; // churn re-fires; nothing changed
      state.playbackState = next;
      push({
        playbackState: next,
        ...positionPatch()
      });
    },
    updatePosition(seconds) {
      const p = Number(seconds);
      if (Number.isFinite(p) && p >= 0) state.position = p;
      const patch = positionPatch();
      if (Object.keys(patch).length) push(patch);
    }
  };
}

module.exports = {
  registerEmbeddedPlayer,
  registerEmbeddedPlayerIpc,
  sendMirrorToEmbeddedPlayer,
  createEmbeddedPlayerMirror
};
