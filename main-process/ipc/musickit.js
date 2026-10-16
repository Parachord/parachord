// main-process/ipc/musickit.js — the MusicKit IPC surface: thin delegations
// to the native MusicKit bridge (musickit-bridge.js). Extracted from main.js
// (maintainability plan Track 3, second slice) so the whole surface is
// reviewable in one file.
//
// Everything is dependency-injected ({ ipcMain, getMusicKitBridge,
// getDeveloperToken }) — no electron require, so jest drives the handlers
// directly with a fake bridge (tests/main-process/musickit-ipc.test.js).
//
// musickit:token-status deliberately stays in main.js — it is a diagnostic of
// the token/key infrastructure (.p8 discovery, token caches), not of the
// bridge, and lives with the token-generation cluster it reports on.

function registerMusicKitIpc({ ipcMain, getMusicKitBridge, getDeveloperToken }) {
// Check if MusicKit helper is available (macOS only)
ipcMain.handle('musickit:available', async () => {
  const bridge = getMusicKitBridge();
  return bridge.isAvailable();
});

// Start the MusicKit helper
ipcMain.handle('musickit:start', async () => {
  const bridge = getMusicKitBridge();
  try {
    const started = await bridge.start();
    return { success: started };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check authorization status (uses cache by default, faster for repeated calls)
ipcMain.handle('musickit:check-auth', async (event, forceRefresh = false) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.getAuthStatus(forceRefresh);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get cached auth status synchronously (for quick checks)
ipcMain.handle('musickit:get-cached-auth', async () => {
  const bridge = getMusicKitBridge();
  const cached = bridge.getCachedAuthStatus();
  if (cached) {
    return { success: true, cached: true, ...cached };
  }
  return { success: false, cached: false, authorized: false };
});

// Request authorization
ipcMain.handle('musickit:authorize', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.authorize();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Clear native MusicKit auth state (invalidate cache, stop helper)
ipcMain.handle('musickit:unauthorize', async () => {
  const bridge = getMusicKitBridge();
  try {
    bridge.unauthorize();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('musickit:fetch-user-token', async () => {
  const bridge = getMusicKitBridge();
  try {
    // Priority chain + .p8-generation await live in the injected getter
    // (main.js keeps the token cluster there).
    const developerToken = await getDeveloperToken();
    if (!developerToken) {
      return { success: false, error: 'No developer token available' };
    }
    const result = await bridge.fetchUserToken(developerToken);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Search for songs
ipcMain.handle('musickit:search', async (event, query, limit = 25) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.search(query, limit);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resolve a track by artist/title
ipcMain.handle('musickit:resolve', async (event, artist, title, album = null) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.resolve(artist, title, album);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Play a song by Apple Music ID
ipcMain.handle('musickit:play', async (event, songId) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.play(songId);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Pause playback
ipcMain.handle('musickit:pause', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.pause();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resume playback
ipcMain.handle('musickit:resume', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.resume();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Stop playback
ipcMain.handle('musickit:stop', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.stop_playback();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Skip to next
ipcMain.handle('musickit:skip-next', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.skipToNext();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Skip to previous
ipcMain.handle('musickit:skip-previous', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.skipToPrevious();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Seek to position
ipcMain.handle('musickit:seek', async (event, position) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.seek(position);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get playback state
ipcMain.handle('musickit:get-playback-state', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.getPlaybackState();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get now playing
ipcMain.handle('musickit:get-now-playing', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.getNowPlaying();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add to queue
ipcMain.handle('musickit:add-to-queue', async (event, songId) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.addToQueue(songId);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Set volume
ipcMain.handle('musickit:set-volume', async (event, volume) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.setVolume(volume);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

}
module.exports = { registerMusicKitIpc };
