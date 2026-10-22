/**
 * Critical Darlings and Pop of the Tops art passes. Both read a null in
 * albumToReleaseIdCache (MusicBrainz had no match) as "no art anywhere":
 * Critical Darlings pinned the placeholder and persisted albumArt: null with
 * the picks, Charts skipped the album. Neither checked the resolver:/catalog:
 * cache keys nor asked the resolvers and the iTunes/Deezer catalogs, so new
 * and small releases never got art (Jeremiah Chiu "Edge Conditions", Dummy,
 * The Tallest Man on Earth, 2026-10: all three in iTunes or Deezer, Dummy's
 * already cached from Apple Music).
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

const body = (name) => {
  const start = app.indexOf(`const ${name} = async (albums) => {`);
  expect(start).toBeGreaterThan(-1);
  return app.slice(start, app.indexOf('\n  };\n', start));
};

describe.each(['fetchCriticsPicksAlbumArt', 'fetchChartsAlbumArt'])('%s', (name) => {
  test('classifies with getCachedAlbumArt, which covers every cache shape', () => {
    expect(body(name)).toMatch(/const cachedArt = getCachedAlbumArt\(album\.artist, album\.title\);/);
  });

  test('sends every cache miss to getAlbumArt, including a MusicBrainz miss', () => {
    const b = body(name);
    expect(b).toMatch(/if \(cachedArt\) \{[\s\S]*?\} else \{\s*albumsNeedingFetch\.push\(album\);\s*\}/);
    expect(b).toMatch(/await getAlbumArt\(album\.artist, album\.title\)/);
  });

  test('no longer treats a null release id as a permanent miss', () => {
    const b = body(name);
    expect(b).not.toMatch(/cachedReleaseId === null|cachedReleaseId !== null/);
    expect(b).not.toMatch(/failedAlbumIds/);
    // An object-form id ({ releaseId, releaseGroupId }) used as a key never hit.
    expect(b).not.toMatch(/albumArtCache\.current\[cachedReleaseId\]/);
  });
});

// Critical Darlings restored from cache keep the art they were saved with, and
// the art pass only ran from loadCriticsPicks, which a cache under 4 hours old
// skips: picks saved with albumArt: null stayed blank until the cache went
// stale. The deferred big-cache hydration now retries them once the album-art
// caches are in (the restore itself runs before those load).
describe('Critical Darlings restored from cache', () => {
  const start = app.indexOf('scheduleIdle(async () => {');
  const idle = app.slice(start, app.indexOf('// end scheduleIdle for big-cache hydration', start));

  test('the deferred hydration retries picks saved without a cover', () => {
    expect(idle).toMatch(/const criticsMissingArt = \(criticsPicksCache\.current\.albums \|\| \[\]\)\.filter\(a => typeof a\.albumArt !== 'string'\);/);
    expect(idle).toMatch(/\.then\(\(\) => fetchCriticsPicksAlbumArt\(criticsMissingArt\)\)/);
  });

  test('it waits for resolvers, bounded, like the Fresh Drops pass', () => {
    expect(idle).toMatch(/Promise\.race\(\[resolversReadyForCritics, new Promise\(resolve => setTimeout\(resolve, 15000\)\)\]\)/);
  });

  test('it runs after the album-art cache is hydrated', () => {
    expect(idle.indexOf('albumArtCache.current = Object.fromEntries(validEntries);')).toBeGreaterThan(-1);
    expect(idle.indexOf('albumArtCache.current = Object.fromEntries(validEntries);')).toBeLessThan(idle.indexOf('const criticsMissingArt'));
  });
});
