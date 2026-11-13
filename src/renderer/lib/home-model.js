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

// One provider's getHistoryMixes answer as Home's mix cards: playlists with
// an id, a name and a URL (the URL is what opens and plays them, through the
// same lookup the Recommendations page's playlist cards use). `title` is
// what the playlist card and the Jump back in tile print; `resolverId` and
// `resolverName` name the service for the source chips and the card label.
const trimmed = (v) => (typeof v === 'string' ? v.trim() : '');
function normalizeHistoryMixes(items, provider) {
  const resolverId = (provider && provider.id) || null;
  const resolverName = (provider && provider.name) || resolverId;
  const out = [];
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw !== 'object') continue;
    if (raw.type != null && raw.type !== 'playlist') continue;
    const id = trimmed(raw.id);
    const name = trimmed(raw.name);
    const url = trimmed(raw.url);
    if (!id || !name || !url) continue;
    const mix = { type: 'playlist', id, name, title: name };
    if (trimmed(raw.description)) mix.description = trimmed(raw.description);
    if (trimmed(raw.imageUrl)) mix.imageUrl = trimmed(raw.imageUrl);
    mix.url = url;
    mix.resolverId = resolverId;
    mix.resolverName = resolverName;
    out.push(mix);
  }
  return out;
}

// Every provider's mixes as one list: round-robin in provider order (the
// first of each, then the second of each, ...), so a service with many mixes
// doesn't fill the row before the next one shows. An id seen once is kept
// where it first appeared.
function flattenHistoryMixes(entries) {
  const lists = (Array.isArray(entries) ? entries : [])
    .map((e) => (e && Array.isArray(e.items) ? e.items : []));
  const longest = lists.reduce((n, l) => Math.max(n, l.length), 0);
  const out = [];
  const seen = new Set();
  for (let i = 0; i < longest; i++) {
    for (const list of lists) {
      const mix = list[i];
      if (!mix || mix.id == null || seen.has(mix.id)) continue;
      seen.add(mix.id);
      out.push(mix);
    }
  }
  return out;
}

// A provider's cached history mixes, or null when there are none to use:
// not a list, or saved for another account (a meta-service's username; a
// changed ListenBrainz user must never see the old one's mixes).
function historyMixCacheEntry(entry, account) {
  if (!entry || !Array.isArray(entry.items)) return null;
  return (entry.account || '') === (account || '') ? entry : null;
}

// The entries Home shows, in provider priority order: one per provider that
// has mixes. `entryFor(provider)` is that provider's answer (fresh or stale),
// or nothing.
function historyMixEntriesFor(providers, entryFor) {
  const out = [];
  for (const provider of providers || []) {
    const entry = provider && entryFor(provider);
    if (!entry || !Array.isArray(entry.items) || entry.items.length === 0) continue;
    out.push({ resolverId: provider.id, resolverName: provider.name || provider.id, items: entry.items });
  }
  return out;
}

// Whether two entry lists show the same thing: the same providers in the
// same order, holding the same item objects. A cached answer keeps its item
// objects, and a fetched one makes new ones, so a refetch always counts.
function sameHistoryMixEntries(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  return a.every((entry, i) => {
    const other = b[i];
    return !!other && entry.resolverId === other.resolverId && entry.resolverName === other.resolverName
      && entry.items.length === other.items.length
      && entry.items.every((item, j) => item === other.items[j]);
  });
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
// bidi embedding, override and isolation characters (U+202A-202E, U+2066-2069),
// the Arabic letter mark (U+061C) and zero-width characters (U+200B-200F)
// removed, whitespace collapsed, and capped at 40 characters. The prompt is
// sent without a confirmation dialog, so a name can't reorder or hide text.
const NAME_CAP = 40;
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;
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

// Whether a finished full load counts for that throttle. Not when every
// provider it asked failed (an outage, a timeout, offline), and not when it
// left no section to show: Home then retries on its next visit instead of
// waiting 10 minutes. A load served wholly from the cache (fetched 0) with
// sections counts.
function shouldStampHomeRecommendationsLoad({ fetched, failed, sectionCount }) {
  if (failed > 0 && failed === fetched) return false;
  return sectionCount > 0;
}

// Each plugin's colour by id, for the source chips. Pass the plugin loader's
// whole registry: ListenBrainz and Last.fm are meta services, so a list of
// content resolvers alone leaves their chips grey.
function pluginColors(registry) {
  const map = {};
  for (const r of Array.isArray(registry) ? registry : []) {
    const c = r && (r.color || (r.manifest && r.manifest.color));
    if (r && r.id && c) map[r.id] = c;
  }
  return map;
}

// A history mix with no cover of its own (ListenBrainz sends none) gets the
// same 2x2 mosaic as any playlist, built from its tracks. These pick the
// mixes still needing one (each tried once per session) and attach the
// covers that arrived.
function mixesNeedingMosaic(mixes, tried) {
  return (Array.isArray(mixes) ? mixes : []).filter((m) => m && m.id && m.url && !m.imageUrl
    && !(Array.isArray(m.mosaic) && m.mosaic.length > 0) && !(tried && tried.has(m.id)));
}

// A mosaic lookup that fails is retried this long after, this many tries in
// all (the first seconds after launch often have no network yet).
const HOME_MIX_COVER_ATTEMPTS = 3;
const HOME_MIX_COVER_RETRY_MS = 60 * 1000;

function withMixMosaics(mixes, covers) {
  if (!Array.isArray(mixes) || !covers || Object.keys(covers).length === 0) return mixes;
  return mixes.map((m) => {
    const c = m && covers[m.id];
    return Array.isArray(c) && c.length > 0 ? { ...m, mosaic: c.slice(0, 4) } : m;
  });
}

module.exports = {
  playlistFreshness, freshestPlaylists, recentLoves, changeBadge, freshChangeLine,
  isActiveContext, latestLoveAlbum, jumpBackInTiles, playlistSubtitle, homeSections,
  normalizeHistoryMixes, flattenHistoryMixes, historyMixCacheEntry, historyMixEntriesFor, sameHistoryMixEntries,
  exampleShufflePrompt, filterBySource, homeTopArtists, albumsNeedingArt,
  shouldLoadHomeRecommendations, shouldStampHomeRecommendationsLoad, HOME_RECOMMENDATIONS_THROTTLE_MS,
  pluginColors, mixesNeedingMosaic, withMixMosaics, HOME_MIX_COVER_ATTEMPTS, HOME_MIX_COVER_RETRY_MS,
};
