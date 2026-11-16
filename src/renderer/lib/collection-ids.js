// src/renderer/lib/collection-ids.js — collection track / album / artist
// ids. Moved verbatim out of app.js's module scope so the extracted page
// modules (Track 2b split) can use them; app.js requires them back.
//
// The id formula itself lives in sync-engine/collection-id.js, shared with
// the sync providers (sync-providers/spotify.js, applemusic.js), so there is
// one definition, not copies to keep byte-identical. Non-Latin names fold
// instead of collapsing to nothing (#1401); ASCII and accented-Latin ids are
// unchanged, and a one-time migration moved stored rows to the new ids.

'use strict';

const { trackSlug } = require('./track-slug');

const { normalizeForId, legacyNormalizeForId, generateTrackId, generateAlbumId, generateArtistId } = require('../../../sync-engine/collection-id');

// An album that isn't one: nothing, "Single", or the name of one of the track's
// own sources. The rule lives in sync-engine/track-identity.js, which library
// sync (main process) also uses to match tracks; packaging excludes src/, so
// it can't live here. One rule for both.
const { isPlaceholderAlbum } = require('../../../sync-engine/track-identity');

const sameName = (a, b) => {
  const x = typeof a === 'string' ? a.trim().toLowerCase() : '';
  return !!x && x === (typeof b === 'string' ? b.trim().toLowerCase() : '');
};

// The saved row for a track, or null. A row's id includes the album it was
// saved with, so when a track's album changes the id no longer matches: a row
// whose album was only a placeholder also matches on artist and title. Two real
// albums stay two tracks, and exact ids win over a placeholder row.
const findSavedTrack = (tracks, track) => {
  if (!Array.isArray(tracks) || !track) return null;
  const generatedId = generateTrackId(track.artist, track.title, track.album);
  // The trackSlug tier, hoisted out of the finds and gated on the ASCII strip
  // collapsing the artist or title — the same gate loveRowId uses
  // (parachord#1071 review). trackSlug is NFKD plus two Unicode regexes and
  // this runs under every render of an unsaved heart, so computing it inside
  // the find callback cost a recomputation per row (10k rows ≈ 5ms a miss).
  // Ungated it also changes Latin matching a little ("Every Day" would match
  // a saved "Everyday"), so the gate keeps Latin hearts on the id tiers.
  // The gate is the OLD normalize (#1401): rows the love import saved under a
  // trackSlug id are the ones the old formula emptied. The startup migration
  // moves them to generateTrackId ids, so this tier only matters for a
  // profile the migration hasn't reached yet.
  const slugId = (!legacyNormalizeForId(track.artist) || !legacyNormalizeForId(track.title))
    ? trackSlug(track.artist, track.title, track.album)
    : null;
  // A heart's own album: search, the queue and now-playing carry none, so an
  // empty album on the CANDIDATE is a placeholder too — the same rule the
  // row-side tier below applies to saved rows. This is what lets a heart on
  // an imported row (whose album-bearing trackSlug id no id tier matches)
  // find it by name.
  const candidateAlbumIsPlaceholder = isPlaceholderAlbum(track.album, track.sources);
  return tracks.find((t) => t.id === track.id && track.id)
    || tracks.find((t) => t.id === generatedId)
    // A row the love-import saved with a trackSlug id (a non-Latin
    // ListenBrainz love keeps its album, so `generateTrackId` collapses the
    // artist/title and never matches): the slug is the only shared id when
    // the heart carries the same album.
    || (slugId ? tracks.find((t) => t.id === slugId) : undefined)
    // A heart with no album of its own matches a saved row with a real album
    // on artist and title (parachord#1071 review).
    || (candidateAlbumIsPlaceholder
      ? tracks.find((t) => sameName(t.artist, track.artist) && sameName(t.title, track.title))
      : undefined)
    // A row saved with a placeholder album matches on artist and title.
    || tracks.find((t) => sameName(t.artist, track.artist) && sameName(t.title, track.title)
      && isPlaceholderAlbum(t.album, t.sources))
    || null;
};

// Clears placeholder albums on saved rows. Ids stay as they are, so anything
// keyed by them keeps working. An album a provider synced is its real name,
// even "Single", so those rows are left alone.
const clearPlaceholderAlbums = (tracks) => {
  let changed = 0;
  const cleared = (tracks || []).map((t) => {
    if (!t || !t.album) return t;
    const synced = Object.keys(t.syncSources || {}).some((id) => id !== 'manual');
    if (synced || !isPlaceholderAlbum(t.album, t.sources)) return t;
    changed += 1;
    return { ...t, album: '' };
  });
  return { tracks: cleared, changed };
};

module.exports = {
  normalizeForId, generateTrackId, generateAlbumId, generateArtistId,
  isPlaceholderAlbum, findSavedTrack, clearPlaceholderAlbums
};
