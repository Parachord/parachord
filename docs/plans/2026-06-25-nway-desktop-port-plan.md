<!--
Desktop-side working plan for the N-way multimaster playlist sync port.
Synthesized 2026-06-25 from the parachord-mobile design docs + Kotlin test
suites + current desktop sync code. Mobile (parachord-mobile @ nway-phase2-
migration) is the reference; parity is enforced ONLY by the shared JSON test
vectors. Tracker: Parachord/parachord#911.
-->

# Desktop N-Way Multimaster Playlist Sync — Implementation Plan

**Tracker:** Parachord/parachord#911 · **Reference:** parachord-mobile `nway-phase2-migration` (feature-complete) · **Working branch base:** `nway-key-unify-prepass`

> Mobile is the reference. Desktop gets a **separate JS implementation** (Electron can't compile Kotlin); parity is enforced **only** by shared JSON test vectors, never shared code. Two engines deliberately accepted — no WASM bridge.

---

## 1. Governing invariant + the real-writes gate

### The governing invariant (state it first, honor it everywhere)

> **Propagation must NEVER drop a track present in — or identity-matching a track in — any copy. Removal requires positive evidence that a copy *deliberately* deleted it. Absence from a fetch — identity mismatch, partial coverage, stale ancestor, failed/throttled request, catalog gap — is NOT a deletion.**

This is the lens for every step below. The Jun 22 2026 incident (a 9-track playlist collapsed to 3, propagated to Spotify) was exactly a violation: stale baseline under partial coverage + cross-service key drift produced *false union-removes*. Every mechanism in this plan exists to make that unreachable. A change that can't guarantee the invariant is not shippable behind real-writes.

### The two flags (the real-writes gate)

Two independent booleans, mirroring mobile's posture:

| Flag | electron-store key (proposed) | Default | Meaning |
|---|---|---|---|
| **Shadow readout** | `nway_shadow_enabled` | **OFF**, flip ON early | Compute the full reconcile (merge + materialize plan) and **log what it WOULD do**; push nothing, write no provider state. Safe to ship and run on a real library. |
| **Real writes** | `nway_propagate` | **OFF** | Arm actual provider add/remove/reorder writes + baseline/token persistence. |

**Sequencing rule (non-negotiable):**
1. Ship **shadow-mode first**. It reads live tracklists, runs the pipeline, emits a structured dry-run log (per playlist: detected-changed copies, merged result, per-provider add/remove/reorder ops, would-drop set, abort reasons).
2. **Arm `nway_propagate` only after a no-false-drop harness is green on a real library** — the desktop port of `NwayMaterializeTest` + `NwaySourceAuthorityTest` + the redesign's no-false-drop vectors, plus on-device shadow validation showing zero unexplained drops across the user's real playlists.
3. **Mixed-fleet gate:** `nway_propagate` additionally requires "all the user's clients support N-way." A canonical-source client and an N-way client on the same shared remote oscillate forever. Until both desktop and mobile are armed, leave writes OFF on both.

Shadow mode is also how we *recover confidence*, not just *prove correctness*: run it for days, diff its proposed merges against reality, look for any drop the invariant can't explain.

---

## 2. Where it lands — desktop file/function map

| Concern | File · symbol | Disposition |
|---|---|---|
| **Pure 3-way merge** | `sync-engine/playlist-merge.js` · `mergePlaylist`, `canonicalTrackKey`, `deriveNorm`, `stripRemasterSuffix`, `exceedsMassChangeThreshold` | **LANDED** — byte-parity locked to Kotlin `PlaylistMerge.kt`. Do **not** add authority/pending/confidence logic here. |
| **Key-unify pre-pass** | `sync-engine/playlist-key-unify.js` · `unifyTrackKeys`, `trackTiers` | **LANDED (in-flight PR)** — union-find over `{isrc,mbid,norm}`, representative rewrite. |
| **State model derivations** | `sync-engine/playlist-sync-state.js` · `buildBaseline`, `deriveChangeToken`, `deriveEditedAt`, `makeProviderSyncState`, `makePlaylistSyncState` | **LANDED** — pure. Add `nwayBaselineTrackKeys` export (see §3 Step 4 trap). |
| **State persistence** | `main.js` L5343–5391 · `getPlaylistSyncState`, `setPlaylistBaseline`, `setProviderSyncState`, `removePlaylistSyncState` + `sync-state` IPC | **LANDED, main-write-only, behavior-neutral.** The port *wires these up* — currently nothing calls them in production. |
| **Library diff (tracks/albums/artists)** | `sync-engine/index.js` · `calculateDiff`, `applyDiff`, `syncDataType` | **LEAVE INTACT.** `syncSources` union model is the existing library N-way primitive; mass-removal safeguard + `filterRemote` hook stay. |
| **Cadence / batching / push no-op** | `sync-engine/index.js` · `staggerPlaylistsForCycle`, `areOrderedIdListsEquivalent`, `canShortCircuitPlaylistUpdate` | **REUSE.** `canShortCircuit` gains an N-way arm (condition #4 canonical-source gate becomes wrong). |
| **Legacy playlist diff** | `sync-engine/index.js` · `calculatePlaylistDiff` | **REMOVE/SUPERSEDE** — no live caller; don't mistake it for production behavior. |
| **Collection tombstones** | `sync-engine/tombstones.js` (full module) | **LEAVE INTACT.** Collection-scoped. If in-playlist removal-intent is ever needed, add a *parallel* playlist-scoped tombstone — do NOT reuse this. |
| **Provider capabilities** | `sync-providers/types.js` + `spotify.js`/`applemusic.js`/`listenbrainz.js` capability objects | **AUGMENT (additive)** — add `trackRemoveMode`, `canReorder`, `supportsPlaylistDelete`, `supportsPlaylistRename`. Existing 5 booleans untouched. |
| **Provider write methods** | `sync-providers/*.js` · `updatePlaylistTracks`, `deletePlaylist`, `updatePlaylistDetails` | **REPLACE the destructive replace-all** with incremental add/remove primitives. Spotify needs a **new targeted DELETE-by-URI**. AM degrade refs (`amPutUnsupportedRef`, `amPatchUnsupportedRef`) **KEEP** as defensive downgrade. |
| **Existence probe** | `sync-providers/*.js` · new `remotePlaylistExists(externalId)` | **NEW** — single GET, 404⇒false, every other outcome⇒true. Spotify needs `playlistExists`; verify AM/LB. |
| **N-way orchestration** | **NEW** `sync-engine/playlist-materialize.js` + reconcile driver | `runNwayPropagation`, `propagateReconcilePlaylist`, `materializeToProvider`, authority/pending augmentation. Pure-testable core + thin `main.js` wiring. |
| **sync:start playlist loop** | `main.js` L6720–7069 (the *inlined* loop, NOT `calculatePlaylistDiff`) | **AUGMENT/REPLACE** the `isOwnPullSource` snapshot-compare last-writer branch (L6843 `hasTrackUpdates`, L7017 `stillHasUpdates`, L7033 rewrite) with a merge call once N-way enabled. |
| **Renderer four-piece propagation** | `app.js` · `handlePull` L43578, push loops L6649 + L11150, clear passes L6814 + L11276, mutators L20133/20154/20180 | **REPLACE** the timestamp-inference heart with baseline-vs-merge comparison. **PRESERVE** `runBackgroundSync` cadence/cancel/mutex scaffolding, IPC surface, `breathe()`/`yieldToIdle()`, `savePlaylistToStore` field-preservation. |
| **Create gateway** | `main.js` · `sync:create-playlist` L7379 (three-layer dedup) | **AUGMENT** stale-link branch with probe-first detach (dead-mirror reconcile). All N-way creates still route through here with `localPlaylistId`. |
| **Dead-mirror reconcile** | **NEW** `sync-engine/dead-mirror-reconcile.js` (`suspectedGone`, `confirmedGone`, `overrideAfterDetach`) + `main.js` glue | **NEW** pure module + probe-gated removal/detach in sync:start + create-dedup. |
| **Channel-override store** | `main.js` + renderer chip/badge rendering | **NEW** — desktop has no channel-override model; introduce `getPlaylistChannels`/`setPlaylistChannels` with empty-set-≠-null distinction. |

---

## 3. The phased work, in dependency order

Each step = a discrete reviewable PR. Phases 0–1 are landed; the key-unify pre-pass is the in-flight PR. Everything from "State wiring" onward is gated behind shadow-then-real flags.

### ✅ Phase 0 — Pure 3-way merge (LANDED, #912)
`sync-engine/playlist-merge.js` + `tests/fixtures/nway-merge/canonical-fixtures.json` (12 cases). Delete-always-wins, editedAt orders only. Green.

**Required follow-up test PR (small):** transcribe the 11/12 `PlaylistMergeTest.kt` assertions into `tests/sync/playlist-merge.test.js` calling `mergePlaylist(baseline, copies)` with `{id, tracks, editedAt}` and deep-equality asserting against `canonical-fixtures.json`. No merge code changes — verify the existing module satisfies every vector, especially `deletePropagates_evenIfAnotherCopyStillHasIt` (the data-loss guard) and the strict-`>` tie-break (a `>=` would diverge from Kotlin `maxByOrNull`).

### ✅ Phase 1 — N-way state model storage (LANDED, #913)
`sync_playlist_state` map in `main.js` + `playlist-sync-state.js` derivations. Additive, behavior-neutral, nothing reads/writes it live.

### 🔄 Step "Key-Unify" — cross-copy key-unification pre-pass (IN FLIGHT — ship this first; see §7)
**Build:** the staged `sync-engine/playlist-key-unify.js` (`unifyTrackKeys` union-find + `trackTiers`), the remaster-strip norm rule already in `playlist-merge.js`, `tests/fixtures/nway-merge/key-unify-fixtures.json` (8 cases), `tests/sync/playlist-key-unify.test.js`. 276 sync tests green.

**Data shape:** `unifyTrackKeys(lists)` where `lists = [baseline, copy1, …]`, each track `{isrc?, mbid?, norm}`; output is each list rewritten to representative keys (`isrc-` > `mbid-` > `norm-`, lexicographically-smallest value within the strongest present tier). Runs BEFORE `mergePlaylist`.

**Vectors to keep pinned (mirror Kotlin `NwayKeyUnify`):** norm↔mbid bridge (Guitarmageddon 60%-drop regression), mbid↔mbid variance, norm-bridge-allowed-when-ids-absent, norm-bridge-allowed-when-ids-agree, representative selection, post-unify merge invariance.

**⚠️ Flag for the human (readings disagree):** The `nway-key-consistency-design` doc specifies a **norm-bridge guard** — "norm may unify only when stronger ids are absent or already agree; NEVER override a confident isrc/mbid disagreement" (prevents live-vs-studio false-merge). **The current `unifyTrackKeys` implementation does NOT implement this guard** — it unions on *any* shared tier transitively, including norm, with no check that a confident isrc/mbid disagreement blocks the norm bridge. The doc itself flags the exact predicate as an open question needing its own fixtures. **Two distinct songs sharing `artist|title` but carrying different confident ISRCs would be wrongly merged** under the current code. Also note the documented **blank-norm collapse** (`norm='|'` from blank title+artist unifies distinct tracks). Decision needed: (a) author the guard + fixtures now and add to the in-flight PR, or (b) ship as-is and file a fast-follow with the explicit risk that the norm bridge can false-merge. Given the in-flight PR is otherwise ready, my recommendation is (b) — ship unify as-is, immediately file the guard as a fixture-pinned follow-up PR, and keep real-writes OFF (which they are) so a false-merge can't reach a remote. But the human should make the call.

> **PR boundary:** the in-flight branch is its own PR. Land it; everything below is new branches off `main` after it merges.

---

### Step 0 — State wiring + Phase-2 bootstrap migration (PR: "N-way state wiring")
**Build:** wire the dormant `sync_playlist_state` helpers. Add a startup migration next to `migrateSyncLinksFromPlaylists` (main.js L5756) that populates `sync_playlist_state` from `local_playlists`: `baseline = buildBaseline(tracks)`, one `providers` entry per `syncedTo`/`syncedFrom` mirror, `baselineSyncedAt = now`. Idempotent, no network. This is the "migration is a one-time bootstrap run desktop-side" piece.

**Files:** `main.js` (new migration fn + call site), `playlist-sync-state.js` (already exports `buildBaseline`).

**Vectors:** migration is idempotent (re-run = no-op); baseline derives via `canonicalTrackKey`; every `syncedTo`/`syncedFrom` provider gets a `providers[pid]` record.

**Behavior:** still behavior-neutral — nothing *reads* the state for reconciliation yet. This decouples the storage-population risk from the reconcile-logic risk.

---

### Step 1 — Provider capabilities + incremental write primitives (PR: "Provider capability surface + incremental writes")
**Build (additive capabilities):** add to `sync-providers/types.js` `SyncProviderCapabilities` and each live object:

```
trackRemoveMode: 'ByNativeId' | 'ByPosition' | 'Unsupported' | 'ReplaceOnly'
canReorder: boolean
supportsPlaylistDelete: boolean
supportsPlaylistRename: boolean
```

Per-provider declared values (the **honest worst case**):
- **Spotify:** `trackRemoveMode: 'ByNativeId'`, `canReorder: true`, delete/rename `true`.
- **Apple Music:** `trackRemoveMode: 'Unsupported'` (add-only — the post-degradation reality), `canReorder: false`, delete/rename `false`.
- **ListenBrainz:** `trackRemoveMode: 'ByPosition'` (clear-then-add maps to position removal), `canReorder: false`, delete/rename `true`. **Also add the missing `playlistFolders: false` key** (LB object currently has only 4 keys).

**Build (write primitives — never provider-id branching):** add to each provider:
- `fetchPlaylistTracks(externalId)` → tracks carrying **both** native ID and identity metadata (mbid/isrc/artist/title). Mostly exists; ensure identity fields present.
- `nativeIdOf(track)` → Spotify `spotifyUri`, AM `appleMusicId`, LB bare `recordingMbid`.
- `searchForTrackId(title, artist, album?, isrc?)` → native id or null (catalog miss ⇒ pending).
- `addPlaylistTracks(externalId, nativeIds[])` → append.
- `removePlaylistTracksByNativeId(externalId, nativeIds[])` — **Spotify needs a NEW targeted `DELETE /v1/playlists/{id}/tracks` by URI** (desktop currently only PUT/POST).
- `removePlaylistTracksByPosition(externalId, positions[])` — LB delete-by-index.
- `remotePlaylistExists(externalId)` → 404⇒false, all else⇒true. **Spotify needs a new `playlistExists`; verify AM/LB.**

**⚠️ KEEP** `amPutUnsupportedRef` / `amPatchUnsupportedRef` runtime kill-switches as a defensive downgrade — a static `'Unsupported'` is the declared guarantee, but the runtime probe still handles Apple changing behavior mid-session. **PRESERVE** never-throw-on-401 semantics for AM PATCH/DELETE (load-bearing — rename runs before track push), and **never retry-on-401** (it force-walks a phantom reauth).

**Vectors:** capability-shape tests per provider; `am_delete_endpoint_unsupported` (no throw, no retry); `am_patch_rename_unsupported_no_throw`; `lb_update_404_returns_remote_deleted_signal`; `lb_update_5xx_throws_not_silent`; `capabilities_serialized_verbatim` (sync:get-providers spreads the object, so new fields auto-flow to renderer).

---

### Step 2 — Incremental materialize executor (PR: "N-way materialize executor (shadow)")
This is the heart, ported from the Jun-23 **incremental-materialization** design and pinned by `NwayMaterializeTest` (the real-writes gate).

**Build:** NEW `sync-engine/playlist-materialize.js` (pure, testable) implementing the two-layer architecture:

**Layer A — Reconcile (identity-only, every cycle):**
- Compute canonical tracklist via `unifyTrackKeys` → `mergePlaylist(baseline, copies)`. Merge stays untouched.
- **Baseline advances to canonical EVERY cycle**, decoupled from materialization coverage. Export `nwayBaselineTrackKeys(tracks)` and advance via it unconditionally.
- **Merge-layer pending-augmentation (the CORRECTION two reviews missed):** a CHANGED provider's merge view is augmented with canonical keys it *lacks* **only where the hydration cache says they are PENDING**. Pending rule, precise and not invertible: **absent OR null `resolvedId` = pending (augment, treat as still-present); non-null `resolvedId` = confirmed-materialized, so absence IS a genuine deletion (do NOT augment).** `isProviderPendingForKey(providerId, key, keyToTrack)` + augmentation in `propagateReconcilePlaylist`.
- **Materialize TARGET is recomputed from UN-augmented keys** (augmentation only protects the merge view, not the write target — else the pending provider never gets re-filled).

**Layer B — Materialize (per-provider, non-destructive incremental diff):**
1. `fetchPlaylistTracks` → identity-keyed remote.
2. Diff remote vs canonical **BY IDENTITY KEY** (not native-id — that's the remaster-drift trap) → add/remove/optional-reorder.
3. Adds: unresolvable add (no native id this cycle) → SKIP + pending + stamp negative cache; never drives a removal. Hydration runs only for adds, inline-budgeted, **STOP on first 429**.
4. Removals dispatch strictly on `trackRemoveMode`: `ByNativeId`→DELETE-by-URI; `ByPosition`→delete-by-index; `Unsupported`→**no remove call, surface "N removals couldn't apply to {provider}", do not abort**; `ReplaceOnly`→replace-all only when add-coverage is full, else degrade to add-only.
5. **Total-wipe guard:** canonical length 0 ⇒ abort materialize (remote untouched). A 75% non-empty drop IS allowed. Only zero blocks.
6. Resolved adds → single `addPlaylistTracks`; removals → single remove call. **Never call `replacePlaylistTracks`** (every test asserts replaceCalls empty).
7. After all providers: replace local rows to merged canonical; advance baseline unconditionally.

**Negative/hydration cache:** keyed by **(identity key, providerId)** (NOT row-keyed — one resolution serves every playlist), persisted via electron-store. `{resolvedId?, lastAttemptAt, attempts}`. Native IDs persist null-only, never overwritten. Failure backs off 7d→30d. Inline budgeted + **background unmetered trickle** (mapped onto the existing `CrossResolverEnrichment` slow-trickle useEffect — unmetered, window-unfocused).

**Time-bounded breakers** (~5 min cooldown), NOT session kill-switches — one 429 pauses only that provider's hydration.

**Per-TARGET failure isolation + 404 self-heal:** wrap each provider's write in try/catch in `propagateReconcilePlaylist` (per-target, not per-playlist). On throw: log, skip that provider, **still advance local rows + baseline.** Then probe `remotePlaylistExists`: false (404)⇒clear the dead link + N-way token; true (transient)⇒**keep the link untouched** (bias hard toward not-clearing).

**Files:** new `sync-engine/playlist-materialize.js`; export `nwayBaselineTrackKeys` from `playlist-sync-state.js`; thin shadow-mode driver in `main.js`'s sync path.

**Fixtures/vectors to port (name them):** the full `NwayMaterializeTest` (13 cases) into `tests/sync/playlist-materialize.test.js` with a desktop `FakeProvider` mirroring the Kotlin harness:
1. partial-coverage-no-drop (headline incident guard), 2. incremental-convergence (the P1b-at-merge-layer gate), 3. add-heavy-80%-churn, 4. multi-master add+remove, 5. one-provider-throws-isolated, 6. throw-on-gone-mirror-clears-link, 7. throw-on-present-mirror-keeps-link, 8. removal-propagates-ByNativeId+ByPosition-but-Unsupported-keeps, 9. capability-dispatch-each-removeMode, 10. total-wipe-blocked-but-75%-allowed, 11. idempotency-×2-zero-ops, 12. identity-diff-remaster-drift-no-churn, 13. cooldown-no-re-search.

**Behavior:** SHADOW only — driver computes the plan and logs; no provider writes, no state persistence. This is the PR where `nway_shadow_enabled` becomes useful.

---

### Step 3 — Pull-source authority (PR: "N-way source authority (shadow)")
Ported from the Jun-24 design, pinned by `NwaySourceAuthorityTest` (7 vectors). **Reconciliation-layer inputs-shaping ONLY — `playlist-merge.js` stays bit-identical.**

**Build:** in the reconcile driver's augmentation step, before re-adding a changed mirror's pending-lacked baseline keys:
1. **Identify authoritative copy:** the pull-source provider's copy (read from `playlist.syncedFrom.resolver` — the desktop analogue of mobile's `sync_playlist_source` row; **use the source field, NOT the id-prefix**); OR `'local'` when `playlist.sourceUrl != null` (hosted XSPF); OR `null` (local-authored multimaster ⇒ augment-all, byte-identical to pre-change).
2. **Refinement A (mandatory):** grant drop-authority ONLY when that provider's `trackRemoveMode !== 'Unsupported'`. Add-only AM declines ⇒ augment-all (a transient partial AM fetch can't read as deletions).
3. **Skip augmenting the authoritative source copy** so its missing baseline keys read as genuine deletions in the union-remove.
4. **Refinement B (the shipped fix):** `authoritativeDropped = baselineRepr − authoritativeCopy.keys` (only when the authoritative copy is `changed`), **subtracted from EVERY mirror's `pendingLacked`** — a source deletion is final, no mirror resurrects it (this is what makes hosted-XSPF correct).
5. **Push-targets stay computed from UN-augmented copies** — never switch to augmented (else genuine catalog-gap fills stop re-attempting).

**Fixtures/vectors to port:** `NwaySourceAuthorityTest` V1–V7 into `tests/sync/playlist-source-authority.test.js`: V1 spotify-rotates-out-residue-drops (Daily Brew 519→40), V2 catalog-gap-on-AM-mirror-survives, V3 multimaster-local-authored-unchanged (inert no-authority path), V4 local-add-pending-kept (authority touches only baseline keys), V5 local-removal-still-on-source-still-drops (authority is additive, never overrides local removal), V6 AM-add-only-source-declined-augment-all, V7 hosted-XSPF-removal-drops-mirror-cannot-resurrect (Refinement B). **Plus the regression suite stays green:** all 12 merge vectors, all materialize cases (especially 1 & 2 which rely on `authoritativeDropped == ∅` for local-authored).

**Behavior:** SHADOW.

---

### Step 4 — Dead-mirror reconcile (PR: "Probe-gated dead-mirror detach")
Ported from the Jun-25 design. **NOT behind a feature flag** — it's a correctness/safety fix distinct from `nway_propagate`. (But land it after the materialize/authority work so the channel-override model and provider probes exist.)

**Build:** NEW `sync-engine/dead-mirror-reconcile.js`, three pure functions:
- `suspectedGone(localExternalIds, bulkRemoteIds)` = set difference.
- `confirmedGone(suspected, probeExists)` = subset with an **explicit `false`** probe; missing entry OR `true` ⇒ still-exists. **KEY PROPERTY: partial fetch with no confirming probe ⇒ EMPTY set.**
- `overrideAfterDetach(effectiveChannels, deadProvider)` = `effectiveChannels − deadProvider` (may be empty; caller persists empty-set, never null).

**Engine glue (`main.js`):** `confirmedGoneMirrors(provider, candidateExternalIds, fullRemoteIds)` = suspect → apply `DEAD_MIRROR_MASS_FLOOR = 30` (strict `>`; 30 still reconciles, 31 skips) → probe each suspect → confirmedGone.

**Two wiring sites:**
- **Removal (sync:start inbound loop):** compute removable set via `confirmedGoneMirrors` against the **FULL fetched remote list** (not selected subset), mass-floor short-circuit. Provider-prefixed pulled row confirmed-gone ⇒ delete row + clean sync_source. `local-*`/hosted-XSPF ⇒ **detach, not delete.** This *gates* the existing >70%-completeness `syncedFrom`-clearing pass (main.js L7089) behind per-externalId probes.
- **Detach (create-dedup stale-link branch, main.js L7379+):** at the stale-link branch, **probe BEFORE clearing**. Still-exists ⇒ keep link + skip (no re-create). Confirmed-404 ⇒ drop `sync_playlist_links[lpId][pid]` + N-way token + write channel-override excluding the dead provider; skip (no re-create).

**NEW channel-override store:** `getPlaylistChannels(lpId)` / `setPlaylistChannels(lpId, Set|null)`. **Empty-set (`' '` space-sentinel that round-trips to emptySet) ≠ null.** Null = "no override → default to all enabled"; empty = "syncs with nothing." Detach recomputes from the **current** override minus the dead provider (never from the full linked set — else it re-enables a user-disabled provider). Chips/badges read override-aware effective channels.

**Fixtures/vectors to port:** `DeadMirrorReconcileTest` (pure, 4) into `tests/sync/dead-mirror-reconcile.test.js`; `DeadMirrorReconcileIntegrationTest` B1/A1/A2/B3/B-mass(31)/A3/A4 as main-process integration tests. Make the probe **injectable** to close the Spotify-inline coverage gap the doc flags.

**Scope note (verbatim from the doc):** this is **NOT whole-playlist deletion propagation** — that was rejected. Manual per-device deletion of the local row stays manual; only mirror links/chips get reconciled.

---

### Step 5 — Reconcile orchestration + renderer integration (PR: "N-way reconcile wired into sync:start (shadow→real)")
**Build:** wire the materialize executor + authority shaping into the live sync path:
- **`canShortCircuitPlaylistUpdate` N-way arm:** condition #4 (`syncedFrom.resolver === providerId`) is wrong under N-way (every mirror is a real edge). Reframe: short-circuit only when **no provider's `changeToken` advanced** vs `sync_playlist_state.providers[pid]`. A snapshot match on the pull source no longer authorizes skipping a playlist a *second* mirror edited.
- **Replace the inlined sync:start last-writer branch** (main.js L6843 `hasTrackUpdates` / L7017 `stillHasUpdates` / L7033 rewrite): when ≥2 providers diverged from baseline, call the reconcile/merge instead of one-snapshot-wins. Drive local rewrite AND outbound push (via `materializeToProvider`) to every diverged mirror from the merge result. Call `setPlaylistBaseline` + `setProviderSyncState` on each successful write.
- **Replace the renderer four-piece** timestamp-inference (app.js): `handlePull`'s `locallyModified: hasOtherMirrors` becomes "feed pulled tracks as one of the N copies into merge"; the `hasGenuineLocalEdits = locallyModified && lastModified > syncedAt` push gate and `allSynced = syncedAt >= lastModified` clear gate become per-mirror "does merged ≠ this mirror's current?" against baseline+merge. **PRESERVE** `runBackgroundSync` cadence/staleness/cancel-on-focus/mutex (`backgroundSyncCancelledRef`, `backgroundSyncInFlightRef`, `playlistSyncInProgressRef`), `modifiedPlaylistIds` + `breathe()`/`yieldToIdle()`, `savePlaylistToStore` field-preservation. Keep the two push loops (L6649, L11150) in lockstep.
- **Migration normalize** (the one-time bootstrap's mirror-normalize step): push the local baseline to every linked mirror so all copies start identical — bounded one-time burst, **MUST respect the Spotify rate-limit gate + stagger.** AM caveat: append-only PUT means AM mirrors don't fully normalize on removals.

**Behavior:** ship in SHADOW (`nway_shadow_enabled` ON, `nway_propagate` OFF). Run the no-false-drop harness on a real library. **Arm `nway_propagate` only when green + mixed-fleet condition met** — a separate, tiny "flip the flag" change after validation, not part of this PR's reviewable diff.

---

### Echo-suppression (woven through Steps 2 & 5, not a separate PR)
**LOAD-BEARING.** After pushing, capture the provider's **NEW** token (Spotify `replacePlaylistTracks`/add-remove returns fresh `snapshot_id`; AM/LB re-read `last_modified` **post-push**) and store THAT via `setProviderSyncState`. Set `baseline = merged`, `baselineSyncedAt = now`, clear `locallyModified`. If you store the *pre-push* token, next cycle sees your own write as external and loops forever. The idempotency-×2 vector (materialize test 11) is the regression guard — test it hardest.

---

## 4. The traps register (one-liner each — the implementer must honor every one)

- **Pending-augmentation at the MERGE layer, not just the write layer:** a track a provider couldn't materialize (pending) is indistinguishable to `mergePlaylist` from a user deletion → delete-always-wins drops it (P1b reborn). Augment the changed provider's *merge view* with pending keys; recompute the *write target* from un-augmented keys.
- **Pending rule is precise, never invert it:** absent/null `resolvedId` = pending (augment); non-null = confirmed-materialized, so absence IS a real deletion (don't augment). Backwards either strands real deletions or resurrects deleted tracks.
- **Catalog-gap ≠ deletion:** a track permanently absent from one provider's catalog must never read as a deletion; it stays pending/augmented. (P1b — the under-covering provider is excluded from the removal computation.)
- **Source authority is gated on `trackRemoveMode !== 'Unsupported'`:** never grant drop-authority to add-only AM — its un-materialized adds AND transient partial fetches would read as deletions with no safety net (empty-mirror/total-wipe only catch collapse-to-zero).
- **`authoritativeDropped` gated on `authoritativeCopy.changed`, keyed off actual keys** (`baseline − ac.keys`), not the pending cache — an unchanged copy reused baseline and dropped nothing; combined with the empty-mirror rule this prevents a transient-empty source yielding `authoritativeDropped = entire baseline`.
- **Refinement B subtracts `authoritativeDropped` from EVERY mirror's pending re-add** — source-skip alone misses hosted-XSPF (there the bug is a streaming *mirror* resurrecting an XSPF-removed key).
- **Authority is additive-only, never overrides a LOCAL removal:** `local` is never augmented, always votes-remove; a user-removed key drops even if the source still lists it.
- **Union-adds are untouchable:** authority touches only baseline keys; a brand-new local-only add (non-baseline), even un-hydratable on every mirror, is never a drop candidate.
- **Partial-fetch floor:** a *changed* copy whose fetch fails ⇒ skip the WHOLE playlist this cycle (never diff an unfetched copy as empty).
- **Total-wipe-only mass guard:** only canonical→0 aborts; a 75% non-empty drop flows. Do NOT reintroduce a coverage-based threshold (the >25% coverage-SKIP conflated "churned a lot" with "couldn't resolve a lot" and blocked legit churn — Guitarmageddon 3/6, SiriusXMU 86/244).
- **Don't delete the old coverage-SKIP / fill-pending machinery until the new harness is green** — keep the safety net until its replacement is proven.
- **Tombstone clear-only-on-user-re-add:** Collection tombstones re-arm on every confirming sync hit; `clearTombstones` runs only on user re-add; `pruneExpired` is startup-only (one-shot, never in the sync loop — races re-arm writes). `externalId`-keyed, not `id`-keyed. Leave the module intact.
- **Echo-suppression post-push token capture:** store the provider's token AFTER your push; pre-push token ⇒ infinite loop.
- **Four-piece mirror propagation — preserve the contract while replacing the mechanism:** the same-timestamp trick (`handlePull` sets `lastModified === syncedAt`), provider-scoped (not blanket) `syncedFrom` guard, `relevantMirrors` excludes source + filters on `externalId` before `>=`, and inline-flag persistence in the saved object — all must be either preserved or explicitly superseded; the two push loops stay in lockstep.
- **Dead-mirror probe contract:** only a definitive 404 returns false; 429/auth/transport/cooldown ⇒ true (a wrongly-cleared link recreates a live remote as a duplicate). `confirmedGone` returns empty under partial fetch. Mass-floor = 30 strict-`>`. Empty channel-override is space-sentinel, never null.
- **#846 runaway-duplication:** a thrown/empty `fetchPlaylists` must NEVER be treated as remote-deleted — preserve link, return retryable. (Produced 6397 fake playlists.) Any N-way is-mirror-alive check inherits this.
- **Never call `provider.createPlaylist` outside `sync:create-playlist`; always pass `localPlaylistId`.** N-way outbound creates route through the three-layer dedup gateway or the id-link layer + `setSyncLink`-on-success are skipped.
- **Never drop** `syncedTo`/`syncedFrom`/`syncSources`/`hasUpdates`/`locallyModified`/`lastModified`/`sourceUrl`/`source` on any save; `sync_playlist_links` and `sync_playlist_state` are **main-process-write-only** (the renderer reconciler must not write them directly).
- **`syncedFrom` heal stays:** `healImportedSyncedFromMismatch` treats the `${provider}-${externalId}` id prefix as ground truth and nulls `snapshotId` on repair; keep an N-way silent-adopt arm or healed playlists flag has-updates forever. Never construct a `pid-` id for a playlist not imported from that provider.
- **`finalizeCancelled` partial-safe:** mid-loop baseline/state writes must not advance for playlists not yet visited; cancel still bumps `lastSyncAt`, skips the `syncedFrom`-clearing pass.

---

## 5. Provider constraints to encode as capabilities

| Provider | `trackRemoveMode` | `canReorder` | delete / rename | Encoded constraints |
|---|---|---|---|---|
| **Spotify** | `ByNativeId` | `true` | true / true | **Shared `client_id`** across the fleet ⇒ aggressive abuse window. Inline hydration STOPS on first 429; honor the shared RateLimitGate per-cycle budget; **escalating cooldown** on consecutive throttle errors (mirror `globalResolverLimiter`). **Verify-by-id** after writes: confirm the new `snapshot_id` (the echo-suppression anchor). Targeted `DELETE /v1/playlists/{id}/tracks` by URI is NEW. |
| **Apple Music** | `Unsupported` (add-only) | `false` | false / false | PUT/PATCH/DELETE on library resources return 401/403/405 (documented policy). **Never throw, never retry-on-401** (phantom reauth). Removals never propagate to AM under any model — surface "N removals couldn't apply," accept physical residue (user clears in Music app). Keep `amPutUnsupportedRef`/`amPatchUnsupportedRef` as defensive runtime downgrade. Catalog API edge-throttled — route per-track catalog calls through the limiter; time-bounded breaker, not session kill-switch. |
| **ListenBrainz** | `ByPosition` | `false` | true / true | **Clear-then-add** (no native PUT replace) — maps to ByPosition removal. **Complete-list-or-abort:** non-404 fetch failure THROWS (must not proceed with `currentLen=0` and duplicate); 404 ⇒ signal `remote-deleted`. **MBID ≥ 0.7** required per track (mapper fallback); unresolved collected into `unresolvedTracks`, MBID-or-skip. Native id = bare recording MBID. Auth token from the **scrobbler-side config**, not the meta-service config. |

`ReplaceOnly` is reserved (future wipe-only provider): replace-all ONLY when add-coverage is full, else degrade to add-only — a partial replace-all is exactly the destructive failure mode the redesign eliminates. The shared executor dispatches purely on `trackRemoveMode` + `canReorder` and **never learns a provider's name.**

---

## 6. Open questions / decisions for the human

1. **Norm-bridge guard (highest priority — see §3 Key-Unify):** the in-flight `unifyTrackKeys` does NOT implement the doc's guard ("norm never overrides a confident isrc/mbid disagreement"). Ship as-is + fast-follow, or add the guard + fixtures to the in-flight PR now? The doc itself leaves the exact predicate open. (Recommendation: ship + immediate fast-follow, since real-writes are OFF; your call.) Also: do we add a blank-norm bridge guard now or wait for it to bite real data?
2. **Where shadow readout runs / surfaces:** main-process reconcile driver logging to console + an electron-store dry-run record? A renderer DevTools-visible diagnostic (like the announcements `📢` logs)? A dev-only "N-way dry-run" UI panel (mobile has one)? Recommendation: structured `console.log` + a rolling `sync_nway_shadow_log` electron-store key the human can inspect, no UI for v1.
3. **How the two flags surface:** hidden electron-store keys flipped via DevTools (like other dev gates), or a Sync-settings toggle? Recommendation: DevTools-only for `nway_shadow_enabled`/`nway_propagate` until armed fleet-wide; no user-facing toggle (matches "enablement gated on all clients support N-way," which the user can't self-assert).
4. **Baseline storage — already chosen, confirm:** `sync_playlist_state` (main-write-only electron-store map) is the desktop analogue of mobile's `sync_playlist_baseline` + `sync_playlist_nway` SQLite tables. **ISRC persistence:** mobile's open question (column vs baseline-encoded TrackKeys) — desktop's `buildBaseline` collapses to a single representative key string per track. For the redesign's "persist ISRC as cross-service ancestor key," the desktop baseline already keys ISRC-first via `canonicalTrackKey`, but does it store the *full* `{isrc,mbid,norm}` key-set or just the collapsed representative? **The key-unify pre-pass needs full key-sets to reconstruct tiers** — confirm whether `sync_playlist_state.baseline` should store key-sets (additive Phase-1-style change) or re-derive tiers at reconcile time. This is a genuine schema decision that affects whether the bridge works on real data.
5. **Channel-override model:** desktop has no first-class channels/chips. Introduce it minimally (just enough for detach to hide a badge + prevent push-loop recreate), or build the full effective-channels/override-allowlist model mobile has? Recommendation: minimal for Step 4, expand if N-way UI needs it.
6. **Fixture re-vendor cadence:** `canonical-fixtures.json` + `key-unify-fixtures.json` are vendored from parachord-mobile. How do we keep them in lockstep when Kotlin changes — manual re-vendor per PR, or a CI check that fetches the mobile fixtures and diffs? The merge/unify/materialize vectors are the *only* thing preventing cross-engine oscillation; recommend a CI guard.
7. **Mobile-parity tickets:** per the project's mobile-parity policy, any desktop-side decision the Kotlin side must mirror (the norm-bridge guard predicate, the ISRC-persistence schema choice, the channel-override empty-set encoding) should get a parachord-mobile ticket. Offer to file these once decisions 1 & 4 land.

---

## 7. Recommended next concrete action

**Ship the in-flight key-unify PR first** — it's ready (276 sync tests green) and is the Phase-4 prerequisite that unblocks everything downstream. Before opening it:

1. **Resolve decision #1** (norm-bridge guard). My recommendation: **land the PR as-is** (union-on-any-tier), and in the same PR add a one-line code comment + a `TODO(parachord#911)` flagging that the norm-bridge guard is unimplemented and the false-merge risk is accepted *only because real-writes are OFF*. Then immediately file the guard as the next PR with its own fixtures. This keeps the ready PR moving without silently shipping a known false-merge into a path that could later reach a remote.
2. **Add the Phase-0 merge test transcription** (`tests/sync/playlist-merge.test.js`) if not already present — it's tiny, has no code risk, and locks the byte-parity contract the whole port rests on.
3. **File the parachord-mobile parity ticket** for the key-unify contract (the readings explicitly call this a shared-invariant change), referencing the desktop PR and reproducing the `unifyTrackKeys` API surface + representative-precedence rule verbatim so the Kotlin side has a target.

Then proceed in strict dependency order: **Step 0 (state wiring + bootstrap) → Step 1 (capabilities + primitives) → Step 2 (materialize, shadow) → Step 3 (authority, shadow) → Step 4 (dead-mirror) → Step 5 (orchestration, shadow) → arm `nway_propagate` only after the no-false-drop harness is green on a real library and the mixed-fleet condition holds.**

**Relevant files:** `/Users/jherskowitz/Development/parachord/parachord-desktop/sync-engine/playlist-merge.js`, `/Users/jherskowitz/Development/parachord/parachord-desktop/sync-engine/playlist-key-unify.js`, `/Users/jherskowitz/Development/parachord/parachord-desktop/sync-engine/playlist-sync-state.js`, `/Users/jherskowitz/Development/parachord/parachord-desktop/sync-engine/index.js`, `/Users/jherskowitz/Development/parachord/parachord-desktop/sync-engine/tombstones.js`, `/Users/jherskowitz/Development/parachord/parachord-desktop/sync-providers/types.js` (+ `spotify.js`/`applemusic.js`/`listenbrainz.js`), `/Users/jherskowitz/Development/parachord/parachord-desktop/main.js` (sync:start L6720–7069, create-dedup L7379, state helpers L5343–5391), `/Users/jherskowitz/Development/parachord/parachord-desktop/app.js` (handlePull L43578, push loops L6649 + L11150). **New files to create:** `sync-engine/playlist-materialize.js`, `sync-engine/dead-mirror-reconcile.js`, and test files under `tests/sync/` with fixtures under `tests/fixtures/nway-merge/`.