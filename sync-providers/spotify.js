/**
 * Spotify Sync Provider
 * Implements the SyncProvider interface for Spotify library sync.
 */

const SPOTIFY_API_BASE = 'https://api.spotify.com/v1';

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
  const url = endpoint.startsWith('http') ? endpoint : `${SPOTIFY_API_BASE}${endpoint}`;
  const { method = 'GET', body } = options;

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
        throw new Error('Spotify API rate limit exceeded after maximum retries');
      }
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return spotifyRequest(endpoint, token, options, _retryCount + 1);
    }
    if (response.status === 401) {
      throw new Error('Spotify token expired. Please reconnect your Spotify account.');
    }
    if (response.status === 403) {
      throw new Error('Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions.');
    }
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }

  // Some endpoints return 201 with snapshot_id, others return empty
  const text = await response.text();
  return text ? JSON.parse(text) : { success: true };
};

/**
 * Make an authenticated Spotify API request with pagination support
 */
const spotifyFetch = async (endpoint, token, allItems = [], onProgress, _retryCount = 0) => {
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
        throw new Error('Spotify API rate limit exceeded after maximum retries');
      }
      // Rate limited - get retry-after header
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return spotifyFetch(endpoint, token, allItems, onProgress, _retryCount + 1);
    }
    if (response.status === 401) {
      throw new Error('Spotify token expired. Please reconnect your Spotify account.');
    }
    if (response.status === 403) {
      throw new Error('Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions for library sync.');
    }
    throw new Error(`Spotify API error: ${response.status} ${response.statusText}`);
  }

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
    return spotifyFetch(data.next, token, combined, onProgress, 0);
  }

  return combined;
};

/**
 * Transform Spotify track object to SyncTrack
 */
const transformTrack = (item, addedAt) => {
  const track = item.track || item;
  return {
    id: generateTrackId(track.artists?.[0]?.name, track.name, track.album?.name),
    externalId: track.id,
    title: track.name,
    artist: track.artists?.map(a => a.name).join(', ') || 'Unknown Artist',
    album: track.album?.name || 'Unknown Album',
    duration: Math.round((track.duration_ms || 0) / 1000),
    albumArt: track.album?.images?.[0]?.url || null,
    addedAt: addedAt ? new Date(addedAt).getTime() : Date.now(),
    spotifyUri: track.uri,
    spotifyId: track.id
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
    isOwnedByUser: playlist.owner?.id === playlist.owner?.id, // Will be set properly during fetch
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
    playlistFolders: true
  },

  /**
   * Fetch all liked/saved tracks from Spotify
   */
  async fetchTracks(token, onProgress) {
    const items = await spotifyFetch('/me/tracks?limit=50', token, [], onProgress);
    return items.map(item => transformTrack(item, item.added_at));
  },

  /**
   * Fetch all saved albums from Spotify
   */
  async fetchAlbums(token, onProgress) {
    const items = await spotifyFetch('/me/albums?limit=50', token, [], onProgress);
    return items.map(transformAlbum);
  },

  /**
   * Fetch all followed artists from Spotify
   */
  async fetchArtists(token, onProgress) {
    // Artists use cursor-based pagination, different from other endpoints
    const fetchArtistsPage = async (after = null, allArtists = []) => {
      const url = `/me/following?type=artist&limit=50${after ? `&after=${after}` : ''}`;
      const response = await fetch(`${SPOTIFY_API_BASE}${url}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Spotify token expired. Please reconnect your Spotify account.');
        }
        if (response.status === 403) {
          throw new Error('Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions for library sync.');
        }
        throw new Error(`Spotify API error: ${response.status}`);
      }

      const data = await response.json();
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
    return artists.map(transformArtist);
  },

  /**
   * Fetch all user playlists from Spotify
   * Note: Spotify API doesn't expose folder structure directly via standard endpoints
   * Folders are only available in the desktop app's internal API
   */
  async fetchPlaylists(token, onProgress) {
    const items = await spotifyFetch('/me/playlists?limit=50', token, [], onProgress);

    // Get current user ID for ownership check
    const userResponse = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const userData = await userResponse.json();
    const userId = userData.id;

    const playlists = items.map(playlist => ({
      ...transformPlaylist(playlist),
      isOwnedByUser: playlist.owner?.id === userId
    }));

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
  async fetchPlaylistTracks(playlistId, token, onProgress) {
    const items = await spotifyFetch(`/playlists/${playlistId}/tracks?limit=100`, token, [], onProgress);
    return items
      .filter(item => item.track) // Filter out null tracks (deleted/unavailable)
      .map(item => transformTrack(item, item.added_at));
  },

  /**
   * Get current snapshot ID for a playlist
   */
  async getPlaylistSnapshot(playlistId, token) {
    const response = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=snapshot_id`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Spotify token expired. Please reconnect your Spotify account.');
      }
      if (response.status === 403) {
        throw new Error('Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions for library sync.');
      }
      throw new Error(`Spotify API error: ${response.status}`);
    }

    const data = await response.json();
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
    const response = await fetch(`${SPOTIFY_API_BASE}/playlists/${playlistId}?fields=owner.id`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      return false;
    }

    const playlist = await response.json();

    // Get current user
    const userResponse = await fetch(`${SPOTIFY_API_BASE}/me`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    const user = await userResponse.json();

    return playlist.owner?.id === user.id;
  },

  /**
   * Save tracks to user's Spotify library (Liked Songs)
   * Uses the unified PUT /me/library endpoint (Feb 2026 API update)
   * @param {string[]} trackIds - Array of Spotify track IDs (not URIs)
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async saveTracks(trackIds, token) {
    if (!trackIds || trackIds.length === 0) {
      return { success: true, saved: 0 };
    }

    // Convert IDs to Spotify URIs for the unified /me/library endpoint
    const uris = trackIds.map(id => id.startsWith('spotify:') ? id : `spotify:track:${id}`);

    // Spotify allows max 50 items per request
    const batches = [];
    for (let i = 0; i < uris.length; i += 50) {
      batches.push(uris.slice(i, i + 50));
    }

    let totalSaved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/library', token, {
        method: 'PUT',
        body: { uris: batch }
      });
      totalSaved += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, saved: totalSaved };
  },

  /**
   * Remove tracks from user's Spotify library
   * Uses the unified DELETE /me/library endpoint (Feb 2026 API update)
   * @param {string[]} trackIds - Array of Spotify track IDs (not URIs)
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean }
   */
  async removeTracks(trackIds, token) {
    if (!trackIds || trackIds.length === 0) {
      return { success: true, removed: 0 };
    }

    // Convert IDs to Spotify URIs for the unified /me/library endpoint
    const uris = trackIds.map(id => id.startsWith('spotify:') ? id : `spotify:track:${id}`);

    // Spotify allows max 50 items per request
    const batches = [];
    for (let i = 0; i < uris.length; i += 50) {
      batches.push(uris.slice(i, i + 50));
    }

    let totalRemoved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/library', token, {
        method: 'DELETE',
        body: { uris: batch }
      });
      totalRemoved += batch.length;
      await new Promise(resolve => setTimeout(resolve, 100)); // Rate limit
    }

    return { success: true, removed: totalRemoved };
  },

  /**
   * Remove albums from Spotify library
   * Uses the unified DELETE /me/library endpoint (Feb 2026 API update)
   * @param {string[]} albumIds - Array of Spotify album IDs
   * @param {string} token - Access token
   * @returns {Object} - { success: boolean, removed: number }
   */
  async removeAlbums(albumIds, token) {
    if (!albumIds || albumIds.length === 0) {
      return { success: true, removed: 0 };
    }

    // Convert IDs to Spotify URIs for the unified /me/library endpoint
    const uris = albumIds.map(id => id.startsWith('spotify:') ? id : `spotify:album:${id}`);

    // Spotify allows max 50 items per request
    const batches = [];
    for (let i = 0; i < uris.length; i += 50) {
      batches.push(uris.slice(i, i + 50));
    }

    let totalRemoved = 0;
    for (const batch of batches) {
      await spotifyRequest('/me/library', token, {
        method: 'DELETE',
        body: { uris: batch }
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
  }
};

module.exports = SpotifySyncProvider;
