/**
 * Search speed. Source-marker checks on src/renderer/app.js:
 *   - the MusicBrainz fetch wrapper hands the request's signal to the limiter,
 *     so a superseded search's queued requests leave the queue for free
 *     (the limiter side is tests/resolver/limiter-abort.test.js);
 *   - search-result covers go through getAlbumArt in the background lane,
 *     not a MusicBrainz search of their own in the user's queue;
 *   - performSearch asks the user's services alongside MusicBrainz and merges
 *     the answers (the merge is tests/renderer/search-catalog.test.js).
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const fnBody = (marker, end = '\n  };') => {
  const s = app.indexOf(marker);
  expect(s).toBeGreaterThan(-1);
  return app.slice(s, app.indexOf(end, s));
};

test('the MusicBrainz fetch wrapper passes the signal to the limiter', () => {
  const s = app.indexOf('(function installMusicBrainzThrottle() {');
  const body = app.slice(s, app.indexOf('})();', s));
  expect(body).toMatch(/\{ background: !!mbBackground, signal: fetchInit\.signal \}/);
});

describe('search-result covers', () => {
  const body = fnBody('const fetchSearchAlbumArt = (albums, tracks) => {');

  test('go through getAlbumArt in the background lane, with known MusicBrainz ids', () => {
    expect(body).toMatch(/getAlbumArt\(job\.artist, job\.album, \{ \.\.\.job\.ids, background: true \}\)/);
    expect(body).toMatch(/isMusicBrainzId\(a\.id\) \? \{ releaseGroupId: a\.id \} : \{\}/);
    expect(body).toMatch(/\{ releaseGroupId: t\.releaseGroupId \|\| null, releaseId: t\.releaseId \|\| null \}/);
  });

  test('make no request of their own', () => {
    expect(body).not.toMatch(/fetch\(/);
    expect(body).not.toMatch(/musicbrainz\.org|coverartarchive\.org/);
  });

  test('land through the coalesced writer, not a render per cover', () => {
    expect(body).toMatch(/writer\.queue\(job\.key, url\)/);
    expect(body).not.toMatch(/setSearchResults\(/);
    expect(app).toMatch(/searchArtWriterRef\.current = window\.createCoalescedUpdater\(/);
  });

  test('are never started from inside a state updater', () => {
    const search = fnBody('const performSearch = async (query) => {');
    expect(search).not.toMatch(/setSearchResults\(prev => \{[^}]*fetchSearchAlbumArt/);
  });
});

describe('getAlbumArt', () => {
  const body = fnBody('const getAlbumArt = async (artist, album, opts = {}) => {');

  test('known ids skip the name search and never seed the name-keyed cache', () => {
    expect(body).toMatch(/if \(opts\.releaseGroupId \|\| opts\.releaseId\) \{\s*const known = await fetchCoverArtByIds\(/);
    const idsBranch = body.slice(body.indexOf('if (opts.releaseGroupId'), body.indexOf('const lookupKey'));
    expect(idsBranch).not.toMatch(/albumToReleaseIdCache/);
  });

  test('its MusicBrainz search takes the caller\'s lane', () => {
    expect(body).toMatch(/searchMusicBrainzRelease\(album, artist, \{ background: !!opts\.background \}\)/);
  });
});

describe('performSearch', () => {
  const body = fnBody('const performSearch = async (query) => {');

  test('asks the services at the same time as MusicBrainz', () => {
    expect(body).toMatch(/const catalogPromise = Promise\.all\(\[\s*\.\.\.trackResolvers\.map\(r => searchCatalog\(r, 'tracks'\)\),\s*\.\.\.albumResolvers\.map\(r => searchCatalog\(r, 'albums'\)\)/);
    expect(body).toMatch(/await Promise\.all\(\[artistPromise, albumPromise, trackPromise, catalogPromise\]\)/);
  });

  test('each service search is bounded', () => {
    expect(body).toMatch(/withCatalogTimeout\(resolver\.search\(query, config\)\)/);
    expect(body).toMatch(/withCatalogTimeout\(albumLoader\.searchAlbums\(resolver\.id, query, config\)\)/);
  });

  test('track rows come only from playable resolvers', () => {
    expect(body).toMatch(/\.filter\(r => typeof r\.play === 'function'\)/);
  });

  test('merges with the confidence scorer and its floor', () => {
    expect(body).toMatch(/const scorer = \{ calculateConfidence, threshold: MIN_CONFIDENCE_THRESHOLD, normalize: normalizeStr \}/);
    expect(body).toMatch(/mergeTrackResults\(mb\.tracks \|\| \[\], trackLists\(\), scorer\)/);
  });

  test('a stale query publishes nothing', () => {
    for (const name of ['publishArtists', 'publishAlbums', 'publishTracks']) {
      const s = body.indexOf(`const ${name} = () => {`);
      expect(body.slice(s, s + 80)).toMatch(/if \(!isCurrent\(\)\) return;/);
    }
  });
});
