/**
 * The artist page's covers (2026-11-01 regression from #1189). The art loop
 * that fetchArtistData starts runs the fetchSingleAlbumArt of the render
 * before setCurrentArtist landed, so reading the artist from currentArtist got
 * null at launch (or the previous artist after a hop), and every lookup
 * returned null at once: an artist page of music-note placeholders whose
 * covers the Cover Art Archive had. Source markers on src/renderer/app.js.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const fnBody = (marker, end = '\n  };') => {
  const s = app.indexOf(marker);
  expect(s).toBeGreaterThan(-1);
  return app.slice(s, app.indexOf(end, s));
};

test('every art-queue fill tags its releases with the artist it already knows', () => {
  expect(app).toMatch(/const withArtArtist = \(releases, artistName\) =>\s*releases\.map\(r => \(r\.artist \|\| !artistName \? r : \{ \.\.\.r, artist: artistName \}\)\);/);
  // fetchArtistData: cached, fallback-source and progressive paths
  expect(app).toMatch(/withArtArtist\(\s*cachedData\.releases\.filter\(r => !albumArtCache\.current\[r\.id\]\), cachedData\.artist\?\.name \|\| artistName\)/);
  expect(app).toMatch(/withArtArtist\(fallbackReleases\.filter\(r =>[\s\S]{0,80}\), fallbackArtist\.name \|\| artistName\)/);
  expect(app).toMatch(/const needingArt = withArtArtist\(batch\.filter\(r => !albumArtCache\.current\[r\.id\]\), artist\.name\);/);
  // back-navigation
  expect(app).toMatch(/withArtArtist\(\s*cachedData\.releases\.filter\(r => !albumArtCache\.current\[r\.id\]\), cachedData\.artist\?\.name \|\| previousArtist\)/);
  // no fill left untagged
  const fills = app.match(/albumArtQueue\.current = releasesNeedingArt;/g) || [];
  const tagged = app.match(/const releasesNeedingArt = withArtArtist\(/g) || [];
  expect(tagged.length).toBe(fills.length);
});

test('fetchSingleAlbumArt reads the tagged artist first and needs no artist to look up by id', () => {
  const body = fnBody('const fetchSingleAlbumArt = async (release) => {');
  expect(body).toMatch(/const artistName = \(typeof release\.artist === 'string' \? release\.artist : release\.artist\?\.name\)\s*\|\| currentArtist\?\.name;/);
  expect(body).toMatch(/if \(!release\.title\) return null;/);
  expect(body).not.toMatch(/if \(!artistName/);
});

test('getAlbumArt with known ids needs no artist; the name only feeds the fallbacks', () => {
  const body = fnBody('const getAlbumArt = async (artist, album, opts = {}) => {');
  expect(body).toMatch(/^const getAlbumArt = async \(artist, album, opts = \{\}\) => \{\s*if \(!album\) return null;/);
  expect(body).toMatch(/return known \|\| \(artist \? getAlbumArtFromResolvers\(artist, album\) : null\);\s*\}\s*if \(!artist\) return null;/);
});
