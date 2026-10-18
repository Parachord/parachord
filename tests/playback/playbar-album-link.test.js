/**
 * The playbar's album-art click must open the album page from any playback
 * context. It used to require track.album, which is empty for tracks played
 * from search, chat, playlists and radio. These test the two pure helpers the
 * click now relies on, extracted from app.js.
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'app.js'), 'utf8');

function extract(startMarker, endMarker) {
  const s = app.indexOf(startMarker);
  expect(s).toBeGreaterThan(-1);
  const e = app.indexOf(endMarker, s);
  expect(e).toBeGreaterThan(s);
  return app.slice(s, e);
}

// normalizeStr is the module-scope helper the picker uses; take the real one.
const normalizeStrSrc = extract('const normalizeStr = ', '\n');
const helpersSrc = extract('window.pickAlbumNameForTrack = ', '// Coalesce bursts of per-key state writes');
const win = {};
new Function('window', 'normalizeStr', helpersSrc)(win, new Function(`${normalizeStrSrc}; return normalizeStr;`)());
const { pickAlbumNameForTrack, pickReleaseGroupForAlbum } = win;

describe('pickAlbumNameForTrack', () => {
  test('uses the track\'s own album first', () => {
    expect(pickAlbumNameForTrack({ album: ' OK Computer ', sources: { spotify: { album: 'Other' } } })).toBe('OK Computer');
  });
  test('falls back to a resolved source\'s album, skipping Apple\'s "Single" filler and noMatch slots', () => {
    expect(pickAlbumNameForTrack({ album: '', sources: { applemusic: { album: 'Single' }, spotify: { album: 'In Rainbows' } } })).toBe('In Rainbows');
    expect(pickAlbumNameForTrack({ sources: { bandcamp: { album: 'Wrong', noMatch: true }, youtube: {} } })).toBe('');
  });
  test('falls back to the mapper\'s canonical release name, else empty', () => {
    expect(pickAlbumNameForTrack({ artist: 'Lustmord', title: 'Black Star', sources: {} }, { release_name: 'The Place Where the Black Stars Hang' })).toBe('The Place Where the Black Stars Hang');
    expect(pickAlbumNameForTrack({ sources: {} }, null)).toBe('');
    expect(pickAlbumNameForTrack(null)).toBe('');
  });
});

describe('pickReleaseGroupForAlbum', () => {
  const rg = (title, artist, type) => ({ id: `${artist}-${title}`, title, 'primary-type': type, 'artist-credit': [{ name: artist }] });
  test('prefers an Album by the right artist over an earlier same-title album by someone else', () => {
    const results = [rg('Black Star', 'Someone Else', 'Album'), rg('Black Star', 'Lustmord', 'Single'), rg('Black Star', 'Lustmord', 'Album')];
    expect(pickReleaseGroupForAlbum(results, 'Lustmord').id).toBe('Lustmord-Black Star');
    expect(pickReleaseGroupForAlbum(results, 'Lustmord')['primary-type']).toBe('Album');
  });
  test('takes the right artist\'s single when they have no album, then any Album, then the first result', () => {
    expect(pickReleaseGroupForAlbum([rg('X', 'A', 'Album'), rg('X', 'B', 'Single')], 'B').id).toBe('B-X');
    expect(pickReleaseGroupForAlbum([rg('X', 'A', 'Single'), rg('X', 'C', 'Album')], 'B').id).toBe('C-X');
    expect(pickReleaseGroupForAlbum([rg('X', 'A', 'Single')], 'B').id).toBe('A-X');
  });
  test('artist matching is normalized containment ("The Beatles" vs "Beatles")', () => {
    expect(pickReleaseGroupForAlbum([rg('Help!', 'Beatles', 'Album')], 'The Beatles').id).toBe('Beatles-Help!');
  });
  test('empty input gives null', () => {
    expect(pickReleaseGroupForAlbum([], 'A')).toBeNull();
    expect(pickReleaseGroupForAlbum(undefined, 'A')).toBeNull();
  });
});

describe('the playbar uses the always-works path', () => {
  test('album-art click calls openAlbumForTrack and no longer gates on currentTrack.album', () => {
    const i = app.indexOf('openAlbumForTrack(currentTrack);');
    expect(i).toBeGreaterThan(-1);
    const around = app.slice(i - 600, i);
    expect(around).not.toMatch(/if \(currentTrack\.album && currentTrack\.artist\)/);
  });
});
