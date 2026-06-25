// N-way multimaster playlist merge — pure 3-way merge (Phase 0).
//
// Design: docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md
// (authored in parachord-mobile). Tracker: Parachord/parachord#911
// (desktop) + Parachord/parachord-mobile#268 (mobile).
//
// SYNC / CROSS-ENGINE PARITY (load-bearing): this JS merge and the Kotlin
// merge (parachord-mobile shared/.../sync/PlaylistMerge.kt) MUST produce
// identical output for identical input. They are NOT shared code — parity
// is proven by a shared JSON test-vector suite. The canonical contract is
// parachord-mobile's docs/nway-playlist-merge-fixtures.json, vendored into
// this repo at tests/fixtures/nway-merge/canonical-fixtures.json and run
// against this engine. If you change a merge rule, change the Kotlin side
// and re-sync the fixtures in lockstep — otherwise the two clients fight
// over the same remote playlists (one pushes an edit the other reverts ->
// oscillation).
//
// This is the pure function only (`baseline + copies -> merged array`). It
// does NOT touch the live sync path, electron-store, or any provider API —
// wiring it into reconciliation (and the caller-side mass-change /
// partial-fetch guards) is Phase 1+ and out of scope here.
//
// ─────────────────────────────────────────────────────────────────────
// Semantics (verbatim from the canonical fixtures' _semantics block)
// ─────────────────────────────────────────────────────────────────────
// presence:  union-adds — a key in ANY changed copy but not in baseline is
//            added. union-removes — a baseline key missing from ANY changed
//            copy is removed. present = (baseline − removed) ∪ added.
//            DELETE ALWAYS WINS — a baseline key dropped by any copy is gone
//            even if a newer copy still has it (a copy still holding the key
//            is un-propagated baseline, NOT a re-add). `added` and `removed`
//            are disjoint by construction (added = non-baseline, removed =
//            baseline), so there is NO same-key add-vs-delete race.
// timestamps: editedAt affects ORDER ONLY, never presence.
// order:     walk the most-recently-edited changed copy's tracks first, then
//            the baseline, then each other changed copy in input order; keep
//            only present keys; dedupe (first occurrence wins). A copy whose
//            tracks == baseline contributes no delta and is ignored.

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}[0-9]{7}$/;

function validIsrc(value) {
  if (typeof value !== 'string') return null;
  const norm = value.trim().toUpperCase();
  return ISRC_RE.test(norm) ? norm : null;
}

// Normalize a recording MBID to its tier value. Per the cross-engine
// key-derivation contract (the merge/key-unify fixtures' `_semantics`), the
// MBID tier is `trim + lowercase`, NON-EMPTY — and is NOT regex-validated
// (only ISRC is). A 36-char UUID regex here was over-strict and DIVERGED from
// the Kotlin engine (which accepts any non-blank recordingMbid), so a track
// whose mbid field carried a non-UUID id keyed differently across the two
// engines. Real recording MBIDs are UUIDs, so this only changes behavior for
// non-standard ids — but matching the contract byte-for-byte is the point.
function validMbid(value) {
  if (typeof value !== 'string') return null;
  const norm = value.trim().toLowerCase();
  return norm.length > 0 ? norm : null;
}

// Fallback-key normalization: lower + trim ONLY (NOT the strip-non-
// alphanumeric normalizeStr used by confidence scoring). Keep them distinct.
function normField(value) {
  return (typeof value === 'string' ? value : '').trim().toLowerCase();
}

// Strip a trailing remaster annotation from a LOWERCASED title so the same
// recording unifies across services when its title drifts (the ListenBrainz
// axis: LB returns no per-track ISRC, so only `norm` can bridge there). This
// is a CROSS-ENGINE identity rule — the Kotlin norm derivation applies the
// identical regex (parachord#911, 2026-06-23 update). Conservative: strips
// "- [YYYY] Remaster(ed) [YYYY]" / "(Remaster(ed) [YYYY])" forms only; it
// deliberately does NOT touch Live / Acoustic / Single / Radio / "(feat …)"
// — those are genuinely different recordings.
function stripRemasterSuffix(lowerTitle) {
  return lowerTitle.replace(
    /\s*[-(]\s*(\d{4}\s+)?remaster(ed)?(\s+\d{4})?\s*\)?\s*$/,
    ''
  );
}

// Derive the `norm` identity tier: `<artist>|<title>`, each lower+trim, with
// the remaster suffix stripped from the title. Shared by canonicalTrackKey
// (singleton) and the unify pre-pass's trackTiers (cross-copy matching).
function deriveNorm(artist, title) {
  return `${normField(artist)}|${stripRemasterSuffix(normField(title))}`;
}

/**
 * Canonical track key. Precedence: valid ISRC -> `isrc-<UPPER>`; else
 * recording MBID -> `mbid-<lower>`; else `norm-<artist|title>` (lower+trim,
 * remaster-stripped title).
 * @param {{isrc?:string, recordingMbid?:string, mbid?:string, artist?:string, title?:string}} track
 * @returns {string}
 */
function canonicalTrackKey(track) {
  if (!track || typeof track !== 'object') return 'norm-|';
  const isrc = validIsrc(track.isrc);
  if (isrc) return `isrc-${isrc}`;
  const mbid = validMbid(track.recordingMbid) || validMbid(track.mbid);
  if (mbid) return `mbid-${mbid}`;
  return `norm-${deriveNorm(track.artist, track.title)}`;
}

function arraysEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Pure N-way 3-way merge.
 *
 * @param {string[]} baseline - ordered canonical keys (the 3-way ancestor).
 * @param {Array<{id:string, tracks:string[], editedAt:number}>} copies -
 *   each copy's CURRENT ordered tracklist. A copy whose `tracks` deep-equals
 *   `baseline` is unchanged and contributes no delta (ignored).
 * @returns {string[]} the merged ordered tracklist.
 *
 * Pure and deterministic. No mass-change / partial-fetch guards — those are
 * caller-side (Phase 1+); the contract's pure merge always returns an array,
 * including [] when every copy removed everything.
 */
function mergePlaylist(baseline, copies) {
  const base = Array.isArray(baseline) ? baseline : [];
  const allCopies = Array.isArray(copies) ? copies : [];

  // Only CHANGED copies contribute. "Changed" = tracks not ordered-equal to
  // baseline (a pure reorder counts — it has no add/remove delta but can be
  // the order winner). Preserves input order among changed copies.
  const changed = allCopies.filter((c) => {
    const tracks = Array.isArray(c.tracks) ? c.tracks : [];
    return !arraysEqual(tracks, base);
  });

  if (changed.length === 0) {
    // Nothing to reconcile — baseline stands.
    return base.slice();
  }

  const baseSet = new Set(base);

  // ── Presence: present = (baseline − removed) ∪ added ──────────────
  // removed = baseline keys missing from ANY changed copy (delete wins).
  // added  = non-baseline keys present in ANY changed copy.
  const present = new Set();
  for (const k of base) {
    const removedBySome = changed.some(
      (c) => !(Array.isArray(c.tracks) ? c.tracks : []).includes(k)
    );
    if (!removedBySome) present.add(k);
  }
  for (const c of changed) {
    for (const k of (Array.isArray(c.tracks) ? c.tracks : [])) {
      if (!baseSet.has(k)) present.add(k);
    }
  }

  // ── Order: winner copy, then baseline, then other changed copies ──
  // Winner = first changed copy (input order) with the maximal editedAt —
  // matches Kotlin `maxByOrNull { editedAt }` (first max in iteration order).
  let winner = changed[0];
  for (const c of changed) {
    if (num(c.editedAt) > num(winner.editedAt)) winner = c;
  }

  const sequence = [];
  sequence.push(Array.isArray(winner.tracks) ? winner.tracks : []);
  sequence.push(base);
  for (const c of changed) {
    if (c !== winner) sequence.push(Array.isArray(c.tracks) ? c.tracks : []);
  }

  const merged = [];
  const seen = new Set();
  for (const list of sequence) {
    for (const k of list) {
      if (present.has(k) && !seen.has(k)) {
        seen.add(k);
        merged.push(k);
      }
    }
  }
  return merged;
}

/**
 * Caller-side mass-change guard (design step 6) — NOT part of the pure
 * merge contract and NOT exercised by the cross-engine fixtures. A caller
 * computes the merge, then refuses to propagate if it would drop more than
 * `threshold` of the baseline (a provider hiccup returning empty). Exact
 * threshold is a design open question; default 0.7. Phase 1+ will wire this
 * into reconciliation.
 */
function exceedsMassChangeThreshold(baselineLength, mergedLength, threshold = 0.7) {
  if (!baselineLength || baselineLength <= 0) return false;
  const dropped = Math.max(0, baselineLength - mergedLength);
  return dropped / baselineLength > threshold;
}

function num(v) {
  return typeof v === 'number' ? v : 0;
}

module.exports = {
  canonicalTrackKey,
  mergePlaylist,
  exceedsMassChangeThreshold,
  // exported for targeted tests / reuse
  validIsrc,
  validMbid,
  normField,
  stripRemasterSuffix,
  deriveNorm,
};
