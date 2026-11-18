/**
 * #1493: the welcome tour explains Parachord; Home's getting-started layout
 * does the setup (three steps, step 1's tiles from the plug-in registry).
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const GS = require('../../src/renderer/lib/getting-started');
const { GettingStarted, GettingStartedSkeleton } = require('../../src/renderer/components/home-getting-started');
const { FirstRunTutorial, TOUR_SCREENS } = require('../../src/renderer/components/first-run-tutorial');
const { HomePage, HOME_PAGE_HANDLERS } = require('../../src/renderer/components/home-page');

const root = path.join(__dirname, '../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const app = read('src/renderer/app.js');

// The shipped manifests, flattened the way resolver-loader.js does.
const plugin = (id) => {
  const m = JSON.parse(read(`plugins-src/${id}/manifest.json`));
  return {
    id, name: m.manifest.name, color: m.manifest.color, capabilities: m.capabilities,
    requiresAuth: (m.settings && m.settings.requiresAuth) || false,
    authType: (m.settings && m.settings.authType) || 'none',
  };
};
const registry = ['spotify', 'applemusic', 'amazonmusic', 'soundcloud', 'subsonic', 'bandcamp', 'localfiles', 'youtube'].map(plugin);

describe('step 1 comes from the registry', () => {
  const p = GS.stepOnePlugins(registry);
  test('services that play here and need an account; never YouTube', () => {
    expect(p.services.map((r) => r.id)).toEqual(['spotify', 'applemusic', 'amazonmusic', 'soundcloud', 'subsonic']);
    expect(p.free.map((r) => r.id)).toEqual(['bandcamp']);
    expect(p.folder.id).toBe('localfiles');
    expect([...p.services, ...p.free].some((r) => r.id === 'youtube')).toBe(false);
  });

  test('a new service plug-in appears without a code change', () => {
    const fresh = { id: 'newservice', name: 'New', capabilities: { resolve: true, stream: true }, requiresAuth: true };
    expect(GS.stepOnePlugins([...registry, fresh]).services.map((r) => r.id)).toContain('newservice');
  });

  test('a plug-in with empty settings needs setup; once one is saved it can count as connected', () => {
    const subsonic = { ...registry[4], configurable: JSON.parse(read('plugins-src/subsonic/manifest.json')).settings.configurable };
    expect(GS.settingsMissing(subsonic, undefined)).toBe(true);
    expect(GS.settingsMissing(subsonic, { serverUrl: '  ' })).toBe(true);
    expect(GS.settingsMissing(subsonic, { serverUrl: 'http://nas:4533' })).toBe(false);
    expect(GS.settingsMissing(registry[5], undefined)).toBe(false); // Bandcamp: nothing to fill in
    // Fields with defaults are filled already: Apple Music's never reads as unset.
    const apple = { ...registry[1], configurable: JSON.parse(read('plugins-src/applemusic/manifest.json')).settings.configurable };
    expect(GS.settingsMissing(apple, undefined)).toBe(false);
    // Every shipped service plug-in: only Subsonic (a server to fill in) and Spotify (a required Client ID) need setup on a new profile.
    const shipped = GS.stepOnePlugins(registry).services.map((r) => ({ ...r, configurable: JSON.parse(read(`plugins-src/${r.id}/manifest.json`)).settings.configurable }));
    expect(shipped.filter((r) => GS.settingsMissing(r, undefined) || GS.requiredSetting(r)).map((r) => r.id).sort()).toEqual(['spotify', 'subsonic']);
    // Switched on but not set up: Set up, never Connected.
    expect(GS.serviceState(subsonic, { setupNeeded: { subsonic: true }, playbackResolvers: ['subsonic'] })).toEqual({ state: 'setup', label: 'Set up' });
    expect(GS.setupMissing(subsonic, undefined)).toBe(true); // no isConfigured: its settings decide
  });

  test('Plex (#1056) lands in step 1 and reads Set up until it says it is configured', () => {
    // Plex's manifest shape and its isConfigured (signed in, with a library picked).
    const plex = {
      id: 'plex', name: 'Plex', color: '#E5A00D',
      capabilities: { resolve: true, search: true, stream: true, urlLookup: true, html5Stream: true },
      requiresAuth: true, authType: 'custom', configurable: {},
      isConfigured: (c) => !!(c && c.authToken && c.libraries && c.libraries.length),
    };
    expect(GS.stepOnePlugins([...registry, plex]).services.map((r) => r.id)).toContain('plex');
    expect(GS.setupMissing(plex, {})).toBe(true);
    expect(GS.setupMissing(plex, { authToken: 't' })).toBe(true);
    expect(GS.setupMissing(plex, { authToken: 't', libraries: ['1'] })).toBe(false);
    // On but not signed in: Set up, never Connected.
    expect(GS.serviceState(plex, { setupNeeded: { plex: GS.setupMissing(plex, {}) }, playbackResolvers: ['plex'] }).state).toBe('setup');
    expect(GS.serviceState(plex, { setupNeeded: { plex: false }, playbackResolvers: ['plex'] }).state).toBe('connected');
    expect(app).toContain('out[r.id] = GettingStartedModel.setupMissing(r, metaServiceConfigs?.[r.id]);');
  });

  test('a required setting not saved yet makes the tile "Add your <field>", named by the manifest', () => {
    const spotify = registry[0];
    // The test registry flattens settings like the loader; Spotify's Client ID is required.
    const withFields = { ...spotify, configurable: JSON.parse(read('plugins-src/spotify/manifest.json')).settings.configurable };
    expect(GS.requiredSetting(withFields)).toEqual({ key: 'clientId', label: 'Client ID' });
    expect(GS.serviceState(withFields, { accounts: { spotify: false }, setupNeeded: { spotify: true } })).toEqual({ state: 'setup', label: 'Add your Client ID' });
    // Once signed in, setup no longer matters.
    expect(GS.serviceState(withFields, { accounts: { spotify: true }, setupNeeded: { spotify: true }, playbackResolvers: ['spotify'] }).state).toBe('connected');
    const fn = app.slice(app.indexOf('const connectPlugin = async'), app.indexOf('const homePageHandlers'));
    expect(fn).toContain('spotify: pluginSetupNeeded.spotify ? null : connectSpotify,');
    expect(app).toContain("out.spotify = spotifyCredentialsSource !== 'user';");
  });

  test('a tile is connected only when signed in and playing; a plan limit shows its label', () => {
    const spotify = registry[0];
    const amazon = registry[2];
    expect(GS.serviceState(spotify, { accounts: { spotify: true }, playbackResolvers: ['spotify'] }).state).toBe('connected');
    expect(GS.serviceState(spotify, { accounts: { spotify: true }, playbackResolvers: [] }).state).toBe('connect');
    expect(GS.serviceState(spotify, { accounts: { spotify: false }, playbackResolvers: ['spotify'] }).state).toBe('connect');
    expect(GS.serviceState(amazon, {
      accounts: { amazonmusic: true }, playbackResolvers: [],
      playbackLimits: { amazonmusic: { blocked: true, label: 'Prime: no playback' } },
    })).toEqual({ state: 'limited', label: 'Prime: no playback' });
    // No host sign-in state: on and playing counts.
    expect(GS.serviceState(registry[4], { accounts: {}, playbackResolvers: ['subsonic'] }).state).toBe('connected');
  });
});

describe('the steps', () => {
  test('each is done on its own rule; current is the first not done', () => {
    expect(GS.gettingStartedSteps({}).current).toBe('connect');
    expect(GS.gettingStartedSteps({ folderAdded: true }).current).toBe('music');
    expect(GS.gettingStartedSteps({ connected: true, scrobbling: true }).current).toBe('listen');
    expect(GS.gettingStartedSteps({ connected: true, hasMusic: true }).current).toBe('listen');
    expect(GS.gettingStartedSteps({ connected: true, hasMusic: true, played: true }).allDone).toBe(true);
    expect(GS.gettingStartedSteps({ played: true }).steps.map((s) => s.done)).toEqual([false, false, true]);
  });

  test('new installs get the layout, upgrades never do, and a saved state wins', () => {
    expect(GS.initialGettingStarted(undefined, false)).toEqual({ active: true, played: false, skipped: false });
    expect(GS.initialGettingStarted(undefined, true)).toEqual({ active: false, played: false, skipped: false });
    expect(GS.initialGettingStarted({ active: false, played: true }, false)).toEqual({ active: false, played: true, skipped: false });
    // Skipped with steps open: the pill offers them; an upgrade (never skipped) isn't nagged.
    expect(GS.gettingStartedLeft({ active: false, skipped: true }, GS.gettingStartedSteps({}))).toBe(true);
    expect(GS.gettingStartedLeft({ active: false, skipped: false }, GS.gettingStartedSteps({}))).toBe(false);
    expect(GS.gettingStartedLeft({ active: false, skipped: true }, GS.gettingStartedSteps({ connected: true, hasMusic: true, played: true }))).toBe(false);
    const open = GS.gettingStartedSteps({});
    expect(GS.showGettingStarted({ active: true }, open)).toBe(true);
    expect(GS.showGettingStarted({ active: false }, open)).toBe(false);
    expect(GS.showGettingStarted({ active: true }, GS.gettingStartedSteps({ connected: true, hasMusic: true, played: true }))).toBe(false);
    expect(GS.showGettingStarted(null, open)).toBe(false);
  });
});

describe('the layout', () => {
  const noop = () => {};
  const plugins = GS.stepOnePlugins(registry);
  const base = {
    status: GS.gettingStartedSteps({}),
    plugins: { ...plugins, free: plugins.free.map((r) => ({ ...r, active: true })) },
    serviceStates: { applemusic: { state: 'connected' } },
    scrobblers: [{ id: 'lastfm', name: 'Last.fm', capabilities: { scrobbling: true } }],
    scrobblerStates: {},
    watchFolders: [], hasCollection: false, playlists: [],
    onSkip: noop, onConnect: noop, onOpenPlugin: noop, onAddFolder: noop, onBrowsePlugins: noop,
    onImportLink: noop, onSyncLibrary: noop, onCollectionRadio: noop, onOpenPlaylist: noop, onSearch: noop,
  };
  const render = (props) => renderToStaticMarkup(React.createElement(GettingStarted, { ...base, ...props }));

  test('step 1 open: service tiles, More plug-ins, the music folder and Bandcamp shown as On', () => {
    const html = render({});
    expect(html).toContain('Welcome to Parachord');
    expect(html).toContain('Skip setup for now');
    expect(html).toContain('aria-label="Connect Spotify"');
    expect(html).toContain('aria-label="Apple Music: connected"');
    expect(html).toContain('More plug-ins');
    expect(html).toContain('Your music folder');
    expect(html).toContain('On · Add a folder');
    const off = render({ plugins: { ...base.plugins, folder: { ...base.plugins.folder, active: false } } });
    expect(off).toContain('Off · Add a folder');
    expect(html).toMatch(/Bandcamp<\/span><span[^>]*>On</);
    expect(html).not.toContain('YouTube');
    expect((html.match(/aria-expanded="true"/g) || []).length).toBe(1);
  });

  test('step 1 explains the order and quality; the phone apps are offered, opened in the browser', () => {
    const html = render({});
    expect(html).toContain('first one in your order that has it');
    expect(html.indexOf('Set the order')).toBeGreaterThan(html.indexOf('Bandcamp'));
    expect(html).toContain('Set the order');
    expect(html).toContain('Sound quality');
    expect(html).toContain('lossless and Dolby Atmos');
    expect(html).toContain('iPhone beta on TestFlight');
    expect(html).toContain('Android beta on Google Play');
    expect(html).toContain('stay up to date between your phone and this computer');
    const page = read('src/renderer/components/home-page.js');
    expect(page).toContain("onOpenQuality: () => { navigateTo('settings'); setSettingsTab('general'); },");
    expect(page).toMatch(/onOpenLink: \(url\) => \{ const shell = globalThis\.electron && globalThis\.electron\.shell; if \(shell && shell\.openExternal\) shell\.openExternal\(url\); \},/);
  });

  test('the current step is open; any step can be opened', () => {
    const html = render({ status: GS.gettingStartedSteps({ connected: true }) });
    expect(html).toContain('Import a playlist');
    expect(html).toContain('aria-label="Connect Last.fm"');
    expect(render({ openStep: 'listen' })).toContain('Search');
  });

  test('every control is a button (no clickable divs), and nothing says resolver', () => {
    const html = render({});
    expect(html).not.toMatch(/<div[^>]*onclick/i);
    expect(html).not.toMatch(/resolver/i);
    expect(renderToStaticMarkup(React.createElement(GettingStartedSkeleton))).toContain('aria-busy="true"');
  });
});

describe('Home', () => {
  const noop = () => {};
  const handlers = Object.fromEntries(HOME_PAGE_HANDLERS.map((k) => [k, noop]));
  const plugins = GS.stepOnePlugins(registry);
  const props = (gettingStarted) => ({
    ...handlers,
    allPlaylistCovers: {}, appVersion: '1.0.0', bannerItems: [], cacheLoaded: true, chatAvailable: false,
    charts: [], chartsLoaded: false, chartsLoading: true,
    collectionData: { tracks: [], albums: [], artists: [] }, collectionLoading: false,
    concerts: [], concertsLoaded: true, concertsLoading: false, concertsLocation: '',
    criticsPicks: [], criticsPicksLoaded: false, criticsPicksLoading: true,
    extensionConnected: null, gettingStarted, homeActive: {}, homeData: {}, homeSetupDismissed: [],
    library: [], mixes: [], newReleases: [], newReleasesLoaded: true, newReleasesLoading: false,
    playlists: [], playlistsLoading: false, recommendationAlbums: [], recommendations: { sections: [], loading: false },
    setAddToPlaylistPanel: noop, setCollectionSort: noop, setCollectionTab: noop, setExtensionInfoOpen: noop,
    setRaycastInfoOpen: noop, setSettingsTab: noop, setShowUrlImportDialog: noop, showToast: noop, watchFolders: [], whatsNewUnread: false,
  });
  const model = (show, ready = true) => ({
    show, ready, status: GS.gettingStartedSteps({}), plugins: { ...plugins, free: [] },
    serviceStates: {}, scrobblers: [], scrobblerStates: {},
  });
  const render = (gs) => renderToStaticMarkup(React.createElement(HomePage, props(gs)));

  test('while setup is open, the getting-started layout replaces the sections and the pill', () => {
    const html = render(model(true));
    expect(html).toContain('Connect where you listen');
    expect(html).toContain('Explore while you set up');
    expect(html).toContain('Critical Darlings');
    expect(html).toContain('Pop of the Tops');
    expect(html).not.toContain('Jump back in');
    expect(html).not.toContain('Ask Shuffleupagus');
    expect(html).not.toContain('Fresh Drops');
    expect(html).not.toMatch(/Finish setting up|What(&#x27;|')s new/);
  });

  test('before the plug-ins load it draws the skeleton; when done or skipped it is the normal Home', () => {
    expect(render(model(true, false))).toContain('aria-busy="true"');
    const normal = render(model(false));
    expect(normal).not.toContain('Connect where you listen');
    expect(normal).toMatch(/Good (morning|afternoon|evening)/);
  });
});

describe('the welcome tour', () => {
  test('overview screens only, ending in set up', () => {
    expect(TOUR_SCREENS.map((s) => s.id)).toEqual(['welcome', 'collection', 'discover', 'spinoff', 'concerts', 'shuffleupagus', 'friends', 'links', 'buy', 'achordion', 'apps']);
    const src = read('src/renderer/components/first-run-tutorial.js');
    expect(src).not.toMatch(/'sources'|'accounts'|'complete'|connectLastfm|setActiveResolvers|TextField/);
  });

  test('each screen renders with Back / Next / Skip tour, and the last hands over to Home', () => {
    const noop = () => {};
    global.window = global.window || {};
    for (const [i, s] of TOUR_SCREENS.entries()) {
      const html = renderToStaticMarkup(React.createElement(FirstRunTutorial, {
        firstRunTutorial: { open: true, step: s.id }, loadedResolvers: registry,
        navigateTo: noop, getTrackArt: () => null, setFirstRunTutorial: noop, startGettingStarted: noop,
      }));
      expect(html).toContain(s.title);
      expect(html).toContain(`Screen ${i + 1} of ${TOUR_SCREENS.length}`);
      if (i > 0) expect(html).toContain('Back');
      expect(html).toContain(i === TOUR_SCREENS.length - 1 ? 'Get started' : 'Skip tour');
    }
  });
});

describe('app wiring', () => {
  test('the state is remembered under an allowlisted key', () => {
    expect(read('main-process/ipc/store.js')).toContain("'home_getting_started'");
    expect(app).toContain("'tutorial_completed', 'whats_new_dismissed_version', 'home_setup_dismissed', 'home_getting_started',");
    expect(app).toContain("GettingStartedModel.initialGettingStarted(d['home_getting_started'], !!tutorialCompleted)");
  });

  test('playing marks step 3; all done or skipped switches to the normal Home', () => {
    expect(app).toMatch(/if \(isPlaying && homeGettingStarted\?\.active && !homeGettingStarted\.played\) \{\s*saveHomeGettingStarted\(\{ \.\.\.homeGettingStarted, played: true \}\);/);
    expect(app).toMatch(/if \(homeGettingStarted\?\.active && homeGettingStartedModel\.status\.allDone\) \{\s*saveHomeGettingStarted\(\{ \.\.\.homeGettingStarted, active: false \}\);/);
    expect(app).toContain('const skipGettingStarted = () => saveHomeGettingStarted({ played: !!homeGettingStarted?.played, active: false, skipped: true });');
  });

  test('Connect switches the plug-in on and runs its sign-in, else opens its panel', () => {
    const fn = app.slice(app.indexOf('const connectPlugin = async'), app.indexOf('const homePageHandlers'));
    // Switched on only when its sign-in runs; a panel opens with the plug-in as it was.
    expect(fn).toMatch(/if \(signIn\) \{\s*if \(!activeResolversRef\.current\.includes\(pluginId\)\) toggleResolver\(pluginId\);\s*await signIn\(\);\s*\} else setSelectedResolver\(plugin\);/);
    expect(fn).toContain('applemusic: connectAppleMusic');
    expect(fn).toContain('else setSelectedResolver(plugin);');
  });

  test('step 1 reads playbackResolvers and the playback limits, not activeResolvers alone', () => {
    expect(app).toContain('const opts = { accounts: pluginAccounts, setupNeeded: pluginSetupNeeded, playbackResolvers, playbackLimits };');
  });
});

describe('the normal Home after setup', () => {
  const { FreshCriticalRow } = require('../../src/renderer/components/home-sections');
  const card = (i, row) => ({ id: `${row}-${i}`, title: `T${i}`, artist: 'A', homeRow: row });
  const render = (p) => renderToStaticMarkup(React.createElement(FreshCriticalRow, { navigateTo: () => {}, ...p }));
  test('Pop of the Tops takes an empty Fresh Drops half; Fresh Drops wins when it has releases', () => {
    const critical = [0, 1, 2].map((i) => card(i, 'critical'));
    const charts = [0, 1, 2].map((i) => card(i, 'charts'));
    const noFresh = render({ fresh: [], critical, charts });
    expect(noFresh).toContain('Pop of the Tops');
    expect(noFresh).toContain('Critical Darlings');
    // The same order as the getting-started layout's Explore row.
    expect(noFresh.indexOf('Critical Darlings')).toBeLessThan(noFresh.indexOf('Pop of the Tops'));
    const withFresh = render({ fresh: [0, 1, 2].map((i) => card(i, 'fresh')), critical, charts });
    expect(withFresh).toContain('Fresh Drops');
    expect(withFresh).not.toContain('Pop of the Tops');
    // While its load fails, the half stays with Try again.
    expect(render({ fresh: [], critical, charts: [], chartsError: true, onRetryCharts: () => {} })).toContain('Try again');
  });
});
