// src/renderer/lib/playlist-duplicates.js: a playlist's duplicate tracks,
// later copies of a song already in it, and the words for the playlist page's
// banner that removes them (#1635; mobile's PlaylistDuplicates /
// PlaylistDuplicateCopy, parachord-mobile#804, from the same vectors).
//
// "The same song" is the rule sync uses to match a track across services
// (sync-engine/playlist-key-unify.js unifyTrackKeys over the one list): the
// same ISRC (pickTrackIsrc: the track's own, else a source's) or recording
// MBID, else the same artist and title with a trailing remaster tag ignored.
// Live, remix, acoustic and "feat." titles stay apart; two different ISRCs
// under one name stay two recordings; a row with no artist, title or id is
// never a duplicate. The first copy of each song stays, in its place.
//
// Pure, loads under plain Node.

const { unifyTrackKeys } = require('../../../sync-engine/playlist-key-unify');
const { validIsrc, validMbid, deriveNorm } = require('../../../sync-engine/playlist-merge');
const { isHostedXspf } = require('../../../sync-engine/auto-pull');
const { pickTrackIsrc } = require('./track-isrc');
const { countOf } = require('./plural');

// Indexes (in the list's order) of the copies that would be removed.
function duplicateIndexes(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  if (list.length < 2) return new Set();
  const keys = list.map((t, i) => {
    const k = {
      isrc: validIsrc(pickTrackIsrc(t)),
      mbid: validMbid(t && t.recordingMbid) || validMbid(t && t.mbid),
      norm: deriveNorm(t && t.artist, t && t.title),
    };
    // A blank row would share the empty "|" name with every other blank row.
    return !k.isrc && !k.mbid && k.norm === '|' ? { isrc: null, mbid: null, norm: `\u0000blank-${i}` } : k;
  });
  const reps = unifyTrackKeys([keys])[0];
  const seen = new Set();
  const dupes = new Set();
  reps.forEach((r, i) => { if (seen.has(r)) dupes.add(i); else seen.add(r); });
  return dupes;
}

function duplicateCount(tracks) {
  return duplicateIndexes(tracks).size;
}

// The list with every later copy removed, in order. The same array when
// there's nothing to remove.
function withoutDuplicates(tracks) {
  const list = Array.isArray(tracks) ? tracks : [];
  const dupes = duplicateIndexes(list);
  return dupes.size ? list.filter((_, i) => !dupes.has(i)) : list;
}

// Whether the playlist page offers the banner: duplicates, and a saved
// playlist that's ours to edit. A hosted XSPF is a copy of its feed, which
// the next poll would restore; a recommendation shown but not saved has
// nothing to save to. A provider import keeps its link only as provenance,
// so it's editable like any other.
function offersRemoval(playlist, count) {
  return !!playlist && !playlist.isEphemeral && !isHostedXspf(playlist) && count > 0;
}

// The words, the same on every app.
const duplicateCopy = {
  remove: 'Remove duplicates',
  banner: (n) => `${countOf(n, 'duplicate track')} in this playlist`,
  confirmTitle: (n) => `Remove ${countOf(n, 'duplicate track')}?`,
  confirmBody: (name) => `The first copy of each track stays in “${name}”. Synced copies on other services update on the next sync.`,
  done: (n) => `Removed ${countOf(n, 'duplicate track')}`,
};

module.exports = { duplicateIndexes, duplicateCount, withoutDuplicates, offersRemoval, duplicateCopy };
