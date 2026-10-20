// main-process/ipc/discord-presence.js — the discordrpc:* IPC handlers and the
// main-process side of the Discord Rich Presence, extracted from main.js (the
// same shape as ipc/store.js) so the handler surface is reviewable and smoke-
// testable on its own.
//
// The renderer never talks to Discord directly: it pushes now-playing state
// over these channels, and the presence manager (discord-presence.js, root)
// owns the socket, the Application id and the reconnect schedule. The presence
// singleton is created lazily — by the first set-enabled/get-status call, or by
// the boot hydration when the toggle was left on — so a user who never enables
// the feature costs no dependency load and no socket attempt.
//
// Dependency-injected ({ ipcMain, store, createPresence? }) — no electron
// require, so jest drives the handlers directly
// (tests/main-process/registration-smoke.test.js).

'use strict';

const createDiscordPresence = require('../../discord-presence');
const {
  DISCORD_PRESENCE_ENABLED_STORE_KEY,
  resolveDiscordClientId,
} = require('../../discord-presence-logic');

// Resolved on every connection attempt, so DISCORD_CLIENT_ID set for a fork
// or a dev build takes effect on the next try without a restart.
const resolveDiscordClientIdFromEnv = () => resolveDiscordClientId({
  env: process.env.DISCORD_CLIENT_ID,
});

let discordPresence = null;

const getDiscordPresence = (createPresence) => {
  if (discordPresence) return discordPresence;
  try {
    discordPresence = (createPresence || createDiscordPresence)({
      getClientId: resolveDiscordClientIdFromEnv,
      logger: console,
    });
  } catch (err) {
    console.warn('[Discord] presence init failed (non-fatal):', err.message);
    discordPresence = null;
  }
  return discordPresence;
};

/** Dispose the live presence (if one was ever created) on app quit. */
const disposeDiscordPresence = () => {
  if (discordPresence) discordPresence.dispose();
};

function registerDiscordPresenceIpc({ ipcMain, store, createPresence } = {}) {
  // ── Discord Rich Presence state push ────────────────────────────
  //
  // Same shape as the MPRIS feed in main.js: the renderer fires these on track
  // change / play-pause / seek, and discord-presence.js decides what to send to
  // the Discord IPC socket (and whether to be connected at all). The renderer
  // must never talk to Discord directly — the Application id, the socket and
  // the reconnect schedule all stay here.
  ipcMain.handle('discordrpc:set-enabled', (event, enabled) => {
    const value = Boolean(enabled);
    store.set(DISCORD_PRESENCE_ENABLED_STORE_KEY, value);
    const presence = getDiscordPresence(createPresence);
    if (!presence) return { enabled: value, status: value ? 'dependency-missing' : 'off' };
    return presence.setEnabled(value);
  });

  ipcMain.handle('discordrpc:get-status', () => {
    const presence = discordPresence || getDiscordPresence(createPresence);
    if (!presence) {
      return {
        enabled: Boolean(store.get(DISCORD_PRESENCE_ENABLED_STORE_KEY)),
        status: store.get(DISCORD_PRESENCE_ENABLED_STORE_KEY) ? 'dependency-missing' : 'off',
        configured: Boolean(resolveDiscordClientIdFromEnv()),
      };
    }
    return presence.getStatus();
  });

  ipcMain.handle('discordrpc:update-track', (event, track) => {
    if (discordPresence) discordPresence.setTrack(track);
  });

  // The combined push the renderer uses for a now-playing change: one IPC, one
  // SET_ACTIVITY, no intermediate payload built from half-updated state.
  ipcMain.handle('discordrpc:update-state', (event, patch) => {
    if (discordPresence) discordPresence.updateState(patch || {});
  });

  ipcMain.handle('discordrpc:update-playback-state', (event, status) => {
    if (discordPresence) discordPresence.setPlaybackStatus(status);
  });

  ipcMain.handle('discordrpc:update-position', (event, positionSeconds) => {
    if (discordPresence) discordPresence.setPosition(positionSeconds);
  });

  ipcMain.handle('discordrpc:clear', () => {
    if (discordPresence) discordPresence.clear();
  });
}

/**
 * Boot hydration: start connecting when the user has opted in, so the toggle
 * survives restarts. Only start connecting on an explicit opt-in — a disabled
 * feature costs no socket attempt and no reconnect timer.
 */
function hydrateDiscordPresence(store) {
  if (store.get(DISCORD_PRESENCE_ENABLED_STORE_KEY)) {
    const presence = getDiscordPresence();
    if (presence) presence.setEnabled(true);
  }
}

module.exports = {
  registerDiscordPresenceIpc,
  hydrateDiscordPresence,
  disposeDiscordPresence,
};
