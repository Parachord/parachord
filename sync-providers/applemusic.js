/**
 * Apple Music Sync Provider
 * Implements the SyncProvider interface for Apple Music library sync.
 *
 * Uses MusicKit JS in the renderer process to access the user's library.
 * Requires both a developer token (app-level) and user token (per-user auth).
 */

const APPLE_MUSIC_API_BASE = 'https://api.music.apple.com/v1';

// Session-scoped kill-switch for PUT /tracks (full-replace). Apple's public
// Library Playlists API documents only POST (append). Third-party clients
// (Cider, etc.) use PUT /tracks with the full desired tracklist to achieve
// replace semantics, but they route via Apple's private `amp-api.music.apple.com`
// host. On the public `api.music.apple.com` PUT may return 401/403/405 —
// Apple's developer forum threads confirm DELETE/PUT on library resources
// are "not supported" on the public API. If we see a hard rejection from
// PUT we flip this flag and degrade to append-only for the rest of the
// process, so the rest of the sync still makes progress. Resets on app
// restart so we re-probe after Apple or infra changes.
const amPutUnsupportedRef = { current: false };

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
   * Attempt to delete a playlist from the user's Apple Music library.
   *
   * Apple's public Library Playlists API documents no DELETE — the
   * endpoint returns 401/403 for MusicKit-issued user tokens. Cider and
   * other third-party clients reach a working DELETE via the private
   * `amp-api.music.apple.com` host, which we don't use. So this is
   * strictly best-effort: we try DELETE on the documented host once and
   * report the outcome honestly. Callers should tolerate failure and
   * surface "delete it manually in the Music app" to the user.
   *
   * Returns `{ success: true }` on a successful delete. Returns
   * `{ success: false, reason, status }` when Apple rejects the request —
   * callers can distinguish this from a thrown error (network failure,
   * unexpected 5xx) which still throws.
   *
   * @param {string} playlistId - Apple Music library playlist ID
   * @param {string} token - JSON string with developerToken and userToken
   * @param {function} [refreshTokenCb] - Optional async callback to refresh token on 401
   */
  async deletePlaylist(playlistId, token, refreshTokenCb) {
    const attemptDelete = async (currentToken) => {
      const { developerToken, userToken } = JSON.parse(currentToken);
      return fetch(
        `${APPLE_MUSIC_API_BASE}/me/library/playlists/${playlistId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${developerToken}`,
            'Music-User-Token': userToken
          }
        }
      );
    };

    let resp = await attemptDelete(token);

    // 401 is sometimes a stale session, so a single refresh+retry is
    // cheap and occasionally helps. Apple more often returns 401 here as
    // a permanent endpoint rejection; the retry is defensive.
    if ((resp.status === 401 || resp.status === 403) && refreshTokenCb) {
      const newToken = await refreshTokenCb();
      if (newToken) {
        token = newToken;
        resp = await attemptDelete(token);
      }
    }

    if (resp.ok || resp.status === 204 || resp.status === 202) {
      return { success: true };
    }

    // 404: already gone — idempotent success.
    if (resp.status === 404) {
      return { success: true, alreadyGone: true };
    }

    // 401/403/405: endpoint-level rejection. Known behavior on the
    // public Apple Music API. Report honestly instead of retrying with
    // a no-op rename (PATCH returns the same 401).
    if (resp.status === 401 || resp.status === 403 || resp.status === 405) {
      console.warn(`[AppleMusic] DELETE playlist ${playlistId} rejected by Apple (${resp.status}). Public API does not support library playlist deletion; user must remove it in the Music app.`);
      return {
        success: false,
        reason: 'endpoint-unsupported',
        status: resp.status,
        message: 'Apple Music\u2019s public API doesn\u2019t support deleting library playlists. Remove it manually in the Music app.'
      };
    }

    // Unexpected — let callers handle.
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
  // Apple's *documented* Library Playlists API exposes only POST (append)
  // for playlist tracks. Empirically, third-party clients (Cider in
  // particular) achieve full-replace semantics by calling PUT on the same
  // `/me/library/playlists/{id}/tracks` endpoint with the full desired
  // tracklist in the body — Apple's private `amp-api.music.apple.com` host
  // serves this reliably; the public host is documented as not supporting
  // DELETE/PUT on library resources. We still try it first on the public
  // host since POST works there and PUT on the same resource is the
  // cleanest path if Apple lets it through.
  //
  // Algorithm:
  //   1. Dedupe the requested catalog IDs, preserve order.
  //   2. Fetch current remote state so we can report accurate added /
  //      removed counts (PUT doesn't echo a diff).
  //   3. If nothing changed, skip entirely.
  //   4. If changes are purely additive (no removals), POST them — both
  //      paths work equivalently when only adding, and POST is the
  //      documented path, so prefer it.
  //   5. Otherwise PUT the full desired list. On failure, flip the
  //      session kill-switch and degrade to append-only (POST just the
  //      new additions). The removals persist on the remote but the
  //      additions still land — same failure mode as the previous DELETE
  //      implementation.
  async updatePlaylistTracks(playlistId, tracks, token) {
    const { developerToken, userToken } = JSON.parse(token);

    // Dedupe requested catalog IDs, preserve order.
    const seen = new Set();
    const desiredCatalog = [];
    for (const t of tracks || []) {
      const id = String(t?.appleMusicCatalogId || t?.appleMusicId || '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      desiredCatalog.push(id);
    }

    // Fetch current remote state. Needed both for (a) computing the diff
    // counts we return to callers, and (b) deciding whether a removal is
    // actually required (if everything on the remote is still desired,
    // we can POST-append and avoid even attempting PUT).
    let currentCatalog = new Set();
    let remoteCount = 0;
    try {
      const current = await this.fetchPlaylistTracks(playlistId, token);
      remoteCount = current.length;
      currentCatalog = new Set(
        current.map(r => String(r?.appleMusicId || '')).filter(Boolean)
      );
    } catch (err) {
      console.warn(`[AppleMusic] Could not fetch existing tracks for ${playlistId}; assuming empty and falling back to append:`, err.message);
      // Fall through with empty currentCatalog; treat as fresh push.
    }

    const toAdd = desiredCatalog.filter(id => !currentCatalog.has(id));
    const removedCount = [...currentCatalog].filter(id => !seen.has(id)).length;
    // Collapse duplicate remote rows that would otherwise persist after
    // an additive-only push. If the remote has 2 copies of a catalog ID
    // that we want to keep exactly 1 copy of, we need PUT to rewrite the
    // list — a naive POST-append wouldn't fix it.
    const duplicateCount = Math.max(0, remoteCount - currentCatalog.size);
    const needsReplace = removedCount > 0 || duplicateCount > 0;

    // Nothing to do.
    if (toAdd.length === 0 && !needsReplace) {
      const snapshot = await this.getPlaylistSnapshot(playlistId, token);
      return { success: true, snapshotId: snapshot, added: 0, removed: 0 };
    }

    // Purely additive and no duplicates to collapse — POST is enough.
    if (!needsReplace && toAdd.length > 0) {
      const added = await this._postTracksToPlaylist(
        playlistId, toAdd, developerToken, userToken
      );
      const snapshot = await this.getPlaylistSnapshot(playlistId, token);
      console.log(`[AppleMusic] Playlist ${playlistId}: +${added} / −0 (POST append)`);
      return { success: true, snapshotId: snapshot, added, removed: 0 };
    }

    // Need full replace. Try PUT (unless the session kill-switch fired).
    if (!amPutUnsupportedRef.current) {
      try {
        await this._putTracksToPlaylist(
          playlistId, desiredCatalog, developerToken, userToken
        );
        const snapshot = await this.getPlaylistSnapshot(playlistId, token);
        console.log(`[AppleMusic] Playlist ${playlistId}: +${toAdd.length} / −${removedCount}${duplicateCount > 0 ? ` (−${duplicateCount} dup)` : ''} (PUT replace)`);
        return {
          success: true,
          snapshotId: snapshot,
          added: toAdd.length,
          removed: removedCount + duplicateCount
        };
      } catch (err) {
        // Treat 401/403/405 as endpoint-level rejection: flip the
        // session kill-switch so we don't retry every playlist. Other
        // errors we let bubble up if the additive fallback also fails.
        if (err?.status === 401 || err?.status === 403 || err?.status === 405) {
          amPutUnsupportedRef.current = true;
          console.warn(`[AppleMusic] PUT /tracks returned ${err.status} — disabling PUT replace for this session. Playlists will push additions only (removals persist on remote).`);
        } else {
          console.warn(`[AppleMusic] PUT /tracks failed for ${playlistId}: ${err.message}. Falling back to append-only.`);
        }
      }
    }

    // Degraded path: POST the additions, leave removals in place.
    let added = 0;
    if (toAdd.length > 0) {
      added = await this._postTracksToPlaylist(
        playlistId, toAdd, developerToken, userToken
      );
    }
    const snapshot = await this.getPlaylistSnapshot(playlistId, token);
    console.log(`[AppleMusic] Playlist ${playlistId}: +${added} / −0 (PUT unsupported — ${removedCount + duplicateCount} track(s) retained on remote)`);
    return {
      success: true,
      snapshotId: snapshot,
      added,
      removed: 0,
      replaceUnsupported: true
    };
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

  // Internal: PUT the full desired tracklist to the playlist's tracks
  // endpoint. On success Apple replaces the playlist's contents with the
  // given list (replace-all semantics, matching Spotify's PUT behavior).
  //
  // Throws an Error whose `.status` field matches the HTTP response for
  // non-2xx outcomes, so the caller can distinguish endpoint-rejection
  // (401/403/405) from transient failures.
  async _putTracksToPlaylist(playlistId, catalogIds, developerToken, userToken) {
    const body = {
      data: catalogIds.map(id => ({ id: String(id), type: 'songs' }))
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
      const err = new Error(`PUT /tracks returned ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    return catalogIds.length;
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
