/**
 * The startup restore of cache_artist_data kept only full (cacheVersion 2)
 * entries, so the ID-only entries Fresh Drops writes ({ artist: { name, mbid },
 * timestamp }) were dropped on every launch and their MusicBrainz ID searches
 * rerun. Both kinds survive now; expired and old-version entries still go.
 */

const { restorableArtistDataEntries, ARTIST_CACHE_VERSION } = require('../../src/renderer/lib/artist-data-cache');

const DAY = 24 * 60 * 60 * 1000;
const TTL = 30 * DAY;
const NOW = 1_800_000_000_000;

const full = (ageDays) => ({
  artist: { name: 'Radiohead', mbid: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
  releases: [{ id: 'r1' }],
  timestamp: NOW - ageDays * DAY,
  cacheVersion: ARTIST_CACHE_VERSION,
});
const idOnly = (ageDays, mbid = '9e1ee1fe-2a2e-4c8c-9a77-ebd8bd1a2a8f') => ({
  artist: { name: 'Vic Chesnutt', mbid },
  timestamp: NOW - ageDays * DAY,
});

describe('restorableArtistDataEntries', () => {
  test('keeps full entries and the ID-only entries Fresh Drops writes', () => {
    const r = restorableArtistDataEntries({ radiohead: full(3), 'vic chesnutt': idOnly(0) }, NOW, TTL);
    expect(Object.keys(r.entries).sort()).toEqual(['radiohead', 'vic chesnutt']);
    expect(r).toMatchObject({ full: 1, idOnly: 1, dropped: 0 });
  });

  test('drops expired entries of both kinds', () => {
    const r = restorableArtistDataEntries({ a: full(31), b: idOnly(31) }, NOW, TTL);
    expect(r.entries).toEqual({});
    expect(r.dropped).toBe(2);
  });

  test('drops full entries from an older cache version', () => {
    const old = { ...full(1), cacheVersion: 1 };
    const r = restorableArtistDataEntries({ old }, NOW, TTL);
    expect(r.entries).toEqual({});
    expect(r.dropped).toBe(1);
  });

  test('an entry with neither a version nor an ID is not kept', () => {
    const r = restorableArtistDataEntries({
      nameOnly: { artist: { name: 'X' }, timestamp: NOW },
      emptyId: idOnly(0, ''),
      noTimestamp: { artist: { name: 'Y', mbid: 'm' } },
      junk: null,
    }, NOW, TTL);
    expect(r.entries).toEqual({});
    expect(r.dropped).toBe(4);
  });

  test('an unversioned entry that has releases is not mistaken for ID-only', () => {
    const { cacheVersion: _v, ...unversioned } = full(1);
    const r = restorableArtistDataEntries({ unversioned }, NOW, TTL);
    expect(r.entries).toEqual({});
  });

  test('a missing cache restores nothing', () => {
    expect(restorableArtistDataEntries(undefined, NOW, TTL)).toEqual({ entries: {}, full: 0, idOnly: 0, dropped: 0 });
  });
});
