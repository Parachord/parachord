/**
 * The Amazon gql capture diagnostic (amazonWebPlayer.debugCaptureGql): which
 * pages it accepts, which captured requests it replays, and what may be
 * written to the capture file. Built to collect the album search and album
 * page request/response shapes the Amazon plugin's album search needs.
 */

const {
  gqlCaptureSubject,
  gqlRequestsIn,
  gqlRequestIsAboutSubject,
  redactGqlSample,
  summarizeGqlRequest,
} = require('../../amazon-music-logic');

describe('gqlCaptureSubject', () => {
  test('an album page', () => {
    expect(gqlCaptureSubject('https://music.amazon.com/albums/b0d1xyz123')).toEqual({ kind: 'album', asin: 'B0D1XYZ123' });
    expect(gqlCaptureSubject('https://music.amazon.com/albums/B0D1XYZ123?trackAsin=B0X')).toEqual({ kind: 'album', asin: 'B0D1XYZ123' });
  });

  test('a search page, with or without its tab', () => {
    expect(gqlCaptureSubject('https://music.amazon.com/search/wild%20pink/albums')).toEqual({ kind: 'search', searchText: 'wild pink', tab: 'albums' });
    expect(gqlCaptureSubject('https://music.amazon.com/search/wild%20pink')).toEqual({ kind: 'search', searchText: 'wild pink', tab: null });
  });

  test('anything else is refused', () => {
    expect(gqlCaptureSubject('https://music.amazon.com/playlists/abc')).toBe(null);
    expect(gqlCaptureSubject('https://evil.example/albums/B0D1XYZ123')).toBe(null);
    expect(gqlCaptureSubject('http://music.amazon.com/albums/B0D1XYZ123')).toBe(null);
    expect(gqlCaptureSubject('not a url')).toBe(null);
  });
});

describe('gqlRequestsIn', () => {
  test('a single request or a batch', () => {
    expect(gqlRequestsIn('{"operationName":"a"}')).toEqual([{ operationName: 'a' }]);
    expect(gqlRequestsIn('[{"operationName":"a"},{"operationName":"b"}]')).toHaveLength(2);
    expect(gqlRequestsIn('nope')).toEqual([]);
  });
});

describe('gqlRequestIsAboutSubject', () => {
  const album = { kind: 'album', asin: 'B0D1XYZ123' };
  const search = { kind: 'search', searchText: 'wild pink', tab: 'albums' };

  test('the page\'s own read query for its album is replayed', () => {
    expect(gqlRequestIsAboutSubject({ operationName: 'albumDetail', variables: { id: 'B0D1XYZ123' } }, album)).toBe(true);
    expect(gqlRequestIsAboutSubject({ operationName: 'albumDetail', variables: { input: { asin: 'b0d1xyz123' } } }, album)).toBe(true);
  });

  test('the search query for the page\'s text is replayed', () => {
    expect(gqlRequestIsAboutSubject({ operationName: 'SpecSearchSeeMorePage', variables: { searchText: 'Wild Pink', specType: 'album' } }, search)).toBe(true);
    expect(gqlRequestIsAboutSubject({ operationName: 'SpecSearchSeeMorePage', variables: { searchText: 'something else' } }, search)).toBe(false);
  });

  test('unrelated queries are not replayed', () => {
    expect(gqlRequestIsAboutSubject({ operationName: 'getHomeFeed', variables: { region: 'US' } }, album)).toBe(false);
    expect(gqlRequestIsAboutSubject({ operationName: 'x' }, album)).toBe(false);
  });

  test('writes are never replayed, even about the album', () => {
    for (const operationName of ['addToLibrary', 'removeFromLibrary', 'recordPlaybackEvent', 'likeAlbum', 'trackImpression', 'updateRecentlyPlayed', 'followArtist', 'SaveAlbumMutation']) {
      expect(gqlRequestIsAboutSubject({ operationName, variables: { asin: 'B0D1XYZ123' } }, album)).toBe(false);
    }
    expect(gqlRequestIsAboutSubject({ query: 'mutation X { add(asin: "B0D1XYZ123") }', variables: { asin: 'B0D1XYZ123' } }, album)).toBe(false);
  });

  test('a read query whose name merely starts with "track" in lower case is still allowed', () => {
    expect(gqlRequestIsAboutSubject({ operationName: 'tracksForAlbum', variables: { id: 'B0D1XYZ123' } }, album)).toBe(true);
  });
});

describe('redactGqlSample', () => {
  test('credential-like keys are redacted at any depth', () => {
    const out = redactGqlSample({
      data: { album: { title: 'Still Coming Down', customerId: 'A1B2', meta: { csrfToken: 'x', deviceType: 'y', userEmail: 'me@example.com' } } },
      extensions: { accessToken: 't', sessionId: 's' },
    });
    expect(out.data.album.title).toBe('Still Coming Down');
    expect(out.data.album.customerId).toBe('[redacted]');
    expect(out.data.album.meta).toEqual({ csrfToken: '[redacted]', deviceType: '[redacted]', userEmail: '[redacted]' });
    expect(out.extensions).toEqual({ accessToken: '[redacted]', sessionId: '[redacted]' });
  });

  test('query strings are cut from URLs (signed CDN links)', () => {
    expect(redactGqlSample({ image: 'https://m.media-amazon.com/images/I/abc.jpg?Signature=xyz&Expires=1' }).image)
      .toBe('https://m.media-amazon.com/images/I/abc.jpg?[query removed]');
    expect(redactGqlSample({ image: 'https://m.media-amazon.com/images/I/abc.jpg' }).image).toBe('https://m.media-amazon.com/images/I/abc.jpg');
  });

  test('long arrays and strings are trimmed but keep their shape', () => {
    const out = redactGqlSample({ edges: [1, 2, 3, 4, 5, 6], blurb: 'x'.repeat(400) });
    expect(out.edges).toEqual([1, 2, 3, '[3 more]']);
    expect(out.blurb).toHaveLength(301);
    expect(redactGqlSample([1, 2], { maxArray: 10 })).toEqual([1, 2]);
  });

  test('primitives pass through', () => {
    expect(redactGqlSample(5)).toBe(5);
    expect(redactGqlSample(null)).toBe(null);
    expect(redactGqlSample(true)).toBe(true);
  });
});

describe('summarizeGqlRequest', () => {
  test('header names only, never their values', () => {
    const entry = {
      url: 'https://gql.music.amazon.com/graphql?x=1',
      headers: { 'x-amz-access-token': 'SECRET', Cookie: 'session=SECRET', 'Content-Type': 'application/json' },
    };
    const req = { operationName: 'albumDetail', variables: { id: 'B0D1XYZ123', csrf: 'SECRET' }, extensions: { persistedQuery: { sha256Hash: 'abc' } } };
    const out = summarizeGqlRequest(entry, req);
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

// ── the wiring: the flow over the host's seams ─────────────────────────────
//
// debugCaptureGql is the module's one remaining page flow, and it runs
// end-to-end over the ONE host instance's primitives: the signed-in guard
// (state), the load chain (enqueue — a #1356 M10 review caught the deleted
// enqueueSearch wrapper making every diagnostic call a TypeError), the
// offscreen view, the capture (attachCapture), the budgeted load, the
// page-world replay (pageFetch) and the park fuse. The stubs below are the
// host's own seams — the module loads under plain require (electron is only
// touched inside the host's lazily-used methods), the pattern the deleted
// tests/resolver/amazon-web-player.test.js used.
describe('debugCaptureGql (the wiring)', () => {
  const amazonWebPlayer = require('../../amazon-web-player');

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  test('rides the host chain and completes: load, capture, replay, redact, detach', async () => {
    jest.useFakeTimers();
    const host = amazonWebPlayer.webSession;
    const spies = {
      state: jest.spyOn(host, 'state').mockResolvedValue({ url: null, signInUrl: null, cookieNames: ['at-main', 'sess-at-main'] }),
      // The regression: the flow rides the host's chain (the deleted
      // enqueueSearch wrapper is the seam a TypeError used to hide behind).
      enqueue: jest.spyOn(host, 'enqueue').mockImplementation((fn) => fn()),
      cancelPark: jest.spyOn(host, 'cancelPark').mockImplementation(() => {}),
      ensureView: jest.spyOn(host, 'ensureView').mockReturnValue({
        webContents: {
          isDestroyed: () => false,
          getURL: () => 'https://music.amazon.com/albums/B0D1XYZ123'
        }
      }),
      layoutOffscreen: jest.spyOn(host, 'layoutOffscreen').mockResolvedValue(undefined),
      beginNavigation: jest.spyOn(host, 'beginNavigation').mockResolvedValue(undefined),
      endNavigation: jest.spyOn(host, 'endNavigation').mockImplementation(() => {}),
      loadURLBudgeted: jest.spyOn(host, 'loadURLBudgeted').mockResolvedValue('https://music.amazon.com/albums/B0D1XYZ123'),
      pageFetch: jest.spyOn(host, 'pageFetch').mockResolvedValue({
        status: 200,
        text: JSON.stringify({ data: { album: { title: 'Still Coming Down', customerId: 'A1B2' } } })
      }),
      schedulePark: jest.spyOn(host, 'schedulePark').mockImplementation(() => {})
    };
    const detach = jest.fn();
    jest.spyOn(host, 'attachCapture').mockReturnValue({
      captured: [{
        url: 'https://gql.music.amazon.com/graphql',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          operationName: 'albumDetail',
          variables: { id: 'B0D1XYZ123' },
          extensions: { persistedQuery: { sha256Hash: 'abc' } }
        })
      }],
      detach
    });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    const run = amazonWebPlayer.debugCaptureGql('https://music.amazon.com/albums/B0D1XYZ123');
    // The quiet window: the capture stops after 6 unchanged 500ms ticks.
    for (let i = 0; i < 8; i++) await jest.advanceTimersByTimeAsync(500);
    const out = await run;

    expect(spies.enqueue).toHaveBeenCalledTimes(1); // it rode the host's chain
    expect(spies.state).toHaveBeenCalledTimes(1);   // the signed-in guard ran
    expect(spies.loadURLBudgeted).toHaveBeenCalledTimes(1);
    expect(out.subject).toEqual({ kind: 'album', asin: 'B0D1XYZ123' });
    expect(out.operations).toHaveLength(1);
    expect(out.operations[0]).toMatchObject({ operationName: 'albumDetail', replayed: true });
    // Only the redacted sample leaves the flow (header values never do).
    expect(out.operations[0].response.data.album).toEqual({ title: 'Still Coming Down', customerId: '[redacted]' });
    expect(detach).toHaveBeenCalledTimes(1);       // the capture came off
    expect(spies.schedulePark).toHaveBeenCalledTimes(1); // the fuse re-armed
    expect(log).toHaveBeenCalledTimes(1);
  });
});
