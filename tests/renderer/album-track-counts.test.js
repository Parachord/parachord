/**
 * Album track-count backfill (parachord#1117). The old loop re-searched every
 * count-less album at every launch on the MusicBrainz user lane, saved the
 * whole collection per album, and cancelled itself on its first update.
 */

const fs = require('fs');
const path = require('path');
const {
  albumsNeedingTrackCount, trackCountFromRelease, runAlbumTrackCountSync, MISS_RETRY_MS,
} = require('../../src/renderer/lib/album-track-counts');

const DAY = 24 * 60 * 60 * 1000;
const album = (id, trackCount = null) => ({ id, artist: 'A', title: id, trackCount });

describe('albumsNeedingTrackCount', () => {
  test('skips albums with a count and recent misses, retries old misses', () => {
    const now = 100 * DAY;
    const albums = [album('has', 12), album('new'), album('recent-miss'), album('old-miss')];
    const misses = { 'recent-miss': now - DAY, 'old-miss': now - MISS_RETRY_MS - 1 };
    expect(albumsNeedingTrackCount(albums, misses, now).map(a => a.id)).toEqual(['new', 'old-miss']);
  });
});

describe('trackCountFromRelease', () => {
  test('sums track-count across media', () => {
    expect(trackCountFromRelease({ media: [{ 'track-count': 10 }, { 'track-count': 2 }] })).toBe(12);
    expect(trackCountFromRelease({})).toBe(0);
  });
});

describe('runAlbumTrackCountSync', () => {
  const run = (albums, results, opts = {}) => {
    const batches = [];
    const persisted = [];
    const lookup = jest.fn(async (a) => {
      const r = results[a.id];
      if (r instanceof Error) throw r;
      return r;
    });
    return runAlbumTrackCountSync({
      albums,
      misses: opts.misses || {},
      lookup,
      applyBatch: (b) => batches.push(b),
      persistMisses: async (m) => { persisted.push(m); },
      isCancelled: opts.isCancelled,
      now: () => 50 * DAY,
      batchSize: opts.batchSize || 10,
    }).then(summary => ({ summary, batches, persisted, lookup }));
  };

  test('applies hits in batches, not once per album', async () => {
    const albums = Array.from({ length: 25 }, (_, i) => album(`a${i}`));
    const results = Object.fromEntries(albums.map(a => [a.id, { trackCount: 9 }]));
    const { batches, summary } = await run(albums, results);
    expect(batches.map(b => b.length)).toEqual([10, 10, 5]);
    expect(summary).toEqual({ checked: 25, found: 25 });
  });

  test('records misses across launches; transient failures are not recorded', async () => {
    const albums = [album('hit'), album('miss'), album('zero'), album('flaky'), album('throws')];
    const results = {
      hit: { trackCount: 11 }, miss: { miss: true }, zero: { trackCount: 0 }, flaky: { transient: true }, throws: new Error('net'),
    };
    const { batches, persisted } = await run(albums, results);
    expect(batches).toEqual([[{ id: 'hit', trackCount: 11 }]]);
    expect(persisted).toHaveLength(1);
    expect(Object.keys(persisted[0]).sort()).toEqual(['miss', 'zero']);
  });

  test('a hit clears an old miss', async () => {
    const { persisted } = await run([album('back')], { back: { trackCount: 3 } }, { misses: { back: 1 } });
    expect(persisted).toEqual([{}]);
  });

  test('stops on cancel and still flushes what it found', async () => {
    let calls = 0;
    const albums = [album('a'), album('b'), album('c')];
    const { batches, lookup } = await run(albums, { a: { trackCount: 1 }, b: { trackCount: 2 }, c: { trackCount: 3 } }, {
      isCancelled: () => calls++ >= 1,
    });
    expect(lookup).toHaveBeenCalledTimes(1);
    expect(batches).toEqual([[{ id: 'a', trackCount: 1 }]]);
  });
});

describe('app.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const start = src.indexOf('// Background sync: fill in track counts');
  const block = src.slice(start, src.indexOf('// Add artist to collection', start));

  test('lookups use the MusicBrainz background lane', () => {
    expect(start).toBeGreaterThan(-1);
    expect(block).toMatch(/mbBackground: true/);
    expect(block).not.toMatch(/fetchReleaseDetails\(/);
  });

  test('the effect does not depend on the albums array it updates (it cancelled itself)', () => {
    expect(block).not.toMatch(/\[collectionLoading, collectionData\.albums[,\]]/);
  });

  test('the miss map key is allowlisted', () => {
    const storeSrc = fs.readFileSync(path.join(__dirname, '../../main-process/ipc/store.js'), 'utf8');
    expect(storeSrc).toMatch(/'cache_album_track_counts'/);
  });
});
