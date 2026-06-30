/**
 * Spotify Sync Provider
 * Implements the SyncProvider interface for Spotify library sync.
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

const { pickConfidentMatch } = require('./confidence-scoring');

// Abuse-mode circuit breaker (parachord#956 audit §2b). Carries rate-limit state
// across calls so a banned client_id isn't re-hammered every cycle. main.js wires
// persistence via _setBreakerStore (load on startup, save on every transition);
// absent → in-memory only (still stops in-session re-hammering).
const { createSpotifyBreaker } = require('../sync-engine/spotify-breaker');
const _spotifyBreaker = createSpotifyBreaker();
let _spotifyBreakerSave = null;
function _setBreakerStore(io) {
  if (io && typeof io.load === 'function') { try { _spotifyBreaker.restore(io.load()); } catch {} }
  _spotifyBreakerSave = (io && typeof io.save === 'function') ? io.save : null;
}
function _persistBreaker() { if (_spotifyBreakerSave) { try { _spotifyBreakerSave(_spotifyBreaker.snapshot()); } catch {} } }
// Throw if the breaker is open (skip the API call to avoid prolonging the ban).
function _breakerGuard() {
  const now = Date.now();
  if (_spotifyBreaker.isOpen(now)) {
    throw new Error(`Spotify rate-limit cooldown active (${Math.ceil(_spotifyBreaker.msRemaining(now) / 60000)} min left); skipping to avoid prolonging the ban`);
  }
}
function _breakerTrip() { _spotifyBreaker.trip(Date.now()); _persistBreaker(); }
function _breakerSuccess() { if (_spotifyBreaker.recordSuccess()) _persistBreaker(); }

/**
 * Normalize a string for ID generation (lowercase, remove special chars)
 */
const normalizeForId = (str) => {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

/**
 * Generate a consistent ID from artist, title, album
 */
const generateTrackId = (artist, title, album) => {
  return `${normalizeForId(artist)}-${normalizeForId(title)}-${normalizeForId(album)}`;
};

/**
 * Make an authenticated Spotify API request (non-paginated, supports all methods)
 */
const MAX_RETRIES = 5;

const spotifyRequest = async (endpoint, token, options = {}, _retryCount = 0) => {
  if (_retryCount === 0) _breakerGuard(); // §2b: fail-fast while the abuse cooldown is open
  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;
  const { method = 'GET', body, refreshToken } = options;

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    if (response.status === 429) {
      if (_retryCount >= MAX_RETRIES) {
        _breakerTrip(); // §2b: open the escalating cooldown — stop re-hammering next cycle
        throw new Error('Spotify API rate limit exceeded after maximum retries');
      }
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return spotifyRequest(endpoint, token, options, _retryCount + 1);
    }
    // Retry on transient server errors (502, 503, 504) with exponential backoff
    if ([502, 503, 504].includes(response.status)) {
      if (_retryCount >= MAX_RETRIES) {
        throw new Error(`Spotify API error: ${response.status} ${response.statusText} (after ${MAX_RETRIES} retries)`);
      }
      const delay = Math.min(1000 * Math.pow(2, _retryCount), 30000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return spotifyRequest(endpoint, token, options, _retryCount + 1);
    }
    // Only refresh on 401 (expired token). 403 means insufficient scopes —
    // refreshing gives the same scopes, so retrying would be wasteful.
    if (response.status === 401 && refreshToken) {
      const newToken = await refreshToken();
      if (newToken) {
        return spotifyRequest(endpoint, newToken, { ...options, refreshToken: null }, 0);
      }
    }
    if (response.status === 401) {
      throw new Error('Spotify token expired. Please reconnect your Spotify account.');
    }
    if (response.status === 403) {
      throw new Error('Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions.');
    }
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }

  _breakerSuccess(); // §2b: a good response closes the cooldown + resets escalation
  // Some endpoints return 201 with snapshot_id, others return empty
  const text = await response.text();
  return text ? JSON.parse(text) : { success: true };
};

/**
 * Make an authenticated Spotify API request with pagination support.
 *
 * `isCancelled` is an optional 0-arg predicate polled at the start of each
 * paginate iteration (parachord#820). When it returns true mid-fetch, the
 * helper returns `null` to signal "abort — discard partial result." Callers
 * map a null return to a null `fetchTracks`/`fetchAlbums`/`fetchArtists`
 * result, which `syncDataType` interprets as "no change to apply" — safe
 * because the next phase-boundary cancel check in `sync:start` will fire
 * within milliseconds and route to `finalizeCancelled`.
 */
const spotifyFetch = async (endpoint, token, allItems = [], onProgress, refreshToken, _retryCount = 0, isCancelled = null) => {
  if (isCancelled?.()) return null;
  if (_retryCount === 0 && allItems.length === 0) _breakerGuard(); // §2b: fail-fast at the start of a fetch while the cooldown is open
  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;

  // Validate pagination URLs stay on the expected host
  if (endpoint.startsWith('http')) {
    const parsedUrl = new URL(endpoint);
    if (parsedUrl.hostname !== 'api.spotify.com') {
      throw new Error(`Unexpected pagination hostname: ${parsedUrl.hostname}`);
    }
  }

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 429) {
      if (_retryCount >= MAX_RETRIES) {
        _breakerTrip(); // §2b: open the escalating cooldown
        throw new Error('Spotify API rate limit exceeded after maximum retries');
      }
      // Rate limited - get retry-after header
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return spotifyFetch(endpoint, token, allItems, onProgress, refreshToken, _retryCount + 1, isCancelled);
    }
    // Retry on transient server errors (502, 503, 504) with exponential backoff
    if ([502, 503, 504].includes(response.status)) {
      if (_retryCount >= MAX_RETRIES) {
        throw new Error(`Spotify API error: ${response.status} ${response.statusText} (after ${MAX_RETRIES} retries)`);
      }
      const delay = Math.min(1000 * Math.pow(2, _retryCount), 30000);
      await new Promise(resolve => setTimeout(resolve, delay));
      return spotifyFetch(endpoint, token, allItems, onProgress, refreshToken, _retryCount + 1, isCancelled);
    }
    // Only refresh on 401 (expired token). 403 means insufficient scopes —
    // refreshing gives the same scopes, so retrying would be wasteful.
    if (response.status === 401 && refreshToken) {
      const newToken = await refreshToken();
      if (newToken) {
        return spotifyFetch(endpoint, newToken, allItems, onProgress, null, 0, isCancelled);
      }
    }
    if (response.status === 401) {
      throw new Error('Spotify token expired. Please reconnect your Spotify account.');
    }
    if (response.status === 403) {
      throw new Error('Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions for library sync.');
    }
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }

  _breakerSuccess(); // §2b: good response closes the cooldown
  const data = await response.json();
  const items = data.items || [];
  const combined = [...allItems, ...items];

  if (onProgress) {
    onProgress({ current: combined.length, total: data.total || combined.length });
  }

  // Handle pagination
  if (data.next) {
    // Small delay to avoid rate limiting
    await new Promise(resolve => setTimeout(resolve, 100));
    return spotifyFetch(data.next, token, combined, onProgress, refreshToken, 0, isCancelled);
  }

  return combined;
};

/**
 * Transform Spotify track object to SyncTrack
 */
const transformTrack = (item, addedAt) => {
  const track = item.track || item;
  const artistName = track.artists?.map(a => a.name).join(', ') || 'Unknown Artist';
  const albumName = track.album?.name || 'Unknown Album';
  const duration = Math.round((track.duration_ms || 0) / 1000);
  const albumArt = track.album?.images?.[0]?.url || null;
  return {
    id: generateTrackId(track.artists?.[0]?.name, track.name, track.album?.name),
    externalId: track.id,
    title: track.name,
    artist: artistName,
    album: albumName,
    duration,
    albumArt,
    addedAt: addedAt ? new Date(addedAt).getTime() : Date.now(),
    spotifyUri: track.uri,
    spotifyId: track.id,
    // Pre-populate sources so the resolution system recognizes synced tracks
    // as already resolved for Spotify (avoids redundant Search API calls)
    sources: {
      spotify: {
        id: `spotify-${track.id}`,
        title: track.name,
        artist: artistName,
        album: albumName,
        duration,
        spotifyUri: track.uri,
        spotifyId: track.id,
        spotifyAlbumId: track.album?.id,
        albumArt,
        confidence: 1.0
      }
    }
  };
};

/**
 * Transform Spotify album object to SyncAlbum
 */
const transformAlbum = (item) => {
  const album = item.album || item;
  return {
    id: `${normalizeForId(album.artists?.[0]?.name)}-${normalizeForId(album.name)}`,
    externalId: album.id,
    title: album.name,
    artist: album.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    year: album.release_date ? parseInt(album.release_date.substring(0, 4), 10) : null,
    art: album.images?.[0]?.url || null,
    addedAt: item.added_at ? new Date(item.added_at).getTime() : Date.now(),
    spotifyUri: album.uri,
    spotifyId: album.id
  };
};

/**
 * Transform Spotify artist object to SyncArtist
 */
const transformArtist = (artist) => {
  return {
    id: normalizeForId(artist.name),
    externalId: artist.id,
    name: artist.name,
    image: artist.images?.[0]?.url || null,
    addedAt: Date.now(), // Spotify doesn't provide follow date
    spotifyUri: artist.uri,
    spotifyId: artist.id
  };
};

/**
 * Transform Spotify playlist object to SyncPlaylist
 */
const transformPlaylist = (playlist, folderId = null, folderName = null) => {
  return {
    id: `spotify-${playlist.id}`,
    externalId: playlist.id,
    name: playlist.name,
    description: playlist.description || '',
    image: playlist.images?.[0]?.url || null,
    trackCount: playlist.tracks?.total ?? playlist.items?.total ?? 0,
    snapshotId: playlist.snapshot_id,
    folderId,
    folderName,
    isOwnedByUser: false, // Set properly in fetchPlaylists() with actual user ID comparison
    spotifyUri: playlist.uri,
    ownerName: playlist.owner?.display_name || playlist.owner?.id || null,
    ownerId: playlist.owner?.id || null
  };
};

/**
 * Spotify Sync Provider implementation
 */
const SpotifySyncProvider = {
  id: 'spotify',
  displayName: 'Spotify',

  capabilities: {
    tracks: true,
    albums: true,
    artists: true,
    playlists: true,
    playlistFolders: true,
    // N-way materialize dispatch (parachord#911). Spotify has a full
    // track-level API: DELETE /playlists/{id}/tracks by URI, PUT for order,
    // and playlist delete (unfollow) + rename.
    trackRemoveMode: 'ByNativeId',
    canReorder: true,
    supportsPlaylistDelete: true,
    supportsPlaylistRename: true
  },

  /**
   * Fetch all liked/saved tracks from Spotify.
   * If localSyncedCount is provided, does a quick count check first and
   * returns null when the remote total matches AND the most recent track
   * is the same (no changes → skip full fetch).
   */
  async fetchTracks(token, onProgress, refreshToken, { localSyncedCount, localLatestExternalId, isCancelled } = {}) {
    // Quick check: 1 API call to see if the library size or most recent track changed
    if (localSyncedCount !== undefined) {
      const probe = await spotifyRequest('/me/tracks?limit=1', token, { refreshToken });
      const remoteLatestId = probe.items?.[0]?.track?.id || null;
      if (probe.total === localSyncedCount && remoteLatestId === localLatestExternalId) {
        console.log(`[Spotify] Track count unchanged (${probe.total}) and latest track matches — skipping full fetch`);
        return null; // Signal: no changes detected
      }
      if (probe.total !== localSyncedCount) {
        console.log(`[Spotify] Track count changed: remote ${probe.total} vs local ${localSyncedCount}`);
      } else {
        console.log(`[Spotify] Track count same (${probe.total}) but latest track differs: remote ${remoteLatestId} vs local ${localLatestExternalId}`);
      }
    }
    const items = await spotifyFetch('/me/tracks?limit=50', token, [], onProgress, refreshToken, 0, isCancelled);
    // spotifyFetch returns null when isCancelled fires mid-paginate. Propagate
    // up — syncDataType treats null as "no change to apply", and sync:start's
    // next phase-boundary check exits via finalizeCancelled.
    if (items === null) return null;
    return items.map(item => transformTrack(item, item.added_at));
  },

  /**
   * Fetch all saved albums from Spotify.
   * Returns null when remote count and latest album match (no changes).
   */
  async fetchAlbums(token, onProgress, refreshToken, { localSyncedCount, localLatestExternalId, isCancelled } = {}) {
    if (localSyncedCount !== undefined) {
      const probe = await spotifyRequest('/me/albums?limit=1', token, { refreshToken });
      const remoteLatestId = probe.items?.[0]?.album?.id || null;
      if (probe.total === localSyncedCount && remoteLatestId === localLatestExternalId) {
        console.log(`[Spotify] Album count unchanged (${probe.total}) and latest album matches — skipping full fetch`);
        return null;
      }
      if (probe.total !== localSyncedCount) {
        console.log(`[Spotify] Album count changed: remote ${probe.total} vs local ${localSyncedCount}`);
      } else {
        console.log(`[Spotify] Album count same (${probe.total}) but latest album differs: remote ${remoteLatestId} vs local ${localLatestExternalId}`);
      }
    }
    const items = await spotifyFetch('/me/albums?limit=50', token, [], onProgress, refreshToken, 0, isCancelled);
    if (items === null) return null;
    return items.map(transformAlbum);
  },

  /**
   * Fetch all followed artists from Spotify.
   * Returns null when remote count and latest artist match (no changes).
   */
  async fetchArtists(token, onProgress, refreshToken, { localSyncedCount, localLatestExternalId, isCancelled } = {}) {
    // Quick count check for artists (first page includes total)
    if (localSyncedCount !== undefined) {
      const probeData = await spotifyRequest('/me/following?type=artist&limit=1', token, { refreshToken });
      const remoteTotal = probeData.artists?.total;
      const remoteLatestId = probeData.artists?.items?.[0]?.id || null;
      if (remoteTotal !== undefined && remoteTotal === localSyncedCount && remoteLatestId === localLatestExternalId) {
        console.log(`[Spotify] Artist count unchanged (${remoteTotal}) and latest artist matches — skipping full fetch`);
        return null;
      }
      if (remoteTotal !== undefined && remoteTotal !== localSyncedCount) {
        console.log(`[Spotify] Artist count changed: remote ${remoteTotal} vs local ${localSyncedCount}`);
      }
    }
    // Artists use cursor-based pagination, different from other endpoints.
    // Same isCancelled gating as spotifyFetch (parachord#820): poll between
    // pages and return null on cancel so the partial result is discarded.
    let currentRefreshToken = refreshToken;
    const fetchArtistsPage = async (after = null, allArtists = []) => {
      if (isCancelled?.()) return null;
      const url = `/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`;
      const data = await spotifyRequest(url, token, { refreshToken: currentRefreshToken });
      // Only allow one refresh attempt across all pages
      currentRefreshToken = null;

      const artists = data.artists?.items || [];
      const combined = [...allArtists, ...artists];

      if (onProgress) {
        onProgress({ current: combined.length, total: data.artists?.total || combined.length });
      }

      if (data.artists?.cursors?.after) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return fetchArtistsPage(data.artists.cursors.after, combined);
      }

      return combined;
    };

    const artists = await fetchArtistsPage();
    if (artists === null) return null;
    return artists.map(transformArtist);
  },

  /**
   * Fetch all user playlists from Spotify
   * Note: Spotify API doesn't expose folder structure directly via standard endpoints
   * Folders are only available in the desktop app's internal API
   */
  async fetchPlaylists(token, onProgress, refreshToken) {
    const items = await spotifyFetch('/me/playlists?limit=50', token, [], onProgress, refreshToken);

    // Get current user ID for ownership check
    const userData = await spotifyRequest('/me', token, { refreshToken });
    const userId = userData.id;

    // Deduplicate — Spotify pagination can return the same playlist on
    // multiple pages when the library changes mid-fetch.
    const seen = new Set();
    const playlists = [];
    for (const playlist of items) {
      if (seen.has(playlist.id)) continue;
      seen.add(playlist.id);
      playlists.push({
        ...transformPlaylist(playlist),
        isOwnedByUser: playlist.owner?.id === userId
      });
    }

    // Spotify's public API doesn't expose folders
    // Return empty folders array - folders would require unofficial API access
    return {
      playlists,
      folders: []
    };
  },

  /**
   * Fetch tracks for a specific playlist
   */
  async fetchPlaylistTracks(playlistId, token, onProgress, refreshToken) {
    const items = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=100`, token, [], onProgress, refreshToken);
    return items
      .filter(item => item.track) // Filter out null tracks (deleted/unavailable)
      .map(item => transformTrack(item, item.added_at));
  },

  /**
   * Get current snapshot ID for a playlist
   */
  async getPlaylistSnapshot(playlistId, token, refreshToken) {
    const data = await spotifyRequest(`/playlists/${playlistId}?fields=snapshot_id`, token, { refreshToken });
    return data.snapshot_id;
  },

  /**
   * Get recommended delay between API calls
   */
  getRateLimitDelay() {
    return 100; // 100ms between calls
  },

  /**
   * Check if token is valid
   */
  async checkAuth(token) {
    try {
      const response = await fetch(`${SPOTIFY_API_BASE}/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Update playlist tracks on Spotify (replaces all tracks)
   * Spotify limits to 100 tracks per request, so we batch if needed
   * @param {string} playlistId - Spotify playlist ID
   * @param {Array} tracks - Array of track objects with spotifyUri
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean, snapshotId: string }
   */
  async updatePlaylistTracks(playlistId, tracks, token) {
    // Filter to only tracks with Spotify URIs
    const uris = tracks
      .filter(t => t.spotifyUri)
      .map(t => t.spotifyUri);

    // Short-circuit when remote already matches the intended list
    // (same URIs in the same order). Spotify's PUT replaces in-order, so
    // any reorder still has to fall through to the full PUT — but a no-op
    // push (common for steady-state hosted-XSPF mirrors where the upstream
    // blob differs by whitespace but the track list is unchanged) becomes
    // a single cheap GET. Mirror of the inbound short-circuit shipped in
    // #796 (canShortCircuitPlaylistUpdate) for the opposite direction;
    // sibling short-circuit lives in the LB and AM providers' update
    // paths. See app.js's playlistSyncInProgressRef starvation concern
    // (#831) — the less work this function does per playlist, the less
    // the cross-provider mutex matters.
    try {
      const currentItems = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=100&fields=items(track(uri)),next`, token, [], null, null);
      const remoteUris = currentItems
        .map(item => item?.track?.uri)
        .filter(uri => typeof uri === 'string' && uri.length > 0);
      const sameOrder =
        remoteUris.length === uris.length
        && remoteUris.every((u, i) => u === uris[i]);
      if (sameOrder) {
        const snap = await spotifyRequest(`/playlists/${playlistId}?fields=snapshot_id`, token);
        console.log(`[Spotify] Skipping push for ${playlistId}: remote already matches (${uris.length} tracks)`);
        return { success: true, snapshotId: snap.snapshot_id };
      }
    } catch (err) {
      // If the precheck fails (rate limit, transient 5xx, etc.), fall through
      // to the full PUT path — the existing retries on the write side handle
      // those error modes. Don't let a precheck failure block the actual write.
      console.warn(`[Spotify] Precheck for short-circuit failed for ${playlistId}; proceeding with full PUT: ${err.message}`);
    }

    if (uris.length === 0) {
      // Clear the playlist if no valid tracks
      const result = await spotifyRequest(`/playlists/${playlistId}/tracks`, token, {
        method: 'PUT',
        body: { uris: [] }
      });
      return { success: true, snapshotId: result.snapshot_id };
    }

    // Spotify allows max 100 tracks per request
    // First request uses PUT to replace, subsequent use POST to add
    const batches = [];
    for (let i = 0; i < uris.length; i += 100) {
      batches.push(uris.slice(i, i + 100));
    }

    let snapshotId;

    // First batch: replace all tracks
    const firstResult = await spotifyRequest(`/playlists/${playlistId}/tracks`, token, {
      method: 'PUT',
      body: { uris: batches[0] }
    });
    snapshotId = firstResult.snapshot_id;

    // Subsequent batches: add tracks
    for (let i = 1; i < batches.length; i++) {
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
      const addResult = await spotifyRequest(`/playlists/${playlistId}/tracks`, token, {
        method: 'POST',
        body: { uris: batches[i] }
      });
      snapshotId = addResult.snapshot_id;
    }

    return { success: true, snapshotId };
  },

  // ── N-way incremental write primitives (parachord#911) ────────────
  // Spotify is `trackRemoveMode: 'ByNativeId'` — surgical add/remove by URI,
  // NOT the destructive PUT-replace that updatePlaylistTracks uses. Dormant
  // until the N-way reconcile driver calls them (real writes gated OFF).

  // The native id Spotify add/remove operate on, off a track object.
  nativeIdOf(track) {
    if (!track) return null;
    if (track.spotifyUri) return track.spotifyUri;
    if (track.spotifyId) return `spotify:track:${track.spotifyId}`;
    return null;
  },

  /**
   * Remove specific tracks from a playlist by their Spotify URI.
   * DELETE /v1/playlists/{id}/tracks  body { tracks: [{ uri }] }; batched 100;
   * returns the new snapshot_id (the echo-suppression anchor).
   * @returns {Promise<{success:boolean, snapshotId:string|undefined}>}
   */
  async removePlaylistTracksByNativeId(playlistId, externalTrackIds, token) {
    const uris = (externalTrackIds || []).filter(Boolean);
    let snapshotId;
    for (let i = 0; i < uris.length; i += 100) {
      const batch = uris.slice(i, i + 100);
      if (i > 0) await new Promise((r) => setTimeout(r, 100)); // rate-limit between batches
      const result = await spotifyRequest(`/playlists/${playlistId}/tracks`, token, {
        method: 'DELETE',
        body: { tracks: batch.map((uri) => ({ uri })) },
      });
      snapshotId = result.snapshot_id;
    }
    return { success: true, snapshotId };
  },

  /**
   * Update playlist metadata (name, description)
   * @param {string} playlistId - Spotify playlist ID
   * @param {Object} metadata - { name?: string, description?: string }
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async updatePlaylistDetails(playlistId, metadata, token) {
    const body = {};
    if (metadata.name) body.name = metadata.name;
    if (metadata.description !== undefined) body.description = metadata.description || '';

    if (Object.keys(body).length === 0) {
      return { success: true }; // Nothing to update
    }

    await spotifyRequest(`/playlists/${playlistId}`, token, {
      method: 'PUT',
      body
    });

    return { success: true };
  },

  /**
   * Check if user owns the playlist (can edit it)
   */
  async checkPlaylistOwnership(playlistId, token) {
    try {
      const playlist = await spotifyRequest(`/playlists/${playlistId}?fields=owner.id`, token);
      const user = await spotifyRequest('/me', token);
      return playlist.owner?.id === user.id;
    } catch {
      return false;
    }
  },

  /**
   * Save tracks to user's Spotify library (Liked Songs)
   * @param {string[]} trackIds - Array of Spotify track IDs (not URIs)
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async saveTracks(trackIds, token) {
    if (!trackIds || trackIds.length === 0) {
      return { success: true, saved: 0 };
    }

    // Strip URIs down to bare IDs if needed
    const ids = trackIds.map(id => id.startsWith('spotify:track:') ? id.replace('spotify:track:', '') : id);

    // Spotify allows max 50 items per request
    const batches = [];
    for (let i = 0; i < ids.length; i += 50) {
      batches.push(ids.slice(i, i + 50));
    }

    let totalSaved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/tracks', token, {
        method: 'PUT',
        body: { ids: batch }
      });
      totalSaved += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, saved: totalSaved };
  },

  /**
   * Save albums to user's Spotify library
   * @param {string[]} albumIds - Array of Spotify album IDs
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean, saved: number }
   */
  async saveAlbums(albumIds, token) {
    if (!albumIds || albumIds.length === 0) {
      return { success: true, saved: 0 };
    }

    const ids = albumIds.map(id => id.startsWith('spotify:album:') ? id.replace('spotify:album:', '') : id);

    const batches = [];
    for (let i = 0; i < ids.length; i += 50) {
      batches.push(ids.slice(i, i + 50));
    }

    let totalSaved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/albums', token, {
        method: 'PUT',
        body: { ids: batch }
      });
      totalSaved += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { success: true, saved: totalSaved };
  },

  /**
   * Remove tracks from user's Spotify library (Liked Songs)
   *
   * DELETE /me/tracks with { ids } for Liked Songs. The previously-coded
   * /me/library endpoint does not exist (same root cause that was fixed
   * for saveTracks/saveAlbums; the remove* methods were missed in that
   * pass). Symptom: local Collection removal succeeds, IPC fires, fetch
   * 404s, fire-and-forget catch swallows the error, and the next sync
   * re-imports the track because there's no tombstone. See bug report
   * traced in achordion#72-adjacent investigation.
   *
   * @param {string[]} trackIds - Array of Spotify track IDs (not URIs)
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async removeTracks(trackIds, token) {
    if (!trackIds || trackIds.length === 0) {
      return { success: true, removed: 0 };
    }

    // Strip URIs down to bare IDs if needed
    const ids = trackIds.map(id => id.startsWith('spotify:track:') ? id.replace('spotify:track:', '') : id);

    // Spotify allows max 50 items per request
    const batches = [];
    for (let i = 0; i < ids.length; i += 50) {
      batches.push(ids.slice(i, i + 50));
    }

    let totalRemoved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/tracks', token, {
        method: 'DELETE',
        body: { ids: batch }
      });
      totalRemoved += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, removed: totalRemoved };
  },

  /**
   * Remove albums from Spotify library
   *
   * DELETE /me/albums with { ids }. Same broken-endpoint regression as
   * removeTracks above — see that method's docblock for context.
   *
   * @param {string[]} albumIds - Array of Spotify album IDs
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean, removed: number }
   */
  async removeAlbums(albumIds, token) {
    if (!albumIds || albumIds.length === 0) {
      return { success: true, removed: 0 };
    }

    // Strip URIs down to bare IDs if needed
    const ids = albumIds.map(id => id.startsWith('spotify:album:') ? id.replace('spotify:album:', '') : id);

    // Spotify allows max 50 items per request
    const batches = [];
    for (let i = 0; i < ids.length; i += 50) {
      batches.push(ids.slice(i, i + 50));
    }

    let totalRemoved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/albums', token, {
        method: 'DELETE',
        body: { ids: batch }
      });
      totalRemoved += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, removed: totalRemoved };
  },

  /**
   * Follow artists on Spotify
   * @param {string[]} artistIds - Array of Spotify artist IDs
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async followArtists(artistIds, token) {
    if (!artistIds || artistIds.length === 0) {
      return { success: true, followed: 0 };
    }

    // Spotify allows max 50 artists per request
    const batches = [];
    for (let i = 0; i < artistIds.length; i += 50) {
      batches.push(artistIds.slice(i, i + 50));
    }

    let totalFollowed = 0;
    for (const batch of batches) {
      await spotifyRequest(`/me/following?type=artist&ids=${batch.join(',')}`, token, {
        method: 'PUT'
      });
      totalFollowed += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, followed: totalFollowed };
  },

  /**
   * Unfollow artists on Spotify
   * @param {string[]} artistIds - Array of Spotify artist IDs
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async unfollowArtists(artistIds, token) {
    if (!artistIds || artistIds.length === 0) {
      return { success: true, unfollowed: 0 };
    }

    // Spotify allows max 50 artists per request
    const batches = [];
    for (let i = 0; i < artistIds.length; i += 50) {
      batches.push(artistIds.slice(i, i + 50));
    }

    let totalUnfollowed = 0;
    for (const batch of batches) {
      await spotifyRequest(`/me/following?type=artist&ids=${batch.join(',')}`, token, {
        method: 'DELETE'
      });
      totalUnfollowed += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, unfollowed: totalUnfollowed };
  },

  /**
   * Unfollow (delete) a playlist from the user's Spotify library
   * @param {string} playlistId - Spotify playlist ID
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async deletePlaylist(playlistId, token) {
    await spotifyRequest(`/playlists/${playlistId}/followers`, token, {
      method: 'DELETE'
    });
    return { success: true };
  },

  // Resolve local tracks to Spotify URIs by searching
  async resolveTracks(tracks, token) {
    const resolved = [];
    const unresolved = [];

    for (const track of tracks) {
      // Skip tracks that already have a Spotify URI or ID
      const existingUri = track.spotifyUri || (track.spotifyId ? `spotify:track:${track.spotifyId}` : null);
      if (existingUri) {
        resolved.push({ ...track, spotifyUri: existingUri });
        continue;
      }

      try {
        const query = `track:"${track.title}" artist:"${track.artist}"`;
        const result = await spotifyRequest(
          `/search?q=${encodeURIComponent(query)}&type=track&limit=5`,
          token
        );

        const items = result.tracks?.items || [];
        // Confidence-gated match (parachord#911 D-Legacy-1). The legacy
        // `... || items[0]` minted the top search hit's URI with no floor when
        // no exact match existed — writing a wrong-song URI (e.g. "Intro" by
        // The xx → "Intro" by Alt-J) that then stuck fleet-wide via provider-ID
        // equality. Route every candidate through the same scoreConfidence gate
        // mobile uses (≥ MIN_CONFIDENCE_THRESHOLD); drop on sub-floor.
        const candidates = items.map(item => ({
          title: item.name,
          artist: (item.artists || []).map(a => a.name).join(', '),
        }));
        const picked = pickConfidentMatch(track, candidates);

        if (picked) {
          resolved.push({
            ...track,
            spotifyUri: items[picked.index].uri
          });
        } else {
          unresolved.push({ artist: track.artist, title: track.title });
        }

        // Rate limit
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to resolve track "${track.title}" by "${track.artist}":`, error.message);
        unresolved.push({ artist: track.artist, title: track.title });
      }
    }

    return { resolved, unresolved };
  },

  // Create a new playlist on Spotify
  async createPlaylist(name, description, token) {
    // Get current user ID
    const user = await spotifyRequest('/me', token);

    const playlist = await spotifyRequest(`/users/${user.id}/playlists`, token, {
      method: 'POST',
      body: {
        name,
        description: description || '',
        public: false
      }
    });

    return {
      externalId: playlist.id,
      snapshotId: playlist.snapshot_id
    };
  }
};

// Persistence wiring for the §2b abuse-mode breaker (main.js calls this once at
// startup with electron-store-backed load/save).
SpotifySyncProvider._setBreakerStore = _setBreakerStore;

module.exports = SpotifySyncProvider;
