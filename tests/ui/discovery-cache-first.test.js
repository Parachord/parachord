/**
 * Concerts and Fresh Drops must show their cache first, then refresh.
 *
 * Their caches are in the deferred big-cache batch, restored after
 * cacheLoaded flips. A loader that ran in that window (the Concerts view
 * restored at launch, Fresh Drops' startup preload) saw an empty cache and
 * fetched everything again. And a stale cache restored into state hit the
 * "data in state, nothing to do" early return, so it never refreshed until
 * the user pressed refresh (2026-10).
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const between = (from, to) => {
  const i = src.indexOf(from);
  expect(i).toBeGreaterThan(-1);
  return src.slice(i, src.indexOf(to, i + from.length));
};

test('both caches are in the deferred batch (the reason the wait exists)', () => {
  const keys = between('const BIG_CACHE_KEYS = [', '];');
  expect(keys).toMatch(/'cache_concerts'/);
  expect(keys).toMatch(/'cache_new_releases'/);
});

test('the hydration settles the ready signal whether it succeeds or fails', () => {
  const tail = between('}; // end hydrateBigCaches', 'setCacheLoaded(true)');
  expect(tail).toMatch(/hydrateBigCaches\(\)[\s\S]*\.finally\(\(\) => bigCachesHydrated\.current\.resolve\(\)\)/);
  const failure = between("console.error('Failed to load cache from store:'", 'setCacheLoaded(true)');
  expect(failure).toMatch(/bigCachesHydrated\.current\.resolve\(\)/);
  expect(between('const waitForBigCaches = ', ';\n')).toMatch(/setTimeout\(r, 10000\)/);
});

test.each([
  ['loadConcerts', 'loadConcertsNow', 'concertsCacheFresh'],
  ['loadNewReleases', 'loadNewReleasesNow', 'newReleasesCacheFresh'],
])('%s waits for the caches, then only skips work when the cache is fresh', (outer, inner, freshVar) => {
  const wrapper = between(`const ${outer} = async (forceRefresh = false) => {`, `const ${inner} = async`);
  expect(wrapper.indexOf('await waitForBigCaches()')).toBeGreaterThan(-1);
  expect(wrapper.indexOf('await waitForBigCaches()')).toBeLessThan(wrapper.indexOf(`await ${inner}(forceRefresh)`));
  expect(wrapper).toMatch(/finally \{/);
  const body = between(`const ${inner} = async (forceRefresh) => {`, '// Check ref cache as fallback');
  expect(body).toMatch(new RegExp(`&& ${freshVar}\\) \\{`));
});
