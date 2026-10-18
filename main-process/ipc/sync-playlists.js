// main-process/ipc/sync-playlists.js — the remaining sync IPC surface:
// fetch-playlists / fetch-playlist-tracks / push-playlist /
// cleanup-duplicate-playlists / relink-orphaned-playlists /
// save-remove tracks & albums / tombstone batch IPC / follow-unfollow artists,
// plus the shared getSyncProviderToken helper. Extracted from main.js
// (maintainability plan Track 3, sync slice 4 — the final sync slice).
//
// Not a verbatim move in three spots, all mechanical:
//  - the MusicKit generated-token wait (if (!generatedMusicKitToken) await
//    musicKitTokenReady) appeared across these handlers; it is now the
//    injected awaitGeneratedMusicKitToken() — the developerToken lines are
//    untouched.
//  - getSyncProviderToken reads the CURRENT generated token synchronously with
//    no generation wait (its callers rely on sync); that read is the injected
//    readGeneratedMusicKitToken(). Do NOT make getSyncProviderToken async —
//    callers treat its return as a value, and a Promise is truthy.
//  - buildLocalPlaylistMirrorContext / pushPlaylistLinksToAchordion go
//    through the injected achordion object.
//
// channelOverrideExcludes + Tombstones import directly from sync-engine
// (pure, jest-covered). Tests: tests/main-process/sync-playlists-ipc.test.js.

const Tombstones = require('../../sync-engine/tombstones');
const { channelOverrideExcludes } = require('../../sync-engine/playlist-push-candidate');

function registerSyncPlaylistsIpc({
  ipcMain,
  SyncEngine,
  store,
  ensureValidSpotifyToken,
  awaitGeneratedMusicKitToken,
  readGeneratedMusicKitToken,
  lbHydrationOpts,
  getChannelOverride,
  legacyPlaylistSyncEnabled,
  relinkOrphansFor,
  removePlaylistSyncState,
  buildAppleMusicRefreshCb,
  deleteRemotePlaylistBestEffort,
  achordion,
  syncLinks,
}) {
  const { getSyncLinks, setSyncLink, removeSyncLink } = syncLinks;

ipcMain.handle('sync:fetch-playlists', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  let token;
  let refreshTokenCb = null;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
    refreshTokenCb = async () => {
      const newToken = await ensureValidSpotifyToken(true);
      if (newToken) token = newToken;
      return newToken;
    };
  } else if (providerId === 'applemusic') {
    const generatedMusicKitToken = await awaitGeneratedMusicKitToken();
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

  try {
    const { playlists, folders } = await provider.fetchPlaylists(token, null, refreshTokenCb);
    return { success: true, playlists, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync:fetch-playlist-tracks', async (event, providerId, playlistExternalId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  let token;
  let refreshTokenCb = null;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
    refreshTokenCb = async () => {
      const newToken = await ensureValidSpotifyToken(true);
      if (newToken) token = newToken;
      return newToken;
    };
  } else if (providerId === 'applemusic') {
    const generatedMusicKitToken = await awaitGeneratedMusicKitToken();
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

  // For Spotify, check that the token has the scopes needed for playlist access.
  if (providerId === 'spotify') {
    const grantedScopes = store.get('spotify_token_scopes');
    if (grantedScopes) {
      const requiredScopes = ['playlist-read-private'];
      const missing = requiredScopes.filter(s => !grantedScopes.includes(s));
      if (missing.length > 0) {
        console.log(`[Sync] Token missing required scopes for playlist pull: ${missing.join(', ')}. Prompting re-auth.`);
        return {
          success: false,
          error: 'Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions.',
          errorCode: 'missing_scopes'
        };
      }
    } else {
      console.log('[Sync] No stored scopes found (legacy auth). Prompting re-auth.');
      return {
        success: false,
        error: 'Your Spotify connection needs to be refreshed. Please disconnect and reconnect Spotify in Settings.',
        errorCode: 'missing_scopes'
      };
    }
  }

  try {
    const tracks = await provider.fetchPlaylistTracks(playlistExternalId, token, null, refreshTokenCb);
    // Also fetch the current snapshot ID
    const snapshotId = await provider.getPlaylistSnapshot?.(playlistExternalId, token, refreshTokenCb);
    return { success: true, tracks, snapshotId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Push local playlist changes to the sync provider
ipcMain.handle('sync:push-playlist', async (event, providerId, playlistExternalId, tracks, metadata) => {
  // N-way mutual exclusion (parachord#911). In 'new' mode the N-way reconcile
  // owns all remote playlist writes; the legacy push path must not also write,
  // or the two engines fight over the shared remote. This is the authoritative
  // chokepoint (every legacy remote playlist write flows through here) — the
  // renderer push loops also skip earlier, but this catches any other caller.
  if (!legacyPlaylistSyncEnabled()) {
    return { success: true, skipped: 'nway-active' };
  }
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  // CHANNEL gate (defense-in-depth, parachord#911). The renderer EDIT push branch
  // already gates, but this is the actual write path — reverse-look-up the local
  // playlist via the durable link map and refuse to push to a provider the user
  // EXCLUDED from this playlist's channel override. So no caller (or a stale push
  // cycle racing a just-landed disable) can write to an excluded mirror.
  try {
    const links = getSyncLinks();
    const lpId = Object.keys(links).find(id => links[id] && links[id][providerId] && links[id][providerId].externalId === playlistExternalId);
    if (lpId && channelOverrideExcludes(getChannelOverride(lpId), providerId)) {
      console.warn(`[Sync] Blocked push to ${providerId} for "${(metadata && metadata.name) || lpId}" — provider excluded from the playlist's sync channels`);
      return { success: false, error: 'channel-excluded' };
    }
  } catch (e) {
    // Never let the guard's own failure block a legitimate push.
    console.warn('[Sync] channel-gate lookup failed (non-fatal):', e && e.message);
  }

  if (!provider.updatePlaylistTracks) {
    return { success: false, error: 'Provider does not support pushing playlist changes' };
  }

  let token;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
  } else if (providerId === 'applemusic') {
    const generatedMusicKitToken = await awaitGeneratedMusicKitToken();
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

  // For Spotify, check that the token has the scopes needed for playlist modification.
  if (providerId === 'spotify') {
    const grantedScopes = store.get('spotify_token_scopes');
    if (grantedScopes) {
      const requiredScopes = ['playlist-modify-public', 'playlist-modify-private'];
      const hasAny = requiredScopes.some(s => grantedScopes.includes(s));
      if (!hasAny) {
        console.log(`[Sync] Token missing required scopes for playlist push. Prompting re-auth.`);
        return {
          success: false,
          error: 'Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions.',
          errorCode: 'missing_scopes'
        };
      }
    } else {
      console.log('[Sync] No stored scopes found (legacy auth). Prompting re-auth.');
      return {
        success: false,
        error: 'Your Spotify connection needs to be refreshed. Please disconnect and reconnect Spotify in Settings.',
        errorCode: 'missing_scopes'
      };
    }
  }

  try {
    // Check if user owns the playlist (can only push to owned playlists)
    if (provider.checkPlaylistOwnership) {
      const isOwner = await provider.checkPlaylistOwnership(playlistExternalId, token);
      if (!isOwner) {
        return { success: false, error: 'You can only push changes to playlists you own' };
      }
    }

    // Push metadata changes (name, description) if provided.
    // A failure here (e.g. Apple Music's PATCH-is-unsupported 401) must NOT
    // abort the track push — the rename is best-effort, the tracks are the
    // point. Swallow any throw and continue.
    if (metadata && provider.updatePlaylistDetails) {
      try {
        await provider.updatePlaylistDetails(playlistExternalId, metadata, token);
      } catch (detailsErr) {
        console.warn(`[Sync] updatePlaylistDetails failed for ${providerId} playlist ${playlistExternalId}; continuing with track push: ${detailsErr.message}`);
      }
    }

    // Push track changes
    const result = await provider.updatePlaylistTracks(playlistExternalId, tracks, token, lbHydrationOpts(providerId));

    // Fire-and-forget: if this push touched an LB-anchored playlist (either
    // we just pushed to LB, OR the local has an LB mirror via sync_playlist_links),
    // tell Achordion about the playlist's mirror set. Look up the local
    // playlist id by reverse-scanning sync_playlist_links.
    try {
      let localPlaylistId = null;
      const allLinks = getSyncLinks();
      for (const [lpId, byProvider] of Object.entries(allLinks)) {
        if (byProvider?.[providerId]?.externalId === playlistExternalId) {
          localPlaylistId = lpId;
          break;
        }
      }
      const lbInvolved = providerId === 'listenbrainz'
        || (localPlaylistId && allLinks[localPlaylistId]?.listenbrainz?.externalId);
      if (lbInvolved) {
        const ctx = achordion.buildLocalPlaylistMirrorContext({
          localPlaylistId,
          providerId,
          externalId: playlistExternalId,
          name: metadata?.name,
          tracks,
        });
        achordion.pushPlaylistLinksToAchordion(ctx);
      }
    } catch (e) {
      console.warn('[achordion] post-push submit prep failed:', e && e.message ? e.message : e);
    }

    return { success: true, snapshotId: result.snapshotId };
  } catch (error) {
    // Detect remote playlist deletion (404)
    if (error.message?.includes('404') || error.message?.includes('Not Found') || error.status === 404) {
      return { success: false, error: 'PLAYLIST_NOT_FOUND', message: 'The remote playlist no longer exists' };
    }
    return { success: false, error: error.message };
  }
});

  // Clean up duplicate playlists on a sync provider
  // Groups remote playlists by name and deletes duplicates, keeping the best one
  // (most tracks, or most recently modified as tiebreaker)
ipcMain.handle('sync:cleanup-duplicate-playlists', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }
  if (!provider.deletePlaylist) {
    return { success: false, error: 'Provider does not support playlist deletion' };
  }

  let token;
  let refreshTokenCb = null;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
    refreshTokenCb = async () => {
      const newToken = await ensureValidSpotifyToken(true);
      if (newToken) token = newToken;
      return newToken;
    };
  } else if (providerId === 'applemusic') {
    const generatedMusicKitToken = await awaitGeneratedMusicKitToken();
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    }
    // Apple Music token refresh: try to fetch a fresh user token via the
    // native MusicKit bridge when a 401 occurs (expired user token).
    refreshTokenCb = buildAppleMusicRefreshCb(token, (newToken) => { token = newToken; });
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Fetch all remote playlists
    const { playlists } = await provider.fetchPlaylists(token, null, refreshTokenCb);
    if (!playlists || playlists.length === 0) {
      return { success: true, deleted: 0, groups: [] };
    }

    // Only consider user-owned playlists (don't delete followed/collaborative ones)
    const ownedPlaylists = playlists.filter(p => p.isOwnedByUser !== false);

    // ----------------------------------------------------------------
    // Step 1: Relink orphaned locals first.
    //
    // A local playlist that should be linked to a remote but has lost
    // its syncedTo (through old bugs, crashes, save-path regressions)
    // looks "unlinked" to keeper selection below — we'd pick the
    // wrong keeper based on fallback heuristics. Relinking restores
    // those links so the keeper-selection correctly prefers the copy
    // the user's local is actually synced with.
    //
    // Relink only acts on unambiguous 1:1 name matches. If a local
    // name has multiple remote candidates (the very case cleanup is
    // about to collapse), relink skips and marks ambiguous — keeper
    // selection's link-awareness still falls back to fallback-sort
    // for that group, which is the best we can do when no local
    // reference disambiguates.
    // ----------------------------------------------------------------
    const relinkResult = relinkOrphansFor(providerId, ownedPlaylists);

    // ----------------------------------------------------------------
    // Step 1b: Repair linked-but-empty remotes.
    //
    // Before the relink-sets-locallyModified fix, orphan relink would
    // write syncedTo without flagging the playlist as modified. The
    // push loop needs locallyModified=true to push track content, so
    // those already-linked playlists would stay empty on the remote
    // indefinitely. Detect that state here and flag for push on the
    // next sync. Covers users recovering from a pre-fix cleanup run.
    // ----------------------------------------------------------------
    const remoteByExternalId = new Map(
      ownedPlaylists.map(p => [p.externalId, p])
    );
    const repairLocal = store.get('local_playlists') || [];
    let repairedCount = 0;
    const repairedLocal = repairLocal.map(p => {
      const link = p.syncedTo?.[providerId];
      if (!link?.externalId) return p;
      if (p.locallyModified) return p; // already flagged
      if (!(p.tracks?.length > 0)) return p; // nothing to push
      const remote = remoteByExternalId.get(link.externalId);
      if (!remote) return p; // remote is gone; different problem (pendingAction handles elsewhere)
      if ((remote.trackCount || 0) > 0) return p; // remote isn't empty; don't trigger a push
      repairedCount++;
      return {
        ...p,
        locallyModified: true,
        lastModified: Date.now()
      };
    });
    if (repairedCount > 0) {
      store.set('local_playlists', repairedLocal);
      console.log(`[Sync Cleanup] Flagged ${repairedCount} locally-tracked playlist(s) as modified (linked to empty remote — will populate on next sync)`);
    }

    // ----------------------------------------------------------------
    // Step 1d: Remove #937 RE-IMPORT duplicates (per #911). A followed
    // Spotify playlist legitimately mirrors to an owned LB copy E; before the
    // link-map import match (#941), a same-cycle LB import re-imported E as a
    // SEPARATE listenbrainz-E local playlist that re-exported into owned
    // Spotify/AM duplicates. Run on the ListenBrainz cleanup (its natural
    // home): delete the owned re-export remotes + remove the redundant local
    // re-import rows. The follower's real LB mirror E is KEPT.
    // ----------------------------------------------------------------
    let reimportDupesRemoved = 0;
    const reimportDupesManual = [];
    if (providerId === 'listenbrainz') {
      try {
        const { findReimportDuplicates } = require('../../sync-engine/follower-cleanup');
        const { dupes } = findReimportDuplicates(store.get('local_playlists') || []);
        for (const d of dupes) {
          for (const r of d.reexports) {
            const res = await deleteRemotePlaylistBestEffort(r.providerId, r.externalId);
            if (!res.deleted && res.reason === 'unsupported') {
              const lbl = { spotify: 'Spotify', applemusic: 'Apple Music', listenbrainz: 'ListenBrainz' }[r.providerId] || r.providerId;
              reimportDupesManual.push(`"${d.displayName}" (${lbl})`);
            }
          }
        }
        if (dupes.length) {
          const removeIds = new Set(dupes.map((d) => d.localId));
          const before = store.get('local_playlists') || [];
          store.set('local_playlists', before.filter((p) => p && !removeIds.has(p.id)));
          for (const id of removeIds) {
            for (const pid of ['spotify', 'applemusic', 'listenbrainz']) { removeSyncLink(id, pid); removePlaylistSyncState(id, pid); }
          }
          reimportDupesRemoved = dupes.length;
          console.log(`[Sync Cleanup] #937: removed ${reimportDupesRemoved} re-import duplicate playlist(s) + their owned re-exports`);
        }
      } catch (e) {
        console.warn('[Sync Cleanup] re-import-dupe phase failed (non-fatal):', e && e.message);
      }
    }

    // Group by normalized name
    const groups = {};
    for (const playlist of ownedPlaylists) {
      const key = (playlist.name || '').trim().toLowerCase();
      if (!groups[key]) groups[key] = [];
      groups[key].push(playlist);
    }

    // Find groups with duplicates
    const duplicateGroups = Object.entries(groups).filter(([, items]) => items.length > 1);
    if (duplicateGroups.length === 0) {
      return {
        success: true,
        deleted: 0,
        unsupported: 0,
        unsupportedManualRemoval: [],
        groups: [],
        ambiguous: [],
        relinked: relinkResult.linked,
        relinkAmbiguous: relinkResult.ambiguous,
        orphanCount: relinkResult.orphanCount,
        repairedEmptyLinks: repairedCount,
        relinkedFromShell: 0,
        reimportDupesRemoved,
        reimportDupesManual
      };
    }

    // ----------------------------------------------------------------
    // Step 2: Build a map of which externalIds in the duplicate groups
    // are referenced by local playlists (via syncedTo, syncedFrom, OR
    // the sync_playlist_links map). This drives keeper selection: we
    // keep the remote that the user's locals are actually linked to,
    // so nobody gets silently re-pointed to a different copy.
    //
    // Note: we re-read local_playlists and links AFTER relink ran so
    // we see the just-written links.
    // ----------------------------------------------------------------
    const groupExternalIds = new Set();
    for (const [, items] of duplicateGroups) {
      for (const item of items) groupExternalIds.add(item.externalId);
    }

    const localPlaylists = store.get('local_playlists') || [];
    const allLinks = getSyncLinks();

    // Map: externalId -> set of localPlaylistIds referencing it.
    // Using a Set dedupes the case where one local has both syncedTo
    // and syncedFrom pointing at the same remote.
    const localsByExternalId = new Map();
    const addLink = (externalId, localId) => {
      if (!externalId || !localId) return;
      if (!groupExternalIds.has(externalId)) return;
      if (!localsByExternalId.has(externalId)) localsByExternalId.set(externalId, new Set());
      localsByExternalId.get(externalId).add(localId);
    };
    for (const local of localPlaylists) {
      addLink(local.syncedTo?.[providerId]?.externalId, local.id);
      if (local.syncedFrom?.resolver === providerId) {
        addLink(local.syncedFrom.externalId, local.id);
      }
    }
    for (const [localId, providers] of Object.entries(allLinks)) {
      addLink(providers[providerId]?.externalId, localId);
    }

    // ----------------------------------------------------------------
    // For each duplicate group, pick a keeper. Preference order:
    //   1. The remote that locals are actually linked to.
    //   2. If multiple remotes in the group have distinct locals
    //      linked (ambiguous — two locals think they own different
    //      copies), skip the group entirely and surface a warning.
    //   3. Otherwise (no locals linked anywhere in the group), fall
    //      back to most-tracks then most-recent-snapshot.
    // ----------------------------------------------------------------
    const cleanableGroups = [];
    const ambiguousGroups = [];

    for (const [name, items] of duplicateGroups) {
      const linkedMembers = items.filter(p => localsByExternalId.has(p.externalId));

      if (linkedMembers.length > 1) {
        // Two or more remotes in this group are each referenced by at
        // least one local. Collapsing them would silently re-point a
        // local to a different playlist's content. Require manual
        // resolution.
        ambiguousGroups.push({
          name,
          linkedMembers: linkedMembers.map(m => ({
            externalId: m.externalId,
            trackCount: m.trackCount || 0,
            localIds: [...localsByExternalId.get(m.externalId)]
          }))
        });
        console.warn(`[Sync Cleanup] Skipping ambiguous group "${name}": ${linkedMembers.length} copies each have local references. User must resolve manually.`);
        continue;
      }

      let keeper;
      let relinkFrom = null; // when we override a linked empty keeper, remember the original external id so we can relink locals
      if (linkedMembers.length === 1) {
        const linked = linkedMembers[0];
        const linkedIsEmpty = (linked.trackCount || 0) === 0;
        // Populated alternatives in the group (not the linked member).
        const populatedAlternatives = items.filter(p => p.externalId !== linked.externalId && (p.trackCount || 0) > 0);
        if (linkedIsEmpty && populatedAlternatives.length > 0) {
          // Linked remote is an empty shell (typically left behind by an
          // earlier buggy relink that never populated it). A populated
          // alternative in the same group is almost certainly what the
          // user actually wants to keep. Pick the richest populated one,
          // and flag that locals linked to the empty shell should be
          // relinked to the new keeper.
          populatedAlternatives.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0));
          keeper = populatedAlternatives[0];
          relinkFrom = linked.externalId;
          console.log(`[Sync Cleanup] Group "${name}": linked remote ${linked.externalId} is empty; preferring populated alternative ${keeper.externalId} (${keeper.trackCount} tracks) and relinking ${localsByExternalId.get(linked.externalId).size} local(s).`);
        } else {
          keeper = linked;
        }
      } else {
        const sorted = [...items].sort((a, b) => {
          if ((b.trackCount || 0) !== (a.trackCount || 0)) {
            return (b.trackCount || 0) - (a.trackCount || 0);
          }
          return (b.snapshotId || '').localeCompare(a.snapshotId || '');
        });
        keeper = sorted[0];
      }

      const toDelete = items.filter(p => p.externalId !== keeper.externalId);
      cleanableGroups.push({ name, keeper, toDelete, relinkFrom });
    }

    // ----------------------------------------------------------------
    // Perform deletions. The keeper selection above guarantees that
    // no local is currently pointing at any of the toDelete ids (when
    // a local pointed at a group member, that member became the
    // keeper), so there's nothing to relink afterwards. We still prune
    // the link map defensively, in case of split-brain between
    // syncedTo and sync_playlist_links.
    // ----------------------------------------------------------------
    let totalDeleted = 0;
    let totalUnsupported = 0;
    const deletedGroups = [];
    const deletedExternalIds = new Set();
    const unsupportedManualRemoval = []; // remotes the provider couldn't delete

    for (const { keeper, toDelete } of cleanableGroups) {
      for (const dup of toDelete) {
        try {
          const result = await provider.deletePlaylist(dup.externalId, token, refreshTokenCb);
          if (result?.success) {
            totalDeleted++;
            deletedExternalIds.add(dup.externalId);
            console.log(`[Sync Cleanup] Deleted duplicate "${dup.name}" (${dup.externalId}, ${dup.trackCount || 0} tracks) — keeping ${keeper.externalId} (${keeper.trackCount || 0} tracks)`);
          } else if (result?.reason === 'endpoint-unsupported') {
            // Provider doesn't support DELETE on its public API (Apple
            // Music). Track so we can surface "manually remove these"
            // guidance; don't treat as failure — the local relink
            // phase still produces correct local state.
            totalUnsupported++;
            unsupportedManualRemoval.push({
              name: dup.name,
              externalId: dup.externalId,
              trackCount: dup.trackCount || 0
            });
            console.log(`[Sync Cleanup] Cannot delete "${dup.name}" (${dup.externalId}) via ${providerId} public API; user must remove manually`);
          } else {
            console.warn(`[Sync Cleanup] Unexpected deletePlaylist result for "${dup.name}":`, result);
          }
          if (provider.getRateLimitDelay) {
            await new Promise(r => setTimeout(r, provider.getRateLimitDelay()));
          }
        } catch (err) {
          console.warn(`[Sync Cleanup] Failed to delete "${dup.name}" (${dup.externalId}): ${err.message}`);
        }
      }
      deletedGroups.push({
        name: keeper.name,
        kept: { externalId: keeper.externalId, trackCount: keeper.trackCount || 0 },
        deleted: toDelete.length
      });
    }

    // ----------------------------------------------------------------
    // Relink locals whose keeper was overridden from an empty shell to
    // a populated alternative. Any local whose syncedTo[provider]
    // points at the old empty shell gets repointed at the new keeper.
    // Also update the sync_playlist_links map. Set locallyModified to
    // false since local's tracks don't match the new remote's tracks
    // (the new keeper was already populated independently) — leaving
    // it as-is would push local content over the richer remote copy.
    // ----------------------------------------------------------------
    const relinkOverrides = cleanableGroups
      .filter(g => g.relinkFrom && g.relinkFrom !== g.keeper.externalId)
      .map(g => ({ from: g.relinkFrom, to: g.keeper.externalId, keeperName: g.keeper.name, keeperSnapshot: g.keeper.snapshotId || null }));
    let relinkedFromOverride = 0;
    if (relinkOverrides.length > 0) {
      const latestLocal = store.get('local_playlists') || [];
      const overrideMap = new Map(relinkOverrides.map(o => [o.from, o]));
      const now = Date.now();
      const updatedLocal = latestLocal.map(p => {
        const link = p.syncedTo?.[providerId];
        if (!link?.externalId) return p;
        const override = overrideMap.get(link.externalId);
        if (!override) return p;
        relinkedFromOverride++;
        return {
          ...p,
          locallyModified: false,
          syncedTo: {
            ...p.syncedTo,
            [providerId]: {
              ...link,
              externalId: override.to,
              snapshotId: override.keeperSnapshot,
              syncedAt: now,
              pendingAction: null
            }
          }
        };
      });
      if (relinkedFromOverride > 0) {
        store.set('local_playlists', updatedLocal);
        // Mirror the change into the sync_playlist_links map so the
        // durable link survives any renderer-side save that might strip
        // syncedTo.
        for (const p of updatedLocal) {
          const link = p.syncedTo?.[providerId];
          if (link?.externalId && overrideMap.has(relinkOverrides.find(o => o.to === link.externalId)?.from)) {
            setSyncLink(p.id, providerId, link.externalId);
          }
        }
        console.log(`[Sync Cleanup] Relinked ${relinkedFromOverride} local playlist(s) from empty shells to populated keepers`);
      }
    }

    // Defensive cleanup of local refs. Keeper selection makes this a
    // no-op in the common case, but a split-brain between syncedTo and
    // sync_playlist_links could still leave dangling pointers.
    if (deletedExternalIds.size > 0) {
      let localCleaned = 0;
      const updatedLocal = localPlaylists.map(p => {
        if (p.syncedTo?.[providerId] && deletedExternalIds.has(p.syncedTo[providerId].externalId)) {
          const newSyncedTo = { ...p.syncedTo };
          delete newSyncedTo[providerId];
          localCleaned++;
          return { ...p, syncedTo: Object.keys(newSyncedTo).length > 0 ? newSyncedTo : undefined };
        }
        if (p.syncedFrom?.resolver === providerId && deletedExternalIds.has(p.syncedFrom.externalId)) {
          localCleaned++;
          return { ...p, syncedFrom: null };
        }
        return p;
      });
      if (localCleaned > 0) {
        store.set('local_playlists', updatedLocal);
        console.warn(`[Sync Cleanup] Cleaned ${localCleaned} stray local ref(s) to deleted duplicates — this should not happen under normal keeper selection, indicates syncedTo/link-map skew.`);
      }

      let linksCleaned = 0;
      const freshLinks = getSyncLinks();
      for (const [localId, providers] of Object.entries(freshLinks)) {
        const link = providers[providerId];
        if (link?.externalId && deletedExternalIds.has(link.externalId)) {
          removeSyncLink(localId, providerId);
          linksCleaned++;
        }
      }
      if (linksCleaned > 0) {
        console.log(`[Sync Cleanup] Pruned ${linksCleaned} sync-link map entries pointing at deleted duplicates`);
      }
    }

    return {
      success: true,
      deleted: totalDeleted,
      unsupported: totalUnsupported,
      unsupportedManualRemoval,
      groups: deletedGroups,
      ambiguous: ambiguousGroups,
      relinked: relinkResult.linked,
      relinkAmbiguous: relinkResult.ambiguous,
      orphanCount: relinkResult.orphanCount,
      repairedEmptyLinks: repairedCount,
      relinkedFromShell: relinkedFromOverride,
      reimportDupesRemoved,
      reimportDupesManual
    };
  } catch (error) {
    console.error(`[Sync Cleanup] Error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

  // Standalone relink IPC — useful for testing or if we want to expose a
  // separate UI button in the future. Internally, the cleanup handler also
  // runs relinkOrphansFor before picking keepers, so most users won't need
  // to call this directly.
ipcMain.handle('sync:relink-orphaned-playlists', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists || !provider.fetchPlaylists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  let token;
  let refreshTokenCb = null;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
    refreshTokenCb = async () => {
      const newToken = await ensureValidSpotifyToken(true);
      if (newToken) token = newToken;
      return newToken;
    };
  } else if (providerId === 'applemusic') {
    const generatedMusicKitToken = await awaitGeneratedMusicKitToken();
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) token = JSON.stringify({ developerToken, userToken });
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }
  if (!token) return { success: false, error: 'Not authenticated' };

  try {
    const { playlists: remote } = await provider.fetchPlaylists(token, null, refreshTokenCb);
    const ownedRemote = (remote || []).filter(p => p.isOwnedByUser !== false);
    const result = relinkOrphansFor(providerId, ownedRemote);
    return { success: true, ...result };
  } catch (error) {
    console.error(`[Sync Relink] Error: ${error.message}`);
    return { success: false, error: error.message };
  }
});

// Helper: get auth token for a sync provider
function getSyncProviderToken(providerId) {
  if (providerId === 'spotify') {
    return store.get('spotify_token');
  } else if (providerId === 'applemusic') {
    const developerToken = readGeneratedMusicKitToken() || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      return JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    // LB user token lives in the scrobbler-side config, not a separate
    // sync key. See CLAUDE.md "ListenBrainz auth token auto-attach".
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    return cfg.userToken || null;
  }
  return null;
}

// Push track changes to sync provider (add to Liked Songs)
ipcMain.handle('sync:save-tracks', async (event, providerId, trackIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.tracks) {
    return { success: false, error: 'Provider does not support track syncing' };
  }

  if (!provider.saveTracks) {
    return { success: false, error: 'Provider does not support saving tracks' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.saveTracks(trackIds, token);
    return { success: true, saved: result.saved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Save albums to sync provider library
ipcMain.handle('sync:save-albums', async (event, providerId, albumIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.albums) {
    return { success: false, error: 'Provider does not support album syncing' };
  }

  if (!provider.saveAlbums) {
    return { success: false, error: 'Provider does not support saving albums' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.saveAlbums(albumIds, token);
    return { success: true, saved: result.saved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── Track tombstones (parachord#864) ─────────────────────────────
//
// Renderer-side `removeTrackFromCollection` writes tombstones for
// every (providerId, externalId) on the removed track. Renderer-side
// `addTrackToCollection` clears them when the user re-adds a track.
// `sync:start` filters remote items against the tombstone list before
// diffing. App start runs `pruneExpired` once.

ipcMain.handle('sync:tombstones:add-batch', async (event, entries) => {
  try {
    const written = Tombstones.addTombstones(store, entries);
    return { success: true, written };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:tombstones:clear-batch', async (event, entries) => {
  try {
    const cleared = Tombstones.clearTombstones(store, entries);
    return { success: true, cleared };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:tombstones:list', async () => {
  return store.get(Tombstones.TOMBSTONE_KEY) || {};
});

// Remove tracks from sync provider library
ipcMain.handle('sync:remove-tracks', async (event, providerId, trackIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.tracks) {
    return { success: false, error: 'Provider does not support track syncing' };
  }

  if (!provider.removeTracks) {
    return { success: false, error: 'Provider does not support removing tracks' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.removeTracks(trackIds, token);
    return { success: true, removed: result.removed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Remove albums from sync provider library
ipcMain.handle('sync:remove-albums', async (event, providerId, albumIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.albums) {
    return { success: false, error: 'Provider does not support album syncing' };
  }

  if (!provider.removeAlbums) {
    return { success: false, error: 'Provider does not support removing albums' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.removeAlbums(albumIds, token);
    return { success: true, removed: result.removed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Follow artists on sync provider
ipcMain.handle('sync:follow-artists', async (event, providerId, artistIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.artists) {
    return { success: false, error: 'Provider does not support artist syncing' };
  }

  if (!provider.followArtists) {
    return { success: false, error: 'Provider does not support following artists' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.followArtists(artistIds, token);
    return { success: true, followed: result.followed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Unfollow artists on sync provider
ipcMain.handle('sync:unfollow-artists', async (event, providerId, artistIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.artists) {
    return { success: false, error: 'Provider does not support artist syncing' };
  }

  if (!provider.unfollowArtists) {
    return { success: false, error: 'Provider does not support unfollowing artists' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.unfollowArtists(artistIds, token);
    return { success: true, unfollowed: result.unfollowed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

}
module.exports = { registerSyncPlaylistsIpc };
