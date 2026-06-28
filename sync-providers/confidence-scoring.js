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

module.exports = {
  normalizeStr,
  validateResolvedTrack,
  calculateConfidence,
  MIN_CONFIDENCE_THRESHOLD,
  pickConfidentMatch,
};
