// src/renderer/lib/musicbrainz-fetch.js — MusicBrainz request retries and error wording.
//
// app.js installs one fetch interceptor that sends every musicbrainz.org/ws/2/
// request through the 1 req/s limiter; mbFetchWithRetries is the retry loop it
// runs inside the limiter. It is the ONLY retry layer for MusicBrainz: callers
// use plain fetch (the artist and album pages used to wrap it in their own
// three-attempt loops, so one lookup could make nine attempts).
//
// During a MetaBrainz outage (2026-10) the app got three kinds of failure:
// 503 "server is currently busy" with Retry-After: 0, TLS handshakes dropped
// (fetch rejects with TypeError "Failed to fetch"), and the wrong certificate
// on mapper.listenbrainz.org. Three things went wrong on our side:
//  - Retry-After: 0 was honoured literally, so the three attempts went out
//    back to back with no backoff (mbRetryDelayMs);
//  - a dropped connection was not retried at all (isNetworkFailure);
//  - the artist page called any TypeError mentioning "fetch" a "Network error
//    - please check your internet connection", blaming the user's connection
//    for a MusicBrainz outage (describeMusicBrainzError).

const MB_MAX_ATTEMPTS = 3;

const BACKOFF_CAP_MS = 4000;
const RETRY_AFTER_CAP_MS = 8000;

// Wait before retry number `attempt` (1-based: the wait after the first
// failure is attempt 1). Exponential backoff (1s, 2s, 4s) is the floor; a
// longer Retry-After is honoured up to 8s. Retry-After: 0 or junk does not
// cancel the backoff.
function mbRetryDelayMs(retryAfterHeader, attempt) {
  const backoff = Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), BACKOFF_CAP_MS);
  const seconds = parseInt(retryAfterHeader || '', 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return backoff;
  return Math.max(backoff, Math.min(seconds * 1000, RETRY_AFTER_CAP_MS));
}

// fetch() rejected without an HTTP response: DNS, TLS or a dropped
// connection. Chromium says "Failed to fetch"; matched on the whole message
// so a TypeError like "fetchArtist is not a function" (a code bug) is not
// mistaken for a network failure.
function isNetworkFailure(err) {
  return !!err && err.name === 'TypeError'
    && /^(failed to fetch|networkerror when attempting to fetch resource\.?|load failed|network ?error)$/i.test(String(err.message || '').trim());
}

// Run one MusicBrainz request with retries.
//   doFetch(init)   the real fetch, bound to the URL
//   init            the caller's fetch options (signal honoured)
//   queuedTimeoutMs a per-attempt timeout armed when the attempt starts
//   sleep(ms)       injectable for tests
// 429/503 retry after mbRetryDelayMs and, once attempts run out, throw an
// Error with mbThrottled. A dropped connection on a GET retries the same way
// and, once attempts run out, rethrows the TypeError with mbUnreachable. Both
// flags count toward the limiter cooldown. Aborts and other errors are not
// retried. Any other response, ok or not, is returned as is.
async function mbFetchWithRetries(doFetch, init = {}, {
  queuedTimeoutMs,
  maxAttempts = MB_MAX_ATTEMPTS,
  sleep = (ms) => new Promise(r => setTimeout(r, ms)),
} = {}) {
  const callerSignal = init.signal;
  const hasQueuedTimeout = Number.isFinite(queuedTimeoutMs) && queuedTimeoutMs > 0;
  const method = String(init.method || 'GET').toUpperCase();
  const retriesNetworkFailure = method === 'GET' || method === 'HEAD';
  for (let attempt = 1; ; attempt++) {
    if (callerSignal && callerSignal.aborted) throw new DOMException('Aborted', 'AbortError');
    let attemptInit = init;
    let timer = null;
    if (hasQueuedTimeout) {
      const controller = new AbortController();
      if (callerSignal) callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
      timer = setTimeout(() => controller.abort(), queuedTimeoutMs);
      attemptInit = { ...init, signal: controller.signal };
    }
    let resp;
    try {
      resp = await doFetch(attemptInit);
    } catch (err) {
      if (!retriesNetworkFailure || !isNetworkFailure(err)) throw err;
      if (attempt >= maxAttempts) {
        err.mbUnreachable = true;
        throw err;
      }
      await sleep(mbRetryDelayMs(null, attempt));
      continue;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (resp.status !== 429 && resp.status !== 503) return resp;
    if (attempt >= maxAttempts) {
      const err = new Error(`MusicBrainz throttled (HTTP ${resp.status})`);
      err.mbThrottled = true;
      err.status = resp.status;
      throw err;
    }
    await sleep(mbRetryDelayMs(resp.headers && resp.headers.get('retry-after'), attempt));
  }
}

// What to tell the user when a MusicBrainz-backed page fails to load.
// online: navigator.onLine (false only when the OS reports no network).
function describeMusicBrainzError(err, { online = true } = {}) {
  if (online === false) return 'You appear to be offline. Check your internet connection and try again.';
  if (err && err.mbThrottled) return 'MusicBrainz is busy right now. Try again in a minute.';
  if (err && (err.mbUnreachable || isNetworkFailure(err))) {
    return "Couldn't reach MusicBrainz. It may be down for a moment; try again in a few minutes.";
  }
  if (err && err.name === 'AbortError') return 'MusicBrainz took too long to answer. Try again in a minute.';
  return err && err.message ? `Error: ${err.message}` : 'Something went wrong. Please try again.';
}

module.exports = { mbFetchWithRetries, mbRetryDelayMs, isNetworkFailure, describeMusicBrainzError, MB_MAX_ATTEMPTS };
