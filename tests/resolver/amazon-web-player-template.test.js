/**
 * amazon-web-player spec-search rework: replay-first templates + parallel
 * replays (docs/architecture/amazon-music.md). Pinned here:
 *   - a fresh template answers a spec search with NO page flow: replayGql
 *     gets the patched body (searchText/specType swapped, hash intact), and
 *     none of ensureWindow/layoutSearch/attachGqlCapture run
 *   - any template miss (stale, replay error, non-Amazon URL) queues the
 *     chained page flow, whose capture re-mints the template
 *   - a wall URL on the warm view is not-signed-in, a missing envelope is
 *     structural (breaker), and the breaker fail-fast precedes any replay
 *   - the delayed park fuse (SEARCH_VIEW_WARM_MS) and its cancel on activity
 *
 * The module is loaded with plain require: electron is pulled lazily behind
 * electron() inside the stubbed methods. Spec-search plumbing methods are
 * stubbed on the exported singleton — all looked up through `this`.
 */

const amazonWebPlayer = require('../../amazon-web-player');
const { makeSpecSearchTemplate, SPEC_TEMPLATE_MAX_AGE_MS } = require('../../amazon-music-logic');

const CAPTURED_BODY = {
  operationName: 'SpecSearchSeeMorePage',
  variables: {
    searchText: '"seed"', specType: 'track', firstLimit: 30,
    isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false
  },
  extensions: {
    clientLibrary: { name: '@apollo/client', version: '4.1.6' },
    persistedQuery: { version: 1, sha256Hash: 'deadbeefhash' }
  }
};
const CAPTURED_HEADERS = { 'x-api-key': 'amzn1.application.x', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' };

const trackEdge = {
  node: {
    __typename: 'Track', id: 'B000SNWG5Q', title: 'Around the World',
    contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Daft Punk' } }] },
    album: { shortTitle: 'Homework' }, duration: 430,
    images: [{ url: 'https://m.media-amazon.com/images/I/x.jpg', width: 500, height: 500, imageType: 'PRIMARY' }]
  }
};
const specEnvelope = (edges) => ({ specificationSearch: { result: [{ edges }] } });
const parseTracks = (data) => {
  const search = data && data.specificationSearch;
  if (!search) return { rows: [], envelope: false };
  const edges = (search.result && search.result[0] && search.result[0].edges) || [];
  return { rows: edges.map(e => e.node).filter(Boolean), envelope: true };
};

const fakeWin = (href = 'https://music.amazon.com/search/x/songs') => ({
  isDestroyed: () => false,
  loadURL: jest.fn().mockResolvedValue(undefined),
  webContents: {
    isDestroyed: () => false,
    getURL: () => href,
    loadURL: jest.fn().mockResolvedValue(undefined)
  }
});

describe('specSearch template replay', () => {
  let replayGql, ensureWindow, layoutSearch, attachGqlCapture;
  let savedTemplate, savedView, savedTimer, savedBreaker;

  beforeEach(() => {
    savedTemplate = amazonWebPlayer.specSearchTemplate;
    savedView = amazonWebPlayer.searchView;
    savedTimer = amazonWebPlayer.searchViewParkTimer;
    savedBreaker = amazonWebPlayer.searchBreaker;
    amazonWebPlayer.searchViewParkTimer = null;
    amazonWebPlayer.searchView = fakeWin();
    amazonWebPlayer.specSearchTemplate = makeSpecSearchTemplate({
      url: 'https://gql.music.amazon.com/', headers: CAPTURED_HEADERS, body: CAPTURED_BODY, capturedAt: Date.now()
    });
    replayGql = jest.spyOn(amazonWebPlayer, 'replayGql');
    ensureWindow = jest.spyOn(amazonWebPlayer, 'ensureWindow');
    layoutSearch = jest.spyOn(amazonWebPlayer, 'layoutSearch');
    attachGqlCapture = jest.spyOn(amazonWebPlayer, 'attachGqlCapture');
    amazonWebPlayer.searchBreaker = {
      allows: jest.fn(() => true),
      isProbe: jest.fn(() => false),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn(),
      state: jest.fn(() => ({ open: false, failures: 0, openUntil: 0 }))
    };
  });

  afterEach(() => {
    replayGql.mockRestore();
    ensureWindow.mockRestore();
    layoutSearch.mockRestore();
    attachGqlCapture.mockRestore();
    amazonWebPlayer.searchBreaker = savedBreaker;
    amazonWebPlayer.specSearchTemplate = savedTemplate;
    amazonWebPlayer.searchView = savedView;
    amazonWebPlayer.searchViewBusy = 0;
    if (amazonWebPlayer.searchViewParkTimer) clearTimeout(amazonWebPlayer.searchViewParkTimer);
    amazonWebPlayer.searchViewParkTimer = savedTimer;
    // The chain must be drained between tests (its jobs capture this suite's mocks).
    amazonWebPlayer.searchChain = Promise.resolve();
  });

  const run = (over = {}) => amazonWebPlayer.specSearch({
    url: 'https://music.amazon.com/search/q/songs',
    searchText: '"daft punk"',
    specType: 'track',
    noun: 'tracks',
    parse: parseTracks,
    ...over
  });

  test('a fresh template answers with no page flow: patched body replayed, hash intact, nothing else touched', async () => {
    replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
    const rows = await run();
    expect(rows).toEqual([trackEdge.node]);
    expect(replayGql).toHaveBeenCalledTimes(1);
    const [win, entry, body] = replayGql.mock.calls[0];
    expect(win).toBe(amazonWebPlayer.searchView);
    expect(entry.url).toBe('https://gql.music.amazon.com/');
    expect(entry.headers).toEqual(CAPTURED_HEADERS);
    expect(body.variables.searchText).toBe('"daft punk"');
    expect(body.variables.specType).toBe('track');
    expect(body.variables.firstLimit).toBe(30);
    expect(body.extensions.persistedQuery.sha256Hash).toBe('deadbeefhash');
    // The stored template was not mutated by patching.
    expect(amazonWebPlayer.specSearchTemplate.body.variables.searchText).toBe('"seed"');
    // No page flow, no chain plumbing.
    expect(ensureWindow).not.toHaveBeenCalled();
    expect(layoutSearch).not.toHaveBeenCalled();
    expect(attachGqlCapture).not.toHaveBeenCalled();
    expect(amazonWebPlayer.searchBreaker.recordSuccess).toHaveBeenCalled();
  });

  test('specType swaps on the shared template (the track capture serves the artist spec)', async () => {
    replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
    await run({ specType: 'artist', url: 'https://music.amazon.com/search/q/artists' });
    expect(replayGql.mock.calls[0][2].variables.specType).toBe('artist');
    // ...and the template itself still says track.
    expect(amazonWebPlayer.specSearchTemplate.body.variables.specType).toBe('track');
  });

  // The page flow's matcher keys on variables.searchText — the captured
  // body must carry the flow's own searchText or the poll never matches.
  const pageFlowCapture = (searched = '"daft punk"') => {
    const win = fakeWin();
    ensureWindow.mockResolvedValue(win);
    layoutSearch.mockResolvedValue('offscreen');
    const detach = jest.fn();
    const body = JSON.stringify(
      searched === null
        ? { operationName: 'OtherOp', variables: {} }
        : { ...CAPTURED_BODY, variables: { ...CAPTURED_BODY.variables, searchText: searched } }
    );
    attachGqlCapture.mockReturnValue({ captured: [{ id: 1, body, headers: CAPTURED_HEADERS, url: 'https://gql.music.amazon.com/' }], detach });
    return { win, detach };
  };

  test('a stale template queues the page flow, which re-mints it even when the body is content-identical', async () => {
    amazonWebPlayer.specSearchTemplate.capturedAt = Date.now() - SPEC_TEMPLATE_MAX_AGE_MS - 1000;
    const { win } = pageFlowCapture();
    replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
    const rows = await run();
    expect(rows).toEqual([trackEdge.node]);
    expect(attachGqlCapture).toHaveBeenCalled();
    expect(win.loadURL).toHaveBeenCalledWith('https://music.amazon.com/search/q/songs');
    // The page flow re-minted from its fresh capture — always, for a stale
    // template: refreshed headers are what the stale template needed.
    expect(amazonWebPlayer.specSearchTemplate.body.variables.searchText).toBe('"daft punk"');
    expect(Date.now() - amazonWebPlayer.specSearchTemplate.capturedAt).toBeLessThan(5000);
  });

  test('a fresh template is NOT re-minted from our own replay echoing into the capture', async () => {
    // A page flow (called directly — specSearch's fast path is not the
    // point here) whose capture matches byte-identically a replay of the
    // current template: minting would re-certify the template's own headers
    // with a fresh capturedAt, so the mint is skipped.
    const mintedAt = amazonWebPlayer.specSearchTemplate.capturedAt;
    const { win } = pageFlowCapture();
    replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
    await amazonWebPlayer.specSearchPageFlow({ url: 'https://music.amazon.com/search/q/songs', searchText: '"daft punk"', specType: 'track', noun: 'tracks', parse: parseTracks });
    expect(win.loadURL).toHaveBeenCalled();
    expect(amazonWebPlayer.specSearchTemplate.capturedAt).toBe(mintedAt);
    // ...and with a DIFFERENT body (a real page capture), mint proceeds.
    const different = JSON.parse(JSON.stringify(amazonWebPlayer.specSearchTemplate.body));
    different.extensions.persistedQuery.sha256Hash = 'newhash2';
    const win2 = fakeWin();
    ensureWindow.mockResolvedValue(win2);
    const ownBody = JSON.stringify({ ...different, variables: { ...different.variables, searchText: '"daft punk"' } });
    attachGqlCapture.mockReturnValue({ captured: [{ id: 1, body: ownBody, headers: CAPTURED_HEADERS, url: 'https://gql.music.amazon.com/' }], detach: jest.fn() });
    await amazonWebPlayer.specSearchPageFlow({ url: 'https://music.amazon.com/search/q/songs', searchText: '"daft punk"', specType: 'track', noun: 'tracks', parse: parseTracks });
    expect(amazonWebPlayer.specSearchTemplate.body.extensions.persistedQuery.sha256Hash).toBe('newhash2');
  });

  test('a replay error drops the old template and falls back to the page flow', async () => {
    const oldTemplate = amazonWebPlayer.specSearchTemplate;
    const { win } = pageFlowCapture();
    replayGql
      .mockResolvedValueOnce({ error: 'Amazon gql query failed (294)' }) // the template replay
      .mockResolvedValueOnce({ parsed: { data: specEnvelope([trackEdge]) } }); // the page flow's own replay
    const rows = await run();
    expect(rows).toEqual([trackEdge.node]);
    expect(win.loadURL).toHaveBeenCalled();
    // The failed template was dropped before the page flow re-minted its own.
    expect(amazonWebPlayer.specSearchTemplate).not.toBe(oldTemplate);
  });

  test('a wall URL on the warm view is not-signed-in without replaying', async () => {
    amazonWebPlayer.searchView = fakeWin('https://music.amazon.com/ap/signin');
    await expect(run()).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(replayGql).not.toHaveBeenCalled();
    expect(attachGqlCapture).not.toHaveBeenCalled();
  });

  test('a replay response without the spec envelope is structural (breaker), never a miss', async () => {
    replayGql.mockResolvedValue({ parsed: { data: { somethingElse: {} } } });
    await expect(run()).rejects.toMatchObject({ reason: 'not-ready' });
    expect(amazonWebPlayer.searchBreaker.recordFailure).toHaveBeenCalled();
    expect(amazonWebPlayer.searchBreaker.recordSuccess).not.toHaveBeenCalled();
  });

  test('a cooling breaker fails fast before any replay', async () => {
    amazonWebPlayer.searchBreaker.allows.mockReturnValue(false);
    await expect(run()).rejects.toMatchObject({ reason: 'not-ready' });
    expect(replayGql).not.toHaveBeenCalled();
    expect(attachGqlCapture).not.toHaveBeenCalled();
  });

  test('staleCheck past budget short-circuits before path selection', async () => {
    const rows = await run({ staleCheck: () => true });
    expect(rows).toEqual([]);
    expect(replayGql).not.toHaveBeenCalled();
    expect(attachGqlCapture).not.toHaveBeenCalled();
  });

  test('an about:blank (parked) view means the page flow runs', async () => {
    amazonWebPlayer.searchView = fakeWin('about:blank');
    const { win } = pageFlowCapture();
    replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
    await run();
    expect(attachGqlCapture).toHaveBeenCalled();
    expect(win.loadURL).toHaveBeenCalled();
  });

  test('two searches in flight resolve concurrently off the chain', async () => {
    const resolvers = [];
    replayGql.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const chainCalls = [];
    const origEnqueue = amazonWebPlayer.enqueueSearch.bind(amazonWebPlayer);
    amazonWebPlayer.enqueueSearch = (fn) => { chainCalls.push(fn); return origEnqueue(fn); };
    const p1 = run({ searchText: '"one"' });
    const p2 = run({ searchText: '"two"' });
    try {
      await new Promise(r => setTimeout(r, 10));
      expect(replayGql).toHaveBeenCalledTimes(2); // both replays started with no chain in between
      resolvers.forEach(resolve => resolve({ parsed: { data: specEnvelope([trackEdge]) } }));
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toEqual([trackEdge.node]);
      expect(r2).toEqual([trackEdge.node]);
      expect(chainCalls).toEqual([]); // neither touched the search chain
    } finally {
      resolvers.forEach(resolve => resolve({ parsed: { data: specEnvelope([]) } }));
      amazonWebPlayer.enqueueSearch = origEnqueue;
      await Promise.allSettled([p1, p2]);
    }
  });

  test('a page flow navigation waits out an in-flight replay (writer drains readers)', async () => {
    const resolvers = [];
    replayGql.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
    const fast = run(); // reader in flight, replay pending
    const { win } = pageFlowCapture('"two"'); // writer plumbing mocked (capture carries its searchText)
    const flow = amazonWebPlayer.specSearchPageFlow({
      url: 'https://music.amazon.com/search/q2/songs',
      searchText: '"two"', specType: 'track', noun: 'tracks', parse: parseTracks
    });
    await new Promise(r => setTimeout(r, 30));
    expect(win.loadURL).not.toHaveBeenCalled(); // the writer is draining the reader first
    resolvers[0]({ parsed: { data: specEnvelope([trackEdge]) } }); // the reader's replay answers
    await fast;
    for (let i = 0; i < 20 && resolvers.length < 2; i++) await new Promise(r => setTimeout(r, 50));
    if (resolvers[1]) resolvers[1]({ parsed: { data: specEnvelope([trackEdge]) } });
    await flow;
    expect(win.loadURL).toHaveBeenCalledWith('https://music.amazon.com/search/q2/songs');
  });

  test('the park fuse blanks the view 30s after activity', async () => {
    jest.useFakeTimers();
    try {
      replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
      const parkSpy = jest.spyOn(amazonWebPlayer, 'parkSearchView').mockResolvedValue(undefined);
      await run();
      expect(amazonWebPlayer.searchViewParkTimer).not.toBeNull();
      jest.advanceTimersByTime(29_999);
      expect(parkSpy).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      await Promise.resolve();
      expect(parkSpy).toHaveBeenCalledTimes(1);
      parkSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('activity during a pending fuse cancels it (no blank-from-under the flow)', async () => {
    jest.useFakeTimers();
    try {
      replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
      const parkSpy = jest.spyOn(amazonWebPlayer, 'parkSearchView').mockResolvedValue(undefined);
      await run(); // arms the fuse
      // Simulate activity 20s later: the cancel hook (as trySpecReplay does on entry).
      jest.advanceTimersByTime(20_000);
      amazonWebPlayer.cancelSearchViewPark();
      jest.advanceTimersByTime(60_000);
      expect(parkSpy).not.toHaveBeenCalled();
      parkSpy.mockRestore();
    } finally {
      jest.useRealTimers();
    }
  });

  test('the fuse RE-ARMS instead of blanking while a flow is using the view (fire-time busy check)', async () => {
    jest.useFakeTimers();
    try {
      const parkSpy = jest.spyOn(amazonWebPlayer, 'parkSearchView').mockResolvedValue(undefined);
      // Busy is what every enqueued page flow holds: a parked-then-long job
      // must not have the view blanked under it by an older fuse.
      amazonWebPlayer.scheduleParkSearchView();
      amazonWebPlayer.searchViewBusy = 1; // a flow in flight
      jest.advanceTimersByTime(30_000);   // fuse fires: busy → re-arm, no blank
      expect(parkSpy).not.toHaveBeenCalled();
      expect(amazonWebPlayer.searchViewParkTimer).not.toBeNull();
      jest.advanceTimersByTime(15_000);   // flow still running at t=45s: nothing happens
      expect(parkSpy).not.toHaveBeenCalled();
      amazonWebPlayer.searchViewBusy = 0; // flow ends
      jest.advanceTimersByTime(15_000);   // re-armed fuse fires at t=60s
      await Promise.resolve();
      expect(parkSpy).toHaveBeenCalledTimes(1);
      parkSpy.mockRestore();
    } finally {
      amazonWebPlayer.searchViewBusy = 0;
      jest.useRealTimers();
    }
  });

  test('an in-flight replay holds the view busy until it exits', async () => {
    let release;
    replayGql.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const pending = run(); // enters the gate and holds searchViewBusy
    for (let i = 0; i < 20 && amazonWebPlayer.searchViewBusy !== 1; i++) await new Promise(r => setTimeout(r, 25));
    expect(amazonWebPlayer.searchViewBusy).toBe(1);
    release({ parsed: { data: specEnvelope([trackEdge]) } });
    await pending;
    expect(amazonWebPlayer.searchViewBusy).toBe(0);
  });

  test('a HARD replay rejection is a template miss, not a raw throw (M1): fallback page flow answers', async () => {
    const oldTemplate = amazonWebPlayer.specSearchTemplate;
    const { win } = pageFlowCapture();
    replayGql
      .mockRejectedValueOnce(new Error('Object has been destroyed')) // the template replay
      .mockResolvedValueOnce({ parsed: { data: specEnvelope([trackEdge]) } }); // the page flow's replay
    const rows = await run();
    expect(rows).toEqual([trackEdge.node]);
    expect(win.loadURL).toHaveBeenCalled();
    expect(amazonWebPlayer.specSearchTemplate).not.toBe(oldTemplate);
  });

  test('a replay overlapping the capture poll degrades the other-spec grace to the full window (M2)', async () => {
    // The capture carries a same-text DIFFERENT-spec body (as a foreign
    // replay would inject) before the page's own track request — without
    // protection that starts the anySpec grace and ends the flow
    // structurally 8 polls later. Replay traffic overlaps the poll, so the
    // grace must not conclude; the page's own request arriving later wins.
    const foreignBody = JSON.stringify({
      ...CAPTURED_BODY,
      variables: { ...CAPTURED_BODY.variables, searchText: '"daft punk"', specType: 'album' }
    });
    const ownBody = JSON.stringify({
      ...CAPTURED_BODY,
      variables: { ...CAPTURED_BODY.variables, searchText: '"daft punk"', specType: 'track' }
    });
    const win = fakeWin();
    ensureWindow.mockResolvedValue(win);
    layoutSearch.mockResolvedValue('offscreen');
    const captured = [{ id: 1, body: foreignBody, headers: CAPTURED_HEADERS, url: 'https://gql.music.amazon.com/' }];
    const detach = jest.fn();
    attachGqlCapture.mockReturnValue({ captured, detach });
    replayGql.mockResolvedValue({ parsed: { data: specEnvelope([trackEdge]) } });
    const flowPromise = amazonWebPlayer.specSearchPageFlow({
      url: 'https://music.amazon.com/search/q/songs',
      searchText: '"daft punk"', specType: 'track', noun: 'tracks', parse: parseTracks
    });
    // A REAL template replay overlaps the poll (bumps replayActivity as it enters).
    setTimeout(() => {
      amazonWebPlayer.trySpecReplay({ searchText: '"daft punk"', specType: 'album', parse: parseTracks, noun: 'albums' })
        .catch(() => {});
    }, 400);
    // The page's own track-spec request arrives ~3s in (past the 8-poll grace).
    setTimeout(() => captured.push({ id: 2, body: ownBody, headers: CAPTURED_HEADERS, url: 'https://gql.music.amazon.com/' }), 3000);
    const rows = await flowPromise;
    expect(rows).toEqual([trackEdge.node]);
    expect(amazonWebPlayer.searchBreaker.recordFailure).not.toHaveBeenCalled();
  }, 15_000);
});

describe('signOut template hygiene', () => {
  test('signOut drops the template and the park fuse', async () => {
    const savedChain = amazonWebPlayer.searchChain;
    amazonWebPlayer.specSearchTemplate = { url: 'x', headers: {}, body: {}, capturedAt: Date.now() };
    amazonWebPlayer.scheduleParkSearchView();
    expect(amazonWebPlayer.searchViewParkTimer).not.toBeNull();
    const destroyView = jest.spyOn(amazonWebPlayer, 'destroyView').mockImplementation(() => {});
    await amazonWebPlayer.signOut(); // session() electron call fails post-clear → success:false is fine
    expect(amazonWebPlayer.specSearchTemplate).toBeNull();
    expect(amazonWebPlayer.searchViewParkTimer).toBeNull();
    destroyView.mockRestore();
    amazonWebPlayer.searchChain = savedChain;
  });
});
