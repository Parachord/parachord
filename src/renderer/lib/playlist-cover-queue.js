// Which playlist mosaics the Playlists page and Home still need, and in what
// order. Pure: app.js's cover effect owns the state, the cache and the loop.
//
// Two rules (the blank-cover bug on Home): covers the cache already holds go
// on screen in one state write before any network work, and the rest are
// fetched freshest first, the order Home shows playlists in. Hosted XSPF
// playlists sit at the end of local_playlists but refresh themselves, so a
// storage-order walk reached Home's first cards last.

const { playlistFreshness } = require('./home-model');

const FULL_MOSAIC = 4;

// Cached cover sets for playlists that have none in state yet, as one
// { id: covers } patch. Null when there is nothing to add.
function cachedCoversToSeed(playlists, cache, current) {
  const patch = {};
  let any = false;
  for (const p of playlists || []) {
    if (!p || p.id == null || (current && current[p.id])) continue;
    const entry = cache && cache[p.id];
    if (entry && Array.isArray(entry.covers) && entry.covers.length > 0) {
      patch[p.id] = entry.covers;
      any = true;
    }
  }
  return any ? patch : null;
}

// One attempt per playlist per version of its tracks, per session: a playlist
// whose tracks change gets a new key and is fetched again.
function coverAttemptKey(p) {
  const n = Array.isArray(p && p.tracks) ? p.tracks.length : 0;
  return `${p && p.id}\u0000${playlistFreshness(p)}\u0000${n}`;
}

// The playlists to fetch covers for, freshest first (ties keep list order).
// Leaves out a playlist whose cache entry already has a full mosaic, and one
// already tried for its current tracks (`tried`, a Set of coverAttemptKey).
function coverFetchOrder(playlists, cache, tried) {
  return (playlists || [])
    .map((p, i) => ({ p, i }))
    .filter(({ p }) => {
      if (!p || p.id == null) return false;
      const entry = cache && cache[p.id];
      if (entry && Array.isArray(entry.covers) && entry.covers.length >= FULL_MOSAIC) return false;
      return !(tried && tried.has(coverAttemptKey(p)));
    })
    .map((x) => ({ ...x, f: playlistFreshness(x.p) }))
    .sort((a, b) => (b.f - a.f) || (a.i - b.i))
    .map((x) => x.p);
}

module.exports = { cachedCoversToSeed, coverAttemptKey, coverFetchOrder };
