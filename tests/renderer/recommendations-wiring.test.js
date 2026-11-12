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

  test('the song playing from a row shows the now-playing row, like a playlist\'s, in that row only', () => {
    // The playlist view's rule (this track, played from this list, while
    // playing), keyed on the ROW the click put in the playback context: two
    // rows can share a title ("For you" in every section, a split Amazon
    // section), so the name (what the queue drawer shows) can't decide.
    const start = app.indexOf('const songRow = (');
    const row = app.slice(start, app.indexOf('// ── Friends', start));
    expect(row).toMatch(/const contextName = section\.title \|\| 'Recommendations';/);
    expect(row).toMatch(/const isNowPlaying = isPlaying && currentTrack\?\.id === track\.id\s*&& playbackContext\?\.type === 'recommendations' && playbackContext\?\.rowKey === section\.key;/);
    expect(row).toMatch(/const context = \{ type: 'recommendations', name: contextName, rowKey: section\.key \};/);
    expect(row).not.toMatch(/playbackContext\?\.name === contextName/);
    // the playlist view's marks: tinted row, a play glyph for the number, accent title
    expect(row).toMatch(/isNowPlaying \? 'bg-purple-50'/);
    expect(row).toMatch(/isNowPlaying \? '▶' : String\(index \+ 1\)\.padStart\(2, '0'\)/);
    expect(row).toMatch(/color: isNowPlaying \? 'var\(--accent-primary\)'/);
  });

  test('"load more" is guarded by a ref and appends from the functional update (review round 2)', () => {
    const i = app.indexOf('const loadMoreRecommendationSection = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    // The ref guard (the state read is stale in the click closure).
    // Keyed by the PROVIDER section (pagingKey), not the display row: the
    // splits of one mixed section share it, so two open splits never fetch
    // the same page twice.
    expect(fn).toMatch(/recommendationsLoadingMoreRef\.current\[section\.pagingKey\]\) return;/);
    expect(fn).toMatch(/delete recommendationsLoadingMoreRef\.current\[section\.pagingKey\];/);
    // The append reads `prev` (via prior), not the post-commit-synced ref.
    expect(fn).toMatch(/const prior = prev\[key\] \|\| \{ items: \[\] \};/);
    expect(fn).toMatch(/items: \[\.\.\.\(prior\.items \|\| \[\]\), \.\.\.result\.items\]/);
    expect(fn).not.toMatch(/expandedSectionsRef\.current\[key\]/);
  });

  test('a readiness failure drops the provider\'s stale cached sections (a transient failure keeps them)', () => {
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    // notReady drops the cached sections; anything else (timeout, network)
    // keeps the cached answer, even an expired one.
    expect(fn).toMatch(/if \(error\?\.notReady\) \{[\s\S]{0,600}?delete recommendationsCache\.current\.providers\[provider\.id\];\s*\} else if \(cachedFor\(provider\)\) \{[\s\S]{0,300}?fresh\[provider\.id\] = cachedFor\(provider\);/);
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
    // (mapped by recommendationPlaylistTracks, shared by every playlist action)
    expect(fn).toContain('await recommendationPlaylistTracks(item)');
    const mapper = app.slice(app.indexOf('const recommendationPlaylistTracks = async'), app.indexOf('const playRecommendationPlaylist = async'));
    expect(mapper).toContain("id: trackSlug(t.artist || '', t.title || '')");
    expect(mapper).not.toContain('amazonmusic-${t.amazonAsin}');
    expect(mapper).not.toContain('rec-playlist-');
  });
});

describe('the single Show-more control with background pagination', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('expanding a paginated section drives the page fetches (no separate Load-more button)', () => {
    // The auto-fetch effect: expanded + canLoadMore + not in flight → fetch.
    const i = app.indexOf('// "Show more" is the only section control');
    const effect = app.slice(i, app.indexOf('}, [activeView, recommendations.sections, recommendationsExpandedSections]);', i));
    // It walks the subsections (rows); open state is per row, the in-flight
    // guard per provider section.
    expect(effect).toMatch(/for \(const section of recommendations\.sections\.flatMap\(s => s\.subsections\)\)/);
    expect(effect).toMatch(/recommendationsExpandedSections\.has\(section\.key\)\) continue;/);
    expect(effect).toMatch(/if \(!section\.canLoadMore\) continue;/);
    expect(effect).toMatch(/recommendationsLoadingMoreRef\.current\[section\.pagingKey\]\) continue;/);
    expect(effect).toMatch(/loadMoreRecommendationSection\(section\);/);
    // One toggle: See all / Show less, never a Load-more button.
    const view = app.slice(app.indexOf("// Recommendations view with collapsible hero header."));
    expect(view).toMatch(/'See all'/);
    expect(view).toMatch(/'Show less'/);
    expect(view).not.toMatch(/'Load more'/);
    expect(view).not.toMatch(/'Show more'/);
  });

  test('the background pagination is page-capped per section (a provider minting endless cursors cannot page forever)', () => {
    expect(app.indexOf('const EXPANSION_PAGE_CAP = 10;')).toBeGreaterThan(-1);;
    const i = app.indexOf('const loadMoreRecommendationSection = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(i).toBeGreaterThan(-1);
    // The budget counts pages in the expansion record and exhausts the section
    // when it is spent, whatever the cursor says.
    expect(fn).toContain('const pages = (prior.pages || 0) + 1;');
    expect(fn).toContain('exhausted: !nextCursor || pages >= EXPANSION_PAGE_CAP');
    // And the merged model turns exhausted into canLoadMore false, which is
    // what stops the self-advancing effect.
    expect(require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/lib/recommendation-model.js'), 'utf8'))
      .toMatch(/canLoadMore: !!section\.id && expandable\.has\(provider\.resolverId\) && !\(expansion && expansion\.exhausted\)/);
  });

  test('a page answering the cursor it was sent is exhausted, not fetched again (no-advance)', () => {
    const i = app.indexOf('const loadMoreRecommendationSection = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(i).toBeGreaterThan(-1);
    // The same rule paginatePlaylistTracks enforces for playlist pages: the
    // self-advancing effect would fetch the identical page forever (the
    // provider's page cache answers instantly) — the repeated cursor ends
    // the chain instead.
    expect(fn).toContain('result.nextCursor != null && result.nextCursor === section.nextCursor');
    expect(fn).toContain('const nextCursor = noAdvance ? null : (result.nextCursor || null);');
    expect(fn).toContain('exhausted: !nextCursor');
  });
});

describe('the grouped model wiring (similar users, weekly sections, readers)', () => {
  const loadFn = () => {
    const i = app.indexOf('const loadRecommendations = async');
    return app.slice(i, app.indexOf('\n  };', i));
  };

  test('the meta-service gate admits similarUsers && getSimilarUsers (startup and hot reload)', () => {
    const gate = /axe\.capabilities\?\.similarUsers && axe\.implementation\?\.getSimilarUsers/g;
    expect((app.match(gate) || []).length).toBe(2);
    const startup = app.slice(app.indexOf('const metaServicesWithRecommendations = metaServiceAxes.filter(axe =>'), app.indexOf('const metaServicesWithPlaybackTelemetry'));
    expect(startup).toMatch(gate);
    const reload = app.slice(app.indexOf('const withRecommendations = filteredAxes.filter(axe =>'), app.indexOf('const withPlaybackTelemetry'));
    expect(reload).toMatch(gate);
  });

  test("_fetchResolverConfig gives lastfm the effective key from getLastfmApiKey()", () => {
    const i = app.indexOf('const _fetchResolverConfig = async (resolverId) => {');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/if \(resolverId === 'lastfm'\) \{\s*const apiKey = saved\.apiKey \|\| getLastfmApiKey\(\);\s*return apiKey \? \{ \.\.\.saved, apiKey \} : \{ \.\.\.saved, credentialsPending: true \};/);
  });

  test('a similar-users config whose credential is not ready is "not ready": not asked, not stored, retried next load', () => {
    const fn = loadFn();
    const fetchBlock = fn.slice(fn.indexOf('const fetchSimilarUsers = async (provider) => {'), fn.indexOf('await Promise.all(['));
    // Checked generically (a config flag), before the plugin is asked…
    const check = fetchBlock.indexOf('if (config?.credentialsPending) {');
    const call = fetchBlock.indexOf('loader.getSimilarUsers(');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(call);
    expect(fetchBlock).toMatch(/if \(config\?\.credentialsPending\) \{\s*const notReady = new Error\('credentials not ready'\);\s*notReady\.notReady = true;\s*throw notReady;/);
    // …and the throw lands in the catch, which keeps the cached answer and
    // stores nothing (accept, the only cache write, never runs).
    const catchBlock = fetchBlock.slice(fetchBlock.indexOf('} catch (error) {'));
    expect(catchBlock).toMatch(/if \(similarCachedFor\(provider\)\) similarFresh\[provider\.id\] = similarCachedFor\(provider\);/);
    expect(catchBlock).not.toMatch(/recommendationsCache\.current\.similarUsers\[/);
    expect(fetchBlock.indexOf('recommendationsCache.current.similarUsers[provider.id] =')).toBeGreaterThan(call);
  });

  test('a similar-users lookup in flight is awaited by a later load, never started twice', () => {
    expect(app).toContain('const similarUsersInFlightRef = useRef({});');
    const fn = loadFn();
    const fetchBlock = fn.slice(fn.indexOf('const fetchSimilarUsers = async (provider) => {'), fn.indexOf('await Promise.all(['));
    // Reused when one is running for the same account; a new run otherwise.
    expect(fetchBlock).toMatch(/let inFlight = similarUsersInFlightRef\.current\[provider\.id\];\s*if \(!inFlight \|\| inFlight\.account !== account\) \{/);
    expect(fetchBlock).toMatch(/inFlight = \{ account, request: run \};\s*similarUsersInFlightRef\.current\[provider\.id\] = inFlight;/);
    // The plugin is asked only inside the shared run.
    const run = fetchBlock.slice(fetchBlock.indexOf('const run = (async () => {'), fetchBlock.indexOf('})();'));
    expect(run).toContain('loader.getSimilarUsers(');
    expect((fetchBlock.match(/loader\.getSimilarUsers\(/g) || []).length).toBe(1);
    // Cleared once settled (either way), and only if it is still the current run.
    expect(fetchBlock).toMatch(/if \(similarUsersInFlightRef\.current\[provider\.id\] === settled\) delete similarUsersInFlightRef\.current\[provider\.id\];/);
    expect(fetchBlock).toContain('run.then(clear, clear);');
    // Each load races the shared request under its own bound and generation.
    expect(fetchBlock).toMatch(/const request = inFlight\.request;[\s\S]*Promise\.race\(\[\s*request,/);
  });

  test('loadRecommendations checks getSimilarUsersResolvers before calling, never names a service, and passes excludeUsernames', () => {
    const fn = loadFn();
    expect(fn).toContain('similarUsersProviders()');
    const providers = app.slice(app.indexOf('const similarUsersProviders = () => {'), app.indexOf('const refreshMergedRecommendations'));
    expect(providers).toContain('if (!loader?.getSimilarUsersResolvers) return [];');
    // The similar-users block: no service named, the exclusions passed, only
    // on a full load.
    const block = fn.slice(fn.indexOf('// Similar users (the Friends row)'), fn.indexOf('const generation = ++recommendationsLoadGenRef.current;'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('const similarProviders = similarUsersProviders();');
    expect(block).toMatch(/if \(metaOnly\) continue;/);
    const fetchBlock = fn.slice(fn.indexOf('const fetchSimilarUsers = async (provider) => {'), fn.indexOf('await Promise.all(['));
    expect(fetchBlock).toMatch(/loader\.getSimilarUsers\(provider\.id, \{ \.\.\.config, excludeUsernames: excludeUsernamesFor\(provider\.id\) \}\)/);
    expect(fetchBlock).toContain('CACHE_TTL.recommendationProvider');
    expect(fetchBlock).toMatch(/if \(raw === TIMED_OUT\) \{[\s\S]{0,400}request\.then\(\(late\) => \{\s*accept\(late\);\s*applyFresh\(\);\s*saveRecommendationsCache\(\);/);
    for (const part of [block, fetchBlock]) {
      expect(part).not.toMatch(/'lastfm'|'listenbrainz'|\.lastfm\b|\.listenbrainz\b/);
    }
    // Both fetch kinds share the round's Promise.all (one generation, one save).
    expect(fn).toMatch(/await Promise\.all\(\[\s*\.\.\.toFetch\.map\(async \(provider\) => \{/);
    expect(fn).toMatch(/\.\.\.similarToFetch\.map\(fetchSimilarUsers\)\s*\]\);/);
    // excludeUsernames: followed people on that service, plus removed ones.
    const exclude = fn.slice(fn.indexOf('const excludeUsernamesFor = (serviceId) => {'));
    expect(exclude).toMatch(/f\.service === serviceId/);
    expect(exclude).toMatch(/hiddenFriendKeysRef\.current/);
  });

  test('every merge applies the friend exclusions (a follow since the fetch drops out at once)', () => {
    const i = app.indexOf('const refreshMergedRecommendations = () => {');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/buildRecommendationPage\(\{[\s\S]*similarUsers: Object\.values\(similarUsersRef\.current\),[\s\S]*exclude: recommendationExclusions\(\)/);
    const ex = app.slice(app.indexOf('const recommendationExclusions = () => {'), app.indexOf('const refreshMergedRecommendations'));
    expect(ex).toMatch(/friendsRef\.current/);
    expect(ex).toMatch(/hiddenFriendKeysRef\.current/);
    expect(ex).toMatch(/metaServiceConfigsRef\.current/);
    // A follow or a removal re-merges without a refetch.
    expect(app).toMatch(/useEffect\(\(\) => \{\s*if \(Object\.keys\(similarUsersRef\.current\)\.length > 0\) refreshMergedRecommendations\(\);\s*\}, \[similarExclusionDigest\]\);/);
  });

  test('loadMoreRecommendationSection guards on section.pagingKey', () => {
    const i = app.indexOf('const loadMoreRecommendationSection = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/if \(recommendationsLoadingMoreRef\.current\[section\.pagingKey\]\) return;/);
    expect(fn).toMatch(/recommendationsLoadingMoreRef\.current\[section\.pagingKey\] = true;/);
    expect(fn).not.toMatch(/recommendationsLoadingMoreRef\.current\[section\.key\]/);
  });

  test('all five readers call flattenRecommendationItems', () => {
    // the discovery-unread hash on the page…
    const seen = app.slice(app.indexOf("if (activeView === 'recommendations' && recommendations.sections.length > 0) {"));
    expect(seen.slice(0, 300)).toMatch(/generateDiscoveryHash\(flattenRecommendationItems\(recommendations\.sections\), i => i\.name\)/);
    // …and on every merge
    const merge = app.slice(app.indexOf('const refreshMergedRecommendations = () => {'));
    expect(merge.slice(0, merge.indexOf('\n  };'))).toMatch(/generateDiscoveryHash\(flattenRecommendationItems\(sections\), i => i\.name\)/);
    // the song list the scheduler resolves
    const songs = app.slice(app.indexOf('const recommendationSongs = useMemo('));
    expect(songs.slice(0, 400)).toContain('flattenRecommendationItems(recommendations.sections)');
    // Home's For You preview
    const preview = app.slice(app.indexOf('const recommendationsPreview = useMemo(() => {'));
    expect(preview.slice(0, 300)).toContain('flattenRecommendationItems(recommendations.sections)');
    // the image fetch
    const images = app.slice(app.indexOf('const recommendationImageFetchesRef = useRef(new Set());'));
    expect(images.slice(0, 900)).toContain('for (const item of flattenRecommendationItems(recommendations.sections))');
    // nothing reads a section's items directly any more
    expect(app).not.toMatch(/recommendations\.sections\.flatMap\(s => s\.items/);
    expect(app).not.toContain('buildRecommendationSections');
  });

  test('loadWeeklyPlaylists no longer exists, and no playlists/createdfor URL is left in app.js', () => {
    expect(app).not.toContain('loadWeeklyPlaylists');
    expect(app).not.toContain('playlists/createdfor');
    // The weekly fields are filled from the merged page's weekly items.
    const i = app.indexOf('const refreshMergedRecommendations = () => {');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/const weekly = weeklyHomeEntries\(sections, prev\);/);
    expect(fn).toMatch(/if \(weekly\.weeklyJams === prev\.weeklyJams && weekly\.weeklyExploration === prev\.weeklyExploration\) return prev;/);
  });
});

describe('the five-section page render', () => {
  const start = app.indexOf('// Recommendations view with collapsible hero header.');
  const view = app.slice(start, app.indexOf('// History view with collapsible hero header and tabs', start));
  const between = (from, to) => view.slice(view.indexOf(from), view.indexOf(to, view.indexOf(from)));
  const home = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/home-page.js'), 'utf8');

  test('the interim flat render is gone', () => {
    expect(start).toBeGreaterThan(-1);
    expect(view).not.toContain('INTERIM');
    expect(view).not.toContain('const renderSection = ');
    // The unguarded read the interim render had.
    expect(view).not.toMatch(/sub\.sources\.some/);
  });

  test('sections render in the model order, Friends last, each heading at Home\'s section size with no count', () => {
    expect(view).toMatch(/const contentSections = sections\.filter\(s => s\.type !== 'friend'\);/);
    expect(view).toMatch(/const friendsSection = sections\.find\(s => s\.type === 'friend'\) \|\| null;/);
    const typeSection = between('const renderTypeSection = (section) =>', '// ── The page');
    expect(typeSection).toMatch(/React\.createElement\('h2', \{ className: 'text-lg font-semibold mb-4', style: \{ color: 'var\(--text-primary\)' \} \}, section\.title\)/);
    expect(typeSection).toMatch(/section\.subsections\.map\(renderSubsection\)/);
    // No item counts beside titles (the old header printed items.length).
    expect(view).not.toMatch(/`\$\{section\.items\.length\}`|`\$\{sub\.items\.length\}`/);
  });

  test('"See all" / "Show less" carry Home\'s link classes exactly', () => {
    const header = between('const subsectionHeader = (sub, ', '// ── One subsection');
    expect(header).toMatch(/className: 'text-sm text-purple-600 hover:text-purple-700 font-medium( [^']*)?'/);
    expect(header).toMatch(/expanded \? 'Show less' : 'See all'/);
    // Only for a row with more than its preview, or more to load.
    const row = between('const renderSubsection = (sub) => {', '// ── Types');
    expect(row).toMatch(/const showToggle = expanded \|\| canExpand \|\| sub\.canLoadMore;/);
  });

  test('no Shuffleupagus Refresh on the page (Home keeps its own)', () => {
    expect(view).not.toContain('fetchAiRecommendations');
    // A whole word: the error state's Try Again passes { forceRefresh: true }.
    expect(view).not.toMatch(/\bRefresh\b/);
    expect(view).not.toContain('Thinking…');
  });

  test('a blended row\'s source tags are buttons with aria-pressed; a single-source row\'s tag is a plain label', () => {
    const tags = between('const sourceTags = (sub) => {', 'const subsectionHeader = (sub, ');
    expect(tags).toMatch(/if \(!sub\.blended\) \{/);
    expect(tags).toMatch(/className: 'text-\[10px\] font-semibold uppercase tracking-wider px-1\.5 py-0\.5 rounded'/);
    expect(tags).toMatch(/style: \{ backgroundColor: 'var\(--placeholder-bg\)', color: 'var\(--text-secondary\)' \}/);
    expect(tags).toMatch(/React\.createElement\('button', \{[\s\S]{0,300}'aria-pressed': on \? 'true' : 'false'/);
    expect(tags).toMatch(/onClick: \(\) => toggleRecommendationSourceFilter\(sub\.key, src\.id\)/);
    // On is accent-tinted; off is outlined and struck through; CSS variables only.
    expect(tags).toMatch(/textDecoration: on \? 'none' : 'line-through'/);
    expect(tags).not.toMatch(/#[0-9a-fA-F]{3,6}\b|rgba?\(/);
  });

  test('filters are session state applied at render, one row at a time, never persisted', () => {
    expect(app).toContain('const [recommendationSourceFilters, setRecommendationSourceFilters] = useState({});');
    const row = between('const renderSubsection = (sub) => {', '// ── Types');
    expect(row).toMatch(/const items = filterSubsectionItems\(sub, recommendationSourceFilters\[sub\.key\]\);/);
    const toggle = app.slice(app.indexOf('const toggleRecommendationSourceFilter = '), app.indexOf('\n  };', app.indexOf('const toggleRecommendationSourceFilter = ')));
    expect(toggle).toMatch(/return \{ \.\.\.prev, \[subKey\]: next \};/);
    // Never written to the store.
    for (const line of app.split('\n').filter(l => l.includes('recommendationSourceFilters') || l.includes('RecommendationSourceFilter'))) {
      expect(line).not.toMatch(/store|localStorage/);
    }
    expect(app).not.toMatch(/recommendation_source_filters/);
  });

  test('a row with every source off shows the empty note and keeps its tags', () => {
    const row = between('const renderSubsection = (sub) => {', '// ── Types');
    expect(row).toMatch(/items\.length === 0 && sub\.items\.length > 0/);
    expect(row).toContain('Every source is turned off for this row. Turn one back on to see its picks.');
    // The header (with the tags) renders before the empty-note branch.
    expect(row.indexOf('subsectionHeader(sub, ')).toBeLessThan(row.indexOf('Every source is turned off'));
  });

  test('weekly cards keep Home\'s mosaic, open as ephemeral playlists and play in their weekly context', () => {
    const card = between('const weeklyCard = (item, index, sub) => {', 'const cardFor = ');
    expect(card).toMatch(/weeklyJamCovers\[item\.weekly\.id\]/);
    expect(card).toMatch(/loadPlaylist\(\{[\s\S]*?listenbrainzId: item\.weekly\.id,[\s\S]*?isEphemeral: true,[\s\S]*?\}\)/);
    const play = view.slice(view.indexOf('const playWeeklyPlaylist = async (item) => {'));
    expect(play.slice(0, 1400)).toMatch(/tracks = await loadWeeklyJamTracks\(item\.weekly\.id\);/);
    expect(play.slice(0, 1400)).toMatch(/playTrackCollection\(tracks, \{ type: item\.weekly\.contextType, name/);
    // Routed by the item's field, never by provider name.
    expect(view).toMatch(/item\.weekly \? weeklyCard\(item, index, sub\)/);
    expect(card).not.toMatch(/'listenbrainz'|'ListenBrainz'/);
  });

  test('a friend card opens the profile with a friend-shaped object that is not in friends', () => {
    const card = between('const friendCard = (item, index) => {', '// ── One subsection');
    expect(card).toMatch(/navigateToFriend\(\{\s*id: `similar:\$\{item\.service\}:\$\{item\.name\}`,\s*username: item\.name,\s*service: item\.service,\s*displayName: item\.name,\s*avatarUrl: item\.avatarUrl \|\| null\s*\}\)/);
    expect(card).toMatch(/% similar/);
    // No per-item source badge (sources live in the row's tags).
    expect(card).not.toContain('release-badge');
  });

  test('Home has no weekly section, and no weekly props', () => {
    expect(home).not.toContain('Weekly Exploration');
    expect(home).not.toContain('Weekly Jams');
    expect(home).not.toContain('weeklyJamCovers');
    expect(home).not.toContain('loadWeeklyJamTracks');
  });

  test('both back paths for a weekly playlist go to Recommendations', () => {
    const drawer = app.slice(app.indexOf("} else if (playbackContext.type === 'weekly-jam' || playbackContext.type === 'weekly-exploration') {"));
    expect(drawer.slice(0, 300)).toContain("navigateTo('recommendations');");
    expect(drawer.slice(0, 300)).not.toContain("navigateTo('home')");
    const timeout = app.slice(app.indexOf('// Give up on pending playlist load after timeout'));
    const ephemeral = timeout.slice(0, timeout.indexOf('} else {'));
    expect(ephemeral).toContain("navigateTo('recommendations');");
    expect(ephemeral).not.toContain("setActiveView('home')");
  });

  test('the empty-page checks count Friends (a page whose only content is Friends is not empty)', () => {
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    const checks = fn.match(/!anySections && !llmHas && !anyFriends/g) || [];
    expect(checks.length).toBe(2);
    expect((fn.match(/const anyFriends = recommendationsFriendsShownRef\.current;/g) || []).length).toBe(2);
    const merge = app.slice(app.indexOf('const refreshMergedRecommendations = () => {'));
    expect(merge.slice(0, merge.indexOf('\n  };'))).toMatch(/recommendationsFriendsShownRef\.current = sections\.some\(s => s\.type === 'friend'\);/);
    // A late Friends answer clears an empty message the round already showed.
    const fetchBlock = fn.slice(fn.indexOf('const fetchSimilarUsers = async (provider) => {'), fn.indexOf('await Promise.all(['));
    expect(fetchBlock).toMatch(/saveRecommendationsCache\(\);\s*(\/\/[^\n]*\n\s*)?if \(isLatest\(\) && recommendationsFriendsShownRef\.current\) \{\s*setRecommendations\(prev => \(\{ \.\.\.prev, loading: false, error: null \}\)\);/);
  });
});
