/**
 * main-process/ipc/plex-fetch.js — the Plex-scoped HTTP handler.
 *
 * The policy is what makes this safe to expose to renderer plugins: only
 * Plex's own hosts and the user's saved server connections are reachable,
 * TLS verification is relaxed only for the saved LAN servers, and redirects
 * are refused. Driven with a fake transport (no sockets).
 */

const { EventEmitter } = require('events');
const { plexFetchPolicy, savedConnectionHosts, registerPlexFetchIpc } = require('../../main-process/ipc/plex-fetch');

const SAVED = {
  libraries: [
    { serverId: 'srv1', connections: ['http://192.168.1.5:32400', 'https://192-168-1-5.abc123.plex.direct:32400'] },
    { serverId: 'srv2', connections: ['https://music.example.org:32400/', 'not a url'] },
  ],
};

describe('plexFetchPolicy', () => {
  test('plex.tv and its subdomains are allowed with TLS verification on', () => {
    expect(plexFetchPolicy('https://plex.tv/api/v2/pins', SAVED)).toEqual({ allowed: true, rejectUnauthorized: true });
    expect(plexFetchPolicy('https://app.plex.tv/auth', null)).toEqual({ allowed: true, rejectUnauthorized: true });
  });

  test('*.plex.direct is allowed with TLS verification on, even before anything is saved', () => {
    expect(plexFetchPolicy('https://192-168-1-5.abc123.plex.direct:32400/identity', undefined)).toEqual({ allowed: true, rejectUnauthorized: true });
  });

  test('a saved LAN connection host is allowed with TLS verification relaxed', () => {
    expect(plexFetchPolicy('http://192.168.1.5:32400/library/sections', SAVED)).toEqual({ allowed: true, rejectUnauthorized: false });
    expect(plexFetchPolicy('https://music.example.org:32400/identity', SAVED)).toEqual({ allowed: true, rejectUnauthorized: false });
  });

  test('anything else is refused: metadata IP, loopback, an unsaved LAN host, a lookalike host', () => {
    for (const url of [
      'http://169.254.169.254/latest/meta-data/',
      'http://127.0.0.1:32400/',
      'http://192.168.1.99:32400/',
      'https://plex.tv.evil.example/',
      'https://notplex.direct/',
      'https://example.com/',
    ]) {
      const policy = plexFetchPolicy(url, SAVED);
      expect(policy.allowed).toBe(false);
      expect(policy.error).toMatch(/not a Plex host/);
    }
  });

  test('non-http schemes and garbage are refused', () => {
    expect(plexFetchPolicy('file:///etc/passwd', SAVED).allowed).toBe(false);
    expect(plexFetchPolicy('ftp://plex.tv/', SAVED).allowed).toBe(false);
    expect(plexFetchPolicy('nope', SAVED).allowed).toBe(false);
  });

  test('savedConnectionHosts lowercases, ignores junk, and tolerates a missing config', () => {
    expect([...savedConnectionHosts(SAVED)].sort()).toEqual(['192-168-1-5.abc123.plex.direct', '192.168.1.5', 'music.example.org']);
    expect(savedConnectionHosts(null).size).toBe(0);
    expect(savedConnectionHosts({ libraries: 'nope' }).size).toBe(0);
  });
});

// A transport fake: records the request and plays back a scripted response.
function makeTransport(script) {
  const requests = [];
  const make = (protocol) => ({
    request(urlObj, reqOptions, onResponse) {
      const req = new EventEmitter();
      req.destroyed = false;
      req.destroy = () => { req.destroyed = true; };
      req.setTimeout = () => {};
      req.write = () => {};
      req.end = () => {
        requests.push({ protocol, url: urlObj.toString(), options: reqOptions });
        const res = new EventEmitter();
        res.statusCode = script.status;
        res.setEncoding = () => {};
        res.resume = () => {};
        onResponse(res);
        if (script.status < 300 || script.status >= 400) {
          for (const chunk of script.chunks || []) res.emit('data', chunk);
          res.emit('end');
        }
      };
      return req;
    },
  });
  return { transports: { 'http:': make('http:'), 'https:': make('https:') }, requests };
}

function makeHarness(script, plexConfig = SAVED) {
  const handlers = new Map();
  const { transports, requests } = makeTransport(script);
  registerPlexFetchIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    store: { get: (k) => (k === 'meta_service_configs' ? { plex: plexConfig } : undefined) },
    transports,
  });
  return { fetch: handlers.get('plex-fetch'), requests };
}

describe('plex-fetch handler', () => {
  test('a refused host never reaches the transport', async () => {
    const { fetch, requests } = makeHarness({ status: 200, chunks: ['{}'] });
    const result = await fetch(null, 'http://169.254.169.254/latest/meta-data/');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not a Plex host/);
    expect(requests).toEqual([]);
  });

  test('a saved LAN host is fetched with rejectUnauthorized false; plex.tv with true', async () => {
    const { fetch, requests } = makeHarness({ status: 200, chunks: ['{"ok":1}'] });
    await expect(fetch(null, 'http://192.168.1.5:32400/identity', { headers: { Accept: 'application/json' } }))
      .resolves.toEqual({ ok: true, status: 200, text: '{"ok":1}' });
    await fetch(null, 'https://plex.tv/api/v2/user');
    expect(requests.map((r) => r.options.rejectUnauthorized)).toEqual([false, true]);
    expect(requests[0].options.headers).toEqual({ Accept: 'application/json' });
  });

  test('a redirect is an error, not followed', async () => {
    const { fetch } = makeHarness({ status: 302 });
    const result = await fetch(null, 'https://plex.tv/api/v2/pins/1');
    expect(result).toEqual({ ok: false, status: 302, error: 'Redirects are not followed for Plex requests' });
  });

  test('a non-2xx is reported with its status', async () => {
    const { fetch } = makeHarness({ status: 401, chunks: ['denied'] });
    await expect(fetch(null, 'https://plex.tv/api/v2/user')).resolves.toEqual({ ok: false, status: 401, text: 'denied' });
  });

  test('an oversized body is cut off', async () => {
    const big = 'x'.repeat(6 * 1024 * 1024);
    const { fetch } = makeHarness({ status: 200, chunks: [big, big] });
    const result = await fetch(null, 'https://plex.tv/big');
    expect(result).toEqual({ ok: false, status: 0, error: 'Response exceeded 10MB limit' });
  });

  test('with nothing saved, only Plex hosts are reachable', async () => {
    const { fetch, requests } = makeHarness({ status: 200, chunks: ['{}'] }, null);
    expect((await fetch(null, 'http://192.168.1.5:32400/identity')).ok).toBe(false);
    expect((await fetch(null, 'https://192-168-1-5.abc123.plex.direct:32400/identity')).ok).toBe(true);
    expect(requests.length).toBe(1);
  });
});
