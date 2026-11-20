// main-process/ipc/sync-start.js — the inbound sync engine: the active-syncs
// map and the sync:get-providers / sync:check-auth / sync:start / sync:cancel
// IPC surface. Extracted from main.js (maintainability plan Track 3, sync
// slice 3).
//
// sync:start is the big one — library/collection import + selected-playlist
// inbound sync with per-phase cancellation (parachord#799), staggered playlist
// cycles (parachord#800), snapshot adoption rules, and the >70% completeness
// guard before clearing syncedFrom. The invariants are documented in docs/architecture/sync.md
// ("Background Sync Cadence", "Staggered playlist sync per cycle",
// "Invariants & Traps") — read them before editing.
//
// Not a verbatim move in one spot only: the MusicKit generated-token wait
// (await musicKitTokenReady before reading generatedMusicKitToken) appears in
// both sync:check-auth and sync:start; it is now the injected
// getGeneratedMusicKitToken() (the token cluster stays in main.js). Everything
// else moved verbatim.
//
// Tombstones is imported directly (pure sync-engine module); writeCollectionAtomic
// is injected (shared with other main.js callers). Tests drive the handlers
// with fakes (tests/main-process/sync-start-ipc.test.js).

const path = require('path');
const Tombstones = require('../../sync-engine/tombstones');
const { flagDeadMirrors } = require('../../sync-engine/dead-mirrors');
const { detachMissingSources } = require('../../sync-engine/missing-sources');
const { keepDroppedLinks } = require('../../sync-engine/playlist-save-guard');
const { remoteUpdateAction, hasRealLocalEdits, applyPulledTracks, keepEditsMadeDuringPull, tracksFingerprint, seedTracksFingerprint } = require('../../sync-engine/auto-pull');
const { stableCreatedAt } = require('../../sync-engine/created-at');
const { planPlaylistCycle } = require('../../sync-engine/playlist-cycle');

function registerSyncStartIpc({
  ipcMain,
  SyncEngine,
  store,
  app,
  ensureValidSpotifyToken,
  getGeneratedMusicKitToken,
  writeCollectionAtomic,
  getSyncLinks,
  legacyPlaylistSyncEnabled,
  getChannelOverride,
}) {
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
  } else if (providerId === 'applemusic') {
    // Ensure developer token generation has completed before checking
    const generatedMusicKitToken = await getGeneratedMusicKitToken();
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (!developerToken) {
      console.warn('[Sync] No Apple Music developer token available — .p8 key may be missing from build');
    }
    if (!userToken) {
      console.warn('[Sync] No Apple Music user token stored');
    }
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    } else {
      const reason = !developerToken && !userToken
        ? 'Missing both developer token and user token'
        : !developerToken
          ? 'Missing developer token (MusicKit key may not be bundled in this build)'
          : 'Missing user token (please reconnect Apple Music)';
      return { authenticated: false, error: reason };
    }
  } else if (providerId === 'listenbrainz') {
    // LB user token lives in the scrobbler-side config, not a separate
    // sync key. See docs/architecture/android-parity.md "ListenBrainz auth token auto-attach".
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
    if (!token) {
      return { authenticated: false, error: 'No ListenBrainz user token configured (set it in the ListenBrainz scrobbler settings)' };
    }
  }

  if (!token) {
    return { authenticated: false, error: 'No token found' };
  }

  // Apple Music: keep Apple's status and say what it means. Unlike Spotify
  // below, a refusal is never treated as a valid token: a 403 on the library
  // (no subscription, Sync Library off) would only fail again in the sync. The
  // renderer re-authorizes only on a 401, no answer, or a 403 that the
  // provider traced to the user token itself (tokenRejected) (parachord#1288).
  if (providerId === 'applemusic' && typeof provider.checkAuthStatus === 'function') {
    const { ok, status, tokenRejected } = await provider.checkAuthStatus(token);
    if (ok) return { authenticated: true, status };
    console.warn(`[Sync] Apple Music auth check failed: ${status ? `HTTP ${status}` : 'no answer'}${tokenRejected ? ' (user token refused)' : ''}`);
    const error = typeof provider.describeAuthFailure === 'function' ? provider.describeAuthFailure(status, { tokenRejected: !!tokenRejected }) : undefined;
    // tokenRejected: a 403 that /me/storefront confirms is the token itself,
    // so the renderer may re-authorize (signing in again fixes it).
    return tokenRejected ? { authenticated: false, status, error, tokenRejected: true } : { authenticated: false, status, error };
  }

  // Spotify: only a 401 means the token itself is bad. A 403/429/5xx on a
  // freshly issued token can't be fixed by logging in again, and reporting
  // it as "not authenticated" made the sync flow re-open the consent screen
  // forever (parachord#986). Report the token as valid, surface the status,
  // and let the sync itself report the real error.
  if (typeof provider.checkAuthStatus === 'function') {
    const { ok, status } = await provider.checkAuthStatus(token);
    if (!ok && status && status !== 401) {
      console.warn(`[Sync] ${providerId} auth check got HTTP ${status}; token treated as valid (re-auth only helps on 401)`);
      return { authenticated: true, status };
    }
    return { authenticated: ok, status };
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

  // Get token (refresh if expired)
  let token;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
  } else if (providerId === 'applemusic') {
    const generatedMusicKitToken = await getGeneratedMusicKitToken();
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  // For Spotify, check that the token was granted with the scopes needed for
  // library sync.  Tokens obtained before these scopes were added will still
  // work for playback but will 403 on library endpoints.
  // If no scopes are stored at all (legacy auth before scope tracking was
  // added), skip the check and let the actual API calls handle any 403.
  if (providerId === 'spotify') {
    const grantedScopes = store.get('spotify_token_scopes');
    if (grantedScopes) {
      const requiredSyncScopes = ['user-library-read', 'user-follow-read', 'playlist-read-private'];
      const missing = requiredSyncScopes.filter(s => !grantedScopes.includes(s));
      if (missing.length > 0) {
        console.log(`[Sync] Token missing required scopes: ${missing.join(', ')}. Prompting re-auth.`);
        return {
          success: false,
          error: 'Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions for library sync.',
          errorCode: 'missing_scopes'
        };
      }
    } else {
      // Legacy auth — token was obtained before we started storing scopes.
      // Refreshing preserves the original (possibly incomplete) scopes, so
      // the only reliable fix is a full re-auth.  Prompt the user instead of
      // silently hitting 403s mid-sync.
      console.log('[Sync] No stored scopes found (legacy auth). Prompting re-auth to ensure correct permissions.');
      return {
        success: false,
        error: 'Your Spotify connection needs to be refreshed to support library sync. Please disconnect and reconnect Spotify in Settings.',
        errorCode: 'missing_scopes'
      };
    }
  }

  // For Spotify, provide a token refresh callback that the sync provider can
  // call mid-sync when it encounters a 401 (token expired during long syncs).
  // Force-refreshes because a 401 means the current token was rejected.
  const refreshToken = providerId === 'spotify'
    ? async () => {
        const newToken = await ensureValidSpotifyToken(true);
        if (newToken) token = newToken;
        return newToken;
      }
    : null;

  // Mark sync as active
  activeSyncs.set(providerId, { startedAt: Date.now(), cancelled: false });

  const sendProgress = (progress) => {
    if (!activeSyncs.get(providerId)?.cancelled) {
      event.sender.send('sync:progress', { providerId, ...progress });
    }
  };

  // Cancellation check (parachord#799). The renderer's foreground handler
  // fires `sync.cancel(providerId)` on window focus to interrupt long-running
  // background syncs. This helper is checked at every phase boundary AND
  // between playlist iterations; when it flips true we short-circuit to the
  // save phase, preserve any progress already made (collection.json write +
  // partial local_playlists updates), and return a `cancelled: true` result.
  // The wizard's manual sync path is not affected — the renderer only sends
  // cancel for syncs it started via `runBackgroundSync`.
  const isCancelled = () => !!activeSyncs.get(providerId)?.cancelled;

  const fsPromises = require('fs').promises;

  try {
    const results = { tracks: null, albums: null, artists: null, playlists: null };
    const settings = options.settings || {};

    // Load current collection
    const collectionPath = path.join(app.getPath('userData'), 'collection.json');

    // Build a "save-partial-and-return" helper that runs collection.json
    // write + lastSyncAt bump + result construction. Called from every
    // cancellation point so partial progress is durable.
    const finalizeCancelled = async (collectionState, resultsState) => {
      try {
        sendProgress({ phase: 'cancelled', message: 'Sync cancelled' });
        await writeCollectionAtomic(collectionPath, collectionState);
      } catch (err) {
        console.warn(`[Sync] Cancellation save failed for ${providerId}:`, err.message);
      }
      // Bump lastSyncAt even for partial syncs so the staleness gate
      // doesn't immediately re-trigger another full run. The next cycle
      // picks up whatever still needs work.
      const partialSyncSettings = store.get('resolver_sync_settings') || {};
      partialSyncSettings[providerId] = {
        ...partialSyncSettings[providerId],
        lastSyncAt: Date.now()
      };
      store.set('resolver_sync_settings', partialSyncSettings);
      const hasChanges = Object.values(resultsState).some(r =>
        r && ((r.added || 0) > 0 || (r.removed || 0) > 0 || (r.updated || 0) > 0 || (r.merged || 0) > 0)
      );
      console.log(`[Sync] ${providerId} cancelled — partial progress saved`);
      return {
        success: true,
        cancelled: true,
        results: resultsState,
        collection: hasChanges ? collectionState : null
      };
    };
    let collection;
    try {
      const content = await fsPromises.readFile(collectionPath, 'utf8');
      collection = JSON.parse(content);
      console.log(`[Sync] Loaded collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    } catch {
      collection = { tracks: [], albums: [], artists: [] };
      console.log('[Sync] No existing collection, starting fresh');
    }

    // Tombstone filter (parachord#864) — drops remote tracks the user
    // previously removed from Collection, so the diff doesn't see them
    // as toAdd and silently undo the removal. Each filter hit also
    // re-arms the tombstone's TTL inside the helper. Only wired for
    // tracks today (album-level tombstones tracked separately).
    const filterTrackTombstones = (remoteItems) => {
      const { filtered, dropped } = Tombstones.filterRemoteByTombstones(store, remoteItems, providerId);
      if (dropped > 0) {
        console.log(`[Sync] Tombstone filter dropped ${dropped} re-import attempt(s) for ${providerId}`);
      }
      return filtered;
    };

    // Sync tracks
    if (settings.syncTracks !== false && provider.capabilities.tracks) {
      sendProgress({ phase: 'fetching', type: 'tracks', message: 'Fetching liked songs...' });
      console.log(`[Sync] Syncing tracks. Input: ${collection.tracks?.length || 0} tracks`);
      const trackResult = await SyncEngine.syncDataType(
        provider,
        token,
        'tracks',
        collection.tracks || [],
        (p) => sendProgress({ phase: 'fetching', type: 'tracks', ...p }),
        refreshToken,
        isCancelled,  // parachord#820: poll between paginated pages
        { filterRemote: filterTrackTombstones }  // parachord#864
      );
      console.log(`[Sync] Track sync complete. Output: ${trackResult.data.length} tracks. Stats:`, trackResult.stats);
      collection.tracks = trackResult.data;
      results.tracks = trackResult.stats;
    } else {
      console.log(`[Sync] Skipping tracks sync. syncTracks=${settings.syncTracks}, capabilities.tracks=${provider.capabilities.tracks}`);
    }

    if (isCancelled()) return await finalizeCancelled(collection, results);

    // Sync albums
    if (settings.syncAlbums !== false && provider.capabilities.albums) {
      sendProgress({ phase: 'fetching', type: 'albums', message: 'Fetching saved albums...' });
      console.log(`[Sync] Syncing albums. Input: ${collection.albums?.length || 0} albums`);
      const albumResult = await SyncEngine.syncDataType(
        provider,
        token,
        'albums',
        collection.albums || [],
        (p) => sendProgress({ phase: 'fetching', type: 'albums', ...p }),
        refreshToken,
        isCancelled
      );
      console.log(`[Sync] Album sync complete. Output: ${albumResult.data.length} albums. Stats:`, albumResult.stats);
      collection.albums = albumResult.data;
      results.albums = albumResult.stats;
    } else {
      console.log(`[Sync] Skipping albums sync. syncAlbums=${settings.syncAlbums}, capabilities.albums=${provider.capabilities.albums}`);
    }

    if (isCancelled()) return await finalizeCancelled(collection, results);

    // Sync artists
    if (settings.syncArtists !== false && provider.capabilities.artists) {
      sendProgress({ phase: 'fetching', type: 'artists', message: 'Fetching followed artists...' });
      console.log(`[Sync] Syncing artists. Input: ${collection.artists?.length || 0} artists`);
      const artistResult = await SyncEngine.syncDataType(
        provider,
        token,
        'artists',
        collection.artists || [],
        (p) => sendProgress({ phase: 'fetching', type: 'artists', ...p }),
        refreshToken,
        isCancelled
      );
      console.log(`[Sync] Artist sync complete. Output: ${artistResult.data.length} artists. Stats:`, artistResult.stats);
      collection.artists = artistResult.data;
      results.artists = artistResult.stats;
    } else {
      console.log(`[Sync] Skipping artists sync. syncArtists=${settings.syncArtists}, capabilities.artists=${provider.capabilities.artists}`);
    }

    if (isCancelled()) return await finalizeCancelled(collection, results);

    // Sync playlists
    // ListenBrainz imports ALL of the user's remote playlists by default (mobile
    // parity — an empty pull-allowlist means "import all"; see
    // SyncEngine.kt getPullPlaylists). So a playlist created on another device
    // (e.g. Android) auto-appears here. Spotify/Apple Music keep the opt-IN model
    // (only playlists in selectedPlaylistIds). Suppression + an explicit channel
    // override still exclude individual playlists on every provider.
    // N-way mutual exclusion (parachord#911): in 'new' mode the N-way reconcile
    // owns inbound playlist import (via its pull-source path), so the legacy
    // inbound playlist phase stands down. Library sync (tracks/albums/artists)
    // above is unaffected — N-way is playlist-only.
    const legacyPlaylists = legacyPlaylistSyncEnabled();
    if (!legacyPlaylists) {
      console.log('[Sync] sync_engine_mode=new — N-way owns playlists; skipping legacy inbound playlist sync');
    }
    const importAll = providerId === 'listenbrainz';
    if (legacyPlaylists && settings.syncPlaylists && (importAll || settings.selectedPlaylistIds?.length > 0) && provider.capabilities.playlists) {
      // Load current playlists
      const currentPlaylists = store.get('local_playlists') || [];

      // Fetch playlist metadata to check for updates
      sendProgress({ phase: 'playlists', current: 0, total: settings.selectedPlaylistIds?.length || 0, providerId });
      const { playlists: remotePlaylists } = await provider.fetchPlaylists(token, null, refreshToken);
      const suppressedPlaylists = store.get('suppressed_sync_playlists') || {};
      const suppressedForProvider = suppressedPlaylists[providerId] || [];
      const allSelectedRemote = remotePlaylists.filter(p => {
        if (suppressedForProvider.includes(p.externalId)) return false; // user removed it
        if (importAll) {
          // Import-all (LB): include unless an explicit channel override drops it.
          const override = getChannelOverride(`${providerId}-${p.externalId}`);
          return !(Array.isArray(override) && !override.includes(providerId));
        }
        return (settings.selectedPlaylistIds || []).includes(p.externalId);
      });

      // Durable link map (sync_playlist_links), loaded once for the import match
      // below. A local playlist that mirrors OUT to this provider (e.g. a followed
      // Spotify playlist auto-mirrored to its owned LB copy, parachord#937) has its
      // link recorded HERE by the create gateway immediately — before the renderer
      // persists syncedTo onto the row. Without consulting it, a same-cycle import
      // of that mirror finds no syncedTo match and creates a SEPARATE owned playlist
      // that then re-exports into a duplicate. Reverse-index: provider externalId → localId.
      const importLinkByExternalId = new Map();
      const allSyncLinks = getSyncLinks();
      for (const [localId, byProvider] of Object.entries(allSyncLinks || {})) {
        const ext = byProvider && byProvider[providerId] && byProvider[providerId].externalId;
        if (ext) importLinkByExternalId.set(ext, localId);
      }

      // The local playlist a remote one belongs to: imported FROM this provider
      // (syncedFrom), pushed TO it (syncedTo), an older playlist by its id
      // pattern, or a mirror the create gateway linked (#937).
      const findLocalFor = (remotePlaylist, list) => {
        const linkedLocalId = importLinkByExternalId.get(remotePlaylist.externalId);
        return list.find(p =>
          p.syncedFrom?.externalId === remotePlaylist.externalId ||
          p.syncedTo?.[providerId]?.externalId === remotePlaylist.externalId ||
          p.id === remotePlaylist.id ||
          p.id === `${providerId}-${remotePlaylist.externalId}` ||
          (linkedLocalId && p.id === linkedLocalId)
        );
      };

      // Every selected playlist's snapshot is compared on every cycle, and only
      // the ones that need work are staggered (sync-engine/playlist-cycle.js).
      // The snapshots come with the playlist list fetched above, so an
      // unchanged playlist costs a compare and is marked checked here; the
      // batch (parachord#800) caps only the full per-playlist branch, which
      // takes first the playlists whose source changed. Before, the stagger
      // picked 15 to compare at all, and with 177 selected a daily playlist's
      // rebuild waited hours to be noticed (Daily Brew, 2026-11-20). Explicit
      // full syncs (wizard "Sync Now", cleanup-duplicates) still process every
      // playlist that needs work.
      //
      // One read of local_playlists for the whole pass: it's a large file that
      // the store parses on every get, so the per-playlist re-read the loop
      // does for its batch would cost a parse per selected playlist here. The
      // fresh copy picks up a renderer write made while the list was fetched,
      // as that re-read does.
      const freshById = new Map((store.get('local_playlists') || []).map(p => [p.id, p]));
      const plan = planPlaylistCycle({
        selectedRemote: allSelectedRemote,
        localFor: (remotePlaylist) => {
          const local = findLocalFor(remotePlaylist, currentPlaylists);
          return local ? (freshById.get(local.id) || local) : undefined;
        },
        localPlaylists: currentPlaylists,
        providerId,
        fullSync: !!options.fullSync,
        canShortCircuit: SyncEngine.canShortCircuitPlaylistUpdate,
        stagger: SyncEngine.staggerPlaylistsForCycle,
      });
      const checkedAt = Date.now();
      for (const { remote, playlist } of plan.unchanged) {
        const idx = currentPlaylists.findIndex(p => p.id === playlist.id);
        if (idx < 0) continue;
        currentPlaylists[idx] = {
          ...playlist,
          syncSources: {
            ...playlist.syncSources,
            [providerId]: { ...playlist.syncSources?.[providerId], syncedAt: checkedAt }
          }
        };
        // parachord#822: "visited, snapshot matched" stays visible in [Sync] traces.
        const snap = (remote.snapshotId || '').slice(0, 12);
        console.log(`[Sync] ${providerId} "${remote.name || playlist.title || remote.id}": short-circuit (snap matched, no work) local=${snap} remote=${snap}`);
      }
      const selectedRemote = plan.toProcess;
      console.log(`[Sync] ${providerId} playlists: ${plan.unchanged.length}/${allSelectedRemote.length} unchanged, ${selectedRemote.length} to check this cycle${plan.waiting > 0 ? `, ${plan.waiting} deferred to the next` : ''}`);

      let playlistsAdded = 0;
      let playlistsUpdated = 0;
      let playlistsFailed = 0;
      // Playlists this sync pulled, with what the pull read
      // ({ lastModified, tracksFingerprint }). A save between the pull and
      // the final write is kept if it changed the tracks, and otherwise
      // takes the pull on top (keepEditsMadeDuringPull, sync-engine/auto-pull.js).
      const pullBases = new Map();
      const keepEditsSinceRead = (list, latestById) => list.map((p) => (pullBases.has(p.id)
        ? keepEditsMadeDuringPull(p, latestById.get(p.id), pullBases.get(p.id))
        : p));

      for (let i = 0; i < selectedRemote.length; i++) {
        // Per-iteration cancellation check (parachord#799). Save partial
        // progress before bailing — currentPlaylists already holds the
        // in-memory mutations for playlists processed so far. Skip the
        // syncedFrom-clearing pass below since we may not have visited
        // every selected playlist; deferring it to the next non-cancelled
        // sync is safer than clearing based on a partial iteration.
        if (isCancelled()) {
          store.set('local_playlists', keepEditsSinceRead(currentPlaylists, new Map((store.get('local_playlists') || []).map(p => [p.id, p]))));
          results.playlists = { added: playlistsAdded, updated: playlistsUpdated, failed: playlistsFailed, cancelled: true, processedCount: i };
          console.log(`[Sync] ${providerId} playlist sync cancelled at ${i}/${selectedRemote.length} — partial progress saved`);
          return await finalizeCancelled(collection, results);
        }

        const remotePlaylist = selectedRemote[i];
        sendProgress({ phase: 'playlists', current: i + 1, total: selectedRemote.length, providerId });

        try {
          // Check for existing playlist by syncedFrom.externalId, syncedTo externalId, or matching ID pattern
          // This handles: playlists imported FROM this provider, playlists pushed TO this provider,
          // and older playlists that may have been synced before the syncedFrom/syncedTo structure
          const localPlaylist = findLocalFor(remotePlaylist, currentPlaylists);

          if (!localPlaylist) {
            // New playlist - fetch tracks and add
            console.log(`[Sync] Importing playlist: ${remotePlaylist.name}`);
            const tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token, null, refreshToken);

            // Use earliest track addedAt as playlist creation estimate (Spotify doesn't provide playlist follow date)
            const earliestTrackDate = tracks.length > 0
              ? Math.min(...tracks.map(t => t.addedAt || Date.now()).filter(Boolean))
              : Date.now();

            const newPlaylist = {
              id: remotePlaylist.id,
              title: remotePlaylist.name,
              description: remotePlaylist.description,
              tracks: tracks,
              creator: remotePlaylist.ownerName || null,
              source: remotePlaylist.isOwnedByUser ? `${providerId}-sync` : `${providerId}-import`,
              syncedFrom: {
                resolver: providerId,
                externalId: remotePlaylist.externalId,
                snapshotId: remotePlaylist.snapshotId,
                ownerId: remotePlaylist.ownerId,
                isCollaborator: !!remotePlaylist.isCollaborator,
                // What the source gave: a later edit here differs from it
                // (sync-engine/auto-pull.js).
                tracksFingerprint: tracksFingerprint(tracks)
              },
              hasUpdates: false,
              locallyModified: false,
              syncSources: {
                [providerId]: { addedAt: earliestTrackDate, syncedAt: Date.now() }
              },
              createdAt: earliestTrackDate,
              addedAt: Date.now(),  // When it was added to Parachord
              // The service's playlist cover; the track mosaic stays the
              // fallback (album-art.md "Playlist covers").
              ...(remotePlaylist.coverArt ? { coverArt: remotePlaylist.coverArt } : {})
            };

            currentPlaylists.push(newPlaylist);
            playlistsAdded++;
          } else {
            // Existing playlist - update metadata and check for track updates
            const idx = currentPlaylists.findIndex(p => p.id === localPlaylist.id);
            if (idx >= 0) {
              // Hoisted re-read: pick up any concurrent renderer writes for
              // this playlist BEFORE deciding short-circuit vs. full branch.
              // Without this, the short-circuit below would use the L6090
              // snapshot and clobber a concurrent renderer edit (e.g. user
              // removed a track) at end-of-loop store.set. electron-store
              // caches the parsed array, so this read is near-free.
              //
              // The full branch keeps its own inner re-read (post-
              // fetchPlaylistTracks) to cover the narrower window of a
              // concurrent edit during the track-fetch IPC. Both reads are
              // defensive; both are cheap.
              {
                const freshPlaylists = store.get('local_playlists') || [];
                const freshPlaylist = freshPlaylists.find(p => p.id === localPlaylist.id);
                if (freshPlaylist) {
                  currentPlaylists[idx] = freshPlaylist;
                }
              }
              // An import from before the fingerprint gets one now, before
              // the short-circuit below moves syncedAt and the old rule
              // forgets an edit (seedTracksFingerprint, sync-engine/auto-pull.js).
              currentPlaylists[idx] = seedTracksFingerprint(currentPlaylists[idx], providerId);

              // Short-circuit unchanged playlists (parachord#796). When the
              // playlist hasn't drifted on either side AND no metadata backfill
              // is pending AND owner/collaborator state is stable, skip the
              // spread-rewrite work and just bump syncedAt. This shrinks the
              // in-memory mutation footprint of a steady-state sync (where
              // most selected playlists haven't actually changed) and keeps
              // the staleness timestamp accurate for #800's oldest-stale-first
              // sort. Modest CPU win; the bigger sync-perf levers are in
              // #797 (resolver concurrency) and #798 (push-loop idle deferral).
              if (SyncEngine.canShortCircuitPlaylistUpdate({
                localPlaylist: currentPlaylists[idx],
                remotePlaylist,
                providerId
              })) {
                // parachord#822: log the short-circuit so it's distinguishable
                // from "playlist never reached" in [Sync] traces. The snapshot
                // preview makes "snap matched, no work" auditable when a user
                // reports "why didn't sync update X" — you can see both that
                // the playlist was visited AND what snapshot was matched.
                const localSnap = (currentPlaylists[idx].syncedFrom?.snapshotId || '').slice(0, 12);
                const remoteSnap = (remotePlaylist.snapshotId || '').slice(0, 12);
                const playlistName = remotePlaylist.name || currentPlaylists[idx].name || remotePlaylist.id;
                console.log(`[Sync] ${providerId} "${playlistName}": short-circuit (snap matched, no work) local=${localSnap} remote=${remoteSnap}`);
                const cur = currentPlaylists[idx];
                currentPlaylists[idx] = {
                  ...cur,
                  syncSources: {
                    ...cur.syncSources,
                    [providerId]: {
                      ...cur.syncSources?.[providerId],
                      syncedAt: Date.now()
                    }
                  }
                };
                continue;
              }

              const hasTrackUpdates = localPlaylist.syncedFrom?.snapshotId !== remotePlaylist.snapshotId;
              const existingTracks = currentPlaylists[idx].tracks || [];
              const isEmpty = existingTracks.length === 0;

              // Determine whether this provider is the canonical pull source.
              // Two categories of "not the pull source" silence the log:
              //   1. Cross-provider push mirrors (syncedFrom.resolver points to
              //      a different provider; matched via syncedTo[providerId]) —
              //      snapshotIds aren't comparable across services.
              //   2. Locally-created push mirrors (syncedFrom undefined; matched
              //      via syncedTo[providerId]) — there's no pull source at all.
              // Only when syncedFrom.resolver STRICTLY matches the provider does
              // this provider own the pull contract; that's the only case where
              // "has updates" carries meaning. (Note: the downstream isOwnPullSource
              // check still uses the permissive form to preserve first-time-link
              // semantics for state writes; the log just needs to be stricter.)
              const preRefreshIsOwnPullSource = localPlaylist.syncedFrom?.resolver === providerId;

              // Snapshot-divergence suppression covers two distinct cases
              // where "snapshotIds differ" does NOT mean "content drifted":
              //
              // 1. **AM snapshotId churn** (any provider's pull source). AM
              //    re-issues snapshotIds for editorial / system playlists
              //    ("My Shazam Tracks", curated picks, Rewind / Radio
              //    Paradise / NTS-style hosted feeds) even when the tracklist
              //    hasn't changed. Use track-count as a cheap content
              //    fingerprint: same count = treat as unchanged, adopt the
              //    new snapshotId silently. Tradeoff: miss the rare "AM
              //    swapped one track for another, same count" case. For
              //    user-owned playlists that's vanishingly rare; for
              //    editorial playlists the user can refresh manually if
              //    they suspect drift.
              //
              //    **Scoped to AM only.** Spotify's snapshotId is rock-solid;
              //    its algorithmic / 3rd-party-rotated playlists keep a FIXED
              //    track count with rotating content — applying count-match
              //    there would silently suppress legitimate daily updates.
              //    Spotify-curated playlists get their own arm below
              //    (`isSpotifyCuratedMatch`) via ownership signal instead.
              //    LB's snapshot anchor (extension.last_modified_at) is
              //    similarly reliable.
              //
              // 2. **Heal-induced null snapshot** (all providers). The
              //    startup heal `healImportedSyncedFromMismatch` (main.js,
              //    runs every launch) nulls syncedFrom.snapshotId when
              //    restoring a corrupted resolver field — the contract is
              //    "next sync from the canonical provider repopulates."
              //    Without this branch, every post-heal sync would flag
              //    these playlists "has updates" forever (stillHasUpdates
              //    stays true → snapshotId never advances → next sync sees
              //    same diff). Adopt silently to honor the heal contract.
              //    Tradeoff: lose the signal for any content drift that
              //    happened BETWEEN the corruption and the heal. Accepted
              //    because (a) heal runs on every launch — drift window is
              //    bounded, (b) the alternative is perpetual log spam and
              //    permanently-set hasUpdates flags on a fleet of playlists
              //    the user already isn't reviewing.
              //
              // Spotify-curated playlists (owner.id === 'spotify': Daily Brew,
              // Discover Weekly, Release Radar, Daily Mix N, Daylist) used to
              // be a third silent-adopt arm. Every changed import is now pulled
              // (auto-pull below), so they need no arm of their own; they are
              // only marked `sourceOnly`, because Spotify refuses writes to
              // playlists the user doesn't own, so a local edit to one could
              // never have reached Spotify and doesn't hold the pull back.
              const localSnapPresent = !!localPlaylist.syncedFrom?.snapshotId;
              const isHealInducedNull = !localSnapPresent;
              const isAmCountChurnMatch =
                providerId === 'applemusic'
                && remotePlaylist.trackCount != null
                && existingTracks.length === remotePlaylist.trackCount;
              const isSpotifyCuratedMatch =
                providerId === 'spotify'
                && remotePlaylist.ownerId === 'spotify';
              const silentlyAdopt = isHealInducedNull || isAmCountChurnMatch;

              // Auto-pull (mobile parity; sync-engine/auto-pull.js). A changed
              // import takes the remote version now, with no "pull changes"
              // prompt, unless it was edited here since the last sync (a
              // conflict: flagged hasUpdates, the playlist page asks) or is a
              // hosted XSPF (the XSPF is the upstream; never pulled).
              const pullOpts = { sourceOnly: isSpotifyCuratedMatch };
              const remoteChanged = preRefreshIsOwnPullSource && hasTrackUpdates && !silentlyAdopt;
              const preAction = remoteChanged ? remoteUpdateAction(currentPlaylists[idx], providerId, pullOpts) : null;
              const snapLog = `local=${existingTracks.length}, remote=${remotePlaylist.trackCount ?? 'NULL'}, localSnap=${(localPlaylist.syncedFrom?.snapshotId || '').slice(0,12) || 'NULL'}, remoteSnap=${(remotePlaylist.snapshotId || '').slice(0,12) || 'NULL'}`;
              if (preAction === 'pull') {
                console.log(`[Sync] Pulling changes to "${remotePlaylist.name}" (${snapLog})`);
              } else if (preAction === 'conflict') {
                console.log(`[Sync] "${remotePlaylist.name}" changed on ${providerId} and was edited here; not pulling, the playlist page asks (${snapLog})`);
              } else if (preAction === 'hosted') {
                console.log(`[Sync] "${remotePlaylist.name}" changed on ${providerId}; hosted XSPF, not pulling (${snapLog})`);
              } else if (preRefreshIsOwnPullSource && hasTrackUpdates && silentlyAdopt) {
                const reason = isHealInducedNull ? 'heal-induced null snapshot' : `track count matches: ${existingTracks.length}`;
                console.log(`[Sync] Adopting remote snapshotId for "${remotePlaylist.name}" (${reason})`);
              }
              // Refetch conditions:
              //   - auto-pull: the remote changed and nothing here holds it back
              //   - isEmpty: playlist has 0 tracks locally; need to backfill,
              //     unless the person emptied it here (a real local edit)
              const shouldRefetchTracks =
                preRefreshIsOwnPullSource
                && (preAction === 'pull'
                  || (isEmpty && preAction !== 'conflict' && !hasRealLocalEdits(currentPlaylists[idx], providerId)));

              let tracks = existingTracks;
              if (shouldRefetchTracks) {
                const reason = preAction === 'pull' ? 'changed remotely' : 'has 0 tracks';
                console.log(`[Sync] Playlist "${remotePlaylist.name}" ${reason}, refetching...`);
                tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token, null, refreshToken);
                console.log(`[Sync] Fetched ${tracks.length} tracks for "${remotePlaylist.name}"`);
              }

              // The created date only ever moves earlier (sync-engine/created-at.js):
              // recalculating it from the current tracks alone moved a playlist
              // the service rebuilds daily (Daily Brew) forward with every rebuild.
              const recalculatedCreatedAt = stableCreatedAt(currentPlaylists[idx], tracks, providerId);

              // Re-read the playlist from store in case the user pulled changes
              // while this sync was running (handlePull saves hasUpdates:false +
              // updated snapshotId to disk, but we loaded currentPlaylists earlier).
              const freshPlaylists = store.get('local_playlists') || [];
              const freshPlaylist = freshPlaylists.find(p => p.id === localPlaylist.id);
              if (freshPlaylist) {
                // The stored copy has no seed yet if this is its first sync.
                currentPlaylists[idx] = seedTracksFingerprint(freshPlaylist, providerId);
              }
              const current = currentPlaylists[idx];

              // Determine whether this provider is the canonical pull source
              // for the local playlist. It IS the pull source when:
              //   - the local has no syncedFrom yet (first time linking), OR
              //   - the existing syncedFrom.resolver already points at us.
              // If syncedFrom points at a DIFFERENT provider (e.g. Spotify),
              // this local is being matched via syncedTo[providerId] — it's a
              // cross-provider push mirror. We must NOT overwrite its
              // syncedFrom or clobber its tracks, because the other provider
              // is the authoritative source.
              const isOwnPullSource = !current.syncedFrom?.resolver
                || current.syncedFrom.resolver === providerId;

              // Re-check after refresh — the user may have already pulled this update.
              // Only meaningful when we're the pull source; otherwise snapshotIds
              // come from different providers and aren't comparable.
              //
              // Same two-arm suppression as the earlier log-firing decision
              // (heal-induced null snapshot, AM track-count churn). Counting
              // from current.tracks (not existingTracks) picks up the case
              // where a previously-empty playlist just got refilled in the
              // isEmpty branch above.
              const freshIsHealInducedNull = !current.syncedFrom?.snapshotId;
              const freshIsAmCountChurnMatch =
                providerId === 'applemusic'
                && remotePlaylist.trackCount != null
                && (current.tracks?.length || 0) === remotePlaylist.trackCount;
              const freshSilentlyAdopt = freshIsHealInducedNull || freshIsAmCountChurnMatch;

              // The pull applies only if nothing changed its answer while the
              // tracks were fetched: an edit saved meanwhile makes it a
              // conflict, and the edit stays.
              const pulled = shouldRefetchTracks
                && isOwnPullSource
                && preAction === 'pull'
                && remoteUpdateAction(current, providerId, pullOpts) === 'pull';
              const stillHasUpdates = isOwnPullSource
                && current.syncedFrom?.snapshotId !== remotePlaylist.snapshotId
                && !freshSilentlyAdopt
                && !pulled;

              // If we refetched tracks (either backfilled an empty playlist
              // OR pulled a Spotify-curated daily update) AND the playlist is
              // mirrored to providers other than this one, the mirrors now
              // have stale content. Flag locallyModified so the next push
              // loop propagates the new tracks outward. This is the main.js
              // parallel of handlePull's hasOtherMirrors logic.
              const tracksRefetched = shouldRefetchTracks && tracks.length > 0 && isOwnPullSource
                && (pulled || !hasRealLocalEdits(current, providerId));
              const hasOtherMirrors = !!(current.syncedTo && Object.keys(current.syncedTo).some(
                pid => pid !== providerId && current.syncedTo[pid]?.externalId
              ));

              const now = Date.now();
              const base = pulled
                ? applyPulledTracks(current, { providerId, remotePlaylist, tracks, now })
                : current;
              if (pulled) pullBases.set(current.id, { lastModified: current.lastModified || 0, tracksFingerprint: tracksFingerprint(current.tracks) });

              // Always update/backfill metadata fields (creator, source, createdAt)
              currentPlaylists[idx] = {
                ...base,
                // Replace tracks if we refetched (auto-pull OR empty backfill),
                // but only if we're the pull source. Cross-provider push
                // mirrors preserve their existing tracks; the authoritative
                // provider will fill them on its own sync. A pull's tracks
                // come from applyPulledTracks (its empty-answer guard).
                tracks: tracksRefetched && !pulled ? tracks : base.tracks,
                // Backfill creator if not set
                creator: current.creator || remotePlaylist.ownerName || null,
                // The source's playlist cover follows the service: a new one
                // replaces it, a removed one (null) gives the mosaic back. A
                // service that reports no covers leaves it alone, and so does
                // a cross-provider mirror (its source owns the cover).
                ...(isOwnPullSource && remotePlaylist.coverArt !== undefined
                  ? { coverArt: remotePlaylist.coverArt || null }
                  : {}),
                // Backfill source if not set
                source: current.source || (remotePlaylist.isOwnedByUser ? `${providerId}-sync` : `${providerId}-import`),
                // The created date, never later than it was (see above)
                createdAt: recalculatedCreatedAt,
                // Update/backfill syncedFrom ONLY if we're the pull source.
                // Cross-provider push mirrors keep their original syncedFrom.
                syncedFrom: isOwnPullSource
                  ? {
                      ...base.syncedFrom,
                      resolver: providerId,
                      externalId: remotePlaylist.externalId,
                      snapshotId: stillHasUpdates ? current.syncedFrom?.snapshotId : remotePlaylist.snapshotId,
                      ownerId: remotePlaylist.ownerId,
                      isCollaborator: !!remotePlaylist.isCollaborator,
                      // An empty-playlist backfill is a pull too.
                      ...(tracksRefetched && !pulled ? { tracksFingerprint: tracksFingerprint(tracks) } : {})
                    }
                  : base.syncedFrom,
                hasUpdates: stillHasUpdates ? true : base.hasUpdates,
                locallyModified: (tracksRefetched && hasOtherMirrors) ? true : base.locallyModified,
                syncSources: {
                  ...base.syncSources,
                  [providerId]: { ...base.syncSources?.[providerId], syncedAt: now }
                }
              };

              if (stillHasUpdates || tracksRefetched || pulled) {
                playlistsUpdated++;
              }
            }
          }
        } catch (playlistError) {
          playlistsFailed++;
          console.error(`[Sync] Failed to sync playlist "${remotePlaylist.name}": ${playlistError.message}`);
          // Continue with remaining playlists instead of aborting the entire sync
        }
      }

      // Playlists whose source is missing from the provider's list: one made in
      // Parachord or copied from another service gives up syncedFrom so the
      // push loops can create it again; one imported from this provider keeps
      // it (the startup heal would restore it, and imports are never pushed
      // back to their source). See sync-engine/missing-sources.js.
      const missingSources = detachMissingSources(currentPlaylists, remotePlaylists, providerId);
      if (missingSources.looksPartial) {
        console.warn(`[Sync] Skipping syncedFrom clearing: ${missingSources.missingCount}/${missingSources.total} playlists missing from ${providerId} remote response (likely incomplete API response)`);
      } else {
        // currentPlaylists is updated in place throughout this handler.
        missingSources.playlists.forEach((p, j) => { currentPlaylists[j] = p; });
        for (const p of missingSources.detached) {
          console.log(`[Sync] Playlist "${p.title}" no longer on ${providerId}, clearing syncedFrom so it can be re-pushed`);
        }
        if (missingSources.kept.length > 0) {
          console.log(`[Sync] ${missingSources.kept.length} playlist(s) imported from ${providerId} aren't in its playlist list; keeping their links (re-following one on ${providerId} brings it back): ${missingSources.kept.map(p => `"${p.title}"`).join(', ')}`);
        }
      }

      // Flag mirrors deleted on the provider. Without this only a push notices,
      // and an unedited playlist never pushes (parachord#1269).
      const { playlists: playlistsToSave } = await flagDeadMirrors(currentPlaylists, remotePlaylists, provider, {
        providerId,
        token,
        isCancelled,
      });

      // Save playlists (including any that succeeded before a failure)
      // This pull read local_playlists when it started; a push loop may have
      // written a link since. Keep any such link rather than saving over it
      // (sync-engine/playlist-save-guard.js).
      const latestById = new Map((store.get('local_playlists') || []).map(p => [p.id, p]));
      const linksNow = getSyncLinks();
      // A playlist pulled above that was edited before this write keeps the
      // edit (sync-engine/auto-pull.js).
      const guardedPlaylists = keepEditsSinceRead(playlistsToSave, latestById)
        .map(p => keepDroppedLinks(p, latestById.get(p.id), linksNow).playlist);
      store.set('local_playlists', guardedPlaylists);
      results.playlists = { added: playlistsAdded, updated: playlistsUpdated, failed: playlistsFailed };
      console.log(`[Sync] Playlists synced: ${playlistsAdded} added, ${playlistsUpdated} updated${playlistsFailed > 0 ? `, ${playlistsFailed} failed` : ''}`);
    }

    // Save collection
    sendProgress({ phase: 'saving', message: 'Saving collection...' });
    console.log(`[Sync] Saving collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    await writeCollectionAtomic(collectionPath, collection);

    // Update sync settings with last sync time
    const syncSettings = store.get('resolver_sync_settings') || {};
    syncSettings[providerId] = {
      ...syncSettings[providerId],
      lastSyncAt: Date.now()
    };
    store.set('resolver_sync_settings', syncSettings);

    sendProgress({ phase: 'complete', message: 'Sync complete!' });

    // Only send the full collection back to the renderer if there were
    // meaningful changes (adds, removes, updates). For no-op syncs where
    // everything is unchanged, skip the expensive IPC serialisation of
    // the entire collection — the data is already saved to disk above.
    const hasChanges = Object.values(results).some(r =>
      r && ((r.added || 0) > 0 || (r.removed || 0) > 0 || (r.updated || 0) > 0 || (r.merged || 0) > 0)
    );

    return { success: true, results, collection: hasChanges ? collection : null };
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
}
module.exports = { registerSyncStartIpc };
