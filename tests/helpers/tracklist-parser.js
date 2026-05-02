// SSRF guard for user-supplied tracklist endpoints in parachord:// commands.
// SYNC: app.js — keep the JSON branch byte-identical with window.parseProtocolTracklist's JSON branch.
// (XSPF branches diverge: this file uses regex; app.js uses DOMParser.)

function extractMbid(identifier) {
  if (!identifier) return null;
  const arr = Array.isArray(identifier) ? identifier : [identifier];
  for (const id of arr) {
    if (typeof id !== 'string') continue;
    const m = id.match(/musicbrainz\.org\/(?:recording|track)\/([a-f0-9-]+)/i);
    if (m) return m[1];
    if (/^[a-f0-9-]{36}$/i.test(id)) return id;
  }
  return null;
}

function parseJspfTrack(t) {
  if (!t || typeof t !== 'object') return null;
  const artist = t.creator || t.artist;
  const title = t.title;
  if (!artist || !title) return null;
  const out = { artist, title };
  if (t.album) out.album = t.album;
  const mbid = extractMbid(t.identifier);
  if (mbid) out.mbid = mbid;
  return out;
}

function parseProtocolTracklist(body, contentType) {
  const ct = (contentType || '').toLowerCase();
  if (ct.includes('xml')) {
    // Lightweight XSPF parser for the test harness (no DOMParser in Node).
    const titleMatch = body.match(/<playlist[^>]*>[\s\S]*?<title>([^<]*)<\/title>/);
    const displayName = titleMatch ? titleMatch[1].trim() : 'Imported playlist';
    const tracks = [];
    const trackRe = /<track>([\s\S]*?)<\/track>/g;
    let m;
    while ((m = trackRe.exec(body))) {
      const inner = m[1];
      const t = inner.match(/<title>([^<]*)<\/title>/)?.[1];
      const c = inner.match(/<creator>([^<]*)<\/creator>/)?.[1];
      const a = inner.match(/<album>([^<]*)<\/album>/)?.[1];
      if (t && c) {
        const tr = { artist: c, title: t };
        if (a) tr.album = a;
        tracks.push(tr);
      }
    }
    return { displayName, tracks };
  }
  let parsed;
  try { parsed = JSON.parse(body); } catch { return { displayName: 'Tracks', tracks: [] }; }
  if (parsed.playlist && Array.isArray(parsed.playlist.track)) {
    const displayName = parsed.playlist.title || 'Tracks';
    const tracks = parsed.playlist.track.map(parseJspfTrack).filter(Boolean);
    return { displayName, tracks };
  }
  if (Array.isArray(parsed.tracks)) {
    const tracks = parsed.tracks
      .filter(t => t && t.artist && t.title)
      .map(t => {
        const out = { artist: t.artist, title: t.title };
        if (t.album) out.album = t.album;
        if (t.mbid) out.mbid = t.mbid;
        if (t.isrc) out.isrc = t.isrc;
        return out;
      });
    return { displayName: parsed.title || 'Tracks', tracks };
  }
  return { displayName: 'Tracks', tracks: [] };
}

module.exports = { parseProtocolTracklist };
