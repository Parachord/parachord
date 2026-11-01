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
    expect(body).toMatch(/jobs\.settled\.add\(key\);\s*writer\.queue\(key, url\);/);
    expect(body).not.toMatch(/setSearchResults\(/);
    expect(app).toMatch(/searchArtWriterRef\.current = window\.createCoalescedUpdater\(/);
  });

  test('a row shows the cover a service already returned when the pipeline is slow or empty', () => {
    expect(app).toMatch(/const SEARCH_ART_FALLBACK_MS = 2000;/);
    expect(body).toMatch(/const fallback = serviceArtFor\(item\);\s*if \(fallback\) setTimeout\(\(\) => settle\(key, fallback\), SEARCH_ART_FALLBACK_MS\);/);
    expect(body).toMatch(/settle\(job\.key, url \|\| job\.fallback\);/);
    // first cover wins: a row never swaps covers, and a settled row skips the pipeline
    expect(body).toMatch(/if \(!url \|\| jobs\.query !== query \|\| jobs\.settled\.has\(key\)\) return;/);
    expect(body).toMatch(/if \(jobs\.settled\.has\(job\.key\)\) continue;/);
    // the fallback is displayed, never cached
    expect(body).not.toMatch(/albumArtCache\.current\[[^\]]+\] =/);
  });

  test('a track row with no album name goes through getTrackArt', () => {
    expect(body).toMatch(/job\.album\s*\? await getAlbumArt\(job\.artist, job\.album, \{ \.\.\.job\.ids, background: true \}\)\s*: await getTrackArt\(job\.artist, job\.title\)/);
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

  test('its MusicBrainz search takes the background lane unless the caller says otherwise', () => {
    // A cover is never what the user clicked for: five cover searches queued
    // at launch made the artist page's lookup wait 11s (2026-11-01).
    expect(body).toMatch(/searchMusicBrainzRelease\(album, artist, \{ background: opts\.background !== false \}\)/);
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

  test('track rows rank on artist and title, with each service\'s priority', () => {
    expect(body).toMatch(/reRankResults\(mergeTrackResults\(mb\.tracks \|\| \[\], trackLists\(\), scorer\), query, TRACK_RANK_KEY\)/);
    expect(body).toMatch(/const priority = trackResolvers\.indexOf\(resolver\);/);
  });

  test('a stale query publishes nothing', () => {
    for (const name of ['publishArtists', 'publishAlbums', 'publishTracks']) {
      const s = body.indexOf(`const ${name} = () => {`);
      expect(body.slice(s, s + 80)).toMatch(/if \(!isCurrent\(\)\) return;/);
    }
  });
});

describe('results show as they arrive', () => {
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/search-page.js'), 'utf8');

  test('the skeleton stands in only until the first rows land', () => {
    // Gating the whole list on isSearching held every result back until the
    // last request finished (the services' rows waited on MusicBrainz).
    expect(page).toMatch(/isSearching &&\s*searchResults\.artists\.length === 0 &&\s*searchResults\.albums\.length === 0 &&\s*searchResults\.tracks\.length === 0 &&\s*searchResults\.playlists\.length === 0 \?/);
    expect(page).not.toMatch(/\n\s*isSearching \?\n/);
  });

  test('a new query with nothing cached clears the previous query\'s rows', () => {
    const input = fnBody('const handleSearchInput = (value) => {');
    expect(input).toMatch(/\} else \{[\s\S]{0,200}setSearchResults\(\{ artists: \[\], albums: \[\], tracks: \[\], playlists: \[\] \}\);/);
  });
});

describe('only what the user asked for takes the foreground MusicBrainz lane', () => {
  test('the playbar bio tooltip\'s artist search is background', () => {
    const s = app.indexOf('// Fetch artist bio for playbar tooltip when track changes');
    const block = app.slice(s, app.indexOf('\n  }, [', s));
    expect(block).toMatch(/musicbrainz\.org\/ws\/2\/artist\?query=[\s\S]{0,200}mbBackground: true/);
  });

  test('the play path\'s cover check for a local file is background', () => {
    const hook = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
    expect(hook).toMatch(/await enrichTrackWithMbid\(trackToSet, \{ background: true \}\);/);
    expect(hook).not.toMatch(/await enrichTrackWithMbid\(trackToSet\);/);
  });

  test('the dead sequential art loader (a foreground MusicBrainz caller) is gone', () => {
    expect(app).not.toMatch(/fetchAlbumArtLazy/);
  });

  test('Home\'s suggestion validation is background', () => {
    const s = app.indexOf('const validateAlbum = async (album) => {');
    expect(app.slice(s, s + 600)).toMatch(/\{ headers: mbHeaders, mbBackground: true \}/);
  });
});
