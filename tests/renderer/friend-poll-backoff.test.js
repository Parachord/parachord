/**
 * Friend polling backoff. The 2-minute friend poll re-requested private
 * (403) and deleted (404) accounts forever, and retried a failed or empty
 * weekly-stats fetch on every poll for every friend at once, which tripped
 * ListenBrainz's rate limit.
 */

const {
  createFriendPollBackoff,
  ACCOUNT_BACKOFF_BASE_MS,
  ACCOUNT_BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_MS,
  STATS_MAX_AGE_MS,
} = require('../../src/renderer/lib/friend-poll-backoff');

let t;
const make = () => createFriendPollBackoff({ now: () => t });
beforeEach(() => { t = 1_790_000_000_000; }); // a real epoch, so "never" is older than any window

describe('recent-track backoff', () => {
  test('a new friend is polled', () => {
    expect(make().shouldSkip('f')).toBe(false);
  });

  test.each([403, 404, 410])('%s backs off an hour, then doubles, capped at a day', (status) => {
    const b = make();
    expect(b.recordStatus('f', status)).toBe(ACCOUNT_BACKOFF_BASE_MS);
    expect(b.shouldSkip('f')).toBe(true);
    t += ACCOUNT_BACKOFF_BASE_MS;
    expect(b.shouldSkip('f')).toBe(false);
    expect(b.recordStatus('f', status)).toBe(2 * ACCOUNT_BACKOFF_BASE_MS);
    for (let i = 0; i < 10; i++) b.recordStatus('f', status);
    expect(b.recordStatus('f', status)).toBe(ACCOUNT_BACKOFF_MAX_MS);
  });

  test('429 waits ten minutes', () => {
    const b = make();
    expect(b.recordStatus('f', 429)).toBe(RATE_LIMIT_BACKOFF_MS);
    expect(b.shouldSkip('f')).toBe(true);
    t += RATE_LIMIT_BACKOFF_MS;
    expect(b.shouldSkip('f')).toBe(false);
  });

  test.each([0, 500, 502, 503])('%s (outage, network) does not back off', (status) => {
    const b = make();
    expect(b.recordStatus('f', status)).toBe(0);
    expect(b.shouldSkip('f')).toBe(false);
  });

  test('a success clears the strikes', () => {
    const b = make();
    b.recordStatus('f', 404);
    b.recordStatus('f', 404);
    b.recordStatus('f', 200);
    expect(b.shouldSkip('f')).toBe(false);
    expect(b.recordStatus('f', 404)).toBe(ACCOUNT_BACKOFF_BASE_MS);
  });

  test('friends are independent', () => {
    const b = make();
    b.recordStatus('a', 403);
    expect(b.shouldSkip('b')).toBe(false);
  });
});

describe('weekly stats', () => {
  test('due with no stats, then not again for 30 min whatever the outcome', () => {
    const b = make();
    expect(b.statsDue('f', undefined)).toBe(true);
    b.recordStatsAttempt('f');
    expect(b.statsDue('f', undefined)).toBe(false);
    t += STATS_MAX_AGE_MS + 1;
    expect(b.statsDue('f', undefined)).toBe(true);
  });

  test('fresh cached stats are not refetched', () => {
    expect(make().statsDue('f', t - 1000)).toBe(false);
  });
});
