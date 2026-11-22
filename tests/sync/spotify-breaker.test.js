/**
 * Spotify abuse-mode circuit breaker (parachord#956 audit §2b). Pure escalation
 * logic + the spotify.js fail-fast wiring (a banned client_id isn't re-hammered
 * across calls).
 */

const { createSpotifyBreaker, cooldownMsForLevel, HOUR_MS } = require('../../sync-engine/spotify-breaker');
const spotify = require('../../sync-providers/spotify');
const { sharedPause } = require('../../sync-providers/spotify-pause');
afterEach(() => sharedPause.clear());

describe('createSpotifyBreaker — escalating cooldown', () => {
  test('cooldownMsForLevel: 1st ban 1h, repeats 6h', () => {
    expect(cooldownMsForLevel(1)).toBe(1 * HOUR_MS);
    expect(cooldownMsForLevel(2)).toBe(6 * HOUR_MS);
    expect(cooldownMsForLevel(5)).toBe(6 * HOUR_MS);
  });

  test('trip opens with an escalating cooldown; isOpen reflects it', () => {
    const b = createSpotifyBreaker();
    const t = 1_000_000;
    expect(b.isOpen(t)).toBe(false);
    b.trip(t);                                   // level 1 → 1h
    expect(b.isOpen(t)).toBe(true);
    expect(b.isOpen(t + HOUR_MS - 1)).toBe(true);
    expect(b.isOpen(t + HOUR_MS + 1)).toBe(false);
    b.trip(t + 2 * HOUR_MS);                      // level 2 → 6h
    expect(b.isOpen(t + 2 * HOUR_MS + 6 * HOUR_MS - 1)).toBe(true);
    expect(b.isOpen(t + 2 * HOUR_MS + 6 * HOUR_MS + 1)).toBe(false);
  });

  test('recordSuccess closes + resets escalation (and reports whether it changed)', () => {
    const b = createSpotifyBreaker();
    expect(b.recordSuccess()).toBe(false);       // nothing to reset
    b.trip(5);
    expect(b.recordSuccess()).toBe(true);        // closed
    expect(b.isOpen(6)).toBe(false);
    // After reset, the next trip starts at level 1 (1h), not the escalated 6h.
    b.trip(10);
    expect(b.isOpen(10 + HOUR_MS - 1)).toBe(true);
    expect(b.isOpen(10 + HOUR_MS + 1)).toBe(false);
  });

  test('snapshot / restore round-trips (cross-restart persistence)', () => {
    const a = createSpotifyBreaker();
    a.trip(100);
    const snap = a.snapshot();
    const b = createSpotifyBreaker();
    b.restore(snap);
    expect(b.snapshot()).toEqual(snap);
    expect(b.isOpen(100)).toBe(true);
    b.restore(null); // malformed → no-op, no throw
    expect(b.isOpen(100)).toBe(true);
  });
});

describe('spotify.js fail-fast while the breaker is open', () => {
  const FUTURE = 1; // restore an open breaker
  afterEach(() => {
    // Reset the module-level breaker to closed so state doesn't leak across tests.
    spotify._setBreakerStore({ load: () => ({ openUntil: 0, level: 0 }) });
    delete global.fetch;
  });

  test('resolveTracks makes NO Spotify call while the cooldown is open', async () => {
    global.fetch = jest.fn();
    // Open the breaker far into the future via the persistence-restore hook.
    spotify._setBreakerStore({ load: () => ({ openUntil: Date.now() + 6 * HOUR_MS, level: 2 }) });
    const { resolved, unresolved, unreachable } = await spotify.resolveTracks(
      [{ title: 'X', artist: 'Y' }], 'tok'
    );
    expect(global.fetch).not.toHaveBeenCalled(); // fail-fast: no hammering the banned client_id
    expect(resolved).toEqual([]);
    // A cooldown is an unanswered lookup, never a miss: a push holds on it
    // rather than dropping the track from the mirror (#1637).
    expect(unresolved).toEqual([]);
    expect(unreachable).toEqual([{ artist: 'Y', title: 'X' }]);
  });
});

describe('a long Retry-After opens the breaker instead of sleeping', () => {
  afterEach(() => {
    spotify._setBreakerStore({ load: () => ({ openUntil: 0, level: 0 }) });
    delete global.fetch;
  });
  const res429 = (seconds) => ({
    ok: false, status: 429, statusText: 'Too Many Requests',
    headers: { get: (k) => (k.toLowerCase() === 'retry-after' ? String(seconds) : null) },
    json: async () => ({}), text: async () => '',
  });

  test('trip(now, minMs) keeps the breaker open at least minMs', () => {
    const b = createSpotifyBreaker();
    b.trip(0, 3 * HOUR_MS);
    expect(b.isOpen(3 * HOUR_MS - 1)).toBe(true);
    expect(b.isOpen(3 * HOUR_MS + 1)).toBe(false);
  });

  test('spotifyRequest: Retry-After 8940 fails at once and opens the breaker past it', async () => {
    const saves = [];
    spotify._setBreakerStore({ load: () => ({ openUntil: 0, level: 0 }), save: (snap) => saves.push(snap) });
    global.fetch = jest.fn().mockResolvedValue(res429(8940));
    const before = Date.now();
    await expect(spotify.getPlaylistSnapshot('p', 'tok')).rejects.toThrow(/rate limit/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(saves[saves.length - 1].openUntil).toBeGreaterThanOrEqual(before + 8940 * 1000);
    // The next call fails fast without a request.
    await expect(spotify.getPlaylistSnapshot('p', 'tok')).rejects.toThrow(/cooldown/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('spotifyFetch (paged) does the same', async () => {
    global.fetch = jest.fn().mockResolvedValue(res429(8940));
    await expect(spotify.fetchPlaylistTracks('p', 'tok')).rejects.toThrow(/rate limit/i);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
