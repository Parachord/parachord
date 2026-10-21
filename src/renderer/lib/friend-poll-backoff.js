// src/renderer/lib/friend-poll-backoff.js — stop re-asking for friends whose
// account answers the same failure every time.
//
// The friend poll runs every 2 minutes over every pinned or saved friend.
// A private Last.fm profile answers 403 and a deleted one 404, forever, so
// those were requested 720 times a day each. The weekly-stats refresh had
// the mirror problem: a failed or empty fetch never recorded an attempt, so
// every poll retried it for every such friend at once, in parallel, which is
// what tripped ListenBrainz's rate limit (429).
//
// Policy, per friend id:
// - 403 / 404 / 410 (the account is private or gone): wait 1 h, doubling on
//   each repeat, capped at 24 h. A success clears it.
// - 429 (rate limited): wait 10 min.
// - Anything else (5xx, network errors): no backoff; the 2-minute poll is
//   already the retry, and an outage should clear as soon as it is over.
// - Weekly stats: at most one attempt per friend per STATS_MAX_AGE_MS,
//   whatever the outcome.
//
// Pure (clock injected), so jest drives it directly
// (tests/renderer/friend-poll-backoff.test.js).

const HOUR = 60 * 60 * 1000;
const ACCOUNT_BACKOFF_BASE_MS = HOUR;
const ACCOUNT_BACKOFF_MAX_MS = 24 * HOUR;
const RATE_LIMIT_BACKOFF_MS = 10 * 60 * 1000;
const STATS_MAX_AGE_MS = 30 * 60 * 1000;
const ACCOUNT_STATUSES = new Set([403, 404, 410]);

function createFriendPollBackoff({ now = () => Date.now() } = {}) {
  const backoff = new Map(); // id -> { until, strikes }
  const statsAttemptAt = new Map(); // id -> ms

  return {
    // True while the friend's recent-track poll should be skipped.
    shouldSkip(id) {
      const entry = backoff.get(id);
      return !!entry && now() < entry.until;
    },

    // Record a recent-track response status (0 for a network error).
    // Returns the delay applied in ms (0 when none), so the caller can log
    // the first time a friend is backed off.
    recordStatus(id, status) {
      if (status >= 200 && status < 300) {
        backoff.delete(id);
        return 0;
      }
      if (ACCOUNT_STATUSES.has(status)) {
        const strikes = (backoff.get(id)?.strikes || 0) + 1;
        const delay = Math.min(ACCOUNT_BACKOFF_BASE_MS * 2 ** (strikes - 1), ACCOUNT_BACKOFF_MAX_MS);
        backoff.set(id, { until: now() + delay, strikes });
        return delay;
      }
      if (status === 429) {
        backoff.set(id, { until: now() + RATE_LIMIT_BACKOFF_MS, strikes: backoff.get(id)?.strikes || 0 });
        return RATE_LIMIT_BACKOFF_MS;
      }
      return 0;
    },

    // True when the friend's weekly stats should be fetched: the cached
    // stats (fetchedAt) and the last attempt are both older than the max age.
    statsDue(id, fetchedAt) {
      const last = Math.max(fetchedAt || 0, statsAttemptAt.get(id) || 0);
      return now() - last > STATS_MAX_AGE_MS;
    },

    recordStatsAttempt(id) {
      statsAttemptAt.set(id, now());
    },
  };
}

module.exports = {
  createFriendPollBackoff,
  ACCOUNT_BACKOFF_BASE_MS,
  ACCOUNT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MS,
  STATS_MAX_AGE_MS,
};
