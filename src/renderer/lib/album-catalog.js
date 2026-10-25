// src/renderer/lib/album-catalog.js — album track lists from the plugins when MusicBrainz can't supply them.
//
// Every album page got its track list from MusicBrainz, so during a
// MusicBrainz outage (2026-10) nearly every album in Fresh Drops, Charts,
// Search and the Collection failed to open, and albums that came from a
// service (a Spotify or Apple Music search result, an artist-page card built
// from Spotify / Apple / Last.fm / Discogs) never opened at all: their ids
// were sent to MusicBrainz. Plugins that declare capabilities.albumSearch
// (searchAlbums + lookupAlbum; docs/architecture/plugins.md) can find the
// album by name and load its tracks instead. This module is the pure part:
// which resolvers to ask in what order, whether a result is the album that
// was asked for, and the conversion to the release-page shape.
//
// MusicBrainz stays first for albums that have a MusicBrainz id: the track
// titles it gives are the ones track ids (trackSlug) and the resolution cache
// are keyed on, and its recording ids feed scrobbles and Achordion.

// A MusicBrainz id is a UUID. Anything else on a release (spotify-…,
// applemusic-…, lastfm-…, discogs-…) is a service's id that MusicBrainz will
// never know.
const MB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isMusicBrainzId = (id) => typeof id === 'string' && MB_ID.test(id);

// "spotify-4aawyAB9vmqN3uQ7FjRGTy" -> "spotify", when that is a known resolver.
function resolverIdFromReleaseId(id, knownIds = []) {
  if (typeof id !== 'string') return null;
  const prefix = id.split('-')[0];
  return knownIds.includes(prefix) ? prefix : null;
}

const stripMarks = (s) => {
  let out = String(s || '');
  try { out = out.normalize('NFKD').replace(/\p{M}/gu, ''); } catch (_e) { /* old engines */ }
  return out.toLowerCase();
};

// Edition and format suffixes services add to an album title, which
// MusicBrainz's title and the user's request usually lack.
const EDITION = /\s*[([]\s*(?:[^)\]]*\b(?:deluxe|expanded|remaster(?:ed)?|anniversary|edition|version|explicit|clean|bonus|reissue|mono|stereo)\b[^)\]]*)[)\]]\s*/gi;
const FORMAT_SUFFIX = /\s+-\s+(?:single|ep|lp)\s*$/i;

function normalizeAlbumTitle(title) {
  const s = stripMarks(title).replace(EDITION, ' ').replace(FORMAT_SUFFIX, '');
  return s.replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizeArtistName(name) {
  return stripMarks(name).replace(/^the\s+/, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
}

// The credited artists of a joined credit ("A, B & C", "A feat. B").
const splitArtists = (name) => String(name || '')
  .split(/\s*(?:,|&|\band\b|\bfeat\.?|\bft\.?|\bfeaturing|\bwith|\bx\b|\/)\s*/i)
  .map(normalizeArtistName)
  .filter(Boolean);

// Containment counts only when the shorter side is most of the longer one, so
// "Red" never matches "Red Hot Chili Peppers".
const closeEnough = (a, b, ratio) => {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return long.includes(short) && short.length >= long.length * ratio;
};

// Whether a catalog album is the one that was asked for: the title matches
// (edition suffixes aside) and so does the artist (one of a joint credit is
// enough). Returns 0 for no match, else a score where higher is closer.
function albumMatchScore(target, album) {
  if (!target || !album) return 0;
  const wantTitle = normalizeAlbumTitle(target.title);
  const gotTitle = normalizeAlbumTitle(album.name);
  if (!closeEnough(wantTitle, gotTitle, 0.6)) return 0;
  const wantArtist = normalizeArtistName(target.artist);
  const gotArtist = normalizeArtistName(album.artist);
  const artistOk = closeEnough(wantArtist, gotArtist, 0.6)
    || splitArtists(album.artist).includes(wantArtist)
    || splitArtists(target.artist).includes(gotArtist);
  if (!artistOk) return 0;
  // The same title before edition suffixes were stripped beats an edition:
  // "Dulling the Horns" over "Dulling the Horns (Deluxe)".
  const bare = (s) => stripMarks(s).replace(/[^\p{L}\p{N}]+/gu, '');
  const exactTitle = bare(target.title) === bare(album.name) ? 1 : 0;
  return (wantTitle === gotTitle ? 2 : 1) + exactTitle + (wantArtist === gotArtist ? 2 : 1);
}

// The best match among one resolver's results, or null.
function pickCatalogAlbum(albums, target) {
  let best = null;
  let bestScore = 0;
  for (const album of albums || []) {
    const score = albumMatchScore(target, album);
    if (score > bestScore) {
      best = album;
      bestScore = score;
    }
  }
  return best;
}

// Which resolvers to ask, in order: one named first (the service a release
// id came from), then the user's active services in their priority order,
// then every other installed resolver that supports album search. A plugin
// without the credentials it needs returns no albums, so asking it is cheap.
function orderCatalogResolvers(resolvers, { activeIds = [], order = [], preferId = null } = {}) {
  const rank = (r) => {
    if (preferId && r.id === preferId) return -1;
    const pos = order.indexOf(r.id);
    const slot = pos === -1 ? order.length : pos;
    return activeIds.includes(r.id) ? slot : 1000 + slot;
  };
  return [...(resolvers || [])].sort((a, b) => rank(a) - rank(b));
}

// A plugin album ({ name, artist, releaseDate, tracks: [{ title, duration
// (seconds), trackNumber, discNumber, ... }] }) in the release-page shape
// fetchReleaseData builds from MusicBrainz ({ title, artist: { name },
// tracks: [{ position, title, length (ms), mediumIndex }] }).
//
// requested: what the page asked for ({ id, title, artistName, albumArt,
// date, releaseType }). Its title and artist win over the catalog's, so the
// tracks get the same ids (trackSlug of artist, title, album) as when
// MusicBrainz answers, and the page header doesn't change under the user.
// Service-specific fields (ids, sources, stream urls) are dropped: the usual
// resolution pass finds each track on the user's own services.
function catalogAlbumToRelease(album, { resolverId, resolverName, requested = {} } = {}) {
  const sorted = [...(album.tracks || [])].sort((a, b) => {
    const da = a.discNumber || 1;
    const db = b.discNumber || 1;
    return da !== db ? da - db : (a.trackNumber || 0) - (b.trackNumber || 0);
  });
  const perDisc = {};
  const tracks = sorted.filter(t => t && t.title).map((t) => {
    const disc = t.discNumber || 1;
    perDisc[disc] = (perDisc[disc] || 0) + 1;
    return {
      position: t.trackNumber || perDisc[disc],
      title: t.title,
      length: Number.isFinite(t.duration) && t.duration > 0 ? Math.round(t.duration * 1000) : null,
      mediumIndex: disc,
      mediumTitle: null,
      recording: null,
      mbid: null,
      artistMbids: [],
    };
  });
  const releaseDate = typeof album.releaseDate === 'string' ? album.releaseDate.slice(0, 10) : null;
  return {
    id: requested.id || album.id,
    title: requested.title || album.name,
    artist: { id: null, name: requested.artistName || album.artist || 'Unknown Artist' },
    date: requested.date || releaseDate,
    releaseType: requested.releaseType || 'album',
    albumArt: requested.albumArt || album.albumArt || null,
    tracks,
    _catalogSource: { resolverId, name: resolverName || resolverId },
  };
}

// A catalog album as a search-result row (the MusicBrainz release-group
// shape the search page renders), carrying where it came from so a click
// loads it from that resolver without searching again.
function catalogAlbumToSearchResult(album, resolverId) {
  return {
    id: album.id,
    title: album.name,
    'primary-type': 'Album',
    'artist-credit': [{ name: album.artist || 'Unknown' }],
    albumArt: album.albumArt || null,
    'first-release-date': album.releaseDate || '',
    _source: resolverId,
    _catalog: { resolverId, url: album.url },
  };
}

module.exports = {
  isMusicBrainzId,
  resolverIdFromReleaseId,
  normalizeAlbumTitle,
  normalizeArtistName,
  albumMatchScore,
  pickCatalogAlbum,
  orderCatalogResolvers,
  catalogAlbumToRelease,
  catalogAlbumToSearchResult,
};
