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
    const i = app.indexOf('aiRecommendationsRef.current = homeData.aiRecommendations;');
    expect(i).toBeGreaterThan(-1);
    const effect = app.slice(i, app.indexOf('}, [homeData.aiRecommendations]);', i));
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

  test("Home's For You preview asks only the meta-services (a resolver's page loads never queue ahead of Home resolution)", () => {
    // The Home discovery effect's call is filtered…
    const homeCall = app.indexOf('loadRecommendations({ metaServicesOnly: true });');
    expect(homeCall).toBeGreaterThan(-1);
    const homeEffect = app.slice(app.lastIndexOf('useEffect', homeCall), homeCall);
    expect(homeEffect).toContain('hasScrobbler');
    // …and loadRecommendations implements the filter (meta-service ids only).
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toContain('const metaOnly = opts !== true && !!opts?.metaServicesOnly;');
    expect(fn).toMatch(/providers = metaOnly[\s\S]*?recommendationProviders\(\)\.filter\(p => metaServiceIds\.has\(p\.id\)\)/);
  });

  test('a recommendation album cover that fails to load is reported, not only hidden (the album-art rule)', () => {
    const i = app.indexOf('recommendationBrokenArtRef.current');
    expect(i).toBeGreaterThan(-1);
    const albumCardStart = app.indexOf('const albumCard = (item, index) => {');
    const albumCard = app.slice(albumCardStart, app.indexOf('const playlistCard', albumCardStart));
    expect(albumCard).toMatch(/report\(art, \{ artist: item\.artist, album: item\.name \}\)/);
  });

  test('the song playing from a section shows the now-playing row, like a playlist\'s', () => {
    // The row had no now-playing state at all; it uses the playlist view's
    // rule (this track, played from this list, while playing), keyed on the
    // section name the row click puts in the playback context.
    const start = app.indexOf('const songRow = (');
    const row = app.slice(start, app.indexOf('const renderSection', start));
    expect(row).toMatch(/const contextName = section\.title \|\| 'Recommendations';/);
    expect(row).toMatch(/const isNowPlaying = isPlaying && currentTrack\?\.id === track\.id\s*&& playbackContext\?\.type === 'recommendations' && playbackContext\?\.name === contextName;/);
    expect(row).toMatch(/const context = \{ type: 'recommendations', name: contextName \};/);
    // the playlist view's marks: tinted row, a play glyph for the number, accent title
    expect(row).toMatch(/isNowPlaying \? 'bg-purple-50'/);
    expect(row).toMatch(/isNowPlaying \? '▶' : String\(index \+ 1\)\.padStart\(2, '0'\)/);
    expect(row).toMatch(/color: isNowPlaying \? 'var\(--accent-primary\)'/);

  test('"load more" is guarded by a ref and appends from the functional update (review round 2)', () => {
    const i = app.indexOf('const loadMoreRecommendationSection = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    // The ref guard (the state read is stale in the click closure).
    expect(fn).toMatch(/recommendationsLoadingMoreRef\.current\[section\.key\]\) return;/);
    expect(fn).toMatch(/delete recommendationsLoadingMoreRef\.current\[section\.key\];/);
    // The append reads `prev`, not the post-commit-synced ref.
    expect(fn).toMatch(/items: \[\.\.\.\(\(prev\[key\] \|\| \{ items: \[\] \}\)\.items \|\| \[\]\), \.\.\.result\.items\]/);
    expect(fn).not.toMatch(/expandedSectionsRef\.current\[key\]/);
  });

  test('a readiness failure drops the provider\'s stale cached sections (a transient failure keeps them)', () => {
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/if \(!error\?\.notReady && cache\.providers\[provider\.id\]\)/);
  });

  test('the LLM stream does not churn: observer keyed on the song-id digest, seen-hash writes skipped when unchanged', () => {
    const i = app.indexOf('const recommendationSongsKey = useMemo');
    expect(i).toBeGreaterThan(-1);
    const observerDeps = app.match(/\}, \[activeView, recommendationSongsKey, updateSchedulerVisibility, recommendationsScrollContainerReady\]\);/);
    expect(observerDeps).toBeTruthy();
    const seen = app.slice(app.indexOf('const markDiscoverySeen = useCallback'), app.indexOf('}, []);', app.indexOf('const markDiscoverySeen = useCallback')));
    expect(seen).toMatch(/if \(discoverySeenHashes\.current\[feature\] === hash\) return;/);
  });

  test('opening a recommended playlist is provider-neutral (creator/source from the item and section, trackSlug ids)', () => {
    const i = app.indexOf('const openRecommendationPlaylist = async');
    expect(i).toBeGreaterThan(-1);
    const fn = app.slice(i, app.indexOf('\n            };', i));
    // The record's identity comes from the item's resolver and the section's
    // resolverName — never a hard-coded service.
    expect(fn).toContain('id: `${item.resolverId}-rec-${item.id}`');
    expect(fn).toContain('const resolverName = (section && section.resolverName) || item.resolverId');
    expect(fn).toContain('creator: resolverName');
    expect(fn).toContain('source: item.resolverId');
    expect(fn).not.toContain("'Amazon Music'");
    // Track ids are trackSlug(artist, title) — the id every no-album track
    // context keys session state on — never an asin or an index fallback.
    expect(fn).toContain("id: trackSlug(t.artist || '', t.title || '')");
    expect(fn).not.toContain('amazonmusic-${t.amazonAsin}');
    expect(fn).not.toContain('rec-playlist-');
  });
});

describe('the single Show-more control with background pagination', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('expanding a paginated section drives the page fetches (no separate Load-more button)', () => {
    // The auto-fetch effect: expanded + canLoadMore + not in flight → fetch.
    const i = app.indexOf('// "Show more" is the only section control');
    const effect = app.slice(i, app.indexOf('}, [activeView, recommendations.sections, recommendationsExpandedSections]);', i));
    expect(effect).toMatch(/recommendationsExpandedSections\.has\(section\.key\)\) continue;/);
    expect(effect).toMatch(/if \(!section\.canLoadMore\) continue;/);
    expect(effect).toMatch(/loadMoreRecommendationSection\(section\);/);
    // One toggle: Show more / Show less — never a Load-more button.
    const view = app.slice(app.indexOf("// Recommendations view with collapsible hero header — the sectioned"));
    expect(view).toMatch(/'Show more'/);
    expect(view).toMatch(/'Show less'/);
    expect(view).not.toMatch(/'Load more'/);
  });
});
