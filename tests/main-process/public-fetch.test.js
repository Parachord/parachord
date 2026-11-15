/**
 * main-process/public-fetch.js: fetching a URL a user or a link supplied
 * (a hosted playlist, a parachord://play tracklist, a SoundCloud short link).
 *
 * The old renderer fetch followed redirects and read the whole body before it
 * checked anything, so a public URL that redirected to the local network sent
 * a request there, and an endless body was read into memory. Here every hop is
 * checked BEFORE it is requested, and the body is read only up to the cap.
 */
const { fetchPublic, PROFILES } = require('../../main-process/public-fetch');

// A fake fetch over a map of url -> Response factory, recording every request.
function fakeFetch(routes) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, method: (init && init.method) || 'GET', redirect: init && init.redirect });
    const make = routes[url];
    if (!make) throw new Error(`unexpected request to ${url}`);
    return make();
  };
  return { impl, calls };
}
const redirect = (to, status = 302) => () => new Response(null, { status, headers: { location: to } });
const body = (text, headers = {}) => () => new Response(text, { status: 200, headers: { 'content-type': 'application/xspf+xml', ...headers } });

describe('fetchPublic: redirects are followed by hand, each hop checked first', () => {
  test('a public URL with no redirect returns its text, content type and final URL', async () => {
    const { impl, calls } = fakeFetch({ 'https://example.com/a.xspf': body('<playlist/>') });
    const out = await fetchPublic('https://example.com/a.xspf', { ...PROFILES['hosted-playlist'], fetchImpl: impl });
    expect(out).toMatchObject({ ok: true, status: 200, text: '<playlist/>', contentType: 'application/xspf+xml', finalUrl: 'https://example.com/a.xspf' });
    expect(calls[0].redirect).toBe('manual');
  });

  test('a redirect that stays public is followed (Dropbox dl=1, http to https)', async () => {
    const { impl } = fakeFetch({
      'http://www.dropbox.com/s/x/a.xspf?dl=1': redirect('https://dl.dropboxusercontent.com/s/x/a.xspf'),
      'https://dl.dropboxusercontent.com/s/x/a.xspf': body('<playlist/>'),
    });
    const out = await fetchPublic('http://www.dropbox.com/s/x/a.xspf?dl=1', { ...PROFILES['hosted-playlist'], fetchImpl: impl });
    expect(out.finalUrl).toBe('https://dl.dropboxusercontent.com/s/x/a.xspf');
    expect(out.text).toBe('<playlist/>');
  });

  test('a relative Location resolves against the current URL', async () => {
    const { impl } = fakeFetch({
      'https://example.com/a': redirect('/b.xspf', 301),
      'https://example.com/b.xspf': body('<playlist/>'),
    });
    expect((await fetchPublic('https://example.com/a', { ...PROFILES['hosted-playlist'], fetchImpl: impl })).finalUrl).toBe('https://example.com/b.xspf');
  });

  test.each([
    'http://127.0.0.1/admin',
    'http://192.168.1.1/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::1]/',
    'http://router.local/',
  ])('a redirect to a private address (%s) is refused and never requested', async (target) => {
    const { impl, calls } = fakeFetch({ 'https://evil.example/x': redirect(target) });
    await expect(fetchPublic('https://evil.example/x', { ...PROFILES['hosted-playlist'], fetchImpl: impl })).rejects.toThrow(/redirected to a private address/);
    expect(calls.map((c) => c.url)).toEqual(['https://evil.example/x']);
  });

  test('a private URL is refused before any request', async () => {
    const { impl, calls } = fakeFetch({});
    await expect(fetchPublic('http://10.0.0.5/a.xspf', { ...PROFILES['hosted-playlist'], fetchImpl: impl })).rejects.toThrow(/public http\(s\) address/);
    expect(calls).toEqual([]);
  });

  test('too many redirects stop', async () => {
    const routes = {};
    for (let i = 0; i < 10; i++) routes[`https://example.com/${i}`] = redirect(`https://example.com/${i + 1}`);
    const { impl, calls } = fakeFetch(routes);
    await expect(fetchPublic('https://example.com/0', { ...PROFILES['hosted-playlist'], fetchImpl: impl })).rejects.toThrow(/Too many redirects/);
    expect(calls.length).toBe(PROFILES['hosted-playlist'].maxRedirects + 1);
  });

  test('a profile with no redirects refuses one (the protocol tracklist, as redirect: "error" did)', async () => {
    const { impl, calls } = fakeFetch({ 'https://example.com/t.json': redirect('https://example.com/u.json') });
    await expect(fetchPublic('https://example.com/t.json', { ...PROFILES['protocol-tracklist'], fetchImpl: impl })).rejects.toThrow(/redirect/i);
    expect(calls.length).toBe(1);
  });

  test('a non-2xx answer comes back as not ok with its status, not thrown', async () => {
    const { impl } = fakeFetch({ 'https://example.com/a': () => new Response('nope', { status: 404 }) });
    expect(await fetchPublic('https://example.com/a', { ...PROFILES['hosted-playlist'], fetchImpl: impl })).toMatchObject({ ok: false, status: 404 });
  });
});

describe('fetchPublic: the body is read only up to the cap', () => {
  test('a Content-Length over the cap is refused without reading the body', async () => {
    let pulled = 0;
    const stream = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(10)); } });
    const { impl } = fakeFetch({ 'https://example.com/big': () => new Response(stream, { status: 200, headers: { 'content-length': String(10 * 1024 * 1024) } }) });
    await expect(fetchPublic('https://example.com/big', { ...PROFILES['hosted-playlist'], fetchImpl: impl })).rejects.toThrow(/too large/);
    expect(pulled).toBeLessThanOrEqual(1);
  });

  test('an endless body with no Content-Length is cut off at the cap, not read whole', async () => {
    let sent = 0;
    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream({ pull(c) { sent += chunk.length; c.enqueue(chunk); } });
    const { impl } = fakeFetch({ 'https://example.com/endless': () => new Response(stream, { status: 200 }) });
    const cap = PROFILES['protocol-tracklist'].maxBytes;
    await expect(fetchPublic('https://example.com/endless', { ...PROFILES['protocol-tracklist'], fetchImpl: impl })).rejects.toThrow(/too large/);
    expect(sent).toBeLessThan(cap + 4 * chunk.length);
  });

  test('a body exactly at the cap is accepted', async () => {
    const cap = PROFILES['protocol-tracklist'].maxBytes;
    const { impl } = fakeFetch({ 'https://example.com/ok': body('x'.repeat(cap)) });
    expect((await fetchPublic('https://example.com/ok', { ...PROFILES['protocol-tracklist'], fetchImpl: impl })).text.length).toBe(cap);
  });
});

describe('request headers', () => {
  test('are sent, and Authorization is dropped when a redirect changes origin', async () => {
    const seen = [];
    const impl = async (url, init) => {
      seen.push({ url, auth: init.headers && init.headers.Authorization });
      if (url === 'https://a.example/x') return new Response(null, { status: 302, headers: { location: 'https://a.example/y' } });
      if (url === 'https://a.example/y') return new Response(null, { status: 302, headers: { location: 'https://b.example/z' } });
      return new Response('<playlist/>', { status: 200 });
    };
    await fetchPublic('https://a.example/x', { ...PROFILES['hosted-playlist'], headers: { Authorization: 'Token t', Accept: 'x' }, fetchImpl: impl });
    expect(seen).toEqual([
      { url: 'https://a.example/x', auth: 'Token t' },
      { url: 'https://a.example/y', auth: 'Token t' },
      { url: 'https://b.example/z', auth: undefined },
    ]);
  });
});

describe('the SoundCloud short-link profile', () => {
  test('follows on.soundcloud.com to the canonical URL with HEAD requests', async () => {
    const { impl, calls } = fakeFetch({
      'https://on.soundcloud.com/abc': redirect('https://soundcloud.com/artist/sets/name?si=1'),
      'https://soundcloud.com/artist/sets/name?si=1': () => new Response(null, { status: 200 }),
    });
    const out = await fetchPublic('https://on.soundcloud.com/abc', { ...PROFILES['soundcloud-short'], fetchImpl: impl });
    expect(out.finalUrl).toBe('https://soundcloud.com/artist/sets/name?si=1');
    expect(calls.every((c) => c.method === 'HEAD')).toBe(true);
  });

  test('a hop off SoundCloud is refused before it is requested', async () => {
    const { impl, calls } = fakeFetch({ 'https://on.soundcloud.com/abc': redirect('https://example.com/elsewhere') });
    await expect(fetchPublic('https://on.soundcloud.com/abc', { ...PROFILES['soundcloud-short'], fetchImpl: impl })).rejects.toThrow();
    expect(calls.length).toBe(1);
  });
});

describe('the public-fetch IPC', () => {
  const { registerPublicFetchIpc } = require('../../main-process/ipc/public-fetch');
  const setup = (routes) => {
    const handlers = new Map();
    const { impl, calls } = fakeFetch(routes);
    registerPublicFetchIpc({ ipcMain: { handle: (c, fn) => handlers.set(c, fn) }, fetchImpl: impl });
    return { call: (...args) => handlers.get('public-fetch')(null, ...args), calls };
  };

  test('takes a profile by name and returns the result', async () => {
    const { call } = setup({ 'https://example.com/a.xspf': body('<playlist/>') });
    await expect(call('https://example.com/a.xspf', 'hosted-playlist')).resolves.toMatchObject({ success: true, ok: true, text: '<playlist/>' });
  });

  test('an unknown profile is refused without a request (the renderer cannot pick its own limits)', async () => {
    const { call, calls } = setup({});
    await expect(call('https://example.com/a', { maxBytes: 1e12 })).resolves.toEqual({ success: false, error: 'Unknown fetch profile' });
    expect(calls).toEqual([]);
  });

  test('passes only plain string headers through', async () => {
    const seen = [];
    const handlers = new Map();
    registerPublicFetchIpc({
      ipcMain: { handle: (c, fn) => handlers.set(c, fn) },
      fetchImpl: async (url, init) => { seen.push(init.headers); return new Response('[]', { status: 200 }); },
    });
    await handlers.get('public-fetch')(null, 'https://api.listenbrainz.org/x', 'protocol-tracklist', { headers: { Authorization: 'Token t', bad: { x: 1 } } });
    expect(seen[0].Authorization).toBe('Token t');
    expect(seen[0].bad).toBeUndefined();
  });

  test('a refused hop comes back as an error message, not a throw', async () => {
    const { call } = setup({ 'https://evil.example/x': redirect('http://127.0.0.1/') });
    await expect(call('https://evil.example/x', 'hosted-playlist')).resolves.toEqual({ success: false, error: 'Playlist URL redirected to a private address' });
  });
});

describe('the renderer uses it, not its own fetch', () => {
  const fs = require('fs');
  const path = require('path');
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');
  const bodyOf = (marker, end) => {
    const i = app.indexOf(marker);
    expect(i).toBeGreaterThan(-1);
    return app.slice(i, app.indexOf(end, i));
  };

  test('preload exposes it and main registers it', () => {
    expect(preload).toContain("publicFetch: (url, profile, options) => ipcRenderer.invoke('public-fetch', url, profile, options)");
    expect(main).toContain('registerPublicFetchIpc(');
  });

  test('the hosted playlist fetch goes through the hosted-playlist profile', () => {
    const body = bodyOf('const fetchHostedPlaylistText = async (url) => {', '\n  };');
    expect(body).toContain("window.electron.publicFetch(url, 'hosted-playlist')");
    expect(body).not.toMatch(/await fetch\(/);
  });

  test('the parachord://play url= fetch goes through the protocol-tracklist profile', () => {
    const body = bodyOf('const resolveProtocolPlayInput = async', '// 4. Inline base64 JSON.');
    expect(body).toContain("window.electron.publicFetch(params.url, 'protocol-tracklist', {");
    expect(body).not.toMatch(/await fetch\(params\.url/);
  });

  test('the SoundCloud short link resolves through the soundcloud-short profile', () => {
    const body = bodyOf("if (classified.kind === 'soundcloud-short') {", 'url = canonical;');
    expect(body).toContain("window.electron.publicFetch(rawUrl, 'soundcloud-short')");
    expect(body).not.toContain('proxyFetch(rawUrl');
  });
});
