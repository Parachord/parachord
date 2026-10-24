// src/renderer/lib/playlist-share.js — the ListenBrainz playlist MBID a
// playlist share link is keyed on.
//
// Achordion keys its playlist links on the ListenBrainz playlist MBID, which
// lives in a playlist's sync fields (syncedTo.listenbrainz, or syncedFrom when
// the playlist was imported from ListenBrainz). The share entry points hand
// publishCollectionSmartLink a display summary (title, creator, cover, track
// list) rather than the playlist itself, so the sync fields were never there
// and every share ended at "Sync this playlist to ListenBrainz first", even for
// a synced playlist (parachord#1084). The summary carries the playlist's id;
// the stored playlist supplies the fields.

function lbMbidOf(p) {
  if (!p) return null;
  return (p.syncedTo && p.syncedTo.listenbrainz && p.syncedTo.listenbrainz.externalId)
    || (p.syncedFrom && p.syncedFrom.resolver === 'listenbrainz' && p.syncedFrom.externalId)
    || null;
}

function playlistListenbrainzMbid(summary, playlists) {
  const own = lbMbidOf(summary);
  if (own) return own;
  const id = summary && (summary.playlistId || summary.id);
  if (!id || !Array.isArray(playlists)) return null;
  return lbMbidOf(playlists.find(p => p && p.id === id));
}

module.exports = { playlistListenbrainzMbid };
