/**
 * Per-client sync-engine mode + the N-way mutual-exclusion contract
 * (parachord#911). Legacy playlist sync stands down ONLY in 'new'; library
 * sync is never gated by this (asserted at the call sites, documented here).
 */

const {
  SYNC_ENGINE_MODES,
  normalizeEngineMode,
  legacyPlaylistSyncEnabled,
  nwayWritesEnabled,
} = require('../../sync-engine/sync-engine-mode');

describe('sync-engine-mode', () => {
  test('the three modes', () => {
    expect(SYNC_ENGINE_MODES).toEqual(['legacy', 'shadow', 'new']);
  });

  describe('normalizeEngineMode — default legacy, anything unknown → legacy', () => {
    test.each(['legacy', 'shadow', 'new'])('passes through %s', (m) => {
      expect(normalizeEngineMode(m)).toBe(m);
    });
    test.each([undefined, null, '', 'NEW', 'nway', 'off', 0, true, {}])(
      'coerces %p to legacy', (bad) => {
        expect(normalizeEngineMode(bad)).toBe('legacy');
      }
    );
  });

  describe('legacyPlaylistSyncEnabled — on except in new', () => {
    test('legacy → enabled', () => expect(legacyPlaylistSyncEnabled('legacy')).toBe(true));
    test('shadow → enabled (legacy still drives)', () => expect(legacyPlaylistSyncEnabled('shadow')).toBe(true));
    test('new → DISABLED (N-way owns playlists)', () => expect(legacyPlaylistSyncEnabled('new')).toBe(false));
    test('unknown/absent → enabled (safe default = legacy)', () => {
      expect(legacyPlaylistSyncEnabled(undefined)).toBe(true);
      expect(legacyPlaylistSyncEnabled('garbage')).toBe(true);
    });
  });

  describe('nwayWritesEnabled — real writes only in new', () => {
    test('legacy → no writes', () => expect(nwayWritesEnabled('legacy')).toBe(false));
    test('shadow → no writes (dry-run only)', () => expect(nwayWritesEnabled('shadow')).toBe(false));
    test('new → writes', () => expect(nwayWritesEnabled('new')).toBe(true));
    test('unknown/absent → no writes', () => {
      expect(nwayWritesEnabled(undefined)).toBe(false);
      expect(nwayWritesEnabled('garbage')).toBe(false);
    });
  });

  test('invariant: legacy and N-way writes are never both on for playlists', () => {
    for (const m of [...SYNC_ENGINE_MODES, undefined, 'garbage']) {
      expect(legacyPlaylistSyncEnabled(m) && nwayWritesEnabled(m)).toBe(false);
    }
  });
});
