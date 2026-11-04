// Resolver match confidence scoring + minimum threshold gate.
//
// CANONICAL desktop copy. `tests/helpers/confidence-scoring.js` re-exports
// this module (was a parallel copy; collapsed to a re-export to remove drift).
// SYNC: app.js — keep `normalizeStr`, `validateResolvedTrack`,
// `calculateConfidence`, and `MIN_CONFIDENCE_THRESHOLD` byte-identical with
// the inline copies. Cross-platform invariant: must match
// `parachord-mobile/shared/.../resolver/ResolverModels.kt#scoreConfidence`
// and `ResolverScoring.kt#MIN_CONFIDENCE_THRESHOLD` so the desktop and
// Android pick the same source for the same track.
//
// Bug history: prior to this scoring, `calculateConfidence` only compared
// title + duration — artist was ignored. A search for "Yesterday" by The
// Beatles could resolve to a same-titled track by a different artist with
// 0.85 confidence, and since confidence was only a tiebreaker within a
// resolver-priority tier (no floor filter), the wrong-artist source could
// outrank a correct local file. The fix collapses single-axis matches to
// 0.50 and gates source selection on MIN_CONFIDENCE_THRESHOLD = 0.6.
//
// See parachord-mobile/shared/.../ResolverScoring.kt header for the full
// rationale.

// Case-fold + strip non-alphanumeric. Unicode-aware: decomposes accented
// Latin (ö → o, café → cafe) via NFKD + combining-mark strip, preserves
// non-Latin scripts (Japanese/Cyrillic/etc.) via \p{L}\p{N} keepset. The
// previous regex `/[^a-z0-9]/g` collapsed Japanese/Cyrillic titles to ""
// and lost umlauts instead of folding them. Cross-platform mirror: keep
// byte-aligned with app.js#normalizeStr and the Kotlin equivalents on
// Android.
function normalizeStr(s) {
  return _foldStr(s).replace(/[^\p{L}\p{N}]/gu, '');
}

// The folding half of normalizeStr, punctuation and spaces still in place. NFKD
// also turns a full-width "（" or "＆" and a no-break space into their plain
// forms, so the patterns below only have to spell those.
function _foldStr(s) {
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '');
}

// Containment check: either string contains the other (after normalization).
// Empty inputs never match. Mirrors Android's `stringsMatch`.
function _contains(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// What services join a multi-artist credit with. Runs on _foldStr output. The
// words need a space on both sides, so a name that starts or ends with one
// stays whole ("Little Feat", "Malcolm X", "X Ambassadors", "And One").
const ARTIST_CREDIT_JOIN = /,|&| (?:and|x) | [(\[]?(?:feat\.?|ft\.?|featuring) /;

// The names an artist credit lists, each normalized. Empty pieces (a stray
// join, an Oxford comma) are dropped.
function _creditedNames(artist) {
  return new Set(_foldStr(artist).split(ARTIST_CREDIT_JOIN).map(normalizeStr).filter(Boolean));
}

function _isSubset(a, b) {
  return a.size > 0 && [...a].every((name) => b.has(name));
}

// Is this the same artist credit? Services write one credit differently ("A and
// B", "A & B", "A, B", "A feat. B", "A x B"), and stripping the punctuation
// leaves a stray "and" or "feat" that defeats containment. So besides plain
// containment, the credited names are compared whole: every name on one side
// must be credited on the other, in any order. Names are compared exactly, so
// sharing one name out of two isn't enough ("Simon & Garfunkel" is not "Simon &
// Schuster") and neither is sharing a word ("Paul Simon" is not "Simon &
// Garfunkel"). A lone name can't pass this way unless containment already
// passes, so this only adds matches between credits of two or more names.
// Mirrored by parachord-mobile's ResolverModels.kt.
function _artistsMatch(a, b) {
  if (_contains(normalizeStr(a), normalizeStr(b))) return true;
  const namesA = _creditedNames(a);
  const namesB = _creditedNames(b);
  return _isSubset(namesA, namesB) || _isSubset(namesB, namesA);
}

// A credit in brackets at the very end of a title: "Song (feat. A)", "Song [ft.
// A]". Runs on _foldStr output. Brackets are required: a bare "ft" or "feat" can
// be part of the title.
const TRAILING_TITLE_CREDIT = / *[(\[] *(?:feat|ft|featuring)[. ][^)\]]*[)\]] *$/;

// Containment, or the same title once a trailing credit comes off both sides,
// which is how "Song (feat. A)" meets "Song (ft. A)" or "Song (feat. A & B)"
// meets "Song (feat. A and B)". This second check is equality on purpose: it
// must not let "Hello (feat. A)" reach "Hello Goodbye" by containment.
function _titlesMatch(a, b) {
  if (_contains(normalizeStr(a), normalizeStr(b))) return true;
  const bareA = normalizeStr(_foldStr(a).replace(TRAILING_TITLE_CREDIT, ''));
  const bareB = normalizeStr(_foldStr(b).replace(TRAILING_TITLE_CREDIT, ''));
  return !!bareA && bareA === bareB;
}

// Boolean gate — does the resolver's returned track plausibly match what we
// asked for? Both axes (artist AND title) must match: see _artistsMatch and
// _titlesMatch. This is the same gate `findBestMatch` uses inside the playback
// path.
function validateResolvedTrack(result, targetArtist, targetTitle) {
  if (!result || !result.artist || !result.title) return false;
  return (
    _artistsMatch(result.artist, targetArtist) &&
    _titlesMatch(result.title, targetTitle)
  );
}

// ISRC normalisation shared by the identity tier: upper-cased, trimmed, and
// only accepted in the standard shape (CC-XXX-NNNNNNN without separators).
const ISRC_SHAPE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
function normalizeIsrc(value) {
  if (!value) return null;
  const isrc = String(value).trim().toUpperCase();
  return ISRC_SHAPE.test(isrc) ? isrc : null;
}

// The ISRC the caller's track carries: top-level `isrc` first, then any
// resolver source that captured one (the same walk as window.pickTrackIsrc
// in the renderer, duplicated here so the module stays pure).
function pickIsrc(track) {
  if (!track || typeof track !== 'object') return null;
  const direct = normalizeIsrc(track.isrc);
  if (direct) return direct;
  const sources = track.sources;
  if (sources && typeof sources === 'object' && !Array.isArray(sources)) {
    for (const id of Object.keys(sources)) {
      const found = normalizeIsrc(sources[id] && sources[id].isrc);
      if (found) return found;
    }
  }
  return null;
}

// Confidence score for a resolver match. Mirrors Android's `scoreConfidence`.
// Identity first: the same ISRC or the same MusicBrainz recording MBID on both
// sides is the same recording whatever the artist/title strings look like
// across services, so that scores 1.0 outright (parachord#926 — Plex, Spotify
// and Apple Music all surface these). Otherwise returns 0.95 when both title
// and artist match, else 0.50. Trusts an authoritative
// resolver-supplied confidence (e.g. direct ID match from spotifyId /
// appleMusicId) only when validation passes.
function calculateConfidence(originalTrack, foundTrack) {
  if (!foundTrack) return 0.5;
  const targetIsrc = pickIsrc(originalTrack);
  const foundIsrc = normalizeIsrc(foundTrack.isrc);
  if (targetIsrc && foundIsrc && targetIsrc === foundIsrc) return 1.0;
  const targetMbid = originalTrack && (originalTrack.mbid || originalTrack.recordingMbid);
  const foundMbid = foundTrack.mbid || foundTrack.recordingMbid;
  if (targetMbid && foundMbid && String(targetMbid).toLowerCase() === String(foundMbid).toLowerCase()) return 1.0;
  const targetArtist = originalTrack?.artist || '';
  const targetTitle = originalTrack?.title || '';
  if (!validateResolvedTrack(foundTrack, targetArtist, targetTitle)) {
    return 0.5;
  }
  // Both axes match. If the resolver provided its own confidence and it's
  // already at or above the validated tier, trust it (keeps direct-ID 1.0
  // scores intact). Otherwise return the canonical validated score.
  if (typeof foundTrack.confidence === 'number' && foundTrack.confidence >= 0.95) {
    return foundTrack.confidence;
  }
  return 0.95;
}

// Sources scoring below this floor are filtered out before the
// resolver-priority sort runs. 0.50 (single-axis match) gets dropped;
// 0.95 (both-axis match) passes. Match Android's value.
const MIN_CONFIDENCE_THRESHOLD = 0.6;

// Pick the highest-confidence candidate that clears MIN_CONFIDENCE_THRESHOLD.
//
// This is the gate that REPLACES the legacy unguarded `|| items[0]` fallback in
// the Spotify / Apple Music `resolveTracks` ID-minting paths (parachord#911
// D-Legacy-1). Without it, an ID-less track with no real match minted the top
// search result's URI with zero confidence floor — e.g. local "Intro" by The xx
// → "Intro" by Alt-J — and that wrong-song URI then stuck fleet-wide via
// provider-ID equality. On a sub-floor best, return null so the caller drops the
// track (unresolved) rather than mis-minting.
//
// `candidates` is an array of resolver-result-shaped `{ title, artist }`
// (already mapped from the provider's native search hit). Returns
// `{ index, score }` of the winning candidate, or `null` when none clears the
// floor. Equivalent to mobile's scoreConfidence(...) >= MIN_CONFIDENCE_THRESHOLD
// selection in AppleMusicSyncProvider / SpotifySyncProvider.
function pickConfidentMatch(originalTrack, candidates) {
  let bestIndex = -1;
  let bestScore = 0;
  (Array.isArray(candidates) ? candidates : []).forEach((cand, i) => {
    const score = calculateConfidence(originalTrack, cand);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = i;
    }
  });
  if (bestIndex < 0 || bestScore < MIN_CONFIDENCE_THRESHOLD) return null;
  return { index: bestIndex, score: bestScore };
}

// Dual-load: the renderer loads this file via index.html (before app.js) and
// consumes it as window.ConfidenceScoring; jest and the main process require()
// it. tests/helpers/confidence-scoring.js re-exports this module — the
// canonical desktop source. The old app.js inline copies are gone (they were
// hand-synced byte-copies; one had already drifted).
if (typeof window !== 'undefined') {
  window.ConfidenceScoring = { normalizeStr, validateResolvedTrack, calculateConfidence, MIN_CONFIDENCE_THRESHOLD, pickConfidentMatch };
}

// Guarded: the renderer has no `module`, and an unguarded assignment threw
// "module is not defined" on every launch (after the window export above).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    normalizeStr,
    validateResolvedTrack,
    calculateConfidence,
    MIN_CONFIDENCE_THRESHOLD,
    pickConfidentMatch,
  };
}
