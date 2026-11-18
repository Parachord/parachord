# Sync providers as plug-ins, and finishing N-way

**Status:** proposal for the maintainer to decide on · **Date:** 2026-11-18 · **Base:** `main` at c5911482
**Covers:** #1515, #1518, #1519, #1445, #802, #790, #801, #911, #945, #1520, #1494
**Out of scope:** the player adapter (#1517), except one note in "Risks".

This is a decision document. Each decision below has options, a recommendation and what it costs if the recommendation is wrong. The sequence at the end is the order to build it in. Read `docs/architecture/sync.md` before implementing any milestone: its rules came from data-loss incidents, and the table in D5 points into it.

## Summary

- **Where plug-in provider code runs:** in the renderer, like every `.axe`, behind a main-process proxy. The sync engines, the scheduler, the safety rules and all stored state stay in main. Main calls the plug-in through a request/response bridge, page by page.
- **How the built-ins become plug-in providers:** each plug-in's manifest declares its sync. Spotify, Apple Music and ListenBrainz name a **host adapter** (the existing main-side code, wrapped), as `embedPlayer.adapter` does today. Their code does not move into the `.axe`. Last.fm and ListenBrainz loves use renderer-side host adapters over the existing scrobbler classes.
- **The contract:** a data **descriptor** in the manifest (`capabilities.librarySync` / `playlistSync` / `lovedTracks` as booleans, details in a top-level `sync` block), plus token-free async methods. A failure always throws; nothing is ever `null`; "unchanged" is said explicitly. The host computes collection ids; a plug-in never does.
- **Engines:** playlists go through N-way. The library stays on `calculateDiff` (it is already a per-provider set union). Loves stay on their own append-only model. All three call the same provider contract.
- **N-way's remaining work:** `new` mode cannot create a mirror or import a playlist (both platforms), drops renames, Achordion submits and dead-mirror flags, and may leave false conflicts on a switch back to `legacy`. The desktop executor has no recorded live run. #945 is open.
- **Gate for `new` as default:** those gaps closed, #945 and shared JSON vectors green on both engines, two release cycles of recorded clean cycles on real libraries, and mobile ready to flip in the same window. Legacy is deleted two to three releases after that.
- **Milestones:** M1 Contract and registry · M2 Renderer asks the provider · M3 Plug-in bridge · M4 Plex library sync · M5 Loves through the contract · M6 N-way creates and imports · M7 N-way feature parity · M8 Validation record and shared vectors · M9 Live validation window · M10 Default flip · M11 Plug-in playlist providers · M12 Legacy removal · M13 Scheduler to main · M14 More library plug-ins and social reads.

## 1. Why

Sync is the last large part of the app that is wired by service name. Three providers are hard-coded in `sync-engine/index.js`, main picks tokens with `providerId === 'spotify'` style switches in four places, and the renderer branches on the service in its push loops, setup dialog, library push and love code (`scripts/design-drift.js` counts 104 such branches on `main`). That breaks CLAUDE.md's first invariant, "Route by the plugin registry, never by service name". It is also why a Plex, Subsonic or Jellyfin library can't reach the Collection even though the Plex plug-in already pages through every track (#1515). At the same time two playlist engines run side by side: legacy is the default, N-way drives only opt-in users. Every sync change has to be made twice, and the legacy loops are where most of the renderer's service branches live. Finishing the two together means each provider is written once, against the engine that will remain.

## 2. The end state

Any `.axe` can declare that it syncs a library (tracks, albums, artists), playlists, loved tracks, or any mix of those. One registry in main lists every sync provider from the loaded plug-ins' manifests. Spotify, Apple Music, ListenBrainz and Last.fm are entries in it like any other, and their state keys (`syncSources`, `syncedTo`, links, tombstones, love marks) are unchanged because their ids are unchanged. Playlists sync only through N-way, which is the default on desktop and mobile; the legacy push and import loops are gone. The library and loves keep their own engines, now fed through the same contract. The renderer asks a provider's descriptor what it can do and never tests its id. Plex is the first plug-in library, Subsonic and Jellyfin follow with no app change, and the plug-in settings dialog shows "Sync your library" for any plug-in that declares it.

## 3. Where things stand

### 3.1 Built-in providers and the service branches

**Registry.** `sync-engine/index.js` maps `spotify`, `applemusic` and `listenbrainz` to the modules in `sync-providers/`. `sync:get-providers` returns their `id`, `displayName` and `capabilities`.

**Capabilities already exist** in `sync-providers/types.js`: `tracks`, `albums`, `artists`, `playlists`, `playlistFolders`, and N-way's `trackRemoveMode` (`ByNativeId`, `ByPosition`, `Unsupported`, `ReplaceOnly`), `canReorder`, `supportsPlaylistDelete`, `supportsPlaylistRename`. The providers also implement `nativeIdOf`, the incremental primitives (`addPlaylistTracks`, `removePlaylistTracksBy*`, `remotePlaylistExists`, `searchForTrackId`; throwing defaults in `sync-providers/incremental-primitives.js`).

**Tokens are chosen by name in main**, in four copies: `sync:check-auth` and `sync:start` (`main-process/ipc/sync-start.js`), `resolveProviderToken` (`main.js`, injected into `sync-create.js`) and `getNwayProviderToken` (`main.js`). Spotify's scope check and refresh callback are inline in `sync:start`. Main's sync files hold about 49 comparisons against a provider id.

**Renderer branches** (`src/renderer/app.js`, line numbers at c5911482):
- the two legacy playlist push loops (`runBackgroundSync` around L4279, the post-wizard loop around L10040): ListenBrainz's re-export opt-in, hosted XSPF to ListenBrainz, `pushLocalPlaylists`;
- library push of manually saved items (`sync.saveTracks` / `saveAlbums` / `followArtists`), choosing `spotifyId` or `appleMusicId` by name (L4729 to L4830, L10355 to L10425);
- `openSyncSetupModal` (L9649): sign-in per service and ListenBrainz's `pushLocalPlaylists: false` default;
- loves: `runLoveBackfill` (L14578), `runLoveImport` (L14666) and `pushLoveToScrobblers` (L14408) pick `window.lastfmScrobbler` or `window.listenbrainzScrobbler` by name;
- the plug-in settings dialog draws "Sync your library" only inside the hand-built Spotify and Apple Music sections (`renderLibrarySync` in `src/renderer/components/plugin-settings-dialog.js`).

**Loves run entirely in the renderer.** The scrobbler classes live in `scrobbler-loader.js`, and `love_pushed_keys` and `love_import_cursor` are written from the renderer. The Sync menu's pause (#1444) does not stop love pushes, and Last.fm has no Sync menu entry (#1445).

**Plex** (`plugins-src/plex/`, 0.1.3) indexes every track of the selected libraries in `buildIndex`, through main's allow-listed `plex-fetch`. Its token and library choice live in `meta_service_configs.plex`, which both processes can read. Nothing sends that index to the Collection.

**Local Files** is a Collection source with its own scanner and its own three guards (`docs/architecture/local-files.md`). It is not a sync provider, and this plan keeps it that way. #1520 (capabilities instead of `'localfiles'` checks in playback) is independent of sync and can land at any time.

### 3.2 The N-way migration, exactly

The plan of record is `docs/plans/2026-06-28-legacy-to-nway-sync-migration.md`, with the port plan `docs/plans/2026-06-25-nway-desktop-port-plan.md`. The design docs are in parachord-mobile.

**Done (merged):**
- The pure merge and its shared fixtures (#912), key unification with the remaster strip (#914), the norm-bridge guard and the v1 no-false-drop harness (#944).
- State: `sync_playlist_state` with tier baselines (#913, #920), seeded and upgraded at every launch by `bootstrapNwayPlaylistState` (#916).
- The provider capability surface and write primitives (#918, #921), the materialize executor (#919), the reconcile core with hydration (#922), the driver and shadow wiring (#923).
- Sync channels: mirror-only and ListenBrainz re-export, `sync:set-channel` (#924); collaborators count as writable (#952); identity parity in `resolveTracks` (#943); followed-playlist duplicates (#940, #941).
- `sync_engine_mode` with the mutual-exclusion guard (#938): in `new`, `sync:create-playlist`, `sync:push-playlist`, `sync:start`'s inbound playlist phase and both renderer loops stand down.
- The preview, approve or report dialog (#939) and the cross-device nudge (#947), reached from Settings › Developer › "Use new sync".
- Arming: `new` drives real writes for opt-in users through `runNwayArmedDrive` (startup after 90 s, then every 15 min), with the parity fixes from its audit (#956, #957).
- The missingStreak fix (#1164, 2026-10-30) and the guard-parity test for the legacy loops (#1225). The paused-service skip in the N-way drive came with #1444.
- The shared fixtures are in step with mobile: `canonical-fixtures.json` and `no-false-drop-scenarios.json` are byte-identical to parachord-android `main` (2026-11-16), and `key-unify-fixtures.json` differs only in its `_about` text.

**Partly done:**
- **Phase 2 (opt-in `new`)** shipped, but only in Settings › Developer.
- **Live validation.** On 2026-06-30 (parachord-mobile#289) desktop's own JS executor had "not fired against a live API". The arming leaned on mobile's live validation of the shared logic. #1164 was then found by reading code, not by a run, and it fixed two failures any real use of `new` would have hit: a track deleted on the service always came back, and an add that resolved but never landed could delete the user's track everywhere. I found no record of a desktop run since.
- **Dead mirrors.** Legacy flags a ListenBrainz mirror that is gone (`flagDeadMirrors`, #1271). N-way only clears a link when a write throws and the 404 probe confirms it.

**Not started:**
1. **Creating a mirror in `new` mode.** The create gateway stands down, and `reconcilePlaylist` only reconciles mirrors that already have an external id. A new local playlist, or a channel switched on in the Sync menu, never reaches the service.
2. **Importing a playlist in `new` mode.** The legacy inbound phase is skipped and N-way only walks existing `sync_playlist_state` entries, so newly selected playlists and ListenBrainz's import-all never arrive. Mobile has the same gap: `SyncEngine.syncPlaylists` returns straight after `runNwayPropagation()` in `new`.
3. **Seeding state during a session.** `bootstrapNwayPlaylistState` runs only at launch.
4. **Renames.** N-way never calls `updatePlaylistDetails`.
5. **The Achordion playlist-links submit** fires only from the legacy write paths (`sync-create.js`, `sync-playlists.js`).
6. **Switching back to `legacy` is unverified.** N-way's effects (`makeStoreEffects` in `sync-engine/nway-reconcile-driver.js`) rewrite tracks without moving `syncedFrom.snapshotId` or `syncedFrom.tracksFingerprint`. After a switch back, `hasRealLocalEdits` may read every merged playlist as edited and raise conflict banners. This needs a test.
7. **#945**, the temporal legacy-and-new alternation simulator.
8. **Shared JSON vectors** for the missingStreak, materialize and source-authority rules. Today each engine ports the other's Kotlin or JS tests by hand.
9. **Docs.** `docs/architecture/sync.md` has no N-way section.

**What shadow runs have shown.** Desktop keeps no record: `runNwayShadowReconcile` logs to the console only. Everything recorded is from mobile: a 148-playlist shadow that motivated key unification (#911), the 2026-06-22 data loss under live writes that led to the reconciliation redesign, and the post-redesign live validation of the shared logic (parachord-mobile#289). Mobile also defaults to `legacy` (`SyncEngineMode.DEFAULT_MODE`).

**Blockers to `new` as default:** items 1 to 3 (without them `new` silently stops creating and importing), item 6 (rollback is the safety net the migration plan relies on), the missing live record, and mobile parity for items 1 to 3. Desktop and mobile write the same remotes.

## 4. Decisions

### D1. Where a plug-in's provider code runs

`.axe` code is materialized with `new Function` in the renderer. The sync engines, the N-way drive, Spotify's breaker and pause, and the built-ins' tokens are in main.

| | A. Renderer runs the plug-in, main calls it through a bridge | B. Plug-in providers run in the renderer with a renderer-side engine | C. Main loads and runs plug-ins |
|---|---|---|---|
| Engines | One, in main | Two (one per process), every safety rule written twice | One, in main |
| Tokens | A plug-in keeps its own (Plex's are already renderer-side); built-ins stay in main | Same as A | Plug-in config must reach main; built-ins unchanged |
| Rate limits | Plug-in fetches go through the renderer, where Spotify's pause already gates `api.spotify.com`; main adds a per-provider pause from `rate-limited` errors | Same, but split across engines | Main only; a second fetch environment needs its own gates |
| Window closed (macOS) or minimized | Minimized works (`backgroundThrottling: false`). Closed: no renderer, so plug-in providers wait; host adapters keep syncing | Nothing syncs with the window closed | Everything syncs |
| #802 (scheduler to main) | Fits: main schedules, only plug-in I/O crosses the bridge | Works against it | Fits |
| Trust | Unchanged: plug-ins already run unsandboxed in the renderer | Unchanged | Worse: marketplace code next to Node in main, or a new sandbox to build and keep in step |
| Plug-in code | Runs as written (`window.electron.plex.fetch`, `this.lib`, the shared instance and its Plex index) | Same | Needs a second `.axe` runtime with polyfills, and a second instance of each plug-in with its own state |
| Precedent | main asks the renderer and awaits a reply today (`embed-search` / `embed-response`, `mcp-response`) | none | none on desktop (mobile has one: `JsRuntime`) |

**Recommendation: A.**
- Main's `PluginSyncProxy` implements the contract. Each call is a request id over `sync-plugin:call`; the renderer's `sync-plugin-host` runs the method on the loaded resolver instance and replies.
- Library fetches are paged, so no single message is large and main can cancel between pages.
- Every call has a budget (30 s a page, in the spirit of `RESOLVE_BUDGET_MS`). Past it the call rejects, and a reject is a failure, never an empty answer.
- With no window, the proxy throws `not-ready`. The engine skips that provider for the cycle, exactly as it skips one with no token today (`runNwayShadowReconcile`).
- Main validates every reply: shapes, no credential-shaped fields, items normalized by the host.

**Cost if wrong:** if plug-in sync must run with the window closed, add a hidden plug-in host window that loads only `resolver-loader.js` and answers the same bridge. The contract and the engines don't change, so the cost is one module. Choosing C wrongly would cost a second plug-in runtime plus a trust problem. Choosing B would mean doubling every safety rule.

### D2. How the built-ins become plug-in providers

1. **Host adapters (recommended).** The `.axe` declares sync and names a host adapter: `"sync": { "adapter": "spotify", ... }`. The adapter is the existing provider module wrapped to the contract, with token handling moved inside it. This is the `embedPlayer.adapter` pattern, kept out of `capabilities` for the same reason (mobile decodes `capabilities` as `Map<String, Boolean>`).
2. **Move their code into the `.axe`.** Marketplace updates could then fix sync without a release. But Spotify's and Apple Music's sync would lose window-closed sync and move about 2,000 tested lines to a new runtime boundary. It would also put Spotify's OAuth refresh and MusicKit token generation behind a bridge.

**Recommendation: 1.** "Becoming a plug-in provider" means: the plug-in declares it, the registry routes by it, the descriptor describes it, and nothing branches on its id. Where the code lives is per provider. Moving one into its `.axe` later stays possible and changes nothing for the engine. Loves for Last.fm and ListenBrainz get renderer-side host adapters over `LastFmScrobbler` and `ListenBrainzScrobbler`, since loves run in the renderer until M13.

**Cost if wrong:** a bug in a built-in provider needs an app release rather than a plug-in update. That is today's situation, so nothing gets worse.

### D3. The provider contract

Full signatures are in Appendix A. The shape:

**A descriptor, as data in the manifest.** Main reads manifests already (`resolvers-load-builtin`), so it can build the registry without running plug-in code. The renderer reads the same descriptor.
- `capabilities` gains booleans only: `librarySync`, plus the existing `playlistSync` (ListenBrainz has it) and `lovedTracks` (Last.fm has it). Each needs a label in `lib/capability-labels.js`. #1515's `librarySync: { tracks, albums, artists }` object would break mobile's decoder; the details go in `sync` instead.
- A top-level `sync` block holds the rest:
  - `contract: 1`;
  - `adapter` (optional): names a host adapter;
  - `kinds`: per kind (tracks, albums, artists, playlists, loves), whether it can be read and written and how it fetches incrementally;
  - the playlist capabilities (the existing ones, plus `snapshots`, `importAll` and `mirrorOutByDefault`);
  - `nativeId`: the field that holds the provider's id (for example `plexRatingKey`), read from a row and from its `sources[providerId]`;
  - `defaults` for the setup dialog.
- `nativeId` is a field name, not a function, so main, the renderer and mobile can all read it without running plug-in code. Host adapters may still supply a `nativeIdOf` function.

**Methods.** All async and token-free; a provider handles its own auth. The engine calls only what `kinds` declares, and a pull-only provider simply has no write methods. The main ones:
- `checkAuth()` returns `{ ok, status, reauth, message }`. `reauth` is true only when signing in again can help.
- `fetchLibraryPage(kind, request)` returns `{ items, nextCursor, mode: 'full' | 'delta', complete, unchanged? }`.
  - `complete: true` comes only on the last page of a full listing.
  - A `delta` answer never causes a removal.
  - `unchanged: true` replaces today's `null` from `fetchTracks`. On desktop `null` means "count check passed"; on mobile it means "not supported". The contract allows neither.
- `saveLibraryItems` / `removeLibraryItems` exist only for kinds that are written.
- The playlist methods keep the names N-way and mobile already use:
  - `fetchPlaylists`, which must report an authoritative `trackCount` (the partial-fetch floor depends on it);
  - `fetchPlaylistTracks`, which returns every track or throws;
  - `createPlaylist`, `addPlaylistTracks`, `removePlaylistTracksByNativeId`, `removePlaylistTracksByPosition`, `replacePlaylistTracks`;
  - `updatePlaylistDetails`, `deletePlaylist`, `getPlaylistSnapshot`, `searchForTrackId`;
  - `remotePlaylistExists`, which returns false only on a definite 404.
- Loves: `fetchLovesPage(cursor)` and `pushLove(track)`. There is no unlove method, so nothing can call one.

**Failure.** Any failure throws a `SyncProviderError` with a `code`: `auth`, `rate-limited` (with `retryAfterMs`), `not-ready`, `unsupported` or `failed`. An empty array is an answer that means "there is none". The engine never derives a removal from a throw. A `rate-limited` throw starts a per-provider pause that every sync path checks. That generalizes `sync-providers/spotify-pause.js`, which stays as Spotify's own process-shared pause.

**What the host keeps.** The host computes every collection id (`sync-engine/collection-id.js`) from the fields a provider returns, so a plug-in update can't re-key a library. The host also:
- builds each item's source record from the provider's `source` payload, so the track plays from that plug-in and shows its icon;
- drops untagged items (empty artist or title) and counts them (#1515 question 4);
- stores every cursor and token-free sync state in main.

A provider never writes local state.

**Scopes (several servers and libraries).** An item may carry a `scope` (Plex: `serverId::libraryKey`), and each page reports the scopes currently selected. A row whose scope is no longer selected is removed as a deliberate choice: not a tombstone, and outside the mass-removal safeguard. That safeguard would otherwise block dropping one library of two (#1515 question 3). A row that vanishes from a still-selected scope goes through the safeguard as today.

**Settings dialog mapping** (the one-layout rule in CLAUDE.md):
- "Enable X" stays the plug-in's on/off. A disabled plug-in's sync is paused, never removed.
- The account row is unchanged.
- "Sync your library" is a nested `SettingRow` for every plug-in whose descriptor has any kind, drawn by the shared `renderLibrarySync`, never inside a per-service section. Its switch is the existing pause (`resolver_sync_settings[id].enabled`), with Set up, Manage and Remove sync….
- The setup dialog offers one choice per declared kind, defaulted from `sync.defaults`. "Loved tracks" is one of them (#1445), and it reads and writes the same `scrobbler_love_push_enabled[id]` as the card's "Push newly loved tracks": one setting, two places.
- What a plug-in syncs from (Plex's libraries) stays in the plug-in's own settings, which define the scopes.

**Cost if wrong:** the descriptor is versioned (`contract: 1`). A host that doesn't know a contract version ignores the plug-in's sync, so a wrong shape costs a v2 and adapter updates, never data.

### D4. How N-way and the contract fit

**Playlists:** N-way is the only playlist engine at the end, and it drives providers through this contract. The driver's `bindProviderToken` wrapper becomes unnecessary for host adapters (they hold their own tokens) and is the model for the proxy.

**Library:** stays on `calculateDiff` / `syncDataType`.
- A library is an unordered set. `syncSources` already gives each row per-provider membership, and a row goes only when no provider holds it. That is the set equivalent of N-way's union.
- N-way's 3-way merge solves concurrent edits to an ordered list, which a set doesn't have.
- The library's protections (tombstones, the mass-removal safeguard, the tiered matching in `sync-engine/track-identity.js`) already work and stay.
- The one rule borrowed from N-way: a library fetch is complete or it throws.

**Loves:** stay on their append-only model (`src/renderer/lib/love-import.js`, `love_pushed_keys`, the `love-import` tombstones). They never remove, so neither engine fits them.

**Recommendation:** three engines, one contract.
**Cost if wrong:** if a set merge is ever needed (two devices saving and unsaving the same album), it goes inside `calculateDiff`. The contract is unaffected.

### D5. How every safety rule holds when the provider is a plug-in

The principle: every rule that protects user data is enforced by the host, never delegated to a plug-in. A plug-in can only make honest declarations (capabilities, complete or throw) and fetch or write what it is asked to.

| Rule (sync.md section) | Lives now | After |
|---|---|---|
| Tombstones: filter before the diff, re-arm on a hit, clear only on a user re-add, 365-day TTL | `sync-engine/tombstones.js`, the `filterRemote` hook in `sync:start` | Unchanged; the engine applies them to every library provider. A pull-only provider's removal writes a tombstone and makes no remote call. |
| Mass-removal safeguard (>25% and >50) | `syncDataType` | Unchanged; engine. Scope deselection is the one labelled exception (D3). |
| Failure is never an empty answer | each provider by convention | Contract (`SyncProviderError`) plus engine checks: `complete` must be true for a full listing; a timeout or bridge failure is a throw. |
| Partial-fetch floor, total-wipe guard, missingStreak, pending augmentation, source authority | `sync-engine/playlist-reconcile.js`, `playlist-materialize.js` | Unchanged. Plug-ins only declare `trackRemoveMode` and report an authoritative `trackCount`. |
| Push-loop guards: provider-scoped `syncedFrom`, the id prefix, `relevantMirrors`, `recordPushToSource` | both legacy renderer loops, pinned by `tests/sync/push-loop-guard-parity.test.js` | Kept until the loops are deleted (M12). Plug-in providers never join the legacy loops. |
| Never unlove on any service | renderer love paths | The contract has no unlove method. |
| No love sent back to its origin; the import cursor advances only on a confirmed write | `love_pushed_keys`, `love_import_cursor`, `love-import.js` | Unchanged; host. |
| Save payloads keep every sync field (`buildPlaylistSavePayload`) | renderer | Unchanged. Providers never write playlists. |
| A save never erases a live mirror link (`keepDroppedLinks`) | `playlists-save`, `sync:start` | Unchanged; N-way's own write path must keep calling it (M6 test). |
| Remote creates only through the three-layer dedup with `localPlaylistId` | `sync:create-playlist` | The dedup moves into a function (`createOrLinkRemotePlaylist`) used by the IPC and by N-way's create (M6). |
| `sync_playlist_links` and `sync_playlist_state` are written by main only | `main-process/sync-links.js`, `main.js` | Unchanged. The bridge carries no write access to them. |
| `syncedFrom` cleared only when the list looks complete (>70%); imports keep their link; dead mirrors confirmed by a 404 only, with a floor of 30 | `sync:start`, `missing-sources.js`, `dead-mirrors.js` | Engine. `remotePlaylistExists` returns false only on a definite 404, by contract. |
| The id-prefix heal (`healImportedSyncedFromMismatch`), and `${providerId}-${externalId}` ids | `main.js` startup | Unchanged. Provider ids must match `/^[a-z0-9]+$/`, because `reconcilePlaylist` splits the id on its first `-`. |
| Every persisted key is in `ALLOWED_STORE_KEYS` | `main-process/ipc/store.js` | Every new key read by the renderer is added (`sync_provider_pause`, `library_sync_cursors`, `nway_cycle_log`). Main-only keys don't pass the IPC allowlist. |
| Pause means nothing calls the service (`resolver_sync_settings[id].enabled`) | checked in several places | One registry function, `isSyncActive(id)`, used by every path, loves included (#1445). |
| Cancel-on-focus, phase boundaries, `finalizeCancelled` | `sync:start` | Engine; checked between pages. A bridge call in flight is abandoned. |
| Spotify's pause and abuse breaker; ListenBrainz hydration budget | `spotify-pause.js`, `spotify-breaker.js`, `lb-hydration.js` | Unchanged, inside the host adapters. Plug-ins get the generic per-provider pause. |
| Credentials never reach page state | per plug-in | Main rejects reply fields that look like credentials. A source record carries ids; stream URLs are built at play time (`getStreamUrl`). |
| Collection ids from one formula | `collection-id.js` | The host computes ids; a plug-in never supplies one. |

### D6. Migrating existing users' state

**The rule that makes this cheap:** a sync provider's id is its plug-in id, and the three built-ins already use theirs (`spotify`, `applemusic`, `listenbrainz`; loves use `lastfm` and `listenbrainz`). So none of these change, and none needs rewriting:
- `syncSources` on every collection row;
- `syncedFrom.resolver`, `syncedTo` keys and the `${providerId}-` id prefixes on playlists;
- `sync_playlist_links` and `sync_playlist_state.providers`;
- `removed_track_tombstones`, `love_pushed_keys`, `love_import_cursor` and `resolver_sync_settings`.

The migration is a code move, not a data move. Three rules keep it that way:
1. **Never rename a provider id.** A new id reads every row as new: re-imports, duplicates, and the startup heal misreading prefixes.
2. **A provider that isn't loaded is paused, not empty.** Uninstalling, disabling or failing to load a plug-in freezes its state. No path treats a missing provider's library as "everything removed". Only Remove sync… removes anything.
3. **The love setting has one home.** `scrobbler_love_push_enabled` stays the key (mobile uses the same name). The sync dialog reads and writes it.

**N-way's own migration** is the existing preview, approve or report flow. M10 adds one change: an existing user whose preview is a no-op (everything converged) is switched to `new` without a dialog, because the first cycle writes nothing. Anyone else sees the dialog once, outside Developer. Switching back stays available.

**How it is verified:**
- **A no-op golden test** (M1): recorded provider responses and a fixture store (collection, playlists, links, state, tombstones, love marks), run through the old path and the registry path. The written stores must be byte-identical.
- **A state audit script** (M1, read-only): counts by provider of `syncSources`, `syncedTo`, links, state entries, tombstones and love marks. Run it before and after on a copy of a real profile. Any change in a count is a failure.
- **A live check** on a throwaway profile copied from the maintainer's (check for a running instance and its ports first). Then sync each service and look for no "Mass removal safeguard" line, no adds or removes beyond real changes, and a no-op N-way preview.
- **The rollback test** (M7): `new`, then back to `legacy`, then one sync. No conflict banners, no pushes.

### D7. Versioning

**What an older app does with a plug-in that declares sync:** it ignores it.
- `capabilities.librarySync` is an unknown boolean, which older apps spell out as a pill. Mobile skips the unknown `sync` block (`ignoreUnknownKeys = true` in `PluginManager.kt`).
- For the built-ins, an older app keeps its own hard-coded providers, so no service syncs twice or not at all.

**`minAppVersion`:**
- Not needed when sync is additive (Plex's library sync: an older app still searches and plays).
- Required, per platform, for a plug-in whose only job is sync. Until apps older than the field (desktop 0.9.11) are rare, such a plug-in has to say in its settings that it needs a newer app.

**`requires.hostBridges`:** not used for sync. That field hides a whole plug-in when a bridge it calls is missing. Sync is the host calling the plug-in, so a host without it just never calls. If a plug-in's sync code calls a new bridge, that bridge goes in `requires` as usual.

**`sync.contract`:** a host ignores the sync of a plug-in whose contract version it doesn't know. A v2 plug-in can declare both versions during a transition.

## 5. Sequence

Each milestone is one PR (M9 is a time window, not a PR), shippable alone, with its docs updated in the same PR (`sync.md`, `plugins.md`, CLAUDE.md where an invariant changes). Two tracks run in parallel after M1: plug-in providers (M2 to M5) and finishing N-way (M6 to M8). They meet at M10.

**M1. Contract and registry (no behavior change).** Advances #1515, #1518.
- `sync-providers/contract.js` holds the typedefs, `validateDescriptor` and the error class.
- `sync-engine/registry.js` replaces the hard-coded map and builds entries from the loaded manifests.
- Host adapters wrap the three providers and absorb the four token switches, the Spotify scope check and the refresh callback.
- The three `.axe` declare `sync` with `adapter`.
- `sync:get-providers` returns descriptors.
- **Tests:** a contract conformance suite run against each adapter with fake HTTP; the no-op golden test (D6); the descriptor snapshot equals today's `capabilities` objects.
- **Live:** throwaway-profile sync of each service, plus the audit script before and after.

**M2. The renderer asks the provider.** Closes #1518 except the legacy loops' share.
- The setup dialog's choices and defaults come from the descriptor.
- The library push reads the `nativeId` field instead of `spotifyId` / `appleMusicId`.
- Remote delete and rename go by capability.
- "Sync your library" is drawn for any plug-in that declares a kind.
- Lower the drift baseline (`npm run design-drift -- --write`).
- **Tests:** the existing setup and push tests; `tests/renderer/plugin-settings-consistency.test.js`.
- **Live:** contact sheets of every plug-in dialog in light and dark (`npm run ui-sheets`), checked by task: set up, pause, remove.

**M3. The plug-in bridge.**
- Main's `PluginSyncProxy` and the renderer's `sync-plugin-host`: per-call budgets, page streaming, `not-ready` with no window, reply validation, and the generic per-provider pause.
- No plug-in declares sync yet.
- **Tests:** a fake plug-in provider end to end over a fake IPC: paging, cancel between pages, a timeout becomes a throw, a closed window skips the provider, a malformed or credential-bearing reply is rejected, a provider is never called twice at once.

**M4. Plex library sync (the early proof).** Closes #1515.
- Plex implements `fetchLibraryPage` for tracks (and albums and artists if its API makes them cheap), pull-only. It uses `addedAt` / `updatedAt` for deltas, a daily full listing for removals, `scope` per library, and `nativeId: 'plexRatingKey'`.
- Bump Plex's version. No `minAppVersion` is needed (the capability is additive).
- **Tests** (#1515's list): the engine path with Plex's real page parser over fixtures; deselecting a library removes its rows; no remote write is ever attempted (there is no method to call); a Collection removal tombstones; untagged items are skipped.
- **Live:** the maintainer's server with two libraries: first sync, an added file, a deleted file, a library deselected, the window minimized during a sync.
- **Mobile:** no ticket for Plex (`mobile: false`). File the contract ticket here (see 6).

**M5. Loves through the contract.** Closes #1445 and #1519's loved-tracks part.
- Renderer-side adapters over the two scrobbler classes.
- `runLoveBackfill`, `runLoveImport` and `pushLoveToScrobblers` call the provider found through the registry.
- The sync dialog's "Loved tracks" choice and the Sync menu's pause gate love pushes.
- Last.fm gets a loves-only row in the Sync menu.
- Also fix the stale "lands with its stacked slice" line in `sync.md`.
- **Tests:** the existing love tests, plus a paused service gets no push.
- **Mobile:** update parachord-mobile#669 and #699 with the shape.

**M6. N-way creates and imports.** Advances #911.
- Extract the three-layer dedup into `createOrLinkRemotePlaylist`. In `new` mode, each cycle starts with three steps:
  - import newly selected playlists, and every playlist for an `importAll` provider, honouring `suppressed_sync_playlists`;
  - create mirrors for channel-allowed playlists that lack one, using the push-candidate rules in `sync-engine/playlist-push-candidate.js`;
  - seed `sync_playlist_state` for any playlist with sync intent and no entry, the same as the launch bootstrap.
- The preview shows "would create" and "would import".
- **Tests:** no double create across two cycles; link, `syncedTo` and name-match dedup all reuse an existing remote; a suppressed playlist is never imported; a channel-excluded provider never gets a mirror; ListenBrainz re-export stays opt-in.
- **Mobile:** ticket for the same gap.

**M7. N-way feature parity.**
- Renames through `updatePlaylistDetails` when `supportsPlaylistRename`.
- The dead-mirror flag in `new`, reusing `flagDeadMirrors`, so the 404 probe and the floor of 30 apply.
- The Achordion submit after N-way writes.
- Keep `syncedFrom.snapshotId` and `tracksFingerprint` in step on N-way writes.
- Batch the cycle's playlist writes into one `local_playlists` write: the driver now rewrites the whole array once per changed playlist (`storeAbstraction.savePlaylist`).
- **Tests:** the rollback test (D6); a rename reaches each mirror that can take one; a dead ListenBrainz mirror is flagged, not recreated.
- **Mobile:** a ticket only for the rename and rollback items (the dead-mirror difference is deliberate, #1269).

**M8. Validation record and shared vectors.** Closes #945.
- A local rolling `nway_cycle_log` (main-written, last 200 cycles: per playlist adds, removes, holds, aborts), and a "Copy sync report" button beside "Use new sync". It is consensual, with no telemetry, matching the migration plan.
- Author shared JSON vectors for missingStreak, materialize and source authority, plus #945's temporal scenarios, run by both engines.
- Add a `sync.md` N-way section.
- **Mobile:** vendor the vectors and add the Kotlin runner.

**M9. The live validation window (a gate, not a PR).** At least two release cycles in which:
- the maintainer's library and the opt-in users run `new` with M6 to M8 in;
- every non-noop cycle in `nway_cycle_log` is explained;
- no N-way data-loss issue is open;
- a mixed fleet (desktop `new`, mobile `legacy`, then both `new`) converges on the same account.

**M10. Default flip (Phase 3).**
- Fresh installs default to `new`.
- Existing users with a no-op preview switch silently; others see the dialog once.
- Remove the `nway_propagate` dev flag (it writes without a preview).
- Mobile flips its `DEFAULT_MODE` in the same window.
- **Gate:** M6 to M9 done, plus mobile's equivalents of M6 and M8 merged.

**M11. Plug-in playlist providers.** Subsonic, Jellyfin and Plex playlists through M3's bridge, N-way only.
- Waiting for M10 means they never touch the legacy loops, and every user who has them gets them.

**M12. Legacy removal (Phase 4).** Closes #790 and the rest of #1518.
- **Gate:** two to three releases after M10 (the migration plan's window). There is no telemetry, so the window is time-based. Also no open N-way data-loss issue, and mobile at the same step.
- **Delete:** both renderer loops, `sync:start`'s inbound playlist phase and its helpers (auto-pull, the stagger, `canShortCircuitPlaylistUpdate`), and the legacy `sync:push-playlist` path.
- **Keep:** the data-model fields, the heal, the link map and the dedup gateway.
- Lower the drift baseline.

**M13. The scheduler and library orchestration move to main.** Closes #802.
- With the playlist loops gone, what moves is the 15-min, startup and blur triggers, cancel-on-focus and the provider loop.
- Loves move with it.
- **Re-scope #801:** the split store already gives `local_playlists` its own file, so what remains is per-record writes. Measure after M7's batching, and close it if the pinwheel is gone.

**M14. More library plug-ins, and social reads.**
- Subsonic, then Jellyfin (#742), as plug-in changes only.
- An Amazon liked-and-purchased library is possible later on the same contract. It would validate the bridge for a plug-in that rides `webSession`.
- #1519's friends and charts become ordinary plug-in capabilities (`friends`, `charts`) read through `resolver-loader.js`, like `getRecommendations`. They are not sync, have no state to protect, and can land any time after M2.

**Where the other issues sit:**
- **#1494** (Amazon Prime purchases) doesn't depend on this plan. Its owned list belongs inside the plug-in.
- **#1520** (Local Files capabilities) is independent and can land any time.

## 6. Android

Desktop and mobile write the same remote playlists and libraries. A drift in identity, removal rules or provider ids corrupts data on both.

**What mobile must mirror:**
- **Provider ids are plug-in ids** and never change. The `${providerId}-${externalId}` prefix rule applies, and ids have no hyphen.
- **Failure semantics:** a failure throws, and nothing returns `null`. Mobile's `SyncProvider.fetchTracks` returns `null` for "not supported", where desktop's meant "unchanged". Both move to explicit answers.
- **Capability names and meanings:** `trackRemoveMode`, `canReorder`, `supportsPlaylistDelete`, `supportsPlaylistRename`, and `snapshots` (mobile's `SnapshotKind`, which desktop adopts). `capabilities` stays all booleans.
- **N-way:** the same create, import and seed steps in `new` (mobile has the same gap); the rename and rollback fixes; the default flip in the same window.
- **Loves in sync:** the dialog choice, and the pause covering loves (#1445).

**Shared test vectors** (the #911 parity mechanism):
- **Already shared:** `canonical-fixtures.json` (merge), `key-unify-fixtures.json` (unification), `no-false-drop-scenarios.json`.
- **To author at M8:** missingStreak, materialize, source-authority and #945's temporal scenarios, as JSON both engines run. The Kotlin `NwayMaterializeTest` and `NwaySourceAuthorityTest` are ported by hand today.
- **Recommended:** a CI check that diffs the vendored files against mobile's `main`.

**Mobile tickets to file:**

| When | Ticket |
|---|---|
| M1 merges | Sync provider contract: ids, failure and `null` semantics, capability names, the manifest `sync` block (informational; mobile's Kotlin providers stay, nothing to port yet). |
| M5 merges | Update parachord-mobile#669 and #699: loves as part of each service's sync, one setting, the pause covers loves. |
| M6 merges | N-way `new` mode imports, creates mirrors and seeds state each cycle. |
| M7 merges | Rename propagation and the switch-back test (dead mirrors excluded on purpose). |
| M8 | Vendor the new shared vectors and run them in Kotlin. |
| M10 | Coordinated default flip: `DEFAULT_MODE = new`, and the silent switch for a no-op preview. |
| M11, only if a sync plug-in is mobile-capable | A Kotlin `SyncProvider` over `JsRuntime` for plug-in providers. |

**Could mobile run a plug-in provider?** Probably, with work. Android runs `.axe` in a headless WebView and iOS in JavaScriptCore, behind `JsRuntime.evaluate` (a string interface with a 20 s timeout in `JsBridge`). Background sync runs in WorkManager (`LibrarySyncWorker`) against Kotlin providers, and I did not check whether the headless WebView can be driven from a worker. No sync plug-in is mobile-capable yet (Plex is `mobile: false`), so this waits.

## 7. Risks and open questions

1. **Plug-in sync needs a window.** On macOS with the window closed, Plex and later plug-ins don't sync, while host adapters do after M13. Acceptable, or should M3 include the hidden plug-in host window?
2. **"Become plug-in providers" read as host adapters.** Confirm that Spotify, Apple Music and ListenBrainz keeping their main-side code (D2) meets the goal.
3. **Silent switch for a no-op preview** (M10). It writes nothing on the first cycle, but it changes the engine without asking. Acceptable?
4. **Time-based legacy removal.** With no telemetry, old desktop builds stay on `legacy` forever and keep writing the same remotes. Coexistence safety (#945, identity parity) carries that indefinitely, not just during a window.
5. **The desktop executor's live record is thin.** M9 is the first sustained record. If it finds a data-loss class, M10 slips, and opt-in users are exposed until then.
6. **Plug-in trust.** The bridge gives a plug-in no other provider's token and no write access to local state. A plug-in still holds its own service's account. That is unchanged from today, but sync makes a bad plug-in update able to write to that account at scale.
7. **The player adapter (#1517)** touches sync in one place: the source record the host builds for a synced item has to be what the player adapter plays from. Agree its shape when #1517 settles; M4 uses Plex's existing `html5Stream` source.

## Appendix A. Contract signatures

```js
// Manifest (plugins-src/<id>/manifest.json), alongside the existing keys.
"capabilities": { "librarySync": true, "playlistSync": true, "lovedTracks": true },
"sync": {
  "contract": 1,
  "adapter": "spotify",              // optional: a host adapter; absent = the .axe implements the methods
  "kinds": {
    "tracks":  { "read": true, "write": true,  "incremental": "count" },   // 'none' | 'count' | 'since' | 'cursor'
    "albums":  { "read": true, "write": true,  "incremental": "count" },
    "artists": { "read": true, "write": true,  "incremental": "none" },
    "playlists": {
      "read": true, "create": true,
      "trackRemoveMode": "ByNativeId",     // TrackRemoveMode
      "canReorder": true,
      "supportsPlaylistDelete": true,
      "supportsPlaylistRename": true,
      "snapshots": "opaque",               // 'opaque' | 'date' | 'none'
      "importAll": false,                  // ListenBrainz: true
      "mirrorOutByDefault": true,          // ListenBrainz: false (re-export is opt-in)
      "folders": false
    },
    "loves": { "read": true, "push": true }
  },
  "nativeId": { "tracks": "spotifyUri", "albums": "spotifyId", "artists": "spotifyId" },
  "scopes": false,                         // Plex: true
  "defaults": { "tracks": true, "albums": true, "artists": true, "playlists": true,
                "loves": false, "pushLocalPlaylists": true }
}
```

```js
// Every method is async and token-free. ctx = { signal, budgetMs, config }.

/** @typedef {'auth'|'rate-limited'|'not-ready'|'unsupported'|'failed'} SyncErrorCode */
class SyncProviderError extends Error { /* code, status?, retryAfterMs? */ }

checkAuth(ctx)
  // -> { ok: boolean, status?: number, reauth: boolean, message?: string }

// ── Library (kind: 'tracks' | 'albums' | 'artists') ──
fetchLibraryPage(kind, { cursor, since, localCount, latestExternalId }, ctx)
  // -> { items: SyncItem[], nextCursor: string|null,
  //      mode: 'full'|'delta',
  //      complete: boolean,        // true only on the LAST page of a FULL listing
  //      unchanged?: true,         // replaces today's null
  //      selectedScopes?: string[], total?: number }
saveLibraryItems(kind, nativeIds, ctx)    // -> { saved: string[] }    only if kinds[kind].write
removeLibraryItems(kind, nativeIds, ctx)  // -> { removed: string[] }  only if kinds[kind].write

/** @typedef SyncItem
 *  { externalId, nativeId, title, artist, album?, albumArtist?, duration?, isrc?, mbid?,
 *    addedAt?, updatedAt?, scope?, art?, source: object }   // no collection id; no credentials
 */

// ── Playlists (names as N-way and mobile already use them) ──
fetchPlaylists(ctx)
  // -> { playlists: [{ externalId, name, description?, image?, trackCount /* authoritative */,
  //      snapshotId?, isOwnedByUser, isCollaborative?, ownerId?, folderId? }], complete: true }
fetchPlaylistTracks(externalId, ctx)            // -> SyncPlaylistTrack[]  (every track, or throw)
getPlaylistSnapshot(externalId, ctx)            // -> string|null
createPlaylist(name, description, ctx)          // -> { externalId, snapshotId? }  host calls it only via createOrLinkRemotePlaylist
addPlaylistTracks(externalId, nativeIds, ctx)   // -> { snapshotId? }
removePlaylistTracksByNativeId(externalId, nativeIds, ctx)  // ByNativeId only
removePlaylistTracksByPosition(externalId, positions, ctx)  // ByPosition only
replacePlaylistTracks(externalId, nativeIds, ctx)           // ReplaceOnly only
updatePlaylistDetails(externalId, { name, description }, ctx)  // -> { applied: boolean }
deletePlaylist(externalId, ctx)                 // -> { deleted: boolean, reason?: 'unsupported' }
remotePlaylistExists(externalId, ctx)           // -> boolean; false ONLY on a definite 404
searchForTrackId({ title, artist, album, isrc }, ctx)  // -> nativeId | null (null = catalog miss)

// ── Loves (never an unlove) ──
fetchLovesPage({ cursor }, ctx)
  // -> { loves: [{ artist, title, album?, mbid?, lovedAt }], nextCursor, complete }
pushLove({ artist, title, album, mbid }, ctx)   // -> { mbid?: string }
```

**Host rules on replies:**
- Unknown fields are dropped.
- A field named like a credential (`token`, `password`, `apiKey`, `X-Plex-Token` in a URL) fails the reply.
- A full listing that ends without `complete: true` is a failure.
- An item without artist or title is skipped and counted.

## Appendix B. Code pointers for the N-way gaps

- **Mutual exclusion:** `legacyPlaylistSyncEnabled` (`sync-engine/sync-engine-mode.js`), used in `sync-create.js` (create), `sync-playlists.js` (push), `sync-start.js` (inbound) and the two loops in `app.js`.
- **The drive:**
  - `runNwayShadowReconcile` and `runNwayArmedDrive` (`main.js`);
  - `runNwayReconcileCycle`, `bindProviderToken` and `makeStoreEffects` (`sync-engine/nway-reconcile-driver.js`);
  - `reconcilePlaylist` (`sync-engine/playlist-reconcile.js`): no create or import path, and a mirror with no list entry reads as unchanged.
- **Seeding:** `bootstrapNwayPlaylistState` (`main.js`), at launch only.
- **Things only the legacy paths do:**
  - `flagDeadMirrors` (`sync-start.js`);
  - `pushPlaylistLinksToAchordion` (the create and push handlers);
  - `recordPushToSource` and the fingerprint writes (`sync-engine/auto-pull.js` via the renderer loops and `sync:start`).
- **Preview UI:** `src/renderer/components/nway-migration-dialog.js`, opened from `src/renderer/components/settings-page.js` (Settings › Developer).
- **Mobile's equivalents:** `SyncEngineMode.kt`, the `new` early return in `SyncEngine.syncPlaylists`, and `SyncProvider.kt`. All are read-only references from parachord-android `main`, checked 2026-11-18.
