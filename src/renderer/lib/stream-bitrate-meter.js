'use strict';

// stream-bitrate-meter.js — the measured-bitrate core behind the shared
// players' streamQuality records (the root stream-quality.js contract).
//
// Input: Chromium's non-standard HTMLMediaElement.webkitAudioDecodedByteCount
// — the compressed audio bytes the pipeline has decoded so far — sampled
// against media time. Output: a running MEDIAN of short-window rates (kbps),
// the same measured-median shape the old hornet-era Amazon poller used, so
// one decode-ahead burst at load, one seek window or one pause-fattened
// window cannot move the number on its own.
//
// Fed by the two shared players, never by resolver code:
//   - the shared HTML5 audio element (ensureSharedAudioElement in
//     use-playback-engine.js samples it on timeupdate) for html5Stream
//     resolvers — Subsonic today — whose direct stream has no manifest to
//     read facts from;
//   - Bandcamp's embed page (bcState's decodedBytes in
//     main-process/bandcamp-embed-control.js, relayed through the adapter in
//     bandcamp-embed-player.js) — the same property read off the page's own
//     <audio> element, which the renderer cannot reach cross-origin.
// localfiles and the Widevine branch attach richer exact records (file parse,
// Shaka's active variant) and never feed this meter.
//
// The estimate describes the average of the last keepWindows windows — VBR
// tracks wander within it, and isStreamQualityChange's tolerance decides
// whether an update is worth a re-render. Pure module: plain Node for jest.

const DEFAULT_WINDOW_SECONDS = 2; // one rate sample per 2s of played media
const DEFAULT_KEEP_WINDOWS = 12; // the median spans the last ~24s
const DEFAULT_MIN_WINDOWS = 3; // no estimate before ~6s of closed windows

function medianOf(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  if (sorted.length % 2) return sorted[mid];
  return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

function positiveIntOr(value, fallback, min = 1) {
  return Number.isFinite(value) && value >= min ? Math.floor(value) : fallback;
}

function createStreamBitrateMeter(options = {}) {
  const windowSeconds = Number.isFinite(options.windowSeconds) && options.windowSeconds > 0
    ? options.windowSeconds
    : DEFAULT_WINDOW_SECONDS;
  const keepWindows = positiveIntOr(options.keepWindows, DEFAULT_KEEP_WINDOWS);
  const minWindows = positiveIntOr(options.minWindows, DEFAULT_MIN_WINDOWS);

  // A window this much longer than the sampling cadence is not contiguous
  // playback (a seek between samples, or a long stall while the page is
  // hidden): its byte/time ratio says nothing about the stream, so the window
  // is dropped and only the anchor advances.
  const maxWindowSeconds = windowSeconds * 5;

  let last = null; // { t, bytes } — the sample the next window closes against
  let rates = []; // kbps, one entry per closed window

  const estimate = () => (rates.length >= minWindows ? medianOf(rates) : null);

  /**
   * Feed one sample (media position in seconds, decoded audio bytes so far).
   * Returns the current median estimate (integer kbps) once enough windows
   * have closed, else null.
   */
  function sample(mediaSeconds, decodedBytes) {
    if (!Number.isFinite(mediaSeconds) || mediaSeconds < 0) return null;
    if (!Number.isFinite(decodedBytes) || decodedBytes < 0) return null;
    if (last) {
      const dt = mediaSeconds - last.t;
      const db = decodedBytes - last.bytes;
      // Bytes or position going backwards is a new load on the same element
      // (a new track restarts both counters): the meter restarts with it.
      if (dt < 0 || db < 0) {
        last = { t: mediaSeconds, bytes: decodedBytes };
        rates = [];
        return null;
      }
      if (dt >= windowSeconds) {
        // A window that decoded nothing (a decode stall, not a stream rate)
        // would poison the median with a 0 — skip it like a discontinuity.
        if (dt <= maxWindowSeconds && db > 0) {
          rates.push(Math.round((db * 8) / 1000 / dt));
          if (rates.length > keepWindows) rates.shift();
        }
        last = { t: mediaSeconds, bytes: decodedBytes };
      }
    } else {
      last = { t: mediaSeconds, bytes: decodedBytes };
    }
    return estimate();
  }

  function reset() {
    last = null;
    rates = [];
  }

  return { sample, estimate, reset };
}

module.exports = { createStreamBitrateMeter };
