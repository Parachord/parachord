// main-process/ipc/plex-fetch.js — the Plex-scoped HTTP handler (plex-fetch).
//
// The Plex resolver talks to the user's own servers on the LAN: private IPs
// and *.plex.direct hosts (which resolve to private IPs), sometimes with
// self-signed TLS. The renderer's fetch is blocked by CORS and the general
// proxy-fetch refuses private addresses, so Plex requests come through here.
//
// This is NOT a general fetch. Any marketplace .axe runs in the renderer with
// window.electron in reach, so an open "fetch anything, TLS off" handler would
// be a confused-deputy SSRF (parachord#926 review). The policy below:
//
//  - Host allowlist: plex.tv / *.plex.tv (the account API), *.plex.direct
//    (Plex's per-server hostnames), and the connection hosts the user saved by
//    selecting libraries in Settings (meta_service_configs.plex.libraries[]
//    .connections). Everything else is refused; the renderer's proxy-fetch
//    and its private-IP guard remain the path for anything that is not Plex.
//  - TLS verification stays ON for plex.tv and *.plex.direct (valid
//    certificates; the PIN-to-token exchange must not be MITM-able). It is
//    relaxed only for a saved connection host (a self-signed LAN server the
//    user chose).
//  - Redirects are refused (a 3xx is an error), so a response can never bounce
//    the token to another host.
//  - A server's plain local address (http://<LAN IP>:<port>), but only one
//    plex.tv itself reported as a LOCAL connection of the signed-in account,
//    in a resources answer this handler relayed (plex.tv's TLS is verified),
//    and only a private or loopback IP. Plex's apps fall back to it when the
//    secure *.plex.direct name doesn't resolve: many home routers drop DNS
//    answers that point at private addresses (DNS-rebinding protection), and
//    then a server in the same room is unreachable by name. Remembered for the
//    session only; once the user saves libraries, the address is in their
//    saved connections like any other.
//
// `plexFetchPolicy` is pure and unit-tested; `registerPlexFetchIpc` is
// dependency-injected (ipcMain, store, transports) so the handler is tested
// with a fake transport (tests/main-process/plex-fetch.test.js).

const MAX_RESPONSE_BYTES = 10 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;

function hostMatches(hostname, pattern) {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1); // ".plex.direct"
    return hostname.endsWith(suffix) && hostname.length > suffix.length;
  }
  return hostname === pattern;
}

const PLEX_HOSTS = ['plex.tv', '*.plex.tv', '*.plex.direct'];

// An IPv4 literal on a private or loopback range (RFC 1918, 127/8, and
// 100.64/10 for CGNAT and Tailscale): the only addresses a reported local
// connection may add.
function isPrivateIPv4(host) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(host));
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if ([m[1], m[2], m[3], m[4]].some((x) => Number(x) > 255)) return false;
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// The plain local addresses ("host:port") in a plex.tv resources answer: each
// LOCAL connection's address and port, private IPv4 only. Junk is ignored.
function reportedLocalAddresses(resourcesText) {
  const out = new Set();
  let list;
  try { list = JSON.parse(resourcesText); } catch (e) { return out; }
  for (const r of (Array.isArray(list) ? list : [])) {
    for (const c of (r && Array.isArray(r.connections) ? r.connections : [])) {
      if (!c || c.local !== true || c.relay === true) continue;
      const port = Number(c.port);
      if (!isPrivateIPv4(c.address) || !Number.isInteger(port) || port <= 0 || port > 65535) continue;
      out.add(`${c.address}:${port}`);
    }
  }
  return out;
}

// Is this the account's server list on plex.tv (whose answer may teach us
// local addresses)?
function isResourcesUrl(u) {
  return u.protocol === 'https:' && u.hostname.toLowerCase() === 'plex.tv' && u.pathname === '/api/v2/resources';
}

// Hosts (hostname[:port] not needed — hostname only) from the saved library
// selection. Malformed entries are ignored.
function savedConnectionHosts(plexConfig) {
  const hosts = new Set();
  const libraries = (plexConfig && Array.isArray(plexConfig.libraries)) ? plexConfig.libraries : [];
  for (const lib of libraries) {
    for (const conn of (Array.isArray(lib && lib.connections) ? lib.connections : [])) {
      try {
        const u = new URL(String(conn));
        if (u.protocol === 'http:' || u.protocol === 'https:') hosts.add(u.hostname.toLowerCase());
      } catch (e) { /* not a URL */ }
    }
  }
  return hosts;
}

// Decide whether a URL may be fetched and with what TLS posture.
// Returns { allowed: false, error } or { allowed: true, rejectUnauthorized }.
function plexFetchPolicy(url, plexConfig, reportedLocal) {
  let u;
  try {
    u = new URL(String(url));
  } catch (e) {
    return { allowed: false, error: `Invalid URL: ${e.message}` };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { allowed: false, error: 'Only HTTP and HTTPS URLs are allowed' };
  }
  const hostname = u.hostname.toLowerCase();
  if (PLEX_HOSTS.some((p) => hostMatches(hostname, p))) {
    return { allowed: true, rejectUnauthorized: true };
  }
  if (savedConnectionHosts(plexConfig).has(hostname)) {
    return { allowed: true, rejectUnauthorized: false };
  }
  // A plain local address plex.tv reported this session: http only, the
  // exact host and port it reported.
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (u.protocol === 'http:' && reportedLocal && reportedLocal.has(`${hostname}:${port}`)) {
    return { allowed: true, rejectUnauthorized: true };
  }
  return { allowed: false, error: `Host ${hostname} is not a Plex host or a saved Plex server connection` };
}

function registerPlexFetchIpc({ ipcMain, store, transports }) {
  const getTransports = () => transports || { 'http:': require('http'), 'https:': require('https') };
  // Local addresses plex.tv reported this session (see the policy above).
  const reportedLocal = new Set();

  ipcMain.handle('plex-fetch', async (event, url, options = {}) => {
    const plexConfig = (store.get('meta_service_configs') || {}).plex;
    const policy = plexFetchPolicy(url, plexConfig, reportedLocal);
    if (!policy.allowed) {
      return { ok: false, status: 0, error: policy.error };
    }
    const urlObj = new URL(String(url));
    const transport = getTransports()[urlObj.protocol];
    const reqOptions = {
      method: options.method || 'GET',
      headers: options.headers || {},
      rejectUnauthorized: policy.rejectUnauthorized
    };

    return await new Promise((resolve) => {
      let settled = false;
      const done = (result) => { if (!settled) { settled = true; resolve(result); } };
      let req;
      try {
        req = transport.request(urlObj, reqOptions, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400) {
            res.resume();
            done({ ok: false, status: res.statusCode, error: 'Redirects are not followed for Plex requests' });
            return;
          }
          let data = '';
          let received = 0;
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            received += Buffer.byteLength(chunk);
            if (received > MAX_RESPONSE_BYTES) {
              req.destroy();
              done({ ok: false, status: 0, error: 'Response exceeded 10MB limit' });
              return;
            }
            data += chunk;
          });
          res.on('end', () => {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            if (ok && isResourcesUrl(urlObj)) {
              for (const a of reportedLocalAddresses(data)) reportedLocal.add(a);
            }
            done({ ok, status: res.statusCode, text: data });
          });
        });
      } catch (err) {
        done({ ok: false, status: 0, error: err.message });
        return;
      }
      req.on('error', (err) => done({ ok: false, status: 0, error: err.message }));
      req.setTimeout(options.timeoutMs || DEFAULT_TIMEOUT_MS, () => { req.destroy(); done({ ok: false, status: 0, error: 'Request timed out' }); });
      if (options.body) req.write(options.body);
      req.end();
    });
  });
}

module.exports = { plexFetchPolicy, savedConnectionHosts, reportedLocalAddresses, isPrivateIPv4, registerPlexFetchIpc, MAX_RESPONSE_BYTES };
