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
        if (c.type !== 'playlist') return false;
        // Several play sites emit { type: 'playlist', name } with no id: such
        // a context matches by title. One with an id matches by id only.
        if (c.id != null) return candidate.id != null && c.id === candidate.id;
        return !!candidate.title && c.name === candidate.title;
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
    .find((p) => !isActiveContext({ kind: 'playlist', id: p.id, title: p.title }, active));
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

// The import card is for a new user only: no collection and no playlists.
// Empty tiles alone (a collection with no loves, say) don't show it.
function homeSections({
  bannerItems, tiles, mixes, playlists, albums, fresh, critical, concerts, concertsLocation, hasCollection,
} = {}) {
  const has = (a) => Array.isArray(a) && a.length > 0;
  return {
    banner: has(bannerItems),
    jump: has(tiles),
    importCard: !hasCollection && !has(playlists),
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

// An artist name as it may appear in the prompt: control characters and the
// bidi embedding, override and isolation characters (U+202A-202E, U+2066-2069)
// removed, whitespace collapsed, and capped at 40 characters. The prompt is
// sent without a confirmation dialog, so a name can't reorder or hide text.
const NAME_CAP = 40;
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
function promptName(name) {
  if (typeof name !== 'string') return '';
  const clean = name.replace(/\s+/g, ' ').replace(UNSAFE_CHARS, '').replace(/ +/g, ' ').trim();
  return Array.from(clean).slice(0, NAME_CAP).join('').trim();
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function exampleShufflePrompt(artists, seed) {
  const names = (artists || []).map(promptName).filter(Boolean).slice(0, 3);
  if (!names.length) return 'Make me a playlist for right now';
  const i = ((Math.trunc(seed) || 0) % 4 + 4) % 4;
  return PHRASINGS[i](joinNames(names));
}

// A Fresh Drops card's tag from its release date (YYYY-MM-DD, local day):
// "Out today", "Out Friday" within the coming week, "Out Nov 30" later,
// "This week" for the past seven days, else the date. Null without a date.
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function releaseTag(date, now) {
  const m = typeof date === 'string' && /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return null;
  const day = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(day.getTime())) return null;
  const t = new Date(now);
  const today = new Date(t.getFullYear(), t.getMonth(), t.getDate());
  const diff = Math.round((day.getTime() - today.getTime()) / DAY_MS);
  const short = `${MONTHS[day.getMonth()]} ${day.getDate()}`;
  if (diff === 0) return 'Out today';
  if (diff > 0 && diff < 7) return `Out ${WEEKDAYS[day.getDay()]}`;
  if (diff > 0) return `Out ${short}`;
  if (diff >= -7) return 'This week';
  return short;
}

// The example prompt's artists: the most frequent among the given loves,
// ties broken by recency. Local collection names only (see
// exampleShufflePrompt); blank or over-long names are dropped.
function homeTopArtists(loves, limit = 3) {
  const counts = new Map();
  (loves || []).forEach((t, i) => {
    const name = t && typeof t.artist === 'string' ? t.artist.trim() : '';
    if (!name || name.length > 80) return;
    const c = counts.get(name);
    if (c) c.n += 1; else counts.set(name, { n: 1, i });
  });
  return Array.from(counts, ([name, c]) => ({ name, ...c }))
    .sort((a, b) => (b.n - a.n) || (a.i - b.i))
    .slice(0, limit)
    .map((x) => x.name);
}

// Matches the recommendation items' real fields: resolverId, and sourceIds
// once the same album arrives from several providers.
function filterBySource(items, sourceId) {
  if (sourceId === 'All') return items;
  return (items || []).filter((it) => it && (it.resolverId === sourceId
    || (Array.isArray(it.sourceIds) && it.sourceIds.includes(sourceId))));
}

// Recommended albums Home asks a cover for: the first `perSource` of the
// whole list (the All chip) and of each source's own list (its chip), so
// picking a chip never shows cards without covers. Order kept, no repeats.
function albumsNeedingArt(albums, perSource = 6) {
  const all = Array.isArray(albums) ? albums.filter(Boolean) : [];
  const ids = [];
  for (const a of all) {
    for (const id of [a.resolverId].concat(Array.isArray(a.sourceIds) ? a.sourceIds : [])) {
      if (id && !ids.includes(id)) ids.push(id);
    }
  }
  const want = new Set(all.slice(0, perSource));
  for (const id of ids) for (const a of filterBySource(all, id).slice(0, perSource)) want.add(a);
  return all.filter((a) => want.has(a));
}

// Home's recommendations load runs on a visit unless one is running, or a
// full load finished within the last 10 minutes (the per-provider cache
// would serve it all anyway; this skips the work of asking).
const HOME_RECOMMENDATIONS_THROTTLE_MS = 10 * 60 * 1000;
function shouldLoadHomeRecommendations({ loading, loadStarted, lastFullLoadAt, now }) {
  if (loading && loadStarted) return false;
  const at = num(lastFullLoadAt);
  if (at !== null && at > 0 && now - at < HOME_RECOMMENDATIONS_THROTTLE_MS) return false;
  return true;
}

module.exports = {
  playlistFreshness, freshestPlaylists, recentLoves, changeBadge, freshChangeLine,
  isActiveContext, latestLoveAlbum, jumpBackInTiles, playlistSubtitle, homeSections,
  exampleShufflePrompt, filterBySource, releaseTag, homeTopArtists, albumsNeedingArt,
  shouldLoadHomeRecommendations, HOME_RECOMMENDATIONS_THROTTLE_MS,
};
