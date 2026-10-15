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
  pickTrackAsinFromIds,
  parseRowDurationSec,
  installAmazonRequireTrap,
  readPersistedQuality,
  writePersistedQuality,
  isAmazonSongResultItem,
  acceptAmazonSearchAnchor,
  asinFromPlayerUrl,
  amazonPlaylistIdFromUrl,
  amazonPlaylistDetailRequest,
  amazonGqlFetchHeaders,
  capturedOperationNames,
  playlistTrackFromGqlEdge,
  playlistFromGql,
  NEAR_END_MS,
  EMPTY_WHILE_PAUSED_POLL_LIMIT,
  measuredStreamKbps,
  QUALITY_MIN_PAIRS,
  QUALITY_PAIR_WINDOW,
  installAmazonStreamCapture,
  mpdAudioRepresentations,
  flacStreamInfoFromInit,
  attachInitStreamInfo,
  pickMpdRepresentation,
  amazonStreamTier,
  amazonStreamQualityRecord
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
  test('quotes title then artist and stays on the songs tab', () => {
    expect(amazonSongSearchUrl({ title: 'stations', artist: 'Warning' }))
      .toBe('https://music.amazon.com/search/%22stations%22%20%22Warning%22/songs');
  });

  test('still uses the songs tab when only one field is present', () => {
    expect(amazonSongSearchUrl({ title: 'stations' })).toMatch(/\/songs$/);
    expect(amazonSongSearchUrl({ artist: 'Warning' })).toMatch(/\/songs$/);
  });
});

describe('isAmazonSongResultItem', () => {
  test('accepts the songs tab row and the general search row', () => {
    expect(isAmazonSongResultItem('HorizontalItem,undefined')).toBe(true);
    expect(isAmazonSongResultItem('HorizontalItem,SearchResultsWidget_Item')).toBe(true);
    expect(isAmazonSongResultItem('TrackItem_Title')).toBe(false);
    expect(isAmazonSongResultItem('HorizontalItem,MiniPlayer_Title')).toBe(false);
  });
});

describe('pickTrackAsinFromIds', () => {
  test('picks the first track id that is not an ASIN the row links to', () => {
    // The album ASIN sorts first in the row (its link renders before the like
    // button); the artist ASIN sorts after. Only the track id survives.
    expect(pickTrackAsinFromIds(
      ['B0ALBUM000', 'B0TRACK001', 'B0ARTIST00'],
      ['B0ALBUM000', 'B0ARTIST00']
    )).toBe('B0TRACK001');
  });

  test('skips ids that are not 10-char B-prefixed ASINs', () => {
    expect(pickTrackAsinFromIds(['reaction-button', '0', 'B0TRACK001'], [])).toBe('B0TRACK001');
    expect(pickTrackAsinFromIds(['B0SHORT', 'B0TOOLONG00000'], [])).toBeNull();
    expect(pickTrackAsinFromIds(['b0lowerca1'], [])).toBe('B0LOWERCA1'); // case-insensitive
  });

  test('returns null when every candidate is a linked ASIN or nothing qualifies', () => {
    expect(pickTrackAsinFromIds(['B0ALBUM000'], ['B0ALBUM000'])).toBeNull();
    expect(pickTrackAsinFromIds([], [])).toBeNull();
    expect(pickTrackAsinFromIds(null, null)).toBeNull();
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

describe('parseRowDurationSec', () => {
  test('parses the shapes search rows render', () => {
    expect(parseRowDurationSec('Around the World Daft Punk 7 MIN 8 SEC Explicit')).toBe(428);
    expect(parseRowDurationSec('3 MIN')).toBe(180);
    expect(parseRowDurationSec('3:45')).toBe(225);
    expect(parseRowDurationSec('1:02:03')).toBe(3723);
    expect(parseRowDurationSec('45 SEC')).toBe(45);
  });

  test('returns 0 for localized or missing durations', () => {
    expect(parseRowDurationSec('Around the World Daft Punk')).toBe(0);
    expect(parseRowDurationSec('')).toBe(0);
    expect(parseRowDurationSec(null)).toBe(0);
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

describe('acceptAmazonSearchAnchor', () => {
  test('search page keeps rows that are not player chrome', () => {
    expect(acceptAmazonSearchAnchor(['SearchResultsWidget_Item'], true)).toBe(true);
    expect(acceptAmazonSearchAnchor([], true)).toBe(true);
    expect(acceptAmazonSearchAnchor(['MiniPlayer_Title'], true)).toBe(false);
    expect(acceptAmazonSearchAnchor([], false)).toBe(false);
  });
});

describe('amazonPlaylistIdFromUrl', () => {
  test('reads the id off shared/brand and my-music playlist pages', () => {
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/playlists/PP6417A00A9C99470BBC8834FF3BF6009A'))
      .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
    expect(amazonPlaylistIdFromUrl('https://music.amazon.com/my/playlists/PP6417A00A9C99470BBC8834FF3BF6009A?ref=dm_sh'))
      .toBe('PP6417A00A9C99470BBC8834FF3BF6009A');
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
      album: { id: 'B00136JQEQ', shortTitle: 'Metal Health' }
    }));
    expect(track).toEqual({
      asin: 'B00136J8K8',
      title: 'Metal Health (Bang Your Head)',
      artist: 'Quiet Riot',
      album: 'Metal Health',
      albumAsin: 'B00136JQEQ',
      duration: 317
    });
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
  });

  test('drops rows without asin, title, or artist', () => {
    expect(playlistTrackFromGqlEdge(edge({ id: 'B1', title: 'No artists', contributingArtists: { edges: [] } }))).toBeNull();
    expect(playlistTrackFromGqlEdge(edge({ title: 'No asin', contributingArtists: { edges: [{ node: { name: 'A' } }] } }))).toBeNull();
    expect(playlistTrackFromGqlEdge(null)).toBeNull();
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
      duration: 317
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
