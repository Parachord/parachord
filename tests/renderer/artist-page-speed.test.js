/**
 * Artist page speed.
 *   - src/renderer/lib/artist-open.js: the MusicBrainz artist id a Search
 *     result already carries, so the page skips its name search;
 *   - fetchArtistData (source markers): no lookup when the caller passes the
 *     MBID, and each release type shown as it arrives instead of after all
 *     three requests (the page used to wait for the singles request).
 */

const fs = require('fs');
const path = require('path');
const { artistOpenOptions, creditOpenOptions, trackArtistOpenOptions } = require('../../src/renderer/lib/artist-open');

const MBID = 'a74b1b7f-71a5-4011-9441-d0b5e4122711';
const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const searchPage = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/search-page.js'), 'utf8');
const fnBody = (marker, end = '\n  };') => {
  const s = app.indexOf(marker);
  expect(s).toBeGreaterThan(-1);
  return app.slice(s, app.indexOf(end, s));
};

describe('artist-open', () => {
  test('a MusicBrainz artist row passes its id', () => {
    expect(artistOpenOptions({ id: MBID, name: 'Radiohead' })).toEqual({ mbid: MBID });
  });

  test('a service artist row or a missing row passes nothing', () => {
    expect(artistOpenOptions({ id: 'spotify-artist-radiohead', name: 'Radiohead' })).toEqual({});
    expect(artistOpenOptions(null)).toEqual({});
  });

  test('an artist credit passes its first artist', () => {
    expect(creditOpenOptions([{ name: 'Radiohead', artist: { id: MBID } }, { name: 'X', artist: { id: 'b' } }])).toEqual({ mbid: MBID });
    expect(creditOpenOptions([{ name: 'Various Artists' }])).toEqual({});
    expect(creditOpenOptions(undefined)).toEqual({});
  });

  test('a recording row passes its first credited artist', () => {
    expect(trackArtistOpenOptions({ artist: 'Radiohead', artistMbids: [MBID] })).toEqual({ mbid: MBID });
    expect(trackArtistOpenOptions({ artist: 'Radiohead', _source: 'spotify' })).toEqual({});
  });
});

describe('fetchArtistData', () => {
  const body = fnBody('const fetchArtistData = async (artistName, options = {}) => {', '\n  // Fetch release data (album/EP/single)');

  test('a caller-supplied MBID skips the artist lookup', () => {
    expect(body).toMatch(/const knownMbid = isMusicBrainzId\(options\.mbid\) \? options\.mbid : null;/);
    // artistLookupPlan: 'known' fetches nothing (page-load-budget.test.js counts it)
    expect(body).toMatch(/const lookupPlan = artistLookupPlan\(\{ name: artistName, knownMbid, mapperMbid: mapperArtistMbid \}\);/);
    expect(body).toMatch(/const knownArtist = lookupPlan\.kind === 'known' \? \{ id: knownMbid, name: artistName, score: 100 \} : null;/);
    expect(body).toMatch(/let mapperArtistMbid = knownMbid \|\| getArtistMbidFromMapperCache\(artistName\);/);
    expect(body).toMatch(/if \(!knownArtist && !searchResponse\.ok\)/);
  });

  test('a cached namesake is not served for a known MBID', () => {
    expect(body).toMatch(/cacheNameMatch &&\s*\(!knownMbid \|\| cachedData\.artist\?\.mbid === knownMbid\);/);
  });

  test('each release type is shown as it arrives, not after all three', () => {
    // loadArtistReleaseGroups hands each type to onBatch as it answers
    expect(body).toMatch(/onBatch: \(releases\) => showReleases\(releases\)/);
    // the 500ms stagger is gone: the MusicBrainz limiter spaces the requests
    expect(body).not.toMatch(/setTimeout\(resolve, index \* 500\)/);
    // rows already on screen keep their object (and any cover written into it)
    expect(body).toMatch(/return sorted\.map\(r => shown\.get\(r\.id\) \|\| withCachedArt\(r\)\);/);
    // the art queue starts with the first batch and later batches append to it
    expect(body).toMatch(/albumArtQueue\.current = \[\.\.\.albumArtQueue\.current, \.\.\.needingArt\];/);
    // a stale fetch (the user went to another artist) shows nothing
    expect(body).toMatch(/if \(thisFetchId !== artistFetchId\.current \|\| batch\.length === 0\) return;/);
  });

  test('loading ends only when all three have answered', () => {
    const all = body.indexOf('const uniqueReleases = (await loadArtistReleaseGroups(artist.id, {');
    const done = body.indexOf('setLoadingArtist(false);', all);
    expect(all).toBeGreaterThan(-1);
    expect(done).toBeGreaterThan(all);
    expect(body.slice(body.indexOf('const showReleases = (batch) => {'), all)).not.toMatch(/setLoadingArtist\(false\)/);
  });
});

test('the Search page passes the MBIDs it has', () => {
  expect(searchPage).toMatch(/fetchArtistData\(artist\.name, artistOpenOptions\(artist\)\)/);
  expect(searchPage).toMatch(/fetchArtistData\(album\['artist-credit'\]\?\.\[0\]\?\.name, creditOpenOptions\(album\['artist-credit'\]\)\)/);
  expect(searchPage).toMatch(/fetchArtistData\(track\.artist, trackArtistOpenOptions\(track\)\)/);
  expect(searchPage).toMatch(/fetchArtistData\(entry\.selectedResult\.name, artistOpenOptions\(entry\.selectedResult\)\)/);
  expect(searchPage).not.toMatch(/fetchArtistData\(artist\.name\)/);
});

// An uncached artist's discography takes an artist lookup and three
// release-group requests in MusicBrainz's 1.1s queue. When none of it has
// shown after ARTIST_SLOW_FALLBACK_MS, the services' discography shows
// meanwhile; MusicBrainz's first batch replaces it.
describe('slow MusicBrainz: the services\' discography meanwhile', () => {
  const fetchArtist = fnBody('const fetchArtistData = async (artistName, options = {}) => {', '\n  // Fetch release data (album/EP/single) with full track listing');

  test('after 3s, the not-on-MusicBrainz sources fill the page', () => {
    expect(app).toMatch(/const ARTIST_SLOW_FALLBACK_MS = 3000;/);
    // One pass over the services, run by the timer and by a MusicBrainz
    // failure (#874) alike
    expect(fetchArtist).toMatch(/const slowFallbackTimer = setTimeout\(showServiceDiscography, ARTIST_SLOW_FALLBACK_MS\);/);
    const timer = fetchArtist.slice(fetchArtist.indexOf('const showServiceDiscography = () =>'), fetchArtist.indexOf('const slowFallbackTimer = setTimeout('));
    expect(timer).toMatch(/\[fetchArtistFromSpotify, fetchArtistFromMusicKit, fetchArtistFromLastfm, fetchArtistFromDiscogs\]/);
    // stale and settled checks before and after every source
    expect(timer.match(/if \(thisFetchId !== artistFetchId\.current \|\| discographySettled\) return;/g)).toHaveLength(2);
    expect(timer).toMatch(/setArtistReleases\(shown\);/);
    expect(timer).toMatch(/albumArtFetchId\.current\+\+;/);
    // only on the uncached path: the cached path returns before the timer
    expect(fetchArtist.indexOf("console.log('📦 Using cached artist data for:'")).toBeLessThan(fetchArtist.indexOf('const slowFallbackTimer'));
  });

  test('MusicBrainz\'s first batch, or the not-on-MusicBrainz path, settles it', () => {
    const show = fetchArtist.slice(fetchArtist.indexOf('const showReleases = (batch) => {'), fetchArtist.indexOf('const releasePromises = '));
    expect(show).toMatch(/discographySettled = true;[^\n]*\n\s*clearTimeout\(slowFallbackTimer\);/);
    // the list is rebuilt from MusicBrainz's releases only, so a service list goes
    expect(show).toMatch(/return sorted\.map\(r => shown\.get\(r\.id\) \|\| withCachedArt\(r\)\);/);
    expect(fetchArtist).toMatch(/if \(!mbMatchIsGood\) \{\s*\/\/ This path asks the same services itself\s*discographySettled = true;\s*clearTimeout\(slowFallbackTimer\);/);
  });

  test('a MusicBrainz miss keeps the service list and caches nothing', () => {
    const tail = fetchArtist.slice(fetchArtist.indexOf('console.log(`Found ${uniqueReleases.length} release-groups'), fetchArtist.indexOf('artistDataCache.current[cacheKey] = {\n        artist: artistData'));
    expect(tail).toMatch(/if \(uniqueReleases\.length === 0 && serviceDiscographySource\) \{[\s\S]*?return;\s*\}/);
  });
});
