// main-process/ipc/store.js — the renderer's persisted-key allowlist + the store-* IPC
// handlers, extracted from main.js (maintainability plan Track 3, first slice)
// so the allowlist is reviewable and testable on its own.
//
// Everything here is dependency-injected ({ ipcMain, store, app,
// getPluginsCacheDir }) — no electron require, so jest drives the handlers
// directly (tests/store/store-ipc.test.js).
//
// Sensitive keys (spotify_token, spotify_refresh_token, soundcloud_client_secret,
// ...) are deliberately NOT in this allowlist — they are only accessed through
// their dedicated IPC handlers.

const fs = require('fs').promises;
const path = require('path');

// Every persisted key the renderer reads or writes must be here, or the
// store-* handlers silently refuse it (store-set returns false and main logs
// "Blocked store-set" — the renderer never sees the failure).
// tests/store/allowed-store-keys.test.js cross-checks this list against every
// key the renderer uses; add new keys here first.
const ALLOWED_STORE_KEYS = new Set([
  'active_resolvers', 'ai_chat_histories', 'ai_include_history',
  'applemusic_authorized', 'applemusic_developer_token', 'applemusic_user_token',
  'auto_launch_spotify', 'autoPinnedFriendIds',
  'cache_ai_suggestions', 'cache_album_art', 'cache_album_release_ids', 'cache_artist_data',
  'cache_artist_images', 'cache_charts', 'cache_concerts', 'cache_mbid_mapper', 'cache_new_releases', 'cache_playlist_covers', 'cache_track_sources',
  'concerts_location', 'concerts_location_coords', 'concerts_location_radius',
  'discovery_seen_charts', 'discovery_seen_concerts', 'discovery_seen_criticsPicks', 'discovery_seen_newReleases', 'discovery_seen_recommendations',
  'discord_presence_enabled',
  'friends', 'last_active_view', 'local_playlists', 'media-key-handling',
  'meta_service_configs', 'pinnedFriendIds', 'playlists_view_mode', 'preferred_spotify_device_id',
  'recommendation_blocklist', 'remember_queue', 'resolver_blocklist',
  'resolver_order', 'resolver_sync_settings', 'resolver_volume_offsets',
  'saved_playback_context', 'saved_queue', 'saved_shuffle_state', 'saved_volume',
  'scrobble-failed-queue', 'scrobbler-config-lastfm', 'scrobbler-config-librefm',
  'scrobbler-config-listenbrainz', 'scrobbler_love_push_enabled', 'scrobbling-enabled',
  'love_pushed_keys', 'search_history',
  'selected_chat_provider', 'show_discovery_badges',
  'skip_external_prompt', 'skip_unsaved_friend_warning',
  'suppressed_sync_playlists',
  'theme_preference',
  'tutorial_completed', 'uninstalled_resolvers', 'whats_new_dismissed_version',
  'cached_announcements', 'dismissed_announcement_ids',
  'playlists_sort',
  'hidden_friend_keys',
  // Added 2026-10-12 after finding main had been silently dropping these
  // (store-set returns false and logs "Blocked store-set"; the renderer never
  // sees the failure). cache_critics_picks / hosted_playlists /
  // sync_engine_mode / discovery_seen_* had never persisted (the two
  // discovery_seen_* keys now sit in the alphabetical block above, via #994).
  'cache_critics_picks', 'cache_release_details',
  'hosted_playlists', 'sync_engine_mode', 'sync_playlist_channels',
]);

function registerStoreIpc({ ipcMain, store, app, getPluginsCacheDir }) {
  ipcMain.handle('store-get', (event, key) => {
    if (!ALLOWED_STORE_KEYS.has(key)) {
      console.warn(`⚠️ Blocked store-get for non-whitelisted key: ${key}`);
      return undefined;
    }
    return store.get(key);
  });

  // Batch get — fetch multiple keys in a single IPC roundtrip.
  //
  // Performance-critical: electron-store's .get(key) implementation is
  // `_.get(this.store, key)`, and the `store` getter is
  // `JSON.parse(JSON.stringify(this.#store))` — i.e., every single .get()
  // call deep-clones the ENTIRE underlying config. On populated installs
  // where config.json is ~45MB (ours: 16MB local_playlists + 13MB
  // cache_track_sources + 3.5MB cache_album_art + …), one clone takes
  // ~170ms. Doing 37 .get() calls in a loop = 37 × 170ms ≈ 6 seconds of
  // pure CPU on the main thread, blocking every other IPC handler. That
  // was the dominant component of the ~10s startup gap on populated
  // installs (measured on user's machine: 6315ms for 37-key critical
  // batch + 1707ms for 10-key big-cache batch ≈ 8s total).
  //
  // Fix: read `store.store` ONCE (one clone, ~170ms), then index into
  // the resulting object by key. N+1 work instead of N×N. Drops the
  // 6315ms case to ~200ms.
  ipcMain.handle('store-get-batch', (event, keys) => {
    const t0 = Date.now();
    const data = store.store;
    const cloneMs = Date.now() - t0;
    const result = {};
    for (const key of keys) {
      if (ALLOWED_STORE_KEYS.has(key)) {
        result[key] = data[key];
      }
    }
    const ms = Date.now() - t0;
    if (ms > 50) {
      console.log(`📦 store-get-batch (${keys.length} keys) took ${ms}ms (clone=${cloneMs}ms)`);
    }
    return result;
  });

  ipcMain.handle('store-set', (event, key, value) => {
    if (!ALLOWED_STORE_KEYS.has(key)) {
      console.warn(`⚠️ Blocked store-set for non-whitelisted key: ${key}`);
      return false;
    }
    store.set(key, value);
    return true;
  });

  ipcMain.handle('store-delete', (event, key) => {
    if (!ALLOWED_STORE_KEYS.has(key)) {
      console.warn(`⚠️ Blocked store-delete for non-whitelisted key: ${key}`);
      return false;
    }
    store.delete(key);
    return true;
  });

  ipcMain.handle('store-clear', async () => {
    console.log('=== Reset Application Data ===');

    // Clear all electron-store data
    store.clear();
    console.log('  ✅ Cleared electron-store');

    // Clear plugin cache directory
    try {
      const pluginsDir = getPluginsCacheDir();
      const files = await fs.readdir(pluginsDir);
      for (const file of files) {
        if (file.endsWith('.axe')) {
          await fs.unlink(path.join(pluginsDir, file));
        }
      }
      console.log('  ✅ Cleared plugin cache');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('  ⚠️ Failed to clear plugin cache:', error.message);
      }
    }

    // Clear collection data (synced tracks, albums, artists)
    try {
      const collectionPath = path.join(app.getPath('userData'), 'collection.json');
      await fs.unlink(collectionPath);
      console.log('  ✅ Cleared collection data');
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('  ⚠️ Failed to clear collection data:', error.message);
      }
    }

    // Clear Local Files database (watch folders, scanned tracks)
    try {
      const localFilesDbPath = path.join(app.getPath('userData'), 'local-files.db');
      await fs.unlink(localFilesDbPath);
      console.log('  ✅ Cleared Local Files database');
      // Also clear WAL/SHM files if they exist
      await fs.unlink(localFilesDbPath + '-wal').catch(() => {});
      await fs.unlink(localFilesDbPath + '-shm').catch(() => {});
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.warn('  ⚠️ Failed to clear Local Files database:', error.message);
      }
    }

    return { success: true };
  });
}

module.exports = { ALLOWED_STORE_KEYS, registerStoreIpc };
