// src/renderer/lib/itunes-rate-limiter.js — the one queue every iTunes Search
// / Lookup request goes through (window.iTunesRateLimiter in app.js).
//
// iTunes allows about 20 requests a minute per IP and answers 403 or 429 past
// it. Requests start at least MIN_INTERVAL_MS apart, one at a time, in two
// lanes like createLimiter's (resolver-limiter.js): covers wait in the
// background lane behind Apple Music resolution (which goes through iTunes
// whenever MusicKit can't answer), and opts.priority (a play click) goes to
// the front.
//
// Refusals open a circuit instead of being ground through. The old limiter
// retried each refused request 3 times with growing backoff and widened its
// spacing 500ms per error, one request at a time: live 2026-11-12, 34 errors
// in, each queued request took about 48s and 42 were waiting, so Apple Music
// resolution and every row waiting on it stalled for half an hour. Now a
// refusal is retried once after RETRY_BACKOFF_MS; one that survives the retry
// opens the circuit for a cool-down (CIRCUIT_BASE_MS, doubling while iTunes
// keeps refusing, up to CIRCUIT_MAX_MS), during which every waiting and new
// request is answered at once with a 429 and never reaches the network.
// Callers already treat a non-OK response as "iTunes had nothing" (covers fall
// through to the next source; Apple Music's search throws, so nothing is
// cached as a miss). A success closes the circuit and resets the cool-down.
//
// Pure (no window at module scope), unit-tested in
// tests/resolver/itunes-rate-limiter.test.js.

const ITUNES_LIMITS = {
  MIN_INTERVAL_MS: 1200,
  RETRY_BACKOFF_MS: 2000,
  CIRCUIT_BASE_MS: 30000,
  CIRCUIT_MAX_MS: 300000
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The answer a request gets while the circuit is open.
const circuitOpenResponse = () => {
  if (typeof Response === 'function') {
    try {
      return new Response('{}', { status: 429, statusText: 'iTunes circuit open' });
    } catch (e) { /* fall through */ }
  }
  return { ok: false, status: 429, statusText: 'iTunes circuit open', json: async () => ({}) };
};

const isRefusal = (status) => status === 403 || status === 429;

function createITunesRateLimiter({ fetchImpl, log } = {}) {
  const doFetch = fetchImpl || ((url) => globalThis.fetch(url));
  const logger = log || (typeof console !== 'undefined' ? console : { warn() {}, log() {} });
  const { MIN_INTERVAL_MS, RETRY_BACKOFF_MS, CIRCUIT_BASE_MS, CIRCUIT_MAX_MS } = ITUNES_LIMITS;

  let lastRequestTime = 0;
  const pendingQueue = [];
  const pendingBackground = [];
  let isProcessing = false;
  let consecutiveErrors = 0;
  let openUntil = 0;
  let cooldownMs = CIRCUIT_BASE_MS;
  let refusingSinceSuccess = false;

  const isOpen = () => Date.now() < openUntil;
  const nextJob = () => (pendingQueue.length > 0 ? pendingQueue.shift() : pendingBackground.shift());
  const answerWaitingWithCircuitOpen = () => {
    while (pendingQueue.length > 0 || pendingBackground.length > 0) nextJob().resolve(circuitOpenResponse());
  };
  const attempt = async (url) => {
    try {
      return { response: await doFetch(url) };
    } catch (error) {
      return { error };
    }
  };

  const processQueue = async () => {
    if (isProcessing) return;
    isProcessing = true;
    try {
      while (pendingQueue.length > 0 || pendingBackground.length > 0) {
        if (isOpen()) { answerWaitingWithCircuitOpen(); break; }
        const job = nextJob();
        const wait = lastRequestTime + MIN_INTERVAL_MS - Date.now();
        if (wait > 0) await sleep(wait);
        if (isOpen()) { job.resolve(circuitOpenResponse()); continue; }

        lastRequestTime = Date.now();
        let result = await attempt(job.url);
        if (result.error || isRefusal(result.response && result.response.status)) {
          await sleep(RETRY_BACKOFF_MS);
          lastRequestTime = Date.now();
          result = await attempt(job.url);
        }

        if (result.error) {
          consecutiveErrors++;
          job.reject(result.error);
          continue;
        }
        if (isRefusal(result.response.status)) {
          consecutiveErrors++;
          cooldownMs = refusingSinceSuccess ? Math.min(cooldownMs * 2, CIRCUIT_MAX_MS) : CIRCUIT_BASE_MS;
          refusingSinceSuccess = true;
          openUntil = Date.now() + cooldownMs;
          logger.warn(`[iTunesRateLimiter] iTunes refused (${result.response.status}) after a retry: answering iTunes requests at once for ${Math.round(cooldownMs / 1000)}s`);
          job.resolve(result.response);
          continue;
        }
        consecutiveErrors = 0;
        refusingSinceSuccess = false;
        cooldownMs = CIRCUIT_BASE_MS;
        job.resolve(result.response);
      }
    } finally {
      isProcessing = false;
    }
  };

  return {
    fetch: (url, opts) => new Promise((resolve, reject) => {
      if (isOpen()) { resolve(circuitOpenResponse()); return; }
      const job = { url, resolve, reject };
      if (opts && opts.background) pendingBackground.push(job);
      else if (opts && opts.priority) pendingQueue.unshift(job);
      else pendingQueue.push(job);
      processQueue();
    }),
    isOpen,
    getCooldownMs: () => cooldownMs,
    getQueueLength: () => pendingQueue.length + pendingBackground.length,
    getBackgroundQueueLength: () => pendingBackground.length,
    getErrorCount: () => consecutiveErrors
  };
}

module.exports = { createITunesRateLimiter, ITUNES_LIMITS };
