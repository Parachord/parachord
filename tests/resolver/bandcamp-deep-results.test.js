/**
 * Bandcamp resolve reads every row the search API returns, not the search
 * page's 20 (#1532). For "Radiohead Nude" the API's 50 rows start with 31
 * remixes and covers by other uploaders; Radiohead's own In Rainbows track is
 * row 31 (2026-11-18, the live check of #1532). search kept 20 rows, so
 * resolve only saw rows the confidence gate rejects, and a local "Nude" never
 * got a Bandcamp source while "15 Step" (row 3) did.
 */

const bandcamp = require('../../plugins-src/bandcamp/implementation');

const row = (i, name, band, album) => ({
  type: 't', id: i, name, band_name: band, album_name: album,
  item_url_path: `https://x${i}.bandcamp.com/track/t${i}`,
});

// The shape of the API's answer for "Radiohead Nude": 31 other versions,
// then the original, then more.
const apiRows = [
  ...Array.from({ length: 31 }, (_, i) => row(i, `Radiohead - Nude (Remix ${i})`, `Remixer ${i}`, null)),
  row(31, 'Nude', 'Radiohead', 'In Rainbows'),
  ...Array.from({ length: 18 }, (_, i) => row(32 + i, `Nude (Radiohead Cover ${i})`, `Cover ${i}`, 'Covers')),
];

let realFetch;
beforeEach(() => {
  realFetch = global.fetch;
  global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ auto: { results: apiRows } }) }));
});
afterEach(() => { global.fetch = realFetch; });

describe('Bandcamp search depth', () => {
  test('search keeps a page of 20 by default', async () => {
    const results = await bandcamp.search('Radiohead Nude', {});
    expect(results).toHaveLength(20);
    expect(results.some(r => r.artist === 'Radiohead')).toBe(false);
  });

  test('search keeps up to the limit it is given', async () => {
    expect(await bandcamp.search('Radiohead Nude', {}, 50)).toHaveLength(50);
  });

  test("resolve finds the artist's own recording below 20 other versions", async () => {
    const found = await bandcamp.resolve.call(bandcamp, 'Radiohead', 'Nude', 'In Rainbows', {});
    expect(found).toMatchObject({ title: 'Nude', artist: 'Radiohead', album: 'In Rainbows' });
  });
});
