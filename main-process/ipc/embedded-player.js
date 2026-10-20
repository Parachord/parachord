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

// webContents.id → { resolverId }. Only registered views may send.
const registeredViews = new Map();

function registerEmbeddedPlayer(webContents, { resolverId } = {}) {
  if (!webContents || typeof webContents.id !== 'number') return;
  registeredViews.set(webContents.id, { resolverId: resolverId || 'unknown' });
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

module.exports = { registerEmbeddedPlayer, registerEmbeddedPlayerIpc };
