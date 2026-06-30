// Spotify abuse-mode circuit breaker (parachord#956 audit §2b).
//
// Spotify rate-limits the WHOLE client_id, and an abuse-mode ban OUTLASTS its
// own Retry-After by 12+ hours. Honoring Retry-After + a per-call-tree retry cap
// can back off WITHIN one request chain but not ACROSS calls — the next op (next
// playlist, next sync tick, next user play) builds a fresh request and re-hammers
// the still-banned client_id, prolonging the ban for the whole client_id fleet.
//
// This breaker carries state ACROSS calls (and, when the caller persists the
// snapshot, across restarts): once a 429 exhausts retries, it OPENS with an
// escalating cooldown that fail-fasts every Spotify call until it expires; a
// successful call closes it and resets the escalation. Mirrors the LB-hydration
// cooldown pattern already in-tree. PURE — persistence is injected by the caller.

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// Escalating cooldown by consecutive trips: first ban 1h, repeats 6h (mobile parity).
function cooldownMsForLevel(level) {
  return level <= 1 ? 1 * HOUR_MS : 6 * HOUR_MS;
}

function createSpotifyBreaker() {
  let openUntil = 0;
  let level = 0;
  return {
    // Open right now? Caller should fail-fast (no API call) while true.
    isOpen(now) { return now < openUntil; },
    msRemaining(now) { return Math.max(0, openUntil - now); },
    // A 429 exhausted retries → open / escalate. Returns true (state changed).
    trip(now) {
      level += 1;
      openUntil = now + cooldownMsForLevel(level);
      return true;
    },
    // A successful Spotify call → close + reset escalation. Returns true iff it
    // actually changed state (so the caller only persists on a real transition).
    recordSuccess() {
      if (!openUntil && !level) return false;
      openUntil = 0;
      level = 0;
      return true;
    },
    snapshot() { return { openUntil, level }; },
    restore(s) {
      if (!s || typeof s !== 'object') return;
      openUntil = Number(s.openUntil) || 0;
      level = Number(s.level) || 0;
    },
  };
}

module.exports = { createSpotifyBreaker, cooldownMsForLevel, HOUR_MS };
