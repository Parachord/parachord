# Syncing system

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Syncing System

### Playlist Sync Overview
- `syncSetupModal` (L5361): Multi-step wizard (options -> playlists -> syncing -> complete)
- Providers: spotify, applemusic (primary); also librefm, listenbrainz for scrobbling
- Settings loaded via `window.electron.syncSettings.load()`, saved per-provider via `.setProvider()`
- `suppressSync(providerId, externalId)`: Prevents future auto-sync for a removed playlist

### Playlist Sync Data Model

Every local playlist object can carry these sync-related fields. **Any client (desktop, Android, etc.) MUST preserve all of them on every save path or duplicates get created.**

| Field | Direction | Meaning |
|---|---|---|
| `syncedFrom: { resolver, externalId, snapshotId, ownerId }` | remote → local | This playlist was imported from that remote. Pull updates apply to it. |
| `syncedTo: { [providerId]: { externalId, snapshotId, syncedAt, unresolvedTracks, pendingAction } }` | local → remote | This playlist has been (or should be) pushed to those remotes. Push updates go there. |
| `syncSources: { [providerId]: { addedAt, syncedAt } }` | metadata | When items were added on each provider, for last-sync timestamps. |
| `hasUpdates: boolean` | remote → local | Remote `snapshotId` differs from ours. Shown as "pull" banner. |
| `locallyModified: boolean` | local → remote | Local content changed since last sync. Triggers the push branch. |
| `lastModified: number` | local | Timestamp of the last local content change. |
| `localOnly: boolean` | intent | User opted this playlist out of all provider sync. |
| `sourceUrl: string` | hosted XSPF | Playlist mirrors a remote XSPF URL, polled every 5 min. |
| `id` | local | Local playlist ID. Imported playlists use `${providerId}-${externalId}`; manually created use `playlist-${Date.now()}`, `ai-chat-${Date.now()}`, `hosted-${hash(url)}`, etc. |

### Durable Link Map (`sync_playlist_links`)

`syncedTo[providerId].externalId` on the playlist object is the primary local→remote link, but it's fragile: any save path that forgets to forward the field drops it. To prevent duplicate creation when that happens, we maintain a parallel map in electron-store:

```
sync_playlist_links = {
  [localPlaylistId]: {
    [providerId]: { externalId, syncedAt }
  }
}
```

**Rules:**
- **Only the main process writes it** (see `setSyncLink`, `removeSyncLink`, `migrateSyncLinksFromPlaylists` in main-process/sync-links.js). Renderer playlist saves cannot clobber it.
- Written on successful create or link inside `sync:create-playlist`.
- Pruned when `cleanupDuplicatePlaylists` deletes a remote.
- Populated on every startup from existing `syncedTo` data (idempotent migration) — ensures users upgrading never lose existing links.
- The renderer can read it via `window.electron.syncLinks.getAll()` but usually doesn't need to.

### Three-Layer Duplicate Prevention

All remote-playlist writes flow through the `sync:create-playlist` IPC handler (main-process/ipc/sync-create.js). Before calling `provider.createPlaylist`, the handler checks for an existing remote in this order:

1. **ID link via `sync_playlist_links[localPlaylistId][providerId]`.** If present, fetch the user's owned remote playlists and verify the stored `externalId` still exists. Match → reuse (pushes tracks, returns the existing ID). Gone → remove the stale link, fall through.
2. **ID link via `syncedTo[providerId].externalId` on the playlist.** Same validation logic. (In practice the renderer already short-circuits this case before calling the IPC, but the handler re-checks for robustness.)
3. **Name match fallback** (trim + lowercase, user-owned only). Picks the richest match if multiple exist. Last-ditch cover for legacy data where no ID link survived.

Only if all three fail does `provider.createPlaylist` actually create a new remote. On success, both `sync_playlist_links` and the caller's `syncedTo` must be populated.

### Sync performance invariants (epic #803)

Five tier-1 + tier-2 fixes addressing the 120% CPU spike + pinwheel users used to see on every background sync. Each is independent but mutually-reinforcing — touch any of the related code paths with awareness of the others.

- **Skip-unchanged playlists** (parachord#796). `sync-engine/index.js` exposes `canShortCircuitPlaylistUpdate({localPlaylist, remotePlaylist, providerId})` — pure predicate returning true when an inbound playlist update can skip the spread-rewrite work (snapshotIds match AND no metadata backfill pending AND owner/collaborator state stable). Called inside `sync:start`'s inbound playlist loop in main.js. Don't bypass without good reason — the savings compound with #800 staggering.

- **Resolver concurrency cap** (parachord#797). `resolver-limiter.js` (loaded via index.html `<script>` before app.js) exposes `createLimiter()` factory + `window.globalResolverLimiter` (concurrency 4, minGap 100ms, cooldown on consecutive throttle errors). Each non-AM/Spotify/localfiles resolver's `.search` method is wrapped via `window.wrapResolverSearchesWithLimiter` at load time — including in the marketplace hot-add paths in app.js. Any new content resolver registered through `loadResolver` inherits the limiter automatically. Don't bypass for new resolvers without considering the renderer's shared socket pool + JSON-parse + match-validation budget. Skip set is `{applemusic, spotify, localfiles}`: AM has its own dedicated limiter, Spotify has a per-token budget, localfiles is in-process.

- **Renderer push loop yields to idle** (parachord#798). The 4 sync-related iteration sites in app.js (background-sync push loop, background-sync inner save loop, post-wizard IIFE push loop, post-wizard IIFE inner save loop) wrap each iteration in `await yieldToIdle()` — a thin Promise-wrapper around `window.requestIdleCallback` with a `setTimeout(r, 16)` fallback. Any new sync-related iteration (e.g. future orchestrator at #802) should yield similarly. The 2000ms timeout in `yieldToIdle` ensures sync still makes forward progress when the renderer is genuinely busy.

- **Cancel-on-focus** (parachord#799). See "Background Sync Cadence" below — the dedicated subsection covers the two-layer renderer+main coordination and partial-save semantics.

- **Staggered playlist sync per cycle** (parachord#800). See "Staggered playlist sync per cycle" below.

When designing new sync features (#801 per-playlist store keys, #802 orchestrator refactor, or anything else): consider how the new code interacts with all five invariants. The push-loop yields and cancel-on-focus checks especially need to be preserved in any code that iterates `local_playlists` with per-item IPCs.

### Background Sync Cadence

Three triggers fire `runBackgroundSync` (app.js, ~L6177 `useEffect`). The function takes an optional `{ minStaleness }` so the per-provider `lastSyncAt < threshold` gate can be tightened or relaxed without forking the function body.

| Trigger | Cadence | Staleness gate | Why |
|---|---|---|---|
| Initial | 60s after app start | 15 min | Catch playlists that changed while the app was closed; delayed so the renderer is interactive first. |
| Timer | every 15 min | 15 min | Floor cadence — runs regardless of focus state. |
| Window **blur** | 30s after losing focus, cancelled if user returns first | **5 min** (tighter) | Heavy work happens while the user is away. They come back to fresh state with zero on-resume cost. |

**Do NOT trigger on foreground / focus.** An earlier iteration fired sync on `onForeground` to catch the "left app open all day, walk back" case. Net effect: ~35 seconds of IPC churn (multi-provider library fetch + 142 playlists × 250ms inter-IPC delay) started exactly when the user wanted the app responsive. Visible pinwheel + CPU spike on resume, force-quit territory. Inverted to `onBackground` — heavy work now happens during the user's absence, not their return.

Two-layer dedup keeps blur-triggered runs cheap:

- **Outer (blur path only):** 30s `setTimeout` that the foreground handler cancels — prevents sync from firing on brief Cmd+Tab blurs.
- **Inner (all paths):** `settings.lastSyncAt < minStaleness` — prevents redundant API calls per provider regardless of trigger.

Net effect for an always-open user: blur for >30s → sync fires while they're gone, completes before they return. Blur for <30s (quick Cmd+Tab) → pending sync cancelled, never fires. Sync never coincides with active app use.

The handlers use `window.electron.app.onBackground` / `onForeground` (preload bridges `app-background` / `app-foreground` IPC). No unsubscribe paths are exposed by the preload (multi-listener safe); they detach when the renderer tears down.

**Cancel-on-focus** (parachord#799). Mid-sync foreground events cancel the in-flight background sync. Two-layer mechanism:

1. **Renderer side** holds `backgroundSyncInFlightRef` (Set of provider IDs with active `sync.start` IPCs) and `backgroundSyncCancelledRef` (boolean flag). The foreground handler flips the flag true and fires `window.electron.sync.cancel(providerId)` for each in-flight provider. The next iteration of the provider loop and any in-flight push loop checks the flag and bails.

2. **Main process** `sync:start` IPC handler checks `activeSyncs.get(providerId)?.cancelled` at every phase boundary (after tracks / after albums / after artists / before playlists) and per-iteration inside the playlist loop. When the flag flips, it runs `finalizeCancelled(collection, results)` which writes the partial collection to disk, bumps `lastSyncAt` so the staleness gate doesn't immediately re-fire, and returns `{success: true, cancelled: true, results, collection}`. Anything mutated in memory before the cancellation point sticks; remaining work defers to the next non-cancelled sync.

**Wizard sync is exempt.** The wizard's manual `sync.start` doesn't go through `runBackgroundSync` and doesn't add to `backgroundSyncInFlightRef`, so foreground events don't cancel it. The user is engaged with the wizard; their sync runs to completion regardless.

**Partial-save semantics.** When the playlist loop is cancelled mid-iteration, `local_playlists` IS written with the in-memory state (so playlists already processed get their `syncedAt` advanced) but the `syncedFrom`-clearing pass is SKIPPED (we may not have visited every selected playlist; clearing based on a partial iteration could mass-clear playlists that haven't been verified-missing-from-remote yet). The next non-cancelled sync re-runs the clearing pass over the full set.

### Staggered playlist sync per cycle (parachord#800)

`sync:start`'s inbound playlist loop processes the **top N oldest-stale playlists** per cycle rather than every selected playlist. With 50 selected × 15-min cadence × batch=15, the whole selection rolls through in ~2.5h worst-case. Most users don't notice; cross-platform power-users get a manual escape via "Sync Now."

`staggerPlaylistsForCycle` (sync-engine/index.js) is the pure sort+slice helper. Sort order:

1. `syncSources[providerId].syncedAt` ascending — oldest-stale first. Playlists with no local entry sort to top (first-time imports run on the first cycle after wizard selection).
2. `lastModified` descending — breaks ties; recent local edits get sync priority over dormant playlists.

**`hasUpdates: true` is NOT a sort priority** (parachord#835). Earlier the sort put hasUpdates-true playlists first on the reasoning that the user is "waiting on a pending pull" — but hasUpdates is a state flag, not an action signal. Once set, the banner is already visible in the UI and re-running sync on the playlist doesn't change anything (the inbound diff just re-confirms what we already know; `stillHasUpdates` keeps the local snapshotId pinned to the pre-detection value until the user actually pulls). When N playlists accumulate hasUpdates=true (easy with daily/weekly algorithmic playlists the user hasn't acted on), they monopolize every batch and the syncedAt-asc tail starves — discovery of NEW pending updates (e.g. Daily Brew rotating from yesterday's content to today's) never happens. Pure syncedAt-asc keeps discovery on its target ~2.5h-worst-case cadence regardless of how many hasUpdates banners are outstanding.

**Full-sync bypass** via `options.fullSync = true` on the `sync:start` IPC. All renderer-side user-initiated sync paths pass it: wizard "Sync Now" (post-config + post-syncing-complete), Spotify/AM re-auth catch-up triggers. `runBackgroundSync` does NOT pass it — that's the cadenced path the stagger targets.

The clearing pass for "remote playlist no longer exists" still runs against the FULL fetched `remotePlaylists` (not the staggered subset), so deleted-on-remote detection is unaffected by which subset we iterate.

### In-Session Mutex

The renderer has **two independent code paths** that call `sync.createPlaylist` and `sync.pushPlaylist`:

- Background sync timer (every 15 min, plus initial-run + focus-triggered, all sharing `runBackgroundSync` at app.js ~L5989)
- Manual sync post-IIFE after the wizard completes (app.js L9312+)

Both loops have the same structure: iterate `local_playlists`, for each one either create a remote (if no `syncedTo[providerId]`) or push updates (if `locallyModified`), then clear `locallyModified` when all mirrors are up to date. Keep them in sync — if you add a guard or branch to one, add it to the other. Without coordination they race: both read a playlist without `syncedTo`, both call `sync.createPlaylist`, both create remotes.

**Mitigation:** `playlistSyncInProgressRef` (app.js L5512), a simple renderer-side boolean ref. Each path acquires it before the creation loop and releases in `finally`. If already held, the path skips with a log message. This is belt-and-suspenders with the IPC-level dedup above.

### Required: Pass `localPlaylistId` When Calling Create

The IPC signature is:
```js
window.electron.sync.createPlaylist(providerId, name, description, tracks, localPlaylistId)
```

**Always pass `localPlaylistId`** (it's the local playlist's `id` field). Without it:
- Step 1 (sync_playlist_links lookup) is skipped — we can't look up a link without a key.
- `setSyncLink` on success is skipped — the durable map stays empty for this playlist.

Only the name-match fallback protects you. Don't rely on it.

### Cleanup: Relink Orphans, Then Dedup

`sync:cleanup-duplicate-playlists` (main-process/ipc/sync-playlists.js) runs two phases:

**Phase 1 — Relink orphans** (via shared helper `relinkOrphansFor`). A local playlist is "orphaned" for a provider if it has tracks, isn't `localOnly`, and has no `syncedTo[providerId]`, `syncedFrom` for that provider, nor `sync_playlist_links` entry. For each orphan with an unambiguous 1:1 name match against a user-owned remote, write both `syncedTo[providerId]` and the link map entry. Ambiguous cases (multiple locals same name, OR multiple remotes same name) are surfaced in the response as `ambiguous` — never automatically resolved.

**Phase 2 — Link-aware deduplication.** Group remote owned playlists by `trim().toLowerCase(name)`. For each group with >1 member:
- **If exactly one remote is linked** to any local (via `syncedTo`, `syncedFrom`, or the link map) → that remote is the keeper. Track counts don't matter.
- **If multiple remotes in the group each have distinct local references** → group is ambiguous, skip entirely. Do not delete anything.
- **If no linked remotes** → fallback: most tracks, tiebreak on most recent `snapshotId`.

Keeper selection guarantees no local ever gets silently re-pointed to a copy it wasn't synced with. Phase 1 must run before Phase 2 so the keeper check sees freshly-written links.

### Hosted XSPF Semantics

A playlist with `sourceUrl` is a **hosted XSPF** — it mirrors a remote URL polled every 5 minutes (`pollHostedPlaylists` effect, app.js ~L37104). The XSPF is canonical; Spotify (if linked) is a passive mirror.

**A provider playlist page is NOT a hosted XSPF (2026-10 fix).** A `sourceUrl` owned by a resolver as a playlist page (`window.isProviderPlaylistUrl(url, resolverLoaderRef.current)` — mirrored in `tests/helpers/playlist-url-classify.js`, tested in `tests/protocol/playlist-url-classify.test.js`) means the playlist was a **resolver import** (Spotify/Apple Music/Amazon/SoundCloud) — a snapshot, not a mirror. The provider page's fetched HTML never equals the stored XSPF, so the poller's content-compare re-runs a full resolver import every 5 minutes forever; and before resolvers finish loading, `handleImportPlaylistFromUrl`'s dispatch falls into the XSPF branch and shows "Import Failed / Failed to parse XSPF file from URL" at startup for a playlist that imported fine (observed with an Amazon playlist import — Electron's `file://` renderer does NOT enforce CORS on these fetches, so the provider page HTML reaches `parseXSPF` and parses to zero tracks). Rules:

- The resolver branch of `handleImportPlaylistFromUrl` keeps `sourceUrl` on the playlist object (provenance + the manual Refresh button, which re-runs the resolver import and toasts on failure) but must NOT push the URL into the `hosted_playlists` startup-reload store — that write is gated on `!resolverId`. Do not put provider URLs back on that list to "make them refresh"; that is the launch dialog.
- `window.isProviderImportedPlaylist(playlist, loader)` is the snapshot predicate: `source` ending in `-import` (works before resolvers load) OR `isProviderPlaylistUrl`. `savePlaylistToStore` persists those through `playlists.save`. The `sourceUrl` early-return (title/creator only, into `hosted_playlists`) is hosted XSPF only — using it for a snapshot drops track edits on restart and must not be widened back.
- `loadHostedPlaylists` awaits resolver init (`resolversInitRef`, bounded 15s) before dispatching imports, and **self-heals** pre-fix state: provider URLs already enrolled in the `hosted_playlists` store list are dropped (logged).
- `pollHostedPlaylists` filters `p.sourceUrl && !isProviderPlaylistUrl(p.sourceUrl)` — only true hosted documents are polled.
- Background reloads (startup list + poller) and the Refresh button (`quiet: true`) call `handleImportPlaylistFromUrl` so a zero-track parse **throws** instead of showing a modal. A `provider: true` call whose loader cannot classify the URL throws rather than fetching the page as XSPF. User-initiated imports keep the dialog.

Flow:
1. Poller fetches `sourceUrl`. If `content !== playlist.xspf`, call `handleImportPlaylistFromUrl` → replaces `tracks`, sets `locallyModified: true`.
2. Next sync push loop pushes local tracks to Spotify via `updatePlaylistTracks` (full replace).
3. Spotify's own state (if changed since last sync) is overwritten.

**Sync banner behavior for hosted playlists** (app.js ~L44433): the "pull" option is suppressed. A pull would briefly replace local tracks with Spotify's, but the 5-min poller would revert it and the next sync push would overwrite Spotify again — effectively a no-op with confusing UX. For hosted playlists:
- `hasUpdates=true, locallyModified=false` → banner hidden (pull is useless).
- `locallyModified=true` → banner shows as push (XSPF is ready to go upstream).
- Conflict (both flags) → rendered as push (XSPF wins anyway).

**Sync banner's push-state check must discount pull-induced `locallyModified`** (app.js ~L44422). The banner is scoped to `syncedFrom.resolver` (the source provider). `locallyModified: true` has two triggers: (a) the user actually edited local content, and (b) `handlePull` on a multi-mirror playlist sets it so the next push loop propagates the pull to *other* mirrors (the multi-provider mirror-propagation fix). Treating case (b) as "push to source" shows a spurious "Push to Spotify" banner immediately after the user clicks "Pull from Spotify" — the push-to-source would be a no-op (the push loop's provider-scoped `syncedFrom` guard correctly skips it), but the banner doesn't know that. Gate `hasLocalChanges` on real divergence from the source: `playlist.locallyModified && lastModified > syncSources[sourceProvider].syncedAt`. `handlePull` sets both to the same `Date.now()` so the comparison is false right after a pull; a subsequent real edit bumps `lastModified` and flips it to true.

### Provider-Specific Push Semantics

| Provider | Semantics | How |
|---|---|---|
| **Spotify** | Full replace | `PUT /playlists/{id}/tracks` replaces; subsequent batches `POST` to append for >100 tracks. |
| **Apple Music** | Full replace via PUT (best-effort) | `updatePlaylistTracks` fetches current remote tracks to compute a diff, then issues `PUT /v1/me/library/playlists/{id}/tracks` with the full desired tracklist in the body. Apple's public API documents only POST for this resource, but Cider and similar third-party clients use PUT here for replace-all semantics. If Apple rejects PUT on the public host with 401/403/405 (consistent with Apple's stated "DELETE/PUT on library resources not supported via public API" policy, per Apple Developer Forum thread 107807), the provider flips a session kill-switch and degrades to append-only — POSTs the new additions, leaves removals on the remote. Pure-additive changes (no removals, no duplicates to collapse) skip PUT entirely and use POST since POST is the documented path. |
| **ListenBrainz** | Clear + add | `POST /1/playlist/<mbid>/item/delete` removes all, then `POST /1/playlist/<mbid>/item/add` adds the new list in 100-track batches. No full-replace PUT exists. JSPF format on the wire; recording MBID is the per-track identifier — tracks without a resolvable MBID are skipped and surfaced via `unresolvedTracks`. |

Apple Music playlist-level DELETE and PATCH (rename) are similarly documented-unsupported and return 401 in practice. `deletePlaylist` tries DELETE once and returns `{ success: false, reason: 'endpoint-unsupported', status }` on rejection — there is no rename fallback because PATCH returns the same 401. The only reliable path Cider uses for these operations is the private `amp-api.music.apple.com` host with an authority-header rewrite; Parachord has chosen not to depend on that undocumented host.

Apple Music fallback behavior:

- `updatePlaylistTracks` tries PUT first when removals or duplicate-collapse are needed. On 401/403/405 it flips `amPutUnsupportedRef.current = true` for the rest of the process — subsequent calls skip straight to POST-append without retrying PUT. The flag resets on app restart so we re-probe if Apple's behavior changes.
- `updatePlaylistDetails` (PATCH name/description) must NOT throw on Apple's 401/403/405 — it's called by `sync:push-playlist` *before* the track push, so a throw would abort tracks too. Instead, flip `amPatchUnsupportedRef.current = true`, log once, and return `{success: true, skipped: 'endpoint-unsupported'}`. The rename silently no-ops for the session; the track push still runs. Main.js also wraps the `updatePlaylistDetails` call in a try/catch as defense-in-depth against future throws (e.g. network errors).
- If fetching current tracks fails (network, 429) before the diff, the call continues with an empty `currentCatalog` — treated as a fresh push; everything requested gets POSTed.
- `sync:cleanup-duplicate-playlists` must tolerate `deletePlaylist` returning `{ success: false, reason: 'endpoint-unsupported' }`. The handler counts these separately (`unsupported`, `unsupportedManualRemoval[]`) so the renderer can surface "remove these manually in the Music app" alongside real deletion counts. The local relink phase still produces correct local state regardless of delete success.

Consequences:

- When PUT works, `updatePlaylistTracks` with an empty array genuinely clears the playlist. When PUT is rejected, the playlist only grows — removals stay on the remote until the user clears them in the Music app.
- There is no per-track DELETE path any more; the prior `DELETE /tracks/{libraryTrackId}` implementation was based on an unverified claim. No third-party client actually uses that endpoint — Cider achieves removal by calling PUT on the parent resource with the new tracklist. Removed to avoid misleading failure modes.
- **There is no reliable public-API path for playlist rename or full deletion.** Both return 401 on MusicKit-issued user tokens. Surface this to users as "remove it manually in the Music app" rather than retrying with PATCH.
- Android implementations: same PUT-replace pattern, same URL/headers. DELETE/PATCH playlist endpoints will behave the same (return 401), so Android should also treat playlist deletion as best-effort.

### ListenBrainz Specifics

- **Token source.** The token comes from the scrobbler-side config (`scrobbler-config-listenbrainz.userToken`), NOT a separate meta-service config. Single source of truth — see "ListenBrainz auth token auto-attach" earlier in this file for the same rule on the lb-radio path.

- **Default private.** `createPlaylist` hard-codes `extension['https://musicbrainz.org/doc/jspf#playlist'].public = false`. No user-facing toggle in v1. If the user makes the playlist public on listenbrainz.org directly, subsequent Parachord pushes don't override (we only set `public` on create, not on update-details).

- **MBID-or-skip.** Every track pushed to LB must have a recording MBID. Tracks without one are run through the MBID Mapper (≥0.7 confidence required); unresolved tracks are collected into `syncedTo.listenbrainz.unresolvedTracks` for the UI to surface. Surfacing TBD; for v1 it's just persisted state.

- **MBID-hydration flood guard (parachord#953, mobile #306/#308 parity).** `resolveTrackMbid(track, hydration?)` has no internal rate limit — without a guard an unresolved track is re-queried against the LB mapper on *every* sync cycle (a flood when the mapper is down: ~2,359 lookups in one cycle on mobile → rate-limited). `sync-engine/lb-hydration.js` (pure) + the `getLbHydration()` singleton in main.js bound it: (1) a **per-cycle live-lookup budget** (`createBudget`, default 250, refills after a 2-min idle gap = a new cycle) so a big backlog drains over several syncs; (2) a **persistent negative cache** (electron-store `lb_mbid_hydration_cache`, keyed ISRC > recording-MBID > norm) with a **7d→30d cooldown** (`shouldLookup`/`recordAttempt`) — a resolved id is reused with no lookup, a recent miss is skipped within cooldown and re-tried only after it expires (so mapper recovery + MB community additions still self-heal). The context is threaded as `{ hydration }` into the LB provider's `resolveTracks`/`updatePlaylistTracks` (`lbHydrationOpts(providerId)` — LB only; other providers get `undefined`); absent → direct lookup every time (legacy). Tests: `tests/sync/lb-hydration.test.js`.

- **Cross-service collaboration.** LB's collaborators-extension list enables a Spotify user and an AM user to share an LB playlist where either's edits propagate via LB to both streaming services. Bob (AM user, collaborator on Alice's LB playlist) imports the playlist into his Parachord; his local edits push back to LB (via the refined push-loop guards documented elsewhere) AND to his own AM. Alice's next sync pulls his edits and pushes to her Spotify. The marquee feature.

- **Snapshot proxy.** LB doesn't return a `snapshotId` per playlist. We use the JSPF extension's `last_modified_at` field (falling back to `playlist.date` only when it's missing) as the comparison anchor for `hasUpdates` detection. `playlist.date` alone would be wrong because per JSPF spec it's the creation date, not last-modified — it never advances on edits.

- **Achordion playlist-links push.** After any successful sync write that touches an LB-anchored playlist (create or update), main.js fires `pushPlaylistLinksToAchordion(localPlaylist)` to `POST https://achordion.xyz/api/playlist-links/submit`. Fire-and-forget; same 401-suppression pattern as the track-links submit. The payload is keyed on the LB playlist MBID; Achordion stores it for 90 days and renders the mirror links on `/playlist/<mbid>`.

- **Push-loop guard refinement.** Both the `syncedFrom`-based guard AND the id-prefix guard in the push loops (app.js, two sites each) now skip-unless-genuine-local-edits when the source provider matches the push target. The discriminator is `locallyModified && lastModified > syncSources[sourceProvider].syncedAt` (real edits, not handlePull artifact). This makes collaborative round-trip possible — without it, Bob's edits to Alice's LB-imported playlist would never push back to LB.

- **Shared-playlist badge.** When `playlist.syncedFrom?.isCollaborator === true`, the UI renders a small "SHARED" pill in the playlist row (both grid and table views) AND in the detail header. Surfaces to the user that their edits propagate to other collaborators.

### Multi-Provider Mirror Propagation

A playlist can be mirrored to multiple providers simultaneously (e.g. synced *from* Spotify and *to* both Spotify and Apple Music). When one mirror changes upstream, the update has to propagate through the local copy to the other mirrors. Four places cooperate to make this work — losing any one of them silently breaks propagation for that playlist:

**1. `handlePull` must set `locallyModified: true` when other mirrors exist** (app.js ~L44509). A pull replaces local tracks with the remote's. If the playlist also has `syncedTo` entries for *other* providers, those copies are now out of date relative to what we just pulled. The pull writes `locallyModified: hasOtherMirrors` (not a hardcoded `false`) so the next push loop picks it up. Without this, an Android-edit → Spotify → desktop pull would stop at the desktop and never reach Apple Music.

```js
const hasOtherMirrors = !!(playlist.syncedTo && Object.keys(playlist.syncedTo).some(
  pid => pid !== provider && playlist.syncedTo[pid]?.externalId
));
const applyPull = prev => ({
  ...prev, tracks: result.tracks, hasUpdates: false,
  locallyModified: hasOtherMirrors,
  ...
});
```

**2. Local-content mutators must persist `locallyModified: true` in the same save that writes the new tracks.** `addTracksToPlaylist`, `removeTrackFromPlaylist`, `moveTrackInPlaylist` (app.js L17170+) used to flag the playlist via a separate React state update that never reached the store. Inline the flag into the object that `savePlaylistToStore` receives. Guard with `p.syncedFrom || p.syncedTo` so local-only playlists don't get flagged for nothing.

```js
const shouldFlag = !!(p.syncedFrom || p.syncedTo);
const updatedPlaylist = {
  ...p, tracks: [...], lastModified: Date.now(),
  ...(shouldFlag ? { locallyModified: true } : {})
};
savePlaylistToStore(updatedPlaylist);
```

**3. Push-loop `syncedFrom` guard must be provider-scoped** (app.js L5629, L9483). The background push loop and the post-wizard create loop each skip playlists whose `syncedFrom` is set — the intent is "don't re-push a pulled playlist to its source." A blanket `if (playlist.syncedFrom) continue;` over-fires: a Spotify-imported playlist also has `syncedFrom: { resolver: 'spotify' }`, and the blanket guard blocks pushing it to *any* other provider too. Without this fix, an Android-edit → Spotify → desktop pull gets stuck at the desktop forever because Apple Music is never even considered in the push loop.

```js
// Wrong — blocks pushing a Spotify-imported playlist to Apple Music too:
if (playlist.syncedFrom) continue;

// Right — only skip when the source provider matches the current push target:
if (playlist.syncedFrom?.resolver === providerId) continue;
```

The id-based guard (`if (playlist.id?.startsWith(\`${providerId}-\`)) continue;`) is the defense-in-depth layer for the same concern and is already provider-scoped — match that pattern.

**4. Post-sync clear logic must filter to `relevantMirrors`** (app.js L5728+) — enabled providers that actually have a `syncedTo[pid].externalId` entry, **excluding the `syncedFrom` source provider**. Two bugs in the old logic:

- `enabledProviders.every(pid => syncedTo[pid]?.syncedAt >= lastModified)` silently failed when an enabled provider had no `syncedTo` entry (`undefined >= number` is `false`), leaving `locallyModified: true` forever.
- If the source provider has a `syncedTo` entry (round-trip mirror — e.g. `syncedFrom: spotify` AND `syncedTo: { spotify, applemusic }`), its `syncedAt` never advances via the push loop because Fix 3's guard prevents pushing back to the source. Including it in `allSynced` strands the flag.

```js
const sourceProvider = playlist.syncedFrom?.resolver;
const relevantMirrors = enabledProviders.filter(pid =>
  playlist.syncedTo[pid]?.externalId && pid !== sourceProvider
);
if (relevantMirrors.length === 0) {
  playlist.locallyModified = false;
} else {
  const allSynced = relevantMirrors.every(pid =>
    (playlist.syncedTo[pid]?.syncedAt || 0) >= (playlist.lastModified || 0)
  );
  if (allSynced) playlist.locallyModified = false;
}
```

**The `sync:start` refill flag** (main-process/ipc/sync-start.js). When the backend refills an empty playlist from a pulled provider and the playlist has other `syncedTo` mirrors, main.js writes `locallyModified: true` alongside the fresh tracks. Same rationale as Fix 1 but from the sync-start path that bypasses `handlePull`. Note this only fires for `isEmpty` playlists — non-empty playlists stay untouched on `sync:start` (user must click the pull banner via `handlePull`, which is the only path that replaces non-empty tracks).

End-to-end flow that all four enable: Android edit → Spotify remote → desktop pull (handlePull or sync:start refill) sets `locallyModified: true` → next AM sync's push loop passes the provider-scoped `syncedFrom` guard → issues PUT to AM → on success, `syncedTo.applemusic.syncedAt` advances past `lastModified` → clear logic's `relevantMirrors` (excluding spotify source) sees `allSynced`, resets the flag.

### Sync IPC Surface

| Handler | Purpose |
|---|---|
| `sync:start` | Full sync for a provider: fetch remote library, import into collection and selected playlists. Does NOT create remote playlists. |
| `sync:fetch-playlists` | Fetch a provider's owned+followed playlists list (used by the wizard). |
| `sync:fetch-playlist-tracks` | Pull one playlist's tracks from a provider. |
| `sync:push-playlist` | Push tracks to an *existing* remote playlist (replace). |
| `sync:create-playlist` | Create OR link to a remote playlist. All three dedup layers live here. `(providerId, name, description, tracks, localPlaylistId)`. |
| `sync:resolve-tracks` | Resolve local tracks to provider-specific IDs/URIs. |
| `sync:cleanup-duplicate-playlists` | Relink orphans, then dedup remote owned playlists. |
| `sync:relink-orphaned-playlists` | Standalone relink. Rarely needed — cleanup calls it. |
| `sync-links:get-all` / `:set` / `:remove` | Direct access to the durable link map. |

### Invariants & Traps

- **Don't drop `syncedTo` on save.** The most common regression. The main-process `playlists-save` handler replaces the stored record outright, so any field missing from a save payload is deleted on disk. Build payloads by spreading the whole playlist and overriding only what you compute, never by listing fields to keep: `savePlaylistToStore` does this through `window.buildPlaylistSavePayload` (protocol-url.js, tests in `tests/sync/playlist-save-payload.test.js`). Its old hand-written list omitted `localOnly` and `description`, so editing a "Local only" playlist's tracks re-enabled sync for it. UI-only flags (`isEphemeral`, `isExternal`, `tracksLoaded`) are stripped there; add any new UI-only playlist flag to that list.
- **Always pass `localPlaylistId` to `sync:create-playlist`.**
- **Never create a remote playlist outside `sync:create-playlist`.** That's the only gateway with dedup.
- **Imported playlist ID convention:** `${providerId}-${externalId}`. The creation loop has a guard `if (playlist.id?.startsWith(\`${providerId}-\`)) continue;` — so imported playlists never get re-pushed even if `syncedFrom` was cleared.
- **Push-loop `syncedFrom` guard must be provider-scoped**, not blanket. `if (playlist.syncedFrom) continue;` blocks pushes to *every* provider, including ones that aren't the pull source — this silently breaks multi-provider mirroring. Use `if (playlist.syncedFrom?.resolver === providerId) continue;` instead. Affects both the background sync push loop and the post-wizard create loop.
- **`sync:start` must preserve cross-provider `syncedFrom`.** The existing-playlist branch's `localPlaylist` lookup matches via `syncedFrom.externalId`, `syncedTo[providerId].externalId`, or id-pattern — so a local playlist can be matched because it's a push target for this provider (not because this provider is its pull source). In that case its `syncedFrom` points at a *different* provider and must be preserved. Gate the syncedFrom/tracks rewrite on `isOwnPullSource = !current.syncedFrom?.resolver || current.syncedFrom.resolver === providerId`. Clobbering a cross-provider syncedFrom orphans the local from its real pull source and causes the original provider to create a duplicate on its next sync.
- **Sync wizard pre-check seeds from push + pull state, not just saved selections.** `openSyncSetupModal` seeds `selectedPlaylists` from the union of `existingSettings.selectedPlaylistIds`, local playlists with `syncedFrom.resolver === providerId`, and local playlists with `syncedTo[providerId].externalId`. The last-saved list alone doesn't reflect playlists that were pushed to the provider without going through the wizard (e.g. locally created, then auto-pushed via the background loop). Combined with the cross-provider syncedFrom protection above, pre-checking a push-only mirror doesn't clobber its existing pull source.
- **Main.js `sync:start` clears `syncedFrom` when the remote no longer exists** — but only if the response looks complete (>70% of previously-synced playlists still present). Guards against mass-duplicate creation on partial API responses.
- **Bulk save on Android** must guarantee `sync_playlist_links` writes are durable independently of playlist object writes (separate keys, separate transactions). The whole point of the map is to survive playlist-save bugs.
- **Imported-playlist ID prefix is load-bearing for the heal migration.** Imported playlists use `${providerId}-${externalId}`. The startup migration `healImportedSyncedFromMismatch` (main.js, runs alongside `migrateSyncLinksFromPlaylists`) treats the ID prefix as ground truth: if `id.startsWith('spotify-')` then `syncedFrom.resolver` MUST be `spotify`, period. If it isn't, the heal restores it and demotes the wrong provider's link to `syncedTo`. Don't ever construct a `${provider}-${externalId}`-shaped ID for a playlist that wasn't imported from that provider — the heal will misread it as corruption and rewrite `syncedFrom`. Symmetric for `applemusic-` and any future provider with import support.
- **`syncedFrom` corruption is a known regression class, not a hypothetical.** A fleet of 54 Spotify-imported playlists were observed in production with `syncedFrom.resolver` rewritten to `applemusic` (or `undefined`). Root cause was a now-fixed code path (commit `9e8b1f3` added `isOwnPullSource` gating) but corrupted state survives until healed. The startup heal in main.js is idempotent and runs every launch — if any future regression (or cross-platform sync from a buggy Android client) reintroduces the corruption, the next desktop launch silently undoes it. Don't disable the heal as "no longer needed"; it's defense-in-depth for cross-platform data consistency.
- **Heal contract: null-snapshot silent repopulation.** The heal nulls `syncedFrom.snapshotId` when restoring a corrupted resolver field, on the contract that the next sync from the canonical provider silently adopts the live remote snapshotId. The inbound sync at `sync:start` honors this by treating `!localPlaylist.syncedFrom?.snapshotId` as a silent-adoption signal in `silentlyAdopt = isHealInducedNull || isAmCountChurnMatch || isSpotifyCuratedMatch` — covering three orthogonal cases: post-heal repopulation (all providers), AM track-count churn (positions rotate but counts stable), and Spotify-curated daily updates (Daily Brew / Discover Weekly / Release Radar / Daily Mix N / Daylist, detected via `remotePlaylist.ownerId === 'spotify'`). Without these arms the affected playlists would flag "has updates" on every sync forever, because `stillHasUpdates` stays true → snapshotId never advances → next sync sees the same diff. Tradeoff: lose the signal for content drift between corruption-and-heal / within-AM-churn / on user-edited curated playlist (last case is empty — Spotify rejects writes to non-owned playlists at the API layer, so local edits to Daily Brew can't have propagated anyway). For Spotify-curated specifically, `sync:start` ALSO refetches the tracklist (via the existing isEmpty refill path's pattern, gated on `isSpotifyCuratedMatch && hasTrackUpdates`) — silently adopting the snapshotId without refetching would leave yesterday's content displayed under today's snapshot.

### Track/Album/Artist Sync
- After playback, fire-and-forget pushes to enabled sync providers
- Checks `track.spotifyId` or `track.sources?.spotify?.spotifyId`

### Loved Tracks → ListenBrainz / Last.fm

Optional opt-in cross-service love sync. Adding a track to the Parachord collection (`addTrackToCollection`, app.js L13151) → optionally push as a love to LB and/or LFM. Design doc: [`docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md`](../../docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md).

**Two independent controls per service**, in each scrobbler's connected-state card:
1. Toggle: "Push newly loved tracks to <service>" — gates live `addTrackToCollection` push.
2. Button: "Backfill N loved tracks → <service>" — one-shot manual push of every collection track not yet pushed for that service.

Both default off. Toggle and button are independent — user can enable just one, both, or neither.

**Persistence keys:**
- `scrobbler_love_push_enabled: { lastfm?: boolean, listenbrainz?: boolean }` — toggle state.
- `love_pushed_keys: { [trackId]: { lastfm?: ts, listenbrainz?: ts } }` — idempotency cache. Written immediately after each successful push (not at end-of-batch) so a crashed backfill resumes naturally.

**Invariants:**

- **One-way only.** `removeTrackFromCollection` does NOT send `track.unlove` / `score=0`. Users may have independent love history on LB/LFM that we shouldn't mutate. Adds are pushed; removes never are.
- **Remote love-date is "now."** Neither LB's `/1/feedback/recording-feedback` nor LFM's `track.love` accept a backdate. Backfilled loves appear on the remote as "loved at the time of the backfill click." The local `addedAt` is preserved. The completion toast doesn't apologize for this; the design doc records the rationale.
- **MBID required for ListenBrainz.** `loveTrack` on the LB scrobbler validates `track.mbid` is a 36-char UUID. The push path (`pushLoveToScrobblers` and `runLoveBackfill` in app.js) calls `window.resolveMbidForLove(track)` which tries cached `track.mbid` first, then the [MBID Mapper](https://mapper.listenbrainz.org/mapping/lookup) (~4ms). If the mapper returns `confidence < 0.7` or no result, the LB push is skipped for that track but LFM still gets it (LFM only needs artist+title strings).
- **Live push is fire-and-forget.** `addTrackToCollection` returns immediately; `pushLoveToScrobblers` runs in the background. Failures log to console but don't affect local collection state.
- **Backfill walks `collectionData.tracks` sequentially** with a 1 req/sec soft rate-limit per service, filtering through `lovePushedKeysRef.current` so re-clicks are cheap. While running, the button is disabled and shows progress (`Pushing… 12/247`). Toast on completion summarizes pushed/skipped/failed counts.
- **Libre.fm out of scope.** Toggle and button are hidden — LFM's `track.love` has no Libre.fm equivalent. Don't add it speculatively; the Libre.fm API surface differs.
- **Scrobbler plugin contract.** Both `lastfmScrobbler.loveTrack(track)` and `listenbrainzScrobbler.loveTrack(track)` exist alongside `scrobble`/`updateNowPlaying`. They throw on hard errors (auth invalid, rate-limited 5xx). Callers must catch.

**Android parity** for this feature follows the same shape: opt-in toggle + manual backfill button per service, same persistence key names (`scrobbler_love_push_enabled`, `love_pushed_keys`), same MBID-required-for-LB rule with mapper fallback, same one-way semantics. Match the desktop's `loveTrack` method shape on the scrobbler classes so the field-tested API stays consistent.
