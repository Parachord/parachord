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
 *     through `window.globalResolverLimiter`, and gives EVERY resolver's
 *     `.resolve` a time budget (RESOLVE_BUDGET_MS). Idempotent.
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

  // backgroundMaxConcurrency: how many of the maxConcurrency slots background
  // jobs may hold at once (default: all of them). Below maxConcurrency, the
  // rest stay free for foreground jobs, so a user's request never waits for a
  // slow background job that has already started; minGapMs still spaces every
  // start, foreground and background alike.
  const createLimiter = ({
    maxConcurrency,
    backgroundMaxConcurrency = maxConcurrency,
    minGapMs,
    cooldownMs,
    errorThreshold,
    isThrottleError,
    name
  }) => {
    let inFlight = 0;
    let inFlightBackground = 0;
    let lastStartAt = 0;
    let consecutiveErrors = 0;
    let cooldownUntil = 0;
    const pending = [];
    // Background lane: drained only when the foreground queue is empty, so a
    // bulk pass (library enrichment, Fresh Drops) can never make a user-initiated
    // request wait behind it. run(fn, { background: true }) lands here.
    const pendingBackground = [];

    const drain = () => {
      while ((pending.length > 0 || pendingBackground.length > 0) && inFlight < maxConcurrency) {
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
        // Only background jobs waiting, and their share of the slots is taken:
        // wait for one to finish (its finally drains again).
        if (pending.length === 0 && inFlightBackground >= backgroundMaxConcurrency) return;
        const job = pending.length > 0 ? pending.shift() : pendingBackground.shift();
        inFlight++;
        if (job.background) inFlightBackground++;
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
            if (job.background) inFlightBackground--;
            drain();
          }
        })();
      }
    };

    const abortError = () => (typeof DOMException === 'function'
      ? new DOMException('Aborted', 'AbortError')
      : Object.assign(new Error('Aborted'), { name: 'AbortError' }));

    return {
      // opts.signal: a job whose signal aborts while it waits leaves the queue
      // without starting, so it uses no slot and no minGapMs. A superseded
      // search used to start anyway, fail at once, and still make the next
      // request wait out the gap: typing with pauses stacked up dead seconds
      // in front of the search the user wanted.
      run: (fn, opts) => new Promise((resolve, reject) => {
        const signal = opts && opts.signal;
        if (signal && signal.aborted) { reject(abortError()); return; }
        const background = !!(opts && opts.background);
        const lane = background ? pendingBackground : pending;
        const job = { fn, resolve, reject, background };
        // opts.priority: the front of the foreground queue. A play click's
        // resolve goes there, ahead of the page's own rows resolving.
        if (signal && typeof signal.addEventListener === 'function') {
          const onAbort = () => {
            const i = lane.indexOf(job);
            if (i === -1) return; // already started; the job's own fetch sees the abort
            lane.splice(i, 1);
            reject(abortError());
          };
          signal.addEventListener('abort', onAbort, { once: true });
          job.fn = () => {
            signal.removeEventListener('abort', onAbort);
            return fn();
          };
        }
        if (opts && opts.priority && !opts.background) lane.unshift(job); else lane.push(job);
        drain();
      }),
      getQueueLength: () => pending.length + pendingBackground.length,
      getBackgroundQueueLength: () => pendingBackground.length,
      getInFlight: () => inFlight,
      isCoolingDown: () => Date.now() < cooldownUntil,
    };
  };

  // Resolver IDs whose `.search` should NOT be wrapped by `globalResolverLimiter`.
  //
  //   - applemusic: has its own dedicated limiter (different rate-limit profile)
  //   - spotify:    has its own per-token budget; not a burst issue
  //   - localfiles: in-process, no network
  // amazonmusic is intentionally NOT skipped. A playlist resolve fans out one
  // in-app web-player page load per track. Keep it under the shared limiter.
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
  // The lane a resolver search runs in, from the config its caller passed:
  // config.__lane 'priority' (a play click) or 'background' (a cover lookup);
  // anything else is foreground (track resolution). resolve() passes its
  // config on to this.search(), so its searches inherit the lane.
  const laneRunOptions = (config) => {
    const lane = config && config.__lane;
    if (lane === 'priority') return { priority: true };
    if (lane === 'background') return { background: true };
    return undefined;
  };

  // Every resolver's resolve() gets this long. Track resolution waits for every
  // active resolver and the scheduler resolves one track at a time, so one
  // resolver that never answers held every row on screen (2026-11-12: iTunes
  // answered 403 and Apple Music's fallback waited minutes in its queue). Past
  // the budget the call rejects with ResolverTimeoutError: the row moves on
  // with what the others found, and since it is an error, not an empty answer,
  // nothing is cached as a miss, so the resolver is asked again next time.
  const RESOLVE_BUDGET_MS = 8000;
  const withResolveBudget = (r) => {
    if (!r || typeof r.resolve !== 'function' || r.__resolveBudgetWrapped) return;
    const original = r.resolve;
    r.resolve = function (...args) {
      let timer = null;
      const budget = new Promise((_, reject) => {
        timer = setTimeout(() => {
          const err = new Error(`${r.id} did not answer within ${RESOLVE_BUDGET_MS}ms`);
          err.name = 'ResolverTimeoutError';
          reject(err);
        }, RESOLVE_BUDGET_MS);
        if (timer && typeof timer.unref === 'function') timer.unref();
      });
      const call = Promise.resolve().then(() => original.apply(this, args));
      return Promise.race([call, budget]).finally(() => clearTimeout(timer));
    };
    r.__resolveBudgetWrapped = true;
  };

  const wrapResolverSearchesWithLimiter = (resolvers, limiter) => {
    if (!Array.isArray(resolvers)) return resolvers;
    // The resolve budget applies to every resolver, the limiter-skipped ones
    // (Apple Music, Spotify, local files) included.
    for (const r of resolvers) {
      if (r && typeof r === 'object') withResolveBudget(r);
    }
    const lim = limiter
      || (typeof window !== 'undefined' ? window.globalResolverLimiter : null);
    if (!lim || typeof lim.run !== 'function') return resolvers;
    for (const r of resolvers) {
      if (!r || typeof r !== 'object') continue;
      if (RESOLVER_LIMITER_SKIP_IDS.has(r.id)) continue;
      if (typeof r.search !== 'function') continue;
      if (r.__limiterWrapped) continue;
      const original = r.search.bind(r);
      r.search = (query, config) => lim.run(() => original(query, config), laneRunOptions(config));
      r.__limiterWrapped = true;
    }
    return resolvers;
  };

  // Expose to renderer.
  if (typeof window !== 'undefined') {
    window.createLimiter = createLimiter;
    window.wrapResolverSearchesWithLimiter = wrapResolverSearchesWithLimiter;
    window.laneRunOptions = laneRunOptions;
    window.RESOLVER_LIMITER_SKIP_IDS = RESOLVER_LIMITER_SKIP_IDS;
    window.RESOLVE_BUDGET_MS = RESOLVE_BUDGET_MS;
  }

  // Export for Node.js (tests).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      createLimiter,
      wrapResolverSearchesWithLimiter,
      laneRunOptions,
      RESOLVER_LIMITER_SKIP_IDS,
      RESOLVE_BUDGET_MS
    };
  }
})();
