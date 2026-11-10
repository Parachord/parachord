/**
 * Startup grace for the main-process Spotify poller (parachord#985).
 */

const {
  STARTUP_GRACE_MS,
  matchesExpectedTrack,
  startupPollVerdict,
} = require('../../spotify-startup-grace');

const URI = 'spotify:track:expected';

const playing = (uri, extra = {}) => ({
  is_playing: true,
  progress_ms: 1500,
  item: { uri, duration_ms: 200000, ...extra },
});

describe('matchesExpectedTrack', () => {
  test('matches the requested URI', () => {
    expect(matchesExpectedTrack({ uri: URI }, URI)).toBe(true);
  });

  test('matches a relinked track via linked_from', () => {
    expect(matchesExpectedTrack({ uri: 'spotify:track:relinked', linked_from: { uri: URI } }, URI)).toBe(true);
  });

  test('rejects a different track, a missing item, or a missing expected URI', () => {
    expect(matchesExpectedTrack({ uri: 'spotify:track:other' }, URI)).toBe(false);
    expect(matchesExpectedTrack(null, URI)).toBe(false);
    expect(matchesExpectedTrack({ uri: URI }, null)).toBe(false);
  });
});

describe('startupPollVerdict', () => {
  const base = { expectedUri: URI, confirmed: false };

  test('waits on 204 (no active device) inside the grace window', () => {
    expect(startupPollVerdict({ ...base, status: 204, data: null, elapsedMs: 0 })).toBe('wait');
  });

  test('waits when there is no item yet', () => {
    expect(startupPollVerdict({ ...base, status: 200, data: { is_playing: false, item: null }, elapsedMs: 3000 })).toBe('wait');
  });

  test('waits while the previous track is still reported', () => {
    expect(startupPollVerdict({ ...base, status: 200, data: playing('spotify:track:previous'), elapsedMs: 4000 })).toBe('wait');
  });

  test('waits while the expected track is loaded but not playing yet', () => {
    const data = { is_playing: false, progress_ms: 0, item: { uri: URI, duration_ms: 200000 } };
    expect(startupPollVerdict({ ...base, status: 200, data, elapsedMs: 2000 })).toBe('wait');
  });

  test('confirms once the expected track is playing', () => {
    expect(startupPollVerdict({ ...base, status: 200, data: playing(URI), elapsedMs: 1000 })).toBe('confirmed');
  });

  test('confirms a relinked track', () => {
    const data = playing('spotify:track:relinked', { linked_from: { uri: URI } });
    expect(startupPollVerdict({ ...base, status: 200, data, elapsedMs: 1000 })).toBe('confirmed');
  });

  test('hands back to normal logic after the grace window expires', () => {
    expect(startupPollVerdict({ ...base, status: 204, data: null, elapsedMs: STARTUP_GRACE_MS })).toBe('evaluate');
    expect(startupPollVerdict({ ...base, status: 200, data: playing('spotify:track:other'), elapsedMs: STARTUP_GRACE_MS + 1 })).toBe('evaluate');
  });

  test('always evaluates normally once startup was confirmed', () => {
    expect(startupPollVerdict({ ...base, confirmed: true, status: 204, data: null, elapsedMs: 0 })).toBe('evaluate');
  });

  test('respects a custom grace window', () => {
    expect(startupPollVerdict({ ...base, status: 204, data: null, elapsedMs: 3000, graceMs: 5000 })).toBe('wait');
    expect(startupPollVerdict({ ...base, status: 204, data: null, elapsedMs: 6000, graceMs: 5000 })).toBe('evaluate');
  });
});

// parachord#1300: started inside its album, Spotify plays on into the album's
// next track, so the poller times one poll for just before the end.
describe('endCheckDelayMs', () => {
  const { endCheckDelayMs, END_CHECK_LEAD_MS } = require('../../spotify-startup-grace');
  const POLL = 20000;

  test('an end before the next regular poll gets a check just ahead of it', () => {
    expect(endCheckDelayMs(12000, POLL)).toBe(12000 - END_CHECK_LEAD_MS);
  });

  test('an end the regular poll will see first gets none yet', () => {
    expect(endCheckDelayMs(60000, POLL)).toBeNull();
    expect(endCheckDelayMs(POLL + END_CHECK_LEAD_MS, POLL)).toBeNull();
  });

  test('inside the lead it checks at once', () => {
    expect(endCheckDelayMs(800, POLL)).toBe(0);
  });

  test('lands inside the poller\'s 2 s near-end window', () => {
    expect(END_CHECK_LEAD_MS).toBeGreaterThan(0);
    expect(END_CHECK_LEAD_MS).toBeLessThan(2000);
  });

  test('no time left, or no duration, means no check', () => {
    expect(endCheckDelayMs(0, POLL)).toBeNull();
    expect(endCheckDelayMs(-500, POLL)).toBeNull();
    expect(endCheckDelayMs(NaN, POLL)).toBeNull();
  });
});
