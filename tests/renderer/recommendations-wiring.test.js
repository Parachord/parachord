/**
 * Source-level wiring checks for the sectioned Recommendations page
 * (src/renderer/app.js) — each one pins a bug found in review of the
 * sectioned-page rework:
 *   - the LLM's updates must reach the page (refreshMergedRecommendations on
 *     every aiRecommendations change — nothing else re-merges on them)
 *   - recommended songs must resolve: the observer callbacks read
 *     recommendationsTracksRef, so it must be synced with the sections' song
 *     list
 *   - the plugin-uninstall path must write the sectioned state/cache shapes
 *     (the flat shape's undefined `sections` crashed the next render)
 *   - a provider that answers empty is never cached (the flat page's
 *     "not cached, so the next visit asks again" rule)
 *   - the blocklist applies to the merge inputs the base-section filter
 *     misses: "load more" items and the Shuffleupagus section
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('recommendations wiring', () => {
  test('an aiRecommendations change re-merges the display model', () => {
    const i = app.indexOf('aiRecommendationsRef.current = aiRecommendations;');
    expect(i).toBeGreaterThan(-1);
    const effect = app.slice(i, app.indexOf('}, [aiRecommendations]);', i));
    expect(effect).toMatch(/refreshMergedRecommendations\(\);/);
  });

  test('recommendationsTracksRef stays synced with the sections song list (the observer reads it)', () => {
    const i = app.indexOf('recommendationsTracksRef.current = recommendationSongs;');
    expect(i).toBeGreaterThan(-1);
    // The sync effect keys on the memoized song list, not a stale snapshot.
    const effect = app.slice(app.lastIndexOf('useEffect', i), app.indexOf('}, [recommendationSongs]);', i));
    expect(effect).toContain('recommendationsTracksRef.current = recommendationSongs');
    // The observer callback finds tracks through that ref.
    const observer = app.slice(app.indexOf('recommendationsObserverRef.current = new IntersectionObserver'));
    expect(observer).toContain('recommendationsTracksRef.current');
  });

  test('the plugin-uninstall path writes the sectioned state and cache shapes', () => {
    const i = app.indexOf("if (resolverId === 'lastfm' || resolverId === 'listenbrainz') {", app.indexOf('removeResolverSources(resolverId)'));
    const block = app.slice(i, i + 400);
    expect(block).toMatch(/setRecommendations\(\{ sections: \[\], loading: false, error: 'not_configured' \}\)/);
    expect(block).toMatch(/recommendationsCache\.current = \{ providers: \{\}, timestamp: 0 \}/);
    expect(block).not.toMatch(/artists: \[\]/);
  });

  test('a provider that answers empty is never cached (the next visit asks again)', () => {
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/cached && cached\.sections\.length > 0/);
  });

  test('the blocklist covers the merge inputs the base-section filter misses (load-more items, the Shuffleupagus section)', () => {
    const i = app.indexOf('const refreshMergedRecommendations = () => {');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/notBlocked\(expansion\.items/);
    expect(fn).toMatch(/items: notBlocked\(s\.items\)/); // shuffle section items
  });

  test('a force refresh forgets the load-more pages', () => {
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/if \(forceRefresh\) \{\s*expandedSectionsRef\.current = \{\};/);
  });
});
