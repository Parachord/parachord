// Which release of an album to show (#1288). A release group can hold many
// releases, and the album page used to take whichever MusicBrainz listed first.
// For George Michael's "The Faith Tour" that was a 9-track CD, while the
// digital release, the one streaming services carry, has all 18.

const { pickRelease, releaseTrackCount } = require('../../src/renderer/lib/release-pick');
const { createReleaseLookup } = require('../../src/renderer/lib/release-lookup');

const rel = (id, formats, date) => ({
  id,
  date,
  media: formats.map(([format, count]) => ({ format, 'track-count': count })),
});

describe('pickRelease', () => {
  test('The Faith Tour: the 18-track digital release, not a 9-track CD listed first', () => {
    const picked = pickRelease([
      rel('cd-a', [['CD', 9]], '2026-11-06'),
      rel('digital', [['Digital Media', 18]], '2026-11-06'),
      rel('cd-b', [['CD', 9]], '2026-11-06'),
    ]);
    expect(picked.id).toBe('digital');
  });

  test('Abbey Road: the standard 17 tracks, not a 40-track super deluxe', () => {
    const picked = pickRelease([
      rel('vinyl', [['12" Vinyl', 17]], '1969-09-26'),
      rel('deluxe', [['Digital Media', 17], ['Digital Media', 17], ['Digital Media', 6]], '2019-09-27'),
      rel('digital-2009', [['Digital Media', 17]], '2009-09-09'),
      rel('digital-2015', [['Digital Media', 17]], '2015-12-24'),
      rel('cd', [['CD', 17]], '1987-08-24'),
    ]);
    expect(picked.id).toBe('digital-2009');
  });

  test('no digital release: the most common track count, earliest first', () => {
    const picked = pickRelease([
      rel('expanded', [['CD', 24]], '2005-01-01'),
      rel('cd-late', [['CD', 12]], '1999-01-01'),
      rel('vinyl', [['12" Vinyl', 12]], '1990-01-01'),
    ]);
    expect(picked.id).toBe('vinyl');
  });

  test('a tie between counts goes to the count with the earliest release', () => {
    const picked = pickRelease([
      rel('deluxe', [['Digital Media', 14]], '2012-05-01'),
      rel('standard', [['Digital Media', 12]], '2010-05-01'),
    ]);
    expect(picked.id).toBe('standard');
  });

  test('a release with no date loses a tie to one with a date', () => {
    expect(pickRelease([
      rel('undated', [['CD', 10]], undefined),
      rel('dated', [['CD', 10]], '2001'),
    ]).id).toBe('dated');
  });

  test('a mixed CD + digital release is not digital-only', () => {
    expect(pickRelease([
      rel('mixed', [['CD', 10], ['Digital Media', 10]], '2000'),
      rel('cd', [['CD', 10]], '2001'),
    ]).id).toBe('mixed');
  });

  test('a single release, or none', () => {
    const only = rel('only', [['CD', 9]], '2020');
    expect(pickRelease([only])).toBe(only);
    expect(pickRelease([])).toBeNull();
    expect(pickRelease(undefined)).toBeNull();
    expect(pickRelease([null, undefined])).toBeNull();
  });

  // #1312: MusicBrainz lists one digital release per storefront, same day,
  // and the first one listed put Bahrain on Bon Iver's "For Emma, Forever Ago".
  const at = (r, country) => ({ ...r, country });

  test('among same-day digital releases, Worldwide beats the first one listed', () => {
    const picked = pickRelease([
      at(rel('bh', [['Digital Media', 9]], '2008-02-19'), 'BH'),
      at(rel('ad', [['Digital Media', 9]], '2008-02-19'), 'AD'),
      at(rel('xw', [['Digital Media', 9]], '2008-02-19'), 'XW'),
      at(rel('us', [['Digital Media', 9]], '2008-02-19'), 'US'),
    ]);
    expect(picked.id).toBe('xw');
  });

  test('with no Worldwide release, the US one', () => {
    const picked = pickRelease([
      at(rel('bh', [['Digital Media', 9]], '2008-02-19'), 'BH'),
      at(rel('us', [['Digital Media', 9]], '2008-02-19'), 'US'),
    ]);
    expect(picked.id).toBe('us');
  });

  test('the country preference wins over an earlier date in another country', () => {
    const picked = pickRelease([
      at(rel('gb', [['Digital Media', 9]], '2008-02-01'), 'GB'),
      at(rel('xw', [['Digital Media', 9]], '2008-03-10'), 'XW'),
    ]);
    expect(picked.id).toBe('xw');
  });

  test('but never over the format and track-count rules', () => {
    const picked = pickRelease([
      at(rel('xw-cd', [['CD', 9]], '2008-02-19'), 'XW'),
      at(rel('bh-digital', [['Digital Media', 9]], '2008-02-19'), 'BH'),
    ]);
    expect(picked.id).toBe('bh-digital');
  });

  test('releases with no media information keep MusicBrainz order', () => {
    expect(pickRelease([{ id: 'a' }, { id: 'b' }]).id).toBe('a');
  });

  test('releaseTrackCount counts tracks when track-count is missing', () => {
    expect(releaseTrackCount({ media: [{ tracks: [1, 2, 3] }, { 'track-count': 2 }] })).toBe(5);
    expect(releaseTrackCount({})).toBe(0);
  });
});

describe('fetchReleaseGroupDetails', () => {
  const cdFirst = {
    releases: [
      { id: 'cd', date: '2026-11-06', media: [{ format: 'CD', 'track-count': 9, tracks: Array(9).fill({}) }] },
      { id: 'digital', date: '2026-11-06', media: [{ format: 'Digital Media', 'track-count': 18, tracks: Array(18).fill({}) }] },
    ],
  };

  test('still one request, and it opens the release pickRelease chose', async () => {
    const calls = [];
    const cache = {};
    const lookup = createReleaseLookup({
      getCache: () => cache,
      ttlMs: 1e9,
      fetch: async (url) => { calls.push(url); return { ok: true, status: 200, json: async () => cdFirst }; },
    });
    const res = await lookup.fetchReleaseGroupDetails('rg-1');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('release?release-group=rg-1&status=official');
    expect(calls[0]).toContain('limit=25');
    expect(res.releaseId).toBe('digital');
    expect((await res.json()).media[0].tracks).toHaveLength(18);
    expect(cache['rg-1']).toEqual(expect.objectContaining({ alias: 'digital' }));
  });
});
