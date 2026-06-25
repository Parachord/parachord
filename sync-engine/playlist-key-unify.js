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
// Match: two tracks are the SAME if they share ANY tier value (isrc OR mbid
//   OR norm), transitively (union-find).
// Representative: per equivalence class, the strongest tier PRESENT in the
//   class — `isrc-<v>` else `mbid-<v>` else `norm-<v>` — using the
//   lexicographically-smallest value within that tier (deterministic
//   regardless of input order). A singleton yields exactly its single
//   canonical key (backward-compatible with canonicalTrackKey).
// Output: each input list rewritten to representative keys, order + length
//   preserved (a within-list collision repeats the same repr; the merge
//   dedups downstream).
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

  // Union any two tracks sharing a tier value (isrc / mbid / norm).
  const firstByTier = new Map(); // `${tier}:${value}` -> first track index
  tracks.forEach((t, i) => {
    const pairs = [['isrc', t.isrc], ['mbid', t.mbid], ['norm', t.norm]];
    for (const [tier, val] of pairs) {
      if (val == null || val === '') continue;
      const key = `${tier}:${val}`;
      if (firstByTier.has(key)) union(i, firstByTier.get(key));
      else firstByTier.set(key, i);
    }
  });

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
