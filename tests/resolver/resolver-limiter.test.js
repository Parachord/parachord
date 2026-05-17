/**
 * Tests for resolver-limiter.js (parachord#797).
 *
 * Two surfaces:
 *   - createLimiter — concurrency / gap / cooldown enforcement
 *   - wrapResolverSearchesWithLimiter — in-place wrap, skip-set, idempotency
 */

const {
  createLimiter,
  wrapResolverSearchesWithLimiter,
  RESOLVER_LIMITER_SKIP_IDS
} = require('../../resolver-limiter');

describe('createLimiter — concurrency', () => {
  test('caps in-flight to maxConcurrency', async () => {
    const limiter = createLimiter({
      maxConcurrency: 2,
      minGapMs: 0,
      cooldownMs: 1000,
      errorThreshold: 3,
      isThrottleError: () => false,
      name: 'test'
    });

    let inFlight = 0;
    let peakInFlight = 0;
    const job = () => new Promise(resolve => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      setTimeout(() => {
        inFlight--;
        resolve();
      }, 30);
    });

    await Promise.all(Array.from({ length: 6 }, () => limiter.run(job)));
    expect(peakInFlight).toBeLessThanOrEqual(2);
  });

  test('allows full concurrency when there is enough work', async () => {
    const limiter = createLimiter({
      maxConcurrency: 3,
      minGapMs: 0,
      cooldownMs: 1000,
      errorThreshold: 3,
      isThrottleError: () => false,
      name: 'test'
    });

    let inFlight = 0;
    let peakInFlight = 0;
    const job = () => new Promise(resolve => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      setTimeout(() => { inFlight--; resolve(); }, 30);
    });

    await Promise.all(Array.from({ length: 9 }, () => limiter.run(job)));
    expect(peakInFlight).toBe(3);
  });
});

describe('createLimiter — min gap', () => {
  test('enforces minGapMs between job starts', async () => {
    const limiter = createLimiter({
      maxConcurrency: 5,
      minGapMs: 50,
      cooldownMs: 1000,
      errorThreshold: 3,
      isThrottleError: () => false,
      name: 'test'
    });

    const starts = [];
    const job = () => {
      starts.push(Date.now());
      return Promise.resolve();
    };

    await Promise.all(Array.from({ length: 3 }, () => limiter.run(job)));
    expect(starts).toHaveLength(3);
    for (let i = 1; i < starts.length; i++) {
      // Allow a couple ms slop for timer granularity.
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(48);
    }
  });
});

describe('createLimiter — cooldown on throttle errors', () => {
  test('trips cooldown after errorThreshold consecutive throttle errors', async () => {
    const limiter = createLimiter({
      maxConcurrency: 1,
      minGapMs: 0,
      cooldownMs: 100,
      errorThreshold: 2,
      isThrottleError: (err) => err && err.code === 429,
      name: 'cool-test'
    });

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const throw429 = () => Promise.reject(Object.assign(new Error('boom'), { code: 429 }));

    // Two consecutive 429s should trip cooldown.
    await expect(limiter.run(throw429)).rejects.toThrow();
    await expect(limiter.run(throw429)).rejects.toThrow();
    expect(limiter.isCoolingDown()).toBe(true);

    consoleSpy.mockRestore();
  });

  test('non-throttle errors do not trip cooldown', async () => {
    const limiter = createLimiter({
      maxConcurrency: 1,
      minGapMs: 0,
      cooldownMs: 100,
      errorThreshold: 2,
      isThrottleError: () => false,
      name: 'test'
    });

    await expect(limiter.run(() => Promise.reject(new Error('regular failure')))).rejects.toThrow();
    await expect(limiter.run(() => Promise.reject(new Error('also a regular failure')))).rejects.toThrow();
    expect(limiter.isCoolingDown()).toBe(false);
  });

  test('successful job decrements consecutiveErrors so cooldown only on sustained throttle', async () => {
    const limiter = createLimiter({
      maxConcurrency: 1,
      minGapMs: 0,
      cooldownMs: 100,
      errorThreshold: 2,
      isThrottleError: (err) => err && err.code === 429,
      name: 'test'
    });
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(limiter.run(() => Promise.reject(Object.assign(new Error('boom'), { code: 429 })))).rejects.toThrow();
    // Success in between — should decrement.
    await limiter.run(() => Promise.resolve('ok'));
    // One more 429 — should NOT trip cooldown because counter went back down.
    await expect(limiter.run(() => Promise.reject(Object.assign(new Error('boom'), { code: 429 })))).rejects.toThrow();
    expect(limiter.isCoolingDown()).toBe(false);

    consoleSpy.mockRestore();
  });
});

describe('createLimiter — queue length', () => {
  test('reports pending count while saturated', async () => {
    const limiter = createLimiter({
      maxConcurrency: 1,
      minGapMs: 0,
      cooldownMs: 1000,
      errorThreshold: 3,
      isThrottleError: () => false,
      name: 'test'
    });

    let release;
    const slow = () => new Promise(resolve => { release = resolve; });

    limiter.run(slow);   // takes the only slot
    limiter.run(() => Promise.resolve());
    limiter.run(() => Promise.resolve());

    // After microtask flush, two should be queued, one in-flight.
    await Promise.resolve();
    expect(limiter.getQueueLength()).toBe(2);

    release();
  });
});

describe('wrapResolverSearchesWithLimiter', () => {
  // Build a stub limiter that just records calls and forwards to fn().
  const makeStubLimiter = () => {
    const calls = [];
    return {
      run: (fn) => {
        calls.push(fn);
        return fn();
      },
      _calls: calls
    };
  };

  test('wraps non-skipped resolvers', async () => {
    const lim = makeStubLimiter();
    const youtube = { id: 'youtube', search: jest.fn().mockResolvedValue(['yt-result']) };
    const bandcamp = { id: 'bandcamp', search: jest.fn().mockResolvedValue(['bc-result']) };

    wrapResolverSearchesWithLimiter([youtube, bandcamp], lim);

    await youtube.search('foo', {});
    await bandcamp.search('bar', {});

    expect(lim._calls).toHaveLength(2);
    expect(youtube.search).not.toBe(undefined);
    expect(youtube.__limiterWrapped).toBe(true);
    expect(bandcamp.__limiterWrapped).toBe(true);
  });

  test('does NOT wrap applemusic / spotify / localfiles', () => {
    const lim = makeStubLimiter();
    const am = { id: 'applemusic', search: jest.fn() };
    const sp = { id: 'spotify', search: jest.fn() };
    const lf = { id: 'localfiles', search: jest.fn() };

    wrapResolverSearchesWithLimiter([am, sp, lf], lim);

    expect(am.__limiterWrapped).toBeUndefined();
    expect(sp.__limiterWrapped).toBeUndefined();
    expect(lf.__limiterWrapped).toBeUndefined();
  });

  test('is idempotent — double-wrap does not double-route', async () => {
    const lim = makeStubLimiter();
    const r = { id: 'youtube', search: jest.fn().mockResolvedValue([]) };

    wrapResolverSearchesWithLimiter([r], lim);
    const wrappedSearch = r.search;
    wrapResolverSearchesWithLimiter([r], lim);  // second pass
    expect(r.search).toBe(wrappedSearch);

    await r.search('q', {});
    expect(lim._calls).toHaveLength(1); // one wrap = one limiter call per search
  });

  test('passes query and config through to the original search', async () => {
    const lim = makeStubLimiter();
    const original = jest.fn().mockResolvedValue(['result']);
    const r = { id: 'youtube', search: original };

    wrapResolverSearchesWithLimiter([r], lim);
    await r.search('the query', { token: 'abc' });

    expect(original).toHaveBeenCalledWith('the query', { token: 'abc' });
  });

  test('returns the resolver array (chaining-friendly)', () => {
    const lim = makeStubLimiter();
    const resolvers = [{ id: 'youtube', search: () => {} }];
    const result = wrapResolverSearchesWithLimiter(resolvers, lim);
    expect(result).toBe(resolvers);
  });

  test('handles non-array input gracefully', () => {
    const lim = makeStubLimiter();
    expect(wrapResolverSearchesWithLimiter(null, lim)).toBe(null);
    expect(wrapResolverSearchesWithLimiter(undefined, lim)).toBe(undefined);
  });

  test('skips entries missing a search function', () => {
    const lim = makeStubLimiter();
    const noSearch = { id: 'youtube' };
    const ok = { id: 'bandcamp', search: () => Promise.resolve([]) };
    wrapResolverSearchesWithLimiter([noSearch, ok], lim);
    expect(noSearch.__limiterWrapped).toBeUndefined();
    expect(ok.__limiterWrapped).toBe(true);
  });
});

describe('RESOLVER_LIMITER_SKIP_IDS export', () => {
  test('contains the documented skip set', () => {
    expect(RESOLVER_LIMITER_SKIP_IDS.has('applemusic')).toBe(true);
    expect(RESOLVER_LIMITER_SKIP_IDS.has('spotify')).toBe(true);
    expect(RESOLVER_LIMITER_SKIP_IDS.has('localfiles')).toBe(true);
    expect(RESOLVER_LIMITER_SKIP_IDS.has('youtube')).toBe(false);
    expect(RESOLVER_LIMITER_SKIP_IDS.has('soundcloud')).toBe(false);
    expect(RESOLVER_LIMITER_SKIP_IDS.has('bandcamp')).toBe(false);
  });
});
