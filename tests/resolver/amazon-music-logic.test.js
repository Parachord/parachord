const {
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  cdmStatusHealthy,
  pageBlocksPlayback,
  signInLanded,
  amazonAuthCookieState,
  asinFromPlayerUrl,
  amazonGqlFetchHeaders,
  stripAmazonTitleMarker,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
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

// (The dmls request builders — amazonDmlsRegion / amazonDmlsManifestBody /
// amazonDmlsLicenseBody / dashCodecFamily — were pinned here until #1356 M9
// moved the DRM pair into the plugin; their cases now drive the _lib copies in
// tests/resolver/amazon-music-plugin-drm.test.js.)

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

// (licenseDenialSummary moved with the licence-400 refusal semantics in
// #1356 M9; its cases drive the _lib copy in
// tests/resolver/amazon-music-plugin-drm.test.js.)

// (The recommendation helpers — recommendationItemFromGqlNode /
// amazonMusicHomeRequest / recommendationsFromMusicHome /
// musicHomeBodyWithVars / mergeMusicHomeSectionPages / seeMoreSectionIdFor /
// amazonSeeMoreRequest / recommendationStrategyId / amazonSeeMorePageUrl /
// seeMoreBodyWithVars / recommendationsFromSeeMore, and with them the
// replay-template trio (makeSpecSearchTemplate / specTemplateIsFresh /
// SPEC_TEMPLATE_MAX_AGE_MS), capturedOperationNames and isAmazonMusicPage —
// were pinned here until #1356 M8 moved the recommendations into the plugin;
// their cases now drive the _lib copies in
// tests/resolver/amazon-music-plugin-recommendations.test.js.)
