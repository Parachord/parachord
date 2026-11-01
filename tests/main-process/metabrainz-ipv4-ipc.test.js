/**
 * main-process/ipc/metabrainz-ipv4.js: MetaBrainz requests with IPv4 forced,
 * the fallback for when their IPv6 endpoint resets the TLS handshake
 * (2026-11-01). Driven with a fake https.request.
 */

const { EventEmitter } = require('events');
const { fetchMetaBrainzIpv4, registerMetaBrainzIpv4Ipc, MAX_REDIRECTS } = require('../../main-process/ipc/metabrainz-ipv4');

// A fake https.request: `routes` maps a URL to { status, headers, body }.
function fakeHttps(routes) {
  const calls = [];
  const httpsRequest = (url, options, onResponse) => {
    calls.push({ url, options });
    const req = new EventEmitter();
    req.destroy = (err) => { if (err) req.emit('error', err); };
    req.end = () => {
      const route = routes[url];
      if (!route) { setImmediate(() => req.emit('error', new Error('ECONNRESET'))); return; }
      const res = new EventEmitter();
      res.statusCode = route.status;
      res.statusMessage = route.statusText || '';
      res.headers = route.headers || {};
      res.resume = () => {};
      res.destroyed = false;
      res.destroy = () => { res.destroyed = true; route.destroyed = true; };
      setImmediate(() => {
        onResponse(res);
        setImmediate(() => {
          if (res.destroyed) return;
          if (route.body) res.emit('data', Buffer.from(route.body));
          res.emit('end');
        });
      });
    };
    return req;
  };
  return { httpsRequest, calls };
}

const UA = 'Parachord/test ( https://github.com/Parachord/parachord )';

test('asks over IPv4 with the MetaBrainz user agent and returns a JSON body', async () => {
  const url = 'https://musicbrainz.org/ws/2/artist/x?fmt=json';
  const { httpsRequest, calls } = fakeHttps({
    [url]: { status: 200, headers: { 'content-type': 'application/json' }, body: '{"name":"Radiohead"}' },
  });
  const result = await fetchMetaBrainzIpv4(url, {}, { userAgent: UA, httpsRequest });
  expect(calls[0].options.family).toBe(4);
  expect(calls[0].options.headers['User-Agent']).toBe(UA);
  expect(result).toMatchObject({ success: true, status: 200, url, body: '{"name":"Radiohead"}' });
  expect(result.headers['content-type']).toBe('application/json');
});

test('passes a 503 and its Retry-After through for the retry layer', async () => {
  const url = 'https://musicbrainz.org/ws/2/artist?query=x&fmt=json';
  const { httpsRequest } = fakeHttps({
    [url]: { status: 503, headers: { 'content-type': 'application/json', 'retry-after': '3' }, body: '{}' },
  });
  const result = await fetchMetaBrainzIpv4(url, {}, { userAgent: UA, httpsRequest });
  expect(result).toMatchObject({ success: true, status: 503, headers: { 'retry-after': '3' } });
});

test('follows a Cover Art Archive redirect to archive.org and skips the image body', async () => {
  const start = 'https://coverartarchive.org/release-group/rg/front-250';
  const image = 'https://ia800.us.archive.org/x/mbid-1/mbid-1-2_thumb250.jpg';
  const routes = {
    [start]: { status: 307, headers: { location: image } },
    [image]: { status: 200, headers: { 'content-type': 'image/jpeg' }, body: 'JPEGBYTES' },
  };
  const { httpsRequest } = fakeHttps(routes);
  const result = await fetchMetaBrainzIpv4(start, {}, { userAgent: UA, httpsRequest });
  expect(result).toMatchObject({ success: true, status: 200, url: image, body: null });
  expect(routes[image].destroyed).toBe(true);
});

test('refuses anything but GET and HEAD to MetaBrainz hosts', async () => {
  const { httpsRequest, calls } = fakeHttps({});
  expect(await fetchMetaBrainzIpv4('https://example.com/x', {}, { userAgent: UA, httpsRequest }))
    .toMatchObject({ success: false });
  expect(await fetchMetaBrainzIpv4('http://musicbrainz.org/ws/2/x', {}, { userAgent: UA, httpsRequest }))
    .toMatchObject({ success: false });
  expect(await fetchMetaBrainzIpv4('https://musicbrainz.org/ws/2/x', { method: 'POST' }, { userAgent: UA, httpsRequest }))
    .toMatchObject({ success: false });
  expect(await fetchMetaBrainzIpv4('https://archive.org/x', {}, { userAgent: UA, httpsRequest }))
    .toMatchObject({ success: false }); // archive.org is a redirect target only
  expect(calls).toHaveLength(0);
});

test('refuses a redirect off MetaBrainz and archive.org', async () => {
  const start = 'https://coverartarchive.org/release/r/front-250';
  const { httpsRequest } = fakeHttps({ [start]: { status: 302, headers: { location: 'https://evil.example/x' } } });
  const result = await fetchMetaBrainzIpv4(start, {}, { userAgent: UA, httpsRequest });
  expect(result).toMatchObject({ success: false });
  expect(result.error).toMatch(/unexpected host/);
});

test('stops after too many redirects', async () => {
  const routes = {};
  for (let i = 0; i <= MAX_REDIRECTS + 1; i++) {
    routes[`https://coverartarchive.org/r/${i}`] = { status: 302, headers: { location: `https://coverartarchive.org/r/${i + 1}` } };
  }
  const { httpsRequest } = fakeHttps(routes);
  expect(await fetchMetaBrainzIpv4('https://coverartarchive.org/r/0', {}, { userAgent: UA, httpsRequest }))
    .toMatchObject({ success: false, error: 'Too many redirects' });
});

test('a connection error is a failure result, not a throw', async () => {
  const { httpsRequest } = fakeHttps({});
  expect(await fetchMetaBrainzIpv4('https://musicbrainz.org/ws/2/x', {}, { userAgent: UA, httpsRequest }))
    .toMatchObject({ success: false, error: 'ECONNRESET' });
});

test('registers the metabrainz-fetch-ipv4 handler', async () => {
  const handlers = {};
  const url = 'https://musicbrainz.org/ws/2/x';
  const { httpsRequest } = fakeHttps({ [url]: { status: 200, headers: { 'content-type': 'application/json' }, body: '{}' } });
  registerMetaBrainzIpv4Ipc({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, userAgent: UA, httpsRequest });
  expect(await handlers['metabrainz-fetch-ipv4']({}, url)).toMatchObject({ success: true, status: 200 });
});
