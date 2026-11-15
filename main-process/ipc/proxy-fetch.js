// main-process/ipc/proxy-fetch.js: the CORS-bypass fetch the renderer uses
// for APIs a file:// page can't call directly (the scrobblers: ListenBrainz,
// Last.fm-style APIs, including POSTs; Deezer; a few lookups). Plugins don't
// use it: Subsonic and the other resolvers call fetch from the renderer.
//
// It used to check only the first URL and let Node's fetch follow redirects,
// so a public URL could redirect to the local network, and it read whole
// bodies (GHSA-6qxm-h86h-9m79). Now:
//   - the addresses it accepts are unchanged (proxyFetchHostProblem is the
//     old check, moved here), so nothing that worked stops working: a
//     Tailscale 100.x host is still allowed, a LAN or loopback one still isn't;
//   - every redirect hop gets that same check before it is requested
//     (followCheckedRedirects, main-process/public-fetch.js), POST follows
//     browser redirect rules, and credentials don't cross origins;
//   - the body is read up to a generous cap (PROXY_FETCH_MAX_BYTES).
// The response shape is the same as before:
//   { success, status, text | data (base64, responseType 'arraybuffer'), finalUrl, error }.

const { followCheckedRedirects, readBytesCapped, formatBytes } = require('../public-fetch');

const PROXY_FETCH_MAX_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 10;
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
const PRIVATE_MESSAGE = 'Requests to private/internal networks are not allowed';

// The check proxy-fetch has always made, unchanged except that `[::1]` (how
// the URL parser writes the IPv6 loopback) is caught like `::1` was meant to
// be. Returns an error message, or null when the URL is allowed.
function proxyFetchHostProblem(url) {
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return `Invalid URL: ${e.message}`;
  }
  if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
    return 'Only HTTP and HTTPS URLs are allowed';
  }
  const hostname = urlObj.hostname;
  if (hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '0.0.0.0' ||
      hostname === '::1' ||
      hostname === '[::1]' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname === '169.254.169.254' ||
      hostname.endsWith('.local') ||
      hostname.endsWith('.internal')) {
    return PRIVATE_MESSAGE;
  }
  return null;
}

function registerProxyFetchIpc({
  ipcMain,
  fetchImpl = (...args) => fetch(...args),
  isMetaBrainzHost = () => false,
  metabrainzUserAgent,
  log = (...args) => console.log(...args),
}) {
  ipcMain.handle('proxy-fetch', async (_event, url, options = {}) => {
    const method = options.method || 'GET';
    log('=== Proxy Fetch ===', method, url);

    const problem = proxyFetchHostProblem(url);
    if (problem) return { success: false, error: problem };

    const headers = { 'User-Agent': BROWSER_UA, ...options.headers };
    // MetaBrainz hosts require a meaningful, contactable UA: override whatever
    // the caller passed with the canonical one (see METABRAINZ_UA in main.js).
    if (metabrainzUserAgent && isMetaBrainzHost(url)) headers['User-Agent'] = metabrainzUserAgent;

    try {
      const { response, finalUrl } = await followCheckedRedirects(url, {
        method,
        body: options.body || undefined,
        headers,
        maxRedirects: MAX_REDIRECTS,
        allowHop: (next) => proxyFetchHostProblem(next) === null,
        fetchImpl,
        messages: {
          refusedHop: PRIVATE_MESSAGE,
          noRedirects: 'Redirects are not allowed here',
          noLocation: 'Redirected without a location',
          badLocation: 'Redirected to an invalid address',
          tooMany: 'Too many redirects',
        },
      });
      const tooLarge = `Response is too large (max ${formatBytes(PROXY_FETCH_MAX_BYTES)})`;

      if (!response.ok) {
        const bytes = await readBytesCapped(response, PROXY_FETCH_MAX_BYTES, tooLarge);
        const errorText = new TextDecoder('utf-8').decode(bytes);
        log('Proxy fetch failed with status:', response.status, errorText.substring(0, 500));
        return { success: false, status: response.status, error: `HTTP ${response.status}`, text: errorText, finalUrl };
      }

      const bytes = method === 'HEAD'
        ? new Uint8Array(0)
        : await readBytesCapped(response, PROXY_FETCH_MAX_BYTES, tooLarge);

      // Binary (audio and the like): base64 across IPC.
      if (options.responseType === 'arraybuffer') {
        return { success: true, status: response.status, data: Buffer.from(bytes).toString('base64'), finalUrl };
      }

      // finalUrl is the post-redirect URL, so callers can resolve short links.
      return { success: true, status: response.status, text: new TextDecoder('utf-8').decode(bytes), finalUrl };
    } catch (error) {
      log('Proxy fetch error:', error && error.message);
      return { success: false, error: (error && error.message) || 'Fetch failed' };
    }
  });
}

module.exports = { registerProxyFetchIpc, proxyFetchHostProblem, PROXY_FETCH_MAX_BYTES };
