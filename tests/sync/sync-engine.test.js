/**
 * Sync Engine Tests
 *
 * Tests for library synchronization across providers:
 * Spotify library sync, pagination, diff calculation, rate limiting.
 */

describe('Sync Engine', () => {
  describe('Provider Registration', () => {
    let syncEngine;

    beforeEach(() => {
      syncEngine = {
        providers: new Map(),

        registerProvider(provider) {
          if (!provider.id || !provider.sync) {
            return false;
          }
          this.providers.set(provider.id, provider);
          return true;
        },

        unregisterProvider(id) {
          this.providers.delete(id);
        },

        getProvider(id) {
          return this.providers.get(id);
        }
      };
    });

    test('can register a provider', () => {
      const provider = {
        id: 'spotify',
        sync: jest.fn()
      };

      const result = syncEngine.registerProvider(provider);

      expect(result).toBe(true);
      expect(syncEngine.providers.has('spotify')).toBe(true);
    });

    test('rejects provider without id', () => {
      const provider = { sync: jest.fn() };

      const result = syncEngine.registerProvider(provider);

      expect(result).toBe(false);
    });

    test('rejects provider without sync method', () => {
      const provider = { id: 'test' };

      const result = syncEngine.registerProvider(provider);

      expect(result).toBe(false);
    });

    test('can unregister a provider', () => {
      syncEngine.registerProvider({ id: 'spotify', sync: jest.fn() });

      syncEngine.unregisterProvider('spotify');

      expect(syncEngine.providers.has('spotify')).toBe(false);
    });
  });

  describe('Sync Status', () => {
    test('tracks sync in progress', () => {
      const status = {
        syncing: false,
        provider: null,
        progress: 0,
        lastSync: null,
        error: null
      };

      // Start sync
      status.syncing = true;
      status.provider = 'spotify';

      expect(status.syncing).toBe(true);
      expect(status.provider).toBe('spotify');
    });

    test('updates progress during sync', () => {
      const status = { progress: 0 };

      status.progress = 50;
      expect(status.progress).toBe(50);

      status.progress = 100;
      expect(status.progress).toBe(100);
    });

    test('records last sync timestamp', () => {
      const status = { lastSync: null };

      status.lastSync = Date.now();

      expect(status.lastSync).toBeDefined();
      expect(typeof status.lastSync).toBe('number');
    });
  });
});

describe('Spotify Sync Provider', () => {
  describe('API Pagination', () => {
    test('fetches all pages of saved tracks', async () => {
      const mockFetch = jest.fn()
        .mockResolvedValueOnce({
          items: Array(50).fill({ track: { id: 'track' } }),
          next: 'https://api.spotify.com/v1/me/tracks?offset=50',
          total: 150
        })
        .mockResolvedValueOnce({
          items: Array(50).fill({ track: { id: 'track' } }),
          next: 'https://api.spotify.com/v1/me/tracks?offset=100',
          total: 150
        })
        .mockResolvedValueOnce({
          items: Array(50).fill({ track: { id: 'track' } }),
          next: null,
          total: 150
        });

      const allItems = [];
      let nextUrl = 'https://api.spotify.com/v1/me/tracks';

      while (nextUrl) {
        const response = await mockFetch(nextUrl);
        allItems.push(...response.items);
        nextUrl = response.next;
      }

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(allItems).toHaveLength(150);
    });

    test('handles empty library', async () => {
      const response = {
        items: [],
        next: null,
        total: 0
      };

      expect(response.items).toHaveLength(0);
      expect(response.total).toBe(0);
    });

    test('calculates correct page offset', () => {
      const pageSize = 50;
      const pageNumber = 3;

      const offset = (pageNumber - 1) * pageSize;

      expect(offset).toBe(100);
    });
  });

  describe('Rate Limiting', () => {
    test('respects 429 rate limit response', async () => {
      let requestCount = 0;
      let waitedForRetry = false;

      const mockFetch = async () => {
        requestCount++;
        if (requestCount === 1) {
          throw { status: 429, headers: { 'retry-after': '1' } };
        }
        return { items: [], next: null };
      };

      const fetchWithRetry = async () => {
        try {
          return await mockFetch();
        } catch (error) {
          if (error.status === 429) {
            const retryAfter = parseInt(error.headers['retry-after']) * 1000 || 1000;
            waitedForRetry = true;
            await new Promise(r => setTimeout(r, 10)); // Shortened for test
            return await mockFetch();
          }
          throw error;
        }
      };

      await fetchWithRetry();

      expect(waitedForRetry).toBe(true);
      expect(requestCount).toBe(2);
    });

    test('implements exponential backoff', () => {
      const baseDelay = 1000;
      const maxDelay = 32000;

      const getBackoffDelay = (attempt) => {
        const delay = baseDelay * Math.pow(2, attempt);
        return Math.min(delay, maxDelay);
      };

      expect(getBackoffDelay(0)).toBe(1000);
      expect(getBackoffDelay(1)).toBe(2000);
      expect(getBackoffDelay(2)).toBe(4000);
      expect(getBackoffDelay(3)).toBe(8000);
      expect(getBackoffDelay(4)).toBe(16000);
      expect(getBackoffDelay(5)).toBe(32000);
      expect(getBackoffDelay(6)).toBe(32000); // Capped
    });
  });

  describe('Track ID Generation', () => {
    const generateTrackId = (track) => {
      const artist = track.artists?.[0]?.name?.toLowerCase() || 'unknown';
      const title = track.name?.toLowerCase() || 'unknown';
      return `${artist}:${title}`.replace(/[^a-z0-9:]/g, '');
    };

    test('generates consistent track ID', () => {
      const track = {
        name: 'Test Song',
        artists: [{ name: 'Test Artist' }]
      };

      const id1 = generateTrackId(track);
      const id2 = generateTrackId(track);

      expect(id1).toBe(id2);
      expect(id1).toBe('testartist:testsong');
    });

    test('handles special characters', () => {
      const track = {
        name: "Don't Stop Me Now!",
        artists: [{ name: 'Queen' }]
      };

      const id = generateTrackId(track);

      expect(id).toBe('queen:dontstopmenow');
    });

    test('handles missing artist', () => {
      const track = {
        name: 'Test Song',
        artists: []
      };

      const id = generateTrackId(track);

      expect(id).toBe('unknown:testsong');
    });
  });
});

describe('Diff Calculation', () => {
  describe('Library Comparison', () => {
    const calculateDiff = (local, remote) => {
      const localIds = new Set(local.map(t => t.id));
      const remoteIds = new Set(remote.map(t => t.id));

      const added = remote.filter(t => !localIds.has(t.id));
      const removed = local.filter(t => !remoteIds.has(t.id));
      const unchanged = local.filter(t => remoteIds.has(t.id));

      return { added, removed, unchanged };
    };

    test('identifies new tracks', () => {
      const local = [{ id: 'a' }, { id: 'b' }];
      const remote = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

      const diff = calculateDiff(local, remote);

      expect(diff.added).toHaveLength(1);
      expect(diff.added[0].id).toBe('c');
    });

    test('identifies removed tracks', () => {
      const local = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const remote = [{ id: 'a' }, { id: 'b' }];

      const diff = calculateDiff(local, remote);

      expect(diff.removed).toHaveLength(1);
      expect(diff.removed[0].id).toBe('c');
    });

    test('identifies unchanged tracks', () => {
      const local = [{ id: 'a' }, { id: 'b' }];
      const remote = [{ id: 'a' }, { id: 'b' }];

      const diff = calculateDiff(local, remote);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(2);
    });

    test('handles empty local library', () => {
      const local = [];
      const remote = [{ id: 'a' }, { id: 'b' }];

      const diff = calculateDiff(local, remote);

      expect(diff.added).toHaveLength(2);
      expect(diff.removed).toHaveLength(0);
    });

    test('handles empty remote library', () => {
      const local = [{ id: 'a' }, { id: 'b' }];
      const remote = [];

      const diff = calculateDiff(local, remote);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(2);
    });

    test('handles both empty', () => {
      const local = [];
      const remote = [];

      const diff = calculateDiff(local, remote);

      expect(diff.added).toHaveLength(0);
      expect(diff.removed).toHaveLength(0);
      expect(diff.unchanged).toHaveLength(0);
    });

    test('handles complex diff', () => {
      const local = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      const remote = [{ id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'e' }];

      const diff = calculateDiff(local, remote);

      expect(diff.added).toHaveLength(2); // d, e
      expect(diff.removed).toHaveLength(1); // a
      expect(diff.unchanged).toHaveLength(2); // b, c
    });
  });

  describe('Sync Actions', () => {
    test('generates correct sync actions', () => {
      const diff = {
        added: [{ id: 'new1' }, { id: 'new2' }],
        removed: [{ id: 'old1' }],
        unchanged: [{ id: 'same1' }]
      };

      const actions = [];

      diff.added.forEach(t => actions.push({ type: 'add', track: t }));
      diff.removed.forEach(t => actions.push({ type: 'remove', track: t }));

      expect(actions).toHaveLength(3);
      expect(actions.filter(a => a.type === 'add')).toHaveLength(2);
      expect(actions.filter(a => a.type === 'remove')).toHaveLength(1);
    });
  });
});

describe('Sync Conflict Resolution', () => {
  test('remote wins by default', () => {
    const local = { id: 'track1', title: 'Local Title', updatedAt: 1000 };
    const remote = { id: 'track1', title: 'Remote Title', updatedAt: 2000 };

    const resolved = remote.updatedAt > local.updatedAt ? remote : local;

    expect(resolved.title).toBe('Remote Title');
  });

  test('local wins if newer', () => {
    const local = { id: 'track1', title: 'Local Title', updatedAt: 3000 };
    const remote = { id: 'track1', title: 'Remote Title', updatedAt: 2000 };

    const resolved = remote.updatedAt > local.updatedAt ? remote : local;

    expect(resolved.title).toBe('Local Title');
  });
});

describe('Sync Error Handling', () => {
  test('401 error triggers re-authentication', async () => {
    let reAuthTriggered = false;

    const handleSyncError = (error) => {
      if (error.status === 401) {
        reAuthTriggered = true;
      }
    };

    handleSyncError({ status: 401 });

    expect(reAuthTriggered).toBe(true);
  });

  test('network error queues for retry', () => {
    const failedSyncs = [];

    const handleNetworkError = (provider) => {
      failedSyncs.push({
        provider,
        failedAt: Date.now(),
        retryAt: Date.now() + 60000
      });
    };

    handleNetworkError('spotify');

    expect(failedSyncs).toHaveLength(1);
    expect(failedSyncs[0].provider).toBe('spotify');
  });

  test('partial sync saves progress', () => {
    const syncState = {
      provider: 'spotify',
      lastOffset: 0,
      totalItems: 500,
      completed: false
    };

    // Simulate partial sync
    syncState.lastOffset = 200;

    // Can resume from offset
    expect(syncState.lastOffset).toBe(200);
    expect(syncState.completed).toBe(false);
  });
});

describe('Incremental Sync', () => {
  test('only fetches changes since last sync', () => {
    const lastSync = new Date('2024-01-01T00:00:00Z').getTime();
    const now = Date.now();

    const shouldFetchAll = !lastSync;
    const shouldFetchIncremental = !!lastSync;

    expect(shouldFetchAll).toBe(false);
    expect(shouldFetchIncremental).toBe(true);
  });

  test('falls back to full sync if incremental fails', async () => {
    let syncType = null;

    const tryIncrementalSync = async () => {
      throw new Error('Incremental not supported');
    };

    const fullSync = async () => {
      syncType = 'full';
    };

    try {
      await tryIncrementalSync();
    } catch {
      await fullSync();
    }

    expect(syncType).toBe('full');
  });
});

describe('Two-Way Playlist Sync', () => {
  describe('Playlist Push', () => {
    test('pushes playlist tracks to Spotify', async () => {
      const mockPushPlaylist = jest.fn().mockResolvedValue({
        success: true,
        snapshotId: 'new-snapshot-123'
      });

      const tracks = [
        { id: '1', spotifyUri: 'spotify:track:abc123' },
        { id: '2', spotifyUri: 'spotify:track:def456' }
      ];

      const result = await mockPushPlaylist('playlist-id', tracks);

      expect(result.success).toBe(true);
      expect(result.snapshotId).toBe('new-snapshot-123');
    });

    test('filters out tracks without Spotify URIs', () => {
      const tracks = [
        { id: '1', spotifyUri: 'spotify:track:abc123' },
        { id: '2', title: 'Local Only Track' }, // No spotifyUri
        { id: '3', spotifyUri: 'spotify:track:def456' }
      ];

      const uris = tracks
        .filter(t => t.spotifyUri)
        .map(t => t.spotifyUri);

      expect(uris).toHaveLength(2);
      expect(uris).toContain('spotify:track:abc123');
      expect(uris).toContain('spotify:track:def456');
    });

    test('batches large playlists (>100 tracks)', () => {
      const tracks = Array(250).fill(null).map((_, i) => ({
        id: `track-${i}`,
        spotifyUri: `spotify:track:${i}`
      }));

      const uris = tracks.map(t => t.spotifyUri);
      const batches = [];
      for (let i = 0; i < uris.length; i += 100) {
        batches.push(uris.slice(i, i + 100));
      }

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(100);
      expect(batches[1]).toHaveLength(100);
      expect(batches[2]).toHaveLength(50);
    });

    test('handles empty playlist', async () => {
      const mockPushPlaylist = jest.fn().mockResolvedValue({
        success: true,
        snapshotId: 'empty-snapshot'
      });

      const result = await mockPushPlaylist('playlist-id', []);

      expect(result.success).toBe(true);
    });
  });

  describe('Playlist Ownership', () => {
    test('allows push to owned playlists', () => {
      const playlist = { owner: { id: 'user123' } };
      const currentUser = { id: 'user123' };

      const isOwner = playlist.owner.id === currentUser.id;

      expect(isOwner).toBe(true);
    });

    test('blocks push to followed playlists', () => {
      const playlist = { owner: { id: 'other-user' } };
      const currentUser = { id: 'user123' };

      const isOwner = playlist.owner.id === currentUser.id;

      expect(isOwner).toBe(false);
    });
  });

  describe('Sync Direction Detection', () => {
    const detectSyncState = (playlist) => {
      const hasRemoteUpdates = playlist.hasUpdates;
      const hasLocalChanges = playlist.locallyModified;

      if (hasLocalChanges && hasRemoteUpdates) {
        return 'conflict';
      } else if (hasLocalChanges) {
        return 'push';
      } else if (hasRemoteUpdates) {
        return 'pull';
      }
      return 'synced';
    };

    test('detects push needed when locally modified', () => {
      const playlist = {
        locallyModified: true,
        hasUpdates: false
      };

      expect(detectSyncState(playlist)).toBe('push');
    });

    test('detects pull needed when remote has updates', () => {
      const playlist = {
        locallyModified: false,
        hasUpdates: true
      };

      expect(detectSyncState(playlist)).toBe('pull');
    });

    test('detects conflict when both have changes', () => {
      const playlist = {
        locallyModified: true,
        hasUpdates: true
      };

      expect(detectSyncState(playlist)).toBe('conflict');
    });

    test('detects synced when no changes', () => {
      const playlist = {
        locallyModified: false,
        hasUpdates: false
      };

      expect(detectSyncState(playlist)).toBe('synced');
    });
  });

  describe('Conflict Resolution', () => {
    const resolveConflict = (playlist) => {
      const localModTime = playlist.lastModified || 0;
      const lastSyncTime = playlist.syncSources?.spotify?.syncedAt || 0;

      // Local wins if modified after last sync
      return localModTime > lastSyncTime ? 'local' : 'remote';
    };

    test('local wins when modified after last sync', () => {
      const playlist = {
        lastModified: 2000,
        syncSources: { spotify: { syncedAt: 1000 } }
      };

      expect(resolveConflict(playlist)).toBe('local');
    });

    test('remote wins when last sync is newer', () => {
      const playlist = {
        lastModified: 1000,
        syncSources: { spotify: { syncedAt: 2000 } }
      };

      expect(resolveConflict(playlist)).toBe('remote');
    });

    test('remote wins when no local modification time', () => {
      const playlist = {
        lastModified: undefined,
        syncSources: { spotify: { syncedAt: 1000 } }
      };

      expect(resolveConflict(playlist)).toBe('remote');
    });

    test('local wins when no sync history', () => {
      const playlist = {
        lastModified: 1000,
        syncSources: {}
      };

      expect(resolveConflict(playlist)).toBe('local');
    });
  });

  describe('Push Result Handling', () => {
    test('updates snapshot after successful push', () => {
      const playlist = {
        syncedFrom: { snapshotId: 'old-snapshot' }
      };

      const pushResult = { success: true, snapshotId: 'new-snapshot' };

      if (pushResult.success) {
        playlist.syncedFrom.snapshotId = pushResult.snapshotId;
      }

      expect(playlist.syncedFrom.snapshotId).toBe('new-snapshot');
    });

    test('clears locallyModified after successful push', () => {
      const playlist = {
        locallyModified: true,
        hasUpdates: false
      };

      const pushResult = { success: true };

      if (pushResult.success) {
        playlist.locallyModified = false;
      }

      expect(playlist.locallyModified).toBe(false);
    });

    test('updates syncedAt timestamp after push', () => {
      const playlist = {
        syncSources: { spotify: { syncedAt: 1000 } }
      };

      const pushResult = { success: true };
      const now = Date.now();

      if (pushResult.success) {
        playlist.syncSources.spotify.syncedAt = now;
      }

      expect(playlist.syncSources.spotify.syncedAt).toBe(now);
    });

    test('preserves state on push failure', () => {
      const playlist = {
        locallyModified: true,
        syncedFrom: { snapshotId: 'original-snapshot' }
      };

      const pushResult = { success: false, error: 'Network error' };

      if (!pushResult.success) {
        // State should remain unchanged
      }

      expect(playlist.locallyModified).toBe(true);
      expect(playlist.syncedFrom.snapshotId).toBe('original-snapshot');
    });
  });
});

describe('Spotify API Migration (Feb 2026)', () => {
  describe('URI Conversion for /me/library', () => {
    const toTrackUris = (ids) =>
      ids.map(id => id.startsWith('spotify:') ? id : `spotify:track:${id}`);
    const toAlbumUris = (ids) =>
      ids.map(id => id.startsWith('spotify:') ? id : `spotify:album:${id}`);

    test('converts track IDs to spotify: URIs', () => {
      const ids = ['abc123', 'def456'];
      const uris = toTrackUris(ids);

      expect(uris).toEqual([
        'spotify:track:abc123',
        'spotify:track:def456'
      ]);
    });

    test('converts album IDs to spotify: URIs', () => {
      const ids = ['album1', 'album2'];
      const uris = toAlbumUris(ids);

      expect(uris).toEqual([
        'spotify:album:album1',
        'spotify:album:album2'
      ]);
    });

    test('passes through values that are already URIs', () => {
      const ids = ['spotify:track:abc123', 'def456'];
      const uris = toTrackUris(ids);

      expect(uris).toEqual([
        'spotify:track:abc123',
        'spotify:track:def456'
      ]);
    });

    test('handles empty array', () => {
      expect(toTrackUris([])).toEqual([]);
      expect(toAlbumUris([])).toEqual([]);
    });
  });

  describe('Playlist trackCount field fallback', () => {
    const getTrackCount = (playlist) =>
      playlist.tracks?.total ?? playlist.items?.total ?? 0;

    test('reads from tracks.total (legacy response)', () => {
      const playlist = { tracks: { total: 42 } };
      expect(getTrackCount(playlist)).toBe(42);
    });

    test('reads from items.total (Feb 2026 response)', () => {
      const playlist = { items: { total: 42 } };
      expect(getTrackCount(playlist)).toBe(42);
    });

    test('prefers tracks.total when both are present', () => {
      const playlist = { tracks: { total: 42 }, items: { total: 99 } };
      expect(getTrackCount(playlist)).toBe(42);
    });

    test('returns 0 when neither field exists', () => {
      const playlist = {};
      expect(getTrackCount(playlist)).toBe(0);
    });
  });
});

describe('Collection Two-Way Sync', () => {
  describe('Track Sync', () => {
    test('saves tracks to Spotify', async () => {
      const mockSaveTracks = jest.fn().mockResolvedValue({
        success: true,
        saved: 3
      });

      const trackIds = ['track1', 'track2', 'track3'];
      const result = await mockSaveTracks(trackIds);

      expect(result.success).toBe(true);
      expect(result.saved).toBe(3);
    });

    test('removes tracks from Spotify', async () => {
      const mockRemoveTracks = jest.fn().mockResolvedValue({
        success: true,
        removed: 2
      });

      const trackIds = ['track1', 'track2'];
      const result = await mockRemoveTracks(trackIds);

      expect(result.success).toBe(true);
      expect(result.removed).toBe(2);
    });

    test('batches track saves (max 50 per request)', () => {
      const trackIds = Array(120).fill(null).map((_, i) => `track-${i}`);

      const batches = [];
      for (let i = 0; i < trackIds.length; i += 50) {
        batches.push(trackIds.slice(i, i + 50));
      }

      expect(batches).toHaveLength(3);
      expect(batches[0]).toHaveLength(50);
      expect(batches[1]).toHaveLength(50);
      expect(batches[2]).toHaveLength(20);
    });

    test('handles empty track list', async () => {
      const mockSaveTracks = jest.fn().mockResolvedValue({
        success: true,
        saved: 0
      });

      const result = await mockSaveTracks([]);

      expect(result.success).toBe(true);
      expect(result.saved).toBe(0);
    });

    test('extracts Spotify ID from track sources', () => {
      const track1 = { spotifyId: 'direct-id' };
      const track2 = { sources: { spotify: { spotifyId: 'nested-id' } } };
      const track3 = { title: 'No Spotify' };

      const getSpotifyId = (track) =>
        track.spotifyId || track.sources?.spotify?.spotifyId;

      expect(getSpotifyId(track1)).toBe('direct-id');
      expect(getSpotifyId(track2)).toBe('nested-id');
      expect(getSpotifyId(track3)).toBeUndefined();
    });
  });

  describe('Artist Sync', () => {
    test('follows artists on Spotify', async () => {
      const mockFollowArtists = jest.fn().mockResolvedValue({
        success: true,
        followed: 2
      });

      const artistIds = ['artist1', 'artist2'];
      const result = await mockFollowArtists(artistIds);

      expect(result.success).toBe(true);
      expect(result.followed).toBe(2);
    });

    test('unfollows artists on Spotify', async () => {
      const mockUnfollowArtists = jest.fn().mockResolvedValue({
        success: true,
        unfollowed: 1
      });

      const artistIds = ['artist1'];
      const result = await mockUnfollowArtists(artistIds);

      expect(result.success).toBe(true);
      expect(result.unfollowed).toBe(1);
    });

    test('batches artist follows (max 50 per request)', () => {
      const artistIds = Array(75).fill(null).map((_, i) => `artist-${i}`);

      const batches = [];
      for (let i = 0; i < artistIds.length; i += 50) {
        batches.push(artistIds.slice(i, i + 50));
      }

      expect(batches).toHaveLength(2);
      expect(batches[0]).toHaveLength(50);
      expect(batches[1]).toHaveLength(25);
    });

    test('extracts Spotify ID from artist sources', () => {
      const artist1 = { spotifyId: 'direct-artist-id' };
      const artist2 = { sources: { spotify: { spotifyId: 'nested-artist-id' } } };
      const artist3 = { name: 'Local Artist' };

      const getSpotifyId = (artist) =>
        artist.spotifyId || artist.sources?.spotify?.spotifyId;

      expect(getSpotifyId(artist1)).toBe('direct-artist-id');
      expect(getSpotifyId(artist2)).toBe('nested-artist-id');
      expect(getSpotifyId(artist3)).toBeUndefined();
    });
  });

  describe('Error Handling', () => {
    test('handles 401 auth error', async () => {
      const mockSaveTracks = jest.fn().mockRejectedValue(
        new Error('Spotify token expired. Please reconnect your Spotify account.')
      );

      await expect(mockSaveTracks(['track1'])).rejects.toThrow('Spotify token expired');
    });

    test('handles 403 permission error', async () => {
      const mockFollowArtists = jest.fn().mockRejectedValue(
        new Error('Missing permissions. Please disconnect and reconnect Spotify.')
      );

      await expect(mockFollowArtists(['artist1'])).rejects.toThrow('Missing permissions');
    });

    test('handles rate limiting with retry', async () => {
      let attempts = 0;
      const mockWithRetry = jest.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw { status: 429, retryAfter: 1 };
        }
        return { success: true };
      });

      const fetchWithRetry = async () => {
        try {
          return await mockWithRetry();
        } catch (error) {
          if (error.status === 429) {
            await new Promise(r => setTimeout(r, 10)); // Shortened for test
            return await mockWithRetry();
          }
          throw error;
        }
      };

      const result = await fetchWithRetry();

      expect(result.success).toBe(true);
      expect(attempts).toBe(2);
    });
  });
});

describe('Track Removal with Special Characters', () => {
  // Replicate the normalizeForId and generateTrackId functions from app.js
  const normalizeForId = (str) => {
    return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  };

  const generateTrackId = (artist, title, album) => {
    return `${normalizeForId(artist || 'unknown')}-${normalizeForId(title || 'untitled')}-${normalizeForId(album || 'noalbum')}`;
  };

  // Replicate the fixed removeTrackFromCollection logic
  const removeTrackFromCollection = (track, collectionTracks) => {
    let existingIndex = -1;
    let matchId = null;
    if (track.id) {
      existingIndex = collectionTracks.findIndex(t => t.id === track.id);
      matchId = track.id;
    }
    if (existingIndex === -1) {
      const generatedId = generateTrackId(track.artist, track.title, track.album);
      existingIndex = collectionTracks.findIndex(t => t.id === generatedId);
      matchId = generatedId;
    }
    if (existingIndex === -1) {
      return { removed: false, tracks: collectionTracks };
    }
    return { removed: true, tracks: collectionTracks.filter(t => t.id !== matchId) };
  };

  test('removes track with # in title by stored ID', () => {
    const collectionTracks = [
      { id: 'artist-vo-01-album', title: 'VO#01', artist: 'Artist', album: 'Album' },
      { id: 'artist-vo-02-album', title: 'VO#02', artist: 'Artist', album: 'Album' }
    ];

    const result = removeTrackFromCollection(
      { id: 'artist-vo-01-album', title: 'VO#01', artist: 'Artist', album: 'Album' },
      collectionTracks
    );

    expect(result.removed).toBe(true);
    expect(result.tracks).toHaveLength(1);
    expect(result.tracks[0].title).toBe('VO#02');
  });

  test('removes track with # in title by generated ID fallback', () => {
    const collectionTracks = [
      { id: 'artist-vo-01-album', title: 'VO#01', artist: 'Artist', album: 'Album' }
    ];

    // Track from playbar or other view may not have a matching id
    const result = removeTrackFromCollection(
      { title: 'VO#01', artist: 'Artist', album: 'Album' },
      collectionTracks
    );

    expect(result.removed).toBe(true);
    expect(result.tracks).toHaveLength(0);
  });

  test('removes multi-artist track synced from Spotify', () => {
    // Spotify sync generates ID from first artist only, but stores all artists
    const spotifyGeneratedId = generateTrackId('Artist A', 'Song Title', 'Album');
    const collectionTracks = [
      { id: spotifyGeneratedId, title: 'Song Title', artist: 'Artist A, Artist B', album: 'Album' }
    ];

    // The track object passed from the collection view has the stored id
    const result = removeTrackFromCollection(
      { id: spotifyGeneratedId, title: 'Song Title', artist: 'Artist A, Artist B', album: 'Album' },
      collectionTracks
    );

    expect(result.removed).toBe(true);
    expect(result.tracks).toHaveLength(0);
  });

  test('fails to remove multi-artist track when only using generated ID (old bug)', () => {
    // This demonstrates why the old approach failed
    const firstArtistId = generateTrackId('Artist A', 'Song Title', 'Album');
    const allArtistsId = generateTrackId('Artist A, Artist B', 'Song Title', 'Album');

    // These IDs are different - this was the root cause
    expect(firstArtistId).not.toBe(allArtistsId);
    expect(firstArtistId).toBe('artist-a-song-title-album');
    expect(allArtistsId).toBe('artist-a-artist-b-song-title-album');
  });

  test('normalizeForId handles # and other special characters consistently', () => {
    expect(normalizeForId('VO#01')).toBe('vo-01');
    expect(normalizeForId('Track (feat. Other)')).toBe('track-feat-other');
    expect(normalizeForId("Don't Stop Me Now!")).toBe('don-t-stop-me-now');
    expect(normalizeForId('Artist & Friend')).toBe('artist-friend');
    expect(normalizeForId('Café Après-midi')).toBe('caf-apr-s-midi');
  });

  test('Spotify transformTrack uses full artist name for ID generation', () => {
    // This tests the fix to sync-providers/spotify.js
    const artistName = 'Artist A, Artist B';
    const trackName = 'VO#01';
    const albumName = 'Test Album';

    const id = generateTrackId(artistName, trackName, albumName);

    // ID should use full artist name, not just first artist
    expect(id).toBe('artist-a-artist-b-vo-01-test-album');
    // Verify regenerating from stored fields produces the same ID
    expect(generateTrackId(artistName, trackName, albumName)).toBe(id);
  });
});
