# Resolver Library Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement automatic library sync from Spotify (and future resolvers) to Parachord's Collection and Playlists.

**Architecture:** A generic sync engine orchestrates provider-specific implementations. Each resolver that supports library sync implements a SyncProvider interface. The engine handles scheduling, diffing, and state management while providers handle API-specific fetching.

**Tech Stack:** React state management, Electron IPC, electron-store persistence, Spotify Web API

**Design Document:** `docs/plans/2026-01-25-spotify-library-sync-design.md`

---

## Task 1: Add Sync State to Collection Data Model

**Files:**
- Modify: `app.js` (lines ~2087-2090, Collection state)
- Modify: `main.js` (lines 1807-1842, collection handlers)

**Step 1: Update collection load handler to handle syncSources**

In `main.js`, the existing `collection:load` handler (line 1807) already returns the full JSON. No changes needed - the new `syncSources` field will be preserved automatically.

**Step 2: Add migration for existing collection items**

In `app.js`, after loading collection data, add migration logic to ensure all items have a `syncSources` field:

```javascript
// Add after line ~4200 where collection is loaded
const migrateCollectionData = (data) => {
  const migrate = (items) => items.map(item => ({
    ...item,
    syncSources: item.syncSources || (item.addedAt ? { manual: { addedAt: item.addedAt } } : { manual: { addedAt: Date.now() } })
  }));

  return {
    tracks: migrate(data.tracks || []),
    albums: migrate(data.albums || []),
    artists: migrate(data.artists || [])
  };
};
```

**Step 3: Verify existing save still works**

Run app, add a track to collection, verify `collection.json` saves correctly.

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(sync): add syncSources migration for collection items"
```

---

## Task 2: Add Sync State to Playlist Data Model

**Files:**
- Modify: `app.js` (playlist state handling)
- Modify: `main.js` (lines 1439-1530, playlist handlers)

**Step 1: Update playlist save to preserve sync metadata**

The existing handlers already preserve all fields. Verify by checking `playlists-save` handler at line 1503.

**Step 2: Add locallyModified tracking**

In `app.js`, find where playlist tracks are modified (add/remove/reorder). Set `locallyModified: true` when user edits a synced playlist.

Search for playlist track modification points:
- Adding tracks to playlist (around line 28855)
- Removing tracks from playlist
- Reordering tracks

Add wrapper function:

```javascript
const markPlaylistAsLocallyModified = (playlistId) => {
  setPlaylists(prev => prev.map(p =>
    p.id === playlistId && p.syncedFrom
      ? { ...p, locallyModified: true, lastModified: Date.now() }
      : p
  ));
};
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(sync): add locallyModified tracking for playlists"
```

---

## Task 3: Create Sync Settings Store Structure

**Files:**
- Modify: `app.js` (add sync settings state)
- Modify: `preload.js` (add sync settings IPC)
- Modify: `main.js` (add sync settings handlers)

**Step 1: Add sync settings state to app.js**

Add near line 2090 with other state declarations:

```javascript
// Resolver sync settings
const [resolverSyncSettings, setResolverSyncSettings] = useState({});
const [syncStatus, setSyncStatus] = useState({}); // { spotify: { lastSyncAt, inProgress, error } }
```

**Step 2: Add IPC handlers in main.js**

Add after line 1842 (after collection handlers):

```javascript
// Resolver sync settings
ipcMain.handle('sync-settings:load', async () => {
  return store.get('resolver_sync_settings') || {};
});

ipcMain.handle('sync-settings:save', async (event, settings) => {
  store.set('resolver_sync_settings', settings);
  return { success: true };
});

ipcMain.handle('sync-settings:get-provider', async (event, providerId) => {
  const settings = store.get('resolver_sync_settings') || {};
  return settings[providerId] || null;
});

ipcMain.handle('sync-settings:set-provider', async (event, providerId, providerSettings) => {
  const settings = store.get('resolver_sync_settings') || {};
  settings[providerId] = providerSettings;
  store.set('resolver_sync_settings', settings);
  return { success: true };
});
```

**Step 3: Expose in preload.js**

Add after line 142 (after collection namespace):

```javascript
syncSettings: {
  load: () => ipcRenderer.invoke('sync-settings:load'),
  save: (settings) => ipcRenderer.invoke('sync-settings:save', settings),
  getProvider: (providerId) => ipcRenderer.invoke('sync-settings:get-provider', providerId),
  setProvider: (providerId, settings) => ipcRenderer.invoke('sync-settings:set-provider', providerId, settings)
},
```

**Step 4: Load sync settings on app start**

In `app.js`, add to the useEffect that loads initial data (around line 7540):

```javascript
const loadSyncSettings = async () => {
  const settings = await window.electron.syncSettings.load();
  setResolverSyncSettings(settings);
};
loadSyncSettings();
```

**Step 5: Commit**

```bash
git add main.js preload.js app.js
git commit -m "feat(sync): add sync settings storage infrastructure"
```

---

## Task 4: Create Sync Provider Interface Types

**Files:**
- Create: `sync-providers/types.js`

**Step 1: Create the types file**

Create `sync-providers/types.js`:

```javascript
/**
 * @typedef {Object} SyncProviderCapabilities
 * @property {boolean} tracks - Can sync liked/saved songs
 * @property {boolean} albums - Can sync saved albums
 * @property {boolean} artists - Can sync followed artists
 * @property {boolean} playlists - Can sync user playlists
 * @property {boolean} playlistFolders - Supports hierarchical playlist organization
 */

/**
 * @typedef {Object} SyncTrack
 * @property {string} id - Unique identifier (artist-title-album normalized)
 * @property {string} externalId - ID in the source service
 * @property {string} title - Track title
 * @property {string} artist - Artist name
 * @property {string} album - Album name
 * @property {number} duration - Duration in seconds
 * @property {string} [albumArt] - Album art URL
 * @property {number} addedAt - When added to source library (timestamp)
 */

/**
 * @typedef {Object} SyncAlbum
 * @property {string} id - Unique identifier
 * @property {string} externalId - ID in the source service
 * @property {string} title - Album title
 * @property {string} artist - Artist name
 * @property {number} [year] - Release year
 * @property {string} [art] - Album art URL
 * @property {number} addedAt - When added to source library
 */

/**
 * @typedef {Object} SyncArtist
 * @property {string} id - Unique identifier
 * @property {string} externalId - ID in the source service
 * @property {string} name - Artist name
 * @property {string} [image] - Artist image URL
 * @property {number} addedAt - When followed
 */

/**
 * @typedef {Object} SyncPlaylist
 * @property {string} id - Unique identifier
 * @property {string} externalId - ID in the source service
 * @property {string} name - Playlist name
 * @property {string} [description] - Playlist description
 * @property {string} [image] - Playlist cover image
 * @property {number} trackCount - Number of tracks
 * @property {string} [snapshotId] - Version identifier for change detection
 * @property {string} [folderId] - Parent folder ID if in a folder
 * @property {string} [folderName] - Parent folder name
 * @property {boolean} isOwnedByUser - Whether user created this playlist
 */

/**
 * @typedef {Object} SyncPlaylistFolder
 * @property {string} id - Folder ID
 * @property {string} name - Folder name
 * @property {string[]} playlistIds - IDs of playlists in this folder
 */

/**
 * @typedef {Object} SyncProgress
 * @property {string} phase - Current phase: 'fetching' | 'processing' | 'saving' | 'complete' | 'error'
 * @property {string} type - What's being synced: 'tracks' | 'albums' | 'artists' | 'playlists'
 * @property {number} current - Current item number
 * @property {number} total - Total items to process
 * @property {string} [message] - Human-readable status message
 */

/**
 * @typedef {Object} SyncResult
 * @property {boolean} success
 * @property {number} added - Items added
 * @property {number} removed - Items removed
 * @property {number} unchanged - Items unchanged
 * @property {string[]} [errors] - Any errors encountered
 */

/**
 * Interface that sync providers must implement.
 * Each resolver that supports library sync creates a provider.
 *
 * @typedef {Object} SyncProvider
 * @property {string} id - Resolver identifier (e.g., "spotify")
 * @property {string} displayName - Human-readable name for UI
 * @property {SyncProviderCapabilities} capabilities - What this provider can sync
 * @property {function(string): Promise<SyncTrack[]>} fetchTracks - Fetch all liked/saved tracks
 * @property {function(string): Promise<SyncAlbum[]>} fetchAlbums - Fetch all saved albums
 * @property {function(string): Promise<SyncArtist[]>} fetchArtists - Fetch all followed artists
 * @property {function(string): Promise<{playlists: SyncPlaylist[], folders: SyncPlaylistFolder[]}>} fetchPlaylists - Fetch all playlists with folder structure
 * @property {function(string, string): Promise<SyncTrack[]>} fetchPlaylistTracks - Fetch tracks for a specific playlist
 * @property {function(string, string): Promise<string>} getPlaylistSnapshot - Get current snapshot ID for change detection
 * @property {function(): number} getRateLimitDelay - Get delay between API calls in ms
 * @property {function(string): Promise<boolean>} checkAuth - Verify token is valid
 */

module.exports = {
  // Export empty object - types are for JSDoc only
};
```

**Step 2: Commit**

```bash
git add sync-providers/types.js
git commit -m "feat(sync): add sync provider interface types"
```

---

## Task 5: Implement Spotify Sync Provider

**Files:**
- Create: `sync-providers/spotify.js`

**Step 1: Create the Spotify provider**

Create `sync-providers/spotify.js`:

```javascript
/**
 * Spotify Sync Provider
 * Implements the SyncProvider interface for Spotify library sync.
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

/**
 * Normalize a string for ID generation (lowercase, remove special chars)
 */
const normalizeForId = (str) => {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

/**
 * Generate a consistent ID from artist, title, album
 */
const generateTrackId = (artist, title, album) => {
  return `${normalizeForId(artist)}-${normalizeForId(title)}-${normalizeForId(album)}`;
};

/**
 * Make an authenticated Spotify API request with pagination support
 */
const spotifyFetch = async (endpoint, token, allItems = [], onProgress) => {
  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 429) {
      // Rate limited - get retry-after header
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return spotifyFetch(endpoint, token, allItems, onProgress);
    }
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const items = data.items || [];
  const combined = [...allItems, ...items];

  if (onProgress) {
    onProgress({ current: combined.length, total: data.total || combined.length });
  }

  // Handle pagination
  if (data.next) {
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    return spotifyFetch(data.next, token, combined, onProgress);
  }

  return combined;
};

/**
 * Transform Spotify track object to SyncTrack
 */
const transformTrack = (item, addedAt) => {
  const track = item.track || item;
  return {
    id: generateTrackId(track.artists?.[0]?.name, track.name, track.album?.name),
    externalId: track.id,
    title: track.name,
    artist: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: track.album?.name || 'Unknown Album',
    duration: Math.round((track.duration_ms || 0) / 1000),
    albumArt: track.album?.images?.[0]?.url || null,
    addedAt: addedAt ? new Date(addedAt).getTime() : Date.now(),
    spotifyUri: track.uri,
    spotifyId: track.id
  };
};

/**
 * Transform Spotify album object to SyncAlbum
 */
const transformAlbum = (item) => {
  const album = item.album || item;
  return {
    id: `${normalizeForId(album.artists?.[0]?.name)}-${normalizeForId(album.name)}`,
    externalId: album.id,
    title: album.name,
    artist: album.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    year: album.release_date ? parseInt(album.release_date.substring(0, 4), 10) : null,
    art: album.images?.[0]?.url || null,
    addedAt: item.added_at ? new Date(item.added_at).getTime() : Date.now(),
    spotifyUri: album.uri,
    spotifyId: album.id
  };
};

/**
 * Transform Spotify artist object to SyncArtist
 */
const transformArtist = (artist) => {
  return {
    id: normalizeForId(artist.name),
    externalId: artist.id,
    name: artist.name,
    image: artist.images?.[0]?.url || null,
    addedAt: Date.now(), // Spotify doesn't provide follow date
    spotifyUri: artist.uri,
    spotifyId: artist.id
  };
};

/**
 * Transform Spotify playlist object to SyncPlaylist
 */
const transformPlaylist = (playlist, folderId = null, folderName = null) => {
  return {
    id: `spotify-${playlist.id}`,
    externalId: playlist.id,
    name: playlist.name,
    description: playlist.description || '',
    image: playlist.images?.[0]?.url || null,
    trackCount: playlist.tracks?.total || 0,
    snapshotId: playlist.snapshot_id,
    folderId,
    folderName,
    isOwnedByUser: playlist.owner?.id === playlist.owner?.id, // Will be set properly during fetch
    spotifyUri: playlist.uri
  };
};

/**
 * Spotify Sync Provider implementation
 */
const SpotifySyncProvider = {
  id: 'spotify',
  displayName: 'Spotify',

  capabilities: {
    tracks: true,
    albums: true,
    artists: true,
    playlists: true,
    playlistFolders: true
  },

  /**
   * Fetch all liked/saved tracks from Spotify
   */
  async fetchTracks(token, onProgress) {
    const items = await spotifyFetch('/me/tracks?limit=50', token, [], onProgress);
    return items.map(item => transformTrack(item, item.added_at));
  },

  /**
   * Fetch all saved albums from Spotify
   */
  async fetchAlbums(token, onProgress) {
    const items = await spotifyFetch('/me/albums?limit=50', token, [], onProgress);
    return items.map(transformAlbum);
  },

  /**
   * Fetch all followed artists from Spotify
   */
  async fetchArtists(token, onProgress) {
    // Artists use cursor-based pagination, different from other endpoints
    const fetchArtistsPage = async (after = null, allArtists = []) => {
      const url = `/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`;
      const response = await fetch(`${SPOTIFY_API_BASE}${url}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`Spotify API error: ${response.status}`);
      }

      const data = await response.json();
      const artists = data.artists?.items || [];
      const combined = [...allArtists, ...artists];

      if (onProgress) {
        onProgress({ current: combined.length, total: data.artists?.total || combined.length });
      }

      if (data.artists?.cursors?.after) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return fetchArtistsPage(data.artists.cursors.after, combined);
      }

      return combined;
    };

    const artists = await fetchArtistsPage();
    return artists.map(transformArtist);
  },

  /**
   * Fetch all user playlists from Spotify
   * Note: Spotify API doesn't expose folder structure directly via standard endpoints
   * Folders are only available in the desktop app's internal API
   */
  async fetchPlaylists(token, onProgress) {
    const items = await spotifyFetch('/me/playlists?limit=50', token, [], onProgress);

    // Get current user ID for ownership check
    const userResponse = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userResponse.json();
    const userId = userData.id;

    const playlists = items.map(playlist => ({
      ...transformPlaylist(playlist),
      isOwnedByUser: playlist.owner?.id === userId
    }));

    // Spotify's public API doesn't expose folders
    // Return empty folders array - folders would require unofficial API access
    return {
      playlists,
      folders: []
    };
  },

  /**
   * Fetch tracks for a specific playlist
   */
  async fetchPlaylistTracks(playlistId, token, onProgress) {
    const items = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=100`, token, [], onProgress);
    return items
      .filter(item => item.track) // Filter out null tracks (deleted/unavailable)
      .map(item => transformTrack(item, item.added_at));
  },

  /**
   * Get current snapshot ID for a playlist
   */
  async getPlaylistSnapshot(playlistId, token) {
    const response = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=snapshot_id`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Spotify API error: ${response.status}`);
    }

    const data = await response.json();
    return data.snapshot_id;
  },

  /**
   * Get recommended delay between API calls
   */
  getRateLimitDelay() {
    return 100; // 100ms between calls
  },

  /**
   * Check if token is valid
   */
  async checkAuth(token) {
    try {
      const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  }
};

module.exports = SpotifySyncProvider;
```

**Step 2: Commit**

```bash
git add sync-providers/spotify.js
git commit -m "feat(sync): implement Spotify sync provider"
```

---

## Task 6: Create Sync Engine Core

**Files:**
- Create: `sync-engine/index.js`

**Step 1: Create the sync engine**

Create `sync-engine/index.js`:

```javascript
/**
 * Sync Engine
 * Orchestrates library sync across all providers.
 * Handles scheduling, diffing, and state management.
 */

const SpotifySyncProvider = require('../sync-providers/spotify');

// Registry of available sync providers
const providers = {
  spotify: SpotifySyncProvider
};

/**
 * Get a provider by ID
 */
const getProvider = (providerId) => {
  return providers[providerId] || null;
};

/**
 * Get all available providers
 */
const getAllProviders = () => {
  return Object.values(providers);
};

/**
 * Calculate diff between remote items and local items
 * Returns { toAdd, toRemove, toUpdate, unchanged }
 */
const calculateDiff = (remoteItems, localItems, providerId) => {
  const remoteMap = new Map(remoteItems.map(item => [item.id, item]));
  const localMap = new Map(localItems.map(item => [item.id, item]));

  const toAdd = [];
  const toRemove = [];
  const toUpdate = [];
  const unchanged = [];

  // Find items to add or update
  for (const [id, remoteItem] of remoteMap) {
    const localItem = localMap.get(id);
    if (!localItem) {
      // New item - add with this provider as source
      toAdd.push({
        ...remoteItem,
        syncSources: {
          [providerId]: {
            addedAt: remoteItem.addedAt,
            syncedAt: Date.now()
          }
        }
      });
    } else if (!localItem.syncSources?.[providerId]) {
      // Item exists but doesn't have this provider as source - add source
      toUpdate.push({
        ...localItem,
        syncSources: {
          ...localItem.syncSources,
          [providerId]: {
            addedAt: remoteItem.addedAt,
            syncedAt: Date.now()
          }
        }
      });
    } else {
      // Item exists with this provider - update syncedAt
      unchanged.push({
        ...localItem,
        syncSources: {
          ...localItem.syncSources,
          [providerId]: {
            ...localItem.syncSources[providerId],
            syncedAt: Date.now()
          }
        }
      });
    }
  }

  // Find items to remove (in local with this provider source, but not in remote)
  for (const [id, localItem] of localMap) {
    if (localItem.syncSources?.[providerId] && !remoteMap.has(id)) {
      // Remove this provider's source
      const newSyncSources = { ...localItem.syncSources };
      delete newSyncSources[providerId];

      // If no sources left, mark for removal
      if (Object.keys(newSyncSources).length === 0) {
        toRemove.push(localItem);
      } else {
        // Still has other sources - just update syncSources
        toUpdate.push({
          ...localItem,
          syncSources: newSyncSources
        });
      }
    }
  }

  return { toAdd, toRemove, toUpdate, unchanged };
};

/**
 * Apply diff to collection data
 */
const applyDiff = (collectionItems, diff) => {
  const { toAdd, toRemove, toUpdate, unchanged } = diff;

  // Create map of items to remove
  const removeIds = new Set(toRemove.map(item => item.id));

  // Create map of items to update
  const updateMap = new Map(toUpdate.map(item => [item.id, item]));

  // Create map of unchanged items
  const unchangedMap = new Map(unchanged.map(item => [item.id, item]));

  // Filter out removed items and apply updates
  const result = collectionItems
    .filter(item => !removeIds.has(item.id))
    .map(item => updateMap.get(item.id) || unchangedMap.get(item.id) || item);

  // Add new items
  return [...result, ...toAdd];
};

/**
 * Sync a specific data type (tracks, albums, artists) for a provider
 */
const syncDataType = async (provider, token, dataType, localData, onProgress) => {
  // Fetch remote data
  let remoteData;
  switch (dataType) {
    case 'tracks':
      remoteData = await provider.fetchTracks(token, onProgress);
      break;
    case 'albums':
      remoteData = await provider.fetchAlbums(token, onProgress);
      break;
    case 'artists':
      remoteData = await provider.fetchArtists(token, onProgress);
      break;
    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }

  // Calculate diff
  const diff = calculateDiff(remoteData, localData, provider.id);

  // Apply diff
  const newData = applyDiff(localData, diff);

  return {
    data: newData,
    stats: {
      added: diff.toAdd.length,
      removed: diff.toRemove.length,
      updated: diff.toUpdate.length,
      unchanged: diff.unchanged.length
    }
  };
};

/**
 * Calculate playlist diff (simpler - playlists are single-source)
 */
const calculatePlaylistDiff = (remotePlaylists, localPlaylists, selectedIds, providerId) => {
  const selectedRemote = remotePlaylists.filter(p => selectedIds.includes(p.externalId));
  const localSynced = localPlaylists.filter(p => p.syncedFrom?.resolver === providerId);

  const remoteMap = new Map(selectedRemote.map(p => [p.externalId, p]));
  const localMap = new Map(localSynced.map(p => [p.syncedFrom?.externalId, p]));

  const toAdd = [];
  const toUpdate = []; // Playlists with hasUpdates = true
  const toRemove = [];
  const unchanged = [];

  // Find new playlists to add
  for (const [externalId, remotePlaylist] of remoteMap) {
    const localPlaylist = localMap.get(externalId);
    if (!localPlaylist) {
      toAdd.push(remotePlaylist);
    } else if (localPlaylist.syncedFrom?.snapshotId !== remotePlaylist.snapshotId) {
      // Snapshot changed - mark as having updates
      toUpdate.push({
        ...localPlaylist,
        hasUpdates: true
      });
    } else {
      unchanged.push(localPlaylist);
    }
  }

  // Find playlists to potentially remove (no longer selected or deleted on remote)
  for (const [externalId, localPlaylist] of localMap) {
    if (!remoteMap.has(externalId)) {
      // Playlist no longer in remote or no longer selected
      if (localPlaylist.locallyModified) {
        // Keep modified playlists, just remove sync metadata
        toUpdate.push({
          ...localPlaylist,
          syncedFrom: null,
          hasUpdates: false
        });
      } else {
        toRemove.push(localPlaylist);
      }
    }
  }

  return { toAdd, toUpdate, toRemove, unchanged };
};

module.exports = {
  getProvider,
  getAllProviders,
  calculateDiff,
  applyDiff,
  syncDataType,
  calculatePlaylistDiff
};
```

**Step 2: Commit**

```bash
git add sync-engine/index.js
git commit -m "feat(sync): create sync engine core with diff calculation"
```

---

## Task 7: Add Sync IPC Handlers

**Files:**
- Modify: `main.js` (add sync handlers after line 1842)
- Modify: `preload.js` (expose sync API)

**Step 1: Add sync handlers to main.js**

Add after line 1842 (after collection handlers):

```javascript
// =============================================================================
// RESOLVER LIBRARY SYNC
// =============================================================================

const SyncEngine = require('./sync-engine');
const SpotifySyncProvider = require('./sync-providers/spotify');

// Track active sync operations
const activeSyncs = new Map();

ipcMain.handle('sync:get-providers', async () => {
  const providers = SyncEngine.getAllProviders();
  return providers.map(p => ({
    id: p.id,
    displayName: p.displayName,
    capabilities: p.capabilities
  }));
});

ipcMain.handle('sync:check-auth', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider) {
    return { authenticated: false, error: 'Provider not found' };
  }

  // Get token from store
  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

  if (!token) {
    return { authenticated: false, error: 'No token found' };
  }

  const isValid = await provider.checkAuth(token);
  return { authenticated: isValid };
});

ipcMain.handle('sync:start', async (event, providerId, options = {}) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider) {
    return { success: false, error: 'Provider not found' };
  }

  // Check if sync already in progress
  if (activeSyncs.has(providerId)) {
    return { success: false, error: 'Sync already in progress' };
  }

  // Get token
  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  // Mark sync as active
  activeSyncs.set(providerId, { startedAt: Date.now(), cancelled: false });

  const sendProgress = (progress) => {
    if (!activeSyncs.get(providerId)?.cancelled) {
      event.sender.send('sync:progress', { providerId, ...progress });
    }
  };

  try {
    const results = { tracks: null, albums: null, artists: null, playlists: null };
    const settings = options.settings || {};

    // Load current collection
    const collectionPath = path.join(app.getPath('userData'), 'collection.json');
    let collection;
    try {
      const content = await fsPromises.readFile(collectionPath, 'utf8');
      collection = JSON.parse(content);
    } catch {
      collection = { tracks: [], albums: [], artists: [] };
    }

    // Sync tracks
    if (settings.syncTracks !== false && provider.capabilities.tracks) {
      sendProgress({ phase: 'fetching', type: 'tracks', message: 'Fetching liked songs...' });
      const trackResult = await SyncEngine.syncDataType(
        provider,
        token,
        'tracks',
        collection.tracks || [],
        (p) => sendProgress({ phase: 'fetching', type: 'tracks', ...p })
      );
      collection.tracks = trackResult.data;
      results.tracks = trackResult.stats;
    }

    // Sync albums
    if (settings.syncAlbums !== false && provider.capabilities.albums) {
      sendProgress({ phase: 'fetching', type: 'albums', message: 'Fetching saved albums...' });
      const albumResult = await SyncEngine.syncDataType(
        provider,
        token,
        'albums',
        collection.albums || [],
        (p) => sendProgress({ phase: 'fetching', type: 'albums', ...p })
      );
      collection.albums = albumResult.data;
      results.albums = albumResult.stats;
    }

    // Sync artists
    if (settings.syncArtists !== false && provider.capabilities.artists) {
      sendProgress({ phase: 'fetching', type: 'artists', message: 'Fetching followed artists...' });
      const artistResult = await SyncEngine.syncDataType(
        provider,
        token,
        'artists',
        collection.artists || [],
        (p) => sendProgress({ phase: 'fetching', type: 'artists', ...p })
      );
      collection.artists = artistResult.data;
      results.artists = artistResult.stats;
    }

    // Save collection
    sendProgress({ phase: 'saving', message: 'Saving collection...' });
    await fsPromises.writeFile(collectionPath, JSON.stringify(collection, null, 2), 'utf8');

    // Update sync settings with last sync time
    const syncSettings = store.get('resolver_sync_settings') || {};
    syncSettings[providerId] = {
      ...syncSettings[providerId],
      lastSyncAt: Date.now()
    };
    store.set('resolver_sync_settings', syncSettings);

    sendProgress({ phase: 'complete', message: 'Sync complete!' });

    return { success: true, results, collection };
  } catch (error) {
    console.error(`❌ Sync error for ${providerId}:`, error);
    sendProgress({ phase: 'error', message: error.message });
    return { success: false, error: error.message };
  } finally {
    activeSyncs.delete(providerId);
  }
});

ipcMain.handle('sync:cancel', async (event, providerId) => {
  const sync = activeSyncs.get(providerId);
  if (sync) {
    sync.cancelled = true;
    return { success: true };
  }
  return { success: false, error: 'No active sync' };
});

ipcMain.handle('sync:fetch-playlists', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { playlists, folders } = await provider.fetchPlaylists(token);
    return { success: true, playlists, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
```

**Step 2: Expose sync API in preload.js**

Add after the `syncSettings` namespace (around line 150):

```javascript
sync: {
  getProviders: () => ipcRenderer.invoke('sync:get-providers'),
  checkAuth: (providerId) => ipcRenderer.invoke('sync:check-auth', providerId),
  start: (providerId, options) => ipcRenderer.invoke('sync:start', providerId, options),
  cancel: (providerId) => ipcRenderer.invoke('sync:cancel', providerId),
  fetchPlaylists: (providerId) => ipcRenderer.invoke('sync:fetch-playlists', providerId),
  onProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('sync:progress', handler);
    return () => ipcRenderer.removeListener('sync:progress', handler);
  }
},
```

**Step 3: Commit**

```bash
git add main.js preload.js
git commit -m "feat(sync): add sync IPC handlers and preload API"
```

---

## Task 8: Add Spotify OAuth Scopes

**Files:**
- Modify: `main.js` (line 504-511, Spotify scopes)

**Step 1: Verify and add required scopes**

Check current scopes at line 504-511. Add any missing:

```javascript
const scopes = [
  'user-read-private',
  'user-read-email',
  'streaming',
  'user-read-playback-state',
  'user-modify-playback-state',
  'user-library-read',        // Already present - for liked songs/albums
  'user-follow-read',         // ADD - for followed artists
  'playlist-read-private',    // ADD - for private playlists
  'playlist-read-collaborative' // ADD - for collaborative playlists
].join(' ');
```

**Step 2: Commit**

```bash
git add main.js
git commit -m "feat(sync): add required Spotify OAuth scopes for library sync"
```

---

## Task 9: Create Sync Setup Modal Component

**Files:**
- Modify: `app.js` (add modal state and component)

**Step 1: Add modal state**

Add near line 2090 with other state:

```javascript
// Sync setup modal state
const [syncSetupModal, setSyncSetupModal] = useState({
  open: false,
  providerId: null,
  step: 'options', // 'options' | 'playlists' | 'syncing' | 'complete'
  playlists: [],
  folders: [],
  selectedPlaylists: [],
  settings: {
    syncTracks: true,
    syncAlbums: true,
    syncArtists: true,
    syncPlaylists: true
  },
  progress: null,
  results: null,
  error: null
});
```

**Step 2: Add sync progress listener**

Add in useEffect section (around line 7600):

```javascript
// Listen for sync progress
useEffect(() => {
  const unsubscribe = window.electron.sync.onProgress((progress) => {
    setSyncSetupModal(prev => ({
      ...prev,
      progress
    }));
  });
  return unsubscribe;
}, []);
```

**Step 3: Add modal open function**

```javascript
const openSyncSetupModal = async (providerId) => {
  // Check auth first
  const authStatus = await window.electron.sync.checkAuth(providerId);
  if (!authStatus.authenticated) {
    // Trigger auth flow
    if (providerId === 'spotify') {
      await window.electron.spotify.auth();
    }
    return;
  }

  // Load existing settings
  const existingSettings = await window.electron.syncSettings.getProvider(providerId);

  setSyncSetupModal({
    open: true,
    providerId,
    step: 'options',
    playlists: [],
    folders: [],
    selectedPlaylists: existingSettings?.selectedPlaylistIds || [],
    settings: {
      syncTracks: existingSettings?.syncTracks ?? true,
      syncAlbums: existingSettings?.syncAlbums ?? true,
      syncArtists: existingSettings?.syncArtists ?? true,
      syncPlaylists: existingSettings?.syncPlaylists ?? true
    },
    progress: null,
    results: null,
    error: null
  });
};
```

**Step 4: Add start sync function**

```javascript
const startSync = async () => {
  const { providerId, settings, selectedPlaylists } = syncSetupModal;

  // Save settings first
  await window.electron.syncSettings.setProvider(providerId, {
    enabled: true,
    ...settings,
    selectedPlaylistIds: selectedPlaylists
  });

  setSyncSetupModal(prev => ({ ...prev, step: 'syncing' }));

  const result = await window.electron.sync.start(providerId, {
    settings: {
      ...settings,
      selectedPlaylistIds: selectedPlaylists
    }
  });

  if (result.success) {
    // Reload collection data
    const newCollection = await window.electron.collection.load();
    setCollectionData(newCollection);

    setSyncSetupModal(prev => ({
      ...prev,
      step: 'complete',
      results: result.results
    }));
  } else {
    setSyncSetupModal(prev => ({
      ...prev,
      step: 'options',
      error: result.error
    }));
  }
};
```

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat(sync): add sync setup modal state and functions"
```

---

## Task 10: Render Sync Setup Modal UI

**Files:**
- Modify: `app.js` (add modal JSX near other modals, around line 28716)

**Step 1: Add modal JSX**

Add before the closing of the main app div, near other modals:

```javascript
{/* Sync Setup Modal */}
{syncSetupModal.open && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    {/* Backdrop */}
    <div
      className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      onClick={() => !syncSetupModal.progress && setSyncSetupModal(prev => ({ ...prev, open: false }))}
    />

    {/* Modal */}
    <div className="relative bg-zinc-900 rounded-2xl w-full max-w-lg mx-4 overflow-hidden shadow-2xl border border-zinc-700/50">
      {/* Header */}
      <div className="px-6 py-4 border-b border-zinc-700/50 flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-green-500 flex items-center justify-center">
          {/* Spotify icon or provider icon */}
          <svg className="w-6 h-6 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>
          </svg>
        </div>
        <div>
          <h2 className="text-lg font-semibold text-white">
            {syncSetupModal.step === 'complete' ? 'Sync Complete' : 'Sync Your Spotify Library'}
          </h2>
          <p className="text-sm text-zinc-400">
            {syncSetupModal.step === 'options' && 'Choose what to sync'}
            {syncSetupModal.step === 'playlists' && 'Select playlists to sync'}
            {syncSetupModal.step === 'syncing' && 'Syncing your library...'}
            {syncSetupModal.step === 'complete' && 'Your library has been synced'}
          </p>
        </div>
      </div>

      {/* Content */}
      <div className="px-6 py-4 max-h-96 overflow-y-auto">
        {syncSetupModal.error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500/50 rounded-lg text-red-400 text-sm">
            {syncSetupModal.error}
          </div>
        )}

        {syncSetupModal.step === 'options' && (
          <div className="space-y-3">
            {/* Sync options */}
            {[
              { key: 'syncTracks', label: 'Liked Songs', desc: 'Your saved tracks' },
              { key: 'syncAlbums', label: 'Saved Albums', desc: 'Albums in your library' },
              { key: 'syncArtists', label: 'Followed Artists', desc: 'Artists you follow' },
              { key: 'syncPlaylists', label: 'Playlists', desc: 'Select which playlists to sync' }
            ].map(option => (
              <label
                key={option.key}
                className="flex items-center gap-3 p-3 rounded-lg bg-zinc-800/50 hover:bg-zinc-800 cursor-pointer transition-colors"
              >
                <input
                  type="checkbox"
                  checked={syncSetupModal.settings[option.key]}
                  onChange={(e) => setSyncSetupModal(prev => ({
                    ...prev,
                    settings: { ...prev.settings, [option.key]: e.target.checked }
                  }))}
                  className="w-5 h-5 rounded bg-zinc-700 border-zinc-600 text-green-500 focus:ring-green-500 focus:ring-offset-zinc-900"
                />
                <div>
                  <div className="text-white font-medium">{option.label}</div>
                  <div className="text-sm text-zinc-400">{option.desc}</div>
                </div>
              </label>
            ))}
          </div>
        )}

        {syncSetupModal.step === 'playlists' && (
          <div className="space-y-2">
            {syncSetupModal.playlists.length === 0 ? (
              <div className="text-center py-8 text-zinc-400">Loading playlists...</div>
            ) : (
              syncSetupModal.playlists.map(playlist => (
                <label
                  key={playlist.externalId}
                  className="flex items-center gap-3 p-2 rounded-lg hover:bg-zinc-800/50 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={syncSetupModal.selectedPlaylists.includes(playlist.externalId)}
                    onChange={(e) => {
                      setSyncSetupModal(prev => ({
                        ...prev,
                        selectedPlaylists: e.target.checked
                          ? [...prev.selectedPlaylists, playlist.externalId]
                          : prev.selectedPlaylists.filter(id => id !== playlist.externalId)
                      }));
                    }}
                    className="w-4 h-4 rounded bg-zinc-700 border-zinc-600 text-green-500"
                  />
                  {playlist.image && (
                    <img src={playlist.image} className="w-10 h-10 rounded" alt="" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="text-white truncate">{playlist.name}</div>
                    <div className="text-sm text-zinc-400">{playlist.trackCount} tracks</div>
                  </div>
                </label>
              ))
            )}
          </div>
        )}

        {syncSetupModal.step === 'syncing' && syncSetupModal.progress && (
          <div className="py-8">
            <div className="text-center mb-4">
              <div className="text-white font-medium">{syncSetupModal.progress.message}</div>
              {syncSetupModal.progress.total > 0 && (
                <div className="text-sm text-zinc-400 mt-1">
                  {syncSetupModal.progress.current} of {syncSetupModal.progress.total}
                </div>
              )}
            </div>
            {syncSetupModal.progress.total > 0 && (
              <div className="h-2 bg-zinc-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-green-500 transition-all duration-300"
                  style={{ width: `${(syncSetupModal.progress.current / syncSetupModal.progress.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}

        {syncSetupModal.step === 'complete' && syncSetupModal.results && (
          <div className="py-4 space-y-3">
            {syncSetupModal.results.tracks && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Tracks</span>
                <span className="text-white">
                  +{syncSetupModal.results.tracks.added} added,
                  -{syncSetupModal.results.tracks.removed} removed
                </span>
              </div>
            )}
            {syncSetupModal.results.albums && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Albums</span>
                <span className="text-white">
                  +{syncSetupModal.results.albums.added} added,
                  -{syncSetupModal.results.albums.removed} removed
                </span>
              </div>
            )}
            {syncSetupModal.results.artists && (
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Artists</span>
                <span className="text-white">
                  +{syncSetupModal.results.artists.added} added,
                  -{syncSetupModal.results.artists.removed} removed
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-zinc-700/50 flex justify-end gap-3">
        {syncSetupModal.step === 'options' && (
          <>
            <button
              onClick={() => setSyncSetupModal(prev => ({ ...prev, open: false }))}
              className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={async () => {
                if (syncSetupModal.settings.syncPlaylists) {
                  // Load playlists first
                  setSyncSetupModal(prev => ({ ...prev, step: 'playlists' }));
                  const result = await window.electron.sync.fetchPlaylists(syncSetupModal.providerId);
                  if (result.success) {
                    setSyncSetupModal(prev => ({
                      ...prev,
                      playlists: result.playlists,
                      folders: result.folders
                    }));
                  }
                } else {
                  startSync();
                }
              }}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
            >
              {syncSetupModal.settings.syncPlaylists ? 'Next' : 'Start Sync'}
            </button>
          </>
        )}

        {syncSetupModal.step === 'playlists' && (
          <>
            <button
              onClick={() => setSyncSetupModal(prev => ({ ...prev, step: 'options' }))}
              className="px-4 py-2 text-zinc-400 hover:text-white transition-colors"
            >
              Back
            </button>
            <button
              onClick={startSync}
              className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
            >
              Start Sync
            </button>
          </>
        )}

        {syncSetupModal.step === 'complete' && (
          <button
            onClick={() => setSyncSetupModal(prev => ({ ...prev, open: false }))}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
          >
            Done
          </button>
        )}
      </div>
    </div>
  </div>
)}
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(sync): render sync setup modal UI"
```

---

## Task 11: Add Sync Button to Collection Header

**Files:**
- Modify: `app.js` (lines 20664-20743, Collection header)

**Step 1: Add sync button to expanded header**

Find the Collection header section (around line 20692-20743) and add sync button:

```javascript
{/* Add after the "Start Collection Station" button */}
<button
  onClick={() => openSyncSetupModal('spotify')}
  className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 hover:bg-white/20 text-white text-sm font-medium transition-colors"
>
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
  Sync Library
</button>
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(sync): add sync button to Collection header"
```

---

## Task 12: Add Library Sync Section to Resolver Settings

**Files:**
- Modify: `app.js` (lines 24558-24700, Settings page)

**Step 1: Find Spotify resolver card in settings**

The resolver settings are rendered around line 24592. After the resolver card for Spotify, add a "Library Sync" section when that resolver is selected/expanded.

**Step 2: Add sync settings section**

Add a conditional section that appears for resolvers with sync capability:

```javascript
{/* Library Sync Section - shown for Spotify */}
{resolver.id === 'spotify' && (
  <div className="mt-4 p-4 bg-zinc-800/50 rounded-lg">
    <h4 className="text-sm font-medium text-white mb-3">Library Sync</h4>

    {resolverSyncSettings.spotify?.enabled ? (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Status</span>
          <span className="text-green-400 flex items-center gap-1">
            <span className="w-2 h-2 bg-green-400 rounded-full" />
            Active
          </span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="text-zinc-400">Last synced</span>
          <span className="text-white">
            {resolverSyncSettings.spotify?.lastSyncAt
              ? new Date(resolverSyncSettings.spotify.lastSyncAt).toLocaleString()
              : 'Never'}
          </span>
        </div>
        <div className="flex gap-2 mt-3">
          <button
            onClick={() => openSyncSetupModal('spotify')}
            className="px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded transition-colors"
          >
            Sync Now
          </button>
          <button
            onClick={() => {/* TODO: Stop syncing flow */}}
            className="px-3 py-1.5 text-zinc-400 hover:text-white text-sm transition-colors"
          >
            Stop Syncing
          </button>
        </div>
      </div>
    ) : (
      <button
        onClick={() => openSyncSetupModal('spotify')}
        className="w-full px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg font-medium transition-colors"
      >
        Set Up Library Sync
      </button>
    )}
  </div>
)}
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(sync): add library sync section to resolver settings"
```

---

## Task 13: Add Background Sync Timer

**Files:**
- Modify: `app.js` (add useEffect for background sync)

**Step 1: Add background sync effect**

Add in the useEffect section (around line 7600):

```javascript
// Background sync timer (every 15 minutes)
useEffect(() => {
  const SYNC_INTERVAL = 15 * 60 * 1000; // 15 minutes

  const runBackgroundSync = async () => {
    // Check each enabled provider
    for (const [providerId, settings] of Object.entries(resolverSyncSettings)) {
      if (settings.enabled) {
        const authStatus = await window.electron.sync.checkAuth(providerId);
        if (authStatus.authenticated) {
          console.log(`[Sync] Starting background sync for ${providerId}`);
          const result = await window.electron.sync.start(providerId, { settings });
          if (result.success) {
            // Reload collection
            const newCollection = await window.electron.collection.load();
            setCollectionData(newCollection);
          }
        }
      }
    }
  };

  // Run on app start (after initial load)
  const initialSyncTimeout = setTimeout(runBackgroundSync, 5000);

  // Set up interval
  const intervalId = setInterval(runBackgroundSync, SYNC_INTERVAL);

  return () => {
    clearTimeout(initialSyncTimeout);
    clearInterval(intervalId);
  };
}, [resolverSyncSettings]);
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(sync): add background sync timer (15 min interval)"
```

---

## Task 14: Add Sync Status Modal (Quick View from Collection)

**Files:**
- Modify: `app.js` (add status modal)

**Step 1: Add status modal state**

```javascript
const [syncStatusModal, setSyncStatusModal] = useState({ open: false });
```

**Step 2: Add status modal component**

```javascript
{/* Sync Status Modal */}
{syncStatusModal.open && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div
      className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      onClick={() => setSyncStatusModal({ open: false })}
    />
    <div className="relative bg-zinc-900 rounded-2xl w-full max-w-md mx-4 overflow-hidden shadow-2xl border border-zinc-700/50">
      <div className="px-6 py-4 border-b border-zinc-700/50">
        <h2 className="text-lg font-semibold text-white">Library Sync</h2>
      </div>

      <div className="px-6 py-4 space-y-4">
        {Object.entries(resolverSyncSettings)
          .filter(([_, settings]) => settings.enabled)
          .map(([providerId, settings]) => (
            <div key={providerId} className="flex items-center gap-3">
              <div className="w-2 h-2 bg-green-400 rounded-full" />
              <div className="flex-1">
                <div className="text-white font-medium capitalize">{providerId}</div>
                <div className="text-sm text-zinc-400">
                  Last sync: {settings.lastSyncAt
                    ? new Date(settings.lastSyncAt).toLocaleString()
                    : 'Never'}
                </div>
              </div>
            </div>
          ))}

        {Object.keys(resolverSyncSettings).filter(id => resolverSyncSettings[id]?.enabled).length === 0 && (
          <div className="text-center py-4 text-zinc-400">
            No sync providers enabled
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-zinc-700/50 flex justify-between">
        <button
          onClick={() => {
            setSyncStatusModal({ open: false });
            // Navigate to settings
          }}
          className="text-zinc-400 hover:text-white text-sm transition-colors"
        >
          Manage settings
        </button>
        <button
          onClick={async () => {
            for (const [providerId, settings] of Object.entries(resolverSyncSettings)) {
              if (settings.enabled) {
                await window.electron.sync.start(providerId, { settings });
              }
            }
            const newCollection = await window.electron.collection.load();
            setCollectionData(newCollection);
          }}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white rounded-lg text-sm font-medium transition-colors"
        >
          Sync Now
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(sync): add sync status modal for quick view"
```

---

## Task 15: Implement Stop Syncing Flow

**Files:**
- Modify: `app.js` (add stop sync dialog and logic)

**Step 1: Add stop sync confirmation state**

```javascript
const [stopSyncDialog, setStopSyncDialog] = useState({
  open: false,
  providerId: null
});
```

**Step 2: Add stop sync function**

```javascript
const stopSyncing = async (providerId, removeItems = false) => {
  if (removeItems) {
    // Remove items that only have this provider as source
    setCollectionData(prev => {
      const filterItems = (items) => items
        .map(item => {
          if (!item.syncSources?.[providerId]) return item;
          const newSyncSources = { ...item.syncSources };
          delete newSyncSources[providerId];
          if (Object.keys(newSyncSources).length === 0) return null;
          return { ...item, syncSources: newSyncSources };
        })
        .filter(Boolean);

      return {
        tracks: filterItems(prev.tracks || []),
        albums: filterItems(prev.albums || []),
        artists: filterItems(prev.artists || [])
      };
    });
  } else {
    // Just remove sync sources but keep items
    setCollectionData(prev => {
      const removeSource = (items) => items.map(item => {
        if (!item.syncSources?.[providerId]) return item;
        const newSyncSources = { ...item.syncSources };
        delete newSyncSources[providerId];
        return { ...item, syncSources: Object.keys(newSyncSources).length > 0 ? newSyncSources : undefined };
      });

      return {
        tracks: removeSource(prev.tracks || []),
        albums: removeSource(prev.albums || []),
        artists: removeSource(prev.artists || [])
      };
    });
  }

  // Disable sync in settings
  await window.electron.syncSettings.setProvider(providerId, {
    ...resolverSyncSettings[providerId],
    enabled: false
  });

  setResolverSyncSettings(prev => ({
    ...prev,
    [providerId]: { ...prev[providerId], enabled: false }
  }));

  setStopSyncDialog({ open: false, providerId: null });
};
```

**Step 3: Add stop sync dialog UI**

```javascript
{/* Stop Sync Confirmation Dialog */}
{stopSyncDialog.open && (
  <div className="fixed inset-0 z-50 flex items-center justify-center">
    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
    <div className="relative bg-zinc-900 rounded-2xl w-full max-w-sm mx-4 overflow-hidden shadow-2xl border border-zinc-700/50">
      <div className="px-6 py-4">
        <h2 className="text-lg font-semibold text-white mb-2">Stop Syncing?</h2>
        <p className="text-zinc-400 text-sm mb-4">
          What would you like to do with your synced items?
        </p>

        <div className="space-y-2">
          <button
            onClick={() => stopSyncing(stopSyncDialog.providerId, false)}
            className="w-full p-3 text-left bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <div className="text-white font-medium">Keep imported items</div>
            <div className="text-sm text-zinc-400">Items stay in your Collection as local items</div>
          </button>
          <button
            onClick={() => stopSyncing(stopSyncDialog.providerId, true)}
            className="w-full p-3 text-left bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
          >
            <div className="text-white font-medium">Remove synced items</div>
            <div className="text-sm text-zinc-400">Remove everything synced from this provider</div>
          </button>
        </div>
      </div>

      <div className="px-6 py-3 border-t border-zinc-700/50">
        <button
          onClick={() => setStopSyncDialog({ open: false, providerId: null })}
          className="w-full py-2 text-zinc-400 hover:text-white text-sm transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
)}
```

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat(sync): implement stop syncing flow with keep/remove option"
```

---

## Task 16: Add Playlist Sync and Update Detection

**Files:**
- Modify: `main.js` (add playlist sync to sync:start handler)
- Modify: `app.js` (add playlist update banner)

**Step 1: Extend sync:start to handle playlists**

Add to the sync:start handler in main.js, after artist sync:

```javascript
// Sync playlists
if (settings.syncPlaylists && settings.selectedPlaylistIds?.length > 0 && provider.capabilities.playlists) {
  sendProgress({ phase: 'fetching', type: 'playlists', message: 'Syncing playlists...' });

  // Load current playlists
  const currentPlaylists = store.get('local_playlists') || [];

  // Fetch playlist metadata to check for updates
  const { playlists: remotePlaylists } = await provider.fetchPlaylists(token);
  const selectedRemote = remotePlaylists.filter(p => settings.selectedPlaylistIds.includes(p.externalId));

  for (const remotePlaylist of selectedRemote) {
    const localPlaylist = currentPlaylists.find(p => p.syncedFrom?.externalId === remotePlaylist.externalId);

    if (!localPlaylist) {
      // New playlist - fetch tracks and add
      sendProgress({ phase: 'fetching', type: 'playlists', message: `Importing "${remotePlaylist.name}"...` });
      const tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token);

      const newPlaylist = {
        id: remotePlaylist.id,
        title: remotePlaylist.name,
        description: remotePlaylist.description,
        tracks: tracks,
        syncedFrom: {
          resolver: providerId,
          externalId: remotePlaylist.externalId,
          snapshotId: remotePlaylist.snapshotId
        },
        hasUpdates: false,
        locallyModified: false,
        syncSources: {
          [providerId]: { addedAt: Date.now(), syncedAt: Date.now() }
        },
        createdAt: Date.now(),
        addedAt: Date.now()
      };

      currentPlaylists.push(newPlaylist);
    } else if (localPlaylist.syncedFrom?.snapshotId !== remotePlaylist.snapshotId) {
      // Playlist has updates
      const idx = currentPlaylists.findIndex(p => p.id === localPlaylist.id);
      if (idx >= 0) {
        currentPlaylists[idx] = {
          ...currentPlaylists[idx],
          hasUpdates: true,
          syncSources: {
            ...currentPlaylists[idx].syncSources,
            [providerId]: { ...currentPlaylists[idx].syncSources?.[providerId], syncedAt: Date.now() }
          }
        };
      }
    }
  }

  // Save playlists
  store.set('local_playlists', currentPlaylists);
  results.playlists = { synced: selectedRemote.length };
}
```

**Step 2: Add playlist update banner in app.js**

When viewing a playlist with `hasUpdates: true`, show:

```javascript
{selectedPlaylist?.hasUpdates && (
  <div className="mx-4 mb-4 p-3 bg-blue-500/20 border border-blue-500/50 rounded-lg flex items-center justify-between">
    <span className="text-blue-400 text-sm">
      This playlist has been updated on {selectedPlaylist.syncedFrom?.resolver || 'the source'}.
    </span>
    <div className="flex gap-2">
      <button
        onClick={async () => {
          // Fetch updated tracks
          const provider = selectedPlaylist.syncedFrom?.resolver;
          if (provider) {
            const tracks = await window.electron.sync.fetchPlaylistTracks?.(
              provider,
              selectedPlaylist.syncedFrom.externalId
            );
            // Update playlist with new tracks and new snapshotId
            // ... implementation
          }
        }}
        className="px-3 py-1 bg-blue-500 text-white text-sm rounded hover:bg-blue-600 transition-colors"
      >
        Update
      </button>
      <button
        onClick={() => {
          setPlaylists(prev => prev.map(p =>
            p.id === selectedPlaylist.id ? { ...p, hasUpdates: false } : p
          ));
        }}
        className="px-3 py-1 text-blue-400 text-sm hover:text-blue-300 transition-colors"
      >
        Dismiss
      </button>
    </div>
  </div>
)}
```

**Step 3: Commit**

```bash
git add main.js app.js
git commit -m "feat(sync): add playlist sync and update detection"
```

---

## Task 17: Test Full Sync Flow

**Files:** None (testing only)

**Step 1: Start the app**

```bash
npm start
```

**Step 2: Test Spotify auth**

1. Go to Settings → Spotify
2. Connect account if not connected
3. Verify OAuth flow works

**Step 3: Test sync setup**

1. Click "Sync Library" in Collection header
2. Verify modal opens
3. Select options
4. Start sync
5. Verify progress shows
6. Verify completion shows stats

**Step 4: Verify collection data**

1. Check Collection tracks tab
2. Verify synced items have `syncSources.spotify`
3. Check `collection.json` file

**Step 5: Test background sync**

1. Wait 15 minutes or modify timer for testing
2. Verify sync runs automatically

**Step 6: Test stop syncing**

1. Go to Settings → Spotify → Library Sync
2. Click Stop Syncing
3. Test both "Keep items" and "Remove items" options

**Step 7: Commit test results/fixes**

```bash
git add -A
git commit -m "test(sync): verify full sync flow works"
```

---

## Summary

This plan implements the Resolver Library Sync feature in 17 tasks:

| Task | Description | Files Modified |
|------|-------------|----------------|
| 1 | Add syncSources to Collection data model | app.js |
| 2 | Add locallyModified to Playlist model | app.js |
| 3 | Create sync settings store | app.js, main.js, preload.js |
| 4 | Create SyncProvider interface types | sync-providers/types.js |
| 5 | Implement Spotify sync provider | sync-providers/spotify.js |
| 6 | Create sync engine core | sync-engine/index.js |
| 7 | Add sync IPC handlers | main.js, preload.js |
| 8 | Add Spotify OAuth scopes | main.js |
| 9 | Create sync setup modal state | app.js |
| 10 | Render sync setup modal UI | app.js |
| 11 | Add sync button to Collection header | app.js |
| 12 | Add sync section to resolver settings | app.js |
| 13 | Add background sync timer | app.js |
| 14 | Add sync status modal | app.js |
| 15 | Implement stop syncing flow | app.js |
| 16 | Add playlist sync and update detection | main.js, app.js |
| 17 | Test full sync flow | - |

Each task is atomic with a commit checkpoint. The implementation follows existing patterns in the codebase.
