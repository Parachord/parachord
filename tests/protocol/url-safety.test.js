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
    ['http://127.0.0.1/foo', '127 loopback'],
    ['http://0.0.0.0/foo', '0.0.0.0'],
    ['http://[::1]/foo', 'ipv6 loopback'],
    ['http://10.0.0.5/foo', 'RFC1918 10/8'],
    ['http://172.16.5.1/foo', 'RFC1918 172.16/12'],
    ['http://172.31.255.1/foo', 'RFC1918 172.31/12 boundary'],
    ['http://192.168.1.1/foo', 'RFC1918 192.168/16'],
    ['http://something.local/foo', '.local mDNS'],
    ['http://router.LOCAL/foo', '.local case-insensitive'],
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
});
