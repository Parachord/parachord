// A compilation's tracks carry their own artist (2026-11-23): an album page
// sent every track as "Various Artists", which scores 0.5 against the real
// recording (below the 0.6 floor), so a compilation never found a source.
const { creditName, ownTrackArtist, albumTrackArtist, hasTrackArtists, playableAlbumTrack, isVariousArtists, ownCatalogTrackArtist } = require('../../src/renderer/lib/album-track-artist');
const { trackSlug } = require('../../src/renderer/lib/track-slug');

const VA = [{ name: 'Various Artists', artist: { id: '89ad4ac3-39f7-470e-963a-56509c546377' } }];
const credit = (...parts) => parts.map(([name, id, joinphrase = '']) => ({ name, joinphrase, artist: { id } }));

describe('creditName', () => {
  test('joins the credited names with their join phrases', () => {
    expect(creditName(credit(['Daft Punk', 'dp', ' feat. '], ['Pharrell Williams', 'pw', ' & '], ['Nile Rodgers', 'nr']))).toBe('Daft Punk feat. Pharrell Williams & Nile Rodgers');
  });
  test('nothing credited is null', () => {
    expect(creditName([])).toBeNull();
    expect(creditName(undefined)).toBeNull();
  });
});

describe('ownTrackArtist', () => {
  test('a Various Artists compilation: each track is its own artist', () => {
    expect(ownTrackArtist({ 'artist-credit': credit(['Iggy Pop', 'iggy']) }, VA)).toBe('Iggy Pop');
  });

  test('falls back to the recording\'s credit when the track has none', () => {
    expect(ownTrackArtist({ recording: { 'artist-credit': credit(['Brian Eno', 'eno']) } }, VA)).toBe('Brian Eno');
  });

  test('a DJ mix or soundtrack credited to someone else: the track\'s own artist', () => {
    expect(ownTrackArtist({ 'artist-credit': credit(['Sleeper', 'sleeper']) }, credit(['Some DJ', 'dj']))).toBe('Sleeper');
  });

  test('a normal album keeps the album\'s artist (null), so its track ids don\'t change', () => {
    const album = credit(['Radiohead', 'rh']);
    expect(ownTrackArtist({ 'artist-credit': credit(['Radiohead', 'rh']) }, album)).toBeNull();
    // A featured guest: the album's artist is still on the track.
    expect(ownTrackArtist({ 'artist-credit': credit(['Radiohead', 'rh', ' feat. '], ['Guest', 'g']) }, album)).toBeNull();
  });

  test('a split album: a track by one of the album\'s artists keeps the album\'s artist', () => {
    expect(ownTrackArtist({ 'artist-credit': credit(['A', 'a']) }, credit(['A', 'a', ' & '], ['B', 'b']))).toBeNull();
  });

  test('without credits on either side it can\'t tell, so it changes nothing', () => {
    expect(ownTrackArtist({ title: 'x' }, VA)).toBeNull();
    expect(ownTrackArtist({ 'artist-credit': credit(['Iggy Pop', 'iggy']) }, undefined)).toBeNull();
    expect(ownTrackArtist({ 'artist-credit': credit(['Iggy Pop', 'iggy']) }, [])).toBeNull();
  });
});

describe('albumTrackArtist / hasTrackArtists', () => {
  test('a track\'s own artist wins, else the album\'s', () => {
    expect(albumTrackArtist({ trackArtist: 'Iggy Pop' }, 'Various Artists')).toBe('Iggy Pop');
    expect(albumTrackArtist({ title: 'x' }, 'Radiohead')).toBe('Radiohead');
    expect(albumTrackArtist(null, 'Radiohead')).toBe('Radiohead');
  });
  test('the tracklist shows an artist column only when some track has its own artist', () => {
    expect(hasTrackArtists([{ title: 'a' }, { title: 'b', trackArtist: 'Iggy Pop' }])).toBe(true);
    expect(hasTrackArtists([{ title: 'a' }])).toBe(false);
    expect(hasTrackArtists(null)).toBe(false);
  });
});

describe('playableAlbumTrack', () => {
  test('a compilation track is keyed and credited under its own artist', () => {
    const t = playableAlbumTrack({ title: 'Lust for Life', trackArtist: 'Iggy Pop', position: 1 }, { albumArtist: 'Various Artists', album: 'Trainspotting', albumArt: 'a.jpg' });
    expect(t).toMatchObject({ title: 'Lust for Life', artist: 'Iggy Pop', album: 'Trainspotting', albumArt: 'a.jpg', position: 1 });
    expect(t.id).toBe(trackSlug('Iggy Pop', 'Lust for Life', 'Trainspotting'));
  });
  test('a normal album\'s track keeps the id it always had', () => {
    const t = playableAlbumTrack({ title: 'Airbag' }, { albumArtist: 'Radiohead', album: 'OK Computer' });
    expect(t.artist).toBe('Radiohead');
    expect(t.id).toBe(trackSlug('Radiohead', 'Airbag', 'OK Computer'));
  });
  test('missing names fall back as the old copies did', () => {
    expect(playableAlbumTrack({}, {}).id).toBe(trackSlug('unknown', 'untitled', 'noalbum'));
  });
});

describe('isVariousArtists (the skeleton, before the tracks land)', () => {
  test('MusicBrainz\'s Various Artists, by id or name', () => {
    expect(isVariousArtists({ id: '89ad4ac3-39f7-470e-963a-56509c546377', name: 'Various Artists' })).toBe(true);
    expect(isVariousArtists({ name: 'Various Artists' })).toBe(true);
    expect(isVariousArtists('various')).toBe(true);
  });
  test('anyone else is not', () => {
    expect(isVariousArtists({ name: 'Radiohead' })).toBe(false);
    expect(isVariousArtists({ name: 'Various Cruelties' })).toBe(false);
    expect(isVariousArtists(null)).toBe(false);
  });
});

describe('ownCatalogTrackArtist (a service\'s catalog: names, no MusicBrainz ids)', () => {
  test('a compilation\'s track keeps its own artist', () => {
    expect(ownCatalogTrackArtist('Iggy Pop', 'Various Artists')).toBe('Iggy Pop');
    expect(ownCatalogTrackArtist('Daft Punk, Pharrell Williams', 'Various Artists')).toBe('Daft Punk, Pharrell Williams');
  });
  test('the album\'s own artist, a featured guest or a split album\'s half keeps the album\'s (null)', () => {
    expect(ownCatalogTrackArtist('Radiohead', 'Radiohead')).toBeNull();
    expect(ownCatalogTrackArtist('radiohead ', 'Radiohead')).toBeNull();
    expect(ownCatalogTrackArtist('Radiohead, Guest', 'Radiohead')).toBeNull();
    expect(ownCatalogTrackArtist('A', 'A & B')).toBeNull();
  });
  test('nothing to compare: null', () => {
    expect(ownCatalogTrackArtist(null, 'Various Artists')).toBeNull();
    expect(ownCatalogTrackArtist('Iggy Pop', null)).toBeNull();
  });
});
