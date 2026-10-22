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
        r && ((r.added || 0) > 0 || (r.removed || 0) > 0 || (r.updated || 0) > 0)
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

      // Stagger across cycles (parachord#800). Background sync processes
      // the top N oldest-stale-first per cycle; over 4-5 cycles the whole
      // selection gets covered. Explicit full-sync paths (wizard "Sync
      // Now", cleanup-duplicates, etc.) bypass via `options.fullSync` so
      // they still see every selected playlist in one run.
      //
      // The sort is provider-scoped (`syncSources[providerId].syncedAt`),
      // so each provider's stagger queue is independent — a Spotify-stale
      // playlist gets priority on Spotify's next cycle without competing
      // with AM's separate queue.
      const selectedRemote = options.fullSync
        ? allSelectedRemote
        : SyncEngine.staggerPlaylistsForCycle({
            selectedRemote: allSelectedRemote,
            localPlaylists: currentPlaylists,
            providerId
          });
      if (!options.fullSync && selectedRemote.length < allSelectedRemote.length) {
        console.log(`[Sync] Staggered ${providerId}: processing ${selectedRemote.length}/${allSelectedRemote.length} oldest-stale this cycle (remainder defers to next cycle)`);
      }

      let playlistsAdded = 0;
      let playlistsUpdated = 0;
      let playlistsFailed = 0;

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

      for (let i = 0; i < selectedRemote.length; i++) {
        // Per-iteration cancellation check (parachord#799). Save partial
        // progress before bailing — currentPlaylists already holds the
        // in-memory mutations for playlists processed so far. Skip the
        // syncedFrom-clearing pass below since we may not have visited
        // every selected playlist; deferring it to the next non-cancelled
        // sync is safer than clearing based on a partial iteration.
        if (isCancelled()) {
          store.set('local_playlists', currentPlaylists);
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
          const linkedLocalId = importLinkByExternalId.get(remotePlaylist.externalId);
          const localPlaylist = currentPlaylists.find(p =>
            p.syncedFrom?.externalId === remotePlaylist.externalId ||
            p.syncedTo?.[providerId]?.externalId === remotePlaylist.externalId ||
            p.id === remotePlaylist.id ||
            p.id === `${providerId}-${remotePlaylist.externalId}` ||
            // Durable link map — this remote is already a mirror of an existing
            // local playlist; match it instead of creating a separate one (#937).
            (linkedLocalId && p.id === linkedLocalId)
          );

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
                isCollaborator: !!remotePlaylist.isCollaborator
              },
              hasUpdates: false,
              locallyModified: false,
              syncSources: {
                [providerId]: { addedAt: earliestTrackDate, syncedAt: Date.now() }
              },
              createdAt: earliestTrackDate,
              addedAt: Date.now()  // When it was added to Parachord
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
              // 3. **Spotify-curated playlists** (`isSpotifyCuratedMatch`).
              //    Playlists owned by Spotify itself (owner.id === 'spotify')
              //    are algorithmic — Daily Brew, Discover Weekly, Release
              //    Radar, Daily Mix N, Daylist, New Music Friday. They
              //    update daily/weekly by design; the user isn't authoring
              //    them and shouldn't see a "pull updates" banner every
              //    morning for content rotation that's expected. Silent
              //    adopt mirrors the AM count-churn suppression but via
              //    a different signal (ownership instead of count).
              //
              //    **Edit-loss is empty.** Spotify's API rejects writes
              //    to non-owned playlists at the auth layer, so any local
              //    "edit" to Daily Brew couldn't have propagated anyway —
              //    no conflict-resolution case to worry about.
              //
              //    **Cross-platform parity.** Android already auto-pulls
              //    these (it has no banner mechanism at all — see
              //    SyncEngine.kt:1209+, "auto-pull on any snapshot
              //    differ"). Desktop's old behavior was the divergence;
              //    this arm closes it for the user-visible case while
              //    preserving the banner UX for user-created playlists
              //    where local-edit conflicts are real.
              const localSnapPresent = !!localPlaylist.syncedFrom?.snapshotId;
              const isHealInducedNull = !localSnapPresent;
              const isAmCountChurnMatch =
                providerId === 'applemusic'
                && remotePlaylist.trackCount != null
                && existingTracks.length === remotePlaylist.trackCount;
              const isSpotifyCuratedMatch =
                providerId === 'spotify'
                && remotePlaylist.ownerId === 'spotify';
              const silentlyAdopt = isHealInducedNull
                || isAmCountChurnMatch
                || isSpotifyCuratedMatch;

              if (preRefreshIsOwnPullSource && hasTrackUpdates && !silentlyAdopt) {
                // Surface both counts so we can tell whether AM is reporting a
                // changed count vs missing trackCount vs same-count-but-different-snapshot.
                console.log(`[Sync] Playlist has updates: ${remotePlaylist.name} (local=${existingTracks.length}, remote=${remotePlaylist.trackCount ?? 'NULL'}, localSnap=${(localPlaylist.syncedFrom?.snapshotId || '').slice(0,12) || 'NULL'}, remoteSnap=${(remotePlaylist.snapshotId || '').slice(0,12) || 'NULL'})`);
              } else if (preRefreshIsOwnPullSource && hasTrackUpdates && silentlyAdopt) {
                const reason = isHealInducedNull
                  ? 'heal-induced null snapshot'
                  : (isSpotifyCuratedMatch
                    ? 'Spotify-curated (owner.id=spotify)'
                    : `track count matches: ${existingTracks.length}`);
                console.log(`[Sync] Adopting remote snapshotId for "${remotePlaylist.name}" (${reason})`);
              }
              // Refetch conditions:
              //   - isEmpty: playlist has 0 tracks locally; need to backfill
              //   - Spotify-curated + snapshot changed: Daily Brew etc. rotate
              //     content daily; advancing the snapshotId without refetching
              //     would silently suppress the banner AND leave yesterday's
              //     tracks in place. Have to do both.
              const shouldRefetchTracks =
                preRefreshIsOwnPullSource
                && (isEmpty || (isSpotifyCuratedMatch && hasTrackUpdates));

              let tracks = existingTracks;
              if (shouldRefetchTracks) {
                const reason = isEmpty ? 'has 0 tracks' : 'Spotify-curated daily update';
                console.log(`[Sync] Playlist "${remotePlaylist.name}" ${reason}, refetching...`);
                tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token, null, refreshToken);
                console.log(`[Sync] Fetched ${tracks.length} tracks for "${remotePlaylist.name}"`);
              }

              // Recalculate createdAt from existing tracks if available
              let recalculatedCreatedAt = currentPlaylists[idx].createdAt;
              if (tracks.length > 0) {
                const trackDates = tracks.map(t => t.addedAt || t.syncSources?.spotify?.addedAt).filter(Boolean);
                if (trackDates.length > 0) {
                  recalculatedCreatedAt = Math.min(...trackDates);
                }
              }

              // Re-read the playlist from store in case the user pulled changes
              // while this sync was running (handlePull saves hasUpdates:false +
              // updated snapshotId to disk, but we loaded currentPlaylists earlier).
              const freshPlaylists = store.get('local_playlists') || [];
              const freshPlaylist = freshPlaylists.find(p => p.id === localPlaylist.id);
              if (freshPlaylist) {
                currentPlaylists[idx] = freshPlaylist;
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
              // Same three-arm suppression as the earlier log-firing decision
              // (heal-induced null snapshot, AM track-count churn, Spotify-
              // curated ownership). Counting from current.tracks (not
              // existingTracks) picks up the case where a previously-empty
              // playlist just got refilled in the isEmpty branch above.
              const freshIsHealInducedNull = !current.syncedFrom?.snapshotId;
              const freshIsAmCountChurnMatch =
                providerId === 'applemusic'
                && remotePlaylist.trackCount != null
                && (current.tracks?.length || 0) === remotePlaylist.trackCount;
              const freshIsSpotifyCuratedMatch =
                providerId === 'spotify'
                && remotePlaylist.ownerId === 'spotify';
              const freshSilentlyAdopt = freshIsHealInducedNull
                || freshIsAmCountChurnMatch
                || freshIsSpotifyCuratedMatch;
              const stillHasUpdates = isOwnPullSource
                && current.syncedFrom?.snapshotId !== remotePlaylist.snapshotId
                && !freshSilentlyAdopt;

              // If we refetched tracks (either backfilled an empty playlist
              // OR pulled a Spotify-curated daily update) AND the playlist is
              // mirrored to providers other than this one, the mirrors now
              // have stale content. Flag locallyModified so the next push
              // loop propagates the new tracks outward. This is the main.js
              // parallel of handlePull's hasOtherMirrors logic.
              const tracksRefetched = shouldRefetchTracks && tracks.length > 0 && isOwnPullSource;
              const hasOtherMirrors = !!(current.syncedTo && Object.keys(current.syncedTo).some(
                pid => pid !== providerId && current.syncedTo[pid]?.externalId
              ));

              // Always update/backfill metadata fields (creator, source, createdAt)
              currentPlaylists[idx] = {
                ...current,
                // Replace tracks if we refetched (empty backfill OR curated
                // daily rotation) — but only if we're the pull source.
                // Cross-provider push mirrors preserve their existing tracks;
                // the authoritative provider will fill them on its own sync.
                tracks: tracksRefetched ? tracks : current.tracks,
                // Backfill creator if not set
                creator: current.creator || remotePlaylist.ownerName || null,
                // Backfill source if not set
                source: current.source || (remotePlaylist.isOwnedByUser ? `${providerId}-sync` : `${providerId}-import`),
                // Update createdAt from track data
                createdAt: recalculatedCreatedAt,
                // Update/backfill syncedFrom ONLY if we're the pull source.
                // Cross-provider push mirrors keep their original syncedFrom.
                syncedFrom: isOwnPullSource
                  ? {
                      ...current.syncedFrom,
                      resolver: providerId,
                      externalId: remotePlaylist.externalId,
                      snapshotId: stillHasUpdates ? current.syncedFrom?.snapshotId : remotePlaylist.snapshotId,
                      ownerId: remotePlaylist.ownerId,
                      isCollaborator: !!remotePlaylist.isCollaborator
                    }
                  : current.syncedFrom,
                hasUpdates: stillHasUpdates ? true : current.hasUpdates,
                locallyModified: (tracksRefetched && hasOtherMirrors) ? true : current.locallyModified,
                syncSources: {
                  ...current.syncSources,
                  [providerId]: { ...current.syncSources?.[providerId], syncedAt: Date.now() }
                }
              };

              if (stillHasUpdates || tracksRefetched) {
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

      // Clear syncedFrom on local playlists whose remote counterpart no longer
      // exists (e.g. deleted on the provider). This turns them into local-only
      // playlists so the post-sync push logic will re-create them on the provider.
      //
      // Safety: only clear syncedFrom when the remote fetch looks complete.
      // If the API returned far fewer playlists than we have locally synced from
      // this provider, the response was likely truncated (rate limit, pagination
      // failure) and clearing syncedFrom would cause mass duplicate creation.
      const remoteExternalIds = new Set(remotePlaylists.map(p => p.externalId));
      const localSyncedFromProvider = currentPlaylists.filter(p => p.syncedFrom?.resolver === providerId);
      const missingCount = localSyncedFromProvider.filter(p => !remoteExternalIds.has(p.syncedFrom.externalId)).length;
      const tooManyMissing = localSyncedFromProvider.length > 0 && missingCount > 3 && (missingCount / localSyncedFromProvider.length) > 0.3;

      if (tooManyMissing) {
        console.warn(`[Sync] Skipping syncedFrom clearing: ${missingCount}/${localSyncedFromProvider.length} playlists missing from ${providerId} remote response (likely incomplete API response)`);
      } else {
        for (let j = 0; j < currentPlaylists.length; j++) {
          const p = currentPlaylists[j];
          if (p.syncedFrom?.resolver === providerId && !remoteExternalIds.has(p.syncedFrom.externalId)) {
            console.log(`[Sync] Playlist "${p.title}" no longer on ${providerId}, clearing syncedFrom so it can be re-pushed`);
            currentPlaylists[j] = { ...p, syncedFrom: null };
          }
        }
      }

      // Save playlists (including any that succeeded before a failure)
      store.set('local_playlists', currentPlaylists);
      results.playlists = { added: playlistsAdded, updated: playlistsUpdated, failed: playlistsFailed };
      console.log(`[Sync] Playlists synced: ${playlistsAdded} added, ${playlistsUpdated} with updates${playlistsFailed > 0 ? `, ${playlistsFailed} failed` : ''}`);
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
      r && ((r.added || 0) > 0 || (r.removed || 0) > 0 || (r.updated || 0) > 0)
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
