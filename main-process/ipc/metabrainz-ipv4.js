// main-process/ipc/metabrainz-ipv4.js — MetaBrainz requests over IPv4.
//
// MusicBrainz and the Cover Art Archive share one IPv6 address. On 2026-11-01
// it accepted connections and then reset the TLS handshake, for hours on end,
// while IPv4 worked. Chromium falls back from IPv6 to IPv4 only when the
// connection itself fails, not the handshake, so every renderer request to
// them failed: discographies, album pages, search and covers. Node's fetch
// races the two families the same way. The renderer retries a request that
// failed like that through this handler (src/renderer/lib/metabrainz-ipv4.js),
// where Node's https module is told to use IPv4.
//
// GET and HEAD only, to the MetaBrainz API and cover hosts. Redirects are
// followed (the Cover Art Archive answers with a 307 to archive.org) over
// https, to MetaBrainz or archive.org hosts only. A JSON or text body comes
// back as a string; any other body (an image) is not read, since the caller
// only needs the final URL.
//
// Dependency-injected ({ ipcMain, userAgent, httpsRequest }) so jest drives
// it directly (tests/main-process/metabrainz-ipv4-ipc.test.js).

const https = require('https');

const START_HOSTS = /(^|\.)(musicbrainz\.org|coverartarchive\.org)$/i;
const REDIRECT_HOSTS = /(^|\.)(musicbrainz\.org|coverartarchive\.org|archive\.org)$/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

function allowedUrl(urlStr, hostRe) {
  try {
    const url = new URL(urlStr);
    return url.protocol === 'https:' && hostRe.test(url.hostname);
  } catch (_e) {
    return false;
  }
}

function requestOnce(httpsRequest, url, { method, userAgent }) {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(url, {
      method,
      family: 4,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': userAgent, Accept: 'application/json, */*' },
    }, resolve);
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
    req.end();
  });
}

function readBody(res) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    res.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        res.destroy();
        reject(new Error('response too large'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

async function fetchMetaBrainzIpv4(url, options = {}, { userAgent, httpsRequest = https.request } = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') return { success: false, error: 'Only GET and HEAD are allowed' };
  if (!allowedUrl(url, START_HOSTS)) return { success: false, error: 'Not a MetaBrainz URL' };

  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res;
    try {
      res = await requestOnce(httpsRequest, current, { method, userAgent });
    } catch (error) {
      return { success: false, error: error.message };
    }
    const status = res.statusCode;
    if (REDIRECT_STATUSES.has(status) && res.headers.location) {
      res.resume();
      const next = new URL(res.headers.location, current).toString();
      if (!allowedUrl(next, REDIRECT_HOSTS)) return { success: false, error: `Redirect to an unexpected host: ${next}` };
      current = next;
      continue;
    }
    const contentType = String(res.headers['content-type'] || '');
    let body = null;
    if (method === 'GET' && /json|text|xml/i.test(contentType)) {
      try {
        body = await readBody(res);
      } catch (error) {
        return { success: false, error: error.message };
      }
    } else {
      res.destroy();
    }
    return {
      success: true,
      status,
      statusText: res.statusMessage || '',
      url: current,
      headers: {
        'content-type': contentType,
        ...(res.headers['retry-after'] ? { 'retry-after': String(res.headers['retry-after']) } : {}),
      },
      body,
    };
  }
  return { success: false, error: 'Too many redirects' };
}

function registerMetaBrainzIpv4Ipc({ ipcMain, userAgent, httpsRequest = https.request }) {
  ipcMain.handle('metabrainz-fetch-ipv4', (event, url, options = {}) =>
    fetchMetaBrainzIpv4(url, options, { userAgent, httpsRequest }));
}

module.exports = { registerMetaBrainzIpv4Ipc, fetchMetaBrainzIpv4, MAX_REDIRECTS };
