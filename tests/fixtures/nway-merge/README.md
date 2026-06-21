# N-way merge — shared cross-engine test vectors

`canonical-fixtures.json` is **vendored verbatim** from the source-of-truth in
parachord-mobile: `docs/nway-playlist-merge-fixtures.json` (commit `ff03511`).

It is the **parity contract** between the desktop JS merge
(`tests/helpers/playlist-merge.js`) and the mobile Kotlin merge
(`shared/.../sync/PlaylistMerge.kt`). The pure 3-way merge is deterministic;
running the SAME file against both engines is what proves they can't drift and
start fighting over the same remote playlists. Mobile's `PlaylistMergeTest` is a
1:1 transcription of these cases; `tests/sync/nway-merge.test.js` runs the same
cases through the JS merge.

Design: `docs/plans/2026-06-21-nway-multimaster-playlist-sync-design.md`
(parachord-mobile). Trackers: Parachord/parachord#911, parachord-mobile#268.

## This is vendored — do not edit here

Edit the canonical file in parachord-mobile, then re-vendor:

```
gh api "repos/Parachord/parachord-mobile/contents/docs/nway-playlist-merge-fixtures.json?ref=<sha>" \
  | python3 -c "import json,base64,sys; print(base64.b64decode(json.load(sys.stdin)['content']).decode())" \
  > tests/fixtures/nway-merge/canonical-fixtures.json
```

A change to the merge rules must update the Kotlin engine, the JS engine, and
this file together — otherwise the two clients diverge.

## File shape

```jsonc
{
  "_about": "...",
  "_semantics": { "presence": "...", "timestamps": "...", "order": "...", "key_derivation": "..." },
  "cases": [
    {
      "name": "kebab_case_id",
      "baseline": ["a", "b"],                          // ordered canonical keys (3-way ancestor)
      "copies": [{ "id": "spotify", "tracks": ["a","b","x"], "editedAt": 1 }],
      "expected": ["a", "b", "x"]                      // merged ordered tracklist (always an array)
    }
  ]
}
```

`expected` is the merged array directly — the pure merge has no abort/guard
return; the mass-change guard is caller-side (Phase 1+) and not exercised here.
