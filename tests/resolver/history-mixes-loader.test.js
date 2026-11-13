/**
 * The history-mixes plugin contract (capabilities.historyMixes, Home
 * redesign spec section 4, "The plugin contract (decided)"): a plugin
 * declares the capability and implements getHistoryMixes(config) ->
 * { mixes: [playlist, ...] }. ResolverLoader lists the plugins that declare
 * and implement it, answers [] for one that doesn't (a marketplace install
 * can lag the app), and rejects when the plugin throws, so the app keeps the
 * cached mixes instead of caching an outage as "no mixes".
 *
 * The app side: both meta-service gates materialize a plugin that has only
 * this capability, the answers are cached per provider in
 * cache_history_mixes (allowlisted), Home shows them in "Made from your
 * listening" and Jump back in, and the Recommendations page leaves out any
 * playlist whose id is a history mix (an older ListenBrainz plugin still
 * returns Weekly and Daily Jams from getRecommendations, for older apps).
 */

const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');
const { buildRecommendationPage, normalizeRecommendationSections } = require('../../src/renderer/lib/recommendation-model');
const { normalizeHistoryMixes, flattenHistoryMixes, jumpBackInTiles } = require('../../src/renderer/lib/home-model');

const ROOT = path.join(__dirname, '..', '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const fake = (id, extra = {}) => ({ id, name: id, capabilities: {}, config: {}, ...extra });
const loaderWith = (resolvers) => {
  const loader = new ResolverLoader();
  for (const r of resolvers) loader.resolvers.set(r.id, r);
  return loader;
};

describe('ResolverLoader history mixes', () => {
  test('getHistoryMixResolvers lists only resolvers that declare and implement it', () => {
    const loader = loaderWith([
      fake('applemusic', { capabilities: { historyMixes: true }, getHistoryMixes: async () => ({ mixes: [] }) }),
      fake('listenbrainz', { capabilities: { historyMixes: true } }),
      fake('youtube', { getHistoryMixes: async () => ({ mixes: [] }) }),
    ]);
    expect(loader.getHistoryMixResolvers().map(r => r.id)).toEqual(['applemusic']);
  });

  test('getHistoryMixes answers [] for a resolver without the capability', async () => {
    const loader = loaderWith([
      fake('youtube'),
      // An older plugin: the flag without the method.
      fake('listenbrainz', { capabilities: { historyMixes: true } }),
      // The method without the flag.
      fake('lastfm', { getHistoryMixes: jest.fn(async () => ({ mixes: [{ id: 'x', name: 'X' }] })) }),
    ]);
    expect(await loader.getHistoryMixes('youtube', {})).toEqual([]);
    expect(await loader.getHistoryMixes('nope', {})).toEqual([]);
    expect(await loader.getHistoryMixes('listenbrainz', {})).toEqual([]);
    expect(await loader.getHistoryMixes('lastfm', {})).toEqual([]);
    expect(loader.getResolver('lastfm').getHistoryMixes).not.toHaveBeenCalled();
  });

  test("getHistoryMixes returns the plugin's mixes and passes the config through", async () => {
    const mixes = [
      { type: 'playlist', id: 'pl.heavy', name: 'Heavy Rotation Mix', description: 'What you play most', imageUrl: 'https://img/1.jpg', url: 'https://music.apple.com/pl.heavy' },
      { type: 'playlist', id: 'pl.replay', name: 'Replay 2026', url: 'https://music.apple.com/pl.replay' },
    ];
    const getHistoryMixes = jest.fn(async () => ({ mixes }));
    const loader = loaderWith([fake('applemusic', { capabilities: { historyMixes: true }, getHistoryMixes })]);
    expect(await loader.getHistoryMixes('applemusic', { token: 't' })).toEqual(mixes);
    expect(getHistoryMixes).toHaveBeenCalledWith({ token: 't' });
    // No override: the resolver's stored config.
    loader.getResolver('applemusic').config = { stored: true };
    await loader.getHistoryMixes('applemusic');
    expect(getHistoryMixes).toHaveBeenLastCalledWith({ stored: true });
  });

  test('a malformed answer is no mixes, and malformed entries are dropped', async () => {
    const r = fake('applemusic', { capabilities: { historyMixes: true } });
    const loader = loaderWith([r]);
    r.getHistoryMixes = async () => null;
    expect(await loader.getHistoryMixes('applemusic', {})).toEqual([]);
    r.getHistoryMixes = async () => [{ id: 'a', name: 'A' }];
    expect(await loader.getHistoryMixes('applemusic', {})).toEqual([]);
    r.getHistoryMixes = async () => ({ mixes: [null, 'x', { id: 'a', name: 'A', url: 'u' }] });
    expect(await loader.getHistoryMixes('applemusic', {})).toEqual([{ id: 'a', name: 'A', url: 'u' }]);
  });

  test('getHistoryMixes rejects when the plugin throws', async () => {
    const loader = loaderWith([fake('listenbrainz', {
      capabilities: { historyMixes: true },
      getHistoryMixes: async () => { throw new Error('503'); },
    })]);
    await expect(loader.getHistoryMixes('listenbrainz', {})).rejects.toThrow('503');
  });
});

describe('history mixes in the Home model', () => {
  test('normalizeHistoryMixes keeps openable playlists and names their provider', () => {
    const out = normalizeHistoryMixes([
      { type: 'playlist', id: ' pl.heavy ', name: ' Heavy Rotation ', description: 'Most played', imageUrl: 'https://img/1.jpg', url: 'https://x/pl.heavy' },
      { id: 'no-url', name: 'No URL' },
      { id: '', name: 'No id', url: 'https://x/1' },
      { id: 'no-name', url: 'https://x/2' },
      { type: 'album', id: 'alb', name: 'Album', url: 'https://x/3' },
      null,
    ], { id: 'applemusic', name: 'Apple Music' });
    expect(out).toEqual([{
      type: 'playlist', id: 'pl.heavy', name: 'Heavy Rotation', title: 'Heavy Rotation',
      description: 'Most played', imageUrl: 'https://img/1.jpg', url: 'https://x/pl.heavy',
      resolverId: 'applemusic', resolverName: 'Apple Music',
    }]);
    expect(normalizeHistoryMixes(null, { id: 'x' })).toEqual([]);
    // A provider with no name is named by its id.
    expect(normalizeHistoryMixes([{ id: 'a', name: 'A', url: 'u' }], { id: 'x' })[0].resolverName).toBe('x');
  });

  test('flattenHistoryMixes interleaves the providers in order and keeps an id once', () => {
    const am = { resolverId: 'applemusic', items: [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }] };
    const lb = { resolverId: 'listenbrainz', items: [{ id: 'l1' }, { id: 'a2' }] };
    expect(flattenHistoryMixes([am, lb]).map(m => m.id)).toEqual(['a1', 'l1', 'a2', 'a3']);
    expect(flattenHistoryMixes([])).toEqual([]);
    expect(flattenHistoryMixes(null)).toEqual([]);
    expect(flattenHistoryMixes([{ resolverId: 'x' }])).toEqual([]);
  });

  test('Jump back in takes the first mix', () => {
    const mixes = flattenHistoryMixes([{ resolverId: 'applemusic', items: normalizeHistoryMixes([
      { id: 'pl.heavy', name: 'Heavy Rotation', url: 'https://x' },
    ], { id: 'applemusic', name: 'Apple Music' }) }]);
    const tiles = jumpBackInTiles({ playlists: [], loves: [], mixes, active: {} });
    expect(tiles).toEqual([expect.objectContaining({ kind: 'mix', item: expect.objectContaining({ id: 'pl.heavy', title: 'Heavy Rotation' }) })]);
  });
});

describe('Recommendations leaves the history mixes out', () => {
  const norm = (resolverId, items) => ({
    ...normalizeRecommendationSections({ sections: [{ items }] }, { resolverId, resolverName: resolverId }),
  });

  test('a playlist whose id is a history mix is dropped; other types and playlists stay', () => {
    const providers = [norm('listenbrainz', [
      { type: 'playlist', id: 'jams', name: 'Weekly Jams', url: 'u1' },
      { type: 'playlist', id: 'explore', name: 'Weekly Exploration', url: 'u2' },
      { type: 'album', id: 'jams', name: 'An album that shares the id', artist: 'A' },
    ])];
    const page = buildRecommendationPage({ providers, excludePlaylistIds: new Set(['jams']) });
    const items = (type) => page.filter(s => s.type === type).flatMap(s => s.subsections).flatMap(r => r.items).map(i => i.name);
    expect(items('playlist')).toEqual(['Weekly Exploration']);
    expect(items('album')).toEqual(['An album that shares the id']);
    // Every playlist a history mix: the section goes.
    const none = buildRecommendationPage({ providers, excludePlaylistIds: new Set(['jams', 'explore']) });
    expect(none.some(s => s.type === 'playlist')).toBe(false);
    // No exclusion given: unchanged.
    expect(buildRecommendationPage({ providers }).find(s => s.type === 'playlist').subsections[0].items).toHaveLength(2);
  });

  test("dropping this week's Jams does not bring last week's back", () => {
    const providers = [norm('listenbrainz', [
      { type: 'playlist', id: 'jams-now', name: 'Weekly Jams, this week', url: 'u1', weekly: { id: 'jams-now', contextType: 'weekly-jam', label: 'Weekly Jams', weekLabel: 'This week', date: '2026-11-09' } },
      { type: 'playlist', id: 'jams-last', name: 'Weekly Jams, last week', url: 'u2', weekly: { id: 'jams-last', contextType: 'weekly-jam', label: 'Weekly Jams', weekLabel: 'Last week', date: '2026-11-02' } },
      { type: 'playlist', id: 'explore', name: 'Weekly Exploration', url: 'u3', weekly: { id: 'explore', contextType: 'weekly-exploration', label: 'Weekly Exploration', weekLabel: 'This week', date: '2026-11-09' } },
    ])];
    const page = buildRecommendationPage({ providers, excludePlaylistIds: new Set(['jams-now']) });
    expect(page.find(s => s.type === 'playlist').subsections[0].items.map(i => i.id)).toEqual(['explore']);
  });
});

describe('wiring', () => {
  const app = read('src', 'renderer', 'app.js');
  const page = read('src', 'renderer', 'components', 'home-page.js');

  test('both meta-service gates load a plugin that only has history mixes', () => {
    const first = app.slice(app.indexOf('const metaServicesWithRecommendations = metaServiceAxes.filter('));
    expect(first.slice(0, first.indexOf(');'))).toContain('(axe.capabilities?.historyMixes && axe.implementation?.getHistoryMixes)');
    const second = app.slice(app.indexOf('const withRecommendations = filteredAxes.filter('));
    expect(second.slice(0, second.indexOf(');'))).toContain('(axe.capabilities?.historyMixes && axe.implementation?.getHistoryMixes)');
  });

  test('cache_history_mixes is allowlisted and saved', () => {
    expect(read('main-process', 'ipc', 'store.js')).toContain("'cache_history_mixes'");
    expect(app).toContain("window.electron.store.set('cache_history_mixes', { providers, savedAt: now });");
  });

  test('loadHistoryMixes asks the registry per provider, under the recommendations bounds', () => {
    const load = app.slice(app.indexOf('const loadHistoryMixes = async (opts = {}) => {'));
    expect(load.length).toBeLessThan(app.length);
    const body = load.slice(0, load.indexOf('\n  };\n'));
    expect(body).toContain('loader.getHistoryMixes(provider.id, config)');
    expect(body).toContain('CACHE_TTL.recommendations');
    expect(body).toContain('CACHE_TTL.recommendationProvider');
    expect(body).toMatch(/const generation = \+\+historyMixesLoadGenRef\.current;/);
    // Providers come from the registry, ordered like the recommendation providers.
    const providers = app.slice(app.indexOf('const historyMixProviders = () => {'));
    const providersBody = providers.slice(0, providers.indexOf('\n  };\n'));
    expect(providersBody).toContain('loader.getHistoryMixResolvers()');
    expect(providersBody).toContain('orderCatalogResolvers(');
  });

  test('historyMixIds is a memoized Set the Recommendations merge excludes', () => {
    expect(app).toMatch(/const historyMixIds = useMemo\(\(\) => new Set\(/);
    const merge = app.slice(app.indexOf('const refreshMergedRecommendations = () => {'));
    expect(merge.slice(0, merge.indexOf('\n  };\n'))).toContain('excludePlaylistIds: historyMixIdsRef.current');
  });

  test("Home's mixes are the flattened history mixes, with their mosaics", () => {
    expect(app).toContain('() => withMixMosaics(flattenHistoryMixes(historyMixEntries), homeMixCovers),');
    expect(app).toContain('[historyMixEntries, homeMixCovers]');
  });

  test("a mix with no cover gets its mosaic through Play's lookup, on Home only", () => {
    const effect = app.slice(app.indexOf('const todo = mixesNeedingMosaic('), app.indexOf('}, [activeView, homeMixes, homeMixCoverRetry]);'));
    expect(app).toContain("if (activeView !== 'home') return;\n    const todo = mixesNeedingMosaic(homeMixes, homeMixCoversTried.current);");
    expect(effect).toContain('await lookupRecommendationPlaylist(mix)');
    expect(effect).toContain('await getPlaylistCovers(mix.id, tracks)');
    expect(effect).toContain('homeMixCoversTried.current.add(mix.id)');
  });

  test('a failed mosaic lookup is retried, a capped number of times', () => {
    const effect = app.slice(app.indexOf('const todo = mixesNeedingMosaic('), app.indexOf('}, [activeView, homeMixes, homeMixCoverRetry]);'));
    expect(effect).toContain('if (attempts < HOME_MIX_COVER_ATTEMPTS) {');
    expect(effect).toContain('homeMixCoversTried.current.delete(mix.id);');
    expect(effect).toContain('}, HOME_MIX_COVER_RETRY_MS);');
    const m = require('../../src/renderer/lib/home-model');
    expect(m.HOME_MIX_COVER_ATTEMPTS).toBe(3);
    expect(m.HOME_MIX_COVER_RETRY_MS).toBe(60000);
  });

  test("Home's background effect loads the mixes, and a mix plays and queues its tracks", () => {
    const effect = page.slice(page.indexOf('const run = () => {'), page.indexOf('const idle = globalThis.requestIdleCallback;'));
    expect(effect).toContain('loadHomeHistoryMixes();');
    expect(page).toMatch(/onPlay: \(m\) => playServicePlaylist\(m, mixContext\(m\)\)/);
    expect(page).toMatch(/onQueue: \(m\) => queueServicePlaylist\(m, mixContext\(m\)\)/);
    expect(page).toMatch(/else if \(tile\.kind === 'mix'\) playServicePlaylist\(tile\.item, mixContext\(tile\.item\)\);/);
    const { HOME_PAGE_HANDLERS } = (() => { global.React = global.React || require('react'); return require('../../src/renderer/components/home-page'); })();
    for (const h of ['loadHomeHistoryMixes', 'playServicePlaylist', 'queueServicePlaylist']) {
      expect(HOME_PAGE_HANDLERS).toContain(h);
    }
    // The play path is the one the Recommendations cards use.
    const play = app.slice(app.indexOf('const playServicePlaylist = async (item, context) => {'));
    expect(play.slice(0, 500)).toContain('await recommendationPlaylistTracks(item)');
    const queue = app.slice(app.indexOf('const queueServicePlaylist = async (item, context) => {'));
    expect(queue.slice(0, 500)).toContain('await recommendationPlaylistTracks(item)');
  });
});

describe('fix round 1', () => {
  const { historyMixCacheEntry, historyMixEntriesFor, sameHistoryMixEntries } = require('../../src/renderer/lib/home-model');
  const { buildRecommendationViews, weeklyHomeEntries } = require('../../src/renderer/lib/recommendation-model');
  const app = read('src', 'renderer', 'app.js');

  test('the weekly mirror keeps Jams the history exclusion takes off the page', () => {
    const providers = [normalizeRecommendationSections({ sections: [{ title: 'Weekly Jams', id: 'weekly-jams', items: [
      { type: 'playlist', id: 'jams-now', name: 'Weekly Jams', url: 'u1', weekly: { id: 'jams-now', contextType: 'weekly-jam', label: 'Weekly Jams', weekLabel: 'This week', date: '2026-11-09' } },
      { type: 'playlist', id: 'explore', name: 'Weekly Exploration', url: 'u2', weekly: { id: 'explore', contextType: 'weekly-exploration', label: 'Weekly Exploration', weekLabel: 'This week', date: '2026-11-09' } },
    ] }] }, { resolverId: 'listenbrainz', resolverName: 'ListenBrainz' })];
    const views = buildRecommendationViews({ providers, excludePlaylistIds: new Set(['jams-now']) });
    // The page leaves the Jams out...
    const pagePlaylists = views.sections.find(s => s.type === 'playlist').subsections[0].items.map(i => i.id);
    expect(pagePlaylists).toEqual(['explore']);
    // ...and the weekly mirror (the restored view, Go to source) still has them.
    const weekly = weeklyHomeEntries(views.weeklySections, {});
    expect(weekly.weeklyJams.map(j => j.id)).toEqual(['jams-now']);
    expect(weekly.weeklyExploration.map(j => j.id)).toEqual(['explore']);
    // No exclusion: one build, the same sections.
    const plain = buildRecommendationViews({ providers });
    expect(plain.weeklySections).toBe(plain.sections);
    // The app mirrors from weeklySections.
    const merge = app.slice(app.indexOf('const refreshMergedRecommendations = () => {'));
    const body = merge.slice(0, merge.indexOf('\n  };\n'));
    expect(body).toContain('buildRecommendationViews({');
    expect(body).toMatch(/const weekly = weeklyHomeEntries\(weeklySections, prev\);/);
  });

  test('sameHistoryMixEntries: same providers and item references is no change', () => {
    const a1 = { id: 'a1' };
    const a = [{ resolverId: 'applemusic', resolverName: 'Apple Music', items: [a1] }];
    expect(sameHistoryMixEntries(a, [{ resolverId: 'applemusic', resolverName: 'Apple Music', items: [a1] }])).toBe(true);
    // A refetch builds new item objects (a new cover, a new line): a change.
    expect(sameHistoryMixEntries(a, [{ resolverId: 'applemusic', resolverName: 'Apple Music', items: [{ id: 'a1' }] }])).toBe(false);
    expect(sameHistoryMixEntries(a, [])).toBe(false);
    expect(sameHistoryMixEntries([], [])).toBe(true);
    expect(sameHistoryMixEntries(a, [{ resolverId: 'listenbrainz', resolverName: 'Apple Music', items: [a1] }])).toBe(false);
    // apply() keeps the previous array when nothing changed.
    expect(app).toMatch(/setHistoryMixEntries\(prev => \(sameHistoryMixEntries\(prev, entries\) \? prev : entries\)\);/);
  });

  test('a cached entry counts only for the same account; entries follow provider priority', () => {
    const entry = { items: [{ id: 'x' }], account: 'me', fetchedAt: 1 };
    expect(historyMixCacheEntry(entry, 'me')).toBe(entry);
    expect(historyMixCacheEntry(entry, 'someone-else')).toBeNull();
    expect(historyMixCacheEntry({ items: [], fetchedAt: 1 }, '')).toEqual({ items: [], fetchedAt: 1 });
    expect(historyMixCacheEntry({ items: 'x' }, '')).toBeNull();
    expect(historyMixCacheEntry(null, '')).toBeNull();

    const byId = {
      listenbrainz: { items: [{ id: 'l1' }] },
      applemusic: { items: [{ id: 'a1' }] },
      amazonmusic: { items: [] },
    };
    const providers = [{ id: 'applemusic', name: 'Apple Music' }, { id: 'amazonmusic', name: 'Amazon Music' }, { id: 'listenbrainz' }];
    expect(historyMixEntriesFor(providers, (p) => byId[p.id])).toEqual([
      { resolverId: 'applemusic', resolverName: 'Apple Music', items: [{ id: 'a1' }] },
      { resolverId: 'listenbrainz', resolverName: 'listenbrainz', items: [{ id: 'l1' }] },
    ]);
  });

  test('cache_history_mixes arrives with the big caches, and the load waits for them', () => {
    const big = app.slice(app.indexOf('const BIG_CACHE_KEYS = ['), app.indexOf('];', app.indexOf('const BIG_CACHE_KEYS = [')));
    expect(big).toContain("'cache_history_mixes'");
    const critical = app.slice(app.indexOf('const criticalKeys = ['), app.indexOf('];', app.indexOf('const criticalKeys = [')));
    expect(critical).not.toContain("'cache_history_mixes'");
    expect(app).toContain("const historyMixesData = dCaches['cache_history_mixes'];");
    // Hydration fills the cache only; the first load orders it by provider
    // priority and checks the account (apply), so nothing is shown twice.
    const hydrate = app.slice(app.indexOf("const historyMixesData = dCaches['cache_history_mixes'];"));
    expect(hydrate.slice(0, hydrate.indexOf('\n\n'))).not.toContain('setHistoryMixEntries');
    const load = app.slice(app.indexOf('const loadHistoryMixes = async (opts = {}) => {'));
    const body = load.slice(0, load.indexOf('\n  };\n'));
    expect(body.indexOf('await waitForBigCaches();')).toBeGreaterThan(-1);
    expect(body.indexOf('await waitForBigCaches();')).toBeLessThan(body.indexOf('historyMixesCache.current.providers[provider.id]'));
    expect(body).toContain('historyMixCacheEntry(historyMixesCache.current.providers[provider.id], historyMixAccountFor(provider))');
    expect(body).toContain('historyMixEntriesFor(providers,');
  });

  test('the init wait clears its timer', () => {
    const load = app.slice(app.indexOf('const loadHistoryMixes = async (opts = {}) => {'));
    const body = load.slice(0, load.indexOf('\n  };\n'));
    expect(body).toMatch(/let initTimer = null;[\s\S]{0,400}initTimer = setTimeout\(resolve, 15000\)[\s\S]{0,200}clearTimeout\(initTimer\);/);
  });

  test('a loader still null after the init wait clears the key so the provider effect reloads', () => {
    const load = app.slice(app.indexOf('const loadHistoryMixes = async (opts = {}) => {'));
    const body = load.slice(0, load.indexOf('\n  };\n'));
    expect(body).toMatch(/if \(!loader\) \{[\s\S]{0,250}historyMixProviderKeyRef\.current = '';\s*return;/);
  });

  test('provider playlist tracks carry their mbid', () => {
    const resolve = app.slice(app.indexOf('const resolveProviderPlaylistUrl = async'));
    expect(resolve.slice(0, 4000)).toContain('if (t.mbid) out.mbid = t.mbid;');
    const rec = app.slice(app.indexOf('const recommendationPlaylistTracks = async'));
    expect(rec.slice(0, 2000)).toContain('...(t.mbid ? { mbid: t.mbid } : {})');
  });

  test('an opened history mix restores to Home, not Recommendations or Playlists', () => {
    expect(app).toContain('viewData.isHistoryMix = Object.values(mixProviders).some(');
    expect(app).toMatch(/pendingPlaylistLoad\.isHistoryMix\) \{[\s\S]{0,300}navigateTo\('home'\)/);
  });

  test('a mix has no right-click menu, on the card or the Jump tile', () => {
    const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/home-page.js'), 'utf8');
    const mixActions = page.slice(page.indexOf('const mixActions = {'), page.indexOf('};', page.indexOf('const mixActions = {')));
    expect(mixActions).not.toMatch(/onContextMenu:/);
    expect(page).toContain("else if (tile.kind !== 'mix') showHomeContextMenu('playlist', tile.item);");
  });
});
