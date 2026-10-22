// main-process/ipc/sync-create.js — the remote-playlist create/link gateway
// and provider track resolution. Extracted from main.js (maintainability plan
// Track 3, sync slice 2).
//
// sync:create-playlist is the single chokepoint for creating a remote playlist:
// every create passes the three-layer dedup here (durable ID link → syncedTo
// link → name-match fallback), so a renderer save bug can never cause a
// duplicate remote. The invariants are documented in docs/architecture/sync.md
// ("Three-Layer Duplicate Prevention") and the parachord#846 retryable
// fetch-failure handling — do not bypass the getRemotePlaylists gating when
// editing.
//
// Not a verbatim move: the provider token-resolution block was duplicated
// verbatim between sync:create-playlist and sync:resolve-tracks; it is now one
// injected resolveProviderToken(providerId) -> { token, refreshTokenCb } (the
// token clusters stay in main.js). refreshTokenCb refreshes auth.token in
// place so subsequent provider calls in the same handler use the fresh token.
//
// channelGateBlocksCreate / findNonOwnedSourceConflict are imported directly
// from sync-engine/playlist-push-candidate (pure, jest-covered module).
// Everything else is dependency-injected; tests drive the handlers with fakes
// (tests/main-process/sync-create-ipc.test.js).

const { channelGateBlocksCreate, findNonOwnedSourceConflict } = require('../../sync-engine/playlist-push-candidate');

function registerSyncCreateIpc({
  ipcMain,
  SyncEngine,
  legacyPlaylistSyncEnabled,
  getChannelOverride,
  resolveProviderToken,
  lbHydrationOpts,
  achordion,
  syncLinks,
}) {
  const { getSyncLinks, setSyncLink, removeSyncLink } = syncLinks;

// Create a new playlist on a remote service from a local playlist
ipcMain.handle('sync:create-playlist', async (event, providerId, name, description, tracks, localPlaylistId = null) => {
  // N-way mutual exclusion (parachord#911). In 'new' mode N-way owns remote
  // playlist creation; the legacy create gateway stands down so the two
  // engines don't both create remotes for the same local playlist.
  if (!legacyPlaylistSyncEnabled()) {
    return { success: true, skipped: 'nway-active' };
  }
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  if (!provider.createPlaylist) {
    return { success: false, error: 'Provider does not support creating playlists' };
  }

  // CHANNEL gate (defense-in-depth, parachord#911). This gateway is the single
  // create/link chokepoint; the renderer push loops already gate before calling
  // it, but enforcing the channel override / LB opt-in HERE too means no future
  // caller (or side-door) can create a mirror the user didn't choose. Safe: the
  // loops only reach this for channel-allowed playlists, so it never
  // false-blocks a legitimate create.
  if (localPlaylistId && channelGateBlocksCreate({ id: localPlaylistId }, providerId, getChannelOverride(localPlaylistId))) {
    console.warn(`[Sync] Blocked create of "${name}" on ${providerId} — not in the playlist's sync channels`);
    return { success: false, error: 'channel-not-selected' };
  }

  // Provider token resolution lives in main.js (the token clusters); the
  // injected getter returns { token, refreshTokenCb } where refreshTokenCb
  // refreshes auth.token in place, so later provider calls in this handler
  // see the refreshed token.
  const auth = await resolveProviderToken(providerId);
  const { refreshTokenCb } = auth;
  if (!auth.token) {
    return { success: false, error: 'Not authenticated' };
  }

  // Helper: push tracks to an existing remote playlist and return the
  // shape sync:create-playlist would normally return. Used when we link
  // to an existing remote instead of creating.
  const linkToExisting = async (existing, source) => {
    let resolved = tracks;
    let unresolved = [];
    if (provider.resolveTracks) {
      const resolveResult = await provider.resolveTracks(tracks, auth.token, lbHydrationOpts(providerId));
      resolved = resolveResult.resolved;
      unresolved = resolveResult.unresolved;
    }
    let snapshotId = existing.snapshotId;
    if (resolved.length > 0 && provider.updatePlaylistTracks) {
      try {
        const updateResult = await provider.updatePlaylistTracks(existing.externalId, resolved, auth.token, lbHydrationOpts(providerId));
        snapshotId = updateResult.snapshotId || snapshotId;
      } catch (trackError) {
        console.warn(`[Sync] Linked "${name}" to existing ${providerId} playlist but failed to push tracks: ${trackError.message}`);
        unresolved = tracks.map(t => ({ artist: t.artist, title: t.title }));
      }
    }
    // Persist the link on the main-process side too so renderer save bugs
    // can't clobber it.
    if (localPlaylistId) {
      setSyncLink(localPlaylistId, providerId, existing.externalId);
    }
    console.log(`[Sync] Linked "${name}" to existing ${providerId} playlist ${existing.externalId} (via ${source})`);

    // Fire-and-forget Achordion playlist-links submit when LB is involved.
    const lbInvolved = providerId === 'listenbrainz'
      || (localPlaylistId && getSyncLinks()[localPlaylistId]?.listenbrainz?.externalId);
    if (lbInvolved) {
      const ctx = achordion.buildLocalPlaylistMirrorContext({
        localPlaylistId,
        providerId,
        externalId: existing.externalId,
        name,
        tracks,
      });
      achordion.pushPlaylistLinksToAchordion(ctx);
    }

    return {
      success: true,
      externalId: existing.externalId,
      snapshotId,
      unresolvedTracks: unresolved,
      linkedToExisting: true,
      linkSource: source
    };
  };

  try {
    // We fetch the remote playlist list at most once and reuse it for both
    // the ID-based link check and the name-based fallback check.
    let remotePlaylists = null;
    // parachord#846: track whether the fetch actually succeeded. A throwing
    // fetchPlaylists (transient 5xx / 429 / 401, malformed response,
    // network glitch) is indistinguishable from "user genuinely has no
    // playlists" if we just collapse both into an empty array — and the
    // dedup logic below treats "missing from result" as "remote gone,"
    // destroying the durable link AND falling through to create a
    // duplicate. A transient blip would then turn into N permanent
    // duplicates on the user's account. We need to differentiate.
    let remotePlaylistsFetchError = null;
    const getRemotePlaylists = async () => {
      if (remotePlaylists !== null) return remotePlaylists;
      if (!provider.fetchPlaylists) return (remotePlaylists = []);
      try {
        const { playlists } = await provider.fetchPlaylists(auth.token, null, refreshTokenCb);
        remotePlaylists = playlists || [];
      } catch (err) {
        console.warn(`[Sync] Could not fetch remote playlists for dedup check on ${providerId}:`, err.message);
        remotePlaylists = [];
        remotePlaylistsFetchError = err.message || 'unknown error';
      }
      return remotePlaylists;
    };

    // -----------------------------------------------------------------
    // Step 0a: ID-based link check (durable, rename-safe).
    //
    // The sync_playlist_links map is an independent source of truth that
    // survives any renderer-side save bug that might strip syncedTo. If
    // we've previously linked this local playlist to a remote, reuse it —
    // but first verify the remote still exists, to handle cases where the
    // user deleted the playlist on the service between syncs.
    // -----------------------------------------------------------------
    if (localPlaylistId) {
      const existingLink = getSyncLinks()[localPlaylistId]?.[providerId];
      if (existingLink?.externalId) {
        const remote = await getRemotePlaylists();
        if (remotePlaylistsFetchError) {
          // parachord#846: fetch failed. We CANNOT tell whether the linked
          // remote is genuinely gone or whether we just couldn't reach
          // the API right now. Treating "missing from empty result" as
          // "remote deleted" would destroy a still-valid durable link
          // AND fall through to creating a duplicate — that's the
          // runaway-duplication failure mode that produced 6,397 fake
          // playlists on the reporter's LB account. Preserve the link
          // and bail with a retryable failure; the next sync cycle will
          // try again.
          console.warn(`[Sync] ${providerId} fetchPlaylists failed (${remotePlaylistsFetchError}); preserving link for local ${localPlaylistId} → ${existingLink.externalId} and skipping create. Will retry next cycle.`);
          return {
            success: false,
            error: `Could not verify ${providerId} remote playlists: ${remotePlaylistsFetchError}. Link preserved; will retry next cycle.`,
            retryable: true
          };
        }
        const match = remote.find(p => p.externalId === existingLink.externalId && p.isOwnedByUser);
        if (match) {
          return await linkToExisting(match, 'id-link');
        }
        // Link is stale (remote gone) — clear it so we don't keep trying
        // to reuse a dead ID on future syncs. Only reached on a
        // SUCCESSFUL fetch that genuinely doesn't contain this ID.
        console.log(`[Sync] Stored link ${providerId}:${existingLink.externalId} for local ${localPlaylistId} no longer exists remotely; clearing and falling through to create`);
        removeSyncLink(localPlaylistId, providerId);
      }
    }

    // -----------------------------------------------------------------
    // Step 0b: Name-based fallback (last-ditch).
    //
    // Catches cases where the ID link is missing entirely: legacy data
    // that predates sync_playlist_links, or installs where migration
    // hadn't run yet. Matches on trimmed-lowercased name among the
    // user's owned playlists. If several match, the richest one wins.
    // -----------------------------------------------------------------
    const remote = await getRemotePlaylists();
    if (remotePlaylistsFetchError) {
      // parachord#846: same rationale as Step 0a — without a confirmed
      // remote list we cannot decide between "no same-named remote
      // exists" and "we couldn't reach the API." Creating blindly here
      // is the OTHER half of the runaway-duplication failure mode
      // (the half for playlists that don't yet have a sync_playlist_links
      // entry — first-time syncs, post-wizard pushes, etc.). Bail rather
      // than risk a duplicate.
      console.warn(`[Sync] ${providerId} fetchPlaylists failed (${remotePlaylistsFetchError}); skipping name-match + create for "${name}". Will retry next cycle.`);
      return {
        success: false,
        error: `Could not verify ${providerId} remote playlists: ${remotePlaylistsFetchError}. Skipped create; will retry next cycle.`,
        retryable: true
      };
    }
    if (remote.length > 0) {
      const normalized = (name || '').trim().toLowerCase();
      const matches = remote.filter(p => p.isOwnedByUser && (p.name || '').trim().toLowerCase() === normalized);
      if (matches.length > 0) {
        matches.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0));
        return await linkToExisting(matches[0], matches.length > 1 ? `name-match (${matches.length} candidates)` : 'name-match');
      }
    }

    // -----------------------------------------------------------------
    // Step 0c: Non-owned source guard (parachord#950).
    //
    // Never create an OWNED copy of a playlist the user doesn't own. A
    // provider-imported MIRROR row re-exporting to a provider where a
    // FOLLOWED / COLLABORATIVE playlist (isOwnedByUser === false) of the same
    // name already lives is re-exporting someone else's playlist — the owned
    // duplicate the user keeps deleting, which reappears because the non-owned
    // original is permanent (so this also stops the re-creation, no tombstone
    // needed). Only reached on NO owned name-match above, so a playlist the
    // user owns is still reused.
    // -----------------------------------------------------------------
    const nonOwnedConflict = findNonOwnedSourceConflict(localPlaylistId, name, remote);
    if (nonOwnedConflict) {
      console.warn(`[Sync] Not creating "${name}" on ${providerId}: a followed/collaborative playlist of that name already exists (owner ${nonOwnedConflict.ownerId || nonOwnedConflict.ownerName || '?'}) — won't re-export someone else's playlist as an owned copy (parachord#950)`);
      return { success: false, error: 'non-owned-source', skipped: 'non-owned-source' };
    }

    // -----------------------------------------------------------------
    // Step 1: Resolve tracks to provider-specific IDs
    // -----------------------------------------------------------------
    let resolved = tracks;
    let unresolved = [];
    if (provider.resolveTracks) {
      const resolveResult = await provider.resolveTracks(tracks, auth.token, lbHydrationOpts(providerId));
      resolved = resolveResult.resolved;
      unresolved = resolveResult.unresolved;
      console.log(`[Sync] Resolved ${resolved.length}/${tracks.length} tracks for ${providerId} (${unresolved.length} unresolved)`);
    }

    // No-empty-create guard: if the playlist HAS tracks but NONE resolved for
    // this provider, don't create an empty remote (the LB-with-no-MBIDs case
    // that left 0-track playlists behind). Only fires when the provider does
    // real resolution (resolveTracks); LB now does. A genuinely empty local
    // playlist (tracks.length === 0) is not blocked.
    if (provider.resolveTracks && Array.isArray(tracks) && tracks.length > 0 && resolved.length === 0) {
      console.warn(`[Sync] Not creating "${name}" on ${providerId}: 0 of ${tracks.length} tracks resolved — would be an empty remote`);
      return { success: false, error: 'no-resolvable-tracks', unresolvedTracks: unresolved };
    }

    // -----------------------------------------------------------------
    // Step 2: Create the playlist
    // -----------------------------------------------------------------
    const { externalId, snapshotId } = await provider.createPlaylist(name, description, auth.token);
    console.log(`[Sync] Created playlist "${name}" on ${providerId}: ${externalId}`);

    // Record the new link in our durable map immediately — even if Step 3
    // (track push) or the renderer-side syncedTo save fails, the next sync
    // will find this link and avoid a duplicate.
    if (localPlaylistId) {
      setSyncLink(localPlaylistId, providerId, externalId);
    }

    // -----------------------------------------------------------------
    // Step 3: Add tracks — if this fails, the playlist was still created
    // on the provider so we must return success with the externalId.
    // Otherwise syncedTo is never set and the next sync creates a dupe.
    // -----------------------------------------------------------------
    let finalSnapshotId = snapshotId;
    if (resolved.length > 0 && provider.updatePlaylistTracks) {
      try {
        const updateResult = await provider.updatePlaylistTracks(externalId, resolved, auth.token, lbHydrationOpts(providerId));
        finalSnapshotId = updateResult.snapshotId || snapshotId;
      } catch (trackError) {
        console.warn(`[Sync] Playlist "${name}" created on ${providerId} but failed to add tracks: ${trackError.message}`);
        unresolved = tracks.map(t => ({ artist: t.artist, title: t.title }));
      }
    }

    // Fire-and-forget: tell Achordion about this playlist's mirror set if
    // LB is involved. Either the just-created remote IS the LB MBID, or
    // we have a stored LB link for this local playlist via sync_playlist_links.
    const lbInvolved = providerId === 'listenbrainz'
      || (localPlaylistId && getSyncLinks()[localPlaylistId]?.listenbrainz?.externalId);
    if (lbInvolved) {
      const ctx = achordion.buildLocalPlaylistMirrorContext({
        localPlaylistId,
        providerId,
        externalId,
        name,
        tracks,
      });
      // Do NOT await — fire-and-forget.
      achordion.pushPlaylistLinksToAchordion(ctx);
    }

    return {
      success: true,
      externalId,
      snapshotId: finalSnapshotId,
      unresolvedTracks: unresolved
    };
  } catch (error) {
    console.error(`[Sync] Failed to create playlist on ${providerId}:`, error.message);
    return { success: false, error: error.message };
  }
});

// Resolve local tracks to provider-specific IDs
ipcMain.handle('sync:resolve-tracks', async (event, providerId, tracks) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider?.resolveTracks) {
    return { success: false, error: 'Provider does not support track resolution' };
  }

  const auth = await resolveProviderToken(providerId);
  if (!auth.token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.resolveTracks(tracks, auth.token, lbHydrationOpts(providerId));
    return { success: true, resolved: result.resolved, unresolved: result.unresolved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});
}
module.exports = { registerSyncCreateIpc };
