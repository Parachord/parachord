/**
 * Migration helper — imports data from Electron's electron-store into the
 * standalone server's JSON store.
 *
 * Usage:
 *   node -e "require('./lib/migration').migrate('/path/to/electron-store')"
 *
 * Electron-store files are typically at:
 *   macOS:   ~/Library/Application Support/Parachord/config.json
 *   Linux:   ~/.config/Parachord/config.json
 *   Windows: %APPDATA%/Parachord/config.json
 */
const fs = require('fs');
const path = require('path');

// Keys that are safe to migrate from Electron store → server store
const MIGRATABLE_KEYS = [
  'collection_sort_by', 'collection_sort_direction',
  'chat_messages', 'chat_provider_configs',
  'meta_service_configs',
  'playlists', 'playlists_view_mode',
  'recommendation_blocklist',
  'remember_queue', 'resolver_blocklist',
  'resolver_order', 'resolver_sync_settings', 'resolver_volume_offsets',
  'saved_playback_context', 'saved_queue', 'saved_shuffle_state',
  'scrobble-failed-queue', 'scrobbler-config-lastfm', 'scrobbler-config-librefm',
  'scrobbler-config-listenbrainz', 'scrobbling-enabled', 'search_history',
  'selected_chat_provider',
  'suppressed_sync_playlists',
  'uninstalled_resolvers'
];

// Sensitive keys that need special handling (tokens may not be valid cross-environment)
const SENSITIVE_KEYS = [
  'spotify_token', 'spotify_refresh_token', 'spotify_token_expiry',
  'soundcloud_token', 'soundcloud_refresh_token', 'soundcloud_token_expiry',
  'soundcloud_client_id', 'soundcloud_client_secret',
  'spotify_client_id'
];

/**
 * Migrate data from an Electron store JSON file into a server Store instance.
 *
 * @param {string} electronStorePath - Path to Electron's config.json
 * @param {import('./store')} serverStore - Server Store instance
 * @param {Object} [options]
 * @param {boolean} [options.includeTokens=false] - Also migrate auth tokens
 * @param {boolean} [options.overwrite=false] - Overwrite existing server store keys
 * @returns {{ migrated: string[], skipped: string[], errors: string[] }}
 */
function migrate(electronStorePath, serverStore, options = {}) {
  const { includeTokens = false, overwrite = false } = options;
  const result = { migrated: [], skipped: [], errors: [] };

  // Read Electron store
  let electronData;
  try {
    const raw = fs.readFileSync(electronStorePath, 'utf-8');
    electronData = JSON.parse(raw);
  } catch (err) {
    result.errors.push(`Failed to read Electron store: ${err.message}`);
    return result;
  }

  const keysToMigrate = [...MIGRATABLE_KEYS];
  if (includeTokens) keysToMigrate.push(...SENSITIVE_KEYS);

  for (const key of keysToMigrate) {
    if (!(key in electronData)) continue;

    if (!overwrite && serverStore.has(key)) {
      result.skipped.push(key);
      continue;
    }

    try {
      serverStore.set(key, electronData[key]);
      result.migrated.push(key);
    } catch (err) {
      result.errors.push(`${key}: ${err.message}`);
    }
  }

  // Migrate collection.json if it exists alongside the Electron store
  const collectionPath = path.join(path.dirname(electronStorePath), 'collection.json');
  if (fs.existsSync(collectionPath)) {
    try {
      const collectionData = JSON.parse(fs.readFileSync(collectionPath, 'utf-8'));
      const serverCollectionPath = path.join(serverStore.filePath ? path.dirname(serverStore.filePath) : '.', 'collection.json');
      if (!fs.existsSync(serverCollectionPath) || overwrite) {
        fs.writeFileSync(serverCollectionPath, JSON.stringify(collectionData, null, 2));
        result.migrated.push('collection.json');
      } else {
        result.skipped.push('collection.json');
      }
    } catch (err) {
      result.errors.push(`collection.json: ${err.message}`);
    }
  }

  serverStore.flushSync();
  return result;
}

module.exports = { migrate, MIGRATABLE_KEYS, SENSITIVE_KEYS };
