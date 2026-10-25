/**
 * Every album opener falls back to the plugins' catalogs (capabilities.
 * albumSearch, via loadAlbumFromCatalogs) when MusicBrainz fails or doesn't
 * have the album, and albums that came from a service skip MusicBrainz.
 * Source-marker checks on src/renderer/app.js; the matching and conversion
 * are unit-tested in tests/renderer/album-catalog.test.js.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const fnBody = (marker, end = '\n  };') => {
  const s = app.indexOf(marker);
  expect(s).toBeGreaterThan(-1);
  return app.slice(s, app.indexOf(end, s));
};

describe('loadAlbumFromCatalogs', () => {
  const body = fnBody('const loadAlbumFromCatalogs = async (');

  test('goes through the plugin registry, never a named service', () => {
    expect(body).toMatch(/getAlbumSearchResolvers\(\)/);
    expect(body).toMatch(/loader\.searchAlbums\(resolver\.id/);
    expect(body).toMatch(/loader\.lookupAlbumFrom\(resolver\.id, match\.url/);
    expect(body).not.toMatch(/'spotify'|'applemusic'|'bandcamp'|'localfiles'|'subsonic'/);
  });

  test('validates the match and bounds every step', () => {
    expect(body).toMatch(/pickCatalogAlbum\(albums, \{ artist, title \}\)/);
    expect(body).toMatch(/orderCatalogResolvers\(/);
    expect((body.match(/withCatalogTimeout\(/g) || []).length).toBeGreaterThanOrEqual(3);
  });

  test('a search result with _catalog loads from its source directly', () => {
    expect(body).toMatch(/catalog\?\.resolverId && catalog\.url/);
  });
});

describe('fetchReleaseData', () => {
  const body = fnBody('const fetchReleaseData = async (release, artist) => {');

  test('an album with a service id skips MusicBrainz', () => {
    const skip = body.indexOf('if (!isMusicBrainzId(release.id)) {');
    const firstMb = body.indexOf('fetchReleaseDetails(releaseId)');
    expect(skip).toBeGreaterThan(-1);
    expect(skip).toBeLessThan(firstMb);
  });

  test('a MusicBrainz failure tries the catalogs before the in-page error', () => {
    expect(body).toMatch(/console\.error\('Error fetching release data:', error\);[\s\S]*?await tryCatalogs\(\)[\s\S]*?showReleaseLoadError\(release\.id, error/);
  });

  test('the catalog release only fills the page still waiting for it', () => {
    expect(body).toMatch(/const releaseStillWaiting = \(prev\) => !!prev && prev\.id === release\.id && !prev\.tracks;/);
  });
});

describe('openers', () => {
  test('collection albums show a placeholder, then the catalogs on not-found and on error', () => {
    const body = fnBody('const handleCollectionAlbumClick = async (album) => {');
    expect(body).toMatch(/setCurrentRelease\(\{\s*id: collectionPlaceholderId,/);
    expect(body).toMatch(/results\.length === 0\) \{\s*if \(await openFromCatalogs\(\)\) return;/);
    expect(body).toMatch(/catch \(error\) \{[\s\S]*?await openFromCatalogs\(\)/);
    // declared outside the try, so the catch can reach it
    expect(body.indexOf('const openFromCatalogs')).toBeLessThan(body.indexOf('try {'));
  });

  test('parachord://album links fall back the same way', () => {
    const s = app.indexOf("case 'album': {\n            const [artistName, albumTitle] = segments;");
    const body = app.slice(s, app.indexOf("case 'library': {", s));
    expect(body).toMatch(/results\.length === 0\) \{\s*if \(await openFromCatalogs\(\)\) break;/);
    expect(body).toMatch(/catch \(error\) \{[\s\S]*?await openFromCatalogs\(\)/);
    expect(body.indexOf('const openFromCatalogs')).toBeLessThan(body.indexOf('try {'));
  });

  test('search results carry their catalog source into fetchReleaseData', () => {
    const body = fnBody('const handleAlbumClick = async (album) => {');
    expect(body).toMatch(/_catalog: album\._catalog \|\| undefined/);
  });
});

describe('search', () => {
  const s = app.indexOf('const albumPromise = (async () => {');
  const body = app.slice(s, app.indexOf('// Search tracks', s));

  test('a MusicBrainz failure still reaches the catalog supplement', () => {
    expect(body).toMatch(/catch \(mbError\) \{\s*if \(mbError\.name === 'AbortError'\) throw mbError;/);
    expect(body).toMatch(/if \(albums\.length < 3 && query === searchQueryRef\.current\)/);
  });

  test('the supplement uses the registry, not hard-wired services', () => {
    expect(body).toMatch(/getAlbumSearchResolvers\(\)/);
    expect(body).toMatch(/catalogAlbumToSearchResult\(a, resolver\.id\)/);
    expect(body).not.toMatch(/api\.spotify\.com/);
    expect(body).not.toMatch(/musicKit\.api\.music/);
  });

  test('outage results are not cached', () => {
    expect(body).toMatch(/const cacheAlbums = \(list\) => \{\s*if \(!mbOk\) return;/);
    expect(body).not.toMatch(/searchResultsCache\.current\[cacheKey\] = \{\s*\.\.\.searchResultsCache\.current\[cacheKey\],\s*albums: (merged|rerankedAlbums)/);
  });
});
