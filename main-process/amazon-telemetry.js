// amazon-telemetry.js — replicates hornet's /telemetry/v1/events streaming
// reports for the native playback path.
//
// Why: Amazon's web player reports streams (licensing-visible accounting —
// what streamed, when, how far, which tier). Moving playback in-process must
// not silently end that reporting. The vocabulary below is live-captured
// from the hornet page (2026-10): streamingInitiated on play start (and on
// resume after pause/scrub), streamingTerminated at seek/pause/teardown/end
// — trackScrub, userStop, systemStop, trackFinished — and trackStreamed
// paired with the FINAL terminated of a track, with durationSecondsSum
// accumulated across segments.
//
// Dependency-injected for tests: { post, context, now, randomUUID }.
//   post(envelope)      — one /telemetry/v1/events POST ({deviceId,
//                         deviceType, clientActionList})
//   context()           — { tier, territory, csrfToken, csrfRnd, csrfTs,
//                           deviceTimeZone, cdnType }
//   now()               — seconds (Date.now()/1000)
//   randomUUID()        — session ids
//
// Player events (from the renderer's shared widevine player):
//   play-started { asin, albumAsin?, durationMs?, initialDelaySeconds?,
//                  bitratesLabel?, cdnType? }
//   seek      { positionMs }
//   pause     { positionMs }
//   resume    { positionMs }
//   ended     { positionMs, durationMs }
//   stopped   { positionMs }   (teardown/skip/replace)

'use strict';

const {
  amazonClientAction,
  amazonStreamingDetails,
  amazonTelemetryBitrateLabel,
  AMAZON_DEVICE_TYPE_ID,
  TELEMETRY_TERMINATION
} = require('../amazon-music-logic');

function createAmazonTelemetry({ post, context, now, randomUUID } = {}) {
  const time = typeof now === 'function' ? now : () => Date.now() / 1000;
  const uuid = typeof randomUUID === 'function' ? randomUUID : () => require('crypto').randomUUID();
  const send = (actions) => {
    if (!actions.length || typeof post !== 'function') return;
    const ctx = typeof context === 'function' ? (context() || {}) : {};
    try {
      void Promise.resolve(post({
        deviceId: ctx.deviceId || null,
        deviceType: AMAZON_DEVICE_TYPE_ID,
        clientActionList: actions
      })).catch(() => {});
    } catch { /* telemetry never throws into playback */ }
  };

  const state = {
    customSessionId: uuid(), // one per app run (hornet's foreground session)
    playbackInstanceId: null,
    playQueueId: null,
    current: null, // { asin, albumAsin, bitratesLabel, cdnType, durationMs }
    segmentStartSecs: null,
    durationSumSecs: 0,
    trackTerminated: true
  };

  const ctxNow = () => (typeof context === 'function' ? (context() || {}) : {});
  const sdkEventId = () => uuid();

  const baseDetails = (extra) => {
    const ctx = ctxNow();
    return amazonStreamingDetails({
      asin: state.current && state.current.asin,
      albumAsin: state.current && state.current.albumAsin,
      territory: ctx.territoryId,
      tier: ctx.tier,
      resourceType: ctx.tier && /^UNLIMITED/.test(ctx.tier) ? 'UNLIMITED_MUSIC' : 'PRIME_MUSIC',
      playbackInstanceId: state.playbackInstanceId,
      playQueueId: state.playQueueId,
      subscriptionMode: ctx.tier,
      bitrates: state.current && state.current.bitratesLabel,
      cdnType: state.current && state.current.cdnType,
      customSessionId: state.customSessionId,
      csrf: ctx,
      deviceTimeZone: ctx.deviceTimeZone,
      ...extra
    });
  };

  const emit = (actionName, extra) => send([amazonClientAction(actionName, baseDetails(extra), {
    timestampSeconds: time(),
    sdkEventId: sdkEventId()
  })]);

  const emitPair = (reason, { segmentSecs, progressSecs, final = false } = {}) => {
    // streamingTerminated always; trackStreamed only for the track's FINAL
    // termination (hornet pairs it there with the aggregate only). Both are
    // built through ONE derivation (baseDetails) — re-serializing a flattened
    // entry through the builder drops subscription/csrf/fulfillment fields
    // and the territory (review B2).
    const terminated = baseDetails({
      durationSeconds: segmentSecs,
      durationSecondsSum: state.durationSumSecs,
      terminationReason: reason,
      trackProgress: progressSecs,
      trackCount: 1
    });
    const stamp = time();
    const actions = [amazonClientAction('streamingTerminated', terminated, { timestampSeconds: stamp, sdkEventId: sdkEventId() })];
    if (final) {
      // trackStreamed: same facts, minus the per-segment durationSeconds —
      // the aggregate travels in durationSecondsSum.
      const streamed = baseDetails({
        durationSecondsSum: state.durationSumSecs,
        terminationReason: reason,
        trackProgress: progressSecs,
        trackCount: 1
      });
      actions.push(amazonClientAction('trackStreamed', streamed, { timestampSeconds: stamp, sdkEventId: sdkEventId() }));
    }
    send(actions);
  };

  const segmentElapsedSecs = () => (state.segmentStartSecs == null ? 0 : Math.max(0, time() - state.segmentStartSecs));

  const closeSegment = (reason, progressSecs) => {
    if (!state.current || state.trackTerminated) return;
    const segmentSecs = segmentElapsedSecs();
    state.durationSumSecs += segmentSecs;
    state.segmentStartSecs = null;
    state.trackTerminated = true;
    emitPair(reason, { segmentSecs, progressSecs, final: true });
  };

  return {
    onPlayStarted({ asin, albumAsin, durationMs, initialDelaySeconds, bitratesLabel, variantFacts, cdnType } = {}) {
      if (!asin) return;
      // Replacing a track without an explicit stop: hornet's flow shows the
      // previous session closed as systemStop first.
      closeSegment(TELEMETRY_TERMINATION.systemStop, 0);
      state.playbackInstanceId = uuid();
      state.playQueueId = uuid();
      const label = bitratesLabel || (variantFacts ? amazonTelemetryBitrateLabel(variantFacts) : null);
      state.current = {
        asin: String(asin),
        albumAsin: albumAsin ? String(albumAsin) : null,
        durationMs: Number(durationMs) || 0,
        bitratesLabel: label,
        cdnType: cdnType || null
      };
      state.durationSumSecs = 0;
      state.segmentStartSecs = time();
      state.trackTerminated = false;
      emit('streamingInitiated', {
        timestamp: String(Math.round(time())),
        initialPlaybackDelaySeconds: initialDelaySeconds != null
          ? String(Number(initialDelaySeconds).toFixed(3))
          : undefined
      });
    },

    onSeek({ positionMs } = {}) {
      if (!state.current || state.trackTerminated) return;
      const segmentSecs = segmentElapsedSecs();
      state.durationSumSecs += segmentSecs;
      state.segmentStartSecs = time();
      emitPair(TELEMETRY_TERMINATION.scrub, { segmentSecs, progressSecs: Math.round((Number(positionMs) || 0) / 1000) });
      // A scrub opens a new segment with a fresh initiated, matching hornet.
      emit('streamingInitiated', { timestamp: String(Math.round(time())) });
    },

    onPause({ positionMs } = {}) {
      if (!state.current || state.trackTerminated) return;
      const segmentSecs = segmentElapsedSecs();
      state.durationSumSecs += segmentSecs;
      state.segmentStartSecs = null;
      state.trackTerminated = true;
      emitPair(TELEMETRY_TERMINATION.userStop, { segmentSecs, progressSecs: Math.round((Number(positionMs) || 0) / 1000) });
    },

    onResume(_args) {
      if (!state.current || !state.trackTerminated) return;
      state.segmentStartSecs = time();
      state.trackTerminated = false;
      emit('streamingInitiated', { timestamp: String(Math.round(time())) });
    },

    onEnded({ positionMs, durationMs } = {}) {
      if (!state.current) return;
      const segmentSecs = state.trackTerminated ? 0 : segmentElapsedSecs();
      state.durationSumSecs += segmentSecs;
      state.segmentStartSecs = null;
      state.trackTerminated = true;
      const durationSecs = Math.round(((Number(durationMs) > 0 ? Number(durationMs) : 0) || state.current.durationMs || Number(positionMs) || 0) / 1000);
      emitPair(TELEMETRY_TERMINATION.finished, { segmentSecs, progressSecs: durationSecs, final: true });
      state.current = null;
    },

    onStopped({ positionMs } = {}) {
      // Guard on the track session, not the open segment: pause-then-skip
      // still owes its FINAL trackStreamed (review I6; hornet's flow).
      if (!state.current) return;
      const segmentSecs = state.trackTerminated ? 0 : segmentElapsedSecs();
      state.durationSumSecs += segmentSecs;
      state.segmentStartSecs = null;
      state.trackTerminated = true;
      emitPair(TELEMETRY_TERMINATION.systemStop, { segmentSecs, progressSecs: Math.round((Number(positionMs) || 0) / 1000), final: true });
      state.current = null;
    },

    // debug visibility
    _state: state
  };
}

module.exports = { createAmazonTelemetry };
