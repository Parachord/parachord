/**
 * Regression guard for the artist-data cache crash (2026-10-15):
 *
 *   Uncaught (in promise) TypeError: Cannot read properties of undefined
 *   (reading 'map') at fetchArtistData — cachedData.releases.map(...)
 *
 * Root cause: the MBID warmup path (Fresh Drops / queue enrichment, around
 * app.js `getArtistMbidFromMapperCache` write sites) stores PARTIAL entries —
 * { artist: { name, mbid }, timestamp } — with no `releases` array. Both cache
 * consumers (fetchArtistData's cache-hit branch and the artist-history back
 * navigation) treated any unexpired entry with a matching name as valid and
 * dereferenced `cachedData.releases.map`, crashing the click handler.
 *
 * The fix requires `Array.isArray(cachedData.releases)` in both cacheValid
 * predicates. Partial entries then fall through to the full fetch, which
 * writes a complete entry (and keeps the warmed MBID via the spread). This test
 * pins the guards so a refactor can't silently drop them.
 *
 * (Source-invariant test — same convention as the FALLBACK_RESOLVERS /
 * CANONICAL_RESOLVER_ORDER guards in tests/resolver/.)
 */

const fs = require('fs');
const path = require('path');

const appSrc = fs.readFileSync(path.join(__dirname, '../../app.js'), 'utf8');

describe('artistDataCache partial-entry guard', () => {
  test('fetchArtistData cacheValid requires a releases array', () => {
    const m = appSrc.match(
      /const cacheValid = cachedData &&\s*\n\s*Array\.isArray\(cachedData\.releases\) &&\s*\n\s*\(now - cachedData\.timestamp\) < CACHE_TTL\.artistData &&\s*\n\s*cacheNameMatch;/
    );
    expect(m).toBeTruthy();
  });

  test('artist-history back-navigation cacheValid requires a releases array', () => {
    // The back-navigation site has no name-match check — just the TTL — so its
    // guard is the Array.isArray + TTL form.
    const m = appSrc.match(
      /const cacheValid = cachedData &&\s*\n\s*Array\.isArray\(cachedData\.releases\) &&\s*\n\s*\(now - cachedData\.timestamp\) < CACHE_TTL\.artistData;/
    );
    expect(m).toBeTruthy();
  });

  test('no unguarded cachedData.releases dereference remains', () => {
    // Every code dereference of .releases off a cached artistDataCache entry
    // must be behind one of the guarded predicates: fetchArtistData has
    // releases.map + releases.filter, back-navigation has the same pair.
    // (The `= ` anchor skips prose mentions in comments, including the ones
    // this fix added describing the crash.)
    const hits = appSrc.match(/= cachedData\.releases\.(map|filter)/g) || [];
    expect(hits.length).toBe(4);
    // ...and both guarded cacheValid predicates exist (verified above), which
    // are the only ways to reach those lines.
  });

  test('partial-entry writers still spread existing data (MBID warmup sites)', () => {
    // The warmup writes must keep spreading the existing entry so a full
    // entry never gets REPLACED by a partial one.
    const warmupWrites = appSrc.match(
      /artistDataCache\.current\[cacheKey\] = \{\s*\n\s*\.\.\.\(artistDataCache\.current\[cacheKey\] \|\| \{\}\),/g
    ) || [];
    expect(warmupWrites.length).toBeGreaterThanOrEqual(2);
  });
});
