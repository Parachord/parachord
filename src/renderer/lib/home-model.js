// Pure model for the Home page: which tiles show, in what order, how fresh a
// playlist is, its change badge and the example prompt. No window, no React.
//
// Field names follow the app's real shapes: playlists have id, title, tracks,
// lastModified, createdAt (plus tracksChangedAt and lastChangeAdded once a
// track change stamps them); collection tracks have addedAt, artist, title,
// album and releaseMbid; a playback context is { type, id?, name?, artist? }.

const { normalizeAlbumTitle, normalizeArtistName } = require('./album-catalog');

const DAY_MS = 86400000;
const BADGE_WINDOW_MS = 7 * DAY_MS;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// When a playlist's tracks last changed. A playlist saved before
// tracksChangedAt existed falls back to lastModified, then createdAt.
function playlistFreshness(p) {
  if (!p) return 0;
  return num(p.tracksChangedAt) ?? num(p.lastModified) ?? num(p.createdAt) ?? 0;
}

function freshestPlaylists(playlists, limit = 6) {
  return (playlists || [])
    .map((p, i) => ({ p, i, f: playlistFreshness(p) }))
    .sort((a, b) => (b.f - a.f) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.p);
}

// Newest love first; tracks without addedAt go last, in input order.
function recentLoves(tracks, limit = 50) {
  return (tracks || [])
    .map((t, i) => ({ t, i, a: num(t && t.addedAt) }))
    .sort((x, y) => {
      if (x.a === null && y.a === null) return x.i - y.i;
      if (x.a === null) return 1;
      if (y.a === null) return -1;
      return (y.a - x.a) || (x.i - y.i);
    })
    .slice(0, limit)
    .map((x) => x.t);
}

function changeBadge(p, now) {
  if (!p || !(p.lastChangeAdded > 0)) return null;
  const at = num(p.tracksChangedAt);
  if (at === null || now - at > BADGE_WINDOW_MS) return null;
  return `+${p.lastChangeAdded}`;
}

function whenPhrase(at, now) {
  const d = new Date(at);
  const today = new Date(now);
  const startOf = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(today) - startOf(d)) / DAY_MS);
  if (days <= 0) {
    const h = d.getHours();
    if (h < 12) return 'this morning';
    if (h < 18) return 'this afternoon';
    return 'this evening';
  }
  if (days === 1) return 'yesterday';
  return `${days} days ago`;
}

function freshChangeLine(p, now) {
  if (changeBadge(p, now) === null) return null;
  const n = p.lastChangeAdded;
  return `${p.title} picked up ${n} new ${n === 1 ? 'track' : 'tracks'} ${whenPhrase(p.tracksChangedAt, now)}`;
}

const ctxMbid = (c) => c.mbid || c.releaseMbid || null;

// Is this candidate what's playing or queued? Compared by the playback
// context only, never by track sets.
function isActiveContext(candidate, { playing, queued } = {}) {
  if (!candidate) return false;
  const contexts = [playing, queued].filter(Boolean);
  return contexts.some((c) => {
    switch (candidate.kind) {
      case 'playlist':
        return c.type === 'playlist' && candidate.id != null && c.id === candidate.id;
      case 'mix':
        return c.type === 'mix' && candidate.id != null && c.id === candidate.id;
      case 'loves':
        return c.type === 'loves';
      case 'album': {
        if (c.type !== 'album') return false;
        if (candidate.mbid && ctxMbid(c)) return candidate.mbid === ctxMbid(c);
        const album = normalizeAlbumTitle(candidate.album);
        const artist = normalizeArtistName(candidate.artist);
        if (!album) return false;
        return normalizeAlbumTitle(c.name || c.album) === album
          && normalizeArtistName(c.artist) === artist;
      }
      default:
        return false;
    }
  });
}

function latestLoveAlbum(loves, active) {
  for (const t of loves || []) {
    if (!t || !t.album) continue;
    const mbid = t.releaseMbid || t.mbid || undefined;
    if (isActiveContext({ kind: 'album', album: t.album, artist: t.artist, mbid }, active)) continue;
    const out = { album: t.album, artist: t.artist, trackTitle: t.title };
    if (mbid) out.mbid = mbid;
    return out;
  }
  return null;
}

function relativeTime(at, now) {
  const diff = Math.max(0, now - at);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(d / 365)}y ago`;
}

function playlistSubtitle(p, now) {
  const at = playlistFreshness(p);
  const base = `Refreshed ${relativeTime(at, now)}`;
  const created = num(p && p.createdAt);
  if (created === null) return base;
  return `${base} · since ${new Date(created).getUTCFullYear()}`;
}

// Up to four tiles in the order playlist, loves, album, mix. Each kind takes
// its first candidate that isn't playing or queued.
function jumpBackInTiles({ playlists, loves, mixes, active, now = Date.now() } = {}) {
  const tiles = [];
  const playlist = freshestPlaylists(playlists, Infinity)
    .find((p) => !isActiveContext({ kind: 'playlist', id: p.id }, active));
  if (playlist) {
    tiles.push({
      kind: 'playlist',
      item: playlist,
      subtitle: changeBadge(playlist, now)
        ? `Playlist · ${playlist.lastChangeAdded} new ${whenPhraseShort(playlist.tracksChangedAt, now)}`
        : 'Playlist',
    });
  }
  const lovesList = loves || [];
  if (lovesList.length && !isActiveContext({ kind: 'loves' }, active)) {
    tiles.push({ kind: 'loves', item: lovesList, subtitle: 'Your recent loves' });
  }
  const album = latestLoveAlbum(lovesList, active);
  if (album) {
    tiles.push({
      kind: 'album',
      item: album,
      subtitle: `${album.trackTitle} · the album behind your latest love`,
    });
  }
  const mix = (mixes || []).find((m) => !isActiveContext({ kind: 'mix', id: m.id }, active));
  if (mix) tiles.push({ kind: 'mix', item: mix, subtitle: 'Made from your listening' });
  return tiles.slice(0, 4);
}

function whenPhraseShort(at, now) {
  const p = whenPhrase(at, now);
  return p.startsWith('this ') ? 'today' : p;
}

function homeSections({
  bannerItems, tiles, mixes, playlists, albums, fresh, critical, concerts, concertsLocation,
} = {}) {
  const has = (a) => Array.isArray(a) && a.length > 0;
  return {
    banner: has(bannerItems),
    jump: has(tiles),
    importCard: !has(tiles),
    mixes: has(mixes),
    playlists: has(playlists),
    albums: has(albums),
    fresh: has(fresh),
    critical: has(critical),
    concerts: has(concerts) && !!concertsLocation,
    ask: true,
  };
}

// Built from local artist names only, never remote text: Home's Ask skips
// the confirmation dialog, so nothing fetched may reach the prompt.
const PHRASINGS = [
  (a) => `A rainy Sunday playlist built around ${a}`,
  (a) => `A late night mix with ${a}`,
  (a) => `Songs that sound like ${a}`,
  (a) => `A road trip playlist starting with ${a}`,
];

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function exampleShufflePrompt(artists, seed) {
  const names = (artists || []).filter((n) => typeof n === 'string' && n.trim()).slice(0, 3);
  if (!names.length) return 'Make me a playlist for right now';
  const i = ((Math.trunc(seed) || 0) % 4 + 4) % 4;
  return PHRASINGS[i](joinNames(names));
}

// Matches the recommendation items' real fields: resolverId, and sourceIds
// once the same album arrives from several providers.
function filterBySource(items, sourceId) {
  if (sourceId === 'All') return items;
  return (items || []).filter((it) => it && (it.resolverId === sourceId
    || (Array.isArray(it.sourceIds) && it.sourceIds.includes(sourceId))));
}

module.exports = {
  playlistFreshness, freshestPlaylists, recentLoves, changeBadge, freshChangeLine,
  isActiveContext, latestLoveAlbum, jumpBackInTiles, playlistSubtitle, homeSections,
  exampleShufflePrompt, filterBySource,
};
