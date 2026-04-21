/**
 * Apple Music Sync Provider
 * Implements the SyncProvider interface for Apple Music library sync.
 *
 * Uses MusicKit JS in the renderer process to access the user's library.
 * Requires both a developer token (app-level) and user token (per-user auth).
 */

const APPLE_MUSIC_API_BASE = 'https://api.music.apple.com/v1';

// Session-scoped kill-switch for the undocumented per-track DELETE endpoint.
// `DELETE /v1/me/library/playlists/{id}/tracks/{libraryTrackId}` isn't part of
// Apple's public contract; third-party clients have used it reliably for
// years, but Apple could change it at any time. If we ever see HTTP 405
// (Method Not Allowed) from that endpoint, we flip this flag and skip the
// DELETE loop for the rest of the process lifetime — failing gracefully
// back to append-only semantics without any user-visible error. Resets on
// app restart, so if Apple restores the endpoint we recover automatically
// at the cost of one wasted 405 per session.
const amRemovalUnsupportedRef = { current: false };

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
   * @param {function} [refreshTokenCb] - Optional async callback to refresh token on 401
   * @returns {Object} - { success: boolean }
   */
  async deletePlaylist(playlistId, token, refreshTokenCb) {
    // Try the actual DELETE endpoint first (Apple Music API supports it for
    // library playlists). Fall back to clear+rename if DELETE is not supported.
    const attemptDelete = async (currentToken) => {
      const { developerToken, userToken } = JSON.parse(currentToken);
      const resp = await fetch(
        `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${developerToken}`,
            'Music-User-Token': userToken
          }
        }
      );
      return resp;
    };

    // First attempt with current token
    let resp = await attemptDelete(token);

    // On 401, try refreshing the token and retry once. Apple has been
    // observed to return 401 on DELETE /me/library/playlists/{id} for
    // MusicKit-issued user tokens even when other write operations
    // (POST tracks, PATCH attributes) succeed with the same token —
    // i.e. this is an endpoint-level restriction, not a broken session.
    // The refresh attempt is harmless but usually returns the same
    // token; we check the response regardless.
    if ((resp.status === 401 || resp.status === 403) && refreshTokenCb) {
      console.log(`[AppleMusic] Got ${resp.status} on DELETE, attempting token refresh...`);
      const newToken = await refreshTokenCb();
      if (newToken) {
        token = newToken;
        resp = await attemptDelete(token);
      }
    }

    if (resp.ok || resp.status === 204 || resp.status === 202) {
      return { success: true };
    }

    // If the DELETE endpoint rejected us — whether with 405 (method not
    // allowed), 404 (already gone), 401/403 (endpoint-restricted for
    // MusicKit tokens on this account, per Apple's current behavior) —
    // fall back to renaming the playlist to mark it as deleted. The
    // tracks persist on the remote, but the playlist no longer collides
    // with the keeper's name, and the user can remove it manually in
    // Music.app.
    if (resp.status === 405 || resp.status === 404 || resp.status === 401 || resp.status === 403) {
      console.log(`[AppleMusic] DELETE returned ${resp.status} (endpoint rejected), falling back to rename for ${playlistId}`);
      try {
        await this.updatePlaylistDetails(playlistId, {
          name: `[Deleted] ${playlistId}`,
          description: 'Marked deleted by Parachord sync cleanup'
        }, token);
        return { success: true, renamedOnly: true };
      } catch (err) {
        console.warn(`[AppleMusic] Failed to rename deleted playlist ${playlistId}:`, err.message);
        throw new Error(`Failed to delete Apple Music playlist ${playlistId}: DELETE returned ${resp.status} and rename fallback failed: ${err.message}`);
      }
    }

    throw new Error(`Failed to delete Apple Music playlist ${playlistId}: ${resp.status}`);
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

  // Sync `tracks` to an Apple Music playlist with full-replace semantics.
  //
  // Apple's *documented* Library Playlists API only exposes POST for
  // tracks — so historically we implemented append-only. This version
  // additionally uses the *undocumented* per-track DELETE endpoint
  // (`DELETE /v1/me/library/playlists/{id}/tracks/{libraryTrackId}`) to
  // remove tracks that are no longer in the requested list. Third-party
  // Apple Music clients have used this endpoint reliably for years; if
  // Apple ever returns 405 we flip the module-scope kill-switch and
  // degrade silently to append-only for the rest of the session.
  //
  // Diff algorithm:
  //   1. Fetch current remote tracks.
  //   2. Compute toRemove = remote rows whose catalog isn't in requested,
  //      plus duplicate rows for catalogs that are in requested (collapse
  //      to one instance — matches Spotify's behavior).
  //   3. Compute toAdd = requested catalogs not currently on the remote.
  //   4. DELETE toRemove (serial, rate-limited), then POST toAdd.
  //
  // The returned `removed` count does NOT include rows that were skipped
  // because the kill-switch fired mid-loop; only rows we successfully
  // deleted (or that were already 404).
  async updatePlaylistTracks(playlistId, tracks, token) {
    const { developerToken, userToken } = JSON.parse(token);

    // Inputs: collect unique catalog IDs from the local tracklist.
    const requestedCatalog = new Set(
      tracks
        .map(t => t?.appleMusicCatalogId || t?.appleMusicId)
        .filter(Boolean)
        .map(id => String(id))
    );

    // Current remote state.
    let remoteTracks = [];
    try {
      remoteTracks = await this.fetchPlaylistTracks(playlistId, token);
    } catch (err) {
      // Non-fatal: without the current state we can't compute a proper
      // diff. Fall back to the pre-change append-only path: POST every
      // requested catalog. Worst case is a few duplicates if Apple
      // doesn't dedup (it usually does on this endpoint).
      console.warn(`[AppleMusic] Could not fetch existing tracks for ${playlistId}; falling back to append-only for this call:`, err.message);
      const toAdd = [...requestedCatalog];
      const added = toAdd.length > 0
        ? await this._postTracksToPlaylist(playlistId, toAdd, developerToken, userToken)
        : 0;
      const snapshot = await this.getPlaylistSnapshot(playlistId, token);
      return { success: true, snapshotId: snapshot, added, removed: 0 };
    }

    // Diff. Iterate the full remoteTracks array (NOT a Map keyed by
    // catalog) so duplicate rows on the remote are each considered.
    const toRemove = [];
    const keptCatalog = new Set();
    for (const r of remoteTracks) {
      const catalog = String(r?.appleMusicId || '');
      if (!catalog) continue;
      if (!requestedCatalog.has(catalog)) {
        toRemove.push(r);
      } else if (keptCatalog.has(catalog)) {
        // Duplicate of a row we've already kept — remove to collapse.
        toRemove.push(r);
      } else {
        keptCatalog.add(catalog);
      }
    }
    const toAdd = [...requestedCatalog].filter(id => !keptCatalog.has(id));

    // DELETE pass. Skipped when the kill-switch is set (Apple 405'd us
    // earlier in this process). Also skipped when there's nothing to
    // remove.
    let removed = 0;
    if (!amRemovalUnsupportedRef.current && toRemove.length > 0) {
      removed = await this._deleteTracksFromPlaylist(playlistId, toRemove, token);
    }

    // POST pass.
    let added = 0;
    if (toAdd.length > 0) {
      added = await this._postTracksToPlaylist(playlistId, toAdd, developerToken, userToken);
    }

    const snapshot = await this.getPlaylistSnapshot(playlistId, token);
    console.log(`[AppleMusic] Playlist ${playlistId}: +${added} / −${removed}${amRemovalUnsupportedRef.current ? ' (removals unsupported in this session)' : ''}`);
    return { success: true, snapshotId: snapshot, added, removed };
  },

  // Internal: POST an add-batch of catalog IDs to the playlist's tracks
  // endpoint. Returns the number added (equals input length on success).
  async _postTracksToPlaylist(playlistId, catalogIds, developerToken, userToken) {
    const body = {
      data: catalogIds.map(id => ({ id: String(id), type: 'songs' }))
    };
    const resp = await fetch(
      `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}/tracks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${developerToken}`,
          'Music-User-Token': userToken,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );
    if (!resp.ok) {
      throw new Error(`Failed to add tracks to Apple Music playlist: ${resp.status}`);
    }
    return catalogIds.length;
  },

  // Internal: issue a DELETE per row against the undocumented per-track
  // endpoint. Rate-limited via getRateLimitDelay() to avoid 429s.
  // Handles per-response outcomes per the design doc:
  //   200/204/404 → success
  //   429         → Retry-After backoff + one retry, else abort loop
  //   405         → flip amRemovalUnsupportedRef and abort loop
  //   other       → log + skip this row, continue
  async _deleteTracksFromPlaylist(playlistId, rows, token) {
    const { developerToken, userToken } = JSON.parse(token);
    const delay = this.getRateLimitDelay ? this.getRateLimitDelay() : 150;
    let removed = 0;

    for (let i = 0; i < rows.length; i++) {
      const libraryTrackId = rows[i]?.externalId; // library ID stored by transformTrack
      if (!libraryTrackId) continue;

      const url = `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}/tracks/${encodeURIComponent(libraryTrackId)}`;

      let attempt = 0;
      while (true) {
        attempt++;
        const resp = await fetch(url, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${developerToken}`,
            'Music-User-Token': userToken
          }
        });

        if (resp.status === 200 || resp.status === 204 || resp.status === 404) {
          removed++;
          break;
        }

        if (resp.status === 405) {
          // Endpoint disabled — stop trying for this session. Append
          // semantics resume silently.
          console.warn(`[AppleMusic] DELETE returned 405; disabling per-track removal for the rest of this session. Playlist ${playlistId} retains ${rows.length - removed} extra track(s) on the remote.`);
          amRemovalUnsupportedRef.current = true;
          return removed;
        }

        if (resp.status === 429 && attempt === 1) {
          const retryAfter = parseInt(resp.headers.get('Retry-After') || '1', 10);
          await new Promise(r => setTimeout(r, Math.max(retryAfter, 1) * 1000));
          continue; // retry once
        }

        if (resp.status === 429) {
          console.warn(`[AppleMusic] DELETE repeatedly rate-limited on playlist ${playlistId}; aborting loop. ${rows.length - removed} track(s) still on remote.`);
          return removed;
        }

        // Other 4xx / 5xx: log and skip this row.
        console.warn(`[AppleMusic] DELETE ${libraryTrackId} returned ${resp.status}; skipping row.`);
        break;
      }

      // Rate-limit between successful DELETEs, not between retries.
      if (i < rows.length - 1) {
        await new Promise(r => setTimeout(r, delay));
      }
    }

    return removed;
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
