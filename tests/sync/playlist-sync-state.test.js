/**
 * N-way state model — pure derivation tests (Phase 1, Parachord/parachord#911).
 *
 * Covers the desktop-internal state-model helpers: baseline construction and
 * the per-provider changeToken / editedAt derivations (incl. the Spotify
 * MAX(added_at) + reorder/delete detection-time floor). The electron-store
 * persistence is in main.js and is behavior-neutral scaffolding (Phase 2
 * populates it); these tests pin the pure logic that decides what goes in.
 */

const {
  buildBaseline,
  toEpochMs,
  deriveChangeToken,
  deriveEditedAt,
  makeProviderSyncState,
  makePlaylistSyncState,
} = require('../../sync-engine/playlist-sync-state');

describe('buildBaseline', () => {
  test('maps tracks to canonical keys in order', () => {
    expect(
      buildBaseline([
        { isrc: 'GBAYE0601498' },
        { recordingMbid: 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8' },
        { artist: 'Radiohead', title: 'Creep' },
      ])
    ).toEqual(['isrc-GBAYE0601498', 'mbid-b2181aae-5cba-496c-bb0c-b4cc0109ebf8', 'norm-radiohead|creep']);
  });

  test('dedupes first-occurrence (so it matches a merge result)', () => {
    expect(
      buildBaseline([
        { isrc: 'GBAYE0601498' },
        { artist: 'Radiohead', title: 'Creep' },
        { isrc: 'gbaye0601498' }, // same recording, different case -> same key
      ])
    ).toEqual(['isrc-GBAYE0601498', 'norm-radiohead|creep']);
  });

  test('empty / non-array degrades to []', () => {
    expect(buildBaseline([])).toEqual([]);
    expect(buildBaseline(null)).toEqual([]);
  });
});

describe('toEpochMs', () => {
  test('passes through a number', () => {
    expect(toEpochMs(1718900000000)).toBe(1718900000000);
  });
  test('parses an ISO string', () => {
    expect(toEpochMs('2026-06-21T00:00:00.000Z')).toBe(Date.parse('2026-06-21T00:00:00.000Z'));
  });
  test('unparseable -> 0', () => {
    expect(toEpochMs('not a date')).toBe(0);
    expect(toEpochMs(undefined)).toBe(0);
  });
});

describe('deriveChangeToken', () => {
  test('spotify uses snapshotId', () => {
    expect(deriveChangeToken('spotify', { snapshotId: 'abc123' })).toBe('abc123');
    expect(deriveChangeToken('spotify', {})).toBeNull();
  });
  test('apple music / listenbrainz use lastModified', () => {
    expect(deriveChangeToken('applemusic', { lastModified: '2026-06-21T00:00:00Z' })).toBe('2026-06-21T00:00:00Z');
    expect(deriveChangeToken('listenbrainz', { lastModified: '2026-06-21T00:00:00Z' })).toBe('2026-06-21T00:00:00Z');
  });
  test('unknown provider -> null', () => {
    expect(deriveChangeToken('localfiles', { lastModified: 'x' })).toBeNull();
  });
});

describe('deriveEditedAt', () => {
  test('apple music / listenbrainz parse last_modified', () => {
    const iso = '2026-06-21T12:00:00.000Z';
    expect(deriveEditedAt('applemusic', { lastModified: iso })).toBe(Date.parse(iso));
    expect(deriveEditedAt('listenbrainz', { lastModified: iso })).toBe(Date.parse(iso));
  });

  test('spotify uses MAX(added_at) when a track was added since last sync', () => {
    const older = '2026-06-01T00:00:00Z';
    const newer = '2026-06-20T00:00:00Z';
    const r = deriveEditedAt(
      'spotify',
      { addedAts: [older, newer] },
      { previousEditedAt: Date.parse(older), detectionTime: 9_999_999_999_999 }
    );
    expect(r).toBe(Date.parse(newer));
  });

  test('spotify reorder/delete (no newer add) floors to detection time', () => {
    // MAX(added_at) hasn't advanced past previousEditedAt -> snapshot changed
    // via a reorder/delete; use detection time so the edit still orders recent.
    const added = '2026-06-01T00:00:00Z';
    const detection = Date.parse('2026-06-21T00:00:00Z');
    const r = deriveEditedAt(
      'spotify',
      { addedAts: [added] },
      { previousEditedAt: Date.parse(added), detectionTime: detection }
    );
    expect(r).toBe(detection);
  });

  test('spotify with no added_ats and no detection time -> 0', () => {
    expect(deriveEditedAt('spotify', { addedAts: [] }, {})).toBe(0);
  });
});

describe('record factories', () => {
  test('makeProviderSyncState fills defaults', () => {
    expect(makeProviderSyncState()).toEqual({ changeToken: null, editedAt: 0, lastSyncedAt: 0 });
    expect(makeProviderSyncState({ changeToken: 'snap', editedAt: 5, lastSyncedAt: 7 })).toEqual({
      changeToken: 'snap',
      editedAt: 5,
      lastSyncedAt: 7,
    });
  });

  test('makePlaylistSyncState copies baseline + providers', () => {
    const base = ['a', 'b'];
    const s = makePlaylistSyncState({ baseline: base, baselineSyncedAt: 1, providers: { spotify: {} } });
    expect(s.baseline).toEqual(['a', 'b']);
    expect(s.baseline).not.toBe(base); // copied, not aliased
    expect(s.baselineSyncedAt).toBe(1);
    expect(s.providers).toEqual({ spotify: {} });
  });
});
