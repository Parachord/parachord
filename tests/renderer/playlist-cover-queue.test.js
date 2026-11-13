/**
 * The playlist cover queue (blank covers on Home): cached covers go on screen
 * in one write, and missing ones are fetched freshest first, so hosted XSPF
 * playlists at the end of local_playlists don't wait behind every other
 * playlist. The effect in app.js runs one loop at a time.
 */
const fs = require('fs');
const path = require('path');
const q = require('../../src/renderer/lib/playlist-cover-queue');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('cachedCoversToSeed', () => {
  const playlists = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  test('every cached set not yet in state, in one patch', () => {
    const cache = { a: { covers: ['1'] }, b: { covers: ['2', '3', '4', '5'] }, c: { covers: [] } };
    expect(q.cachedCoversToSeed(playlists, cache, { b: ['x'] })).toEqual({ a: ['1'] });
  });
  test('null when nothing to add', () => {
    expect(q.cachedCoversToSeed(playlists, {}, {})).toBeNull();
    expect(q.cachedCoversToSeed([], { a: { covers: ['1'] } }, {})).toBeNull();
  });
});

describe('coverFetchOrder', () => {
  // Storage order puts the hosted playlist last; it changed most recently.
  const old = { id: 'old', lastModified: 100, tracks: [{}] };
  const mid = { id: 'mid', tracksChangedAt: 500, lastModified: 900, tracks: [{}] };
  const hosted = { id: 'hosted', tracksChangedAt: 1000, tracks: [{}], source: 'hosted-xspf' };
  test('freshest first, by the same freshness Home uses', () => {
    expect(q.coverFetchOrder([old, mid, hosted], {}, new Set()).map((p) => p.id)).toEqual(['hosted', 'mid', 'old']);
  });
  test('a full cached mosaic is skipped; a partial one is fetched', () => {
    const cache = { hosted: { covers: ['1', '2', '3', '4'] }, mid: { covers: ['1'] } };
    expect(q.coverFetchOrder([old, mid, hosted], cache, new Set()).map((p) => p.id)).toEqual(['mid', 'old']);
  });
  test('a playlist tried for its current tracks is skipped until they change', () => {
    const tried = new Set([q.coverAttemptKey(hosted)]);
    expect(q.coverFetchOrder([old, hosted], {}, tried).map((p) => p.id)).toEqual(['old']);
    const changed = { ...hosted, tracksChangedAt: 2000 };
    expect(q.coverFetchOrder([old, changed], {}, tried).map((p) => p.id)).toEqual(['hosted', 'old']);
  });
});

describe('app.js cover effect (source pins)', () => {
  const start = app.indexOf('const playlistCoverLoopRef = useRef(');
  const effect = app.slice(start, app.indexOf('}, [activeView, playlists]);', start));
  test('seeds the cache into state before the network loop', () => {
    expect(start).toBeGreaterThan(-1);
    const seed = effect.indexOf('cachedCoversToSeed(playlists, playlistCoverCache.current, allPlaylistCovers)');
    expect(seed).toBeGreaterThan(-1);
    expect(seed).toBeLessThan(effect.indexOf('await getPlaylistCovers('));
  });
  test('fetches in coverFetchOrder from the latest playlists', () => {
    expect(effect).toContain('coverFetchOrder(playlistsRef.current, playlistCoverCache.current, loop.tried)');
  });
  test('one loop at a time: a running loop is told to start over, not joined by a second', () => {
    expect(effect).toMatch(/if \(loop\.running\) \{\s*loop\.again = true;\s*return;\s*\}/);
    expect(effect).toMatch(/finally \{\s*loop\.running = false;/);
  });
  test('the old storage-order walk is gone', () => {
    expect(app).not.toContain('for (const playlist of playlists) {\n        // Skip if we already have covers for this playlist');
  });
});
