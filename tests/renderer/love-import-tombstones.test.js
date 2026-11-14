/**
 * Loved-tracks IMPORT (parachord#1071): the tombstone round trip. Removal
 * writes ONE provider for both services ('love-import', normalized name
 * key), so a track loved on both and removed once stays removed from both
 * imports; a deliberate re-add clears it through the existing
 * deriveTombstoneEntries → clearBatch path. Plan:
 * docs/plans/2026-11-06-import-loved-tracks.md, Task 3.
 */

const fs = require('fs');
const path = require('path');

const {
  loveNameKey,
  loveTombstoneEntries,
  loveTombstoneAt,
  isLoveTombstoned,
  planLoveImport,
} = require('../../src/renderer/lib/love-import');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

describe('loveTombstoneEntries', () => {
  test('one entry, keyed by the same name key the plan looks up', () => {
    const entries = loveTombstoneEntries({ artist: 'Portishead', title: 'Roads' });
    expect(entries).toEqual([{ providerId: 'love-import', externalId: loveNameKey({ artist: 'Portishead', title: 'Roads' }) }]);
  });

  test('blank names write nothing', () => {
    expect(loveTombstoneEntries({ artist: '', title: 'T' })).toEqual([]);
    expect(loveTombstoneEntries(null)).toEqual([]);
  });
});

describe('isOrphanedLovePush (pre-ship removals)', () => {
  test('an exact id matches, and so does the album-bearing form of the same song', () => {
    const { isOrphanedLovePush } = require('../../src/renderer/lib/love-import');
    const orphanIds = new Set(['radiohead-creep-pablohoney', 'wire-map-ref-41n-93-w-noalbum']);
    // The import candidate computes the album-less id; the heart was marked
    // under the album-bearing one. Same song.
    expect(isOrphanedLovePush(orphanIds, { id: 'radiohead-creep-noalbum', artist: 'Radiohead', title: 'Creep', album: '' })).toBe(true);
    expect(isOrphanedLovePush(orphanIds, { id: 'wire-map-ref-41n-93-w-noalbum', artist: 'Wire', title: 'Map Ref. 41°N 93°W', album: '' })).toBe(true);
    // A different song by the same artist does not match the prefix.
    expect(isOrphanedLovePush(orphanIds, { id: 'radiohead-karma-police-noalbum', artist: 'Radiohead', title: 'Karma Police', album: '' })).toBe(false);
    // trackSlug ids (non-Latin) keep exact matching only.
    expect(isOrphanedLovePush(orphanIds, { id: '宇多田ヒカル-光-', artist: '宇多田ヒカル', title: '光', album: '' })).toBe(false);
  });
});

describe('the removal → import round trip', () => {
  test('removing a Last.fm-imported track keeps a ListenBrainz love for it out (cross-service)', () => {
    // removeTrackFromCollection writes every entry from loveTombstoneEntries
    // into the tombstone store (deriveTombstoneEntries spreads them).
    const removedTrack = { artist: 'Portishead', title: 'Roads', album: '' };
    const tombstones = { 'love-import': {} };
    for (const { providerId, externalId } of loveTombstoneEntries(removedTrack)) {
      tombstones[providerId][externalId] = { removedAt: 1700000100000 };
    }
    // The same track, loved later on ListenBrainz, older than the removal.
    const plan = planLoveImport(
      [{ service: 'listenbrainz', artist: 'Portishead', title: 'Roads', album: 'Dummy', mbid: null, lovedAt: 1700000000 }],
      [], tombstones);
    expect(plan.tombstoned).toBe(1);
    expect(plan.add).toEqual([]);
  });

  test('a re-love NEWER than the removal is a fresh decision and gets through', () => {
    const key = loveNameKey({ artist: 'Portishead', title: 'Roads' });
    const tombstones = { 'love-import': { [key]: { removedAt: 1700000000000 } } };
    const plan = planLoveImport(
      [{ service: 'lastfm', artist: 'Portishead', title: 'Roads', album: '', mbid: null, lovedAt: 1700001000 }],
      [], tombstones);
    expect(plan.add).toHaveLength(1);
  });

  test('loveTombstoneAt: null only when NO entry exists, so the pre-ship heuristic and the date rule never fight', () => {
    const reloved = { service: 'lastfm', artist: 'Portishead', title: 'Roads', album: '', mbid: null, lovedAt: 1700001000 };
    const key = loveNameKey(reloved);
    const tombstones = { 'love-import': { [key]: { removedAt: 1700000000000 } } };
    // A removed-then-re-loved track HAS an entry → the heuristic doesn't
    // apply, and the date rule passes it.
    expect(loveTombstoneAt(tombstones, reloved)).toBe(1700000000000);
    expect(isLoveTombstoned(tombstones, reloved)).toBe(false);
    // No entry at all → the heuristic's case (a pre-ship removal).
    expect(loveTombstoneAt({}, reloved)).toBeNull();
    // A corrupt entry without removedAt reads as no entry.
    expect(loveTombstoneAt({ 'love-import': { [key]: {} } }, reloved)).toBeNull();
  });
});

describe('wiring (source markers)', () => {
  const app = read('src/renderer/app.js');

  test('deriveTombstoneEntries writes the love-import entries on every removal', () => {
    expect(app).toContain('entries.push(...loveTombstoneEntries(track))');
  });

  test('addTrackToCollection still clears them on a deliberate re-add (the existing clearBatch)', () => {
    const clearAt = app.indexOf('window.electron.tombstones.clearBatch(tombstoneEntries)');
    const addAt = app.indexOf('const addTrackToCollection = useCallback');
    expect(clearAt).toBeGreaterThan(-1);
    expect(addAt).toBeGreaterThan(-1);
    expect(clearAt).toBeGreaterThan(addAt);
  });
});
