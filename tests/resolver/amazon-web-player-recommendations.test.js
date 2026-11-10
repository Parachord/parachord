/**
 * amazon-web-player recommendations wiring (the recommendations capability's
 * host half; docs/architecture/amazon-music.md, "Recommendations"). The
 * parsers are pinned in amazon-music-logic.test.js and the .axe bridge
 * mapping in amazon-music-resolver.test.js — this file pins the flows:
 *   - getRecommendations: a fresh browseHomeTemplate answers with NO page
 *     flow (the template body replayed VERBATIM — the home page's own
 *     variables, hash intact), the page flow mints the template from the
 *     capture with the freshest csrf-ts, and a page that never fired
 *     BrowseHomePage is not-ready
 *   - the session cache: cached sections skip the replay entirely and the
 *     TTL re-fetches
 *   - expandRecommendationSection: the see-more template replays with the
 *     id/afterCursor patched; a cold template loads the see-more ROUTE
 *     (first page) to mint one, and a cursor page then replays the minted
 *     template
 *   - not signed in: notReady without any request
 *
 * The module is loaded with plain require: electron is pulled lazily behind
 * electron() inside the stubbed methods. Plumbing methods are stubbed on the
 * exported singleton — all looked up through `this` (the pattern of
 * amazon-web-player-template.test.js).
 */

const amazonWebPlayer = require('../../amazon-web-player');
const { makeSpecSearchTemplate } = require('../../amazon-music-logic');

const CAPTURED_HEADERS = { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1000' };

const BROWSE_HOME_BODY = {
  operationName: 'BrowseHomePage',
  variables: { firstLimit: 5, recommenderItemLimit: 15, topRecommenderId: 'musicTopOneRecommender', isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false, paginating: false },
  extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: 'browsehash' } }
};

const SEE_MORE_BODY = {
  operationName: 'RecommenderSeeMorePage',
  variables: { id: 'uri:///recommendations/browse-home/browse-home_mp3PrimeAlbumsStrategy', firstLimit: 20, isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false },
  extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: 'seemorehash' } }
};

const albumNode = (id, title, artist) => ({
  __typename: 'Album', id,
  title, shortTitle: title,
  images: [{ url: `https://m.media-amazon.com/images/I/${id}.jpg`, width: 2560, height: 2560, imageType: 'PRIMARY' }],
  url: `https://music.amazon.com/albums/${id}?ref=dm_wtyd`,
  contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] }
});

const browseHomeData = (sections) => ({
  data: {
    user: { id: 'u', tier: 'UNLIMITED' },
    t1r: {},
    browse: { recommendationConnection: { edges: sections.map(s => ({ node: s })) } }
  }
});

const SECTION_ID = 'uri:///recommendations/browse-home/browse-home_mp3PrimeAlbumsStrategy';

const fakeWin = (href = 'https://music.amazon.com/') => ({
  isDestroyed: () => false,
  loadURL: jest.fn().mockResolvedValue(undefined),
  webContents: {
    isDestroyed: () => false,
    getURL: () => href,
    loadURL: jest.fn().mockResolvedValue(undefined)
  }
});

describe('amazonWebPlayer.getRecommendations', () => {
  let replayGql, isSignedIn, ensureWindow, layoutSearch, attachGqlCapture, cancelSearchViewPark, scheduleParkSearchView, expandParsed;
  let saved;

  beforeEach(() => {
    saved = {
      browseHomeTemplate: amazonWebPlayer.browseHomeTemplate,
      seeMoreTemplate: amazonWebPlayer.seeMoreTemplate,
      recommendationsCache: amazonWebPlayer.recommendationsCache,
      seeMorePages: amazonWebPlayer.seeMorePages,
      searchView: amazonWebPlayer.searchView,
      searchViewParkTimer: amazonWebPlayer.searchViewParkTimer
    };
    amazonWebPlayer.searchViewParkTimer = null;
    amazonWebPlayer.searchView = fakeWin();
    amazonWebPlayer.browseHomeTemplate = null;
    amazonWebPlayer.seeMoreTemplate = null;
    amazonWebPlayer.recommendationsCache = null;
    amazonWebPlayer.seeMorePages = new Map();
    isSignedIn = jest.spyOn(amazonWebPlayer, 'isSignedIn').mockResolvedValue(true);
    replayGql = jest.spyOn(amazonWebPlayer, 'replayGql');
    // The playlists-strategy synthesis: answered with nothing by default (the
    // dedicated describe below pins it); individual tests override.
    expandParsed = jest.spyOn(amazonWebPlayer, 'expandRecommendationSectionParsed').mockResolvedValue({ section: null, nextCursor: null });
    ensureWindow = jest.spyOn(amazonWebPlayer, 'ensureWindow');
    layoutSearch = jest.spyOn(amazonWebPlayer, 'layoutSearch');
    attachGqlCapture = jest.spyOn(amazonWebPlayer, 'attachGqlCapture');
    cancelSearchViewPark = jest.spyOn(amazonWebPlayer, 'cancelSearchViewPark').mockImplementation(() => {});
    scheduleParkSearchView = jest.spyOn(amazonWebPlayer, 'scheduleParkSearchView').mockImplementation(() => {});
  });

  afterEach(() => {
    isSignedIn.mockRestore();
    replayGql.mockRestore();
    expandParsed.mockRestore();
    ensureWindow.mockRestore();
    layoutSearch.mockRestore();
    attachGqlCapture.mockRestore();
    cancelSearchViewPark.mockRestore();
    scheduleParkSearchView.mockRestore();
    Object.assign(amazonWebPlayer, saved);
    amazonWebPlayer.searchViewBusy = 0;
    if (amazonWebPlayer.searchViewParkTimer) clearTimeout(amazonWebPlayer.searchViewParkTimer);
    amazonWebPlayer.searchChain = Promise.resolve();
  });

  test('not signed in: notReady without any request', async () => {
    isSignedIn.mockResolvedValue(false);
    await expect(amazonWebPlayer.getRecommendations()).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(replayGql).not.toHaveBeenCalled();
    expect(ensureWindow).not.toHaveBeenCalled();
  });

  test('a fresh template answers with NO page flow: the body replayed verbatim, hash intact', async () => {
    amazonWebPlayer.browseHomeTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: BROWSE_HOME_BODY, capturedAt: Date.now()
    });
    replayGql.mockResolvedValue({ parsed: browseHomeData([{ id: SECTION_ID, name: 'Albums for You', recommendedContent: { edges: [{ node: albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }] } }]) });
    expandParsed.mockResolvedValue({ section: { title: 'Playlists for You', items: [{ type: 'playlist', id: 'PP6417A00A9C99470BBC8834FF3BF6009A', name: 'My Discovery Mix' }] }, nextCursor: 'browse-home_playlistStrategy.20' });
    const sections = await amazonWebPlayer.getRecommendations();
    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({ id: SECTION_ID, title: 'Albums for You' });
    // The home page carried no playlists: the playlists strategy was pulled as
    // a titled section, with its first page's cursor riding on it.
    expect(sections[1]).toMatchObject({ id: 'uri:///recommendations/browse-home/browse-home_playlistStrategy', title: 'Playlists for You', nextCursor: 'browse-home_playlistStrategy.20' });
    expect(sections[1].items[0]).toMatchObject({ type: 'playlist', name: 'My Discovery Mix' });
    expect(replayGql).toHaveBeenCalledTimes(1);
    const [win, entry, body] = replayGql.mock.calls[0];
    expect(win).toBe(amazonWebPlayer.searchView);
    expect(entry.url).toBe('https://gql.music.amazon.com/');
    // Verbatim: the template's variables, byte-identical (no patching on this flow).
    expect(body).toEqual(BROWSE_HOME_BODY);
    expect(ensureWindow).not.toHaveBeenCalled();
    expect(attachGqlCapture).not.toHaveBeenCalled();
    // The synthesized result is cached: a second call re-fetches nothing.
    await amazonWebPlayer.getRecommendations();
    expect(replayGql).toHaveBeenCalledTimes(1);
    expect(expandParsed).toHaveBeenCalledTimes(1);
  });

  test('the session cache serves a second call without a replay', async () => {
    amazonWebPlayer.browseHomeTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: BROWSE_HOME_BODY, capturedAt: Date.now()
    });
    replayGql.mockResolvedValue({ parsed: browseHomeData([{ id: SECTION_ID, name: 'Albums for You', recommendedContent: { edges: [] } }]) });
    await amazonWebPlayer.getRecommendations();
    await amazonWebPlayer.getRecommendations();
    expect(replayGql).toHaveBeenCalledTimes(1);
  });

  test('the cache expires after RECOMMENDATIONS_CACHE_TTL_MS', async () => {
    amazonWebPlayer.recommendationsCache = { sections: [{ id: SECTION_ID, title: 'Albums for You', items: [] }], fetchedAt: Date.now() - (30 * 60 * 1000 + 1000) };
    amazonWebPlayer.browseHomeTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: BROWSE_HOME_BODY, capturedAt: Date.now()
    });
    replayGql.mockResolvedValue({ parsed: browseHomeData([{ id: SECTION_ID, name: 'Albums for You', recommendedContent: { edges: [{ node: albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }] } }]) });
    const sections = await amazonWebPlayer.getRecommendations();
    expect(replayGql).toHaveBeenCalledTimes(1);
    expect(sections[0].items[0].name).toBe('Tempelschlaf');
  });

  test('a replay error drops the template and falls to the chained page flow, which re-mints', async () => {
    amazonWebPlayer.browseHomeTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: BROWSE_HOME_BODY, capturedAt: Date.now()
    });
    const win = fakeWin();
    ensureWindow.mockResolvedValue(win);
    layoutSearch.mockResolvedValue('desktop');
    const captured = [
      { id: 1, body: JSON.stringify({ operationName: 'Transport', variables: {} }), url: 'https://gql.music.amazon.com/', headers: { ...CAPTURED_HEADERS, 'csrf-ts': '900' } },
      { id: 2, body: JSON.stringify(BROWSE_HOME_BODY), url: 'https://gql.music.amazon.com/', headers: { ...CAPTURED_HEADERS, 'csrf-ts': '2000' } },
      // An echo of the stale template: same body, session-AGED headers (lower csrf-ts) — must NOT win the mint.
      { id: 3, body: JSON.stringify(BROWSE_HOME_BODY), url: 'https://gql.music.amazon.com/', headers: { ...CAPTURED_HEADERS, 'csrf-ts': '1000' } }
    ];
    attachGqlCapture.mockReturnValue({ captured, detach: jest.fn() });
    replayGql
      .mockResolvedValueOnce({ error: 'replay exceeded 12000ms' }) // the fast path drops the template
      .mockResolvedValueOnce({ parsed: browseHomeData([{ id: SECTION_ID, name: 'Albums for You', recommendedContent: { edges: [{ node: albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }] } }]) });
    const sections = await amazonWebPlayer.getRecommendations();
    expect(sections).toHaveLength(1);
    expect(ensureWindow).toHaveBeenCalledTimes(1);
    expect(win.loadURL).toHaveBeenCalledWith('https://music.amazon.com/');
    // The page flow minted from the FRESHEST csrf-ts capture (id 2's headers).
    expect(amazonWebPlayer.browseHomeTemplate.headers['csrf-ts']).toBe('2000');
    // The page's own request is replayed verbatim.
    const [, entry, body] = replayGql.mock.calls[1];
    expect(entry.headers['csrf-ts']).toBe('2000');
    expect(body).toEqual(BROWSE_HOME_BODY);
  });

  test('a page that never fires BrowseHomePage is not-ready, and nothing is cached', async () => {
    const win = fakeWin();
    ensureWindow.mockResolvedValue(win);
    layoutSearch.mockResolvedValue('desktop');
    attachGqlCapture.mockReturnValue({ captured: [{ id: 1, body: JSON.stringify({ operationName: 'Transport', variables: {} }), url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS }], detach: jest.fn() });
    // Fake timers: the capture poll waits its full 60x250ms window before
    // concluding structurally, which is the wall-clock cost the not-ready
    // protects against in the real app.
    jest.useFakeTimers();
    try {
      const pending = amazonWebPlayer.getRecommendations();
      const expectation = expect(pending).rejects.toMatchObject({ reason: 'not-ready' });
      await jest.advanceTimersByTimeAsync(60 * 250 + 500);
      await expectation;
    } finally {
      jest.useRealTimers();
    }
    expect(amazonWebPlayer.recommendationsCache).toBeNull();
    expect(amazonWebPlayer.browseHomeTemplate).toBeNull();
  }, 20000);

  test('a structural response (no envelope) is not-ready, never a miss', async () => {
    const win = fakeWin();
    ensureWindow.mockResolvedValue(win);
    layoutSearch.mockResolvedValue('desktop');
    attachGqlCapture.mockReturnValue({ captured: [{ id: 1, body: JSON.stringify(BROWSE_HOME_BODY), url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS }], detach: jest.fn() });
    replayGql.mockResolvedValue({ parsed: { data: { user: { tier: 'UNLIMITED' } } } }); // no data.browse
    await expect(amazonWebPlayer.getRecommendations()).rejects.toMatchObject({ reason: 'not-ready' });
    expect(amazonWebPlayer.recommendationsCache).toBeNull();
  });
});

describe('amazonWebPlayer.expandRecommendationSection', () => {
  let replayGql, isSignedIn, ensureWindow, layoutSearch, attachGqlCapture, cancelSearchViewPark, scheduleParkSearchView;
  let saved;

  const seeMoreData = (edges, pageInfo) => ({
    data: { recommender: { edges: [{ node: { id: SECTION_ID, name: 'Albums for You', recommendedContent: { edges, pageInfo } } }] } }
  });

  beforeEach(() => {
    saved = {
      browseHomeTemplate: amazonWebPlayer.browseHomeTemplate,
      seeMoreTemplate: amazonWebPlayer.seeMoreTemplate,
      recommendationsCache: amazonWebPlayer.recommendationsCache,
      seeMorePages: amazonWebPlayer.seeMorePages,
      searchView: amazonWebPlayer.searchView,
      searchViewParkTimer: amazonWebPlayer.searchViewParkTimer
    };
    amazonWebPlayer.searchViewParkTimer = null;
    amazonWebPlayer.searchView = fakeWin();
    amazonWebPlayer.browseHomeTemplate = null;
    amazonWebPlayer.seeMoreTemplate = null;
    amazonWebPlayer.recommendationsCache = null;
    amazonWebPlayer.seeMorePages = new Map();
    isSignedIn = jest.spyOn(amazonWebPlayer, 'isSignedIn').mockResolvedValue(true);
    replayGql = jest.spyOn(amazonWebPlayer, 'replayGql');
    ensureWindow = jest.spyOn(amazonWebPlayer, 'ensureWindow');
    layoutSearch = jest.spyOn(amazonWebPlayer, 'layoutSearch');
    attachGqlCapture = jest.spyOn(amazonWebPlayer, 'attachGqlCapture');
    cancelSearchViewPark = jest.spyOn(amazonWebPlayer, 'cancelSearchViewPark').mockImplementation(() => {});
    scheduleParkSearchView = jest.spyOn(amazonWebPlayer, 'scheduleParkSearchView').mockImplementation(() => {});
  });

  afterEach(() => {
    isSignedIn.mockRestore();
    replayGql.mockRestore();
    ensureWindow.mockRestore();
    layoutSearch.mockRestore();
    attachGqlCapture.mockRestore();
    cancelSearchViewPark.mockRestore();
    scheduleParkSearchView.mockRestore();
    Object.assign(amazonWebPlayer, saved);
    amazonWebPlayer.searchViewBusy = 0;
    if (amazonWebPlayer.searchViewParkTimer) clearTimeout(amazonWebPlayer.searchViewParkTimer);
    amazonWebPlayer.searchChain = Promise.resolve();
  });

  test('a fresh template replays with the id/afterCursor patched, hash and firstLimit intact', async () => {
    amazonWebPlayer.seeMoreTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: SEE_MORE_BODY, capturedAt: Date.now()
    });
    replayGql.mockResolvedValue({ parsed: seeMoreData(
      [{ node: albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal') }],
      { hasNextPage: true, endCursor: null, token: 'browse-home_mp3PrimeAlbumsStrategy.20' }
    ) });
    const page = await amazonWebPlayer.expandRecommendationSection(SECTION_ID, 'browse-home_mp3PrimeAlbumsStrategy.20');
    expect(page.items[0]).toMatchObject({ type: 'album', name: 'Sons of Northern Darkness' });
    expect(page.nextCursor).toBe('browse-home_mp3PrimeAlbumsStrategy.20');
    expect(replayGql).toHaveBeenCalledTimes(1);
    const [, , body] = replayGql.mock.calls[0];
    expect(body.variables.id).toBe(SECTION_ID);
    expect(body.variables.afterCursor).toBe('browse-home_mp3PrimeAlbumsStrategy.20');
    expect(body.variables.firstLimit).toBe(20);
    expect(body.extensions.persistedQuery.sha256Hash).toBe('seemorehash');
    // The stored template is not mutated by the patch.
    expect(amazonWebPlayer.seeMoreTemplate.body.variables.id).toBe('uri:///recommendations/browse-home/browse-home_mp3PrimeAlbumsStrategy');
    expect(ensureWindow).not.toHaveBeenCalled();
  });

  test('the first page (no cursor) drops the afterCursor variable', async () => {
    amazonWebPlayer.seeMoreTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: { ...CAPTURED_HEADERS }, body: { ...SEE_MORE_BODY, variables: { ...SEE_MORE_BODY.variables, afterCursor: 'stale.15' } }, capturedAt: Date.now()
    });
    replayGql.mockResolvedValue({ parsed: seeMoreData([{ node: albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }], { hasNextPage: false, endCursor: null, token: null }) });
    const page = await amazonWebPlayer.expandRecommendationSection(SECTION_ID, null);
    expect(page.nextCursor).toBeNull();
    const [, , body] = replayGql.mock.calls[0];
    expect(body.variables).not.toHaveProperty('afterCursor');
  });

  test('a cold template loads the see-more ROUTE (first page), mints the template, and replays the cursor page with it', async () => {
    const win = fakeWin('https://music.amazon.com/browse/music-items/home/recommendation/browse-home_mp3PrimeAlbumsStrategy');
    ensureWindow.mockResolvedValue(win);
    layoutSearch.mockResolvedValue('desktop');
    attachGqlCapture.mockReturnValue({ captured: [
      { id: 1, body: JSON.stringify({ operationName: 'KidsMode', variables: {} }), url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS },
      { id: 2, body: JSON.stringify(SEE_MORE_BODY), url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS }
    ], detach: jest.fn() });
    replayGql
      .mockResolvedValueOnce({ parsed: seeMoreData([{ node: albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }], { hasNextPage: true, token: 'browse-home_mp3PrimeAlbumsStrategy.20' }) }) // the route's first page
      .mockResolvedValueOnce({ parsed: seeMoreData([{ node: albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal') }], { hasNextPage: false, token: null }) }); // the cursor page via the minted template
    const page = await amazonWebPlayer.expandRecommendationSection(SECTION_ID, 'browse-home_mp3PrimeAlbumsStrategy.20');
    expect(page.items[0].name).toBe('Sons of Northern Darkness');
    expect(page.nextCursor).toBeNull();
    expect(win.loadURL).toHaveBeenCalledWith('https://music.amazon.com/browse/music-items/home/recommendation/browse-home_mp3PrimeAlbumsStrategy');
    // The minted template carries the route's request.
    expect(amazonWebPlayer.seeMoreTemplate.body.extensions.persistedQuery.sha256Hash).toBe('seemorehash');
    // The cursor page replay patches the minted template.
    const [, , body] = replayGql.mock.calls[1];
    expect(body.variables.afterCursor).toBe('browse-home_mp3PrimeAlbumsStrategy.20');
    // The page is cached: a second identical expansion does not fetch again.
    expect(replayGql).toHaveBeenCalledTimes(2);
    const again = await amazonWebPlayer.expandRecommendationSection(SECTION_ID, 'browse-home_mp3PrimeAlbumsStrategy.20');
    expect(again.items[0].name).toBe('Sons of Northern Darkness');
    expect(replayGql).toHaveBeenCalledTimes(2);
  });

  test('a section with nothing more answers empty (a miss, not an error)', async () => {
    amazonWebPlayer.seeMoreTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: SEE_MORE_BODY, capturedAt: Date.now()
    });
    replayGql.mockResolvedValue({ parsed: seeMoreData([], { hasNextPage: false, endCursor: null, token: null }) });
    const page = await amazonWebPlayer.expandRecommendationSection(SECTION_ID, null);
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  test('a non-section id is not-ready without a request', async () => {
    await expect(amazonWebPlayer.expandRecommendationSection('', null)).rejects.toMatchObject({ reason: 'not-ready' });
    expect(replayGql).not.toHaveBeenCalled();
  });
});

describe('amazonWebPlayer.withPlaylistsSection (the synthesized "Playlists for You" section)', () => {
  let expandParsed, isSignedIn;
  let saved;

  const albumSections = [{ id: SECTION_ID, title: 'Albums for You', items: [{ type: 'album', id: 'B0G2TSTWXD', name: 'Tempelschlaf', artist: 'The Ruins Of Beverast' }] }];
  const playlistSections = [{ id: 'uri:///recommendations/browse-home/other', title: 'Home playlists', items: [{ type: 'playlist', id: 'PP1', name: 'My Discovery Mix', url: 'https://music.amazon.com/playlists/PP1' }] }];

  beforeEach(() => {
    saved = { recommendationsCache: amazonWebPlayer.recommendationsCache, seeMorePages: amazonWebPlayer.seeMorePages, searchChain: amazonWebPlayer.searchChain };
    amazonWebPlayer.recommendationsCache = null;
    amazonWebPlayer.seeMorePages = new Map();
    isSignedIn = jest.spyOn(amazonWebPlayer, 'isSignedIn').mockResolvedValue(true);
    expandParsed = jest.spyOn(amazonWebPlayer, 'expandRecommendationSectionParsed');
  });

  afterEach(() => {
    isSignedIn.mockRestore();
    expandParsed.mockRestore();
    amazonWebPlayer.recommendationsCache = saved.recommendationsCache;
    amazonWebPlayer.seeMorePages = saved.seeMorePages;
    amazonWebPlayer.searchChain = saved.searchChain;
  });

  test('no playlist items in the home sections: the playlists strategy is pulled as a titled section with its cursor', async () => {
    expandParsed.mockResolvedValue({ section: { title: 'Playlists for You', items: [{ type: 'playlist', id: 'PP6417A00A9C99470BBC8834FF3BF6009A', name: 'My Discovery Mix' }] }, nextCursor: 'browse-home_playlistStrategy.20' });
    const out = await amazonWebPlayer.withPlaylistsSection(albumSections);
    expect(expandParsed).toHaveBeenCalledWith('uri:///recommendations/browse-home/browse-home_playlistStrategy', null);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 'uri:///recommendations/browse-home/browse-home_playlistStrategy', title: 'Playlists for You', nextCursor: 'browse-home_playlistStrategy.20' });
    expect(out[1].items[0]).toMatchObject({ type: 'playlist', name: 'My Discovery Mix' });
  });

  test('the home page already rendered playlists: no synthesis', async () => {
    const out = await amazonWebPlayer.withPlaylistsSection(playlistSections);
    expect(expandParsed).not.toHaveBeenCalled();
    expect(out).toBe(playlistSections);
  });

  test('a renamed strategy or route failure soft-fails: the home sections pass through', async () => {
    expandParsed.mockRejectedValue(Object.assign(new Error('Amazon see-more page never issued its query'), { reason: 'not-ready' }));
    const out = await amazonWebPlayer.withPlaylistsSection(albumSections);
    expect(out).toBe(albumSections);
  });

  test('a strategy with nothing answers no section (still soft)', async () => {
    expandParsed.mockResolvedValue({ section: null, nextCursor: null });
    const out = await amazonWebPlayer.withPlaylistsSection(albumSections);
    expect(out).toBe(albumSections);
  });
});

describe('signOut recommendations hygiene', () => {
  test('signOut clears the recommendations templates and caches (they embed the old session)', async () => {
    const saved = {
      browseHomeTemplate: amazonWebPlayer.browseHomeTemplate,
      seeMoreTemplate: amazonWebPlayer.seeMoreTemplate,
      recommendationsCache: amazonWebPlayer.recommendationsCache,
      seeMorePages: amazonWebPlayer.seeMorePages
    };
    const destroyView = jest.spyOn(amazonWebPlayer, 'destroyView').mockImplementation(() => {});
    const cancelSearchViewPark = jest.spyOn(amazonWebPlayer, 'cancelSearchViewPark').mockImplementation(() => {});
    const session = jest.spyOn(amazonWebPlayer, 'session').mockReturnValue({ clearStorageData: jest.fn().mockResolvedValue(undefined) });
    try {
      amazonWebPlayer.browseHomeTemplate = { url: 'https://gql.music.amazon.com/', headers: { 'csrf-ts': '1' }, body: BROWSE_HOME_BODY, capturedAt: Date.now() };
      amazonWebPlayer.seeMoreTemplate = { url: 'https://gql.music.amazon.com/', headers: { 'csrf-ts': '1' }, body: SEE_MORE_BODY, capturedAt: Date.now() };
      amazonWebPlayer.recommendationsCache = { sections: [{ id: SECTION_ID, title: 'Albums for You', items: [] }], fetchedAt: Date.now() };
      amazonWebPlayer.seeMorePages.set('x|', { items: [], nextCursor: null });
      await amazonWebPlayer.signOut();
      expect(amazonWebPlayer.browseHomeTemplate).toBeNull();
      expect(amazonWebPlayer.seeMoreTemplate).toBeNull();
      expect(amazonWebPlayer.recommendationsCache).toBeNull();
      expect(amazonWebPlayer.seeMorePages.size).toBe(0);
    } finally {
      destroyView.mockRestore();
      cancelSearchViewPark.mockRestore();
      session.mockRestore();
      amazonWebPlayer.browseHomeTemplate = saved.browseHomeTemplate;
      amazonWebPlayer.seeMoreTemplate = saved.seeMoreTemplate;
      amazonWebPlayer.recommendationsCache = saved.recommendationsCache;
      amazonWebPlayer.seeMorePages = saved.seeMorePages;
      amazonWebPlayer.searchChain = Promise.resolve();
    }
  });
});
