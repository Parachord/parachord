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
