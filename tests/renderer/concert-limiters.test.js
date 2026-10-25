/**
 * Concerts: one limiter per concert service, so services don't queue behind
 * each other (parachord: Concerts took 30s+ to load with SeatGeek and
 * Ticketmaster sharing one 2-in-flight queue).
 */

const { createLimiter } = require('../../resolver-limiter');
const { createConcertLimiters, isConcertThrottleError, CONCERT_LIMITER_OPTIONS } = require('../../src/renderer/lib/concert-limiters');

describe('createConcertLimiters', () => {
  test('one limiter per service, reused for the same service', () => {
    const made = [];
    const limiters = createConcertLimiters((opts) => {
      made.push(opts);
      return { run: (fn) => fn() };
    });
    const tm = limiters.forService('ticketmaster');
    expect(limiters.forService('ticketmaster')).toBe(tm);
    expect(limiters.forService('seatgeek')).not.toBe(tm);
    expect(made.map(o => o.name)).toEqual(['concertsLimiter:ticketmaster', 'concertsLimiter:seatgeek']);
    // Each keeps the shared limiter's Ticketmaster-safe settings.
    for (const opts of made) {
      expect(opts).toMatchObject(CONCERT_LIMITER_OPTIONS);
      expect(opts.isThrottleError).toBe(isConcertThrottleError);
    }
  });

  test('two services run side by side instead of sharing two slots', async () => {
    const limiters = createConcertLimiters(createLimiter);
    let inFlight = 0;
    let peak = 0;
    const call = () => new Promise((resolve) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      setTimeout(() => { inFlight--; resolve(); }, 900);
    });
    await Promise.all(['ticketmaster', 'seatgeek'].flatMap(id => [
      limiters.forService(id).run(call),
      limiters.forService(id).run(call),
    ]));
    // A shared limiter would cap this at 2.
    expect(peak).toBe(4);
  });

  test('throttle errors are recognised', () => {
    expect(isConcertThrottleError(new Error('HTTP 429'))).toBe(true);
    expect(isConcertThrottleError(new Error('Rate limit exceeded'))).toBe(true);
    expect(isConcertThrottleError(new Error('Too Many Requests'))).toBe(true);
    expect(isConcertThrottleError(new Error('HTTP 500'))).toBe(false);
  });
});
