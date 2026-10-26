const {
  reportedPlaybackAsin,
  shouldRevealPlayerOnFailure,
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  cdmStatusHealthy,
  pageBlocksPlayback,
  signInLanded,
  AMAZON_QUALITY_OPTIONS,
  normalizeStreamingQuality,
  amazonSongSearchUrl,
  installAmazonRequireTrap,
  readPersistedQuality,
  writePersistedQuality,
  amazonQualityFromStore,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  playlistPageInfoFromGql,
  playlistEdgesFromGql,
  paginatePlaylistTracks,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  playlistTrackFromGqlEdge,
  stripAmazonTitleMarker,
  playlistFromGql,
  NEAR_END_MS,
  EMPTY_WHILE_PAUSED_POLL_LIMIT,
  measuredStreamKbps,
  createStreamBitrateMeter,
  QUALITY_MIN_PAIRS,
  QUALITY_PAIR_WINDOW,
  QUALITY_SHIFT_RATIO,
  installAmazonStreamCapture,
  mpdAudioRepresentations,
  flacStreamInfoFromInit,
  attachInitStreamInfo,
  pickMpdRepresentation,
  amazonStreamTier,
  amazonStreamQualityRecord,
  amazonMediaPauseExpr,
  amazonPlayGenerationStamp,
  amazonSpecSearchRequest,
  searchTracksFromGql,
  amazonAlbumSearchUrl,
  amazonAlbumAsinFromUrl,
  amazonAlbumDetailRequest,
  amazonAlbumDetailCandidates,
  albumTracksConnectionIn,
  albumFromGqlSearchNode,
  searchAlbumsFromGql,
  albumTrackFromGqlEdge,
  assignDiscNumbers,
  albumDetailFromGql,
  createSearchBreaker,
  isAmazonMusicPage
} = require('../../amazon-music-logic');

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

describe('playerDurationMs', () => {
  test('treats the player value as milliseconds, including long tracks', () => {
    expect(playerDurationMs(180000)).toBe(180000);
    expect(playerDurationMs(1200000)).toBe(1200000);
    expect(playerDurationMs(0)).toBe(0);
    expect(playerDurationMs(null)).toBe(0);
  });
});

describe('decidePollAdvance', () => {
  const playing = { state: 'PLAYING', durationMs: 180000, pollCount: 5, expectedAsin: 'B1', actualAsin: 'B1' };

  test('does not skip when seeking backward near the end', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 140000,
      seekSuppress: true
    });
    expect(decision.action).not.toBe('advance');
  });

  test('a backward seek is not an autoplay wrap even without the suppress flag', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 140000
    });
    expect(decision.action).toBe('continue');
  });

  test('wrap to the start after 80% is a finish', () => {
    const decision = decidePollAdvance({
      ...playing,
      lastPositionMs: 176000,
      positionMs: 200
    });
    expect(decision).toEqual({ action: 'advance', reason: 'finished' });
  });

  test('does not cut off several seconds before the end', () => {
    const early = decidePollAdvance({ ...playing, lastPositionMs: 170000, positionMs: 176000 });
    expect(early.action).not.toBe('advance');
    const late = decidePollAdvance({
      ...playing,
      lastPositionMs: 179000,
      positionMs: 180000 - NEAR_END_MS
    });
    expect(late).toEqual({ action: 'advance', reason: 'near-end' });
  });

  test('polls faster only in the last few seconds', () => {
    expect(shouldPollFaster(180000, 100000)).toBe(false);
    expect(shouldPollFaster(180000, 175000)).toBe(true);
  });

  test('a different ASIN after the grace period advances', () => {
    expect(decidePollAdvance({ ...playing, pollCount: 1, actualAsin: 'B9' }).action).toBe('wait');
    expect(decidePollAdvance({ ...playing, pollCount: 3, actualAsin: 'B9' }).reason).toBe('track-changed');
  });

  test('a page torn down while paused waits out a grace window, then advances', () => {
    const emptyWhilePaused = { state: 'EMPTY', positionMs: 0, durationMs: 180000, lastPositionMs: 60000, lastState: 'PAUSED', expectedAsin: 'B1' };
    // Still inside the window: keep polling — the user paused, and the page
    // may just be between documents.
    expect(decidePollAdvance({ ...emptyWhilePaused, emptyWhilePausedPolls: 5 })).toEqual({ action: 'track' });
    // Past the window: the element is gone and cannot be resumed — the pause
    // was honored long enough; playback is dead.
    expect(decidePollAdvance({ ...emptyWhilePaused, emptyWhilePausedPolls: EMPTY_WHILE_PAUSED_POLL_LIMIT }))
      .toEqual({ action: 'advance', reason: 'stopped' });
    // STOPPED/FINISHED while paused count the same as EMPTY.
    expect(decidePollAdvance({ ...emptyWhilePaused, state: 'STOPPED', emptyWhilePausedPolls: EMPTY_WHILE_PAUSED_POLL_LIMIT }))
      .toEqual({ action: 'advance', reason: 'stopped' });
  });

  test('an empty player while nothing ever played does not advance', async () => {
    // lastState null (never PLAYING): the page is still loading — a fresh
    // poller never latches a pause-death, so the count it sends is 0 and a
    // fresh poller must not advance on its first EMPTY reads.
    const decision = decidePollAdvance({ state: 'EMPTY', lastState: null, emptyWhilePausedPolls: 0 });
    expect(decision).toEqual({ action: 'track' });
    // The latched counter is only nonzero after a PAUSED poller saw death —
    // a count at the limit advances regardless of the (churned) lastState.
    expect(decidePollAdvance({
      state: 'EMPTY', lastState: 'EMPTY', emptyWhilePausedPolls: EMPTY_WHILE_PAUSED_POLL_LIMIT
    })).toEqual({ action: 'advance', reason: 'stopped' });
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

describe('amazonSongSearchUrl', () => {
  test('quotes both terms and ORs the two phrase orders — Amazon matching is order-sensitive in both directions', () => {
    expect(amazonSongSearchUrl({ title: 'stations', artist: 'Warning' })).toEqual({
      url: 'https://music.amazon.com/search/%22stations%22%20%22Warning%22%20OR%20%22Warning%22%20%22stations%22/songs',
      searchText: '"stations" "Warning" OR "Warning" "stations"'
    });
    // The case that surfaced this: "Яйца" "ХЛЕБ" returns nothing on Amazon;
    // ORing the reversed clauses is what surfaces ХЛЕБ — Яйца.
    expect(amazonSongSearchUrl({ title: 'Яйца', artist: 'ХЛЕБ' }).searchText)
      .toBe('"Яйца" "ХЛЕБ" OR "ХЛЕБ" "Яйца"');
  });

  test('still uses the songs tab when only one field is present', () => {
    expect(amazonSongSearchUrl({ title: 'stations' }).url).toMatch(/\/songs$/);
    expect(amazonSongSearchUrl({ artist: 'Warning' }).url).toMatch(/\/songs$/);
  });

  test('a bare query goes to the songs tab too — that is the page which fires the track search', () => {
    expect(amazonSongSearchUrl({ query: 'eisenherz' })).toEqual({
      url: 'https://music.amazon.com/search/eisenherz/songs',
      searchText: 'eisenherz'
    });
  });

  test('returns null when there is nothing to search', () => {
    expect(amazonSongSearchUrl({ query: '   ' })).toBeNull();
    expect(amazonSongSearchUrl({})).toBeNull();
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

describe('measuredStreamKbps', () => {
  test('steady 2s pairs measure the stream bitrate exactly', () => {
    expect(measuredStreamKbps(steadySamples(QUALITY_MIN_PAIRS))).toBe(850);
  });

  test('fast-cadence 400ms pairs (the near-end interval) measure too', () => {
    expect(measuredStreamKbps(steadySamples(QUALITY_MIN_PAIRS, { stepMs: 400, kbps: 320 }))).toBe(320);
  });

  test('needs several steady pairs before reporting — a couple of reads are not a measurement', () => {
    expect(measuredStreamKbps(steadySamples(QUALITY_MIN_PAIRS - 1))).toBeNull();
    expect(measuredStreamKbps(steadySamples(1))).toBeNull();
    expect(measuredStreamKbps([])).toBeNull();
    expect(measuredStreamKbps(null)).toBeNull();
  });

  test('the startup buffer-fill overshoot does not drag the median', () => {
    // While the decoder's buffers fill, the first pairs read ~3-5x the true
    // rate. The median window must land on the steady pairs.
    const spiked = [
      qualitySample(0, 0, 0),
      qualitySample(2000, 2000, 1282500), // 5130 kbps
      ...steadySamples(QUALITY_MIN_PAIRS, { startWallMs: 2000, startPositionMs: 2000, startBytes: 1282500 })
    ];
    expect(measuredStreamKbps(spiked)).toBe(850);
  });

  test('a pair spanning a seek is not a measurement', () => {
    const seeked = [
      ...steadySamples(2),
      qualitySample(8000, 90000, 425000), // forward seek: playhead jumped far past the wall clock
      ...steadySamples(QUALITY_MIN_PAIRS, { startWallMs: 8000, startPositionMs: 90000, startBytes: 425000 })
    ];
    expect(measuredStreamKbps(seeked)).toBe(850);
  });

  test('a pair spanning a pause or a stalled counter is not a measurement', () => {
    // Pause: playhead frozen while the wall clock ran on.
    const paused = [...steadySamples(2), qualitySample(8000, 4000, 425000), qualitySample(10000, 4000, 425000)];
    expect(measuredStreamKbps(paused)).toBeNull();
    // Stalled counter: nothing decoded in the window (bytes frozen).
    const stalled = [...steadySamples(2), qualitySample(8000, 8000, 425000), qualitySample(10000, 10000, 425000)];
    expect(measuredStreamKbps(stalled)).toBeNull();
  });

  test('absurd pair rates are transients, not the stream', () => {
    // 24000 kbps is beyond anything Amazon delivers; under 16 kbps is not
    // audio. Either way the pair is dropped, and without enough steady pairs
    // there is no measurement at all.
    const absurd = [
      qualitySample(0, 0, 0),
      qualitySample(2000, 2000, 6000000), // 24000 kbps
      ...steadySamples(QUALITY_MIN_PAIRS - 2, { startWallMs: 2000, startPositionMs: 2000, startBytes: 6000000 })
    ];
    expect(measuredStreamKbps(absurd)).toBeNull();
  });

  test('the median window is bounded, so a quality change mid-track is tracked', () => {
    // An ABR step mid-track: the early 320 kbps pairs age out of the window
    // and the measurement follows the new rate once it dominates.
    const shifted = [
      ...steadySamples(2, { kbps: 320 }),
      ...steadySamples(QUALITY_PAIR_WINDOW + 1, { startWallMs: 4000, startPositionMs: 4000, startBytes: 80000, kbps: 850 })
    ];
    expect(measuredStreamKbps(shifted)).toBe(850);
  });

  test('a dropped poll does not pair across the gap', () => {
    // Wall delta 6000ms exceeds the pair window — skip rather than average
    // across whatever happened in between.
    const gapped = [
      ...steadySamples(2),
      qualitySample(10000, 10000, 1062500),
      ...steadySamples(QUALITY_MIN_PAIRS, { startWallMs: 10000, startPositionMs: 10000, startBytes: 1062500 })
    ];
    expect(measuredStreamKbps(gapped)).toBe(850);
  });

  test('reads without a decode counter never form pairs', () => {
    const counterless = [
      qualitySample(0, 0, null),
      qualitySample(2000, 2000, null),
      ...steadySamples(QUALITY_MIN_PAIRS, { startWallMs: 4000, startPositionMs: 4000 })
    ];
    expect(measuredStreamKbps(counterless)).toBe(850);
  });
});

// The poller's meter: the median of every steady pair rate of the track, so a
// VBR stream settles on its average instead of following a 16s window
// (review on #1100), with a tier change (auto adjust) still followed.
describe('createStreamBitrateMeter', () => {
  // Feed 2s pairs with the given per-pair rates, continuing from `from` (the
  // last sample fed, or a fresh start). Returns the last sample.
  const feed = (meter, rates, from = null) => {
    let cur = from || { wallMs: 0, positionMs: 0, bytes: 0 };
    if (!from) meter.addSample(cur);
    for (const kbps of rates) {
      cur = { wallMs: cur.wallMs + 2000, positionMs: cur.positionMs + 2000, bytes: cur.bytes + kbps * 250 };
      meter.addSample(cur);
    }
    return cur;
  };
  const meterWithRates = (rates) => {
    const meter = createStreamBitrateMeter();
    feed(meter, rates);
    return meter;
  };

  test('reports nothing until enough steady pairs exist', () => {
    expect(meterWithRates(Array(QUALITY_MIN_PAIRS - 1).fill(850)).kbps()).toBeNull();
    expect(meterWithRates(Array(QUALITY_MIN_PAIRS).fill(850)).kbps()).toBe(850);
  });

  test('a VBR stream reports the track median, not the latest 16s window', () => {
    // Pair rates wander 760-1040 around ~900; the last window happens to be high.
    const rates = [];
    for (let i = 0; i < 40; i++) rates.push(900 + ((i * 37) % 9 - 4) * 35);
    const tail = Array(QUALITY_PAIR_WINDOW).fill(1000);
    const meter = meterWithRates([...rates, ...tail]);
    const track = meter.kbps();
    expect(track).toBeGreaterThanOrEqual(880);
    expect(track).toBeLessThanOrEqual(920);
    // 1000 vs ~900 is inside the shift ratio: wobble, not a tier change.
    expect(Math.abs(1000 - track) / track).toBeLessThan(QUALITY_SHIFT_RATIO);
  });

  test('the startup buffer-fill overshoot does not drag the report', () => {
    expect(meterWithRates([5130, 4200, ...Array(20).fill(850)]).kbps()).toBe(850);
  });

  test('a tier change mid-track is followed once the recent window shows it', () => {
    const meter = createStreamBitrateMeter();
    let last = feed(meter, Array(60).fill(900));
    expect(meter.kbps()).toBe(900);
    // Auto adjust drops to AAC 256: the whole-track median alone would sit at
    // 900 for minutes; the recent window's shift resets it.
    last = feed(meter, Array(QUALITY_PAIR_WINDOW).fill(256), last);
    expect(meter.kbps()).toBe(256);
    // ...and from then on the track figure is the new tier's.
    feed(meter, Array(4).fill(260), last);
    expect(meter.kbps()).toBeGreaterThanOrEqual(256);
    expect(meter.kbps()).toBeLessThanOrEqual(260);
  });

  test('a seek or pause between reads is not a pair', () => {
    const meter = createStreamBitrateMeter();
    const last = feed(meter, Array(QUALITY_MIN_PAIRS).fill(850));
    // Forward seek: playhead jumps 60s while the wall clock moves 2s.
    meter.addSample({ wallMs: last.wallMs + 2000, positionMs: last.positionMs + 60000, bytes: last.bytes + 9000000 });
    expect(meter.kbps()).toBe(850);
  });
});

describe('installAmazonStreamCapture', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const fakeResponse = ({ text = '', contentLength = null, arrayBuffer = null }) => ({
    clone: () => ({
      text: () => Promise.resolve(text),
      arrayBuffer: () => Promise.resolve(arrayBuffer)
    }),
    headers: { get: (name) => (String(name).toLowerCase() === 'content-length' ? (contentLength == null ? null : String(contentLength)) : null) }
  });

  const fetchScope = (responseFor) => {
    const scope = {};
    scope.fetch = async (input) => {
      const url = typeof input === 'string' ? input : (input && input.url);
      const res = responseFor(url);
      scope.__lastResponse = res;
      return res;
    };
    return scope;
  };

  test('captures a fetch-loaded manifest via the cloned response text', async () => {
    const scope = fetchScope(() => fakeResponse({ text: '<MPD>flac</MPD>' }));
    installAmazonStreamCapture(scope);
    await scope.fetch('https://cdn.example.com/a.mpd?sig=1');
    await flush();
    expect(scope.__parachordStreamCaps.manifests).toEqual([
      { url: 'https://cdn.example.com/a.mpd?sig=1', text: '<MPD>flac</MPD>' }
    ]);
  });

  test('fetch passthrough is untouched: the caller gets the original response object', async () => {
    const res = fakeResponse({ text: '<MPD>x</MPD>' });
    const scope = fetchScope(() => res);
    installAmazonStreamCapture(scope);
    const out = await scope.fetch('https://cdn.example.com/a.mpd');
    expect(out).toBe(res);
  });

  test('captures small init segments and drops media-sized responses', async () => {
    const small = new ArrayBuffer(1200);
    const scope = fetchScope((url) => (
      url === 'https://cdn.example.com/init.mp4' ? fakeResponse({ contentLength: 1200, arrayBuffer: small })
        : url === 'https://cdn.example.com/seg1.m4s' ? fakeResponse({ contentLength: 812344 })
          : fakeResponse({ arrayBuffer: small }) // no content-length: decided after the read
    ));
    installAmazonStreamCapture(scope);
    await scope.fetch('https://cdn.example.com/init.mp4');
    await scope.fetch('https://cdn.example.com/seg1.m4s'); // media segment: skipped by content-length
    await scope.fetch('https://cdn.example.com/unknown.bin'); // not a manifest/init URL: ignored
    await flush();
    expect(scope.__parachordStreamCaps.inits).toEqual([
      { url: 'https://cdn.example.com/init.mp4', bytes: small }
    ]);
  });

  test('an XHR-loaded manifest and init segment are captured on load', () => {
    class FakeXHR {
      constructor() { this.responseType = ''; this._listeners = {}; }
      open(method, url) { this._url = url; }
      addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
      fire() { (this._listeners.load || []).forEach((fn) => fn()); }
    }
    FakeXHR.UNSENT = 0;
    FakeXHR.OPENED = 1;
    const scope = { XMLHttpRequest: FakeXHR };
    installAmazonStreamCapture(scope);
    const XHR = scope.XMLHttpRequest;
    expect(XHR.UNSENT).toBe(0); // statics survive the wrap
    const manifestXhr = new XHR();
    expect(manifestXhr).toBeInstanceOf(XHR);
    manifestXhr.open('GET', 'https://cdn.example.com/b.mpd');
    manifestXhr.responseText = '<MPD>xhr</MPD>';
    manifestXhr.fire();
    const initXhr = new XHR();
    initXhr.open('GET', 'https://cdn.example.com/i.m4s');
    initXhr.responseType = 'arraybuffer';
    const bytes = new ArrayBuffer(800);
    initXhr.response = bytes;
    initXhr.fire();
    expect(scope.__parachordStreamCaps.manifests).toEqual([
      { url: 'https://cdn.example.com/b.mpd', text: '<MPD>xhr</MPD>' }
    ]);
    expect(scope.__parachordStreamCaps.inits).toEqual([
      { url: 'https://cdn.example.com/i.m4s', bytes }
    ]);
  });

  test('install is idempotent and a bare scope is tolerated', () => {
    const scope = fetchScope(() => fakeResponse({ text: '<MPD/>' }));
    installAmazonStreamCapture(scope);
    const wrapped = scope.fetch;
    installAmazonStreamCapture(scope);
    expect(scope.fetch).toBe(wrapped);
    // A scope with no fetch/XHR at all (the preload stub's test stub) must not throw.
    expect(() => installAmazonStreamCapture({})).not.toThrow();
    expect(() => installAmazonStreamCapture(null)).not.toThrow();
  });
});

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

describe('mpdAudioRepresentations', () => {
  test('parses the audio ladder and excludes video sets', () => {
    const reps = mpdAudioRepresentations(ladderMpd, 'https://cdn.example.com/manifest.mpd');
    expect(reps).toHaveLength(2);
    expect(reps[0]).toMatchObject({
      id: 'B0HD441',
      codec: 'fLaC',
      container: 'mp4',
      bandwidth: 850000,
      sampleRate: 44100,
      channels: 2,
      initializationUrl: 'https://cdn.example.com/dash/B0HD441/init.mp4?token=a&b'
    });
    expect(reps.some(r => r.id === 'v1')).toBe(false);
  });

  test('a representation id naming the depth is picked up as a bit-depth hint', () => {
    const reps = mpdAudioRepresentations(ladderMpd, 'https://cdn.example.com/manifest.mpd');
    expect(reps.find(r => r.id === 'B0HD441').bitDepth).toBeNull();
    expect(reps.find(r => r.id === 'B0UHD48-24bit').bitDepth).toBe(24);
  });

  test('audio attributes inherit from the AdaptationSet when the representation omits them', () => {
    const xml = `<MPD><Period>
      <AdaptationSet mimeType="audio/mp4" codecs="fLaC" audioSamplingRate="44100" bitDepth="16">
        <Representation id="r1" bandwidth="900000"/>
      </AdaptationSet>
    </Period></MPD>`;
    const reps = mpdAudioRepresentations(xml, 'https://x/m.mpd');
    expect(reps[0]).toMatchObject({ codec: 'fLaC', container: 'mp4', sampleRate: 44100, bitDepth: 16, bandwidth: 900000 });
  });

  test('SegmentList Initialization sourceURL is an init URL too', () => {
    const xml = `<MPD><Period>
      <AdaptationSet mimeType="audio/mp4">
        <Representation id="a1" codecs="mp4a.40.2" bandwidth="256000" audioSamplingRate="44100">
          <SegmentList timescale="44100" duration="196608">
            <Initialization sourceURL="https://cdn2.example.com/init.mp4"/>
          </SegmentList>
        </Representation>
      </AdaptationSet>
    </Period></MPD>`;
    const reps = mpdAudioRepresentations(xml, 'https://x/m.mpd');
    expect(reps[0].initializationUrl).toBe('https://cdn2.example.com/init.mp4');
  });

  test('garbage in, empty list out', () => {
    expect(mpdAudioRepresentations('', 'https://x/m.mpd')).toEqual([]);
    expect(mpdAudioRepresentations('not xml at all', 'https://x/m.mpd')).toEqual([]);
    expect(mpdAudioRepresentations(null, null)).toEqual([]);
  });
});

describe('flacStreamInfoFromInit', () => {
  const isoBox = (type, payload) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(payload.length + 8, 0);
    head.write(type, 4, 'ascii');
    return Buffer.concat([head, payload]);
  };
  const streaminfo = ({ sampleRate, bitDepth, channels }) => {
    const s = Buffer.alloc(34);
    s[10] = (sampleRate >> 12) & 0xff;
    s[11] = (sampleRate >> 4) & 0xff;
    s[12] = ((sampleRate & 0x0f) << 4) | (((channels - 1) & 0x07) << 1) | (((bitDepth - 1) >> 4) & 0x01);
    s[13] = ((bitDepth - 1) & 0x0f) << 4;
    return s;
  };
  // A dfla box: FullBox version/flags, FLAC block header (type 0, length 34),
  // then STREAMINFO — nested the way a real init segment carries it.
  const dflaBox = (fourcc, opts) => isoBox(fourcc, Buffer.concat([
    Buffer.alloc(4),
    Buffer.from([0x00, 0x00, 0x00, 34]),
    streaminfo(opts)
  ]));

  test('reads STREAMINFO from the nested dfla box (spec spelling)', () => {
    const init = isoBox('moov', isoBox('trak', dflaBox('dfla', { sampleRate: 48000, bitDepth: 24, channels: 2 })));
    expect(flacStreamInfoFromInit(init))
      .toEqual({ codec: 'fLaC', sampleRate: 48000, channels: 2, bitDepth: 24 });
    const hd = isoBox('moov', isoBox('trak', dflaBox('dfla', { sampleRate: 44100, bitDepth: 16, channels: 2 })));
    expect(flacStreamInfoFromInit(hd))
      .toEqual({ codec: 'fLaC', sampleRate: 44100, channels: 2, bitDepth: 16 });
  });

  test("reads STREAMINFO from Amazon's muxer spelling 'dfLa' inside an encrypted audio entry", () => {
    // Observed live (2026-10-15): the init segment carries stsd → enca →
    // [dfLa + sinf → (frma 'fLaC', schi → tenc)], with the FLAC box spelled
    // 'dfLa' — not the spec's 'dfla'.
    const dfLa = dflaBox('dfLa', { sampleRate: 44100, bitDepth: 16, channels: 2 });
    const sinf = isoBox('sinf', Buffer.concat([
      isoBox('frma', Buffer.from('fLaC', 'ascii')),
      isoBox('schi', Buffer.concat([Buffer.alloc(4), isoBox('tenc', Buffer.alloc(20))]))
    ]));
    const enca = isoBox('enca', Buffer.concat([
      Buffer.alloc(28), // sample-entry + AudioSampleEntry reserved fields
      dfLa,
      sinf
    ]));
    const stsd = isoBox('stsd', Buffer.concat([Buffer.alloc(8), enca]));
    const init = isoBox('moov', isoBox('trak', isoBox('mdia', isoBox('minf', isoBox('stbl', stsd)))));
    expect(flacStreamInfoFromInit(init))
      .toEqual({ codec: 'fLaC', sampleRate: 44100, channels: 2, bitDepth: 16 });
  });

  test('a media segment or garbage is null, not a false positive', () => {
    expect(flacStreamInfoFromInit(isoBox('moof', Buffer.alloc(64)))).toBeNull();
    expect(flacStreamInfoFromInit(Buffer.alloc(0))).toBeNull();
    expect(flacStreamInfoFromInit(Buffer.from('dfla but far too short'))).toBeNull();
    // 'dfLa' appearing with no plausible STREAMINFO behind it does not parse.
    const decoy = Buffer.concat([Buffer.from('dfLa'), Buffer.alloc(80, 0xff)]);
    expect(flacStreamInfoFromInit(decoy)).toBeNull();
    // A planted fourcc plus a bare STREAMINFO used to parse. The block header
    // is required; sample-rate and bit-depth range checks are not enough.
    const bare = Buffer.concat([
      Buffer.from('dfLa'),
      streaminfo({ sampleRate: 48000, bitDepth: 24, channels: 2 }),
      Buffer.alloc(8)
    ]);
    expect(flacStreamInfoFromInit(bare)).toBeNull();
    expect(flacStreamInfoFromInit(Buffer.concat([
      Buffer.from('dfla'),
      streaminfo({ sampleRate: 44100, bitDepth: 16, channels: 2 }),
      Buffer.alloc(8)
    ]))).toBeNull();
  });
});

describe('attachInitStreamInfo', () => {
  const rep = (initializationUrl) => ({ codec: 'fLaC', bandwidth: 900000, sampleRate: 44100, channels: null, bitDepth: null, initializationUrl });

  test('a URL-matched init is authoritative over the MPD attributes', () => {
    const inits = [{ url: 'https://cdn/i.mp4', codec: 'fLaC', sampleRate: 48000, bitDepth: 24, channels: 2 }];
    const out = attachInitStreamInfo([rep('https://cdn/i.mp4')], inits);
    expect(out[0]).toMatchObject({ sampleRate: 48000, bitDepth: 24, channels: 2 });
  });

  test('the single-representation pairing fills only missing fields', () => {
    const inits = [{ url: 'https://other/i.mp4', codec: 'fLaC', sampleRate: 44100, bitDepth: 16, channels: 2 }];
    const out = attachInitStreamInfo([rep(null)], inits);
    expect(out[0]).toMatchObject({ sampleRate: 44100, bitDepth: 16, channels: 2 });
  });

  test('ambiguous multi-rep, multi-init input pairs nothing', () => {
    const inits = [
      { url: 'https://a/i.mp4', codec: 'fLaC', sampleRate: 44100, bitDepth: 16, channels: 2 },
      { url: 'https://b/i.mp4', codec: 'fLaC', sampleRate: 48000, bitDepth: 24, channels: 2 }
    ];
    const out = attachInitStreamInfo([rep(null), rep(null)], inits);
    expect(out.every(r => r.bitDepth === null)).toBe(true);
  });
});

describe('pickMpdRepresentation', () => {
  const ladder = [
    { id: 'a', codec: 'fLaC', bandwidth: 850000, sampleRate: 44100, bitDepth: 16 },
    { id: 'b', codec: 'fLaC', bandwidth: 1478000, sampleRate: 48000, bitDepth: 24 }
  ];

  test('the measured bitrate picks the rung of the ladder actually playing', () => {
    expect(pickMpdRepresentation(ladder, 840).id).toBe('a');
    expect(pickMpdRepresentation(ladder, 1500).id).toBe('b');
  });

  test('a single representation is it, and no bandwidths means the richest wins', () => {
    expect(pickMpdRepresentation([{ codec: 'fLaC' }], 900).codec).toBe('fLaC');
    const noBw = [
      { codec: 'fLaC', sampleRate: 44100 },
      { codec: 'fLaC', sampleRate: 48000, bitDepth: 24 }
    ];
    expect(pickMpdRepresentation(noBw, 900).bitDepth).toBe(24);
  });

  test('empty input is null', () => {
    expect(pickMpdRepresentation([], 900)).toBeNull();
    expect(pickMpdRepresentation(null, 900)).toBeNull();
  });
});

describe('amazonStreamTier / amazonStreamQualityRecord', () => {
  test('the tier follows Amazon\'s vocabulary from the measured facts', () => {
    expect(amazonStreamTier({ codec: 'mp4a.40.2', sampleRate: 44100 })).toBe('SD');
    expect(amazonStreamTier({ codec: 'fLaC', sampleRate: 44100, bitDepth: 16 })).toBe('HD');
    expect(amazonStreamTier({ codec: 'fLaC', sampleRate: 48000, bitDepth: 24 })).toBe('Ultra HD');
    expect(amazonStreamTier({ codec: 'fLaC', sampleRate: 96000, bitDepth: 16 })).toBe('Ultra HD');
    expect(amazonStreamTier({ codec: 'alac', sampleRate: 44100, bitDepth: 16 })).toBe('HD');
    expect(amazonStreamTier({ codec: null })).toBeNull();
  });

  test('the record merges the measured bitrate with the captured params', () => {
    expect(amazonStreamQualityRecord(1478, { codec: 'fLaC', container: 'mp4', sampleRate: 48000, bitDepth: 24, channels: 2 }))
      .toEqual({
        bitrate: 1478,
        origin: 'measured',
        codec: 'fLaC',
        container: 'mp4',
        sampleRate: 48000,
        bitDepth: 24,
        channels: 2,
        tier: 'Ultra HD'
      });
  });

  test('without captured params the record is the honest bitrate-only one', () => {
    expect(amazonStreamQualityRecord(850, null)).toEqual({ bitrate: 850, origin: 'measured' });
    expect(amazonStreamQualityRecord(0, { codec: 'fLaC' })).toBeNull();
  });
});

describe('normalizeStreamingQuality', () => {
  test('maps the modal radios and the legacy HD value', () => {
    expect(normalizeStreamingQuality('BEST_AVAILABLE')).toBe('BEST_AVAILABLE');
    expect(normalizeStreamingQuality('HD')).toBe('BEST_AVAILABLE');
    expect(normalizeStreamingQuality('STANDARD')).toBe('STANDARD');
    expect(normalizeStreamingQuality('DATA_SAVER')).toBe('DATA_SAVER');
    expect(normalizeStreamingQuality('ULTRA_HD')).toBeNull();
    expect(AMAZON_QUALITY_OPTIONS.map(o => o.value)).toEqual([
      'BEST_AVAILABLE', 'STANDARD', 'DATA_SAVER'
    ]);
  });
});

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

describe('installAmazonRequireTrap', () => {
  test('captures the playbackController when Amazon requires its module', () => {
    const scope = makeMetroScope();
    installAmazonRequireTrap(scope);
    scope.__r = scope.require;
    scope.__r(456);
    expect(scope.__parachordAmazonPlayback).toBeUndefined();
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
    expect(scope.__parachordAmazonPlayback.audioQualitySettings.streamingQuality).toBe('STANDARD');
  });

  test('wraps a require that was already assigned before the trap', () => {
    const scope = makeMetroScope();
    scope.__r = scope.require;
    installAmazonRequireTrap(scope);
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
  });

  test('the wrapped require still passes through calls and extra properties', () => {
    const scope = makeMetroScope();
    installAmazonRequireTrap(scope);
    const asyncChunk = () => {};
    scope.require.async = asyncChunk;
    scope.__r = scope.require;
    expect(scope.__r).not.toBe(scope.require);
    expect(scope.__r.async).toBe(asyncChunk);
    expect(scope.__r(456)).toEqual({ other: true });
  });

  test('re-assignment re-wraps without double wrapping, and install is idempotent', () => {
    const scope = makeMetroScope();
    installAmazonRequireTrap(scope);
    scope.__r = scope.require;
    const first = scope.__r;
    scope.__r = scope.require; // a lazy chunk exposes __r again
    expect(scope.__r).not.toBe(first);
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
    installAmazonRequireTrap(scope);
    expect(scope.__r).toBe(scope.__r); // no-op re-install
  });

  test('a throwing module export does not break the require', () => {
    const scope = {};
    const hostile = { get playbackController() { throw new Error('getter'); } };
    scope.require = (id) => (id === 7 ? hostile : { ok: 1 });
    installAmazonRequireTrap(scope);
    scope.__r = scope.require;
    expect(() => scope.__r(7)).not.toThrow();
    expect(scope.__r(8)).toEqual({ ok: 1 });
    expect(scope.__parachordAmazonPlayback).toBeUndefined();
  });

  test('serializes self-contained for evaluation inside the Amazon page', () => {
    // The preload embeds this function with .toString() and runs it in the
    // page world, where module-scope identifiers do not exist. new Function
    // gives it the same bare scope, so a closure reference fails here instead
    // of inside Amazon's page.
    const embedded = new Function(`return (${installAmazonRequireTrap.toString()})`)();
    const scope = makeMetroScope();
    embedded(scope);
    scope.__r = scope.require;
    scope.__r(123);
    expect(scope.__parachordAmazonPlaybackModuleId).toBe(123);
  });
});

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

describe('readPersistedQuality', () => {
  test('reads audio quality from the playback-controller entry', () => {
    const storage = makeStorage({
      'hornet:playback-controller:v2': playbackControllerEntry({ streamingQuality: 'HD', abrEnabled: false })
    });
    expect(readPersistedQuality(storage)).toEqual({ streamingQuality: 'HD', abrEnabled: false });
  });

  test('returns null when no entry, malformed JSON, or no audioQualitySettings', () => {
    expect(readPersistedQuality(makeStorage({}))).toBeNull();
    expect(readPersistedQuality(makeStorage({ 'playback-controller': '{not json' }))).toBeNull();
    expect(readPersistedQuality(makeStorage({ 'playback-controller': JSON.stringify({ data: {} }) }))).toBeNull();
    expect(readPersistedQuality(makeStorage({ 'playback-controller': JSON.stringify({ data: { audioQualitySettings: null } }) }))).toBeNull();
  });

  test('serializes self-contained for evaluation inside the Amazon page', () => {
    const embedded = new Function(`return (${readPersistedQuality.toString()})`)();
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'STANDARD', abrEnabled: true })
    });
    expect(embedded(storage)).toEqual({ streamingQuality: 'STANDARD', abrEnabled: true });
  });
});

describe('amazonQualityFromStore', () => {
  test('a read does not produce a persist patch', () => {
    const store = { streamingQuality: 'BEST_AVAILABLE' };
    const step = amazonQualityFromStore(store, null);
    expect(step.persist).toBeNull();
    expect(step.report).toEqual({ streamingQuality: 'BEST_AVAILABLE', abrEnabled: true });
    expect(store.abrEnabled).toBeUndefined();
  });

  test('a write persists only fields that are actually set', () => {
    const store = { streamingQuality: 'STANDARD' };
    const step = amazonQualityFromStore(store, { streamingQuality: 'BEST_AVAILABLE' });
    expect(step.persist).toEqual({ streamingQuality: 'BEST_AVAILABLE' });
    expect(step.persist.abrEnabled).toBeUndefined();
  });

  test('a write can turn Auto-adjust off when the caller set it', () => {
    const store = { streamingQuality: 'HD', abrEnabled: true };
    const step = amazonQualityFromStore(store, { abrEnabled: false });
    expect(step.persist).toEqual({ streamingQuality: 'HD', abrEnabled: false });
  });
});

describe('writePersistedQuality', () => {
  test('merges quality into the entry and preserves unrelated data', () => {
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'STANDARD', abrEnabled: true })
    });
    expect(writePersistedQuality(storage, { streamingQuality: 'BEST_AVAILABLE', abrEnabled: false })).toBe(true);
    const parsed = JSON.parse(storage.getItem('playback-controller'));
    expect(parsed.data.audioQualitySettings).toEqual({ streamingQuality: 'BEST_AVAILABLE', abrEnabled: false });
    expect(parsed.data.unrelated).toEqual({ keep: true });
  });

  test('a patch with undefined fields keeps the stored tier', () => {
    // Flipping only Auto-adjust must not clobber the persisted streamingQuality.
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'HD', abrEnabled: true })
    });
    expect(writePersistedQuality(storage, { abrEnabled: false })).toBe(true);
    const parsed = JSON.parse(storage.getItem('playback-controller'));
    expect(parsed.data.audioQualitySettings).toEqual({ streamingQuality: 'HD', abrEnabled: false });
  });

  test('returns false when there is no entry to merge into', () => {
    const storage = makeStorage({});
    expect(writePersistedQuality(storage, { streamingQuality: 'STANDARD' })).toBe(false);
    expect(readPersistedQuality(storage)).toBeNull();
  });

  test('serializes self-contained for evaluation inside the Amazon page', () => {
    const embedded = new Function(`return (${writePersistedQuality.toString()})`)();
    const storage = makeStorage({
      'playback-controller': playbackControllerEntry({ streamingQuality: 'STANDARD', abrEnabled: true })
    });
    expect(embedded(storage, { abrEnabled: false })).toBe(true);
    expect(readPersistedQuality(storage)).toEqual({ streamingQuality: 'STANDARD', abrEnabled: false });
  });
});

describe('asinFromPlayerUrl', () => {
  test('reads the playing track ASIN from the player URL', () => {
    expect(asinFromPlayerUrl('https://music.amazon.com/tracks/B000SNWG5Q?do=play')).toBe('B000SNWG5Q');
    expect(asinFromPlayerUrl('https://music.amazon.com/')).toBeNull();
    expect(asinFromPlayerUrl('')).toBeNull();
  });
});

describe('amazonPlaylistIdFromUrl', () => {
  test('reads the id off shared/brand, my-music and user-playlist pages', () => {
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A'))
      .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh'))
      .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    // /user-playlists/<uuid> is the share-link shape for user-created
    // playlists (observed 2026-10); ids come bare-hex AND dashed — a dashed
    // id truncated at its first dash never matches the page's own request.
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/user-playlists/e518f7064d964396a9dc211c4a705a80'))
      .toBe('e518f7064d964396a9dc211c4a705a80');
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/user-playlists/1ff61395-8d2c-4c12-a5de-8fc0b69bdf02'))
      .toBe('1ff61395-8d2c-4c12-a5de-8fc0b69bdf02');
  });

  test('track, album and non-Amazon URLs are not playlists', () => {
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/tracks/B000SNWG5Q')).toBeNull();
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/albums/B000031W1M')).toBeNull();
    expect(amazonPlaylistIdFromUrl('https://open.spotify.com/playlist/abc')).toBeNull();
    expect(amazonPlaylistIdFromUrl('')).toBeNull();
  });
});

describe('amazonPlaylistDetailRequest', () => {
  const detail = (id) => JSON.stringify({
    operationName: 'playlistDetail',
    variables: { id, firstLimit: 100, isAuthenticated: true, includeCollaborators: false },
    extensions: { persistedQuery: { version: 1, sha256Hash: '41c5f472' } }
  });

  test('finds the playlistDetail request for our playlist among the captured gql bodies', () => {
    const bodies = [
      JSON.stringify({ operationName: 'Transport', variables: {} }),
      detail('PP6417A00A9C99470BBC8834FF3BF6009A'),
      JSON.stringify({ operationName: 'playlistSuggestions', variables: { recsUri: 'uri:///playlist/x/suggested-tracks' } }),
      '{not json'
    ];
    const req = amazonPlaylistDetailRequest(bodies, 'PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(req.operationName).toBe('playlistDetail');
    expect(req.variables.id).toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(req.extensions.persistedQuery.sha256Hash).toBe('41c5f472');
  });

  test('a playlistDetail for another playlist is not ours', () => {
    expect(amazonPlaylistDetailRequest([detail('PPOTHER')], 'PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
    expect(amazonPlaylistDetailRequest([detail('pp6417a00a9c99470bbc8834ff3bf6009a')], 'PP6417A00A9C99470BBC8834FF3BF6009A')).not.toBeNull();
    expect(amazonPlaylistDetailRequest([], 'PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
    expect(amazonPlaylistDetailRequest(null, 'x')).toBeNull();
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
    const req = amazonSpecSearchRequest(bodies, '"Eisenherz" "Juli"');
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
    expect(amazonSpecSearchRequest([batch], 'eisenherz')).not.toBeNull();
  });

  test('only the track spec is ever accepted — even alone, an album/artist spec never matches', () => {
    // The album-spec request carries the SAME searchText and an ASIN-shaped
    // node that maps to a track — first-arrival must not win it the replay.
    // This is the album-ASIN failure the DOM-era exclusion dance existed to
    // prevent, on its gql successor.
    expect(amazonSpecSearchRequest([search('eisenherz', 'album')], 'eisenherz')).toBeNull();
    expect(amazonSpecSearchRequest([search('eisenherz', 'artist')], 'eisenherz')).toBeNull();
    const bodies = [
      search('eisenherz', 'album'),
      search('eisenherz', 'track')
    ];
    expect(amazonSpecSearchRequest(bodies, 'eisenherz').variables.specType).toBe('track');
  });

  test('a body with no specType at all is accepted (older deploys)', () => {
    expect(amazonSpecSearchRequest([search('eisenherz', undefined)], 'eisenherz').variables.specType).toBeUndefined();
  });

  test('the anySpec mode matches any spec — used only to detect the grace condition, never for replay', () => {
    expect(amazonSpecSearchRequest([search('eisenherz', 'album')], 'eisenherz', { anySpec: true }).variables.specType).toBe('album');
    expect(amazonSpecSearchRequest([search('eisenherz', 'album')], 'eisenherz', { anySpec: false })).toBeNull();
  });

  test('another query\'s search, a missing text, and empty captures are not ours', () => {
    expect(amazonSpecSearchRequest([search('something else', 'track')], 'eisenherz')).toBeNull();
    expect(amazonSpecSearchRequest([JSON.stringify({ operationName: 'Transport', variables: { id: 1 } })], 'eisenherz')).toBeNull();
    expect(amazonSpecSearchRequest([], 'eisenherz')).toBeNull();
    expect(amazonSpecSearchRequest([search('eisenherz', 'track')], '  ')).toBeNull();
    expect(amazonSpecSearchRequest(null, 'eisenherz')).toBeNull();
  });
});

// The SpecSearchSeeMorePage response (live-captured 2026-10): edges under
// data.specificationSearch.result[], each node the same Track entity the
// playlist detail returns (id/title/contributingArtists/album/duration) plus
// images the search flow surfaces as cover art.
describe('searchTracksFromGql', () => {
  // Real shape, first rows of the "eisenherz" search (trimmed).
  const trackNode = (id, title, artists, album, duration, art) => ({
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
  // parsed.data — what the web player passes the parser after the replay.
  const response = (edges, extra = {}) => ({
    specificationSearch: {
      id: 'search_368547b5e7',
      searchText: 'eisenherz',
      result: [
        {
          __typename: 'SpecificationSearchResult',
          pageInfo: { hasNextPage: !!edges.length, endCursor: null, token: edges.length ? 'tztok-v2_iosm' : null },
          label: 'requiredButUnused',
          edges: edges.map(node => ({ __typename: 'EntityEdge', node })),
          ...extra
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
    const out = searchTracksFromGql(data);
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
    // Live-observed: a no-results search answers result[0] with edges: [] and
    // hasNextPage false. The caller returns [] (cached as a 30-day noMatch).
    const out = searchTracksFromGql(response([]));
    expect(out).toEqual({ tracks: [], envelope: true });
  });

  test('a non-Track node (an album-spec edge) is rejected, not imported as a track', () => {
    // The album spec searches the same text; its edges are Album nodes with
    // ASIN + title + artists — everything the mapper wants. The __typename
    // (present when the response asks for it, as the search response does) is
    // the discriminator: an album ASIN in the track slot passes the
    // confidence gate on a self-titled release and playback loads
    // /tracks/<albumAsin>.
    const data = response([
      { __typename: 'Album', id: 'B0ALBUM123', title: 'Kid A',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Radiohead' } }] },
        album: { id: 'B0ALBUM123', shortTitle: 'Kid A' }, duration: 2900 },
      trackNode('B073N3R1KZ', 'Eisenherz', [['Juli', 'PRIMARY']], ['In Love', 'B073HX454H'], 276)
    ]);
    const out = searchTracksFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0].asin).toBe('B073N3R1KZ');
  });

  test('a row without artists is dropped, not fatal', () => {
    const data = response([
      trackNode('B0NOARTIST', 'Artless', [], ['X', 'B0ALBUMX'], 100),
      trackNode('B073N3R1KZ', 'Eisenherz', [['Juli', 'PRIMARY']], ['In Love', 'B073HX454H'], 276)
    ]);
    const out = searchTracksFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.tracks).toHaveLength(1);
    expect(out.tracks[0].asin).toBe('B073N3R1KZ');
  });

  test('no specificationSearch envelope is a structural failure — the caller must not cache a miss', () => {
    // A hornet rename of the response field. envelope false tells the caller
    // to throw not-ready instead of returning [].
    expect(searchTracksFromGql({ data: { renamedSearch: {} } })).toEqual({ tracks: [], envelope: false });
    expect(searchTracksFromGql({ data: null })).toEqual({ tracks: [], envelope: false });
    expect(searchTracksFromGql(null)).toEqual({ tracks: [], envelope: false });
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
    const b = createSearchBreaker({ threshold: 3, cooldownMs: 600000, now: step });
    expect(b.allows()).toBe(true);
    b.recordFailure();
    b.recordFailure();
    expect(b.allows()).toBe(true);
    b.recordFailure();
    expect(b.allows()).toBe(false);
    expect(b.state()).toEqual({ failures: 3, openUntil: 600001, open: true });
  });

  test('a success closes it; a probe after the cooldown re-opens on failure', () => {
    const b = createSearchBreaker({ threshold: 2, cooldownMs: 100, now: step });
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
    const b = createSearchBreaker({ threshold: 3, cooldownMs: 100, now: step });
    b.recordFailure();
    b.recordFailure();
    b.recordSuccess();
    b.recordFailure();
    b.recordFailure();
    expect(b.allows()).toBe(true);
  });
});

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
      'x-amzn-device-id': '14354613042605242',
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

describe('playlistTrackFromGqlEdge', () => {
  const edge = (node) => ({ node });

  test('maps a track node with artists, album, and duration', () => {
    const track = playlistTrackFromGqlEdge(edge({
      id: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      duration: 317,
      contributingArtists: {
        edges: [
          { role: 'PRIMARY', node: { name: 'Quiet Riot' } },
          { role: 'FEATURED', node: { name: 'Someone Else' } }
        ]
      },
      album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' },
      images: [{ url: 'https://m.media-amazon.com/images/I/500.jpg', width: 500, height: 500, imageType: 'PRIMARY' }, { url: 'https://m.media-amazon.com/images/I/1400.jpg', width: 1400, height: 1400, imageType: 'PRIMARY' }]
    }));
    expect(track).toEqual({
      asin: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      artist: 'Quiet Riot',
      album: 'Metal Health',
      albumAsin: 'B00136JQEQ',
      // Widest imageType=PRIMARY image — the search flow surfaces it as art;
      // the playlist detail response carries no track images, so it is null
      // there.
      albumArt: 'https://m.media-amazon.com/images/I/1400.jpg',
      duration: 317,
      explicit: false
    });
  });

  test('strips Amazon\'s in-title explicit marker and sets the flag instead', () => {
    const track = playlistTrackFromGqlEdge(edge({
      id: 'B0H7NMPYBC',
      title: 'Kunnioita [Explicit]',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Turmion Kätilöt' } }] },
      album: { id: 'B0H7NSSY32', shortTitle: 'Resodance' }
    }));
    expect(track.title).toBe('Kunnioita');
    expect(track.explicit).toBe(true);
    // A title that is ONLY the marker is garbage — drop the row.
    expect(playlistTrackFromGqlEdge(edge({
      id: 'B1', title: '[Explicit]',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] }
    }))).toBeNull();
  });

  test('joins multiple artists when none are PRIMARY, and falls back to the album title', () => {
    const track = playlistTrackFromGqlEdge(edge({
      id: 'B1',
      title: 'Song',
      contributingArtists: { edges: [{ node: { name: 'A' } }, { role: 'FEATURED', node: { name: 'B' } }] },
      album: { id: 'B2', title: 'Full Album Title' }
    }));
    expect(track.artist).toBe('A, B');
    expect(track.album).toBe('Full Album Title');
    expect(track.albumArt).toBeNull();
  });

  test('drops rows without asin, title, or artist', () => {
    expect(playlistTrackFromGqlEdge(edge({ id: 'B1', title: 'No artists', contributingArtists: { edges: [] } }))).toBeNull();
    expect(playlistTrackFromGqlEdge(edge({ title: 'No asin', contributingArtists: { edges: [{ node: { name: 'A' } }] } }))).toBeNull();
    expect(playlistTrackFromGqlEdge(null)).toBeNull();
  });

  test('drops non-Track nodes when __typename says so, and allows its absence', () => {
    // The search response asks for __typename; the playlist detail response
    // does not. An Album node must never import as a track (its ASIN in the
    // track slot plays the wrong thing), but an absent __typename is normal
    // playlist data.
    expect(playlistTrackFromGqlEdge(edge({
      __typename: 'Album', id: 'B0ALBUM123', title: 'Kid A',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Radiohead' } }] }
    }))).toBeNull();
    expect(playlistTrackFromGqlEdge(edge({
      id: 'B1', title: 'Song', contributingArtists: { edges: [{ node: { name: 'A' } }] }
    }))).not.toBeNull();
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

describe('playlistFromGql', () => {
  const gqlPlaylist = (overrides = {}) => ({
    id: 'PP6417A00A9C99470BBC8834FF3BF6009A',
    title: 'My Discovery Mix',
    trackCount: 2,
    images: [
      { url: 'https://m.media-amazon.com/images/I/banner.jpg', width: 4188, height: 2094, imageType: null },
      { url: 'https://m.media-amazon.com/images/I/cover.jpg', width: 2400, height: 2400, imageType: 'PRIMARY' }
    ],
    curator: { name: 'Amazon' },
    tracks: {
      edges: [
        { node: { id: 'B00136J8K8', title: 'Metal Health (Bang Your Head)', duration: 317, contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Quiet Riot' } }] }, album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' } } },
        { node: { id: 'B07XLSKGGK', title: 'Master of Puppets (Remastered)', duration: 515, contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Metallica' } }] }, album: { id: 'B000031W1M', shortTitle: 'Master of Puppets' } } }
      ]
    },
    ...overrides
  });

  test('maps the response playlist with the PRIMARY cover', () => {
    const out = playlistFromGql({ playlist: gqlPlaylist() });
    expect(out.id).toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(out.name).toBe('My Discovery Mix');
    expect(out.owner).toBe('Amazon');
    expect(out.albumArt).toBe('https://m.media-amazon.com/images/I/cover.jpg');
    expect(out.trackCount).toBe(2);
    expect(out.tracks).toHaveLength(2);
    expect(out.tracks[0]).toEqual({
      asin: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      artist: 'Quiet Riot',
      album: 'Metal Health',
      albumAsin: 'B00136JQEQ',
      albumArt: null,
      duration: 317,
      explicit: false
    });
  });

  test('null playlist (deleted/private) maps to null, not an empty import', () => {
    expect(playlistFromGql({ playlist: null })).toBeNull();
    expect(playlistFromGql(null)).toBeNull();
  });

  test('curator variants: string curator, algorithmic null curator, widest non-PRIMARY fallback', () => {
    expect(playlistFromGql({ playlist: gqlPlaylist({ curator: 'Rhino' }) }).owner).toBe('Rhino');
    expect(playlistFromGql({ playlist: gqlPlaylist({ curator: null }) }).owner).toBeNull();
    const noPrimary = playlistFromGql({
      playlist: gqlPlaylist({ images: [{ url: 'https://x/small.jpg', width: 300, imageType: null }, { url: 'https://x/big.jpg', width: 3000, imageType: null }] })
    });
    expect(noPrimary.albumArt).toBe('https://x/big.jpg');
  });
});

describe('playlistPageInfoFromGql', () => {
  test('reads the connection pageInfo when present', () => {
    const data = { playlist: { tracks: { pageInfo: { hasNextPage: true, endCursor: 'CUR_100', token: 'TOKEN_100' } } } };
    expect(playlistPageInfoFromGql(data)).toEqual({ hasNextPage: true, endCursor: 'CUR_100', token: 'TOKEN_100' });
  });

  test('last page: hasNextPage false still carries the cursor', () => {
    const data = { playlist: { tracks: { pageInfo: { hasNextPage: false, endCursor: 'CUR_977', token: 'TOKEN_977' } } } };
    expect(playlistPageInfoFromGql(data)).toEqual({ hasNextPage: false, endCursor: 'CUR_977', token: 'TOKEN_977' });
  });

  test('absent pageInfo (or absent playlist) maps to null — caller falls back to scroll', () => {
    expect(playlistPageInfoFromGql({ playlist: { tracks: {} } })).toBeNull();
    expect(playlistPageInfoFromGql({ playlist: null })).toBeNull();
    expect(playlistPageInfoFromGql(null)).toBeNull();
  });

  test('partial pageInfo: missing fields are null, not undefined', () => {
    expect(playlistPageInfoFromGql({ playlist: { tracks: { pageInfo: { hasNextPage: true } } } }))
      .toEqual({ hasNextPage: true, endCursor: null, token: null });
  });
});

describe('playlistEdgesFromGql', () => {
  const edge = (asin, title) => ({ node: { id: asin, title } });

  test('the playlistDetail envelope: data.playlist.tracks.edges', () => {
    const data = { playlist: { tracks: { edges: [edge('B1', 'One'), edge('B2', 'Two')] } } };
    expect(playlistEdgesFromGql(data)).toHaveLength(2);
  });

  test('a different envelope is found by the shape scan (continuation operations can rename it)', () => {
    const data = { playlistTracks: { edges: [edge('B1', 'One')] } };
    expect(playlistEdgesFromGql(data)).toHaveLength(1);
  });

  test('nothing edge-shaped maps to null, not an empty array', () => {
    expect(playlistEdgesFromGql({ playlist: { tracks: {} } })).toBeNull();
    expect(playlistEdgesFromGql(null)).toBeNull();
    expect(playlistEdgesFromGql({ other: { edges: [{}] } })).toBeNull();
  });
});









describe('paginatePlaylistTracks', () => {
  const edge = (position, asin, title) => ({
    cursor: `${position}:dfeab136-0000-0000-0000-${String(position).padStart(12, '0')}`,
    node: asin == null ? null : {
      id: asin,
      title: title || `Track ${asin}`,
      duration: 200,
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Artist' } }] },
      album: { id: 'B0ALBUM', shortTitle: 'Album' }
    }
  });
  const pageData = (positions, over = {}) => ({
    playlist: {
      id: 'PP1',
      title: 'Test',
      trackCount: over.trackCount != null ? over.trackCount : positions.length,
      tracks: {
        edges: positions.map(p => (Array.isArray(p) ? edge(p[0], p[1], p[2]) : edge(p, 'B0' + String(p).padStart(8, '0')))),
        pageInfo: over.pageInfo != null ? over.pageInfo : { hasNextPage: false }
      }
    }
  });
  const pageInfo = (over = {}) => ({ hasNextPage: true, endCursor: '99:x', token: 'TOKEN', ...over });
  // fetchPage over a script of canned pages; records the tokens it was called with
  const fetcher = (pages) => {
    const calls = [];
    const fn = async (token) => {
      calls.push(token);
      const next = pages.shift();
      if (!next) return { error: 'no more pages' };
      if (next.error) return { error: next.error };
      return { data: next.data };
    };
    fn.calls = calls;
    return fn;
  };

  test('follows the token page over page until trackCount is reached', async () => {
    const first = pageData([0, 1], { trackCount: 4, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([2, 3], { trackCount: 4, pageInfo: pageInfo({ token: 'T2' }) }) }
    ];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('complete');
    expect(r.pages).toBe(1);
    expect(r.playlist.tracks).toHaveLength(4);
    expect(r.playlist.trackCount).toBe(4);
  });

  test('no token on the first page and hasNextPage false both end naturally (exhausted)', async () => {
    const noToken = await paginatePlaylistTracks({
      firstPageData: pageData([0, 1], { trackCount: 5, pageInfo: pageInfo({ token: null }) }),
      fetchPage: fetcher([])
    });
    expect(noToken.stop).toBe('exhausted');
    expect(noToken.pages).toBe(0);
    expect(noToken.playlist.tracks).toHaveLength(2);

    const lastPage = await paginatePlaylistTracks({
      firstPageData: pageData([0, 1], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) }),
      fetchPage: fetcher([{ data: pageData([2], { trackCount: 3, pageInfo: { hasNextPage: false, token: null } }) }])
    });
    expect(lastPage.stop).toBe('exhausted');
    expect(lastPage.playlist.tracks).toHaveLength(3);
  });

  test('a page that is entirely delisted rows (node:null) advances — mapped zero is not a stop', async () => {
    // review feedback on #1072: an all-null page used to end the import even
    // though later pages exist.
    const first = pageData([0], { trackCount: 4, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([[100, null], [101, null]], { trackCount: 4, pageInfo: pageInfo({ token: 'T2' }) }) },
      { data: pageData([200, 201], { trackCount: 4, pageInfo: { hasNextPage: false, token: null } }) }
    ];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('exhausted');
    expect(r.pages).toBe(2);
    expect(r.playlist.tracks.map(t => t.asin)).toHaveLength(3); // row 0 + rows 200-201
  });

  test('a duplicate track first on two consecutive pages advances — the cursor distinguishes windows', async () => {
    // review feedback on #1072: same asin first on consecutive pages used to
    // read as a repeated window.
    const first = pageData([[0, 'BDUP', 'First']], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([[100, 'BDUP', 'Dup again'], [101, 'B0X', 'Other']], { trackCount: 5, pageInfo: pageInfo({ token: 'T2' }) }) },
      { data: pageData([200], { trackCount: 4, pageInfo: { hasNextPage: false, token: null } }) }
    ];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('exhausted');
    expect(r.playlist.tracks).toHaveLength(4);
    expect(r.playlist.tracks.filter(t => t.asin === 'BDUP')).toHaveLength(2);
  });

  test('a repeated window (same first cursor) stops with no-advance', async () => {
    const first = pageData([0], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([100, 101], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) }) },
      { data: pageData([100, 101], { trackCount: 5, pageInfo: pageInfo({ token: 'T1' }) }) }
    ];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('no-advance');
    expect(r.pages).toBe(2);
    expect(r.playlist.tracks).toHaveLength(3); // first page + one real page
  });

  test('a page error stops and keeps what merged (page-error)', async () => {
    const first = pageData([0], { trackCount: 9, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [{ error: 'Amazon playlist query failed (500)' }];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('page-error');
    expect(r.playlist.tracks).toHaveLength(1);
  });

  test('an empty page (zero raw edges) stops (empty-page)', async () => {
    const first = pageData([0], { trackCount: 9, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [{ data: pageData([], { trackCount: 9, pageInfo: pageInfo({ token: 'T2' }) }) }];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    expect(r.stop).toBe('empty-page');
    expect(r.playlist.tracks).toHaveLength(1);
  });

  test('the page cap stops the loop (page-limit)', async () => {
    const first = pageData([0], { trackCount: 9999, pageInfo: pageInfo({ token: 'T0' }) });
    const pages = [];
    for (let i = 1; i <= 10; i++) pages.push({ data: pageData([i * 100], { trackCount: 9999, pageInfo: pageInfo({ token: 'T' + i }) }) });
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages), maxPages: 3 });
    expect(r.stop).toBe('page-limit');
    expect(r.pages).toBe(3);
    expect(r.playlist.tracks).toHaveLength(4); // first page + 3
  });

  test('the time cap stops the loop (time-limit)', async () => {
    let clock = 0;
    const first = pageData([0], { trackCount: 9999, pageInfo: pageInfo({ token: 'T0' }) });
    const pages = [];
    for (let i = 1; i <= 10; i++) pages.push({ data: pageData([i * 100], { trackCount: 9999, pageInfo: pageInfo({ token: 'T' + i }) }) });
    const r = await paginatePlaylistTracks({
      firstPageData: first,
      fetchPage: fetcher(pages),
      maxMs: 1000,
      now: () => (clock += 400) // crosses the cap on the third check
    });
    expect(r.stop).toBe('time-limit');
    expect(r.playlist.tracks.length).toBeGreaterThanOrEqual(1);
  });

  test('a null first page (deleted/private) reports no-playlist', async () => {
    const r = await paginatePlaylistTracks({ firstPageData: { playlist: null }, fetchPage: fetcher([]) });
    expect(r.playlist).toBeNull();
    expect(r.stop).toBe('no-playlist');
  });

  test('trackCount can grow from later responses', async () => {
    const first = pageData([0], { trackCount: 2, pageInfo: pageInfo({ token: 'T1' }) });
    const pages = [
      { data: pageData([100], { trackCount: 3, pageInfo: pageInfo({ token: 'T2' }) }) },
      { data: pageData([200], { trackCount: 3, pageInfo: { hasNextPage: false, token: null } }) }
    ];
    const r = await paginatePlaylistTracks({ firstPageData: first, fetchPage: fetcher(pages) });
    // trackCount grew to 3 and the second page reached it — complete, not exhausted
    expect(r.stop).toBe('complete');
    expect(r.playlist.trackCount).toBe(3);
    expect(r.playlist.tracks).toHaveLength(3);
  });
});

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

describe('amazonAlbumSearchUrl', () => {
  test('the albums tab carries the same quoted-or query as the songs search', () => {
    expect(amazonAlbumSearchUrl({ title: 'Dulling the Horns', artist: 'Wild Pink' })).toEqual({
      url: 'https://music.amazon.com/search/' + encodeURIComponent('"Dulling the Horns" "Wild Pink" OR "Wild Pink" "Dulling the Horns"') + '/albums',
      searchText: '"Dulling the Horns" "Wild Pink" OR "Wild Pink" "Dulling the Horns"'
    });
  });

  test('free text passes through, onto the albums tab', () => {
    expect(amazonAlbumSearchUrl('wild pink')).toEqual({
      url: 'https://music.amazon.com/search/wild%20pink/albums',
      searchText: 'wild pink'
    });
  });

  test('a single artist term is still quoted', () => {
    expect(amazonAlbumSearchUrl({ artist: 'Wild Pink' })).toEqual({
      url: 'https://music.amazon.com/search/' + encodeURIComponent('"Wild Pink"') + '/albums',
      searchText: '"Wild Pink"'
    });
  });

  test('nothing to search returns null', () => {
    expect(amazonAlbumSearchUrl({})).toBeNull();
    expect(amazonAlbumSearchUrl({ title: '  ', artist: '' })).toBeNull();
  });
});

describe('amazonAlbumAsinFromUrl', () => {
  test('parses the canonical album URL', () => {
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJL')).toBe('B07558DQJL');
  });

  test('tolerates the ?ref= tracker the search response carries, trailing slashes and lowercase', () => {
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJL?ref=dm_ff_amazonmusic_greenhornet_web')).toBe('B07558DQJL');
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/albums/b07558dqjl/')).toBe('B07558DQJL');
  });

  test('not an album URL — including a 9- or 11-char id — is null', () => {
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/tracks/B07554FHF5')).toBeNull();
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A')).toBeNull();
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJ')).toBeNull();
    expect(amazonAlbumAsinFromUrl('https://music.amazon.com/albums/B07558DQJLL')).toBeNull();
    expect(amazonAlbumAsinFromUrl('https://example.com/albums/B07558DQJL')).toBeNull();
    expect(amazonAlbumAsinFromUrl('')).toBeNull();
    expect(amazonAlbumAsinFromUrl(null)).toBeNull();
  });
});

describe('amazonSpecSearchRequest album spec', () => {
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

  test('the album spec is accepted only with { spec: "album" }', () => {
    expect(amazonSpecSearchRequest([search('wild pink', 'album')], 'wild pink', { spec: 'album' }).variables.specType).toBe('album');
    // Album mode must not accept the track spec — mirror of the track-side
    // rule that an album ASIN never lands in the track slot.
    expect(amazonSpecSearchRequest([search('wild pink', 'track')], 'wild pink', { spec: 'album' })).toBeNull();
    // A body with no specType at all is still accepted (older deploys); the
    // album parser itself drops any non-Album nodes in that response.
    expect(amazonSpecSearchRequest([search('wild pink', undefined)], 'wild pink', { spec: 'album' })).not.toBeNull();
  });

  test('the default mode never matches the album spec no matter the order the page fired them', () => {
    const bodies = [search('wild pink', 'album'), search('wild pink', 'track')];
    expect(amazonSpecSearchRequest(bodies, 'wild pink').variables.specType).toBe('track');
    expect(amazonSpecSearchRequest(bodies, 'wild pink', { spec: 'album' }).variables.specType).toBe('album');
  });
});

// The album-detail request the album page fires (live-captured 2026-10):
// AlbumDetailPage, variables.id = the ASIN, an APQ hash that renumbers per
// hornet redeploy.
describe('amazonAlbumDetailRequest / amazonAlbumDetailCandidates', () => {
  const detail = (asin, operationName = 'AlbumDetailPage') => JSON.stringify({
    operationName,
    variables: { id: asin, isAuthenticated: true, includeMerch: true, includeAlbumAbout: false },
    extensions: {
      clientLibrary: { name: '@apollo/client', version: '4.1.6' },
      persistedQuery: { version: 1, sha256Hash: 'f4920eac7f471a63a36f569ecee41972789a03b6342013f3a5781c78f6d7ce55' }
    }
  });

  test('finds the album-detail request for our ASIN among everything the page fires', () => {
    const bodies = [
      JSON.stringify({ operationName: 'IdentityStoreSeed', variables: {} }),
      JSON.stringify({ operationName: 'Transport', variables: { id: 'mrn:x' } }),
      detail('B07558DQJL'),
      '{not json'
    ];
    const req = amazonAlbumDetailRequest(bodies, 'b07558dqjl');
    expect(req.operationName).toBe('AlbumDetailPage');
    expect(req.variables.id).toBe('B07558DQJL');
    expect(req.extensions.persistedQuery.sha256Hash).toBe('f4920eac7f471a63a36f569ecee41972789a03b6342013f3a5781c78f6d7ce55');
  });

  test('batch arrays are tolerated, and another album\'s detail is not ours', () => {
    const batch = JSON.stringify([
      { operationName: 'AppChromeHeaderLeft', variables: {} },
      JSON.parse(detail('B07H76H4F1'))
    ]);
    expect(amazonAlbumDetailRequest([batch], 'B07H76H4F1')).not.toBeNull();
    expect(amazonAlbumDetailRequest([batch], 'B07558DQJL')).toBeNull();
  });

  test('the detail op ranks first, then other album-named reads, then (with anyName) any read carrying the ASIN', () => {
    // Live-captured 2026-10: the real album page fires AlbumSeo (header-only)
    // with the same variables.id BEFORE AlbumDetailPage. First-arrival is
    // never the winner: candidates come back detail-named first.
    const seo = detail('B07558DQJL', 'AlbumSeo');
    const stray = JSON.stringify({ operationName: 'PlaybackContextSeed', variables: { id: 'B07558DQJL' } });
    const bodies = [seo, detail('B07558DQJL'), stray];
    expect(amazonAlbumDetailCandidates(bodies, 'B07558DQJL').map(r => r.operationName))
      .toEqual(['AlbumDetailPage', 'AlbumSeo']);
    // default excludes the stray entirely — an unrelated read that happens to
    // carry the ASIN must not be replayed as the album detail
    expect(amazonAlbumDetailRequest([stray], 'B07558DQJL')).toBeNull();
    // { anyName: true } appends it last (the caller's rename hedge) and the
    // ranked detail op still leads
    expect(amazonAlbumDetailCandidates(bodies, 'B07558DQJL', { anyName: true }).map(r => r.operationName))
      .toEqual(['AlbumDetailPage', 'AlbumSeo', 'PlaybackContextSeed']);
    expect(amazonAlbumDetailRequest([stray], 'B07558DQJL', { anyName: true }).operationName).toBe('PlaybackContextSeed');
    expect(amazonAlbumDetailRequest(bodies, 'B07558DQJL', { anyName: true }).operationName).toBe('AlbumDetailPage');
  });

  test('write-shaped operations for the same ASIN are never replayed', () => {
    expect(amazonAlbumDetailRequest([
      JSON.stringify({ operationName: 'recordAlbumView', variables: { id: 'B07558DQJL' } })
    ], 'B07558DQJL')).toBeNull();
    expect(amazonAlbumDetailRequest([
      JSON.stringify({ operationName: 'addToLibraryMutation', variables: { id: 'B07558DQJL' } })
    ], 'B07558DQJL')).toBeNull();
    expect(amazonAlbumDetailRequest([
      JSON.stringify({ operationName: 'LibraryWrite', query: ' mutation AddToLibrary($id: ID!) { x }', variables: { id: 'B07558DQJL' } })
    ], 'B07558DQJL')).toBeNull();
  });

  test('missing id and empty captures are null', () => {
    expect(amazonAlbumDetailRequest([JSON.stringify({ operationName: 'AlbumDetailPage', variables: {} })], 'B07558DQJL')).toBeNull();
    expect(amazonAlbumDetailRequest([], 'B07558DQJL')).toBeNull();
    expect(amazonAlbumDetailRequest(null, 'B07558DQJL')).toBeNull();
    expect(amazonAlbumDetailRequest([detail('B07558DQJL')], '')).toBeNull();
    expect(amazonAlbumDetailRequest([detail('B07558DQJL')], undefined)).toBeNull();
  });
});

// The album-spec SpecSearchSeeMorePage response (live-captured 2026-10, the
// "wild pink" search): edges under data.specificationSearch.result[] whose
// node is an ALBUM entity (id/title/shortTitle/contributingArtists/images/url
// — no releaseDate or trackCount in the search spec).
describe('searchAlbumsFromGql', () => {
  const albumNode = (id, title, shortTitle, artists, images, explicit) => ({
    __typename: 'Album',
    id,
    uri: 'mrn:1.0:catalog:album:asin:' + id + '?territory=US',
    title,
    shortTitle,
    images: images.map(([url, width, height]) => ({ url, width, height, imageType: 'PRIMARY', __typename: 'Image' })),
    playParams: {
      id: 'mrn:1.0:catalog:album:asin:' + id + '?territory=US',
      selections: ['PLAY', 'SHUFFLE', 'STATION'],
      __typename: 'PlayParams'
    },
    parentalSettings: { hasExplicitLanguage: explicit, __typename: 'ParentalSettings' },
    url: 'https://music.amazon.com/albums/' + id + '?ref=dm_ff_amazonmusic_greenhornet_web',
    contributingArtists: {
      edges: artists.map(a => ({ role: a[1], node: { name: a[0], __typename: 'Artist', id: a[2] || 'B00VNR8ILM' }, __typename: 'ArtistEdge' })),
      __typename: 'ArtistConnection'
    },
    likesContext: { state: 'NEUTRAL', __typename: 'LikesContext' }
  });
  const response = (edges, extra = {}) => ({
    specificationSearch: {
      id: 'search_3c00ab130b',
      searchText: 'wild pink',
      result: [
        {
          __typename: 'SpecificationSearchResult',
          pageInfo: { hasNextPage: !!edges.length, endCursor: null, token: edges.length ? '[redacted]' : null },
          label: 'requiredButUnused',
          edges: edges.map(node => ({ __typename: 'EntityEdge', node })),
          ...extra
        }
      ]
    }
  });

  test('maps the spec search album edges to the searchAlbums shape', () => {
    const data = response([
      albumNode('B0FMW6FYGN', 'Dulling The Horns (Deluxe Edition) [Explicit]', 'Dulling The Horns (Deluxe Edition)',
        [['Wild Pink', 'PRIMARY']],
        [['https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg', 2560, 2560], ['https://m.media-amazon.com/images/I/51mBZqGZpnL.jpg', 500, 500]],
        true),
      albumNode('B0GZ59Z25F', 'Still Coming Down [Explicit]', 'Still Coming Down',
        [['Wild Pink', 'PRIMARY']],
        [['https://m.media-amazon.com/images/I/91KofyX81wL.jpg', 2560, 2560], ['https://m.media-amazon.com/images/I/41RHRLzSB4L.jpg', 500, 500]],
        true),
      albumNode('B07CMLR17Z', 'Yolk in the Fur', 'Yolk in the Fur',
        [['Wild Pink', 'PRIMARY']],
        [['https://m.media-amazon.com/images/I/61t5hojNMAL.jpg', 1400, 1400], ['https://m.media-amazon.com/images/I/41FQ1rARzML.jpg', 500, 500]],
        false)
    ]);
    const out = searchAlbumsFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.albums).toEqual([
      {
        asin: 'B0FMW6FYGN',
        name: 'Dulling The Horns (Deluxe Edition)',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/91OrDh0ADYL.jpg',
        url: 'https://music.amazon.com/albums/B0FMW6FYGN',
        explicit: true
      },
      {
        asin: 'B0GZ59Z25F',
        name: 'Still Coming Down',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/91KofyX81wL.jpg',
        url: 'https://music.amazon.com/albums/B0GZ59Z25F',
        explicit: true
      },
      {
        asin: 'B07CMLR17Z',
        name: 'Yolk in the Fur',
        artist: 'Wild Pink',
        albumArt: 'https://m.media-amazon.com/images/I/61t5hojNMAL.jpg',
        url: 'https://music.amazon.com/albums/B07CMLR17Z',
        explicit: false
      }
    ]);
  });

  test('a Track edge in the album spec is dropped — the ASIN-in-the-wrong-slot guard, in reverse', () => {
    const track = {
      __typename: 'Track',
      id: 'B073N3R1KZ',
      title: 'Eisenherz',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'Juli', __typename: 'Artist' } }], __typename: 'ArtistConnection' },
      album: { id: 'B073HX454H', __typename: 'Album', shortTitle: 'In Love' },
      duration: 276
    };
    const out = searchAlbumsFromGql(response([track]));
    expect(out.envelope).toBe(true);
    expect(out.albums).toEqual([]);
  });

  test('a miss is a present envelope with empty edges; an absent envelope is structural', () => {
    const miss = searchAlbumsFromGql(response([]));
    expect(miss.envelope).toBe(true);
    expect(miss.albums).toEqual([]);
    expect(searchAlbumsFromGql({ somethingElse: {} })).toEqual({ albums: [], envelope: false });
    expect(searchAlbumsFromGql(null)).toEqual({ albums: [], envelope: false });
    expect(searchAlbumsFromGql(undefined)).toEqual({ albums: [], envelope: false });
  });

  test('an album node without an artist or a usable title is dropped', () => {
    expect(albumFromGqlSearchNode({ __typename: 'Album', id: 'B0X1', title: 'X' })).toBeNull();
    expect(albumFromGqlSearchNode({
      __typename: 'Album', id: 'B0X1', title: ' [Explicit]',
      contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] }
    })).toBeNull();
    expect(albumFromGqlSearchNode(null)).toBeNull();
    expect(albumFromGqlSearchNode({ __typename: 'Album', title: 'X', contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] } })).toBeNull();
  });
});

// The AlbumDetailPage response (live-captured 2026-10 for Master of Puppets /
// S&M2 / Enema Of The State): data.album with the full title, trackCount,
// releaseDate, images; tracksConnection.edges[] with NO pageInfo (a 100-track
// album answered whole), per-disc trackNumbers (1..n, 1..m) and no discNumber
// field anywhere.
describe('albumDetailFromGql', () => {
  const mopArtist = ['Metallica', 'PRIMARY'];
  const detailTrack = (id, title, shortTitle, trackNumber, duration, artists, explicit = false) => ({
    __typename: 'Track',
    id,
    uri: 'mrn:1.0:catalog:track:asin:' + id + '?territory=US',
    mediaType: 'AUDIO',
    title,
    shortTitle,
    images: [{ url: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg', width: 1200, height: 1200, imageType: 'PRIMARY', __typename: 'Image' }],
    contributingArtists: {
      edges: (artists || [mopArtist]).map(a => ({ role: a[1], node: { name: a[0], __typename: 'Artist' }, __typename: 'ArtistEdge' })),
      __typename: 'ArtistConnection'
    },
    album: { artistNames: 'Metallica', __typename: 'Album' },
    duration,
    trackNumber,
    parentalSettings: { hasExplicitLanguage: explicit, __typename: 'ParentalSettings' },
    url: 'https://music.amazon.com/tracks/' + id + '/?ref=dm_ff_amazonmusic_greenhornet_web'
  });
  const detailAlbum = (edges, over = {}) => ({
    __typename: 'Album',
    id: 'B07558DQJL',
    title: 'Master of Puppets (Remastered)',
    shortTitle: 'Master of Puppets',
    images: [
      { url: 'https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg', width: 1200, height: 1200, imageType: 'PRIMARY', __typename: 'Image' },
      { url: 'https://m.media-amazon.com/images/I/513OAf2edPL.jpg', width: 500, height: 500, imageType: 'PRIMARY', __typename: 'Image' }
    ],
    contributingArtists: {
      edges: [{ role: 'PRIMARY', node: { name: 'Metallica', __typename: 'Artist', id: 'B000QJPIHU' }, __typename: 'ArtistEdge' }],
      __typename: 'ArtistConnection'
    },
    trackCount: 8,
    duration: 3284,
    releaseDate: '1986-02-21T00:00:00.000Z',
    url: 'https://music.amazon.com/albums/B07558DQJL?ref=dm_ff_amazonmusic_greenhornet_web',
    parentalSettings: { hasExplicitLanguage: false, __typename: 'ParentalSettings' },
    tracksConnection: { __typename: 'TrackConnection', edges: edges.map(node => ({ __typename: 'TrackEdge', node })) },
    ...over
  });

  test('maps the album and its tracks, keeping the server trackCount over truncated edges', () => {
    const data = {
      album: detailAlbum([
        detailTrack('B07554FHF5', 'Battery (Remastered)', 'Battery', 1, 312),
        detailTrack('B0755C8JX3', 'Master Of Puppets (Remastered)', 'Master Of Puppets', 2, 515),
        detailTrack('B07555PLZZ', 'The Thing That Should Not Be (Remastered)', 'The Thing That Should Not Be', 3, 396)
      ])
    };
    const out = albumDetailFromGql(data);
    expect(out.envelope).toBe(true);
    expect(out.album.asin).toBe('B07558DQJL');
    // The full title, not shortTitle: editions distinguish releases. The
    // album URL is minted from the ASIN, dropping the ?ref= tracker.
    expect(out.album.name).toBe('Master of Puppets (Remastered)');
    expect(out.album.artist).toBe('Metallica');
    expect(out.album.albumArt).toBe('https://m.media-amazon.com/images/I/71RlRk9uwIL.jpg');
    expect(out.album.releaseDate).toBe('1986-02-21T00:00:00.000Z');
    expect(out.album.url).toBe('https://music.amazon.com/albums/B07558DQJL');
    expect(out.album.explicit).toBe(false);
    // Three edges parsed but the album says eight — the shortfall stays
    // visible for the caller to log, like a truncated playlist page.
    expect(out.album.trackCount).toBe(8);
    expect(out.album.tracks).toEqual([
      { asin: 'B07554FHF5', title: 'Battery (Remastered)', artist: 'Metallica', duration: 312, trackNumber: 1, explicit: false, discNumber: 1 },
      { asin: 'B0755C8JX3', title: 'Master Of Puppets (Remastered)', artist: 'Metallica', duration: 515, trackNumber: 2, explicit: false, discNumber: 1 },
      { asin: 'B07555PLZZ', title: 'The Thing That Should Not Be (Remastered)', artist: 'Metallica', duration: 396, trackNumber: 3, explicit: false, discNumber: 1 }
    ]);
  });

  test('disc numbers come from the trackNumber resets (S&M2: 1..10, 1..13)', () => {
    const live = (id, title, tn, dur) => detailTrack(id, title, title, tn, dur, [['Metallica', 'PRIMARY'], ['San Francisco Symphony', 'PRIMARY']]);
    const data = {
      album: detailAlbum([
        live('B0897X5B49', 'No Leaf Clover (Live)', 9, 330),
        live('B0897YX5BS', 'Halo on Fire (Live)', 10, 497),
        live('B0897X532Q', 'Intro to Scythian Suite (Live)', 1, 316),
        live('B0897YFYZW', 'Scythian Suite, Opus 20 II: The Enemy God And The Dance Of The Dark Spirits (Live)', 2, 219),
        live('B0897YDVKB', 'Intro to The Iron Foundry (Live)', 3, 62)
      ], {
        title: 'S&M2',
        contributingArtists: {
          edges: [
            { role: 'PRIMARY', node: { name: 'Metallica', __typename: 'Artist' }, __typename: 'ArtistEdge' },
            { role: 'PRIMARY', node: { name: 'San Francisco Symphony', __typename: 'Artist' }, __typename: 'ArtistEdge' }
          ],
          __typename: 'ArtistConnection'
        }
      })
    };
    const out = albumDetailFromGql(data);
    expect(out.album.artist).toBe('Metallica, San Francisco Symphony');
    expect(out.album.tracks.map(t => [t.trackNumber, t.discNumber])).toEqual([[9, 1], [10, 1], [1, 2], [2, 2], [3, 2]]);
    // Per-track artists survive (compilations), joined like the search mapper.
    expect(out.album.tracks[0].artist).toBe('Metallica, San Francisco Symphony');
  });

  test('the explicit flag comes from the title marker or parentalSettings (Enema Of The State)', () => {
    const data = {
      album: detailAlbum([
        detailTrack('B07H734KCX', 'Dumpweed [Explicit]', 'Dumpweed', 1, 144, [['blink-182', 'PRIMARY']], true),
        detailTrack('B07H7338V8', "Don't Leave Me", "Don't Leave Me", 2, 144, [['blink-182', 'PRIMARY']], false)
      ], {
        title: 'Enema Of The State [Explicit]',
        shortTitle: 'Enema Of The State',
        parentalSettings: { hasExplicitLanguage: true, __typename: 'ParentalSettings' }
      })
    };
    const out = albumDetailFromGql(data);
    expect(out.album.name).toBe('Enema Of The State');
    expect(out.album.explicit).toBe(true);
    expect(out.album.tracks[0].title).toBe('Dumpweed');
    expect(out.album.tracks[0].explicit).toBe(true);
    expect(out.album.tracks[1].explicit).toBe(false);
  });

  test('data.album null is the legitimate not-found, a missing album field is structural', () => {
    expect(albumDetailFromGql({ album: null })).toEqual({ album: null, envelope: true });
    expect(albumDetailFromGql({ somethingElse: {} })).toEqual({ album: null, envelope: false });
    expect(albumDetailFromGql(null)).toEqual({ album: null, envelope: false });
  });

  test('an album with no tracksConnection still maps, with an empty track list', () => {
    const album = detailAlbum([]);
    delete album.tracksConnection;
    const out = albumDetailFromGql({ album });
    expect(out.envelope).toBe(true);
    expect(out.album.tracks).toEqual([]);
    expect(out.album.trackCount).toBe(8);
  });
});

describe('albumTrackFromGqlEdge', () => {
  test('drops rows that are not tracks or lack the import fields', () => {
    expect(albumTrackFromGqlEdge(null)).toBeNull();
    expect(albumTrackFromGqlEdge({ node: null })).toBeNull();
    expect(albumTrackFromGqlEdge({ node: { __typename: 'Track', id: 'B0X1' } })).toBeNull();
    expect(albumTrackFromGqlEdge({
      node: {
        __typename: 'Track', id: 'B0X1', title: 'Song',
        contributingArtists: { edges: [{ role: 'FEATURED', node: {} }] }
      }
    })).toBeNull();
    // A non-Track typename (a row hornet added for a podcast) never maps.
    expect(albumTrackFromGqlEdge({
      node: {
        __typename: 'PodcastEpisode', id: 'B0X1', title: 'Song',
        contributingArtists: { edges: [{ role: 'PRIMARY', node: { name: 'A' } }] }
      }
    })).toBeNull();
  });
});

describe('assignDiscNumbers', () => {
  test('a trackNumber that does not advance starts a new disc; rows without one keep null', () => {
    const tracks = [
      { trackNumber: 1 }, { trackNumber: 2 }, { trackNumber: 1 }, { trackNumber: 2 },
      { title: 'untagged' }, { trackNumber: 3 }
    ];
    assignDiscNumbers(tracks);
    expect(tracks.map(t => t.discNumber)).toEqual([1, 1, 2, 2, null, 2]);
  });
});

describe('albumTracksConnectionIn', () => {
  // Live-captured 2026-10 (the Resodance capture): AlbumDetailPage's response
  // carries data.album.tracksConnection.edges; AlbumSeo's carries data.album
  // with title/trackCount and a bare `tracks` field — no tracksConnection.
  test('the detail response passes, the header-only SEO response does not', () => {
    expect(albumTracksConnectionIn({
      album: { id: 'B07558DQJL', title: 'Master of Puppets (Remastered)', tracksConnection: { __typename: 'TrackConnection', edges: [] } }
    })).toBe(true);
    expect(albumTracksConnectionIn({
      album: { id: 'B0H7NR1GWR', title: 'Resodance [Explicit]', trackCount: 12, tracks: { total: 12 } }
    })).toBe(false);
  });

  test('nulls and wrong shapes do not pass', () => {
    expect(albumTracksConnectionIn(null)).toBe(false);
    expect(albumTracksConnectionIn({})).toBe(false);
    expect(albumTracksConnectionIn({ album: null })).toBe(false);
    expect(albumTracksConnectionIn({ album: { tracksConnection: null } })).toBe(false);
    expect(albumTracksConnectionIn({ album: { tracksConnection: { edges: 'nope' } } })).toBe(false);
  });
});
