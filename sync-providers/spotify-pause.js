// Spotify's rate-limit pause, one per process.
//
// A 429 from api.spotify.com carries Retry-After, and Spotify limits the whole
// client id: every endpoint answers 429 until it has passed, and requests sent
// meanwhile can stretch it. On 2026-11-15 it was 8940 s, while searches,
// playback polls and the sync kept going. So every Spotify call in a process
// checks one pause first, and any 429 it gets starts or extends that pause.
//
// The renderer gates its fetch (src/renderer/app.js, the fetch interceptor):
// plugin searches, playback controls, the artist-discography fallback. The
// main process uses `sharedPause` for the playback poller, the quit pause and
// the sync provider (sync-providers/spotify.js). PURE apart from that
// module-level instance.
//
// The pause outlives a restart and is shared by both processes (#909): main
// saves `sharedPause` to the store (`spotify_pause_until`) and restores it at
// startup; the renderer adopts main's on load and on every change, and hands
// its own 429s to main. `extendTo` adopts a pause known elsewhere and
// `onChange` hears every lengthening, so neither side ever shortens the other's
// and an echo between them stops at once.

const DEFAULT_RETRY_AFTER_S = 5;
// A Retry-After longer than this is treated as this: a corrupt header must not
// silence Spotify for days.
const MAX_PAUSE_MS = 24 * 60 * 60 * 1000;

function isSpotifyApiUrl(input) {
  try {
    const raw = typeof input === 'string' ? input : (input && input.url);
    if (!raw) return false;
    return new URL(raw).hostname === 'api.spotify.com';
  } catch (_e) {
    return false;
  }
}

function retryAfterMs(header) {
  const seconds = parseInt(header, 10);
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_S;
  return Math.min(s * 1000, MAX_PAUSE_MS);
}

function createSpotifyPause() {
  let until = 0;
  const listeners = new Set();
  // Lengthen the pause to `next`; tell the listeners. Never shortens.
  const raise = (next) => {
    if (!(next > until)) return false;
    until = next;
    for (const fn of listeners) {
      try { fn(until); } catch (_e) { /* a listener's failure isn't the pause's */ }
    }
    return true;
  };
  return {
    // Record a response: a 429 starts or extends the pause. Returns true when
    // this response started a pause (none was running), so the caller can tell
    // the user once.
    noteStatus(status, retryAfterHeader, now = Date.now()) {
      if (status !== 429) return false;
      const started = now >= until;
      raise(now + retryAfterMs(retryAfterHeader));
      return started;
    },
    // Adopt a pause known elsewhere (the saved one, or the other process's).
    // Only ever lengthens, ignores one already over or not a number, and never
    // reaches past MAX_PAUSE_MS from now (a corrupt saved value must not
    // silence Spotify for days). Returns true when it changed the pause.
    extendTo(untilMs, now = Date.now()) {
      const n = Number(untilMs);
      if (!Number.isFinite(n) || n <= now) return false;
      return raise(Math.min(n, now + MAX_PAUSE_MS));
    },
    // Hear every lengthening (from noteStatus or extendTo) with the new end
    // time. Returns the unsubscribe.
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    isPaused(now = Date.now()) { return now < until; },
    msRemaining(now = Date.now()) { return Math.max(0, until - now); },
    until() { return until; },
    // Tests only: the main-process instance is module-level.
    clear() { until = 0; listeners.clear(); },
  };
}

// What a paused call answers instead of a request: the same 429 Spotify would
// send, so every caller's existing 429 handling applies.
function pausedResponse(msRemaining) {
  const seconds = String(Math.max(1, Math.ceil(msRemaining / 1000)));
  return new Response(null, { status: 429, statusText: 'Too Many Requests (paused by Parachord)', headers: { 'Retry-After': seconds } });
}

const sharedPause = createSpotifyPause();

module.exports = { createSpotifyPause, sharedPause, isSpotifyApiUrl, retryAfterMs, pausedResponse, MAX_PAUSE_MS };
