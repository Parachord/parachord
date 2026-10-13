/**
 * Recommendation blocklist matching (parachord#1006).
 *
 * The blocklist is `{ artists: [{ name }], albums: [{ title, artist }],
 * tracks: [{ title, artist }] }`, persisted as `recommendation_blocklist` and
 * written by `addToRecommendationBlocklist` (chat and MCP `block_recommendation`).
 * Until #1006 nothing read it. These helpers are the one place that decides
 * what "blocked" means so every surface agrees:
 *
 *   - a blocked artist blocks everything by that artist (albums, tracks, the
 *     artist itself);
 *   - a blocked album blocks that album and tracks that say they are on it;
 *   - a blocked track blocks that track only.
 *
 * Matching is case-insensitive on trimmed strings. No fuzzy matching: a
 * blocked "Radiohead" does not block "Radiohead & Friends".
 *
 * Loaded by index.html for the renderer (window.recommendationBlocklist) and
 * require()d by the tests.
 */
(function () {
  'use strict';

  const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
  const EMPTY = { artists: [], albums: [], tracks: [] };

  function sets(blocklist) {
    const b = blocklist || EMPTY;
    return {
      artists: new Set((b.artists || []).map((a) => norm(a && a.name)).filter(Boolean)),
      albums: new Set((b.albums || []).map((a) => a && `${norm(a.artist)}|${norm(a.title)}`).filter((k) => k && k !== '|')),
      tracks: new Set((b.tracks || []).map((t) => t && `${norm(t.artist)}|${norm(t.title)}`).filter((k) => k && k !== '|')),
    };
  }

  function isEmpty(blocklist) {
    const b = blocklist || EMPTY;
    return !(b.artists && b.artists.length) && !(b.albums && b.albums.length) && !(b.tracks && b.tracks.length);
  }

  // item: { artist?, album?, title? }. `title` is the track title when
  // `album` is also given (a track on an album); when there is no `album`,
  // `title` is matched against both blocked albums and blocked tracks, which
  // is what callers with a bare release or a bare song both want.
  function isBlocked(blocklist, item) {
    if (!item || isEmpty(blocklist)) return false;
    const s = sets(blocklist);
    const artist = norm(item.artist);
    if (artist && s.artists.has(artist)) return true;
    const album = norm(item.album);
    if (album && s.albums.has(`${artist}|${album}`)) return true;
    const title = norm(item.title);
    if (title) {
      if (s.tracks.has(`${artist}|${title}`)) return true;
      if (!album && s.albums.has(`${artist}|${title}`)) return true;
    }
    return false;
  }

  // Keep the items that are not blocked. `pick` maps an item to
  // { artist, album?, title? }; defaults to the item itself.
  function filterBlocked(blocklist, items, pick) {
    if (!Array.isArray(items) || isEmpty(blocklist)) return items || [];
    const p = pick || ((x) => x);
    return items.filter((x) => !isBlocked(blocklist, p(x)));
  }

  // Lines for the chat system prompt, or [] when nothing is blocked.
  function formatForPrompt(blocklist) {
    if (isEmpty(blocklist)) return [];
    const b = blocklist;
    const lines = ['\n🚫 BLOCKLIST (user asked never to see these; do not recommend, queue or play them):'];
    if (b.artists && b.artists.length) lines.push(`  Artists: ${b.artists.map((a) => a.name).filter(Boolean).join(', ')}`);
    if (b.albums && b.albums.length) lines.push(`  Albums: ${b.albums.map((a) => `"${a.title}" by ${a.artist}`).join(', ')}`);
    if (b.tracks && b.tracks.length) lines.push(`  Tracks: ${b.tracks.map((t) => `"${t.title}" by ${t.artist}`).join(', ')}`);
    return lines;
  }

  const api = { isBlocked, filterBlocked, formatForPrompt, isEmpty };
  if (typeof window !== 'undefined') window.recommendationBlocklist = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
