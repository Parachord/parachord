# Migration: legacy sync → N-way sync (cross-platform)

**Status:** proposal · **Date:** 2026-06-28 · **Epic:** parachord#911
**Applies to:** parachord-desktop + parachord-mobile (Android + iOS). This doc is the shared contract; both platforms implement the same model.

## The problem in one paragraph

Two sync engines exist with **no mutual exclusion** and they write the **same shared remotes** (Spotify / Apple Music / ListenBrainz playlists) and the same local keys (`local_playlists`, `sync_playlist_links`). New mobile clients ship on the new (N-way) engine; existing desktop + mobile run the legacy engine. The instant a new-sync client and an old-sync client both sync a playlist that mirrors to the same remote, you are in **mixed mode** — and you cannot force every client of a user to upgrade simultaneously. Therefore the migration cannot be a flip-the-switch cutover; it must survive a transition window where both engines operate on shared remotes.

## Decision: yes to a per-client toggle — with three states, not two

A per-platform "use new sync" toggle is the correct mechanism, because the engine's baseline state (`sync_playlist_state`) is **local to each client** and clients upgrade independently. But a binary legacy/new toggle skips the validation bridge and gives no safe coexistence story. Use a single per-client setting `sync_engine_mode`:

| Mode | Legacy engine | N-way engine | Writes to remotes |
|---|---|---|---|
| `legacy` (default today) | drives | dormant | legacy only |
| `shadow` | drives | computes + logs (dryRun) | legacy only |
| `new` | **stands down** | drives (propagate) | N-way only |

- `shadow` is the per-client validation step: the new engine produces its reconcile plan against the user's real data and logs it, while legacy still owns writes. Zero risk, full observability.
- `new` requires a **mutual-exclusion guard that does not exist yet**: the legacy push/create loops (main.js `sync:start` inbound loop + the two renderer push loops; the Kotlin equivalents on mobile) must early-return when `sync_engine_mode === 'new'`. Without this guard, `new` is unsafe — both engines write at once.

New mobile clients default to `new` (no legacy state to migrate). Existing clients default to `legacy` and opt in.

## The hard prerequisite: coexistence-safety on shared remotes

Because the mobile launch forces mixed mode, the new engine must **converge with a legacy client writing the same remote**, not just with other new clients. Required properties:

1. **Inbound-drift tolerance.** When a legacy client pushes to the remote, the new engine must see the snapshot/trackCount change as legitimate inbound drift and reconcile it through the 3-way merge — never treat it as corruption. The N-way core is designed for this (snapshot/baseline drift detection + `missingStreak` gate + partial-fetch floor), but it must be **validated against real legacy-induced churn**, not just synthetic tests.
2. **Identity parity across engines — the top audit item.** Legacy matches tracks one way; N-way keys them by `{isrc, mbid, norm}` tiers. If they disagree on "same track," you get duplicate adds or false removes on the shared remote. The two identity models must agree, or the legacy client's writes will look like deletes+adds to N-way. Audit `confidence-scoring` / the legacy match vs `playlist-merge.js` tier keys before any `new`-mode writes.
3. **No-worse-than-today guarantee.** Concurrent local edits on two clients are last-write-wins under legacy↔legacy today. Mixed legacy↔new must be no worse: where N-way participates it can do better, but a legacy participant's full-replace PUT can still clobber — that is acceptable (it is the status quo), as long as identity parity holds so it is a clobber, not a duplication.

If coexistence-safety cannot be guaranteed, the fallback is account-level coordination (below), which is heavier and has its own failure mode.

## Migration UX: preview → approve or report (no telemetry)

We do **not** build passive telemetry. Instead, each user validates their own migration interactively, and divergences self-surface as consensual, user-initiated bug reports. The user in front of the app is the validator; the maintainer learns about problems only when a user looks at a wrong-looking diff and chooses to send it.

**The flow ("Use new sync" toggle):**

1. User flips **Use new sync** (Developer Tool / sync settings).
2. The client runs `runNwayShadowReconcile()` (dry-run, zero writes) and renders the full plan as a **human-readable diff** — per playlist, per mirror: tracks that would be **added** and **removed**, plus any safety aborts. Most users on a synced fleet see *"No changes needed"* (every playlist `noop`), because they are already converged.
3. The user picks one of three actions:
   - **Accept changes** → set `sync_engine_mode = 'new'`: legacy stands down, N-way takes over writes. (If the plan was `noop`, the first real cycle writes nothing — a true zero-risk cutover.)
   - **Report a problem** → package the diff into a diagnostic the user can see and send (see below). Does **not** cut over; stays on `legacy`.
   - **Cancel** → stays on `legacy`. No state changed.

**Rendering the diff.** The reconcile result already carries it: `status:'would-push'` → `perTarget:[{providerId, addKeys, removeKeys}]` + `mergedSize`; `total-wipe-abort` / `partial-abort` are safety refusals (show them — they mean the engine *protected* the user); `null` = noop. A `describePlan(result, playlistsById)` helper resolves the `{isrc,mbid,norm}` keys back to "Artist – Title" for display. **Removes must be visually prominent** — a plan that only adds is benign; a plan that would delete real tracks is the thing the user must consciously see.

**"Report a problem" — user-driven, not telemetry.** A clicked report is consent, not passive collection. It builds a markdown diagnostic (app version + the flagged playlists + the specific would-remove / would-dupe tracks), shows the user exactly what it contains, and offers **Copy to clipboard + open a prefilled GitHub issue** (and/or "paste in Discord"). No server endpoint, no background sends, no Achordion dependency. The scary cases (false removes, duplicate adds from identity mismatch) are exactly what lands in your tracker, with the actionable track list attached.

**Why this replaces telemetry AND the canary.** Every migrating user is a visible-to-themselves canary with a revert: they see the intended end-state before committing, approve only what they accept, and can flip `sync_engine_mode` back to `legacy` at any time (N-way goes dormant, `sync_playlist_state` persists harmlessly). Clean fleets migrate silently; broken cases arrive as bug reports with a diff. You get the signal without collecting data.

**What this does NOT remove:**
- **Coexistence-safety is still required.** Approval cuts over *one client*. New mobile ships on `new` by default, and a user who flips desktop but not mobile (or vice versa) is in mixed mode on shared remotes until both flip. The preview flow lets you nudge users to migrate all their clients together, but cannot guarantee it — so the engines must still converge during the gap (the §"hard prerequisite").
- **Approval is of the plan (decision), not the execution.** Mitigate by **recomputing the shadow at the moment of Accept** (the remote may have drifted since preview — if the snapshot changed, re-render before committing), and by leaning on the common `noop` case writing nothing.

**Prerequisite:** the preview needs the shadow to actually run on demand — already available via the `nway:shadow-run` IPC, so the toggle calls it directly (no background cadence required for the preview itself; a background shadow is optional and only useful if you later want passive logs, which we are not building).

## Phases

- **Phase 0 — baseline seeding (DONE).** `bootstrapNwayPlaylistState()` already seeds `sync_playlist_state` (tier baselines) on every launch, idempotent, no-network, behavior-neutral. So any client that flips to `shadow`/`new` already has baseline tiers ready.
- **Phase 1 — coexistence hardening + shadow validation.** Add the `new`-mode mutual-exclusion guard. Audit identity parity (#2 above). Ship the per-client `shadow` mode as a Developer Tool toggle + a "Run dry-run reconcile" action that prints the plan. Run shadow across a real mixed fleet (a `new` mobile + a `shadow` desktop on the same account) and confirm the plans converge and don't churn.
- **Phase 2 — opt-in `new`.** Expose `new` behind the Developer Tool (with a "real writes, disables legacy" confirm). Early adopters + new mobile clients run `new`. Legacy remains the default for existing clients. Watch for remote churn / duplicates / drops.
- **Phase 3 — default flip.** Once stable at scale, new builds default to `new`; legacy becomes opt-out (`sync_engine_mode === 'legacy'` still honored for rollback).
- **Phase 4 — legacy removal.** After a deprecation window with low legacy usage, delete the legacy push/create loops. Keep the data-model fields (they are shared).

## Cross-platform coordination model

**Parachord has no user account.** It is local-first; the only thing a user's clients share is the third-party provider accounts they are each connected to (the Spotify / AM / LB remotes). There is no Parachord-side identity to store a global flag on, so there is no central coordinator to migrate the fleet at once.

**Per-client local mode is therefore the only clean model — and it is sufficient.** `sync_engine_mode` lives in each client's own store, authoritative for that client. It tolerates a client stuck on an old build (which simply stays `legacy`). The "no global coordinator" gap is filled not by a shared flag but by **coexistence-safety on the shared remotes** — the engines converging on the remote playlist *is* the coordination. That is exactly what Phase 1 hardens.

**Fresh-install default is a build-time constant, not a runtime hint.** A new install picks its starting mode from its build: new mobile builds default `new`, desktop builds default `legacy` until the Phase 3 flip. No client reads a default from anywhere shared. (A provider-stored sentinel — e.g. a marker in a Spotify playlist description — could carry a cross-client signal, but it is hacky, per-provider, and unnecessary given coexistence-safety. Not recommended.)

## Data + rollback

- **No destructive local migration.** N-way reads the same `local_playlists` fields; `sync_playlist_links` is shared and respected by both engines. Nothing rewrites the legacy shape.
- **Baseline adoption on first `new` run.** The reconcile adopts the current remote as the baseline anchor (the same silent-adopt contract the `syncedFrom` heal uses), so flipping to `new` doesn't flag spurious "updates."
- **Reversible.** Flip `sync_engine_mode` back to `legacy` → legacy resumes, N-way goes dormant, `sync_playlist_state` persists harmlessly. No data loss either direction.
- **Existing guard rails stay.** `missingStreak` gate, partial-fetch floor, total-wipe-only mass guard, and the imported-`syncedFrom` heal continue to protect against mass deletion during the transition.

## Decisions needed from the maintainer

1. ~~Account-level hint?~~ Resolved: no Parachord account exists, so per-client local mode is authoritative and fresh-install defaults are build-time constants. No central coordinator; coexistence-safety on the shared remotes substitutes for one.
2. **When does `new` reach end users — Phase 2 (opt-in, dev-tool) or wait for Phase 3 (default)?** Recommend opt-in dev-tool first; do not auto-enable real writes for everyone until shadow validation across a mixed fleet is clean.
3. **Legacy deprecation window** before Phase 4 removal (e.g. 2–3 release cycles after the default flip).

## Mobile parity

parachord-mobile mirrors this exactly: same `sync_engine_mode` 3-state, same `new`-mode mutual-exclusion guard on its push loops, same coexistence requirements, same per-client-authoritative model. New mobile clients default to `new`; the identity-parity audit (`ResolverScoring.kt` ↔ `playlist-merge` tiers) is a cross-engine byte-parity item. File as a parachord-mobile tracking issue referencing this doc.
