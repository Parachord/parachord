/**
 * The Amazon plugin's spec-search runner (#1356 M5; plugins-src/amazonmusic/
 * implementation.js) — the machinery pins from amazon-web-player-template.test.js
 * ported to drive the PLUGIN methods against a mocked window.electron.webSession
 * bridge (the preload wrappers' shapes; docs/architecture/web-session.md,
 * "The IPC bridge"). The host file still pins the host-side runner the
 * album/artist searches use until their milestone; the matchers agree because
 * both are copies of the same pure helpers (amazon-music-logic.js owns the
 * host copies, the plugin's _lib the moved ones).
 *
 * Pinned here:
 *   - the plan gate: not-signed-in when signed out, plan-ineligible when the
 *     plan can't play (prime or unreadable), both before any search and never
 *     a sign-in prompt for a plan refusal
 *   - a fresh template answers a spec search with NO page flow: pageFetch gets
 *     the patched body (searchText/specType swapped, APQ hash intact), and
 *     load is never called
 *   - any template miss (stale, replay error, busy navigation, dead view)
 *     runs the page flow, whose RETURNED captures (the bridge's quiet-bounded
 *     capture window) re-mint the template
 *   - the echo rules on the data the bridge provides: our own echoed capture
 *     never re-mints the template, and an echoed other-spec capture never
 *     reads as the page having searched another spec (#1152)
 *   - a wall URL on the warm view is not-signed-in; a missing envelope defers
 *     structure to the page flow (the breaker hears it ONCE — #1152); the
 *     breaker fail-fast precedes any replay
 *   - the spec-only rule: an album-spec capture for our text is a structural
 *     failure, never a track result
 *   - the moved parser (searchTracksFromGql) and the resolver track mapping
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin,
  amazonSearchCapture,
  amazonSpecEnvelope,
  amazonWebSessionMock
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

const TRACKS = [
  { asin: 'B000SNWG5Q', title: 'Around the World', artist: 'Daft Punk', album: 'Homework', albumAsin: 'B000031W1M', duration: 430, albumArt: 'https://m.media-amazon.com/images/I/B000SNWG5Q.jpg' },
  { asin: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', artist: 'Metallica', album: 'Master of Puppets', duration: 515 }
];

const resolverTrack = (t) => ({
  id: 'amazonmusic-' + t.asin,
  title: t.title,
  artist: t.artist,
  album: t.album,
  duration: t.duration || 0,
  sources: ['amazonmusic'],
  amazonAsin: t.asin,
  amazonUniqueId: t.uniqueId,
  genre: t.genre || null,
  explicit: !!t.explicit,
  albumArt: t.albumArt || null
});

const search = (resolver, query) => resolver.search(query, {});

afterEach(() => {
  delete global.window;
});

describe('the plan gate (#1220) before any search', () => {
  test('not-signed-in when signed out, before the plan is read or any page loads', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS, signedIn: false });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
    // The plan is read only when signed in — a signed-out search is the
    // sign-in prompt, never a plan refusal.
    expect(ws.fetch).not.toHaveBeenCalled();
  });

  test('the sign-in window sitting on a wall is signed out (a cookie alone is not a session)', async () => {
    amazonWebSessionMock({ tracks: TRACKS, signInUrl: 'https://www.amazon.com/ap/mfa?arb=x' });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('plan-ineligible when the account is Prime, before any search', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS, tier: 'PRIME' });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'plan-ineligible'
    });
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).not.toHaveBeenCalled();
    // The plan read is cached — a second search does not re-read config.json.
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ notReady: true, code: 'plan-ineligible' });
    expect(ws.fetch).toHaveBeenCalledTimes(1);
  });

  test('an unreadable config.json is unknown, and unknown blocks too', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS, configResult: { success: true, status: 200, headers: {}, text: 'not json' } });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'plan-ineligible'
    });
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('an unlimited tier searches (the gate passes through)', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS, tier: 'UNLIMITED_AUDIO' });
    const resolver = instantiateAmazonPlugin(axe);
    const rows = await search(resolver, 'daft punk around the world');
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
  });
});

describe('the resolver track mapping', () => {
  test('maps the runner rows to the resolver track shape', async () => {
    amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    const rows = await search(resolver, 'daft punk around the world');
    expect(rows).toEqual([resolverTrack(TRACKS[0]), resolverTrack(TRACKS[1])]);
  });

  test('returns [] on short queries without touching the bridge', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    expect(await search(resolver, 'd')).toEqual([]);
    expect(await search(resolver, '')).toEqual([]);
    expect(ws.state).not.toHaveBeenCalled();
    expect(ws.load).not.toHaveBeenCalled();
  });

  test('a present envelope with no usable edges is a real miss', async () => {
    amazonWebSessionMock({ envelope: { data: { specificationSearch: { result: [{ edges: [] }] } } } });
    const resolver = instantiateAmazonPlugin(axe);
    expect(await search(resolver, 'nothing anywhere')).toEqual([]);
  });
});

describe('the page flow (webSession.load with the capture window inside it)', () => {
  test('loads the songs tab with the gql capture prefix and the 15s budget, and mints the template', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    const rows = await search(resolver, { artist: 'daft punk', title: 'around the world' });
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
    const [sessionId, url, opts] = ws.load.mock.calls[0];
    expect(sessionId).toBe('amazon-music');
    expect(url).toBe('https://music.amazon.com/search/' + encodeURIComponent('"around the world" by "daft punk" OR "around the world" "daft punk" OR "daft punk" "around the world"') + '/songs');
    // The same capture lens and the same 15s window the old in-flow poll had.
    expect(opts.capture.urlPrefixes).toEqual(['https://gql.music.amazon.com/*']);
    expect(opts.capture.budgetMs).toBe(15000);
    // The quiet window is explicit, not the host's 1000ms default: the host
    // returns ~quietMs after load-finish when ZERO captures exist, so the
    // default would close before a cold view's first gql ever fired.
    expect(opts.capture.quietMs).toBeGreaterThanOrEqual(2500);
    // The page's own request was replayed verbatim to the captured URL.
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    const [rid, request] = ws.pageFetch.mock.calls[0];
    expect(rid).toBe('amazon-music');
    expect(request.url).toBe('https://gql.music.amazon.com/');
    const body = JSON.parse(request.body);
    expect(body.variables.searchText).toBe('"around the world" by "daft punk" OR "around the world" "daft punk" OR "daft punk" "around the world"');
    expect(body.variables.specType).toBe('track');
    expect(body.extensions.persistedQuery.sha256Hash).toBe('deadbeefhash');
  });

  test('a cold view whose first gql lands after the host default quiet window is still captured and matched', async () => {
    // The review fix: the host's awaitCaptureQuiet returns ~quietMs after
    // load-finish when ZERO captures exist, so a cold view whose first gql
    // lands >1s after load-finish under the host default (1000ms) would read
    // as "the page never fired the search" — a structural failure and a
    // breaker tick. The plugin's explicit window (2500ms) keeps the late
    // request inside it.
    const ws = amazonWebSessionMock({ tracks: TRACKS, captureDelayMs: 1200 });
    const resolver = instantiateAmazonPlugin(axe);
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    // The late capture was returned AND matched — the flow replayed it.
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    // The mock simulates the window honestly: the SAME 1200ms-late capture
    // under the host's default 1000ms window is not returned — the window
    // closed before the request fired. The wider window the plugin passes
    // is the only reason the capture above survived.
    const late = await ws.load('amazon-music', 'https://music.amazon.com/search/x/songs', {
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 1000 }
    });
    expect(late.captures).toEqual([]);
  });

  test('a refused load surfaces its reason — never cached as a miss, never a sign-in prompt', async () => {
    amazonWebSessionMock({ loadResult: { success: false, reason: 'load-failed', error: 'page did not finish loading within 30000ms' } });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'load-failed'
    });
  });

  test('a load superseded by a sign-out surfaces superseded', async () => {
    amazonWebSessionMock({ loadResult: { success: false, reason: 'superseded', error: 'the session was cleared while this load ran' } });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'superseded'
    });
  });

  test('a page that ended on a sign-in wall is not-signed-in, not a structural failure', async () => {
    amazonWebSessionMock({ tracks: TRACKS, finalUrl: 'https://www.amazon.com/ap/signin' });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
  });

  test('the page never firing the spec search is structural — with the operations it did fire', async () => {
    const ws = amazonWebSessionMock({
      capturesFor: () => [{ url: 'https://gql.music.amazon.com/', method: 'POST', body: JSON.stringify({ operationName: 'MusicHomePage', variables: {} }), headers: { 'x-api-key': 'k' } }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warnings = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
        notReady: true,
        code: 'not-ready'
      });
      expect(warnings.join('\n')).toContain('MusicHomePage');
      // The breaker COUNTED it (one structural failure — it opens at three,
      // so the next search still runs its flow).
      expect(resolver._searchBreaker.state()).toMatchObject({ failures: 1, open: false });
      // Three consecutive structural failures open it; the next search then
      // fails fast with no page load at all.
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'not-ready' });
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'not-ready' });
      expect(resolver._searchBreaker.state().open).toBe(true);
      const loadsBefore = ws.load.mock.calls.length;
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'not-ready' });
      expect(ws.load.mock.calls.length).toBe(loadsBefore);
    } finally {
      warn.mockRestore();
    }
  });

  test('a same-text other-spec capture reads as "the page searched another spec" — a structural failure with that diagnosis', async () => {
    // The spec-only rule at the flow level: the album spec searches the same
    // text (the album/artist searches share it), and its capture is never a
    // track result — the matcher rejects it and nothing is replayed.
    const ws = amazonWebSessionMock({
      capturesFor: (url) => {
        const m = decodeURIComponent(String(url)).match(/\/search\/(.+)\/songs$/);
        return m ? [amazonSearchCapture(m[1], { specType: 'album' })] : [];
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warnings = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
        notReady: true,
        code: 'not-ready'
      });
      expect(warnings.join('\n')).toContain('a non-track spec searched');
      expect(ws.pageFetch).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test('an ECHOED same-text other-spec capture is not page evidence — the diagnosis reads "never issued its search" (#1152)', async () => {
    // Our own replay traffic (this plugin's, or the host-side album/artist
    // runner's) arrives echo-flagged: reading it as "the page searched
    // another spec" is exactly the poisoning the echo flag exists to stop.
    const ws = amazonWebSessionMock({
      capturesFor: (url) => {
        const m = decodeURIComponent(String(url)).match(/\/search\/(.+)\/songs$/);
        return m ? [amazonSearchCapture(m[1], { specType: 'album', echo: true })] : [];
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    const warnings = [];
    const warn = jest.spyOn(console, 'warn').mockImplementation((...a) => warnings.push(a.join(' ')));
    try {
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
        notReady: true,
        code: 'not-ready'
      });
      expect(warnings.join('\n')).not.toContain('a non-track spec searched');
      expect(warnings.join('\n')).toContain('page never fired the track search');
    } finally {
      warn.mockRestore();
    }
  });

  test('an ECHOED same-spec capture answers the search but never re-mints the template (#1152)', async () => {
    // A page flow (called directly — the fast path is not the point here)
    // whose matched capture is byte-identically a replay of the current
    // template: minting from it would re-certify the template's own
    // session-aged headers with a fresh capturedAt. The warmed retry at flow
    // entry fails busy (a navigation holds the gate), the load then sees the
    // echo, and the mint is skipped.
    let echoNow = true;
    const ws = amazonWebSessionMock({
      tracks: TRACKS,
      capturesFor: (url) => {
        const m = decodeURIComponent(String(url)).match(/\/search\/(.+)\/songs$/);
        return m ? [amazonSearchCapture(m[1], { echo: echoNow })] : [];
      }
    });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk'); // one real page flow mints the template
    const minted = resolver._specSearchTemplate;
    // The two warmed retries fail busy (a navigation holds the gate); each
    // page flow's own replay after the load answers the envelope.
    const outcomes = [
      { success: true, error: 'busy' },
      { success: true, status: 200, text: JSON.stringify(amazonSpecEnvelope(TRACKS)) },
      { success: true, error: 'busy' },
      { success: true, status: 200, text: JSON.stringify(amazonSpecEnvelope(TRACKS)) }
    ];
    ws.pageFetch.mockImplementation(async () => outcomes.shift());
    ws.load.mockClear();
    const rows = await resolver.specSearchPageFlow({
      url: 'https://music.amazon.com/search/daft%20punk/songs',
      searchText: 'daft punk',
      specType: 'track',
      noun: 'tracks',
      parse: (data) => {
        const out = resolver.lib.searchTracksFromGql(data);
        return { rows: out.tracks, envelope: out.envelope };
      }
    });
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(resolver._specSearchTemplate).toBe(minted);
    // ...and with a NON-echo capture (a real page request), the mint proceeds.
    echoNow = false;
    ws.load.mockClear();
    await resolver.specSearchPageFlow({
      url: 'https://music.amazon.com/search/daft%20punk/songs',
      searchText: 'daft punk',
      specType: 'track',
      noun: 'tracks',
      parse: (data) => {
        const out = resolver.lib.searchTracksFromGql(data);
        return { rows: out.tracks, envelope: out.envelope };
      }
    });
    expect(resolver._specSearchTemplate).not.toBe(minted);
  });

  test('a structural response trips the breaker only from the page flow — the fast path defers (#1152)', async () => {
    // Both the template replay and the page flow's own replay lack the
    // envelope (the auth-failed-field shape of rotated session headers). The
    // fast path must drop the template and defer; the page flow makes the
    // structural call with a fresh capture, so the breaker hears it ONCE.
    const ws = amazonWebSessionMock({ envelope: { data: { specificationSearch: null } } });
    const resolver = instantiateAmazonPlugin(axe);
    // Seed a template with one successful search first.
    ws.pageFetch.mockImplementationOnce(async () => ({ success: true, status: 200, text: JSON.stringify(amazonSpecEnvelope(TRACKS)) }));
    await search(resolver, 'daft punk');
    expect(resolver._specSearchTemplate).toBeTruthy();
    ws.pageFetch.mockClear();
    ws.load.mockClear();
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-ready'
    });
    // Two replays: the failed template replay, then the page flow's own.
    expect(ws.pageFetch).toHaveBeenCalledTimes(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
    // The breaker heard it ONCE — from the page flow, not the fast path.
    expect(resolver._searchBreaker.state()).toMatchObject({ failures: 1, open: false });
  });
});

describe('the fast path (template replay via webSession.pageFetch)', () => {
  const seededResolver = (ws) => {
    const resolver = instantiateAmazonPlugin(axe);
    // Mint a template with one real page flow.
    return search(resolver, 'daft punk').then(() => resolver);
  };

  test('a fresh template answers with no page load: patched body replayed, hash intact', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    const rows = await search(resolver, { title: 'around the world', artist: 'daft punk' });
    expect(rows).toHaveLength(2);
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    const request = ws.pageFetch.mock.calls[0][1];
    const body = JSON.parse(request.body);
    expect(body.variables.searchText).toBe('"around the world" by "daft punk" OR "around the world" "daft punk" OR "daft punk" "around the world"');
    expect(body.variables.specType).toBe('track');
    expect(body.variables.firstLimit).toBe(30);
    expect(body.extensions.persistedQuery.sha256Hash).toBe('deadbeefhash');
    // The stored template was not mutated by patching.
    expect(resolver._specSearchTemplate.body.variables.searchText).toBe('daft punk');
  });

  test('a stale template runs the page flow, which re-mints it', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    resolver._specSearchTemplate.capturedAt = Date.now() - 25 * 60 * 60 * 1000;
    ws.load.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(resolver._specSearchTemplate.body.variables.searchText).toBe('daft punk');
    expect(Date.now() - resolver._specSearchTemplate.capturedAt).toBeLessThan(5000);
  });

  test('a template replay error drops the old template and falls to the page flow', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    const oldTemplate = resolver._specSearchTemplate;
    ws.pageFetch.mockImplementationOnce(async () => ({ success: true, error: 'Amazon gql query failed (294)' }));
    ws.load.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(resolver._specSearchTemplate).not.toBe(oldTemplate);
  });

  test('a pageFetch answered busy (a navigation holds the gate) is a miss that keeps the template', async () => {
    // The bridge answers a pageFetch that arrives while a navigation holds the
    // readers/writer gate with { error: 'busy' } — the reader-gate refusal
    // that used to be tryEnterReplay returning false. It is NOT a template
    // miss: nothing is dropped, the caller just falls to its page flow.
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    const template = resolver._specSearchTemplate;
    ws.pageFetch.mockImplementationOnce(async () => ({ success: true, error: 'busy' }));
    await expect(resolver.trySpecReplay({ searchText: 'daft punk', specType: 'track', noun: 'tracks', parse: () => ({ rows: [], envelope: true }) })).resolves.toBeNull();
    expect(resolver._specSearchTemplate).toBe(template);
  });

  test('a dead view (no hidden view after a sign-out) means the page flow runs', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    ws.state.mockResolvedValue({ success: true, url: null, signInUrl: null, cookieNames: ['at-main'] });
    ws.load.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
  });

  test('a wall URL on the warm view is not-signed-in without replaying', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    ws.state.mockResolvedValue({ success: true, url: 'https://music.amazon.com/ap/signin', signInUrl: null, cookieNames: ['at-main'] });
    ws.pageFetch.mockClear();
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
    expect(ws.pageFetch).not.toHaveBeenCalled();
  });

  test('a parked (about:blank) view means the page flow runs — a replay needs an origin page world', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    ws.state.mockResolvedValue({ success: true, url: 'about:blank', signInUrl: null, cookieNames: ['at-main'] });
    ws.load.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
  });

  test('two searches in flight resolve concurrently off the page flow chain', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    const replies = [];
    ws.pageFetch.mockImplementation(() => new Promise((resolve) => replies.push(resolve)));
    const loads = [];
    ws.load.mockImplementation(async (id, url) => { loads.push(url); return { success: true, finalUrl: url, captures: [] }; });
    const p1 = search(resolver, { title: 'one', artist: 'a' });
    const p2 = search(resolver, { title: 'two', artist: 'b' });
    try {
      for (let i = 0; i < 40 && replies.length < 2; i++) await new Promise(r => setTimeout(r, 10));
      // Both fast-path replays started at once; neither ran a page flow.
      expect(replies).toHaveLength(2);
      expect(loads).toEqual([]);
      replies.forEach(resolve => resolve({ success: true, status: 200, text: JSON.stringify(amazonSpecEnvelope(TRACKS)) }));
      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toHaveLength(2);
      expect(r2).toHaveLength(2);
    } finally {
      replies.forEach(resolve => resolve({ success: true, status: 200, text: JSON.stringify(amazonSpecEnvelope([])) }));
      await Promise.allSettled([p1, p2]);
    }
  });
});

describe('the session generation (a sign-out the plugin cannot see the event of)', () => {
  test('a sign-out and sign-in as another account between searches serves no stale plan or template', async () => {
    // clear() bumps the host's session generation and state() carries it;
    // the plugin cannot see the sign-out EVENT, but its next state read (the
    // first thing every search does) observes the bump and drops the caches
    // minted under the old account: the plan reading (the next account's
    // may differ) and the spec-search template (its headers embed the old
    // session's csrf tokens).
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk'); // mints the template, caches the plan
    const minted = resolver._specSearchTemplate;
    expect(minted).toBeTruthy();
    expect(ws.fetch).toHaveBeenCalledTimes(1);

    // Sign out (clear() — the generation bumps) and sign in as another
    // account, with NO search between the two.
    ws.state.mockResolvedValue({
      success: true,
      url: 'https://music.amazon.com/search/x/songs',
      signInUrl: null,
      cookieNames: ['at-main', 'sess-at-main'],
      generation: 1
    });
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    // The plan was re-read under the new session (the cache dropped)...
    expect(ws.fetch).toHaveBeenCalledTimes(2);
    // ...and the template was dropped: the fast path missed (its csrf headers
    // belong to account A) and the page flow re-minted a fresh one.
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(resolver._specSearchTemplate).not.toBe(minted);
    expect(Date.now() - resolver._specSearchTemplate.capturedAt).toBeLessThan(5000);
  });

  test('a same-generation state read serves the caches as before (no needless re-mint)', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk');
    const minted = resolver._specSearchTemplate;
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    // Same generation, live session: the fast path answered from the cached
    // template and the cached plan — no load, no config re-read.
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.fetch).toHaveBeenCalledTimes(1);
    expect(resolver._specSearchTemplate).toBe(minted);
  });

  test('a state read with no generation (an older host) changes nothing', async () => {
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk');
    const minted = resolver._specSearchTemplate;
    ws.state.mockResolvedValue({ success: true, url: 'https://music.amazon.com/search/x/songs', signInUrl: null, cookieNames: ['at-main'] });
    ws.load.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    // Nothing to compare — the caches stand and the fast path serves them.
    expect(ws.load).not.toHaveBeenCalled();
    expect(ws.fetch).toHaveBeenCalledTimes(1);
    expect(resolver._specSearchTemplate).toBe(minted);
  });
});

describe('the moved parser (searchTracksFromGql, the _lib copy)', () => {
  const lib = instantiateAmazonPlugin(axe).lib;

  // Real shape, first rows of the "eisenherz" search (trimmed).
  const trackNode = (id, title, artists, album, duration) => ({
    __typename: 'Track',
    id,
    uri: 'mrn:1.0:catalog:track:asin:' + id + '?territory=US',
    mediaType: 'AUDIO',
    title,
    images: [
      { url: 'https://m.media-amazon.com/images/I/' + id + '_500.jpg', width: 500, height: 500, imageType: 'PRIMARY' },
      { url: 'https://m.media-amazon.com/images/I/' + id + '_1400.jpg', width: 1400, height: 1400, imageType: 'PRIMARY' }
    ],
    contributingArtists: {
      edges: artists.map(a => ({ role: a[1], node: { name: a[0], __typename: 'Artist' } })),
      __typename: 'ArtistConnection'
    },
    album: { id: album[1], __typename: 'Album', shortTitle: album[0] },
    duration
  });
  const response = (edges) => ({
    specificationSearch: {
      id: 'search_368547b5e7',
      searchText: 'eisenherz',
      result: [
        {
          __typename: 'SpecificationSearchResult',
          pageInfo: { hasNextPage: !!edges.length, endCursor: null, token: edges.length ? 'tztok-v2_iosm' : null },
          label: 'requiredButUnused',
          edges: edges.map(node => ({ __typename: 'EntityEdge', node }))
        }
      ]
    }
  });

  test('maps the spec search edges to the searchTracks shape with cover art', () => {
    const data = response([
      trackNode('B073N3R1KZ', 'Eisenherz', [['Juli', 'PRIMARY']], ['In Love', 'B073HX454H'], 276),
      trackNode('B0D7W4QWZ7', 'Eisenherz', [['Stahlhammer', 'PRIMARY']], ['Eisenherz', 'B0D7W3YZJW'], 267),
      trackNode('B0G6FM547C', 'Eisenherz (Live im Nikolaisaal Potsdam)',
        [['Juli', 'PRIMARY'], ['Deutsches Filmorchester Babelsberg', 'PRIMARY']],
        ['IN LOVE EP - Live im Nikolaisaal Potsdam', 'B0G6F5SV4J'], 289)
    ]);
    const out = lib.searchTracksFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.tracks).toEqual([
      {
        asin: 'B073N3R1KZ',
        title: 'Eisenherz',
        artist: 'Juli',
        album: 'In Love',
        albumAsin: 'B073HX454H',
        albumArt: 'https://m.media-amazon.com/images/I/B073N3R1KZ_1400.jpg',
        duration: 276,
        explicit: false
      },
      {
        asin: 'B0D7W4QWZ7',
        title: 'Eisenherz',
        artist: 'Stahlhammer',
        album: 'Eisenherz',
        albumAsin: 'B0D7W3YZJW',
        albumArt: 'https://m.media-amazon.com/images/I/B0D7W4QWZ7_1400.jpg',
        duration: 267,
        explicit: false
      },
      {
        asin: 'B0G6FM547C',
        title: 'Eisenherz (Live im Nikolaisaal Potsdam)',
        artist: 'Juli, Deutsches Filmorchester Babelsberg',
        album: 'IN LOVE EP - Live im Nikolaisaal Potsdam',
        albumAsin: 'B0G6F5SV4J',
        albumArt: 'https://m.media-amazon.com/images/I/B0G6FM547C_1400.jpg',
        duration: 289,
        explicit: false
      }
    ]);
  });

  test('an empty edges list is a present envelope — a real miss, not a structural failure', () => {
    expect(lib.searchTracksFromGql(response([]))).toEqual({ tracks: [], envelope: true });
  });

  test('a non-Track node (an album-spec edge) is rejected, not imported as a track', () => {
    const data = response([
      { __typename: 'Album', id: 'B0ALBUM123', title: 'Kid A',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Radiohead' } }] },
        album: { id: 'B0ALBUM123', shortTitle: 'Kid A' }, duration: 2900 },
      trackNode('B073N3R1KZ', 'Eisenherz', [['Juli', 'PRIMARY']], ['In Love', 'B073HX454H'], 276)
    ]);
    const out = lib.searchTracksFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0].asin).toBe('B073N3R1KZ');
  });

  test('a trailing [Explicit] marker is stripped and sets the flag the payload lacks', () => {
    const data = response([trackNode('B0EXPLICIT1', 'Kunnioita [Explicit]', [['CMX', 'PRIMARY']], ['Kunnioita', 'B0ALBEXPL1'], 200)]);
    const out = lib.searchTracksFromGql(data);
    expect(out.tracks[0].title).toBe('Kunnioita');
    expect(out.tracks[0].explicit).toBe(true);
  });

  test('a bare word like "Sexually Explicit" is the real title and is kept', () => {
    const data = response([trackNode('B0SEXP1', 'Sexually Explicit', [['Artist', 'PRIMARY']], ['X', 'B0ALBSEX1'], 200)]);
    const out = lib.searchTracksFromGql(data);
    expect(out.tracks[0].title).toBe('Sexually Explicit');
    expect(out.tracks[0].explicit).toBe(false);
  });

  test('no specificationSearch envelope is a structural failure — the caller must not cache a miss', () => {
    expect(lib.searchTracksFromGql({ data: { renamedSearch: {} } })).toEqual({ tracks: [], envelope: false });
    expect(lib.searchTracksFromGql({ data: null })).toEqual({ tracks: [], envelope: false });
    expect(lib.searchTracksFromGql(null)).toEqual({ tracks: [], envelope: false });
  });
});

describe('the plan mapping (amazonPlanFromTier / tierFromConfig)', () => {
  const lib = instantiateAmazonPlugin(axe).lib;

  test('UNLIMITED… → unlimited, PRIME → prime, anything else unreadable → unknown', () => {
    expect(lib.amazonPlanFromTier('UNLIMITED_AUDIO')).toBe('unlimited');
    expect(lib.amazonPlanFromTier('PRIME')).toBe('prime');
    expect(lib.amazonPlanFromTier('SOMETHING_NEW')).toBe('unknown');
    expect(lib.amazonPlanFromTier(null)).toBe('unknown');
  });

  test('the tier read accepts the string and the object spellings of config.json', () => {
    expect(lib.tierFromConfig({ tier: 'UNLIMITED_AUDIO' })).toBe('UNLIMITED_AUDIO');
    expect(lib.tierFromConfig({ tier: { name: 'UNLIMITED_AUDIO' } })).toBe('UNLIMITED_AUDIO');
    expect(lib.tierFromConfig({ tier: { tier: 'PRIME' } })).toBe('PRIME');
    expect(lib.tierFromConfig({})).toBeNull();
    expect(lib.tierFromConfig(null)).toBeNull();
  });
});
