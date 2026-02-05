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
const appleMusicFetch = async (endpoint, developerToken, userToken, allItems = [], onProgress) => {
  const url = endpoint.startsWith('http') ? endpoint : `${APPLE_MUSIC_API_BASE}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${developerToken}`,
      'Music-User-Token': userToken,
      'Content-Type': 'application/json'
    }
  });

  if (!response.ok) {
    if (response.status === 429) {
      const retryAfter = parseInt(response.headers.get('Retry-After') || '5', 10);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return appleMusicFetch(endpoint, developerToken, userToken, allItems, onProgress);
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
    const nextUrl = data.next.startsWith('http')
      ? data.next
      : `${APPLE_MUSIC_API_BASE}${data.next}`;
    return appleMusicFetch(nextUrl, developerToken, userToken, combined, onProgress);
  }

  return combined;
};

/**
 * Transform Apple Music library song to SyncTrack
 */
const transformTrack = (song) => {
  const attrs = song.attributes || {};
  return {
    id: generateTrackId(attrs.artistName, attrs.name, attrs.albumName),
    externalId: song.id,
    title: attrs.name || 'Unknown Title',
    artist: attrs.artistName || 'Unknown Artist',
    album: attrs.albumName || 'Unknown Album',
    duration: attrs.durationInMillis ? Math.round(attrs.durationInMillis / 1000) : 0,
    albumArt: attrs.artwork?.url?.replace('{w}', '500').replace('{h}', '500') || null,
    addedAt: attrs.dateAdded ? new Date(attrs.dateAdded).getTime() : Date.now(),
    appleMusicId: attrs.playParams?.catalogId || song.id,
    appleMusicUrl: null
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
  }
};

module.exports = AppleMusicSyncProvider;
