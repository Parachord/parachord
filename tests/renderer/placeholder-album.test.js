// A track with no album must not carry a stand-in as if it were real: "Single",
// or the name of the service it came from. And a track saved with a stand-in
// has to keep matching when the album changes, because its id includes the album.
const fs = require('fs');
const path = require('path');
const {
  generateTrackId, isPlaceholderAlbum, findSavedTrack, clearPlaceholderAlbums
} = require('../../src/renderer/lib/collection-ids');

const read = (rel) => fs.readFileSync(path.join(__dirname, '../..', rel), 'utf8');

describe('isPlaceholderAlbum', () => {
  test.each([[''], ['   '], [null], [undefined], ['Single'], ['single'], [' SINGLE ']])('%p is no album', (album) => {
    expect(isPlaceholderAlbum(album)).toBe(true);
  });

  test('a real album is an album', () => {
    expect(isPlaceholderAlbum('OK Computer')).toBe(false);
    expect(isPlaceholderAlbum('Singles')).toBe(false);
  });

  test('the name of the track\'s own source is no album', () => {
    expect(isPlaceholderAlbum('SoundCloud', { soundcloud: {} })).toBe(true);
    expect(isPlaceholderAlbum('YouTube', ['youtube'])).toBe(true);
    expect(isPlaceholderAlbum('Apple Music', { applemusic: {} })).toBe(true);
  });

  test('a service name is an album when the track has no such source', () => {
    expect(isPlaceholderAlbum('SoundCloud', { spotify: {} })).toBe(false);
    expect(isPlaceholderAlbum('SoundCloud')).toBe(false);
  });

  test('a non-Latin album is an album, though id normalization would strip it to nothing', () => {
    expect(isPlaceholderAlbum('東京事変', { soundcloud: {} })).toBe(false);
    expect(isPlaceholderAlbum('Яйца', { spotify: {} })).toBe(false);
  });
});

describe('findSavedTrack', () => {
  const saved = (artist, title, album, extra = {}) => ({ id: generateTrackId(artist, title, album), artist, title, album, ...extra });

  test('matches by the track\'s own id', () => {
    const row = saved('A', 'B', 'C');
    expect(findSavedTrack([row], { id: row.id, artist: 'Other', title: 'Other', album: 'Other' })).toBe(row);
  });

  test('matches by the id generated from its fields', () => {
    const row = saved('A', 'B', 'C');
    expect(findSavedTrack([row], { artist: 'A', title: 'B', album: 'C' })).toBe(row);
  });

  test('the issue\'s scenario: saved as SoundCloud, then opened with no album', () => {
    const row = saved('A', 'B', 'SoundCloud', { sources: { soundcloud: {} } });
    expect(findSavedTrack([row], { id: 'a-b-single', artist: 'A', title: 'B', album: '' })).toBe(row);
  });

  test('saved as Single, then opened with no album', () => {
    const row = saved('A', 'B', 'Single');
    expect(findSavedTrack([row], { artist: 'A', title: 'B', album: '' })).toBe(row);
  });

  test('a row whose placeholder was cleared keeps matching', () => {
    const row = { ...saved('A', 'B', 'Single'), album: '' };
    expect(findSavedTrack([row], { artist: 'A', title: 'B', album: '' })).toBe(row);
    expect(findSavedTrack([row], { artist: 'A', title: 'B', album: 'A Real Album' })).toBe(row);
  });

  test('artist and title match regardless of case and spacing', () => {
    const row = saved('The Band', 'A Song', 'Single');
    expect(findSavedTrack([row], { artist: ' the band ', title: 'a song', album: '' })).toBe(row);
  });

  test('two real albums stay two tracks', () => {
    const row = saved('A', 'B', 'First Album');
    expect(findSavedTrack([row], { artist: 'A', title: 'B', album: 'Second Album' })).toBeNull();
  });

  test('a real saved album is not matched by a track with no album', () => {
    const row = saved('A', 'B', 'First Album');
    expect(findSavedTrack([row], { artist: 'A', title: 'B', album: '' })).toBeNull();
  });

  test('different non-Latin songs are different songs', () => {
    const row = saved('Хлеб', 'Яйца', 'Single');
    expect(findSavedTrack([row], { id: 'x', artist: 'Хлеб', title: 'Молоко', album: '' })).toBeNull();
    expect(findSavedTrack([row], { id: 'x', artist: 'Хлеб', title: 'Яйца', album: '' })).toBe(row);
  });

  test('nothing to look for finds nothing', () => {
    expect(findSavedTrack([saved('A', 'B', 'Single')], null)).toBeNull();
    expect(findSavedTrack(null, { artist: 'A', title: 'B' })).toBeNull();
    expect(findSavedTrack([{ id: 'x', album: '' }], { id: 'y', album: '' })).toBeNull();
  });

  test('an exact match wins over an earlier placeholder row', () => {
    const placeholder = saved('A', 'B', 'Single');
    const exact = saved('A', 'B', 'Real');
    expect(findSavedTrack([placeholder, exact], { artist: 'A', title: 'B', album: 'Real' })).toBe(exact);
  });
});

describe('clearPlaceholderAlbums', () => {
  test('clears the album and keeps the id, so the row still matches what it did', () => {
    const row = { id: 'a-b-soundcloud', artist: 'A', title: 'B', album: 'SoundCloud', sources: { soundcloud: {} } };
    const { tracks, changed } = clearPlaceholderAlbums([row]);
    expect(changed).toBe(1);
    expect(tracks[0]).toEqual({ ...row, album: '' });
    expect(tracks[0].id).toBe('a-b-soundcloud');
  });

  test('leaves real albums, and the same object when nothing changed', () => {
    const row = { id: 'x', album: 'OK Computer', sources: { spotify: {} } };
    const input = [row];
    const result = clearPlaceholderAlbums(input);
    expect(result.changed).toBe(0);
    expect(result.tracks[0]).toBe(row);
  });

  test('a row already empty is not a change', () => {
    expect(clearPlaceholderAlbums([{ id: 'x', album: '' }, { id: 'y' }]).changed).toBe(0);
  });

  test('an album a provider synced is that provider\'s real name, even "Single"', () => {
    const row = { id: 'x', album: 'Single', sources: { spotify: {} }, syncSources: { spotify: { addedAt: 1 } } };
    expect(clearPlaceholderAlbums([row]).changed).toBe(0);
  });

  test('a manually saved row with a Single album is cleared', () => {
    const row = { id: 'x', album: 'Single', syncSources: { manual: { addedAt: 1 } } };
    expect(clearPlaceholderAlbums([row]).changed).toBe(1);
  });

  test('copes with no tracks', () => {
    expect(clearPlaceholderAlbums(undefined)).toEqual({ tracks: [], changed: 0 });
  });
});

describe('the app uses them', () => {
  const app = read('src/renderer/app.js');

  test('nothing in app.js fills in Single as an album', () => {
    expect(app).not.toMatch(/album:\s*[^,\n]*\|\|\s*'Single'/);
  });

  test('every is-it-saved check goes through findSavedTrack', () => {
    expect(app).not.toMatch(/collectionData\.tracks\.some\(t => t\.id === trackId/);
    expect(app).not.toMatch(/prev\.tracks\.some\(t => t\.id === trackId\)/);
    expect(app).not.toMatch(/newTracks\.some\(t => t\.id === trackId\)/);
    expect(app.match(/findSavedTrack\(/g).length).toBeGreaterThanOrEqual(5);
  });

  test('a collection load clears placeholders and saves the result', () => {
    expect(app).toContain('clearPlaceholderAlbums(');
    expect(app).toMatch(/const needsSave = [^;]*clearedAlbumCount > 0/);
  });

  test('the album art tooltip does not offer a placeholder', () => {
    expect(app).not.toContain('content: currentTrack.album ? `View "${currentTrack.album}"');
  });

  test.each([['applemusic'], ['bandcamp']])('the %s plugin sends no placeholder either', (id) => {
    expect(read(`plugins-src/${id}/implementation.js`)).not.toMatch(/\|\|\s*'Single'/);
  });
});
