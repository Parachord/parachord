/**
 * The playbar's album link on a compilation track (2026-11-24). Since #1652 a
 * compilation's track plays under its own artist, so the link searched
 * MusicBrainz for "Trainspotting" by Iggy Pop, found nothing, and could end on
 * Iggy Pop's page. The track now carries the album's artist too, and the link
 * opens the album by it. Runs the real opener from app.js with fakes.
 */

const fs = require('fs');
const path = require('path');
const { playableAlbumTrack, albumArtistForTrack } = require('../../src/renderer/lib/album-track-artist');
const { isPlaceholderAlbum } = require('../../src/renderer/lib/collection-ids');
const { hasArtistPage } = require('../../src/renderer/lib/artist-page-name');

const read = (p) => fs.readFileSync(path.join(__dirname, '../../src/renderer', p), 'utf8');
const app = read('app.js');

const compilationTrack = (extra) => playableAlbumTrack(
  { title: 'Lust for Life', trackArtist: 'Iggy Pop', ...extra },
  { albumArtist: 'Various Artists', album: 'Trainspotting' }
);

describe('a compilation track carries its album\'s artist', () => {
  test('its own artist, and the album\'s beside it', () => {
    expect(compilationTrack()).toMatchObject({ artist: 'Iggy Pop', albumArtist: 'Various Artists', album: 'Trainspotting' });
  });
  test('an album by one artist is unchanged: no extra field', () => {
    expect(playableAlbumTrack({ title: 'Airbag' }, { albumArtist: 'Radiohead', album: 'OK Computer' })).not.toHaveProperty('albumArtist');
  });
});

describe('albumArtistForTrack: whose album a track\'s album name is', () => {
  test('the album\'s artist when the track has one', () => {
    expect(albumArtistForTrack({ artist: 'Iggy Pop', albumArtist: 'Various Artists', album: 'Trainspotting' }, 'Trainspotting')).toBe('Various Artists');
  });
  test('the track\'s artist when it has none, or only the scanner\'s stand-in', () => {
    expect(albumArtistForTrack({ artist: 'Radiohead', album: 'OK Computer' }, 'OK Computer')).toBe('Radiohead');
    expect(albumArtistForTrack({ artist: 'Radiohead', albumArtist: '', album: 'OK Computer' }, 'OK Computer')).toBe('Radiohead');
    expect(albumArtistForTrack({ artist: 'Radiohead', albumArtist: 'Unknown Artist', album: 'OK Computer' }, 'OK Computer')).toBe('Radiohead');
  });
  test('only for the track\'s own album: a source\'s or the mapper\'s is the track\'s artist\'s', () => {
    expect(albumArtistForTrack({ artist: 'Iggy Pop', albumArtist: 'Various Artists', album: 'Trainspotting' }, 'Lust for Life')).toBe('Iggy Pop');
    expect(albumArtistForTrack({ artist: 'Iggy Pop', albumArtist: 'Various Artists', album: '' }, 'Lust for Life')).toBe('Iggy Pop');
  });
});

// The opener as app.js has it, with everything it calls faked.
function makeOpener({ search, picks = new Map(), mapper = null }) {
  const start = app.indexOf('const openAlbumForTrack = async (track) => {');
  const src = app.slice(start, app.indexOf('const handleAlbumClick = async (album) => {', start));
  const calls = { searched: [], opened: [], placeholders: [], catalogs: [], artistPages: [], loadErrors: [] };
  const window = {};
  const helpers = app.slice(app.indexOf('window.pickAlbumNameForTrack = '), app.indexOf('// Coalesce bursts of per-key state writes'));
  new Function('window', 'normalizeStr', 'isPlaceholderAlbum', helpers)(window, (s) => String(s || '').toLowerCase().trim(), isPlaceholderAlbum);
  const deps = {
    window,
    albumArtistForTrack,
    hasArtistPage,
    showReleaseLoadError: (id, error, retry) => calls.loadErrors.push({ message: error.userMessage, retry: retry.kind }),
    showToast: () => {}, setCurrentRelease: () => {}, setLoadingRelease: () => {}, setArtistHistory: () => {},
    setArtistReleases: () => {}, setCurrentArtist: () => {}, navigateTo: () => {}, fetchReleaseData: () => {},
    openingReleaseRef: { current: false }, rememberReleaseGroupAlias: () => {}, editionPickFor: () => null,
    showReleasePlaceholder: (p) => calls.placeholders.push(p.artist),
    lookupMbidMapper: async () => mapper,
    loadAlbumFromCatalogs: async (a) => { calls.catalogs.push(a.artist); return null; },
    showCatalogRelease: () => false,
    fetchArtistData: (name) => calls.artistPages.push(name),
    handleAlbumClick: (a) => calls.opened.push(a.title),
    releaseGroupPicksRef: { current: { get: (a, t) => picks.get(`${a}|${t}`), set: (a, t, v) => picks.set(`${a}|${t}`, v) } },
    fetch: async (url) => {
      const artist = /artist:"([^"]+)"/.exec(decodeURIComponent(url))[1];
      calls.searched.push(artist);
      return { ok: true, json: async () => ({ 'release-groups': search[artist] || [] }) };
    },
    console: { log() {}, warn() {}, error() {} },
  };
  const open = new Function(...Object.keys(deps), `${src}\nreturn openAlbumForTrack;`)(...Object.values(deps));
  return { open, calls, picks };
}
const group = (title, artist) => ({ id: `${artist}-${title}`, title, 'primary-type': 'Album', 'artist-credit': [{ name: artist }] });

describe('the playbar\'s album link', () => {
  test('a compilation track opens the compilation, found under the album\'s artist', async () => {
    const { open, calls } = makeOpener({ search: { 'Various Artists': [group('Trainspotting', 'Various Artists')] } });
    await open(compilationTrack());
    expect(calls.opened).toEqual(['Trainspotting']);
    expect(calls.searched).toEqual(['Various Artists']);
    expect(calls.placeholders).toEqual(['Various Artists']);
    expect(calls.artistPages).toEqual([]);
  });

  test('a compilation whose page was open already needs no search', async () => {
    const picks = new Map([['Various Artists|Trainspotting', group('Trainspotting', 'Various Artists')]]);
    const { open, calls } = makeOpener({ search: {}, picks });
    await open(compilationTrack());
    expect(calls.opened).toEqual(['Trainspotting']);
    expect(calls.searched).toEqual([]);
  });

  test('nothing under the album\'s artist: the track\'s own artist is tried', async () => {
    const { open, calls, picks } = makeOpener({ search: { 'Iggy Pop': [group('Trainspotting', 'Iggy Pop')] } });
    await open(compilationTrack());
    expect(calls.searched).toEqual(['Various Artists', 'Iggy Pop']);
    expect(calls.opened).toEqual(['Trainspotting']);
    expect(picks.has('Iggy Pop|Trainspotting')).toBe(true);
  });

  test('found nowhere: the catalogs are asked under the album\'s artist, then the track\'s artist page', async () => {
    const { open, calls } = makeOpener({ search: {} });
    await open(compilationTrack());
    expect(calls.catalogs).toEqual(['Various Artists']);
    expect(calls.artistPages).toEqual(['Iggy Pop']);
  });

  test('a track with no artist of its own has no page to fall back to: the album\'s page says why, with a retry', async () => {
    const { open, calls } = makeOpener({ search: {} });
    await open({ artist: 'Various Artists', title: 'Track 1', album: 'Trainspotting' });
    expect(calls.artistPages).toEqual([]);
    expect(calls.loadErrors).toEqual([{ message: 'Couldn’t find this album’s tracks on MusicBrainz or your services.', retry: 'release' }]);
  });

  test('an ordinary track searches once, under its artist, as before', async () => {
    const { open, calls } = makeOpener({ search: { Radiohead: [group('OK Computer', 'Radiohead')] } });
    await open({ artist: 'Radiohead', title: 'Airbag', album: 'OK Computer' });
    expect(calls.searched).toEqual(['Radiohead']);
    expect(calls.opened).toEqual(['OK Computer']);
  });
});

describe('the album\'s artist survives into now playing', () => {
  test('every rebuild of the playing track takes it with the album, from the same record', () => {
    const engine = read('hooks/use-playback-engine.js');
    const albums = engine.match(/album: trackOrSource\.album,\n/g) || [];
    // Set even when there is none: the playing source is spread first, and a
    // local file's own album artist belongs to the file's album, not this one.
    const pairs = engine.match(/album: trackOrSource\.album,\n\s*albumArtist: trackOrSource\.albumArtist,\n/g) || [];
    expect(albums.length).toBeGreaterThan(0);
    expect(pairs.length).toBe(albums.length);
  });
  test('a missing cover is looked up under the album\'s artist', () => {
    expect(app).toContain('getAlbumArt(albumArtistForTrack(currentTrack, currentTrack.album), currentTrack.album)');
  });
});

describe('every path that plays an album builds its tracks with playableAlbumTrack', () => {
  // #1652 missed the album cards' Play, Add to queue and Add to playlist
  // (loadAlbumTrackList) and Critical Darlings' prefetch: a compilation played
  // from its card was still sent as "Various Artists".
  test('the card actions\' track list', () => {
    const s = app.indexOf('const loadAlbumTrackList = async (');
    const body = app.slice(s, app.indexOf('// An edition the user picked on the album page wins', s));
    expect(body).toContain('...playableAlbumTrack({');
    expect(body).toContain('trackArtist: e.trackArtist,');
    expect(body).toContain('albumArtist: artist, album: title');
  });
  test.each(['const prefetchChartsTracks = ', 'const prefetchCriticsPicksTracks = '])('%s', (marker) => {
    const s = app.indexOf(marker);
    const body = app.slice(s, s + 2600);
    expect(body).toContain('...playableAlbumTrack({');
    expect(body).toContain("trackArtist: ownTrackArtist(track, releaseData['artist-credit']),");
    expect(body).toContain('albumArtist: album.artist, album: album.title');
  });
  test('an album the browser extension sends keeps them too', () => {
    expect(app).toContain('artist: track.albumArtist ? track.artist : artistName,');
  });
  test('no album-track builder stamps the album\'s artist by hand', () => {
    expect(app).not.toMatch(/medium\.tracks[\s\S]{0,700}?\n\s+artist: (album\.artist|artistName|artist\?\.name),/);
  });
});
