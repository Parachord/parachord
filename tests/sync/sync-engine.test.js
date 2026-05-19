/**
 * Sync Engine Tests
 *
 * Tests for library synchronization across providers:
 * Spotify library sync, pagination, diff calculation, rate limiting.
 */

const { canShortCircuitPlaylistUpdate, staggerPlaylistsForCycle, syncDataType, areOrderedIdListsEquivalent } = require('../../sync-engine');

describe('staggerPlaylistsForCycle (oldest-stale-first batching, see parachord#800)', () => {
  // Helper to build a remote-shape playlist (what fetchPlaylists returns).
  const remote = (externalId) => ({ externalId, name: `Playlist ${externalId}` });

  // Helper to build a local-shape playlist (what's in `local_playlists`).
  const local = ({ id, externalId, syncedAt, hasUpdates, lastModified }) => ({
    id: id || `spotify-${externalId}`,
    title: `Playlist ${externalId}`,
    syncedFrom: { resolver: 'spotify', externalId },
    syncSources: syncedAt != null ? { spotify: { syncedAt } } : {},
    hasUpdates: !!hasUpdates,
    lastModified: lastModified || 0
  });

  test('returns all when count <= batchSize', () => {
    const selected = [remote('a'), remote('b'), remote('c')];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: [],
      providerId: 'spotify',
      batchSize: 10
    });
    expect(result).toHaveLength(3);
  });

  test('takes top N when count > batchSize', () => {
    const selected = Array.from({ length: 50 }, (_, i) => remote(`p${i}`));
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: [],
      providerId: 'spotify',
      batchSize: 15
    });
    expect(result).toHaveLength(15);
  });

  test('hasUpdates does NOT jump the queue (parachord#835 starvation fix)', () => {
    // hasUpdates is a state flag (banner visible to user), not a sort
    // priority. Re-running sync on a hasUpdates=true playlist confirms
    // what we already know; meanwhile the syncedAt-asc tail starves and
    // never discovers new updates. Pure syncedAt-asc ordering means the
    // oldest-stale playlist wins regardless of hasUpdates state.
    const selected = [remote('a'), remote('b'), remote('c')];
    const locals = [
      local({ externalId: 'a', syncedAt: 1000 }),                       // fresh, no updates
      local({ externalId: 'b', syncedAt: 500, hasUpdates: true }),      // middle-aged, has updates
      local({ externalId: 'c', syncedAt: 100 }),                        // oldest, no updates
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'spotify',
      batchSize: 2
    });
    expect(result[0].externalId).toBe('c'); // oldest syncedAt wins
    expect(result[1].externalId).toBe('b'); // hasUpdates is irrelevant to position
  });

  test('many hasUpdates-true playlists do NOT monopolize the batch (parachord#835)', () => {
    // Real-world repro: a user with 96 hasUpdates=true playlists
    // (accumulated pending pulls they haven't acted on) and one
    // stale-but-undetected-yet playlist (Daily Brew) at syncedAt=
    // yesterday. With the old hasUpdates-first sort, Daily Brew sits at
    // position 97 every cycle and never gets discovered. With the fix,
    // the oldest-stale entry wins regardless of how many hasUpdates-true
    // playlists exist.
    const NOW = 1_000_000;
    const stale = remote('stale');
    const pending = Array.from({ length: 50 }, (_, i) => remote(`p${i}`));
    const selected = [...pending, stale];
    const locals = [
      // 50 playlists with hasUpdates=true and FRESH syncedAt (today)
      ...pending.map((r, i) =>
        local({ externalId: r.externalId, syncedAt: NOW - i, hasUpdates: true })
      ),
      // The starvation victim: syncedAt is YESTERDAY, no hasUpdates yet
      local({ externalId: 'stale', syncedAt: NOW - 24 * 60 * 60 * 1000 }),
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'spotify',
      batchSize: 15
    });
    expect(result[0].externalId).toBe('stale'); // wins by syncedAt-asc
    expect(result.length).toBe(15);
  });

  test('among non-hasUpdates, oldest syncedAt comes first', () => {
    const selected = [remote('a'), remote('b'), remote('c')];
    const locals = [
      local({ externalId: 'a', syncedAt: 3000 }),
      local({ externalId: 'b', syncedAt: 1000 }),
      local({ externalId: 'c', syncedAt: 2000 }),
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'spotify',
      batchSize: 3
    });
    expect(result.map(r => r.externalId)).toEqual(['b', 'c', 'a']);
  });

  test('never-synced playlists (no syncSources entry) sort to top via 0-syncedAt', () => {
    const selected = [remote('new'), remote('old'), remote('newer')];
    const locals = [
      // 'new' has no local entry — first import; treated as syncedAt 0
      local({ externalId: 'old', syncedAt: 100 }),
      local({ externalId: 'newer', syncedAt: 200 }),
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'spotify',
      batchSize: 3
    });
    expect(result[0].externalId).toBe('new');   // no local match → 0 syncedAt → top
    expect(result[1].externalId).toBe('old');
    expect(result[2].externalId).toBe('newer');
  });

  test('lastModified descending breaks ties in syncedAt', () => {
    const selected = [remote('a'), remote('b'), remote('c')];
    const locals = [
      local({ externalId: 'a', syncedAt: 1000, lastModified: 500 }),
      local({ externalId: 'b', syncedAt: 1000, lastModified: 2000 }),
      local({ externalId: 'c', syncedAt: 1000, lastModified: 1000 }),
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'spotify',
      batchSize: 3
    });
    // All same syncedAt → lastModified desc: b > c > a
    expect(result.map(r => r.externalId)).toEqual(['b', 'c', 'a']);
  });

  test('matches local playlist via syncedFrom.externalId', () => {
    const selected = [remote('xyz')];
    const locals = [
      local({ externalId: 'xyz', syncedAt: 999 })
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'spotify',
      batchSize: 1
    });
    expect(result).toHaveLength(1);
    expect(result[0].externalId).toBe('xyz');
  });

  test('matches local playlist via syncedTo[providerId].externalId (push mirror)', () => {
    const selected = [remote('am-id-1')];
    const locals = [
      {
        id: 'spotify-something',
        title: 'Push mirror',
        syncedFrom: { resolver: 'spotify', externalId: 'spotify-something' },
        syncedTo: { applemusic: { externalId: 'am-id-1', syncedAt: 500 } },
        syncSources: { applemusic: { syncedAt: 500 } },
        hasUpdates: false,
        lastModified: 0
      }
    ];
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: locals,
      providerId: 'applemusic',
      batchSize: 1
    });
    expect(result[0].externalId).toBe('am-id-1');
  });

  test('does not mutate the input array', () => {
    const selected = [remote('z'), remote('a'), remote('m')];
    const before = selected.map(r => r.externalId);
    staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: [],
      providerId: 'spotify',
      batchSize: 10
    });
    expect(selected.map(r => r.externalId)).toEqual(before);
  });

  test('handles empty selectedRemote', () => {
    const result = staggerPlaylistsForCycle({
      selectedRemote: [],
      localPlaylists: [],
      providerId: 'spotify',
      batchSize: 15
    });
    expect(result).toEqual([]);
  });

  test('falls back to default batchSize when omitted', () => {
    const selected = Array.from({ length: 30 }, (_, i) => remote(`p${i}`));
    const result = staggerPlaylistsForCycle({
      selectedRemote: selected,
      localPlaylists: [],
      providerId: 'spotify'
      // batchSize omitted
    });
    // Default batch size; just verify it's a sensible cap (< 30 since input is 30).
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result.length).toBeGreaterThan(0);
  });
});

describe('canShortCircuitPlaylistUpdate (inbound sync optimization, see parachord#796)', () => {
  // Helper to build a "happy path" local + remote pair where short-circuit
  // should return true. Each test overrides the relevant field.
  const makePair = (overrides = {}) => {
    const local = {
      id: 'spotify-abc123',
      title: 'Test Playlist',
      tracks: [{ id: 't1' }, { id: 't2' }],
      creator: 'someuser',
      source: 'spotify-import',
      syncedFrom: {
        resolver: 'spotify',
        externalId: 'abc123',
        snapshotId: 'snap_xyz',
        ownerId: 'someuser',
        isCollaborator: false
      },
      ...overrides.local
    };
    const remote = {
      externalId: 'abc123',
      name: 'Test Playlist',
      snapshotId: 'snap_xyz', // matches local
      ownerId: 'someuser',
      ownerName: 'someuser',
      isOwnedByUser: true,
      isCollaborator: false,
      trackCount: 2,
      ...overrides.remote
    };
    return { local, remote, providerId: 'spotify', ...overrides.rest };
  };

  test('returns true when snapshots match, owner stable, metadata complete', () => {
    const { local, remote, providerId } = makePair();
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(true);
  });

  test('returns false when snapshotIds differ', () => {
    const { local, remote, providerId } = makePair({ remote: { snapshotId: 'snap_NEW' } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when local has no tracks (needs refill path)', () => {
    const { local, remote, providerId } = makePair({ local: { tracks: [] } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when syncedFrom.resolver is a different provider (cross-provider mirror)', () => {
    const { local, remote, providerId } = makePair({
      local: { syncedFrom: { resolver: 'applemusic', externalId: 'abc123', snapshotId: 'snap_xyz', ownerId: 'someuser', isCollaborator: false } }
    });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when local has no syncedFrom (locally-created push mirror)', () => {
    const { local, remote, providerId } = makePair({ local: { syncedFrom: null } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when local snapshotId is null (heal-induced — needs silent-adopt)', () => {
    const { local, remote, providerId } = makePair({
      local: { syncedFrom: { resolver: 'spotify', externalId: 'abc123', snapshotId: null, ownerId: 'someuser', isCollaborator: false } }
    });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when ownerId changed on remote', () => {
    const { local, remote, providerId } = makePair({ remote: { ownerId: 'DIFFERENT_USER' } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when collaborator status changed on remote (false -> true)', () => {
    const { local, remote, providerId } = makePair({ remote: { isCollaborator: true } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when collaborator status changed on remote (true -> false)', () => {
    const { local, remote, providerId } = makePair({
      local: { syncedFrom: { resolver: 'spotify', externalId: 'abc123', snapshotId: 'snap_xyz', ownerId: 'someuser', isCollaborator: true } }
    });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns false when creator needs backfill (local null, remote has ownerName)', () => {
    const { local, remote, providerId } = makePair({ local: { creator: null } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns true when creator is null on both sides (no backfill possible)', () => {
    const { local, remote, providerId } = makePair({ local: { creator: null }, remote: { ownerName: null } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(true);
  });

  test('returns false when source needs backfill (local null)', () => {
    const { local, remote, providerId } = makePair({ local: { source: null } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('returns true even when remote.isCollaborator is undefined (treated as false to match local false)', () => {
    const { local, remote, providerId } = makePair({ remote: { isCollaborator: undefined } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(true);
  });

  test('returns false when local.syncedFrom.isCollaborator is undefined but remote is true', () => {
    const { local, remote, providerId } = makePair({
      local: { syncedFrom: { resolver: 'spotify', externalId: 'abc123', snapshotId: 'snap_xyz', ownerId: 'someuser' } },
      remote: { isCollaborator: true }
    });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });

  test('handles missing tracks field as empty (forces full path)', () => {
    const { local, remote, providerId } = makePair({ local: { tracks: undefined } });
    expect(canShortCircuitPlaylistUpdate({ localPlaylist: local, remotePlaylist: remote, providerId })).toBe(false);
  });
});

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

  test('removal works even when sync ID uses first artist only', () => {
    // Spotify sync generates ID from first artist only (for backward compat),
    // but stores all artists in the artist field. The dual-lookup in
    // removeTrackFromCollection handles this by matching on stored track.id first.
    const firstArtistId = generateTrackId('Artist A', 'VO#01', 'Test Album');
    const collectionTracks = [
      { id: firstArtistId, title: 'VO#01', artist: 'Artist A, Artist B', album: 'Test Album' }
    ];

    // Track from collection view has the stored id — removal works via ID match
    const result = removeTrackFromCollection(
      { id: firstArtistId, title: 'VO#01', artist: 'Artist A, Artist B', album: 'Test Album' },
      collectionTracks
    );
    expect(result.removed).toBe(true);
  });
});

describe('syncDataType isCancelled propagation (parachord#820)', () => {
  // Minimal provider stub. fetchTracks consults the isCancelled callback from
  // the options bag the same way the real Spotify/AM providers do, mirroring
  // the mid-paginate cancel path: when isCancelled fires, return null so
  // syncDataType treats the result as "no change to apply" rather than
  // computing a diff against partial data.
  const makeProvider = ({ trackData = [], onFetch = null } = {}) => ({
    id: 'spotify',
    fetchTracks: jest.fn(async (token, onProgress, refreshToken, opts = {}) => {
      if (onFetch) onFetch();
      if (opts.isCancelled?.()) return null;
      return trackData;
    }),
    fetchAlbums: jest.fn(async () => []),
    fetchArtists: jest.fn(async () => [])
  });

  const localTrack = (id) => ({
    id, title: `t${id}`, artist: `a${id}`, album: `A${id}`,
    syncSources: { spotify: { syncedAt: 100 } }
  });

  test('returns localData unchanged with stats 0/0/0/N when isCancelled fires before fetch', async () => {
    const local = [localTrack('1'), localTrack('2'), localTrack('3')];
    const provider = makeProvider({ trackData: [localTrack('1')] }); // would-be removal of 2,3

    const result = await syncDataType(
      provider, 'token', 'tracks', local, () => {}, null,
      () => true  // already cancelled
    );

    expect(result.data).toBe(local); // same reference — no diff applied
    expect(result.stats).toEqual({ added: 0, removed: 0, updated: 0, unchanged: 3 });
  });

  test('passes isCancelled through fetchOptions to the provider', async () => {
    const isCancelled = jest.fn(() => false);
    const provider = makeProvider({ trackData: [] });

    await syncDataType(provider, 'token', 'tracks', [], () => {}, null, isCancelled);

    expect(provider.fetchTracks).toHaveBeenCalledWith(
      'token',
      expect.any(Function),
      null,
      expect.objectContaining({ isCancelled })
    );
  });

  test('omitting isCancelled is backward-compatible (provider receives undefined)', async () => {
    const provider = makeProvider({ trackData: [] });

    await syncDataType(provider, 'token', 'tracks', [], () => {}, null);

    const opts = provider.fetchTracks.mock.calls[0][3];
    expect(opts.isCancelled).toBeUndefined();
  });

  test('full diff still applies when isCancelled never fires', async () => {
    const local = [localTrack('1')];
    const provider = makeProvider({ trackData: [
      { id: '1', title: 't1', artist: 'a1', album: 'A1' },
      { id: '2', title: 't2', artist: 'a2', album: 'A2' }
    ]});

    const result = await syncDataType(
      provider, 'token', 'tracks', local, () => {}, null,
      () => false
    );

    expect(result.stats.added).toBe(1);
    expect(result.data.length).toBe(2);
  });
});

describe('areOrderedIdListsEquivalent (updatePlaylistTracks short-circuit helper)', () => {
  test('returns true for identical ordered lists', () => {
    expect(areOrderedIdListsEquivalent(['a', 'b', 'c'], ['a', 'b', 'c'])).toBe(true);
  });

  test('returns true for two empty lists', () => {
    expect(areOrderedIdListsEquivalent([], [])).toBe(true);
  });

  test('returns false when lengths differ', () => {
    expect(areOrderedIdListsEquivalent(['a', 'b'], ['a', 'b', 'c'])).toBe(false);
    expect(areOrderedIdListsEquivalent(['a', 'b', 'c'], ['a', 'b'])).toBe(false);
  });

  test('returns false when order differs (same set, different sequence)', () => {
    expect(areOrderedIdListsEquivalent(['a', 'b', 'c'], ['a', 'c', 'b'])).toBe(false);
  });

  test('returns false when any local id is null (ambiguous — never short-circuit)', () => {
    // Critical: a null local ID means the mapper failed for that incoming
    // track. Even if both lists happen to have null in the same slot, we
    // can't claim "remote already matches" because we don't know what
    // remote actually has at that position. Falling through to the full
    // push is safer.
    expect(areOrderedIdListsEquivalent(['a', null, 'c'], ['a', null, 'c'])).toBe(false);
    expect(areOrderedIdListsEquivalent([null], [null])).toBe(false);
  });

  test('returns false when any local id is undefined or empty string', () => {
    expect(areOrderedIdListsEquivalent(['a', undefined, 'c'], ['a', undefined, 'c'])).toBe(false);
    expect(areOrderedIdListsEquivalent([''], [''])).toBe(false);
  });

  test('returns false for non-array inputs', () => {
    expect(areOrderedIdListsEquivalent(null, ['a'])).toBe(false);
    expect(areOrderedIdListsEquivalent(['a'], null)).toBe(false);
    expect(areOrderedIdListsEquivalent(undefined, undefined)).toBe(false);
    expect(areOrderedIdListsEquivalent('a', 'a')).toBe(false);
  });

  test('returns true for case-sensitive matches (MBIDs are normalised by caller, not here)', () => {
    // Caller is responsible for normalising — we just do byte-equality.
    expect(areOrderedIdListsEquivalent(['ABC', 'def'], ['ABC', 'def'])).toBe(true);
    expect(areOrderedIdListsEquivalent(['ABC'], ['abc'])).toBe(false);
  });

  test('handles realistic LB MBID workload', () => {
    const local = [
      '550e8400-e29b-41d4-a716-446655440000',
      '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
    ];
    const remoteSame = [...local];
    const remoteOneSwapped = [local[0], local[2], local[1]]; // 2 and 3 swapped
    const remoteOneRemoved = local.slice(0, 2);
    expect(areOrderedIdListsEquivalent(local, remoteSame)).toBe(true);
    expect(areOrderedIdListsEquivalent(local, remoteOneSwapped)).toBe(false);
    expect(areOrderedIdListsEquivalent(local, remoteOneRemoved)).toBe(false);
  });
});
