// src/renderer/lib/local-albums.js: the Collection with local files merged in
// (#1532). Local albums and saved albums are one list, local songs and saved
// songs are one list, and each merged entry carries every source it has.
//
// Local files live only in the Local Files library (useLocalFiles'
// `library`), never in collectionData. The Collection derives from it here on
// every library change, in component-scope useMemos, so a rescan or a removed
// folder updates the Songs and Albums tabs by themselves and nothing local is
// persisted as a collection row.
//
// What counts as the same song: the library-sync matching rules
// (sync-engine/track-identity.js): the same artist and title compared through
// normalizeStr (case, accents, spaces and punctuation drop out), and
// compatible albums (the same album without a store's " - Single" / " - EP"
// suffix, or a placeholder album on either side). A saved song with a
// matching file becomes one row: the saved record, plus the file's Local
// Files source.
//
// What counts as the same album: the same album artist (else the track
// artist) and the same title, compared the same way (normalizeStr, store
// suffix dropped), so "X" and "X - EP" by one artist are one album. The card
// keeps the saved record when there is one; its tracks are the union of the
// saved songs and the files, merged per song as above.
//
// What counts as the same artist: the same name through normalizeStr. A
// file's artist is its album artist, else its track artist ("Various
// Artists" and "Unknown Artist" are skipped for the next one); the id is
// generateArtistId, as for saved artists.
//
// Showing is not saving. An album, artist or song that is on a tab only
// because of local files is never written into collectionData, so it is
// never followed, starred, hearted or loved, and no library push or love
// push (they read collectionData only) ever sends it. Only the user's own
// follow, heart or save makes it saved; undoing that leaves it listed,
// unsaved.
//
// Albums with no title, or a placeholder one ("Unknown Album", "Single", a
// service's name: isPlaceholderAlbum plus the unknown family), stay off the
// Albums tab; their tracks still list on Songs.
//
// Removing a local album only hides it: its album key goes into a small
// persisted list (`collection_hidden_local_albums`), the files and the
// library are untouched, and nothing is tombstoned or unsaved on a service.
// Adding the album to the Collection later clears the hide.
//
// Pure; loads under plain Node.

'use strict';

const { generateAlbumId, generateArtistId } = require('../../../sync-engine/collection-id');
const {
  isPlaceholderAlbum, hasPlaceholderAlbum, albumKey, nameOf, nameKey,
} = require('../../../sync-engine/track-identity');

// Placeholders a tagger or player writes for a file with no album tag,
// folded the way the match gate folds names (case, accents, spaces and
// punctuation drop out), so "[Unknown Album]" and "unknown_album" are caught
// too. "Untitled" and "None" stay: both are real album titles.
const PLACEHOLDER_TITLES = new Set(['Unknown Album', 'Unknown', 'No Album'].map(nameOf));

const isJunkAlbumTitle = (album, sources) => {
  if (typeof album !== 'string' || !album.trim()) return true;
  if (isPlaceholderAlbum(album, sources)) return true;
  return PLACEHOLDER_TITLES.has(nameOf(album));
};

// An album's identity: "<artist>:<title>", both folded (letters and digits
// only, so the separator can't occur inside), the title without a store
// suffix. Null when either side folds to nothing.
const albumIdentity = (artist, title) => {
  const a = nameOf(artist);
  const t = albumKey(title);
  return a && t ? `${a}:${t}` : null;
};

const albumArtistOf = (track) => {
  const albumArtist = typeof track.albumArtist === 'string' ? track.albumArtist.trim() : '';
  if (albumArtist) return albumArtist;
  return typeof track.artist === 'string' ? track.artist.trim() : '';
};

// Artist names that stand for no one in particular: a compilation's album
// artist, or what the scanner writes for a file with no artist tag.
const PLACEHOLDER_ARTISTS = new Set(['Various Artists', 'Various', 'Unknown Artist', 'Unknown'].map(nameOf));
const isJunkArtistName = (name) => typeof name !== 'string' || !nameOf(name) || PLACEHOLDER_ARTISTS.has(nameOf(name));

// The artist a file is listed under on the Artists tab: its album artist,
// else its track artist; null when neither names anyone.
const trackArtistNameOf = (track) => {
  if (!track) return null;
  for (const name of [track.albumArtist, track.artist]) {
    if (typeof name === 'string' && !isJunkArtistName(name)) return name.trim();
  }
  return null;
};

// Per-object memo: the library is re-published in batches by the art passes
// (new arrays, mostly the same row objects), so folding every name again on
// each publish would cost a 150k-track library a pass of NFKD per batch.
const trackAlbumKeys = new WeakMap();
const trackNameKeys = new WeakMap();
const memo = (cache, obj, fn) => {
  if (!obj || typeof obj !== 'object') return fn(obj);
  if (cache.has(obj)) return cache.get(obj);
  const v = fn(obj);
  cache.set(obj, v);
  return v;
};

// The album a track belongs to, or null when its album is missing or a
// placeholder.
const trackAlbumKeyOf = (track) => memo(trackAlbumKeys, track, (t) => {
  if (!t || isJunkAlbumTitle(t.album, t.sources)) return null;
  return albumIdentity(albumArtistOf(t), t.album);
});

const songKeyOf = (track) => memo(trackNameKeys, track, (t) => (t ? nameKey(t) : null));

const byDiscAndTrack = (a, b) =>
  ((a.discNumber || 1) - (b.discNumber || 1)) || ((a.trackNumber || 0) - (b.trackNumber || 0));

/**
 * The Songs tab's rows before filter and sort: every saved track, and every
 * library track that isn't one of them. A saved track with a matching file
 * (same song, compatible albums: see the header) is one row, the saved record
 * with the file's sources added, so it plays from the file or any service and
 * its heart stays the saved one. A library track matches at most one saved
 * track; an exact album match is preferred over a placeholder one. Unmatched
 * rows are the same objects (the MBID enrichment mutates library rows in
 * place, and a copy would keep serving the old fields).
 */
function mergeCollectionSongs(library, savedTracks) {
  const lib = Array.isArray(library) ? library : [];
  const saved = Array.isArray(savedTracks) ? savedTracks : [];
  if (lib.length === 0 || saved.length === 0) return [...lib, ...saved];
  const byName = new Map();
  for (const t of lib) {
    const k = songKeyOf(t);
    if (!k) continue;
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(t);
  }
  const used = new Set();
  const rows = [];
  for (const s of saved) {
    const k = songKeyOf(s);
    const candidates = k ? (byName.get(k) || []).filter(t => !used.has(t)) : [];
    let match = null;
    if (candidates.length > 0) {
      const ka = albumKey(s && s.album);
      match = (ka && candidates.find(t => albumKey(t.album) === ka))
        || (hasPlaceholderAlbum(s) ? candidates[0] : null)
        || candidates.find(t => hasPlaceholderAlbum(t))
        || null;
    }
    if (!match) { rows.push(s); continue; }
    used.add(match);
    // The file's path rides along (from the row, else its local source), so
    // the row's menu offers Show in Finder like a local-only row's; its id
    // and everything else stay the saved record's.
    const localSource = Object.values(match.sources || {}).find(src => src && src.filePath) || null;
    rows.push({
      ...s,
      filePath: match.filePath || (localSource && localSource.filePath) || s.filePath,
      sources: { ...(s.sources || {}), ...(match.sources || {}) },
      albumArt: s.albumArt || match.albumArt || null,
      duration: s.duration || match.duration,
    });
  }
  const out = lib.filter(t => !used.has(t));
  for (const r of rows) out.push(r);
  return out;
}

/**
 * The library's albums, shaped like collection albums:
 *   { id, key, title, artist, year, art, trackCount, addedAt, isLocal: true,
 *     localTracks }
 * `key` is the album identity (see the header); `id` is generateAlbumId of
 * the first track's album artist and title, the formula saved albums use.
 * `localTracks` are the library rows themselves, in disc and track order.
 * `art` is the first cover the Local Files art passes found for any of its
 * tracks, or null (the card then asks getAlbumArt). `addedAt` is when the
 * earliest track was indexed.
 */
function deriveLocalAlbums(library) {
  if (!Array.isArray(library) || library.length === 0) return [];
  const groups = new Map();
  for (const track of library) {
    const key = trackAlbumKeyOf(track);
    if (!key) continue;
    let group = groups.get(key);
    if (!group) {
      const artist = albumArtistOf(track) || 'Unknown Artist';
      const title = track.album.trim();
      group = {
        id: generateAlbumId(artist, title),
        key,
        title,
        artist,
        year: null,
        art: null,
        addedAt: null,
        isLocal: true,
        localTracks: [],
      };
      groups.set(key, group);
    }
    group.localTracks.push(track);
    if (!group.year && track.year) group.year = track.year;
    if (!group.art && track.albumArt) group.art = track.albumArt;
    if (Number.isFinite(track.indexedAt) && (group.addedAt == null || track.indexedAt < group.addedAt)) {
      group.addedAt = track.indexedAt;
    }
  }
  const albums = [];
  for (const group of groups.values()) {
    group.localTracks.sort(byDiscAndTrack);
    group.trackCount = group.localTracks.length;
    albums.push(group);
  }
  return albums;
}

// A store's own suffix on an album title (Apple Music's "X - Single" /
// "X - EP"), the part albumKey drops.
const STORE_SUFFIX = /\s+-\s+(single|ep)\s*$/i;

// The copy a merged card shows when several saved copies are one album: the
// one without a store suffix, else the earliest saved; ties keep list order.
const pickCardCopy = (copies) => {
  const rank = (a) => [STORE_SUFFIX.test(a.title || '') ? 1 : 0, Number.isFinite(a.addedAt) ? a.addedAt : Infinity];
  let best = copies[0];
  for (const c of copies.slice(1)) {
    const [bs, bt] = rank(best);
    const [cs, ct] = rank(c);
    if (cs < bs || (cs === bs && ct < bt)) best = c;
  }
  return best;
};

/**
 * The Albums tab's list: one card per album. Saved copies of one album (the
 * same identity: "X" and "X - EP" by one artist) are one card, and a local
 * album that is also saved joins it; each local album that isn't saved or
 * hidden is a card of its own. Display only: the saved records are never
 * changed.
 *
 * A merged card is the record of the copy pickCardCopy chooses (its id,
 * title, track count and addedAt), with `savedIds` (every saved copy it
 * stands for; removing the card removes them all), a cover and year from the
 * first copy that has one, else the files. `songs` (mergeCollectionSongs'
 * rows) give a merged card its `tracks`: the union of the copies' saved
 * songs and the files, one row per song with every source, in disc and
 * track order. `hiddenKeys` hides local albums only: a saved album always
 * shows.
 */
function mergeCollectionAlbums(savedAlbums, localAlbums, hiddenKeys, songs) {
  const saved = Array.isArray(savedAlbums) ? savedAlbums : [];
  const local = Array.isArray(localAlbums) ? localAlbums : [];
  const hidden = hiddenKeys instanceof Set ? hiddenKeys : new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
  const localByKey = new Map(local.map(a => [a.key, a]));

  // Saved copies by album identity, in list order of each album's first copy.
  const groups = new Map();
  const order = [];
  for (const album of saved) {
    const key = album ? albumIdentity(album.artist, album.title) : null;
    if (!key) { order.push({ single: album }); continue; }
    if (!groups.has(key)) { groups.set(key, []); order.push({ key }); }
    groups.get(key).push(album);
  }
  const merges = (key) => (groups.get(key) || []).length > 1 || localByKey.has(key);
  if (local.length === 0 && ![...groups.keys()].some(merges)) return saved;

  const tracksByKey = new Map();
  for (const t of Array.isArray(songs) ? songs : []) {
    const k = trackAlbumKeyOf(t);
    if (!k || !(localByKey.has(k) || (groups.get(k) || []).length > 1)) continue;
    if (!tracksByKey.has(k)) tracksByKey.set(k, []);
    tracksByKey.get(k).push(t);
  }
  for (const list of tracksByKey.values()) list.sort(byDiscAndTrack);

  const out = [];
  for (const entry of order) {
    if (entry.single) { out.push(entry.single); continue; }
    const { key } = entry;
    const copies = groups.get(key);
    const match = localByKey.get(key) || null;
    if (copies.length === 1 && !match) { out.push(copies[0]); continue; }
    const card = pickCardCopy(copies);
    out.push({
      ...card,
      art: card.art || (copies.find(c => c.art) || {}).art || (match && match.art) || null,
      year: card.year || (copies.find(c => c.year) || {}).year || (match && match.year) || null,
      savedIds: copies.map(c => c.id),
      tracks: tracksByKey.get(key) || (match ? match.localTracks : undefined),
    });
  }
  for (const album of local) {
    if (groups.has(album.key) || hidden.has(album.key)) continue;
    out.push({ ...album, tracks: tracksByKey.get(album.key) || album.localTracks });
  }
  return out;
}

/**
 * The ids of the saved albums "Remove from Collection" (or un-hearting)
 * removes for `album`: the copy it names (its id, its `savedIds`, or
 * generateAlbumId of its artist and title) and every other saved copy of the
 * same album (the same identity), since the Albums tab shows them as one
 * card.
 */
function savedAlbumIdsFor(album, savedAlbums) {
  const a = album || {};
  const saved = Array.isArray(savedAlbums) ? savedAlbums : [];
  const generated = generateAlbumId(a.artist, a.title);
  const key = albumIdentity(a.artist, a.title);
  const named = new Set([a.id, generated, ...(Array.isArray(a.savedIds) ? a.savedIds : [])].filter(Boolean));
  return saved
    .filter(s => s && (named.has(s.id) || (key && albumIdentity(s.artist, s.title) === key)))
    .map(s => s.id);
}

/**
 * The library's artists, shaped like collection artists:
 *   { id, key, name, image: null, trackCount, addedAt, isLocal: true }
 * `key` is the folded name; `id` is generateArtistId, the formula saved
 * artists use.
 */
function deriveLocalArtists(library) {
  if (!Array.isArray(library) || library.length === 0) return [];
  const groups = new Map();
  for (const track of library) {
    const name = trackArtistNameOf(track);
    if (!name) continue;
    const key = nameOf(name);
    let group = groups.get(key);
    if (!group) {
      group = { id: generateArtistId(name), key, name, image: null, trackCount: 0, addedAt: null, isLocal: true };
      groups.set(key, group);
    }
    group.trackCount++;
    if (Number.isFinite(track.indexedAt) && (group.addedAt == null || track.indexedAt < group.addedAt)) {
      group.addedAt = track.indexedAt;
    }
  }
  return [...groups.values()];
}

/**
 * The Artists tab's list: every saved artist, then each local artist who
 * isn't saved (same id, or the same folded name). A saved artist keeps their
 * own record; a track count they lack comes from the files. A local-only
 * artist stays `isLocal` and is never in collectionData.artists, so they show
 * unfollowed (the star and the menus read collectionData.artists).
 */
function mergeCollectionArtists(savedArtists, localArtists) {
  const saved = Array.isArray(savedArtists) ? savedArtists : [];
  const local = Array.isArray(localArtists) ? localArtists : [];
  if (local.length === 0) return saved;
  const localByKey = new Map(local.map(a => [a.key, a]));
  const localById = new Map(local.map(a => [a.id, a]));
  const taken = new Set();
  const out = saved.map(artist => {
    const match = artist && ((artist.id && localById.get(artist.id)) || localByKey.get(nameOf(artist.name)));
    if (!match) return artist;
    taken.add(match);
    return artist.trackCount == null ? { ...artist, trackCount: match.trackCount } : artist;
  });
  for (const artist of local) if (!taken.has(artist)) out.push(artist);
  return out;
}

// The hidden list with `key` added, or the same list when it is already there.
function hideLocalAlbum(hiddenKeys, key) {
  const list = Array.isArray(hiddenKeys) ? hiddenKeys : [];
  if (!key || list.includes(key)) return list;
  return [...list, key];
}

// The hidden list without `key`, or the same list when it wasn't there.
function unhideLocalAlbum(hiddenKeys, key) {
  const list = Array.isArray(hiddenKeys) ? hiddenKeys : [];
  if (!key || !list.includes(key)) return list;
  return list.filter(x => x !== key);
}

/**
 * What "Remove from Collection" does to an album:
 *   { hideKey, unsave }
 * `hideKey` is the local album to hide (null when the album isn't in the
 * local library); `unsave` says whether a saved record has to go through the
 * normal removal (collection write, service unsave). A local-only album is
 * hidden and nothing else: no collection write, no tombstone, no service
 * call. A saved album that is also local is both unsaved and hidden, or it
 * would come straight back as a local album.
 */
function planAlbumRemoval(album, localKeys, savedAlbums) {
  const a = album || {};
  const keys = localKeys instanceof Set ? localKeys : new Set(localKeys || []);
  const key = albumIdentity(a.artist, a.title);
  const hideKey = key && keys.has(key) ? key : null;
  const isSaved = savedAlbumIdsFor(a, savedAlbums).length > 0;
  return { hideKey, unsave: isSaved || !hideKey };
}

module.exports = {
  savedAlbumIdsFor,
  pickCardCopy,
  trackArtistNameOf,
  deriveLocalArtists,
  mergeCollectionArtists,
  albumIdentity,
  trackAlbumKeyOf,
  isJunkAlbumTitle,
  mergeCollectionSongs,
  deriveLocalAlbums,
  mergeCollectionAlbums,
  hideLocalAlbum,
  unhideLocalAlbum,
  planAlbumRemoval,
};
