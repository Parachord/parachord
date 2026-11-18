// Which services to ask again for a track whose sources are already saved.
//
// resolveTrack saves an answer for every service it asked: a real source, or a
// `{ noMatch: true }` sentinel when the service found nothing. A service that
// threw (refused, failed, or ran past RESOLVE_BUDGET_MS) leaves no entry, so
// that an outage is never remembered as a miss. Reading a missing entry as "no
// match" undid that: during a burst of lookups every slow service timed out,
// the saved entry looked complete, and the service wasn't asked again for the
// 7-day TTL (2026-11-15: Recommendations rows showed Spotify only).
//
// So a missing entry means "not answered yet". The failure time is kept on the
// saved entry (`unanswered: { [resolverId]: ms }`) so a service that keeps
// failing is retried once per window, not on every render of the row.

const UNANSWERED_RETRY_MS = 10 * 60 * 1000;

// The ids in `resolverIds` that have no answer in `entry` and are outside the
// retry window. `entry` null means there is nothing saved (a full resolve,
// not a retry), so nothing is listed. `isStale(id, saved)`, when given, says a
// saved answer no longer holds (a miss from an older plug-in version,
// lib/cached-miss.js), so that service counts as unanswered too.
function resolversToAskAgain(entry, resolverIds, now = Date.now(), isStale = null) {
  if (!entry || !Array.isArray(resolverIds)) return [];
  const sources = entry.sources || {};
  const failedAt = entry.unanswered || {};
  return resolverIds.filter((id) => {
    if (sources[id] && !(typeof isStale === 'function' && isStale(id, sources[id]))) return false;
    const at = failedAt[id];
    return !(typeof at === 'number' && now - at < UNANSWERED_RETRY_MS);
  });
}

// The `unanswered` map to save after a lookup: services that failed this time
// are stamped `now`, services that answered are cleared, others are kept.
// Returns undefined when nothing is left, so the saved entry stays small.
function nextUnanswered(prev, { failed = [], answered = [] } = {}, now = Date.now()) {
  const next = { ...(prev || {}) };
  for (const id of answered) delete next[id];
  for (const id of failed) next[id] = now;
  return Object.keys(next).length > 0 ? next : undefined;
}

module.exports = { UNANSWERED_RETRY_MS, resolversToAskAgain, nextUnanswered };
