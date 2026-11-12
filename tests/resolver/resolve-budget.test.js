/**
 * Every resolver's resolve() gets a time budget (resolver-limiter.js).
 *
 * Track resolution waits for every active resolver, and the scheduler resolves
 * one track at a time, so one resolver that never answers held every row on
 * screen. Live 2026-11-12: iTunes answered 403, Apple Music's fallback sat in
 * the iTunes queue for minutes, and an opened playlist's visible rows stopped
 * resolving. Past the budget a resolve rejects with ResolverTimeoutError: the
 * row moves on, and (an error, not an empty answer) nothing is cached as a
 * miss, so the resolver is asked again next time.
 */
const {
  wrapResolverSearchesWithLimiter,
  RESOLVE_BUDGET_MS
} = require('../../resolver-limiter');

const passThroughLimiter = { run: (fn) => fn() };

describe('resolve budget', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('the budget is 8 seconds', () => {
    expect(RESOLVE_BUDGET_MS).toBe(8000);
  });

  test('a resolve that never answers rejects with ResolverTimeoutError at the budget', async () => {
    const r = { id: 'applemusic', search: async () => [], resolve: () => new Promise(() => {}) };
    wrapResolverSearchesWithLimiter([r], passThroughLimiter);
    const p = r.resolve('Muse', 'Uprising', null, {});
    let settled = null;
    p.then(() => { settled = 'resolved'; }, (e) => { settled = e; });
    await jest.advanceTimersByTimeAsync(RESOLVE_BUDGET_MS - 1);
    expect(settled).toBeNull();
    await jest.advanceTimersByTimeAsync(1);
    expect(settled).toBeInstanceOf(Error);
    expect(settled.name).toBe('ResolverTimeoutError');
    expect(settled.message).toContain('applemusic');
  });

  test('every resolver gets it, including the ones the search limiter skips', () => {
    const ids = ['applemusic', 'spotify', 'localfiles', 'bandcamp'];
    const rs = ids.map(id => ({ id, search: async () => [], resolve: async () => null }));
    wrapResolverSearchesWithLimiter(rs, passThroughLimiter);
    for (const r of rs) expect(r.__resolveBudgetWrapped).toBe(true);
  });

  test('an answer, a miss and an error pass through unchanged', async () => {
    jest.useRealTimers();
    const hit = { title: 'Uprising' };
    const failure = new Error('boom');
    const rs = [
      { id: 'a', search: async () => [], resolve: async () => hit },
      { id: 'b', search: async () => [], resolve: async () => null },
      { id: 'c', search: async () => [], resolve: async () => { throw failure; } }
    ];
    wrapResolverSearchesWithLimiter(rs, passThroughLimiter);
    await expect(rs[0].resolve('x', 'y')).resolves.toBe(hit);
    await expect(rs[1].resolve('x', 'y')).resolves.toBeNull();
    await expect(rs[2].resolve('x', 'y')).rejects.toBe(failure);
  });

  test('the wrapper keeps `this` and the arguments, and is applied once', async () => {
    jest.useRealTimers();
    const seen = [];
    const r = {
      id: 'spotify',
      search: async () => [],
      resolve: async function (...args) { seen.push([this, args]); return null; }
    };
    wrapResolverSearchesWithLimiter([r], passThroughLimiter);
    const once = r.resolve;
    wrapResolverSearchesWithLimiter([r], passThroughLimiter);
    expect(r.resolve).toBe(once);
    await r.resolve('A', 'B', 'C', { k: 1 });
    expect(seen).toEqual([[r, ['A', 'B', 'C', { k: 1 }]]]);
  });

  test('a resolver without resolve() is left alone', () => {
    const r = { id: 'x', search: async () => [] };
    wrapResolverSearchesWithLimiter([r], passThroughLimiter);
    expect(r.resolve).toBeUndefined();
  });
});
