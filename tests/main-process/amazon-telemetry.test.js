// Amazon telemetry state machine + builder shapes, against fixtures captured
// live from the hornet page (2026-10): streamingInitiated / streamingTerminated
// (trackScrub, userStop, systemStop, trackFinished) / trackStreamed (paired,
// carrying durationSecondsSum).

const { createAmazonTelemetry } = require('../../main-process/amazon-telemetry');

const CTX = {
  customerId: 'CUST1',
  marketplaceId: 'MKT',
  territoryId: 'US',
  region: 'NA',
  tier: 'UNLIMITED_HD',
  deviceId: '14354613042605242',
  csrfToken: 'tok-0123456789abcdef0123456789abcdef=',
  csrfRnd: '403697901',
  csrfTs: '1793304003',
  deviceTimeZone: '-07:00'
};

// A fixed sequence of UUIDs (deterministic fixtures).
function uuids(...values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function makeTelemetry({ posts = [], uuidsSeq } = {}) {
  let clock = 1000;
  const telemetry = createAmazonTelemetry({
    post: (envelope) => posts.push(envelope),
    context: () => CTX,
    now: () => clock,
    randomUUID: uuidsSeq || uuids('custom-session', 'inst-1', 'queue-1', 'evt-1', 'evt-2', 'inst-2', 'queue-2', 'evt-3', 'evt-4', 'evt-5', 'evt-6', 'evt-7', 'evt-8', 'evt-9')
  });
  return { telemetry, advance: (secs) => { clock += secs; }, getClock: () => clock };
}

const actions = (posts) => posts.flatMap((p) => p.clientActionList);
const byName = (posts, name) => actions(posts).filter((a) => a.actionName === name);

test('play-started emits streamingInitiated with hornet-shaped details', () => {
  const posts = [];
  const { telemetry } = makeTelemetry({ posts });
  telemetry.onPlayStarted({
    asin: 'B00CRMX53S', albumAsin: 'B00CRMWMZ0', durationMs: 369615,
    initialDelaySeconds: 0.148, variantFacts: { codec: 'flac', sampleRate: 48000, bitDepth: 24 }, cdnType: 'cf-d17vo8z6jop21h'
  });
  const init = byName(posts, 'streamingInitiated')[0];
  expect(init).toBeDefined();
  const d = init.additionalDetails;
  expect(d.asin).toBe('B00CRMX53S');
  expect(d.mrn).toBe('mrn:1.0:catalog:track:asin:B00CRMX53S?territory=US');
  expect(d.selectionSourceId).toBe('B00CRMWMZ0');
  expect(d.selectionSourceType).toBe('ALBUM');
  expect(d.contentSubscriptionMode).toBe('UNLIMITED_HD');
  expect(d.customSessionId).toBe('custom-session');
  expect(d.playbackInstanceId).toBe('inst-1');
  expect(d.playQueueId).toBe('queue-1');
  expect(d.mediaPlayerName).toBe('VINYL');
  expect(d.platformName).toBe('WebPlayer');
  expect(d.bitrates).toBe('UHD48');
  expect(d.initialPlaybackDelaySeconds).toBe('0.148');
  expect(d.csrf).toBe(JSON.stringify({ token: CTX.csrfToken, rnd: CTX.csrfRnd, ts: CTX.csrfTs }));
  expect(d.productId).toBe('803');
  expect(init.contentInfo).toEqual([]);
  // posts carry the device envelope
  expect(posts[0].deviceId).toBe(CTX.deviceId);
  expect(posts[0].deviceType).toBe('A16ZV8BU3SN1N3');
});

test('segment sums accumulate across seek/pause/resume; reasons map live', () => {
  const posts = [];
  const { telemetry, advance } = makeTelemetry({ posts });
  telemetry.onPlayStarted({ asin: 'B1', durationMs: 200000 });
  advance(10);
  telemetry.onSeek({ positionMs: 50000 }); // segment 1: 10s
  advance(30);
  telemetry.onPause({ positionMs: 90000 }); // segment 2: 30s
  telemetry.onResume({});
  advance(60);
  telemetry.onEnded({ positionMs: 200000, durationMs: 200000 }); // segment 3: 60s, sum 100s

  const terms = byName(posts, 'streamingTerminated');
  expect(terms.map((t) => t.additionalDetails.terminationReason)).toEqual(['trackScrub', 'userStop', 'trackFinished']);
  expect(terms[0].additionalDetails.durationSeconds).toBe('10');
  expect(terms[1].additionalDetails.durationSeconds).toBe('30');
  // the FINAL terminated pairs with trackStreamed carrying the aggregate
  const streamed = byName(posts, 'trackStreamed');
  expect(streamed).toHaveLength(1);
  const sum = streamed[0].additionalDetails;
  expect(sum.terminationReason).toBe('trackFinished');
  expect(sum.durationSecondsSum).toBe('100');
  expect(sum.trackProgress).toBe('200');
  expect(sum.durationSeconds).toBeUndefined();
  // review B2: the streamed pair must keep the SAME derived facts as its
  // terminated sibling (subscription/csrf/fulfillment/territory) — the old
  // re-serialization dropped them all.
  const termSibling = byName(posts, 'streamingTerminated').find((t) => t.additionalDetails.terminationReason === 'trackFinished');
  expect(sum.contentSubscriptionMode).toBe(termSibling.additionalDetails.contentSubscriptionMode);
  expect(sum.csrf).toBe(termSibling.additionalDetails.csrf);
  expect(sum.mrn).toBe(termSibling.additionalDetails.mrn);
  expect(sum.customSessionId).toBe(termSibling.additionalDetails.customSessionId);
  expect(sum.playbackInstanceId).toBe(termSibling.additionalDetails.playbackInstanceId);
  expect(JSON.stringify(sum)).not.toContain('NaN');
});

test('stopped (teardown/skip) closes with systemStop + trackStreamed', () => {
  const posts = [];
  const { telemetry, advance } = makeTelemetry({ posts });
  telemetry.onPlayStarted({ asin: 'B1', durationMs: 100000 });
  advance(42);
  telemetry.onStopped({ positionMs: 42000 });
  const streamed = byName(posts, 'trackStreamed');
  expect(streamed).toHaveLength(1);
  expect(streamed[0].additionalDetails.terminationReason).toBe('systemStop');
  expect(streamed[0].additionalDetails.durationSecondsSum).toBe('42');
  expect(streamed[0].additionalDetails.trackProgress).toBe('42');
});

test('a second play without an explicit stop closes the first as systemStop', () => {
  const posts = [];
  const { telemetry, advance } = makeTelemetry({ posts });
  telemetry.onPlayStarted({ asin: 'B1', durationMs: 100000 });
  advance(20);
  telemetry.onPlayStarted({ asin: 'B2', durationMs: 200000 });
  const streamed = byName(posts, 'trackStreamed');
  expect(streamed).toHaveLength(1);
  expect(streamed[0].additionalDetails.terminationReason).toBe('systemStop');
  expect(streamed[0].additionalDetails.durationSecondsSum).toBe('20');
  const inits = byName(posts, 'streamingInitiated');
  expect(inits).toHaveLength(2);
  expect(inits[1].additionalDetails.asin).toBe('B2');
});

test('idle events are no-ops (seek/pause/ended before any play)', () => {
  const posts = [];
  const { telemetry } = makeTelemetry({ posts });
  telemetry.onSeek({ positionMs: 1 });
  telemetry.onPause({ positionMs: 1 });
  telemetry.onEnded({ positionMs: 1, durationMs: 1 });
  telemetry.onStopped({ positionMs: 1 });
  expect(posts).toHaveLength(0);
});


test('pause-then-skip still emits the FINAL trackStreamed (review I6)', () => {
  const posts = [];
  const { telemetry, advance } = makeTelemetry({ posts });
  telemetry.onPlayStarted({ asin: 'B1', durationMs: 100000 });
  advance(30);
  telemetry.onPause({ positionMs: 30000 }); // segment closed, userStop pair
  advance(5);
  telemetry.onStopped({ positionMs: 30000 }); // skip while paused
  const streamed = byName(posts, 'trackStreamed');
  expect(streamed).toHaveLength(1);
  expect(streamed[0].additionalDetails.terminationReason).toBe('systemStop');
  expect(streamed[0].additionalDetails.durationSecondsSum).toBe('30');
});
