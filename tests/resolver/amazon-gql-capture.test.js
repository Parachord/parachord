/**
 * The Amazon gql capture diagnostic (#1356 M11: the plugin's debugCaptureGql
 * and its _lib helpers, moved from the deleted amazon-web-player.js /
 * amazon-music-logic.js pair): which pages it accepts, which captured
 * requests it replays, what the reply carries, and how the flow rides the
 * webSession bridge. Built to collect the album search and album page
 * request/response shapes the Amazon plugin's album search needs — the tool
 * every new flow starts from.
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonWebSessionMock,
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();
const lib = instantiateAmazonPlugin(axe).lib;

// One captured AlbumDetailPage request body, as the bridge's returned
// captures carry them (headers paired by request id, echo flagged).
const albumDetailCapture = (asin, op = 'AlbumDetailPage') => ({
  url: 'https://gql.music.amazon.com/',
  method: 'POST',
  echo: false,
  body: JSON.stringify({
    operationName: op,
    variables: { id: asin },
    extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: 'deadbeefhash' } }
  }),
  headers: { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' }
});

const ALBUM_PAGE = 'https://music.amazon.com/albums/B0D1XYZ123';

describe('gqlCaptureSubject (the plugin _lib copy)', () => {
  test('an album page', () => {
    expect(lib.gqlCaptureSubject('https://music.amazon.com/albums/b0d1xyz123')).toEqual({ kind: 'album', asin: 'B0D1XYZ123' });
    expect(lib.gqlCaptureSubject('https://music.amazon.com/albums/B0D1XYZ123?trackAsin=B0X')).toEqual({ kind: 'album', asin: 'B0D1XYZ123' });
  });

  test('a search page, with or without its tab', () => {
    expect(lib.gqlCaptureSubject('https://music.amazon.com/search/wild%20pink/albums')).toEqual({ kind: 'search', searchText: 'wild pink', tab: 'albums' });
    expect(lib.gqlCaptureSubject('https://music.amazon.com/search/wild%20pink')).toEqual({ kind: 'search', searchText: 'wild pink', tab: null });
  });

  test('anything else is refused', () => {
    expect(lib.gqlCaptureSubject('https://music.amazon.com/playlists/abc')).toBe(null);
    expect(lib.gqlCaptureSubject('https://evil.example/albums/B0D1XYZ123')).toBe(null);
    expect(lib.gqlCaptureSubject('http://music.amazon.com/albums/B0D1XYZ123')).toBe(null);
    expect(lib.gqlCaptureSubject('not a url')).toBe(null);
  });
});

describe('gqlRequestsIn', () => {
  test('a single request or a batch', () => {
    expect(lib.gqlRequestsIn('{"operationName":"a"}')).toEqual([{ operationName: 'a' }]);
    expect(lib.gqlRequestsIn('[{"operationName":"a"},{"operationName":"b"}]')).toHaveLength(2);
    expect(lib.gqlRequestsIn('nope')).toEqual([]);
  });
});

describe('gqlRequestIsAboutSubject', () => {
  const album = { kind: 'album', asin: 'B0D1XYZ123' };
  const search = { kind: 'search', searchText: 'wild pink', tab: 'albums' };

  test('the page\'s own read query for its album is replayed', () => {
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'albumDetail', variables: { id: 'B0D1XYZ123' } }, album)).toBe(true);
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'albumDetail', variables: { input: { asin: 'b0d1xyz123' } } }, album)).toBe(true);
  });

  test('the search query for the page\'s text is replayed', () => {
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'SpecSearchSeeMorePage', variables: { searchText: 'Wild Pink', specType: 'album' } }, search)).toBe(true);
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'SpecSearchSeeMorePage', variables: { searchText: 'something else' } }, search)).toBe(false);
  });

  test('unrelated queries are not replayed', () => {
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'getHomeFeed', variables: { region: 'US' } }, album)).toBe(false);
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'x' }, album)).toBe(false);
  });

  test('writes are never replayed, even about the album', () => {
    for (const operationName of ['addToLibrary', 'removeFromLibrary', 'recordPlaybackEvent', 'likeAlbum', 'trackImpression', 'updateRecentlyPlayed', 'followArtist', 'SaveAlbumMutation']) {
      expect(lib.gqlRequestIsAboutSubject({ operationName, variables: { asin: 'B0D1XYZ123' } }, album)).toBe(false);
    }
    expect(lib.gqlRequestIsAboutSubject({ query: 'mutation X { add(asin: "B0D1XYZ123") }', variables: { asin: 'B0D1XYZ123' } }, album)).toBe(false);
  });

  test('a read query whose name merely starts with "track" in lower case is still allowed', () => {
    expect(lib.gqlRequestIsAboutSubject({ operationName: 'tracksForAlbum', variables: { id: 'B0D1XYZ123' } }, album)).toBe(true);
  });
});

describe('redactGqlSample', () => {
  test('credential-like keys are redacted at any depth', () => {
    const out = lib.redactGqlSample({
      data: { album: { title: 'Still Coming Down', customerId: 'A1B2', meta: { csrfToken: 'x', deviceType: 'y', userEmail: 'me@example.com' } } },
      extensions: { accessToken: 't', sessionId: 's' },
    });
    expect(out.data.album.title).toBe('Still Coming Down');
    expect(out.data.album.customerId).toBe('[redacted]');
    expect(out.data.album.meta).toEqual({ csrfToken: '[redacted]', deviceType: '[redacted]', userEmail: '[redacted]' });
    expect(out.extensions).toEqual({ accessToken: '[redacted]', sessionId: '[redacted]' });
  });

  test('query strings are cut from URLs (signed CDN links)', () => {
    expect(lib.redactGqlSample({ image: 'https://m.media-amazon.com/images/I/abc.jpg?Signature=xyz&Expires=1' }).image)
      .toBe('https://m.media-amazon.com/images/I/abc.jpg?[query removed]');
    expect(lib.redactGqlSample({ image: 'https://m.media-amazon.com/images/I/abc.jpg' }).image)
      .toBe('https://m.media-amazon.com/images/I/abc.jpg');
  });

  test('long arrays and strings are trimmed but keep their shape', () => {
    const out = lib.redactGqlSample({ edges: [1, 2, 3, 4, 5, 6], blurb: 'x'.repeat(400) });
    expect(out.edges).toEqual([1, 2, 3, '[3 more]']);
    expect(out.blurb).toHaveLength(301);
    expect(lib.redactGqlSample([1, 2], { maxArray: 10 })).toEqual([1, 2]);
  });

  test('primitives pass through', () => {
    expect(lib.redactGqlSample(5)).toBe(5);
    expect(lib.redactGqlSample(null)).toBe(null);
    expect(lib.redactGqlSample(true)).toBe(true);
  });
});

describe('summarizeGqlRequest', () => {
  test('header names only, never their values', () => {
    const entry = {
      url: 'https://gql.music.amazon.com/graphql?x=1',
      headers: { 'x-amz-access-token': 'SECRET', Cookie: 'session=SECRET', 'Content-Type': 'application/json' },
    };
    const req = { operationName: 'albumDetail', variables: { id: 'B0D1XYZ123', csrf: 'SECRET' }, extensions: { persistedQuery: { sha256Hash: 'abc' } } };
    const out = lib.summarizeGqlRequest(entry, req);
    expect(out).toEqual({
      operationName: 'albumDetail',
      endpoint: 'https://gql.music.amazon.com/graphql',
      persistedQuery: true,
      hasQueryText: false,
      variables: { id: 'B0D1XYZ123', csrf: '[redacted]' },
      headerNames: ['Content-Type', 'Cookie', 'x-amz-access-token'],
    });
    expect(JSON.stringify(out)).not.toContain('SECRET');
  });
});

describe('amazonGqlFetchHeaders (the replay-header filter, the _lib copy)', () => {
  test('keeps the gql auth headers and drops browser-managed ones', () => {
    const headers = lib.amazonGqlFetchHeaders({
      'content-type': 'application/json',
      accept: 'application/graphql-response+json, application/json',
      'x-api-key': 'amzn1.application.4ff5579ca2e3407aba989a1f5dbdaf69',
      'csrf-token': 'dAFuzikk=',
      'csrf-rnd': '2128471272',
      'csrf-ts': '1791997974',
      'music-territory': 'US',
      'x-amzn-device-id': '12345678901234567',
      Cookie: 'at-main=secret; session-id=143',
      Origin: 'https://music.amazon.com',
      Referer: 'https://music.amazon.com/',
      'User-Agent': 'Mozilla/5.0',
      'sec-fetch-site': 'same-site',
      'sec-ch-ua': '"Not_A Brand"',
      'Accept-Encoding': 'gzip',
      Host: 'gql.music.amazon.com'
    });
    expect(Object.keys(headers).sort()).toEqual([
      'accept', 'content-type', 'csrf-rnd', 'csrf-token', 'csrf-ts',
      'music-territory', 'x-amzn-device-id', 'x-api-key'
    ]);
    expect(headers['x-api-key']).toBe('amzn1.application.4ff5579ca2e3407aba989a1f5dbdaf69');
    expect(headers.Cookie).toBeUndefined();
  });

  test('tolerates missing headers', () => {
    expect(lib.amazonGqlFetchHeaders(null)).toEqual({});
  });
});

// ── the wiring: the flow over the bridge ───────────────────────────────────
//
// debugCaptureGql rides the plugin's page-flow chain and the mocked
// webSession bridge at the same seam every other plugin flow uses: the
// signed-in guard (isSignedIn → state), one load with the capture window
// inside it (3s quiet / 20s budget — a diagnostic waits the page's whole
// burst), the after-load wall re-check, and one replay per subject read with
// the reply redacted before it leaves the method.
describe('debugCaptureGql (the wiring)', () => {
  afterEach(() => {
    delete global.window;
  });

  test('rides the bridge: load with the 20s capture window, replay the subject read, redact it', async () => {
    const ws = amazonWebSessionMock({
      envelope: { data: { album: { title: 'Still Coming Down', customerId: 'A1B2' } } },
      capturesFor: () => [
        albumDetailCapture('B0D1XYZ123'),
        { url: 'https://gql.music.amazon.com/', body: JSON.stringify({ operationName: 'getHomeFeed', variables: { region: 'US' } }), headers: { 'x-api-key': 'amzn1.application.x' } },
        albumDetailCapture('B0D1XYZ123', 'addToLibrary'),
      ],
    });
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.debugCaptureGql(ALBUM_PAGE);

    expect(out.subject).toEqual({ kind: 'album', asin: 'B0D1XYZ123' });
    // The diagnostic's own capture window: 3s quiet, at most 20s (the old
    // host flow's timings — a diagnostic wants the whole burst, not the
    // flows' tighter 2.5s/15s window).
    expect(ws.load).toHaveBeenCalledWith('amazon-music', ALBUM_PAGE, {
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 3000, budgetMs: 20000 }
    });
    expect(out.operations).toHaveLength(3);
    // The page's own read about the album is the one replayed — the unrelated
    // read and the write (even though its variables name the album) are not.
    const replayed = out.operations.filter(o => o.replayed);
    expect(replayed).toHaveLength(1);
    expect(replayed[0]).toMatchObject({ operationName: 'AlbumDetailPage' });
    // Only the redacted sample leaves the flow (header values never do).
    expect(replayed[0].response.data.album).toEqual({ title: 'Still Coming Down', customerId: '[redacted]' });
    expect(JSON.stringify(out)).not.toContain('A1B2');
    expect(out.operations.filter(o => !o.replayed).map(o => o.operationName).sort()).toEqual(['addToLibrary', 'getHomeFeed']);
    // Header NAMES only in the summary, never the values.
    expect(out.operations[0].headerNames).toContain('x-api-key');
    expect(JSON.stringify(out.operations[0].headerNames)).not.toContain('amzn1.application');
  });

  test('a page that ended on a wall is not-signed-in, not a failed capture', async () => {
    amazonWebSessionMock({
      finalUrl: 'https://www.amazon.com/ap/signin?return_to=x',
      capturesFor: () => [],
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.debugCaptureGql(ALBUM_PAGE)).rejects.toMatchObject({
      reason: 'not-signed-in'
    });
  });

  test('a refused load surfaces its reason', async () => {
    amazonWebSessionMock({ loadResult: { success: false, reason: 'load-failed', error: 'page did not finish loading' } });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.debugCaptureGql(ALBUM_PAGE)).rejects.toMatchObject({
      reason: 'load-failed'
    });
  });

  test('a bad URL is refused before anything loads', async () => {
    const ws = amazonWebSessionMock({});
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.debugCaptureGql('https://music.amazon.com/playlists/abc')).rejects.toMatchObject({
      reason: 'not-ready'
    });
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('a signed-out session is refused before any page load', async () => {
    const ws = amazonWebSessionMock({ signedIn: false });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.debugCaptureGql(ALBUM_PAGE)).rejects.toMatchObject({
      reason: 'not-signed-in'
    });
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('a busy gate on the subject replay is ridden out, then the reply lands', async () => {
    // A concurrent navigation (another plugin page flow) can hold the host's
    // readers/writer gate after the capture already succeeded: busy is
    // transient there — the same bounded backoff the other replay flows
    // carry, never a failed capture.
    const ws = amazonWebSessionMock({
      envelope: { data: { album: { title: 'Still Coming Down' } } },
      capturesFor: () => [albumDetailCapture('B0D1XYZ123')],
    });
    const outcomes = [
      { success: true, error: 'busy' },
      { success: true, status: 200, text: JSON.stringify({ data: { album: { title: 'Still Coming Down' } } }) },
    ];
    ws.pageFetch.mockImplementation(async () => outcomes.shift());
    const resolver = instantiateAmazonPlugin(axe);
    const out = await resolver.debugCaptureGql(ALBUM_PAGE);
    expect(out.operations).toHaveLength(1);
    expect(out.operations[0]).toMatchObject({ operationName: 'AlbumDetailPage', replayed: true });
    expect(out.operations[0].response.data.album).toEqual({ title: 'Still Coming Down' });
  });
});
