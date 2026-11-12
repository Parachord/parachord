/**
 * The iTunes rate limiter (src/renderer/lib/itunes-rate-limiter.js).
 *
 * iTunes allows about 20 requests a minute and answers 403 or 429 past it.
 * The limiter used to retry each refused request 3 times with growing
 * backoff, one request at a time, with its spacing growing 500ms per error:
 * live 2026-11-12, 34 errors in, each queued request took about 48s and 42
 * were waiting, so Apple Music resolution (its iTunes fallback) and every row
 * waiting on it stalled for half an hour. Now a refusal that survives one
 * retry opens a circuit: for a cool-down every waiting and new request is
 * answered at once with a 429 (no network), and the cool-down doubles while
 * iTunes keeps refusing, from 30s up to 5 minutes. A success closes it.
 */
const { createITunesRateLimiter, ITUNES_LIMITS } = require('../../src/renderer/lib/itunes-rate-limiter');

const res = (status) => ({ ok: status >= 200 && status < 300, status, json: async () => ({ results: [] }) });

const make = (statuses) => {
  const calls = [];
  const limiter = createITunesRateLimiter({
    fetchImpl: async (url) => {
      calls.push(url);
      const next = statuses.length ? statuses.shift() : 200;
      if (next instanceof Error) throw next;
      return res(next);
    }
  });
  return { limiter, calls };
};

describe('iTunes rate limiter', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('the limits', () => {
    expect(ITUNES_LIMITS).toEqual({
      MIN_INTERVAL_MS: 1200,
      RETRY_BACKOFF_MS: 2000,
      CIRCUIT_BASE_MS: 30000,
      CIRCUIT_MAX_MS: 300000
    });
  });

  test('requests are spaced at least 1.2s apart and answered in order', async () => {
    const { limiter, calls } = make([200, 200]);
    const a = limiter.fetch('a');
    const b = limiter.fetch('b');
    await jest.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['a']);
    await jest.advanceTimersByTimeAsync(1199);
    expect(calls).toEqual(['a']);
    await jest.advanceTimersByTimeAsync(1);
    expect(calls).toEqual(['a', 'b']);
    expect((await a).status).toBe(200);
    expect((await b).status).toBe(200);
  });

  test('a refusal is retried once after 2s; one that survives it opens the circuit and answers the waiting requests at once', async () => {
    const { limiter, calls } = make([403, 403]);
    const first = limiter.fetch('first');
    const waiting = [limiter.fetch('w1'), limiter.fetch('w2', { background: true })];
    await jest.advanceTimersByTimeAsync(2000);
    expect(calls).toEqual(['first', 'first']);
    expect((await first).status).toBe(403);
    expect(limiter.isOpen()).toBe(true);
    // The waiting requests never reach the network.
    for (const p of waiting) expect((await p).status).toBe(429);
    expect(calls).toEqual(['first', 'first']);
    // New requests during the cool-down are answered at once too.
    const during = await limiter.fetch('during');
    expect(during.status).toBe(429);
    expect(during.ok).toBe(false);
    expect(calls).toHaveLength(2);
  });

  test('the circuit closes after its cool-down; a success resets it, a refusal doubles it up to 5 minutes', async () => {
    const { limiter, calls } = make([403, 403, 403, 403, 200]);
    limiter.fetch('a');
    await jest.advanceTimersByTimeAsync(2000);
    expect(limiter.isOpen()).toBe(true);
    expect(limiter.getCooldownMs()).toBe(30000);
    await jest.advanceTimersByTimeAsync(30000);
    expect(limiter.isOpen()).toBe(false);
    // Refused again (both tries): 60s now.
    limiter.fetch('b');
    await jest.advanceTimersByTimeAsync(2000);
    expect(limiter.isOpen()).toBe(true);
    expect(limiter.getCooldownMs()).toBe(60000);
    await jest.advanceTimersByTimeAsync(60000);
    const ok = limiter.fetch('c');
    await jest.advanceTimersByTimeAsync(0);
    expect((await ok).status).toBe(200);
    expect(limiter.isOpen()).toBe(false);
    expect(limiter.getCooldownMs()).toBe(30000);
    expect(calls).toEqual(['a', 'a', 'b', 'b', 'c']);
  });

  test('the cool-down never passes 5 minutes', async () => {
    const statuses = Array(40).fill(403);
    const { limiter } = make(statuses);
    for (let i = 0; i < 8; i++) {
      limiter.fetch('x' + i);
      await jest.advanceTimersByTimeAsync(2000);
      await jest.advanceTimersByTimeAsync(limiter.getCooldownMs());
    }
    expect(limiter.getCooldownMs()).toBe(300000);
  });

  test('a refusal that clears on the retry answers normally and opens nothing', async () => {
    const { limiter } = make([429, 200]);
    const p = limiter.fetch('a');
    await jest.advanceTimersByTimeAsync(2000);
    expect((await p).status).toBe(200);
    expect(limiter.isOpen()).toBe(false);
  });

  test('a network error is retried once, then rejects (and opens nothing)', async () => {
    const boom = new TypeError('Failed to fetch');
    const { limiter, calls } = make([boom, boom]);
    const p = limiter.fetch('a');
    const caught = p.catch(e => e);
    await jest.advanceTimersByTimeAsync(2000);
    expect(await caught).toBe(boom);
    expect(calls).toEqual(['a', 'a']);
    expect(limiter.isOpen()).toBe(false);
  });

  test('lanes: a priority request goes first, background waits behind foreground', async () => {
    const { limiter, calls } = make([]);
    limiter.fetch('fg1');
    limiter.fetch('bg', { background: true });
    limiter.fetch('fg2');
    limiter.fetch('prio', { priority: true });
    await jest.advanceTimersByTimeAsync(5000);
    expect(calls).toEqual(['fg1', 'prio', 'fg2', 'bg']);
  });

  test('queue length and background length are reported', () => {
    const { limiter } = make([]);
    limiter.fetch('a');
    limiter.fetch('b');
    limiter.fetch('c', { background: true });
    // 'a' has started; b and c wait.
    expect(limiter.getQueueLength()).toBe(2);
    expect(limiter.getBackgroundQueueLength()).toBe(1);
  });
});
