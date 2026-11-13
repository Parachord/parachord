/**
 * Loved-tracks IMPORT (parachord#1071): the name key, the row id and the
 * plan (planLoveImport — what a run adds, what it matches, what a tombstone
 * blocks). Plan: docs/plans/2026-11-06-import-loved-tracks.md, Tasks 2.
 */

const {
  loveNameKey,
  loveRowId,
  planLoveImport,
} = require('../../src/renderer/lib/love-import');

const MBID = '9bd9f6a2-2c27-4d3c-b1d9-6e56a5ee72c2';
const OTHER_MBID = '1e7b2ec1-6fab-4846-b25e-3dcb4a9f61a9';
const THIRD_MBID = 'b6d7ec1f-62f6-43dc-a67c-8367f4047d0e';

describe('loveNameKey', () => {
  test('folds accents, punctuation and case together', () => {
    expect(loveNameKey({ artist: 'Björk', title: 'Jóga' })).toBe(loveNameKey({ artist: 'Bjork', title: 'Joga' }));
    expect(loveNameKey({ artist: 'AC/DC', title: 'Back in Black' })).toBe(loveNameKey({ artist: 'ACDC', title: 'Back in Black' }));
    expect(loveNameKey({ artist: 'wire', title: 'Map ref 41°N 93°W' })).toBe(loveNameKey({ artist: 'Wire', title: 'Map Ref 41°N 93°W' }));
  });

  test('non-Latin names stay distinct, not collapsed to one key', () => {
    const a = loveNameKey({ artist: '宇多田ヒカル', title: '光' });
    const b = loveNameKey({ artist: '宇多田ヒカル', title: 'Automatic' });
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  test('an all-punctuation artist (the band !!!) falls back to the raw name, not an empty key', () => {
    const key = loveNameKey({ artist: '!!!', title: 'Heart of Hearts' });
    expect(key).toBe('!!!|heartofhearts'); // raw lowercase fallback, not the empty normalized key
  });

  test('null when either name is blank', () => {
    expect(loveNameKey({ artist: '', title: 'T' })).toBeNull();
    expect(loveNameKey({ artist: 'A', title: '' })).toBeNull();
    expect(loveNameKey(null)).toBeNull();
  });
});

describe('loveRowId', () => {
  test('generateTrackId while the ASCII strip leaves something', () => {
    expect(loveRowId({ artist: 'Radiohead', title: 'Creep', album: '' })).toBe('radiohead-creep-noalbum');
  });

  test('trackSlug when the ASCII strip collapses the artist or the title, so non-Latin loves get their own rows', () => {
    const a = loveRowId({ artist: '宇多田ヒカル', title: '光', album: '' });
    const b = loveRowId({ artist: '宇多田ヒカル', title: 'First Love', album: '' });
    expect(a).not.toBe(b);
    expect(a).not.toBe('--');
    expect(a).not.toBe(b);
    // A non-Latin artist with a Latin title (BTS's First Love) is distinct
    // from every other artist's, which generateTrackId would have collapsed.
    const c = loveRowId({ artist: '宇多田ヒカル', title: 'First Love', album: '' });
    const d = loveRowId({ artist: 'BTS', title: 'First Love', album: '' });
    expect(c).not.toBe(d);
  });
});

describe('planLoveImport', () => {
  const tracks = [
    // A saved row with the album a love doesn't carry — the near-duplicate
    // the naive id add would create.
    { id: 'a', artist: 'Radiohead', title: 'Creep', album: 'Pablo Honey', sources: {} },
    // A row whose recording MBID came from the mapper (ListenBrainz rows keep theirs).
    { id: 'b', artist: 'Sonic Youth', title: 'Kool Thing (2024 Remaster)', album: 'Goo', mbid: MBID, sources: {} },
    // A row carrying an MBID only on a source record.
    { id: 'c', artist: 'Björk', title: 'Jóga', album: 'Homogenic', sources: { listenbrainz: { mbid: OTHER_MBID } } },
  ];

  test('a love whose MBID equals a saved row matches even when the names differ', () => {
    const plan = planLoveImport(
      [{ service: 'lastfm', artist: 'Sonic Youth', title: 'Kool Thing', album: '', mbid: MBID, lovedAt: 100 }],
      tracks, {});
    expect(plan.add).toEqual([]);
    expect(plan.matchedIds).toEqual(['b']);
  });

  test('a source-record MBID matches too, and a name match works whatever the saved album', () => {
    const plan = planLoveImport(
      [
        { service: 'listenbrainz', artist: 'Björk', title: 'Joga', album: '', mbid: OTHER_MBID, lovedAt: 100 },
        { service: 'lastfm', artist: 'Radiohead', title: 'Creep', album: '', mbid: null, lovedAt: 100 },
      ],
      tracks, {});
    expect(plan.add).toEqual([]);
    expect(plan.matchedIds).toEqual(['c', 'a']);
  });

  test('a version suffix stays a different track; a new love adds a row with addedAt = lovedAt * 1000', () => {
    const plan = planLoveImport(
      [
        { service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W', album: '', mbid: null, lovedAt: 1700000000 },
        { service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W (remastered)', album: '', mbid: null, lovedAt: 1700000001 },
      ],
      tracks, {});
    expect(plan.add).toHaveLength(2);
    expect(plan.add[0]).toMatchObject({ addedAt: 1700000000000 });
    expect(plan.add[1].id).not.toBe(plan.add[0].id);
  });

  test('two loves for the same track in one batch add one row, with the earlier lovedAt', () => {
    const plan = planLoveImport(
      [
        { service: 'lastfm', artist: 'Wire', title: 'Map Ref. 41°N 93°W', album: '', mbid: null, lovedAt: 1700000005 },
        { service: 'lastfm', artist: 'Wire', title: 'Map ref 41°N 93°W', album: '', mbid: null, lovedAt: 1700000002 },
      ],
      tracks, {});
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].addedAt).toBe(1700000002000);
  });

  test('a ListenBrainz row keeps its MBID; a Last.fm row carries none (the parser drops it)', () => {
    const plan = planLoveImport(
      [
        { service: 'listenbrainz', artist: 'New Order', title: 'Temptation', album: 'Substance', mbid: THIRD_MBID, lovedAt: 100 },
      ],
      tracks, {});
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].mbid).toBe(THIRD_MBID);
    const lfmPlan = planLoveImport(
      [{ service: 'lastfm', artist: 'New Order', title: 'Temptation', album: '', mbid: null, lovedAt: 100 }],
      tracks, {});
    expect('mbid' in lfmPlan.add[0]).toBe(false);
  });

  test('fully non-Latin loves by one artist add one row each, none of them the collapsed id', () => {
    const plan = planLoveImport(
      [
        { service: 'listenbrainz', artist: '宇多田ヒカル', title: '光', album: 'Deep River', mbid: null, lovedAt: 100 },
        { service: 'listenbrainz', artist: '宇多田ヒカル', title: 'First Love', album: 'First Love', mbid: null, lovedAt: 200 },
      ],
      tracks, {});
    expect(plan.add).toHaveLength(2);
    expect(new Set(plan.add.map((r) => r.id)).size).toBe(2);
    for (const row of plan.add) expect(row.id.startsWith('宇多田ヒカル')).toBe(true);
  });

  test('a tombstone blocks, unless the love is newer than the removal (a fresh decision)', () => {
    const key = loveNameKey({ artist: 'Portishead', title: 'Roads' });
    const tombstones = { 'love-import': { [key]: { removedAt: 2000000 } } };
    const plan = planLoveImport(
      [
        { service: 'lastfm', artist: 'Portishead', title: 'Roads', album: '', mbid: null, lovedAt: 1000 },
        { service: 'listenbrainz', artist: 'Portishead', title: 'Roads', album: '', mbid: null, lovedAt: 3000 },
      ],
      tracks, tombstones);
    expect(plan.tombstoned).toBe(1);
    expect(plan.add).toHaveLength(1);
    expect(plan.add[0].addedAt).toBe(3000000);
  });

  test('the recording-MBID tombstone entry blocks by MBID too, for either service', () => {
    const tombstones = { listenbrainz: { [MBID]: { removedAt: 200000 } } };
    const plan = planLoveImport(
      [{ service: 'lastfm', artist: 'Sonic Youth', title: 'Kool Thing', album: '', mbid: MBID, lovedAt: 100 }],
      tracks, tombstones);
    expect(plan.tombstoned).toBe(1);
    expect(plan.add).toEqual([]);
  });

  test('needsLookup loves are ignored here (the runner resolves their names first)', () => {
    const plan = planLoveImport(
      [{ service: 'listenbrainz', mbid: MBID, lovedAt: 100, needsLookup: true, artist: '', title: '', album: '' }],
      tracks, {});
    expect(plan).toEqual({ add: [], matchedIds: [], tombstoned: 0 });
  });

  test('20,000 loves against 20,000 rows plans in under a second (an index, not a scan per love)', () => {
    const rows = [];
    const loves = [];
    for (let i = 0; i < 20000; i++) {
      rows.push({ id: `row-${i}`, artist: `Artist ${i}`, title: `Song ${i}`, album: 'Album', sources: {} });
      loves.push({ service: 'lastfm', artist: `Artist ${i}`, title: `Song ${i}`, album: '', mbid: null, lovedAt: 1700000000 + i });
    }
    const started = Date.now();
    const plan = planLoveImport(loves, rows, {});
    const elapsed = Date.now() - started;
    expect(plan.add).toHaveLength(0);
    expect(plan.matchedIds).toHaveLength(20000);
    expect(elapsed).toBeLessThan(1000);
  }, 15000);
});
