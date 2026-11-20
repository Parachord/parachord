/**
 * The playlist mosaic's covers (lib/playlist-cover-picks.js), run for real
 * with stub lookups. #1578: a track with its own cover but no album name
 * uses that cover instead of falling through to the artist's image.
 */
const { pickPlaylistCovers } = require('../../src/renderer/lib/playlist-cover-picks');

const lookups = (albumArt = {}, artistImages = {}) => {
  const calls = { album: [], artist: [] };
  return {
    calls,
    getAlbumArt: async (artist, album) => { calls.album.push(`${artist}|${album}`); return albumArt[`${artist}|${album}`] || null; },
    getArtistImage: async (artist) => { calls.artist.push(artist); return artistImages[artist] ? { url: artistImages[artist] } : null; },
  };
};

describe('pickPlaylistCovers', () => {
  test('a track with its own cover and no album name uses that cover, with no artist lookup (#1578)', async () => {
    const l = lookups({}, { Hovvdy: 'https://img/artist-hovvdy.jpg' });
    const covers = await pickPlaylistCovers([{ artist: 'Hovvdy', title: 'Bubble', albumArt: 'https://img/bubble.jpg' }], l);
    expect(covers).toEqual(['https://img/bubble.jpg']);
    expect(l.calls.artist).toEqual([]);
    expect(l.calls.album).toEqual([]);
  });

  test('a track with its own cover and no artist either still gives its cover', async () => {
    const l = lookups();
    expect(await pickPlaylistCovers([{ title: 'Untitled', albumArt: 'https://img/u.jpg' }], l)).toEqual(['https://img/u.jpg']);
  });

  test('a track with no album name and a cover already in the grid falls back to its artist', async () => {
    const l = lookups({}, { B: 'https://img/artist-b.jpg' });
    const covers = await pickPlaylistCovers([
      { artist: 'A', albumArt: 'https://img/same.jpg' },
      { artist: 'B', albumArt: 'https://img/same.jpg' },
    ], l);
    expect(covers).toEqual(['https://img/same.jpg', 'https://img/artist-b.jpg']);
  });

  test('unchanged: one tile per album, its own art first, else the album lookup', async () => {
    const l = lookups({ 'C|Lp': 'https://img/c-lp.jpg' });
    const covers = await pickPlaylistCovers([
      { artist: 'A', album: 'One', albumArt: 'https://img/a-one.jpg' },
      { artist: 'A', album: 'One', albumArt: 'https://img/a-one-big.jpg' }, // same album: skipped
      { artist: 'C', album: 'Lp' },
    ], l);
    expect(covers).toEqual(['https://img/a-one.jpg', 'https://img/c-lp.jpg']);
    expect(l.calls.album).toEqual(['C|Lp']);
  });

  test('unchanged: never one URL four times, at most four covers, artist images fill the rest', async () => {
    const stamped = 'https://img/playlist-cover.jpg';
    const l = lookups({}, { A: 'https://img/a.jpg', B: 'https://img/b.jpg', C: 'https://img/c.jpg', D: 'https://img/d.jpg', E: 'https://img/e.jpg' });
    const covers = await pickPlaylistCovers(['A', 'B', 'C', 'D', 'E'].map((artist, i) => ({ artist, album: `Album ${i}`, albumArt: stamped })), l);
    expect(covers).toEqual([stamped, 'https://img/b.jpg', 'https://img/c.jpg', 'https://img/d.jpg']);
    expect(new Set(covers).size).toBe(4);
  });

  test('no tracks, no covers', async () => {
    expect(await pickPlaylistCovers([], lookups())).toEqual([]);
    expect(await pickPlaylistCovers(undefined, lookups())).toEqual([]);
  });
});
