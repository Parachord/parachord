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

  test('the import card leads to Library Sync in Settings, which offers each service\'s sync setup', () => {
    expect(page).toContain("onImport: () => { navigateTo('settings'); setSettingsTab('general'); },");
    expect(page).not.toContain("navigateTo('search')");
    // With nothing synced, the card is a way forward, not a dead-end sentence.
    const card = app.slice(app.indexOf('// Nothing synced yet: offer each service'), app.indexOf('// Nothing synced yet: offer each service') + 1800);
    expect(card).toContain('onClick: () => openSyncSetupModal(pid),');
    expect(card).toContain('`Set up ${config.name} sync`');
    expect(app).not.toContain('No sync providers connected.');
  });

  test('the checklist\'s services and scrobbling items open Plug-Ins, where both are connected', () => {
    expect(page).toContain("if (id === 'resolvers' || id === 'scrobbling') { navigateTo('settings'); setSettingsTab('plugins'); }");
    expect(page).not.toContain("openSyncSetupModal('spotify')");
    // Scrobbling is connected once any plugin has an account name saved.
    expect(page).toContain('Object.values(metaServiceConfigs || {}).some((c) => c && c.username)');
    // Services: something beyond the two that ship switched on.
    expect(app).toMatch(/const homeServicesConnected = useMemo\(\s*\(\) => activeResolvers\.some\(id => id !== 'bandcamp' && id !== 'localfiles'\),/);
  });

  test('Spotify sync setup with no Client ID opens the Spotify plugin and says why', () => {
    const i = app.indexOf("pendingSyncSetupRef.current = 'spotify';");
    const block = app.slice(i, i + 1100);
    expect(block).toContain('const result = await window.electron.spotify.authenticate();');
    expect(block).toMatch(/if \(result\.error === 'no_client_id'\) \{\s*openPluginSettings\('spotify'\);\s*showToast\(/);
    // A refused login is not left pending.
    expect(block).toContain('pendingSyncSetupRef.current = null;');
  });

  test('the Ask box is not re-keyed on the example (that wiped typed text)', () => {
    expect(page).not.toMatch(/key: examplePrompt/);
  });

  test('the rows are memoized', () => {
    for (const name of ['tiles', 'albums', 'fresh', 'critical']) {
      expect(page).toMatch(new RegExp(`const ${name} = React\\.useMemo\\(`));
    }
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
    expect(page).toContain("const LOVES_CONTEXT = { type: 'loves', name: 'Recent Loves' };");
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
    expect(block).toContain("label: `Add to Queue (${trackCount(data.tracks?.length || 0)})`");
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
    setRaycastInfoOpen: noop, setSettingsTab: noop, showToast: noop, servicesConnected: false, whatsNewUnread: false,
  };
  const render = (props) => renderToStaticMarkup(React.createElement(HomePage, { ...base, ...props }));

  test('Home opens with the collapsed page hero, in its sidebar colour, above the scroller', () => {
    // Other pages' collapsed heroes (80px, the uppercase light title and shadow)
    // and Home's sidebar colour (the accent, #7c3aed: Tailwind violet-600).
    expect(app).toMatch(/className: 'text-2xl font-light text-white',\s*style: \{\s*textShadow: '0 2px 10px rgba\(0,0,0,0\.5\)',\s*letterSpacing: '0\.2em',/);
    expect(app).toContain("color: activeView === 'home' ? 'var(--accent-primary)' : 'var(--nav-inactive)',");
    expect(fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8')).toMatch(/--accent-primary: #7c3aed;/);
    const html = render({});
    const hero = html.slice(html.indexOf('data-home-hero-banner'), html.indexOf('scrollable-content'));
    expect(html.indexOf('data-home-hero-banner')).toBeGreaterThan(-1);
    expect(html.indexOf('data-home-hero-banner')).toBeLessThan(html.indexOf('scrollable-content'));
    expect(hero).toMatch(/^data-home-hero-banner=""[^>]*style="height:80px;flex-shrink:0;overflow:hidden"/);
    expect(hero).toContain('class="absolute inset-0 bg-gradient-to-br from-purple-500 via-violet-600 to-indigo-600"');
    expect(hero).toMatch(/<h1 class="text-2xl font-light text-white" style="text-shadow:0 2px 10px rgba\(0,0,0,0\.5\);letter-spacing:0\.2em;text-transform:uppercase">Home<\/h1>/);
    // The hero replaces the macOS title-bar band, and the greeting is no longer a second h1.
    expect(html).not.toContain('data-home-titlebar');
    expect(html.match(/<h1/g)).toHaveLength(1);
  });

  test('Your playlists cards add their tracks to a playlist the way the Playlists page does', () => {
    const page = read('src/renderer/components/home-page.js');
    const actions = page.slice(page.indexOf('const playlistActions = {'), page.indexOf('const mixActions = {'));
    expect(actions).toContain("onAddToPlaylist: (p) => { const tracks = playlistTracks(p); if (tracks.length > 0) setAddToPlaylistPanel({ open: true, tracks, sourceName: p.title, sourceType: 'playlist' }); },");
  });

  test('a mix hovers like every playlist card: Add to Playlist, Play, Add to Queue', () => {
    const page = read('src/renderer/components/home-page.js');
    const actions = page.slice(page.indexOf('const mixActions = {'), page.indexOf('// Jump back in: the tile opens'));
    expect(actions).toContain('onAddToPlaylist: addServicePlaylistToPlaylist,');
    const html = render({ mixes: [{ type: 'playlist', id: 'm1', title: 'Weekly Jams', url: 'https://listenbrainz.org/playlist/m1', resolverId: 'listenbrainz', resolverName: 'ListenBrainz' }] });
    const row = html.slice(html.indexOf('id="home-mixes"'));
    const add = row.indexOf('Add Weekly Jams to a playlist');
    expect(add).toBeGreaterThan(-1);
    expect(add).toBeLessThan(row.indexOf('aria-label="Play Weekly Jams"'));
    expect(row.indexOf('aria-label="Play Weekly Jams"')).toBeLessThan(row.indexOf('Add Weekly Jams to the queue'));
    // The Recommendations page's playlist cards share the same function.
    expect(app).toContain('const addRecommendationPlaylistToPlaylist = async (item) => addServicePlaylistToPlaylist(item);');
  });

  test('Made from your listening shows Recent Loves even with no service mixes', () => {
    const tracks = [
      { id: 't1', title: 'One', artist: 'A', album: 'X', addedAt: 3 },
      { id: 't2', title: 'Two', artist: 'B', album: 'Y', addedAt: 2 },
    ];
    const html = render({ collectionData: { tracks, albums: [], artists: [] }, mixes: [] });
    const row = html.slice(html.indexOf('id="home-mixes"'));
    expect(html).toContain('id="home-mixes"');
    expect(row.indexOf('aria-label="Open Recent Loves"')).toBeGreaterThan(-1);
    expect(row).toContain('Your 2 latest loves');
    expect(row).toContain('aria-label="Add Recent Loves to a playlist"');
    expect(render({ mixes: [] })).not.toContain('id="home-mixes"');
  });

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
    for (const s of ['Jump back in', 'Daily Brew', 'Recent Loves', 'Your playlists, freshest first',
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

describe("Home's recommended albums (app.js recommendationAlbums)", () => {
  // Albums split into category rows (#1377): Home's row must still take
  // albums from every row of the Albums section, not only the first. Run the
  // real useMemo body against a page the real model built.
  const model = require('../../src/renderer/lib/recommendation-model');
  const { trackSlug } = require('../../src/renderer/lib/track-slug');
  const start = app.indexOf('const recommendationAlbums = useMemo(() => {');
  const end = app.indexOf('}, [recommendations.sections, homeData.aiRecommendations, recommendationImages]);', start);
  const recommendationAlbumsFor = (recommendations, homeData = {}) => new Function(
    'useMemo', 'recommendations', 'homeData', 'recommendationImageFor', 'trackSlug',
    `${app.slice(start, end)}}, []);\nreturn recommendationAlbums;`
  )((fn) => fn(), recommendations, homeData, (item) => item.imageUrl || null, trackSlug);

  test('takes albums from every category row of the Albums section', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const providers = [model.normalizeRecommendationSections({ sections: [
      { id: 'fresh', title: 'Fresh', category: 'new', items: [{ type: 'album', name: 'N1', artist: 'A' }] },
      { id: 'ed', title: 'Ed', category: 'editorial', items: [{ type: 'album', name: 'E1', artist: 'B' }] },
    ] }, { resolverId: 'amazonmusic', resolverName: 'Amazon Music' })];
    const sections = model.buildRecommendationPage({ providers });
    const albumRows = sections.find(s => s.type === 'album').subsections;
    expect(albumRows.map(s => s.key)).toEqual(['albums:new', 'albums:editorial']);
    const albums = recommendationAlbumsFor({ sections });
    expect(albums.map(a => a.title)).toEqual(['N1', 'E1']);
    expect(albums.every(a => a.sourceLabel === 'Amazon Music')).toBe(true);
  });

  // Before category rows, Home's albums were the provider blend (one round per
  // provider, Shuffleupagus last). Category order would let the leading row
  // fill Home's ~6 cards and drop a provider whose albums sit in a later row.
  const al = (name) => ({ type: 'album', name, artist: `Artist ${name}` });
  const blendPage = () => {
    const providers = [
      model.normalizeRecommendationSections({ sections: [
        { items: [al('AP0'), al('AP1'), al('AP2')] },
      ] }, { resolverId: 'applemusic', resolverName: 'Apple Music' }),
      model.normalizeRecommendationSections({ sections: [
        { id: 'recents', title: 'Recents', category: 'personal', items: [al('AZ0'), al('AZ1')] },
        { id: 'fans', title: 'Fans also like', category: 'artist', seedArtist: 'FIDLAR', items: [al('AZ2'), al('AZ3')] },
      ] }, { resolverId: 'amazonmusic', resolverName: 'Amazon Music' }),
    ];
    const aiAlbums = ['SH0', 'SH1', 'SH2'].map(t => ({ title: t, artist: `Artist ${t}`, reason: 'r' }));
    const shuffleupagus = model.shuffleupagusSection({ albums: aiAlbums, artists: [] });
    return { sections: model.buildRecommendationPage({ providers, shuffleupagus }), aiAlbums };
  };

  test('keeps the provider blend order across the category rows', () => {
    const { sections, aiAlbums } = blendPage();
    expect(sections.find(s => s.type === 'album').subsections.map(s => s.key))
      .toEqual(['albums:personal', 'albums:artist', 'albums:other']);
    const albums = recommendationAlbumsFor({ sections }, {
      aiRecommendations: { albums: [...aiAlbums, { title: 'SH9', artist: 'Artist SH9' }] },
    });
    expect(albums.map(a => a.title)).toEqual(
      ['AP0', 'AZ0', 'SH0', 'AP1', 'AZ1', 'SH1', 'AP2', 'AZ2', 'SH2', 'AZ3', 'SH9']);
    expect(albums.slice(0, 3).map(a => a.sourceLabel)).toEqual(['Apple Music', 'Amazon Music', 'Shuffleupagus']);
  });

  test('a page cached before blendIndex keeps its collection order', () => {
    const { sections } = blendPage();
    const old = sections.map(s => ({
      ...s,
      subsections: s.subsections.map(sub => ({
        ...sub, items: sub.items.map(({ blendIndex, ...rest }) => rest),
      })),
    }));
    expect(recommendationAlbumsFor({ sections: old }).map(a => a.title)).toEqual(
      ['AZ0', 'SH0', 'AZ1', 'SH1', 'SH2', 'AZ2', 'AZ3', 'AP0', 'AP1', 'AP2']);
  });
});

describe('setup checklist housekeeping', () => {
  test('opening the Raycast instructions completes its item (it has no way to detect an install)', () => {
    expect(page).toContain("else if (id === 'raycast') { setRaycastInfoOpen(true); dismissHomeSetupItem('raycast'); }");
  });

  test('Settings › Dialogs can bring dismissed checklist items back', () => {
    const i = app.indexOf('// Items dismissed from Home\'s setup checklist');
    const card = app.slice(i, i + 1800);
    expect(card).toContain('homeSetupDismissed.length > 0 && React.createElement');
    expect(card).toContain('setHomeSetupDismissed([]);');
    expect(card).toContain("await window.electron.store.set('home_setup_dismissed', []);");
  });
});

describe('first launch', () => {
  const html = read('index.html');
  test('a splash that never clears says so and offers Reload', () => {
    // Outside the app bundle, so it runs even when the bundle fails.
    expect(html).toMatch(/<div id="parachord-splash-stuck" role="alert" style="[^"]*display:none;/);
    expect(html).toContain('<button type="button" onclick="location.reload()"');
    expect(html).toMatch(/setTimeout\(function \(\) \{[\s\S]*?!splash\.classList\.contains\('fade-out'\)\) stuck\.style\.display = 'flex';\s*\}, 20000\);/);
  });

  test('a first run records the installed version as seen, so What\'s New is not unread', () => {
    expect(app).toMatch(/if \(!tutorialCompleted && !dismissedVersion && version\) \{\s*setWhatsNewDismissedVersion\(version\);\s*window\.electron\.store\?\.set\('whats_new_dismissed_version', version\);/);
  });
});

describe('design-audit bug fixes (#1382)', () => {
  const pv = read('src/renderer/components/playlist-view-page.js');

  test('a loaded, empty playlist says so instead of loading rows forever', () => {
    expect(pv).toMatch(/if \(displayTracks\.length === 0 && !playlistEditMode && emptyPlaylistId === selectedPlaylist\.id\) \{/);
    expect(pv).toContain("'This playlist is empty'");
    // Each "no tracks" path marks the playlist.
    expect(app.match(/setEmptyPlaylistId\(playlist\.id\);/g) || []).toHaveLength(3);
  });

  test('the confirm dialog\'s secondary button uses defined variables', () => {
    expect(app).not.toContain("var(--card-secondary-bg");
    expect(app).not.toContain("'1px solid var(--border)'");
  });

  test('Spotify "Clear" saves the cleared value, not the stale input', () => {
    expect(app).toContain("saveSpotifyCredentials('');");
    expect(app).toContain("const clientId = (typeof clientIdOverride === 'string' ? clientIdOverride : spotifyClientIdInput).trim();");
  });

  test('Add-to-Playlist "Done" is readable, and the stop-sync option keeps its box after a hover', () => {
    expect(app).toContain("color: selectedPlaylistsForAdd.length > 0 ? '#ffffff' : 'var(--text-primary)',");
    expect(app).toContain("onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)'; }");
  });
});

describe('design-audit copy and motion fixes (#1382)', () => {
  const engine = read('src/renderer/hooks/use-playback-engine.js');
  const html = read('index.html');

  test('no message names a Settings path that does not exist', () => {
    for (const src of [app, engine, read('src/renderer/lib/playback-limits.js'), read('main.js')]) {
      expect(src).not.toMatch(/Settings (→|>) (Resolvers|Installed|Apple Music)/);
    }
    expect(engine).not.toContain('Toggle Developer Tools');
  });

  test('Settings does not claim plug-ins are sandboxed (README: they are not)', () => {
    expect(app).not.toMatch(/secure sandbox|Sandboxed execution/);
  });

  test('card-fade-up releases the card when it ends, so the hover lift applies', () => {
    expect(html).toMatch(/\.card-fade-up \{\s*animation: cardFadeUp 0\.4s cubic-bezier\(0\.4, 0, 0\.2, 1\) backwards;\s*\}/);
    expect(html).toMatch(/\.release-card:hover \{[^}]*!important;/);
  });

  test('the fadeIn animation the concert rows use is defined', () => {
    expect(html).toMatch(/@keyframes fadeIn \{/);
  });
});

describe('design-audit keyboard fixes (#1382)', () => {
  test('Escape in the Search box goes back; other typing is left alone', () => {
    expect(app).toContain("const searchBoxEscape = e.key === 'Escape' && activeElement === searchInputRef.current;");
    expect(app).toContain('if (isTyping && !searchBoxEscape) return;');
  });

  test('Find (Cmd/Ctrl+F) opens Search from any page, then focuses its box', () => {
    expect(app).toMatch(/case 'focus-search':[\s\S]{0,200}openSearchRef\.current\(\);/);
    expect(app).toContain("if (activeView !== 'search') navigateTo('search');");
  });

  test('the Buy button has one tooltip', () => {
    const i = app.indexOf('content: `Buy on ${purchaseSource.resolverName}`');
    expect(app.slice(i, i + 1400)).not.toContain('title: `Buy on');
  });
});

describe('design-audit layout fixes (#1382)', () => {
  test('the playbar centre and progress shrink in a narrow window', () => {
    expect(app).toContain("style: { flex: '0 1 340px', minWidth: '200px' },");
    expect(app).not.toContain("style: { width: '340px', flexShrink: 0 },");
    const atoms = read('src/renderer/components/ui-atoms.js');
    expect(atoms).toContain("className: 'flex items-center gap-2', style: { minWidth: '120px' }");
    expect(atoms).not.toContain('min-w-[200px]');
  });

  test('Search re-measures its width after a detail view', () => {
    expect(app).toMatch(/return \(\) => resizeObserver\.disconnect\(\);[\s\S]{0,400}?\}, \[activeView, searchDetailCategory\]\);/);
  });
});

describe('design-audit small fixes (#1382)', () => {
  test('History offers to connect a missing service instead of "Try Again"', () => {
    expect(app).toContain("const notConnected = /^No (listening history service|Last\\.fm account) connected/.test(error || '');");
    expect(app).toContain("? services.map(s => button(`Connect ${s.name}`, () => openPluginSettings(s.id)))");
    expect((app.match(/historyErrorState\((listeningHistory|topTracks|topArtists|topAlbums)\.error,/g) || []).length).toBe(4);
  });

  test('saving an empty key or URL does not switch a plugin on', () => {
    expect((app.match(/enabled: !!e\.target\.value\.trim\(\)/g) || []).length).toBe(2);
  });

  test('text fields and selections get a native Cut / Copy / Paste menu', () => {
    const main = read('main.js');
    expect(main).toContain("mainWindow.webContents.on('context-menu', (_event, params) => {");
    expect(main).toContain("{ role: 'paste', enabled: !!flags.canPaste },");
  });
});
