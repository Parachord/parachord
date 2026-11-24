# Migration: legacy sync → N-way sync (cross-platform)

**Status:** plan of record, revised · **Date:** 2026-06-28, revised 2026-11-23 · **Epic:** parachord#911, parachord-mobile#289
**Applies to:** parachord-desktop + parachord-mobile (Android + iOS). This doc is the shared contract; both platforms implement the same model.
**Read with:** `docs/plans/2026-11-18-sync-providers-and-nway.md` (sync providers as plug-ins and the milestones that finish N-way, M1 to M15). This doc owns the migration itself: the modes, what has to be true before each step, the backup, and the order. That doc owns the provider contract and the N-way feature work. Where they overlap, the milestone numbers below are that doc's.

**What the 2026-11-23 revision adds:**
- **The plug-in sync engine.** N-way becomes the only playlist engine, and the providers it drives become plug-in providers. The phases now map to that doc's milestones.
- **What the November 2026 incidents showed is missing.** Mobile's legacy engine emptied and cut down real Spotify playlists, and a playlist could have a different source on each client. Six new coexistence rules come out of it.
- **A backup the user can restore from** before every step that hands writes to a different engine.

## The problem in one paragraph

Two sync engines exist and they write the **same shared remotes** (Spotify / Apple Music / ListenBrainz playlists) and the same local keys (`local_playlists`, `sync_playlist_links`). Existing desktop and mobile clients default to the legacy engine; opt-in users run the new (N-way) engine. When a new-sync client and an old-sync client both sync a playlist that mirrors to the same remote, you are in **mixed mode**, and you cannot force every client of a user to upgrade at once. So the migration cannot be a flip-the-switch cutover: it has to survive a transition window where both engines write shared remotes. November 2026 showed the window is dangerous even with one engine, because two *clients* of the legacy engine disagreed about where a playlist comes from (below).

## Decision: a per-client toggle with three states

The engine's baseline state (`sync_playlist_state`) is local to each client, and clients upgrade independently. So the switch is per client, through one setting, `sync_engine_mode`:

| Mode | Legacy engine | N-way engine | Writes to remotes |
|---|---|---|---|
| `legacy` (default today) | drives | dormant | legacy only |
| `shadow` | drives | computes + logs (dryRun) | legacy only |
| `new` | **stands down** | drives (propagate) | N-way only |

- `shadow` is the per-client validation step: the new engine produces its plan against the user's real data and logs it, while legacy still owns writes.
- `new` stands the legacy push, create and inbound loops down through the mutual-exclusion guard (`legacyPlaylistSyncEnabled`; desktop #938, mobile `SyncEngineMode.legacyPlaylistSyncEnabled`).

Fresh installs take their default from the build (a constant, never anything shared). Every client defaults to `legacy` until the default flip (Phase 3).

## The hard prerequisite: coexistence-safety on shared remotes

The new engine must **converge with a legacy client writing the same remote**, not just with other new clients. The three original properties stand:

1. **Inbound-drift tolerance.** A legacy client's push to the remote is legitimate drift that N-way reconciles through the 3-way merge, never corruption. The snapshot/baseline drift detection, the `missingStreak` gate and the partial-fetch floor are built for this; they must be validated against real legacy churn (#945).
2. **Identity parity across engines.** Legacy and N-way must agree on "same track", or a legacy write looks like delete + add to N-way. Audited in June (parachord-mobile#289, D-Legacy-1 to D-Nway-vs-Legacy-7); the shared vectors keep it.
3. **No worse than today.** Concurrent edits on two clients are last-write-wins under legacy. Mixed legacy↔new must be no worse.

### What November 2026 showed

Mobile's legacy engine rewrote real Spotify playlists with partial or empty lists, twice:
- **2026-11-18:** 154 Spotify mirrors were rewritten, during a Spotify rate-limit cooldown, with only the tracks whose Spotify ids had been found (parachord-mobile#807).
- **2026-11-22:** "2019 Greatest Hits" (100 tracks) was emptied on Spotify.

A repair on 2026-11-22 found 30 Spotify playlists empty and 5 short, and refilled them from the phone's lists and desktop's copies.

**The pattern behind it:**
1. Desktop pulls a playlist from Spotify and pushes a copy to ListenBrainz.
2. Mobile, with ListenBrainz import-all, imports that copy as a ListenBrainz original. Those copies are lossy: ListenBrainz keeps only tracks it can match to a recording, so 84 of 100, 48 of 59 and so on.
3. Mobile's push then found the original Spotify playlist by name, adopted it as its "mirror", and replaced its contents with the lossy list.

On that account, 31 playlists had Spotify (or Apple Music) as the source on desktop and ListenBrainz on mobile.

**Bugs found and fixed on mobile, all legacy paths:**
- the push replaced a mirror with only the ids it could find (#809: the push now waits while tracks haven't been looked up);
- Spotify synced while its switch was off (#817: one shared rule, `syncingProviders`, decides which providers sync);
- stopping one provider's sync cancelled every provider's background schedule (#817);
- the playlist page offered to pull from a mirror and accepted an empty answer (#819);
- a pull's own flag pushed the list back to its source (#802 / #803);
- Apple Music's append-only push re-appended the whole list every time (#820; desktop already appended only the missing tracks).

**Desktop side:** its pull refuses an empty answer, but not a sharp shrink. A Spotify playlist holding `spotify:local:` entries (files from the user's computer) can never be written back through the API, so a pull of its API-written copy would have cut desktop's 12-track Biohio to 1.

**Six rules this adds to coexistence-safety.** Each applies to legacy for as long as it runs, and to N-way:

4. **One source per playlist, known to every client (provenance).** A copy Parachord pushes to another service says which playlist it mirrors (resolver and external id). A client that imports a playlist carrying that mark treats it as a mirror of the marked source: it links it, never imports it as a new original, and never pushes into the source from it. Without a mark, two clients can each think a different service is the source, and each push overwrites the other's source.
   - Mechanism to decide (D-New-1). A ListenBrainz playlist has an `additional_metadata` field, which looks like the right home if ListenBrainz keeps it. Spotify and Apple Music have only the description, which the user sees.
   - A client that can't tell must assume the remote might be someone's source.
5. **A remote found by name is linked, never overwritten.** The three-layer dedup's name match (layer 3) may link an existing remote playlist. The first write to it must merge with what it holds (N-way's 3-way merge, with the remote as a copy) or add only what's missing. It must never replace it. Only a remote this client created, or one whose provenance names this playlist, may take a replace.
6. **Write incrementally where the provider allows.** N-way already writes adds and removes by native id or position. A full replace is for `ReplaceOnly` providers only. Never replace a list that holds entries the API can't write back (Spotify `spotify:local:` items): a replace drops them for good.
7. **A sharp shrink is held, in both directions.** Today N-way's mass guard is total-wipe only, and desktop's pull refuses only an empty answer. Add a shrink hold: a pull or push that would remove more than half of a playlist and more than 10 tracks. A held change is logged (`nway_cycle_log`, M8) and shown on the playlist page with Keep / Apply, never applied silently. The thresholds are a decision (D-New-2).
8. **Which providers sync is one rule.** A provider is synced only while the user has it switched on. Desktop gets this from the registry's `isSyncActive(id)` (M1/M5); mobile from `syncingProviders` (#817). No engine path decides it separately.
9. **An append-only provider gets only the missing tracks** (Apple Music library playlists). Both platforms do this now.

**Repairing a playlist whose source is wrong, on mobile.** Mobile's playlist id names its source (`spotify-<id>`, `listenbrainz-<mbid>`, read by `impliedPlaylistProvider`), so correcting a source means moving the playlist to a new id. Desktop's ids (`p-…`) don't name a source and need no move. The 31 flipped playlists were repaired on 2026-11-23 by hand, and the move had to cover every place that keys on the id: the playlist row (with the source's `spotifyId` and a cleared snapshot so the next pull refreshes it), `playlist_tracks`, `sync_playlist_link`, `sync_sources` (item type `playlist`), `sync_playlist_baseline`, `sync_playlist_nway`, `sync_playlist_source` (rewritten to the real source, with a link row for it), and two settings: the per-playlist channel override (`sync_playlist_channels_<id>`, which must name the source, since it's an allowlist for pull as well as push) and Apple Music's pull list. Rule 4 on mobile needs this as shared code (one re-key function in `shared/commonMain`), run for every existing playlist whose provenance says it's a mirror, inside one transaction. Until it exists, a source can only be corrected by hand.

**Rows a removed playlist left behind.** Mobile's `playlist_tracks` declares a cascade that never ran (SQLite's foreign keys are off, and can't be turned on while playlist saves are `INSERT OR REPLACE`), so every removed playlist left its tracks under an id nothing owned: 3,863 rows for 89 playlists on one phone. The first repair attempt failed on them: the new id already held old tracks at the same positions. Fixed in parachord-mobile#827 (the delete removes the tracks; both apps drop orphaned rows when the database opens). For this plan: the backup exports only playlists that exist and their tracks, a restore or re-key clears the target id's rows first, and no step relies on a database cascade on mobile.

Rules 4, 5 and 7 are new work on both platforms. Until they land, the safe operating advice for a mixed fleet is: **turn on a service's sync on only one client per source.** If desktop pulls a playlist from Spotify, mobile should get it through Spotify too, not through ListenBrainz's copy.

## Backup and restore

Every step in this migration hands writes from one engine to another, and November showed that the remote copies themselves get damaged, not just the local ones. Before the user commits to a step, the app saves a backup they can restore from without help. The 2026-11-22 repair needed copies of a phone's database and desktop's store that existed only by luck.

**What a backup holds** (one versioned JSON file, the same format on every platform):
- every local playlist with its tracks and every sync field (`syncedFrom`, `syncedTo`, links, snapshot ids, fingerprints);
- the collection's rows with their `syncSources`;
- `sync_playlist_links`, `sync_playlist_state` baselines, track tombstones and love marks;
- **a snapshot of every linked remote playlist**, read at backup time: provider, external id, name, snapshot id, and each track's native id with artist and title. This is the part that would have made November's repair routine. Each remote's read is complete or the backup says it's missing; a partial list is never saved as if whole.
- **a snapshot of every remote library Parachord can write to** (tracks, albums and artists where the provider declares `write`: Spotify, Apple Music, Amazon Music's library). A pull-only library (Subsonic, Plex) needs no remote snapshot, since Parachord never writes to the server; its rows are in the collection above, with their scope.
- the app version, platform and `sync_engine_mode` at backup time.

**When the app makes one:**
- automatically, before **Accept** in the migration dialog (Phase 2), and before the silent switch at the default flip (Phase 3);
- automatically on the first launch of a build that removes legacy (Phase 4);
- on demand: **Settings › Sync › Back up sync data**, at any time and in any mode.

It keeps the last 5 automatic backups plus any the user made. A backup is never uploaded anywhere. Desktop saves under the user data folder, with "Show in Finder" / "Export…". Mobile saves in app storage, with "Export" through the share sheet or Files.

**Restoring:**
- **Per playlist, from a backup's list:**
  - "Restore in Parachord" puts back the local playlist and its links.
  - "Put back on <service>" writes the saved remote list to that service. It goes through the provider contract with incremental adds and removes, after showing the diff, one playlist at a time, and says when the saved list holds entries the service can't take (local files).
- **Restore the whole backup** locally, behind a confirm, for a client that lost its store.
- **Restoring never switches modes by itself.** A restore made in `new` mode leaves N-way in charge, and the next cycle merges from the restored state.

**Cost:** one exporter and one restore screen per platform, over shared code on mobile (the format and its parser in `shared/commonMain`). It lands before Phase 2 reaches anyone outside Developer settings.

## Migration UX: back up, preview, then approve or report (no telemetry)

We don't build passive telemetry. Each user validates their own migration, and problems arrive as user-initiated reports.

1. The user turns on **Use new sync** (desktop: Settings › Developer today; mobile: Settings › Sync › "Use new sync (preview)").
2. **The app saves a backup** (above) and says where.
3. The client runs the dry-run reconcile and shows the full plan as a **human-readable diff**: per playlist and mirror, tracks that would be **added** and **removed**, imports and creates (M6), held shrinks (rule 7), and safety aborts. Most converged users see *"No changes needed"*.
4. Three actions:
   - **Accept changes** → recompute the plan at that moment (the remote may have moved since the preview), then set `sync_engine_mode = 'new'`.
   - **Report a problem** → a markdown diagnostic the user sees before sending: app version, the flagged playlists, the would-remove and would-dupe tracks, and the provenance each client recorded. Offered as copy + a prefilled GitHub issue. Stays on `legacy`.
   - **Cancel** → stays on `legacy`; nothing changed except the saved backup.

**Rendering the diff.** `status:'would-push'` carries `perTarget:[{providerId, addKeys, removeKeys}]`, and `describePlan` resolves the `{isrc, mbid, norm}` keys to "Artist – Title". `total-wipe-abort`, `partial-abort` and the new shrink hold show as protections. **Removes are visually prominent.**

**Reversible.** Switching back to `legacy` makes N-way dormant. Whether that's clean is unverified: N-way doesn't keep `syncedFrom.snapshotId` and `tracksFingerprint` in step, so legacy may read every merged playlist as edited (M7 fixes it and adds the switch-back test). Until M7, the backup is the rollback that's known to work.

## Phases

Phases are the user-visible steps; milestones (M) are from the sync-providers plan. The two tracks there, plug-in providers (M1 to M4) and finishing N-way (M6 to M8), run in parallel and meet at the default flip.

- **Phase 0 — baseline seeding. DONE (desktop and mobile).** `sync_playlist_state` is seeded at every launch, idempotent, no network.
- **Phase 1 — coexistence hardening and shadow validation. PARTLY DONE.**
  - **Done:** the mutual-exclusion guard (desktop #938, mobile); the June identity-parity audit and its fixes; shadow mode; the preview dialog (desktop #939, mobile #314 / iOS #315).
  - **Added by this revision:** rules 4 to 9; the backup and restore tool; mobile's November legacy fixes (#803, #809, #817, #819, #820), and desktop's equivalents where its legacy has the same gap (tickets to file: the sharp-shrink hold on pull, and the name-match replace).
  - **Still open:** #945 (legacy↔new alternation simulator).
- **Phase 2 — opt-in `new`. SHIPPED, behind Developer settings on desktop and a preview on mobile.** Before it goes anywhere more visible:
  - **N-way creates, imports and seeds in `new` (M6).** Today `new` silently stops importing newly selected playlists and creating new mirrors, on both platforms.
  - **Renames, dead-mirror flags, the Achordion submit, and fingerprints kept in step (M7)**, with the switch-back test.
  - **The validation record (M8):** `nway_cycle_log` with "Copy sync report", and shared JSON vectors for missingStreak, materialize, source authority and #945's scenarios, run by both engines.
  - **The backup tool**, and rules 4, 5 and 7.
- **Phase 3 — default flip (M10).**
  - **Gate:**
    - M6 to M9 done on desktop, and mobile's M6 and M8 equivalents merged;
    - rules 4 to 9 and the backup in on both platforms;
    - two release cycles of explained `nway_cycle_log` records on real libraries (M9), including a mixed fleet converging on one account;
    - no open N-way data-loss issue.
  - **The flip:** fresh installs default to `new`. An existing user whose preview is a no-op switches without a dialog, after an automatic backup. Everyone else sees the dialog once, outside Developer. Mobile flips its `DEFAULT_MODE` in the same window.
  - **Remove the dev-only propagate flag:** it writes without a preview.
- **Phase 4 — legacy removal (M12).**
  - **Gate:** two to three releases after M10, no open N-way data-loss issue, and mobile at the same step.
  - **Delete:** the legacy push, create and inbound loops on both platforms.
  - **Keep:** the data-model fields, the heal, the link map and the dedup gateway (which N-way's create uses after M6).
  - The first launch of the removing build makes an automatic backup.
  - Old builds still on `legacy` keep writing shared remotes indefinitely (no telemetry, no account), which is why rules 4 to 9 must also hold in N-way and not only in the legacy code that's deleted.

**Plug-in providers, in this order relative to the phases:**
- **Loves (M5) come first, before M1** (2026-11-24): they touch neither playlist engine nor the library. **M1 to M4 (contract, registry, bridge, Subsonic/Plex library) can ship during Phase 2** (see "Plug-in services" for what each needs). They don't change which engine writes playlists. M1's no-op golden test and state audit script stand in for a backup during that move, since no data shape changes.
- **M11 (plug-in playlist providers) waits for Phase 3**, so plug-in playlists never touch legacy.
- **M15 (built-in providers move into their `.axe`) waits for M3's bridge to carry Subsonic and Plex for a release.** Each move runs the M1 conformance suite and golden test, and the release that ships it makes an automatic backup.

## Plug-in services (Subsonic, Plex, Amazon Music)

The sync-providers plan brings these in as plug-in providers: Subsonic and then Plex libraries (M4), their playlists (M11), and Amazon Music's library and playlists (M14). What the migration needs from each:

- **Subsonic and Plex libraries (M4): pull-only, so the risk is local.**
  - Parachord never writes to the server (the contract gives them no write method), so they can't damage a remote. What they can do is remove rows from the collection.
  - **A scope change is a deliberate removal.** Deselecting one Plex library removes its rows outside the mass-removal safeguard (the sync-providers plan, D3). The sharp-shrink hold (rule 7) takes the same exception. The app makes a backup before applying a scope change, so a library deselected by mistake can be restored.
  - **A server that can't be reached is "paused", not empty.** A home server off the network (a phone away from home Wi-Fi) throws, and nothing is removed (the contract's failure rule; desktop #1358's throw-on-failure in `subsonic.axe` is the precedent).
  - They can ship during Phase 2: they don't change which engine writes playlists.
- **Subsonic and Plex playlists (M11):** N-way only, after the default flip, so they never meet the legacy loops. Rules 4 to 9 apply as to any provider.
- **Amazon Music (M14): read and written, behind a web session.**
  - **Placement.** After M3's bridge has carried Subsonic and Plex for a release (the same gate as M15). If it lands before the default flip, its playlists stay off the legacy loops, as M11's do: Amazon playlist sync is N-way only.
  - **Followed playlists are read-only sources.** Amazon's followed playlists (mostly editorial or auto-generated) can't be edited, only unfollowed. They import with `syncedFrom` and are never a push target or a mirror on any client (rule 4). A client that finds one by name links it and never writes it (rule 5).
  - **Created playlists** sync both ways like any provider's.
  - **A purchases-only plan.** On a plan that plays only owned tracks, a playlist or library can hold tracks the account can't play. Playability is not membership: a track that can't play stays in the list. Only the provider's own listing decides presence, so a plan change doesn't read as removals to `missingStreak` or the shrink hold. The plan transition already purges and re-resolves *sources* (`limitTransition`); it must never remove *rows*.
  - **The library** (tracks, albums, artists) is written, so the backup snapshots it.
  - **Purchased tracks:** one list, shared with playback's owned-only plans (desktop #1494).
  - **Before M14 ships:** the M1 conformance suite and golden test run against Amazon's provider with recorded responses.
- **Mobile.**
  - Subsonic is mobile-capable, so its library sync needs a Kotlin `SyncProvider` over `JsRuntime`. Whether the headless WebView (Android) or JavaScriptCore (iOS) can run it from the background worker (`LibrarySyncWorker`, iOS `BGProcessingTask`) is unanswered.
  - Until it is, Subsonic's library sync on mobile runs only while the app is open, and says so in its settings. This doesn't gate the default flip, which is about playlists.
  - Plex is `mobile: false`.
  - Amazon on mobile follows desktop's M14 with the same rules, on the web-session bridge both apps already supply.

## Cross-platform coordination model

**Parachord has no user account.** A user's clients share only the third-party accounts each is connected to. There is no Parachord-side place for a global flag, so there is no central coordinator.

**Per-client local mode is authoritative, and coexistence on the shared remotes is the coordination.** That's why rules 4 to 9 matter as much as the engine work: the remotes are the only thing every client sees. Rule 4's provenance mark is a small, deliberate exception to "nothing shared but the remotes". It's data on the remote that says which playlist a copy mirrors, not a mode or a flag, and any client can read it.

**Fresh-install default is a build-time constant.** No client reads its default from anywhere shared.

## Data + rollback

- **Mobile's database has no working cascades.** Every step that removes or moves a playlist deletes its dependent rows in code (see "Rows a removed playlist left behind").
- **No destructive local migration.** N-way reads the same `local_playlists` fields; `sync_playlist_links` is shared and respected by both engines.
- **Baseline adoption on first `new` run.** The reconcile adopts the current remote as the baseline anchor, so switching doesn't flag spurious updates.
- **Rollback:** switch back to `legacy` (clean after M7), or restore from the backup (works today).
- **Guard rails that stay:** `missingStreak`, the partial-fetch floor, the total-wipe guard, the imported-`syncedFrom` heal, and from this revision the sharp-shrink hold.

## Decisions needed from the maintainer

1. ~~Account-level hint?~~ Resolved: no account; per-client mode is authoritative.
2. ~~Phase 2 opt-in or wait for Phase 3?~~ Resolved: opt-in shipped behind Developer / preview.
3. **Legacy deprecation window** before Phase 4 (recommend 2 to 3 releases after M10, as the sync-providers plan says).
4. **D-New-1: the provenance mark.**
   - Recommendation: ListenBrainz `additional_metadata` (confirm ListenBrainz keeps it); for Spotify and Apple Music, no mark, and rule 5 (link, never overwrite) carries them.
   - Alternative: a short machine-readable suffix in the description. It's visible and users edit it, so it's not recommended.
5. **D-New-2: the sharp-shrink thresholds.** Recommend "more than half and more than 10 tracks", held per playlist with Keep / Apply, as the library's mass-removal safeguard does at 25% / 50.
6. **Backup retention and size.** Recommend the last 5 automatic plus manual ones. The remote snapshots carry ids and names, not artwork, so a large library stays in single-digit megabytes. Confirm before building.
7. **Silent switch at M10 for a no-op preview** (the sync-providers plan's risk 3). With an automatic backup first, recommend yes.

## Mobile parity

parachord-mobile mirrors this doc: the same `sync_engine_mode`, the same guard, the same coexistence rules (1 to 9), the same backup format and restore, and the same default-flip window. Mobile's state at this revision:
- **Done:**
  - the guard and the preview (Android #314, iOS #315), and iOS background sync (#316);
  - the shared fixtures, byte-identical with desktop's;
  - the November legacy fixes (#803, #809, #817, #819, #820).
- **Open, mobile's share of each milestone:**
  - M6 (imports, creates and seeding in `new`): mobile's `syncPlaylists` returns after `runNwayPropagation()`, the same gap;
  - M7 (renames, switch-back);
  - M8 (vendor the new vectors, Kotlin runner);
  - a Kotlin `SyncProvider` over `JsRuntime` for Subsonic's library (M4);
  - the backup tool, built once in `shared/commonMain` (format, writer, parser and the restore plan) and drawn by each app.
- **Rules 4, 5 and 7** are shared rules (`shared/commonMain`). The 31 playlists flipped on one account on 2026-11-22 are being repaired by hand on that device; rule 4 is what stops it recurring for anyone.

The per-milestone mobile tickets are in the sync-providers plan's section 6 table. Add one: **backup and restore**, filed when the format is agreed.
