// src/renderer/lib/broken-art.js — recover when a cached cover URL dies.
//
// Album art is cached for 90 days (albumArtCache, persisted as
// cache_album_art), and the URL it holds can stop working well before then:
// Bandcamp image URLs carry an image id that changes when the artist replaces
// the cover (a cached f4.bcbits.com/img/<id>_10.jpg goes 404), and archive.org
// mirror hosts move. The cards used to answer a failed <img> by showing the
// placeholder, so the dead URL kept winning until the entry expired.
//
// report(url, { artist, album, releaseId }) drops every cache entry holding
// the dead URL (the persisted cache and the session resolver cache), runs the
// album-art pipeline once more, records the fresh URL under the release id
// the caller rendered from, and resolves to it (or null). One attempt per
// album per session, shared by every card showing it, so a URL that is still
// broken after the retry cannot loop.
//
// Pure (caches and the pipeline injected), so jest drives it directly
// (tests/renderer/broken-art.test.js).

function createBrokenArtRetry({ getCache, getSessionCache, refetch, now = () => Date.now() }) {
  const attempts = new Map(); // album key -> Promise<url|null>

  const forget = (url) => {
    const cache = getCache() || {};
    for (const key of Object.keys(cache)) {
      if (cache[key] && cache[key].url === url) delete cache[key];
    }
    const session = getSessionCache() || {};
    for (const key of Object.keys(session)) {
      if (session[key] === url) delete session[key];
    }
  };

  const report = (url, { artist, album, releaseId } = {}) => {
    if (typeof url !== 'string' || !url || !artist || !album) return Promise.resolve(null);
    const key = `${artist}-${album}`.toLowerCase();
    if (attempts.has(key)) return attempts.get(key);
    const attempt = (async () => {
      forget(url);
      let fresh = null;
      try {
        fresh = await refetch(artist, album);
      } catch {
        return null;
      }
      if (!fresh || fresh === url) return null;
      if (releaseId) getCache()[releaseId] = { url: fresh, timestamp: now() };
      return fresh;
    })();
    attempts.set(key, attempt);
    return attempt;
  };

  return { report };
}

module.exports = { createBrokenArtRetry };
