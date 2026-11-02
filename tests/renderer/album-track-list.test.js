/**
 * The album-card actions' track list (loadAlbumTrackList in app.js; the pure
 * half is src/renderer/lib/album-track-list.js). Play / Add to Queue / Add to
 * Playlist on Search, Home, Fresh Drops and Charts cards, and albums the
 * browser extension sends, used to wait on MusicBrainz alone; they now race it
 * against the services' catalogs.
 */

const fs = require('fs');
const path = require('path');
const {
  firstNonEmptyList,
  entriesFromMusicBrainzRelease,
  entriesFromCatalogRelease,
  pickReleaseGroup,
} = require('../../src/renderer/lib/album-track-list');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');
const fnBody = (marker, end = '\n  };') => {
  const s = app.indexOf(marker);
  expect(s).toBeGreaterThan(-1);
  return app.slice(s, app.indexOf(end, s));
};

const later = (ms, value) => new Promise(r => setTimeout(() => r(value), ms));
const laterReject = (ms) => new Promise((_, j) => setTimeout(() => j(new Error('boom')), ms));

describe('firstNonEmptyList', () => {
  test('the first list with tracks wins, whichever side it is', async () => {
    const won = await firstNonEmptyList([later(30, { tracks: [1], source: 'musicbrainz' }), later(5, { tracks: [2], source: 'spotify' })]);
    expect(won).toEqual({ tracks: [2], source: 'spotify', index: 1 });
  });

  test('an empty list or a failure does not win; the other side still can', async () => {
    expect(await firstNonEmptyList([later(1, { tracks: [] }), later(10, { tracks: [3] })])).toMatchObject({ tracks: [3], index: 1 });
    expect(await firstNonEmptyList([laterReject(1), later(10, { tracks: [4] })])).toMatchObject({ tracks: [4], index: 1 });
    expect(await firstNonEmptyList([later(1, null), later(5, { tracks: [5] })])).toMatchObject({ tracks: [5] });
  });

  test('null when nothing has tracks, or nothing was asked', async () => {
    expect(await firstNonEmptyList([later(1, { tracks: [] }), laterReject(2), later(3, null)])).toBeNull();
    expect(await firstNonEmptyList([])).toBeNull();
  });
});

describe('track entries', () => {
  test('from a MusicBrainz release, every medium in order', () => {
    const release = { media: [
      { tracks: [{ position: 1, title: 'Intro', length: 60000, recording: { id: 'rec-1' } }] },
      { tracks: [{ position: 1, recording: { id: 'rec-2', title: 'From the recording' } }] }
    ] };
    expect(entriesFromMusicBrainzRelease(release)).toEqual([
      { position: 1, title: 'Intro', length: 60000, recordingId: 'rec-1' },
      { position: 1, title: 'From the recording', length: null, recordingId: 'rec-2' }
    ]);
    expect(entriesFromMusicBrainzRelease(null)).toEqual([]);
  });

  test('from a catalog release, no recording ids', () => {
    expect(entriesFromCatalogRelease({ tracks: [{ position: 2, title: 'Roads', length: 305000, mediumIndex: 1 }] }))
      .toEqual([{ position: 2, title: 'Roads', length: 305000, recordingId: null }]);
  });
});

describe('pickReleaseGroup', () => {
  const credit = (name) => [{ name }];
  test('prefers a studio album credited to the artist', () => {
    const results = [
      { id: 'live', 'primary-type': 'Album', 'secondary-types': ['Live'], 'artist-credit': credit('Portishead') },
      { id: 'other', 'primary-type': 'Album', 'artist-credit': credit('Someone Else') },
      { id: 'studio', 'primary-type': 'Album', 'artist-credit': credit('Portishead') }
    ];
    expect(pickReleaseGroup(results, 'portishead').id).toBe('studio');
  });
  test('then anything credited to the artist, then the top result', () => {
    expect(pickReleaseGroup([{ id: 'x', 'artist-credit': credit('A') }, { id: 'ep', 'primary-type': 'EP', 'artist-credit': credit('B') }], 'B').id).toBe('ep');
    expect(pickReleaseGroup([{ id: 'top', 'artist-credit': credit('A') }], 'B').id).toBe('top');
    expect(pickReleaseGroup([], 'B')).toBeNull();
  });
});

describe('app.js wiring', () => {
  const loader = fnBody('const loadAlbumTrackList = async (');

  test('MusicBrainz and the catalogs race; a cached MusicBrainz answer skips the race', () => {
    expect(loader).toMatch(/firstNonEmptyList\(\[skipMusicBrainz \? Promise\.resolve\(null\) : mbSide\(\), catalogSide\(\)\]\)/);
    expect(loader).toMatch(/const mbCached = !skipMusicBrainz && isMusicBrainzId\(releaseGroupId\) && !!cachedReleaseDetails\(releaseGroupId\);/);
    expect(loader).toMatch(/loadAlbumFromCatalogs\(\{ artist, title, catalog, preferResolverId \}\)/);
  });

  test('a release-group id costs one MusicBrainz request; a name costs a search plus one', () => {
    expect(loader).toMatch(/: await fetchReleaseGroupDetails\(rgId\);/);
    expect(loader.match(/musicbrainz\.org\/ws\/2\//g)).toHaveLength(1); // only the search
  });

  test('track ids come from the names the caller asked for, whichever side answered', () => {
    expect(loader).toMatch(/id: trackSlug\(artist \|\| 'unknown', e\.title \|\| 'untitled', title \|\| 'noalbum'\)/);
  });

  test('every album-card action goes through it', () => {
    expect(fnBody('const fetchAlbumTracksFromMusicBrainz = async (')).toMatch(/loadAlbumTrackList\(\{ artist: artistName, title: albumTitle, albumArt \}\)/);
    const search = fnBody('const fetchSearchAlbumTracksAsync = async (album) => {');
    expect(search).toMatch(/loadAlbumTrackList\(\{/);
    expect(search).toMatch(/skipMusicBrainz: !isMbRow/); // a service's row never goes to MusicBrainz
    expect(search).not.toMatch(/musicbrainz\.org/);
    const charts = fnBody('const addChartsToQueue = async (album) => {');
    expect(charts).toMatch(/loadAlbumTrackList\(\{ artist: album\.artist, title: album\.title/);
    expect(charts).not.toMatch(/musicbrainz\.org/);
    const scraped = fnBody('const handleScrapedAlbum = async (albumData) => {');
    expect(scraped).toMatch(/loadAlbumTrackList\(\{ artist, title: album \}\)/);
    expect(scraped).not.toMatch(/musicbrainz\.org/);
    // Top Albums (History, Friends) and AI chat's "play this album"
    const byName = fnBody('const fetchAlbumTracksByName = async (');
    expect(byName).toMatch(/loadAlbumTrackList\(\{ artist: artistName, title: albumName, albumArt \}\)/);
    expect(byName).not.toMatch(/searchMusicBrainzRelease/);
  });
});
