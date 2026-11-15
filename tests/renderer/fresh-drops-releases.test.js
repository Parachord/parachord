// Fresh Drops keeps one row per release group. A collaboration is found once
// per artist in the collection ("Manchester Orchestra" and "Manchester
// Orchestra, Julien Baker" both return "Colly Strings (Reimagined)", same
// MusicBrainz release-group id), and the list used to de-duplicate by
// artist + title only, so both rows survived. The grid keys its cards by
// release id; two cards with one key leave React unable to tell them apart,
// and after a couple of filter clicks stale cards pile up and the filters
// look dead (2026-11).

const fs = require('fs');
const path = require('path');
const { uniqueReleases } = require('../../src/renderer/lib/fresh-drops-releases');

const rel = (id, artist, title, extra = {}) => ({ id, artist, title, releaseType: 'single', date: '2026-09-18', ...extra });

describe('uniqueReleases', () => {
  test('one row per release-group id, even when the artist strings differ', () => {
    const out = uniqueReleases([
      rel('rg-colly', 'Manchester Orchestra', 'Colly Strings (Reimagined)'),
      rel('rg-colly', 'Manchester Orchestra, Julien Baker', 'Colly Strings (Reimagined)'),
      rel('rg-site', 'Waxahatchee', 'Site Unseen'),
      rel('rg-site', 'Courtney Barnett', 'Site Unseen'),
      rel('rg-site', 'Waxahatchee, MJ Lenderman', 'Site Unseen'),
    ]);
    expect(out.map(r => r.id)).toEqual(['rg-colly', 'rg-site']);
  });

  test('the first copy wins, so fresh results placed first take priority', () => {
    const out = uniqueReleases([
      rel('rg-1', 'Kevin Morby', 'Little Wide Open', { albumArt: 'fresh.jpg' }),
      rel('rg-1', 'Waxahatchee, Kevin Morby', 'Little Wide Open', { albumArt: 'old.jpg' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].albumArt).toBe('fresh.jpg');
    expect(out[0].artist).toBe('Kevin Morby');
  });

  test('still drops a same artist + title copy under another id, as before', () => {
    const out = uniqueReleases([
      rel('rg-a', 'Bon Iver', 'Sold Out'),
      rel('rg-b', 'bon iver', 'SOLD OUT'),
    ]);
    expect(out.map(r => r.id)).toEqual(['rg-a']);
  });

  test('different releases with the same title by different artists both stay', () => {
    const out = uniqueReleases([
      rel('rg-arkells', 'Arkells', 'Ride'),
      rel('rg-other', 'Someone Else', 'Ride'),
    ]);
    expect(out.map(r => r.id)).toEqual(['rg-arkells', 'rg-other']);
  });

  test('keeps order, skips holes, and never mutates its input', () => {
    const input = [rel('b', 'B', 'Two'), null, rel('a', 'A', 'One'), rel('b', 'B2', 'Two')];
    const copy = JSON.parse(JSON.stringify(input));
    expect(uniqueReleases(input).map(r => r.id)).toEqual(['b', 'a']);
    expect(input).toEqual(copy);
    expect(uniqueReleases(undefined)).toEqual([]);
  });

  test('a release with no id falls back to its artist + title', () => {
    const out = uniqueReleases([
      { artist: 'X', title: 'Y' },
      { artist: 'x', title: 'y' },
      rel('rg-z', 'X', 'Z'),
    ]);
    expect(out).toHaveLength(2);
  });
});

describe('every Fresh Drops list goes through uniqueReleases', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('the cache restore, the incremental merge, the progress merge and the full merge', () => {
    expect(src).toMatch(/const filteredReleases = uniqueReleases\(withinFreshDropsWindow\(newReleasesData\.releases\)\.filter\(/);
    expect(src).toMatch(/const merged = uniqueReleases\(withinFreshDropsWindow\(\[\.\.\.brandNew, \.\.\.newReleases\]\)\)/);
    expect(src).toMatch(/const deduped = uniqueReleases\(progressMerged\)/);
    expect(src).toMatch(/const uniqueList = uniqueReleases\(merged\)/);
  });

  test('no inline artist + title de-duplication is left behind', () => {
    expect(src).not.toMatch(/const key = `\$\{r\.artist\.toLowerCase\(\)\}-\$\{r\.title\.toLowerCase\(\)\}`;\s*\n\s*if \(seen(Releases)?\.has\(key\)\)/);
  });
});

// Fresh Drops shows the last three months, up to two weeks ahead. The window
// used to be applied only to new MusicBrainz results: every scan merged them
// with the whole cache, nothing ever aged out, and one library reached 436
// releases, 312 of them over six months old (2026-11).
describe('Fresh Drops window', () => {
  const { freshDropsWindow, withinFreshDropsWindow, FRESH_DROPS_MONTHS_BACK, FRESH_DROPS_DAYS_AHEAD } =
    require('../../src/renderer/lib/fresh-drops-releases');
  const NOW = new Date('2026-11-15T12:00:00Z');

  test('three months back, two weeks ahead', () => {
    expect(FRESH_DROPS_MONTHS_BACK).toBe(3);
    expect(FRESH_DROPS_DAYS_AHEAD).toBe(14);
    expect(freshDropsWindow(NOW)).toEqual({ from: '2026-08-15', to: '2026-11-29' });
  });

  test('drops releases that aged out, announcements too far ahead, and undated ones; keeps order', () => {
    const out = withinFreshDropsWindow([
      rel('new', 'A', 'New', { date: '2026-11-10' }),
      rel('edge-from', 'A', 'Edge from', { date: '2026-08-15' }),
      rel('old', 'A', 'Old', { date: '2026-08-14' }),
      rel('year-old', 'A', 'Year old', { date: '2025-08-26' }),
      rel('edge-to', 'A', 'Edge to', { date: '2026-11-29' }),
      rel('far', 'A', 'Far', { date: '2026-12-01' }),
      rel('undated', 'A', 'Undated', { date: '' }),
      rel('month-only', 'A', 'Month only', { date: '2026-10' }),
    ], NOW);
    expect(out.map(r => r.id)).toEqual(['new', 'edge-from', 'edge-to', 'month-only']);
  });

  test('tolerates junk input', () => {
    expect(withinFreshDropsWindow(null, NOW)).toEqual([]);
    expect(withinFreshDropsWindow([null, 3, rel('ok', 'A', 'Ok', { date: '2026-11-01' })], NOW).map(r => r.id)).toEqual(['ok']);
  });
});

describe('Fresh Drops window wiring (app.js)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('the cache load, both merges and the fetch all use the shared window', () => {
    expect(src).toMatch(/withinFreshDropsWindow\(newReleasesData\.releases/);
    expect(src).toMatch(/priorCachedReleases = withinFreshDropsWindow\(/);
    expect(src).toMatch(/withinFreshDropsWindow\(\[\.\.\.brandNew, \.\.\.newReleases\]\)/);
    expect(src).toMatch(/const \{ from: cutoffDate \} = freshDropsWindow\(\)/);
    expect(src).toMatch(/const \{ to: upperCutoffDate \} = freshDropsWindow\(\)/);
    expect(src).not.toMatch(/sixMonthsAgo/);
  });
});
