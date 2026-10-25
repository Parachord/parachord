// src/renderer/lib/concert-limiters.js — one request limiter per concert service.
//
// Every Concerts lookup used to go through a single shared limiter (2 in
// flight, 400ms between starts), so SeatGeek waited behind Ticketmaster even
// though each service has its own rate limit. 40 artists x 2 services was 80
// lookups in one queue: at least 32 seconds before anything showed (2026-10).
// Each service now gets its own limiter with the settings the shared one had,
// which Ticketmaster needs (5 req/s, and an artist lookup is 2 calls: the
// attraction search, then its events); the services run side by side.

const CONCERT_LIMITER_OPTIONS = {
  maxConcurrency: 2,
  minGapMs: 400,
  cooldownMs: 5000,
  errorThreshold: 2,
};

const isConcertThrottleError = (err) => /\b429\b|rate.?limit|too many/i.test(String(err && err.message));

// createLimiter: resolver-limiter.js's factory (window.createLimiter).
function createConcertLimiters(createLimiter) {
  const byService = new Map();
  return {
    forService(serviceId) {
      let limiter = byService.get(serviceId);
      if (!limiter) {
        limiter = createLimiter({
          ...CONCERT_LIMITER_OPTIONS,
          name: `concertsLimiter:${serviceId}`,
          isThrottleError: isConcertThrottleError,
        });
        byService.set(serviceId, limiter);
      }
      return limiter;
    },
  };
}

module.exports = { createConcertLimiters, isConcertThrottleError, CONCERT_LIMITER_OPTIONS };
