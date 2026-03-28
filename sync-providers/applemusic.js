/**
 * Apple Music Sync Provider
 * Implements the SyncProvider interface for Apple Music library sync.
 *
 * Uses MusicKit JS in the renderer process to access the user's library.
 * Requires both a developer token (app-level) and user token (per-user auth).
 */

const APPLE_MUSIC_API_BASE = 'https://api.music.apple.com/v1';

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
 * Make an authenticated Apple Music API request with pagination
 */
const MAX_RETRIES = 5;

const appleMusicFetch = async (endpoint, developerToken, userToken, allItems = [], onProgress, _retryCount = 0) => {
  const url = endpoint.startsWith('http') ? endpoint : `${APPLE_MUSIC_API_BASE}${endpoint}`;

  // Validate pagination URLs stay on the expected host
  if (endpoint.startsWith('http')) {
    const parsedUrl = new URL(endpoint);
    if (parsedUrl.hostname !== 'api.music.apple.com') {
      throw new Error(`Unexpected pagination hostname: ${parsedUrl.hostname}`);
    }
  }

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${developerToken}`,
      'Music-User-Token': userToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 429) {
      if (_retryCount >= MAX_RETRIES) {
        throw new Error('Apple Music API rate limit exceeded after maximum retries');
      }
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return appleMusicFetch(endpoint, developerToken, userToken, allItems, onProgress, _retryCount + 1);
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error('Apple Music token expired or unauthorized. Please reconnect your Apple Music account.');
    }
    throw new Error(`Apple Music API error: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  const items = data.data || [];
  const combined = [...allItems, ...items];

  if (onProgress) {
    onProgress({ current: combined.length, total: data.meta?.total || combined.length });
  }

  // Handle pagination
  if (data.next) {
    await new Promise(resolve => setTimeout(resolve, 150));
    // data.next is a relative path like /v1/me/library/songs?offset=100
    // data.next already includes /v1, so use base domain only
    const nextUrl = data.next.startsWith('http')
      ? data.next
      : `https://api.music.apple.com${data.next}`;
    return appleMusicFetch(nextUrl, developerToken, userToken, combined, onProgress, 0);
  }

  return combined;
};

/**
 * Transform Apple Music library song to SyncTrack
 */
const transformTrack = (song) => {
  const attrs = song.attributes || {};
  const artistName = attrs.artistName || 'Unknown Artist';
  const albumName = attrs.albumName || 'Unknown Album';
  const title = attrs.name || 'Unknown Title';
  const duration = attrs.durationInMillis ? Math.round(attrs.durationInMillis / 1000) : 0;
  const albumArt = attrs.artwork?.url?.replace('{w}', '500').replace('{h}', '500') || null;
  const catalogId = attrs.playParams?.catalogId || song.id;
  return {
    id: generateTrackId(artistName, title, albumName),
    externalId: song.id,
    title,
    artist: artistName,
    album: albumName,
    duration,
    albumArt,
    addedAt: attrs.dateAdded ? new Date(attrs.dateAdded).getTime() : Date.now(),
    appleMusicId: catalogId,
    appleMusicUrl: attrs.url || `https://music.apple.com/us/song/${catalogId}`,
    // Pre-populate sources so the resolution system recognizes synced tracks
    // as already resolved for Apple Music (avoids redundant Search API calls)
    sources: {
      applemusic: {
        id: `applemusic-${catalogId}`,
        title,
        artist: artistName,
        album: albumName,
        duration,
        appleMusicId: catalogId,
        appleMusicUrl: attrs.url || `https://music.apple.com/us/song/${catalogId}`,
        albumArt,
        previewUrl: attrs.previews?.[0]?.url || null,
        confidence: 1.0
      }
    }
  };
};

/**
 * Transform Apple Music library album to SyncAlbum
 */
const transformAlbum = (album) => {
  const attrs = album.attributes || {};
  return {
    id: `${normalizeForId(attrs.artistName)}-${normalizeForId(attrs.name)}`,
    externalId: album.id,
    title: attrs.name || 'Unknown Album',
    artist: attrs.artistName || 'Unknown Artist',
    year: attrs.releaseDate ? parseInt(attrs.releaseDate.substring(0, 4), 10) : null,
    art: attrs.artwork?.url?.replace('{w}', '500').replace('{h}', '500') || null,
    addedAt: attrs.dateAdded ? new Date(attrs.dateAdded).getTime() : Date.now(),
    appleMusicId: attrs.playParams?.catalogId || album.id
  };
};

/**
 * Transform Apple Music library playlist to SyncPlaylist
 */
const transformPlaylist = (playlist) => {
  const attrs = playlist.attributes || {};
  // Track count: prefer relationships.tracks.meta.total, fall back to data length, then 0
  const tracksRel = playlist.relationships?.tracks;
  const trackCount = tracksRel?.meta?.total ?? tracksRel?.data?.length ?? 0;
  return {
    id: `applemusic-${playlist.id}`,
    externalId: playlist.id,
    name: attrs.name || 'Untitled Playlist',
    description: attrs.description?.standard || '',
    image: attrs.artwork?.url?.replace('{w}', '500').replace('{h}', '500') || null,
    trackCount,
    snapshotId: attrs.lastModifiedDate || null,
    folderId: null,
    folderName: null,
    isOwnedByUser: attrs.canEdit || false,
    ownerName: null,
    ownerId: null
  };
};

/**
 * Apple Music Sync Provider implementation
 */
const AppleMusicSyncProvider = {
  id: 'applemusic',
  displayName: 'Apple Music',

  capabilities: {
    tracks: true,
    albums: true,
    artists: false,
    playlists: true,
    playlistFolders: false
  },

  /**
   * Fetch all library songs from Apple Music
   * @param {string} token - JSON string with { developerToken, userToken }
   * @param {function} onProgress - Progress callback
   */
  async fetchTracks(token, onProgress) {
    const { developerToken, userToken } = JSON.parse(token);
    const items = await appleMusicFetch(
      '/me/library/songs?limit=100',
      developerToken,
      userToken,
      [],
      onProgress
    );
    return items.map(transformTrack);
  },

  /**
   * Fetch all saved albums from Apple Music
   */
  async fetchAlbums(token, onProgress) {
    const { developerToken, userToken } = JSON.parse(token);
    const items = await appleMusicFetch(
      '/me/library/albums?limit=100',
      developerToken,
      userToken,
      [],
      onProgress
    );
    return items.map(transformAlbum);
  },

  /**
   * Artists are not available via Apple Music API
   */
  async fetchArtists(_token, _onProgress) {
    return [];
  },

  /**
   * Fetch all user playlists from Apple Music
   */
  async fetchPlaylists(token, onProgress) {
    const { developerToken, userToken } = JSON.parse(token);
    const items = await appleMusicFetch(
      '/me/library/playlists?limit=100',
      developerToken,
      userToken,
      [],
      onProgress
    );

    const playlists = items.map(transformPlaylist);

    // Fetch track counts individually (library playlists API doesn't include them)
    const headers = {
      'Authorization': `Bearer ${developerToken}`,
      'Music-User-Token': userToken
    };
    await Promise.all(playlists.map(async (playlist) => {
      try {
        const resp = await fetch(
          `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlist.externalId}/tracks?limit=1`,
          { headers }
        );
        if (resp.ok) {
          const data = await resp.json();
          playlist.trackCount = data.meta?.total ?? data.data?.length ?? 0;
        }
      } catch {
        // Leave trackCount as 0 on failure
      }
    }));

    return {
      playlists,
      folders: []
    };
  },

  /**
   * Fetch tracks for a specific playlist
   */
  async fetchPlaylistTracks(playlistId, token, onProgress) {
    const { developerToken, userToken } = JSON.parse(token);
    const items = await appleMusicFetch(
      `/me/library/playlists/${playlistId}/tracks?limit=100`,
      developerToken,
      userToken,
      [],
      onProgress
    );
    return items.map(transformTrack);
  },

  /**
   * Get change detection snapshot for a playlist
   * Apple Music uses lastModifiedDate instead of Spotify's snapshot_id
   */
  async getPlaylistSnapshot(playlistId, token) {
    const { developerToken, userToken } = JSON.parse(token);
    const url = `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}`;

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${developerToken}`,
        'Music-User-Token': userToken
      }
    });

    if (!response.ok) {
      throw new Error(`Apple Music API error: ${response.status}`);
    }

    const data = await response.json();
    const playlist = data.data?.[0];
    return playlist?.attributes?.lastModifiedDate || null;
  },

  /**
   * Get recommended delay between API calls
   */
  getRateLimitDelay() {
    return 150;
  },

  /**
   * Check if tokens are valid
   */
  async checkAuth(token) {
    try {
      const { developerToken, userToken } = JSON.parse(token);
      if (!developerToken || !userToken) return false;

      const response = await fetch(`${APPLE_MUSIC_API_BASE}/me/library/songs?limit=1`, {
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken
        }
      });
      return response.ok;
    } catch {
      return false;
    }
  },

  /**
   * Delete a playlist from the user's Apple Music library
   * @param {string} playlistId - Apple Music library playlist ID
   * @param {string} token - JSON string with developerToken and userToken
   * @returns {Object} - { success: boolean }
   */
  async deletePlaylist(playlistId, token) {
    // Apple Music API does not support DELETE for library playlists.
    // Instead, clear the playlist's tracks so it becomes an empty shell,
    // and rename it to signal it's a leftover duplicate.
    try {
      await this.updatePlaylistTracks(playlistId, [], token);
    } catch (err) {
      // If clearing tracks fails, still try renaming
      console.warn(`[AppleMusic] Failed to clear tracks for playlist ${playlistId}:`, err.message);
    }

    try {
      await this.updatePlaylistDetails(playlistId, {
        name: `[Deleted] ${playlistId}`,
        description: 'Duplicate cleared by Parachord sync cleanup'
      }, token);
    } catch (err) {
      console.warn(`[AppleMusic] Failed to rename deleted playlist ${playlistId}:`, err.message);
    }

    return { success: true };
  },

  /**
   * Save tracks to user's Apple Music library
   * @param {string[]} trackIds - Array of Apple Music catalog song IDs
   * @param {string} token - JSON string with developerToken and userToken
   * @returns {Object} - { success: boolean, saved: number }
   */
  async saveTracks(trackIds, token) {
    if (!trackIds || trackIds.length === 0) {
      return { success: true, saved: 0 };
    }

    const { developerToken, userToken } = JSON.parse(token);

    // Apple Music allows adding multiple items via POST /me/library with ids query param
    // Batch in groups of 25 to stay within limits
    const batches = [];
    for (let i = 0; i < trackIds.length; i += 25) {
      batches.push(trackIds.slice(i, i + 25));
    }

    let totalSaved = 0;
    for (const batch of batches) {
      const idsParam = batch.map(id => `ids[songs]=${id}`).join('&');
      const response = await fetch(`${APPLE_MUSIC_API_BASE}/me/library?${idsParam}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken
        }
      });
      if (!response.ok && response.status !== 202) {
        console.warn(`[AppleMusic] Failed to save tracks batch: ${response.status}`);
      } else {
        totalSaved += batch.length;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    return { success: true, saved: totalSaved };
  },

  /**
   * Save albums to user's Apple Music library
   * @param {string[]} albumIds - Array of Apple Music catalog album IDs
   * @param {string} token - JSON string with developerToken and userToken
   * @returns {Object} - { success: boolean, saved: number }
   */
  async saveAlbums(albumIds, token) {
    if (!albumIds || albumIds.length === 0) {
      return { success: true, saved: 0 };
    }

    const { developerToken, userToken } = JSON.parse(token);

    const batches = [];
    for (let i = 0; i < albumIds.length; i += 25) {
      batches.push(albumIds.slice(i, i + 25));
    }

    let totalSaved = 0;
    for (const batch of batches) {
      const idsParam = batch.map(id => `ids[albums]=${id}`).join('&');
      const response = await fetch(`${APPLE_MUSIC_API_BASE}/me/library?${idsParam}`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken
        }
      });
      if (!response.ok && response.status !== 202) {
        console.warn(`[AppleMusic] Failed to save albums batch: ${response.status}`);
      } else {
        totalSaved += batch.length;
      }
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    return { success: true, saved: totalSaved };
  },

  // Resolve local tracks to Apple Music catalog IDs by searching
  async resolveTracks(tracks, token) {
    const { developerToken, userToken } = JSON.parse(token);
    const resolved = [];
    const unresolved = [];

    for (const track of tracks) {
      // Skip tracks that already have an Apple Music catalog ID
      const existingId = track.appleMusicCatalogId || track.appleMusicId || track.sources?.applemusic?.appleMusicId;
      if (existingId) {
        resolved.push({ ...track, appleMusicCatalogId: existingId, appleMusicId: existingId });
        continue;
      }

      try {
        const query = `${track.title} ${track.artist}`;
        const resp = await fetch(
          `${APPLE_MUSIC_API_BASE}/catalog/us/search?term=${encodeURIComponent(query)}&types=songs&limit=5`,
          {
            headers: {
              'Authorization': `Bearer ${developerToken}`,
              'Music-User-Token': userToken
            }
          }
        );

        if (!resp.ok) {
          unresolved.push({ artist: track.artist, title: track.title });
          await new Promise(resolve => setTimeout(resolve, 150));
          continue;
        }

        const data = await resp.json();
        const items = data.results?.songs?.data || [];

        // Find best match — exact title + artist match (case-insensitive)
        const match = items.find(item =>
          item.attributes.name.toLowerCase() === track.title.toLowerCase() &&
          item.attributes.artistName.toLowerCase() === track.artist.toLowerCase()
        ) || items[0];

        if (match) {
          resolved.push({
            ...track,
            appleMusicId: match.id,
            appleMusicCatalogId: match.id
          });
        } else {
          unresolved.push({ artist: track.artist, title: track.title });
        }

        await new Promise(resolve => setTimeout(resolve, 150));
      } catch (error) {
        console.error(`Failed to resolve track "${track.title}" by "${track.artist}":`, error.message);
        unresolved.push({ artist: track.artist, title: track.title });
      }
    }

    return { resolved, unresolved };
  },

  // Find an existing user-owned playlist by exact name (case-insensitive).
  // Returns the best match (most tracks) or null.
  async findPlaylistByName(name, token) {
    const { developerToken, userToken } = JSON.parse(token);
    const items = await appleMusicFetch(
      '/me/library/playlists?limit=100',
      developerToken,
      userToken
    );
    const normalizedName = (name || '').trim().toLowerCase();
    const matches = items
      .filter(p => {
        const pName = (p.attributes?.name || '').trim().toLowerCase();
        return pName === normalizedName && (p.attributes?.canEdit !== false);
      });

    if (matches.length === 0) return null;

    // If multiple matches, prefer the one with the most tracks
    // (fetch track counts to decide)
    if (matches.length === 1) {
      const p = matches[0];
      return {
        externalId: p.id,
        snapshotId: p.attributes?.lastModifiedDate || null
      };
    }

    // Fetch track counts for each match to pick the best one
    const headers = {
      'Authorization': `Bearer ${developerToken}`,
      'Music-User-Token': userToken
    };
    const withCounts = await Promise.all(matches.map(async (p) => {
      let trackCount = 0;
      try {
        const resp = await fetch(
          `${APPLE_MUSIC_API_BASE}/me/library/playlists/${p.id}/tracks?limit=1`,
          { headers }
        );
        if (resp.ok) {
          const data = await resp.json();
          trackCount = data.meta?.total ?? data.data?.length ?? 0;
        }
      } catch { /* leave as 0 */ }
      return { playlist: p, trackCount };
    }));

    withCounts.sort((a, b) => b.trackCount - a.trackCount);
    const best = withCounts[0].playlist;
    return {
      externalId: best.id,
      snapshotId: best.attributes?.lastModifiedDate || null
    };
  },

  // Create a new playlist on Apple Music, or adopt an existing one with the same name
  async createPlaylist(name, description, token) {
    // Check for an existing playlist with the same name to avoid duplicates.
    // Apple Music API does not support DELETE, so preventing duplicates at
    // creation time is critical.
    try {
      const existing = await this.findPlaylistByName(name, token);
      if (existing) {
        console.log(`[AppleMusic] Adopting existing playlist "${name}" (${existing.externalId}) instead of creating duplicate`);
        return existing;
      }
    } catch (err) {
      // Non-fatal — fall through to create
      console.warn(`[AppleMusic] Failed to check for existing playlist "${name}":`, err.message);
    }

    const { developerToken, userToken } = JSON.parse(token);

    const resp = await fetch(`${APPLE_MUSIC_API_BASE}/me/library/playlists`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${developerToken}`,
        'Music-User-Token': userToken,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        attributes: {
          name,
          description: description || ''
        }
      })
    });

    if (!resp.ok) {
      throw new Error(`Failed to create Apple Music playlist: ${resp.status}`);
    }

    const data = await resp.json();
    const playlist = data.data?.[0];

    return {
      externalId: playlist.id,
      snapshotId: playlist.attributes?.lastModifiedDate || new Date().toISOString()
    };
  },

  // Replace all tracks in an Apple Music playlist
  async updatePlaylistTracks(playlistId, tracks, token) {
    const { developerToken, userToken } = JSON.parse(token);

    // Filter to tracks with Apple Music catalog IDs
    const catalogTracks = tracks.filter(t => t.appleMusicCatalogId || t.appleMusicId);

    const body = {
      data: catalogTracks.map(t => ({
        id: t.appleMusicCatalogId || t.appleMusicId,
        type: 'songs'
      }))
    };

    const resp = await fetch(
      `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}/tracks`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!resp.ok) {
      throw new Error(`Failed to update Apple Music playlist tracks: ${resp.status}`);
    }

    // Fetch updated snapshot
    const snapshot = await this.getPlaylistSnapshot(playlistId, token);

    return { success: true, snapshotId: snapshot };
  },

  // Update playlist name and description on Apple Music
  async updatePlaylistDetails(playlistId, metadata, token) {
    const { developerToken, userToken } = JSON.parse(token);

    const attributes = {};
    if (metadata.name) attributes.name = metadata.name;
    if (metadata.description !== undefined) attributes.description = metadata.description || '';

    if (Object.keys(attributes).length === 0) {
      return { success: true };
    }

    const resp = await fetch(
      `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ attributes })
      }
    );

    if (!resp.ok) {
      throw new Error(`Failed to update Apple Music playlist details: ${resp.status}`);
    }

    return { success: true };
  }
};

module.exports = AppleMusicSyncProvider;
