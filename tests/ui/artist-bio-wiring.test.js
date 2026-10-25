/**
 * Artist bio wiring in app.js (the logic is in src/renderer/lib/artist-bio.js):
 * - the Wikipedia bio and image get the Wikidata id from lookupWikidataId,
 *   never by asking MusicBrainz themselves, so a MusicBrainz outage doesn't
 *   take them down (Wild Pink, 2026-10-25);
 * - bios go through the session cache shared by the playbar and the page;
 * - the playbar's fetch doesn't touch the Biography tab's loadingBio, which
 *   the tab checks before fetching (a playbar fetch in progress left it blank).
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const body = (startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  return start === -1 || end === -1 ? '' : src.slice(start, end);
};

const wikiBio = body('const getWikipediaBio = async (artistMbid) => {', '\n  };\n');
const wikiImage = body('const getWikipediaArtistImage = async (artistMbid) => {', '\n  };\n');
const uncached = body('const fetchArtistBioUncached = async (artistName, artistMbid) => {', '\n  };\n');
const pageBio = body('const getArtistBio = async (artistName, artistMbid) => {', '\n  };\n');
const playbar = body('// Fetch artist bio for playbar tooltip when track changes', '}, [currentTrack?.artist]);');

describe('artist bio wiring', () => {
  test('the markers this test depends on exist', () => {
    for (const part of [wikiBio, wikiImage, uncached, pageBio, playbar]) expect(part.length).toBeGreaterThan(0);
  });

  test('the Wikipedia bio and image ask lookupWikidataId, not MusicBrainz', () => {
    for (const part of [wikiBio, wikiImage]) {
      expect(part).toContain('await lookupWikidataId(artistMbid)');
      expect(part).not.toContain('musicbrainz.org');
    }
  });

  test('the Wikidata lookup and the bio cache are module-scope singletons', () => {
    expect(src).toMatch(/^const lookupWikidataId = createWikidataIdLookup\(/m);
    expect(src).toMatch(/^const artistBioCache = createArtistBioCache\(\);/m);
    expect(src).toContain('artistBioCache.load(artistName, artistMbid, fetchArtistBioUncached)');
  });

  test('only the page fetch drives loadingBio', () => {
    expect(uncached).not.toContain('setLoadingBio');
    expect(pageBio).toContain('setLoadingBio(true)');
    expect(pageBio).toContain('await fetchArtistBio(artistName, artistMbid)');
    expect(playbar).toContain('await fetchArtistBio(currentTrack.artist, mbid)');
    expect(playbar).not.toContain('getArtistBio(');
  });
});
