// Corrected #937 cleanup, aligned with the #911 per-copy-writable contract.
//
// A FOLLOWED Spotify playlist legitimately mirrors out to an owned ListenBrainz
// copy (externalId E) — that mirror is NOT wreckage. The wreckage is what a
// same-cycle LB import-all created BEFORE the link-map import match (PR #941):
// a SEPARATE owned `listenbrainz-E` local playlist (a redundant re-import of E),
// which then re-exported into owned Spotify / Apple Music duplicates.
//
// So the cleanup targets the redundant re-import rows and the owned streaming
// copies they spawned — and explicitly KEEPS the follower's real LB mirror E.
// PURE — no electron, no fetch.

// A read-only follower: imported (`source` ends `-import`) and NOT a collaborator
// (collaborators can write back, so they own their copies legitimately).
function isReadOnlyFollower(pl) {
  if (!pl) return false;
  const src = typeof pl.source === 'string' ? pl.source : '';
  if (!src.endsWith('-import')) return false;
  return !(pl.syncedFrom && pl.syncedFrom.isCollaborator === true);
}

// The ListenBrainz external id a local row represents, if it's LB-origin.
function lbExternalIdOf(pl) {
  if (pl && pl.syncedFrom && pl.syncedFrom.resolver === 'listenbrainz' && pl.syncedFrom.externalId) {
    return pl.syncedFrom.externalId;
  }
  if (pl && typeof pl.id === 'string' && pl.id.startsWith('listenbrainz-')) {
    return pl.id.slice('listenbrainz-'.length);
  }
  return null;
}

function findReimportDuplicates(localPlaylists) {
  const playlists = Array.isArray(localPlaylists) ? localPlaylists : [];

  // E -> followerLocalId, from each read-only follower's LB mirror link.
  const followerLbMirror = new Map();
  for (const pl of playlists) {
    if (!isReadOnlyFollower(pl)) continue;
    const e = pl.syncedTo && pl.syncedTo.listenbrainz && pl.syncedTo.listenbrainz.externalId;
    if (e) followerLbMirror.set(e, pl.id);
  }

  const dupes = [];
  for (const pl of playlists) {
    if (!pl) continue;
    const lbExt = lbExternalIdOf(pl);
    if (!lbExt) continue;
    const followerId = followerLbMirror.get(lbExt);
    // Only a SEPARATE row (not the follower itself) that re-imports the
    // follower's LB mirror is a duplicate.
    if (!followerId || followerId === pl.id) continue;

    // Its owned re-export remotes (the visible Spotify/AM duplicates). NEVER the
    // listenbrainz mirror — that's the follower's legitimate copy.
    const reexports = [];
    for (const [pid, st] of Object.entries(pl.syncedTo || {})) {
      if (pid === 'listenbrainz') continue;
      if (st && st.externalId) reexports.push({ providerId: pid, externalId: st.externalId });
    }
    dupes.push({
      localId: pl.id,
      displayName: pl.title || pl.name || pl.id,
      lbExternalId: lbExt,
      followerId,
      reexports,
    });
  }

  return { dupes, reexportCount: dupes.reduce((n, d) => n + d.reexports.length, 0) };
}

module.exports = { isReadOnlyFollower, lbExternalIdOf, findReimportDuplicates };
