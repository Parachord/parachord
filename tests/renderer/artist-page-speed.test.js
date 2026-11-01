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
    expect(body).toMatch(/const knownArtist = knownMbid \? \{ id: knownMbid, name: artistName, score: 100 \} : null;\s*if \(knownArtist\) \{\s*\/\/ nothing to fetch\s*\} else if \(mapperArtistMbid\)/);
    expect(body).toMatch(/let mapperArtistMbid = knownMbid \|\| getArtistMbidFromMapperCache\(artistName\);/);
    expect(body).toMatch(/if \(!knownArtist && !searchResponse\.ok\)/);
  });

  test('a cached namesake is not served for a known MBID', () => {
    expect(body).toMatch(/cacheNameMatch &&\s*\(!knownMbid \|\| cachedData\.artist\?\.mbid === knownMbid\);/);
  });

  test('each release type is shown as it arrives, not after all three', () => {
    expect(body).toMatch(/showReleases\(releases\);\s*return releases;/);
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
    const all = body.indexOf('const releaseResults = await Promise.all(releasePromises);');
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
