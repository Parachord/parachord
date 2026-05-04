# Track Playback: Confidence Floor + Priority + Confidence Logic

## Overview

Track playback selects the best source from a track's resolved `sources` map using a **three-stage gate**:

1. **Confidence floor** — drop wrong-artist / wrong-title results before they can compete
2. **Priority** — among survivors, pick by user-configured resolver order
3. **Confidence tiebreaker** — within the same priority tier, higher confidence wins

This document covers stages 1–3 of the playback selection. Scoring (how `confidence` itself is computed) is documented in `CLAUDE.md` → "Match Confidence + Selection Floor".

## Why a Confidence Floor

Without a floor, **wrong-artist matches silently win.**

```
Resolver Order: [Spotify #1, Bandcamp #2]

Track "Yesterday" by The Beatles, resolved sources:
- Spotify: 0.50 confidence — wrong artist's "Yesterday"
- Bandcamp: 0.95 confidence — exact match
```

Old behavior (no floor): plays Spotify because it's #1 priority. The user gets a different artist's song that happens to share the title, with no warning.

New behavior (floor at 0.60): Spotify's 0.50 is dropped before the priority sort even runs. Bandcamp wins.

Confidence in this codebase is **categorical, not continuous**:
- `0.95` — both artist AND title containment-match the target (correct match)
- `0.50` — single-axis match (title-only or artist-only) — wrong song
- `1.0` — direct-ID match (cached `spotifyId`, `appleMusicId`, etc.) — authoritative

A 0.50 score literally means "wrong song." It must not reach selection. The floor at 0.60 cleanly separates 0.50 (drop) from 0.95+ (keep).

## The Algorithm

```
FOR each resolved source on the track:
  confidence = sources[resolverId].confidence || 0
  priority   = resolverOrder.indexOf(resolverId)  // -1 → end of list

FILTER sources to keep only those where:
  resolverId is in activeResolvers (user-enabled)
  confidence >= MIN_CONFIDENCE_THRESHOLD (0.6)
  source not on the per-result blocklist

SORT survivors by:
  1. Preferred resolver (if track.preferredResolver set) wins
  2. Priority ascending (0, 1, 2, ...)
  3. Confidence descending (0.95, 0.50, ...) within same priority

PLAY the first survivor.
```

Code lives in `handlePlay` (app.js L15170+, with the floor filter at L15184).

## Examples

### Example 1: Floor protects against wrong-artist match

```
Order: [Spotify #1, Bandcamp #2]
Sources:
- Spotify:  0.50 (wrong artist — dropped by floor)
- Bandcamp: 0.95
PLAYS: Bandcamp
```

This is the regression-test case. Pre-floor, Spotify won despite being the wrong song.

### Example 2: Priority wins among survivors

```
Order: [Spotify #1, Bandcamp #2]
Sources:
- Spotify:  0.95 (correct match)
- Bandcamp: 0.95 (also correct)
PLAYS: Spotify (priority #1)
```

Both pass the floor. User's preferred order wins.

### Example 3: Fallback to next priority

```
Order: [Spotify #1, Bandcamp #2, Qobuz #3]
Sources:
- Spotify:  0.50 (wrong artist — dropped)
- Bandcamp: 0.95
- Qobuz:    0.95
PLAYS: Bandcamp (next priority survivor)
```

### Example 4: Confidence breaks tie within priority tier

```
Order: [Spotify #1, Bandcamp #1, Qobuz #2]   // Spotify and Bandcamp same tier
Sources:
- Spotify:  0.95
- Bandcamp: 1.00 (direct ID match)
- Qobuz:    0.95
PLAYS: Bandcamp (same tier, higher confidence)
```

### Example 5: All sources below floor → no source

```
Order: [Spotify #1, Bandcamp #2]
Sources:
- Spotify:  0.50 (wrong artist)
- Bandcamp: 0.50 (wrong title)
PLAYS: nothing — "No Enabled Source" dialog
```

This surfaces when the resolvers genuinely couldn't find this track in any user-enabled service, even if they returned wrong-song matches that look superficially plausible.

## Manual Override

Clicking a specific resolver icon (the small per-resolver play buttons on the track row) bypasses all of the above:

```js
onClick: (e) => {
  e.stopPropagation();
  handlePlay(specificSource); // ignores floor, priority, confidence
}
```

If the user explicitly clicks "play from Bandcamp," they get Bandcamp regardless of confidence or priority. The icons themselves dim at low confidence (~L2108, L4183) so the user can see the resolver isn't confident, but the click still goes through.

## Background Resolution Also Gates

The selection floor at `handlePlay` is the user-visible gate, but background resolution paths also gate at the same threshold so wrong-artist results never enter `track.sources` in the first place:

- Background normal-resolver pipeline (app.js L8027)
- Rate-limited iTunes path (app.js L8056)
- Per-track resolve flush (app.js L8170)
- Five `calculateConfidence`-using sites in cache validation / collection resolution — these already used `calculateConfidence` and now benefit from its tightened semantics

This matters beyond playback: a wrong-artist result also pollutes `track.album` and `track.albumArt` via the fallback-fill logic. Skipping the attach keeps those fields clean.

## Tests

`tests/resolver/confidence-scoring.test.js` (27 tests) covers:

- `normalizeStr` — case folding, punctuation stripping
- `validateResolvedTrack` — both-axes containment, missing fields, empty inputs
- `calculateConfidence` — 0.95 for both-match, 0.50 for single-axis, preserves direct-ID 1.0, rejects wrong-artist match even when resolver claims 1.0 confidence
- `MIN_CONFIDENCE_THRESHOLD = 0.6` and the regression — wrong-artist 0.50 drops, correct 0.95 passes

Mirrors `parachord-android/app/src/test/.../ConfidenceScoringTest.kt`.

## Cross-Platform Invariant

The desktop and Android clients must select the same source for the same track. The contract:

| Platform | File | What it owns |
|---|---|---|
| Desktop (runtime) | `app.js` L149–166 + L24880 | `normalizeStr`, `validateResolvedTrack`, `MIN_CONFIDENCE_THRESHOLD`, `calculateConfidence` |
| Desktop (test mirror) | `tests/helpers/confidence-scoring.js` | Same functions, byte-identical, `require`d by tests |
| Android | `parachord-android/shared/src/commonMain/kotlin/com/parachord/shared/resolver/ResolverModels.kt` + `ResolverScoring.kt` | `scoreConfidence`, `validateResolvedTrack` equivalent, `MIN_CONFIDENCE_THRESHOLD` |

Drift on any platform produces inconsistent selection. The SYNC comments in each file flag where the others live.

## History

This logic was tightened on 2026-05-04 in response to a bug where the desktop's `calculateConfidence` ignored artist entirely (only compared title and duration). A search for "Yesterday" by The Beatles could resolve to a same-titled different-artist recording with 0.85 confidence; combined with no selection floor, the wrong source could win against a correct lower-priority resolver.

The fix:
- Required both axes to substring-match in `calculateConfidence` (else 0.50)
- Added `MIN_CONFIDENCE_THRESHOLD = 0.6` and applied it before the priority sort
- Replaced three hardcoded `confidence: 0.9` stamps in background resolution with proper scoring + threshold check + skip-on-reject
- Added `tests/resolver/confidence-scoring.test.js` mirroring Android's coverage

Android applied the same tightening (commit `8a31bf5: tighten scoreConfidence to match desktop's validateResolvedTrack gate`) — both platforms now share the same selection semantics.
