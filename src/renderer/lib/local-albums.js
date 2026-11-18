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
    rows.push({
      ...s,
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

/**
 * The Albums tab's list: every saved album, then each local album that isn't
 * saved (same album identity) or hidden. A saved album that is also local
 * keeps its own record (id, title, art, year, track count, addedAt); a cover
 * it lacks comes from the files. `songs` (mergeCollectionSongs' rows) give
 * each merged or local album its `tracks`: the union of its saved songs and
 * its files, one row per song with every source, in disc and track order.
 * `hiddenKeys` hides local albums only: a saved album always shows.
 */
function mergeCollectionAlbums(savedAlbums, localAlbums, hiddenKeys, songs) {
  const saved = Array.isArray(savedAlbums) ? savedAlbums : [];
  const local = Array.isArray(localAlbums) ? localAlbums : [];
  if (local.length === 0) return saved;
  const hidden = hiddenKeys instanceof Set ? hiddenKeys : new Set(Array.isArray(hiddenKeys) ? hiddenKeys : []);
  const localByKey = new Map(local.map(a => [a.key, a]));
  const tracksByKey = new Map();
  for (const t of Array.isArray(songs) ? songs : []) {
    const k = trackAlbumKeyOf(t);
    if (!k || !localByKey.has(k)) continue;
    if (!tracksByKey.has(k)) tracksByKey.set(k, []);
    tracksByKey.get(k).push(t);
  }
  for (const list of tracksByKey.values()) list.sort(byDiscAndTrack);
  const savedKeys = new Set();
  const out = saved.map(album => {
    const key = album ? albumIdentity(album.artist, album.title) : null;
    const match = key ? localByKey.get(key) : null;
    if (!match) return album;
    savedKeys.add(key);
    return {
      ...album,
      art: album.art || match.art || null,
      tracks: tracksByKey.get(key) || match.localTracks,
    };
  });
  for (const album of local) {
    if (savedKeys.has(album.key) || hidden.has(album.key)) continue;
    out.push({ ...album, tracks: tracksByKey.get(album.key) || album.localTracks });
  }
  return out;
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
  const generated = generateAlbumId(a.artist, a.title);
  const saved = Array.isArray(savedAlbums) ? savedAlbums : [];
  const isSaved = saved.some(s => s && (s.id === generated || (a.id && s.id === a.id)));
  return { hideKey, unsave: isSaved || !hideKey };
}

module.exports = {
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
