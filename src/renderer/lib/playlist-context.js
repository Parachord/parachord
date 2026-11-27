// src/renderer/lib/playlist-context.js — the playback context for a playlist,
// and the playlist the queue's context bar ("Playing from …") reopens.
//
// A saved playlist is found again by id in `playlists`. An ephemeral one (a
// ListenBrainz Weekly Jams / Weekly Exploration, a service's recommended
// playlist) is in no list, so the bar's click found nothing and only closed
// the drawer. The context now carries a slim reference to it: the fields
// loadPlaylist needs to open and refetch it, never its tracks, because the
// context is copied onto every queued track and persisted with the queue
// (`saved_playback_context`, `saved_queue`). No functions either: a
// recommended playlist's `fetchTracks` can't cross the store's IPC. So a
// reference reopens by what it does keep: a ListenBrainz id (loadPlaylist's
// ListenBrainz branch), or the playlist's link, `sourceUrl`, whose tracks
// loadPlaylist looks up again through the plug-in registry (withLinkFetch,
// #1653: "Playing from" a service's recommended playlist only closed the
// drawer). A reference with neither falls back to Recommendations.
//
// Pure, no React, loads under plain Node.

const REF_FIELDS = [
  'id', 'title', 'creator', 'description', 'source', 'sourceUrl',
  'listenbrainzId', 'weekLabel', 'date', 'isExternal', 'isEphemeral'
];

// The reopenable reference for an ephemeral playlist; undefined for a saved one.
// The cover the playlist was shown with rides along when it's a web link
// (the reopened view shows the same image); never a data URI, which would
// be copied onto every queued track.
const isWebLink = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);

function playlistRef(playlist) {
  if (!playlist || !playlist.isEphemeral) return undefined;
  const ref = { tracks: [], tracksLoaded: false };
  for (const key of REF_FIELDS) {
    if (playlist[key] !== undefined) ref[key] = playlist[key];
  }
  if (isWebLink(playlist.coverArt)) ref.coverArt = playlist.coverArt;
  return ref;
}

// The playback context for playing from a playlist's page.
function playlistPlaybackContext(playlist) {
  const ref = playlistRef(playlist);
  return {
    type: 'playlist',
    id: playlist ? playlist.id : undefined,
    name: playlist ? playlist.title : undefined,
    ...(ref ? { playlist: ref } : {})
  };
}

// The link a recommended playlist's tracks are looked up from again: an
// ephemeral playlist's own web link, when it isn't a ListenBrainz one (those
// reload by id).
const reloadLink = (ref) => (ref && ref.isEphemeral && !ref.listenbrainzId && isWebLink(ref.sourceUrl) ? ref.sourceUrl : null);

// Whether a reference can load its tracks again: by ListenBrainz id
// (loadPlaylist's ListenBrainz branch) or by its link (withLinkFetch).
const canReload = (ref) => !!ref && !!ref.id && (!!ref.listenbrainzId || !!reloadLink(ref));

// A reference reopened by its link: the playlist with its lookup back, so
// loadPlaylist's fetchTracks branch opens it on skeleton rows and fills
// them when `fetchByLink(link)` lands. Anything else (a saved playlist, one
// that still has its fetchTracks or its tracks, a ListenBrainz one, one with
// no link) comes back as it was.
function withLinkFetch(playlist, fetchByLink) {
  if (!playlist || typeof playlist.fetchTracks === 'function') return playlist;
  if (Array.isArray(playlist.tracks) && playlist.tracks.length > 0) return playlist;
  const link = reloadLink(playlist);
  if (!link) return playlist;
  return { ...playlist, fetchTracks: () => fetchByLink(link) };
}

// The playlist the context bar opens: the saved playlist with the context's
// id, else the context's ephemeral reference when it can still load; null
// otherwise (the caller falls back to the page the playlist came from).
function contextPlaylistTarget(context, playlists) {
  if (!context) return null;
  const isPlaylistType = context.type === 'playlist'
    || context.type === 'weekly-jam' || context.type === 'weekly-exploration';
  if (!isPlaylistType) return null;
  if (context.type === 'playlist' && context.id && Array.isArray(playlists)) {
    const saved = playlists.find((p) => p && p.id === context.id);
    if (saved) return saved;
  }
  return canReload(context.playlist) ? context.playlist : null;
}

module.exports = { playlistRef, playlistPlaybackContext, contextPlaylistTarget, withLinkFetch };
