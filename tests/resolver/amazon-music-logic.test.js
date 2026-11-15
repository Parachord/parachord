const {
  amazonDmlsRegion,
  licenseDenialSummary,
  amazonDmlsManifestBody,
  amazonDmlsLicenseBody,
  dashCodecFamily,
  WIDEVINE_CERT_CHALLENGE,
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  cdmStatusHealthy,
  pageBlocksPlayback,
  signInLanded,
  amazonAuthCookieState,
  AMAZON_QUALITY_OPTIONS,
  asinFromPlayerUrl,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  stripAmazonTitleMarker,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
  SPEC_TEMPLATE_MAX_AGE_MS,
  makeSpecSearchTemplate,
  specTemplateIsFresh,
  recommendationItemFromGqlNode,
  amazonMusicHomeRequest,
  recommendationsFromMusicHome,
  musicHomeBodyWithVars,
  mergeMusicHomeSectionPages,
  seeMoreSectionIdFor,
  amazonSeeMoreRequest,
  recommendationStrategyId,
  amazonSeeMorePageUrl,
  seeMoreBodyWithVars,
  recommendationsFromSeeMore,
  isAmazonMusicPage,
  amazonNativeSessionFromConfig,
  isUnlimitedTier,
  amazonPlanFromTier,
  amazonPlanMessage
} = require('../../amazon-music-logic');

// #1220: only Music Unlimited plays; Prime and anything unreadable block.
describe('Amazon plan from config.json tier', () => {
  test.each([
    ['UNLIMITED', 'unlimited'],
    ['UNLIMITED_HD', 'unlimited'],
    [' unlimited_hd ', 'unlimited'],
    ['PRIME', 'prime'],
    ['prime', 'prime'],
    ['PRIME_PLUS', 'unknown'],
    ['FREE', 'unknown'],
    ['', 'unknown'],
    [null, 'unknown'],
    [undefined, 'unknown'],
    [{ name: 'UNLIMITED' }, 'unknown'] // the raw object; amazonNativeSessionFromConfig unwraps it first
  ])('%p → %s', (tier, plan) => {
    expect(amazonPlanFromTier(tier)).toBe(plan);
  });

  test('an object-shaped tier is unwrapped by the config parser', () => {
    expect(amazonPlanFromTier(amazonNativeSessionFromConfig({ tier: { name: 'UNLIMITED_HD' } }).tier)).toBe('unlimited');
    expect(amazonPlanFromTier(amazonNativeSessionFromConfig({ tier: { tier: 'PRIME' } }).tier)).toBe('prime');
    expect(amazonPlanFromTier(amazonNativeSessionFromConfig({}).tier)).toBe('unknown');
  });

  test('telemetry and the gate share one Unlimited rule', () => {
    expect(isUnlimitedTier('UNLIMITED_HD')).toBe(true);
    expect(isUnlimitedTier('PRIME')).toBe(false);
    expect(isUnlimitedTier(null)).toBe(false);
  });

  test('one wording per blocked plan; none for Unlimited', () => {
    expect(amazonPlanMessage('prime')).toBe('Amazon Prime: Amazon is used for album art, artist photos and links. Playing Amazon tracks in Parachord needs Music Unlimited.');
    expect(amazonPlanMessage('unknown')).toMatch(/^Parachord couldn't confirm your Amazon Music plan, so Amazon playback is off until it can\./);
    expect(amazonPlanMessage('unlimited')).toBeNull();
  });
});

// The replay-first template: one captured spec-search request serves every
// later search with patched variables (see "Spec-search request templates"
// in amazon-music-logic.js). The template and the gate are what let gql
// searches run without a page load and in parallel.
describe('spec-search templates', () => {
  const capture = (over = {}) => ({
    url: 'https://gql.music.amazon.com/',
    headers: { 'x-api-key': 'key', 'csrf-token': 'tok', Cookie: 'session' },
    body: {
      operationName: 'SpecSearchSeeMorePage',
      variables: { searchText: '"daft punk"', specType: 'track', firstLimit: 30, isAuthenticated: true },
      extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'abc123' } }
    },
    ...over
  });

  test('makeSpecSearchTemplate keeps url/headers/body/capturedAt, deep-cloned', () => {
    const { url, headers, body } = capture();
    const t = makeSpecSearchTemplate({ url, headers, body, capturedAt: 123 });
    expect(t.capturedAt).toBe(123);
    expect(t.url).toBe(url);
    expect(t.body).toEqual(body);
    // Deep clone: mutating the capture cannot alias into the stored template.
    body.variables.searchText = 'MUTATED';
    headers['x-api-key'] = 'MUTATED';
    expect(t.body.variables.searchText).toBe('"daft punk"');
    expect(t.headers['x-api-key']).toBe('key');
  });

  test('makeSpecSearchTemplate refuses request shapes a replay cannot use', () => {
    expect(makeSpecSearchTemplate({ url: null, headers: {}, body: {} })).toBeNull();
    expect(makeSpecSearchTemplate({ url: 'https://x', headers: {}, body: {} })).toBeNull();
    const noHash = capture().body;
    delete noHash.extensions.persistedQuery;
    expect(makeSpecSearchTemplate({ url: 'https://x', headers: {}, body: noHash })).toBeNull();
    const noVars = capture().body;
    noVars.variables = 'nope';
    expect(makeSpecSearchTemplate({ url: 'https://x', headers: {}, body: noVars })).toBeNull();
  });

  test('specTemplateIsFresh gates on shape and the age cap', () => {
    const { url, headers, body } = capture();
    const t = makeSpecSearchTemplate({ url, headers, body, capturedAt: 1_000_000 });
    expect(specTemplateIsFresh(t, 1_000_000 + 1000)).toBe(true);
    expect(specTemplateIsFresh(t, 1_000_000 + SPEC_TEMPLATE_MAX_AGE_MS - 1)).toBe(true);
    expect(specTemplateIsFresh(t, 1_000_000 + SPEC_TEMPLATE_MAX_AGE_MS)).toBe(false);
    expect(specTemplateIsFresh(null)).toBe(false);
    expect(specTemplateIsFresh({})).toBe(false);
    expect(specTemplateIsFresh({ ...t, url: '' })).toBe(false);
    expect(specTemplateIsFresh({ ...t, headers: null })).toBe(false);
    expect(specTemplateIsFresh({ ...t, body: null })).toBe(false);
  });


});

describe('reportedPlaybackAsin', () => {
  test('the page URL wins over a disagreeing mini player', () => {
    // A stale or "up next" mini-player row used to outrank the document we
    // actually loaded, and the track-changed branch skipped the track.
    expect(reportedPlaybackAsin({
      playingAsin: 'B0NEXTUP01',
      href: 'https://music.amazon.com/tracks/B0PLAYING1?do=play'
    })).toBe('B0PLAYING1');
  });

  test('the mini player is the fallback when the URL carries no ASIN', () => {
    expect(reportedPlaybackAsin({
      playingAsin: 'B0MINIROW1',
      href: 'https://music.amazon.com/queue'
    })).toBe('B0MINIROW1');
    expect(reportedPlaybackAsin({
      href: 'https://music.amazon.com/tracks/B0URLTRACK?do=play'
    })).toBe('B0URLTRACK');
  });

  test('does not echo the ASIN we asked to play when the page has none', () => {
    expect(reportedPlaybackAsin({ href: 'https://music.amazon.com/', expectedAsin: 'B0ASKED' })).toBeNull();
    expect(reportedPlaybackAsin(null)).toBeNull();
  });
});

describe('shouldRevealPlayerOnFailure', () => {
  test('a playback miss never reveals the player, including during radio', () => {
    expect(shouldRevealPlayerOnFailure({ advancing: true })).toBe(false);
    expect(shouldRevealPlayerOnFailure({ advancing: false, licenseDenied: false })).toBe(false);
  });
});

describe('pageBlocksPlayback', () => {
  test('profile picker and sign-in are not a finished session', () => {
    expect(pageBlocksPlayback('https://music.amazon.com/identity/who-is-listening')).toBe('not-signed-in');
    expect(pageBlocksPlayback('https://www.amazon.com/ap/signin?openid.return_to=music')).toBe('not-signed-in');
  });

  test('the player home is usable', () => {
    expect(pageBlocksPlayback('https://music.amazon.com/')).toBeNull();
    expect(pageBlocksPlayback('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
  });
  test('every step of the Amazon sign-in portal is a wall, 2FA included', () => {
    const rt = '?openid.return_to=https%3A%2F%2Fmusic.amazon.com%2F';
    for (const path of ['/ap/mfa', '/ap/cvf/approval', '/ap/cvf/request', '/ap/challenge', '/ap/accountfixup']) {
      expect(pageBlocksPlayback(`https://www.amazon.com${path}${rt}`)).toBe('not-signed-in');
    }
    expect(pageBlocksPlayback('https://www.amazon.co.uk/ap/mfa?arb=x')).toBe('not-signed-in');
    expect(pageBlocksPlayback('https://music.amazon.com/albums/B0AP123')).toBeNull();
  });

});

describe('cdmStatusHealthy', () => {
  test('a healthy component status is healthy', () => {
    expect(cdmStatusHealthy({ widevine: { status: 'ok', version: '4.1' } })).toBe(true);
  });

  test('a failed component status is not', () => {
    expect(cdmStatusHealthy({ widevine: { status: 'failed' } })).toBe(false);
    expect(cdmStatusHealthy({ components: [{ name: 'widevine', status: 'component_update_error' }] })).toBe(false);
  });

  test('an unrelated "failed" string does not disable the CDM', () => {
    // The old check substring-matched the whole JSON blob.
    expect(cdmStatusHealthy({
      widevine: { status: 'ok' },
      notes: 'update-check-url https://example.com/failed-check'
    })).toBe(true);
  });

  test('empty status means nothing installed; unknown shapes are optimistic', () => {
    expect(cdmStatusHealthy({})).toBe(false);
    expect(cdmStatusHealthy({ something: { else: true } })).toBe(true);
    expect(cdmStatusHealthy(null)).toBe(true);
  });

  test('survives deep nesting and cycles', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: { status: 'failed' } } } } } } } };
    expect(cdmStatusHealthy(deep)).toBe(false);
    const cyclic = { widevine: { status: 'ok' } };
    cyclic.self = cyclic;
    expect(cdmStatusHealthy(cyclic)).toBe(true);
  });
});

describe('signInLanded', () => {
  const home = 'https://music.amazon.com/';
  const track = 'https://music.amazon.com/tracks/B000SNWG5Q';

  test('a stable non-wall page with an auth cookie lands', () => {
    let v = signInLanded({ url: home, hasCookie: true });
    expect(v).toEqual({ landed: false, stableTicks: 1 });
    v = signInLanded({ url: home, lastUrl: home, stableTicks: v.stableTicks, hasCookie: true });
    expect(v).toEqual({ landed: true, stableTicks: 2 });
  });

  test('the bare home path without a cookie waits a third tick', () => {
    // A logged-out first paint at / (or a slow redirect to /ap/signin) must
    // not close the sign-in window and report success.
    let v = signInLanded({ url: home, hasCookie: false });
    v = signInLanded({ url: home, lastUrl: home, stableTicks: v.stableTicks, hasCookie: false });
    expect(v.landed).toBe(false);
    v = signInLanded({ url: home, lastUrl: home, stableTicks: v.stableTicks, hasCookie: false });
    expect(v.landed).toBe(true); // rotation fallback: nothing but stability
  });

  test('a page off the home path lands after two stable ticks without a cookie', () => {
    let v = signInLanded({ url: track, hasCookie: false });
    v = signInLanded({ url: track, lastUrl: track, stableTicks: v.stableTicks, hasCookie: false });
    expect(v.landed).toBe(true);
  });

  test('walls, foreign URLs and navigation churn reset the stability count', () => {
    // A wall URL never lands, cookies or not — the profile is not chosen yet.
    expect(signInLanded({
      url: 'https://music.amazon.com/identity/who-is-listening',
      lastUrl: 'https://music.amazon.com/identity/who-is-listening',
      stableTicks: 5, hasCookie: true
    })).toEqual({ landed: false, stableTicks: 0 });
    // Off amazon.com (password step) resets too.
    expect(signInLanded({
      url: 'https://www.amazon.com/ap/signin', lastUrl: 'https://www.amazon.com/ap/signin',
      stableTicks: 5, hasCookie: true
    })).toEqual({ landed: false, stableTicks: 0 });
    // A URL that changed this tick is not stable yet.
    expect(signInLanded({ url: track, lastUrl: home, stableTicks: 3, hasCookie: true }))
      .toEqual({ landed: false, stableTicks: 1 });
  });
});


// Samples as the poller records them: consecutive PLAYING reads of the
// media element's decode counter. kbps over stepMs: 850 kbps at 2s pairs is
// 212500 bytes per pair.
const qualitySample = (wallMs, positionMs, bytes) => ({ wallMs, positionMs, bytes });
const steadySamples = (count, { startWallMs = 0, startPositionMs = 0, startBytes = 0, stepMs = 2000, kbps = 850 } = {}) => {
  const out = [];
  for (let i = 0; i <= count; i++) {
    out.push(qualitySample(
      startWallMs + i * stepMs,
      startPositionMs + i * stepMs,
      startBytes + Math.round((kbps * stepMs / 8) * i)
    ));
  }
  return out;
};


const ladderMpd = `<?xml version="1.0" encoding="utf-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static">
  <BaseURL>https://cdn.example.com/dash/</BaseURL>
  <Period>
    <AdaptationSet contentType="audio" mimeType="audio/mp4">
      <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
      <SegmentTemplate timescale="44100" initialization="$RepresentationID$/init.mp4?token=a&amp;b" media="$RepresentationID$/$Number$.m4s"/>
      <Representation id="B0HD441" codecs="fLaC" bandwidth="850000" audioSamplingRate="44100"/>
      <Representation id="B0UHD48-24bit" codecs="fLaC" bandwidth="1478000" audioSamplingRate="48000"/>
    </AdaptationSet>
    <AdaptationSet contentType="video" mimeType="video/mp4">
      <Representation id="v1" codecs="avc1.640028" bandwidth="2000000"/>
    </AdaptationSet>
  </Period>
</MPD>`;

// window.__r is Metro's require. The trap observes requires Amazon's own
// code makes — it never calls __r itself.
const makeMetroScope = () => {
  const scope = {};
  scope.require = (id) => {
    if (id === 123) return { playbackController: { audioQualitySettings: { streamingQuality: 'STANDARD', abrEnabled: true } } };
    if (id === 456) return { other: true };
    throw new Error(`Requiring unknown module "${id}"`);
  };
  return scope;
};


// Real localStorage exposes stored entries as enumerable own properties,
// which is how the helpers find the playback-controller key. Model that.
const makeStorage = (initial) => {
  const storage = {};
  for (const [k, v] of Object.entries(initial || {})) storage[k] = String(v);
  Object.defineProperty(storage, 'getItem', { value: (k) => (k in storage ? storage[k] : null), enumerable: false });
  Object.defineProperty(storage, 'setItem', { value: (k, v) => { storage[k] = String(v); }, enumerable: false });
  return storage;
};

const playbackControllerEntry = (quality) => JSON.stringify({
  data: { audioQualitySettings: quality, unrelated: { keep: true } }
});

describe('asinFromPlayerUrl', () => {
  test('reads the playing track ASIN from the player URL', () => {
    expect(asinFromPlayerUrl('https://music.amazon.com/tracks/B000SNWG5Q?do=play')).toBe('B000SNWG5Q');
    expect(asinFromPlayerUrl('https://music.amazon.com/')).toBeNull();
    expect(asinFromPlayerUrl('')).toBeNull();
  });
});

// (The playlist-import parsers — amazonPlaylistIdFromUrl,
// amazonPlaylistDetailRequest, playlistTrackFromGqlEdge, playlistFromGql,
// playlistPageInfoFromGql, playlistEdgesFromGql and the pagination loop
// paginatePlaylistTracks — were pinned here until #1356 M7 moved the flow
// into the plugin; their cases now drive the _lib copies in
// tests/resolver/amazon-music-plugin-playlist.test.js.)

// The search request the songs page fires (live-captured 2026-10, hornet
// 1.18x): SpecSearchSeeMorePage, specType track, our exact searchText, an APQ
// hash that renumbers per hornet redeploy. The parser matches on
// variables.searchText, never the operationName.


// The breaker bounds the damage of a hornet rename: without it every search
// burns the full capture window and fails not-ready, serially on the search
// chain — a resolution run of 100 tracks spends ~25 minutes there and starves
// playlist imports too.

describe('capturedOperationNames', () => {
  test('lists the distinct gql operations the page fired, for the miss log', () => {
    const bodies = [
      JSON.stringify({ operationName: 'playlistDetail', variables: { id: 'PP1' } }),
      JSON.stringify([{ operationName: 'bootstrap' }, { operationName: 'playlistDetail', variables: { id: 'PP2' } }]),
      'not json',
      JSON.stringify({ noOperationName: true })
    ];
    expect(capturedOperationNames(bodies)).toEqual(['playlistDetail', 'bootstrap']);
    expect(capturedOperationNames([])).toEqual([]);
    expect(capturedOperationNames(null)).toEqual([]);
  });
});

describe('amazonGqlFetchHeaders', () => {
  test('keeps the gql auth headers and drops browser-managed ones', () => {
    const headers = amazonGqlFetchHeaders({
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
    expect(amazonGqlFetchHeaders(null)).toEqual({});
  });
});

describe('stripAmazonTitleMarker', () => {
  test('strips a trailing bracketed or parenthesized explicit marker, any case', () => {
    expect(stripAmazonTitleMarker('Kunnioita [Explicit]')).toEqual({ title: 'Kunnioita', explicit: true });
    expect(stripAmazonTitleMarker('Song (explicit)')).toEqual({ title: 'Song', explicit: true });
    expect(stripAmazonTitleMarker('Song [EXPLICIT]')).toEqual({ title: 'Song', explicit: true });
    expect(stripAmazonTitleMarker('Song[Explicit]')).toEqual({ title: 'Song', explicit: true });
  });

  test('leaves real titles alone — the bare word and parenthesized non-markers are title text', () => {
    expect(stripAmazonTitleMarker('Sexually Explicit')).toEqual({ title: 'Sexually Explicit', explicit: false });
    expect(stripAmazonTitleMarker('Explicit Content')).toEqual({ title: 'Explicit Content', explicit: false });
    expect(stripAmazonTitleMarker('Metal Health (Bang Your Head)')).toEqual({ title: 'Metal Health (Bang Your Head)', explicit: false });
    expect(stripAmazonTitleMarker('[Explicit] Content')).toEqual({ title: '[Explicit] Content', explicit: false });
  });
});

// (The playlist edge mapper and data.playlist parser cases —
// playlistFromGql / playlistPageInfoFromGql / playlistEdgesFromGql and the
// pagination loop paginatePlaylistTracks — were pinned here until #1356 M7
// moved the playlist import into the plugin; their cases now drive the _lib
// copies in tests/resolver/amazon-music-plugin-playlist.test.js.)

describe('isAmazonMusicPage', () => {
  test('only the music.amazon.com origin is the playlist page', () => {
    expect(isAmazonMusicPage('https://music.amazon.com/playlists/PP1')).toBe(true);
    expect(isAmazonMusicPage('https://music.amazon.com/ap/signin')).toBe(true);
    expect(isAmazonMusicPage('https://evil.example/playlists/PP1')).toBe(false);
    expect(isAmazonMusicPage('https://music.amazon.com.evil.example/')).toBe(false);
    expect(isAmazonMusicPage('not a url')).toBe(false);
  });
});

describe('amazon halt pause guard', () => {
  test('a generation-scoped pause no-ops unless the page token matches', () => {
    const expr = amazonMediaPauseExpr(3);
    expect(expr).toContain('window.__parachordPlayGen !== 3');
    expect(expr).toContain('return { ok: false, superseded: true }');
    expect(expr).toContain('m.pause()');
  });

  test('a user pause is unguarded', () => {
    expect(amazonMediaPauseExpr()).toBe('m.pause();');
    expect(amazonMediaPauseExpr(undefined)).toBe('m.pause();');
    expect(amazonMediaPauseExpr(NaN)).toBe('m.pause();');
  });

  test('the stamp is an integer assignment, not interpolated caller text', () => {
    expect(amazonPlayGenerationStamp(4)).toBe('window.__parachordPlayGen = 4;');
    expect(amazonPlayGenerationStamp(4.9)).toBe('window.__parachordPlayGen = 4;');
  });
});




// The album-detail request the album page fires (live-captured 2026-10):
// AlbumDetailPage, variables.id = the ASIN, an APQ hash that renumbers per
// hornet redeploy.

// The album-spec SpecSearchSeeMorePage response (live-captured 2026-10, the
// "wild pink" search): edges under data.specificationSearch.result[] whose
// node is an ALBUM entity (id/title/shortTitle/contributingArtists/images/url
// — no releaseDate or trackCount in the search spec).

// The artists tab (/search/<q>/artists — plural; the singular /artist path
// fires nothing matchable) fires SpecSearchSeeMorePage with
// variables.specType 'artist' (live-verified 2026-10 via
// amazonmusic-debug-capture-gql and a specSearch probe), and its bucket is
// labeled 'requiredButUnused' — the same label the album bucket uses.


// The artist-spec SpecSearchSeeMorePage response (shape live-verified
// 2026-10, the "warning" search): edges[].node = Artist with id/name/images
// (imageType PROFILE or BACKGROUND — artists have no PRIMARY) /url — and the
// ranking is Amazon's: 'warning' leads with 'The Warning'.


// The AlbumDetailPage response (live-captured 2026-10 for Master of Puppets /
// S&M2 / Enema Of The State): data.album with the full title, trackCount,
// releaseDate, images; tracksConnection.edges[] with NO pageInfo (a 100-track
// album answered whole), per-disc trackNumbers (1..n, 1..m) and no discNumber
// field anywhere.




// The real variant table observed live 2026-10 for an HD-tier account (Get
// Lucky): three opus plus two FLAC renditions across five adaptation sets.
const LIVE_REPS = [
  { id: '0', codec: 'opus', bandwidth: 53059, sampleRate: 48000, channels: 2, bitDepth: null },
  { id: '1', codec: 'opus', bandwidth: 197343, sampleRate: 48000, channels: 2, bitDepth: null },
  { id: '2', codec: 'opus', bandwidth: 325595, sampleRate: 48000, channels: 2, bitDepth: null },
  { id: '3', codec: 'opus', bandwidth: 53059, sampleRate: 48000, channels: 2, bitDepth: null },
  { id: '4', codec: 'opus', bandwidth: 165280, sampleRate: 48000, channels: 2, bitDepth: null },
  { id: '5', codec: 'flac', bandwidth: 1062133, sampleRate: 44100, channels: 2, bitDepth: 16 },
  { id: '6', codec: 'flac', bandwidth: 1902230, sampleRate: 44100, channels: 2, bitDepth: 24 },
  // Spatial/Atmos renditions ride the SAME manifest (observed live) —
  // Chromium cannot decode AC-4/MPEG-H, so they must never be selected.
  { id: '8', codec: 'mha1.0x0e', bandwidth: 1612557, sampleRate: 48000, channels: null, bitDepth: null },
  { id: '12', codec: 'mhm1.0x0e', bandwidth: 1610228, sampleRate: 48000, channels: null, bitDepth: null }
];

describe('amazonDmlsRegion', () => {
  test('maps territories to the dmls region segment', () => {
    expect(amazonDmlsRegion('US')).toBe('NA');
    expect(amazonDmlsRegion('BR')).toBe('NA');
    expect(amazonDmlsRegion('DE')).toBe('EU');
    expect(amazonDmlsRegion('GB')).toBe('EU');
    expect(amazonDmlsRegion('JP')).toBe('FE');
    expect(amazonDmlsRegion('AU')).toBe('FE');
    expect(amazonDmlsRegion(null)).toBe('NA');
  });
});

describe('amazonDmlsManifestBody', () => {
  const base = { asin: 'B00CRMX53S', customerId: 'CUST', marketplaceId: 'ATVPDKIKX0DER', territoryId: 'US', deviceId: '123', musicAgent: 'Agent/1.0' };
  test('builds the captured shape', () => {
    const body = amazonDmlsManifestBody(base);
    expect(body.contentIdList).toEqual([{ identifier: 'B00CRMX53S', identifierType: 'ASIN' }]);
    expect(body.deviceToken).toEqual({ deviceTypeId: 'A16ZV8BU3SN1N3', deviceId: '123' });
    expect(body.customerId).toBe('CUST');
    expect(body.customerInfo).toEqual({ marketplaceId: 'ATVPDKIKX0DER', territoryId: 'US' });
    expect(body.musicDashVersionList).toEqual(['SIREN_KATANA']);
    expect(body.contentProtectionList).toEqual(['TRACK_PSSH']);
    expect(body.tryAsinSubstitution).toBe(true);
    expect(body.appInfo).toEqual({ musicAgent: 'Agent/1.0' });
  });
  test('null without required identifiers', () => {
    expect(amazonDmlsManifestBody({ ...base, asin: null })).toBeNull();
    expect(amazonDmlsManifestBody({ ...base, customerId: null })).toBeNull();
    expect(amazonDmlsManifestBody({ ...base, deviceId: null })).toBeNull();
  });
});

describe('amazonDmlsLicenseBody', () => {
  test('builds the Widevine relay shape, cert challenge included', () => {
    const body = amazonDmlsLicenseBody({ challenge: WIDEVINE_CERT_CHALLENGE, customerId: 'CUST', deviceId: '123', musicAgent: 'Agent/1.0' });
    expect(body.DrmType).toBe('WIDEVINE');
    expect(body.licenseChallenge).toBe('CAQ=');
    expect(body.customerId).toBe('CUST');
    expect(body.deviceToken.deviceId).toBe('123');
    expect(amazonDmlsLicenseBody({ challenge: null, customerId: 'C', deviceId: 'D' })).toBeNull();
  });
});

describe('dashCodecFamily', () => {
  test('buckets codec strings', () => {
    expect(dashCodecFamily('flac')).toBe('flac');
    expect(dashCodecFamily('opus')).toBe('opus');
    expect(dashCodecFamily('mp4a.40.2')).toBe('aac');
  });
});

describe('amazonAuthCookieState', () => {
  test('the auth cookies isSignedIn has always keyed on are known', () => {
    expect(amazonAuthCookieState(['session-id', 'at-main', 'sess-at-main', 'x-main'])).toBe('known');
    expect(amazonAuthCookieState(['at-main-music'])).toBe('known');
    expect(amazonAuthCookieState(['at-acbuk'])).toBe('known');
  });

  test('other auth-shaped names are a session under rotated names', () => {
    expect(amazonAuthCookieState(['session-id', 'x-main'])).toBe('rotated');
    expect(amazonAuthCookieState(['at-main2', 'session-id'])).toBe('known');
    expect(amazonAuthCookieState(['at-v2', 'sess-at-v2'])).toBe('rotated');
  });

  test('a logged-out jar is signed out (the old page-based hedge said signed in)', () => {
    expect(amazonAuthCookieState(['session-id', 'session-id-time', 'ubid-main', 'i18n-prefs', 'csm-hit', 'cwr_u'])).toBe('none');
    expect(amazonAuthCookieState(['session-token'])).toBe('none');
    expect(amazonAuthCookieState([])).toBe('none');
    expect(amazonAuthCookieState(null)).toBe('none');
  });
});

describe('licenseDenialSummary', () => {
  // Shape of a live content refusal on a Prime account; the ids are fake.
  const CONTENT_REFUSAL = 'customer is not eligible for content (EligibilityException CUSTOMER_NOT_ELIGIBLE) - '
    + 'CustomerEligibility(customerId=AFAKECUSTOMER123, marketplaceId=ATVFAKEMARKET, eligibilities=[ROBIN, NIGHTWING]) '
    + 'ContentEligibility(asin=B086Q41M9C, eligibilities=[KATANA])';

  test('keeps the sentence before the eligibility dump', () => {
    expect(licenseDenialSummary(CONTENT_REFUSAL))
      .toBe('customer is not eligible for content (EligibilityException CUSTOMER_NOT_ELIGIBLE)');
  });

  test('drops an eligibility block that arrives without the separator', () => {
    const out = licenseDenialSummary('not eligible CustomerEligibility(customerId=AFAKECUSTOMER123)');
    expect(out).toBe('not eligible');
  });

  test('scrubs account identifiers anywhere in the text, JSON bodies included', () => {
    expect(licenseDenialSummary('denied for customerId=AFAKECUSTOMER123, deviceId: 1234abcd'))
      .toBe('denied for customerId=<redacted>, deviceId: <redacted>');
    const body = licenseDenialSummary('{"customerId":"AFAKECUSTOMER123","message":"denied"}');
    expect(body).not.toContain('AFAKECUSTOMER123');
  });

  test('leaves a plain message alone and caps a long one', () => {
    expect(licenseDenialSummary('customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)'))
      .toBe('customer is not eligible for HD content (EligibilityException CUSTOMER_NOT_ELIGIBLE)');
    expect(licenseDenialSummary('x'.repeat(500))).toHaveLength(201);
  });

  test('non-strings and empty text give null', () => {
    expect(licenseDenialSummary(null)).toBeNull();
    expect(licenseDenialSummary(undefined)).toBeNull();
    expect(licenseDenialSummary('   ')).toBeNull();
  });
});

// --- Recommendations (capabilities.recommendations in the plugin) ---------
// Fixtures from the 2026-11 live capture of the signed-in home page's MUSIC
// tab (MusicHomePage) and the see-more route (RecommenderSeeMorePage).

describe('recommendations', () => {
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

  describe('amazonMusicHomeRequest', () => {
    const req = (opName, vars) => JSON.stringify({ operationName: opName, variables: vars, extensions: { clientLibrary: { name: '@apollo/client' }, persistedQuery: { version: 1, sha256Hash: 'a'.repeat(64) } } });

    test('matches the page own MusicHomePage request among everything the page fires', () => {
      const bodies = [
        JSON.stringify({ operationName: 'IdentityStoreSeed', variables: {} }),
        req('MusicHomePage', { firstLimit: 5, recommenderItemLimit: 15, type: 'music-home', topRecommenderId: 'musicTopOneRecommender', isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false, paginating: false }),
        JSON.stringify({ operationName: 'Transport', variables: {} })
      ];
      expect(amazonMusicHomeRequest(bodies).operationName).toBe('MusicHomePage');
      expect(amazonMusicHomeRequest(bodies).variables.recommenderItemLimit).toBe(15);
    });

    test('the LAST match wins (a re-render fires it again with fresher headers)', () => {
      const bodies = [req('MusicHomePage', { firstLimit: 1 }), req('MusicHomePage', { firstLimit: 5 })];
      expect(amazonMusicHomeRequest(bodies).variables.firstLimit).toBe(5);
    });

    test('no MusicHomePage → null (a structural miss for the page flow)', () => {
      expect(amazonMusicHomeRequest([JSON.stringify({ operationName: 'BrowseHomePage', variables: {} })])).toBeNull();
      // The full home's op, asked for by name (the refused-music-tab fallback, #1328).
      expect(amazonMusicHomeRequest([JSON.stringify({ operationName: 'BrowseHomePage', variables: { firstLimit: 5 } })], 'BrowseHomePage').variables.firstLimit).toBe(5);
      expect(amazonMusicHomeRequest([JSON.stringify({ operationName: 'MusicHomePage', variables: {} })], 'BrowseHomePage')).toBeNull();
      expect(amazonMusicHomeRequest([JSON.stringify({ operationName: 'Transport', variables: {} })])).toBeNull();
      expect(amazonMusicHomeRequest([])).toBeNull();
      expect(amazonMusicHomeRequest(['not json'])).toBeNull();
    });
  });

  describe('recommendationsFromMusicHome', () => {
    const response = (sections, extra = {}) => ({
      user: { id: 'u', tier: 'UNLIMITED', __typename: 'User' },
      t1r: { id: 'musicTopOneRecommender', __typename: 'RecommendationCollection', recommendationConnection: { edges: [{ node: { id: 'uri:///recommendations/music-home/playMusic', __typename: 'Recommendation', parentContainer: { node: { __typename: 'Station', id: 'A1ESXGJW9GSMCX', name: 'My Soundtrack' }, __typename: 'ParentContainerEdge' }, recommendedContent: { edges: [{ node: trackNode('B002S3FW6Y', 'Geneva', [['Russian Circles']], ['Empros', 'B005S3FW6Y']) }], __typename: 'EntityConnection' } } }] } },
      // A genre edge whose node WOULD map (an Album) if the parser ever
      // pointed at data.genres — pins that genres never reach the sections.
      genres: [{ id: '1|G|GROUPING_GENRE', __typename: 'Recommendation', recommendedContent: { edges: [{ node: albumNode('B00CXS55LG', 'Sunbather', ['Deafheaven']) }] } }],
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
      const out = recommendationsFromMusicHome(data);
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
      const out = recommendationsFromMusicHome(data);
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
      const out = recommendationsFromMusicHome(data);
      expect(out.sections.map(s => s.title)).toEqual(['New Releases for You']);
    });

    test('an absent data.browse is a structural miss (envelope false), not an empty page', () => {
      expect(recommendationsFromMusicHome({ user: { tier: 'UNLIMITED' }, t1r: {} }).envelope).toBe(false);
      expect(recommendationsFromMusicHome(null).envelope).toBe(false);
    });

    test('the home connection cursor rides on the parse (hasNextPage + token; the endCursor decoy ignored)', () => {
      const data = response([sectionNode('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy', 'Albums for You', [albumNode('B0G2TSTWXD', 'Tempelschlaf', ['The Ruins Of Beverast'])], 'ALBUM')], { pageInfo: { hasNextPage: true, endCursor: null, token: '20' } });
      expect(recommendationsFromMusicHome(data).nextCursor).toBe('20');
      // hasNextPage false, or no token: the walk ends.
      expect(recommendationsFromMusicHome(response([], { pageInfo: { hasNextPage: false, endCursor: null, token: '20' } })).nextCursor).toBeNull();
      expect(recommendationsFromMusicHome(response([], { pageInfo: { hasNextPage: true, endCursor: 'decoy', token: null } })).nextCursor).toBeNull();
    });
  });

  describe('musicHomeBodyWithVars / mergeMusicHomeSectionPages', () => {
    test('the body clone patches firstLimit and afterCursor; page 1 drops the afterCursor variable', () => {
      const body = { operationName: 'MusicHomePage', variables: { firstLimit: 5, type: 'music-home', paginating: false }, extensions: { persistedQuery: { sha256Hash: 'h' } } };
      const first = musicHomeBodyWithVars(body, { firstLimit: 20, afterCursor: null });
      expect(first.variables.firstLimit).toBe(20);
      expect(first.variables.afterCursor).toBeUndefined();
      expect(first.variables.type).toBe('music-home');
      expect(first.extensions.persistedQuery.sha256Hash).toBe('h');
      const second = musicHomeBodyWithVars(body, { firstLimit: 20, afterCursor: '20' });
      expect(second.variables.afterCursor).toBe('20');
      // Everything the patch does not touch survives the clone.
      expect(second.variables.audiobooksEnabled).toBeUndefined(); // (the fixture carries none here)
      const rich = { ...body, variables: { ...body.variables, audiobooksEnabled: true, paginating: false } };
      const patched = musicHomeBodyWithVars(rich, { firstLimit: 20, afterCursor: '20' });
      expect(patched.variables.audiobooksEnabled).toBe(true);
      expect(patched.variables.paginating).toBe(false);
      expect(patched.variables.firstLimit).toBe(20);
      // The original body is untouched.
      expect(body.variables.firstLimit).toBe(5);
      expect(body.variables.afterCursor).toBeUndefined();
    });

    test('the page merge dedupes by section id in first-appearance order (offset pages re-serve re-ranked sections)', () => {
      const page = (ids) => ({ sections: ids.map(id => ({ id, title: id })) });
      const merged = mergeMusicHomeSectionPages([page(['a', 'b']), page(['a', 'c']), page([])]);
      expect(merged.map(s => s.id)).toEqual(['a', 'b', 'c']);
      expect(mergeMusicHomeSectionPages(null)).toEqual([]);
    });
  });

  describe('see-more route + request', () => {
    test('the strategy id is the last uri segment; the see-more URL is the SPA route', () => {
      expect(recommendationStrategyId('uri:///recommendations/browse-home/browse-home_playlistStrategy')).toBe('browse-home_playlistStrategy');
      expect(recommendationStrategyId('browse-home_playlistStrategy')).toBe('browse-home_playlistStrategy');
      expect(recommendationStrategyId('')).toBeNull();
      expect(amazonSeeMorePageUrl('uri:///recommendations/browse-home/browse-home_newReleasesForYouStrategy'))
        .toBe('https://music.amazon.com/browse/music-items/home/recommendation/browse-home_newReleasesForYouStrategy');
      expect(amazonSeeMorePageUrl('')).toBeNull();
    });

    test('seeMoreSectionIdFor: the see-more REQUEST always carries the browse-home prefix — even for a music-home strategy', () => {
      // Live-verified 2026-11: a music-home section's own id is
      // uri:///recommendations/music-home/<strategy>, but its see-more request
      // asks for uri:///recommendations/browse-home/<strategy> — the echo guard
      // and the replay's id patch key on the mapped id.
      expect(seeMoreSectionIdFor('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy'))
        .toBe('uri:///recommendations/browse-home/music-home_mp3PrimeAlbumsStrategy');
      expect(seeMoreSectionIdFor('music-home_newReleasesForYouStrategy'))
        .toBe('uri:///recommendations/browse-home/music-home_newReleasesForYouStrategy');
      // Browse-home ids (the playlists strategy) are already in this form.
      expect(seeMoreSectionIdFor('uri:///recommendations/browse-home/browse-home_playlistStrategy'))
        .toBe('uri:///recommendations/browse-home/browse-home_playlistStrategy');
      expect(seeMoreSectionIdFor('')).toBeNull();
      // The route URL keys on the strategy suffix, so a music-home section's
      // route works from its own id.
      expect(amazonSeeMorePageUrl('uri:///recommendations/music-home/music-home_mp3PrimeAlbumsStrategy'))
        .toBe('https://music.amazon.com/browse/music-items/home/recommendation/music-home_mp3PrimeAlbumsStrategy');
    });

    test('amazonSeeMoreRequest matches the route page own request, last match wins', () => {
      const req = (opName, vars) => JSON.stringify({ operationName: opName, variables: vars, extensions: { persistedQuery: { version: 1, sha256Hash: 'b'.repeat(64) } } });
      const bodies = [
        JSON.stringify({ operationName: 'AppChromeHeaderLeft', variables: {} }),
        req('RecommenderSeeMorePage', { id: 'uri:///recommendations/browse-home/browse-home_playlistStrategy', firstLimit: 20, isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false }),
        JSON.stringify({ operationName: 'KidsMode', variables: {} })
      ];
      expect(amazonSeeMoreRequest(bodies).operationName).toBe('RecommenderSeeMorePage');
      expect(amazonSeeMoreRequest(bodies).variables.id).toBe('uri:///recommendations/browse-home/browse-home_playlistStrategy');
      expect(amazonSeeMoreRequest([req('KidsMode', {})])).toBeNull();
    });

    test('seeMoreBodyWithVars patches id/afterCursor and nothing else', () => {
      const body = {
        operationName: 'RecommenderSeeMorePage',
        variables: { id: 'uri:///recommendations/browse-home/browse-home_playlistStrategy', firstLimit: 20, isAuthenticated: true, audiobooksEnabled: true, merchEnabled: true, categoryInEntityUnionEnabled: false, afterCursor: 'browse-home_playlistStrategy.15' },
        extensions: { clientLibrary: { name: '@apollo/client', version: '4.1.6' }, persistedQuery: { version: 1, sha256Hash: 'c'.repeat(64) } }
      };
      const patched = seeMoreBodyWithVars(body, { sectionId: 'uri:///recommendations/browse-home/otherStrategy', afterCursor: 'otherStrategy.20' });
      expect(patched.variables.id).toBe('uri:///recommendations/browse-home/otherStrategy');
      expect(patched.variables.afterCursor).toBe('otherStrategy.20');
      expect(patched.variables.firstLimit).toBe(20);
      expect(patched.variables.isAuthenticated).toBe(true);
      expect(patched.extensions.persistedQuery.sha256Hash).toBe('c'.repeat(64));
      // The input body is not mutated
      expect(body.variables.id).toBe('uri:///recommendations/browse-home/browse-home_playlistStrategy');
      // No afterCursor → the variable is dropped (the first page of a section)
      const first = seeMoreBodyWithVars(body, { sectionId: 'uri:///recommendations/browse-home/otherStrategy' });
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
      const out = recommendationsFromSeeMore(data);
      expect(out.envelope).toBe(true);
      expect(out.section.title).toBe('Albums for You');
      expect(out.section.items[0]).toMatchObject({ type: 'album', name: 'Sons of Northern Darkness', artist: 'Immortal' });
      expect(out.nextCursor).toBe('browse-home_mp3PrimeAlbumsStrategy.20');
    });

    test('no next page → null cursor (the endCursor decoy is never used)', () => {
      const data = seeMoreResponse([albumNode('B0G2TSTWXD', 'Tempelschlaf', [['The Ruins Of Beverast']])],
        { hasNextPage: false, endCursor: '99:dfeab136', token: '[redacted]', __typename: 'PageInfo' });
      const out = recommendationsFromSeeMore(data);
      expect(out.nextCursor).toBeNull();
      expect(out.section.items).toHaveLength(1);
    });

    test('an absent data.recommender is structural; an empty connection is a real nothing-more', () => {
      expect(recommendationsFromSeeMore({}).envelope).toBe(false);
      expect(recommendationsFromSeeMore(null).envelope).toBe(false);
      expect(recommendationsFromSeeMore({ recommender: { edges: [] } })).toMatchObject({ envelope: true, section: null, nextCursor: null });
    });
  });
});
