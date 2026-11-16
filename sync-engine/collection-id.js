// sync-engine/collection-id.js — the collection's track, album and artist ids.
//
// One definition for every side that builds them: the renderer
// (src/renderer/lib/collection-ids.js re-exports these) and the sync
// providers (sync-providers/spotify.js, sync-providers/applemusic.js). They
// used to be three hand-kept copies that had to stay byte-identical, because
// collection rows, love_pushed_keys and the sync diff for albums and artists
// all key on these ids. sync-engine/ is packaged and loads in both processes.
//
// #1401: the old normalize kept only [a-z0-9], so a name in a non-Latin script
// collapsed to nothing. Every all-Cyrillic or all-CJK album got the id "-",
// so a second one couldn't be saved ("already in your collection"), and two
// non-Latin tracks could share an id, so a heart found the wrong saved row.
//
// The fix changes as few ids as possible:
//   - A name whose letters and digits are all Latin (after NFKD and dropping
//     combining marks, so Beyoncé and Motörhead count as Latin) keeps the
//     OLD formula exactly, byte for byte, accents and all. ASCII ids and
//     accented-Latin ids don't move.
//   - A name with letters or digits from another script (Cyrillic, CJK,
//     Greek, Arabic, Hebrew, and Latin letters NFKD can't reduce to ASCII,
//     such as ß, ø, æ and ł) is normalized with NFKC (composed, full-width
//     forms folded), lowercased, and every run of anything that isn't a
//     letter, mark or digit becomes one hyphen. Marks are KEPT here: in these
//     scripts they tell letters apart (Japanese ガ and カ, Cyrillic й and и),
//     where dropping them, as trackSlug does, would let two names share an
//     id again.
// So the only ids that change are ones the old formula had already broken,
// and the one-time migration (sync-engine/collection-id-migration.js) moves
// stored rows and their love marks to the new ids.
//
// Mobile doesn't build these ids: the Android app keys its library by the
// provider's own ids ("spotify-<id>", "applemusic-<id>", "listenbrainz-<mbid>")
// and its love marks by its own track ids, so nothing there has to match
// this formula (checked 2026-11-16, #1401).

'use strict';

// The stored ids' version. 1: ASCII-only (before #1401). 2: this file.
const COLLECTION_ID_VERSION = 2;

// The pre-#1401 normalize, kept for Latin names (byte-identical) and for the
// migration, which recognises rows saved under the old ids.
const legacyNormalizeForId = (str) => {
  return (str || '').toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
};

// A letter or digit outside ASCII, once NFKD has split accents off and the
// combining marks are gone: the name is (partly) in another script. Only the
// test folds; the id itself keeps every letter.
const NON_LATIN_LETTER = /(?![\x00-\x7F])[\p{L}\p{N}]/u;

const foldText = (str) => String(str || '').normalize('NFKD').replace(/\p{M}/gu, '');

const HAS_LETTER = /[\p{L}\p{N}]/u;

const normalizeForId = (str) => {
  const folded = foldText(str);
  const legacy = legacyNormalizeForId(str);
  // Latin, and the old formula kept something: the old id, unchanged. (A
  // name the old formula emptied though it has letters, such as full-width
  // "Ｂｊｏｒｋ", was broken too, so it takes the new path.)
  if (!NON_LATIN_LETTER.test(folded) && (legacy || !HAS_LETTER.test(folded))) return legacy;
  return String(str).normalize('NFKC').toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, '-')
    .replace(/^-|-$/g, '');
};

// Track id: artist-title-album, with the callers' long-standing fallbacks.
const generateTrackId = (artist, title, album) => {
  return `${normalizeForId(artist || 'unknown')}-${normalizeForId(title || 'untitled')}-${normalizeForId(album || 'noalbum')}`;
};

const generateAlbumId = (artist, title) => {
  return `${normalizeForId(artist || 'unknown')}-${normalizeForId(title || 'untitled')}`;
};

const generateArtistId = (name) => {
  return normalizeForId(name || 'unknown');
};

// The same three with the pre-#1401 normalize, for the migration.
const legacyGenerateTrackId = (artist, title, album) => {
  return `${legacyNormalizeForId(artist || 'unknown')}-${legacyNormalizeForId(title || 'untitled')}-${legacyNormalizeForId(album || 'noalbum')}`;
};
const legacyGenerateAlbumId = (artist, title) => {
  return `${legacyNormalizeForId(artist || 'unknown')}-${legacyNormalizeForId(title || 'untitled')}`;
};
const legacyGenerateArtistId = (name) => legacyNormalizeForId(name || 'unknown');

module.exports = {
  COLLECTION_ID_VERSION,
  normalizeForId, generateTrackId, generateAlbumId, generateArtistId,
  legacyNormalizeForId, legacyGenerateTrackId, legacyGenerateAlbumId, legacyGenerateArtistId,
};
