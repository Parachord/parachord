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
async function fetchPlaylists(token, _onProgress, _refreshToken) {
  const userName = await getUserName(token);
  // LB returns 25 playlists per page by default. Paginate via `count` / `offset`.
  const PAGE_SIZE = 50;
  let offset = 0;
  const playlists = [];
  while (true) {
    const res = await fetch(
      `${LB_BASE}/1/user/${encodeURIComponent(userName)}/playlists?count=${PAGE_SIZE}&offset=${offset}`,
      { headers: authHeaders(token) },
    );
    if (!res.ok) throw new Error(`LB fetchPlaylists returned ${res.status}`);
    const data = await res.json();
    const items = Array.isArray(data?.playlists) ? data.playlists : [];
    if (items.length === 0) break;
    for (const item of items) {
      const p = item?.playlist;
      if (!p?.identifier) continue;
      const mbidMatch = p.identifier.match(/playlist\/([a-f0-9-]{36})/i);
      if (!mbidMatch) continue;
      const externalId = mbidMatch[1];

      // Collaborator detection: a user is considered "owner-capable" if
      // they're the creator OR appear in the playlist's collaborators
      // extension. This enables cross-service collaboration — see the
      // "Cross-service collaboration via LB" section at the top of the plan.
      const ext = p.extension?.['https://musicbrainz.org/doc/jspf#playlist'] || {};
      const creator = (p.creator || '').toLowerCase();
      const userLower = userName.toLowerCase();
      const collaborators = Array.isArray(ext.collaborators)
        ? ext.collaborators.map(c => String(c).toLowerCase())
        : [];
      const isOwnedByUser = creator === userLower || collaborators.includes(userLower);
      const isCollaborator = !!collaborators.length && creator !== userLower && collaborators.includes(userLower);

      playlists.push({
        externalId,
        id: `listenbrainz-${externalId}`,
        name: p.title || 'Untitled',
        description: p.annotation || '',
        ownerName: p.creator || userName,
        ownerId: p.creator || userName,
        isOwnedByUser,
        // `isCollaborator` is surfaced to the UI for the "shared playlist"
        // badge (Task 13-bis). Owner-only playlists have it false.
        isCollaborator,
        collaborators,
        snapshotId: p.date || ext.last_modified_at || null,
        trackCount: Array.isArray(p.track) ? p.track.length : 0,
        // Surface visibility so the wizard / cleanup UI can show it
        isPublic: !!ext.public,
      });
    }
    if (items.length < PAGE_SIZE) break;
    offset += items.length;
  }
  return { playlists };
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
  // Sibling providers (spotify.js, applemusic.js) export `displayName`, and
  // main.js's sync-provider listing reads `p.displayName` (main.js:5756).
  // Match that contract.
  displayName: 'ListenBrainz',
  capabilities,
  fetchPlaylists,
  fetchPlaylistTracks,
  createPlaylist,
  updatePlaylistTracks,
  updatePlaylistDetails,
  deletePlaylist,
};
