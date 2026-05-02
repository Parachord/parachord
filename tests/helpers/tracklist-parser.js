// SSRF-protected tracklist parser. Used by parachord:// play-album, play-playlist, play-radio.
// SYNC: app.js — keep the JSON branch byte-identical with window.parseProtocolTracklist's JSON branch.
// (XSPF branches diverge intentionally: this file uses regex; app.js uses DOMParser.)

function parseProtocolTracklist(body, contentType) {
  const MAX_TRACKS = 500;
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('xml')) {
    // Lightweight XSPF parser for the test harness (no DOMParser in Node).
    // Match <title> only when it appears before <trackList> (i.e., the playlist-level title).
    const titleMatch = body.match(/<playlist[^>]*>([\s\S]*?)<trackList/);
    const headTitle = titleMatch ? titleMatch[1].match(/<title>([^<]*)<\/title>/) : null;
    const displayName = headTitle ? headTitle[1].trim() : 'Tracks';
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
    return { displayName, tracks: tracks.slice(0, MAX_TRACKS) };
  }

  // === SYNC START: JSON branch — byte-identical with app.js ===
  const extractMbid = (identifier) => {
    if (!identifier) return null;
    const arr = Array.isArray(identifier) ? identifier : [identifier];
    for (const id of arr) {
      if (typeof id !== 'string') continue;
      const m = id.match(/musicbrainz\.org\/(?:recording|track)\/([a-f0-9-]{36})/i);
      if (m) return m[1];
      if (/^[a-f0-9-]{36}$/i.test(id)) return id;
    }
    return null;
  };
  const parseJspfTrack = (t) => {
    if (!t || typeof t !== 'object') return null;
    const rawArtist = t.creator || t.artist;
    const artist = Array.isArray(rawArtist) ? rawArtist.filter(x => typeof x === 'string').join(', ') : rawArtist;
    const title = t.title;
    if (!artist || !String(artist).trim() || !title || !String(title).trim()) return null;
    const out = { artist: String(artist).trim(), title: String(title).trim() };
    if (t.album && String(t.album).trim()) out.album = String(t.album).trim();
    const mbid = extractMbid(t.identifier);
    if (mbid) out.mbid = mbid;
    return out;
  };

  let parsed;
  try { parsed = JSON.parse(body); } catch { return { displayName: 'Tracks', tracks: [] }; }
  // ListenBrainz lb-radio wraps the JSPF in `{payload: {jspf: {playlist}}}`.
  // Unwrap to the bare JSPF shape so the existing JSPF branch handles it.
  const jspfRoot = parsed.payload?.jspf || parsed;
  if (jspfRoot.playlist && Array.isArray(jspfRoot.playlist.track)) {
    const displayName = jspfRoot.playlist.title || 'Tracks';
    const tracks = jspfRoot.playlist.track.map(parseJspfTrack).filter(Boolean);
    return { displayName, tracks: tracks.slice(0, MAX_TRACKS) };
  }
  if (Array.isArray(parsed.tracks)) {
    const tracks = parsed.tracks
      .filter(t => t && t.artist && String(t.artist).trim() && t.title && String(t.title).trim())
      .map(t => {
        const out = { artist: String(t.artist).trim(), title: String(t.title).trim() };
        if (t.album && String(t.album).trim()) out.album = String(t.album).trim();
        if (t.mbid && /^[a-f0-9-]{36}$/i.test(t.mbid)) out.mbid = t.mbid;
        if (t.isrc && String(t.isrc).trim()) out.isrc = String(t.isrc).trim();
        return out;
      });
    return { displayName: parsed.title || 'Tracks', tracks: tracks.slice(0, MAX_TRACKS) };
  }
  return { displayName: 'Tracks', tracks: [] };
  // === SYNC END ===
}

module.exports = { parseProtocolTracklist };
