/**
 * Catalog album-art fallback: Apple's iTunes Search API, then Deezer's public
 * search API. The tail of the one album-art pipeline every surface shares:
 *
 *   cache → MusicBrainz + Cover Art Archive → enabled resolvers → iTunes → Deezer
 *
 * Why two catalogs: Cover Art Archive is volunteer-uploaded and often lacks
 * art for fresh or small-label releases; resolver search only covers the
 * services the user has enabled; iTunes Search has store art the day a
 * release ships but its index lags for indie titles; Deezer carries many of
 * those. Deezer is only asked when iTunes misses, so the common path is one
 * call. Ported from Achordion's lib/clients/{itunes,deezer,album-art}.ts with
 * one addition: a hit must name the artist and the album (or track) we asked
 * for, after normalization, because both APIs return a best-effort top hit
 * (iTunes answers "Lustmord Black Star" with "The Place Where the Black Stars
 * Hang"), and a wrong cover is worse than none.
 *
 * Pure: every network call goes through the injected fetch functions, so the
 * renderer can route iTunes through window.iTunesRateLimiter and Deezer
 * (no CORS for file:// origins) through the main-process proxy, and the
 * tests can script both. Loaded by index.html (window.albumArtCatalog) and
 * require()d by the tests.
 */
(function () {
  'use strict';

  // Lower-case, strip non-alphanumerics and a leading "the".
  const norm = (s) => (typeof s === 'string' ? s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/^the/, '') : '');
  // Equal after normalization, or one is a prefix of the other, so
  // "Black Star" matches "Black Star (Remastered)" and "The Beatles" matches
  // "Beatles", but "Black Star" does not match "The Place Where the Black
  // Stars Hang" (plain containment would). Empty strings never match.
  const nameMatch = (a, b) => {
    const x = norm(a), y = norm(b);
    return !!x && !!y && (x === y || x.startsWith(y) || y.startsWith(x));
  };

  const upsizeItunes = (url) => (typeof url === 'string' && url ? url.replace(/100x100/g, '500x500') : null);

  async function readJson(fetchImpl, url) {
    if (typeof fetchImpl !== 'function') return null;
    try {
      const res = await fetchImpl(url);
      if (!res || !res.ok) return null;
      return await res.json();
    } catch (e) {
      return null;
    }
  }

  // --- iTunes Search (no auth; ~20 req/min/IP, hence the renderer's limiter) ---

  async function getItunesAlbumArtwork(artist, album, deps) {
    if (!artist || !album) return null;
    const params = new URLSearchParams({ term: `${artist} ${album}`.trim(), entity: 'album', limit: '5' });
    const data = await readJson(deps && deps.fetchItunes, `https://itunes.apple.com/search?${params}`);
    const hit = (data && Array.isArray(data.results) ? data.results : [])
      .find((r) => nameMatch(r.artistName, artist) && nameMatch(r.collectionName, album));
    return hit ? upsizeItunes(hit.artworkUrl100) : null;
  }

  async function getItunesTrackArtwork(artist, track, deps) {
    if (!artist || !track) return null;
    const params = new URLSearchParams({ term: `${artist} ${track}`.trim(), entity: 'song', limit: '5' });
    const data = await readJson(deps && deps.fetchItunes, `https://itunes.apple.com/search?${params}`);
    const hit = (data && Array.isArray(data.results) ? data.results : [])
      .find((r) => nameMatch(r.artistName, artist) && nameMatch(r.trackName, track));
    return hit ? upsizeItunes(hit.artworkUrl100) : null;
  }

  // --- Deezer public search (no auth) ---

  const esc = (s) => String(s).replace(/"/g, ' ');

  async function getDeezerAlbumArtwork(artist, album, deps) {
    if (!artist || !album) return null;
    const params = new URLSearchParams({ q: `artist:"${esc(artist)}" album:"${esc(album)}"`, limit: '5' });
    const data = await readJson(deps && deps.fetchDeezer, `https://api.deezer.com/search/album?${params}`);
    const hit = (data && Array.isArray(data.data) ? data.data : [])
      .find((r) => nameMatch(r.artist && r.artist.name, artist) && nameMatch(r.title, album));
    return hit ? (hit.cover_big || hit.cover_medium || null) : null;
  }

  async function getDeezerTrackArtwork(artist, track, deps) {
    if (!artist || !track) return null;
    const params = new URLSearchParams({ q: `artist:"${esc(artist)}" track:"${esc(track)}"`, limit: '5' });
    const data = await readJson(deps && deps.fetchDeezer, `https://api.deezer.com/search?${params}`);
    const hit = (data && Array.isArray(data.data) ? data.data : [])
      .find((r) => nameMatch(r.artist && r.artist.name, artist) && nameMatch(r.title, track));
    const cover = hit && hit.album;
    return cover ? (cover.cover_big || cover.cover_medium || null) : null;
  }

  // --- The chain ---

  async function getCatalogAlbumArtwork(artist, album, deps) {
    return (await getItunesAlbumArtwork(artist, album, deps)) || (await getDeezerAlbumArtwork(artist, album, deps));
  }

  async function getCatalogTrackArtwork(artist, track, deps) {
    return (await getItunesTrackArtwork(artist, track, deps)) || (await getDeezerTrackArtwork(artist, track, deps));
  }

  const api = {
    nameMatch,
    getItunesAlbumArtwork, getItunesTrackArtwork,
    getDeezerAlbumArtwork, getDeezerTrackArtwork,
    getCatalogAlbumArtwork, getCatalogTrackArtwork,
  };
  if (typeof window !== 'undefined') window.albumArtCatalog = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
