/**
 * Background lane on both limiters: a job queued with { background: true }
 * never runs ahead of a foreground job that is waiting, regardless of arrival
 * order. Bulk library enrichment and Fresh Drops use the lane so a user's
 * search, artist page, or the lookup handlePlay awaits never waits behind them.
 */

const { createLimiter } = require('../../resolver-limiter');
const { createGate } = require('../../mbid-lookup');

const order = (log, tag) => async () => { log.push(tag); };

async function fillThenRace(limiter, log) {
  // One job occupies the single slot; queue 3 background jobs, then 2 foreground.
  let release;
  const first = limiter.run(() => new Promise((r) => { release = r; }));
  const bg = [1, 2, 3].map((i) => limiter.run(order(log, `bg${i}`), { background: true }));
  const fg = [1, 2].map((i) => limiter.run(order(log, `fg${i}`)));
  // createGate starts jobs on a microtask, so `release` is assigned a tick later.
  await new Promise((r) => setTimeout(r, 0));
  release();
  await Promise.all([first, ...bg, ...fg]);
}

describe('createLimiter background lane', () => {
  test('foreground jobs queued later still run before waiting background jobs', async () => {
    const limiter = createLimiter({ name: 't', maxConcurrency: 1, minGapMs: 0, cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false });
    const log = [];
    await fillThenRace(limiter, log);
    expect(log).toEqual(['fg1', 'fg2', 'bg1', 'bg2', 'bg3']);
  });

  test('queue length counts both lanes', () => {
    const limiter = createLimiter({ name: 't', maxConcurrency: 1, minGapMs: 0, cooldownMs: 0, errorThreshold: 99, isThrottleError: () => false });
    limiter.run(() => new Promise(() => {}));
    limiter.run(() => Promise.resolve(), { background: true });
    limiter.run(() => Promise.resolve());
    expect(limiter.getQueueLength()).toBe(2);
    expect(limiter.getBackgroundQueueLength()).toBe(1);
  });
});

describe('mbid-lookup createGate background lane', () => {
  test('foreground jobs run before waiting background jobs', async () => {
    const gate = createGate({ maxConcurrency: 1, minGapMs: 0 });
    const log = [];
    await fillThenRace(gate, log);
    expect(log).toEqual(['fg1', 'fg2', 'bg1', 'bg2', 'bg3']);
  });
});
