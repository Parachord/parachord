/**
 * Track Tombstones — pure module tests.
 *
 * The tombstone module persists "user removed this track on purpose"
 * markers so that subsequent syncs from the same provider don't undo
 * the user's removal by re-adding the still-present remote track.
 *
 * Addresses parachord#864. Mirrors the per-playlist `suppressSync`
 * pattern at the track level, keyed by (providerId, externalId).
 *
 * The module is pure functions that take a store-like object — the
 * tests inject an in-memory fake. Main-process integration (IPC,
 * sync:start filter, app-start prune) is exercised in app-level tests
 * separately.
 */

const {
  addTombstone,
  addTombstones,
  getTombstone,
  clearTombstone,
  clearTombstones,
  pruneExpired,
  filterRemoteByTombstones,
  TOMBSTONE_KEY,
  TOMBSTONE_TTL_MS
} = require('../../sync-engine/tombstones');

const makeStore = (initial = {}) => {
  const data = { ...initial };
  return {
    get: (k) => data[k],
    set: (k, v) => { data[k] = v; },
    _peek: () => data
  };
};

describe('Track Tombstones', () => {
  describe('addTombstone', () => {
    it('writes a new entry under (providerId, externalId)', () => {
      const store = makeStore();
      const ok = addTombstone(store, 'spotify', 'abc123', 1000);
      expect(ok).toBe(true);
      expect(getTombstone(store, 'spotify', 'abc123')).toEqual({ removedAt: 1000 });
    });

    it('refreshes removedAt when called twice for the same key', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc123', 1000);
      addTombstone(store, 'spotify', 'abc123', 2000);
      expect(getTombstone(store, 'spotify', 'abc123')).toEqual({ removedAt: 2000 });
    });

    it('keeps providers independent', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      addTombstone(store, 'applemusic', 'abc', 2000);
      expect(getTombstone(store, 'spotify', 'abc')).toEqual({ removedAt: 1000 });
      expect(getTombstone(store, 'applemusic', 'abc')).toEqual({ removedAt: 2000 });
    });

    it('rejects empty providerId', () => {
      const store = makeStore();
      expect(addTombstone(store, '', 'abc', 1000)).toBe(false);
      expect(store._peek()[TOMBSTONE_KEY]).toBeUndefined();
    });

    it('rejects empty externalId', () => {
      const store = makeStore();
      expect(addTombstone(store, 'spotify', '', 1000)).toBe(false);
      expect(store._peek()[TOMBSTONE_KEY]).toBeUndefined();
    });

    it('rejects non-string providerId or externalId', () => {
      const store = makeStore();
      expect(addTombstone(store, null, 'abc', 1000)).toBe(false);
      expect(addTombstone(store, 'spotify', null, 1000)).toBe(false);
      expect(addTombstone(store, 42, 'abc', 1000)).toBe(false);
    });
  });

  describe('getTombstone', () => {
    it('returns null for missing keys', () => {
      const store = makeStore();
      expect(getTombstone(store, 'spotify', 'never-existed')).toBeNull();
    });

    it('returns null for missing provider bucket', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      expect(getTombstone(store, 'applemusic', 'abc')).toBeNull();
    });
  });

  describe('addTombstones (batch)', () => {
    it('writes multiple entries in one store write', () => {
      const store = makeStore();
      const written = addTombstones(store, [
        { providerId: 'spotify', externalId: 'a' },
        { providerId: 'spotify', externalId: 'b' },
        { providerId: 'applemusic', externalId: 'c' }
      ], 1000);
      expect(written).toBe(3);
      expect(getTombstone(store, 'spotify', 'a')).toEqual({ removedAt: 1000 });
      expect(getTombstone(store, 'spotify', 'b')).toEqual({ removedAt: 1000 });
      expect(getTombstone(store, 'applemusic', 'c')).toEqual({ removedAt: 1000 });
    });

    it('skips invalid entries without rejecting the whole batch', () => {
      const store = makeStore();
      const written = addTombstones(store, [
        { providerId: 'spotify', externalId: 'a' },
        { providerId: '', externalId: 'b' },
        { providerId: 'spotify', externalId: 'c' }
      ], 1000);
      expect(written).toBe(2);
      expect(getTombstone(store, 'spotify', 'a')).not.toBeNull();
      expect(getTombstone(store, 'spotify', 'c')).not.toBeNull();
    });

    it('returns 0 for empty input without touching the store', () => {
      const store = makeStore();
      expect(addTombstones(store, [])).toBe(0);
      expect(addTombstones(store, null)).toBe(0);
      expect(store._peek()[TOMBSTONE_KEY]).toBeUndefined();
    });
  });

  describe('clearTombstone', () => {
    it('removes a single entry', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      expect(clearTombstone(store, 'spotify', 'abc')).toBe(true);
      expect(getTombstone(store, 'spotify', 'abc')).toBeNull();
    });

    it('cleans up empty provider buckets', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'only', 1000);
      clearTombstone(store, 'spotify', 'only');
      expect(store._peek()[TOMBSTONE_KEY].spotify).toBeUndefined();
    });

    it('returns false when nothing to clear', () => {
      const store = makeStore();
      expect(clearTombstone(store, 'spotify', 'nope')).toBe(false);
    });
  });

  describe('clearTombstones (batch)', () => {
    it('clears multiple entries across providers', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'a', 1000);
      addTombstone(store, 'applemusic', 'b', 1000);
      addTombstone(store, 'spotify', 'c', 1000);
      const cleared = clearTombstones(store, [
        { providerId: 'spotify', externalId: 'a' },
        { providerId: 'applemusic', externalId: 'b' }
      ]);
      expect(cleared).toBe(2);
      expect(getTombstone(store, 'spotify', 'a')).toBeNull();
      expect(getTombstone(store, 'applemusic', 'b')).toBeNull();
      expect(getTombstone(store, 'spotify', 'c')).not.toBeNull();
    });

    it('silently skips missing entries', () => {
      const store = makeStore();
      const cleared = clearTombstones(store, [
        { providerId: 'spotify', externalId: 'never-existed' }
      ]);
      expect(cleared).toBe(0);
    });
  });

  describe('pruneExpired', () => {
    it('removes entries older than TTL', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'old', 0);
      addTombstone(store, 'spotify', 'recent', TOMBSTONE_TTL_MS / 2);
      const pruned = pruneExpired(store, TOMBSTONE_TTL_MS, TOMBSTONE_TTL_MS + 1);
      expect(pruned).toBe(1);
      expect(getTombstone(store, 'spotify', 'old')).toBeNull();
      expect(getTombstone(store, 'spotify', 'recent')).not.toBeNull();
    });

    it('cleans up empty provider buckets after pruning', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'only', 0);
      pruneExpired(store, TOMBSTONE_TTL_MS, TOMBSTONE_TTL_MS + 1);
      expect(store._peek()[TOMBSTONE_KEY]?.spotify).toBeUndefined();
    });

    it('returns 0 when nothing expired', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'recent', 1000);
      expect(pruneExpired(store, TOMBSTONE_TTL_MS, 2000)).toBe(0);
    });

    it('removes corrupt entries lacking removedAt', () => {
      const store = makeStore();
      // Inject manually-corrupt entry
      store.set(TOMBSTONE_KEY, { spotify: { bad: {} } });
      const pruned = pruneExpired(store, TOMBSTONE_TTL_MS, 1000);
      expect(pruned).toBe(1);
      expect(getTombstone(store, 'spotify', 'bad')).toBeNull();
    });
  });

  describe('filterRemoteByTombstones', () => {
    it('drops items whose externalId is tombstoned for the same provider', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      const items = [
        { externalId: 'abc', title: 'tombstoned' },
        { externalId: 'def', title: 'kept' }
      ];
      const { filtered, dropped } = filterRemoteByTombstones(store, items, 'spotify');
      expect(filtered.map(i => i.title)).toEqual(['kept']);
      expect(dropped).toBe(1);
    });

    it('re-arms TTL on tombstone hit (proves remote still has it)', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      filterRemoteByTombstones(store, [{ externalId: 'abc' }], 'spotify', 5000);
      expect(getTombstone(store, 'spotify', 'abc')).toEqual({ removedAt: 5000 });
    });

    it('does not touch tombstones from other providers', () => {
      const store = makeStore();
      addTombstone(store, 'applemusic', 'abc', 1000);
      const { filtered, dropped } = filterRemoteByTombstones(
        store,
        [{ externalId: 'abc' }],
        'spotify'
      );
      expect(filtered).toHaveLength(1);
      expect(dropped).toBe(0);
      // Other-provider tombstone untouched
      expect(getTombstone(store, 'applemusic', 'abc').removedAt).toBe(1000);
    });

    it('handles empty or missing items list', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      expect(filterRemoteByTombstones(store, [], 'spotify')).toEqual({ filtered: [], dropped: 0 });
      expect(filterRemoteByTombstones(store, null, 'spotify')).toEqual({ filtered: null, dropped: 0 });
    });

    it('handles items without externalId (pass through unchanged)', () => {
      const store = makeStore();
      addTombstone(store, 'spotify', 'abc', 1000);
      const items = [
        { title: 'no-ext-id' },
        { externalId: null },
        { externalId: 'abc' }
      ];
      const { filtered, dropped } = filterRemoteByTombstones(store, items, 'spotify');
      expect(filtered).toHaveLength(2);
      expect(dropped).toBe(1);
    });
  });

  describe('module integration', () => {
    it('add → filter → clear → filter — end-to-end happy path', () => {
      const store = makeStore();
      // User removes a Spotify-synced track
      addTombstone(store, 'spotify', 'track1', 1000);

      // Next sync sees the track on Spotify → filter drops it
      const sync1 = filterRemoteByTombstones(
        store,
        [{ externalId: 'track1', title: 'foo' }],
        'spotify',
        2000
      );
      expect(sync1.dropped).toBe(1);
      // TTL re-armed
      expect(getTombstone(store, 'spotify', 'track1').removedAt).toBe(2000);

      // User re-adds the track via UI
      clearTombstones(store, [{ providerId: 'spotify', externalId: 'track1' }]);

      // Next sync now lets it through
      const sync2 = filterRemoteByTombstones(
        store,
        [{ externalId: 'track1', title: 'foo' }],
        'spotify',
        3000
      );
      expect(sync2.dropped).toBe(0);
      expect(sync2.filtered).toHaveLength(1);
    });
  });
});
