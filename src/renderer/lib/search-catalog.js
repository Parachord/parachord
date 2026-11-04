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
    // A service's own popularity (Spotify's 0-100), when it sends one
    ...(typeof track.popularity === 'number' && Number.isFinite(track.popularity) ? { _popularity: track.popularity } : {}),
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
    const row = { ...base, sources: { ...(base.sources || {}) }, _aliases: [base.id] };
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
        const row = { ...hit, sources: { ...hit.sources }, _aliases: [hit.id] };
        rows.push(row);
        if (key) catalogByKey.set(key, row);
        continue;
      }
      // The row now stands for the hit too: if the hit's own row was on
      // screen, stabilizeRows keeps this one in its place (no remount).
      if (!match._aliases.includes(hit.id)) match._aliases.push(hit.id);
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
// A dropped service album still lends its cover: the row it duplicates keeps
// it as `_serviceArt`, the fallback serviceArtFor returns.
function mergeAlbumResults(mbAlbums, catalogLists) {
  const byKey = new Map();
  const rows = [];
  const add = (album, keepUnkeyed) => {
    const key = albumKey(album);
    const existing = key ? byKey.get(key) : null;
    if (existing) {
      if (!existing.albumArt && !existing._serviceArt && album.albumArt) existing._serviceArt = album.albumArt;
      if (!existing._aliases.includes(album.id)) existing._aliases.push(album.id);
      return;
    }
    if (!key && !keepUnkeyed) return;
    const row = { ...album, _aliases: [album.id] };
    if (key) byKey.set(key, row);
    rows.push(row);
  };
  for (const album of mbAlbums || []) add(album, true);
  for (const list of catalogLists || []) {
    for (const album of list || []) add(album, false);
  }
  return rows;
}

// The cover a service already returned for this row: an album row's
// `_serviceArt` (from a service album it absorbed), or the first of a track
// row's sources that carries one (sources join in priority order). Search
// shows it when the album-art pipeline is slow or finds nothing; it is the
// image the pipeline's resolver step would find, without searching again.
// skip: URLs known not to load (a Set), passed over.
function serviceArtFor(row, skip) {
  if (!row) return null;
  const usable = (u) => typeof u === 'string' && u && !(skip && skip.has(u));
  if (usable(row._serviceArt)) return row._serviceArt;
  for (const source of Object.values(row.sources || {})) {
    if (source && usable(source.albumArt)) return source.albumArt;
  }
  return null;
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

// Fuse key for ranking album rows, the same idea as TRACK_RANK_KEY: the
// query against "artist title". Titles alone ranked a search for an artist
// by which albums have the artist's name in the title, which is mostly covers
// ("Into Dust (Mazzy Star Cover)"), while the artist's own albums
// ("Among My Swan") scored nothing.
const albumArtistName = (album) => (((album && album['artist-credit']) || [])[0] || {}).name || '';
const ALBUM_RANK_KEY = { name: 'artistTitle', getFn: (a) => `${albumArtistName(a)} ${a.title || ''}` };

// Lowercased, accent-free, punctuation as spaces, padded for whole-word tests.
const asWords = (s) => ` ${String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  .replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

// Does the query name this artist, as whole words? "mazzy star" and
// "mazzy star among my swan" name Mazzy Star; "airplane" doesn't name Air.
// A leading "The" is optional on either side.
function queryNamesArtist(query, artistName) {
  const artist = asWords(artistName).trim();
  if (!artist) return false;
  const q = asWords(query).replace(/^ the /, ' ');
  const bare = artist.replace(/^the /, '');
  return !!bare && q.includes(` ${bare} `);
}

// Popularity, 0-100, when a source has it: ListenBrainz listen counts for
// MusicBrainz rows (no account needed; log scale, `reference` listens = 100)
// and Spotify's own popularity for its track rows, for users with Spotify.
// Albums use the release group's listens (POPULARITY_REFERENCE_LISTENS, 1M:
// Portishead's Dummy, ~610k, is ~96). Tracks use their artist's total
// (ARTIST_POPULARITY_REFERENCE_LISTENS, 10M: Mazzy Star, ~4.2M, ~95; a
// covering artist with ~18k, ~61): ListenBrainz splits a song's plays across
// duplicate recordings, so the recording MusicBrainz's search returns for an
// original often has no count at all while a cover's does. It degrades gracefully: in rankSearchRows a row without popularity
// counts as the median of the rows in its list that have one, so having or
// lacking the signal is neutral, and a list where nothing has it ranks
// exactly as it would without popularity.
const POPULARITY_REFERENCE_LISTENS = 1000000;
const ARTIST_POPULARITY_REFERENCE_LISTENS = 10000000;
function popularityFromListens(listens, reference = POPULARITY_REFERENCE_LISTENS) {
  if (typeof listens !== 'number' || !Number.isFinite(listens) || listens < 0) return null;
  return Math.min(100, (100 * Math.log10(1 + listens)) / Math.log10(1 + reference));
}

// Does the query name this row: its artist (queryNamesArtist), or its title
// exactly (edition suffixes aside, normalizeAlbumTitle)? The title half keeps
// a title search fair: for "Abbey Road", a tribute band named Abbey Road must
// not outrank the Beatles' Abbey Road just because the query names the band.
function queryNamesRow(query, artistName, title) {
  if (queryNamesArtist(query, artistName)) return true;
  const t = normalizeAlbumTitle(title || '');
  return !!t && t === normalizeAlbumTitle(query || '');
}

// A row the query names (its artist, or its exact title) ranks above rows that
// only mention it (covers and tributes with the artist's name in the title). Large enough to lift a perfect artist
// match over a cover whose title contains the name; small next to the 60
// points fuzzy relevance is worth, so an unrelated artist still can't win.
const ARTIST_NAMED_BONUS = 20;

// How far a row must outrank a row shown ahead of it to move past it once rows
// hold still (stabilizeRows' promote). On the 0-120 ranking scale; smaller
// gaps are noise between sources, and moving on them is the reshuffling rows
// hold still to avoid.
const PROMOTE_MARGIN = 5;

// Search's ranking (reRankResults in app.js). Each row scores 60% fuzzy
// relevance of the query against `key` plus 40% its standing: its source's
// own score (MusicBrainz's search score, or a service row's rankScore by
// position), averaged with its popularity (_popularity, or the list's median
// when it has none, see above), plus
// ARTIST_NAMED_BONUS when the query names the row (queryNamesRow, given
// `artistOf`; `titleOf` defaults to the row's title).
// Fuse is passed in: the renderer loads it from vendor/fuse.min.js.
function rankSearchRows(items, query, { Fuse, key, artistOf = null, titleOf = (r) => r.title } = {}) {
  if (!items || items.length === 0 || !query || !Fuse) return items;
  const fuse = new Fuse(items, { keys: [key], includeScore: true, threshold: 0.6, ignoreLocation: true, useExtendedSearch: false });
  const fuzzy = new Map();
  for (const r of fuse.search(query)) fuzzy.set(r.item, (1 - r.score) * 100);
  const popularityOf = (item) => (typeof item._popularity === 'number' && Number.isFinite(item._popularity) ? item._popularity : null);
  const known = items.map(popularityOf).filter(p => p !== null).sort((a, b) => a - b);
  const median = known.length === 0 ? null
    : known.length % 2 ? known[(known.length - 1) / 2]
      : (known[known.length / 2 - 1] + known[known.length / 2]) / 2;
  return items
    .map((item) => {
      const relevance = fuzzy.get(item) || 0;
      const sourceScore = item.score || 50;
      const popularity = popularityOf(item) ?? median; // null: nothing in the list has one
      const standing = popularity === null ? sourceScore : (sourceScore + popularity) / 2;
      const bonus = artistOf && queryNamesRow(query, artistOf(item), titleOf(item)) ? ARTIST_NAMED_BONUS : 0;
      return { ...item, _finalScore: relevance * 0.6 + standing * 0.4 + bonus };
    })
    .sort((a, b) => b._finalScore - a._finalScore);
}

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

// Search re-publishes each category whenever another source answers, and a
// re-ranked list moved rows on screen: the card in each slot changed, and a
// service row absorbed by a MusicBrainz match came back as a new row (new id,
// new React key), so covers faded out and back in (2026-11-01). stabilizeRows
// keeps what is already on screen in place:
//   - a row that stands for a row shown before (any of identityKeys(row)
//     matches) keeps that row's display key, _rowKey, and its position;
//   - rows new to the list follow, in the order they were ranked.
// The row's real id still changes (a MusicBrainz match wins identity); only
// the display key and the order are held. previous is the last call's
// returned `shown`; returns { rows, shown }.
// tierOf(row), optional: a higher tier always comes first, and rows hold
// still within their tier. Search passes 1 for rows by the artist the query
// names, so when an artist's own albums arrive after a fast service's covers
// that mention the name, they move above them once (2026-11-02: "Mazzy Star"
// kept its covers on top until a second search).
// promote, optional { scoreOf, margin }: within a tier, a row moves above a
// row ahead of it whose score is lower by at least `margin`; smaller gaps hold
// still. Search passes the ranking score and PROMOTE_MARGIN, so a row that
// arrives later and clearly outranks what is shown (the original song, with
// its artist's popularity, after a fast service's covers) moves up once and
// then holds where it lands.
function stabilizeRows(rows, previous, identityKeys, tierOf = null, promote = null) {
  const owner = new Map();
  for (const p of previous || []) {
    for (const k of p.keys) if (!owner.has(k)) owner.set(k, p.rowKey);
  }
  const placed = new Map();
  const fresh = [];
  for (const row of rows || []) {
    const keys = identityKeys(row);
    const rowKey = keys.map(k => owner.get(k)).find(rk => rk && !placed.has(rk));
    if (rowKey) placed.set(rowKey, { ...row, _rowKey: rowKey });
    else fresh.push({ ...row, _rowKey: row.id });
  }
  const held = [
    ...(previous || []).map(p => placed.get(p.rowKey)).filter(Boolean),
    ...fresh,
  ];
  const tier = (r) => (tierOf ? tierOf(r) || 0 : 0);
  const tiers = [...new Set(held.map(tier))].sort((x, y) => y - x);
  const tiered = tiers.length > 1 ? tiers.flatMap(t => held.filter(r => tier(r) === t)) : held;
  let ordered = tiered;
  if (promote && typeof promote.scoreOf === 'function') {
    const score = (r) => promote.scoreOf(r) || 0;
    ordered = [];
    for (const row of tiered) {
      let i = ordered.length;
      while (i > 0 && tier(ordered[i - 1]) === tier(row) && score(row) - score(ordered[i - 1]) >= promote.margin) i -= 1;
      ordered.splice(i, 0, row);
    }
  }
  const shown = ordered.map(r => ({ rowKey: r._rowKey, keys: [...new Set([r._rowKey, ...identityKeys(r)])] }));
  return { rows: ordered, shown };
}

// Identity keys for stabilizeRows: the ids a track or album row stands for,
// and for an artist its normalized name (a service-named artist and the
// MusicBrainz artist that replaces it share it).
const rowIdentityKeys = (row) => (Array.isArray(row._aliases) && row._aliases.length ? row._aliases : [row.id]);
const artistIdentityKeys = (row) => [row.id, `name:${normalizeArtistName(row.name || '')}`];

// The user's own files, as Search rows. The local-files service already builds
// the source record under the resolver id (`sources.localfiles`); source
// selection only keeps sources keyed by an active resolver id, so replacing it
// here is what made these rows answer "No Enabled Source".
const LOCAL_SEARCH_RESULTS = 20;
function localSearchRows(results) {
  return (results || []).slice(0, LOCAL_SEARCH_RESULTS).map(track => ({ ...track, isLocal: true }));
}

module.exports = {
  localSearchRows,
  stabilizeRows,
  rowIdentityKeys,
  artistIdentityKeys,
  CATALOG_RESULTS_PER_RESOLVER,
  TRACK_RANK_KEY,
  ALBUM_RANK_KEY,
  albumArtistName,
  queryNamesArtist,
  queryNamesRow,
  ARTIST_NAMED_BONUS,
  rankSearchRows,
  popularityFromListens,
  POPULARITY_REFERENCE_LISTENS,
  ARTIST_POPULARITY_REFERENCE_LISTENS,
  PROMOTE_MARGIN,
  searchResolversFor,
  catalogTrackToSearchResult,
  catalogTracksToSearchResults,
  catalogAlbumsToSearchResults,
  catalogArtistsFromResults,
  mergeTrackResults,
  mergeAlbumResults,
  withoutLocalDuplicates,
  serviceArtFor,
};
