# N-way merge — shared cross-engine test vectors

These JSON fixtures are the **parity contract** between the desktop JS merge
(`tests/helpers/playlist-merge.js`) and the mobile Kotlin merge
(`shared/commonMain`, parachord-mobile). The pure 3-way merge is a
deterministic function; authoring the fixtures ONCE and running the **same
files** against both engines is what proves they can't drift apart and start
fighting over the same remote playlists.

Design: `docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md`
(parachord-mobile). Trackers: Parachord/parachord#911, parachord-mobile#268.

## Status / location

These live in the desktop repo for now and are the **source of truth**. The
mobile repo should vendor them in (copy or submodule) and run its Kotlin merge
against the identical files. The permanent shared home is a design open
question (#911) — until settled, treat this directory as canonical and mirror
changes into mobile in the same PR pair.

## Fixture format

```jsonc
{
  "name": "kebab-case-id",                 // required, unique
  "description": "one line",               // required
  "baseline": ["isrc-A", "isrc-B"],        // ordered canonical keys (3-way ancestor)
  "copies": [
    {
      "id": "spotify",                     // stable label; deterministic tiebreak on editedAt ties
      "editedAt": 1000,                    // comparable number (epoch ms); higher = newer
      "keys": ["isrc-A", "isrc-B", "isrc-C"] // this copy's CURRENT ordered tracklist
    }
  ],
  "options": { "massChangeThreshold": 0.7 }, // optional; default 0.7
  "expected": {
    "aborted": false,
    "merged": ["isrc-A", "isrc-B", "isrc-C"]  // present when aborted=false
    // when aborted=true: { "aborted": true, "reason": "mass-change" }
  }
}
```

Keys are already-derived canonical keys (`isrc-…` / `mbid-…` / `norm-…`); the
key-derivation function (`canonicalTrackKey`) has its own unit coverage and is
not exercised by these merge fixtures.

## Rules these fixtures pin (must match on both engines)

- **Union of adds** — concurrent adds on different copies both survive.
- **Delete propagates** — a baseline key dropped by any copy is removed by
  default ("a delete propagates everywhere"); delete wins editedAt ties.
- **Re-add beats stale delete** — for a baseline key with both a keeper and a
  deleter, the keeper wins iff its freshest `editedAt` is **strictly greater**
  than the deleter's.
- **Order = LWW** — the most-recently-edited copy's order is followed (filtered
  to present keys); keys added by others are appended in recency-then-id scan
  order; baseline order is the final fallback.
- **Determinism** — `editedAt` ties break by `id` ascending, everywhere.
- **Mass-change abort** — if the merge would drop a fraction of baseline
  strictly greater than `massChangeThreshold`, it aborts (no merged output).
