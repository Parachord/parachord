/**
 * Sync Engine
 * Orchestrates library sync across all providers.
 * Handles scheduling, diffing, and state management.
 */

const SpotifySyncProvider = require('../sync-providers/spotify');
const AppleMusicSyncProvider = require('../sync-providers/applemusic');
const ListenBrainzSyncProvider = require('../sync-providers/listenbrainz');

// Registry of available sync providers
const providers = {
  spotify: SpotifySyncProvider,
  applemusic: AppleMusicSyncProvider,
  listenbrainz: ListenBrainzSyncProvider
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
      // Merge remote sources (e.g., sources.spotify from sync) with local sources
      toUpdate.push({
        ...localItem,
        sources: { ...localItem.sources, ...remoteItem.sources },
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
      // Merge remote sources into local to ensure pre-populated resolution data
      // (e.g., sources.spotify) is present even for previously synced tracks
      unchanged.push({
        ...localItem,
        sources: { ...localItem.sources, ...remoteItem.sources },
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

  console.log(`[SyncEngine] applyDiff input: ${collectionItems.length} items`);
  console.log(`[SyncEngine] diff: +${toAdd.length} add, -${toRemove.length} remove, ~${toUpdate.length} update, =${unchanged.length} unchanged`);

  // Create map of items to remove
  const removeIds = new Set(toRemove.map(item => item.id));

  // Create map of items to update
  const updateMap = new Map(toUpdate.map(item => [item.id, item]));

  // Create map of unchanged items
  const unchangedMap = new Map(unchanged.map(item => [item.id, item]));

  // Track items not in any diff category (manual items that should pass through)
  const diffItemIds = new Set([
    ...toAdd.map(i => i.id),
    ...toRemove.map(i => i.id),
    ...toUpdate.map(i => i.id),
    ...unchanged.map(i => i.id)
  ]);
  const preservedItems = collectionItems.filter(item => !diffItemIds.has(item.id));
  console.log(`[SyncEngine] Items not in diff (should be preserved): ${preservedItems.length}`);
  if (preservedItems.length > 0) {
    console.log(`[SyncEngine] Preserved item IDs:`, preservedItems.slice(0, 5).map(i => i.id));
  }

  // Filter out removed items and apply updates
  const result = collectionItems
    .filter(item => !removeIds.has(item.id))
    .map(item => updateMap.get(item.id) || unchangedMap.get(item.id) || item);

  // Add new items
  const finalResult = [...result, ...toAdd];
  console.log(`[SyncEngine] applyDiff output: ${finalResult.length} items`);

  return finalResult;
};

/**
 * Sync a specific data type (tracks, albums, artists) for a provider.
 *
 * `isCancelled` (optional) is a 0-arg predicate the provider's pagination
 * loop can poll between pages so a `sync:cancel` IPC takes effect within
 * one page of latency (~1s) instead of waiting for the entire library
 * fetch to complete (~90s for a 2,600-track Spotify library). When
 * cancellation fires mid-paginate, the provider returns `null` to signal
 * "no usable result — treat as unchanged"; the next phase-boundary
 * `isCancelled()` check in `sync:start` then routes to `finalizeCancelled`
 * and the run exits without applying a partial diff. See parachord#820.
 */
const syncDataType = async (provider, token, dataType, localData, onProgress, refreshToken, isCancelled) => {
  // Count how many local items came from this provider (for incremental check)
  const syncedItems = localData.filter(item => item.syncSources?.[provider.id]);
  const localSyncedCount = syncedItems.length;
  // Find the most recently added synced item (by addedAt) to detect swapped content
  const mostRecentItem = syncedItems.reduce((latest, item) => {
    const itemDate = item.addedAt || item.syncSources?.[provider.id]?.addedAt || 0;
    const latestDate = latest ? (latest.addedAt || latest.syncSources?.[provider.id]?.addedAt || 0) : 0;
    return itemDate > latestDate ? item : latest;
  }, null);
  const fetchOptions = {
    localSyncedCount,
    localLatestExternalId: mostRecentItem?.externalId || null,
    isCancelled
  };

  // Fetch remote data
  let remoteData;
  switch (dataType) {
    case 'tracks':
      remoteData = await provider.fetchTracks(token, onProgress, refreshToken, fetchOptions);
      break;
    case 'albums':
      remoteData = await provider.fetchAlbums(token, onProgress, refreshToken, fetchOptions);
      break;
    case 'artists':
      remoteData = await provider.fetchArtists(token, onProgress, refreshToken, fetchOptions);
      break;
    default:
      throw new Error(`Unknown data type: ${dataType}`);
  }

  // Provider returned null → count check passed, nothing changed
  if (remoteData === null) {
    return {
      data: localData,
      stats: { added: 0, removed: 0, updated: 0, unchanged: localSyncedCount }
    };
  }

  // Calculate diff
  const diff = calculateDiff(remoteData, localData, provider.id);

  // Safety check: if we'd remove a large fraction of the synced items,
  // the remote provider likely returned incomplete results (API pagination
  // failure, rate limit, network issue). Skip removals to prevent data loss.
  const syncedLocalCount = localData.filter(item => item.syncSources?.[provider.id]).length;
  if (diff.toRemove.length > 0 && syncedLocalCount > 0) {
    const removalRatio = diff.toRemove.length / syncedLocalCount;
    if (removalRatio > 0.25 && diff.toRemove.length > 50) {
      console.warn(`[SyncEngine] ⚠️ Mass removal safeguard triggered for ${dataType}: would remove ${diff.toRemove.length}/${syncedLocalCount} synced items (${Math.round(removalRatio * 100)}%). Skipping removals — remote may have returned incomplete results.`);
      // Convert removals to unchanged — keep the tracks but don't delete them
      diff.unchanged.push(...diff.toRemove.map(item => ({
        ...item,
        syncSources: {
          ...item.syncSources,
          [provider.id]: {
            ...item.syncSources?.[provider.id],
            syncedAt: Date.now()
          }
        }
      })));
      diff.toRemove = [];
    }
  }

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

/**
 * Decide whether the inbound playlist update branch in sync:start can be
 * short-circuited for a given (localPlaylist, remotePlaylist, providerId).
 *
 * A short-circuit means: the playlist hasn't changed on either side, no
 * metadata backfills are needed, and ownership/collaborator state is stable.
 * The caller can skip the heavy fresh-read + spread-rewrite + isOwnPullSource
 * recomputation work, and only bump `syncSources[providerId].syncedAt`.
 *
 * This is the tier-1 perf win from parachord#796 (epic #803). Real CPU
 * savings are modest because the dominant per-iteration cost is the
 * `store.get('local_playlists')` fresh-read for concurrent-write protection,
 * which still has to happen for changed playlists. The win here is avoiding
 * the spread allocation + downstream rewrite for the typical case where most
 * selected playlists haven't drifted since the last sync, plus more accurate
 * `syncedAt` accounting for the staleness sort in #800.
 *
 * Returns true ONLY if ALL of the following hold:
 *   - snapshotIds match (no track-level updates available)
 *   - local has tracks (not the empty-playlist refill path)
 *   - this provider IS the canonical pull source (resolver matches)
 *   - local snapshotId is present (not heal-induced null requiring adoption)
 *   - remote ownerId matches local syncedFrom.ownerId
 *   - remote isCollaborator matches local syncedFrom.isCollaborator
 *   - local.creator is either set OR remote has nothing to backfill from
 *   - local.source is set (no backfill needed)
 *
 * If any condition fails, the caller MUST fall through to the full update
 * branch to avoid losing legitimate state updates.
 *
 * Pure / deterministic / no I/O. Safe to call N times per sync without cost.
 *
 * @param {Object} args
 * @param {Object} args.localPlaylist - The local playlist record (pre-fresh-read).
 * @param {Object} args.remotePlaylist - The provider's reported playlist shape.
 * @param {string} args.providerId - The provider running this sync iteration.
 * @returns {boolean}
 */
const canShortCircuitPlaylistUpdate = ({ localPlaylist, remotePlaylist, providerId }) => {
  if (!localPlaylist || !remotePlaylist || !providerId) return false;

  // Snapshots must match. This is the primary signal of "nothing changed."
  // Mismatch handles both real updates and AM count-churn / heal-null adoption.
  if (localPlaylist.syncedFrom?.snapshotId !== remotePlaylist.snapshotId) return false;

  // Empty-tracks case routes to the refill path; cannot short-circuit.
  const tracks = localPlaylist.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) return false;

  // Must be the canonical pull source. Cross-provider mirrors (matched via
  // syncedTo[providerId]) and locally-created push mirrors (no syncedFrom)
  // still need the full branch to compute isOwnPullSource correctly.
  if (localPlaylist.syncedFrom?.resolver !== providerId) return false;

  // Heal-induced null snapshot needs silent-adopt path. The equality check
  // above would actually have passed if remote also had null/undefined, so
  // be explicit here to keep the contract obvious and prevent false short-
  // circuits if a provider ever starts returning null snapshotIds.
  if (!localPlaylist.syncedFrom?.snapshotId) return false;

  // Ownership / collaborator state changes need to flow into syncedFrom.
  // Normalize via `!!` so legacy records (undefined isCollaborator) compare
  // as false rather than triggering a spurious "state changed" branch.
  if (localPlaylist.syncedFrom?.ownerId !== remotePlaylist.ownerId) return false;
  const localCollab = !!localPlaylist.syncedFrom?.isCollaborator;
  const remoteCollab = !!remotePlaylist.isCollaborator;
  if (localCollab !== remoteCollab) return false;

  // Metadata backfills. If `creator` is missing locally AND remote has an
  // ownerName to populate it with, we'd backfill in the full branch —
  // can't short-circuit. Same for `source`.
  if (!localPlaylist.creator && remotePlaylist.ownerName) return false;
  if (!localPlaylist.source) return false;

  return true;
};

// Default batch size for staggered playlist sync. With ~50 selected playlists
// and the 15-min background cadence, 15 per cycle covers everything in roughly
// 2.5 hours worst-case. Tune via the explicit `batchSize` argument if needed.
const DEFAULT_STAGGER_BATCH_SIZE = 15;

/**
 * Stagger selected remote playlists across multiple sync cycles
 * (parachord#800, part of epic #803). Returns the top N playlists for
 * this cycle, sorted "oldest stale first" with lastModified breaking
 * ties.
 *
 * Why: today every sync cycle processes ALL selected remote playlists
 * for the provider. With 50+ playlists × 3 providers, that's 150+
 * remote-list comparisons + per-playlist update logic per cycle, every
 * 15 minutes. Most of that work finds nothing changed (see
 * `canShortCircuitPlaylistUpdate` for the cheap-iter win). Staggering
 * cuts the *volume* of work per cycle: only the oldest-stale N get
 * processed; the rest defer to the next cycle. Over 4-5 cycles the
 * whole selection is covered.
 *
 * Sort order:
 *   1. `syncSources[providerId].syncedAt` ascending — oldest-stale first.
 *      Playlists with no local entry (never imported) treat as 0,
 *      which floats them to the top (so first-time imports happen on
 *      the first cycle after wizard selection).
 *   2. `lastModified` descending — breaks ties; recent local edits get
 *      sync priority over dormant playlists.
 *
 * **`hasUpdates: true` is NOT a sort priority.** Earlier the sort
 * put hasUpdates-true playlists first, on the reasoning that the user
 * is "waiting on a pending pull." But hasUpdates is a state flag, not
 * an action signal — once it's set, the banner is already visible in
 * the UI and re-running sync on the playlist doesn't change anything
 * (the inbound diff just re-confirms what we already know;
 * `stillHasUpdates` keeps the local snapshotId pinned to the
 * pre-detection value until the user actually pulls).
 *
 * The starvation pathology: when N playlists accumulate hasUpdates=true
 * (because the user hasn't acted on them yet — easy with daily/weekly
 * algorithmic playlists), they monopolize every staggered batch and
 * the syncedAt-asc tail never makes progress. Discovery of NEW
 * pending updates (Daily Brew flipping from "yesterday's content"
 * to "today's content") never happens because Daily Brew sits at
 * position N+1 forever. See parachord#835.
 *
 * Caller is expected to bypass staggering entirely for explicit
 * full-sync paths (wizard "Sync Now", cleanup-duplicates, etc.) by
 * NOT calling this helper for those flows.
 *
 * Pure / deterministic / no I/O. Does NOT mutate inputs — returns a
 * new sorted-and-sliced array.
 *
 * @param {Object} args
 * @param {Array} args.selectedRemote - Remote playlists already filtered to
 *   the user's selected set. Each entry has at minimum `externalId`.
 * @param {Array} args.localPlaylists - The full `local_playlists` array
 *   loaded from store at the top of `sync:start`. Used to look up
 *   `syncSources[providerId].syncedAt` and `lastModified` for the
 *   staleness sort.
 * @param {string} args.providerId - Provider running this sync iteration.
 *   Used both as the syncSources sub-key and for matching local
 *   playlists via `syncedFrom.externalId` / `syncedTo[providerId].externalId`.
 * @param {number} [args.batchSize=DEFAULT_STAGGER_BATCH_SIZE] - Max
 *   playlists to process this cycle.
 * @returns {Array} Sorted and sliced subset of `selectedRemote`.
 */
const staggerPlaylistsForCycle = ({
  selectedRemote,
  localPlaylists,
  providerId,
  batchSize = DEFAULT_STAGGER_BATCH_SIZE
}) => {
  if (!Array.isArray(selectedRemote) || selectedRemote.length === 0) return [];

  // Build externalId → local-playlist map so we don't O(N²) for each
  // remote in the comparator. A single remote can match either via
  // syncedFrom (we pulled FROM this provider for this playlist) or
  // via syncedTo (we pushed TO this provider — i.e. push mirror).
  const localByExternalId = new Map();
  if (Array.isArray(localPlaylists)) {
    for (const p of localPlaylists) {
      if (!p) continue;
      if (p.syncedFrom?.externalId) {
        localByExternalId.set(p.syncedFrom.externalId, p);
      }
      const pushedId = p.syncedTo?.[providerId]?.externalId;
      if (pushedId) {
        localByExternalId.set(pushedId, p);
      }
    }
  }

  const sorted = [...selectedRemote].sort((a, b) => {
    const localA = localByExternalId.get(a.externalId);
    const localB = localByExternalId.get(b.externalId);
    // 1. Oldest syncedAt first (missing → 0 → absolute top)
    const tsA = localA?.syncSources?.[providerId]?.syncedAt || 0;
    const tsB = localB?.syncSources?.[providerId]?.syncedAt || 0;
    if (tsA !== tsB) return tsA - tsB;
    // 2. lastModified desc breaks ties (recent local edits → priority)
    const lmA = localA?.lastModified || 0;
    const lmB = localB?.lastModified || 0;
    return lmB - lmA;
  });

  return sorted.slice(0, batchSize);
};

/**
 * Compare two ordered lists of stable identifiers (e.g. LB recording MBIDs,
 * Spotify URIs) for length+order+value equality. Returns false if either
 * list has any null/empty entry — null IDs are ambiguous and must NOT be
 * treated as matching even if they appear in the same slot of both lists
 * (otherwise we'd skip a push for "two tracks that mapper couldn't resolve"
 * which silently keeps the wrong content on the remote).
 *
 * Used by per-provider `updatePlaylistTracks` short-circuits to avoid the
 * delete+add (or PUT-replace) round-trip when the intended push would be
 * a no-op. Mirror of the inbound `canShortCircuitPlaylistUpdate` check
 * shipped in parachord#796 for the opposite direction.
 */
const areOrderedIdListsEquivalent = (localIds, remoteIds) => {
  if (!Array.isArray(localIds) || !Array.isArray(remoteIds)) return false;
  if (localIds.length !== remoteIds.length) return false;
  for (let i = 0; i < localIds.length; i++) {
    const lid = localIds[i];
    if (lid === null || lid === undefined || lid === '') return false;
    if (lid !== remoteIds[i]) return false;
  }
  return true;
};

module.exports = {
  getProvider,
  getAllProviders,
  calculateDiff,
  applyDiff,
  syncDataType,
  calculatePlaylistDiff,
  canShortCircuitPlaylistUpdate,
  staggerPlaylistsForCycle,
  areOrderedIdListsEquivalent,
  DEFAULT_STAGGER_BATCH_SIZE
};
