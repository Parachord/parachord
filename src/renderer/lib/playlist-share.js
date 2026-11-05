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

// What a share should do. Sharing is what makes a playlist's visibility matter:
//  - gone: the link 404s for everyone, its owner included. The sync record can't
//    tell us, since it only learns on the next push, which may be months away.
//  - private: the link only opens for the owner, so ask before making it public.
//
// checkStatus(mbid) answers { exists, isPublic }, each null for "couldn't tell".
// Only a clear answer changes anything: being offline or rate limited shouldn't
// stop a share.
async function playlistShareTarget(summary, playlists, checkStatus) {
  const mbid = playlistListenbrainzMbid(summary, playlists);
  if (!mbid) return { status: 'not-synced' };
  const id = summary && (summary.playlistId || summary.id);
  const stored = id && Array.isArray(playlists) ? playlists.find(p => p && p.id === id) : null;
  const mirror = (stored || summary)?.syncedTo?.listenbrainz;
  if (mirror?.pendingAction === 'remote-deleted') return { status: 'gone' };
  let answer = null;
  try {
    answer = checkStatus ? await checkStatus(mbid) : null;
  } catch {
    answer = null;
  }
  if (answer?.exists === false) return { status: 'gone' };
  if (answer?.isPublic === false) return { status: 'private', mbid };
  return { status: 'ok', mbid };
}

// The next step for a playlist that isn't on ListenBrainz. `config` is the
// ListenBrainz scrobbler config, which is where its token lives.
function notSyncedSharePrompt(config) {
  if (!config || !config.userToken) {
    return {
      message: 'Playlist links go through ListenBrainz. Connect your account with a user token to share this playlist.',
      actionLabel: 'Connect ListenBrainz',
      next: 'connect',
    };
  }
  return {
    message: 'Sync this playlist to ListenBrainz first to enable sharing via Achordion.',
    actionLabel: 'Sync Settings',
    next: 'sync',
  };
}

module.exports = { playlistListenbrainzMbid, playlistShareTarget, notSyncedSharePrompt };
