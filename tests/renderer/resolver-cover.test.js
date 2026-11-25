/**
 * A cover looked up through the services is only ever the album's own (#1665).
 * getAlbumArtFromResolvers took the artist's other album, then anyone's result
 * that had art: on a real profile 65 images were saved for clearly different
 * artists, one of them for 32 albums.
 */
const fs = require('fs');
const path = require('path');
const { isCoverOf, pickResolverCover, coverQuery, dropUnmatchedCovers } = require('../../src/renderer/lib/resolver-cover');

const r = (artist, album, title = 'Track', extra = {}) => ({ artist, album, title, albumArt: `${artist}/${album || title}.jpg`, source: 'spotify', ...extra });
const ask = (artist, album) => ({ artist, album });

describe('isCoverOf', () => {
  test('the album by its artist', () => {
    expect(isCoverOf(r('Portishead', 'Dummy'), ask('Portishead', 'Dummy'))).toBe(true);
    expect(isCoverOf(r('portishead', 'DUMMY'), ask('Portishead', 'Dummy'))).toBe(true);
  });
  test('never another artist\'s, nor the artist\'s other album (the incident: "212")', () => {
    expect(isCoverOf(r('Azealia Banks', '212'), ask('Tundra 212', 'Alive'))).toBe(false);
    expect(isCoverOf(r('Portishead', 'Third'), ask('Portishead', 'Dummy'))).toBe(false);
    expect(isCoverOf(r('Someone Else', 'Dummy'), ask('Portishead', 'Dummy'))).toBe(false);
  });
  test('an edition of it, however the store writes it', () => {
    expect(isCoverOf(r('Portishead', 'Dummy (Deluxe Edition)'), ask('Portishead', 'Dummy'))).toBe(true);
    expect(isCoverOf(r('Robyn', 'Honey - Single'), ask('Robyn', 'Honey'))).toBe(true);
    expect(isCoverOf(r('Robyn', 'Honey (feat. X)'), ask('Robyn', 'Honey'))).toBe(true);
    expect(isCoverOf(r('Ed Sheeran', '÷ (Deluxe)'), ask('Ed Sheeran', '÷'))).toBe(true);
  });
  test('a volume, a sequel or a live album is a different cover', () => {
    expect(isCoverOf(r('Queen', 'Greatest Hits II'), ask('Queen', 'Greatest Hits'))).toBe(false);
    expect(isCoverOf(r('Queen', 'Live Killers'), ask('Queen', 'Live'))).toBe(false);
    expect(isCoverOf(r('Fleetwood Mac', 'Rumours (Live)'), ask('Fleetwood Mac', 'Rumours'))).toBe(false);
  });
  test('a joint credit, however it is joined', () => {
    expect(isCoverOf(r('Jay-Z, Kanye West', 'Watch the Throne'), ask('Jay-Z & Kanye West', 'Watch the Throne'))).toBe(true);
  });
  test('a single matches on its title only when the result names no album', () => {
    expect(isCoverOf(r('Robyn', '', 'Honey', { source: 'bandcamp' }), ask('Robyn', 'Honey'))).toBe(true);
    expect(isCoverOf(r('Robyn', 'Single', 'Honey', { source: 'applemusic' }), ask('Robyn', 'Honey'))).toBe(true);
    // The title track on another album is that album's cover.
    expect(isCoverOf(r('Michael Jackson', 'Greatest Hits', 'Thriller'), ask('Michael Jackson', 'Thriller'))).toBe(false);
  });
  test('a placeholder album is no album to match', () => {
    expect(isCoverOf(r('A', 'SoundCloud', 'X', { source: 'soundcloud' }), ask('A', 'SoundCloud'))).toBe(false);
    expect(isCoverOf(r('A', 'Single', 'X'), ask('A', 'Single'))).toBe(false);
  });
  test('no art, or nothing to compare', () => {
    expect(isCoverOf({ artist: 'A', album: 'B', albumArt: null }, ask('A', 'B'))).toBe(false);
    expect(isCoverOf(r('A', 'B'), ask('', 'B'))).toBe(false);
    expect(isCoverOf(r('A', 'B'), ask('A', ''))).toBe(false);
    expect(isCoverOf(null, ask('A', 'B'))).toBe(false);
  });
  test('non-Latin names match, and one never stands for another', () => {
    expect(isCoverOf(r('Кино', 'Группа крови'), ask('Кино', 'Группа крови'))).toBe(true);
    expect(isCoverOf(r('Кино', 'Звезда по имени Солнце'), ask('Кино', 'Группа крови'))).toBe(false);
  });
});

describe('pickResolverCover', () => {
  test('the right cover behind another result is found', () => {
    expect(pickResolverCover([r('Azealia Banks', '212'), r('Portishead', 'Third'), r('Portishead', 'Dummy')], ask('Portishead', 'Dummy'))).toBe('Portishead/Dummy.jpg');
  });
  test('the album itself before an edition of it', () => {
    expect(pickResolverCover([r('Portishead', 'Dummy (Deluxe Edition)'), r('Portishead', 'Dummy')], ask('Portishead', 'Dummy'))).toBe('Portishead/Dummy.jpg');
    expect(pickResolverCover([r('Portishead', 'Dummy (Deluxe Edition)')], ask('Portishead', 'Dummy'))).toBe('Portishead/Dummy (Deluxe Edition).jpg');
  });
  test('nothing of its own: no cover', () => {
    expect(pickResolverCover([r('Azealia Banks', '212')], ask('Tundra 212', 'Alive'))).toBeNull();
    expect(pickResolverCover([], ask('A', 'B'))).toBeNull();
    expect(pickResolverCover(undefined, ask('A', 'B'))).toBeNull();
  });
});

describe('a compilation: its tracks carry their own artists', () => {
  const on = (artist, album, art) => r(artist, album, 'T', { albumArt: art });
  test('two different artists on that album with the same image', () => {
    const results = [on('Azealia Banks', '212', '212.jpg'), on('Iggy Pop', 'Trainspotting', 't.jpg'), on('Pulp', 'Trainspotting', 't.jpg')];
    expect(pickResolverCover(results, ask('Various Artists', 'Trainspotting'))).toBe('t.jpg');
  });
  test('one artist\'s album of that title is not the compilation, nor two artists\' own', () => {
    expect(pickResolverCover([on('Queen', 'Greatest Hits', 'q.jpg'), on('Queen', 'Greatest Hits', 'q.jpg')], ask('Various Artists', 'Greatest Hits'))).toBeNull();
    expect(pickResolverCover([on('Queen', 'Greatest Hits', 'q.jpg'), on('ABBA', 'Greatest Hits', 'a.jpg')], ask('Various Artists', 'Greatest Hits'))).toBeNull();
  });
  test('a result credited to Various Artists is enough', () => {
    expect(pickResolverCover([on('Various Artists', 'Trainspotting', 't.jpg')], ask('Various Artists', 'Trainspotting'))).toBe('t.jpg');
  });
  test('it is searched by its title: no track is credited to Various Artists', () => {
    expect(coverQuery({ artist: 'Various Artists', album: 'Trainspotting' })).toBe('Trainspotting');
    expect(coverQuery({ artist: 'Portishead', album: 'Dummy' })).toBe('Portishead Dummy');
  });
  test('only for a compilation: another artist never gets it', () => {
    expect(pickResolverCover([on('Iggy Pop', 'Trainspotting', 't.jpg'), on('Pulp', 'Trainspotting', 't.jpg')], ask('Primal Scream', 'Trainspotting'))).toBeNull();
  });
});

describe('dropUnmatchedCovers: saved covers from before the check', () => {
  const e = (url) => ({ url, timestamp: 1 });
  test('every resolver: entry goes, with the same image saved under a release id', () => {
    const { kept, dropped } = dropUnmatchedCovers({
      'resolver:a-x': e('wrong.jpg'), 'rg-1': e('wrong.jpg'), 'rg-2': e('caa.jpg'),
      'catalog:a-y': e('itunes.jpg'), 'service:a-z': e('right.jpg'),
    });
    expect(Object.keys(kept).sort()).toEqual(['catalog:a-y', 'rg-2', 'service:a-z']);
    expect(dropped).toEqual(new Set(['wrong.jpg']));
  });
  test('nothing old: nothing dropped', () => {
    const cache = { 'rg-2': e('caa.jpg'), 'service:a-z': e('right.jpg') };
    expect(dropUnmatchedCovers(cache)).toEqual({ kept: cache, dropped: new Set() });
    expect(dropUnmatchedCovers(null)).toEqual({ kept: {}, dropped: new Set() });
  });
});

describe('app.js', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const between = (a, b) => { const s = app.indexOf(a); expect(s).toBeGreaterThan(-1); return app.slice(s, app.indexOf(b, s)); };
  test('the lookup walks on until a service has this album\'s cover, else goes to iTunes and Deezer', () => {
    const body = between('const getAlbumArtFromResolvers = async (artist, album) => {', 'const getTrackArt = async');
    expect(body).toContain('accept: (found) => !!pickResolverCover(found, { artist, album })');
    expect(body).toContain('const url = pickResolverCover(results, { artist, album });');
    expect(body).toContain('searchResolvers(coverQuery({ artist, album }), {');
    expect(body).toContain("remember(url, 'service')");
    expect(body).not.toMatch(/find\(r => r\.albumArt\)/);
    expect(body.indexOf('pickResolverCover(')).toBeLessThan(body.indexOf('getCatalogAlbumArtwork('));
  });
  test('an accepted result is what ends an early-return walk', () => {
    const body = between('const searchResolvers = async (query, options = {}) => {', 'const createPlaylistFromChat');
    expect(body).toContain('} else if (accept ? accept(taggedTracks) : (!requireAlbumArt || taggedTracks.some(t => t.albumArt))) {');
  });
  test('the saved cache is cleaned on load, and the old key is never read or written', () => {
    expect(app).toContain('dropUnmatchedCovers(Object.fromEntries(validEntries))');
    expect(app).not.toContain('`resolver:${');
    expect(app).toContain('albumArtCache.current[`service:${lookupKey}`]?.url');
  });
  test('a chart track with no album asks for the track\'s own cover, not only an album named like it', () => {
    expect(app).toContain("|| (track.album ? null : await getTrackArt(track.artist, track.title))");
  });
});
