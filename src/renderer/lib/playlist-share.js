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

// What a share should do. A link to a playlist that's gone from ListenBrainz
// 404s for everyone, its owner included, and the sync record can't tell us: it
// only learns on the next push, which may be months away. So ask first.
//
// checkExists(mbid) answers true, false, or null for "couldn't tell". Only a
// clear false stops the share: being offline or rate limited shouldn't.
async function playlistShareTarget(summary, playlists, checkExists) {
  const mbid = playlistListenbrainzMbid(summary, playlists);
  if (!mbid) return { status: 'not-synced' };
  const id = summary && (summary.playlistId || summary.id);
  const stored = id && Array.isArray(playlists) ? playlists.find(p => p && p.id === id) : null;
  const mirror = (stored || summary)?.syncedTo?.listenbrainz;
  if (mirror?.pendingAction === 'remote-deleted') return { status: 'gone' };
  let exists = null;
  try {
    exists = checkExists ? await checkExists(mbid) : null;
  } catch {
    exists = null;
  }
  return exists === false ? { status: 'gone' } : { status: 'ok', mbid };
}

module.exports = { playlistListenbrainzMbid, playlistShareTarget };
