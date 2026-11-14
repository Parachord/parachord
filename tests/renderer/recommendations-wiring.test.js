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

  test("Home's load waits for first paint, and the meta-services-only option stays available", () => {
    // The redesigned Home shows every provider's album picks, so it runs the
    // full load, from an idle callback after paint (home-page.js), never from
    // an app.js effect on navigation.
    expect(app).not.toContain('loadRecommendations({ metaServicesOnly: true });');
    const home = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/home-page.js'), 'utf8');
    const idle = home.indexOf('globalThis.requestIdleCallback');
    const effect = home.slice(home.lastIndexOf('React.useEffect(', idle), home.indexOf('}, [cacheLoaded]);', idle));
    expect(effect).toContain('loadHomeRecommendations();');
    expect(app).toMatch(/const loadHomeRecommendations = \(\) => \{[\s\S]{0,400}loadRecommendations\(\);/);
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
    expect(row).toMatch(/isNowPlaying \? 'bg-accent-tint'/);
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
    // One opener for the Recommendations cards and Home's service mixes.
    expect(app).toContain('const openRecommendationPlaylist = (item, section) => openServicePlaylist(item, itemSourceName(item, section));');
    const i = app.indexOf('const openServicePlaylist = (item, sourceName) => {');
    expect(i).toBeGreaterThan(-1);
    const fn = app.slice(i, app.indexOf('\n  };', i));
    // The record's identity comes from the item's resolver and that source's
    // name on the row (rows are blended) — never a hard-coded service.
    expect(fn).toContain('id: `${item.resolverId}-rec-${item.id}`');
    expect(fn).toContain("const resolverName = sourceName || 'the service';");
    const name = app.slice(app.indexOf('const itemSourceName = (item, row) => {'), app.indexOf('const openRecommendationPlaylist = async'));
    expect(name).toContain('const src = ((row && row.sources) || []).find(x => x.id === item.resolverId);');
    expect(fn).toContain('creator: resolverName');
    expect(fn).toContain('source: item.resolverId');
    expect(fn).not.toContain("'Amazon Music'");
    // Track ids are trackSlug(artist, title) — the id every no-album track
    // context keys session state on — never an asin or an index fallback.
    // (mapped by recommendationPlaylistTracks, shared by every playlist action)
    expect(fn).toContain('fetchTracks: () => recommendationPlaylistTracks(item)');
    const mapper = app.slice(app.indexOf('const recommendationPlaylistTracks = async'), app.indexOf('const playRecommendationPlaylist = async'));
    expect(mapper).toContain("id: trackSlug(t.artist || '', t.title || '')");
    expect(mapper).not.toContain('amazonmusic-${t.amazonAsin}');
    expect(mapper).not.toContain('rec-playlist-');
  });
});

describe('opening a recommended playlist is responsive', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('the click opens the view at once and the tracks fill in when the lookup lands', () => {
    const open = app.slice(app.indexOf('const openServicePlaylist = (item, sourceName) => {'));
    const body = open.slice(0, open.indexOf('\n  };'));
    // No waiting before the view changes: no await, no global spinner.
    expect(body).not.toContain('await ');
    expect(body).not.toContain('setTrackLoading');
    expect(body).toContain('tracks: [],');
    expect(body).toContain('tracksLoaded: false,');
    const load = app.slice(app.indexOf('const loadPlaylist = async (playlistOrId'));
    const branch = load.slice(load.indexOf("typeof playlist.fetchTracks === 'function'"), load.indexOf('} else if (playlist.isEphemeral && playlist.listenbrainzId'));
    expect(branch).toContain('tracks = await playlist.fetchTracks();');
    // A user who moved on to another playlist is never overwritten.
    expect(branch).toContain('if (selectedPlaylistRef.current?.id !== playlistId) return;');
    // A failed lookup says so and goes back, only if still on this playlist.
    expect(branch).toContain("if (selectedPlaylistRef.current?.id === playlistId && activeViewNowRef.current === 'playlist-view') {");
    // Through the latest navigateBack: the closure's own is from before the view opened.
    expect(branch).toContain('navigateBackRef.current?.();');
    expect(branch).not.toMatch(/\bnavigateBack\(\);/);
    expect(app).toContain('navigateBackRef.current = navigateBack;');
  });

  test('one lookup per playlist URL is shared for 10 minutes, and a failed one is dropped', () => {
    expect(app).toContain('const recommendationPlaylistLookupsRef = useRef(new Map());');
    const lookup = app.slice(app.indexOf('const lookupRecommendationPlaylist = (item) => {'), app.indexOf('const prefetchRecommendationPlaylist = (item) => {'));
    expect(app).toContain('const PLAYLIST_LOOKUP_TTL = 10 * 60 * 1000;');
    expect(lookup).toContain('if (hit && Date.now() - hit.at < PLAYLIST_LOOKUP_TTL) return hit.promise;');
    expect(lookup).toContain('entry.promise.catch(() => { if (cache.get(item.url) === entry) cache.delete(item.url); });');
    expect(app).toMatch(/const recommendationPlaylistTracks = async \(item\) => \{\s*const resolved = await lookupRecommendationPlaylist\(item\);/);
  });

  test('hovering a playlist card for 250ms starts its lookup; leaving cancels it', () => {
    const prefetch = app.slice(app.indexOf('const prefetchRecommendationPlaylist = (item) => {'), app.indexOf('const recommendationPlaylistTracks = async'));
    expect(prefetch).toContain('if (!item.url || item.weekly) return;');
    expect(prefetch).toMatch(/\}, 250\)\);/);
    expect(prefetch).toContain('clearTimeout(timer);');
    const card = app.slice(app.indexOf('const playlistCard = (item, index, section) => {'));
    expect(card.slice(0, 800)).toContain('onMouseEnter: () => prefetchRecommendationPlaylist(item),');
    expect(card.slice(0, 800)).toContain('onMouseLeave: () => cancelRecommendationPlaylistPrefetch(item),');
  });
});

describe('the single Show-more control with background pagination', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('expanding a paginated section drives the page fetches (no separate Load-more button)', () => {
    // The auto-fetch effect: expanded + canLoadMore + not in flight → fetch.
    const i = app.indexOf('// "Show more" is the only section control');
    const effect = app.slice(i, app.indexOf('}, [activeView, recommendations.sections, recommendationsExpandedSections]);', i));
    // It walks the rows; open state is per row, and an open row pages every
    // provider section it lists, with the in-flight guard per provider section.
    expect(effect).toMatch(/for \(const row of recommendations\.sections\.flatMap\(s => s\.subsections\)\)/);
    expect(effect).toMatch(/if \(!recommendationsExpandedSections\.has\(row\.key\)\) continue;/);
    expect(effect).toMatch(/for \(const section of row\.pageable \|\| \[\]\)/);
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
    // And the merged model drops an exhausted section from its rows'
    // pageable list, which is what stops the self-advancing effect.
    expect(require('fs').readFileSync(require('path').join(__dirname, '../../src/renderer/lib/recommendation-model.js'), 'utf8'))
      .toMatch(/if \(!section\.id \|\| !expandable\.has\(provider\.resolverId\) \|\| \(expansion && expansion\.exhausted\)\) continue;/);
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
    expect(fn).toMatch(/buildRecommendation(?:Page|Views)\(\{[\s\S]*similarUsers: Object\.values\(similarUsersRef\.current\),[\s\S]*exclude: recommendationExclusions\(\)/);
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

  test('the readers call flattenRecommendationItems', () => {
    // the discovery-unread hash on the page…
    const seen = app.slice(app.indexOf("if (activeView === 'recommendations' && recommendations.sections.length > 0) {"));
    expect(seen.slice(0, 300)).toMatch(/generateDiscoveryHash\(flattenRecommendationItems\(recommendations\.sections\), i => i\.name\)/);
    // …and on every merge
    const merge = app.slice(app.indexOf('const refreshMergedRecommendations = () => {'));
    expect(merge.slice(0, merge.indexOf('\n  };'))).toMatch(/generateDiscoveryHash\(flattenRecommendationItems\(sections\), i => i\.name\)/);
    // the song list the scheduler resolves
    const songs = app.slice(app.indexOf('const recommendationSongs = useMemo('));
    expect(songs.slice(0, 400)).toContain('flattenRecommendationItems(recommendations.sections)');
    // (Home's For You preview was the fifth; the redesigned Home reads the
    // album items per row in its recommendationAlbums memo, for the row's
    // source names.)
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
    // The weekly fields are filled from the merged page's weekly items,
    // before the history-mix exclusion (buildRecommendationViews).
    const i = app.indexOf('const refreshMergedRecommendations = () => {');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    expect(fn).toMatch(/const weekly = weeklyHomeEntries\(weeklySections, prev\);/);
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

  test('sections render in the model order, Friends last, each one row under a heading at Home\'s section size with no count', () => {
    expect(view).toMatch(/const contentSections = sections\.filter\(s => s\.type !== 'friend'\);/);
    expect(view).toMatch(/const friendsSection = sections\.find\(s => s\.type === 'friend'\) \|\| null;/);
    const typeSection = between('const renderTypeSection = (section) =>', '// ── The page');
    expect(typeSection).toMatch(/visibleRows\.map\(sub => renderSubsection\(sub, \{ cardRows \}\)\)/);
    const header = between('const subsectionHeader = (sub, ', 'const renderSubsection = (sub, { cardRows = CARD_ROWS } = {}) => {');
    // The app's section title (Home's), not a page-local heading.
    expect(header).toMatch(/React\.createElement\(SectionHeader, \{\s*title: sub\.title,/);
    // No provider row titles or per-row source tags any more.
    expect(view).not.toContain('const sourceTags = ');
    expect(header).not.toMatch(/React\.createElement\('h3'/);
    // No item counts beside titles (the old header printed items.length).
    expect(view).not.toMatch(/`\$\{section\.items\.length\}`|`\$\{sub\.items\.length\}`/);
  });

  test('category rows are subsections under one "Playlists" SectionHeader', () => {
    const typeSection = between('const renderTypeSection = (section) =>', '// ── The page');
    expect(typeSection).toMatch(/if \(visibleRows\.some\(sub => sub\.category\)\) \{[\s\S]*?React\.createElement\(SectionHeader, \{ title: section\.title, style: SECTION_HEADER_GAP \}\)/);
    const header = between('const subsectionHeader = (sub, ', "// ── One section's row");
    expect(header).toContain("size: sub.category ? 'sub' : 'section',");
  });

  test('"See all" / "Show less" is the section header\'s in-place link, labelled "See all"', () => {
    const header = between('const subsectionHeader = (sub, ', "// ── One section's row");
    // SectionHeader's link style (Home's); no page-local link classes.
    expect(header).toMatch(/action: showToggle \? \{/);
    expect(header).not.toMatch(/text-purple-600/);
    // It opens the row in place, so it is not "See all in Recommendations".
    expect(header).toMatch(/label: expanded \? 'Show less' : 'See all'/);
    expect(header).toMatch(/onClick: \(\) => toggleRecommendationSection\(sub\.key\)/);
    // Only for a row with more than its preview, or more to load.
    const row = between('const renderSubsection = (sub, { cardRows = CARD_ROWS } = {}) => {', '// ── Types');
    expect(row).toMatch(/const showToggle = expanded \|\| canExpand \|\| sub\.canLoadMore;/);
  });

  test('no Shuffleupagus Refresh on the page (Home keeps its own)', () => {
    expect(view).not.toContain('fetchAiRecommendations');
    // A whole word: the error state's Try Again passes { forceRefresh: true }.
    expect(view).not.toMatch(/\bRefresh\b/);
    expect(view).not.toContain('Thinking…');
  });

  test('the filter bar sits under the hero, as on the other tabs: All plus one chip per source, no counts, each in its own colour', () => {
    const bar = between('// Filter bar (outside scrollable area), as on the other tabs', '// Scrollable content area: the grouped page');
    expect(bar.length).toBeGreaterThan(0);
    // After the hero, before the scroll area, so it stays put while the page scrolls.
    expect(view.indexOf("'RECOMMENDATIONS'")).toBeLessThan(view.indexOf('// Filter bar (outside scrollable area)'));
    expect(bar).toContain('const sources = pageSources(recommendations.sections);');
    // The app's filter chips (Home's), All neutral, then one per source with
    // its name and no count.
    expect(bar).toContain("const chips = [{ id: 'all', label: 'All' }, ...sources.map(src => ({ id: src.id, label: src.name, color: colorFor(src.id) }))];");
    expect(bar).not.toMatch(/\$\{(name|src\.name)\} \(/);
    expect(bar).toContain("React.createElement(FilterChips, { chips, value: active, onChange: setRecommendationSourceFilter, label: 'Filter recommendations by source' })");
    // A source's colour is Home's (the plugins' manifest colours), Shuffleupagus
    // the fixed accent, a source with none the grey.
    expect(bar).toContain("const colorFor = (id) => (id === 'shuffleupagus' ? '#7c3aed' : (homeSourceColors && homeSourceColors[id]) || 'var(--text-secondary)');");
    // Fresh Drops' bar, verbatim; no page-local pill classes.
    expect(bar).toContain("className: 'flex items-center px-6 py-3'");
    expect(bar).toContain("style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }");
    expect(bar).not.toMatch(/rounded-full|bg-gray-100/);
    // Never a service by name.
    expect(bar).not.toMatch(/'lastfm'|'listenbrainz'|'amazonmusic'/);
  });

  test('the source pick is session state applied to every section, never persisted', () => {
    expect(app).toContain("const [recommendationSourceFilter, setRecommendationSourceFilter] = useState('all');");
    expect(view).toMatch(/const activeSourceFilter = pageSources\(allSections\)\.some\(src => src\.id === recommendationSourceFilter\) \? recommendationSourceFilter : 'all';/);
    // A section the pick leaves empty is left out.
    expect(view).toMatch(/allSections\.filter\(sec => sec\.subsections\.some\(sub => filterRowBySource\(sub, activeSourceFilter\)\.length > 0\)\)/);
    const row = between('const renderSubsection = (sub, { cardRows = CARD_ROWS } = {}) => {', '// ── Types');
    expect(row).toMatch(/const items = filterRowBySource\(sub, activeSourceFilter\);/);
    for (const line of app.split('\n').filter(l => l.includes('recommendationSourceFilter') || l.includes('RecommendationSourceFilter'))) {
      expect(line).not.toMatch(/store|localStorage/);
    }
    expect(app).not.toMatch(/recommendation_source_filter/);
    expect(app).not.toContain('toggleRecommendationSourceFilter');
  });

  test('weekly cards keep Home\'s mosaic, open as ephemeral playlists and play in their weekly context', () => {
    const card = between('const weeklyCard = (item, index, sub) => {', 'const cardFor = ');
    expect(card).toMatch(/weeklyJamCovers\[item\.weekly\.id\]/);
    expect(card).toMatch(/loadPlaylist\(\{[\s\S]*?listenbrainzId: item\.weekly\.id,[\s\S]*?isEphemeral: true,[\s\S]*?\}\)/);
    const play = view.slice(view.indexOf('const playWeeklyPlaylist = async (item) => {'));
    expect(play.slice(0, 1400)).toMatch(/tracks = await loadWeeklyJamTracks\(item\.weekly\.id\);/);
    expect(play.slice(0, 1400)).toMatch(/playTrackCollection\(tracks, \{ type: item\.weekly\.contextType, name/);
    // Titled with the playlist's full name, its source under it, as on every
    // playlist card (only the newest week is on the page).
    expect(card).toContain("React.createElement('p', { className: 'font-medium text-ink-primary truncate text-sm transition-colors' }, item.weekly.label)");
    expect(card).toContain("React.createElement('p', { className: 'text-xs text-ink-tertiary truncate mt-0.5' }, creator || '')");
    const plain = between('const playlistCard = (item, index, section) => {', '// ── Weekly playlists');
    expect(plain).toContain("React.createElement('p', { className: 'text-xs text-ink-tertiary truncate mt-0.5' }, itemSourceName(item, section) || '')");
    expect(view).toContain("const cardLines = sub.type === 'album' || sub.type === 'playlist' ? 2 : 1;");
    // Routed by the item's field, never by provider name.
    expect(view).toMatch(/item\.weekly \? weeklyCard\(item, index, sub\)/);
    expect(card).not.toMatch(/'listenbrainz'|'ListenBrainz'/);
  });

  test('a friend card opens the profile with a friend-shaped object that is not in friends', () => {
    const card = between('const friendCard = (item, index, row) => {', "// ── One section's row");
    expect(card).toMatch(/navigateToFriend\(\{\s*id: `similar:\$\{item\.service\}:\$\{item\.name\}`,\s*username: item\.name,\s*service: item\.service,\s*displayName: item\.name,\s*avatarUrl: item\.avatarUrl \|\| null\s*\}\)/);
    // The score is a badge over the hexagon; the card names the source and
    // lists up to two lines of the person's recent artists.
    expect(card).toContain("'data-similarity-badge': 'true',");
    // In the service's brand colour (manifest `color`), never a service by name.
    expect(card).toContain('const serviceResolver = (resolverLoaderRef.current?.getAllResolvers?.() || []).find(r => r.id === item.service);');
    expect(card).toContain('backgroundColor: badgeColor,');
    expect(card).not.toMatch(/'lastfm'|'listenbrainz'/);
    expect(card).toContain('title: `${pct}% similar`,');
    expect(card).toContain("}, itemSourceName(item, row) || ''),");
    expect(card).toContain("display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'");
    expect(card).toContain("}, (item.topArtists || []).join(', '))");
    expect(card).not.toContain('% similar` : \'\'');
    // No per-item source badge (sources live in the row's tags).
    expect(card).not.toContain('release-badge');
  });

  test('Home has no weekly section, and no weekly props', () => {
    expect(home).not.toContain('Weekly Exploration');
    expect(home).not.toContain('Weekly Jams');
    expect(home).not.toContain('weeklyJamCovers');
    expect(home).not.toContain('loadWeeklyJamTracks');
  });

  test('the weekly covers effect runs only on Recommendations (Home shows no weekly cards)', () => {
    // Home's meta-only load fills homeData.weekly* too; loading up to 8
    // playlists' tracks and covers there was work for cards nobody sees.
    const i = app.indexOf('const loadWeeklyPlaylistCoversAsync = async () => {');
    expect(i).toBeGreaterThan(-1);
    const effect = app.slice(i, app.indexOf('loadWeeklyPlaylistCoversAsync();', i) + 200);
    expect(app).toMatch(/useEffect\(\(\) => \{\s*if \(activeView !== 'recommendations'\) return;\s*const loadWeeklyPlaylistCoversAsync = async \(\) => \{/);
    expect(effect).toMatch(/\}, \[homeData\.weeklyJams, homeData\.weeklyExploration, activeView\]\);/);
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

  test('the sidebar keeps Recommendations lit on a recommended playlist, Playlists on your own', () => {
    expect(app).toContain("const viewingRecommendedPlaylist = activeView === 'playlist-view' && !!selectedPlaylist?.isEphemeral;");
    expect(app).toContain("const playlistsNavActive = activeView === 'playlists' || (activeView === 'playlist-view' && !viewingRecommendedPlaylist);");
    expect(app).toContain("const recommendationsNavActive = activeView === 'recommendations' || viewingRecommendedPlaylist;");
    expect(app).toContain("backgroundColor: playlistsNavActive ? 'rgba(236, 72, 153, 0.1)' : 'transparent',");
    expect(app).toContain("backgroundColor: recommendationsNavActive ? 'rgba(245, 158, 11, 0.1)' : 'transparent',");
    expect(app).not.toContain("(activeView === 'playlists' || activeView === 'playlist-view') ? '#ec4899'");
  });

  test('the playlist view\'s breadcrumb and Close go back to Recommendations for an ephemeral playlist', () => {
    // Every ephemeral playlist opens from Recommendations (weekly cards,
    // provider playlists, the restore path), so neither back control says or
    // goes Home.
    const view = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/playlist-view-page.js'), 'utf8');
    const backs = view.match(/if \(selectedPlaylist\?\.isEphemeral\) \{\s*navigateTo\('[a-z]+'\);/g) || [];
    expect(backs).toHaveLength(2);
    for (const back of backs) expect(back).toContain("navigateTo('recommendations');");
    expect(view).toContain("selectedPlaylist?.isEphemeral ? 'Recommendations' : 'Playlists'");
    expect(view).not.toContain("'HOME'");
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

describe('playlist category rows on the page', () => {
  test('playlist category rows: per-row preview, hidden empty rows, tail by category', () => {
    // Typed since albums split into category rows too (#1377): `playlist:personal`
    // and `album:personal` are different rows.
    expect(app).toContain("lastPageCategories: [...new Set(result.items.filter(i => i && (i.type === 'playlist' || i.type === 'album')).map(i => `${i.type}:${categoryFor(i.type, i, section.category)}`))]");
    expect(app).toContain('expansion.lastPageCategories.includes(`${sub.type}:${sub.category}`)');
    expect(app).not.toContain('expansion.lastPageCategories.includes(sub.category)');
    expect(app).toContain('rowCount > 1 ? 1 : CARD_ROWS');
    // Under a source filter only a page from that provider can fill a row, so
    // only its in-flight page keeps an otherwise empty row on the page.
    expect(app).toContain('recommendationsLoadingMore[p.pagingKey] && (!filteringOne || p.resolverId === activeSourceFilter)');
    expect(app).toContain('(recommendationsGridColumns.cards || 6) * cardRows');
    expect(app).toMatch(/exhausted: true, lastPageTypes: \[\], lastPageCategories: \[\]/);
  });

  test('playlist category rows have space between them', () => {
    expect(app).toContain("className: 'mb-10', style: { display: 'flex', flexDirection: 'column', gap: '32px' }");
  });
});

describe('album category rows on the page', () => {
  test('album category rows: typed loading tail, Shuffleupagus placeholder in Based on your listening', () => {
    expect(app).toContain("lastPageCategories: [...new Set(result.items.filter(i => i && (i.type === 'playlist' || i.type === 'album')).map(i => `${i.type}:${categoryFor(i.type, i, section.category)}`))]");
    expect(app).toContain('expansion.lastPageCategories.includes(`${sub.type}:${sub.category}`)');
    // The model's typed category helper, imported with the other model helpers.
    expect(app).toMatch(/shuffleupagusSection, FRIEND_SERVICES, categoryFor\s*\} = require\('\.\/lib\/recommendation-model'\)/);
    expect(app).toContain("const LLM_TAIL_ROWS = new Set(['type:album', 'type:artist', 'albums:personal']);");
    expect(app).toContain("'albums:personal-pending'");
    expect(app).toContain("title: 'Based on your listening'");
    // The Albums pending slot only when the page has no album section at all.
    expect(app).toContain("!allSections.some(s => s.type === 'album')");
  });

  test('the placeholder subsection sits after New for you, else first, under All or the Shuffleupagus chip', () => {
    const fn = app.slice(app.indexOf('const renderTypeSection = (section) => {'));
    const body = fn.slice(0, fn.indexOf('// ── The page'));
    expect(body).toMatch(/const llmPersonalPending = section\.type === 'album' && llmLoading\s*&& \(!filteringOne \|\| activeSourceFilter === 'shuffleupagus'\)\s*&& visibleRows\.some\(sub => sub\.category\)\s*&& !visibleRows\.some\(sub => sub\.key === 'albums:personal'\);/);
    expect(body).toContain("const newAt = visibleRows.findIndex(sub => sub.key === 'albums:new');");
    expect(body).toContain('rows.splice(newAt + 1, 0, llmPersonalPendingRow)');
    // The placeholder is a subsection: a 15px subsection header, no link.
    expect(app).toMatch(/React\.createElement\(SectionHeader, \{ title: 'Based on your listening', size: 'sub', style: SECTION_HEADER_GAP \}\)/);
  });
});
