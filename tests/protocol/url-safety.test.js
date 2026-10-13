/**
 * URL safety guard — blocks SSRF-class URLs from external protocol links.
 * Used by parachord://import and parachord://play-* commands that fetch
 * user-supplied URLs.
 */

const { isPublicHttpUrl } = require('../helpers/url-safety');

describe('isPublicHttpUrl', () => {
  test.each([
    ['https://api.listenbrainz.org/1/explore/lb-radio?prompt=tag:shoegaze', true],
    ['http://example.com/path', true],
    ['https://example.com:8080/path', true],
  ])('accepts %s', (url, expected) => {
    expect(isPublicHttpUrl(url)).toBe(expected);
  });

  test.each([
    ['ftp://example.com/foo', 'non-http scheme'],
    ['file:///etc/passwd', 'file scheme'],
    ['parachord://play-album', 'custom scheme'],
    ['javascript:alert(1)', 'javascript scheme'],
    ['http://localhost/foo', 'localhost'],
    ['http://localhost./foo', 'localhost trailing dot'],
    ['http://127.0.0.1/foo', '127 loopback'],
    ['http://0.0.0.0/foo', '0.0.0.0'],
    ['http://0.1.2.3/foo', '0.0.0.0/8 range'],
    ['http://[::1]/foo', 'ipv6 loopback'],
    ['http://[::1]:8080/foo', 'ipv6 loopback with port'],
    ['http://10.0.0.5/foo', 'RFC1918 10/8'],
    ['http://172.16.5.1/foo', 'RFC1918 172.16/12'],
    ['http://172.31.255.1/foo', 'RFC1918 172.31/12 boundary'],
    ['http://192.168.1.1/foo', 'RFC1918 192.168/16'],
    ['http://100.64.5.1/foo', 'CGNAT 100.64.0.0/10'],
    ['http://169.254.169.254/foo', 'cloud metadata IP'],
    ['http://[fe80::1]/foo', 'IPv6 link-local fe80::/10'],
    ['http://[fc00::1]/foo', 'IPv6 ULA fc00::/7'],
    ['http://[fd00::1]/foo', 'IPv6 ULA fd00::/7'],
    ['http://[::ffff:127.0.0.1]/foo', 'IPv4-mapped IPv6 loopback'],
    ['http://something.local/foo', '.local mDNS'],
    ['http://router.LOCAL/foo', '.local case-insensitive'],
    ['http://router.local./foo', 'mDNS trailing dot'],
    ['not a url at all', 'unparseable'],
    ['', 'empty'],
    [null, 'null'],
    [undefined, 'undefined'],
  ])('rejects %s (%s)', (url) => {
    expect(isPublicHttpUrl(url)).toBe(false);
  });

  test('accepts 172.15.x.x and 172.32.x.x (boundaries OUTSIDE RFC1918)', () => {
    expect(isPublicHttpUrl('http://172.15.255.255/foo')).toBe(true);
    expect(isPublicHttpUrl('http://172.32.0.1/foo')).toBe(true);
  });

  // The WHATWG URL parser canonicalizes decimal-int and octal-form IPs to
  // dotted-quad before our regex inspects them, so these get caught by the
  // 127.x check. Lock the behavior in.
  test('rejects decimal-integer loopback (URL parser canonicalizes to 127.0.0.1)', () => {
    expect(isPublicHttpUrl('http://2130706433/foo')).toBe(false);
  });

  test('rejects octal-form loopback (URL parser canonicalizes to 127.0.0.1)', () => {
    expect(isPublicHttpUrl('http://0177.0.0.1/foo')).toBe(false);
  });
});

describe('hostedPlaylistFetchProblem (parachord#1011)', () => {
  const { hostedPlaylistFetchProblem, HOSTED_PLAYLIST_MAX_BYTES } = require('../helpers/url-safety');

  test('accepts a public URL with a small body and no redirect', () => {
    expect(hostedPlaylistFetchProblem('https://example.com/p.xspf', 'https://example.com/p.xspf', 1200)).toBeNull();
  });

  test('accepts a redirect that stays public (http -> https, Dropbox dl=1)', () => {
    expect(hostedPlaylistFetchProblem('http://example.com/p.xspf', 'https://cdn.example.com/p.xspf', 1200)).toBeNull();
  });

  test('rejects a private requested URL before any fetch', () => {
    expect(hostedPlaylistFetchProblem('http://192.168.1.10/p.xspf', null, 0)).toMatch(/public http/);
    expect(hostedPlaylistFetchProblem('file:///tmp/p.xspf', null, 0)).toMatch(/public http/);
    expect(hostedPlaylistFetchProblem('spotify:playlist:abc', null, 0)).toMatch(/public http/);
  });

  test('rejects a redirect that lands on a private address', () => {
    expect(hostedPlaylistFetchProblem('https://example.com/p.xspf', 'http://169.254.169.254/latest/meta-data', 10)).toMatch(/redirected/);
    expect(hostedPlaylistFetchProblem('https://example.com/p.xspf', 'http://localhost:9876/import', 10)).toMatch(/redirected/);
  });

  test('rejects a body over the cap and accepts one at the cap', () => {
    expect(hostedPlaylistFetchProblem('https://example.com/p.xspf', null, HOSTED_PLAYLIST_MAX_BYTES + 1)).toMatch(/too large/);
    expect(hostedPlaylistFetchProblem('https://example.com/p.xspf', null, HOSTED_PLAYLIST_MAX_BYTES)).toBeNull();
  });

  test('tests/helpers copy matches app.js byte for byte', () => {
    const fs = require('fs');
    const path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
    // Body = everything between the signature line and the closing brace,
    // with `window.` prefixes dropped so the two copies can be compared.
    const bodyAfter = (src, signature, closer) => {
      const i = src.indexOf(signature);
      expect(i).toBeGreaterThan(-1);
      const open = src.indexOf('\n', i) + 1;
      return src.slice(open, src.indexOf(closer, open)).replace(/window\./g, '');
    };
    expect(bodyAfter(read('app.js'), 'window.hostedPlaylistFetchProblem = (requestedUrl, finalUrl, bodyLength) => {', '\n};'))
      .toBe(bodyAfter(read('tests/helpers/url-safety.js'), 'function hostedPlaylistFetchProblem(requestedUrl, finalUrl, bodyLength) {', '\n}'));
  });
});
