/**
 * LB MBID-hydration flood guard (parachord#953). Pure cache/budget logic +
 * the provider threading (resolveTracks consults the injected hydration so an
 * un-findable track isn't re-queried against the mapper every sync cycle).
 */

const {
  hydrationKey, shouldLookup, recordAttempt, createBudget,
  FIRST_MISS_COOLDOWN_MS, REPEAT_MISS_COOLDOWN_MS,
} = require('../../sync-engine/lb-hydration');
const lb = require('../../sync-providers/listenbrainz');

const MBID = 'b2181aae-5cba-496c-bb0c-b4cc0109ebf8';

describe('hydrationKey — ISRC > recording-MBID > norm', () => {
  test('valid ISRC wins (upper-cased)', () => {
    expect(hydrationKey({ isrc: 'usrc17607839', recordingMbid: MBID, artist: 'A', title: 'B' }))
      .toBe('isrc:USRC17607839');
  });
  test('recording-MBID when no ISRC', () => {
    expect(hydrationKey({ recordingMbid: MBID, artist: 'A', title: 'B' })).toBe(`mbid:${MBID}`);
  });
  test('norm when neither (artist|title lower)', () => {
    expect(hydrationKey({ artist: 'The xx', title: 'Intro' })).toBe('norm:the xx|intro');
  });
  test('null when no usable identity', () => {
    expect(hydrationKey({})).toBeNull();
    expect(hydrationKey(null)).toBeNull();
  });
});

describe('shouldLookup — cooldown gate', () => {
  const now = 1_000_000_000_000;
  test('no entry → look up', () => { expect(shouldLookup(undefined, now)).toBe(true); });
  test('resolved entry → never look up', () => {
    expect(shouldLookup({ mbid: MBID, lastAttemptAt: 0, misses: 0 }, now)).toBe(false);
  });
  test('recent miss → skip within cooldown', () => {
    expect(shouldLookup({ mbid: null, lastAttemptAt: now - 1000, misses: 1 }, now)).toBe(false);
  });
  test('first miss re-tries after 7d', () => {
    expect(shouldLookup({ mbid: null, lastAttemptAt: now - FIRST_MISS_COOLDOWN_MS, misses: 1 }, now)).toBe(true);
    expect(shouldLookup({ mbid: null, lastAttemptAt: now - (FIRST_MISS_COOLDOWN_MS - 1), misses: 1 }, now)).toBe(false);
  });
  test('repeat miss escalates to 30d', () => {
    // 8 days in: a 1-miss entry would re-try, a 2-miss entry still waits (30d).
    const eightDays = 8 * 24 * 60 * 60 * 1000;
    expect(shouldLookup({ mbid: null, lastAttemptAt: now - eightDays, misses: 2 }, now)).toBe(false);
    expect(shouldLookup({ mbid: null, lastAttemptAt: now - REPEAT_MISS_COOLDOWN_MS, misses: 2 }, now)).toBe(true);
  });
});

describe('recordAttempt', () => {
  test('hit resets the miss streak', () => {
    expect(recordAttempt({ mbid: null, misses: 3 }, MBID, 5)).toEqual({ mbid: MBID, lastAttemptAt: 5, misses: 0 });
  });
  test('miss increments the streak', () => {
    expect(recordAttempt(undefined, null, 5)).toEqual({ mbid: null, lastAttemptAt: 5, misses: 1 });
    expect(recordAttempt({ mbid: null, misses: 1 }, null, 9)).toEqual({ mbid: null, lastAttemptAt: 9, misses: 2 });
  });
});

describe('createBudget — per-cycle cap + idle refill', () => {
  test('caps live lookups then refuses after an idle gap', () => {
    const b = createBudget(2, 100); // limit 2, idle reset 100ms
    expect(b.tryConsume(1000)).toBe(true);
    expect(b.tryConsume(1000)).toBe(true);
    expect(b.tryConsume(1000)).toBe(false); // exhausted this cycle
    expect(b.tryConsume(1050)).toBe(false); // still within idle window
    expect(b.tryConsume(1200)).toBe(true);  // gap > 100ms → new cycle, refilled
  });
});

describe('resolveTracks threads the hydration guard', () => {
  let origFetch;
  beforeEach(() => { origFetch = global.fetch; });
  afterEach(() => { global.fetch = origFetch; });

  test('a cached resolved id is reused WITHOUT a live mapper call', async () => {
    global.fetch = jest.fn(); // must NOT be called
    const hydration = {
      resolve: () => ({ skip: true, mbid: MBID }),
      record: jest.fn(),
      flush: jest.fn(),
    };
    const { resolved, unresolved } = await lb.resolveTracks(
      [{ artist: 'A', title: 'B' }], 'tok', { hydration }
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(resolved).toEqual([{ artist: 'A', title: 'B', mbid: MBID }]);
    expect(unresolved).toEqual([]);
    expect(hydration.flush).toHaveBeenCalled();
  });

  test('a cooled-down / over-budget miss is dropped WITHOUT a live call', async () => {
    global.fetch = jest.fn();
    const hydration = { resolve: () => ({ skip: true, mbid: null }), record: jest.fn(), flush: jest.fn() };
    const { resolved, unresolved } = await lb.resolveTracks(
      [{ artist: 'A', title: 'B' }], 'tok', { hydration }
    );
    expect(global.fetch).not.toHaveBeenCalled();
    expect(resolved).toEqual([]);
    expect(unresolved).toEqual([{ artist: 'A', title: 'B', album: undefined }]);
  });

  test('a fresh track does the live lookup and records the result', async () => {
    global.fetch = jest.fn(async () => ({
      ok: true,
      json: async () => ({ recording_mbid: MBID, confidence: 0.95 }),
    }));
    const recorded = [];
    const hydration = {
      resolve: () => ({ skip: false }),
      record: (t, mbid) => recorded.push([t.title, mbid]),
      flush: jest.fn(),
    };
    const { resolved } = await lb.resolveTracks([{ artist: 'A', title: 'B' }], 'tok', { hydration });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(resolved[0].mbid).toBe(MBID);
    expect(recorded).toEqual([['B', MBID]]);
  });
});
