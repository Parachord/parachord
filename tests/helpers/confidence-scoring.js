// Resolver match confidence scoring + minimum threshold gate.
//
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
  return (s || '')
    .toString()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

// Containment check: either string contains the other (after normalization).
// Empty inputs never match. Mirrors Android's `stringsMatch`.
function _contains(a, b) {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

// Boolean gate — does the resolver's returned track plausibly match what we
// asked for? Both axes (artist AND title) must containment-match. This is
// the same gate `findBestMatch` uses inside the playback path.
function validateResolvedTrack(result, targetArtist, targetTitle) {
  if (!result || !result.artist || !result.title) return false;
  const resultArtist = normalizeStr(result.artist);
  const resultTitle = normalizeStr(result.title);
  const normTargetArtist = normalizeStr(targetArtist);
  const normTargetTitle = normalizeStr(targetTitle);
  return (
    _contains(resultArtist, normTargetArtist) &&
    _contains(resultTitle, normTargetTitle)
  );
}

// Confidence score for a resolver match. Mirrors Android's `scoreConfidence`.
// Returns 0.95 when both title and artist containment-match, else 0.50.
// Trusts an authoritative resolver-supplied confidence (e.g. direct ID
// match from spotifyId/appleMusicId) only when validation passes.
function calculateConfidence(originalTrack, foundTrack) {
  if (!foundTrack) return 0.5;
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

module.exports = {
  normalizeStr,
  validateResolvedTrack,
  calculateConfidence,
  MIN_CONFIDENCE_THRESHOLD,
};
