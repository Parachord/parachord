/**
 * The Amazon plugin's DRM pair (#1356 M4, live since M9; plugins-src/
 * amazonmusic/implementation.js) — the provider pins from
 * tests/main-process/widevine-amazon-provider.test.js ported to drive the
 * PLUGIN methods against a mocked window.electron.webSession bridge (the
 * preload wrappers' shapes; docs/architecture/web-session.md, "The IPC
 * bridge"). amazon-dmls.js and its main-process provider registration died
 * with the move; the bridge-half pins live on in
 * tests/main-process/widevine-bridge.test.js (the provider path) and
 * widevine-plugin-relay.test.js (the plugin-mediated session).
 *
 * Pinned here:
 *   - the session-context mint: config.json over webSession.fetch paired
 *     with a csrf-triplet page flow (load with capture, the placeholder
 *     filter, config.json's deviceId preferred over the captured header)
 *   - getPlaybackManifest: the ASIN dug out of the WHOLE track, the dmls
 *     body/target/headers, the reply shape (manifest/type/drm/asin/context),
 *     the substituteAsin/cdnType parse and the KID protection sets
 *   - the plan gate: plan-ineligible (with planKey) refused BEFORE any dmls
 *     request, the wording the tile and settings show
 *   - relayLicense: the licence body, the 400 branches (cert class vs
 *     per-content with the first-sentence message and no customer ids in
 *     logs), the auth-rot drop-and-remint retry, the passed session context
 *   - the CAQ= cert warm once per session
 *   - telemetry: the player events mapped onto the hornet envelope and
 *     posted with the csrf + device headers, the health bookkeeping
 *   - the session-generation drop (sign-out) clearing the DRM state
 * Plus the _lib copies the flows run on (the dmls request builders, the
 * licence-denial summary — moved from amazon-music-logic.js with the pair).
 */

const {
  loadAmazonAxe,
  instantiateAmazonPlugin
} = require('../helpers/amazon-plugin-bridge');

const axe = loadAmazonAxe();

const CONFIG_JSON = {
  customerId: 'CUST1',
  marketplaceId: 'MKT',
  musicTerritory: 'US',
  siteRegion: 'NA',
  deviceId: '12345678901234567',
  tier: { name: 'UNLIMITED_HD' }
};

const MINT_HEADERS = {
  'csrf-token': 'tok-0123456789abcdef0123456789abcdef=',
  'csrf-rnd': '403697901',
  'csrf-ts': '1793304003',
  'x-amzn-device-id': '135'
};

const MINT_HEADERS_FRESH = {
  'csrf-token': 'tok-fresh-0123456789abcdef01234567=',
  'csrf-rnd': '403697902',
  'csrf-ts': '1793304103',
  'x-amzn-device-id': '135'
};

// A live-captured-shape MPD (two family-pure AdaptationSets, per-set KIDs —
// the SIREN_KATANA mid-tier + a FLAC set).
const MPD = [
  '<MPD minBufferTime="PT2S">',
  '<AdaptationSet id="1" contentType="audio">',
  '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="021c8ca6-cdb1-412e-8d34-d3a11c1c5f66"/>',
  '<Representation id="3" codecs="opus" bandwidth="325595" audioSamplingRate="48000"/>',
  '</AdaptationSet>',
  '<AdaptationSet id="2" contentType="audio">',
  '<ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="111c8ca6-cdb1-412e-8d34-d3a11c1c5f66"/>',
  '<Representation id="7" codecs="flac" bandwidth="1902230" audioSamplingRate="48000"/>',
  '</AdaptationSet>',
  '</MPD>'
].join('');

function manifestReply(over = {}) {
  return {
    contentResponseStatusCode: 'SUCCESS',
    manifest: MPD,
    substituteAsin: 'SUB1',
    musicDashVersion: 'SIREN_KATANA',
    cdnType: 'cf-d17vo8z6jop21h',
    ...over
  };
}

const flush = (rounds = 6) => {
  let p = Promise.resolve();
  for (let i = 0; i < rounds; i++) p = p.then(() => new Promise((resolve) => setImmediate(resolve)));
  return p;
};

// The resolver track shape the engine hands getPlaybackManifest (the whole
// track — its amazonmusic source record carries amazonAsin).
const drmTrack = (asin = 'B00CRMX53S') => ({
  id: 'amazonmusic-' + asin,
  title: 'no fun',
  artist: 'Kara Jackson',
  album: 'Why Does the Earth Give',
  duration: 210,
  sources: { amazonmusic: { id: 'amazonmusic-' + asin, title: 'no fun', artist: 'Kara Jackson', amazonAsin: asin, confidence: 1 } }
});

/**
 * The DRM-pair webSession mock. Every fetch/load is recorded; the dmls and
 * telemetry endpoints answer from queues (shifted per request), config.json
 * answers the configured tier, and the mint page flow's load answers csrf
 * headers per mint (an array is consumed one entry per load; the last entry
 * repeats). opts:
 *   tier            — config.json's tier (default UNLIMITED_HD; PRIME/null refuse)
 *   configJson      — the full config.json object (overrides tier)
 *   signedIn        — false serves a logged-out jar
 *   generation      — state()'s session generation
 *   mints           — array of capture header sets the loads answer, in order
 *   dmls            — array of { status, text } answers, in request order
 *   telemetry       — array of { status, text } answers (default 200)
 *   loadResult      — the whole load outcome ({ success: false, reason })
 *   finalUrl        — the load's final URL (a wall redirect)
 *   capturesFor     — (loadIndex, url) => capture entries (overrides mints)
 *   version         — what updater.getVersion answers (default '9.9.9-test')
 */
function drmMock(opts = {}) {
  const configJson = opts.configJson !== undefined
    ? opts.configJson
    : { ...CONFIG_JSON, ...(opts.tier === undefined ? {} : { tier: opts.tier }) };
  const dmlsQueue = [...(opts.dmls || [
    { status: 200, text: JSON.stringify({ contentResponseList: [manifestReply()] }) },
    { status: 200, text: '{"license":"Q0VSVF9PSw=="}' } // the cert warm's answer
  ])];
  const telemetryQueue = [...(opts.telemetry || [])];
  const mints = [...(opts.mints || [MINT_HEADERS])];
  const fetches = [];
  const loads = [];
  let loadCount = 0;
  const ws = {
    state: jest.fn(async () => ({
      success: true,
      url: 'viewUrl' in opts ? opts.viewUrl : 'https://music.amazon.com/search/x/songs',
      signInUrl: null,
      cookieNames: opts.signedIn === false ? ['session-id', 'ubid-main'] : ['at-main', 'sess-at-main'],
      generation: 'generation' in opts ? opts.generation : 0
    })),
    load: jest.fn(async (id, url, o) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      const n = loadCount++;
      loads.push({ id, url, o });
      if (opts.loadResult) return opts.loadResult;
      const headers = opts.capturesFor
        ? opts.capturesFor(n, url)
        : [(mints[Math.min(n, mints.length - 1)] || MINT_HEADERS)];
      return {
        success: true,
        finalUrl: 'finalUrl' in opts ? opts.finalUrl : url,
        captures: headers.map((h) => ({ url: 'https://gql.music.amazon.com/', method: 'POST', headers: h, body: '{}', echo: false }))
      };
    }),
    fetch: jest.fn(async (id, request) => {
      if (id !== 'amazon-music') throw new Error('the plugin must drive its own session id');
      fetches.push(request);
      const url = String(request.url || '');
      if (url.includes('/api/dmls/')) {
        const out = dmlsQueue.length ? dmlsQueue.shift() : { status: 500, text: 'no mock' };
        return { success: true, status: out.status, headers: {}, text: out.text };
      }
      if (url.includes('/config.json')) {
        return { success: true, status: 200, headers: {}, text: JSON.stringify(configJson) };
      }
      if (url.includes('/telemetry/')) {
        const out = telemetryQueue.length ? telemetryQueue.shift() : { status: 200, text: '{}' };
        return { success: true, status: out.status, headers: {}, text: out.text };
      }
      return { success: true, status: 404, headers: {}, text: '' };
    }),
    pageFetch: jest.fn(),
    clear: jest.fn().mockResolvedValue({ success: true })
  };
  global.window = {
    electron: {
      webSession: ws,
      updater: { getVersion: async () => ('version' in opts ? opts.version : '9.9.9-test') }
    }
  };
  return { ws, fetches, loads };
}

const dmlsFetches = (fetches) => fetches.filter((r) => String(r.url).includes('/api/dmls/'));
const manifestPosts = (fetches) => dmlsFetches(fetches).filter((r) => String(r.headers['X-Amz-Target'] || '').includes('getDashManifestsV2'));
const telemetryFetches = (fetches) => fetches.filter((r) => String(r.url).includes('/telemetry/'));
const configFetches = (fetches) => fetches.filter((r) => String(r.url).includes('/config.json'));

afterEach(() => {
  delete global.window;
});

// ── the _lib copies the flows run on (moved from amazon-music-logic.js) ────

describe('the plugin _lib dmls builders', () => {
  const lib = () => instantiateAmazonPlugin(axe).lib;

  test('amazonDmlsRegion maps territories to the dmls region segment', () => {
    const { amazonDmlsRegion } = lib();
    expect(amazonDmlsRegion('US')).toBe('NA');
    expect(amazonDmlsRegion('BR')).toBe('NA');
    expect(amazonDmlsRegion('DE')).toBe('EU');
    expect(amazonDmlsRegion('GB')).toBe('EU');
    expect(amazonDmlsRegion('JP')).toBe('FE');
    expect(amazonDmlsRegion('AU')).toBe('FE');
    expect(amazonDmlsRegion(null)).toBe('NA');
  });

  test('amazonDmlsManifestBody builds the captured shape', () => {
    const { amazonDmlsManifestBody } = lib();
    const base = { asin: 'B00CRMX53S', customerId: 'CUST', marketplaceId: 'ATVPDKIKX0DER', territoryId: 'US', deviceId: '123', musicAgent: 'Agent/1.0' };
    const body = amazonDmlsManifestBody(base);
    expect(body.contentIdList).toEqual([{ identifier: 'B00CRMX53S', identifierType: 'ASIN' }]);
    expect(body.deviceToken).toEqual({ deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: '123' });
    expect(body.customerId).toBe('CUST');
    expect(body.customerInfo).toEqual({ marketplaceId: 'ATVPDKIKX0DER', territoryId: 'US' });
    expect(body.musicDashVersionList).toEqual(['SIREN_KATANA']);
    expect(body.contentProtectionList).toEqual(['TRACK_PSSH']);
    expect(body.tryAsinSubstitution).toBe(true);
    expect(body.appInfo).toEqual({ musicAgent: 'Agent/1.0' });
    expect(amazonDmlsManifestBody({ ...base, asin: null })).toBeNull();
    expect(amazonDmlsManifestBody({ ...base, customerId: null })).toBeNull();
    expect(amazonDmlsManifestBody({ ...base, deviceId: null })).toBeNull();
  });

  test('amazonDmlsLicenseBody builds the Widevine relay shape, cert challenge included', () => {
    const { amazonDmlsLicenseBody, WIDEVINE_CERT_CHALLENGE } = lib();
    const body = amazonDmlsLicenseBody({ challenge: WIDEVINE_CERT_CHALLENGE, customerId: 'CUST', deviceId: '123', musicAgent: 'Agent/1.0' });
    expect(body.DrmType).toBe('WIDEVINE');
    expect(body.licenseChallenge).toBe('CAQ=');
    expect(body.customerId).toBe('CUST');
    expect(body.deviceToken.deviceId).toBe('123');
    expect(amazonDmlsLicenseBody({ challenge: null, customerId: 'C', deviceId: 'D' })).toBeNull();
  });

  test('dashCodecFamily buckets codec strings', () => {
    const { dashCodecFamily } = lib();
    expect(dashCodecFamily('flac')).toBe('flac');
    expect(dashCodecFamily('opus')).toBe('opus');
    expect(dashCodecFamily('mp4a.40.2')).toBe('aac');
  });

  describe('licenseDenialSummary', () => {
    // Shape of a live content refusal on a Prime account; the ids are fake.
    const CONTENT_REFUSAL = 'customer is not eligible for content (EligibilityException CUSTOMER_NOT_ELIGIBLE) - '
      + 'CustomerEligibility(customerId=AFAKECUSTOMER123, marketplaceId=ATVFAKEMARKET, eligibilities=[ROBIN, NIGHTWING]) '
      + 'ContentEligibility(asin=B086Q41M9C, eligibilities=[KATANA])';
    const { licenseDenialSummary } = lib();

    test('keeps the sentence before the eligibility dump', () => {
      expect(licenseDenialSummary(CONTENT_REFUSAL))
        .toBe('customer is not eligible for content (EligibilityException CUSTOMER_NOT_ELIGIBLE)');
    });

    test('drops an eligibility block that arrives without the separator', () => {
      expect(licenseDenialSummary('not eligible CustomerEligibility(customerId=AFAKECUSTOMER123)')).toBe('not eligible');
    });

    test('scrubs account identifiers anywhere in the text, JSON bodies included', () => {
      expect(licenseDenialSummary('denied for customerId=AFAKECUSTOMER123, deviceId: 1234abcd'))
        .toBe('denied for customerId=<redacted>, deviceId: <redacted>');
      expect(licenseDenialSummary('{"customerId":"AFAKECUSTOMER123","message":"denied"}')).not.toContain('AFAKECUSTOMER123');
    });

    test('leaves a plain message alone and caps a long one; non-strings give null', () => {
      expect(licenseDenialSummary('customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)'))
        .toBe('customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)');
      expect(licenseDenialSummary('x'.repeat(500))).toHaveLength(201);
      expect(licenseDenialSummary(null)).toBeNull();
      expect(licenseDenialSummary('   ')).toBeNull();
    });
  });
});

// ── the session-context mint ────────────────────────────────────────────────

describe('the session-context mint', () => {
  test('mints from config.json + the captured csrf headers, preferring config deviceId', async () => {
    const { ws, fetches, loads } = drmMock();
    const resolver = instantiateAmazonPlugin(axe);
    const reply = await resolver.getPlaybackManifest(drmTrack(), {});
    expect(reply.manifest).toContain('<MPD');
    // The csrf triplet came from a mint page flow (a load with capture), and
    // config.json from a jar-carrying fetch.
    expect(loads).toHaveLength(1);
    expect(loads[0].url).toContain('https://music.amazon.com/search/');
    expect(loads[0].o.capture.urlPrefixes).toContain('https://gql.music.amazon.com/*');
    expect(configFetches(fetches)).toHaveLength(1);
    // The manifest body carries the config's device (the captured header's is
    // the fallback), the customer, and the mint's csrf triplet.
    const body = JSON.parse(dmlsFetches(fetches)[0].body);
    expect(body.deviceToken).toEqual({ deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: '12345678901234567' });
    expect(body.customerId).toBe('CUST1');
    expect(dmlsFetches(fetches)[0].headers['csrf-token']).toBe(MINT_HEADERS['csrf-token']);
    expect(ws.fetch).toHaveBeenCalledWith('amazon-music', expect.objectContaining({ url: expect.stringContaining('/api/dmls/') }));
  });

  test('config.json deviceId wins over the captured header placeholder', async () => {
    const { fetches } = drmMock({ mints: [{ ...MINT_HEADERS, 'x-amzn-device-id': 'foo' }] });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getPlaybackManifest(drmTrack(), {});
    expect(JSON.parse(dmlsFetches(fetches)[0].body).deviceToken.deviceId).toBe('12345678901234567');
  });

  test('the benign mint query is the plugin\'s own last search text, else a constant', async () => {
    const cold = drmMock();
    await instantiateAmazonPlugin(axe).getPlaybackManifest(drmTrack(), {});
    await flush(); // the cold resolver's fire-and-forget cert warm settles here
    expect(cold.loads[0].url).toContain('/search/the/songs');

    const warm = drmMock();
    const resolver = instantiateAmazonPlugin(axe);
    // The search's own page flow runs first (it fails structurally on this
    // mock's mint-shaped captures — irrelevant here: the query is recorded
    // before the runner). The MINT is the load after it.
    await resolver.search({ title: 'Around the World', artist: 'Daft Punk' }, {}).catch(() => {});
    await resolver.getPlaybackManifest(drmTrack(), {});
    // The songs query the search built — already in the user's Amazon history.
    expect(warm.loads.length).toBeGreaterThan(1);
    const mintLoad = warm.loads[warm.loads.length - 1];
    expect(mintLoad.url).toContain(encodeURIComponent('"Around the World" by "Daft Punk"'));
    expect(resolver._lastSearchText).toContain('"Around the World"');
  });

  test('not signed in fails with not-signed-in before any request', async () => {
    const { fetches, loads } = drmMock({ signedIn: false });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(loads).toHaveLength(0);
    expect(fetches).toHaveLength(0);
  });

  test('a mint page that lands on a wall is not-signed-in', async () => {
    const { fetches } = drmMock({ finalUrl: 'https://www.amazon.com/ap/signin' });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(dmlsFetches(fetches)).toHaveLength(0);
  });

  test('a mint page that fires no real csrf is load-failed, never a sign-in prompt', async () => {
    const { fetches } = drmMock({ capturesFor: () => [{ 'csrf-token': 'foo', 'csrf-rnd': 'bar', 'csrf-ts': 'baz' }] });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'load-failed' });
    expect(dmlsFetches(fetches)).toHaveLength(0);
  });
});

// ── getPlaybackManifest ─────────────────────────────────────────────────────

describe('getPlaybackManifest', () => {
  test('digs the ASIN out of the whole track (the amazonmusic source record) and posts the dmls body', async () => {
    const { fetches } = drmMock();
    const resolver = instantiateAmazonPlugin(axe);
    const reply = await resolver.getPlaybackManifest(drmTrack('B00CRMX53S'), {});
    const req = dmlsFetches(fetches)[0];
    expect(String(req.url)).toBe('https://music.amazon.com/NA/api/dmls/');
    expect(req.method).toBe('POST');
    expect(req.headers['X-Amz-Target']).toBe('com.amazon.digitalmusiclocator.DigitalMusicLocatorServiceExternal.getDashManifestsV2');
    expect(req.headers['Content-Encoding']).toBe('amz-1.0');
    expect(req.headers['csrf-rnd']).toBe('403697901');
    const body = JSON.parse(req.body);
    expect(body.contentIdList).toEqual([{ identifier: 'B00CRMX53S', identifierType: 'ASIN' }]);
    expect(body.customerInfo).toEqual({ marketplaceId: 'MKT', territoryId: 'US' });
    // The musicAgent embeds the app version off the renderer's version surface.
    expect(body.appInfo.musicAgent).toBe('Vinyl/2.0 GreenHornet_Web/1.0.1458 (Parachord/9.9.9-test)');
    // The reply rides the M4 contract's fields.
    expect(reply.type).toBe('dash');
    expect(reply.drm).toBe('widevine');
    expect(reply.asin).toBe('B00CRMX53S');
    expect(reply.substituteAsin).toBe('SUB1');
    expect(reply.musicDashVersion).toBe('SIREN_KATANA');
    expect(reply.cdnType).toBe('cf-d17vo8z6jop21h');
    // The context carries the session bits relayLicense + telemetry need.
    expect(reply.context).toMatchObject({
      customerId: 'CUST1',
      deviceId: '12345678901234567',
      csrfToken: MINT_HEADERS['csrf-token'],
      region: 'NA',
      tier: 'UNLIMITED_HD',
      substituteAsin: 'SUB1',
      cdnType: 'cf-d17vo8z6jop21h'
    });
    // The KID protection sets ride the reply (per-family error attribution).
    expect(reply.protectionSets.map((s) => [s.family, s.kid])).toEqual([
      ['opus', '021c8ca6-cdb1-412e-8d34-d3a11c1c5f66'],
      ['flac', '111c8ca6-cdb1-412e-8d34-d3a11c1c5f66']
    ]);
  });

  test('a track without an identifier is invalid; a missing app version degrades honestly', async () => {
    const noVersion = drmMock({ version: null });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getPlaybackManifest({ title: 'x' }, {})).rejects.toMatchObject({ reason: 'invalid' });
    await resolver.getPlaybackManifest(drmTrack(), {});
    expect(JSON.parse(dmlsFetches(noVersion.fetches)[0].body).appInfo.musicAgent).toBe('Vinyl/2.0 GreenHornet_Web/1.0.1458 (Parachord/dev)');
  });

  test('a manifest HTTP error maps to playback-failed; a bridge failure to load-failed', async () => {
    const http = drmMock({ dmls: [{ status: 500, text: 'boom' }] });
    await expect(instantiateAmazonPlugin(axe).getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'playback-failed' });

    const offline = drmMock({ dmls: [{ status: -1, text: 'web-session fetch exceeded 30000ms' }] });
    await expect(instantiateAmazonPlugin(axe).getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'load-failed' });
  });

  test('a non-SUCCESS entry maps to playback-failed', async () => {
    const { fetches } = drmMock({ dmls: [{ status: 200, text: JSON.stringify({ contentResponseList: [{ contentResponseStatusCode: 'CONTENT_NOT_FOUND', contentResponseStatusMessage: 'nf' }] }) }] });
    await expect(instantiateAmazonPlugin(axe).getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'playback-failed' });
    expect(dmlsFetches(fetches)).toHaveLength(1);
  });

  test('session rot: a 400 auth-shaped refusal drops the context, re-mints and retries once', async () => {
    const { fetches, loads } = drmMock({
      mints: [MINT_HEADERS, MINT_HEADERS_FRESH],
      dmls: [
        { status: 400, text: '{"__type":"com.amazon.digitalmusiclocator#UnauthorizedException","message":"Request authentication failure : REQUIRED_COOKIES_MISSING"}' },
        { status: 200, text: JSON.stringify({ contentResponseList: [manifestReply()] }) }
      ]
    });
    const resolver = instantiateAmazonPlugin(axe);
    const reply = await resolver.getPlaybackManifest(drmTrack(), {});
    expect(reply.manifest).toContain('<MPD');
    expect(manifestPosts(fetches)).toHaveLength(2);
    expect(loads).toHaveLength(2); // the re-mint ran its own page flow
    // The retry carried the FRESH mint's csrf triplet.
    expect(manifestPosts(fetches)[1].headers['csrf-token']).toBe(MINT_HEADERS_FRESH['csrf-token']);
  });

  test('a second auth-shaped refusal is the session itself being dead: not-signed-in', async () => {
    const rot = { status: 400, text: '{"message":"Request authentication failure : REQUIRED_COOKIES_MISSING"}' };
    const { fetches } = drmMock({ dmls: [rot, rot] });
    await expect(instantiateAmazonPlugin(axe).getPlaybackManifest(drmTrack(), {})).rejects.toMatchObject({ reason: 'not-signed-in' });
    expect(manifestPosts(fetches)).toHaveLength(2);
  });
});

// ── the plan gate before any manifest request ───────────────────────────────

describe('the plan gate (#1220) before any dmls request', () => {
  const configWithTier = (tier) => JSON.stringify({
    customerId: 'CUST1', marketplaceId: 'MKT', musicTerritory: 'US', siteRegion: 'NA', deviceId: '1435',
    ...(tier === undefined ? {} : { tier })
  });
  const mockWithConfig = (configText) => drmMock({ configJson: JSON.parse(configText) });

  test('Music Unlimited plays', async () => {
    const { fetches } = mockWithConfig(configWithTier('UNLIMITED_HD'));
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.getPlaybackManifest(drmTrack(), {})).resolves.toMatchObject({ manifest: expect.any(String) });
    expect(manifestPosts(fetches)).toHaveLength(1);
    expect(resolver._planState.plan).toBe('unlimited');
  });

  test.each([
    ['PRIME', 'prime', /^Amazon Prime: Amazon is used for album art, artist photos and links\. Playing Amazon tracks in Parachord needs Music Unlimited\.$/],
    [undefined, 'unknown', /couldn't confirm your Amazon Music plan/],
    ['SOMETHING_NEW', 'unknown', /couldn't confirm your Amazon Music plan/]
  ])('tier %p is refused as plan-ineligible before any dmls request', async (tier, planKey, message) => {
    const { fetches } = mockWithConfig(configWithTier(tier));
    const resolver = instantiateAmazonPlugin(axe);
    const err = await resolver.getPlaybackManifest(drmTrack(), {}).catch((e) => e);
    expect(err).toMatchObject({ reason: 'plan-ineligible', planKey });
    expect(err.message).toMatch(message);
    expect(manifestPosts(fetches)).toHaveLength(0);
  });
});

// ── relayLicense ────────────────────────────────────────────────────────────

describe('relayLicense', () => {
  test('returns the license field, targeting getLicenseForPlaybackV2 with the passed context', async () => {
    // No manifest flow first: the passed context (the snapshot the session
    // opened with) supplies the session bits.
    const { fetches } = drmMock({ dmls: [{ status: 200, text: '{"license":"TElDRU5TRQ=="}' }] });
    const resolver = instantiateAmazonPlugin(axe);
    const context = {
      customerId: 'CUST1', marketplaceId: 'MKT', territoryId: 'US', region: 'NA', tier: 'UNLIMITED_HD',
      deviceId: '12345678901234567', csrfToken: 'tok-x', csrfRnd: '1', csrfTs: '2',
      substituteAsin: 'SUB1', cdnType: 'cf', musicDashVersion: 'SIREN_KATANA'
    };
    await expect(resolver.relayLicense('Y2hhbGxlbmdl', context)).resolves.toBe('TElDRU5TRQ==');
    const req = dmlsFetches(fetches)[0];
    expect(req.headers['X-Amz-Target']).toContain('getLicenseForPlaybackV2');
    expect(req.headers['csrf-token']).toBe('tok-x');
    const body = JSON.parse(req.body);
    expect(body.DrmType).toBe('WIDEVINE');
    expect(body.licenseChallenge).toBe('Y2hhbGxlbmdl');
    expect(body.customerId).toBe('CUST1');
  });

  test('prefers the live mint over the passed snapshot (an auth-rot re-mint refreshes only the live one)', async () => {
    const { fetches } = drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [manifestReply()] }) },
      { status: 200, text: '{"license":"TElDRU5TRQ=="}' }
    ] });
    const resolver = instantiateAmazonPlugin(axe);
    resolver._certSessionReady = true; // keep the cert warm out of this flow
    // A manifest flow first: the plugin now holds a LIVE context.
    const reply = await resolver.getPlaybackManifest(drmTrack(), {});
    await resolver.relayLicense('Y2hhbGxlbmdl', { ...reply.context, csrfToken: 'tok-stale' });
    const relay = dmlsFetches(fetches)[1];
    expect(relay.headers['csrf-token']).toBe(MINT_HEADERS['csrf-token']);
  });

  test('an invalid challenge is refused before any request', async () => {
    const { fetches } = drmMock();
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.relayLicense('not b64!!', {})).rejects.toThrow('invalid license challenge');
    await expect(resolver.relayLicense('', {})).rejects.toThrow('invalid license challenge');
    expect(fetches).toHaveLength(0);
  });

  test('400 with an opaque/non-JSON body is a generic refusal, NOT claimed as the cert class', async () => {
    const { fetches } = drmMock({ dmls: [{ status: 400, text: 'denied' }] });
    const resolver = instantiateAmazonPlugin(axe);
    const err = await resolver.relayLicense('CAQ=', {}).catch((e) => e);
    expect(err.licenseDenied).toBe(false);
    expect(err.denialReason).toBeNull();
    expect(err.message).not.toContain('VMP');
    expect(err.reason).toBe('playback-failed');
  });

  test('400 denialReason=CUSTOMER_NOT_ELIGIBLE is a per-content refusal (the Prime HD capture shape)', async () => {
    const { fetches } = drmMock({
      dmls: [{
        status: 400,
        text: JSON.stringify({
          __type: 'com.amazon.digitalmusicdrmlicenseservice#ForbiddenException',
          denialReason: 'CUSTOMER_NOT_ELIGIBLE',
          message: 'customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)'
        })
      }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    const err = await resolver.relayLicense('CAQ=', {}).catch((e) => e);
    expect(err.licenseDenied).toBe(false);
    expect(err.denialReason).toBe('CUSTOMER_NOT_ELIGIBLE');
    expect(err.message).toContain('not eligible for HD content');
    expect(err.message).not.toContain('VMP');
  });

  test('400 content refusal: the error and the log carry no customer ID', async () => {
    const { fetches } = drmMock({
      dmls: [{
        status: 400,
        text: JSON.stringify({
          denialReason: 'CUSTOMER_NOT_ELIGIBLE',
          message: 'customer is not eligible for content (EligibilityException CUSTOMER_NOT_ELIGIBLE) - '
            + 'CustomerEligibility(customerId=AFAKECUSTOMER123, marketplaceId=ATVFAKEMARKET)'
        })
      }]
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const resolver = instantiateAmazonPlugin(axe);
      const err = await resolver.relayLicense('CAQ=', {}).catch((e) => e);
      const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(err.message).toContain('not eligible for content');
      expect(err.message).not.toContain('AFAKECUSTOMER123');
      expect(err.message).not.toContain('CustomerEligibility');
      expect(logged).toContain('license denied (CUSTOMER_NOT_ELIGIBLE)');
      expect(logged).not.toContain('AFAKECUSTOMER123');
    } finally {
      warn.mockRestore();
    }
  });

  test('400 denialReason=UNTRUSTED_DEVICE_CERTIFICATE stays licenseDenied (build VMP problem)', async () => {
    const { fetches } = drmMock({
      dmls: [{ status: 400, text: JSON.stringify({ denialReason: 'UNTRUSTED_DEVICE_CERTIFICATE', message: 'device cert rejected' }) }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({
      reason: 'playback-failed',
      licenseDenied: true,
      message: expect.stringContaining('VMP')
    });
  });

  test('a 200 without a license field is an error; a non-200 maps its status class', async () => {
    const noLicense = drmMock({ dmls: [{ status: 200, text: '{"notLicense":"x"}' }] });
    await expect(instantiateAmazonPlugin(axe).relayLicense('CAQ=', {})).rejects.toBeTruthy();

    const offline = drmMock({ dmls: [{ status: -1, text: 'fetch exceeded' }] });
    await expect(instantiateAmazonPlugin(axe).relayLicense('CAQ=', {})).rejects.toMatchObject({ reason: 'load-failed' });
  });

  test('session rot inside a relay drops the context and retries once, then not-signed-in', async () => {
    const rot = { status: 400, text: '{"message":"Request authentication failure : REQUIRED_COOKIES_MISSING"}' };
    const { fetches, loads } = drmMock({
      mints: [MINT_HEADERS_FRESH],
      dmls: [rot, { status: 200, text: '{"license":"TElDRU5TRQ=="}' }]
    });
    const resolver = instantiateAmazonPlugin(axe);
    const context = {
      customerId: 'CUST1', deviceId: '12345678901234567', region: 'NA',
      csrfToken: 'tok-stale', csrfRnd: '1', csrfTs: '2'
    };
    await expect(resolver.relayLicense('Y2hhbGxlbmdl', context)).resolves.toBe('TElDRU5TRQ==');
    expect(dmlsFetches(fetches)).toHaveLength(2);
    expect(loads).toHaveLength(1); // one re-mint page flow
    expect(dmlsFetches(fetches)[1].headers['csrf-token']).toBe(MINT_HEADERS_FRESH['csrf-token']);
  });
});

// ── the cert warm ───────────────────────────────────────────────────────────

describe('the CAQ= cert warm', () => {
  test('a successful manifest pre-charges the cert session once per session', async () => {
    const { fetches } = drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [manifestReply()] }) },
      { status: 200, text: '{"license":"Q0VSVF9PSw=="}' }, // the cert warm's answer
      { status: 200, text: JSON.stringify({ contentResponseList: [manifestReply()] }) } // the second manifest
    ] });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getPlaybackManifest(drmTrack(), {});
    await flush();
    const certWarm = dmlsFetches(fetches).slice(1);
    expect(certWarm).toHaveLength(1);
    expect(certWarm[0].headers['X-Amz-Target']).toContain('getLicenseForPlaybackV2');
    expect(JSON.parse(certWarm[0].body).licenseChallenge).toBe('CAQ=');
    // Once per session: a second manifest does not warm again.
    fetches.length = 0;
    await resolver.getPlaybackManifest(drmTrack('B2'), {});
    await flush();
    expect(dmlsFetches(fetches)).toHaveLength(1); // the manifest only
  });
});

// ── telemetry ───────────────────────────────────────────────────────────────

describe('telemetry (the player events over the bridge)', () => {
  test('play-started maps to a streamingInitiated POST with the hornet envelope + csrf/device headers', async () => {
    const { fetches } = drmMock();
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getPlaybackManifest(drmTrack(), {});
    await flush();
    resolver.handlePlayerEvent({
      type: 'play-started',
      asin: 'SUB1', // the host attributes the SERVED pressing
      albumAsin: 'B00CRMWMZ0',
      durationMs: 369615,
      initialDelaySeconds: 0.148,
      variantFacts: { codec: 'flac', sampleRate: 48000, channels: 2, bandwidth: 1902 },
      cdnType: 'cf-d17vo8z6jop21h'
    });
    await flush();
    const posts = telemetryFetches(fetches);
    expect(posts).toHaveLength(1);
    const envelope = JSON.parse(posts[0].body);
    expect(posts[0].headers['csrf-token']).toBe(MINT_HEADERS['csrf-token']);
    expect(posts[0].headers['x-amz-device-type']).toBe('A16ZV8BU3SN1N3');
    expect(posts[0].headers['x-amz-device-id']).toBe('12345678901234567');
    expect(envelope.deviceId).toBe('12345678901234567');
    expect(envelope.deviceType).toBe('A16ZV8BU3SN1N3');
    const action = envelope.clientActionList[0];
    expect(action.actionName).toBe('streamingInitiated');
    const d = action.additionalDetails;
    expect(d.asin).toBe('SUB1');
    expect(d.selectionSourceId).toBe('B00CRMWMZ0');
    expect(d.contentSubscriptionMode).toBe('UNLIMITED_HD');
    expect(d.bitrates).toBe('HD48'); // 48kHz, no bitDepth reported — the conservative label
    expect(d.cdnType).toBe('cf-d17vo8z6jop21h');
    expect(d.initialPlaybackDelaySeconds).toBe('0.148');
    expect(d.csrf).toBe(JSON.stringify({ token: MINT_HEADERS['csrf-token'], rnd: MINT_HEADERS['csrf-rnd'], ts: MINT_HEADERS['csrf-ts'] }));
    expect(d.resourceType).toBe('UNLIMITED_MUSIC');
  });

  test('seek/pause/resume/ended/stopped map to the termination vocabulary with the final trackStreamed', async () => {
    const { fetches } = drmMock();
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getPlaybackManifest(drmTrack(), {});
    await flush();
    resolver.handlePlayerEvent({ type: 'play-started', asin: 'SUB1', durationMs: 200000 });
    await flush();
    resolver.handlePlayerEvent({ type: 'seek', positionMs: 50000 });
    resolver.handlePlayerEvent({ type: 'pause', positionMs: 60000 });
    resolver.handlePlayerEvent({ type: 'resume', positionMs: 60000 });
    resolver.handlePlayerEvent({ type: 'ended', positionMs: 200000, durationMs: 200000 });
    await flush(8);
    const actions = telemetryFetches(fetches).flatMap((r) => JSON.parse(r.body).clientActionList);
    const names = actions.map((a) => a.actionName);
    expect(names).toEqual([
      'streamingInitiated', // the play-started
      'streamingTerminated', 'streamingInitiated', // the seek pair
      'streamingTerminated', // the pause
      'streamingInitiated', // the resume
      'streamingTerminated', 'trackStreamed' // the final ended pair
    ]);
    const reasons = actions.filter((a) => a.actionName === 'streamingTerminated').map((a) => a.additionalDetails.terminationReason);
    expect(reasons).toEqual(['trackScrub', 'userStop', 'trackFinished']);
    const streamed = actions.find((a) => a.actionName === 'trackStreamed');
    expect(streamed.additionalDetails.terminationReason).toBe('trackFinished');
    expect(streamed.additionalDetails.trackProgress).toBe('200');
    expect(streamed.additionalDetails.durationSecondsSum).toBeDefined();
  });

  test('health: a non-2xx post is warned and counted, the last status surfaces', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { fetches } = drmMock({ telemetry: [{ status: 401, text: 'no csrf' }] });
      const resolver = instantiateAmazonPlugin(axe);
      await resolver.getPlaybackManifest(drmTrack(), {});
      await flush();
      resolver.handlePlayerEvent({ type: 'play-started', asin: 'SUB1' });
      await flush();
      expect(resolver._telemetryHealth.dropped).toBe(1);
      expect(resolver._telemetryHealth.last).toMatchObject({ status: 401, actionName: 'streamingInitiated' });
      const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(logged).toContain('streamingInitiated -> 401');
    } finally {
      warn.mockRestore();
    }
  });

  test('a bridge refusal (the fetch outcome shape) counts as dropped too', async () => {
    const { ws } = drmMock();
    const passthrough = ws.fetch.getMockImplementation();
    ws.fetch.mockImplementation(async (id, request) => (
      String(request.url).includes('/telemetry/')
        ? { success: false, reason: 'not-ready', error: 'no session' }
        : passthrough(id, request)
    ));
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getPlaybackManifest(drmTrack(), {});
    await flush();
    resolver.handlePlayerEvent({ type: 'play-started', asin: 'SUB1' });
    await flush();
    expect(resolver._telemetryHealth.dropped).toBe(1);
    expect(resolver._telemetryHealth.last.status).toBe(-1);
  });
});

// ── the session-generation drop (the sign-out the plugin cannot see) ───────

describe('the session-generation drop', () => {
  test('a generation bump drops the session context, cert warm, telemetry and its health', async () => {
    const gen0 = drmMock({ generation: 0 });
    const resolver = instantiateAmazonPlugin(axe);
    await resolver.getPlaybackManifest(drmTrack(), {});
    await flush();
    resolver.handlePlayerEvent({ type: 'play-started', asin: 'SUB1' });
    await flush();
    expect(resolver._drmSessionContext).toBeTruthy();
    expect(resolver._certSessionReady).toBe(true);
    expect(resolver._telemetry).toBeTruthy();
    expect(resolver._telemetryHealth.dropped).toBe(0);
    resolver._telemetryHealth.dropped = 3; // a stale sign-out counter

    // The sign-out bumped the generation: the next state read drops the DRM
    // state (the fresh mock stands in for the post-sign-out session).
    const gen1 = drmMock({ generation: 1 });
    await resolver.sessionState();
    expect(resolver._drmSessionContext).toBeNull();
    expect(resolver._certSessionReady).toBe(false);
    expect(resolver._telemetry).toBeNull();
    expect(resolver._telemetryHealth).toEqual({ last: null, dropped: 0 });
    // The next manifest re-mints (a fresh page flow + config read).
    await resolver.getPlaybackManifest(drmTrack(), {});
    expect(gen1.loads).toHaveLength(1);
    expect(configFetches(gen1.fetches)).toHaveLength(1);
  });

  test('the drop clears the mint\'s benign-query source too (account A\'s last search is not "already in the user\'s history" under account B)', async () => {
    const gen0 = drmMock({ generation: 0 });
    const resolver = instantiateAmazonPlugin(axe);
    // The benign-query setup: a search records its own query text (the
    // search itself fails structurally on this mock's mint-shaped captures
    // — irrelevant here: the query is recorded before the runner).
    await resolver.search({ title: 'Around the World', artist: 'Daft Punk' }, {}).catch(() => {});
    await resolver.getPlaybackManifest(drmTrack(), {});
    await flush(); // the fire-and-forget cert warm settles here, on this mock
    expect(resolver._lastSearchText).toContain('"Around the World"');

    // The sign-out bumped the generation: the next state read drops the
    // benign-query source, and the next mint falls back to the constant.
    const gen1 = drmMock({ generation: 1 });
    await resolver.sessionState();
    expect(resolver._lastSearchText).toBeNull();
    await resolver.getPlaybackManifest(drmTrack(), {});
    expect(gen1.loads).toHaveLength(1);
    expect(gen1.loads[0].url).toContain('/search/the/songs');
  });
});
