/**
 * #1410: a hosted (or file, or linked) XSPF's playlist-level <image> becomes
 * the playlist's coverArt, but only when it's a public http(s) URL, never a
 * track's <image>; and every exported playlist writes its coverArt back out.
 */
const fs = require('fs');
const path = require('path');
const { isPublicHttpUrl } = require('../../protocol-url');
const { playlistImageUrl, playlistImageXml, withPlaylistImage } = require('../../src/renderer/lib/xspf-image');

const el = (localName, textContent) => ({ localName, textContent });

describe('playlistImageUrl: the playlist\'s own <image>', () => {
  test('a public https image under <playlist> is the cover', () => {
    const kids = [el('title', 'Mix'), el('image', ' https://example.com/cover.jpg '), el('trackList', '')];
    expect(playlistImageUrl(kids, isPublicHttpUrl)).toBe('https://example.com/cover.jpg');
  });

  test('a private-network or non-http image is dropped, so the mosaic shows', () => {
    for (const bad of ['http://192.168.1.1/x.jpg', 'http://localhost/x.jpg', 'http://10.0.0.5/c.png', 'file:///etc/passwd', 'javascript:alert(1)', 'data:image/png;base64,AAAA']) {
      expect(playlistImageUrl([el('image', bad)], isPublicHttpUrl)).toBeNull();
    }
  });

  test('no playlist-level image gives nothing, and a track\'s image is never read', () => {
    // Root children only: a <track>'s <image> lives inside <trackList>, so it
    // is never among them.
    expect(playlistImageUrl([el('title', 'Mix'), el('trackList', 'https://example.com/track.jpg')], isPublicHttpUrl)).toBeNull();
    expect(playlistImageUrl([], isPublicHttpUrl)).toBeNull();
    expect(playlistImageUrl(null, isPublicHttpUrl)).toBeNull();
    expect(playlistImageUrl([el('image', '   ')], isPublicHttpUrl)).toBeNull();
  });
});

describe('writing the cover', () => {
  test('playlistImageXml escapes the URL and skips anything not public http(s)', () => {
    expect(playlistImageXml('https://example.com/a.jpg?x=1&y=2', isPublicHttpUrl))
      .toBe('  <image>https://example.com/a.jpg?x=1&amp;y=2</image>\n');
    expect(playlistImageXml('http://192.168.0.2/a.jpg', isPublicHttpUrl)).toBe('');
    expect(playlistImageXml('', isPublicHttpUrl)).toBe('');
    expect(playlistImageXml(null, isPublicHttpUrl)).toBe('');
  });

  const doc = (extra = '') => `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>Mix</title>
${extra}  <date>2026-11-18T00:00:00.000Z</date>
  <trackList>
    <track>
      <title>Song</title>
      <image>https://example.com/track.jpg</image>
    </track>
  </trackList>
</playlist>`;

  test('withPlaylistImage adds the cover before <date> in a document without one', () => {
    const out = withPlaylistImage(doc(), 'https://example.com/cover.jpg', isPublicHttpUrl);
    expect(out).toContain('  <image>https://example.com/cover.jpg</image>\n  <date>');
    // The track's own image is untouched and still inside the track.
    expect(out.match(/<image>/g)).toHaveLength(2);
  });

  test('a document that names its own cover keeps it, and a track image doesn\'t count as one', () => {
    const own = doc('  <image>https://example.com/own.jpg</image>\n');
    expect(withPlaylistImage(own, 'https://example.com/other.jpg', isPublicHttpUrl)).toBe(own);
    // doc() has only a track-level image: the cover is still added.
    expect(withPlaylistImage(doc(), 'https://example.com/c.jpg', isPublicHttpUrl)).not.toBe(doc());
  });

  test('no cover, or a private one, leaves the document unchanged', () => {
    expect(withPlaylistImage(doc(), null, isPublicHttpUrl)).toBe(doc());
    expect(withPlaylistImage(doc(), 'http://127.0.0.1/c.jpg', isPublicHttpUrl)).toBe(doc());
  });

  test('a document without <date> gets the cover before <trackList>', () => {
    const noDate = '<playlist version="1" xmlns="http://xspf.org/ns/0/">\n  <title>T</title>\n  <trackList>\n  </trackList>\n</playlist>';
    expect(withPlaylistImage(noDate, 'https://example.com/c.jpg', isPublicHttpUrl))
      .toContain('  <image>https://example.com/c.jpg</image>\n  <trackList>');
  });
});

describe('app.js wiring', () => {
  const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
  const fn = (name) => app.slice(app.indexOf(`const ${name} = `), app.indexOf(`const ${name} = `) + 2500);

  test('parseXSPF reads the playlist-level image through the helper', () => {
    expect(fn('parseXSPF')).toMatch(/playlistImageUrl\(xml\.documentElement && xml\.documentElement\.children, window\.isPublicHttpUrl\)/);
    expect(fn('parseXSPF')).not.toMatch(/querySelector\('image'\)/);
  });

  test('generateXSPF writes the cover, and export adds it to a stored document', () => {
    expect(fn('generateXSPF')).toMatch(/playlistImageXml\(playlist\.coverArt, window\.isPublicHttpUrl\)/);
    expect(fn('handleExportPlaylist')).toMatch(/withPlaylistImage\(playlist\.xspf \|\| generateXSPF\(/);
  });
});
