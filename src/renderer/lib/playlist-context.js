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
// recommended playlist's `fetchTracks` can't cross the store's IPC, so only a
// playlist with a ListenBrainz id can be reopened from the bar; the others
// fall back to Recommendations, where they live.
//
// Pure, no React, loads under plain Node.

const REF_FIELDS = [
  'id', 'title', 'creator', 'description', 'source', 'sourceUrl',
  'listenbrainzId', 'weekLabel', 'date', 'isExternal', 'isEphemeral'
];

// The reopenable reference for an ephemeral playlist; undefined for a saved one.
function playlistRef(playlist) {
  if (!playlist || !playlist.isEphemeral) return undefined;
  const ref = { tracks: [], tracksLoaded: false };
  for (const key of REF_FIELDS) {
    if (playlist[key] !== undefined) ref[key] = playlist[key];
  }
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

// Whether a reference can load its tracks again (loadPlaylist's ListenBrainz
// branch).
const canReload = (ref) => !!ref && !!ref.id && !!ref.listenbrainzId;

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

module.exports = { playlistRef, playlistPlaybackContext, contextPlaylistTarget };
