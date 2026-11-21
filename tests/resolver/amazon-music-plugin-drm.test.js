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

  describe('the rendition-group dialect (labels, KIDs, the refusal scope, the MPD filter)', () => {
    // Real MPD: the 2026-11 capture for ASIN B073N6C5XH (the dev-VMP session
    // whose per-track refusals this feature caches), shared with
    // tests/renderer/widevine-shaka-adaptation.test.js — segment lists
    // trimmed and the BaseURLs scrubbed, everything else verbatim: three
    // audio adaptation sets, one Widevine key group each, each named by
    // <SupplementalProperty schemeIdUri="amz-music:trackType">. Identical
    // structure on every track SERVED TO THIS UNVERIFIED BUILD; only the
    // KIDs change (they are per-asset).
    const { AMAZON_LIVE_MPD: LIVE_MPD, AMAZON_SYNTHESIZED_FIVE_SET_MPD } = require('../test-utils/amazon-live-mpd');
    const {
      mpdContentProtectionSets, mpdHasPlayableAudio, mpdRenditionGroupLabel,
      amazonGroupLabelFromDenial, amazonGroupRefusalScope, mpdDropRenditionGroups,
      licenseDenialSummary
    } = instantiateAmazonPlugin(axe).lib;

    test('every adaptation set carries its group label and its own key group', () => {
      const sets = mpdContentProtectionSets(LIVE_MPD);
      expect(sets.map((s) => s.groupLabel)).toEqual(['HD', 'SD', 'LD']);
      expect(sets.map((s) => s.family)).toEqual(['flac', 'opus', 'opus']);
      expect(sets.map((s) => (s.kids || []).length)).toEqual([1, 1, 1]);
      expect(sets[0].reps.map((r) => r.bandwidth)).toEqual([1144652]);
      expect(sets[1].reps.map((r) => r.bandwidth)).toEqual([52988, 196992, 324994]);
      expect(sets[2].reps.map((r) => r.bandwidth)).toEqual([52988, 164991]);
      expect(mpdRenditionGroupLabel(LIVE_MPD.match(/<AdaptationSet id="3"[\s\S]*?<\/AdaptationSet>/)[0])).toBe('LD');
    });

    test('a refusal names its group in the manifest\'s own vocabulary', () => {
      // Live dev-VMP refusals (an unverified VMP signature gets the lowest tier only).
      expect(amazonGroupLabelFromDenial('UNVERIFIED request not eligible for HD content (EligibilityException VMP_VALIDATION_FAILED)')).toBe('HD');
      expect(amazonGroupLabelFromDenial('UNVERIFIED request not eligible for SD content (EligibilityException VMP_VALIDATION_FAILED)')).toBe('SD');
      expect(amazonGroupLabelFromDenial('customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)')).toBe('HD');
      // No phrase, no label: the caller keeps today's unfiltered behavior.
      expect(amazonGroupLabelFromDenial('EligibilityException')).toBe(null);
      expect(amazonGroupLabelFromDenial(null)).toBe(null);
      expect(amazonGroupLabelFromDenial('')).toBe(null);
    });

    test('refusal scope: build-scoped only on a POSITIVE build signal, account-scoped only on a recognized eligibility reason — anything else records nothing', () => {
      // The live dev-VMP refusals: the reason, and Amazon's own sentence, both say build.
      expect(amazonGroupRefusalScope('VMP_VALIDATION_FAILED', 'UNVERIFIED request not eligible for HD content')).toBe('build-refused');
      expect(amazonGroupRefusalScope('SOME_RENAMED_REASON', 'UNVERIFIED request not eligible for SD content')).toBe('build-refused');
      // Eligibility denials are the account's: sign-out AND a plan upgrade end them.
      expect(amazonGroupRefusalScope('CUSTOMER_NOT_ELIGIBLE', 'customer is not eligible for HD content')).toBe('license-denied');
      // Anything else Amazon can ever return records NOTHING: an unrecognized
      // reason (a per-title HD refusal, a reason invented tomorrow) must never
      // take a tier away for the session — a recorded label keeps the tier out
      // of every later manifest, so only a reason the scope positively
      // recognizes may be cached at all.
      expect(amazonGroupRefusalScope('SOME_FUTURE_REASON', 'this title is not eligible for HD content')).toBe(null);
      expect(amazonGroupRefusalScope(null, null)).toBe(null);
    });

    test('the scope reads the RAW message — the summary slice can cut the build sentence away', () => {
      // licenseDenialSummary keeps the text BEFORE the first " - ", so a refusal
      // that puts its UNVERIFIED sentence after the separator loses it there.
      // The scope is handed the RAW message precisely for that case, and its
      // build signal is ANCHORED, so the PII tail can never impersonate it.
      const raw = 'Amazon could not license this title - UNVERIFIED request not eligible for SD content (EligibilityException VMP_VALIDATION_FAILED)';
      // The reason alone carries the build signal here; the anchored sentence read
      // is unchanged by the tail (it does not sit at the start of the message).
      expect(amazonGroupRefusalScope('VMP_VALIDATION_FAILED', raw)).toBe('build-refused');
      expect(amazonGroupRefusalScope('SOME_FUTURE_REASON', raw)).toBe(null);
      // The anchoring is what makes the raw message safe: the same words, buried
      // in an account refusal's tail, record nothing.
      expect(amazonGroupRefusalScope('CUSTOMER_NOT_ELIGIBLE', 'not eligible for HD content - CustomerEligibility(customerId=X, UNVERIFIED request)')).toBe('license-denied');
      // And the PAIR as it stands, pinned rather than implied: the LABEL is still
      // read from the summary slice, so this message yields no label at all —
      // nothing is cached, and the manifests stay unfiltered.
      expect(licenseDenialSummary(raw)).toBe('Amazon could not license this title');
      expect(amazonGroupLabelFromDenial(licenseDenialSummary(raw))).toBe(null);
      expect(amazonGroupLabelFromDenial(raw)).toBe('SD'); // why the raw message is NOT handed to the label reader
    });

    test('mpdDropRenditionGroups removes whole groups, by label, case-insensitively', () => {
      const { manifest, dropped } = mpdDropRenditionGroups(LIVE_MPD, ['sd', 'HD']);
      // Ordered by document position: the real capture serves HD first.
      expect(dropped).toEqual(['HD', 'SD']);
      expect(mpdContentProtectionSets(manifest).map((s) => s.groupLabel)).toEqual(['LD']);
      expect(manifest).toContain('value="LD"');
      expect(manifest).not.toContain('codecs="flac"');
      // Nothing to drop: the manifest comes back untouched.
      expect(mpdDropRenditionGroups(LIVE_MPD, [])).toEqual({ manifest: LIVE_MPD, dropped: [] });
      expect(mpdDropRenditionGroups(LIVE_MPD, ['ULTRA'])).toEqual({ manifest: LIVE_MPD, dropped: [] });
    });

    test('the label is a TIER: two sets sharing value="HD" drop together and report ONCE; other tiers stay', () => {
      // The synthesized five-set shape (the 2026-10 Ultra-HD set/rung count,
      // the trackType labels carried over or guessed — see the fixture): both
      // FLAC rungs ride separate sets under the SAME tier label, and the
      // spatial rung carries its own. Family-scoping the cache was considered
      // and rejected (see mpdDropRenditionGroups) — the refusal is about the tier.
      const { manifest, dropped } = mpdDropRenditionGroups(AMAZON_SYNTHESIZED_FIVE_SET_MPD, ['HD']);
      expect(dropped).toEqual(['HD']);
      const kept = mpdContentProtectionSets(manifest);
      expect(kept.map((s) => s.groupLabel)).toEqual(['LD', 'SD', 'SPATIAL_ATMOS_HIGH']);
      expect(kept.some((s) => s.family === 'flac')).toBe(false); // BOTH FLAC rungs out
      expect(manifest).toContain('value="SPATIAL_ATMOS_HIGH"'); // spatial tier untouched
      expect(manifest).toContain('codecs="ec-3"');
    });

    test('the filter never empties a manifest — an over-eager cache must not unplay a track', () => {
      const { manifest, dropped } = mpdDropRenditionGroups(LIVE_MPD, ['LD', 'SD', 'HD']);
      expect(dropped).toEqual([]);
      expect(manifest).toBe(LIVE_MPD);
      expect(mpdContentProtectionSets(manifest)).toHaveLength(3);
    });

    test('the never-empty guard checks playability, not tag presence: a leftover video set does not count', () => {
      // indexOf("<AdaptationSet") survived this document with EVERY audio set
      // dropped — the engine then dies at "manifest carried no audio variant
      // this build can play". The guard requires a surviving set with actual
      // representations.
      const withVideo = LIVE_MPD.replace('</Period>', '  <AdaptationSet id="9" contentType="video" mimeType="video/mp4">\n    <BaseURL>video/</BaseURL>\n    <SegmentTemplate media="v$Number$.m4s" initialization="v-init.mp4" duration="4" timescale="1"/>\n  </AdaptationSet>\n</Period>');
      expect(mpdContentProtectionSets(withVideo)).toHaveLength(4);
      const { manifest, dropped } = mpdDropRenditionGroups(withVideo, ['LD', 'SD', 'HD']);
      expect(dropped).toEqual([]);
      expect(manifest).toBe(withVideo); // served unfiltered, never audio-less
    });

    test('a VIDEO set with representations does not count as playable audio either', () => {
      // The stronger half of the same guard: a video set is not a substitute for
      // audio, so a manifest left with only video must be served unfiltered.
      const withVideoReps = LIVE_MPD.replace('</Period>', '  <AdaptationSet id="9" contentType="video" mimeType="video/mp4">\n    <Representation id="v1" codecs="avc1.64001f" bandwidth="5200000"/>\n  </AdaptationSet>\n</Period>');
      expect(mpdContentProtectionSets(withVideoReps).map((s) => s.contentType)).toEqual(['audio', 'audio', 'audio', 'video']);
      expect(mpdHasPlayableAudio(withVideoReps)).toBe(true);
      const { manifest, dropped } = mpdDropRenditionGroups(withVideoReps, ['LD', 'SD', 'HD']);
      expect(dropped).toEqual([]);
      expect(manifest).toBe(withVideoReps);
      // And on the audio-less result itself the predicate says no.
      expect(mpdHasPlayableAudio(withVideoReps.replace(/<AdaptationSet id="[123]"[\s\S]*?<\/AdaptationSet>/g, ''))).toBe(false);
    });

    test('mpdHasPlayableAudio: audio sets yes, video only no, untyped sets count', () => {
      expect(mpdHasPlayableAudio(LIVE_MPD)).toBe(true);
      expect(mpdHasPlayableAudio('<MPD><Period><AdaptationSet contentType="audio" mimeType="audio/mp4"><Representation id="a" codecs="opus" bandwidth="53059"/></AdaptationSet></Period></MPD>')).toBe(true);
      expect(mpdHasPlayableAudio('<MPD><Period><AdaptationSet contentType="video"><Representation id="v" codecs="avc1.64001f" bandwidth="1000"/></AdaptationSet></Period></MPD>')).toBe(false);
      // mimeType alone types the set too.
      expect(mpdHasPlayableAudio('<MPD><Period><AdaptationSet mimeType="audio/mp4"><Representation id="a" codecs="opus" bandwidth="53059"/></AdaptationSet></Period></MPD>')).toBe(true);
      // Nothing typed: any set with representations counts (an untyped document
      // must not be treated as unplayable).
      expect(mpdHasPlayableAudio('<MPD><Period><AdaptationSet><Representation id="a" codecs="opus" bandwidth="53059"/></AdaptationSet></Period></MPD>')).toBe(true);
      expect(mpdHasPlayableAudio('<MPD><Period><AdaptationSet contentType="audio"/></AdaptationSet></Period></MPD>')).toBe(false);
      expect(mpdHasPlayableAudio('')).toBe(false);
    });

    test('a nested adaptation set comes back unchanged — never a cut block', () => {
      // DASH AdaptationSetType permits NESTED sets; the old non-greedy match cut
      // the outer block at the INNER close tag, and the vendored Shaka parser
      // rejects that output with "Unexpected close tag" — a hard manifest error
      // instead of a graceful degrade. Matching is innermost-only, so the label
      // on the OUTER set is never even seen — and the pre-rewrite nesting bail
      // answers the document as it arrived, unfiltered.
      const nested = `<MPD minBufferTime="PT2S"><Period id="0">
  <AdaptationSet id="1" contentType="audio" selectionPriority="2000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
    <AdaptationSet id="1a" subsegmentAlignment="true">
      <Representation id="1" codecs="flac" bandwidth="1144652"/>
    </AdaptationSet>
  </AdaptationSet>
  <AdaptationSet id="3" contentType="audio" selectionPriority="500">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
    <Representation id="3" codecs="opus" bandwidth="52988"/>
  </AdaptationSet>
</Period></MPD>`;
      const { manifest, dropped } = mpdDropRenditionGroups(nested, ['HD']);
      expect(manifest).toBe(nested);
      expect(dropped).toEqual([]);
    });

    test('the label on the INNER set bails too — no empty outer shell left behind', () => {
      // The innermost-only match WOULD have removed this block: it removes one
      // open with its close, so the open/close balance guards can never see it —
      // the result is a partially rewritten document with an EMPTY outer
      // <AdaptationSet> where the refused tier used to be. That is not a graceful
      // degrade, so the nesting is answered before any rewrite: byte-identical
      // document, no drop.
      const nestedInner = `<MPD minBufferTime="PT2S"><Period id="0">
  <AdaptationSet id="1" contentType="audio" selectionPriority="2000">
    <AdaptationSet id="1a" subsegmentAlignment="true">
      <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
      <Representation id="1" codecs="flac" bandwidth="1144652"/>
    </AdaptationSet>
  </AdaptationSet>
  <AdaptationSet id="3" contentType="audio" selectionPriority="500">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
    <Representation id="3" codecs="opus" bandwidth="52988"/>
  </AdaptationSet>
</Period></MPD>`;
      const { manifest, dropped } = mpdDropRenditionGroups(nestedInner, ['HD']);
      expect(manifest).toBe(nestedInner); // never a document with an empty outer set
      expect(dropped).toEqual([]);
    });

    test('a self-closing set does not swallow its neighbour', () => {
      // Three opens vs two closes: the old regex started a match AT the
      // self-closing video set and deleted it TOGETHER WITH the following HD
      // set (the block it spanned carried the HD label). An unbalanced document
      // is now served as it arrived.
      const selfClosing = `<MPD minBufferTime="PT2S"><Period id="0">
  <AdaptationSet id="0" contentType="video" mimeType="video/mp4"/>
  <AdaptationSet id="1" contentType="audio" selectionPriority="2000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
    <Representation id="1" codecs="flac" bandwidth="1144652"/>
  </AdaptationSet>
  <AdaptationSet id="2" contentType="audio" selectionPriority="500">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
    <Representation id="2" codecs="opus" bandwidth="52988"/>
  </AdaptationSet>
</Period></MPD>`;
      const { manifest, dropped } = mpdDropRenditionGroups(selfClosing, ['HD']);
      expect(manifest).toBe(selfClosing);
      expect(dropped).toEqual([]);
    });

    test('the attribute reader has a left boundary: subvalue="9" is not value', () => {
      const tricky = `<MPD minBufferTime="PT2S"><Period id="0">
  <AdaptationSet id="1" contentType="audio">
    <SupplementalProperty schemeIdUri="amz-music:trackType" subvalue="9"/>
    <Representation id="1" codecs="opus" bandwidth="52988"/>
  </AdaptationSet>
</Period></MPD>`;
      expect(mpdRenditionGroupLabel(tricky.match(/<AdaptationSet[\s\S]*?<\/AdaptationSet>/)[0])).toBe(null);
      const { manifest, dropped } = mpdDropRenditionGroups(tricky, ['9']);
      expect(dropped).toEqual([]);
      expect(manifest).toBe(tricky);
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

  test('a play needing a fresh session context goes ahead of queued background page flows (the foreground lane)', async () => {
    // New 3 (the #1439 review): the mint rides the FOREGROUND lane of the
    // plugin's two-lane page-flow queue, like a playlist the user opened. A
    // running job is never interrupted (the mint waits for the album lookup
    // in progress); it starts before every QUEUED background job — a play
    // click the user is waiting on must not wait behind every queued spec
    // search, album lookup and recommendations refresh, each a page load
    // that can hold the queue for 15-30s.
    const order = [];
    let releaseFirst;
    const firstLoad = new Promise((resolve) => { releaseFirst = resolve; });
    let seenFirst = false;
    const { ws } = drmMock();
    ws.load.mockImplementation(async (id, url) => {
      order.push(url);
      if (!seenFirst) {
        seenFirst = true; // the RUNNING job: never interrupted
        await firstLoad;
      }
      // Mint-shaped captures answer every load — enough for the mint; the
      // album flows fail structurally on them (irrelevant here: the load
      // ORDER is the point).
      return { success: true, finalUrl: url, captures: [{ url: 'https://gql.music.amazon.com/', method: 'POST', headers: MINT_HEADERS, body: '{}', echo: false }] };
    });
    const resolver = instantiateAmazonPlugin(axe);
    const running = resolver.lookupAlbumFlow('https://music.amazon.com/albums/B000ALBUM1').catch(() => 'album-failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const bg1 = resolver.lookupAlbumFlow('https://music.amazon.com/albums/B000ALBUM2').catch(() => 'album-failed');
    const bg2 = resolver.lookupAlbumFlow('https://music.amazon.com/albums/B000ALBUM3').catch(() => 'album-failed');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const play = resolver.getPlaybackManifest(drmTrack(), {});
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([running, bg1, bg2]);
    const reply = await play;
    expect(reply.manifest).toContain('<MPD'); // the flow completed; the load ORDER is the point
    await flush(); // the fire-and-forget cert warm settles here
    // The mint's load fired before both queued background jobs — behind only
    // the one that was already running.
    expect(order).toEqual([
      'https://music.amazon.com/albums/B000ALBUM1',
      'https://music.amazon.com/search/the/songs',
      'https://music.amazon.com/albums/B000ALBUM2',
      'https://music.amazon.com/albums/B000ALBUM3'
    ]);
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

  // Prime plays the tracks the account bought (#1494), checked against the
  // plugin's own list from the library page, never a flag on the track.
  describe('on Prime', () => {
    const { amazonLibraryPage, serveAmazonLibrary } = require('../helpers/amazon-plugin-bridge');
    const primeWithLibrary = (pages) => {
      const mock = mockWithConfig(configWithTier('PRIME'));
      serveAmazonLibrary(mock.ws, pages || {
        first: amazonLibraryPage([
          { asin: 'B0OWNED001', title: 'Bought', artist: 'A' },
          { asin: 'B0LIKED001', title: 'Liked', artist: 'A', bought: false }
        ])
      });
      return mock;
    };

    test('a bought track plays', async () => {
      const { fetches } = primeWithLibrary();
      const resolver = instantiateAmazonPlugin(axe);
      await expect(resolver.getPlaybackManifest(drmTrack('B0OWNED001'), {})).resolves.toMatchObject({ manifest: expect.any(String) });
      expect(manifestPosts(fetches)).toHaveLength(1);
    });

    test('a track the account only liked, or never bought, is refused before any dmls request', async () => {
      const { fetches } = primeWithLibrary();
      const resolver = instantiateAmazonPlugin(axe);
      for (const asin of ['B0LIKED001', 'B0NEVER001']) {
        const err = await resolver.getPlaybackManifest(drmTrack(asin), {}).catch((e) => e);
        expect(err).toMatchObject({ reason: 'plan-ineligible', planKey: 'prime' });
        expect(err.message).toBe("Amazon Prime: Parachord plays the songs you've bought from Amazon. Playing anything else from Amazon needs Music Unlimited.");
      }
      expect(manifestPosts(fetches)).toHaveLength(0);
    });

    test('a flag on the track is not proof of a purchase', async () => {
      const { fetches } = primeWithLibrary();
      const resolver = instantiateAmazonPlugin(axe);
      const track = { ...drmTrack('B0NEVER001'), amazonPurchased: true, owned: true };
      await expect(resolver.getPlaybackManifest(track, {})).rejects.toMatchObject({ reason: 'plan-ineligible' });
      expect(manifestPosts(fetches)).toHaveLength(0);
    });

    test('a library that cannot be read is "try again", not a plan refusal', async () => {
      const mock = mockWithConfig(configWithTier('PRIME'));
      serveAmazonLibrary(mock.ws, {}, { capture: null });
      const resolver = instantiateAmazonPlugin(axe);
      const err = await resolver.getPlaybackManifest(drmTrack('B0OWNED001'), {}).catch((e) => e);
      expect(err).toMatchObject({ reason: 'not-ready' });
      expect(err.message).toBe("Couldn't read your Amazon purchases. Try again in a minute.");
      expect(manifestPosts(mock.fetches)).toHaveLength(0);
    });
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

// ── the rendition-group refusal cache (#1446, ported to the plugin) ────────
// Live-captured MPD shape: three audio adaptation sets, one Widevine key group
// each, each named by <SupplementalProperty schemeIdUri="amz-music:trackType"
// value="LD|SD|HD"/>. A key group in the manifest is a license request Shaka
// makes whether or not anything selects it — so a refusal only helps if the
// group stops appearing in the manifests the plugin serves.
const GROUP_MPD = `<MPD minBufferTime="PT2S"><Period>
  <AdaptationSet id="1" contentType="audio" selectionPriority="1000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="SD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="a52f9a11-0000-0000-0000-000000000000"/>
    <Representation id="1" codecs="opus" bandwidth="53059"/>
    <Representation id="2" codecs="opus" bandwidth="197343"/>
    <Representation id="3" codecs="opus" bandwidth="325595"/>
  </AdaptationSet>
  <AdaptationSet id="2" contentType="audio" selectionPriority="500">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="LD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="6d02ab22-0000-0000-0000-000000000000"/>
    <Representation id="4" codecs="opus" bandwidth="53059"/>
    <Representation id="5" codecs="opus" bandwidth="165280"/>
  </AdaptationSet>
  <AdaptationSet id="3" contentType="audio" selectionPriority="2000">
    <SupplementalProperty schemeIdUri="amz-music:trackType" value="HD"/>
    <ContentProtection schemeIdUri="urn:mpeg:dash:mp4protection:2011" value="cenc" cenc:default_KID="28ea2833-0000-0000-0000-000000000000"/>
    <Representation id="6" codecs="fLaC" bandwidth="1191000"/>
  </AdaptationSet>
</Period></MPD>`;

describe('the rendition-group refusal cache (the per-track re-request and the start-of-track stutter)', () => {
  const groupEntry = (manifest = GROUP_MPD) => ({ contentResponseStatusCode: 'SUCCESS', manifest, musicDashVersion: 'SIREN_KATANA' });
  const licenseDenial = (denialReason, message) => ({
    status: 400, text: JSON.stringify({ denialReason, message })
  });
  // The plugin sees a refusal only through relayLicense's 400 branch, so the
  // tests drive it directly, each against a fresh mock standing in for the
  // session (the cert warm stays idle — a manifest would otherwise fire its
  // own CAQ= relay into the queue).
  test('a refused group is out of every later manifest this session', async () => {
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry()] }) }
    ] });
    const resolver = instantiateAmazonPlugin(axe);
    resolver._certSessionReady = true; // keep the cert warm idle
    const first = await resolver.getPlaybackManifest(drmTrack(), {});
    expect(first.protectionSets.map((s) => s.groupLabel)).toEqual(['SD', 'LD', 'HD']);

    // The live Linux dev-VMP shape: two refusals per play, ~1.4s in, for the
    // SD and HD groups, while LD keys fine and is what plays.
    drmMock({ dmls: [licenseDenial('VMP_VALIDATION_FAILED', 'UNVERIFIED request not eligible for SD content (EligibilityException VMP_VALIDATION_FAILED)')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'SD', licenseDenied: false });
    drmMock({ dmls: [licenseDenial('VMP_VALIDATION_FAILED', 'UNVERIFIED request not eligible for HD content (EligibilityException VMP_VALIDATION_FAILED)')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'HD' });
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ SD: 'build-refused', HD: 'build-refused' });

    // Track 2: the refused groups never reach the player, so no init segment,
    // no license round-trip and no buffered-then-discarded chunk for them.
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry()] }) }
    ] });
    const reply = await resolver.getPlaybackManifest(drmTrack('B2'), {});
    expect(reply.protectionSets.map((s) => s.groupLabel)).toEqual(['LD']);
    expect(reply.manifest).not.toContain('value="SD"');
    expect(reply.manifest).not.toContain('fLaC');
    expect(reply.manifest).toContain('value="LD"');
  });

  test('an eligibility refusal is the account\'s (cleared on the sign-out generation drop); an unverified request is the build\'s', async () => {
    const resolver = instantiateAmazonPlugin(axe);
    // The production order: the manifest flow's mint records the plan reading
    // BEFORE any licence refusal can be recorded, so a refusal never sits in
    // the cache ahead of a first plan reading (whose unlimited-turn clear
    // would otherwise wipe it — an artifact, not the upgrade path).
    drmMock({});
    await resolver.getPlan();
    drmMock({ dmls: [licenseDenial('CUSTOMER_NOT_ELIGIBLE', 'customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'HD' });
    drmMock({ dmls: [licenseDenial('VMP_VALIDATION_FAILED', 'UNVERIFIED request not eligible for SD content')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'SD' });
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ HD: 'license-denied', SD: 'build-refused' });
    // The sign-out the plugin cannot see the event of: the generation bump on
    // the next state read drops the account-scoped entries and keeps the
    // build-scoped ones (another account changes nothing about this build's
    // VMP signature).
    const gen1 = drmMock({ generation: 1 });
    await resolver.sessionState();
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ SD: 'build-refused' });
  });

  test('a refusal without a group phrase changes nothing (no filtering, no crash)', async () => {
    const resolver = instantiateAmazonPlugin(axe);
    drmMock({ dmls: [licenseDenial('REGION_NOT_SUPPORTED', 'content is not available here')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: null });
    expect(resolver._refusedGroups).toBeUndefined();
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry()] }) }
    ] });
    const reply = await resolver.getPlaybackManifest(drmTrack('B3'), {});
    expect(reply.protectionSets.map((s) => s.groupLabel)).toEqual(['SD', 'LD', 'HD']);
  });

  test('every group refused: the manifest is served unfiltered rather than unplayable', async () => {
    const resolver = instantiateAmazonPlugin(axe);
    resolver._refusedGroups = new Map([['LD', 'build-refused'], ['SD', 'build-refused'], ['HD', 'build-refused']]);
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry()] }) }
    ] });
    const reply = await resolver.getPlaybackManifest(drmTrack('B4'), {});
    expect(reply.protectionSets.map((s) => s.groupLabel)).toEqual(['SD', 'LD', 'HD']);
  });

  test('an unrecognized refusal reason records NOTHING — never even an account-scoped entry', async () => {
    // A per-content refusal ("this title isn't licensed in HD") must not take
    // the tier away for the session: only a reason the scope positively
    // recognizes may be cached at all, and this one is not.
    const resolver = instantiateAmazonPlugin(axe);
    drmMock({ dmls: [licenseDenial('SOME_FUTURE_REASON', 'this title is not eligible for HD content')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'HD' });
    expect(resolver._refusedGroups).toBeUndefined();
    const gen1 = drmMock({ generation: 1 });
    await resolver.sessionState();
    expect(resolver._refusedGroups).toBeUndefined();
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry()] }) }
    ] });
    const reply = await resolver.getPlaybackManifest(drmTrack('B5'), {});
    expect(reply.protectionSets.map((s) => s.groupLabel)).toEqual(['SD', 'LD', 'HD']);
  });

  test('a certificate-class refusal records no group at all', async () => {
    // A cert refusal means NO license works on this build — caching group
    // labels from it would be noise, so the cert branch throws before the
    // refusal cache is ever reached.
    const resolver = instantiateAmazonPlugin(axe);
    drmMock({ dmls: [licenseDenial('DEVELOPMENT_CERTIFICATE_NOT_ALLOWED', 'development VMP certificate not allowed - not eligible for HD content')] });
    const certErr = await resolver.relayLicense('CAQ=').catch((e) => e);
    expect(certErr).toMatchObject({ licenseDenied: true });
    expect(certErr.groupLabel).toBeUndefined();
    expect(resolver._refusedGroups).toBeUndefined();
  });

  test('a group label can never come from the CustomerEligibility PII dump', async () => {
    // The label is read from licenseDenialSummary's first sentence, never the
    // raw message: this refusal's "not eligible for HD" sits only inside the
    // `CustomerEligibility(customerId=…)` tail, so nothing is recorded.
    const resolver = instantiateAmazonPlugin(axe);
    drmMock({ dmls: [licenseDenial('SOME_FUTURE_REASON', 'sorry - CustomerEligibility(customerId=X, note=not eligible for HD content)')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: null });
    expect(resolver._refusedGroups).toBeUndefined();
  });

  test('a later account-shaped refusal never DOWNGRADES a build-scoped label', async () => {
    // The cache entry's scope is a claim about WHY the key was refused, and
    // 'build-refused' survives sign-out. Overwriting it with a later refusal's
    // account-shaped reason would hand the refused group back to every manifest
    // after the next sign-in, which is exactly what the entry exists to stop.
    const resolver = instantiateAmazonPlugin(axe);
    drmMock({}); // the production order: the plan reading precedes any refusal
    await resolver.getPlan();
    drmMock({ dmls: [licenseDenial('CUSTOMER_NOT_ELIGIBLE', 'this title is not eligible for HD content')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'HD' });
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ HD: 'license-denied' });
    // A positive build signal still upgrades the entry (account → build).
    drmMock({ dmls: [licenseDenial('VMP_VALIDATION_FAILED', 'UNVERIFIED request not eligible for HD content')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'HD' });
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ HD: 'build-refused' });
    // And back down it must not go.
    drmMock({ dmls: [licenseDenial('CUSTOMER_NOT_ELIGIBLE', 'this title is not eligible for HD content')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: 'HD' });
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ HD: 'build-refused' });
    const gen1 = drmMock({ generation: 1 });
    await resolver.sessionState();
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ HD: 'build-refused' });
  });

  test('a build sentence the summary cut away records no label (documented, not filtered)', async () => {
    // The label comes from licenseDenialSummary's FIRST SENTENCE (a label mined
    // from the PII tail would be worse than none), and that slice stops at " - ";
    // a refusal that puts its `UNVERIFIED request not eligible for HD content`
    // sentence after the separator therefore caches NOTHING, even though the
    // refusal's scope — read from the raw message — is build-scoped. The
    // manifest stays unfiltered rather than filtering on a guessed label.
    const resolver = instantiateAmazonPlugin(axe);
    drmMock({ dmls: [licenseDenial('VMP_VALIDATION_FAILED', 'Amazon could not license this title - UNVERIFIED request not eligible for HD content (EligibilityException VMP_VALIDATION_FAILED)')] });
    await expect(resolver.relayLicense('CAQ=', {})).rejects.toMatchObject({ groupLabel: null, denialReason: 'VMP_VALIDATION_FAILED' });
    expect(resolver._refusedGroups).toBeUndefined();
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry()] }) }
    ] });
    const reply = await resolver.getPlaybackManifest(drmTrack('B6'), {});
    expect(reply.protectionSets.map((s) => s.groupLabel)).toEqual(['SD', 'LD', 'HD']);
  });

  test('a plan reading turning unlimited clears the account-scoped labels; a re-read clears nothing', async () => {
    // On this stack a Prime account never reaches a licence (assertPlanPlays
    // refuses first), so the reachable path is unlimited → unknown (a bad
    // reply on a scheduled re-read) → unlimited — the return to unlimited is
    // the moment the old refusals must not outlive.
    const resolver = instantiateAmazonPlugin(axe);
    resolver._refusedGroups = new Map([['HD', 'license-denied'], ['SD', 'build-refused']]);
    const prime = drmMock({ tier: 'PRIME' });
    await resolver.getPlan({ refresh: true });
    expect(resolver._planState.plan).toBe('prime');
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ HD: 'license-denied', SD: 'build-refused' });
    // The upgrade: an unlimited reading clears the account-scoped label and
    // keeps the build-scoped one.
    const unlimited = drmMock({ tier: 'UNLIMITED_HD' });
    await resolver.getPlan({ refresh: true });
    expect(resolver._planState.plan).toBe('unlimited');
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ SD: 'build-refused' });
    // A RE-read of an already-unlimited plan is not a turn: it clears nothing.
    resolver._refusedGroups.set('HD', 'license-denied');
    await resolver.getPlan({ refresh: true });
    expect(Object.fromEntries(resolver._refusedGroups)).toEqual({ SD: 'build-refused', HD: 'license-denied' });
  });

  test('only the groups a refusal named leave the manifest — other tiers ride on', async () => {
    // The synthesized five-set shape (LD, SD, TWO sets sharing the HD tier, a
    // spatial tier of its own — see tests/test-utils/amazon-live-mpd.js): a
    // refused HD drops both FLAC sets and touches nothing else. The drop is
    // per TIER — family-scoping the cache was considered and rejected.
    const { AMAZON_SYNTHESIZED_FIVE_SET_MPD } = require('../test-utils/amazon-live-mpd');
    const resolver = instantiateAmazonPlugin(axe);
    resolver._refusedGroups = new Map([['HD', 'build-refused']]);
    drmMock({ dmls: [
      { status: 200, text: JSON.stringify({ contentResponseList: [groupEntry(AMAZON_SYNTHESIZED_FIVE_SET_MPD)] }) }
    ] });
    const reply = await resolver.getPlaybackManifest(drmTrack('B5'), {});
    expect(reply.protectionSets.map((s) => s.groupLabel)).toEqual(['LD', 'SD', 'SPATIAL_ATMOS_HIGH']);
    expect(reply.manifest).toContain('value="SPATIAL_ATMOS_HIGH"');
    expect(reply.manifest).not.toContain('codecs="flac"');
  });
});
