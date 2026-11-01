/**
 * src/renderer/lib/metabrainz-ipv4.js: a MetaBrainz request that fails at the
 * network level is retried over IPv4 through the main process, and later
 * requests go there directly for a while. Plus source markers for the wiring
 * in src/renderer/app.js and the artist page's cover loader.
 */

const fs = require('fs');
const path = require('path');
const { createIpv4Fallback, PREFER_IPV4_MS } = require('../../src/renderer/lib/metabrainz-ipv4');

const networkError = () => new TypeError('Failed to fetch');
const ok = (overrides = {}) => ({
  success: true, status: 200, statusText: 'OK', url: 'https://musicbrainz.org/ws/2/x',
  headers: { 'content-type': 'application/json' }, body: '{"ok":true}', ...overrides,
});

function setup({ direct, ipv4 }) {
  let clock = 1000;
  const fetchDirect = jest.fn(direct);
  const fetchIpv4 = jest.fn(ipv4);
  const fb = createIpv4Fallback({ fetchDirect, fetchIpv4, now: () => clock });
  return { fb, fetchDirect, fetchIpv4, advance: (ms) => { clock += ms; } };
}

test('a working default route never touches IPv4', async () => {
  const { fb, fetchIpv4 } = setup({ direct: async () => new Response('{}'), ipv4: async () => ok() });
  await fb.fetch('https://musicbrainz.org/ws/2/x', {});
  expect(fetchIpv4).not.toHaveBeenCalled();
});

test('a network failure is retried over IPv4 and returns a real Response', async () => {
  const { fb, fetchIpv4 } = setup({ direct: async () => { throw networkError(); }, ipv4: async () => ok() });
  const res = await fb.fetch('https://musicbrainz.org/ws/2/x', { method: 'GET', headers: { X: 'y' } });
  expect(fetchIpv4).toHaveBeenCalledWith('https://musicbrainz.org/ws/2/x', { method: 'GET' });
  expect(res.ok).toBe(true);
  expect(await res.json()).toEqual({ ok: true });
  expect(res.url).toBe('https://musicbrainz.org/ws/2/x');
});

test('the Response carries the final URL after a redirect and the retry-after header', async () => {
  const image = 'https://ia800.us.archive.org/x/thumb250.jpg';
  const { fb } = setup({
    direct: async () => { throw networkError(); },
    ipv4: async () => ok({ url: image, headers: { 'content-type': 'image/jpeg', 'retry-after': '2' }, body: null }),
  });
  const res = await fb.fetch('https://coverartarchive.org/release-group/rg/front-250', {});
  expect(res.url).toBe(image);
  expect(res.headers.get('retry-after')).toBe('2');
});

test('after a fallback, requests go straight to IPv4 until the preference expires', async () => {
  const { fb, fetchDirect, fetchIpv4, advance } = setup({
    direct: async () => { throw networkError(); }, ipv4: async () => ok(),
  });
  await fb.fetch('https://musicbrainz.org/ws/2/a', {});
  expect(fb.isPreferringIpv4()).toBe(true);
  await fb.fetch('https://musicbrainz.org/ws/2/b', {});
  expect(fetchDirect).toHaveBeenCalledTimes(1);
  expect(fetchIpv4).toHaveBeenCalledTimes(2);
  advance(PREFER_IPV4_MS);
  await fb.fetch('https://musicbrainz.org/ws/2/c', {});
  expect(fetchDirect).toHaveBeenCalledTimes(2); // the default route gets another try
});

test('when IPv4 fails too, the original network error reaches the retry layer', async () => {
  const original = networkError();
  const { fb } = setup({ direct: async () => { throw original; }, ipv4: async () => ({ success: false, error: 'ECONNRESET' }) });
  await expect(fb.fetch('https://musicbrainz.org/ws/2/x', {})).rejects.toBe(original);
  expect(fb.isPreferringIpv4()).toBe(false);
});

test('an HTTP error or an abort is not a reason to try IPv4', async () => {
  const abort = new DOMException('Aborted', 'AbortError');
  const { fb, fetchIpv4 } = setup({ direct: async () => { throw abort; }, ipv4: async () => ok() });
  await expect(fb.fetch('https://musicbrainz.org/ws/2/x', {})).rejects.toBe(abort);
  expect(fetchIpv4).not.toHaveBeenCalled();
});

test('an abort during the IPv4 request rejects the caller at once', async () => {
  const controller = new AbortController();
  let release;
  const { fb } = setup({
    direct: async () => { throw networkError(); },
    ipv4: () => new Promise((r) => { release = r; }),
  });
  const pending = fb.fetch('https://musicbrainz.org/ws/2/x', { signal: controller.signal });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  release(ok());
});

test('a 204 answer has no body', async () => {
  const { fb } = setup({ direct: async () => { throw networkError(); }, ipv4: async () => ok({ status: 204, body: '' }) });
  const res = await fb.fetch('https://musicbrainz.org/ws/2/x', {});
  expect(res.status).toBe(204);
});

describe('wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const preload = fs.readFileSync(path.join(__dirname, '../../preload.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '../../main.js'), 'utf8');

  test('MusicBrainz requests use the fallback inside the limiter; the Cover Art Archive outside it', () => {
    expect(app).toMatch(/mbFetchWithRetries\(\(attemptInit\) => metabrainz\.fetch\(input, attemptInit\), fetchInit/);
    expect(app).toMatch(/if \(isCoverArtArchive\(input\)\) return metabrainz\.fetch\(input, init \|\| \{\}\);/);
    expect(preload).toMatch(/metabrainzFetchIpv4: \(url, options\) => ipcRenderer\.invoke\('metabrainz-fetch-ipv4', url, options\)/);
    expect(main).toMatch(/registerMetaBrainzIpv4Ipc\(\{ ipcMain, userAgent: METABRAINZ_UA \}\);/);
  });

  test('the artist page cover loader goes through getAlbumArt in the background lane', () => {
    const s = app.indexOf('const fetchSingleAlbumArt = async (release) => {');
    const body = app.slice(s, app.indexOf('\n  };', s));
    expect(body).toMatch(/return getAlbumArt\(artistName, release\.title, \{\s*\.\.\.\(isMusicBrainzId\(release\.id\) \? \{ releaseGroupId: release\.id \} : \{\}\),\s*background: true\s*\}\);/);
    expect(body).not.toMatch(/fetch\(/);
  });
});
