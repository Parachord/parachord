/**
 * The Amazon plugin's catalog flows (#1356 M6; plugins-src/amazonmusic/
 * implementation.js): the album search, the album lookup and the artist-image
 * lookup, moved from amazon-web-player.js onto the window.electron.webSession
 * bridge — driven here against the mocked bridge exactly like the track search
 * in amazon-music-plugin-spec-search.test.js. The pure parsers the flows use
 * (their cases moved out of amazon-music-logic.test.js, whose host copies
 * died with the flows) are pinned here against the plugin's _lib copies.
 *
 * Pinned here (docs/architecture/amazon-music.md, "Album search and lookup"
 * and "Artist images" — the sections are the spec):
 *   - the album search rides the SAME spec-search runner as the track search,
 *     on the albums tab with the album spec; NOT plan-gated (a Prime account
 *     still gets albums — the plan gate stops playback, not discovery)
 *   - the artist image rides the runner with its never-throw wrapper: not
 *     signed in is null WITHOUT a request, the runner's structural notReady
 *     degrades to null, and the #1135 staleness check skips the page load
 *   - the album lookup is its own flow: the candidate-ranking replay over
 *     webSession.load + webSession.pageFetch, the winner judged by
 *     albumTracksConnectionIn (AlbumSeo's header-only response is logged and
 *     skipped), the miss/lookup-failed/not-found semantics, and the
 *     per-disc numbering with no pageInfo to follow — and the capture
 *     window's own shape: the doneWhen early stop ending it AT the detail op
 *     (the load opts carry the needle) with the album quiet window as the
 *     fallback, and the TOTAL flow time measured against the renderer's 8s
 *     catalog step (CATALOG_STEP_TIMEOUT_MS) on both paths, the drift guard
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
  amazonAlbumSpecEnvelope,
  amazonArtistSpecEnvelope
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

const ALBUMS = [
  { asin: 'B0FMW6FYGN', name: 'Dulling The Horns (Deluxe Edition)', artist: 'Wild Pink', albumArt: 'https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg', explicit: true },
  { asin: 'B07CMLR17Z', name: 'Yolk in the Fur', artist: 'Wild Pink', albumArt: 'https://m.media-amazon.com/images/I/61t5hojNMAL.jpg', explicit: false }
];

const photo = (id, width, imageType = 'PROFILE') => ({
  url: 'https://m.media-amazon.com/images/I/' + id + '.jpg', width, height: width, imageType
});
const ARTISTS = [
  { asin: 'B000U7ZTW2', name: 'Fates Warning', images: [photo('71rGf-BOhvL', 2560), photo('418N-wFRGiL', 500)] },
  { asin: 'B00V07PBMY', name: 'The Warning', images: [photo('9160a4z-YNL', 2549, 'BACKGROUND'), photo('41mVLfnDeyL', 500), photo('71KKtoQJVeL', 1366)] }
];

const resolverAlbum = (a) => ({
  id: 'amazonmusic-album-' + a.asin,
  name: a.name,
  artist: a.artist,
  albumArt: a.albumArt,
  releaseDate: null,
  trackCount: null,
  url: 'https://music.amazon.com/albums/' + a.asin,
  explicit: !!a.explicit
});

const searchAlbums = (resolver, query) => resolver.searchAlbums(query, {});

afterEach(() => {
  delete global.window;
});

// ── The album search: the same runner, the albums tab ───────────────────────

describe('searchAlbums (the albums tab of the spec search)', () => {
  test('loads the albums tab with the album spec and maps the rows to the albumSearch contract', async () => {
    const ws = amazonWebSessionMock({ albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    const albums = await searchAlbums(resolver, { artist: 'Wild Pink', title: 'Dulling the Horns' });
    expect(albums).toEqual([resolverAlbum(ALBUMS[0]), resolverAlbum(ALBUMS[1])]);
    expect(ws.load).toHaveBeenCalledTimes(1);
    const [sessionId, url, opts] = ws.load.mock.calls[0];
    expect(sessionId).toBe('amazon-music');
    // The same quoted-or query as the track search, on the /albums tab.
    expect(url).toBe('https://music.amazon.com/search/' + encodeURIComponent('"Dulling the Horns" by "Wild Pink" OR "Dulling the Horns" "Wild Pink" OR "Wild Pink" "Dulling the Horns"') + '/albums');
    expect(opts.capture.urlPrefixes).toEqual(['https://gql.music.amazon.com/*']);
    // The page's own album-spec request was replayed verbatim.
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(ws.pageFetch.mock.calls[0][1].body);
    expect(body.variables.searchText).toBe('"Dulling the Horns" by "Wild Pink" OR "Dulling the Horns" "Wild Pink" OR "Wild Pink" "Dulling the Horns"');
    expect(body.variables.specType).toBe('album');
    expect(body.extensions.persistedQuery.sha256Hash).toBe('deadbeefhash');
  });

  test('free text passes through trimmed; a too-short or empty query never reaches the bridge', async () => {
    const ws = amazonWebSessionMock({ albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    expect(await searchAlbums(resolver, '  wild pink  ')).toEqual([resolverAlbum(ALBUMS[0]), resolverAlbum(ALBUMS[1])]);
    expect(await searchAlbums(resolver, 'd')).toEqual([]);
    expect(await searchAlbums(resolver, '')).toEqual([]);
    expect(await searchAlbums(resolver, {})).toEqual([]);
    expect(ws.load.mock.calls.length).toBe(1); // only the free-text search
  });

  test('NOT plan-gated: a Prime account still gets albums, and config.json is never read', async () => {
    const ws = amazonWebSessionMock({ albums: ALBUMS, tier: 'PRIME' });
    const resolver = instantiateAmazonPlugin(axe);
    const albums = await searchAlbums(resolver, 'wild pink');
    expect(albums).toEqual([resolverAlbum(ALBUMS[0]), resolverAlbum(ALBUMS[1])]);
    expect(ws.fetch).not.toHaveBeenCalled(); // the plan gate is the track search's
  });

  test('not signed in is notReady not-signed-in before any page load', async () => {
    const ws = amazonWebSessionMock({ albums: ALBUMS, signedIn: false });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(searchAlbums(resolver, 'wild pink')).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a present envelope with no Album edges is a real miss', async () => {
    amazonWebSessionMock({ envelope: { data: { specificationSearch: { result: [{ edges: [] }] } } } });
    const resolver = instantiateAmazonPlugin(axe);
    expect(await searchAlbums(resolver, 'nothing anywhere')).toEqual([]);
  });

  test('a structural failure (the albums tab never searched) is notReady and trips the shared breaker', async () => {
    const ws = amazonWebSessionMock({
      capturesFor: () => [{ url: 'https://gql.music.amazon.com/', method: 'POST', body: JSON.stringify({ operationName: 'MusicHomePage', variables: {} }), headers: { 'x-api-key': 'k' } }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(searchAlbums(resolver, 'wild pink')).rejects.toMatchObject({
        notReady: true,
        code: 'not-ready'
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('MusicHomePage'));
      expect(resolver._searchBreaker.state()).toMatchObject({ failures: 1, open: false });
    } finally {
      warn.mockRestore();
    }
  });

  test('readiness failures throw notReady; the breaker fail-fast is shared with the track search', async () => {
    amazonWebSessionMock({ albums: ALBUMS, loadResult: { success: false, reason: 'load-failed', error: 'page did not finish loading within 30000ms' } });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(searchAlbums(resolver, 'wild pink')).rejects.toMatchObject({
      notReady: true,
      code: 'load-failed'
    });
    // The SAME breaker the track search trips: three album-search structural
    // failures open it and the next TRACK search fails fast without a load.
    amazonWebSessionMock({
      envelope: { data: { specificationSearch: null } }
    });
    const resolver2 = instantiateAmazonPlugin(axe);
    for (let i = 0; i < 3; i++) {
      await expect(searchAlbums(resolver2, 'wild pink')).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
    }
    expect(resolver2._searchBreaker.state().open).toBe(true);
    const ws = amazonWebSessionMock({ tracks: [] });
    const resolver3 = instantiateAmazonPlugin(axe);
    resolver3._searchBreaker = resolver2._searchBreaker;
    await expect(resolver3.search('daft punk', {})).rejects.toMatchObject({ notReady: true, code: 'not-ready' });
    expect(ws.load).not.toHaveBeenCalled();
  });

  test("an error without a listed reason (a requireLib throw) is notReady, never a cached miss — search()'s rule", async () => {
    // "An error is never 'no results'" (playback.md): search() maps every
    // unlisted reason to notReady (more failure classes reach the catch
    // since the runner moved into the plugin), and searchAlbums shares the
    // runner — a miss here would cache a 30-day noMatch against every album
    // page that asked.
    amazonWebSessionMock({ albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    resolver.lib = null; // a host older than the _lib prerequisite (requireLib throws)
    await expect(searchAlbums(resolver, 'wild pink')).rejects.toMatchObject({
      notReady: true,
      code: 'not-ready'
    });
  });

  test('an album search answers off a TRACK-minted template: specType swaps, no page load', async () => {
    // The spec-search template is shared across specs — a track search's page
    // flow mints it, and the album search's fast path patches specType onto
    // it (the same swap that live-verified the album search in the first
    // place). The template itself keeps saying track.
    const ws = amazonWebSessionMock({ tracks: [], albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.search('daft punk', {}); // one track page flow mints the template
    expect(ws.load).toHaveBeenCalledTimes(1);
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    const albums = await searchAlbums(resolver, 'wild pink');
    expect(albums).toEqual([resolverAlbum(ALBUMS[0]), resolverAlbum(ALBUMS[1])]);
    expect(ws.load).not.toHaveBeenCalled();
    const body = JSON.parse(ws.pageFetch.mock.calls[0][1].body);
    expect(body.variables.searchText).toBe('wild pink');
    expect(body.variables.specType).toBe('album');
    expect(resolver._specSearchTemplate.body.variables.specType).toBe('track');
  });

  test('a template dropped by a session-generation bump is never replayed by a queued page flow', async () => {
    // The warmed retry inside the chained page flow re-reads the template
    // AFTER its state read: a sign-out + sign-in as another account between
    // the queue and the run must not send account A's csrf-bearing template
    // into account B's session. The drop (sessionState) nulls the instance
    // field — the snapshot must be re-checked, not trusted.
    const ws = amazonWebSessionMock({ albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    await searchAlbums(resolver, 'wild pink'); // mints the template under generation 0
    const minted = resolver._specSearchTemplate;
    expect(minted).toBeTruthy();
    ws.state.mockResolvedValue({
      success: true,
      url: 'https://music.amazon.com/search/x/albums',
      signInUrl: null,
      cookieNames: ['at-main', 'sess-at-main'],
      generation: 1
    });
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    // specSearch directly (the warmed-retry seam): no isSignedIn first, so
    // the generation bump is first observed inside the retry's own read.
    const rows = await resolver.specSearch({
      url: 'https://music.amazon.com/search/wild%20pink/albums',
      searchText: 'wild pink',
      specType: 'album',
      noun: 'albums',
      parse: (data) => {
        const out = resolver.lib.searchAlbumsFromGql(data);
        return { rows: out.albums, envelope: out.envelope };
      }
    });
    expect(rows).toHaveLength(2);
    // The stale template was NOT replayed (no pageFetch before the load) —
    // the identity re-check sent the flow to its page load, which re-minted.
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(ws.pageFetch).toHaveBeenCalledTimes(1); // the page flow's own replay only
    expect(resolver._specSearchTemplate).not.toBe(minted);
  });

  test('the staleness check short-circuits before path selection — a stale job never replays a warm template', async () => {
    // The entry-time check (before the fast path): a job already past the
    // budget must not even replay from a fresh template, never mind a page
    // load — the caller has moved on either way.
    const ws = amazonWebSessionMock({ albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    await searchAlbums(resolver, 'wild pink'); // mints the template
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    const rows = await resolver.specSearch({
      url: 'https://music.amazon.com/search/wild%20pink/albums',
      searchText: 'wild pink',
      specType: 'album',
      noun: 'albums',
      staleCheck: () => true,
      parse: (data) => {
        const out = resolver.lib.searchAlbumsFromGql(data);
        return { rows: out.albums, envelope: out.envelope };
      }
    });
    expect(rows).toEqual([]);
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a stale job (past the #1135 8s catalog budget) skips its page load and returns []', async () => {
    const ws = amazonWebSessionMock({ albums: ALBUMS });
    const resolver = instantiateAmazonPlugin(axe);
    // Hold the plugin's page-flow queue with a gated job, so the album
    // search queues behind it; then let the 8s budget pass before the queue
    // frees up.
    let releaseChain;
    const gate = new Promise((resolve) => { releaseChain = resolve; });
    resolver.enqueuePageFlow(() => gate); // a gated job holds the page-flow queue
    const base = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const pending = searchAlbums(resolver, 'wild pink');
      await new Promise((r) => setTimeout(r, 0)); // the job reaches the queue wait
      dateSpy.mockReturnValue(base + 8001);
      releaseChain();
      await expect(pending).resolves.toEqual([]);
    } finally {
      dateSpy.mockRestore();
    }
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });
});

// ── The artist image: the same runner, never throwing ───────────────────────

describe('searchArtistImage (the artists tab, never throws)', () => {
  test('rides the runner with the artists tab URL, the artist spec and the exact-name pick', async () => {
    const ws = amazonWebSessionMock({ artists: ARTISTS });
    const resolver = instantiateAmazonPlugin(axe);
    const url = await resolver.searchArtistImage('The Warning', {});
    expect(url).toBe('https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg');
    expect(ws.load).toHaveBeenCalledTimes(1);
    const [sessionId, loadUrl] = ws.load.mock.calls[0];
    expect(sessionId).toBe('amazon-music');
    expect(loadUrl).toBe('https://music.amazon.com/search/' + encodeURIComponent('"The Warning"') + '/artists');
    const body = JSON.parse(ws.pageFetch.mock.calls[0][1].body);
    expect(body.variables.searchText).toBe('"The Warning"');
    expect(body.variables.specType).toBe('artist');
  });

  test('the photo pick is the widest PROFILE of the FIRST exact (normalized) name — never a namesake ranked higher', async () => {
    // 'The Warning' asked; Fates Warning leads Amazon's ranking. A rank-based
    // pick would pin Fates Warning's photo on The Warning for 90 days.
    amazonWebSessionMock({ artists: ARTISTS });
    const resolver = instantiateAmazonPlugin(axe);
    expect(await resolver.searchArtistImage('The Warning', {})).toBe('https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg');
    expect(await resolver.searchArtistImage('Fates Warning', {})).toBe('https://m.media-amazon.com/images/I/71rGf-BOhvL.jpg');
    // A leading-The alias folds to the same key; the miss for a name that is
    // not on the page is null, never another artist's photo.
    expect(await resolver.searchArtistImage('Warrant', {})).toBeNull();
  });

  test('not signed in is null WITHOUT a request', async () => {
    const ws = amazonWebSessionMock({ artists: ARTISTS, signedIn: false });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.searchArtistImage('The Warning', {})).resolves.toBeNull();
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a structural failure (breaker class) degrades to null, never rethrows', async () => {
    amazonWebSessionMock({
      capturesFor: () => [{ url: 'https://gql.music.amazon.com/', method: 'POST', body: JSON.stringify({ operationName: 'MusicHomePage', variables: {} }), headers: { 'x-api-key': 'k' } }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.searchArtistImage('The Warning', {})).resolves.toBeNull();
    // The breaker counted it (a photo is optional, but the rename still trips
    // the circuit for the searches sharing it).
    expect(resolver._searchBreaker.state().failures).toBe(1);
  });

  test('a URL that is not a bare CDN URL never leaves the plugin — the cache persists it', async () => {
    // Each class exercised on its own matched artist: the parser skips the
    // query-string and off-host URLs at parse time, so the matched artist
    // reports no usable photo — never another host's pixel in the persisted
    // image cache.
    const withQuery = [{ asin: 'B0X1', name: 'Xtc', images: [{ url: 'https://m.media-amazon.com/images/I/x1.jpg?token=abc', width: 2400, imageType: 'PROFILE' }] }];
    const offHost = [{ asin: 'B0X2', name: 'Xtc', images: [{ url: 'https://tracker.example.com/pixel.jpg', width: 2400, imageType: 'PROFILE' }, { url: 'https://m.media-amazon.com.com.evil.example/images/I/y2.jpg', width: 1200, imageType: 'PROFILE' }] }];
    amazonWebSessionMock({ artists: withQuery });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.searchArtistImage('XTC', {})).resolves.toBeNull();
    amazonWebSessionMock({ artists: offHost });
    await expect(resolver.searchArtistImage('XTC', {})).resolves.toBeNull();
  });

  test('a short or malformed name is null before even the sign-in check', async () => {
    const ws = amazonWebSessionMock({ artists: ARTISTS });
    const resolver = instantiateAmazonPlugin(axe);
    expect(await resolver.searchArtistImage('x', {})).toBeNull();
    expect(await resolver.searchArtistImage('', {})).toBeNull();
    expect(await resolver.searchArtistImage('   ', {})).toBeNull();
    expect(await resolver.searchArtistImage(null, {})).toBeNull();
    // A lone surrogate in metadata is a miss, not an exception.
    await expect(resolver.searchArtistImage('AC\uD83DDC', {})).resolves.toBeNull();
    expect(ws.state).not.toHaveBeenCalled();
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('a stale job (past the #1135 8s budget) skips its page load and returns null', async () => {
    const ws = amazonWebSessionMock({ artists: ARTISTS });
    const resolver = instantiateAmazonPlugin(axe);
    let releaseChain;
    const gate = new Promise((resolve) => { releaseChain = resolve; });
    resolver.enqueuePageFlow(() => gate); // a gated job holds the page-flow queue
    const base = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const pending = resolver.searchArtistImage('The Warning', {});
      await new Promise((r) => setTimeout(r, 0)); // the job reaches the queue wait
      dateSpy.mockReturnValue(base + 8001);
      releaseChain();
      await expect(pending).resolves.toBeNull();
    } finally {
      dateSpy.mockRestore();
    }
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('no webSession bridge is a quiet null', async () => {
    global.window = {};
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.searchArtistImage('The Warning', {})).resolves.toBeNull();
  });
});

// ── The album lookup: its own candidate-ranking flow ────────────────────────

// One captured gql request the album page fired (bodies as the bridge's
// returned captures carry them).
const albumPageCapture = (asin, operationName) => ({
  url: 'https://gql.music.amazon.com/',
  method: 'POST',
  body: JSON.stringify({
    operationName,
    variables: { id: asin, isAuthenticated: true, includeMerch: true },
    extensions: {
      clientLibrary: { name: '@apollo/client', version: '4.1.6' },
      persistedQuery: { version: 1, sha256Hash: 'f4920eac7f471a63a36f569ecee41972789a03b6342013f3a5781c78f6d7ce55' }
    }
  }),
  headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' }
});

const detailTrack = (id, title, trackNumber, duration, artist = 'Metallica') => ({
  __typename: 'Track',
  id,
  title,
  contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: artist } }] },
  duration,
  trackNumber
});

const ALBUM_URL = 'https://music.amazon.com/albums/B07558DQJL';

// The album-page webSession mock: the load answers the given captures, and
// pageFetch answers per operationName (AlbumSeo carries the header only —
// data.album with title/trackCount but no tracksConnection — while
// AlbumDetailPage carries the tracksConnection the winner is judged by).
// entriesFor, when passed, overrides the load's capture verdict: (url, o) =>
// captures, computed against the load's OWN capture options — the host's
// quiet-window verdict simulated at the decision point (see
// amazonWebSessionMock's captureDelayMs).
// The album page's two responses: AlbumSeo carries the header only
// (data.album with title/trackCount but no tracksConnection — the shape a
// header-only miss is judged by), AlbumDetailPage the tracksConnection the
// winner is judged by. Shared by albumLookupMock and the timing tests.
const albumSeoResponse = (seo = {}) => ({
  data: {
    album: Object.assign({ id: 'B07558DQJL', title: 'Master of Puppets (Remastered)', trackCount: 8 }, seo)
  }
});
const albumDetailResponse = (detail = {}) => ({
  data: {
    album: Object.assign({
      id: 'B07558DQJL',
      title: 'Master of Puppets (Remastered)',
      shortTitle: 'Master of Puppets',
      trackCount: 8,
      releaseDate: '1986-02-21T00:00:00.000Z',
      images: [{ url: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg', width: 1200, height: 1200, imageType: 'PRIMARY' }],
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Metallica' } }] },
      tracksConnection: {
        edges: [
          { node: detailTrack('B07554FHF5', 'Battery (Remastered)', 1, 312) },
          { node: detailTrack('B0755C8JX3', 'Master Of Puppets (Remastered)', 2, 515) }
        ]
      }
    }, detail)
  }
});

function albumLookupMock({ captures, seoFirst = true, seo = {}, detail = {}, replayFor, entriesFor, timing } = {}) {
  const asin = 'B07558DQJL';
  const entries = captures || (seoFirst
    ? [albumPageCapture(asin, 'AlbumSeo'), albumPageCapture(asin, 'AlbumDetailPage')]
    : [albumPageCapture(asin, 'AlbumDetailPage')]);
  const ws = amazonWebSessionMock({
    capturesFor: entriesFor || ((url) => (/\/albums\//.test(String(url)) ? entries : [])),
    envelope: {},
    ...(timing ? { timing } : {})
  });
  const seoResponse = albumSeoResponse(seo);
  const detailResponse = albumDetailResponse(detail);
  ws.pageFetch.mockImplementation(async (id, request) => {
    if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
    const body = JSON.parse(request.body);
    if (replayFor) return replayFor(body);
    if (body.operationName === 'AlbumSeo') return { success: true, status: 200, text: JSON.stringify(seoResponse) };
    return { success: true, status: 200, text: JSON.stringify(detailResponse) };
  });
  return ws;
}

describe('lookupAlbum (the candidate-ranking flow)', () => {
  test('replays the ranked candidates and the winner is judged by the tracksConnection, not the name', async () => {
    const ws = albumLookupMock({}); // AlbumSeo arrives FIRST on a real page
    const resolver = instantiateAmazonPlugin(axe);
    const logs = [];
    const log = jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    try {
      const album = await resolver.lookupAlbum(ALBUM_URL, {});
      expect(album).toEqual(expect.objectContaining({
        id: 'amazonmusic-album-B07558DQJL',
        name: 'Master of Puppets (Remastered)',
        artist: 'Metallica',
        albumArt: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg',
        releaseDate: '1986-02-21T00:00:00.000Z',
        trackCount: 8,
        url: 'https://music.amazon.com/albums/B07558DQJL'
      }));
      expect(album.tracks[0]).toEqual(expect.objectContaining({
        id: 'amazonmusic-B07554FHF5',
        title: 'Battery (Remastered)',
        artist: 'Metallica',
        album: 'Master of Puppets (Remastered)',
        duration: 312,
        sources: ['amazonmusic'],
        amazonAsin: 'B07554FHF5',
        albumAsin: 'B07558DQJL',
        trackNumber: 1,
        discNumber: 1,
        explicit: false,
        albumArt: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg'
      }));
      // The page load went to the album page with the gql capture lens.
      expect(ws.load).toHaveBeenCalledTimes(1);
      expect(ws.load.mock.calls[0][1]).toBe(ALBUM_URL);
      expect(ws.load.mock.calls[0][2].capture.urlPrefixes).toEqual(['https://gql.music.amazon.com/*']);
      // The ranked detail op won on the first replay — the header-only
      // AlbumSeo sibling (ranked behind it) was never needed. It is replayed
      // and logged only when it precedes every connection-carrying candidate
      // (the renamed case below).
      const ops = ws.pageFetch.mock.calls.map((c) => JSON.parse(c[1].body).operationName);
      expect(ops).toEqual(['AlbumDetailPage']);
    } finally {
      log.mockRestore();
    }
  });

  test('per-disc numbering derives from the trackNumber resets (S&M2: 1..10, 1..13)', async () => {
    const ws = albumLookupMock({
      detail: {
        title: 'S&M2',
        trackCount: 5,
        contributingArtists: {
          edges: [
            { role: 'PRIMARY', node: { name: 'Metallica' } },
            { role: 'PRIMARY', node: { name: 'San Francisco Symphony' } }
          ]
        },
        tracksConnection: {
          edges: [
            { node: detailTrack('B0897X5B49', 'No Leaf Clover (Live)', 9, 330, 'Metallica') },
            { node: detailTrack('B0897YX5BS', 'Halo on Fire (Live)', 10, 497, 'Metallica') },
            { node: detailTrack('B0897X532Q', 'Intro to Scythian Suite (Live)', 1, 316, 'Metallica') },
            { node: detailTrack('B0897YFYZW', 'Scythian Suite, Opus 20 II (Live)', 2, 219, 'Metallica') }
          ]
        }
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const album = await resolver.lookupAlbum(ALBUM_URL, {});
    expect(album.tracks.map((t) => [t.trackNumber, t.discNumber]))
      .toEqual([[9, 1], [10, 1], [1, 2], [2, 2]]);
    // Per-track artists survive (compilations), joined like the search mapper.
    expect(album.tracks[0].artist).toBe('Metallica');
    expect(album.name).toBe('S&M2');
    expect(ws.pageFetch).toHaveBeenCalledTimes(1); // one replay won
  });

  test('a hornet-renamed detail op still wins: the anyName hedge, judged by the response', async () => {
    const entries = [
      albumPageCapture('B07558DQJL', 'AlbumSeo'),
      albumPageCapture('B07558DQJL', 'PlaybackContextSeed') // an unrelated read carrying the ASIN
    ];
    const ws = albumLookupMock({ captures: entries });
    const resolver = instantiateAmazonPlugin(axe);
    const logs = [];
    const log = jest.spyOn(console, 'log').mockImplementation((...a) => logs.push(a.join(' ')));
    try {
      const album = await resolver.lookupAlbum(ALBUM_URL, {});
      expect(album.name).toBe('Master of Puppets (Remastered)');
      // AlbumSeo (album-named) ranks ahead of the stray: its header-only
      // response is replayed, logged and skipped, then the renamed read wins
      // on its tracksConnection — the response is the arbiter, never the name.
      const ops = ws.pageFetch.mock.calls.map((c) => JSON.parse(c[1].body).operationName);
      expect(ops).toEqual(['AlbumSeo', 'PlaybackContextSeed']);
      expect(logs.join('\n')).toContain('AlbumSeo carried the header but no tracks connection');
    } finally {
      log.mockRestore();
    }
  });

  test('an AlbumSeo-style header with no operation exposing a connection is a miss with the ops log', async () => {
    const entries = [albumPageCapture('B07558DQJL', 'AlbumSeo')];
    const ws = albumLookupMock({ captures: entries });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolver.lookupAlbum(ALBUM_URL, {})).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('header came from AlbumSeo but no operation exposed a tracks connection'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('gql operations seen: AlbumSeo'));
    } finally {
      warn.mockRestore();
    }
  });

  test('a detail op lagging its SEO sibling past the shared quiet window is still captured and matched', async () => {
    // The old in-flow poll kept polling to the END of its 20s window while
    // every replay so far was header-only, because a detail op lagging
    // AlbumSeo by more than a poll had produced a bogus miss (the #1135
    // review). The bridge's capture replaces the poll with TWO mechanisms:
    // the doneWhen early stop ends the window the moment the detail op
    // itself lands (however far behind its SEO sibling — the needle is the
    // operation-name value the plugin's matcher ranks first), and the quiet
    // window is the FALLBACK for a detail op the needle can't see (a hornet
    // rename). This detail op lands 4s behind the SEO header — past the
    // shared 2500ms default, inside the album quiet window — and the lookup
    // still wins on it.
    const LAG_MS = 4000;
    const seoEntry = albumPageCapture('B07558DQJL', 'AlbumSeo');
    const detailEntry = albumPageCapture('B07558DQJL', 'AlbumDetailPage');
    const resolver = instantiateAmazonPlugin(axe);
    // The lag sits past the shared quiet window and inside the album one —
    // the gap the old poll's wait-it-out rule existed to cover.
    expect(LAG_MS).toBeGreaterThan(resolver.lib.PAGE_CAPTURE_QUIET_MS);
    expect(LAG_MS).toBeLessThan(resolver.lib.ALBUM_CAPTURE_QUIET_MS);
    // The host's window verdict for this timeline, computed at the decision
    // point: doneWhen ends the window AT the detail op (the early stop), so
    // the ONLY way it is missing is the shared budget closing the window
    // before it fires (LAG_MS ≥ budgetMs) — the quiet window never gets the
    // chance to cut a lagging detail op off once the needle names it.
    const ws = albumLookupMock({
      entriesFor: (url, o) => {
        if (!/\/albums\//.test(String(url))) return [];
        return LAG_MS < (o && o.capture && o.capture.budgetMs) ? [seoEntry, detailEntry] : [seoEntry];
      }
    });
    const album = await resolver.lookupAlbum(ALBUM_URL, {});
    expect(album).toEqual(expect.objectContaining({
      id: 'amazonmusic-album-B07558DQJL',
      name: 'Master of Puppets (Remastered)',
      trackCount: 8
    }));
    expect(album.tracks).toHaveLength(2);
    // The album page's own stop condition and quiet window, not the shared
    // 2.5s ones — and the shared 15s budget still caps the window.
    expect(ws.load.mock.calls[0][2].capture.quietMs).toBe(resolver.lib.ALBUM_CAPTURE_QUIET_MS);
    expect(ws.load.mock.calls[0][2].capture.quietMs).toBe(4500);
    expect(ws.load.mock.calls[0][2].capture.budgetMs).toBe(15000);
    expect(ws.load.mock.calls[0][2].capture.doneWhen).toEqual({ bodyIncludes: '"AlbumDetailPage"' });
    // The detail op won on its tracksConnection; the header-only sibling
    // ranked behind it was never needed.
    const ops = ws.pageFetch.mock.calls.map((c) => JSON.parse(c[1].body).operationName);
    expect(ops).toEqual(['AlbumDetailPage']);
  });

  test('the flow total stays inside the renderer\'s 8s catalog step — doneWhen ends the window at the detail op, before the page even finishes loading', async () => {
    // The renderer wraps every album lookup in withCatalogTimeout
    // (CATALOG_STEP_TIMEOUT_MS, 8000ms — src/renderer/app.js) and drops the
    // answer when the step expires; the plugin cannot read the renderer
    // constant, so it mirrors the budget as ALBUM_JOB_STALE_MS and this test
    // mirrors it again — the drift guard the maintainer asked for: a future
    // quiet-window or doneWhen change that pushes the flow past 8s fails
    // HERE, not in the field as "no track list".
    const CATALOG_STEP_TIMEOUT_MS = 8000;
    const REPLAY_MS = 300; // one candidate replay's cost
    // The timeline: a slow album page — did-finish-load at 6s (subresources),
    // but the page fires AlbumSeo at 1.5s and the detail op at 3s. doneWhen
    // ends the capture window AT the detail op, so the load returns at 3s,
    // with did-finish-load still 3s out — the pre-doneWhen flow (page load +
    // the quiet tail) answered at ~13s, three seconds past the renderer's
    // step, every Amazon-sourced album showing "no track list".
    const ws = albumLookupMock({
      timing: {
        loadMs: 6000,
        requests: [
          { atMs: 1500, entry: albumPageCapture('B07558DQJL', 'AlbumSeo') },
          { atMs: 3000, entry: albumPageCapture('B07558DQJL', 'AlbumDetailPage') }
        ]
      }
    });
    ws.pageFetch.mockImplementation(async (id, request) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      await new Promise((resolve) => setTimeout(resolve, REPLAY_MS));
      const body = JSON.parse(request.body);
      if (body.operationName === 'AlbumSeo') return { success: true, status: 200, text: JSON.stringify(albumSeoResponse()) };
      return { success: true, status: 200, text: JSON.stringify(albumDetailResponse()) };
    });
    const resolver = instantiateAmazonPlugin(axe);
    expect(resolver.lib.ALBUM_JOB_STALE_MS).toBe(CATALOG_STEP_TIMEOUT_MS); // the two mirrors never drift apart
    jest.useFakeTimers();
    try {
      const t0 = Date.now();
      // Drive the clock only as far as the flow needs: the elapsed measured
      // below is the flow's own end, not however far a blind advance went.
      let settled = false;
      const pending = resolver.lookupAlbum(ALBUM_URL, {}).then((out) => { settled = true; return out; });
      for (let clock = 0; clock < CATALOG_STEP_TIMEOUT_MS && !settled; clock += 1) {
        await jest.advanceTimersByTimeAsync(1);
      }
      const album = await pending;
      const elapsed = Date.now() - t0;
      expect(album).toEqual(expect.objectContaining({ id: 'amazonmusic-album-B07558DQJL', trackCount: 8 }));
      // The whole flow — sign-in check, page load, the capture window, the
      // winning replay — answered inside the renderer's step, and before
      // did-finish-load: the early stop, not a lucky quiet window.
      expect(elapsed).toBeLessThan(CATALOG_STEP_TIMEOUT_MS);
      expect(elapsed).toBeLessThan(6000 + REPLAY_MS);
      expect(elapsed).toBe(3000 + REPLAY_MS); // the window ended AT the detail op
    } finally {
      jest.useRealTimers();
    }
  });

  test('the fallback path — only the SEO sibling, no detail op to match — still finishes inside the 8s step on the quiet window', async () => {
    // The same budget against the FALLBACK: a detail op the needle can't see
    // (the hornet-rename case) never matches doneWhen, so the window falls
    // back to ALBUM_CAPTURE_QUIET_MS past the last capture — which must stay
    // sized so page load + quiet still answers inside the renderer's step.
    // A page that loads in 2s, fires its SEO sibling at 2.4s and nothing else
    // ends the window at 2.4s + 4.5s = 6.9s, replays the header-only
    // candidate and reports the miss at ~7.2s — inside the step, so the miss
    // is CACHED as the honest answer instead of being dropped for a slow
    // nothing.
    const CATALOG_STEP_TIMEOUT_MS = 8000;
    const REPLAY_MS = 300;
    const ws = albumLookupMock({
      timing: {
        loadMs: 2000,
        requests: [{ atMs: 2400, entry: albumPageCapture('B07558DQJL', 'AlbumSeo') }]
      }
    });
    ws.pageFetch.mockImplementation(async (id, request) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      await new Promise((resolve) => setTimeout(resolve, REPLAY_MS));
      return { success: true, status: 200, text: JSON.stringify(albumSeoResponse()) };
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      const t0 = Date.now();
      let settled = false;
      const pending = resolver.lookupAlbum(ALBUM_URL, {}).then((out) => { settled = true; return out; });
      for (let clock = 0; clock < CATALOG_STEP_TIMEOUT_MS && !settled; clock += 1) {
        await jest.advanceTimersByTimeAsync(1);
      }
      await expect(pending).resolves.toBeNull(); // the header-only miss
      const elapsed = Date.now() - t0;
      // Page load (2s) + the last capture (2.4s) + the album quiet window
      // (4.5s) + the one header-only replay — inside the step with room.
      expect(elapsed).toBeLessThan(CATALOG_STEP_TIMEOUT_MS);
      expect(elapsed).toBe(2400 + resolver.lib.ALBUM_CAPTURE_QUIET_MS + REPLAY_MS);
    } finally {
      jest.useRealTimers();
      warn.mockRestore();
    }
  });

  test('no candidates at all is the deleted/region miss (null), with the ops log', async () => {
    const ws = albumLookupMock({ captures: [] });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolver.lookupAlbum(ALBUM_URL, {})).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('page never requested the album detail for B07558DQJL'));
    } finally {
      warn.mockRestore();
    }
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a busy gate on a candidate replay is ridden out, not a failed candidate', async () => {
    // A concurrent host-side navigation (a playlist import, the session mint)
    // can hold the readers/writer gate after the album page's capture
    // succeeded: busy is transient there, not a failed candidate — the same
    // short bounded retry the spec-search page flow carries.
    const ws = albumLookupMock({});
    const outcomes = [
      { success: true, error: 'busy' },
      { success: true, error: 'busy' },
      null // the third call answers the detail response
    ];
    const base = ws.pageFetch.getMockImplementation();
    ws.pageFetch.mockImplementation(async (id, request) => {
      const next = outcomes.shift();
      if (next) return next;
      return base(id, request);
    });
    const resolver = instantiateAmazonPlugin(axe);
    const album = await resolver.lookupAlbum(ALBUM_URL, {});
    expect(album.name).toBe('Master of Puppets (Remastered)');
  });

  test('a permanently-busy replay backs off to a bounded ~13s per candidate, then the busy is the replay error', async () => {
    // The backoff the busy retry actually promises (the same ladder as the
    // spec-search page flow's replay): three 400ms waits, then 1000ms waits
    // until 12s of the 1000ms ladder — 15 sleeps, 13200ms total, 16 attempts
    // — and then the still-busy candidate is given up on as a replay error
    // (lookup-failed), never an endless spin on the page-flow chain. A
    // mid-retry staleness re-check is deliberately NOT part of this: the
    // #1135 budget guards the QUEUE wait (a job queued past 8s skips its page
    // load); once a flow is inside its page flow it runs to its bounded end.
    const ws = albumLookupMock({ captures: [albumPageCapture('B07558DQJL', 'AlbumDetailPage')] });
    ws.pageFetch.mockImplementation(async () => ({ success: true, error: 'busy' }));
    const resolver = instantiateAmazonPlugin(axe);
    jest.useFakeTimers();
    try {
      const t0 = Date.now();
      const pending = resolver.lookupAlbum(ALBUM_URL, {});
      // The rejection expectation attaches BEFORE the timers are driven: the
      // flow rejects while the advance is still running, and a pending without
      // a handler yet would surface as an unhandled rejection.
      const rejection = expect(pending).rejects.toMatchObject({ notReady: true, code: 'lookup-failed' });
      await jest.advanceTimersByTimeAsync(0); // the flow reaches the first backoff sleep
      await jest.advanceTimersByTimeAsync(13200);
      await rejection;
      expect(Date.now() - t0).toBe(13200); // exactly 3×400 + 12×1000 of backoff
      expect(ws.pageFetch).toHaveBeenCalledTimes(16); // the initial attempt + 15 retries, then the bound gives up
    } finally {
      jest.useRealTimers();
    }
  });

  test('an errored replay is lookup-failed, never a bogus miss', async () => {
    const ws = albumLookupMock({ replayFor: () => ({ success: true, error: 'Amazon gql query failed (500)' }) });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupAlbum(ALBUM_URL, {})).rejects.toMatchObject({
      notReady: true,
      code: 'lookup-failed'
    });
  });

  test('an errored detail replay outranks the AlbumSeo header — a failed lookup, never a "deleted album" miss', async () => {
    // The SEO replay answered the header (the album exists), the detail
    // replay errored: the lookup FAILED — returning a miss here would cache
    // a live album as deleted.
    const ws = albumLookupMock({
      replayFor: (body) => (body.operationName === 'AlbumSeo'
        ? { success: true, status: 200, text: JSON.stringify({ data: { album: { id: 'B07558DQJL', title: 'Master of Puppets (Remastered)', trackCount: 8 } } }) }
        : { success: true, error: 'Amazon gql query failed (500)' })
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupAlbum(ALBUM_URL, {})).rejects.toMatchObject({
      notReady: true,
      code: 'lookup-failed'
    });
    expect(ws.pageFetch).toHaveBeenCalledTimes(2); // both ranked candidates were tried
  });

  test('a data.album: null response (deleted / other region) never wins — every candidate is tried and the miss is null', async () => {
    // The connection is the arbiter: a response whose data.album is null is
    // not a winner (and not a header-only op either), so the ranked pool is
    // exhausted and the lookup reports the miss with the ops log. The
    // envelope semantics (data.album null = not-found, no album field at all
    // = lookup-failed) are pinned at the parser level below.
    const ws = albumLookupMock({ replayFor: () => ({ success: true, status: 200, text: JSON.stringify({ data: { album: null } }) }) });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolver.lookupAlbum(ALBUM_URL, {})).resolves.toBeNull();
      // Both captured candidates were replayed (the pool is exhausted before
      // the miss is concluded).
      expect(ws.pageFetch).toHaveBeenCalledTimes(2);
    } finally {
      warn.mockRestore();
    }
  });

  test('a replay that parses with no album field at all is lookup-failed, never a miss', async () => {
    // The hornet rename of the response's album field: the winner is chosen
    // by the connection, which requires data.album, so an album-less replay
    // can never win — and before the loop classified it, the exhausted pool
    // fell into the "page never requested the album detail" MISS, caching a
    // rename as a deleted album. albumDetailFromGql's envelope:false shape
    // now surfaces where it can actually bite: lookup-failed (the playlist
    // structural rule, mirrored).
    const ws = albumLookupMock({
      replayFor: () => ({ success: true, status: 200, text: JSON.stringify({ data: { albumV2: { id: 'B07558DQJL', tracksConnection: { edges: [] } } } }) })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolver.lookupAlbum(ALBUM_URL, {})).rejects.toMatchObject({
        notReady: true,
        code: 'lookup-failed'
      });
      // The whole ranked pool was replayed (the response stays the arbiter —
      // a later candidate could still have carried the connection).
      expect(ws.pageFetch).toHaveBeenCalledTimes(2);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('carried no album field at all'));
    } finally {
      warn.mockRestore();
    }
  });

  test('an album-less replay does not outrank a seen header — the header proves the field intact', async () => {
    // AlbumSeo answered data.album (no connection), an unrelated read that
    // happens to carry the ASIN answered with no album field at all. The
    // header proves the album field intact, so the stray's album-less
    // response is its expected shape, not a rename: the header-only verdict
    // (the detail op never ran) stands — a miss with the ops log.
    const entries = [
      albumPageCapture('B07558DQJL', 'AlbumSeo'),
      albumPageCapture('B07558DQJL', 'PlaybackContextSeed')
    ];
    const ws = albumLookupMock({
      captures: entries,
      replayFor: (body) => (body.operationName === 'AlbumSeo'
        ? { success: true, status: 200, text: JSON.stringify({ data: { album: { id: 'B07558DQJL', title: 'Master of Puppets (Remastered)', trackCount: 8 } } }) }
        : { success: true, status: 200, text: JSON.stringify({ data: { playbackContext: { id: 'B07558DQJL' } } }) })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolver.lookupAlbum(ALBUM_URL, {})).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('header came from AlbumSeo but no operation exposed a tracks connection'));
    } finally {
      warn.mockRestore();
    }
  });

  test('the ranked pool is replayed to a cap of four — a fifth candidate is never replayed', async () => {
    // A page whose every candidate answers the not-found shape (data.album
    // null) exhausts the pool at four pageFetch replays; the fifth-ranked
    // candidate (an unrelated read carrying the ASIN) is never asked.
    const asin = 'B07558DQJL';
    // The capture timeline ends at the detail op (doneWhen ends the window
    // the moment it lands): the SEO sibling and the strays fired first, all
    // captured, and the ranking — not arrival order — still puts the
    // detail-named op at the head of the pool the cap governs.
    const entries = [
      albumPageCapture(asin, 'AlbumSeo'),
      albumPageCapture(asin, 'PlaybackContextSeed'),
      albumPageCapture(asin, 'LibrarySeed'),
      albumPageCapture(asin, 'MerchModuleSeed'),
      albumPageCapture(asin, 'AlbumDetailPage')
    ];
    const ws = albumLookupMock({
      captures: entries,
      replayFor: () => ({ success: true, status: 200, text: JSON.stringify({ data: { album: null } }) })
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await expect(resolver.lookupAlbum(ALBUM_URL, {})).resolves.toBeNull();
      expect(ws.pageFetch).toHaveBeenCalledTimes(4);
      // And the four the cap allowed were the highest-ranked: the detail op,
      // the album-named header, then the strays in capture order.
      expect(ws.pageFetch.mock.calls.map((c) => JSON.parse(c[1].body).operationName))
        .toEqual(['AlbumDetailPage', 'AlbumSeo', 'PlaybackContextSeed', 'LibrarySeed']);
    } finally {
      warn.mockRestore();
    }
  });

  test('the no-pageInfo single page: trackCount above the mapped rows logs the truncation', async () => {
    // A 100-track album answers all edges in one response — but this server
    // truncated: the tracksConnection has no pageInfo to follow, so the
    // shortfall is logged, not paginated, and the server's trackCount stays
    // visible in the mapped album.
    const ws = albumLookupMock({ seo: { trackCount: 12 }, detail: { trackCount: 12 } });
    const resolver = instantiateAmazonPlugin(axe);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const album = await resolver.lookupAlbum(ALBUM_URL, {});
      expect(album.tracks).toHaveLength(2);
      expect(album.trackCount).toBe(12);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('album lookup truncated: got 2 of 12 tracks'));
      // And a 0-of-N map says which (edges present vs absent) — a future
      // "0 of N" in the field log should not need a DevTools session to
      // diagnose. The album with zero mapped rows is a miss (the loaded()
      // gate), not a notReady throw.
      const zero = albumLookupMock({
        seo: { trackCount: 12 },
        detail: { trackCount: 12, tracksConnection: { edges: [] } }
      });
      const zeroResolver = instantiateAmazonPlugin(axe);
      await expect(zeroResolver.lookupAlbum(ALBUM_URL, {})).resolves.toBeNull();
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('0 of 12 mapped — edges=0, first node null'));
    } finally {
      warn.mockRestore();
    }
    expect(ws.pageFetch).toHaveBeenCalled();
  });

  test('not signed in prompts and retries once, like lookupPlaylist', async () => {
    const ws = albumLookupMock({});
    const resolver = instantiateAmazonPlugin(axe);
    // First flow run: signed out. Then signed in.
    const stateSpy = ws.state;
    let signedOut = true;
    stateSpy.mockImplementation(async () => ({
      success: true,
      url: 'https://music.amazon.com/search/x/songs',
      signInUrl: null,
      cookieNames: signedOut ? ['session-id', 'ubid-main'] : ['at-main', 'sess-at-main'],
      generation: 0
    }));
    const managePrompt = jest.fn(async () => { signedOut = false; return true; });
    global.window.__parachordManageAmazonMusic = managePrompt;
    const album = await resolver.lookupAlbum(ALBUM_URL, {});
    expect(album.name).toBe('Master of Puppets (Remastered)');
    expect(managePrompt).toHaveBeenCalledTimes(1);
    // The refused run never loaded a page; only the retry did.
    expect(ws.load).toHaveBeenCalledTimes(1);
    delete global.window.__parachordManageAmazonMusic;
  });

  test('a declined prompt is notReady not-signed-in; a signed-out first run loads nothing', async () => {
    const ws = albumLookupMock({});
    const resolver = instantiateAmazonPlugin(axe);
    let signedOut = true;
    ws.state.mockImplementation(async () => ({
      success: true,
      url: 'https://music.amazon.com/search/x/songs',
      signInUrl: null,
      cookieNames: signedOut ? ['session-id', 'ubid-main'] : ['at-main', 'sess-at-main'],
      generation: 0
    }));
    global.window.__parachordManageAmazonMusic = jest.fn(async () => false);
    await expect(resolver.lookupAlbum(ALBUM_URL, {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
    delete global.window.__parachordManageAmazonMusic;
  });

  test('a refused load (a stalled page) is notReady load-failed, never a bogus miss', async () => {
    amazonWebSessionMock({
      loadResult: { success: false, reason: 'load-failed', error: 'page did not finish loading within 30000ms' },
      capturesFor: () => []
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupAlbum(ALBUM_URL, {})).rejects.toMatchObject({
      notReady: true,
      code: 'load-failed'
    });
  });

  test('a page that ends on a sign-in wall mid-flight is not-signed-in', async () => {
    albumLookupMock({});
    const ws = amazonWebSessionMock({
      finalUrl: 'https://www.amazon.com/ap/signin',
      capturesFor: (url) => (/\/albums\//.test(String(url)) ? [albumPageCapture('B07558DQJL', 'AlbumDetailPage')] : []),
      envelope: {}
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupAlbum(ALBUM_URL, {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('a stale job (queued past the #1135 budget) skips its page load and returns null', async () => {
    const ws = albumLookupMock({});
    const resolver = instantiateAmazonPlugin(axe);
    let releaseChain;
    const gate = new Promise((resolve) => { releaseChain = resolve; });
    resolver.enqueuePageFlow(() => gate); // a gated job holds the page-flow queue
    const base = Date.now();
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(base);
    try {
      const pending = resolver.lookupAlbum(ALBUM_URL, {});
      await new Promise((r) => setTimeout(r, 0)); // the job reaches the queue wait
      dateSpy.mockReturnValue(base + 8001);
      releaseChain();
      await expect(pending).resolves.toBeNull();
    } finally {
      dateSpy.mockRestore();
    }
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('not an album URL is notReady before anything runs', async () => {
    const ws = albumLookupMock({});
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.lookupAlbum('https://open.spotify.com/album/x', {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-ready'
    });
    await expect(resolver.lookupAlbum('https://music.amazon.com/albums/B07558DQJ', {})).rejects.toMatchObject({
      notReady: true,
      code: 'not-ready'
    });
    expect(ws.load).not.toHaveBeenCalled();
  });
});


// ── The moved _lib helpers ───────────────────────────────────────────────────
// The pure helpers the catalog flows use, ported VERBATIM from
// tests/resolver/amazon-music-logic.test.js (their host copies in
// amazon-music-logic.js died with the flows; these are the only copies now).
// The cases are the original ones — from redacted live captures — retargeted
// at the plugin's _lib copies.
{
  const lib = instantiateAmazonPlugin(axe).lib;
  // amazonAlbumDetailRequest was the one-line first-candidate wrapper; the
  // plugin flow ranks and replays candidates itself, so the wrapper died with
  // it — the cases read the head of the ranked list instead.
  const first = (bodies, asin, opts) => lib.amazonAlbumDetailCandidates(bodies, asin, opts)[0] || null;

describe('amazonAlbumSearchUrl', () => {
  test('the albums tab carries the same quoted-or query as the songs search', () => {
    expect(lib.amazonAlbumSearchUrl({ title: 'Dulling the Horns', artist: 'Wild Pink' })).toEqual({
      url: 'https://music.amazon.com/search/' + encodeURIComponent('"Dulling the Horns" by "Wild Pink" OR "Dulling the Horns" "Wild Pink" OR "Wild Pink" "Dulling the Horns"') + '/albums',
      searchText: '"Dulling the Horns" by "Wild Pink" OR "Dulling the Horns" "Wild Pink" OR "Wild Pink" "Dulling the Horns"'
    });
  });

  test('free text passes through, onto the albums tab', () => {
    expect(lib.amazonAlbumSearchUrl('wild pink')).toEqual({
      url: 'https://music.amazon.com/search/wild%20pink/albums',
      searchText: 'wild pink'
    });
  });

  test('a single artist term is still quoted', () => {
    expect(lib.amazonAlbumSearchUrl({ artist: 'Wild Pink' })).toEqual({
      url: 'https://music.amazon.com/search/' + encodeURIComponent('"Wild Pink"') + '/albums',
      searchText: '"Wild Pink"'
    });
  });

  test('nothing to search returns null', () => {
    expect(lib.amazonAlbumSearchUrl({})).toBeNull();
    expect(lib.amazonAlbumSearchUrl({ title: '  ', artist: '' })).toBeNull();
  });
});

describe('amazonAlbumAsinFromUrl', () => {
  test('parses the canonical album URL', () => {
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJL')).toBe('B07558DQJL');
  });

  test('tolerates the ?ref= tracker the search response carries, trailing slashes and lowercase', () => {
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJL?ref=dm_ff_amazonmusic_greenhornet_web')).toBe('B07558DQJL');
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/albums/b07558dqjl/')).toBe('B07558DQJL');
  });

  test('not an album URL — including a 9- or 11-char id — is null', () => {
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/tracks/B07554FHF5')).toBeNull();
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJ')).toBeNull();
    expect(lib.amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJLL')).toBeNull();
    expect(lib.amazonAlbumAsinFromUrl('https://example.com/albums/B07558DQJL')).toBeNull();
    expect(lib.amazonAlbumAsinFromUrl('')).toBeNull();
    expect(lib.amazonAlbumAsinFromUrl(null)).toBeNull();
  });
});

describe('amazonSpecSearchRequest album spec', () => {
  const search = (searchText, specType) => JSON.stringify({
    operationName: 'SpecSearchSeeMorePage',
    variables: {
      searchText, specType, firstLimit: 30, isAuthenticated: true,
      audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false
    },
    extensions: {
      clientLibrary: { name: '@apollo/client', version: '4.1.6' },
      persistedQuery: { version: 1, sha256Hash: '56f888fd039c581a348e8057e0d61b9495ce835870a2d1ab7b6f2c900e54e15c' }
    }
  });

  test('the album spec is accepted only with { spec: "album" }', () => {
    expect(lib.amazonSpecSearchRequest([search('wild pink', 'album')], 'wild pink', { spec: 'album' }).variables.specType).toBe('album');
    // Album mode must not accept the track spec — mirror of the track-side
    // rule that an album ASIN never lands in the track slot.
    expect(lib.amazonSpecSearchRequest([search('wild pink', 'track')], 'wild pink', { spec: 'album' })).toBeNull();
    // A body with no specType at all is still accepted (older deploys); the
    // album parser itself drops any non-Album nodes in that response.
    expect(lib.amazonSpecSearchRequest([search('wild pink', undefined)], 'wild pink', { spec: 'album' })).not.toBeNull();
  });

  test('the default mode never matches the album spec no matter the order the page fired them', () => {
    const bodies = [search('wild pink', 'album'), search('wild pink', 'track')];
    expect(lib.amazonSpecSearchRequest(bodies, 'wild pink').variables.specType).toBe('track');
    expect(lib.amazonSpecSearchRequest(bodies, 'wild pink', { spec: 'album' }).variables.specType).toBe('album');
  });
});

// The album-detail request the album page fires (live-captured 2026-10):
// AlbumDetailPage, variables.id = the ASIN, an APQ hash that renumbers per
// hornet redeploy.
describe('amazonAlbumDetailRequest / lib.amazonAlbumDetailCandidates', () => {
  const detail = (asin, operationName = 'AlbumDetailPage') => JSON.stringify({
    operationName,
    variables: { id: asin, isAuthenticated: true, includeMerch: true, includeAlbumAbout: false },
    extensions: {
      clientLibrary: { name: '@apollo/client', version: '4.1.6' },
      persistedQuery: { version: 1, sha256Hash: 'f4920eac7f471a63a36f569ecee41972789a03b6342013f3a5781c78f6d7ce55' }
    }
  });

  test('finds the album-detail request for our ASIN among everything the page fires', () => {
    const bodies = [
      JSON.stringify({ operationName: 'IdentityStoreSeed', variables: {} }),
      JSON.stringify({ operationName: 'Transport', variables: { id: 'mrn:x' } }),
      detail('B07558DQJL'),
      '{not json'
    ];
    const req = first(bodies, 'b07558dqjl');
    expect(req.operationName).toBe('AlbumDetailPage');
    expect(req.variables.id).toBe('B07558DQJL');
    expect(req.extensions.persistedQuery.sha256Hash).toBe('f4920eac7f471a63a36f569ecee41972789a03b6342013f3a5781c78f6d7ce55');
  });

  test('batch arrays are tolerated, and another album\'s detail is not ours', () => {
    const batch = JSON.stringify([
      { operationName: 'AppChromeHeaderLeft', variables: {} },
      JSON.parse(detail('B07H76H4F1'))
    ]);
    expect(first([batch], 'B07H76H4F1')).not.toBeNull();
    expect(first([batch], 'B07558DQJL')).toBeNull();
  });

  test('the detail op ranks first, then other album-named reads, then (with anyName) any read carrying the ASIN', () => {
    // Live-captured 2026-10: the real album page fires AlbumSeo (header-only)
    // with the same variables.id BEFORE AlbumDetailPage. First-arrival is
    // never the winner: candidates come back detail-named first.
    const seo = detail('B07558DQJL', 'AlbumSeo');
    const stray = JSON.stringify({ operationName: 'PlaybackContextSeed', variables: { id: 'B07558DQJL' } });
    const bodies = [seo, detail('B07558DQJL'), stray];
    expect(lib.amazonAlbumDetailCandidates(bodies, 'B07558DQJL').map(r => r.operationName))
      .toEqual(['AlbumDetailPage', 'AlbumSeo']);
    // default excludes the stray entirely — an unrelated read that happens to
    // carry the ASIN must not be replayed as the album detail
    expect(first([stray], 'B07558DQJL')).toBeNull();
    // { anyName: true } appends it last (the caller's rename hedge) and the
    // ranked detail op still leads
    expect(lib.amazonAlbumDetailCandidates(bodies, 'B07558DQJL', { anyName: true }).map(r => r.operationName))
      .toEqual(['AlbumDetailPage', 'AlbumSeo', 'PlaybackContextSeed']);
    expect(first([stray], 'B07558DQJL', { anyName: true }).operationName).toBe('PlaybackContextSeed');
    expect(first(bodies, 'B07558DQJL', { anyName: true }).operationName).toBe('AlbumDetailPage');
  });

  test('write-shaped operations for the same ASIN are never replayed', () => {
    expect(first([
      JSON.stringify({ operationName: 'recordAlbumView', variables: { id: 'B07558DQJL' } })
    ], 'B07558DQJL')).toBeNull();
    expect(first([
      JSON.stringify({ operationName: 'addToLibraryMutation', variables: { id: 'B07558DQJL' } })
    ], 'B07558DQJL')).toBeNull();
    expect(first([
      JSON.stringify({ operationName: 'LibraryWrite', query: ' mutation AddToLibrary($id: ID!) { x }', variables: { id: 'B07558DQJL' } })
    ], 'B07558DQJL')).toBeNull();
  });

  test('missing id and empty captures are null', () => {
    expect(first([JSON.stringify({ operationName: 'AlbumDetailPage', variables: {} })], 'B07558DQJL')).toBeNull();
    expect(first([], 'B07558DQJL')).toBeNull();
    expect(first(null, 'B07558DQJL')).toBeNull();
    expect(first([detail('B07558DQJL')], '')).toBeNull();
    expect(first([detail('B07558DQJL')], undefined)).toBeNull();
  });
});

// The album-spec SpecSearchSeeMorePage response (live-captured 2026-10, the
// "wild pink" search): edges under data.specificationSearch.result[] whose
// node is an ALBUM entity (id/title/shortTitle/contributingArtists/images/url
// — no releaseDate or trackCount in the search spec).
describe('searchAlbumsFromGql', () => {
  const albumNode = (id, title, shortTitle, artists, images, explicit) => ({
    __typename: 'Album',
    id,
    uri: 'mrn:1.0:catalog:album:asin:' + id + '?territory=US',
    title,
    shortTitle,
    images: images.map(([url, width, height]) => ({ url, width, height, imageType: 'PRIMARY', __typename: 'Image' })),
    playParams: {
      id: 'mrn:1.0:catalog:album:asin:' + id + '?territory=US',
      selections: ['PLAY', 'SHUFFLE', 'STATION'],
      __typename: 'PlayParams'
    },
    parentalSettings: { hasExplicitLanguage: explicit, __typename: 'ParentalSettings' },
    url: 'https://music.amazon.com/albums/' + id + '?ref=dm_ff_amazonmusic_greenhornet_web',
    contributingArtists: {
      edges: artists.map(a => ({ role: a[1], node: { name: a[0], __typename: 'Artist', id: a[2] || 'B00VNR8ILM' }, __typename: 'ArtistEdge' })),
      __typename: 'ArtistConnection'
    },
    likesContext: { state: 'NEUTRAL', __typename: 'LikesContext' }
  });
  const response = (edges, extra = {}) => ({
    specificationSearch: {
      id: 'search_3c00ab130b',
      searchText: 'wild pink',
      result: [
        {
          __typename: 'SpecificationSearchResult',
          pageInfo: { hasNextPage: !!edges.length, endCursor: null, token: edges.length ? '[redacted]' : null },
          label: 'requiredButUnused',
          edges: edges.map(node => ({ __typename: 'EntityEdge', node })),
          ...extra
        }
      ]
    }
  });

  test('maps the spec search album edges to the searchAlbums shape', () => {
    const data = response([
      albumNode('B0FMW6FYGN', 'Dulling The Horns (Deluxe Edition) [Explicit]', 'Dulling The Horns (Deluxe Edition)',
        [['Wild Pink', 'PRIMARY']],
        [['https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg', 2560, 2560], ['https://m.media-amazon.com/images/I/51mBZqGZpnL.jpg', 500, 500]],
        true),
      albumNode('B0GZ59Z25F', 'Still Coming Down [Explicit]', 'Still Coming Down',
        [['Wild Pink', 'PRIMARY']],
        [['https://m.media-amazon.com/images/I/91KofyX81wL.jpg', 2560, 2560], ['https://m.media-amazon.com/images/I/41RHRLzSB4L.jpg', 500, 500]],
        true),
      albumNode('B07CMLR17Z', 'Yolk in the Fur', 'Yolk in the Fur',
        [['Wild Pink', 'PRIMARY']],
        [['https://m.media-amazon.com/images/I/61t5hojNMAL.jpg', 1400, 1400], ['https://m.media-amazon.com/images/I/41FQ1rARzML.jpg', 500, 500]],
        false)
    ]);
    const out = lib.searchAlbumsFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.albums).toEqual([
      {
        asin: 'B0FMW6FYGN',
        name: 'Dulling The Horns (Deluxe Edition)',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg',
        url: 'https://music.amazon.com/albums/B0FMW6FYGN',
        explicit: true
      },
      {
        asin: 'B0GZ59Z25F',
        name: 'Still Coming Down',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/91KofyX81wL.jpg',
        url: 'https://music.amazon.com/albums/B0GZ59Z25F',
        explicit: true
      },
      {
        asin: 'B07CMLR17Z',
        name: 'Yolk in the Fur',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/61t5hojNMAL.jpg',
        url: 'https://music.amazon.com/albums/B07CMLR17Z',
        explicit: false
      }
    ]);
  });

  test('a Track edge in the album spec is dropped — the ASIN-in-the-wrong-slot guard, in reverse', () => {
    const track = {
      __typename: 'Track',
      id: 'B073N3R1KZ',
      title: 'Eisenherz',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Juli', __typename: 'Artist' } }], __typename: 'ArtistConnection' },
      album: { id: 'B073HX454H', __typename: 'Album', shortTitle: 'In Love' },
      duration: 276
    };
    const out = lib.searchAlbumsFromGql(response([track]));
    expect(out.envelope).toBe(true);
    expect(out.albums).toEqual([]);
  });

  test('a miss is a present envelope with empty edges; an absent envelope is structural', () => {
    const miss = lib.searchAlbumsFromGql(response([]));
    expect(miss.envelope).toBe(true);
    expect(miss.albums).toEqual([]);
    expect(lib.searchAlbumsFromGql({ somethingElse: {} })).toEqual({ albums: [], envelope: false });
    expect(lib.searchAlbumsFromGql(null)).toEqual({ albums: [], envelope: false });
    expect(lib.searchAlbumsFromGql(undefined)).toEqual({ albums: [], envelope: false });
  });

  test('an album node without an artist or a usable title is dropped', () => {
    expect(lib.albumFromGqlSearchNode({ __typename: 'Album', id: 'B0X1', title: 'X' })).toBeNull();
    expect(lib.albumFromGqlSearchNode({
      __typename: 'Album', id: 'B0X1', title: ' [Explicit]',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] }
    })).toBeNull();
    expect(lib.albumFromGqlSearchNode(null)).toBeNull();
    expect(lib.albumFromGqlSearchNode({ __typename: 'Album', title: 'X', contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] } })).toBeNull();
  });
});

// The artists tab (/search/<q>/artists — plural; the singular /artist path
// fires nothing matchable) fires SpecSearchSeeMorePage with
// variables.specType 'artist' (live-verified 2026-10 via
// amazonmusic-debug-capture-gql and a specSearch probe), and its bucket is
// labeled 'requiredButUnused' — the same label the album bucket uses.
describe('amazonArtistSearchUrl', () => {
  test('the artists tab carries the quoted artist name', () => {
    expect(lib.amazonArtistSearchUrl('The Warning')).toEqual({
      url: 'https://music.amazon.com/search/' + encodeURIComponent('"The Warning"') + '/artists',
      searchText: '"The Warning"'
    });
    // An embedded quote is stripped, not escaped into a broken phrase.
    expect(lib.amazonArtistSearchUrl('The "Warning"').searchText).toBe('"The Warning"');
  });

  test('control characters in a metadata name fold to a space — a junk name must not wedge the matcher', () => {
    // searchText is what the runner matches the page's own request on; a raw
    // newline normalized differently by hornet would never match, and one
    // junk name would wait out the capture window as a structural failure.
    expect(lib.amazonArtistSearchUrl('AC\nDC').searchText).toBe('"AC DC"');
    expect(lib.amazonArtistSearchUrl('a\tb').searchText).toBe('"a b"');
    expect(lib.amazonArtistSearchUrl('\n\r')).toBeNull();
  });

  test('a lone surrogate in metadata is a miss, not an encodeURIComponent exception', () => {
    expect(lib.amazonArtistSearchUrl('AC\uD83DDC')).toBeNull();
    expect(lib.amazonArtistSearchUrl('\uD800')).toBeNull();
    // A well-formed surrogate pair (an actual emoji) still searches.
    expect(lib.amazonArtistSearchUrl('AC\uD83D\uDE00DC')).not.toBeNull();
  });

  test('nothing to search returns null', () => {
    expect(lib.amazonArtistSearchUrl('')).toBeNull();
    expect(lib.amazonArtistSearchUrl('  ')).toBeNull();
    expect(lib.amazonArtistSearchUrl(null)).toBeNull();
    expect(lib.amazonArtistSearchUrl(undefined)).toBeNull();
  });
});

describe('amazonSpecSearchRequest artist spec', () => {
  const search = (searchText, specType) => JSON.stringify({
    operationName: 'SpecSearchSeeMorePage',
    variables: {
      searchText, specType, firstLimit: 30, isAuthenticated: true,
      audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false
    },
    extensions: {
      clientLibrary: { name: '@apollo/client', version: '4.1.6' },
      persistedQuery: { version: 1, sha256Hash: '19e7571fa4ccb97a7e70bacbf8877ad9f63ba23359131807300ac6eb8616b083' }
    }
  });

  test('the artist spec is accepted only with { spec: "artist" }', () => {
    expect(lib.amazonSpecSearchRequest([search('warning', 'artist')], 'warning', { spec: 'artist' }).variables.specType).toBe('artist');
    // Artist mode must not accept the track or album spec — the same
    // entity-in-the-wrong-slot rule, for photos this time.
    expect(lib.amazonSpecSearchRequest([search('warning', 'track')], 'warning', { spec: 'artist' })).toBeNull();
    expect(lib.amazonSpecSearchRequest([search('warning', 'album')], 'warning', { spec: 'artist' })).toBeNull();
    // The default (track) mode never matches the artist spec either.
    expect(lib.amazonSpecSearchRequest([search('warning', 'artist')], 'warning')).toBeNull();
  });
});

// The artist-spec SpecSearchSeeMorePage response (shape live-verified
// 2026-10, the "warning" search): edges[].node = Artist with id/name/images
// (imageType PROFILE or BACKGROUND — artists have no PRIMARY) /url — and the
// ranking is Amazon's: 'warning' leads with 'The Warning'.
describe('searchArtistImageFromGql', () => {
  const img = (id, width, height, imageType) => ({
    id: id + (imageType ? ':' + imageType : ''),
    url: 'https://m.media-amazon.com/images/I/' + id + '.jpg',
    width, height, imageType: imageType || null, __typename: 'Image'
  });
  const artistNode = (id, name, images) => ({
    __typename: 'Artist',
    id,
    name,
    images,
    uri: 'mrn:1.0:catalog:artist:asin:' + id + '?territory=US',
    url: 'https://music.amazon.com/artists/' + id + '?ref=dm_ff_amazonmusic_greenhornet_web'
  });
  const response = (edges) => ({
    specificationSearch: {
      id: 'search_0179e2c66e',
      searchText: '"warning"',
      result: [
        {
          __typename: 'SpecificationSearchResult',
          label: 'requiredButUnused',
          edges: edges.map(node => ({ __typename: 'EntityEdge', node }))
        }
      ]
    }
  });

  test('finds the exact artist even when Amazon ranks a namesake first, and picks the widest PROFILE photo', () => {
    const data = response([
      artistNode('B000U7ZTW2', 'Fates Warning', [img('81fjIzayUYL', 2560, 1920, 'BACKGROUND'), img('71rGf-BOhvL', 2560, 1701, 'PROFILE'), img('418N-wFRGiL', 500, 332, 'PROFILE')]),
      artistNode('B00V07PBMY', 'The Warning', [img('9160a4z-YNL', 2549, 1912, 'BACKGROUND'), img('41mVLfnDeyL', 500, 500, 'PROFILE'), img('71KKtoQJVeL', 1366, 1366, 'PROFILE')]),
      artistNode('B000RHPPF6', 'Warning', [img('81BePqr9D6L', 1448, 1448, 'PROFILE'), img('41L8NFlJ3vL', 500, 500, 'PROFILE')])
    ]);
    expect(lib.searchArtistImageFromGql(data, 'The Warning')).toEqual({ url: 'https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg', envelope: true });
    // Fates Warning leads this fixture's ranking and is a different artist —
    // a rank-based pick would pin its photo on The/Warning.
    expect(lib.searchArtistImageFromGql(data, 'Fates Warning')).toEqual({ url: 'https://m.media-amazon.com/images/I/71rGf-BOhvL.jpg', envelope: true });
  });

  test('a leading-The alias folds to the same key; Amazon\'s ranking breaks the tie', () => {
    // normalizeArtistName strips a leading "The", so 'The Warning' and
    // 'Warning' are the same key — the same collision the Deezer and Subsonic
    // chain steps have. The first ranked node with the key wins (live
    // ranking for 'warning': The Warning above Warning).
    const data = response([
      artistNode('B00V07PBMY', 'The Warning', [img('71KKtoQJVeL', 1366, 1366, 'PROFILE')]),
      artistNode('B000RHPPF6', 'Warning', [img('81BePqr9D6L', 1448, 1448, 'PROFILE')])
    ]);
    expect(lib.searchArtistImageFromGql(data, 'Warning')).toEqual({ url: 'https://m.media-amazon.com/images/I/71KKtoQJVeL.jpg', envelope: true });
  });

  test('falls back to the widest image of any type when there is no PROFILE', () => {
    const data = response([
      artistNode('B000S2JA4W', 'Eminem', [img('41ARdb+TI0L', 500, 375, 'BACKGROUND'), img('810cSt8jgfL', 2560, 1920, 'BACKGROUND')])
    ]);
    expect(lib.searchArtistImageFromGql(data, 'Eminem')).toEqual({ url: 'https://m.media-amazon.com/images/I/810cSt8jgfL.jpg', envelope: true });
  });

  test('an image URL with a query string is skipped — never a credential in the persisted cache', () => {
    const signed = img('x1', 2400, 2400, 'PROFILE');
    signed.url = 'https://m.media-amazon.com/images/I/x1.jpg?token=abc';
    const photo = img('x2', 500, 500, 'PROFILE');
    const data = response([artistNode('B0X1', 'Xtc', [signed, photo])]);
    expect(lib.searchArtistImageFromGql(data, 'XTC')).toEqual({ url: 'https://m.media-amazon.com/images/I/x2.jpg', envelope: true });
    // And when every URL is query-bearing the artist reports no photo.
    const onlySigned = response([artistNode('B0X1', 'Xtc', [signed])]);
    expect(lib.searchArtistImageFromGql(onlySigned, 'XTC')).toEqual({ url: null, envelope: true });
  });

  test('an image URL off m.media-amazon.com is skipped — a third-party host must not persist', () => {
    const offHost = img('y1', 2400, 2400, 'PROFILE');
    offHost.url = 'https://tracker.example.com/pixel.jpg';
    const siblingHost = img('y2', 1200, 1200, 'PROFILE');
    siblingHost.url = 'https://m.media-amazon.com.evil.example/images/I/y2.jpg';
    const photo = img('y3', 500, 500, 'PROFILE');
    const data = response([artistNode('B0X1', 'Xtc', [offHost, siblingHost, photo])]);
    expect(lib.searchArtistImageFromGql(data, 'XTC')).toEqual({ url: 'https://m.media-amazon.com/images/I/y3.jpg', envelope: true });
    expect(lib.searchArtistImageFromGql(response([artistNode('B0X1', 'Xtc', [offHost])]), 'XTC')).toEqual({ url: null, envelope: true });
  });

  test('the matched artist with no usable photo is a miss — never another artist\'s photo', () => {
    const data = response([
      artistNode('B0N01', 'Photoless', []),
      artistNode('B000RHPPF6', 'Warning', [img('81BePqr9D6L', 1448, 1448, 'PROFILE')])
    ]);
    expect(lib.searchArtistImageFromGql(data, 'Photoless')).toEqual({ url: null, envelope: true });
  });

  test('no exact-normalized name in the spec is a miss', () => {
    const data = response([
      artistNode('B000U7ZTW2', 'Fates Warning', [img('71rGf-BOhvL', 2560, 1701, 'PROFILE')]),
      artistNode('B00V07PBMY', 'The Warning', [img('71KKtoQJVeL', 1366, 1366, 'PROFILE')])
    ]);
    expect(lib.searchArtistImageFromGql(data, 'Warrant')).toEqual({ url: null, envelope: true });
  });

  test('normalization matches the chain: case, marks, leading The, & and punctuation fold away', () => {
    const data = response([artistNode('B0B1', 'Björk', [img('p1', 500, 500, 'PROFILE')])]);
    expect(lib.searchArtistImageFromGql(data, 'bjork')).toEqual({ url: 'https://m.media-amazon.com/images/I/p1.jpg', envelope: true });
    const amp = response([artistNode('B0B2', 'Simon & Garfunkel', [img('p2', 500, 500, 'PROFILE')])]);
    expect(lib.searchArtistImageFromGql(amp, 'Simon and Garfunkel')).toEqual({ url: 'https://m.media-amazon.com/images/I/p2.jpg', envelope: true });
  });

  test('a Track/Album edge in the artist spec is dropped', () => {
    const track = { __typename: 'Track', id: 'B0FBVD5MW3', title: 'Warning', images: [img('t1', 1448, 1448, 'PRIMARY')] };
    const album = { __typename: 'Album', id: 'B001227N6E', title: 'Warning', images: [img('a1', 1450, 1450, 'PRIMARY')] };
    const out = lib.searchArtistImageFromGql(response([track, album]), 'Warning');
    expect(out).toEqual({ url: null, envelope: true });
    expect(lib.artistFromGqlSearchNode(track)).toBeNull();
    expect(lib.artistFromGqlSearchNode(null)).toBeNull();
    expect(lib.artistFromGqlSearchNode({ __typename: 'Artist', name: 'X' })).toBeNull(); // no id
    expect(lib.artistFromGqlSearchNode({ __typename: 'Artist', id: 'B0X1' })).toBeNull(); // no name
  });

  test('a missing name is a miss, not an error; an absent envelope is structural', () => {
    const data = response([artistNode('B000RHPPF6', 'Warning', [img('81BePqr9D6L', 1448, 1448, 'PROFILE')])]);
    expect(lib.searchArtistImageFromGql(data, '')).toEqual({ url: null, envelope: true });
    expect(lib.searchArtistImageFromGql({ somethingElse: {} })).toEqual({ url: null, envelope: false });
    expect(lib.searchArtistImageFromGql(null)).toEqual({ url: null, envelope: false });
    expect(lib.searchArtistImageFromGql(undefined)).toEqual({ url: null, envelope: false });
  });

  test('empty edges in a present envelope is a real miss', () => {
    const out = lib.searchArtistImageFromGql(response([]), 'Warning');
    expect(out).toEqual({ url: null, envelope: true });
  });
});

describe('amazonNormalizeArtistName', () => {
  test('mirrors normalizeArtistName in src/renderer/lib/album-catalog.js', () => {
    const { normalizeArtistName } = require('../../src/renderer/lib/album-catalog');
    for (const name of ['The Warning', 'Fates Warning', 'Björk', 'Simon & Garfunkel', 'ХЛЕБ', 'The Notorious B.I.G.', 'Guns N\' Roses', '']) {
      expect(lib.amazonNormalizeArtistName(name)).toBe(normalizeArtistName(name));
    }
  });
});

describe('albumDetailFromGql', () => {
  const mopArtist = ['Metallica', 'PRIMARY'];
  const detailTrack = (id, title, shortTitle, trackNumber, duration, artists, explicit = false) => ({
    __typename: 'Track',
    id,
    uri: 'mrn:1.0:catalog:track:asin:' + id + '?territory=US',
    mediaType: 'AUDIO',
    title,
    shortTitle,
    images: [{ url: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg', width: 1200, height: 1200, imageType: 'PRIMARY', __typename: 'Image' }],
    contributingArtists: {
      edges: (artists || [mopArtist]).map(a => ({ role: a[1], node: { name: a[0], __typename: 'Artist' }, __typename: 'ArtistEdge' })),
      __typename: 'ArtistConnection'
    },
    album: { artistNames: 'Metallica', __typename: 'Album' },
    duration,
    trackNumber,
    parentalSettings: { hasExplicitLanguage: explicit, __typename: 'ParentalSettings' },
    url: 'https://music.amazon.com/tracks/' + id + '/?ref=dm_ff_amazonmusic_greenhornet_web'
  });
  const detailAlbum = (edges, over = {}) => ({
    __typename: 'Album',
    id: 'B07558DQJL',
    title: 'Master of Puppets (Remastered)',
    shortTitle: 'Master of Puppets',
    images: [
      { url: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg', width: 1200, height: 1200, imageType: 'PRIMARY', __typename: 'Image' },
      { url: 'https://m.media-amazon.com/images/I/513OAf2edPL.jpg', width: 500, height: 500, imageType: 'PRIMARY', __typename: 'Image' }
    ],
    contributingArtists: {
      edges: [{ role: 'PRIMARY', node: { name: 'Metallica', __typename: 'Artist', id: 'B000QJPIHU' }, __typename: 'ArtistEdge' }],
      __typename: 'ArtistConnection'
    },
    trackCount: 8,
    duration: 3284,
    releaseDate: '1986-02-21T00:00:00.000Z',
    url: 'https://music.amazon.com/albums/B07558DQJL?ref=dm_ff_amazonmusic_greenhornet_web',
    parentalSettings: { hasExplicitLanguage: false, __typename: 'ParentalSettings' },
    tracksConnection: { __typename: 'TrackConnection', edges: edges.map(node => ({ __typename: 'TrackEdge', node })) },
    ...over
  });

  test('maps the album and its tracks, keeping the server trackCount over truncated edges', () => {
    const data = {
      album: detailAlbum([
        detailTrack('B07554FHF5', 'Battery (Remastered)', 'Battery', 1, 312),
        detailTrack('B0755C8JX3', 'Master Of Puppets (Remastered)', 'Master Of Puppets', 2, 515),
        detailTrack('B07555PLZZ', 'The Thing That Should Not Be (Remastered)', 'The Thing That Should Not Be', 3, 396)
      ])
    };
    const out = lib.albumDetailFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.album.asin).toBe('B07558DQJL');
    // The full title, not shortTitle: editions distinguish releases. The
    // album URL is minted from the ASIN, dropping the ?ref= tracker.
    expect(out.album.name).toBe('Master of Puppets (Remastered)');
    expect(out.album.artist).toBe('Metallica');
    expect(out.album.albumArt).toBe('https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg');
    expect(out.album.releaseDate).toBe('1986-02-21T00:00:00.000Z');
    expect(out.album.url).toBe('https://music.amazon.com/albums/B07558DQJL');
    expect(out.album.explicit).toBe(false);
    // Three edges parsed but the album says eight — the shortfall stays
    // visible for the caller to log, like a truncated playlist page.
    expect(out.album.trackCount).toBe(8);
    expect(out.album.tracks).toEqual([
      { asin: 'B07554FHF5', title: 'Battery (Remastered)', artist: 'Metallica', duration: 312, trackNumber: 1, explicit: false, discNumber: 1 },
      { asin: 'B0755C8JX3', title: 'Master Of Puppets (Remastered)', artist: 'Metallica', duration: 515, trackNumber: 2, explicit: false, discNumber: 1 },
      { asin: 'B07555PLZZ', title: 'The Thing That Should Not Be (Remastered)', artist: 'Metallica', duration: 396, trackNumber: 3, explicit: false, discNumber: 1 }
    ]);
  });

  test('disc numbers come from the trackNumber resets (S&M2: 1..10, 1..13)', () => {
    const live = (id, title, tn, dur) => detailTrack(id, title, title, tn, dur, [['Metallica', 'PRIMARY'], ['San Francisco Symphony', 'PRIMARY']]);
    const data = {
      album: detailAlbum([
        live('B0897X5B49', 'No Leaf Clover (Live)', 9, 330),
        live('B0897YX5BS', 'Halo on Fire (Live)', 10, 497),
        live('B0897X532Q', 'Intro to Scythian Suite (Live)', 1, 316),
        live('B0897YFYZW', 'Scythian Suite, Opus 20 II: The Enemy God And The Dance Of The Dark Spirits (Live)', 2, 219),
        live('B0897YDVKB', 'Intro to The Iron Foundry (Live)', 3, 62)
      ], {
        title: 'S&M2',
        contributingArtists: {
          edges: [
            { role: 'PRIMARY', node: { name: 'Metallica', __typename: 'Artist' }, __typename: 'ArtistEdge' },
            { role: 'PRIMARY', node: { name: 'San Francisco Symphony', __typename: 'Artist' }, __typename: 'ArtistEdge' }
          ],
          __typename: 'ArtistConnection'
        }
      })
    };
    const out = lib.albumDetailFromGql(data);
    expect(out.album.artist).toBe('Metallica, San Francisco Symphony');
    expect(out.album.tracks.map(t => [t.trackNumber, t.discNumber])).toEqual([[9, 1], [10, 1], [1, 2], [2, 2], [3, 2]]);
    // Per-track artists survive (compilations), joined like the search mapper.
    expect(out.album.tracks[0].artist).toBe('Metallica, San Francisco Symphony');
  });

  test('the explicit flag comes from the title marker or parentalSettings (Enema Of The State)', () => {
    const data = {
      album: detailAlbum([
        detailTrack('B07H734KCX', 'Dumpweed [Explicit]', 'Dumpweed', 1, 144, [['blink-182', 'PRIMARY']], true),
        detailTrack('B07H7338V8', "Don't Leave Me", "Don't Leave Me", 2, 144, [['blink-182', 'PRIMARY']], false)
      ], {
        title: 'Enema Of The State [Explicit]',
        shortTitle: 'Enema Of The State',
        parentalSettings: { hasExplicitLanguage: true, __typename: 'ParentalSettings' }
      })
    };
    const out = lib.albumDetailFromGql(data);
    expect(out.album.name).toBe('Enema Of The State');
    expect(out.album.explicit).toBe(true);
    expect(out.album.tracks[0].title).toBe('Dumpweed');
    expect(out.album.tracks[0].explicit).toBe(true);
    expect(out.album.tracks[1].explicit).toBe(false);
  });

  test('data.album null is the legitimate not-found, a missing album field is structural', () => {
    expect(lib.albumDetailFromGql({ album: null })).toEqual({ album: null, envelope: true });
    expect(lib.albumDetailFromGql({ somethingElse: {} })).toEqual({ album: null, envelope: false });
    expect(lib.albumDetailFromGql(null)).toEqual({ album: null, envelope: false });
  });

  test('an album with no tracksConnection still maps, with an empty track list', () => {
    const album = detailAlbum([]);
    delete album.tracksConnection;
    const out = lib.albumDetailFromGql({ album });
    expect(out.envelope).toBe(true);
    expect(out.album.tracks).toEqual([]);
    expect(out.album.trackCount).toBe(8);
  });
});

describe('albumTrackFromGqlEdge', () => {
  test('drops rows that are not tracks or lack the import fields', () => {
    expect(lib.albumTrackFromGqlEdge(null)).toBeNull();
    expect(lib.albumTrackFromGqlEdge({ node: null })).toBeNull();
    expect(lib.albumTrackFromGqlEdge({ node: { __typename: 'Track', id: 'B0X1' } })).toBeNull();
    expect(lib.albumTrackFromGqlEdge({
      node: {
        __typename: 'Track', id: 'B0X1', title: 'Song',
        contributingArtists: { edges: [{ role: 'FEATURED', node: {} }] }
      }
    })).toBeNull();
    // A non-Track typename (a row hornet added for a podcast) never maps.
    expect(lib.albumTrackFromGqlEdge({
      node: {
        __typename: 'PodcastEpisode', id: 'B0X1', title: 'Song',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] }
      }
    })).toBeNull();
  });
});

describe('assignDiscNumbers', () => {
  test('a trackNumber that does not advance starts a new disc; rows without one keep null', () => {
    const tracks = [
      { trackNumber: 1 }, { trackNumber: 2 }, { trackNumber: 1 }, { trackNumber: 2 },
      { title: 'untagged' }, { trackNumber: 3 }
    ];
    lib.assignDiscNumbers(tracks);
    expect(tracks.map(t => t.discNumber)).toEqual([1, 1, 2, 2, null, 2]);
  });
});

describe('albumTracksConnectionIn', () => {
  // Live-captured 2026-10 (the Resodance capture): AlbumDetailPage's response
  // carries data.album.tracksConnection.edges; AlbumSeo's carries data.album
  // with title/trackCount and a bare `tracks` field — no tracksConnection.
  test('the detail response passes, the header-only SEO response does not', () => {
    expect(lib.albumTracksConnectionIn({
      album: { id: 'B07558DQJL', title: 'Master of Puppets (Remastered)', tracksConnection: { __typename: 'TrackConnection', edges: [] } }
    })).toBe(true);
    expect(lib.albumTracksConnectionIn({
      album: { id: 'B0H7NR1GWR', title: 'Resodance [Explicit]', trackCount: 12, tracks: { total: 12 } }
    })).toBe(false);
  });

  test('nulls and wrong shapes do not pass', () => {
    expect(lib.albumTracksConnectionIn(null)).toBe(false);
    expect(lib.albumTracksConnectionIn({})).toBe(false);
    expect(lib.albumTracksConnectionIn({ album: null })).toBe(false);
    expect(lib.albumTracksConnectionIn({ album: { tracksConnection: null } })).toBe(false);
    expect(lib.albumTracksConnectionIn({ album: { tracksConnection: { edges: 'nope' } } })).toBe(false);
  });
});

}
