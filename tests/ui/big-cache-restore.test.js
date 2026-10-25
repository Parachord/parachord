/**
 * Startup reads the store in two batches: the critical keys (`d`) before first
 * paint, and BIG_CACHE_KEYS (`dCaches`) in an idle callback. When the split
 * landed (693b60e, 2026-05) cache_concerts moved to the big batch but its
 * restore kept reading `d['cache_concerts']`, which is never there, so the
 * Concerts page never got its cache back and did a full fetch on every launch.
 * Every big key must be read from dCaches, and none from d.
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const listMatch = src.match(/const BIG_CACHE_KEYS = \[([\s\S]*?)\];/);
const BIG_CACHE_KEYS = listMatch ? [...listMatch[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]) : [];

const hydrateStart = src.indexOf('const hydrateBigCaches = async () => {');
const hydrateEnd = src.indexOf('// end hydrateBigCaches', hydrateStart);
const hydrate = src.slice(hydrateStart, hydrateEnd);

describe('big-cache restore reads the big-cache batch', () => {
  test('the markers this test depends on exist', () => {
    expect(BIG_CACHE_KEYS).toContain('cache_concerts');
    expect(BIG_CACHE_KEYS).toContain('cache_new_releases');
    expect(hydrateStart).toBeGreaterThan(-1);
    expect(hydrateEnd).toBeGreaterThan(hydrateStart);
  });

  test.each(BIG_CACHE_KEYS)('%s is read from dCaches', (key) => {
    expect(hydrate).toContain(`dCaches['${key}']`);
  });

  test.each(BIG_CACHE_KEYS)('%s is never read from the critical batch', (key) => {
    expect(src).not.toMatch(new RegExp(`\\bd\\[['"]${key}['"]\\]`));
  });
});
