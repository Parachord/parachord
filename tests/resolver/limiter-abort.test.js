/**
 * A job whose AbortSignal fires while it waits in the limiter's queue leaves
 * the queue without starting: it uses no slot and no minGapMs. Search aborts
 * a superseded query's MusicBrainz requests; they used to start anyway, fail
 * at once, and still make the next request wait out the 1.1s gap, so typing
 * with pauses stacked up dead seconds in front of the search the user wanted.
 */

const { createLimiter } = require('../../resolver-limiter');

const makeLimiter = (minGapMs = 1000) => createLimiter({
  name: 't', maxConcurrency: 1, minGapMs, cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false
});

describe('createLimiter abort', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('an aborted queued job never starts and does not cost the next job a gap', async () => {
    const limiter = makeLimiter(1000);
    const started = [];
    const job = (tag) => () => { started.push(tag); return Promise.resolve(tag); };

    const first = limiter.run(job('first'));
    const controller = new AbortController();
    const stale = limiter.run(job('stale'), { signal: controller.signal });
    const next = limiter.run(job('next'));
    controller.abort();

    await expect(stale).rejects.toMatchObject({ name: 'AbortError' });
    await first;
    expect(limiter.getQueueLength()).toBe(1);

    // One gap after `first`, not two: the stale job took no slot.
    await jest.advanceTimersByTimeAsync(1000);
    await expect(next).resolves.toBe('next');
    expect(started).toEqual(['first', 'next']);
  });

  test('an already-aborted signal is rejected without queueing', async () => {
    const limiter = makeLimiter(0);
    const controller = new AbortController();
    controller.abort();
    const fn = jest.fn(() => Promise.resolve());
    await expect(limiter.run(fn, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fn).not.toHaveBeenCalled();
    expect(limiter.getQueueLength()).toBe(0);
  });

  test('an abort after the job started leaves it to the job (the fetch sees the signal)', async () => {
    const limiter = makeLimiter(0);
    const controller = new AbortController();
    let release;
    const running = limiter.run(() => new Promise((r) => { release = r; }), { signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    release('done');
    await expect(running).resolves.toBe('done');
  });

  test('an aborted background job leaves the background lane', async () => {
    const limiter = makeLimiter(0);
    let release;
    const first = limiter.run(() => new Promise((r) => { release = r; }));
    const controller = new AbortController();
    const bg = limiter.run(() => Promise.resolve(), { background: true, signal: controller.signal });
    expect(limiter.getBackgroundQueueLength()).toBe(1);
    controller.abort();
    await expect(bg).rejects.toMatchObject({ name: 'AbortError' });
    expect(limiter.getBackgroundQueueLength()).toBe(0);
    await Promise.resolve();
    release();
    await first;
  });
});
