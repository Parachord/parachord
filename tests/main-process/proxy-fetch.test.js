/**
 * main-process/ipc/proxy-fetch.js: the CORS-bypass fetch the scrobblers and a
 * few app lookups use (GHSA-6qxm-h86h-9m79, the proxy-fetch item).
 *
 * It checked only the first URL and let Node's fetch follow redirects, so a
 * public URL could redirect to the local network; and it read whole bodies.
 * Now every redirect hop gets the SAME check the first URL always had (the
 * accepted addresses don't change: a Tailscale 100.x host still works), POST
 * follows browser redirect rules, credentials don't cross origins, and the
 * body has a generous cap.
 */
const { registerProxyFetchIpc, proxyFetchHostProblem, PROXY_FETCH_MAX_BYTES } = require('../../main-process/ipc/proxy-fetch');

function setup(routes, deps = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers || {}, redirect: init.redirect });
    const make = routes[url];
    if (!make) throw new Error(`unexpected request to ${url}`);
    return make();
  };
  const handlers = new Map();
  registerProxyFetchIpc({
    ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
    fetchImpl,
    isMetaBrainzHost: (u) => u.includes('musicbrainz.org'),
    metabrainzUserAgent: 'Parachord/test',
    log: () => {},
    ...deps,
  });
  return { call: (url, options) => handlers.get('proxy-fetch')(null, url, options), calls };
}
const redirect = (to, status = 302) => () => new Response(null, { status, headers: { location: to } });
const ok = (text, headers = {}) => () => new Response(text, { status: 200, headers });

describe('proxyFetchHostProblem: the addresses proxy-fetch accepts are unchanged', () => {
  test.each([
    'http://localhost:4533/rest', 'http://127.0.0.1/', 'http://0.0.0.0/', 'http://[::1]/',
    'http://10.0.0.2/', 'http://192.168.1.5:4533/', 'http://172.16.0.1/', 'http://172.31.255.255/',
    'http://169.254.169.254/latest', 'http://nas.local/', 'http://svc.internal/', 'ftp://example.com/',
  ])('refuses %s, as before', (url) => {
    expect(proxyFetchHostProblem(url)).toBeTruthy();
  });

  test.each([
    'https://api.listenbrainz.org/1/submit-listens',
    'https://api.deezer.com/search?q=x',
    'http://100.101.102.103:4533/rest/ping', // Tailscale (CGNAT): allowed before, still allowed
    'https://172.15.0.1/', 'https://172.32.0.1/', // outside RFC1918
  ])('accepts %s, as before', (url) => {
    expect(proxyFetchHostProblem(url)).toBeNull();
  });
});

describe('proxy-fetch follows redirects by hand', () => {
  test('a plain GET returns the same shape as before', async () => {
    const { call, calls } = setup({ 'https://api.deezer.com/a': ok('{"x":1}', { 'content-type': 'application/json' }) });
    await expect(call('https://api.deezer.com/a', { headers: { Accept: 'application/json' } }))
      .resolves.toEqual({ success: true, status: 200, text: '{"x":1}', finalUrl: 'https://api.deezer.com/a' });
    expect(calls[0].redirect).toBe('manual');
    expect(calls[0].headers.Accept).toBe('application/json');
  });

  test('a redirect to another public host is followed and reported as finalUrl', async () => {
    const { call } = setup({
      'https://on.soundcloud.com/abc': redirect('https://soundcloud.com/a/sets/b'),
      'https://soundcloud.com/a/sets/b': ok(''),
    });
    expect((await call('https://on.soundcloud.com/abc', { method: 'HEAD' })).finalUrl).toBe('https://soundcloud.com/a/sets/b');
  });

  test.each(['http://192.168.1.1/', 'http://127.0.0.1:8888/', 'http://169.254.169.254/', 'http://router.local/'])(
    'a redirect to %s is refused and never requested', async (target) => {
      const { call, calls } = setup({ 'https://evil.example/x': redirect(target) });
      const out = await call('https://evil.example/x');
      expect(out.success).toBe(false);
      expect(out.error).toMatch(/private\/internal/);
      expect(calls.map((c) => c.url)).toEqual(['https://evil.example/x']);
    });

  test('a redirect to a Tailscale address is followed, as a direct request to it is allowed', async () => {
    const { call } = setup({
      'https://example.com/go': redirect('http://100.64.1.2:4533/rest/ping'),
      'http://100.64.1.2:4533/rest/ping': ok('pong'),
    });
    expect((await call('https://example.com/go')).text).toBe('pong');
  });

  test('a 303, or a 301/302 after a POST, becomes a GET without the body; a 307/308 keeps both', async () => {
    const { call, calls } = setup({
      'https://a.example/p': redirect('https://a.example/q', 303),
      'https://a.example/q': ok('done'),
      'https://b.example/p': redirect('https://b.example/q', 307),
      'https://b.example/q': ok('kept'),
    });
    await call('https://a.example/p', { method: 'POST', body: '{"a":1}' });
    await call('https://b.example/p', { method: 'POST', body: '{"b":1}' });
    expect(calls.map((c) => [c.url, c.method, c.body])).toEqual([
      ['https://a.example/p', 'POST', '{"a":1}'],
      ['https://a.example/q', 'GET', undefined],
      ['https://b.example/p', 'POST', '{"b":1}'],
      ['https://b.example/q', 'POST', '{"b":1}'],
    ]);
  });

  test('credentials do not follow a redirect to another origin', async () => {
    const { call, calls } = setup({
      'https://api.listenbrainz.org/1/x': redirect('https://other.example/y'),
      'https://other.example/y': ok('{}'),
    });
    await call('https://api.listenbrainz.org/1/x', { headers: { Authorization: 'Token t' } });
    expect(calls[0].headers.Authorization).toBe('Token t');
    expect(calls[1].headers.Authorization).toBeUndefined();
  });

  test('too many redirects stop', async () => {
    const routes = {};
    for (let i = 0; i < 20; i++) routes[`https://e.example/${i}`] = redirect(`https://e.example/${i + 1}`);
    const { call } = setup(routes);
    expect((await call('https://e.example/0')).error).toMatch(/Too many redirects/);
  });
});

describe('proxy-fetch responses', () => {
  test('a non-2xx answer returns its status, text and finalUrl, as before', async () => {
    const { call } = setup({ 'https://api.listenbrainz.org/x': () => new Response('nope', { status: 404 }) });
    await expect(call('https://api.listenbrainz.org/x')).resolves.toEqual({
      success: false, status: 404, error: 'HTTP 404', text: 'nope', finalUrl: 'https://api.listenbrainz.org/x',
    });
  });

  test('responseType arraybuffer comes back as base64 data, as before', async () => {
    const { call } = setup({ 'https://cdn.example/a.bin': () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }) });
    await expect(call('https://cdn.example/a.bin', { responseType: 'arraybuffer' })).resolves.toEqual({
      success: true, status: 200, data: Buffer.from([1, 2, 3]).toString('base64'), finalUrl: 'https://cdn.example/a.bin',
    });
  });

  test('a body over the cap is refused without being read whole', async () => {
    let sent = 0;
    const chunk = new Uint8Array(1024 * 1024);
    const stream = new ReadableStream({ pull(c) { sent += chunk.length; c.enqueue(chunk); } });
    const { call } = setup({ 'https://big.example/x': () => new Response(stream, { status: 200 }) });
    const out = await call('https://big.example/x');
    expect(out.success).toBe(false);
    expect(out.error).toMatch(/too large/);
    expect(sent).toBeLessThan(PROXY_FETCH_MAX_BYTES + 4 * chunk.length);
  });

  test('MetaBrainz hosts get the contactable User-Agent, others the browser one', async () => {
    const { call, calls } = setup({ 'https://musicbrainz.org/ws/2/x': ok('{}'), 'https://api.deezer.com/y': ok('{}') });
    await call('https://musicbrainz.org/ws/2/x', { headers: { 'User-Agent': 'whatever' } });
    await call('https://api.deezer.com/y');
    expect(calls[0].headers['User-Agent']).toBe('Parachord/test');
    expect(calls[1].headers['User-Agent']).toMatch(/^Mozilla\/5\.0/);
  });

  test('a refused first URL never reaches fetch', async () => {
    const { call, calls } = setup({});
    expect((await call('http://192.168.1.10:4533/rest')).success).toBe(false);
    expect(calls).toEqual([]);
  });
});

test('main.js registers the module instead of an inline handler', () => {
  const main = require('fs').readFileSync(require('path').join(__dirname, '../../main.js'), 'utf8');
  expect(main).toContain('registerProxyFetchIpc(');
  expect(main).not.toContain("ipcMain.handle('proxy-fetch'");
});
