// src/renderer/lib/playlist-sync-banner.js: what the playlist page's sync
// banner shows for an imported playlist, and the open playlist a sync pulled.
//
// The banner used to ask "Pull changes" whenever the source changed. A sync
// now pulls an unedited import by itself (sync-engine/auto-pull.js), so the
// banner has two states left:
//   - push: edited here and waiting to go to the source.
//   - conflict: edited here AND changed on the source. The sync didn't pull,
//     so the edits are kept; the person picks which version wins.
// Both read edits from the tracks-vs-fingerprint rule in auto-pull.js, so a
// conflict stays visible after later syncs move `syncedAt`.
//
// A hosted XSPF never pulls from the service (its XSPF is the upstream), so
// it only shows push, on the timestamp rule it always used, and only for
// your edits: the hosted refresh also flags a change that came from the link
// (locallyModified, so the next sync sends it to the mirrors), and tracks
// that match the link's own tracklist (linkTracksFingerprint, recorded on
// every poll) are the link's, not yours. The banner said "You changed this
// playlist" after a feed update (2026-11-22).
//
// Pure, no React, loads under plain Node.

const { hasRealLocalEdits, isHostedXspf, tracksFingerprint } = require('../../../sync-engine/auto-pull');

// { state: 'push' | 'conflict', localIsNewer } or null for no banner.
function syncBannerState(playlist) {
  if (!playlist || !playlist.syncedFrom) return null;
  const provider = playlist.syncedFrom.resolver;
  const sourceSyncedAt = (playlist.syncSources && playlist.syncSources[provider] && playlist.syncSources[provider].syncedAt) || 0;
  const localIsNewer = (playlist.lastModified || 0) > sourceSyncedAt;

  if (isHostedXspf(playlist)) {
    if (typeof playlist.linkTracksFingerprint === 'string'
      && tracksFingerprint(playlist.tracks) === playlist.linkTracksFingerprint) return null;
    return playlist.locallyModified && localIsNewer ? { state: 'push', localIsNewer } : null;
  }
  if (!hasRealLocalEdits(playlist, provider)) return null;
  if (playlist.hasUpdates) return { state: 'conflict', localIsNewer };
  // Dismiss clears locallyModified: the push offer goes away, and the edits
  // stay protected from a pull by the fingerprint.
  return playlist.locallyModified ? { state: 'push', localIsNewer } : null;
}

// The stored record for the open playlist when a sync pulled it (its source
// snapshot moved and its tracks differ from the open view's), else null.
function pulledOpenPlaylist(selected, loadedPlaylists) {
  if (!selected || !selected.id || !Array.isArray(loadedPlaylists)) return null;
  const stored = loadedPlaylists.find((p) => p && p.id === selected.id);
  if (!stored || !stored.syncedFrom) return null;
  const before = selected.syncedFrom && selected.syncedFrom.snapshotId;
  if (stored.syncedFrom.snapshotId === before) return null;
  if (tracksFingerprint(stored.tracks) === tracksFingerprint(selected.tracks)) return null;
  return stored;
}

module.exports = { syncBannerState, pulledOpenPlaylist };
