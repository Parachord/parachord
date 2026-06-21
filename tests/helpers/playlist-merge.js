// N-way multimaster playlist merge — pure 3-way merge (Phase 0).
//
// Design: docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md
// (authored in parachord-mobile). Tracker: Parachord/parachord#911
// (desktop) + Parachord/parachord-mobile#268 (mobile).
//
// SYNC / CROSS-ENGINE PARITY (load-bearing): this JS merge and the Kotlin
// merge in parachord-mobile's `shared/commonMain` MUST produce identical
// output for identical input. They are NOT shared code — parity is proven
// by a shared JSON test-vector suite (tests/fixtures/nway-merge/*.json)
// run against BOTH engines. If you change a merge rule here, change the
// Kotlin side and the fixtures in lockstep, or the two clients will fight
// over the same remote playlists (one pushes an edit the other reverts ->
// oscillation). This module is the desktop half of that contract.
//
// This is the pure function only (`baseline + copies -> mergedResult`).
// It does NOT touch the live sync path, electron-store, or any provider
// API — wiring that into reconciliation is Phase 1+ and out of scope here.
//
// ─────────────────────────────────────────────────────────────────────
// Canonical track key
// ─────────────────────────────────────────────────────────────────────
// The linchpin that lets us diff a Spotify tracklist against an Apple
// Music one. Precedence (per design doc):
//   1. valid ISRC            -> `isrc-<UPPER>`
//   2. recording MBID        -> `mbid-<lower>`
//   3. normalized artist|title -> `norm-<artist|title>` (lower + trimmed)
// Residual risk (documented, accepted): a track with ISRC on one service
// but neither ISRC nor MBID on another mismatches -> treated as two
// tracks. Minimized by MBID/ISRC enrichment over time.

const ISRC_RE = /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/;
const MBID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function validIsrc(value) {
  if (typeof value !== 'string') return null;
  const norm = value.trim().toUpperCase();
  return ISRC_RE.test(norm) ? norm : null;
}

function validMbid(value) {
  if (typeof value !== 'string') return null;
  const norm = value.trim().toLowerCase();
  return MBID_RE.test(norm) ? norm : null;
}

// Normalize a free-text field for the fallback key. The design doc
// specifies "lower/trimmed" (NOT the strip-non-alphanumeric normalizeStr
// used by confidence scoring) — keep it literal so both engines agree.
function normField(value) {
  return (typeof value === 'string' ? value : '').trim().toLowerCase();
}

/**
 * Derive the canonical track key for a track object.
 * @param {{isrc?:string, recordingMbid?:string, mbid?:string, artist?:string, title?:string}} track
 * @returns {string}
 */
function canonicalTrackKey(track) {
  if (!track || typeof track !== 'object') return 'norm-|';
  const isrc = validIsrc(track.isrc);
  if (isrc) return `isrc-${isrc}`;
  // Accept either `recordingMbid` or `mbid` (recording MBID) as the source.
  const mbid = validMbid(track.recordingMbid) || validMbid(track.mbid);
  if (mbid) return `mbid-${mbid}`;
  return `norm-${normField(track.artist)}|${normField(track.title)}`;
}

// ─────────────────────────────────────────────────────────────────────
// Pure 3-way merge
// ─────────────────────────────────────────────────────────────────────
//
// Inputs:
//   baseline : ordered array of canonical key strings (the 3-way ancestor —
//              the last-merged tracklist).
//   copies   : array of { id, editedAt, keys } where
//                id       : stable copy/provider label (deterministic
//                           tiebreak when editedAt ties)
//                editedAt : comparable number (epoch ms). Higher = newer.
//                keys     : ordered array of canonical key strings — that
//                           copy's CURRENT tracklist. An unchanged copy's
//                           keys == baseline (caller passes it as-is).
//   options  : { massChangeThreshold } — abort if the merge would drop a
//              fraction of baseline strictly greater than this (default 0.7;
//              guards against a provider hiccup returning empty). Exact
//              value is a design open-question — parameterized + fixture-pinned.
//
// Output: { aborted, reason?, merged?, droppedCount, droppedFraction }
//
// Presence rules (design step 4):
//   - Non-baseline key: present iff ANY copy has it (union of adds; a key
//     absent from baseline can't be "deleted", so adds always survive).
//   - Baseline key with NO deleter: kept.
//   - Baseline key deleted by ALL copies that have an opinion: dropped.
//   - Baseline key with BOTH a keeper and a deleter (the same-key
//     add-vs-delete race): LWW by editedAt. Keep iff the freshest keeper's
//     editedAt is STRICTLY greater than the freshest deleter's editedAt
//     (a re-add/keep beats a stale delete). Otherwise the delete wins
//     ("a delete propagates everywhere" is the default; delete takes ties).
//
// Order rules (design step 5):
//   - Follow the most-recently-edited copy's order (LWW winner), filtered
//     to present keys.
//   - Then append present keys the winner lacks (added by others), in the
//     order they first appear when scanning the remaining copies by
//     editedAt DESC (id ascending as the deterministic tiebreak), each in
//     that copy's own order; any still-missing present key falls back to
//     baseline order.
//
// Determinism: editedAt ties are broken by `id` ascending everywhere a
// "winner" or scan order is chosen, so the output is a pure function of
// the input (required for cross-engine parity).
function mergePlaylist({ baseline, copies, options } = {}) {
  const base = Array.isArray(baseline) ? baseline : [];
  const cps = Array.isArray(copies) ? copies : [];
  const massChangeThreshold =
    options && typeof options.massChangeThreshold === 'number'
      ? options.massChangeThreshold
      : 0.7;

  const baseSet = new Set(base);

  // Sort copies by recency (editedAt DESC, id ASC tiebreak). Used both for
  // the order-winner and the append-scan. Stable, deterministic.
  const byRecency = cps.slice().sort((a, b) => {
    const ea = typeof a.editedAt === 'number' ? a.editedAt : 0;
    const eb = typeof b.editedAt === 'number' ? b.editedAt : 0;
    if (eb !== ea) return eb - ea;
    return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
  });

  // Each copy's key set for O(1) membership.
  const copySets = new Map();
  for (const c of cps) copySets.set(c, new Set(Array.isArray(c.keys) ? c.keys : []));

  // ── Presence decision ────────────────────────────────────────────
  // Build the set of keys present in the merged result.
  const present = new Set();

  // 1. Union of adds: any key in any copy that is NOT in baseline survives.
  for (const c of cps) {
    for (const k of copySets.get(c)) {
      if (!baseSet.has(k)) present.add(k);
    }
  }

  // 2. Baseline keys: keep/drop via the per-key rule above.
  for (const k of base) {
    const keepers = []; // copies that still have k
    const deleters = []; // copies missing k (deleted relative to baseline)
    for (const c of cps) {
      if (copySets.get(c).has(k)) keepers.push(c);
      else deleters.push(c);
    }
    let keep;
    if (deleters.length === 0) {
      keep = true; // nobody deleted
    } else if (keepers.length === 0) {
      keep = false; // everyone deleted (or had no opinion == missing)
    } else {
      // Same-key add-vs-delete race -> LWW. Keep only if a keeper is
      // strictly newer than every deleter; delete wins ties (propagate).
      const keepMax = Math.max(...keepers.map((c) => num(c.editedAt)));
      const delMax = Math.max(...deleters.map((c) => num(c.editedAt)));
      keep = keepMax > delMax;
    }
    if (keep) present.add(k);
    else present.delete(k);
  }

  // ── Mass-change guard (design step 6) ────────────────────────────
  // Drop is measured against baseline (a provider hiccup returns empty ->
  // removes all baseline keys -> merge would drop ~everything).
  let droppedCount = 0;
  for (const k of base) if (!present.has(k)) droppedCount++;
  const droppedFraction = base.length > 0 ? droppedCount / base.length : 0;
  if (base.length > 0 && droppedFraction > massChangeThreshold) {
    return {
      aborted: true,
      reason: 'mass-change',
      droppedCount,
      droppedFraction,
    };
  }

  // ── Order: LWW winner first, then others' adds ───────────────────
  const merged = [];
  const seen = new Set();
  const pushIfPresent = (k) => {
    if (present.has(k) && !seen.has(k)) {
      seen.add(k);
      merged.push(k);
    }
  };

  // Winner (most-recently-edited copy) order first.
  const winner = byRecency[0];
  if (winner) {
    for (const k of (Array.isArray(winner.keys) ? winner.keys : [])) pushIfPresent(k);
  }
  // Remaining copies by recency: append present keys not yet placed.
  for (let i = 1; i < byRecency.length; i++) {
    for (const k of (Array.isArray(byRecency[i].keys) ? byRecency[i].keys : [])) pushIfPresent(k);
  }
  // Any present key still unplaced (e.g. present via baseline but absent
  // from every copy's array — shouldn't happen, but keep deterministic):
  // append in baseline order, then any leftover in insertion order.
  for (const k of base) pushIfPresent(k);
  for (const k of present) pushIfPresent(k);

  return {
    aborted: false,
    merged,
    droppedCount,
    droppedFraction,
  };
}

function num(v) {
  return typeof v === 'number' ? v : 0;
}

module.exports = {
  canonicalTrackKey,
  mergePlaylist,
  // exported for targeted tests / reuse
  validIsrc,
  validMbid,
  normField,
};
