/**
 * Bandcamp resolve reads every row the search API returns, not the search
 * page's 20 (#1532). For "Radiohead Nude" the API's 50 rows start with 31
 * remixes and covers by other uploaders; Radiohead's own In Rainbows track is
 * row 31 (2026-11-18, the live check of #1532). search kept 20 rows, so
 * resolve only saw rows the confidence gate rejects, and a local "Nude" never
 * got a Bandcamp source while "15 Step" (row 3) did.
 *
 * Reading deeper found Radiohead's own "Nude", which is buy-only: the artist
 * turned streaming off, so it can't be a source to play (2026-11-18). resolve
 * checks its pick with isStreamable, and a buy-only pick comes back
 * purchase-only (streamable false: Buy, no playing) and ends the search, so a
 * fan's upload credited to Radiohead on another page (there is one: a
 * "stripped mix") is never taken.
 */

const bandcamp = require('../../plugins-src/bandcamp/implementation');

const row = (i, name, band, album, page = `https://x${i}.bandcamp.com/track/t${i}`) => ({
  type: 't', id: i, band_id: 1000 + i, name, band_name: band, album_name: album,
  item_url_path: page,
});

// The shape of the API's answer for "Radiohead Nude": 31 other versions,
// then the original, then more.
const apiRows = [
  ...Array.from({ length: 31 }, (_, i) => row(i, `Radiohead - Nude (Remix ${i})`, `Remixer ${i}`, null)),
  row(31, 'Nude', 'Radiohead', 'In Rainbows', 'https://radiohead.bandcamp.com/track/nude'),
  ...Array.from({ length: 17 }, (_, i) => row(32 + i, `Nude (Radiohead Cover ${i})`, `Cover ${i}`, 'Covers')),
  row(49, 'nude', 'radiohead', 'big ideas', 'https://meanderpede.bandcamp.com/track/nude'),
];

// Which tracks stream, for Bandcamp's mobile API: every one but those listed.
let buyOnly;
let realFetch;
beforeEach(() => {
  buyOnly = new Set();
  realFetch = global.fetch;
  global.fetch = jest.fn(async (url) => {
    if (url.includes('/api/mobile/24/tralbum_details')) {
      const id = Number(new URL(url).searchParams.get('tralbum_id'));
      const tracks = buyOnly.has(id) ? [] : [{ track_id: id, streaming_url: { 'mp3-128': 'https://t4.bcbits.com/x' } }];
      return { ok: true, json: async () => ({ id, tracks }) };
    }
    return { ok: true, json: async () => ({ auto: { results: apiRows } }) };
  });
});
afterEach(() => { global.fetch = realFetch; });

const resolveNude = () => bandcamp.resolve.call(Object.create(bandcamp), 'Radiohead', 'Nude', 'In Rainbows', {});

describe('Bandcamp search depth', () => {
  test('search keeps a page of 20 by default', async () => {
    const results = await bandcamp.search.call(Object.create(bandcamp), 'Radiohead Nude', {});
    expect(results).toHaveLength(20);
    expect(results.some(r => r.artist === 'Radiohead')).toBe(false);
  });

  test('search keeps up to the limit it is given', async () => {
    expect(await bandcamp.search.call(Object.create(bandcamp), 'Radiohead Nude', {}, 50)).toHaveLength(50);
  });

  test("resolve finds the artist's own recording below 20 other versions", async () => {
    const found = await resolveNude();
    expect(found).toMatchObject({ title: 'Nude', artist: 'Radiohead', album: 'In Rainbows' });
    expect(found.bandcampUrl).toBe('https://radiohead.bandcamp.com/track/nude');
  });

  test("Radiohead's own buy-only Nude is purchase-only, and a fan's copy is never taken", async () => {
    buyOnly.add(31);
    // Buy, not play: the pick comes back marked streamable false.
    expect(await resolveNude()).toMatchObject({
      bandcampUrl: 'https://radiohead.bandcamp.com/track/nude',
      purchaseUrl: 'https://radiohead.bandcamp.com/track/nude',
      streamable: false,
    });
    // One check: the pick, on the artist's own page.
    const checks = global.fetch.mock.calls.filter(([u]) => u.includes('/api/mobile/'));
    expect(checks.map(([u]) => new URL(u).searchParams.get('tralbum_id'))).toEqual(['31']);
  });

  test('a remix by another uploader never stands in for it', async () => {
    // With the original buy-only on a label's page, the track gets only a
    // purchase-only source: a buy-only pick ends the search, so no other copy is checked,
    // and the remixes at the top ("Radiohead - Nude (Lobec Remix)" by Lobec,
    // live) are other versions by someone else and never candidates.
    const labelRows = apiRows.map((r) => (r.id === 31 ? { ...r, item_url_path: 'https://xlrecordings.bandcamp.com/track/nude' } : r));
    global.fetch.mockImplementation(async (url) => {
      if (url.includes('/api/mobile/24/tralbum_details')) {
        const id = Number(new URL(url).searchParams.get('tralbum_id'));
        return { ok: true, json: async () => ({ id, tracks: [] }) };
      }
      return { ok: true, json: async () => ({ auto: { results: labelRows } }) };
    });
    expect(await resolveNude()).toMatchObject({ bandcampUrl: 'https://xlrecordings.bandcamp.com/track/nude', streamable: false });
    const checks = global.fetch.mock.calls.filter(([u]) => u.includes('/api/mobile/'));
    expect(checks.map(([u]) => new URL(u).searchParams.get('tralbum_id'))).toEqual(['31']);
  });
});
