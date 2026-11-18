// src/renderer/lib/xspf-image.js: a playlist's own cover in XSPF, read and
// written (#1410).
//
// XSPF can name a playlist's cover with an <image> element directly under
// <playlist>. A <track> can carry its own <image> too, but that's album art
// and stays on the album-art path; only the playlist's own one becomes the
// record's `coverArt` (album-art.md "Playlist covers": never stamped on a
// track's albumArt, never written into albumArtCache).
//
// The URL comes from a document someone else wrote (a hosted playlist, a file,
// a parachord:// import), and every surface that shows the cover loads it as
// <img src>. So it's accepted only when it's a public http(s) address, the
// same rule the hosted-playlist fetch guard applies to the document itself
// (CLAUDE.md: every URL fetched on behalf of a deep link goes through the SSRF
// guard). Anything else is dropped and the playlist shows its mosaic.
//
// Pure: the caller passes `isPublicHttpUrl` (protocol-url.js). Loads under
// plain Node.

'use strict';

// The playlist-level <image> URL from the document root's child elements
// (`{ localName, textContent }`-shaped, e.g. `xml.documentElement.children`),
// or null when there is none or it isn't a public http(s) URL.
function playlistImageUrl(rootChildren, isPublicHttpUrl) {
  const children = Array.from(rootChildren || []);
  const el = children.find((c) => c && (c.localName || c.nodeName) === 'image');
  const url = el && typeof el.textContent === 'string' ? el.textContent.trim() : '';
  if (!url || typeof isPublicHttpUrl !== 'function' || !isPublicHttpUrl(url)) return null;
  return url;
}

const escapeXml = (str) => String(str)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

// The `<image>` line to write for a playlist's coverArt (indented for the
// playlist level, with its newline), or '' when there's nothing to write.
function playlistImageXml(coverArt, isPublicHttpUrl) {
  if (typeof coverArt !== 'string' || !coverArt.trim()) return '';
  const url = coverArt.trim();
  if (typeof isPublicHttpUrl !== 'function' || !isPublicHttpUrl(url)) return '';
  return `  <image>${escapeXml(url)}</image>\n`;
}

// An XSPF document with the playlist's cover in it, for exporting a playlist
// whose stored document (playlist.xspf) may not name one. Inserts the <image>
// before <date> (XSPF's element order: ... identifier, image, date, ...), or
// before <trackList> when there's no <date>. A document that already has a
// playlist-level <image> (before its <trackList>) is returned unchanged, so
// the document's own cover wins.
function withPlaylistImage(xspf, coverArt, isPublicHttpUrl) {
  if (typeof xspf !== 'string') return xspf;
  const line = playlistImageXml(coverArt, isPublicHttpUrl);
  if (!line) return xspf;
  const listAt = xspf.search(/<trackList[\s>]/);
  const head = listAt === -1 ? xspf : xspf.slice(0, listAt);
  if (/<image[\s>]/.test(head)) return xspf;
  const dateAt = head.search(/<date[\s>]/);
  const insertAt = dateAt !== -1 ? dateAt : listAt;
  if (insertAt === -1) return xspf;
  // Insert at the start of that element's line, keeping its indentation.
  const lineStart = xspf.lastIndexOf('\n', insertAt - 1) + 1;
  return xspf.slice(0, lineStart) + line + xspf.slice(lineStart);
}

module.exports = { playlistImageUrl, playlistImageXml, withPlaylistImage };
