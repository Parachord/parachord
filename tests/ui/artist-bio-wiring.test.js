/**
 * Artist bio wiring in app.js (the logic is in src/renderer/lib/artist-bio.js):
 * - bios come from the plug-ins with capabilities.biography (#1539 step 6),
 *   never from a service called by name;
 * - the Wikipedia image gets the Wikidata id from lookupWikidataId, never by
 *   asking MusicBrainz itself, so a MusicBrainz outage doesn't take it down
 *   (Wild Pink, 2026-10-25; the Wikipedia plug-in's bio does the same);
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

const wikiImage = body('const getWikipediaArtistImage = async (artistMbid) => {', '\n  };\n');
const uncached = body('const fetchArtistBioUncached = async (artistName, artistMbid) => {', '\n  };\n');
const pageBio = body('const getArtistBio = async (artistName, artistMbid) => {', '\n  };\n');
const playbar = body('// Fetch artist bio for playbar tooltip when track changes', '}, [currentTrack?.artist]);');

describe('artist bio wiring', () => {
  test('the markers this test depends on exist', () => {
    for (const part of [wikiImage, uncached, pageBio, playbar]) expect(part.length).toBeGreaterThan(0);
  });

  test('the Wikipedia image asks lookupWikidataId, not MusicBrainz', () => {
    expect(wikiImage).toContain('await lookupWikidataId(artistMbid)');
    expect(wikiImage).not.toContain('musicbrainz.org');
  });

  test('bios come from the biography plug-ins, all asked at once, in the user\'s order', () => {
    expect(uncached).toContain("askEach(similarProvidersFor('biography')");
    expect(uncached).toContain('loader.getArtistBio(p.id, artist, await configForSimilar(p.id))');
    expect(uncached).toContain('bioWithSources(answers)');
  });

  test('app.js no longer fetches a bio from a service by name', () => {
    expect(src).not.toMatch(/getLastfmBio|getWikipediaBio|getDiscogsBio|bioFromWikipediaExtract|normalizeDiscogsProfile/);
    expect(src).not.toMatch(/method=artist\.getinfo|prop=extracts/);
    expect(src).not.toMatch(/metaServiceConfigs(Ref\.current)?\??\.discogs\b[\s\S]{0,80}personalAccessToken[\s\S]{0,400}profile/);
  });

  test('Search\'s artist preview reads the same cached bio', () => {
    const preview = body('const fetchArtistBioSnippet = async () => {', '\n    };\n');
    expect(preview).toContain('await fetchArtistBio(artistName');
    expect(preview).not.toContain('lastfm');
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
  test('the bio shown follows the last pick, then a preferred plug-in, and the pick is saved', () => {
    const fetchBio = body('const fetchArtistBio = async (artistName, artistMbid) => {', '\n  };\n');
    expect(fetchBio).toContain('preferredBio(bio, bioPreference(artistBioPickRef.current, resolvers))');
    const pick = body('const pickArtistBioSource = (sourceId) => {', '\n  };\n');
    expect(pick).toContain("store?.set('artist_bio_source', sourceId)");
    expect(pick).toContain('artistBioPickRef.current = sourceId');
    expect(src).toContain("artistBioPickRef.current = d['artist_bio_source']");
    const store = fs.readFileSync(path.join(__dirname, '../../main-process/ipc/store.js'), 'utf8');
    expect(store).toContain("'artist_bio_source'");
    const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/artist-page.js'), 'utf8');
    expect(page).toContain('onChange: pickArtistBioSource');
  });
});
