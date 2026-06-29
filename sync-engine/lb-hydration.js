// LB sync MBID-hydration flood guard (parachord#953, mirrors mobile #306/#308).
//
// `resolveTrackMbid` resolves a recording-MBID per track before a ListenBrainz
// push. Without a guard, an unresolved track is re-queried against the LB
// mapper / MusicBrainz on EVERY sync cycle — latent while the mapper is healthy,
// a flood when it's down (the mapper has been down for weeks: a single cycle
// fired ~2,359 lookups on mobile and got rate-limited). Two bounds fix it:
//
//   1. Per-cycle lookup BUDGET — cap live lookups so a big backlog drains over
//      several cycles instead of bursting. Resets after an idle gap (a new
//      cycle). The cap is the load-bearing part.
//   2. Persistent negative-cache with COOLDOWN — a resolved id is reused with no
//      lookup; a recent MISS is skipped within a cooldown window and re-tried
//      only after it expires, so community additions + mapper recovery still get
//      picked up, just not re-queried every sync. Two-step 7d → 30d (mobile parity).
//
// PURE. Persistence (electron-store) + the live mapper call are injected by the
// caller (main.js builds the context; sync-providers/listenbrainz.js consumes it).

const { validIsrc, validMbid, deriveNorm } = require('./playlist-merge');

const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_MISS_COOLDOWN_MS = 7 * DAY_MS;
const REPEAT_MISS_COOLDOWN_MS = 30 * DAY_MS;
const DEFAULT_BUDGET = 250;
// A gap longer than this since the last lookup is treated as a new sync cycle,
// so the budget refills. Cycles' lookups are bursty (seconds) and cycles are
// minutes apart, so this cleanly separates them without per-cycle plumbing.
const DEFAULT_IDLE_RESET_MS = 2 * 60 * 1000;

// Canonical identity key for the negative cache: ISRC > recording-MBID > norm.
// (In the live call path the MBID tier never fires — resolveTrackMbid returns a
// valid track.mbid before reaching hydration — but it's kept for fidelity to the
// cross-platform key contract.) Returns null when the track has no usable identity.
function hydrationKey(track) {
  if (!track) return null;
  const isrc = validIsrc(track.isrc);
  if (isrc) return `isrc:${isrc}`;
  const mbid = validMbid(track.recordingMbid) || validMbid(track.mbid);
  if (mbid) return `mbid:${mbid}`;
  const norm = deriveNorm(track.artist, track.title);
  return norm && norm !== '|' ? `norm:${norm}` : null;
}

function cooldownMs(entry) {
  return entry && entry.misses >= 2 ? REPEAT_MISS_COOLDOWN_MS : FIRST_MISS_COOLDOWN_MS;
}

// Should a LIVE lookup run for this cache entry now?
//   no entry        → yes (never attempted)
//   resolved (mbid) → no  (reuse, permanent)
//   miss            → only once its cooldown has elapsed
function shouldLookup(entry, now) {
  if (!entry) return true;
  if (entry.mbid) return false;
  return now - (entry.lastAttemptAt || 0) >= cooldownMs(entry);
}

// The next cache entry after a live attempt. A hit resets the miss streak; a
// miss increments it (so the second+ miss escalates to the longer cooldown).
function recordAttempt(entry, resolvedMbid, now) {
  if (resolvedMbid) return { mbid: resolvedMbid, lastAttemptAt: now, misses: 0 };
  return { mbid: null, lastAttemptAt: now, misses: ((entry && entry.misses) || 0) + 1 };
}

// Per-cycle live-lookup budget. `tryConsume(now)` returns false once the cycle's
// budget is exhausted; an idle gap > idleResetMs refills it (new cycle).
function createBudget(limit = DEFAULT_BUDGET, idleResetMs = DEFAULT_IDLE_RESET_MS) {
  let remaining = limit;
  let lastAt = 0;
  return {
    tryConsume(now) {
      if (lastAt && now - lastAt > idleResetMs) remaining = limit;
      lastAt = now;
      if (remaining <= 0) return false;
      remaining -= 1;
      return true;
    },
    remaining() { return remaining; },
  };
}

module.exports = {
  hydrationKey,
  shouldLookup,
  recordAttempt,
  createBudget,
  cooldownMs,
  FIRST_MISS_COOLDOWN_MS,
  REPEAT_MISS_COOLDOWN_MS,
  DEFAULT_BUDGET,
  DEFAULT_IDLE_RESET_MS,
};
