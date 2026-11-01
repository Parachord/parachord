/**
 * Bandcamp cover art from search. The search API's img field names the image
 * without the "a" prefix album art lives under: img/2732951243_3.jpg 404s at
 * every size, img/a2732951243_10.jpg is the cover (checked 2026-11-01). Search
 * rows showed the dead URL, and once a slot kept its first cover, Bandcamp's
 * broken one (it answers first) stuck.
 */

const bandcamp = require('../../plugins-src/bandcamp/implementation');

const elastic = (results) => ({
  ok: true,
  json: async () => ({ auto: { results } }),
});

afterEach(() => { delete global.fetch; });

test('search builds the cover from art_id with the album-art prefix', async () => {
  global.fetch = jest.fn(async () => elastic([{
    type: 't', id: 1, name: 'The Breeders - Cannonball', band_name: 'Concha',
    item_url_path: 'https://concha.bandcamp.com/track/cannonball',
    img: 'https://f4.bcbits.com/img/2732951243_3.jpg', art_id: 2732951243,
  }]));
  const [track] = await bandcamp.search('the breeders cannonball', {});
  expect(track.albumArt).toBe('https://f4.bcbits.com/img/a2732951243_10.jpg');
});

test('searchAlbums builds the cover the same way', async () => {
  global.fetch = jest.fn(async () => elastic([{
    type: 'a', id: 2, name: 'Last Splash', band_name: 'The Breeders',
    item_url_path: 'https://thebreeders.bandcamp.com/album/last-splash',
    img: 'https://f4.bcbits.com/img/1669816621_3.jpg', art_id: 1669816621,
  }]));
  const albums = await bandcamp.searchAlbums('last splash', {});
  expect(albums[0].albumArt).toBe('https://f4.bcbits.com/img/a1669816621_10.jpg');
});

test('without an art_id it falls back to the img field', async () => {
  global.fetch = jest.fn(async () => elastic([{
    type: 't', id: 3, name: 'X', band_name: 'Y',
    item_url_path: 'https://y.bandcamp.com/track/x',
    img: 'https://f4.bcbits.com/img/a42_3.jpg',
  }]));
  const [track] = await bandcamp.search('x', {});
  expect(track.albumArt).toBe('https://f4.bcbits.com/img/a42_10.jpg');
});
