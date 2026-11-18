// src/renderer/lib/local-albums.js: the Collection's albums from local files
// (#1532).
//
// Albums from scanned files live only in the Local Files library
// (useLocalFiles' `library`), never in collectionData.albums. The Albums tab
// derives them here on every library change and merges them with the saved
// albums in a component-scope useMemo, so a rescan or a removed folder
// updates the tab by itself and nothing is persisted as an album.
//
//   - Grouped by album artist (else the track artist) and album title, with
//     the id from generateAlbumId: the formula saved albums use, so a local
//     album that is also saved has the same id and shows once.
//   - No album title, or a placeholder one ("Unknown Album", "Single", a
//     service's name: isPlaceholderAlbum plus the unknown/untitled family),
//     stays off the tab. Those tracks still list on Songs.
//   - Removing a local album only hides it: its id goes into a small
//     persisted list (`collection_hidden_local_albums`), the files and the
//     library are untouched, and nothing is tombstoned or unsaved on a
//     service. Adding the album to the Collection later clears the hide.
//
// Mobile lists scanned albums as Collection albums too (Parachord/
// parachord-mobile#706), and removing a scanned item there keeps the file.
//
// Pure; loads under plain Node.

'use strict';

const { generateAlbumId } = require('../../../sync-engine/collection-id');
const { isPlaceholderAlbum } = require('../../../sync-engine/track-identity');
const { normalizeStr } = require('../../../sync-providers/confidence-scoring');

// Placeholders a tagger or player writes for a file with no album tag,
// folded the way the match gate folds names (case, accents, spaces and
// punctuation drop out), so "[Unknown Album]" and "unknown_album" are caught
// too. "Untitled" and "None" stay: both are real album titles.
const PLACEHOLDER_TITLES = new Set([
  'Unknown Album', 'Unknown', 'No Album',
].map(normalizeStr));

const isJunkAlbumTitle = (album, sources) => {
  if (typeof album !== 'string' || !album.trim()) return true;
  if (isPlaceholderAlbum(album, sources)) return true;
  return PLACEHOLDER_TITLES.has(normalizeStr(album));
};

const albumArtistOf = (track) => {
  const albumArtist = typeof track.albumArtist === 'string' ? track.albumArtist.trim() : '';
  if (albumArtist) return albumArtist;
  return typeof track.artist === 'string' ? track.artist.trim() : '';
};

// The local album id a library track belongs to, or null when its album is
// missing or a placeholder.
const localAlbumIdOf = (track) => {
  if (!track || isJunkAlbumTitle(track.album, track.sources)) return null;
  return generateAlbumId(albumArtistOf(track), track.album.trim());
};

const byDiscAndTrack = (a, b) =>
  ((a.discNumber || 1) - (b.discNumber || 1)) || ((a.trackNumber || 0) - (b.trackNumber || 0));

/**
 * The library's albums, shaped like collection albums:
 *   { id, title, artist, year, art, trackCount, addedAt, isLocal: true,
 *     localTracks }
 * `localTracks` are the library rows themselves (same objects, disc and
 * track order), so playing one plays the file. `art` is the first cover the
 * Local Files art passes found for any of its tracks, or null (the card then
 * asks getAlbumArt). `addedAt` is when the earliest track was indexed.
 */
function deriveLocalAlbums(library) {
  if (!Array.isArray(library) || library.length === 0) return [];
  const groups = new Map();
  for (const track of library) {
    const id = localAlbumIdOf(track);
    if (!id) continue;
    let group = groups.get(id);
    if (!group) {
      group = {
        id,
        title: track.album.trim(),
        artist: albumArtistOf(track) || 'Unknown Artist',
        year: null,
        art: null,
        addedAt: null,
        isLocal: true,
        localTracks: [],
      };
      groups.set(id, group);
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
 * saved (same id) or hidden. A saved album that is also local keeps its own
 * record (title, art, year, track count, addedAt) and gains `localTracks`, so
 * it plays from the files; a cover it lacks comes from the files.
 * `hiddenIds` hides local albums only: a saved album always shows.
 */
function mergeCollectionAlbums(savedAlbums, localAlbums, hiddenIds) {
  const saved = Array.isArray(savedAlbums) ? savedAlbums : [];
  const local = Array.isArray(localAlbums) ? localAlbums : [];
  if (local.length === 0) return saved;
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(Array.isArray(hiddenIds) ? hiddenIds : []);
  const localById = new Map(local.map(a => [a.id, a]));
  const savedIds = new Set();
  const out = saved.map(album => {
    const id = album && (album.id || generateAlbumId(album.artist, album.title));
    savedIds.add(id);
    const match = localById.get(id);
    if (!match) return album;
    return { ...album, art: album.art || match.art || null, localTracks: match.localTracks };
  });
  for (const album of local) {
    if (savedIds.has(album.id) || hidden.has(album.id)) continue;
    out.push(album);
  }
  return out;
}

// The hidden list with `id` added, or the same list when it is already there.
function hideLocalAlbum(hiddenIds, id) {
  const list = Array.isArray(hiddenIds) ? hiddenIds : [];
  if (!id || list.includes(id)) return list;
  return [...list, id];
}

// The hidden list without `id`, or the same list when it wasn't there.
function unhideLocalAlbum(hiddenIds, id) {
  const list = Array.isArray(hiddenIds) ? hiddenIds : [];
  if (!id || !list.includes(id)) return list;
  return list.filter(x => x !== id);
}

/**
 * What "Remove from Collection" does to an album:
 *   { hideId, unsave }
 * `hideId` is the local album id to hide (null when the album isn't in the
 * local library); `unsave` says whether a saved record has to go through the
 * normal removal (collection write, service unsave). A local-only album is
 * hidden and nothing else: no collection write, no tombstone, no service
 * call. A saved album that is also local is both unsaved and hidden, or it
 * would come straight back as a local album.
 */
function planAlbumRemoval(album, localIds, savedAlbums) {
  const a = album || {};
  const ids = localIds instanceof Set ? localIds : new Set(localIds || []);
  const generated = generateAlbumId(a.artist, a.title);
  const hideId = [a.id, generated].find(id => id && ids.has(id)) || null;
  const saved = Array.isArray(savedAlbums) ? savedAlbums : [];
  const isSaved = saved.some(s => s && (s.id === generated || (a.id && s.id === a.id)));
  return { hideId, unsave: isSaved || !hideId };
}

module.exports = {
  planAlbumRemoval,
  isJunkAlbumTitle,
  localAlbumIdOf,
  deriveLocalAlbums,
  mergeCollectionAlbums,
  hideLocalAlbum,
  unhideLocalAlbum,
};
