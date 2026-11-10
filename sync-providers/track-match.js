// sync-providers/track-match.js — which search result, if any, is the track
// that was asked for?
//
// A search result carries its own names, so handlePlay's confidence check can
// only ever compare it with itself. This choice is the last place a wrong song
// can be refused, and returning the first result when nothing matched played
// "Untitled #4" for a link to "Happy Me" (#1241). Returning null is the point:
// callers report "not found".
//
// Lives here rather than in src/ because tools/dj-tools.js needs it and the main
// process loads that file, while package.json leaves src/ out of the packaged app.

const { normalizeStr, validateResolvedTrack } = require('./confidence-scoring');
const { isOtherVersion } = require('./track-variants');

// A trailing remaster label on a title: "- 2016 Remaster", "- Remastered 2009",
// "- 2003 Digital Remaster", "(Remastered)", "[2011 Remaster]", "- Remastered
// Version". It labels an edition of the same studio recording. Only at the end,
// after a dash or in brackets, so "Remaster Me" keeps its name. Same pattern as
// mobile's REMASTER_LABEL (parachord-mobile#581); keep the two the same.
const REMASTER_WORDS = '(?:\\d{4} )?(?:digital(?:ly)? )?remaster(?:ed)?(?: \\d{4})?(?: version| edition)?';
const REMASTER_LABEL = new RegExp(` *(?:- *${REMASTER_WORDS}|[(\\[] *${REMASTER_WORDS} *[)\\]]) *$`);

// Lowercased and NFKD-folded (so a full-width bracket is a plain one), the way
// normalizeStr folds before it drops punctuation.
function foldForLabel(title) {
  return String(title || '').toLowerCase().normalize('NFKD');
}

function hasRemasterLabel(title) {
  return REMASTER_LABEL.test(foldForLabel(title));
}

function withoutRemasterLabel(title) {
  return foldForLabel(title).replace(REMASTER_LABEL, '');
}

function pickTrackMatch(results, targetArtist, targetTitle, { mbid, isrc } = {}) {
  if (!results || results.length === 0) return null;
  // Tier 1: exact MusicBrainz recording MBID — a definitive identity match
  // that's immune to artist/title formatting differences.
  if (mbid) {
    const m = results.find(r => (r.mbid || r.recordingMbid) && (r.mbid === mbid || r.recordingMbid === mbid));
    if (m) return m;
  }
  // Tier 2: exact ISRC — also a definitive recording-identity match.
  if (isrc) {
    const ti = String(isrc).trim().toUpperCase();
    const m = results.find(r => r.isrc && String(r.isrc).trim().toUpperCase() === ti);
    if (m) return m;
  }
  const normTargetArtist = normalizeStr(targetArtist);
  const normTargetTitle = normalizeStr(targetTitle);
  // Tier 3: exact normalized name (artist + title). A trailing remaster label
  // on the result doesn't count against it unless the request names one too:
  // Spotify labels remastered studio tracks while a live album or an outtakes
  // set carries the bare title, so a raw comparison picked Ramones' live
  // "Judy Is a Punk" over "Judy Is a Punk - 2016 Remaster" ranked above it
  // (#1304).
  const targetLabelled = hasRemasterLabel(targetTitle);
  for (const r of results) {
    const title = targetLabelled ? r.title : withoutRemasterLabel(r.title);
    if (normalizeStr(r.artist) === normTargetArtist && normalizeStr(title) === normTargetTitle) {
      return r;
    }
  }
  // Tier 4: a contains match that is not another version (a cover, remix or
  // live cut the target title doesn't name). Tier 5: any contains match, so
  // "Song - Remastered"-style catalog titles and variant-only results still
  // resolve.
  for (const r of results) {
    if (!isOtherVersion(r, targetArtist, targetTitle) && validateResolvedTrack(r, targetArtist, targetTitle)) {
      return r;
    }
  }
  for (const r of results) {
    if (validateResolvedTrack(r, targetArtist, targetTitle)) {
      return r;
    }
  }
  return null;
}

module.exports = { pickTrackMatch };
