// Search results from the user's own services, shown alongside MusicBrainz.
//
// Every MusicBrainz request waits its turn in the 1 req/s queue, so Search's
// three MusicBrainz queries land one to several seconds apart. The services
// the user has enabled answer in a few hundred milliseconds, so Search asks
// them at the same time and shows what they return first:
//
//   - tracks: every active resolver that declares capabilities.search
//   - albums: every active resolver that declares capabilities.albumSearch
//   - artists: the artists named by those track and album results that match
//     the query (no plugin capability searches artists)
//
// Resolvers are asked in the user's priority order (the order they rank
// sources in Settings), and that order decides which row a duplicate joins:
// the same track from two services is one row, carrying both sources. A
// MusicBrainz row is the canonical one: a service result that matches it
// (artist and title, by the confidence scorer) adds its source to that row
// rather than becoming a row of its own. Rows that only a service found stay.
//
// Pure: the host passes the resolvers, the results and the scorer.

const { orderCatalogResolvers, catalogAlbumToSearchResult, normalizeAlbumTitle, normalizeArtistName } = require('./album-catalog');
const { trackSlug, slug } = require('./track-slug');

// Results past this position in a service's list aren't shown. The rank, and
// the service's place in the user's priority order, become the row's
// relevance score (MusicBrainz gives each result one): a service's top hit
// scores 100, less 5 per place down its list and 5 per service ahead of it.
const CATALOG_RESULTS_PER_RESOLVER = 15;
const rankScore = (rank, priority = 0) => Math.max(0, 100 - 5 * rank - 5 * priority);

// The active resolvers that can run `fn` for `capability`, in priority order.
function searchResolversFor(resolvers, { activeIds = [], order = [], capability, fn }) {
  const usable = (resolvers || []).filter(r => r
    && activeIds.includes(r.id)
    && r.capabilities && r.capabilities[capability]
    && typeof r[fn] === 'function');
  return orderCatalogResolvers(usable, { activeIds, order });
}

// A resolver's search hit as a Search track row. The hit is its own source,
// at confidence 1: the row is that result, nothing was matched to it.
function catalogTrackToSearchResult(track, resolverId, rank, priority = 0) {
  const { sources: _ignored, ...record } = track;
  return {
    id: trackSlug(track.artist, track.title, track.album),
    title: track.title,
    artist: track.artist || 'Unknown',
    album: track.album || '',
    duration: track.duration || 0,
    albumArt: track.albumArt || null,
    ...(track.isrc ? { isrc: track.isrc } : {}),
    sources: { [resolverId]: { ...record, confidence: 1 } },
    score: rankScore(rank, priority),
    _source: resolverId,
  };
}

// Two rows are the same track when their artist and title are the same after
// normalization. Not the confidence scorer's containment test: that one
// would fold "Creep (Acoustic)" into "Creep", and Search should list both.
const trackKey = (track, normalize) => {
  const artist = normalize(track.artist);
  const title = normalize(track.title);
  return artist && title ? `${artist}|${title}` : null;
};

// A MusicBrainz row is one recording on one release, and MusicBrainz often
// returns several recordings of a song (studio, live, compilations). A hit
// joins a MusicBrainz row only when the album matches too (edition suffixes
// aside), or when either side names no album: otherwise the studio version a
// service found would hide inside a live recording's row.
const albumOf = (track) => normalizeAlbumTitle(track.album || '');

// Each further service that returns the same track raises its row's score:
// agreement between services is the best sign a row is the track the user
// means, not one of the covers and edits titled after it.
const AGREEMENT_BONUS = 5;

// Track rows: `baseRows` (MusicBrainz and local files) are kept as they are;
// each service list, in priority order, adds its hits. A hit that is the same
// track as a base row adds its source to that row, except a local file's row,
// which it only duplicates; a hit that is the same track as an earlier
// service row joins that row; any other hit is a new row. A source joins at
// the confidence the scorer gives it against the row, and only at or above
// the floor (validate, then sort: the playback pipeline's rule).
function mergeTrackResults(baseRows, catalogLists, { calculateConfidence, threshold, normalize }) {
  const rows = [];
  const localByKey = new Map();
  const baseByKey = new Map(); // key -> MusicBrainz rows, in order
  const catalogByKey = new Map();
  for (const base of baseRows || []) {
    const key = trackKey(base, normalize);
    if (base.isLocal) {
      rows.push(base);
      if (key && !localByKey.has(key)) localByKey.set(key, base);
      continue;
    }
    const row = { ...base, sources: { ...(base.sources || {}) } };
    rows.push(row);
    if (key) baseByKey.set(key, [...(baseByKey.get(key) || []), row]);
  }
  const baseMatch = (key, hit) => {
    const album = albumOf(hit);
    return (baseByKey.get(key) || []).find(row => !album || !albumOf(row) || albumOf(row) === album) || null;
  };
  for (const list of catalogLists || []) {
    for (const hit of list || []) {
      const key = trackKey(hit, normalize);
      if (key && localByKey.has(key)) continue;
      const match = key ? (baseMatch(key, hit) || catalogByKey.get(key)) : null;
      if (!match) {
        const row = { ...hit, sources: { ...hit.sources } };
        rows.push(row);
        if (key) catalogByKey.set(key, row);
        continue;
      }
      let joined = false;
      for (const [resolverId, source] of Object.entries(hit.sources || {})) {
        if (match.sources[resolverId]) continue;
        // Scored without the hit's own confidence: its 1 says "this row is
        // this hit", which is no longer true once it joins another row.
        const { confidence: _own, ...candidate } = source;
        const confidence = calculateConfidence(match, candidate);
        if (confidence >= threshold) {
          match.sources[resolverId] = { ...source, confidence };
          joined = true;
        }
      }
      if (joined) {
        match.score = Math.max(match.score ?? 50, hit.score ?? 50) + AGREEMENT_BONUS;
      }
    }
  }
  return rows;
}

// Drop service rows that a local file's row now duplicates (local results can
// arrive after the services' do).
function withoutLocalDuplicates(rows, localRows, { normalize }) {
  if (!localRows || localRows.length === 0) return rows;
  const localKeys = new Set(localRows.map(t => trackKey(t, normalize)).filter(Boolean));
  return rows.filter(row => !row._source || !localKeys.has(trackKey(row, normalize)));
}

const albumKey = (album) => {
  const artist = normalizeArtistName(album['artist-credit']?.[0]?.name || album.artist || '');
  const title = normalizeAlbumTitle(album.title || '');
  return artist && title ? `${artist}|${title}` : null;
};

// Album rows: MusicBrainz's first, then each service's in priority order,
// minus albums an earlier row already names (artist and title, edition
// suffixes aside).
function mergeAlbumResults(mbAlbums, catalogLists) {
  const seen = new Set();
  const rows = [];
  const add = (album, keepUnkeyed) => {
    const key = albumKey(album);
    if (key && seen.has(key)) return;
    if (!key && !keepUnkeyed) return;
    if (key) seen.add(key);
    rows.push(album);
  };
  for (const album of mbAlbums || []) add(album, true);
  for (const list of catalogLists || []) {
    for (const album of list || []) add(album, false);
  }
  return rows;
}

// A service's albums as Search album rows, ranked by position and by the
// service's place in the priority order.
function catalogAlbumsToSearchResults(albums, resolverId, priority = 0) {
  return (albums || []).slice(0, CATALOG_RESULTS_PER_RESOLVER).map((album, rank) => ({
    ...catalogAlbumToSearchResult(album, resolverId),
    score: rankScore(rank, priority),
  }));
}

// A service's tracks as Search track rows, ranked by position and by the
// service's place in the priority order.
function catalogTracksToSearchResults(tracks, resolverId, priority = 0) {
  return (tracks || [])
    .filter(t => t && t.title)
    .slice(0, CATALOG_RESULTS_PER_RESOLVER)
    .map((track, rank) => catalogTrackToSearchResult(track, resolverId, rank, priority));
}

// Fuse key for ranking track rows: the query against "artist title", so
// "portishead roads" finds Portishead's "Roads" rather than only the covers
// and edits whose title is "Portishead - Roads".
const TRACK_RANK_KEY = { name: 'artistTitle', getFn: (t) => `${t.artist || ''} ${t.title || ''}` };

// Artists named by service results whose name matches the query (one
// contains the other, after normalization), in the order the results name
// them, minus artists MusicBrainz already returned.
function catalogArtistsFromResults({ query, trackLists = [], albumLists = [], mbArtists = [] }) {
  const q = normalizeArtistName(query || '');
  if (!q) return [];
  const seen = new Set((mbArtists || []).map(a => normalizeArtistName(a.name || '')).filter(Boolean));
  const artists = [];
  const consider = (name, resolverId) => {
    const key = normalizeArtistName(name || '');
    if (!key || seen.has(key)) return;
    if (!key.includes(q) && !q.includes(key)) return;
    seen.add(key);
    artists.push({
      id: `${resolverId}-artist-${slug(name)}`,
      name,
      score: rankScore(artists.length),
      _source: resolverId,
    });
  };
  for (const list of trackLists) for (const t of list || []) consider(t.artist, t._source);
  for (const list of albumLists) for (const a of list || []) consider(a['artist-credit']?.[0]?.name, a._source);
  return artists;
}

module.exports = {
  CATALOG_RESULTS_PER_RESOLVER,
  TRACK_RANK_KEY,
  searchResolversFor,
  catalogTrackToSearchResult,
  catalogTracksToSearchResults,
  catalogAlbumsToSearchResults,
  catalogArtistsFromResults,
  mergeTrackResults,
  mergeAlbumResults,
  withoutLocalDuplicates,
};
