// The Amazon dmls provider + the widevine bridge: session-context minting,
// manifest/license plumbing, and the IPC error contract — all against mocks.
// These tests would have caught the unregistered-provider call and the
// response-line syntax break that manual runs found.

const path = require('path');

// electron: net.request + session.fromPartition + app.getVersion
const requestHandlers = [];
const mockCookies = [
  { name: 'at-main', value: 'AT' },
  { name: 'session-id', value: 'SID' },
  { name: 'ubid-main', value: 'UB' }
];
const mockRequests = [];
jest.mock('electron', () => ({
  app: { getVersion: () => '9.9.9-test' },
  net: {
    request: (opts) => {
      const headers = {};
      const req = {
        setHeader: (k, v) => { headers[k] = v; },
        on: (event, cb) => { (req._handlers = req._handlers || {})[event] = cb; return req; },
        end: (body) => {
          req._body = body;
          const handler = requestHandlers.shift() || (() => ({ status: 500, text: 'no mock' }));
          const { status, text } = handler({ url: opts.url, headers, body });
          const res = { statusCode: status, on: (ev, cb) => { if (ev === 'data') setImmediate(() => cb(Buffer.from(text))); if (ev === 'end') setImmediate(() => cb()); return res; } };
          req._handlers.response(res);
        }
      };
      mockRequests.push({ opts, headers, getBody: () => req._body });
      return req;
    }
  },
  session: {
    fromPartition: () => ({
      cookies: { get: async () => mockCookies.slice() }
    })
  }
}));

// amazon-web-player: search host (sign-in predicate + header mint)
jest.mock('../../amazon-web-player', () => ({
  isSignedIn: jest.fn().mockResolvedValue(true),
  mintSessionHeaders: jest.fn().mockResolvedValue({
    csrfToken: 'tok-0123456789abcdef0123456789abcdef=',
    csrfRnd: '403697901',
    csrfTs: '1793304003',
    deviceId: '135'
  })
}));

const amazonWebPlayer = require('../../amazon-web-player');
const { amazonDmls, registerAmazonDmlsProvider, ELIGIBILITY_CACHE_MAX_ENTRIES } = require('../../amazon-dmls');
const { ELIGIBILITY_CACHE_TTL_MS } = require('../../amazon-music-logic');
const { registerWidevineProvider, registerWidevineBridgeIpc } = require('../../main-process/widevine-bridge');

const ELIGIBILITY_CACHE_MAX = ELIGIBILITY_CACHE_MAX_ENTRIES;
const ELIGIBILITY_DAY_TTL = ELIGIBILITY_CACHE_TTL_MS;

const CONFIG_JSON = JSON.stringify({
  customerId: 'CUST1',
  marketplaceId: 'MKT',
  musicTerritory: 'US',
  siteRegion: 'NA',
  deviceId: '14354613042605242',
  tier: { name: 'UNLIMITED_HD' }
});

const CONFIG_NO_TERRITORY = JSON.stringify({ customerId: 'CUST1', marketplaceId: 'MKT', siteRegion: 'NA', deviceId: '1435' });

const CONFIG_PRIME = JSON.stringify({
  customerId: 'CUST1',
  marketplaceId: 'MKT',
  musicTerritory: 'US',
  siteRegion: 'NA',
  deviceId: '14354613042605242',
  tier: 'PRIME'
});

function queueEligibility({ status = 200, map = {} } = {}) {
  requestHandlers.push(() => ({ status, text: status === 200 ? JSON.stringify({ trackEligibilityMap: map }) : 'boom' }));
}

function queueManifest({ status = 200, entry } = {}) {
  const body = JSON.stringify({ contentResponseList: [entry || {
    contentResponseStatusCode: 'SUCCESS',
    manifest: '<MPD minBufferTime="PT2S"/>',
    substituteAsin: 'SUB1',
    musicDashVersion: 'SIREN_KATANA'
  }] });
  requestHandlers.push(() => ({ status, text: body }));
}

beforeEach(() => {
  amazonDmls.sessionContext = null;
  amazonDmls.sessionContextPromise = null;
  amazonDmls.certSessionReady = false;
  amazonDmls.eligibilityCache.clear();
  amazonDmls.eligibilityInFlight.clear();
  amazonDmls.eligibilityBackoffUntil = 0;
  amazonWebPlayer.isSignedIn.mockResolvedValue(true);
  amazonWebPlayer.mintSessionHeaders.mockClear();
  requestHandlers.length = 0;
  mockRequests.length = 0;
  amazonDmls.init({ store: { get: () => undefined, set: () => {} } });
});

describe('L9: telemetry bookkeeping survives a synchronous net.request throw', () => {
  test('net.request throwing resolves as status -1 and increments the dropped counter', async () => {
    const electron = jest.requireMock('electron');
    const orig = electron.net.request;
    // Prewarm the session context FIRST (its config.json fetch precedes the
    // guarded POST executor — flipping to throw first would fail there).
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    await amazonDmls.ensureSessionContext();
    electron.net.request = () => { throw new Error('session is destroyed'); };
    try {
      const before = amazonDmls.telemetryHealth.dropped;
      const out = await amazonDmls.postTelemetryEvent({ clientActionList: [{ actionName: 'streamingTerminated' }] });
      expect(out.status).toBe(-1);
      expect(amazonDmls.telemetryHealth.dropped).toBe(before + 1);
      expect(amazonDmls.telemetryHealth.last.status).toBe(-1);
    } finally {
      electron.net.request = orig;
    }
  });
});

describe('amazon-dmls session context', () => {
  test('mints from config.json + the header capture, prefers config deviceId', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON })); // config.json
    const ctx = await amazonDmls.ensureSessionContext();
    expect(ctx.customerId).toBe('CUST1');
    expect(ctx.territoryId).toBe('US');
    expect(ctx.region).toBe('NA');
    expect(ctx.deviceId).toBe('14354613042605242'); // config.json first
    expect(ctx.csrfToken).toBe('tok-0123456789abcdef0123456789abcdef=');
    expect(ctx.tier).toBe('UNLIMITED_HD');
  });

  test('config.json deviceId wins over the captured header placeholder', async () => {
    amazonWebPlayer.mintSessionHeaders.mockResolvedValueOnce({ csrfToken: 'tok-0123456789abcdef0123456789abcdef=', csrfRnd: '1', csrfTs: '2', deviceId: 'foo' });
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    const ctx = await amazonDmls.ensureSessionContext();
    expect(ctx.deviceId).toBe('14354613042605242');
  });

  test('not signed in (no at-main cookie) fails with not-signed-in', async () => {
    mockCookies.length = 0;
    mockCookies.push({ name: 'session-id', value: 'x' });
    await expect(amazonDmls.ensureSessionContext()).rejects.toMatchObject({ reason: 'not-signed-in' });
    mockCookies.unshift({ name: 'at-main', value: 'AT' });
  });
});

describe('amazon-dmls getManifest', () => {
  test('posts the manifest body with cookies + csrf and returns the inline MPD', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    queueManifest({});
    const result = await amazonDmls.getManifest({ asin: 'B00CRMX53S' });
    const dmlsReq = mockRequests.find((r) => r.opts.url.includes('/api/dmls/'));
    const headers = dmlsReq.headers;
    expect(headers['X-Amz-Target']).toContain('getDashManifestsV2');
    expect(headers['csrf-token']).toBe('tok-0123456789abcdef0123456789abcdef=');
    expect(headers['Cookie']).toContain('at-main=AT');
    expect(headers['Content-Encoding']).toBe('amz-1.0');
    const body = JSON.parse(dmlsReq.getBody());
    expect(body.contentIdList).toEqual([{ identifier: 'B00CRMX53S', identifierType: 'ASIN' }]);
    expect(body.customerId).toBe('CUST1');
    expect(body.deviceToken).toEqual({ deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: '14354613042605242' });
    expect(body.appInfo.musicAgent).toMatch(/^Vinyl\/2\.0 GreenHornet_Web\//);
    expect(result.manifest).toContain('<MPD');
    expect(result.substituteAsin).toBe('SUB1');
  });

  test('not-signed-in without a request', async () => {
    amazonWebPlayer.isSignedIn.mockResolvedValue(false);
    await expect(amazonDmls.getManifest({ asin: 'B1' })).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(mockRequests.find((r) => r.opts.url.includes('/api/dmls/'))).toBeUndefined();
  });

  test('manifest HTTP error maps to playback-failed', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 500, text: 'boom' }));
    await expect(amazonDmls.getManifest({ asin: 'B1' })).rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('a non-SUCCESS entry maps to playback-failed', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    queueManifest({ entry: { contentResponseStatusCode: 'CONTENT_NOT_FOUND', contentResponseStatusMessage: 'nf' } });
    await expect(amazonDmls.getManifest({ asin: 'B1' })).rejects.toMatchObject({ reason: 'playback-failed' });
  });

  test('session rot: 400 Unauthorized refreshes the context and retries once', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON })); // first config
    requestHandlers.push(() => ({ status: 400, text: '{"__type":"com.amazon.digitalmusiclocator#UnauthorizedException","message":"Request authentication failure : REQUIRED_COOKIES_MISSING"}' }));
    requestHandlers.push(() => ({ status: 200, text: CONFIG_NO_TERRITORY })); // refresher config
    queueManifest({});
    const result = await amazonDmls.getManifest({ asin: 'B1' });
    expect(result.manifest).toBeDefined();
    const dmlsCalls = mockRequests.filter((r) => r.opts.url.includes('/api/dmls/')).length;
    expect(dmlsCalls).toBe(2);
  });
});

describe('amazon-dmls relayLicense', () => {
  test('returns the license field, targets getLicenseForPlaybackV2', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 200, text: '{"license":"TElDRU5TRQ=="}' }));
    const license = await amazonDmls.relayLicense('Y2hhbGxlbmdl');
    expect(license).toBe('TElDRU5TRQ==');
    const req = mockRequests.find((r) => r.opts.url.includes('/api/dmls/'));
    const body = JSON.parse(req.getBody());
    expect(body.DrmType).toBe('WIDEVINE');
    expect(body.licenseChallenge).toBe('Y2hhbGxlbmdl');
  });

  test('400 is licenseDenied with the VMP message', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 400, text: 'denied' }));
    await expect(amazonDmls.relayLicense('CAQ=')).rejects.toMatchObject({
      licenseDenied: true,
      message: expect.stringContaining('VMP')
    });
  });

  test('non-200 without license field is an error', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON }));
    requestHandlers.push(() => ({ status: 200, text: '{"notLicense":"x"}' }));
    await expect(amazonDmls.relayLicense('CAQ=')).rejects.toBeTruthy();
  });
});

describe('amazon-dmls plan-tier eligibility filter (#1196)', () => {
  // A Prime-only account cannot play an Unlimited-only (isPrime: false)
  // track on demand — Amazon starts a station seeded from it instead. The
  // filter asks muse getEligibility for the search's ASINs (ONE batched
  // call) and drops the ones the plan can't play; failures keep everything.
  const museCalls = () => mockRequests.filter((r) => r.opts.url.includes('/api/muse/getEligibility'));

  test('PRIME tier: isPrime:false and absent-from-map drop, isPrime:true and ASIN-less stay', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME })); // config.json
    queueEligibility({ map: { B_PRIME_OK: { isPrime: true, isMusicSubscription: true }, B_UNL_ONLY: { isPrime: false, isMusicSubscription: true } } });
    const tracks = [
      { asin: 'B_UNL_ONLY', title: 'Ready or Not' },
      { asin: 'B_PRIME_OK', title: 'Ready or Not' },
      { asin: 'B_MISSING', title: 'Ghost' },
      { title: 'ASIN-less' }
    ];
    const kept = await amazonDmls.filterUnplayableForPlan(tracks);
    expect(kept.map((t) => t.asin || 'none')).toEqual(['B_PRIME_OK', 'none']);
  });

  test('the muse call: one batched POST with the dmls-shaped envelope (csrf + cookies on the wire only)', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: true } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }, { asin: 'B2' }, { asin: 'B1' }]);
    expect(museCalls()).toHaveLength(1);
    const req = museCalls()[0];
    expect(req.opts.url).toBe('https://music.amazon.com/NA/api/muse/getEligibility');
    expect(req.headers['X-Amz-Target']).toBe('com.amazon.muse.MuseServiceExternal.getEligibility');
    expect(req.headers['Content-Type']).toBe('application/json');
    expect(req.headers['Content-Encoding']).toBe('amz-1.0');
    expect(req.headers['csrf-token']).toBe('tok-0123456789abcdef0123456789abcdef=');
    expect(req.headers['Cookie']).toContain('at-main=AT');
    expect(JSON.parse(req.getBody())).toEqual({
      customerId: 'CUST1',
      deviceType: 'A16ZV8BU3SN1N3',
      deviceId: '14354613042605242',
      musicTerritory: 'US',
      requestedContent: 'KATANA',
      asins: ['B1', 'B2'] // one batch, deduped
    });
  });

  test('UNLIMITED tiers do not filter — no request, the input list passes through', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON })); // tier UNLIMITED_HD
    const tracks = [{ asin: 'B1' }, { asin: 'B2' }];
    const kept = await amazonDmls.filterUnplayableForPlan(tracks);
    expect(kept).toBe(tracks);
    expect(museCalls()).toHaveLength(0);
  });

  test('an unknown tier does not filter either (no request)', async () => {
    requestHandlers.push(() => ({ status: 200, text: JSON.stringify({ customerId: 'C', siteRegion: 'NA', deviceId: 'D', tier: 'SOMETHING_NEW' }) }));
    const tracks = [{ asin: 'B1' }];
    expect(await amazonDmls.filterUnplayableForPlan(tracks)).toBe(tracks);
    expect(museCalls()).toHaveLength(0);
  });

  test('failures never make things worse: HTTP error keeps every track', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ status: 500 });
    const tracks = [{ asin: 'B1' }, { asin: 'B2' }];
    expect(await amazonDmls.filterUnplayableForPlan(tracks)).toEqual(tracks);
  });

  test('failures never make things worse: a renamed/reshaped envelope keeps every track', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    requestHandlers.push(() => ({ status: 200, text: '{"notTrackEligibilityMap":{}}' }));
    const tracks = [{ asin: 'B1' }];
    expect(await amazonDmls.filterUnplayableForPlan(tracks)).toEqual(tracks);
  });

  test('an EMPTY map is a valid answer — every ASIN result drops (asin-less stays)', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: {} });
    const kept = await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }, { asin: 'B2' }, { title: 'none' }]);
    expect(kept).toEqual([{ title: 'none' }]);
  });

  test('verdicts cache per ASIN: a second search makes no new call, absent-asins cache as not-eligible', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: true } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }, { asin: 'B2' }]);
    expect(amazonDmls.eligibilityCache.size).toBe(2); // B2's absence cached as not-eligible
    const kept = await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }, { asin: 'B2' }]);
    expect(kept.map((t) => t.asin)).toEqual(['B1']);
    expect(museCalls()).toHaveLength(1);
  });

  test('verdicts expire after a day and refresh in one call', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: true } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }]);
    for (const entry of amazonDmls.eligibilityCache.values()) entry.at = 0; // past the day TTL
    queueEligibility({ map: { B1: { isPrime: false } } });
    const kept = await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }]);
    expect(kept).toEqual([]);
    expect(museCalls()).toHaveLength(2);
  });

  test('mixed: a cached drop survives a failed refresh of the other ASINs', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: false } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }]);
    queueEligibility({ status: 500 });
    const kept = await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }, { asin: 'B2' }]);
    expect(kept.map((t) => t.asin)).toEqual(['B2']); // B1 cached-drop, B2 failure-kept
  });

  test('sign-out drops the verdict cache with the session context', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: true } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }]);
    expect(amazonDmls.eligibilityCache.size).toBe(1);
    amazonDmls.onSignOut();
    expect(amazonDmls.eligibilityCache.size).toBe(0);
  });

  test('tier/filter diagnostics surface in debugState', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: true } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }]);
    expect(amazonDmls.debugState().eligibility).toEqual({
      filtering: true,
      cached: 1,
      inFlight: 0,
      backedOffUntil: new Date(0).toISOString()
    });
  });

  test('not signed in keeps everything (no session context, no filter, no throw)', async () => {
    mockCookies.length = 0;
    mockCookies.push({ name: 'session-id', value: 'x' });
    const tracks = [{ asin: 'B1' }];
    const kept = await amazonDmls.filterUnplayableForPlan(tracks);
    expect(kept).toBe(tracks);
    expect(museCalls()).toHaveLength(0);
    mockCookies.unshift({ name: 'at-main', value: 'AT' });
  });
});

describe('eligibility LRU cache (#1198 review)', () => {
  const verdict = { isPrime: true, isMusicSubscription: true, isHighQuality: false, isSonicRush: false };

  test('writes past the cap push the OLDEST entries out, one by one', () => {
    for (let i = 0; i < ELIGIBILITY_CACHE_MAX + 10; i++) amazonDmls.cacheEligibility(`B${i}`, verdict, 1);
    expect(amazonDmls.eligibilityCache.size).toBe(ELIGIBILITY_CACHE_MAX);
    expect(amazonDmls.eligibilityCache.has('B0')).toBe(false); // coldest: gone
    expect(amazonDmls.eligibilityCache.has('B9')).toBe(false);
    expect(amazonDmls.eligibilityCache.has('B10')).toBe(true); // the 4001st survives
  });

  test('a cache HIT refreshes recency — hot verdicts are not pushed out', () => {
    for (let i = 0; i < ELIGIBILITY_CACHE_MAX; i++) amazonDmls.cacheEligibility(`B${i}`, verdict, 1);
    expect(amazonDmls.cachedEligibility('B0', 100)).toEqual(verdict); // touch B0
    amazonDmls.cacheEligibility('BNEW', verdict, 100); // must evict B1, not B0
    expect(amazonDmls.eligibilityCache.has('B0')).toBe(true);
    expect(amazonDmls.eligibilityCache.has('B1')).toBe(false);
  });

  test('TTL still uses the original mint time (a hit does not extend the day)', () => {
    amazonDmls.cacheEligibility('B0', verdict, 1000);
    expect(amazonDmls.cachedEligibility('B0', 1000 + ELIGIBILITY_DAY_TTL - 1)).toEqual(verdict);
    expect(amazonDmls.cachedEligibility('B0', 1000 + ELIGIBILITY_DAY_TTL)).toBeNull();
  });

  test('re-writing an asin keeps one entry (delete + re-insert)', () => {
    amazonDmls.cacheEligibility('B0', { ...verdict, isPrime: false }, 1);
    amazonDmls.cacheEligibility('B0', verdict, 2);
    expect(amazonDmls.eligibilityCache.size).toBe(1);
    expect(amazonDmls.cachedEligibility('B0', 3)).toEqual(verdict);
  });
});

describe('eligibility failure backoff (#1198 review #3)', () => {
  test('a failed lookup backs the endpoint off: no calls, results kept, cache still applies', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B_CACHED: { isPrime: false } } });
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B_CACHED' }]);
    queueEligibility({ status: 500 }); // the failure: B_FRESH fetch fails
    await amazonDmls.filterUnplayableForPlan([{ asin: 'B_FRESH' }]);
    expect(amazonDmls.eligibilityBackoffUntil).toBeGreaterThan(Date.now());
    // Within the backoff: NO new request, cached B_CACHED still drops, fresh kept.
    const kept = await amazonDmls.filterUnplayableForPlan([{ asin: 'B_CACHED' }, { asin: 'B_FRESH' }]);
    expect(kept.map((t) => t.asin)).toEqual(['B_FRESH']);
    const calls = mockRequests.filter((r) => r.opts.url.includes('/api/muse/getEligibility'));
    expect(calls).toHaveLength(2); // the success + the failure — and no third
  });

  test('success clears the backoff', async () => {
    amazonDmls.eligibilityBackoffUntil = Date.now() + 60000;
    amazonDmls.eligibilityBackoffUntil = 0; // simulate expiry
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    queueEligibility({ map: { B1: { isPrime: false } } });
    const kept = await amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }]);
    expect(kept).toEqual([]);
    expect(amazonDmls.eligibilityBackoffUntil).toBe(0);
  });
});

describe('concurrent eligibility lookups (#1198 review #4)', () => {
  const PRIME_CTX = {
    customerId: 'CUST1', marketplaceId: 'MKT', territoryId: 'US', region: 'NA',
    tier: 'PRIME', deviceType: 'A16ZV8BU3SN1N3', deviceId: '1435', csrfToken: 'tok-tok-tok-tok-tok', csrfRnd: '1', csrfTs: '2'
  };

  test('overlapping searches share one lookup per ASIN', async () => {
    amazonDmls.sessionContext = PRIME_CTX; // pre-warmed: no config.json fetch
    queueEligibility({ map: { B1: { isPrime: true }, B2: { isPrime: false } } });
    queueEligibility({ map: { B3: { isPrime: true } } });
    const [a, b] = await Promise.all([
      amazonDmls.filterUnplayableForPlan([{ asin: 'B1' }, { asin: 'B2' }]),
      amazonDmls.filterUnplayableForPlan([{ asin: 'B2' }, { asin: 'B3' }])
    ]);
    expect(a.map((t) => t.asin)).toEqual(['B1']);
    expect(b.map((t) => t.asin)).toEqual(['B3']);
    const calls = mockRequests.filter((r) => r.opts.url.includes('/api/muse/getEligibility'));
    // B2 fetched exactly once; the second fan only re-fetches B3.
    const fetched = calls.flatMap((r) => JSON.parse(r.getBody()).asins);
    expect(fetched.filter((x) => x === 'B2')).toHaveLength(1);
    expect(fetched.sort()).toEqual(['B1', 'B2', 'B3']);
    expect(amazonDmls.eligibilityInFlight.size).toBe(0); // cleaned up after settle
  });

  test('in-flight verdict writes die with their session (sign-out mid-flight)', async () => {
    requestHandlers.push(() => ({ status: 200, text: '{"trackEligibilityMap":{}}' }));
    const p = amazonDmls.fetchEligibilityBatch(['B1'], PRIME_CTX);
    amazonDmls.onSignOut(); // generation bump lands before the response does
    const map = await p;
    expect(map.size).toBe(0);
    expect(amazonDmls.eligibilityCache.size).toBe(0); // nothing cached from the old session
  });
});

describe('session warm-up (#1198 review #2)', () => {
  test('cold start warms the context (one config.json + header mint); second call is a no-op', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    expect(amazonDmls.warmSession()).toBe(true);
    await amazonDmls.sessionContextPromise;
    expect(amazonDmls.sessionContext && amazonDmls.sessionContext.tier).toBe('PRIME');
    expect(amazonDmls.warmSession()).toBe(false); // already warm
    expect(mockRequests.filter((r) => r.opts.url.includes('config.json'))).toHaveLength(1);
  });

  test('refresh re-mints (a new sign-in can be a different account/tier)', async () => {
    requestHandlers.push(() => ({ status: 200, text: CONFIG_PRIME }));
    amazonDmls.warmSession();
    await amazonDmls.sessionContextPromise;
    requestHandlers.push(() => ({ status: 200, text: CONFIG_JSON })); // now UNLIMITED_HD
    expect(amazonDmls.warmSession({ refresh: true })).toBe(true);
    await amazonDmls.sessionContextPromise; // capture-then-await: no leaked mint into the next test
    expect(amazonDmls.sessionContext.tier).toBe('UNLIMITED_HD');
  });

  test('signed out is a silent no-op (no rejection, no context)', async () => {
    mockCookies.length = 0;
    mockCookies.push({ name: 'session-id', value: 'x' });
    expect(amazonDmls.warmSession()).toBe(true);
    await new Promise((r) => setTimeout(r, 20));
    expect(amazonDmls.sessionContext).toBeNull();
    mockCookies.unshift({ name: 'at-main', value: 'AT' });
  });

  test('sign-out also clears the in-flight map, the backoff and bumps the generation', () => {
    amazonDmls.eligibilityInFlight.set('B1', Promise.resolve(null));
    amazonDmls.eligibilityBackoffUntil = Date.now() + 60000;
    const gen = amazonDmls.sessionGeneration;
    amazonDmls.onSignOut();
    expect(amazonDmls.eligibilityInFlight.size).toBe(0);
    expect(amazonDmls.eligibilityBackoffUntil).toBe(0);
    expect(amazonDmls.sessionGeneration).toBe(gen + 1);
  });
});

describe('widevine bridge IPC', () => {
  test('unregistered resolver fails honestly; registered provider round-trips', async () => {
    const handlers = {};
    const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
    registerWidevineBridgeIpc({ ipcMain });

    const missing = await handlers['widevine:manifest'](null, { resolverId: 'nope', entity: {} });
    expect(missing).toMatchObject({ success: false, reason: 'not-ready' });

    registerWidevineProvider('mock', {
      getManifest: async (entity) => ({ manifest: '<MPD/>', note: entity.asin }),
      relayLicense: async (challenge) => (challenge === 'Q0FRPQ==' ? 'TElD' : 'BAD')
    });
    const manifest = await handlers['widevine:manifest'](null, { resolverId: 'mock', entity: { asin: 'B1' } });
    expect(manifest).toMatchObject({ success: true, manifest: '<MPD/>', note: 'B1' });
    expect(typeof manifest.sessionId).toBe('string');
    const license = await handlers['widevine:license'](null, { resolverId: 'mock', challenge: 'Q0FRPQ==', sessionId: manifest.sessionId });
    expect(license).toMatchObject({ success: true, license: 'TElD' });
    const bad = await handlers['widevine:license'](null, { resolverId: 'mock' });
    expect(bad).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('registerAmazonDmlsProvider registers the amazon provider', () => {
    const registered = {};
    registerAmazonDmlsProvider({ registerWidevineProvider: (id, p) => { registered[id] = p; }, store: { get: () => undefined, set: () => {} } });
    expect(registered.amazonmusic).toBeDefined();
    expect(typeof registered.amazonmusic.getManifest).toBe('function');
    expect(typeof registered.amazonmusic.relayLicense).toBe('function');
  });
});

describe('widevine bridge relay gating', () => {
  let handlers;
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };

  const provider = {
    getManifest: async () => ({ manifest: '<MPD/>' }),
    relayLicense: async (challenge) => 'LIC-' + challenge.slice(0, 6)
  };

  const topFrame = {};
  Object.defineProperty(topFrame, 'top', { value: topFrame });
  const mainFrameEvent = { sender: { id: 1 }, senderFrame: topFrame };
  const iframeEvent = { sender: { id: 1 }, senderFrame: { top: {}, different: true } };
  const isAllowedSender = (event) => event.senderFrame && event.senderFrame.top === event.senderFrame;

  beforeEach(() => {
    handlers = {};
    registerWidevineProvider('mock', provider);
    registerWidevineBridgeIpc({ ipcMain, isAllowedSender });
  });

  test('sender gate: iframes are denied on all channels', async () => {
    const manifest = await handlers['widevine:manifest'](iframeEvent, { resolverId: 'mock', entity: {} });
    expect(manifest).toMatchObject({ success: false, reason: 'denied' });
    const license = await handlers['widevine:license'](iframeEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: 'x' });
    expect(license).toMatchObject({ success: false, reason: 'denied' });
  });

  test('manifest opens a session; license only relays inside it', async () => {
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    expect(manifest.success).toBe(true);
    expect(typeof manifest.sessionId).toBe('string');
    const license = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: manifest.sessionId });
    expect(license).toMatchObject({ success: true, license: expect.stringContaining('LIC') });
  });

  test('no session → invalid (the oracle is closed without a live play)', async () => {
    const license = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: 'never-opened' });
    expect(license).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('a new manifest rotates the session — the stale play\'s relays fail', async () => {
    const first = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    const second = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    expect(first.sessionId).not.toBe(second.sessionId);
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: first.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: second.sessionId }))
      .toMatchObject({ success: true });
  });

  test('stop/end closes the session', async () => {
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'mock', event: { type: 'stopped' } });
    expect(await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'CAQ=', sessionId: manifest.sessionId }))
      .toMatchObject({ success: false, reason: 'invalid' });
  });

  test('relays per session are capped', async () => {
    const manifest = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock', entity: {} });
    for (let i = 0; i < 30; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'QnA=', sessionId: manifest.sessionId });
      expect(r.success).toBe(true);
    }
    const cap = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock', challenge: 'QnE=', sessionId: manifest.sessionId });
    expect(cap).toMatchObject({ success: false, reason: 'invalid', error: expect.stringContaining('cap') });
  });
});

describe('widevine bridge session ORDERING (review round 2)', () => {
  let handlers;
  const ipcMain = { handle: (name, fn) => { handlers[name] = fn; } };
  const topFrame = {};
  Object.defineProperty(topFrame, 'top', { value: topFrame });
  const mainFrameEvent = { sender: { id: 1 }, senderFrame: topFrame };
  const isAllowedSender = (event) => event.senderFrame && event.senderFrame.top === event.senderFrame;

  beforeEach(() => {
    handlers = {};
    registerWidevineBridgeIpc({ ipcMain, isAllowedSender });
  });

  test('a late-resolving manifest cannot rotate over the newer request', async () => {
    const resolvers = [];
    registerWidevineProvider('mock-order', {
      getManifest: () => new Promise((res) => resolvers.push(() => res({ manifest: '<MPD/>' }))),
      relayLicense: async () => 'LIC'
    });
    const oldP = handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-order', entity: { asin: 'OLD' } });
    const newP = handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-order', entity: { asin: 'NEW' } });
    await new Promise((r) => setImmediate(r));
    expect(resolvers).toHaveLength(2);
    resolvers[1](); // NEW resolves first
    const newer = await newP;
    expect(newer.success).toBe(true);
    resolvers[0](); // then OLD resolves late
    const older = await oldP;
    expect(older).toMatchObject({ success: false, reason: 'superseded' });
    const relay = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock-order', challenge: 'CAQ=', sessionId: newer.sessionId });
    expect(relay).toMatchObject({ success: true });
  });

  test('a stopped/ended event closes ONLY the matching session', async () => {
    registerWidevineProvider('mock-close', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'LIC'
    });
    const first = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-close', entity: {} });
    const second = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-close', entity: {} });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'mock-close', event: { type: 'stopped', sessionId: first.sessionId } });
    const relay = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock-close', challenge: 'CAQ=', sessionId: second.sessionId });
    expect(relay).toMatchObject({ success: true });
    await handlers['widevine:player-event'](mainFrameEvent, { resolverId: 'mock-close', event: { type: 'stopped', sessionId: second.sessionId } });
    const afterClose = await handlers['widevine:license'](mainFrameEvent, { resolverId: 'mock-close', challenge: 'CAQ=', sessionId: second.sessionId });
    expect(afterClose).toMatchObject({ success: false, reason: 'invalid' });
  });

  test('manifests are rate-limited per resolver', async () => {
    registerWidevineProvider('mock-rate', {
      getManifest: async () => ({ manifest: '<MPD/>' }),
      relayLicense: async () => 'LIC'
    });
    for (let i = 0; i < 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      const r = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-rate', entity: { asin: String(i) } });
      expect(r.success).toBe(true);
    }
    const ninth = await handlers['widevine:manifest'](mainFrameEvent, { resolverId: 'mock-rate', entity: {} });
    expect(ninth).toMatchObject({ success: false, reason: 'rate-limited' });
  });
});
