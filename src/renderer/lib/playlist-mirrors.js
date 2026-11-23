// src/renderer/lib/playlist-mirrors.js: the remote copies of a playlist (its
// source and push mirrors) that deleting it could clean up, and the names
// shown for them. Pure; app.js's delete flow and the delete dialog share it.

const PROVIDER_LABEL = { spotify: 'Spotify', applemusic: 'Apple Music', listenbrainz: 'ListenBrainz' };

// Returns [{ providerId, externalId, role }], role 'source' or 'mirror'.
function getPlaylistMirrorTargets(playlist) {
  if (!playlist) return [];
  const out = [];
  if (playlist.syncedFrom?.resolver && playlist.syncedFrom?.externalId) {
    out.push({ providerId: playlist.syncedFrom.resolver, externalId: playlist.syncedFrom.externalId, role: 'source' });
  }
  for (const [pid, info] of Object.entries(playlist.syncedTo || {})) {
    if (info?.externalId) out.push({ providerId: pid, externalId: info.externalId, role: 'mirror' });
  }
  return out;
}

// The services a playlist pushes to, for the playlist page's "where it syncs"
// badges (#1640): its syncedTo providers, except the one it's pulled from,
// whose "Source: X" line already says it (a source that's also pushed back to
// is the source, not a mirror). A pulled playlist with mirrors used to show no
// badge at all. Mobile's rule: PlaylistOrigin.pushMirrors.
function pushMirrors(playlist) {
  if (!playlist || !playlist.syncedTo) return [];
  const source = playlist.syncedFrom && playlist.syncedFrom.resolver;
  return Object.keys(playlist.syncedTo).filter((pid) => pid !== source && playlist.syncedTo[pid]);
}

module.exports = { PROVIDER_LABEL, getPlaylistMirrorTargets, pushMirrors };
