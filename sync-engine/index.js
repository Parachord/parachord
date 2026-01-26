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
