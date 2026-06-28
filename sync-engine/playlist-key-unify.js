// N-way cross-copy KEY UNIFICATION pre-pass (Phase 4 prerequisite).
//
// Design: docs/plans/2026-06-21-nway-key-consistency-design.md (parachord-
// mobile). Tracker: Parachord/parachord#911.
//
// SYNC / CROSS-ENGINE PARITY (load-bearing): runs BEFORE the merge. Shadow
// validation on a real 148-playlist library proved that the SAME track gets
// different canonical keys across services (norm- vs mbid- for un-enriched
// vs MBID-native; mbid- vs mbid- recording variance; and the confirmed
// data-loss vector where a different recording MBID AND a drifted title left
// only the ISRC to bridge). Exact-equality on a single key produced false
// 'removes'. This pre-pass rewrites each copy's tracklist to canonical
// REPRESENTATIVE keys so the same song matches across services; the
// fixture-pinned delete-wins/order-LWW merge then runs UNCHANGED on the
// representatives.
//
// The Kotlin engine (parachord-mobile shared/.../sync) implements the
// identical algorithm; parity is proven by the shared vectors
// tests/fixtures/nway-merge/key-unify-fixtures.json (vendored verbatim from
// parachord-mobile docs/nway-key-unify-fixtures.json). Pure function — no
// live sync wiring (dormant until the reconciliation redesign + no-false-
// drop harness land; real writes stay off, matching mobile).

const { validIsrc, validMbid, deriveNorm } = require('./playlist-merge');

// ─────────────────────────────────────────────────────────────────────
// unifyTrackKeys
// ─────────────────────────────────────────────────────────────────────
//
// Input: `lists` = [baseline, copy1, copy2, …], each an array of tracks
//   { isrc?, mbid?, norm } — already normalized (isrc validated+UPPER or
//   null; mbid trim+lower or null; norm '<artist>|<title>' lower+trim,
//   always present). Use `trackTiers()` below to derive this shape from a
//   raw track object.
//
// Match (two-phase norm-bridge guard, parachord#911 P3 —
//   docs/plans/2026-06-28-nway-norm-bridge-guard.md, mobile#289):
//   1. STRONG phase (unconditional): union by equal ISRC, then equal MBID.
//      A shared MBID may legitimately span two DIFFERENT ISRCs (same recording,
//      reissue/market re-registration) → they become ONE component.
//   2. NORM phase (guarded), per norm group, counting the COMPONENTS that carry
//      an ISRC after the strong phase (NOT distinct ISRC values):
//        - cIsrc ≤ 1 → stronger ISRC identity is absent or agrees → union the
//          whole group (keeps norm↔isrc / norm↔mbid cross-service dedup).
//        - cIsrc ≥ 2 → ≥2 disagreeing ISRC identities → NEVER collapse via norm;
//          union only the ISRC-free (mbid-only + pure-norm) nodes among
//          themselves (leaves each strong component intact; transitivity-safe).
//   MBID DISAGREEMENT NEVER BLOCKS the norm bridge — recording-MBID varies for
//   the same song across services/enrichment; blocking it re-introduces the
//   2026-06-22 false-REMOVE data-loss class. Only ISRC is a hard discriminator.
// Representative: per equivalence class, the strongest tier PRESENT in the
//   class — `isrc-<v>` else `mbid-<v>` else `norm-<v>` — using the
//   lexicographically-smallest value within that tier (deterministic
//   regardless of input order). A singleton yields exactly its single
//   canonical key (backward-compatible with canonicalTrackKey).
// Output: each input list rewritten to representative keys, order + length
//   preserved (a within-list collision repeats the same repr; the merge
//   dedups downstream).
//
// CROSS-ENGINE CONTRACT: tests/fixtures/nway-merge/key-unify-fixtures.json (16
//   cases, vendored verbatim from parachord-mobile docs/nway-key-unify-
//   fixtures.json) is the source of truth; Kotlin NwayKeyUnify.unifyTrackKeys
//   must produce identical output on every case. Two behaviors are explicit in
//   the fixture _semantics but NOT yet fixture-pinned — both implemented here
//   per the text: (a) "component carries an ISRC" is GLOBAL (an ISRC-bearing
//   member outside the evaluated norm group still counts, via the post-strong
//   snapshot below); (b) the weak set is ISRC-FREE (mbid-only nodes join it),
//   not pure-norm-only.
//
// @param {Array<Array<{isrc?:string|null, mbid?:string|null, norm:string}>>} lists
// @returns {string[][]}
function unifyTrackKeys(lists) {
  const safe = Array.isArray(lists) ? lists : [];

  // Flatten, tracking (listIdx, pos) for the rewrite.
  const tracks = [];
  safe.forEach((list, li) => {
    (Array.isArray(list) ? list : []).forEach((t, pi) => {
      tracks.push({
        isrc: t && typeof t.isrc === 'string' && t.isrc ? t.isrc : null,
        mbid: t && typeof t.mbid === 'string' && t.mbid ? t.mbid : null,
        // norm is "always present" per the contract; default to '' defensively.
        norm: t && typeof t.norm === 'string' ? t.norm : '',
        listIdx: li,
        pos: pi,
      });
    });
  });

  // Union-find over track indices.
  const parent = tracks.map((_, i) => i);
  const find = (x) => {
    let r = x;
    while (parent[r] !== r) r = parent[r];
    while (parent[x] !== r) { const n = parent[x]; parent[x] = r; x = n; }
    return r;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  // ── Phase 1: STRONG (unconditional) — union equal ISRC, then equal MBID.
  const byIsrc = new Map();
  tracks.forEach((t, i) => {
    if (!t.isrc) return;
    if (byIsrc.has(t.isrc)) union(i, byIsrc.get(t.isrc));
    else byIsrc.set(t.isrc, i);
  });
  const byMbid = new Map();
  tracks.forEach((t, i) => {
    if (!t.mbid) return;
    if (byMbid.has(t.mbid)) union(i, byMbid.get(t.mbid));
    else byMbid.set(t.mbid, i);
  });

  // Snapshot the post-strong-phase component of each track, and whether that
  // component carries an ISRC ANYWHERE (global — an ISRC-bearing member in a
  // different norm group still makes the component an ISRC identity). The guard
  // decisions below read this snapshot, never live find(), so a norm-phase union
  // in one group can't shift another group's component count (order-independent,
  // matching the _semantics "components that exist after the strong phase").
  const strongRoot = tracks.map((_, i) => find(i));
  const compHasIsrc = new Set();
  tracks.forEach((t, i) => { if (t.isrc) compHasIsrc.add(strongRoot[i]); });

  // ── Phase 2: NORM (guarded), per norm group.
  const groups = new Map(); // norm -> [trackIdx]
  tracks.forEach((t, i) => {
    if (!t.norm) return;
    if (!groups.has(t.norm)) groups.set(t.norm, []);
    groups.get(t.norm).push(i);
  });
  for (const members of groups.values()) {
    // cIsrc = distinct post-strong components in this group that carry an ISRC.
    const isrcRoots = new Set();
    for (const i of members) {
      if (compHasIsrc.has(strongRoot[i])) isrcRoots.add(strongRoot[i]);
    }
    if (isrcRoots.size <= 1) {
      // Stronger identity absent or agrees → union the whole group.
      for (let k = 1; k < members.length; k++) union(members[0], members[k]);
    } else {
      // ≥2 disagreeing ISRC identities → bridge only the ISRC-free nodes among
      // themselves; leave each strong component intact. "ISRC-free" is a
      // COMPONENT property, not the node's own field: an mbid-only node whose
      // component carries an ISRC (bridged via MBID in the strong phase) already
      // belongs to a strong identity, so it must NOT act as a norm bridge —
      // including it would drag a pure-norm node into that conflicting ISRC.
      const weak = members.filter((i) => !compHasIsrc.has(strongRoot[i]));
      for (let k = 1; k < weak.length; k++) union(weak[0], weak[k]);
    }
  }

  // Representative per class.
  const reprByRoot = new Map();
  const membersByRoot = new Map();
  tracks.forEach((_, i) => {
    const r = find(i);
    if (!membersByRoot.has(r)) membersByRoot.set(r, []);
    membersByRoot.get(r).push(i);
  });
  for (const [root, members] of membersByRoot) {
    const isrcs = [];
    const mbids = [];
    const norms = [];
    for (const i of members) {
      if (tracks[i].isrc) isrcs.push(tracks[i].isrc);
      if (tracks[i].mbid) mbids.push(tracks[i].mbid);
      norms.push(tracks[i].norm);
    }
    let repr;
    if (isrcs.length) repr = `isrc-${minStr(isrcs)}`;
    else if (mbids.length) repr = `mbid-${minStr(mbids)}`;
    else repr = `norm-${minStr(norms)}`;
    reprByRoot.set(root, repr);
  }

  // Rewrite, preserving each list's order + length.
  const out = safe.map(() => []);
  tracks.forEach((t, i) => {
    out[t.listIdx][t.pos] = reprByRoot.get(find(i));
  });
  return out;
}

function minStr(arr) {
  let m = arr[0];
  for (const s of arr) if (s < m) m = s;
  return m;
}

// Derive the unify input tiers from a raw track object. Mirrors
// canonicalTrackKey's tier extraction (isrc validated+UPPER, recording mbid
// trim+lower, norm = remaster-stripped `<artist>|<title>`). This is the
// bridge a caller uses to build the `lists` input from real tracks.
// @returns {{isrc: string|null, mbid: string|null, norm: string}}
function trackTiers(track) {
  return {
    isrc: validIsrc(track && track.isrc),
    mbid: validMbid(track && track.recordingMbid) || validMbid(track && track.mbid),
    norm: deriveNorm(track && track.artist, track && track.title),
  };
}

module.exports = { unifyTrackKeys, trackTiers };
