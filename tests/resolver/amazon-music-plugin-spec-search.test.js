/**
 * The Amazon plugin's spec-search runner (#1356 M5; plugins-src/amazonmusic/
 * implementation.js) — the machinery pins from amazon-web-player-template.test.js
 * ported to drive the PLUGIN methods against a mocked window.electron.webSession
 * bridge (the preload wrappers' shapes; docs/architecture/web-session.md,
 * "The IPC bridge"). The album/artist catalog flows that ride the same runner
 * moved in M6; their pins live in amazon-music-plugin-catalog.test.js. The
 * matchers below are the plugin's own _lib copies (the host copies in
 * amazon-music-logic.js died with the host runner).
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
 *   - the plan-gate rules: only an unlimited reading earns the 30-min TTL (a
 *     refusal re-reads within a minute — the upgrade path the plugin cannot
 *     hear), an in-flight plan read is never joined or cached across a session
 *     generation change, and any error without a listed reason is notReady,
 *     never a cached miss
 *   - a busy gate on the page flow's own replay (the capture already
 *     succeeded) is ridden out with a bounded backoff, and a template dropped
 *     by a session-generation bump is never replayed
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

  test('only an unlimited reading earns the 30-min TTL — a refusal re-reads within a minute (the upgrade path)', async () => {
    // The plugin has no refresh channel (the status read's forced re-read is
    // the closest thing, and it serves the tile — not the search gate), so a
    // refused reading must not sit for 30 minutes: an upgrade unblocks the
    // search a minute later at the worst. The plugin's own _lib constants pin
    // the TTLs; this pins which reading gets which.
    const ws = amazonWebSessionMock({ tracks: TRACKS, tier: 'PRIME' });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'plan-ineligible' });
    expect(ws.fetch).toHaveBeenCalledTimes(1);
    resolver._planState.at = Date.now() - (61 * 1000); // the 1-min refusal TTL elapsed
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'plan-ineligible' });
    expect(ws.fetch).toHaveBeenCalledTimes(2); // re-read — not the 30-min cache
    // ...and an unlimited reading within the 30-min TTL is served from cache.
    ws.fetch.mockResolvedValue({ success: true, status: 200, headers: {}, text: JSON.stringify({ tier: 'UNLIMITED_AUDIO' }) });
    resolver._planState.at = Date.now() - (61 * 1000); // the refusal re-read re-cached 'prime'
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    resolver._planState.at = Date.now() - (29 * 60 * 1000); // within the 30-min unlimited TTL
    const rows2 = await search(resolver, 'daft punk around the world');
    expect(rows2).toHaveLength(2);
    expect(ws.fetch).toHaveBeenCalledTimes(3); // still the cached unlimited reading
  });

  test("a SCHEDULED read past the TTL that comes back without a tier stays the judge — dmls's rule", async () => {
    // The plugin's gate mirrors the dmls gate exactly (amazon-dmls.js
    // getPlan): only a FORCED re-read keeps a known plan when the tier read
    // fails. A scheduled re-read reads what came back — unknown — so a
    // hornet rename of `tier` blocks the plugin's search (plan-ineligible,
    // re-read within the 1-min TTL) exactly as it blocks the host's, instead
    // of the plugin serving its last Unlimited reading until a restart or
    // sign-out.
    const ws = amazonWebSessionMock({ tracks: TRACKS, tier: 'UNLIMITED_AUDIO' });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk'); // caches the unlimited reading
    expect(ws.fetch).toHaveBeenCalledTimes(1);
    resolver._planState.at = Date.now() - (31 * 60 * 1000); // the TTL elapsed
    ws.fetch.mockResolvedValue({ success: true, status: 200, headers: {}, text: 'not json' });
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'plan-ineligible'
    });
    expect(ws.fetch).toHaveBeenCalledTimes(2); // the scheduled re-read ran, and it read unknown
  });

  test("a FORCED re-read that comes back without a tier keeps a known plan without re-caching it — dmls's rule", async () => {
    // dmls's other half (amazon-dmls.js getPlan, the Settings refreshPlan
    // path): a forced re-read failing on a network blip must not overturn a
    // known plan — that would block an Unlimited account for a minute
    // because Settings opened. The plugin's reads are scheduled (its
    // searches), so this drives getPlan's forced option directly — and the
    // kept reading is NOT re-cached: the stale timestamp stands, so the
    // scheduled re-read that follows still re-reads.
    const ws = amazonWebSessionMock({ tracks: TRACKS, tier: 'UNLIMITED_AUDIO' });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk'); // caches the unlimited reading
    expect(ws.fetch).toHaveBeenCalledTimes(1);
    resolver._planState.at = Date.now() - (31 * 60 * 1000); // the TTL elapsed
    const staleAt = resolver._planState.at;
    ws.fetch.mockResolvedValue({ success: true, status: 200, headers: {}, text: 'not json' });
    await expect(resolver.getPlan({ refresh: true })).resolves.toBe('unlimited'); // keeps the known plan
    expect(ws.fetch).toHaveBeenCalledTimes(2); // the forced read skips the cache entirely
    expect(resolver._planState.at).toBe(staleAt); // not re-cached
    // The scheduled re-read that follows stays the judge: unknown, not the
    // kept reading.
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'plan-ineligible'
    });
    expect(ws.fetch).toHaveBeenCalledTimes(3);
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

  test("an error without a listed reason (a requireLib throw) is notReady, never a cached miss", async () => {
    // "An error is never 'no results'" (playback.md): more failure classes
    // reach search()'s catch since the runner moved into the plugin (a
    // requireLib throw, a bridge 'invalid'/'denied', a plain bug), and the
    // resolver would store a 30-day noMatch for a failure that had nothing to
    // do with matching — the recommendations path's rule, now search's too.
    amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    resolver.lib = null; // a host older than the _lib prerequisite (requireLib throws)
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-ready'
    });
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
    // The budget escape is OPT-IN and the spec search never opts in: a slow
    // page stays a load-failed here, never a structural "never searched".
    expect(opts.capture.returnOnTimeout).toBeUndefined();
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
    // The zero-capture rule: a page that has fired nothing yet is not quiet,
    // so the wait runs to budgetMs for the FIRST request and only closes
    // quietMs after the last one. A cold view whose first gql lands 1.2s
    // after load-finish is inside the window under both the plugin's explicit
    // window (2500ms quiet, 15s budget) and the host defaults (1000ms quiet,
    // 8s budget) — the returned capture is matched and replayed.
    const ws = amazonWebSessionMock({ tracks: TRACKS, captureDelayMs: 1200 });
    const resolver = instantiateAmazonPlugin(axe);
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    // The late capture was returned AND matched — the flow replayed it.
    expect(ws.pageFetch).toHaveBeenCalledTimes(1);
    // The mock simulates the window honestly: the SAME 1200ms-late FIRST
    // capture under a window that closes at 1s for it (quietMs 1000 AND
    // budgetMs 1000) is not returned — the wait for the first request ended
    // before it fired.
    const late = await ws.load('amazon-music', 'https://music.amazon.com/search/x/songs', {
      capture: { urlPrefixes: ['https://gql.music.amazon.com/*'], quietMs: 1000, budgetMs: 1000 }
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

  test('a load budget that fires mid-page is load-failed for the spec search — three slow pages never open the breaker', async () => {
    // #1437 review round 2, New 1 (the maintainer's bridge-mock
    // reproduction): a slow page — the budget fires after the page's
    // boot-time gql but before the search request — is a load-failed, not a
    // structural "never searched". The spec search never opts into rule 5's
    // budget escape (capture.returnOnTimeout is the playlist import's), so
    // the half-loaded page's captures never reach the matcher: the flow
    // takes the refused-load path, the breaker never hears it, and the
    // fourth slow search still loads its page (the breaker's fail-fast
    // never precedes it).
    const ws = amazonWebSessionMock({
      loadTimedOut: true, // the mock answers by the host's OPT-IN rule: no returnOnTimeout → load-failed
      capturesFor: () => [{ url: 'https://gql.music.amazon.com/', method: 'POST', body: JSON.stringify({ operationName: 'MusicHomePage', variables: {} }), headers: { 'x-api-key': 'k' } }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    // The spec-search load never opts into the escape.
    const optIns = () => ws.load.mock.calls.map((c) => !!(c[2] && c[2].capture && c[2].capture.returnOnTimeout));
    for (let i = 0; i < 3; i += 1) {
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
        notReady: true,
        code: 'load-failed'
      });
    }
    expect(optIns()).toEqual([false, false, false]);
    // The breaker counted NONE of them — a slow network is not a hornet
    // rename, and three slow page loads must not stop Amazon search for
    // ten minutes.
    expect(resolver._searchBreaker.state()).toMatchObject({ failures: 0, open: false });
    // The fourth slow search still pays for its page load: no fail-fast.
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'load-failed' });
    expect(ws.load).toHaveBeenCalledTimes(4);
    expect(resolver._searchBreaker.state()).toMatchObject({ failures: 0, open: false });
  });

  test("a busy gate on the page flow's own replay is ridden out, not a structural failure", async () => {
    // A concurrent navigation (a host-side playlist import or the session
    // mint) can hold the readers/writer gate after the page flow's capture
    // already succeeded: busy is transient there, not a rename — a short
    // retry rides it out instead of failing the search not-ready.
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    const outcomes = [
      { success: true, error: 'busy' },
      { success: true, error: 'busy' },
      { success: true, status: 200, text: JSON.stringify(amazonSpecEnvelope(TRACKS)) }
    ];
    ws.pageFetch.mockImplementation(async () => outcomes.shift());
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    expect(resolver._searchBreaker.state().failures).toBe(0);
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
      // ...and with a FRESH TEMPLATE SEEDED, the fail-fast still precedes the
      // fast path: a reordering that replayed first (or minted on a breaker
      // tick) would pageFetch here.
      resolver._specSearchTemplate = resolver.lib.makeSpecSearchTemplate({
        url: 'https://gql.music.amazon.com/',
        headers: { 'x-api-key': 'k', 'csrf-token': 't', 'csrf-rnd': 'r', 'csrf-ts': '1' },
        body: { operationName: 'SpecSearchSeeMorePage', variables: { searchText: 'seed', specType: 'track', firstLimit: 30 }, extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'h' } } },
        capturedAt: Date.now()
      });
      ws.pageFetch.mockClear();
      await expect(search(resolver, 'daft punk')).rejects.toMatchObject({ code: 'not-ready' });
      expect(ws.load.mock.calls.length).toBe(loadsBefore);
      expect(ws.pageFetch).not.toHaveBeenCalled();
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
    let echoNow = false; // the seed flow's capture is the page's own — it mints
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
    expect(minted).toBeTruthy();
    echoNow = true; // from here every capture is our own replay echoing back
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

  test('a wall URL on the warm view falls to the page flow — a parked wall is a miss, not a verdict', async () => {
    // The view keeps whatever URL its last navigation left behind, so a
    // token-refresh redirect can park it on a wall with a LIVE session: a
    // throw here would block the very page flow that navigates it off. The
    // fast path misses (no replay), the page flow loads — and ITS verdict
    // decides: a genuinely dead session still lands on the wall.
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    ws.state.mockResolvedValue({ success: true, url: 'https://music.amazon.com/ap/signin', signInUrl: null, cookieNames: ['at-main'] });
    ws.pageFetch.mockClear();
    ws.load.mockClear();
    // The loaded page lands on the wall too — the session is genuinely dead.
    ws.load.mockImplementation(async (id, url) => ({
      success: true,
      finalUrl: 'https://www.amazon.com/ap/signin',
      captures: []
    }));
    await expect(search(resolver, 'daft punk')).rejects.toMatchObject({
      notReady: true,
      code: 'not-signed-in'
    });
    // The fast path did not replay the stale template off the wall view...
    expect(ws.pageFetch).not.toHaveBeenCalled();
    // ...but the page flow RAN (the healing navigation).
    expect(ws.load).toHaveBeenCalledTimes(1);
  });

  test('a parked wall with a LIVE session heals: the page flow navigates it off', async () => {
    // The stale view URL says /ap/signin, but the session is fine (a
    // token-refresh redirect parked it there): the fast path misses and the
    // page flow's fresh load answers the search.
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = await seededResolver(ws);
    ws.state.mockImplementation(async (id) => ({
      success: true,
      // The state read still reports the parked wall URL...
      url: 'https://music.amazon.com/ap/signin',
      signInUrl: null,
      cookieNames: ['at-main', 'sess-at-main'],
      generation: 0
    }));
    // ...but the fresh page load lands on the tab, not the wall.
    const m = decodeURIComponent('https://music.amazon.com/search/daft%20punk/songs');
    ws.load.mockImplementation(async (id, url) => ({
      success: true,
      finalUrl: url,
      captures: [require('../helpers/amazon-plugin-bridge').amazonSearchCapture('daft punk')]
    }));
    ws.pageFetch.mockClear();
    ws.load.mockClear();
    const rows = await search(resolver, 'daft punk');
    expect(rows).toHaveLength(2);
    expect(ws.load).toHaveBeenCalledTimes(1);
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

  test('a plan read racing a sign-out is not joined or cached under the new session (the generation)', async () => {
    // Account A's plan read is in flight when the session is cleared and B
    // signs in. A concurrent search must not JOIN the stale read (it would
    // gate B on A's plan), and the stale read must not WRITE the plan cache
    // under the new account — the generation drop in sessionState is
    // worthless if that write lands after it.
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    const releases = [];
    ws.fetch.mockImplementation(() => new Promise((resolve) => releases.push(resolve)));
    // Account A's search starts the plan read under generation 0.
    const p1 = search(resolver, 'daft punk');
    await new Promise((r) => setTimeout(r, 0));
    expect(releases).toHaveLength(1);
    // Sign out + sign in as B, observed by the next state read BEFORE the
    // fetch resolves.
    ws.state.mockResolvedValue({
      success: true,
      url: 'https://music.amazon.com/search/x/songs',
      signInUrl: null,
      cookieNames: ['at-main', 'sess-at-main'],
      generation: 1
    });
    const p2 = search(resolver, 'daft punk');
    await new Promise((r) => setTimeout(r, 0));
    // The concurrent search did NOT join account A's in-flight read — it
    // started its own fetch under the new generation.
    expect(releases).toHaveLength(2);
    releases[0]({ success: true, status: 200, headers: {}, text: JSON.stringify({ tier: 'PRIME', customerId: 'A1' }) });
    releases[1]({ success: true, status: 200, headers: {}, text: JSON.stringify({ tier: 'UNLIMITED_AUDIO', customerId: 'B2' }) });
    // A's own search still answers A's reading (Prime → plan-ineligible);
    // B's search proceeds.
    await expect(p1).rejects.toMatchObject({ notReady: true, code: 'plan-ineligible' });
    const rows = await p2;
    expect(rows).toHaveLength(2);
    // The racing write was skipped: the cached plan is B's, and a third
    // search serves it without re-fetching config.json.
    const rows3 = await search(resolver, 'daft punk');
    expect(rows3).toHaveLength(2);
    expect(ws.fetch).toHaveBeenCalledTimes(2);
  });

  test('a template dropped by a session-generation bump is never replayed by a queued page flow', async () => {
    // The warmed retry inside the chained page flow re-reads the template
    // AFTER its state read: a sign-out + sign-in as another account between
    // the queue and the run must not send account A's csrf-bearing template
    // into account B's session. The drop (sessionState) nulls the instance
    // field — the snapshot must be re-checked, not trusted.
    const ws = amazonWebSessionMock({ tracks: TRACKS });
    const resolver = instantiateAmazonPlugin(axe);
    await search(resolver, 'daft punk'); // mints the template under generation 0
    const minted = resolver._specSearchTemplate;
    expect(minted).toBeTruthy();
    ws.state.mockResolvedValue({
      success: true,
      url: 'https://music.amazon.com/search/x/songs',
      signInUrl: null,
      cookieNames: ['at-main', 'sess-at-main'],
      generation: 1
    });
    ws.load.mockClear();
    ws.pageFetch.mockClear();
    // specSearch directly (the warmed-retry seam): no isSignedIn first, so
    // the generation bump is first observed inside the retry's own read.
    const rows = await resolver.specSearch({
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
    // The stale template was NOT replayed (no pageFetch before the load) —
    // the identity re-check sent the flow to its page load, which re-minted.
    expect(ws.load).toHaveBeenCalledTimes(1);
    expect(ws.pageFetch).toHaveBeenCalledTimes(1); // the page flow's own replay only
    expect(resolver._specSearchTemplate).not.toBe(minted);
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

  test('a row without artists is dropped, not fatal', () => {
    // A row with no contributingArtists edges is not a track this resolver
    // could match (the mapper would leave it artistless and the confidence
    // gate would drop it anyway): the parser drops the ROW, the rest of the
    // response survives. The old amazon-music-logic.test.js pin, moved with
    // the parser.
    const data = response([
      trackNode('B0NOARTIST', 'Artless', [], ['X', 'B0ALBUMX'], 100),
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


describe('the runner helpers (the _lib copies, ported from amazon-music-logic.test.js)', () => {
  const lib = instantiateAmazonPlugin(axe).lib;

describe('amazonSongSearchUrl', () => {
  test('quotes both terms and ORs the by-form with the two phrase orders — Amazon matching is order-sensitive in both directions', () => {
    expect(lib.amazonSongSearchUrl({ title: 'stations', artist: 'Warning' })).toEqual({
      url: 'https://music.amazon.com/search/' + encodeURIComponent('"stations" by "Warning" OR "stations" "Warning" OR "Warning" "stations"') + '/songs',
      searchText: '"stations" by "Warning" OR "stations" "Warning" OR "Warning" "stations"'
    });
    // The case that surfaced the two-order OR: "Яйца" "ХЛЕБ" returns nothing
    // on Amazon; the reversed clause is what surfaces ХЛЕБ — Яйца.
    expect(lib.amazonSongSearchUrl({ title: 'Яйца', artist: 'ХЛЕБ' }).searchText)
      .toBe('"Яйца" by "ХЛЕБ" OR "Яйца" "ХЛЕБ" OR "ХЛЕБ" "Яйца"');
    // The case that surfaced the by-clause (live-verified 2026-11 through
    // the app): both bare orders bury Backstabbed's "Out Of Body Experience"
    // past the spec search's 30-row first page — every row is a track by an
    // artist literally named "Out of Body Experience" — while the by-form
    // returns it as row 1. The by-clause is a supplement, never a replacement:
    // alone it returns zero rows for Яйца/ХЛЕБ and misses Stations/Warning.
    expect(lib.amazonSongSearchUrl({ title: 'out of body experience', artist: 'backstabbed' }).searchText)
      .toBe('"out of body experience" by "backstabbed" OR "out of body experience" "backstabbed" OR "backstabbed" "out of body experience"');
  });

  test('still uses the songs tab when only one field is present', () => {
    expect(lib.amazonSongSearchUrl({ title: 'stations' }).url).toMatch(/\/songs$/);
    expect(lib.amazonSongSearchUrl({ artist: 'Warning' }).url).toMatch(/\/songs$/);
  });

  test('a bare query goes to the songs tab too — that is the page which fires the track search', () => {
    expect(lib.amazonSongSearchUrl({ query: 'eisenherz' })).toEqual({
      url: 'https://music.amazon.com/search/eisenherz/songs',
      searchText: 'eisenherz'
    });
  });

  test('returns null when there is nothing to search', () => {
    expect(lib.amazonSongSearchUrl({ query: '   ' })).toBeNull();
    expect(lib.amazonSongSearchUrl({})).toBeNull();
    // A lone surrogate in metadata is a miss, not an exception (the callers'
    // catch would cache the throw as a noMatch); a well-formed pair searches.
    expect(lib.amazonSongSearchUrl({ title: 'AC\uD83DDC', artist: 'X' })).toBeNull();
    expect(lib.amazonSongSearchUrl({ title: 'AC\uD83D\uDE00DC', artist: 'X' })).not.toBeNull();
    // Control characters in metadata fold to a space — a junk string must not
    // wedge the matcher for a request it can never match (the same fold
    // amazonArtistSearchUrl applies to a name).
    expect(lib.amazonSongSearchUrl({ title: 'Around\nthe World', artist: 'Daft Punk' }).searchText)
      .toBe('"Around the World" by "Daft Punk" OR "Around the World" "Daft Punk" OR "Daft Punk" "Around the World"');
    expect(lib.amazonSongSearchUrl({ query: 'a\tb' }).searchText).toBe('a b');
  });
});

// The search request the songs page fires (live-captured 2026-10, hornet
// 1.18x): SpecSearchSeeMorePage, specType track, our exact searchText, an APQ
// hash that renumbers per hornet redeploy. The parser matches on
// variables.searchText, never the operationName.
describe('amazonSpecSearchRequest', () => {
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

  test('finds the search request for our text among everything the page fires', () => {
    const bodies = [
      JSON.stringify({ operationName: 'IdentityStoreSeed', variables: {} }),
      search('"Eisenherz" "Juli"', 'track'),
      JSON.stringify({ operationName: 'Transport', variables: { id: 'mrn:x' } }),
      '{not json'
    ];
    const req = lib.amazonSpecSearchRequest(bodies, '"Eisenherz" "Juli"');
    expect(req.operationName).toBe('SpecSearchSeeMorePage');
    expect(req.variables.searchText).toBe('"Eisenherz" "Juli"');
    expect(req.variables.specType).toBe('track');
    expect(req.extensions.persistedQuery.sha256Hash).toBe('56f888fd039c581a348e8057e0d61b9495ce835870a2d1ab7b6f2c900e54e15c');
  });

  test('matching is case-insensitive and trim-tolerant, and batch arrays are tolerated', () => {
    const batch = JSON.stringify([
      { operationName: 'AppChromeHeaderLeft', variables: {} },
      { operationName: 'SpecSearchSeeMorePage', variables: { searchText: '  EiSenHerz ', specType: 'track' } }
    ]);
    expect(lib.amazonSpecSearchRequest([batch], 'eisenherz')).not.toBeNull();
  });

  test('only the track spec is ever accepted — even alone, an album/artist spec never matches', () => {
    // The album-spec request carries the SAME searchText and an ASIN-shaped
    // node that maps to a track — first-arrival must not win it the replay.
    // This is the album-ASIN failure the DOM-era exclusion dance existed to
    // prevent, on its gql successor.
    expect(lib.amazonSpecSearchRequest([search('eisenherz', 'album')], 'eisenherz')).toBeNull();
    expect(lib.amazonSpecSearchRequest([search('eisenherz', 'artist')], 'eisenherz')).toBeNull();
    const bodies = [
      search('eisenherz', 'album'),
      search('eisenherz', 'track')
    ];
    expect(lib.amazonSpecSearchRequest(bodies, 'eisenherz').variables.specType).toBe('track');
  });

  test('a body with no specType at all is accepted (older deploys)', () => {
    expect(lib.amazonSpecSearchRequest([search('eisenherz', undefined)], 'eisenherz').variables.specType).toBeUndefined();
  });

  test('the anySpec mode matches any spec — used only to detect the grace condition, never for replay', () => {
    expect(lib.amazonSpecSearchRequest([search('eisenherz', 'album')], 'eisenherz', { anySpec: true }).variables.specType).toBe('album');
    expect(lib.amazonSpecSearchRequest([search('eisenherz', 'album')], 'eisenherz', { anySpec: false })).toBeNull();
  });

  test('another query\'s search, a missing text, and empty captures are not ours', () => {
    expect(lib.amazonSpecSearchRequest([search('something else', 'track')], 'eisenherz')).toBeNull();
    expect(lib.amazonSpecSearchRequest([JSON.stringify({ operationName: 'Transport', variables: { id: 1 } })], 'eisenherz')).toBeNull();
    expect(lib.amazonSpecSearchRequest([], 'eisenherz')).toBeNull();
    expect(lib.amazonSpecSearchRequest([search('eisenherz', 'track')], '  ')).toBeNull();
    expect(lib.amazonSpecSearchRequest(null, 'eisenherz')).toBeNull();
  });
});

// The breaker bounds the damage of a hornet rename: without it every search
// burns the full capture window and fails not-ready, serially on the search
// chain — a resolution run of 100 tracks spends ~25 minutes there and starves
// playlist imports too.
describe('createSearchBreaker', () => {
  const ms = (t) => () => t;
  const step = () => { t += 1; return t; };
  let t;

  beforeEach(() => { t = 0; });

  test('stays closed under the threshold and opens at it', () => {
    const b = lib.createSearchBreaker({ threshold: 3, cooldownMs: 600000, now: step });
    expect(b.allows()).toBe(true);
    b.recordFailure();
    b.recordFailure();
    expect(b.allows()).toBe(true);
    b.recordFailure();
    expect(b.allows()).toBe(false);
    expect(b.state()).toEqual({ failures: 3, openUntil: 600001, open: true });
  });

  test('a success closes it; a probe after the cooldown re-opens on failure', () => {
    const b = lib.createSearchBreaker({ threshold: 2, cooldownMs: 100, now: step });
    b.recordFailure();
    b.recordFailure();
    expect(b.allows()).toBe(false);
    t = 200; // cooldown elapsed — this search is a probe
    expect(b.allows()).toBe(true);
    expect(b.isProbe()).toBe(true);
    b.recordFailure();
    expect(b.allows()).toBe(false);
    b.recordSuccess();
    expect(b.allows()).toBe(true);
    expect(b.isProbe()).toBe(false);
    expect(b.state()).toEqual({ failures: 0, openUntil: 0, open: false });
  });

  test('a success mid-count resets the run of failures', () => {
    const b = lib.createSearchBreaker({ threshold: 3, cooldownMs: 100, now: step });
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.allows()).toBe(true);
  });
});

  test('specBodyWithVars patches searchText and specType, keeps hash and flags, never mutates', () => {
    const body = {
      operationName: 'SpecSearchSeeMorePage',
      variables: { searchText: '"daft punk"', specType: 'track', firstLimit: 30, isAuthenticated: true },
      extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'abc123' } }
    };
    const before = JSON.parse(JSON.stringify(body));
    const out = lib.specBodyWithVars(body, { searchText: '"metallica"', specType: 'album' });
    expect(out.variables.searchText).toBe('"metallica"');
    expect(out.variables.specType).toBe('album');
    expect(out.variables.firstLimit).toBe(30);
    expect(out.variables.isAuthenticated).toBe(true);
    expect(out.extensions.persistedQuery.sha256Hash).toBe('abc123');
    expect(out.operationName).toBe('SpecSearchSeeMorePage');
    // The template is untouched — later searches patch their own copy.
    expect(body).toEqual(before);
    // searchText alone (specType left as captured) and vice versa.
    expect(lib.specBodyWithVars(body, { searchText: 'x' }).variables.specType).toBe('track');
    expect(lib.specBodyWithVars(body, { specType: 'artist' }).variables.searchText).toBe('"daft punk"');
  });
});
