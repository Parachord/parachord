// Pop of the Tops' charts from the plug-ins (#1539 step 3): which plug-ins,
// in what order, which regions, the page's items, and the wiring in app.js.

const fs = require('fs');
const path = require('path');
const { chartKind, chartProviders, regionOptions, pickRegion, chartItems, chartCacheKey } = require('../../src/renderer/lib/charts');
const { CHARTS_COUNTRIES } = require('../../src/renderer/lib/charts-countries');
const ResolverLoader = require('../../resolver-loader');

const apple = { id: 'applemusic', charts: { tracks: { global: false, countries: ['us', 'gb'] }, albums: { global: false, countries: ['us', 'gb'] } } };
const lastfm = { id: 'lastfm', charts: { tracks: { global: true, countries: ['us', 'kr'] } } };
const lb = { id: 'listenbrainz', charts: { period: 'this week', tracks: { global: true, countries: [] }, albums: { global: true, countries: [] } } };
const loaderOf = (list) => ({ getChartResolvers: () => list });

describe('chartProviders', () => {
  test('every installed plug-in that charts the kind, active first, in the user\'s order', () => {
    const loader = loaderOf([lastfm, lb, apple]);
    // Apple Music isn't turned on, and still charts.
    expect(chartProviders(loader, 'tracks', { activeIds: [], order: ['applemusic'] }).map((r) => r.id)).toEqual(['applemusic', 'lastfm', 'listenbrainz']);
    expect(chartProviders(loader, 'albums', { activeIds: [], order: [] }).map((r) => r.id)).toEqual(['listenbrainz', 'applemusic']);
  });

  test('a plug-in switched off is left out', () => {
    expect(chartProviders(loaderOf([lastfm, lb]), 'tracks', { isOff: (id) => id === 'lastfm' }).map((r) => r.id)).toEqual(['listenbrainz']);
    expect(chartProviders(null, 'tracks')).toEqual([]);
  });

  test('tabs map to kinds', () => {
    expect(chartKind('songs')).toBe('tracks');
    expect(chartKind('albums')).toBe('albums');
  });
});

describe('regions', () => {
  test('Global first when the source has it, then its countries in the app\'s order', () => {
    expect(regionOptions(lastfm, 'tracks', CHARTS_COUNTRIES)).toEqual([
      { value: '', label: 'Global' }, { value: 'us', label: 'United States' }, { value: 'kr', label: 'South Korea' },
    ]);
    expect(regionOptions(apple, 'albums', CHARTS_COUNTRIES).map((o) => o.value)).toEqual(['us', 'gb']);
    expect(regionOptions(lb, 'tracks', CHARTS_COUNTRIES)).toEqual([{ value: '', label: 'Global' }]);
    expect(regionOptions(lastfm, 'albums', CHARTS_COUNTRIES)).toEqual([]);
  });

  test('the wanted region when offered, else Global, else the US, else the first country', () => {
    expect(pickRegion(lastfm, 'tracks', 'kr')).toBe('kr');
    expect(pickRegion(lastfm, 'tracks', 'gb')).toBe('');
    expect(pickRegion(apple, 'tracks', '')).toBe('us');
    expect(pickRegion(apple, 'tracks', 'gb')).toBe('gb');
    expect(pickRegion(apple, 'tracks', null)).toBe('us');
    expect(pickRegion({ charts: { tracks: { global: false, countries: ['jp'] } } }, 'tracks', null)).toBe('jp');
    expect(pickRegion(lastfm, 'albums', null)).toBeNull();
  });
});

describe('chartItems', () => {
  test('ranked items with ids unique per chart; an album\'s MBID opens its release group', () => {
    const albums = chartItems('albums', 'listenbrainz', '', [{ title: 'Monsters', artist: 'All Time Low', mbid: 'rg1', listens: 3 }]);
    expect(albums[0]).toMatchObject({ id: 'chart-listenbrainz-global-0-all-time-low-monsters', rank: 1, releaseGroupId: 'rg1', listens: 3, source: 'listenbrainz' });
    const tracks = chartItems('tracks', 'applemusic', 'gb', [{ title: 'A', artist: 'B', albumArt: 'x' }, { title: 'A', artist: 'B' }]);
    expect(tracks.map((t) => t.id)).toEqual(['chart-applemusic-gb-0-b-a', 'chart-applemusic-gb-1-b-a']);
    expect(tracks[0]).toMatchObject({ album: '', albumArt: 'x', mbid: null, rank: 1 });
    expect(chartCacheKey('tracks', 'lastfm', '')).toBe('tracks:lastfm:global');
  });
});

describe('resolver-loader', () => {
  const loader = new ResolverLoader();
  beforeEach(() => loader.resolvers.clear());

  test('chartsInfo keeps only well-formed kinds and codes', () => {
    expect(ResolverLoader.chartsInfo({ tracks: { global: true, countries: ['US', 'xxx', 'gb', 'gb'] }, albums: {}, period: ' this week ' }))
      .toEqual({ tracks: { global: true, countries: ['us', 'gb'] }, period: 'this week' });
    expect(ResolverLoader.chartsInfo({ albums: { countries: [] } })).toBeNull();
    expect(ResolverLoader.chartsInfo(null)).toBeNull();
  });

  test('lists plug-ins by capability, chart info and method; null for a kind it doesn\'t chart; rejects on a throw', async () => {
    const register = (id, impl, charts = lb.charts) => loader.resolvers.set(id, { id, capabilities: { charts: true }, charts, config: {}, ...impl });
    register('a', { getCharts: async (q) => (q.kind === 'tracks' ? [{ title: 'A', artist: 'B' }, { title: ' ', artist: 'B' }] : null) });
    register('b', {});
    register('c', { getCharts: async () => { throw new Error('down'); } });
    register('d', { getCharts: async () => [] }, null);
    expect(loader.getChartResolvers().map((r) => r.id)).toEqual(['a', 'c']);
    await expect(loader.getCharts('a', { kind: 'tracks' })).resolves.toEqual([{ title: 'A', artist: 'B' }]);
    await expect(loader.getCharts('a', { kind: 'albums' })).resolves.toBeNull();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(loader.getCharts('c', { kind: 'tracks' })).rejects.toThrow('down');
    spy.mockRestore();
    await expect(loader.getCharts('nope', { kind: 'tracks' })).resolves.toBeNull();
  });
});

describe('app.js asks the plug-ins', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/charts-page.js'), 'utf8');

  test('no chart is fetched by service name', () => {
    expect(app).not.toMatch(/rss\.marketingtools\.apple\.com|chart\.gettoptracks|geo\.gettoptracks|stats\/sitewide/);
    expect(app).not.toMatch(/loadLastfmCharts|loadAppleMusicSongsCharts|parseChartsJSON|lastfmCharts\b|appleMusicSongsCharts/);
    expect(page).not.toMatch(/'apple'|'lastfm'|'listenbrainz'/);
    expect(fs.existsSync(path.join(__dirname, '../../src/charts-utils.js'))).toBe(false);
  });

  test('both meta-service load gates include charts', () => {
    expect(app.match(/axe\.capabilities\?\.charts && axe\.implementation\?\.getCharts/g)).toHaveLength(2);
  });

  test('an automatic pick tries each source in turn; a picked one is the only one asked', () => {
    const fn = app.slice(app.indexOf('const loadChartFor = async'), app.indexOf('const pickChart = '));
    expect(fn).toContain('const queue = picked ? [picked] : providers;');
    expect(fn).toMatch(/for \(const provider of queue\)/);
    expect(fn).toContain('resolverLoaderRef.current.getCharts(provider.id,');
    expect(fn).not.toMatch(/showConfirmDialog/);
  });

  test('the menus are built from the plug-ins, any installed one, minus one switched off', () => {
    expect(app).toMatch(/const chartSources = useMemo\(\(\) => \{/);
    expect(app).toContain('chartProviders(resolverLoaderRef.current, chartKind(tab), { activeIds: activeResolvers, order: resolverOrder, isOff })');
    expect(page).toContain("onChange: (v) => pickChart(chartsTab, { source: v }),");
    expect(page).toContain("onChange: (v) => pickChart(chartsTab, { region: v }),");
  });
});
