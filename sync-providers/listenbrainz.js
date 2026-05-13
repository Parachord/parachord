// ListenBrainz playlist sync provider.
//
// Uses JSPF for playlist body and recording MBIDs as the canonical track
// identifier. The user token used here is the SCROBBLER-side token (key
// `scrobbler-config-listenbrainz`.userToken), not the meta-service config —
// see CLAUDE.md "ListenBrainz auth token auto-attach" for the rationale.
//
// Capability matrix (mirrors the shape used by spotify.js / applemusic.js):
//   - playlists: true
//   - tracks: false   (LB has no library-of-tracks concept)
//   - albums: false   (LB has no library-of-albums concept)
//   - artists: false  (LB has no library-of-artists concept)

const LB_BASE = 'https://api.listenbrainz.org';

const capabilities = {
  playlists: true,
  tracks: false,
  albums: false,
  artists: false,
};

function authHeaders(token) {
  return {
    'Authorization': `Token ${token}`,
    'Content-Type': 'application/json',
  };
}

async function getUserName(token) {
  // GET /1/validate-token returns { user_name, valid }
  const res = await fetch(`${LB_BASE}/1/validate-token`, { headers: authHeaders(token) });
  if (!res.ok) throw new Error(`LB validate-token returned ${res.status}`);
  const data = await res.json();
  if (!data.valid || !data.user_name) throw new Error('LB token invalid');
  return data.user_name;
}

// ── Stubs for now; filled in by Tasks 7–11 ──
async function fetchPlaylists(token /*, onProgress, refreshToken */) {
  throw new Error('fetchPlaylists not implemented yet');
}
async function fetchPlaylistTracks(playlistMbid, token /*, _onProgress, refreshToken */) {
  throw new Error('fetchPlaylistTracks not implemented yet');
}
async function createPlaylist(name, description, tracks, token) {
  throw new Error('createPlaylist not implemented yet');
}
async function updatePlaylistTracks(playlistMbid, tracks, token) {
  throw new Error('updatePlaylistTracks not implemented yet');
}
async function updatePlaylistDetails(playlistMbid, details, token) {
  throw new Error('updatePlaylistDetails not implemented yet');
}
async function deletePlaylist(playlistMbid, token) {
  throw new Error('deletePlaylist not implemented yet');
}

module.exports = {
  id: 'listenbrainz',
  name: 'ListenBrainz',
  capabilities,
  fetchPlaylists,
  fetchPlaylistTracks,
  createPlaylist,
  updatePlaylistTracks,
  updatePlaylistDetails,
  deletePlaylist,
};
