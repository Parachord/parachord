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
  const body = fnBody('const loadAlbumFromCatalogsNow = async (');

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
    // an MB edition pick can open that fence (the pick's release is a real MB id)
    const skip = body.indexOf("if (!isMusicBrainzId(release.id) && pickEdition?.kind !== 'mb') {");
    const firstMb = body.indexOf('releaseLookupRef.current.loadRelease(');
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
  test('every release-group search is picked by the shared matcher, never by "first studio album"', () => {
    // The title and the artist decide (album-catalog.js), a joint credit
    // written "A, B" by the source and "A & B" by MusicBrainz included; the
    // opener that still had its own chain opened an unrelated tribute album
    // for Ozzy Osbourne & Black Sabbath's "Back to the Beginning" (2026-11-20).
    expect(app).not.toMatch(/artistMatches\.find\(isStudioAlbum\)/);
    expect(fnBody('const handleCollectionAlbumClick = async (album) => {'))
      .toMatch(/pickReleaseGroupForAlbum\([^;]*\{ artist: album\.artist, title: album\.title \}\)/);
    const protocol = app.slice(app.indexOf("case 'album': {"), app.indexOf("case 'library': {"));
    expect(protocol).toMatch(/pickReleaseGroupForAlbum\(results, \{ artist: artistName, title: albumTitle \}\)/);
    expect(fnBody('const loadAlbumTrackList = async (')).toMatch(/pickReleaseGroup\(\(await searchResp\.json\(\)\)\['release-groups'\], artist, title\)/);
  });

  test('an album found nowhere shows the reason and a retry, not a stranded skeleton', () => {
    const body = fnBody('const handleCollectionAlbumClick = async (album) => {');
    // The placeholder stays on screen (title and cover) with ReleasePage's
    // ErrorState; a toast used to leave its track skeleton up forever.
    expect(body).toMatch(/showReleaseLoadError\(collectionPlaceholderId, (notFound|error), \{\s*\n?\s*run: \(\) => handleCollectionAlbumClickRef\.current\?\.\(album\)/);
    expect(body).not.toMatch(/showToast\(['"]Album not found/);
    // The retry calls the LATEST opener, not the render's closure
    expect(app).toContain('const handleCollectionAlbumClickRef = useRef(null);');
    expect(app).toContain('handleCollectionAlbumClickRef.current = handleCollectionAlbumClick;');
    // ...and the opener does not skip a page that is showing a load error
    expect(body).toMatch(/currentArtist\?\.name === album\.artist && !currentRelease\?\._loadError/);
    // The protocol opener does the same, through the same ref
    const protocol = app.slice(app.indexOf("case 'album': {"), app.indexOf("case 'library': {"));
    expect(protocol).toMatch(/showReleaseLoadError\(linkPlaceholderId, notFound, \{\s*\n?\s*run: \(\) => handleCollectionAlbumClickRef\.current\?\.\(/);
  });

  test('a local album takes a joint-credit result for its own album, not only one credited to its first artist', () => {
    // #1532: an album with local files only takes a MusicBrainz result with
    // its own title, else its files' catalog opens it. The title is compared
    // through normalizeAlbumTitle and the artist through the shared credit
    // rule, so a file tagged with one artist of a joint credit still matches
    // (the old first-credit string compare missed the other direction).
    const body = fnBody('const handleCollectionAlbumClick = async (album) => {');
    expect(body).toMatch(/const wantedTitle = normalizeAlbumTitle\(album\.title\);/);
    expect(body).toMatch(/normalizeAlbumTitle\(r\.title\) === wantedTitle\s*&& creditMatches\(album\.artist, releaseGroupCredit\(r\)\)/);
    expect(body).not.toMatch(/albumIdentity\(r\['artist-credit'\]/);
  });

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
  const search = fnBody('const performSearch = async (query) => {');
  const s = search.indexOf('const albumPromise = (async () => {');
  const body = search.slice(s, search.indexOf('// Search tracks', s));

  test('a MusicBrainz failure still reaches the catalogs, inactive ones included', () => {
    // searchMusicBrainzAlbums answers a network failure with { ok: false,
    // failed: true } and rethrows only AbortError (page-load-budget.test.js
    // runs it); Search carries on to the catalogs
    expect(body).toMatch(/const result = await searchMusicBrainzAlbums\(query, \{ fetch, fetchOptions \}\);/);
    expect(body).toMatch(/mbOk\.albums = result\.ok;/);
    expect(body).toMatch(/if \(mb\.albums\.length < 3 && albumLoader\?\.getAlbumSearchResolvers\)/);
    expect(body).toMatch(/fallbackAlbumResolvers = orderCatalogResolvers\(albumLoader\.getAlbumSearchResolvers\(\)/);
  });

  test('the catalogs come from the registry, not hard-wired services', () => {
    expect(search).toMatch(/searchResolversFor\(albumLoader\.getAlbumSearchResolvers\(\), \{\s*activeIds, order, capability: 'albumSearch', fn: 'searchAlbums'/);
    expect(search).toMatch(/searchResolversFor\(loadedResolversRef\.current, \{\s*activeIds, order, capability: 'search', fn: 'search'/);
    expect(search).toMatch(/catalogAlbumsToSearchResults\(Array\.isArray\(found\) \? found : \[\], resolver\.id, priority\)/);
    expect(search).not.toMatch(/api\.spotify\.com/);
    expect(search).not.toMatch(/musicKit\.api\.music/);
    expect(search).not.toMatch(/activeIds\.includes\('(spotify|applemusic)'\)/);
  });

  test('outage results are not cached', () => {
    expect(search).toMatch(/if \(mbOk\.albums\) cacheCategory\('albums', rows\);/);
    expect(search).toMatch(/if \(mbOk\.tracks\) cacheCategory\('tracks', rows\);/);
    expect(search).toMatch(/if \(mbOk\.artists\) cacheCategory\('artists', rows\);/);
  });
});

describe('the catalogs race MusicBrainz', () => {
  test('concurrent lookups for the same album share one', () => {
    const body = fnBody('const loadAlbumFromCatalogs = (args) => {');
    expect(body).toMatch(/catalogLookupsInFlight\.current\.get\(key\)/);
    expect(body).toMatch(/\.finally\(\(\) => catalogLookupsInFlight\.current\.delete\(key\)\)/);
  });

  test('the catalogs race MusicBrainz as soon as a page is waiting for its track list', () => {
    // It used to wait 5s (MB_SLOW_FALLBACK_MS) before asking the catalogs.
    expect(app).not.toMatch(/MB_SLOW_FALLBACK_MS/);
    const s = app.indexOf('const waitingAlbumKey = ');
    const body = app.slice(s, app.indexOf('}, [waitingAlbumKey]);', s));
    expect(body).not.toMatch(/setTimeout/);
    expect(body).toMatch(/currentReleaseRef\.current/); // the page now, not a stale closure
    expect(body).toMatch(/sameAlbumIdentity\(prev, waiting\)/); // keyed on the album, not the id
    // MusicBrainz's answer already cached: it lands at once, no catalog call
    expect(body).toMatch(/if \(waiting\.id && cachedReleaseDetails\(waiting\.id\)\) return;/);
    expect(body).toMatch(/cancelled = true/);
    // the dependency is computed during render from state declared above it
    expect(app.indexOf('const [currentRelease, setCurrentRelease] = useState')).toBeLessThan(s);
  });

  test('a track the catalog list is already resolving is not resolved again when MusicBrainz\'s list lands', () => {
    const helper = fnBody('const resolveAlbumTrack = (track, artistName) => {');
    expect(helper).toMatch(/if \(inFlight\.has\(track\.id\)\) return inFlight\.get\(track\.id\);/);
    expect(helper).toMatch(/\.finally\(\(\) => inFlight\.delete\(track\.id\)\)/);
    expect(fnBody('const showCatalogRelease = ({ found, requested, artist, canApply }) => {')).toMatch(/resolveAlbumTrack\(\{ \.\.\.track, id: albumTrack\.id \}, albumTrack\.artist \|\| artistName\)/);
    expect(fnBody('const fetchReleaseData = async (release, artist) => {')).toMatch(/resolveAlbumTrack\(\{ \.\.\.track, id: albumTrack\.id \}, albumTrack\.artist \|\| artistName\)/);
  });

  test('fetchReleaseData does not blank a catalog list already on screen, and the fastest list stays', () => {
    const body = fnBody('const fetchReleaseData = async (release, artist) => {');
    expect(body).toMatch(/const keepCatalogList = [\s\S]*?shownRelease\._catalogSource[\s\S]*?if \(!keepCatalogList\) \{\s*setCurrentRelease\(partialRelease\);/);
    // MusicBrainz's answer doesn't replace a catalog list for this album
    // (replacing it flickered the source from the service to MusicBrainz).
    expect(body).toMatch(/const keepsFirstList = \(prev\) => !!\(prev && prev\._catalogSource && prev\.tracks\s*&& sameAlbumIdentity\(prev, \{ title: release\.title, artist: artistNameForLookup \}\)\);/);
    expect(body).toMatch(/setCurrentRelease\(prev => \(prev && \(prev\._pickingEdition \|\| keepsFirstList\(prev\)\) \? prev : releaseInfo\)\);/);
    // a MusicBrainz failure with the catalog list showing leaves it be
    expect(body).toMatch(/onScreen\._catalogSource && onScreen\.tracks[\s\S]*?setLoadingRelease\(false\);\s*return;/);
  });
});
