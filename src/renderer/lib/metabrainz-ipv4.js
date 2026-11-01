// MusicBrainz and Cover Art Archive requests that fall back to IPv4.
//
// Both hosts share one IPv6 address, and on 2026-11-01 it reset the TLS
// handshake for hours while IPv4 worked. Chromium falls back to IPv4 only when
// the connection fails, not the handshake, so every request from the renderer
// failed. createIpv4Fallback wraps the renderer's fetch for those hosts: a
// request that fails like that (a network error, not an HTTP status) is retried
// through the main process with IPv4 forced (main-process/ipc/metabrainz-ipv4.js),
// and for preferMs after that, requests go there directly instead of failing
// over IPv6 first. Then IPv6 gets another try.
//
// The IPv4 path answers with a real Response (status, the headers callers read,
// a JSON or text body) whose url is the final URL after redirects: the album-art
// pipeline uses a Cover Art Archive redirect's target as the image URL. It
// can't be aborted mid-flight; an aborted signal rejects the caller at once
// and the main-process answer is dropped.

const { isNetworkFailure } = require('./musicbrainz-fetch');

const PREFER_IPV4_MS = 10 * 60 * 1000;
const NULL_BODY_STATUSES = new Set([101, 204, 205, 304]);

const abortError = () => (typeof DOMException === 'function'
  ? new DOMException('Aborted', 'AbortError')
  : Object.assign(new Error('Aborted'), { name: 'AbortError' }));

function withAbort(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(abortError());
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve(value); },
      (error) => { signal.removeEventListener('abort', onAbort); reject(error); }
    );
  });
}

const urlOf = (input) => (typeof input === 'string' ? input : (input && input.url) || String(input));

function createIpv4Fallback({ fetchDirect, fetchIpv4, now = Date.now, preferMs = PREFER_IPV4_MS, log = () => {} }) {
  let preferUntil = 0;

  const viaIpv4 = async (input, init) => {
    const result = await fetchIpv4(urlOf(input), { method: (init && init.method) || 'GET' });
    if (!result || !result.success) {
      throw Object.assign(new TypeError('Failed to fetch'), { ipv4Error: result && result.error });
    }
    const body = NULL_BODY_STATUSES.has(result.status) ? null : (result.body ?? null);
    const response = new Response(body, {
      status: result.status,
      statusText: result.statusText || '',
      headers: result.headers || {},
    });
    Object.defineProperty(response, 'url', { value: result.url });
    return response;
  };

  return {
    async fetch(input, init = {}) {
      const signal = init && init.signal;
      if (now() < preferUntil) return withAbort(viaIpv4(input, init), signal);
      try {
        return await fetchDirect(input, init);
      } catch (error) {
        if (!isNetworkFailure(error) || (signal && signal.aborted)) throw error;
        let response;
        try {
          response = await withAbort(viaIpv4(input, init), signal);
        } catch (ipv4Error) {
          if (ipv4Error && ipv4Error.name === 'AbortError') throw ipv4Error;
          throw error; // both failed: the caller's retry layer sees the original network error
        }
        preferUntil = now() + preferMs;
        log(`MetaBrainz unreachable over the default route; using IPv4 for ${Math.round(preferMs / 60000)} min`);
        return response;
      }
    },
    isPreferringIpv4: () => now() < preferUntil,
  };
}

module.exports = { createIpv4Fallback, PREFER_IPV4_MS };
