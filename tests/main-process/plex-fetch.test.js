/**
 * main-process/ipc/plex-fetch.js — the Plex-scoped HTTP handler.
 *
 * The policy is what makes this safe to expose to renderer plugins: only
 * Plex's own hosts and the user's saved server connections are reachable,
 * TLS verification is relaxed only for the saved LAN servers, and redirects
 * are refused. Driven with a fake transport (no sockets).
 */

const { EventEmitter } = require('events');
const { plexFetchPolicy, savedConnectionHosts, reportedLocalAddresses, isPrivateIPv4, registerPlexFetchIpc } = require('../../main-process/ipc/plex-fetch');

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

// The plain-local-address fallback: when a router drops DNS answers for
// *.plex.direct names that point at private addresses, Plex's apps use the
// server's LAN address instead. plex-fetch allows it only when plex.tv itself
// reported it as a local connection of the account, this session.
const RESOURCES = JSON.stringify([
  { name: 'Mac', provides: 'server', connections: [
    { protocol: 'https', local: true, relay: false, address: '192.168.1.250', port: 32400, uri: 'https://192-168-1-250.abc.plex.direct:32400' },
    { protocol: 'https', local: false, relay: false, address: '203.0.113.7', port: 21656, uri: 'https://203-0-113-7.abc.plex.direct:21656' },
    { protocol: 'https', local: false, relay: true, address: '10.9.9.9', port: 8443, uri: 'https://10-9-9-9.abc.plex.direct:8443' },
  ] },
  { name: 'Phone', provides: 'player', connections: [{ local: true, address: '8.8.8.8', port: 32500 }] },
]);

describe('reported local addresses', () => {
  test('only local, non-relay connections on private IPv4 addresses, with their port', () => {
    expect([...reportedLocalAddresses(RESOURCES)]).toEqual(['192.168.1.250:32400']);
    expect([...reportedLocalAddresses('not json')]).toEqual([]);
    expect([...reportedLocalAddresses('{"a":1}')]).toEqual([]);
  });

  test('isPrivateIPv4 knows the private and loopback ranges and nothing else', () => {
    for (const ip of ['10.0.0.1', '127.0.0.1', '172.16.0.1', '172.31.255.255', '192.168.0.10', '100.64.0.1', '100.127.0.1']) expect([ip, isPrivateIPv4(ip)]).toEqual([ip, true]);
    for (const ip of ['8.8.8.8', '172.32.0.1', '169.254.169.254', '100.128.0.1', '192.169.0.1', '256.1.1.1', 'plex.tv', '::1']) expect([ip, isPrivateIPv4(ip)]).toEqual([ip, false]);
  });

  test('the policy allows a reported address over http, at that port only', () => {
    const reported = new Set(['192.168.1.250:32400']);
    expect(plexFetchPolicy('http://192.168.1.250:32400/identity', null, reported)).toEqual({ allowed: true, rejectUnauthorized: true });
    expect(plexFetchPolicy('http://192.168.1.250:8080/identity', null, reported).allowed).toBe(false);
    expect(plexFetchPolicy('https://192.168.1.250:32400/identity', null, reported).allowed).toBe(false);
    expect(plexFetchPolicy('http://192.168.1.251:32400/identity', null, reported).allowed).toBe(false);
    expect(plexFetchPolicy('http://192.168.1.250:32400/identity', null, undefined).allowed).toBe(false);
  });

  test('the handler learns local addresses from the account\'s resources answer, and from nothing else', async () => {
    const handlers = new Map();
    let body = RESOURCES;
    const { transports, requests } = makeTransport({ status: 200, get chunks() { return [body]; } });
    registerPlexFetchIpc({ ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, store: { get: () => ({}) }, transports });
    const fetch = handlers.get('plex-fetch');
    // Before plex.tv has reported it, the LAN address is refused.
    expect((await fetch(null, 'http://192.168.1.250:32400/identity')).ok).toBe(false);
    // Some other plex.tv answer that happens to contain connections teaches nothing.
    await fetch(null, 'https://plex.tv/api/v2/user');
    expect((await fetch(null, 'http://192.168.1.250:32400/identity')).ok).toBe(false);
    // The resources answer does.
    await fetch(null, 'https://plex.tv/api/v2/resources?includeHttps=1&includeRelay=1');
    expect((await fetch(null, 'http://192.168.1.250:32400/identity')).ok).toBe(true);
    // Its remote and relay addresses never become reachable this way.
    expect((await fetch(null, 'http://203.0.113.7:21656/identity')).ok).toBe(false);
    expect((await fetch(null, 'http://10.9.9.9:8443/identity')).ok).toBe(false);
    expect(requests.filter((r) => r.url.startsWith('http://')).map((r) => r.url)).toEqual(['http://192.168.1.250:32400/identity']);
  });
});
