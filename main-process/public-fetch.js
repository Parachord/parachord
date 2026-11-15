// main-process/public-fetch.js: fetch a URL that a user or a link supplied
// (a hosted XSPF playlist, a parachord://play tracklist, a SoundCloud short
// link), without letting it reach the local network or fill memory.
//
// The renderer used to `fetch(url)` and check afterwards
// (`hostedPlaylistFetchProblem(url, response.url, text.length)`): by then the
// redirect to a private address had already been requested and the whole
// body read. A renderer can't do better, because `redirect: 'manual'` there
// gives an opaque response with no Location. So these fetches run here:
//   - redirects are followed by hand, and every hop is checked with
//     `isPublicHttpUrl` (protocol-url.js, the same check the renderer uses)
//     BEFORE it is requested;
//   - a Content-Length over the cap is refused up front, and the body is read
//     as a stream that stops at the cap.
// DNS rebinding stays out of scope (docs/protocol-schema.md says so).
//
// Callers pick a fixed PROFILE (the IPC accepts a profile name, never limits),
// so the renderer can't widen them.

const { isPublicHttpUrl, HOSTED_PLAYLIST_MAX_BYTES } = require('../protocol-url');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const isSoundCloudHost = (url) => {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com');
  } catch {
    return false;
  }
};

const PROFILES = {
  // A hosted XSPF: import, the launch reload, the 5-minute poll. Public
  // redirects are allowed (Dropbox `dl=1`, http to https).
  'hosted-playlist': { method: 'GET', maxBytes: HOSTED_PLAYLIST_MAX_BYTES, maxRedirects: 5 },
  // parachord://play/*?url=: no redirects, as the renderer's
  // `redirect: 'error'` had it; 100 KB, as before.
  'protocol-tracklist': { method: 'GET', maxBytes: 100 * 1024, maxRedirects: 0 },
  // on.soundcloud.com → its canonical URL: HEAD only, every hop public and on
  // SoundCloud.
  'soundcloud-short': {
    method: 'HEAD',
    maxBytes: 0,
    maxRedirects: 5,
    allowHop: (url) => isPublicHttpUrl(url) && isSoundCloudHost(url),
  },
};

async function discard(response) {
  try { if (response.body && response.body.cancel) await response.body.cancel(); } catch { /* ignore */ }
}

// The body as bytes, read as a stream that stops at maxBytes; a declared
// Content-Length over it is refused before reading. tooLarge names the error.
async function readBytesCapped(response, maxBytes, tooLarge) {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await discard(response);
    throw new Error(tooLarge);
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch { /* ignore */ }
      throw new Error(tooLarge);
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { all.set(c, offset); offset += c.byteLength; }
  return all;
}

async function readCapped(response, maxBytes) {
  const bytes = await readBytesCapped(response, maxBytes, `Playlist is too large (max ${formatBytes(maxBytes)})`);
  return new TextDecoder('utf-8').decode(bytes);
}

function formatBytes(n) {
  return n >= 1024 * 1024 ? `${Math.round(n / (1024 * 1024))} MB` : `${Math.round(n / 1024)} KB`;
}

const DEFAULT_MESSAGES = {
  refusedHop: 'Playlist URL redirected to a private address',
  noRedirects: 'Playlist URL redirected; redirects are not allowed here',
  noLocation: 'Playlist URL redirected without a location',
  badLocation: 'Playlist URL redirected to an invalid address',
  tooMany: 'Too many redirects',
};

/**
 * Request `url`, following redirects by hand: each hop is checked with
 * `allowHop` BEFORE it is requested. As in a browser, a 303 (or a 301/302
 * after a POST) turns into a GET without the body, a 307/308 keeps both, and
 * Authorization/Cookie are dropped when a hop changes origin. Resolves the
 * final, non-redirect response and its URL; throws on a refused hop, a missing
 * or bad Location, or too many redirects. The first URL is the caller's to
 * check.
 */
async function followCheckedRedirects(url, {
  method = 'GET', body, headers, maxRedirects, allowHop, fetchImpl, messages = DEFAULT_MESSAGES,
}) {
  let current = url;
  let currentMethod = method;
  let currentBody = body;
  const hopHeaders = headers ? { ...headers } : undefined;
  for (let hop = 0; ; hop++) {
    // A copy per hop: the next hop may drop credentials from hopHeaders.
    const init = { method: currentMethod, redirect: 'manual', headers: hopHeaders ? { ...hopHeaders } : undefined };
    if (currentBody !== undefined) init.body = currentBody;
    const response = await fetchImpl(current, init);
    if (!REDIRECT_STATUSES.has(response.status)) return { response, finalUrl: current };
    const location = response.headers.get('location');
    await discard(response);
    if (!location) throw new Error(messages.noLocation);
    if (maxRedirects === 0) throw new Error(messages.noRedirects);
    if (hop >= maxRedirects) throw new Error(messages.tooMany);
    let next;
    try { next = new URL(location, current).href; } catch { throw new Error(messages.badLocation); }
    if (!allowHop(next)) throw new Error(messages.refusedHop);
    if (hopHeaders && new URL(next).origin !== new URL(current).origin) {
      for (const key of Object.keys(hopHeaders)) {
        if (key.toLowerCase() === 'authorization' || key.toLowerCase() === 'cookie') delete hopHeaders[key];
      }
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && currentMethod === 'POST')) {
      currentMethod = currentMethod === 'HEAD' ? 'HEAD' : 'GET';
      currentBody = undefined;
    }
    current = next;
  }
}

/**
 * @param {string} url
 * @param {{ method?: string, maxBytes: number, maxRedirects: number,
 *   allowHop?: (url: string) => boolean, headers?: object,
 *   fetchImpl: typeof fetch }} opts
 * @returns {Promise<{ ok: boolean, status: number, finalUrl: string,
 *   contentType: string, text: string }>} throws on a refused hop, too many
 *   redirects, or a body over the cap; a non-2xx answer returns ok:false.
 */
async function fetchPublic(url, { method = 'GET', maxBytes, maxRedirects, allowHop = isPublicHttpUrl, headers, fetchImpl }) {
  if (!allowHop(url)) throw new Error('Playlist URL must be a public http(s) address');
  const { response, finalUrl } = await followCheckedRedirects(url, { method, headers, maxRedirects, allowHop, fetchImpl });
  const contentType = response.headers.get('content-type') || '';
  if (!response.ok) {
    await discard(response);
    return { ok: false, status: response.status, finalUrl, contentType, text: '' };
  }
  const text = method === 'HEAD' ? '' : await readCapped(response, maxBytes);
  if (method === 'HEAD') await discard(response);
  return { ok: true, status: response.status, finalUrl, contentType, text };
}

module.exports = { fetchPublic, followCheckedRedirects, readBytesCapped, formatBytes, PROFILES, isSoundCloudHost };
