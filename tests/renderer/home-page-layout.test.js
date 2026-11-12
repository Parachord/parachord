/**
 * The redesigned Home page (spec: docs/superpowers/specs/2026-11-12-home-redesign-design.md).
 * Pins the section order, that the old sections are gone, the one
 * background-load effect, and that the page renders under plain Node with the
 * props app.js passes.
 */
const fs = require('fs');
const path = require('path');

global.React = require('react');
global.ReactDOM = require('react-dom');
const { renderToStaticMarkup } = require('react-dom/server');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const page = read('src/renderer/components/home-page.js');
const app = read('src/renderer/app.js');
const main = read('main.js');
const { HomePage, HOME_PAGE_HANDLERS } = require('../../src/renderer/components/home-page');

describe('source', () => {
  test.each(['Continue Listening', 'Recently Added', 'Friend Activity', 'Enhance Your Experience',
    'Album Suggestions', 'Artist Suggestions', "'Discover'", 'Surprise Me', 'Sync Your Collection',
    'linear-gradient(135deg, #667eea'])('the old "%s" is gone', (s) => {
    expect(page).not.toContain(s);
  });

  test('sections render in the spec order, header first', () => {
    const order = ['HomeBanner', 'HomeSetupButton', 'JumpBackIn', 'MixesRow', 'PlaylistsRow', 'AlbumsRow',
      'FreshCriticalRow', 'ConcertsRow', 'AskShuffleupagus'];
    const at = order.map((name) => page.indexOf(`React.createElement(${name},`));
    at.forEach((i, n) => expect([order[n], i]).not.toEqual([order[n], -1]));
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test('one background-load effect, after paint, through requestIdleCallback', () => {
    const i = page.indexOf('globalThis.requestIdleCallback');
    expect(i).toBeGreaterThan(-1);
    const effect = page.slice(page.lastIndexOf('React.useEffect(', i), page.indexOf('}, [cacheLoaded]);', i));
    expect(effect).toMatch(/setTimeout\([^,]+, 0\)/);
    expect(effect).toMatch(/!newReleasesLoaded && !newReleasesLoading\) loadNewReleases\(\)/);
    expect(effect).toMatch(/!criticsPicksLoaded && !criticsPicksLoading\) loadCriticsPicks\(\)/);
    expect(effect).toMatch(/!concertsLoaded && !concertsLoading && !concertsError\) loadConcerts\(\)/);
    // Recommendations: every Home mount, unless a load is running or a full
    // load finished in the last 10 minutes; the per-provider cache TTL
    // inside decides what is fetched.
    expect(effect).toContain('loadHomeRecommendations();');
    const i2 = app.indexOf('const loadHomeRecommendations = () => {');
    const fn = app.slice(i2, app.indexOf('\n  };', i2));
    expect(fn).toMatch(/if \(!shouldLoadHomeRecommendations\(\{[\s\S]*loading: recommendations\.loading,[\s\S]*loadStarted: recommendationProviderIdsRef\.current !== null,[\s\S]*lastFullLoadAt: recommendationsFullLoadAtRef\.current,[\s\S]*\}\)\) return;\s*loadRecommendations\(\);/);
  });

  test('a full recommendations load stamps when it finishes, from cache or after fetching', () => {
    const i = app.indexOf('const loadRecommendations = async');
    const fn = app.slice(i, app.indexOf('\n  };', i));
    // One stamp, behind the pure rule, called from both finish paths.
    expect(fn.match(/recommendationsFullLoadAtRef\.current = Date\.now\(\);/g) || []).toHaveLength(1);
    expect(fn).toMatch(/if \(!metaOnly && shouldStampHomeRecommendationsLoad\(\{ fetched, failed, sectionCount: loadSectionCount\(\) \}\)\) \{\s*recommendationsFullLoadAtRef\.current = Date\.now\(\);/);
    expect(fn).toMatch(/if \(toFetch\.length === 0 && similarToFetch\.length === 0\) \{\s*stampFullLoad\(0, 0\);/);
    expect(fn).toMatch(/saveRecommendationsCache\(\);\s*stampFullLoad\(toFetch\.length, failed\);/);
  });

  test('the import card leads to Library Sync in Settings', () => {
    expect(page).toContain("onImport: () => { navigateTo('settings'); setSettingsTab('general'); },");
    expect(page).not.toContain("navigateTo('search')");
  });

  test('the Ask box is not re-keyed on the example (that wiped typed text)', () => {
    expect(page).not.toMatch(/key: examplePrompt/);
  });

  test('the rows are memoized', () => {
    for (const name of ['tiles', 'albums', 'fresh', 'critical']) {
      expect(page).toMatch(new RegExp(`const ${name} = React\\.useMemo\\(`));
    }
    expect(page).not.toMatch(/releaseTag\(r\.date, Date\.now\(\)\)/);
  });

  test('app.js no longer runs its own Home discovery load', () => {
    expect(app).not.toContain('Load discovery data (recommendations, charts, critics picks) for HOME view previews');
    expect(app).not.toContain('const recommendationsPreview = useMemo(');
  });

  test('the new handlers are stable handlers', () => {
    for (const name of ['openServicePlaylist', 'loadConcerts', 'loadHomeRecommendations', 'askShuffleupagus',
      'dismissHomeBanner', 'openHomeBannerCta', 'dismissHomeSetupItem', 'showHomeContextMenu']) {
      expect(HOME_PAGE_HANDLERS).toContain(name);
    }
  });

  test('recent loves play with the loves context', () => {
    expect(page).toContain("const LOVES_CONTEXT = { type: 'loves', name: 'Recent loves' };");
  });

  test('a concert card only links tickets: Home no longer opens the Concerts flyout', () => {
    expect(page).not.toContain('setConcertsTicketFlyout');
    expect(page).not.toContain('onOpenTickets');
  });

  test('every cover that fails reports through reportBrokenAlbumArt', () => {
    expect(page).toContain('globalThis.reportBrokenAlbumArt');
    expect(page).toContain('createCoalescedUpdater');
  });

  test('openServicePlaylist is one function both pages call', () => {
    expect(app).toMatch(/const openServicePlaylist = \(item, sourceName\) => \{/);
    expect(app).toMatch(/const openRecommendationPlaylist = \(item, section\) => openServicePlaylist\(item, itemSourceName\(item, section\)\);/);
  });

  test('the loves context menu offers Add to Queue and Open in Collection', () => {
    const i = main.indexOf("if (data.type === 'loves') {");
    expect(i).toBeGreaterThan(-1);
    const block = main.slice(i, i + 1200);
    expect(block).toContain("label: `Add to Queue (${data.tracks?.length || 0} tracks)`");
    expect(block).toContain("label: 'Open in Collection'");
    expect(app).toContain("data.action === 'open-collection-loves'");
  });
});

describe('render', () => {
  const noop = () => {};
  const handlers = Object.fromEntries(HOME_PAGE_HANDLERS.map((k) => [k, noop]));
  const now = Date.now();
  const base = {
    ...handlers,
    allPlaylistCovers: {}, allResolvers: [], appVersion: '1.0.0', bannerItems: [], cacheLoaded: true,
    chatAvailable: true,
    collectionData: { tracks: [], albums: [], artists: [] }, collectionLoading: false,
    concerts: [], concertsLoaded: true, concertsLoading: false, concertsLocation: '',
    criticsPicks: [], criticsPicksLoaded: true, criticsPicksLoading: false,
    extensionConnected: null, homeActive: {}, homeData: {}, homeSetupDismissed: [],
    library: [], metaServiceConfigs: {}, mixes: [], newReleases: [], newReleasesLoaded: true, newReleasesLoading: false,
    playlists: [], playlistsLoading: false, recommendationAlbums: [], recommendations: { sections: [], loading: false },
    setAddToPlaylistPanel: noop, setConcertsTicketFlyout: noop, setExtensionInfoOpen: noop, setHomeData: noop,
    setRaycastInfoOpen: noop, setSettingsTab: noop, showToast: noop, spotifyConnected: false, whatsNewUnread: false,
  };
  const render = (props) => renderToStaticMarkup(React.createElement(HomePage, { ...base, ...props }));

  test('a new user sees the import card and the Ask box', () => {
    const html = render({});
    expect(html).toContain('Build your collection');
    expect(html).toContain('Ask Shuffleupagus');
    expect(html).not.toContain('Your playlists, freshest first');
  });

  test('with data, every section shows', () => {
    const html = render({
      collectionData: {
        tracks: [{ id: 't1', title: 'Song', artist: 'Hovvdy', album: 'Frog', addedAt: now }],
        albums: [], artists: [],
      },
      playlists: [{ id: 'p1', title: 'Daily Brew', tracks: [{ title: 'a', artist: 'b' }], lastModified: now }],
      recommendationAlbums: [{ id: 'a1', title: 'Heavy', artist: 'Nap Eyes', resolverId: 'lastfm', sourceLabel: 'Last.fm' }],
      newReleases: [{ id: 'n1', title: 'New One', artist: 'Frog', date: '2026-11-13' }],
      criticsPicks: [{ id: 'c1', title: 'Acclaimed', artist: 'Someone' }],
      concerts: [{ id: 'e1', artist: 'Hovvdy', date: '2099-01-02', venue: { name: 'Hall', city: 'Town' } }],
      concertsLocation: 'Town',
    });
    for (const s of ['Jump back in', 'Daily Brew', 'Recent loves', 'Your playlists, freshest first',
      'Albums you might love', 'Fresh Drops', 'Critical Darlings', 'Concerts near you', 'Ask Shuffleupagus',
      'Play Collection Radio']) {
      expect(html).toContain(s);
    }
    // The Ask box's example is built from the collection's artists.
    expect(html).toMatch(/id="home-ask-prompt"[^>]*value="[^"]*Hovvdy/);
  });

  test('loading data shows the skeletons, not an empty page', () => {
    const html = render({
      collectionLoading: true, playlistsLoading: true, recommendations: { sections: [], loading: true },
      newReleasesLoaded: false, criticsPicksLoaded: false, concertsLoaded: false, concertsLocation: 'Town',
    });
    expect((html.match(/animate-shimmer/g) || []).length).toBeGreaterThan(10);
    expect(html).not.toContain('Build your collection');
  });

  test('with no chat plugin, Ask offers set-up', () => {
    expect(render({ chatAvailable: false })).toContain('Set up Shuffleupagus');
  });
});
