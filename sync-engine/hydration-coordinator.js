// N-way hydration coordinator (parachord#911, Step 2 / PR-4a).
//
// ONE instance per reconcile cycle. Turns a canonical track into a provider
// NATIVE id for the materialize executor's ADD path — `resolveNativeId` in
// materializeToProvider is `(track) => coordinator.resolve(provider, track)`.
//
// It is the cost-control + no-false-drop boundary around track search:
//   - native id already on the row            → return it, no search
//   - cache hit (non-null resolvedId)          → return it, no search
//   - within the per-track cooldown window     → return null (PENDING), no search
//   - per-cycle inline budget exhausted        → return null (PENDING), no search
//   - else                                     → ONE search, ALWAYS stamp the cache
//
// Returning null means "pending this cycle" — the executor leaves the add
// unapplied and the augmentation layer protects the baseline key from being
// read as a deletion. A search is attempted at most once per track per cycle
// and the result (hit OR miss) is always written back, so the cooldown
// escalates and a genuinely-absent track stops being re-searched.
//
// The provider passed to `resolve` is already token-bound (PR-4b's per-cycle
// adapter) or a Fake, so provider methods take no token here — keeping this
// module pure and the executor call sites uniform across desktop/tests.

const { canonicalTrackKey } = require('./playlist-merge');

const DAY_MS = 24 * 60 * 60 * 1000;

// attempts<=1 → 7-day cooldown; thereafter 30 days. A track that isn't on a
// service shouldn't burn a search every sync; a track that's just new gets
// retried within a week.
function defaultCooldownMs(attempts) {
  return attempts <= 1 ? 7 * DAY_MS : 30 * DAY_MS;
}

/**
 * @param {object} args
 * @param {object} args.cache - createHydrationCache() instance
 * @param {() => number} args.clock - returns epoch ms (injected for determinism)
 * @param {number} [args.maxInlineLookups=12] - per-cycle search budget
 * @param {(attempts:number)=>number} [args.cooldownMs] - cooldown policy
 * @param {(track:object, providerId:string, nativeId:string)=>void} [args.persistRowId]
 *   - optional: write a freshly-resolved native id back onto the local row
 *     (null-only backfill). Omitted in shadow mode to stay side-effect-free.
 * @returns {{resolve:function, stats:function}}
 */
function createHydrationCoordinator({ cache, clock, maxInlineLookups = 12, cooldownMs = defaultCooldownMs, persistRowId } = {}) {
  let inlineUsed = 0;
  let searches = 0;

  async function resolve(provider, track) {
    if (!provider || !track) return null;

    // 1. native id already present on the row
    const onRow = typeof provider.nativeIdOf === 'function' ? provider.nativeIdOf(track) : null;
    if (onRow) return onRow;

    // 2/3. cache hit
    const key = canonicalTrackKey(track);
    const entry = cache.select(key, provider.id);
    if (entry && entry.resolvedId) return entry.resolvedId;

    const now = clock();

    // 4. cooldown — recently attempted + failed; don't re-search yet
    if (entry && now - entry.lastAttemptAt < cooldownMs(entry.attempts)) return null;

    // 5. per-cycle inline budget
    if (inlineUsed >= maxInlineLookups) return null;
    inlineUsed += 1;

    // 6. ONE search
    const attempts = (entry && entry.attempts ? entry.attempts : 0) + 1;
    let id = null;
    try {
      searches += 1;
      id = await provider.searchForTrackId(track.title, track.artist, track.album, track.isrc);
    } catch {
      id = null;
    }

    // 7. ALWAYS stamp (cooldown escalation) — then null-only backfill the row
    cache.upsert(key, provider.id, id || null, now, attempts);
    if (id && typeof persistRowId === 'function') {
      try {
        persistRowId(track, provider.id, id);
      } catch {
        /* row backfill is best-effort */
      }
    }
    return id || null;
  }

  return {
    resolve,
    stats() {
      return { inlineUsed, searches };
    },
  };
}

module.exports = { createHydrationCoordinator, defaultCooldownMs };
