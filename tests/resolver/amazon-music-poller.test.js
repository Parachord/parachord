/**
 * Tests for the Amazon Music playback poller state machine (amazon-music-poller.js).
 *
 * These exist because the two races the poller used to lose are integration
 * bugs the pure decidePollAdvance tests cannot see:
 *   - overlapping polls firing while a previous poll is awaiting haltPlayback
 *     (the fast interval is 400ms; a halt pauses + loads about:blank) used to
 *     send advance twice per track end
 *   - stop() during the halt (user skip) left the halt running and the advance
 *     signal still fired
 *   - the pause-death grace window never elapsed because the counter reset
 *     itself after the first dead tick
 */

const { createAmazonMusicPoller } = require('../../amazon-music-poller');

// Queue of player states; the last entry repeats.
function makePlayer(states, { haltImpl } = {}) {
  const queue = [...states];
  const sends = [];
  const player = {
    haltPlayback: jest.fn(async () => {}),
    async getPlaybackState() {
      const next = queue.length > 1 ? queue.shift() : queue[0];
      return next;
    }
  };
  if (haltImpl) player.haltPlayback.mockImplementation(haltImpl);
  const send = (channel, data) => sends.push({ channel, data });
  const poller = createAmazonMusicPoller({ player, send });
  return { poller, player, sends };
}

const playing = (positionMs, durationMs = 180000) => ({ state: 'PLAYING', asin: 'B1', positionMs, durationMs });

describe('Amazon Music poller', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('a near-end advance halts once even while fast-poll ticks overlap the halt', async () => {
    let resolveHalt;
    const haltPromise = new Promise((resolve) => { resolveHalt = resolve; });
    const { poller, player, sends } = makePlayer([playing(179500)], {
      haltImpl: () => haltPromise
    });

    const started = poller.start({ asin: 'B1', duration: 180 });
    // Start delay, then poll 1 decides near-end and enters haltPlayback.
    await jest.advanceTimersByTimeAsync(1200);
    expect(player.haltPlayback).toHaveBeenCalledTimes(1);

    // Interval ticks while the halt is pending — all dropped by single flight.
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    await jest.advanceTimersByTimeAsync(400);
    expect(player.haltPlayback).toHaveBeenCalledTimes(1);

    resolveHalt();
    await started;

    const advances = sends.filter(s => s.channel === 'amazonmusic-polling-advance');
    expect(advances).toEqual([{ channel: 'amazonmusic-polling-advance', data: { reason: 'near-end' } }]);
    expect(poller.interval).toBeNull(); // stopped after advancing
  });

  test('stop() during the halt cancels the advance signal (a user skip owns the next track)', async () => {
    let resolveHalt;
    const haltPromise = new Promise((resolve) => { resolveHalt = resolve; });
    const { poller, player, sends } = makePlayer([playing(179500)], {
      haltImpl: () => haltPromise
    });

    const started = poller.start({ asin: 'B1', duration: 180 });
    await jest.advanceTimersByTimeAsync(1200);
    expect(player.haltPlayback).toHaveBeenCalledTimes(1);

    poller.stop(); // user skipped while the halt was in flight
    await jest.advanceTimersByTimeAsync(400);
    resolveHalt();
    await started;

    expect(sends.filter(s => s.channel === 'amazonmusic-polling-advance')).toEqual([]);
  });

  test('a rejected halt still advances', async () => {
    const { poller, sends } = makePlayer([playing(179500)], {
      haltImpl: async () => { throw new Error('view gone'); }
    });
    const started = poller.start({ asin: 'B1', duration: 180 });
    await jest.advanceTimersByTimeAsync(1200);
    await started;
    const advances = sends.filter(s => s.channel === 'amazonmusic-polling-advance');
    expect(advances).toEqual([{ channel: 'amazonmusic-polling-advance', data: { reason: 'near-end' } }]);
  });

  test('a page that dies under a pause advances after the grace window (the latch survives lastState churn)', async () => {
    const { poller, sends } = makePlayer([
      playing(60000),           // lastState -> PLAYING
      { state: 'PAUSED', asin: 'B1', positionMs: 60000, durationMs: 180000 }, // lastState -> PAUSED
      { state: 'EMPTY', asin: null, positionMs: 0, durationMs: 180000 }       // dead under pause; repeats
    ]);
    const started = poller.start({ asin: 'B1', duration: 180 });

    // Grace window: EMPTY_WHILE_PAUSED_POLL_LIMIT (30) dead polls at 2s each,
    // plus the start delay and the two live polls.
    await jest.advanceTimersByTimeAsync(70000);
    await started;

    const advances = sends.filter(s => s.channel === 'amazonmusic-polling-advance');
    expect(advances).toEqual([{ channel: 'amazonmusic-polling-advance', data: { reason: 'stopped' } }]);
    expect(poller.interval).toBeNull();
  });

  test('a player that was never alive never advances', async () => {
    const { poller, sends } = makePlayer([
      { state: 'EMPTY', asin: null, positionMs: 0, durationMs: 0 }
    ]);
    const started = poller.start({ asin: 'B1', duration: 180 });
    await jest.advanceTimersByTimeAsync(1200);
    await started;
    await jest.advanceTimersByTimeAsync(90000);

    expect(sends.filter(s => s.channel === 'amazonmusic-polling-advance')).toEqual([]);
    expect(poller.interval).not.toBeNull(); // still polling, still waiting
  });

  test('five consecutive read errors signal connection-lost and stop', async () => {
    const player = {
      haltPlayback: jest.fn(async () => {}),
      getPlaybackState: jest.fn(async () => { throw new Error('view is gone'); })
    };
    const sends = [];
    const poller = createAmazonMusicPoller({ player, send: (c, d) => sends.push({ channel: c, data: d }) });

    const started = poller.start({ asin: 'B1', duration: 180 }); // poll 1 (error 1) after the start delay, then the 2s interval
    await jest.advanceTimersByTimeAsync(1200);
    await jest.advanceTimersByTimeAsync(10000);                   // errors 2..5
    await started;

    expect(sends.filter(s => s.channel === 'amazonmusic-polling-advance'))
      .toEqual([{ channel: 'amazonmusic-polling-advance', data: { reason: 'connection-lost' } }]);
    expect(player.haltPlayback).not.toHaveBeenCalled();
    expect(poller.interval).toBeNull();
  });

  test('a user seek near the end does not advance while suppressed, and finishes when the track ends', async () => {
    const { poller, sends } = makePlayer([
      playing(170000),           // poll 1: mid-track
      playing(179500),          // poll 2: right after the user seek (suppressed)
      { state: 'FINISHED', asin: 'B1', positionMs: 180000, durationMs: 180000 } // poll 3: ended
    ]);
    const started = poller.start({ asin: 'B1', duration: 180 });
    await jest.advanceTimersByTimeAsync(1200); // poll 1 done

    poller.noteUserSeek(179500); // suppress advances for 4s, remember the seek position
    await jest.advanceTimersByTimeAsync(2000); // poll 2: near-end but suppressed -> continue
    expect(sends.filter(s => s.channel === 'amazonmusic-polling-advance')).toEqual([]);

    await jest.advanceTimersByTimeAsync(2000); // suppress expired, track finished
    await started;
    expect(sends.filter(s => s.channel === 'amazonmusic-polling-advance'))
      .toEqual([{ channel: 'amazonmusic-polling-advance', data: { reason: 'finished' } }]);
  });

  test('stop() is idempotent', async () => {
    const { poller } = makePlayer([playing(60000)]);
    poller.start({ asin: 'B1', duration: 180 });
    await jest.advanceTimersByTimeAsync(1200);
    poller.stop();
    poller.stop();
    expect(poller.interval).toBeNull();
  });
});
