/**
 * The Amazon plugin's recommendations (#1356 M8;
 * plugins-src/amazonmusic/implementation.js): the flows that used to live in
 * amazon-web-player.js (pinned in tests/resolver/amazon-web-player-
 * recommendations.test.js until the move), retargeted at the plugin's real
 * flows against the mocked webSession bridge — the same seam the spec search
 * (amazon-music-plugin-spec-search.test.js), the album catalog
 * (amazon-music-plugin-catalog.test.js) and the playlist import
 * (amazon-music-plugin-playlist.test.js) drive.
 *
 * Pinned here (docs/architecture/amazon-music.md, "Recommendations" — the
 * section is the spec; every sentence is a requirement):
 *   - getRecommendations: the music-tab walk (firstLimit bumped to 20, the
 *     offset cursor followed, sections deduped across pages, the cursor-repeat
 *     no-advance stop, the 4-page cap), the page-flow mint preferring the
 *     freshest csrf-ts among the page's OWN captures (an echo never mints),
 *     the 294 browse fallback (session-sticky), the session caches (30 min,
 *     all dropped on the generation bump a sign-out carries), NOT plan-gated,
 *     and the shelf filter (#1491): every shelf but "Featured This Week",
 *     each under a category
 *   - expandRecommendationSection: the see-more template replays with the
 *     id/afterCursor patched (the id is the SEE-MORE id — the browse-home
 *     prefix even for a music-home strategy); a cold template loads the
 *     see-more route to mint one; the per-session page cache
 *   - withPlaylistsSection: the synthesized "Playlists for You" section with
 *     the route's first-page cursor riding on it; a soft-fail never affects
 *     the home page's own sections
 *   - signed out: notReady without any request; a wall is structural
 *     not-ready, never a miss
 *
 * The _lib helpers those flows use (their cases moved out of
 * amazon-music-logic.test.js, whose host copies died with the flow) are
 * pinned at the bottom against the plugin's own library.
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonRecommendationsMock,
  amazonMusicHomeCapture,
  amazonMusicHomeData,
  amazonSeeMoreCapture,
  amazonSeeMoreData
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

// A music-home section: its own id is music-home-prefixed; its see-more
// REQUEST carries the browse-home prefix (seeMoreSectionIdFor).
const SECTION_ID = 'uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy';
const SEE_MORE_ID = 'uri:///recommendations/browse-home/music-home_mp3PrimeAlbumsStrategy';
const RECENTS_ID = 'uri:///recommendations/music-home/music-home_mp3YmlRecentPlaybackStrategy';
const PLAYLISTS_SECTION_ID = 'uri:///recommendations/browse-home/browse-home_playlistStrategy';

// One gql Album node (the live captures' shape, 2026-11).
const albumNode = (id, title, artist) => ({
  __typename: 'Album', id,
  title, shortTitle: title,
  images: [{ url: `https://m.media-amazon.com/images/I/${id}.jpg`, width: 2560, height: 2560, imageType: 'PRIMARY' }],
  url: `https://music.amazon.com/albums/${id}?ref=dm_wtyd`,
  contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] }
});

const playlistNode = (id, title) => ({
  __typename: 'Playlist', id,
  title,
  images: [{ url: `https://m.media-amazon.com/images/I/${id}.jpg`, width: 500, height: 500, imageType: 'PRIMARY' }],
  url: `https://music.amazon.com/playlists/${id}`
});

// A home section node carrying one album (the "Albums for You" shape).
const albumSection = (id, name, albumId = 'B0G2TSTWXD', albumTitle = 'Tempelschlaf', artist = 'The Ruins Of Beverast') => ({
  id, name, itemType: 'ALBUM',
  recommendedContent: { edges: [{ node: albumNode(albumId, albumTitle, artist) }] }
});

// A see-more responder that always answers one page with no cursor.
const oneSeeMorePage = (items, pageInfo, title) => async () => amazonSeeMoreData(items, pageInfo, title);

afterEach(() => {
  delete global.window;
});

// ── getRecommendations: the home walk ──────────────────────────────────────

describe('getRecommendations (the music-home walk)', () => {
  test('not signed in: notReady without any request', async () => {
    const ws = amazonRecommendationsMock({ signedIn: false, homePage: async () => amazonMusicHomeData([]) });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'not-signed-in' });
    expect(ws.pageFetch).not.toHaveBeenCalled();
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('the page flow walks the captured request with ONLY firstLimit patched, follows the offset cursor, and dedupes across pages', async () => {
    const ws = amazonRecommendationsMock({
      // Page 1 carries a cursor (hasNextPage) — the walk continues to page 2,
      // which re-serves page 1's section (the server re-ranks per request) and
      // carries one more before running out.
      homePage: async (body) => (body.variables.afterCursor
        ? amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You'), albumSection(RECENTS_ID, 'Based on Your Recents', 'B0DTRR4VWM', 'Lonely People With Power', 'Deafheaven')])
        : amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')], { hasNextPage: true, endCursor: null, token: '20' })),
      // The home sections carry no playlists: the playlists strategy is pulled
      // as a titled section with its first page's cursor riding on it.
      seeMorePage: oneSeeMorePage([playlistNode('PP6417A00A9C99470BBC8834FF3BF6009A', 'My Discovery Mix')], { hasNextPage: true, endCursor: null, token: 'browse-home_playlistStrategy.20' }, 'Playlists for You')
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID, RECENTS_ID, PLAYLISTS_SECTION_ID]);
    expect(out.sections[2]).toMatchObject({ id: PLAYLISTS_SECTION_ID, title: 'Playlists for You', nextCursor: 'browse-home_playlistStrategy.20' });
    expect(out.sections[2].items[0]).toMatchObject({ type: 'playlist', name: 'My Discovery Mix' });
    // The load ran the music tab, and the walk's two pages + the see-more
    // route's first page are the only replays.
    expect(ws.load.mock.calls.map(c => c[1])).toEqual([
      'https://music.amazon.com/music',
      'https://music.amazon.com/browse/music-items/home/recommendation/browse-home_playlistStrategy'
    ]);
    expect(ws.sentRequests.length).toBe(3);
    // Page 1: the page's own request with ONLY firstLimit patched (the walk
    // bumps the page's 5 to 20) — full-body equality pins that everything else
    // (type, feature flags, the hash) stays the capture's.
    const capturedBody = JSON.parse(amazonMusicHomeCapture().body);
    expect(ws.sentRequests[0]).toEqual({ ...capturedBody, variables: { ...capturedBody.variables, firstLimit: 20 } });
    // Page 2: the cursor page.
    expect(ws.sentRequests[1].variables.afterCursor).toBe('20');
    expect(ws.sentRequests[1].variables.firstLimit).toBe(20);
  });

  test('a fresh template answers with NO page flow: the walk replays it, the hash intact', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async (body) => (body.variables.afterCursor
        ? amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You'), albumSection(RECENTS_ID, 'Based on Your Recents', 'B0DTRR4VWM', 'Lonely People With Power', 'Deafheaven')])
        : amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')], { hasNextPage: true, endCursor: null, token: '20' })),
      // The synthesis answers an empty section (soft-fail): this test pins
      // the walk, not the synthesis.
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, endCursor: null, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    // Prime the template with one page flow.
    const first = await resolver.getRecommendations({});
    expect(first.sections.map(s => s.id)).toEqual([SECTION_ID, RECENTS_ID]);
    const loads = ws.load.mock.calls.length;
    const replays = ws.sentRequests.length;
    // The second call: the template is fresh, the walk answers with no load.
    resolver._recommendationsCache = null; // past the cache, straight at the template
    const second = await resolver.getRecommendations({});
    expect(second.sections.map(s => s.id)).toEqual([SECTION_ID, RECENTS_ID]);
    expect(ws.load.mock.calls.length).toBe(loads);
    expect(ws.sentRequests.length).toBe(replays + 2);
    // The walk replays the page's own request with ONLY the pagination
    // variables patched — the hash, type and feature flags stay the capture's.
    expect(ws.sentRequests[replays].variables.firstLimit).toBe(20);
    expect(ws.sentRequests[replays].extensions.persistedQuery.sha256Hash).toBe('browsehash');
    expect(ws.sentRequests[replays].variables.audiobooksEnabled).toBe(true);
  });

  test('the session cache serves a second call without a replay', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getRecommendations({});
    const replays = ws.sentRequests.length;
    await resolver.getRecommendations({});
    expect(ws.sentRequests.length).toBe(replays);
  });

  test('the cache expires after RECOMMENDATIONS_CACHE_TTL_MS', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getRecommendations({});
    const replays = ws.sentRequests.length;
    resolver._recommendationsCache = {
      sections: [albumSection(SECTION_ID, 'Albums for You')],
      fetchedAt: Date.now() - (30 * 60 * 1000 + 1000)
    };
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID]);
    expect(ws.sentRequests.length).toBeGreaterThan(replays);
  });

  test('a replay error drops the template and falls to the chained page flow, which re-mints and re-walks', async () => {
    const data = () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]);
    const ws = amazonRecommendationsMock({
      homePage: jest.fn()
        .mockResolvedValueOnce(data()) // the prime walk
        .mockResolvedValueOnce({ error: 'replay exceeded 12000ms' }) // the fast-path walk drops the template
        .mockResolvedValue(data()),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    // Prime a template whose replay now fails.
    await resolver.getRecommendations({});
    expect(resolver._musicHomeTemplate).toBeTruthy();
    const loads = ws.load.mock.calls.length;
    resolver._recommendationsCache = null;
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID]);
    // The page flow re-minted (a fresh load) and re-walked.
    expect(ws.load.mock.calls.length).toBe(loads + 1);
    expect(resolver._musicHomeTemplate.body.operationName).toBe('MusicHomePage');
  });

  test('the mint prefers the freshest csrf-ts among the page\'s OWN captures — an echo never mints', async () => {
    // Our own concurrent template replay echoes into the capture with a FRESHER
    // csrf-ts than the page's own request: byte-identical body (the home
    // request's variables are constant — that is exactly why the csrf-ts rule
    // exists), session-aged headers. The echo flag is the M5/M6 rule; the
    // echo must not be re-certified as fresh.
    const echo = amazonMusicHomeCapture({ csrfTs: '9999', echo: true });
    const own = amazonMusicHomeCapture({ csrfTs: '2000' });
    const stale = amazonMusicHomeCapture({ csrfTs: '900' });
    const ws = amazonRecommendationsMock({
      capturesFor: (url) => (/\/music$/.test(String(url)) ? [stale, echo, own] : []),
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getRecommendations({});
    expect(resolver._musicHomeTemplate.headers['csrf-ts']).toBe('2000');
  });

  test('an echo-only capture (the page never fired its own op) is structural not-ready, never a mint', async () => {
    const echo = amazonMusicHomeCapture({ csrfTs: '9999', echo: true });
    const ws = amazonRecommendationsMock({
      capturesFor: () => [echo],
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
    expect(resolver._musicHomeTemplate).toBeFalsy();
    expect(resolver._recommendationsCache).toBeFalsy();
  });

  // A Prime account's music tab is refused: MusicHomePage answers HTTP 294
  // to the page itself and to any replay, while the full home's
  // BrowseHomePage answers 200 in the same envelope (live-verified
  // 2026-11-11, #1328). The flow switches to the full home for the session.
  test('the music tab refused (HTTP 294): the full home is read instead, and stays the session\'s home', async () => {
    const ws = amazonRecommendationsMock({
      capturesFor: (url) => (/\/music$/.test(String(url))
        ? [amazonMusicHomeCapture()]
        : (String(url) === 'https://music.amazon.com/'
          ? [amazonMusicHomeCapture({ operationName: 'BrowseHomePage' })]
          : [])),
      homePage: async (body) => (body.operationName === 'MusicHomePage'
        ? { status: 294, text: {} } // the refused music tab
        : amazonMusicHomeData([{ id: 'uri:///recommendations/browse-home/browse-home_mp3YmlRecentPlaybackStrategy', name: 'Based on Your Recents', recommendedContent: { edges: [{ node: albumNode('B0DTRR4VWM', 'Lonely People With Power', 'Deafheaven') }] } }])),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.title)).toEqual(['Based on Your Recents']);
    // The music tab's load, then the full home's.
    expect(ws.load.mock.calls.map(c => c[1])).toEqual([
      'https://music.amazon.com/music',
      'https://music.amazon.com/',
      // The browse home carries no playlists either: the synthesis pulled the
      // strategy (an empty answer — a soft miss).
      'https://music.amazon.com/browse/music-items/home/recommendation/browse-home_playlistStrategy'
    ]);
    expect(resolver._musicHomeVariant).toBe('browse');
    expect(resolver._musicHomeTemplate.body.operationName).toBe('BrowseHomePage');
    // The switch lasts the session: the next page flow goes straight to the
    // full home — no refused load first.
    resolver._recommendationsCache = null;
    resolver._musicHomeTemplate = null;
    ws.load.mockClear();
    await resolver.getRecommendations({});
    expect(ws.load.mock.calls.map(c => c[1])).toEqual([
      'https://music.amazon.com/',
      'https://music.amazon.com/browse/music-items/home/recommendation/browse-home_playlistStrategy'
    ]);
  });

  test('a music-tab failure that is not a 294 does not switch homes', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => ({ status: 500, text: {} }),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
    expect(ws.load.mock.calls.length).toBe(1);
    expect(resolver._musicHomeVariant).toBeFalsy();
  });

  test('the walk stops when a page repeats the cursor it was sent (no advance), never looping', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async (body) => (body.variables.afterCursor
        // The server answers the SAME token it was sent — the walk must stop
        // instead of re-fetching the identical window forever.
        ? amazonMusicHomeData([albumSection(RECENTS_ID, 'Based on Your Recents', 'B0DTRR4VWM', 'Lonely People With Power', 'Deafheaven')], { hasNextPage: true, endCursor: null, token: body.variables.afterCursor })
        : amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')], { hasNextPage: true, endCursor: null, token: '20' })),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID, RECENTS_ID]);
    expect(ws.sentRequests.length).toBe(2 + 1); // two walk pages + the playlists probe
  });

  test('the walk stops at the page cap even if every page keeps advancing', async () => {
    let n = 0;
    const ws = amazonRecommendationsMock({
      homePage: async () => {
        n += 20;
        return amazonMusicHomeData(
          [{ id: `uri:///recommendations/music-home/cap${n}Strategy`, name: `Section ${n}`, recommendedContent: { edges: [{ node: albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast') }] } }],
          { hasNextPage: true, endCursor: null, token: String(n) }
        );
      },
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([
      'uri:///recommendations/music-home/cap20Strategy',
      'uri:///recommendations/music-home/cap40Strategy',
      'uri:///recommendations/music-home/cap60Strategy',
      'uri:///recommendations/music-home/cap80Strategy'
    ]);
  });

  test('a page that never fires MusicHomePage is not-ready, and nothing is cached', async () => {
    const ws = amazonRecommendationsMock({
      capturesFor: () => [{ url: 'https://gql.music.amazon.com/', headers: { 'csrf-ts': '1' }, body: JSON.stringify({ operationName: 'Transport', variables: {} }) }],
      homePage: async () => amazonMusicHomeData([]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
    expect(resolver._recommendationsCache).toBeFalsy();
    expect(resolver._musicHomeTemplate).toBeFalsy();
  });

  test('a structural response (no envelope) is not-ready, never a miss', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => ({ data: { user: { tier: 'UNLIMITED' } } }), // no data.browse
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
    expect(resolver._recommendationsCache).toBeFalsy();
  });

  test('a walk that never answers times out (12s), drops the template, and defers to the page flow', async () => {
    const ws = amazonRecommendationsMock({ homePage: () => new Promise(() => {}) });
    const resolver = instantiateAmazonPlugin(axe);
    resolver._musicHomeTemplate = resolver.lib.makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/',
      headers: { 'csrf-token': 't', 'csrf-ts': '1' },
      body: JSON.parse(amazonMusicHomeCapture().body),
      capturedAt: Date.now()
    });
    jest.useFakeTimers();
    try {
      const pending = resolver.tryMusicHomeWalk();
      const expectation = expect(pending).resolves.toBeNull();
      await jest.advanceTimersByTimeAsync(12000);
      await expectation;
    } finally {
      jest.useRealTimers();
    }
    expect(resolver._musicHomeTemplate).toBeFalsy();
  });

  test('a wall on the warm view is a fast-path MISS (never a throw): the page flow runs and its after-load re-check throws not-signed-in', async () => {
    // The M5 rule (the spec-search fast path's lesson): the view keeps
    // whatever URL its last navigation left behind, so a token-refresh
    // redirect can park it on a wall with a LIVE session — a throw would
    // block the very page flow that navigates it off. The page flow's own
    // after-load re-check (on a freshly loaded page) is where the verdict is
    // made.
    const ws = amazonRecommendationsMock({
      viewUrl: 'https://music.amazon.com/ap/signin',
      finalUrl: 'https://music.amazon.com/ap/signin',
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    resolver._musicHomeTemplate = resolver.lib.makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/',
      headers: { 'csrf-token': 't', 'csrf-ts': '1' },
      body: JSON.parse(amazonMusicHomeCapture().body),
      capturedAt: Date.now()
    });
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'not-signed-in' });
    // The fast path missed (no replay), the page flow loaded and its
    // after-load check made the verdict. The wall is not a template miss:
    // the template survives for a later signed-in walk.
    expect(ws.pageFetch).not.toHaveBeenCalled();
    expect(ws.load.mock.calls.length).toBe(1);
    expect(resolver._musicHomeTemplate).toBeTruthy();
  });

  test('a refused load is notReady (load-failed), never a miss and never a sign-in prompt', async () => {
    const ws = amazonRecommendationsMock({
      loadResult: { success: false, reason: 'load-failed', error: 'the page did not finish' },
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')])
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).rejects.toMatchObject({ notReady: true, code: 'load-failed' });
  });

  test('NOT plan-gated: the plan (config.json) is never read', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getRecommendations({});
    expect(ws.fetch).not.toHaveBeenCalled();
  });

  test('the busy backoff rides out a busy gate mid-walk instead of failing the walk', async () => {
    let busyOnce = false;
    const ws = amazonRecommendationsMock({
      homePage: async (body) => {
        if (!busyOnce && !body.variables.afterCursor) {
          busyOnce = true;
          return { busy: true };
        }
        return amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]);
      },
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID]);
  });
});

// ── The page-flow queue lane ─────────────────────────────────────────────

describe('the page-flow queue lane: the recommendations are background work', () => {
  // The recommendations half of #1423's lane fix (the #1438 review's
  // before-merge item): a playlist the user opened from Recommendations is
  // what they are waiting on, and the home page flow, its walk and the
  // see-more route flow (which withPlaylistsSection also goes through) are
  // speculative refreshes — so all three queue on the plugin's two-lane
  // page-flow queue's BACKGROUND lane, and the playlist (lookupPlaylistFlow,
  // the FOREGROUND lane) goes ahead of every one of them, behind at most the
  // job already running (a running job is never interrupted). The exact
  // case #1423 fixed on the host: an opened playlist waited behind a
  // two-page home refresh.
  test('a playlist lookup queued behind a recommendations page flow starts first', async () => {
    const order = [];
    let releaseFirst;
    const firstLoad = new Promise((resolve) => { releaseFirst = resolve; });
    let seenFirst = false;
    // A home page carrying a playlist item so withPlaylistsSection passes
    // through (its see-more synthesis is a fourth flow, not this test's
    // subject).
    const homeSections = [
      albumSection(SECTION_ID, 'Albums for You'),
      { id: 'uri:///recommendations/music-home/music-home_playlistStrategy', name: 'Playlists for You', itemType: 'MIXED', recommendedContent: { edges: [{ node: playlistNode('PP1', 'My Discovery Mix') }] } }
    ];
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData(homeSections),
      seeMorePage: oneSeeMorePage([albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal')], { hasNextPage: false, token: null })
    });
    ws.load.mockImplementation(async (id, url) => {
      order.push(url);
      if (!seenFirst) {
        seenFirst = true; // the RUNNING job: never interrupted
        await firstLoad;
      }
      // The mock's own capture shapes (amazonRecommendationsMock's default
      // capturesFor): a home capture per home URL, a see-more capture on the
      // route, nothing for the playlist (its import is not this test's
      // subject — the load ORDER is).
      const u = String(url);
      let captures = [];
      if (/\/music$/.test(u)) captures = [amazonMusicHomeCapture()];
      else if (u === 'https://music.amazon.com/') captures = [amazonMusicHomeCapture({ operationName: 'BrowseHomePage' })];
      else {
        const route = /\/browse\/music-items\/home\/recommendation\/([^?]+)/.exec(u);
        if (route) {
          let strategy;
          try { strategy = decodeURIComponent(route[1]); } catch (e) { strategy = route[1]; }
          captures = [amazonSeeMoreCapture({ id: 'uri:///recommendations/browse-home/' + strategy })];
        }
      }
      return { success: true, finalUrl: u, captures };
    });
    const resolver = instantiateAmazonPlugin(axe);
    // The RUNNING job: the home refresh (a cold template queues the page
    // flow).
    const homeRefresh = resolver.getRecommendations({});
    await new Promise((resolve) => setTimeout(resolve, 0));
    // A queued BACKGROUND job: the see-more route flow (a cold see-more
    // template).
    const seeMore = resolver.expandRecommendationSection(SECTION_ID, null, {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    // The FOREGROUND job: a playlist the user opened from Recommendations.
    const playlist = resolver.lookupPlaylistFlow('https://music.amazon.com/playlists/PP1').catch(() => 'playlist-failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    const refreshed = await homeRefresh;
    await seeMore;
    await playlist;
    // The home refresh ran (it was already running); the playlist went
    // ahead of the queued see-more flow.
    expect(order).toEqual([
      'https://music.amazon.com/music',
      'https://music.amazon.com/playlists/PP1',
      'https://music.amazon.com/browse/music-items/home/recommendation/music-home_mp3PrimeAlbumsStrategy'
    ]);
    expect(refreshed.sections.map(s => s.id)).toEqual([SECTION_ID, 'uri:///recommendations/music-home/music-home_playlistStrategy']);
  });
});

// ── The shelf filter ──────────────────────────────────────────────────────

describe('the shelf filter (getRecommendations output)', () => {
  // Live 2026-11-12, a Prime account's BrowseHomePage: the personal sections
  // are named strategies; editorial shelves carry UUID ids, the onboarding
  // shelf is GET_STARTED, and the genre shelf ("Soundtracks") is a strategy
  // but a promo. All of them come back except Featured This Week.
  const item = albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast');
  const pl = playlistNode('PP1', 'A Mix');
  const base = 'uri:///recommendations/browse-home/';
  // A gql section NODE ({ id, name, recommendedContent: { edges } }), not a
  // provider section — the walk parses these.
  const sec = (id, title, items) => ({
    id: base + id,
    name: title,
    recommendedContent: { edges: (items || [item]).map(node => ({ node })) }
  });

  const homeWith = (sections) => amazonRecommendationsMock({
    homePage: async () => amazonMusicHomeData(sections),
    seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
  });

  test('keeps every shelf but Featured This Week, each under a category', async () => {
    const sections = [
      sec('GET_STARTED', "Let's Get Started", [pl]),
      sec('mp3YmlRecentPlaybackStrategy', 'Based on Your Recents'),
      sec('browse-home_mp3PrimeAlbumsStrategy', 'Albums for You'),
      sec('f5c621d6-7ba8-4d44-9e72-433921bb5203', 'Recently Played'),
      sec('browse-home_mp3ByArtistStrategy', 'FIDLAR'),
      sec('browse-home_playlistStrategy', 'Playlists for You', [pl]),
      sec('browse-home_mp3CommunityPlaylistsStrategy', 'Community Playlists', [pl]),
      sec('6a0d8250-d85c-42c0-868a-01dc91991473', 'Top Playlists', [pl]),
      sec('3cdd6257-e173-4d3b-bd27-e5e7b400492e', 'Featured This Week', [pl]),
      sec('23e18714-c11c-4576-bbc2-1dece54b3b16', 'On-Demand Albums This Week'),
      // The genre shelf is a strategy but a promo — editorial, not dropped.
      sec('browse-home_mp3GenreForYouStrategy', 'Soundtracks', [pl, item]),
      sec('fab9f6f8-60d6-49f1-a0ff-9b26256c5e90', 'A Whole Mood', [pl]),
      sec('457820b0-616c-4fb0-baf4-6114cf1cc230', 'Amazon Music Live'),
      { id: 'uri:///recommendations/music-home/music-home_newReleasesForYouStrategy', name: 'New Releases for You', recommendedContent: { edges: [{ node: item }] } }
    ];
    const ws = homeWith(sections);
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => [s.title, s.category])).toEqual([
      ["Let's Get Started", 'editorial'],
      ['Based on Your Recents', 'personal'],
      ['Albums for You', 'personal'],
      ['Recently Played', 'personal'],
      ['FIDLAR', 'artist'],
      ['Playlists for You', 'personal'],
      ['Community Playlists', 'community'],
      ['Top Playlists', 'editorial'],
      ['On-Demand Albums This Week', 'editorial'],
      ['Soundtracks', 'editorial'],
      ['A Whole Mood', 'editorial'],
      ['Amazon Music Live', 'editorial'],
      ['New Releases for You', 'new']
    ]);
    expect(ws.sentRequests.length).toBe(1); // no playlists synthesis: the home carried some
  });

  test('categories: playlist strategies personal/community, album strategies personal/artist, with the seed artist', async () => {
    const fidlar = albumNode('B0G2TSTWXD', 'Tempelschlaf', 'FIDLAR');
    const fidlar2 = { ...albumNode('B0G64M7J2C', 'The Crawl', ' fidlar ') };
    const sections = [
      sec('browse-home_playlistStrategy', 'Playlists for You', [pl]),
      sec('browse-home_mp3CommunityPlaylistsStrategy', 'Community', [pl]),
      sec('browse-home_mp3YmlRecentPlaybackStrategy', 'Recent'),
      sec('browse-home_mp3PrimeAlbumsStrategy', 'Prime'),
      sec('browse-home_mp3ByArtistStrategy', 'Because you like FIDLAR', [fidlar, fidlar2]),
      sec('browse-home_mp3OtherShelfStrategy', 'Something else')
    ];
    const ws = homeWith(sections);
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.category)).toEqual(['personal', 'community', 'personal', 'personal', 'artist', undefined]);
    // The seed artist is the one artist every album shares (trimmed,
    // case-insensitive, the first item's spelling) — never read from the
    // shelf title.
    expect(out.sections[4].seedArtist).toBe('FIDLAR');
    expect(out.sections[0].seedArtist).toBeUndefined();
  });

  test('a section with its own first-page cursor (the synthesized playlists section) carries it through', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: oneSeeMorePage([playlistNode('PP6417A00A9C99470BBC8834FF3BF6009A', 'My Discovery Mix')], { hasNextPage: true, endCursor: null, token: 'browse-home_playlistStrategy.20' }, 'Playlists for You')
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID, PLAYLISTS_SECTION_ID]);
    expect(out.sections[1].nextCursor).toBe('browse-home_playlistStrategy.20');
    expect(out.sections[1].items[0]).toMatchObject({ type: 'playlist', name: 'My Discovery Mix' });
  });

  test('a strategy with nothing answers no section (the synthesis soft-fails; the home sections pass through)', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID]);
  });

  test('a renamed strategy or a route failure soft-fails: the home sections pass through', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => ({ error: 'Amazon see-more page never issued its query' })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.id)).toEqual([SECTION_ID]);
  });

  test('a host whose bridge is missing is a quiet empty provider', async () => {
    global.window = { electron: {} };
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getRecommendations({})).resolves.toEqual({ sections: [] });
  });
});

// ── expandRecommendationSection (the see-more route) ────────────────────────

describe('expandRecommendationSection', () => {
  test('not signed in: notReady without any request', async () => {
    const ws = amazonRecommendationsMock({ signedIn: false, seeMorePage: async () => amazonSeeMoreData([]) });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.expandRecommendationSection(SECTION_ID, null, {})).rejects.toMatchObject({ notReady: true, code: 'not-signed-in' });
    expect(ws.pageFetch).not.toHaveBeenCalled();
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('an editorial shelf (no strategy, no see-more page) is at its end without loading anything', async () => {
    // #1491: the see-more route is keyed on the strategy, so a UUID or
    // GET_STARTED shelf has no page to load — its Load more ends at once.
    // Without the check the route flow would load
    // /browse/music-items/home/recommendation/<uuid> (a route that does not
    // exist), hold the page-flow queue for the capture budget, and throw
    // not-ready — an error on the shelf instead of its end.
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: oneSeeMorePage([albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast')])
    });
    const resolver = instantiateAmazonPlugin(axe);
    for (const id of ['uri:///recommendations/browse-home/6a0d8250-d85c-42c0-868a-01dc91991473', 'uri:///recommendations/browse-home/GET_STARTED']) {
      await expect(resolver.expandRecommendationSection(id, null, {})).resolves.toEqual({ items: [], nextCursor: null });
    }
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a fresh template replays with the id/afterCursor patched — the SEE-MORE id, hash and firstLimit intact', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: oneSeeMorePage([albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal')], { hasNextPage: true, endCursor: null, token: 'music-home_mp3PrimeAlbumsStrategy.20' })
    });
    const resolver = instantiateAmazonPlugin(axe);
    // Mint the template with one expansion.
    await resolver.expandRecommendationSection(SECTION_ID, null, {});
    resolver._seeMorePages = new Map();
    ws.sentRequests.length = 0;
    const page = await resolver.expandRecommendationSection(SECTION_ID, 'music-home_mp3PrimeAlbumsStrategy.20', {});
    expect(page.items[0]).toMatchObject({ type: 'album', name: 'Sons of Northern Darkness' });
    expect(page.nextCursor).toBe('music-home_mp3PrimeAlbumsStrategy.20');
    expect(ws.sentRequests.length).toBe(1);
    const body = ws.sentRequests[0];
    // The id patch is the SEE-MORE id: the browse-home prefix even for a
    // music-home section — never the section's own uri.
    expect(body.variables.id).toBe(SEE_MORE_ID);
    expect(body.variables.afterCursor).toBe('music-home_mp3PrimeAlbumsStrategy.20');
    expect(body.variables.firstLimit).toBe(20);
    expect(body.extensions.persistedQuery.sha256Hash).toBe('seemorehash');
    // The stored template is not mutated by the patch.
    expect(resolver._seeMoreTemplate.body.variables.id).toBe(SEE_MORE_ID);
  });

  test('the first page (no cursor) drops the afterCursor variable', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: oneSeeMorePage([albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast')], { hasNextPage: false, endCursor: null, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.expandRecommendationSection(SECTION_ID, null, {});
    expect(ws.sentRequests[0].variables).not.toHaveProperty('afterCursor');
  });

  test('a cold template loads the see-more ROUTE (first page), mints the template, and replays the cursor page with it', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async (body) => (body.variables.afterCursor
        ? amazonSeeMoreData([albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal')], { hasNextPage: false, endCursor: null, token: null })
        : amazonSeeMoreData([albumNode('B0G2TSTWXD', 'Tempelschlaf', 'The Ruins Of Beverast')], { hasNextPage: true, endCursor: null, token: 'music-home_mp3PrimeAlbumsStrategy.20' }))
    });
    const resolver = instantiateAmazonPlugin(axe);
    const page = await resolver.expandRecommendationSection(SECTION_ID, 'music-home_mp3PrimeAlbumsStrategy.20', {});
    expect(page.items[0].name).toBe('Sons of Northern Darkness');
    expect(page.nextCursor).toBeNull();
    // The route loaded, and its first page + the cursor page are the replays.
    expect(ws.load.mock.calls.map(c => c[1])).toEqual(['https://music.amazon.com/browse/music-items/home/recommendation/music-home_mp3PrimeAlbumsStrategy']);
    expect(resolver._seeMoreTemplate.body.extensions.persistedQuery.sha256Hash).toBe('seemorehash');
    expect(ws.sentRequests.length).toBe(2);
    expect(ws.sentRequests[1].variables.afterCursor).toBe('music-home_mp3PrimeAlbumsStrategy.20');
    // The page is cached: a second identical expansion does not fetch again.
    const again = await resolver.expandRecommendationSection(SECTION_ID, 'music-home_mp3PrimeAlbumsStrategy.20', {});
    expect(again.items[0].name).toBe('Sons of Northern Darkness');
    expect(ws.sentRequests.length).toBe(2);
  });

  test('the page cache evicts at SEE_MORE_CACHE_MAX (40): the oldest inserted key goes first', async () => {
    // The cache is a plain Map walked in INSERTION order (cacheSeeMorePage's
    // keys().next()), not LRU — a cached key is served without re-insertion —
    // so the 41st distinct section+cursor costs the OLDEST key its slot.
    const ws = amazonRecommendationsMock({
      seeMorePage: oneSeeMorePage([albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal')], { hasNextPage: false, endCursor: null, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    // The first page (no cursor) mints the template and takes the oldest slot.
    await resolver.expandRecommendationSection(SECTION_ID, null, {});
    // 41 distinct cursor pages — one cache key each — all served by the fresh
    // template's fast replay.
    for (let i = 0; i < 41; i++) {
      await resolver.expandRecommendationSection(SECTION_ID, 'cursor' + i, {});
    }
    // 42 pages against 40 slots: the two oldest keys were evicted; the newest
    // 40 remain.
    expect(resolver._seeMorePages.size).toBe(40);
    expect(resolver._seeMorePages.has(SECTION_ID + '|')).toBe(false);
    expect(resolver._seeMorePages.has(SECTION_ID + '|cursor0')).toBe(false);
    expect(resolver._seeMorePages.has(SECTION_ID + '|cursor40')).toBe(true);
    // The evicted key re-fetches; a retained one is a cache hit.
    const replays = ws.sentRequests.length;
    await resolver.expandRecommendationSection(SECTION_ID, 'cursor40', {});
    expect(ws.sentRequests.length).toBe(replays);
    await resolver.expandRecommendationSection(SECTION_ID, null, {});
    expect(ws.sentRequests.length).toBe(replays + 1);
  });

  test('the route flow never mints or returns a DIFFERENT section\'s echo (variables.id guard)', async () => {
    // Our own concurrent template replay of ANOTHER section, echoing into the
    // capture with the FRESHER csrf-ts than the page's own request.
    const otherSectionBody = amazonSeeMoreCapture({ id: 'uri:///recommendations/browse-home/music-home_newReleasesForYouStrategy', csrfTs: '9999', echo: true });
    const own = amazonSeeMoreCapture({ csrfTs: '2000' });
    const ws = amazonRecommendationsMock({
      capturesFor: () => [otherSectionBody, own],
      seeMorePage: oneSeeMorePage([albumNode('B07QYGJGVC', 'Sons of Northern Darkness', 'Immortal')], { hasNextPage: false, endCursor: null, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const page = await resolver.expandRecommendationSection(SECTION_ID, null, {});
    expect(page.items[0].name).toBe('Sons of Northern Darkness');
    // Minted from the page's own request — not the fresher echo. The echoed
    // id differs from the mapped see-more id, so it is rejected.
    expect(resolver._seeMoreTemplate.headers['csrf-ts']).toBe('2000');
    expect(resolver._seeMoreTemplate.body.variables.id).toBe(SEE_MORE_ID);
    expect(ws.sentRequests[0].variables.id).toBe(SEE_MORE_ID);
  });

  test('a section with nothing more answers empty (a miss, not an error)', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async () => amazonMusicHomeData([albumSection(SECTION_ID, 'Albums for You')]),
      seeMorePage: async () => amazonSeeMoreData([], { hasNextPage: false, endCursor: null, token: null })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.expandRecommendationSection(SECTION_ID, null, {})).resolves.toEqual({ items: [], nextCursor: null });
  });

  test('an empty or segment-less id answers a quiet miss — never a request', async () => {
    const ws = amazonRecommendationsMock({ seeMorePage: async () => amazonSeeMoreData([]) });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.expandRecommendationSection('', null, {})).resolves.toEqual({ items: [], nextCursor: null });
    // #1491: any id whose last path segment doesn't end in Strategy (a
    // segment-less one included) has no see-more page — its Load more is at
    // its end at once, never a request. A bare strategy IS a valid section
    // id (the helpers accept the full uri or the strategy).
    await expect(resolver.expandRecommendationSection('///', null, {})).resolves.toEqual({ items: [], nextCursor: null });
    expect(ws.pageFetch).not.toHaveBeenCalled();
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('a structural see-more response is not-ready, never a cached miss', async () => {
    const ws = amazonRecommendationsMock({
      seeMorePage: async () => ({ data: { user: { tier: 'UNLIMITED' } } }) // no data.recommender
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.expandRecommendationSection(SECTION_ID, null, {})).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
  });
});

// ── The session caches and the generation drop (sign-out) ──────────────────

describe('the session caches and the generation drop', () => {
  test('the generation bump (a sign-out the plugin cannot see) drops the caches, the templates and the home variant', async () => {
    const ws = amazonRecommendationsMock({
      homePage: async (body) => (body.operationName === 'MusicHomePage'
        ? { status: 294, text: {} }
        : amazonMusicHomeData([{ id: 'uri:///recommendations/browse-home/browse-home_mp3YmlRecentPlaybackStrategy', name: 'Based on Your Recents', recommendedContent: { edges: [{ node: albumNode('B0DTRR4VWM', 'Lonely People With Power', 'Deafheaven') }] } }])),
      seeMorePage: oneSeeMorePage([playlistNode('PP1', 'A Mix')], { hasNextPage: false, endCursor: null, token: null }, 'Playlists for You')
    });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getRecommendations({});
    // The session read a 294 on the music tab: the variant switched, and the
    // caches/templates hold the browse-home state.
    expect(resolver._musicHomeVariant).toBe('browse');
    expect(resolver._recommendationsCache).toBeTruthy();
    expect(resolver._musicHomeTemplate).toBeTruthy();
    expect(resolver._seeMoreTemplate).toBeTruthy();
    expect(resolver._seeMorePages.size).toBeGreaterThan(0);
    // The sign-out: the host's clear() bumps the generation, the next state
    // read observes it, and every recommendation cache drops — the templates
    // embed the old session's csrf headers and the parsed content is the old
    // account's. The next account may read the music tab.
    ws.state.mockResolvedValue({ success: true, url: 'https://music.amazon.com/music', signInUrl: null, cookieNames: ['at-main'], generation: 1 });
    resolver._recommendationsCache = { sections: [], fetchedAt: Date.now() }; // as if cached a moment ago
    const out = await resolver.getRecommendations({});
    expect(out.sections.map(s => s.title)).toEqual(['Based on Your Recents', 'Playlists for You']);
    // The variant reset: the walk loaded the MUSIC tab first again.
    expect(ws.load.mock.calls.map(c => c[1])).toContain('https://music.amazon.com/music');
    expect(resolver._musicHomeVariant).toBe('browse'); // the 294 re-applied for this account
  });
});

// ── The _lib helpers (moved out of amazon-music-logic.test.js, whose host
// copies died with the flow) ────────────────────────────────────────────────

describe('the _lib recommendations helpers', () => {
  const lib = instantiateAmazonPlugin(axe).lib;

  const image = (id, w, h, type = 'PRIMARY') => ({ id, url: `https://m.media-amazon.com/images/I/${id}.jpg`, width: w, height: h, imageType: type, __typename: 'Image' });
  const artistConn = (names) => ({
    edges: names.map(([name, role]) => ({ role: role || 'PRIMARY', node: { name, __typename: 'Artist', id: 'B' + name.slice(0, 8).toUpperCase() }, __typename: 'ArtistEdge' })),
    __typename: 'ArtistConnection'
  });
  const trackNode = (id, title, artists, album) => ({
    __typename: 'Track', id,
    uri: `mrn:1.0:catalog:track:asin:${id}?territory=US`,
    title, shortTitle: title,
    images: [image(id + 'A', 1448, 1448)],
    playParams: { id: `mrn:1.0:catalog:track:asin:${id}?territory=US`, selections: ['PLAY', 'SHUFFLE'], __typename: 'PlayParams' },
    playbackInformation: { videoId: null, __typename: 'PlaybackInformation' },
    mediaType: 'AUDIO',
    parentalSettings: { hasExplicitLanguage: false, __typename: 'ParentalSettings' },
    url: `https://music.amazon.com/tracks/${id}/?ref=dm_wtyd_direct_uni`,
    contributingArtists: artistConn(artists),
    duration: 394,
    album: { id: album[1], __typename: 'Album', uri: `mrn:1.0:catalog:album:asin:${album[1]}?territory=US`, shortTitle: album[0], url: `https://music.amazon.com/albums/${album[1]}?ref=dm_wtyd` }
  });
  const albumNode = (id, title, artists) => ({
    __typename: 'Album', id,
    uri: `mrn:1.0:catalog:album:asin:${id}?territory=US`,
    title, shortTitle: title,
    images: [image(id + 'A', 2560, 2560)],
    playParams: { id: `mrn:1.0:catalog:album:asin:${id}?territory=US`, selections: ['PLAY'], __typename: 'PlayParams' },
    parentalSettings: { hasExplicitLanguage: false, __typename: 'ParentalSettings' },
    url: `https://music.amazon.com/albums/${id}?ref=dm_wtyd`,
    contributingArtists: artistConn(artists),
    likesContext: { state: 'NEUTRAL', __typename: 'LikesContext' }
  });
  const audiobookNode = (id, title) => ({
    __typename: 'Audiobook', id, title,
    images: [image(id + 'A', 500, 500)],
    uri: `mrn:1.0:audible:audiobook:asin:${id}?marketplaceid=AF2M0KC94RCEA`,
    url: `https://music.amazon.com/audiobooks/${id}?ref=dm_wtyd`
  });
  const sectionNode = (id, name, items, itemType = 'MIXED') => ({
    id,
    __typename: 'Recommendation',
    name,
    description: null,
    itemType,
    tags: ['TEMPLATE:VISUAL_SHOVELER', 'spere-recommender'],
    recommendedContent: {
      edges: items.map(node => ({ __typename: 'EntityEdge', node })),
      pageInfo: { hasNextPage: false, endCursor: null, token: '[redacted]', __typename: 'PageInfo' },
      __typename: 'EntityConnection'
    }
  });

  describe('the replay templates (makeSpecSearchTemplate / specTemplateIsFresh)', () => {
    const capture = (over = {}) => ({
      url: 'https://gql.music.amazon.com/',
      headers: { 'x-api-key': 'key', 'csrf-token': 'tok', Cookie: 'session' },
      body: {
        operationName: 'MusicHomePage',
        variables: { firstLimit: 5, type: 'music-home', isAuthenticated: true },
        extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'abc123' } }
      },
      ...over
    });

    test('makeSpecSearchTemplate keeps url/headers/body/capturedAt, deep-cloned', () => {
      const body = capture().body;
      const t = lib.makeSpecSearchTemplate({ url: 'https://gql.music.amazon.com/', headers: { a: 1 }, body, capturedAt: 123 });
      expect(t.capturedAt).toBe(123);
      expect(t.body).toEqual(body);
      expect(t.body).not.toBe(body); // deep-cloned: a later capture mutation cannot alias in
      t.body.variables.firstLimit = 20;
      expect(body.variables.firstLimit).toBe(5);
      expect(t.headers).toEqual({ a: 1 });
    });

    test('makeSpecSearchTemplate refuses request shapes a replay cannot use', () => {
      const noHash = { operationName: 'MusicHomePage', variables: {}, extensions: {} };
      const noVars = { operationName: 'MusicHomePage', extensions: { persistedQuery: { sha256Hash: 'x' } } };
      expect(lib.makeSpecSearchTemplate({ url: null, headers: {}, body: {} })).toBeNull();
      expect(lib.makeSpecSearchTemplate({ url: 'https://x', headers: {}, body: {} })).toBeNull();
      expect(lib.makeSpecSearchTemplate({ url: 'https://x', headers: {}, body: noHash })).toBeNull();
      expect(lib.makeSpecSearchTemplate({ url: 'https://x', headers: {}, body: noVars })).toBeNull();
    });

    test('specTemplateIsFresh gates on shape and the age cap', () => {
      const t = lib.makeSpecSearchTemplate({ url: 'https://gql.music.amazon.com/', headers: {}, body: capture().body, capturedAt: 1000000 });
      expect(lib.specTemplateIsFresh(t, 1000000 + 1000)).toBe(true);
      expect(lib.specTemplateIsFresh(t, 1000000 + 24 * 60 * 60 * 1000 - 1)).toBe(true);
      expect(lib.specTemplateIsFresh(t, 1000000 + 24 * 60 * 60 * 1000)).toBe(false);
      expect(lib.specTemplateIsFresh(null)).toBe(false);
      expect(lib.specTemplateIsFresh({})).toBe(false);
      expect(lib.specTemplateIsFresh({ ...t, url: '' })).toBe(false);
      expect(lib.specTemplateIsFresh({ ...t, headers: null })).toBe(false);
      expect(lib.specTemplateIsFresh({ ...t, body: null })).toBe(false);
    });
  });

  describe('amazonMusicHomeRequest', () => {
    const req = (opName, vars) => JSON.stringify({ operationName: opName, variables: vars, extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'a'.repeat(64) } } });

    test('matches the page own MusicHomePage request among everything the page fires', () => {
      const bodies = [
        JSON.stringify({ operationName: 'IdentityStoreSeed', variables: {} }),
        req('MusicHomePage', { firstLimit: 5, recommenderItemLimit: 15, type: 'music-home', topRecommenderId: 'musicTopOneRecommender', isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false, paginating: false }),
        JSON.stringify({ operationName: 'Transport', variables: {} })
      ];
      expect(lib.amazonMusicHomeRequest(bodies).operationName).toBe('MusicHomePage');
      expect(lib.amazonMusicHomeRequest(bodies).variables.recommenderItemLimit).toBe(15);
    });

    test('the LAST match wins (a re-render fires it again with fresher headers)', () => {
      const bodies = [req('MusicHomePage', { firstLimit: 1 }), req('MusicHomePage', { firstLimit: 5 })];
      expect(lib.amazonMusicHomeRequest(bodies).variables.firstLimit).toBe(5);
    });

    test('no MusicHomePage → null; the full home op is asked for by name (the refused-music-tab fallback, #1328)', () => {
      expect(lib.amazonMusicHomeRequest([JSON.stringify({ operationName: 'BrowseHomePage', variables: {} })])).toBeNull();
      expect(lib.amazonMusicHomeRequest([JSON.stringify({ operationName: 'BrowseHomePage', variables: { firstLimit: 5 } })], 'BrowseHomePage').variables.firstLimit).toBe(5);
      expect(lib.amazonMusicHomeRequest([JSON.stringify({ operationName: 'MusicHomePage', variables: {} })], 'BrowseHomePage')).toBeNull();
      expect(lib.amazonMusicHomeRequest([JSON.stringify({ operationName: 'Transport', variables: {} })])).toBeNull();
      expect(lib.amazonMusicHomeRequest([])).toBeNull();
      expect(lib.amazonMusicHomeRequest(['not json'])).toBeNull();
    });
  });

  describe('recommendationsFromMusicHome', () => {
    const response = (sections, extra = {}) => ({
      user: { id: 'u', tier: 'UNLIMITED', __typename: 'User' },
      t1r: { id: 'musicTopOneRecommender', __typename: 'RecommendationCollection', recommendationConnection: { edges: [{ node: { id: 'uri:///recommendations/music-home/playMusic', __typename: 'Recommendation', parentContainer: { node: { __typename: 'Station', id: 'A1ESXGJW9GSMCX', name: 'My Soundtrack' }, __typename: 'ParentContainerEdge' }, recommendedContent: { edges: [{ node: trackNode('B002S3FW6Y', 'Geneva', [['Russian Circles']], ['Empros', 'B005S3FW6Y']) }], __typename: 'EntityConnection' } } }] } },
      // A genre edge whose node WOULD map (an Album) if the parser ever
      // pointed at data.genres — pins that genres never reach the sections.
      genres: [{ id: '1|G|GROUPING_GENRE', __typename: 'Recommendation', recommendedContent: { edges: [{ node: albumNode('B00CXS55LG', 'Sunbather', [['Deafheaven']]) }] } }],
      browse: { id: 'uri:///browse/home', __typename: 'RecommendationCollection', recommendationConnection: { edges: sections.map(s => ({ node: s, __typename: 'RecommendationEdge' })), pageInfo: (extra.pageInfo !== undefined ? extra.pageInfo : { hasNextPage: false, endCursor: null, token: null }), __typename: 'RecommendationConnection' } },
      ...({ pageInfo: undefined, ...extra })
    });

    test('maps the home page sections to titled provider sections', () => {
      const data = response([
        sectionNode('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy', 'Albums for You', [
          albumNode('B0G2TSTWXD', 'Tempelschlaf', [['The Ruins Of Beverast']]),
          albumNode('B0G64M7J2C', 'The Crawl [Explicit]', [['Temple of Void']])
        ], 'ALBUM')
      ]);
      const out = lib.recommendationsFromMusicHome(data);
      expect(out.envelope).toBe(true);
      expect(out.sections).toHaveLength(1);
      expect(out.sections[0]).toMatchObject({
        id: 'uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy',
        title: 'Albums for You'
      });
      expect(out.sections[0].items[0]).toMatchObject({
        type: 'album', id: 'B0G2TSTWXD', name: 'Tempelschlaf', artist: 'The Ruins Of Beverast',
        imageUrl: 'https://m.media-amazon.com/images/I/B0G2TSTWXDA.jpg',
        url: 'https://music.amazon.com/albums/B0G2TSTWXD'
      });
      expect(out.sections[0].items[1]).toMatchObject({ type: 'album', name: 'The Crawl', artist: 'Temple of Void' });
    });

    test('a mixed section carries songs, albums and artists; the explicit marker is stripped from titles', () => {
      const data = response([
        sectionNode('uri:///recommendations/music-home/music-home_mp3YourHeaviestListeningStrategy', 'Your Frequent Plays', [
          trackNode('B0DTRL3P23', 'Doberman [Explicit]', [['Deafheaven']], ['Lonely People With Power', 'B0DTRR4VWM']),
          albumNode('B00CXS55LG', 'Sunbather', [['Deafheaven']]),
          { __typename: 'Artist', id: 'B004RUHJBC', name: 'Deafheaven', images: [image('81z2TKR2HlL', 2560, 1920, 'BACKGROUND'), image('31mOw69votL', 500, 500, 'PROFILE')], url: 'https://music.amazon.com/artists/B004RUHJBC?ref=dm_wtyd' }
        ], 'MIXED')
      ]);
      const out = lib.recommendationsFromMusicHome(data);
      const items = out.sections[0].items;
      expect(items.map(i => i.type)).toEqual(['song', 'album', 'artist']);
      expect(items[0]).toMatchObject({ type: 'song', name: 'Doberman', artist: 'Deafheaven', duration: 394, url: 'https://music.amazon.com/tracks/B0DTRL3P23/' });
      expect(items[2]).toMatchObject({ type: 'artist', name: 'Deafheaven', imageUrl: 'https://m.media-amazon.com/images/I/31mOw69votL.jpg', url: 'https://music.amazon.com/artists/B004RUHJBC' });
    });

    test('sections with only non-music nodes disappear; data.t1r is never mapped', () => {
      const data = response([
        sectionNode('uri:///recommendations/music-home/audiobooksForYouLapsedT2', 'Audiobooks for You', [
          audiobookNode('B0F154ZCSN', 'Harry Potter'), audiobookNode('B01N4S7VVP', 'Fantastic Beasts')
        ], 'AUDIOBOOK'),
        sectionNode('uri:///recommendations/music-home/music-home_newReleasesForYouStrategy', 'New Releases for You', [
          albumNode('B0H3LTPPRH', 'Empty on the Inside', [['Entheos']])
        ], 'ALBUM')
      ]);
      const out = lib.recommendationsFromMusicHome(data);
      expect(out.sections.map(s => s.title)).toEqual(['New Releases for You']);
    });

    test('an absent data.browse is a structural miss (envelope false), not an empty page', () => {
      expect(lib.recommendationsFromMusicHome({ user: { tier: 'UNLIMITED' }, t1r: {} }).envelope).toBe(false);
      expect(lib.recommendationsFromMusicHome(null).envelope).toBe(false);
    });

    test('the home connection cursor rides on the parse (hasNextPage + token; the endCursor decoy ignored)', () => {
      const data = response([sectionNode('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy', 'Albums for You', [albumNode('B0G2TSTWXD', 'Tempelschlaf', [['The Ruins Of Beverast']])], 'ALBUM')], { pageInfo: { hasNextPage: true, endCursor: null, token: '20' } });
      expect(lib.recommendationsFromMusicHome(data).nextCursor).toBe('20');
      // hasNextPage false, or no token: the walk ends.
      expect(lib.recommendationsFromMusicHome(response([], { pageInfo: { hasNextPage: false, endCursor: null, token: '20' } })).nextCursor).toBeNull();
      expect(lib.recommendationsFromMusicHome(response([], { pageInfo: { hasNextPage: true, endCursor: 'decoy', token: null } })).nextCursor).toBeNull();
    });
  });

  describe('musicHomeBodyWithVars / mergeMusicHomeSectionPages', () => {
    test('the body clone patches firstLimit and afterCursor; page 1 drops the afterCursor variable', () => {
      const body = { operationName: 'MusicHomePage', variables: { firstLimit: 5, type: 'music-home', paginating: false }, extensions: { persistedQuery: { sha256Hash: 'h' } } };
      const first = lib.musicHomeBodyWithVars(body, { firstLimit: 20, afterCursor: null });
      expect(first.variables.firstLimit).toBe(20);
      expect(first.variables.afterCursor).toBeUndefined();
      expect(first.variables.type).toBe('music-home');
      expect(first.extensions.persistedQuery.sha256Hash).toBe('h');
      const second = lib.musicHomeBodyWithVars(body, { firstLimit: 20, afterCursor: '20' });
      expect(second.variables.afterCursor).toBe('20');
      // Everything the patch does not touch survives the clone verbatim (the
      // "replay verbatim" rule: the page's own feature flags ride the capture).
      const rich = { ...body, variables: { ...body.variables, audiobooksEnabled: true, merchEnabled: true, paginating: false } };
      const patched = lib.musicHomeBodyWithVars(rich, { firstLimit: 20, afterCursor: '20' });
      expect(patched.variables.audiobooksEnabled).toBe(true);
      expect(patched.variables.merchEnabled).toBe(true);
      expect(patched.variables.paginating).toBe(false);
      expect(patched.variables.firstLimit).toBe(20);
      // The original body is untouched.
      expect(body.variables.firstLimit).toBe(5);
      expect(body.variables.afterCursor).toBeUndefined();
    });

    test('the page merge dedupes by section id in first-appearance order (offset pages re-serve re-ranked sections)', () => {
      const page = (ids) => ({ sections: ids.map(id => ({ id, title: id })) });
      const merged = lib.mergeMusicHomeSectionPages([page(['a', 'b']), page(['a', 'c']), page([])]);
      expect(merged.map(s => s.id)).toEqual(['a', 'b', 'c']);
      expect(lib.mergeMusicHomeSectionPages(null)).toEqual([]);
    });
  });

  describe('the see-more route helpers', () => {
    test('the strategy id is the last uri segment; the see-more URL is the SPA route', () => {
      expect(lib.recommendationStrategyId('uri:///recommendations/browse-home/browse-home_playlistStrategy')).toBe('browse-home_playlistStrategy');
      expect(lib.recommendationStrategyId('browse-home_playlistStrategy')).toBe('browse-home_playlistStrategy');
      expect(lib.recommendationStrategyId('')).toBeNull();
      expect(lib.amazonSeeMorePageUrl('uri:///recommendations/browse-home/browse-home_newReleasesForYouStrategy'))
        .toBe('https://music.amazon.com/browse/music-items/home/recommendation/browse-home_newReleasesForYouStrategy');
      expect(lib.amazonSeeMorePageUrl('')).toBeNull();
    });

    test('seeMoreSectionIdFor: the see-more REQUEST always carries the browse-home prefix — even for a music-home strategy', () => {
      // Live-verified 2026-11: a music-home section's own id is
      // uri:///recommendations/music-home/<strategy>, but its see-more request
      // asks for uri:///recommendations/browse-home/<strategy> — the echo guard
      // and the replay's id patch key on the mapped id.
      expect(lib.seeMoreSectionIdFor('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy'))
        .toBe('uri:///recommendations/browse-home/music-home_mp3PrimeAlbumsStrategy');
      expect(lib.seeMoreSectionIdFor('music-home_newReleasesForYouStrategy'))
        .toBe('uri:///recommendations/browse-home/music-home_newReleasesForYouStrategy');
      // Browse-home ids (the playlists strategy) are already in this form.
      expect(lib.seeMoreSectionIdFor('uri:///recommendations/browse-home/browse-home_playlistStrategy'))
        .toBe('uri:///recommendations/browse-home/browse-home_playlistStrategy');
      expect(lib.seeMoreSectionIdFor('')).toBeNull();
      // The route URL keys on the strategy suffix, so a music-home section's
      // route works from its own id.
      expect(lib.amazonSeeMorePageUrl('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy'))
        .toBe('https://music.amazon.com/browse/music-items/home/recommendation/music-home_mp3PrimeAlbumsStrategy');
    });

    test('amazonSeeMoreRequest matches the route page own request, last match wins', () => {
      const req = (opName, vars) => JSON.stringify({ operationName: opName, variables: vars, extensions: { persistedQuery: { version: 1, sha256Hash: 'b'.repeat(64) } } });
      const bodies = [
        JSON.stringify({ operationName: 'AppChromeHeaderLeft', variables: {} }),
        req('RecommenderSeeMorePage', { id: 'uri:///recommendations/browse-home/browse-home_playlistStrategy', firstLimit: 20, isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false }),
        JSON.stringify({ operationName: 'KidsMode', variables: {} })
      ];
      expect(lib.amazonSeeMoreRequest(bodies).operationName).toBe('RecommenderSeeMorePage');
      expect(lib.amazonSeeMoreRequest(bodies).variables.id).toBe('uri:///recommendations/browse-home/browse-home_playlistStrategy');
      expect(lib.amazonSeeMoreRequest([req('KidsMode', {})])).toBeNull();
    });

    test('seeMoreBodyWithVars patches id/afterCursor and nothing else', () => {
      const body = {
        operationName: 'RecommenderSeeMorePage',
        variables: { id: 'uri:///recommendations/browse-home/browse-home_playlistStrategy', firstLimit: 20, isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false, afterCursor: 'browse-home_playlistStrategy.15' },
        extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: 'c'.repeat(64) } }
      };
      const patched = lib.seeMoreBodyWithVars(body, { sectionId: 'uri:///recommendations/browse-home/otherStrategy', afterCursor: 'otherStrategy.20' });
      expect(patched.variables.id).toBe('uri:///recommendations/browse-home/otherStrategy');
      expect(patched.variables.afterCursor).toBe('otherStrategy.20');
      expect(patched.variables.firstLimit).toBe(20);
      expect(patched.variables.isAuthenticated).toBe(true);
      expect(patched.extensions.persistedQuery.sha256Hash).toBe('c'.repeat(64));
      // The input body is not mutated
      expect(body.variables.id).toBe('uri:///recommendations/browse-home/browse-home_playlistStrategy');
      // No afterCursor → the variable is dropped (the first page of a section)
      const first = lib.seeMoreBodyWithVars(body, { sectionId: 'uri:///recommendations/browse-home/otherStrategy' });
      expect(first.variables).not.toHaveProperty('afterCursor');
    });
  });

  describe('recommendationsFromSeeMore', () => {
    const seeMoreResponse = (edges, pageInfo) => ({
      recommender: {
        edges: [{
          node: {
            id: 'uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy',
            name: 'Albums for You',
            __typename: 'Recommendation',
            recommendedContent: { edges: edges.map(node => ({ __typename: 'EntityEdge', node })), pageInfo, __typename: 'EntityConnection' }
          },
          __typename: 'RecommendationEdge'
        }],
        __typename: 'RecommendationConnection'
      }
    });

    test('maps the section with the offset cursor when there is a next page', () => {
      const data = seeMoreResponse(
        [albumNode('B07QYGJGVC', 'Sons of Northern Darkness', [['Immortal']])],
        { hasNextPage: true, endCursor: null, token: 'browse-home_mp3PrimeAlbumsStrategy.20', __typename: 'PageInfo' }
      );
      const out = lib.recommendationsFromSeeMore(data);
      expect(out.envelope).toBe(true);
      expect(out.section.title).toBe('Albums for You');
      expect(out.section.items[0]).toMatchObject({ type: 'album', name: 'Sons of Northern Darkness', artist: 'Immortal' });
      expect(out.nextCursor).toBe('browse-home_mp3PrimeAlbumsStrategy.20');
    });

    test('no next page → null cursor (the endCursor decoy is never used)', () => {
      const data = seeMoreResponse([albumNode('B0G2TSTWXD', 'Tempelschlaf', [['The Ruins Of Beverast']])],
        { hasNextPage: false, endCursor: '99:dfeab136', token: '[redacted]', __typename: 'PageInfo' });
      const out = lib.recommendationsFromSeeMore(data);
      expect(out.nextCursor).toBeNull();
      expect(out.section.items).toHaveLength(1);
    });

    test('an absent data.recommender is structural; an empty connection is a real nothing-more', () => {
      expect(lib.recommendationsFromSeeMore({}).envelope).toBe(false);
      expect(lib.recommendationsFromSeeMore(null).envelope).toBe(false);
      expect(lib.recommendationsFromSeeMore({ recommender: { edges: [] } })).toMatchObject({ envelope: true, section: null, nextCursor: null });
    });
  });

  describe('capturedOperationNames', () => {
    test('lists the distinct gql operations the page fired, for the miss log', () => {
      const bodies = [
        JSON.stringify({ operationName: 'playlistDetail', variables: { id: 'PP1' } }),
        JSON.stringify([{ operationName: 'bootstrap' }, { operationName: 'playlistDetail', variables: { id: 'PP2' } }]),
        'not json',
        JSON.stringify({ noOperationName: true })
      ];
      expect(lib.capturedOperationNames(bodies)).toEqual(['playlistDetail', 'bootstrap']);
      expect(lib.capturedOperationNames([])).toEqual([]);
      expect(lib.capturedOperationNames(null)).toEqual([]);
    });
  });

  describe('isAmazonMusicPage', () => {
    test('only the music.amazon.com origin is an Amazon Music page', () => {
      expect(lib.isAmazonMusicPage('https://music.amazon.com/music')).toBe(true);
      expect(lib.isAmazonMusicPage('https://music.amazon.com/ap/signin')).toBe(true);
      expect(lib.isAmazonMusicPage('https://evil.example/playlists/PP1')).toBe(false);
      expect(lib.isAmazonMusicPage('https://music.amazon.com.evil.example/')).toBe(false);
      expect(lib.isAmazonMusicPage('not a url')).toBe(false);
    });
  });
});
