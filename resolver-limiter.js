/**
 * Resolver concurrency + rate limiter (parachord#797).
 *
 * Two things live here:
 *
 *  1. `createLimiter(options)` — generic factory used for both
 *     `nativeMusicKitLimiter` (Apple Music catalog rate limit) and
 *     `globalResolverLimiter` (non-AM resolver search fan-out).
 *
 *  2. `wrapResolverSearchesWithLimiter(resolvers)` — in-place mutation
 *     helper that routes each non-skipped resolver's `.search` method
 *     through `window.globalResolverLimiter`. Idempotent.
 *
 * The factory schedules jobs with three throttle dimensions:
 *
 *   maxConcurrency  — max in-flight jobs at once
 *   minGapMs        — min ms between job starts (smooths bursts)
 *   cooldownMs      — pause for this long when consecutive throttle errors
 *                     exceed `errorThreshold`
 *
 * A job is anything wrapped by `limiter.run(() => Promise<T>)`. The factory
 * is unit-tested with controllable timers; the wrap helper is unit-tested
 * with stub resolver objects.
 *
 * See block comment in app.js at the `globalResolverLimiter` declaration for
 * which resolvers go through the limiter and why.
 */
(function () {
  'use strict';

  const createLimiter = ({
    maxConcurrency,
    minGapMs,
    cooldownMs,
    errorThreshold,
    isThrottleError,
    name
  }) => {
    let inFlight = 0;
    let lastStartAt = 0;
    let consecutiveErrors = 0;
    let cooldownUntil = 0;
    const pending = [];

    const drain = () => {
      while (pending.length > 0 && inFlight < maxConcurrency) {
        const now = Date.now();
        if (now < cooldownUntil) {
          setTimeout(drain, cooldownUntil - now);
          return;
        }
        const sinceLast = now - lastStartAt;
        if (sinceLast < minGapMs) {
          setTimeout(drain, minGapMs - sinceLast);
          return;
        }
        const job = pending.shift();
        inFlight++;
        lastStartAt = Date.now();
        (async () => {
          try {
            const result = await job.fn();
            consecutiveErrors = Math.max(0, consecutiveErrors - 1);
            job.resolve(result);
          } catch (err) {
            if (isThrottleError && isThrottleError(err)) {
              consecutiveErrors++;
              if (consecutiveErrors >= errorThreshold) {
                cooldownUntil = Date.now() + cooldownMs;
                if (typeof console !== 'undefined' && console.warn) {
                  console.warn(`[${name}] ${consecutiveErrors} consecutive throttle errors — cooling down ${cooldownMs}ms`);
                }
                consecutiveErrors = 0;
              }
            }
            job.reject(err);
          } finally {
            inFlight--;
            drain();
          }
        })();
      }
    };

    return {
      run: (fn) => new Promise((resolve, reject) => {
        pending.push({ fn, resolve, reject });
        drain();
      }),
      getQueueLength: () => pending.length,
      isCoolingDown: () => Date.now() < cooldownUntil,
    };
  };

  // Resolver IDs whose `.search` should NOT be wrapped by `globalResolverLimiter`.
  //
  //   - applemusic: has its own dedicated limiter (different rate-limit profile)
  //   - spotify:    has its own per-token budget; not a burst issue
  //   - localfiles: in-process, no network
  const RESOLVER_LIMITER_SKIP_IDS = new Set(['applemusic', 'spotify', 'localfiles']);

  /**
   * Wrap each non-skipped resolver's `.search` method in
   * `globalResolverLimiter.run`. In-place mutation: the same resolver
   * object is used at every dispatch site (loadedResolversRef,
   * search-page, validation pipeline, etc.), so wrapping once at
   * load-time covers everything.
   *
   * Idempotent: skips resolvers already wrapped (detected via
   * `__limiterWrapped` marker). Safe to call from re-load paths.
   *
   * Accepts an explicit limiter argument so tests can inject one without
   * having to mutate `window`. Production callers can rely on the default
   * which reads from `window.globalResolverLimiter`.
   */
  const wrapResolverSearchesWithLimiter = (resolvers, limiter) => {
    if (!Array.isArray(resolvers)) return resolvers;
    const lim = limiter
      || (typeof window !== 'undefined' ? window.globalResolverLimiter : null);
    if (!lim || typeof lim.run !== 'function') return resolvers;
    for (const r of resolvers) {
      if (!r || typeof r !== 'object') continue;
      if (RESOLVER_LIMITER_SKIP_IDS.has(r.id)) continue;
      if (typeof r.search !== 'function') continue;
      if (r.__limiterWrapped) continue;
      const original = r.search.bind(r);
      r.search = (query, config) => lim.run(() => original(query, config));
      r.__limiterWrapped = true;
    }
    return resolvers;
  };

  // Expose to renderer.
  if (typeof window !== 'undefined') {
    window.createLimiter = createLimiter;
    window.wrapResolverSearchesWithLimiter = wrapResolverSearchesWithLimiter;
    window.RESOLVER_LIMITER_SKIP_IDS = RESOLVER_LIMITER_SKIP_IDS;
  }

  // Export for Node.js (tests).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createLimiter,
      wrapResolverSearchesWithLimiter,
      RESOLVER_LIMITER_SKIP_IDS
    };
  }
})();
