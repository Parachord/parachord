# Parachord - Claude Code Guide

## Architecture

Single-file React app (`app.js`, ~58k lines). No JSX — uses `React.createElement()` exclusively. Styling via Tailwind CSS classes + inline styles with CSS variables (`var(--accent-primary)`, `var(--card-bg)`, etc.).

Main component: `const Parachord = () => { ... }` (L4951), rendered via `ReactDOM.createRoot`.

## Playback

### Resolver System
- Resolvers provide playback, search, and metadata (Spotify, Apple Music, SoundCloud, YouTube, Bandcamp, local files)
- `CANONICAL_RESOLVER_ORDER` (L1266): `['spotify', 'applemusic', 'bandcamp', 'soundcloud', 'localfiles', 'youtube']`
- Each track has a `sources` object keyed by resolver ID — playback picks the highest-priority available source above the confidence floor
- Resolvers loaded into `loadedResolversRef` (L7756) with `.play()`, `.search()`, `.capabilities`

### Match Confidence + Selection Floor

Source selection is a **two-stage gate**: validate, then sort. Without the floor, a higher-priority resolver's wrong-artist match silently outranks a correct lower-priority result, because confidence is otherwise only a within-priority tiebreaker.

**Stage 1 — Validation.** `validateResolvedTrack(result, targetArtist, targetTitle)` (module-scope helper, app.js L151) returns true only when BOTH the artist and title containment-match the target after `normalizeStr` (lowercase + strip non-alphanumeric). Single-axis matches — same title, different artist; or same artist, different title — fail.

**Stage 2 — Scoring.** `calculateConfidence(track, result)` (app.js L24880, inside `Parachord`) returns:
- `0.95` — both axes pass `validateResolvedTrack`
- `0.50` — single-axis match, or no match
- `1.0` (or whatever the resolver supplied ≥ 0.95) — direct-ID match (cached `spotifyId`/`appleMusicId`/etc), preserved as-is

**Stage 3 — Selection floor.** `MIN_CONFIDENCE_THRESHOLD = 0.6` (app.js L166). The source-selection sort (app.js L15184) drops sources below this floor BEFORE the priority sort runs. A 0.50 source never reaches selection.

**Stage 4 — Priority + confidence sort.** Sources passing the floor sort by user-configured resolver priority; confidence is the within-priority tiebreaker.

**All resolution paths gate on `MIN_CONFIDENCE_THRESHOLD`** and skip the attach entirely (with a warn log) when a result fails — three background paths (app.js L8027 normal, L8056 rate-limited iTunes, L8170 per-track flush) plus five `calculateConfidence`-using sites (search-page `resolveRecording` ~L19828, validation pipeline ~L23106, missing-resolver flush ~L23368, bandcamp-shortcut path ~L23464, scheduler flush ~L23634). All eight follow the same pattern: `const confidence = calculateConfidence(track, result); if (confidence < MIN_CONFIDENCE_THRESHOLD) skip-and-warn; else attach`. This prevents wrong-artist results from ever entering `track.sources` (and so from rendering pale resolver badges) and from polluting `track.album` / `track.albumArt` fallback fields.

**Badge dim logic is absolute (≥ 0.95 = full opacity), not relative-to-best.** `getBestSourceConfidence(sources)` (app.js ~L264) returns the constant `0.95` regardless of input. Each badge renders dimmed (opacity 0.6) when its confidence is strictly less than 0.95, full otherwise — `(source.confidence || 0) < bestConf ? 0.6 : 1`. Since the upstream `MIN_CONFIDENCE_THRESHOLD = 0.6` floor drops sub-floor results before they reach `track.sources`, in normal operation the only values present are 0.95 (fuzzy validated) and 1.0 (direct-ID), so nothing dims unless a resolver explicitly returns a non-standard sub-0.95 value. The function signature is preserved (takes `sources`, returns a number) so the 11 badge call sites compile unchanged; the argument is ignored. **Historical note:** the prior relative-to-best model dimmed a 0.95 fuzzy match whenever a sibling resolver had 1.0, which users read as "wrong" when the match was actually correct — flipped to absolute on 2026-05-08. Applied at all 11 badge call sites (TrackRow + 10 list-view variants).

**Cross-platform invariant.** `tests/helpers/confidence-scoring.js` is the test-side mirror of the app.js inline copies and the source-of-truth SYNC marker. The Kotlin equivalents live at `parachord-android/shared/.../resolver/ResolverModels.kt#scoreConfidence` and `ResolverScoring.kt#MIN_CONFIDENCE_THRESHOLD`. All four (desktop helper, desktop inline, Android, tests) must agree byte-for-byte on the gate semantics — drift on any platform produces inconsistent source selection between desktop and Android for the same track. Test cases at `tests/resolver/confidence-scoring.test.js` mirror Android's `ConfidenceScoringTest`.

### handlePlay (L13213)
- Central async playback function; manages `playbackGenerationRef` to supersede stale requests
- Stops all competing audio (Spotify, Apple Music, browser, local, SoundCloud, YouTube, Bandcamp) before starting new track
- Retry logic for Spotify: if `.play()` fails, retries after 2s with fresh token, then falls back to next resolver

**Failure-path auto-skip in auto-advance contexts.** Near the top of `handlePlay` is `autoSkipIfAdvancing(reason)` which all 8 failure paths (No Source Found, No Enabled Source, Local Playback Error ×2, SoundCloud Not Connected, SoundCloud Playback Error ×2, Track Re-resolved) call before showing a dialog. The helper returns true when `isAdvancingTrackRef.current || spinoffModeRef.current` — i.e. handleNext is in flight, or we're inside a spinoff/radio session. In that case it logs `⏭️ Auto-skip "X" — <reason>`, marks the track's queue entry status: 'error' (no-op for spinoff-pool tracks since they aren't in the queue), schedules another `handleNext` via `setTimeout(... 600)` (after the 500ms re-entrancy lock releases), and returns true so the caller skips the dialog. User-initiated single-track plays from outside spinoff/auto-advance still surface the dialog as before. This makes radio/spinoff sessions resilient: a single unplayable track gets silently passed over instead of stopping playback with a modal.

### Cross-Resolver Enrichment (Eager Gate + Slow Trickle)

When a track has a persisted source from one resolver but is missing slots for other enabled resolvers, `resolveTrack` (app.js ~L23809) has two complementary code paths for filling those missing slots. The split exists because of a real performance regression — a user with 376 local FLACs and Bandcamp enabled saw ~1 minute of pinwheel + constant CPU on every library navigation, because library-page navigation tagged 374 tracks at page-priority and the scheduler walked them all firing Bandcamp searches that returned 0 every time.

**Eager gate (foreground, in-handler):** If the persisted sources include a `localfiles` source with no `noMatch` flag and confidence ≥ 1.0, the missing-resolver fill is skipped entirely. Localfiles confidence-1.0 means "this file exists on disk and plays" — cross-resolver enrichment for it is speculative (the user's obscure Japanese reggae rip is unlikely to also be on Bandcamp) and the burst pattern destroys UX. **Scoped specifically to `localfiles`**, not all confidence-1.0 sources: a confidence-1.0 Spotify match (cached spotifyId from sync) DOES carry cross-platform intent — those still fire the eager fill, because finding the matching Apple Music ID is useful.

**Slow trickle (background, separate useEffect):** A setInterval-driven loop walks `collectionTracksRef.current` looking for tracks with at least one real source but missing some enabled non-localfiles resolver. Fires `resolveTrack(..., { forceEnrichment: true })` on at most one candidate every 10 seconds, ONLY while the window is unfocused (mirroring the "do work while user is away" principle from background sync). The `forceEnrichment` option flips the gate inside resolveTrack so the same fill code path runs, just stretched over hours instead of seconds. Per-session `enrichmentAttemptedRef: Set<trackId>` prevents re-trying within a launch; cross-launch dedup is handled by the existing `noMatch` sentinel persistence in `cache_track_sources`.

This split preserves the Achordion contribution path: local-only listeners playing tracks that DO exist on streaming services eventually get those mappings resolved (during background time) and submitted to Achordion's match cache. See [parachord#791](https://github.com/Parachord/parachord/issues/791) for the polish backlog (negative cache per-(resolver, artist), telemetry, integration with ResolutionScheduler vs the parallel setInterval).

**Critical placement note:** the slow-trickle useEffect references `cacheLoaded` in its dep array, so it MUST live AFTER the `useState` line that declares `cacheLoaded` (~L9066). It's intentionally separated from its logical sibling (the background-sync useEffect around L6177) for this reason. See the placement comment in app.js and the React useEffect TDZ note in [Common Patterns](#common-patterns).

### Spotify Playback Modes
- **Browser (Web Playback SDK)**: In-app streaming, `streamingPlaybackActiveRef.current = true`
- **Spotify Connect** (`playOnSpotifyConnect`, L32465): Controls external Spotify clients via REST API (`/v1/me/player` endpoints)

### Volume Management
- `volumeRef` (L6673): Current playback volume (0–100%). Always use the ref in async/event code to avoid stale closures
- `preMuteVolumeRef` (L4984): Stores pre-mute volume for unmute restore
- `resolverVolumeOffsets` (L5002): Per-resolver dB adjustments (Spotify 0dB, Bandcamp -3dB, YouTube -6dB)
- `trackVolumeAdjustments` (L5013): Per-track dB offset map
- `getEffectiveVolume()` (L7867): Combines base volume + resolver offset + track offset
- Spotify volume API calls are debounced via `spotifyVolumeTimeoutRef`

## Spotify Device Handling

### Device Discovery
- `getSpotifyDevices()` (L32444): Fetches from `GET /v1/me/player/devices`
- Filters out `is_restricted` devices (can't be remotely controlled)

### Device Selection Priority (in playOnSpotifyConnect)
1. Active device (already playing)
2. User's preferred device (`preferredSpotifyDeviceId`) if still available
3. If multiple inactive devices: show device picker dialog for user to choose
4. Single inactive device: auto-select (Computer > Smartphone > Speaker > other)

### Device Picker Dialog
- State: `devicePickerDialog` `{ show, devices[], onSelect(device|null) }`
- Promise-based: `playOnSpotifyConnect` awaits user selection via `new Promise(resolve => setDevicePickerDialog({ onSelect: resolve }))`
- Shows device type icons, names, and volume levels
- Cancel returns `null`, aborting playback

### Preferred Device Persistence
- `preferredSpotifyDeviceId` state + `preferredSpotifyDeviceIdRef` for async access
- Persisted via `electron.store` key `preferred_spotify_device_id`
- Loaded during bulk cache restore, saved on change and on cleanup
- Clearable from Spotify resolver settings section

### Device Wake-up
- If selected device is inactive: `PUT /v1/me/player` with `{ device_ids, play: false }` to transfer playback
- 1000ms wait for device readiness, then sends track URI via `PUT /v1/me/player/play?device_id=`
- Volume adoption: if device's `volume_percent` < internal volume, adopts device volume to prevent loud surprise

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
- **Only the main process writes it** (see `setSyncLink`, `removeSyncLink`, `migrateSyncLinksFromPlaylists` in main.js). Renderer playlist saves cannot clobber it.
- Written on successful create or link inside `sync:create-playlist`.
- Pruned when `cleanupDuplicatePlaylists` deletes a remote.
- Populated on every startup from existing `syncedTo` data (idempotent migration) — ensures users upgrading never lose existing links.
- The renderer can read it via `window.electron.syncLinks.getAll()` but usually doesn't need to.

### Three-Layer Duplicate Prevention

All remote-playlist writes flow through the `sync:create-playlist` IPC handler (main.js L5689+). Before calling `provider.createPlaylist`, the handler checks for an existing remote in this order:

1. **ID link via `sync_playlist_links[localPlaylistId][providerId]`.** If present, fetch the user's owned remote playlists and verify the stored `externalId` still exists. Match → reuse (pushes tracks, returns the existing ID). Gone → remove the stale link, fall through.
2. **ID link via `syncedTo[providerId].externalId` on the playlist.** Same validation logic. (In practice the renderer already short-circuits this case before calling the IPC, but the handler re-checks for robustness.)
3. **Name match fallback** (trim + lowercase, user-owned only). Picks the richest match if multiple exist. Last-ditch cover for legacy data where no ID link survived.

Only if all three fail does `provider.createPlaylist` actually create a new remote. On success, both `sync_playlist_links` and the caller's `syncedTo` must be populated.

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

The handlers use `window.electron.app.onBackground` / `onForeground` (preload bridges `app-background` / `app-foreground` IPC). No unsubscribe paths are exposed by the preload (multi-listener safe); they detach when the renderer tears down. Mid-sync foreground events are NOT cancelled — too risky to interrupt a running save — only pending `setTimeout`s. A user who returns mid-sync may still see residual IPC activity for a few seconds; accepted vs the complexity of safe cancellation.

### In-Session Mutex

The renderer has **two independent code paths** that call `sync.createPlaylist` and `sync.pushPlaylist`:

- Background sync timer (every 15 min, plus initial-run + focus-triggered, all sharing `runBackgroundSync` at app.js ~L6177)
- Manual sync post-IIFE after the wizard completes (app.js L9500+)

Both loops have the same structure: iterate `local_playlists`, for each one either create a remote (if no `syncedTo[providerId]`) or push updates (if `locallyModified`), then clear `locallyModified` when all mirrors are up to date. Keep them in sync — if you add a guard or branch to one, add it to the other. Without coordination they race: both read a playlist without `syncedTo`, both call `sync.createPlaylist`, both create remotes.

**Mitigation:** `playlistSyncInProgressRef` (app.js L5700), a simple renderer-side boolean ref. Each path acquires it before the creation loop and releases in `finally`. If already held, the path skips with a log message. This is belt-and-suspenders with the IPC-level dedup above.

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

`sync:cleanup-duplicate-playlists` (main.js L6025+) runs two phases:

**Phase 1 — Relink orphans** (via shared helper `relinkOrphansFor`). A local playlist is "orphaned" for a provider if it has tracks, isn't `localOnly`, and has no `syncedTo[providerId]`, `syncedFrom` for that provider, nor `sync_playlist_links` entry. For each orphan with an unambiguous 1:1 name match against a user-owned remote, write both `syncedTo[providerId]` and the link map entry. Ambiguous cases (multiple locals same name, OR multiple remotes same name) are surfaced in the response as `ambiguous` — never automatically resolved.

**Phase 2 — Link-aware deduplication.** Group remote owned playlists by `trim().toLowerCase(name)`. For each group with >1 member:
- **If exactly one remote is linked** to any local (via `syncedTo`, `syncedFrom`, or the link map) → that remote is the keeper. Track counts don't matter.
- **If multiple remotes in the group each have distinct local references** → group is ambiguous, skip entirely. Do not delete anything.
- **If no linked remotes** → fallback: most tracks, tiebreak on most recent `snapshotId`.

Keeper selection guarantees no local ever gets silently re-pointed to a copy it wasn't synced with. Phase 1 must run before Phase 2 so the keeper check sees freshly-written links.

### Hosted XSPF Semantics

A playlist with `sourceUrl` is a **hosted XSPF** — it mirrors a remote URL polled every 5 minutes (`pollHostedPlaylists` effect, app.js L32167+). The XSPF is canonical; Spotify (if linked) is a passive mirror.

Flow:
1. Poller fetches `sourceUrl`. If `content !== playlist.xspf`, call `handleImportPlaylistFromUrl` → replaces `tracks`, sets `locallyModified: true`.
2. Next sync push loop pushes local tracks to Spotify via `updatePlaylistTracks` (full replace).
3. Spotify's own state (if changed since last sync) is overwritten.

**Sync banner behavior for hosted playlists** (app.js L39315+): the "pull" option is suppressed. A pull would briefly replace local tracks with Spotify's, but the 5-min poller would revert it and the next sync push would overwrite Spotify again — effectively a no-op with confusing UX. For hosted playlists:
- `hasUpdates=true, locallyModified=false` → banner hidden (pull is useless).
- `locallyModified=true` → banner shows as push (XSPF is ready to go upstream).
- Conflict (both flags) → rendered as push (XSPF wins anyway).

**Sync banner's push-state check must discount pull-induced `locallyModified`** (app.js L39876+). The banner is scoped to `syncedFrom.resolver` (the source provider). `locallyModified: true` has two triggers: (a) the user actually edited local content, and (b) `handlePull` on a multi-mirror playlist sets it so the next push loop propagates the pull to *other* mirrors (the multi-provider mirror-propagation fix). Treating case (b) as "push to source" shows a spurious "Push to Spotify" banner immediately after the user clicks "Pull from Spotify" — the push-to-source would be a no-op (the push loop's provider-scoped `syncedFrom` guard correctly skips it), but the banner doesn't know that. Gate `hasLocalChanges` on real divergence from the source: `playlist.locallyModified && lastModified > syncSources[sourceProvider].syncedAt`. `handlePull` sets both to the same `Date.now()` so the comparison is false right after a pull; a subsequent real edit bumps `lastModified` and flips it to true.

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

- **Cross-service collaboration.** LB's collaborators-extension list enables a Spotify user and an AM user to share an LB playlist where either's edits propagate via LB to both streaming services. Bob (AM user, collaborator on Alice's LB playlist) imports the playlist into his Parachord; his local edits push back to LB (via the refined push-loop guards documented elsewhere) AND to his own AM. Alice's next sync pulls his edits and pushes to her Spotify. The marquee feature.

- **Snapshot proxy.** LB doesn't return a `snapshotId` per playlist. We use the JSPF extension's `last_modified_at` field (falling back to `playlist.date` only when it's missing) as the comparison anchor for `hasUpdates` detection. `playlist.date` alone would be wrong because per JSPF spec it's the creation date, not last-modified — it never advances on edits.

- **Achordion playlist-links push.** After any successful sync write that touches an LB-anchored playlist (create or update), main.js fires `pushPlaylistLinksToAchordion(localPlaylist)` to `POST https://achordion.xyz/api/playlist-links/submit`. Fire-and-forget; same 401-suppression pattern as the track-links submit. The payload is keyed on the LB playlist MBID; Achordion stores it for 90 days and renders the mirror links on `/playlist/<mbid>`.

- **Push-loop guard refinement.** Both the `syncedFrom`-based guard AND the id-prefix guard in the push loops (app.js, two sites each) now skip-unless-genuine-local-edits when the source provider matches the push target. The discriminator is `locallyModified && lastModified > syncSources[sourceProvider].syncedAt` (real edits, not handlePull artifact). This makes collaborative round-trip possible — without it, Bob's edits to Alice's LB-imported playlist would never push back to LB.

- **Shared-playlist badge.** When `playlist.syncedFrom?.isCollaborator === true`, the UI renders a small "SHARED" pill in the playlist row (both grid and table views) AND in the detail header. Surfaces to the user that their edits propagate to other collaborators.

### Multi-Provider Mirror Propagation

A playlist can be mirrored to multiple providers simultaneously (e.g. synced *from* Spotify and *to* both Spotify and Apple Music). When one mirror changes upstream, the update has to propagate through the local copy to the other mirrors. Four places cooperate to make this work — losing any one of them silently breaks propagation for that playlist:

**1. `handlePull` must set `locallyModified: true` when other mirrors exist** (app.js L39818+). A pull replaces local tracks with the remote's. If the playlist also has `syncedTo` entries for *other* providers, those copies are now out of date relative to what we just pulled. The pull writes `locallyModified: hasOtherMirrors` (not a hardcoded `false`) so the next push loop picks it up. Without this, an Android-edit → Spotify → desktop pull would stop at the desktop and never reach Apple Music.

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

**2. Local-content mutators must persist `locallyModified: true` in the same save that writes the new tracks.** `addTracksToPlaylist`, `removeTrackFromPlaylist`, `moveTrackInPlaylist` (app.js L17358+) used to flag the playlist via a separate React state update that never reached the store. Inline the flag into the object that `savePlaylistToStore` receives. Guard with `p.syncedFrom || p.syncedTo` so local-only playlists don't get flagged for nothing.

```js
const shouldFlag = !!(p.syncedFrom || p.syncedTo);
const updatedPlaylist = {
  ...p, tracks: [...], lastModified: Date.now(),
  ...(shouldFlag ? { locallyModified: true } : {})
};
savePlaylistToStore(updatedPlaylist);
```

**3. Push-loop `syncedFrom` guard must be provider-scoped** (app.js L5817, L9483). The background push loop and the post-wizard create loop each skip playlists whose `syncedFrom` is set — the intent is "don't re-push a pulled playlist to its source." A blanket `if (playlist.syncedFrom) continue;` over-fires: a Spotify-imported playlist also has `syncedFrom: { resolver: 'spotify' }`, and the blanket guard blocks pushing it to *any* other provider too. Without this fix, an Android-edit → Spotify → desktop pull gets stuck at the desktop forever because Apple Music is never even considered in the push loop.

```js
// Wrong — blocks pushing a Spotify-imported playlist to Apple Music too:
if (playlist.syncedFrom) continue;

// Right — only skip when the source provider matches the current push target:
if (playlist.syncedFrom?.resolver === providerId) continue;
```

The id-based guard (`if (playlist.id?.startsWith(\`${providerId}-\`)) continue;`) is the defense-in-depth layer for the same concern and is already provider-scoped — match that pattern.

**4. Post-sync clear logic must filter to `relevantMirrors`** (app.js L5916+) — enabled providers that actually have a `syncedTo[pid].externalId` entry, **excluding the `syncedFrom` source provider**. Two bugs in the old logic:

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

**Main.js `sync:start` also flags on refill** (main.js L5680+). When the backend refills an empty playlist from a pulled provider and the playlist has other `syncedTo` mirrors, main.js writes `locallyModified: true` alongside the fresh tracks. Same rationale as Fix 1 but from the sync-start path that bypasses `handlePull`. Note this only fires for `isEmpty` playlists — non-empty playlists stay untouched on `sync:start` (user must click the pull banner via `handlePull`, which is the only path that replaces non-empty tracks).

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

- **Don't drop `syncedTo` on save.** The most common regression. Any place that builds a save payload must copy `syncedTo`, `syncedFrom`, `syncSources`, `hasUpdates`, `locallyModified`, `sourceUrl`, `source` from the input. See `savePlaylistToStore` (app.js L24946) as the reference shape.
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
- **Heal contract: null-snapshot silent repopulation.** The heal nulls `syncedFrom.snapshotId` when restoring a corrupted resolver field, on the contract that the next sync from the canonical provider silently adopts the live remote snapshotId. The inbound sync at `sync:start` honors this by treating `!localPlaylist.syncedFrom?.snapshotId` as a silent-adoption signal (`silentlyAdopt = isHealInducedNull || isAmCountChurnMatch`) for *all* providers — not just AM. Without this arm, post-heal playlists would flag "has updates" on every sync forever, because `stillHasUpdates` stays true → snapshotId never advances → the next sync sees the same diff. Tradeoff: lose the signal for any content drift that occurred between the corruption and the heal. Accepted because (a) heal runs on every launch so the drift window is bounded, (b) the alternative is perpetual log spam and permanently-set hasUpdates flags across a fleet of playlists the user isn't reviewing. Distinct from the AM track-count churn suppression which is Spotify-disallowed (Daily Brew via SmartPlaylists, Discover Weekly, Release Radar have fixed-count rotating content).

### Android Parity Requirements

This section is for the Android client — Parachord's sync logic must stay byte-compatible with the desktop so playlists round-trip correctly. Every rule here was learned from a real bug that broke propagation until it was fixed. Skipping any one silently breaks multi-provider sync for users on both platforms.

**Apple Music provider must degrade gracefully on library-endpoint rejections.** Apple's public API (`api.music.apple.com`) rejects all of the following on user library resources with 401/403/405 — this is documented policy (Apple Developer Forum 107807), not a bug or a token issue:

| Endpoint | Apple's response | Required Android behavior |
|---|---|---|
| `DELETE /me/library/playlists/{id}` | 401 | Do NOT throw. Return `{success: false, reason: 'endpoint-unsupported', status}`. Surface to user as "remove manually in the Music app." |
| `DELETE /me/library/playlists/{id}/tracks/{libraryTrackId}` | Varies / unreliable | Do NOT implement. No third-party client actually uses this endpoint; Cider achieves removal by PUT on the parent resource. |
| `PATCH /me/library/playlists/{id}` (rename/description) | 401 | Do NOT throw. Flip a session kill-switch, log once, return success-with-skipped. **Load-bearing** — the rename step runs before the track push in `sync:push-playlist`; a throw here aborts the track push too. |
| `PUT /me/library/playlists/{id}/tracks` (replace) | 401 on many tokens | Do NOT throw. Flip a separate session kill-switch, log once, fall back to `POST` append for the additions only. Removals will persist on the remote — accept this, document it. |
| `POST /me/library/playlists/{id}/tracks` (append) | 204 | Works. This is the only reliable write path. |

Specifically on Android: if you find yourself writing `if (!response.isSuccessful()) throw new IOException(...)` around any of the PATCH/PUT/DELETE calls above, stop. That's the bug that killed desktop pushes for months. The function's contract must be "best-effort; never throw on documented-unsupported 401/403/405." Use two separate booleans (`amPutUnsupportedForSession`, `amPatchUnsupportedForSession`), not one shared flag — they're independent endpoints with independent kill-switches.

**Do NOT retry-on-401 for any of the documented-unsupported endpoints.** A "defensive" refresh-and-retry on 401 looks harmless but introduces a worse failure mode: when the MusicKit bridge returns no fresh token during the retry attempt, the desktop's `buildAppleMusicRefreshCb` emits `applemusic:reauth-required` and force-walks the user through the System Settings revoke flow for an authorization that was never actually broken. Since the 401 is structural (Apple won't unblock the endpoint by handing you a fresh token), the retry can never succeed — it can only escalate a benign endpoint rejection into a phantom auth crisis. Go straight to the endpoint-unsupported return on the first 401. Same rule for Android: don't refresh-and-retry on 401 against these endpoints.

**Push order in the "update existing remote playlist" path:**

```
1. PATCH (rename/description)   — wrap in try/catch; never abort on throw
2. PUT or POST (tracks)         — this is the actual payload; must always run
3. Fetch new snapshotId         — return to caller
```

The wrapping try/catch is defense-in-depth. Even if the PATCH function itself never throws under normal rejection, a network error or unexpected 5xx should also not kill the track push.

**Push loop invariants (both background timer and post-wizard "Sync Now"):**

```kotlin
for (playlist in localPlaylists) {
    if (playlist.localOnly) continue
    // Provider-scoped guard — NOT `if (playlist.syncedFrom != null) continue`.
    // A Spotify-imported playlist has syncedFrom.resolver == "spotify"
    // and must still be pushable to Apple Music.
    if (playlist.syncedFrom?.resolver == providerId) continue
    if (playlist.id?.startsWith("$providerId-") == true) continue
    if (playlist.syncedTo?.get(providerId)?.pendingAction != null) continue

    val syncInfo = playlist.syncedTo?.get(providerId)
    if (syncInfo == null) {
        // Create new remote; link on success.
        createRemote(playlist)
    } else if (playlist.locallyModified) {
        // Push updates; on 404 mark pendingAction = "remote-deleted".
        pushToRemote(playlist, syncInfo.externalId)
    }
}

// After the loop, clear locallyModified when every outbound mirror is
// up to date. Exclude the source provider — we don't push to it.
for (playlist in localPlaylists) {
    if (!playlist.locallyModified || playlist.syncedTo == null) continue
    val sourceProvider = playlist.syncedFrom?.resolver
    val relevantMirrors = enabledProviders.filter { pid ->
        playlist.syncedTo[pid]?.externalId != null && pid != sourceProvider
    }
    if (relevantMirrors.isEmpty()) {
        playlist.locallyModified = false
    } else if (relevantMirrors.all { pid ->
        (playlist.syncedTo[pid]?.syncedAt ?: 0) >= (playlist.lastModified ?: 0)
    }) {
        playlist.locallyModified = false
    }
}
```

Both the background timer and any "sync now" action must run the full create-OR-push-update flow, not just create-if-missing. If you split them into two code paths, make sure both do the same work — don't let only the background timer push updates, or users won't see uploads until the next cadence tick.

**`sync:start` equivalent — import path must preserve cross-provider `syncedFrom`.** When matching an imported remote to an existing local (via `syncedFrom.externalId` OR `syncedTo[providerId].externalId` OR id-pattern), the match can fire because the local is a *push target* for this provider with its pull source elsewhere:

```kotlin
// local.syncedFrom?.resolver == "spotify"
// remote is from Apple Music, matched via local.syncedTo["applemusic"].externalId
val isOwnPullSource = local.syncedFrom?.resolver == null
    || local.syncedFrom.resolver == providerId

if (isOwnPullSource) {
    // Update syncedFrom, refill tracks if empty, etc. (standard path)
} else {
    // CROSS-PROVIDER PUSH MIRROR. Preserve local.syncedFrom as-is.
    // Do NOT refetch tracks — the other provider is authoritative.
    // Do NOT compute hasUpdates from snapshotId diff (snapshotIds from
    // different providers aren't comparable).
    // DO update syncSources[providerId].syncedAt.
}
```

Clobbering the cross-provider `syncedFrom` orphans the local from its real pull source; the original provider will then see it as a new playlist on its next sync and create a duplicate remote.

**Multi-provider mirror propagation — four cooperating pieces:**

1. **Pull paths must set `locallyModified = true` when other mirrors exist.** Both the explicit "pull" action and the implicit refill-on-empty path. The predicate is `hasOtherMirrors = playlist.syncedTo.any { (pid, v) -> pid != currentProvider && v.externalId != null }`. Without this, an Android edit pulled through Spotify onto the desktop never reaches Apple Music — and vice versa for edits made on desktop that should reach Apple Music via Android's Spotify pull.

2. **Every local-content mutator must persist `locallyModified = true` in the same save that writes the tracks.** If Android has `addTracksToPlaylist` / `removeTrackFromPlaylist` / `moveTrackInPlaylist` equivalents, inline the flag write — don't issue a separate state update that might not reach storage. Guard with `playlist.syncedFrom != null || playlist.syncedTo != null` so local-only playlists aren't flagged pointlessly.

3. **Push-loop `syncedFrom` guard must be provider-scoped** (see above — `syncedFrom?.resolver == providerId`, not blanket).

4. **Post-push clear logic filters to `relevantMirrors` excluding the source provider** (see the Kotlin snippet above).

**Sync wizard / playlist-picker pre-check state**, if Android has one: seed the "checked" set from the union of saved `selectedPlaylistIds`, externalIds where any local has `syncedFrom.resolver == providerId`, and externalIds where any local has `syncedTo[providerId].externalId`. Don't seed only from the last-saved list — push-only mirrors that were never selected in the wizard will appear unchecked even though they're actively syncing.

**Playlist data-model fields to preserve on every save:**

```
id, title, description, tracks,
syncedFrom, syncedTo, syncSources,
hasUpdates, locallyModified, lastModified,
localOnly, sourceUrl, source, creator,
createdAt, addedAt
```

Missing any one of these on any save path causes a specific class of bug — e.g., dropping `syncedTo` causes duplicate remote creation; dropping `locallyModified` causes the propagation chain to silently break.

**Durable link map (`sync_playlist_links`):** Android MUST write this map in a separate transaction/key from the playlist object itself. Its entire purpose is to survive playlist-save bugs. A combined write defeats it.

**Implement the imported-playlist `syncedFrom` heal.** Desktop runs `healImportedSyncedFromMismatch` on every launch (main.js, alongside `migrateSyncLinksFromPlaylists`). Android should run the equivalent — idempotent, runs at app startup, no network. The contract:

```kotlin
for (playlist in localPlaylists) {
    val id = playlist.id ?: continue
    val impliedProvider = when {
        id.startsWith("spotify-") -> "spotify"
        id.startsWith("applemusic-") -> "applemusic"
        else -> null
    } ?: continue

    if (playlist.syncedFrom?.resolver == impliedProvider) continue

    val externalId = id.substringAfter("$impliedProvider-")
    val oldSyncedFrom = playlist.syncedFrom
    val newSyncedTo = (playlist.syncedTo ?: emptyMap()).toMutableMap()

    // Demote the wrong syncedFrom into syncedTo if not already present.
    if (oldSyncedFrom?.resolver != null
        && oldSyncedFrom.resolver != impliedProvider
        && oldSyncedFrom.externalId != null
        && newSyncedTo[oldSyncedFrom.resolver]?.externalId == null
    ) {
        newSyncedTo[oldSyncedFrom.resolver] = SyncedToEntry(
            externalId = oldSyncedFrom.externalId,
            snapshotId = oldSyncedFrom.snapshotId,
            syncedAt = playlist.syncSources?.get(oldSyncedFrom.resolver)?.syncedAt
                ?: System.currentTimeMillis(),
            unresolvedTracks = emptyList(),
            pendingAction = null
        )
    }

    // Restore the correct syncedFrom and clear sync flags.
    playlist.syncedFrom = SyncedFrom(
        resolver = impliedProvider,
        externalId = externalId,
        snapshotId = null,           // next sync from impliedProvider repopulates
        ownerId = if (oldSyncedFrom?.resolver == impliedProvider) oldSyncedFrom.ownerId else null
    )
    playlist.syncedTo = newSyncedTo.takeIf { it.isNotEmpty() }
    playlist.hasUpdates = false
    playlist.locallyModified = false
}
```

Why both platforms need it: when one client has the bug and the other doesn't, the buggy one's writes propagate corruption to the healthy one via the shared remotes. With the heal on both sides, whichever client launches next undoes the damage. No-op on healthy data.

**Apple Music catalog API IS rate-limited — throttle parallel calls.** `api.music.apple.com/v1/catalog/{storefront}/...` (search, songs/{id}, albums/{id}) has an aggressive edge throttle. The throttle is per-token/IP and leaks across endpoints: once a flood of `/search` calls trips it, subsequent `play()` calls (which read `/songs/{id}` internally) also fail with `MusicDataRequest.Error 1`. Symptoms: 429s on search, mysterious "data request failed" on play, JS-fallback path skipped because of a sticky kill-switch.

Desktop fix: `nativeMusicKitLimiter` in app.js (concurrency 3, ≥150ms gap, 8s cooldown after 3 consecutive throttle errors). All catalog calls go through it.

Android equivalent: any place that fans out per-track catalog calls (background source enrichment, library import resolution, etc.) MUST throttle. The trigger threshold isn't documented by Apple, but real-world data: 200+ parallel calls trips it instantly; 50 sustained does too over a few seconds. Sane defaults: concurrency 3-5, ≥100-200ms gap between starts, exponential backoff with circuit breaker on `429`/`MusicKit.MusicDataRequest.Error 1`/`MusicDataRequest`/timeout strings.

The corollary: **don't make the JS-fallback or auth-failed kill-switch session-permanent.** Time-bound it (5-minute cooldown is what desktop uses now via `_appleMusicWebAuthFailedAt`). One transient catalog throttle should not permanently disable Apple Music for the rest of the session.

**ListenBrainz Android parity**

- Same JSPF + recording-MBID semantics. Recording MBID is mandatory for every pushed track; mapper fallback with 0.7 confidence floor.
- Same default-private (`public: false` on create only, never override on update).
- Token from scrobbler-side store, NOT a meta-service store.
- Same clear-then-add update path (no full-replace PUT exists).
- Snapshot anchor is `extension.last_modified_at || playlist.date` (NOT the other way around — `playlist.date` is creation-only).
- Cross-service collaboration: collaborators-extension list enables write-back; Android should also refine its push-loop guards (syncedFrom + id-prefix) to allow push-back-to-source when the user has genuine local edits (`locallyModified && lastModified > syncSources[source].syncedAt`).
- Achordion playlist-links push from Android: same endpoint, same bearer, same payload shape. Submits the LB MBID as the cross-platform anchor.
- Shared-playlist badge: when fetched playlist has `isCollaborator: true`, surface a "SHARED" affordance in the UI.

### Track/Album/Artist Sync
- After playback, fire-and-forget pushes to enabled sync providers
- Checks `track.spotifyId` or `track.sources?.spotify?.spotifyId`

### Loved Tracks → ListenBrainz / Last.fm

Optional opt-in cross-service love sync. Adding a track to the Parachord collection (`addTrackToCollection`, app.js L13339) → optionally push as a love to LB and/or LFM. Design doc: [`docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md`](docs/plans/2026-05-03-loved-tracks-scrobbler-push-design.md).

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

## Friend Sync (Last.fm + ListenBrainz)

### Overview

Desktop and Android both keep the local `friends` list aligned with each service's follow graph. Sync is **bidirectional** with asymmetric capability per service.

| Direction | Last.fm | ListenBrainz |
|---|---|---|
| **Inbound pull** | `user.getFriends` | `/user/{name}/following` |
| **Outbound push (follow)** | ❌ API deprecated 2018 | `POST /user/{name}/follow` |
| **Outbound push (unfollow)** | ❌ API deprecated 2018 | `DELETE /user/{name}/follow` |

### Data Model

Every friend carries (app.js friend shape):

```js
{
  id, username, service, displayName, avatarUrl,
  addedAt, lastFetched, cachedRecentTrack,
  savedToCollection  // false when sidebar-only, true when in collection
}
```

**`hidden_friend_keys: string[]`** in electron-store — allowlist of `"${service}:${username_lowercase}"` keys for friends the user has explicitly removed. **Load-bearing for Last.fm** (since its friend API is deprecated, the only way to make a removal stick is to skip the username on the next inbound pull). Belt-and-suspenders for ListenBrainz.

### Sync Triggers

1. **Startup:** single pull after `cacheLoaded` + 5s delay, only if Last.fm or ListenBrainz has a configured username. Guarded by `friendStartupSyncDoneRef` so it doesn't re-fire.
2. **Periodic:** every 15th tick of the existing 2-min friend-activity poll (`refreshPinnedFriends`, app.js L29269+). Gated by `friendSyncTickCounterRef` so the graph sync runs every ~30 min while the activity poll continues every 2 min. Friend graphs change orders of magnitude less often than recent tracks — no value polling at the same cadence.
3. **Inline on local action:** `addFriend` calls `followOnService` after local insert; `removeFriend` calls `unfollowOnService` before local delete. Fire-and-forget; local state is authoritative.

### Inbound Pull Algorithm

```
for each service with credentials:
  fetch friend list from service
  for each user in list:
    key = `${service}:${username_lowercase}`
    if key matches any existing friend: skip
    if key is in hidden_friend_keys: skip   // load-bearing for Last.fm
    append to batch

apply-time dedup vs friendsRef.current (covers races between two desktop
  instances syncing the same account concurrently)
setFriends(prev => [...prev, ...deduped])
```

New friends are added with `savedToCollection: false` — same default as manual add via the sidebar modal.

### Outbound Push Semantics

**`addFriend`:** after local insert succeeds
1. Remove `${service}:${username}` from `hiddenFriendKeys` (un-hide if the user is re-adding someone they previously removed).
2. `followOnService(friend)`:
   - ListenBrainz: `POST /follow` with `Authorization: Token ${userToken}`. Warn toast on failure; local add stands.
   - Last.fm: no-op (log only). API deprecated.

**`removeFriend`:** before local delete
1. Add `${service}:${username}` to `hiddenFriendKeys`. Persisted immediately via the useEffect save path.
2. `unfollowOnService(friend)`:
   - ListenBrainz: `DELETE /follow`. Swallow 404s (user deleted their account). Proceed with local removal regardless.
   - Last.fm: no-op. Allowlist is what enforces the removal.

### Sort Options

`collectionSort.friends` supports:
- `alpha-asc`, `alpha-desc` — by `displayName`
- `recent` — by `addedAt` descending ("Recently Added" in UI)
- `active` — friends with activity in the last 14 days, sorted by `cachedRecentTrack?.timestamp` descending ("Recently Active" in UI). Mirrors Android's `FriendSort.ACTIVE`.
- `on-air` — filters to friends whose last track < 10 min old, sorted by activity

Sort switch lives in the friends-tab branch of the collection view (app.js L43971+). Both `active` and `on-air` are filter-and-sort combined: an extra branch in the `displayFriends` derivation applies the inactivity cutoff alongside the on-air filter.

### Manual Sync UI

Small icon button (`M4 4v5h.582m15.356 2A8...` — circular arrows) beside the Add Friend button on the Friends tab header (app.js L43428+). Calls `syncFriendsFromServices({ silent: false })` which toasts "Synced N new friends" on success or "No new friends to sync" on a zero-result manual run. Disabled when neither service is configured.

### Invariants for Cross-Platform Consistency

- **Key shape is identical across Android and desktop:** `"${service}:${username_lowercase}"`. Either client can read the other's hidden-keys list without translation if we ever sync it.
- **`addFriend` on either platform must un-hide.** Both clients remove the key from the allowlist on add so the next sync on the other platform doesn't skip the re-added friend.
- **Last.fm is pull-only on both platforms.** Don't attempt `user.addFriend` or `user.removeFriend` — they'll 403 and introduce phantom follow/unfollow state that confuses the UI.
- **Outbound push failure must NOT roll back local state.** Local is authoritative; service write is best-effort.
- **Startup sync should have a small delay (~5s).** Avoids thrashing the network during bulk cache load.

## Local Files Library

`local-files/` is a SQLite-backed scanner/indexer for music files in user-configured watch folders. DB lives at `userData/local-files.db`. Tables: `tracks` (metadata + paths) and `watch_folders` (configured roots).

### Cadences

- **Foreground:** chokidar real-time watcher per folder, `awaitWriteFinish` 2s, 2s debounce on event batches.
- **Background:** chokidar watchers torn down (Electron throttles them aggressively), replaced with a 5-min `pollForChanges` interval that calls `scanner.scanFolder` on every enabled root.

### Diff-and-delete invariant — DO NOT regress

`scanner.scanFolder` does a tree walk, builds the current set of files, and removes DB entries not in that set. Three guards exist to prevent an unreadable folder (unmounted external drive, offline network share, transient permission lapse, iCloud offload race) from being interpreted as "all files deleted" and wiping the DB:

1. **Pre-scan stat check.** `fs.statSync(folderPath)` before doing anything. If it throws or the path isn't a directory, return early with `skipped: 'unreadable'` / `'not-a-directory'`.
2. **Root-walk error propagation.** `collectAudioFiles` returns `{ok: true|false, files|error}`. The recursive `walk` only swallows errors for *subdirectories*; failure on the root path bubbles up so the caller can abort. (Subdir failures still skip silently — those are usually individual unreadable folders, not whole-volume issues.)
3. **Empty-but-DB-populated guard.** If the scan returns zero files but the DB has any entries for that folder, refuse to delete and log a warning. Mirrors the >70% completeness guard in `sync:start` for the same class of "looks like environmental, not a real change" pattern.

Without these, a user with their music library on an external drive would see the entire scanned library disappear every time the drive disconnected, and reappear on the next 5-min poll once it reconnected. That was the symptom that surfaced the bug in user reports.

### chokidar caveat

The watcher (foreground mode) listens for individual `unlink` events and deletes per-file from the DB. Chokidar may fire a flood of `unlink` events when a watched volume disappears mid-session — there's currently no batched safeguard there equivalent to the scanFolder guard. If users still report disappearance with a foreground app, look at `processFileChange('unlink', ...)` next.

### Library Load Performance

Big libraries (50k–150k tracks) used to freeze the app for tens of seconds during enrichment. Three changes keep load reasonable across the size range:

**Sync warm-cache fast-path for album art.** `formatTrackForRenderer` (local-files/index.js) returns `file://` URLs for `folder_art_path` and the embedded-art cache file (`cache/embedded-<md5(file_path)>.{jpg,png}`) if they exist on disk — no IPC, no extraction. Tracks with already-extracted art render with art immediately on library load.

**Lazy embedded-art warmup** (`enrichLocalTracksWithEmbeddedArt`, app.js ~L9100). For tracks that have embedded ID3 art or sibling `cover.jpg` but no extracted cache entry yet, an 8-way concurrency-limited background loop walks them, calls the new `localFiles:resolveArt` IPC (`resolveArtForTrack(track)` in local-files/index.js), and patches the renderer's library state in batches of 50. Runs unconditionally on every library load — costs nothing for small libraries, pays the extraction cost lazily for big ones.

**Size-gated bulk MBID + Cover Art Archive enrichment.** The existing `enrichLocalTracksWithArtwork` path (MBID mapper + CAA fetch for every track) is now gated behind a 10,000-track threshold. Above that, the loop is skipped with a warning log; per-track MBID enrichment still happens lazily on play. The full big-library fix is tracked at [parachord#784](https://github.com/Parachord/parachord/issues/784); the lazy `local-art://` custom-protocol follow-up to the embedded-art work is at [parachord#787](https://github.com/Parachord/parachord/issues/787).

**Library scan progress toast.** Throttled at 250ms so navigating away from the scan screen mid-import still shows scan status. Prevents the "did it freeze?" reaction.

### IPC field translation for resolveArt

`localFiles:resolveArt` (main.js) accepts the renderer-shaped track payload (camelCase: `filePath`, `hasEmbeddedArt`, `folderArtPath`, `musicbrainzReleaseId`, `musicbrainzArtUrl`) and translates to the snake_case the resolver expects (`file_path`, `has_embedded_art`, `folder_art_path`, etc.) before calling `service.resolveArtForTrack(dbShaped)`. The renderer-side track may strip the `local-` prefix from `id`; the handler restores it for DB lookups. Forward-compatible: passing the raw snake_case shape also works since the handler reads from both keys.

## State Persistence

### Bulk Load Pattern (L18740)
- Single IPC roundtrip: `window.electron.store.getBatch(allKeys)` loads 40+ keys at once
- Includes caches (album art, artist data, track sources), settings, preferences, queues
- `cacheLoaded` flag (L7923) gates initialization effects until restore completes

### Key Persisted Values
- `saved_volume`, `preferred_spotify_device_id`, `active_resolvers`, `resolver_order`
- `saved_queue`, `saved_playback_context`, `auto_launch_spotify`, `skip_external_prompt`
- Caches with TTLs: album art (30 days), artist data (version-checked), charts, concerts

### Save Triggers
- On unmount (cleanup effect)
- Periodically (every 5 minutes)
- Immediately on preference change (volume, preferred device, etc.)

## Dialog Patterns

All dialogs follow the same pattern: state object with `show` boolean, rendered conditionally in the component tree at z-[60].

- `confirmDialog` (L6581): Simple OK dialog `{ show, type, title, message, onConfirm }`
- `syncDeleteDialog` (L6605): Multi-action dialog `{ show, playlist }`
- `devicePickerDialog` (L4989): Promise-based picker `{ show, devices[], onSelect }`

## MBID Mapper Integration (ListenBrainz)

### Overview
We use the [ListenBrainz MBID Mapper v2.0](https://mapper.listenbrainz.org) to resolve music metadata to MusicBrainz IDs in ~4ms. This replaces or shortcuts several slow MusicBrainz API calls that are rate-limited to 1 req/sec.

### API
- **Endpoint**: `GET https://mapper.listenbrainz.org/mapping/lookup`
- **Required params**: `artist_credit_name`, `recording_name`
- **Optional params**: `release_name` (improves accuracy)
- **Response**: `{ recording_mbid, artist_credit_mbids[], release_mbid, release_name, recording_name, artist_credit_name, confidence (0-1) }`
- **Speed**: ~4ms typical response time
- **No auth required**, no documented strict rate limit
- **Docs**: https://mapper.listenbrainz.org/docs

### What It Can Do
- Map `artist + track title` → `recording_mbid`, `artist_credit_mbids[]`, `release_mbid`
- Return canonical/corrected names (useful when metadata has typos or alternate spellings)
- Confidence score (0-1) indicates match quality; ≥0.9 is a strong match

### What It Cannot Do
- **Not a search engine** — takes exact metadata, returns one result (not a list)
- **Cannot look up by album alone** — requires a recording name
- **Cannot replace discography fetches** — only maps recordings, not release-groups
- **Cannot replace open-ended search** — user queries still need MusicBrainz `/ws/2/` search endpoints

### Where We Use It
1. **handlePlay** — mapper fires in parallel with resolver searches; enriches track with `mbid`, `artistMbids`, `releaseMbid`; canonical name fallback retries resolution when all resolvers fail (confidence ≥ 0.7)
2. **Search results** — MusicBrainz `recording.id` stored as `mbid` directly; background mapper lookups warm cache for future use
3. **Album tracks** — `recording.id` and artist-credit IDs extracted from MB release data
4. **Queue additions** — background batch enrichment via `enrichTracksWithMbids()`
5. **Playlist loading** — all 3 load paths (XSPF, ListenBrainz, direct) fire background enrichment
6. **Background resolution** — mapper runs alongside resolver searches
7. **Artist page** — `getArtistMbidFromMapperCache()` shortcuts MB artist search (~0ms vs ~500ms)
8. **Fresh Drops** — mapper cache checked before rate-limited MB artist search (saves ~1100ms per hit)
9. **Scrobblers** — ListenBrainz sends `recording_mbid`, `artist_mbids`, `release_mbid` in `additional_info`; Last.fm/Libre.fm sends `mbid` parameter

### Cache Strategy
- **Key**: `"artist_lowercase|title_lowercase"` → `{ result, timestamp }`
- **TTL**: 90 days (MBIDs are permanent identifiers)
- **Null caching**: misses are cached too to avoid repeated lookups for unknown tracks
- **Persisted**: saved/loaded via `electron.store` key `cache_mbid_mapper`
- **Helper**: `getArtistMbidFromMapperCache(artistName)` scans cache for any track by that artist

### Track MBID Fields
Tracks are enriched with these fields throughout the app:
- `track.mbid` — MusicBrainz recording ID
- `track.artistMbids` — array of MusicBrainz artist IDs
- `track.releaseMbid` — MusicBrainz release ID

### Fresh Drops Artist Limit (50 artists)
`gatherNewReleasesArtists()` caps at 50 artists per fetch, shuffled across sources (collection, library, history). This limit exists because of the MusicBrainz release-groups fetch (`GET /ws/2/release-group?artist={mbid}`), which is rate-limited at 1 req/sec regardless of mapper cache. The mapper only eliminates the *artist search* call (~1100ms each), not the release-groups call. At 50 artists with full mapper cache coverage, Fresh Drops still takes ~55s; doubling to 100 would mean ~110s. The shuffle+accumulate design covers the full library over multiple sessions while keeping each load time reasonable.

### MusicBrainz API Calls That Benefit
| Use case | Before | After (with mapper) |
|---|---|---|
| Artist MBID from track context | `/ws/2/artist?query=...` search (~500ms, rate limited) | Mapper cache hit (~0ms) or live call (~4ms) |
| Artist page initial load | Fuzzy search + validation | Direct `/ws/2/artist/{mbid}` lookup |
| Fresh Drops batch (50 artists) | 50 × 1100ms = ~55s worst case | Cache hits skip MB search entirely |
| handlePlay canonical fallback | No fallback for metadata mismatches | Mapper canonical names retry resolution |

### MusicBrainz API Calls That Don't Benefit
- Discography fetch (`/ws/2/release-group?artist={mbid}`) — still needs MB, mapper has no release-group data
- Release details (`/ws/2/release/{id}?inc=recordings`) — need full tracklist, mapper only maps single recordings
- Album art (`/ws/2/release?query=...`) — need release ID for Cover Art Archive
- Global search (artist/album/track) — open-ended queries need MB's fuzzy search, not mapper's exact lookup

## Scrobbling: inline core, plugin contract for the rest

The three OAuth-based scrobblers (Last.fm, ListenBrainz, Libre.fm) live **inline** in [scrobbler-loader.js](scrobbler-loader.js) — `ScrobbleManager` plus `BaseScrobbler` and one subclass per service, all in one ~600-line file. They are NOT loaded as `.axe` plugins despite the existence of [plugins/lastfm.axe](plugins/lastfm.axe), [plugins/listenbrainz.axe](plugins/listenbrainz.axe), and [plugins/librefm.axe](plugins/librefm.axe) — those `.axe` files declare `type: "meta-service"` with `capabilities: { recommendations: true, metadata: true }` and cover only the *read* half (recommendations, library metadata). The *write* half (now-playing pings + scrobble submissions) stays inline.

### Why inline for the write path

1. **Code shape doesn't fit `.axe`.** A `.axe` is a JSON file whose `implementation.init` is a stringified function. That works for additive, mostly-stateless logic (Achordion's submit flow, AI providers). It's awkward for stateful 600-line classes with retry queues, OAuth state machines, persisted tokens, and protocol-callback wiring.

2. **Privileged-path coupling.** Each scrobbler needs:
   - `window.electron.proxyFetch` for token-exchange CORS bypass
   - `electron.store` for persisted user tokens (key per provider)
   - Protocol-handler registration for `parachord://lastfm-callback` (and friends)
   - Polling for OAuth-completion detection (commit `a380040`)
   - main.js IPC handlers that have to know each provider specifically (endpoint allowlist, token rotation)
   
   These can't be added by an `.axe` alone — main.js has to ship support, which means a desktop release ships with the scrobbler anyway. Bundling closes the loop.

3. **Marketplace hot-push is wrong for load-bearing code.** A bad Achordion `.axe` push = "submit pipeline idle this session." A bad scrobbler push = "user's plays don't scrobble until next desktop release." For users who scrobble, that's the central feature — risk profile too asymmetric for the marketplace path.

4. **Earlier modular attempt didn't pan out.** There's a `scrobblers/` directory + `scrobble-manager.js` (a separate older copy) still in the tree. Commit [`26b7ebd`](https://github.com/Parachord/parachord/commit/26b7ebd) is the explicit consolidation: *"The app uses ScrobbleManager from scrobbler-loader.js (not the separate scrobble-manager.js file)"* — keeping two implementations in sync was a recurring source of bugs. The `scrobblers/` files are functionally dead; treat `scrobbler-loader.js` as the source of truth.

### What CAN come from an `.axe`

The plugin contract is `window.scrobbleManager.registerPlugin({ id, isEnabled, scrobble, updateNowPlaying })` — public, stable. Achordion uses it via `capabilities.playbackTelemetry: true` (see Achordion Pre-resolution Plugin below). Anything that's:

- Additive (a new write target — Maloja, Spotify-history-as-a-source, custom analytics)
- Mostly stateless (no OAuth, no persistent retry queue)
- Doesn't need new main.js IPC

…can ship as a `.axe`. The capability filter + `initResolver()` invocation lives in app.js's cold-load (`initResolvers`, ~L9216) and marketplace hot-reload (`handlePluginsUpdated`, ~L9325) paths — keep those two in lockstep when adding any new playback-telemetry-shaped plugin (same rule as `withGenerate` / `withChat` / `withConcerts`).

### Where to look

| Concern | File |
|---|---|
| Track-state machine, retry queue, plugin dispatch | [scrobbler-loader.js](scrobbler-loader.js) — `ScrobbleManager` |
| Last.fm scrobbler | [scrobbler-loader.js](scrobbler-loader.js) — `LastFmScrobbler` |
| ListenBrainz scrobbler | [scrobbler-loader.js](scrobbler-loader.js) — `ListenBrainzScrobbler` |
| Libre.fm scrobbler | [scrobbler-loader.js](scrobbler-loader.js) — `LibreFmScrobbler` |
| Recommendations / library metadata for those services | `plugins/lastfm.axe`, `listenbrainz.axe`, `librefm.axe` (meta-service) |
| Playback-telemetry plugin (Achordion) | [plugins/achordion.axe](plugins/achordion.axe) |
| Loved-tracks push toggles + backfill | inline in app.js, persisted at `scrobbler_love_push_enabled` / `love_pushed_keys` |
| Stale ignore | `scrobblers/` directory and `scrobble-manager.js` — superseded by scrobbler-loader.js (see commit [`26b7ebd`](https://github.com/Parachord/parachord/commit/26b7ebd)) |

## Achordion Pre-resolution Plugin

`plugins/achordion.axe` — bundled, default-on. Submits confirmed-on-playback `recording-MBID → external-streaming-URL` mappings to Achordion's match cache (POST `https://achordion.xyz/api/track-links/submit`). Each entry stored 90 days with `source: "parachord"`, which outranks Achordion's own Odesli + MB url-rel lookups. Spec: [achordion AGENTS.md L484-507](../achordion/AGENTS.md). Design notes: [docs/plans/look-at-achordion-agents-md-eventual-book.md](docs/plans/look-at-achordion-agents-md-eventual-book.md). This is the **submit half**; the consume half (skip live resolver search on a cache hit) is future work pending an Achordion GET endpoint.

**Plugin shape.** `manifest.type: "meta-service"`, `capabilities.playbackTelemetry: true`. `init()` self-registers a scrobbler-shaped object (`{id, isEnabled, updateNowPlaying, scrobble}`) with `window.scrobbleManager`. `cleanup()` unregisters. The capability filter + `initResolver()` invocation lives in app.js next to the existing `withGenerate`/`withChat`/`withConcerts` branches in *both* the cold-load (`initResolvers`, ~L9216) and the marketplace hot-reload (`handlePluginsUpdated`, ~L9325) — keep those two paths in lockstep when adding any new playback-telemetry-shaped plugin.

**Tiered trigger** — derived from each track's `bestConfidence(track.sources)`:
| Confidence | Hook | Why |
|---|---|---|
| `>= 1.0` (direct-ID match — cached `spotifyId`/`appleMusicId`/etc) | `updateNowPlaying` (track-start) | By definition correct from a prior validated resolution; submit immediately. |
| `>= 0.95` (fuzzy `validateResolvedTrack` pass) | `scrobble` (at scrobble-manager threshold: ≥50% of track or 4min, whichever is sooner) | Containment-match has edge cases (Live/remix/etc); playback-duration is the evidence the match was correct. |
| `< 0.95` | never | Already gate-dropped by `MIN_CONFIDENCE_THRESHOLD` upstream of `track.sources` (see "Match Confidence + Selection Floor"). |

**Inherited filter from scrobbleManager:** tracks with `duration < 30` are excluded from both hooks (see [scrobbler-loader.js:75](scrobbler-loader.js)). Affects tier-1 too — a 25s ambient piece with a verified Spotify ID won't submit. Acceptable trade-off for using existing infrastructure; revisit if coverage matters.

**Submission rules** (inside the plugin):
1. Require `track.mbid`. The MBID Mapper enrichment provides it; a track that hasn't gotten a mapper hit yet at fire time is silently dropped (no retry — the next play of the same track will catch it).
2. In-session dedup via a `Set<mbid>` so loops/replays don't re-POST.
3. Build `links[]` from `track.sources`: Spotify (`https://open.spotify.com/track/{spotifyId}`), Apple Music (`appleMusicUrl` if present, else `https://music.apple.com/us/song/{appleMusicId}`), Bandcamp (`bandcampUrl`/`url`), SoundCloud (`soundcloudUrl`/`permalink_url`/`url`), YouTube (`https://www.youtube.com/watch?v={youtubeId}`). Local files skipped (not shareable). Sources with `noMatch` skipped.
4. Skip if `links.length === 0`.
5. POST with `Authorization: Bearer <embedded-token>`. On 401, flip session-scoped `authFailed = true` and suppress all further submissions until restart (mirrors the Apple Music `_appleMusicWebAuthFailedAt` pattern).

**Bearer token** is embedded as a string constant in `implementation.init`. Generated with `crypto.randomBytes(32).toString('base64url')` plus a `parachord_` prefix so Achordion can identify Parachord-client traffic distinctly. ASAR-extractable; same blast radius as any in-binary secret. Achordion server reads matching value from `PARACHORD_TRACK_LINKS_TOKEN` env var.

**Token rotation** if leaked: generate a new value, swap it in `plugins/achordion.axe`, bump `manifest.version` *and* `marketplace-manifest.json` version (both required — see "Critical: Both Files Must Be Updated"), push to main. Marketplace sync fans out to every install on next launch. Coordinate with Achordion owner so the new token is accepted before old installs become invalid (or accept both for an overlap window).

**Disable path for users:** uninstall the plugin via the Plugins UI (writes to `uninstalled_resolvers`). No bespoke "Pre-resolution" toggle exists; the plugin's own `isEnabled()` returns `true` unconditionally.

**Cross-platform parity.** Android client should mirror the same submit semantics if/when it adds Achordion writes — same endpoint, same bearer token (or a sibling `parachord_android_*` token if Achordion wants to distinguish), same tiered confidence gates derived from `ResolverScoring.kt`. The MBID requirement is non-negotiable on both platforms.

## In-App Announcements

Public banner notifications fetched from Achordion. Used to push messages (releases, Discord invite, incidents) to every Parachord install without shipping a build.

### Architecture

- **Source of truth:** Upstash Redis key `announcements:json` (a JSON-encoded array). Edit it via the Upstash Data Browser UI; avoid the CLI when values contain apostrophes or other shell-fighting characters (the CLI's outer single-quote breaks on inner `'`).
- **Endpoint:** `GET https://achordion.xyz/api/announcements` ([app/api/announcements/route.ts](../../achordion/app/api/announcements/route.ts) in the achordion repo). Reads the Redis key, validates with the same zod schema the desktop client uses, returns the array. Cache headers: `public, s-maxage=60, stale-while-revalidate=600` — edits propagate within ~60s. Public, unauthenticated; gating would just be ceremony.
- **Desktop fetcher:** main.js, ~10s after `app.whenReady()` and on `browser-window-focus` when the last fetch is older than 6h. NO setInterval polling — earlier iteration polled every 1h, dropped to launch+focus-gated to cut request volume ~95% with no behavioural loss for product announcements.
- **Cache:** electron-store key `cached_announcements = { fetchedAt, items }`. Hydrates the renderer at bulk-load time so the banner can render before the first fetch fires. Updated on every successful fetch.
- **Dismissals:** electron-store key `dismissed_announcement_ids = string[]`. Per-id-once. The renderer's `activeAnnouncements` filter strips dismissed/expired/version-mismatched entries; the first remaining item renders.

### Schema

```jsonc
{
  "id": "2026-05-08-launch-discord",  // required, stable; dismissals key off this
  "title": "string",                  // required
  "severity": "info" | "success" | "warn" | "error",  // default 'info'
  "body": "string",                   // optional
  "icon": "📡",                        // optional, ≤4 chars (emoji/glyph)
  "iconUrl": "https://...png",        // optional, https-only, rendered 20×20
  "cta": { "label": "string", "url": "https://..." },  // optional
  "minVersion": "0.9.2",              // optional inclusive lower bound
  "maxVersion": "1.0.0",              // optional inclusive upper bound
  "expiresAt": "2026-06-01T00:00:00Z" // optional ISO-8601
}
```

`iconUrl` takes precedence over `icon`; on image error the banner silently falls back to `icon` (or nothing). Multiple items: id-sort descending wins (date-prefixed ids = recency-sorted), banner shows one at a time, dismiss surfaces the next.

### Per-id-once dismissal is a testing footgun

Once a user dismisses id X, X never re-shows for them — even if the server re-publishes the exact same id with new content. This is correct production behaviour (a fixed, stale banner shouldn't keep appearing), but during testing it looks like "the system is broken." If a banner doesn't appear:

1. Check `await window.electron.store.get('dismissed_announcement_ids')` — if your test id is in there, the filter is correctly suppressing it.
2. Either bump the id (`-v2`, `-v3`, etc.) for each test push, OR clear the dismissed list: `await window.electron.store.set('dismissed_announcement_ids', [])`.

Recommend always changing the id when iterating during dev so you exercise the same code path real users will hit.

### Manual refresh

`await window.electron.announcements.refresh()` (DevTools) forces a fetch regardless of the focus-stale gate. Returns the cached payload after the fetch lands. Use this during testing instead of waiting for focus or restarting.

### Renderer-side diagnostic logs

When `cacheLoaded` flips, the renderer logs `📢 Listener registered for announcements:updated broadcasts`. When main pushes a fresh payload, it logs `📢 Broadcast received: N item(s) [<ids>]`. Absence of either tells you which side the wiring is broken on.

### Cross-process flow

Main fetches → writes `cached_announcements` to electron-store → broadcasts `announcements:updated` via `webContents.send` to every BrowserWindow → renderer's `electron.announcements.onUpdated` listener fires → `setAnnouncements(payload.items)` → `activeAnnouncements` re-derives → banner re-renders. Listener registers in a `useEffect([cacheLoaded])` so it can't miss the broadcast as long as the renderer is up before the 10s mark (it always is — bulk-load completes much earlier).

### Editing flow

1. Upstash Console → Data Browser → key `announcements:json` → paste new JSON array → Save.
2. Within ~60s (CDN cache), `https://achordion.xyz/api/announcements` returns the new array.
3. Users pick it up at next launch (fast path) or on window focus after 6h (slow path), or instantly via manual refresh during testing.

To clear the banner everywhere: `DEL announcements:json` or `SET announcements:json '[]'`.

### Engagement telemetry

Three events fire from the desktop client over the announcement's life:

- **`view`** — first time the banner is painted in a session (deduped per id via `announcementViewedThisSessionRef`; re-renders, focus refetches, etc. don't double-count).
- **`dismiss`** — user clicks the × on the banner. Fires before the dismissed-id-list write so a failed counter increment can't strand the dismissal.
- **`cta-click`** — user clicks the CTA button. Fires before the URL opens.

All three POST to `https://achordion.xyz/api/announcements/event` with `{ id, event }`. Counters are stored as a Redis hash per id: `ann:event:<id> = { view, dismiss, cta-click }`. Read in the Upstash Data Browser via `HGETALL ann:event:<id>` or via `GET https://achordion.xyz/api/announcements/event?id=<id>` which returns `{ id, view, dismiss, "cta-click" }` with absent fields normalised to 0.

**Privacy:** events carry no client identifier, no version, no IP. The IP is read at the edge for rate-limiting only and never persisted. Counters are aggregate-only — there's no path to attribute a dismiss to a specific install.

**Reliability:** the event POST is fire-and-forget with a 4s timeout, `redirect: 'error'`, and full error swallow. Counter writes failing never affect UI state. The endpoint accepts a 200 even when Redis is unconfigured (local dev) so the desktop client doesn't see errors during achordion development without an Upstash backend.

**Rate limit:** 60/min/IP via `lib/rate-limit.ts`'s `announcement-event` kind. Real users emit at most a handful per banner shown; the limit blocks scripts trying to inflate counters.

**Not captured:** time-to-dismiss, time-to-CTA, whether the user dismissed *before or after* clicking CTA, banner impression duration. Add these later if a specific question needs them — don't over-instrument speculatively.

## Plugin (`.axe`) Marketplace System

### Architecture
- Plugins are `.axe` files (JSON) in `plugins/` directory, each with a `manifest` (id, version, etc.) and `implementation`
- **Marketplace source**: Raw GitHub files from `Parachord/parachord-plugins` repo
- **Manifest**: `marketplace-manifest.json` in this repo — the central catalog of all plugins with version numbers
- **Client sync**: `main.js` fetches manifest + `.axe` files from `https://raw.githubusercontent.com/Parachord/parachord-plugins/main/`

### Plugin Loading Order (main.js L3545–3634)
1. Shipped plugins from app `plugins/` directory (bundled in ASAR for packaged builds)
2. Cached marketplace plugins from `~/.parachord/plugins/`
3. Version comparison: newer version always wins; same version prefers shipped over cached

### How Updates Reach Users (No New Build Required)
1. **Update the `.axe` file** in `plugins/` — bump `manifest.version`
2. **Update `marketplace-manifest.json`** — set matching version for that plugin ID
3. **Push to main** — the `sync-repos.yml` CI workflow automatically syncs `.axe` files and manifest to `Parachord/parachord-plugins`
4. **User relaunches Parachord** — `syncPluginsWithMarketplace()` (app.js L1181) compares cached version against marketplace manifest version; if different, downloads the new `.axe` and fires `parachord-plugins-updated` event for hot-reload

### Critical: Both Files Must Be Updated
The client checks `cachedVersion !== marketplaceVersion` (main.js L3674). If you update the `.axe` but not the manifest (or vice versa), the update won't propagate. Always bump version in both:
- `plugins/{id}.axe` → `manifest.version`
- `marketplace-manifest.json` → `version` field for that plugin ID

### Marketplace Sync CI (.github/workflows/sync-repos.yml)
- Triggered on push to main when `plugins/*.axe` or `marketplace-manifest.json` change
- Copies `.axe` files to `parachord-plugins` repo (does NOT delete community-contributed plugins)
- Merges manifest: updates monorepo entries, preserves community-only entries

### Reverse Sync (.github/workflows/reverse-sync.yml)
- Daily at 6 AM UTC or manual dispatch
- Pulls community contributions from `parachord-plugins` back into this repo via PR

### Dynamic Model Selection
- AI plugins (Ollama, ChatGPT, Gemini) use `type: "dynamic-select"` in their model setting
- Each plugin implements a `listModels(config)` function that fetches available models from the provider's API
- **Ollama**: `GET {endpoint}/api/tags` — returns locally installed models
- **ChatGPT**: `GET /v1/models` with blocklist filter (excludes `dall-e`, `whisper`, `tts`, `text-embedding`, `babbage`, `davinci`, `canary`, `moderation`, `embedding`, plus `realtime`/`audio`/`transcri`)
- **Gemini**: `GET /v1beta/models?key=` filtered by `supportedGenerationMethods.includes('generateContent')`
- **Claude**: No list endpoint — stays curated with static `type: "select"`
- App-side: `dynamicModelOptions` state tracks loading/options/error per resolver; `fetchDynamicModels()` called on settings panel open and after API key/endpoint changes
- `fallbackOptions` in the plugin manifest shown when fetch fails or no API key configured yet
- Refresh button (↻) next to model label for manual re-fetch

### AI Chat (Shuffleupagus)
- `AIChatService` (L4700s): Manages conversation, tool calls, and provider communication
- Tool results must include `name` field (not just `tool_call_id`) — Gemini API requires `function_response.name`
- `handleToolCalls` (L4779): Deduplicates multiple `queue_add` calls in same response (merges tracks into one call) — prevents models from adding N×requested tracks
- Share button on user messages copies `https://parachord.com/go?uri=parachord://chat?prompt=...` to clipboard
- `parachord.com/go` is a static redirect page (GitHub Pages) that handles `parachord://` protocol links from contexts that strip custom schemes (e.g., GitHub Discussions)

## `parachord://` Protocol Surface

Custom-scheme deep links handled at app.js's protocol switch (search `switch (command)` ~L10651). Public docs at [`docs/protocol-schema.md`](docs/protocol-schema.md).

| Command | Inputs | Confirmation |
|---|---|---|
| `parachord://play` | `artist` + `title` | None |
| `parachord://play/album` | `mbid` / `spotify` / `applemusic` / `url` / `tracks` / `artist`+`title` | None |
| `parachord://play/playlist` | `url` / `tracks` (optional `title`, `creator`, `shuffle`) | None |
| `parachord://play/radio` | `url` (also reused as refill) / `tracks`+`refill` / `artist`[+`title`] | None |
| `parachord://listen-along` | `service`=`listenbrainz`\|`lastfm`, `user`=`<username>` | None |
| `parachord://import` | `url` / `tracks` | Required (writes to library) |
| `parachord://chat` | `prompt` | Required (sends to AI) |
| `parachord://control/<action>`, `queue/<action>`, `shuffle/<state>`, `volume/<level>`, etc. | varies | None |

**Shared input resolution** (`resolveProtocolPlayInput`, ~L10495): all `play-*` commands feed through one helper that turns `mbid`/provider IDs/url/tracks/artist+title into a normalized `{ displayName, tracks: [{artist, title, album?, mbid?, isrc?}], albumArt? }`. Priority: mbid → spotify → applemusic → url → tracks → artist+title. `opts.allowMbid` / `allowProviderId` / `allowArtistTitleAlbum` gate per-command (album-only shapes silently fall through for non-album commands).

**Tracklist parser** (`window.parseProtocolTracklist`, ~L33048; SYNCed with `tests/helpers/tracklist-parser.js`): auto-detects XSPF (XML, DOMParser) / JSPF / generic JSON tracklist. JSPF identifier strings are MBID-validated (`/^[a-f0-9-]{36}$/i`). Inline tracks capped at 500; bodies capped at 100KB.

**`play/radio` extends in-app spinoff** (`startSpinoff` overloaded to accept `{ pool, displayName, refillUrl }`, ~L32066). Refill loop polls the URL when pool falls below 3 tracks, soft-rate-limited to ≥5s between fetches; stops after 3 consecutive empty fetches. Mode B (`?artist=`) uses the existing similar-tracks endpoint; Mode C (`?url=` / `?tracks=`+`?refill=`) uses an externally-curated pool.

**SSRF guard** (`window.isPublicHttpUrl`, ~L97): rejects non-HTTP(S), loopback, RFC1918, CGNAT (100.64/10), link-local 169.254/16 (incl. cloud-metadata IP), `.local` mDNS (with trailing-dot variants), IPv6 loopback / link-local fe80::/10 / ULA fc00::/7 / IPv4-mapped `::ffff:0:0/96`. Applied at four call sites: `resolveProtocolPlayInput` URL branch, `play/radio` upfront refill check, `refillSpinoffPool` re-check on every refill, and the `import` handler. Does NOT defend against DNS rebinding (documented). All protocol fetchers also pass `redirect: 'error'` to defend against 3xx-to-private redirects.

**Listen-along** (`activateListenAlongRef.current(friend)`, ~L29637 wiring): the `listen-along` case looks up an existing friend; if none, fetches the user's now-playing via `fetchTransientFriendNowPlaying(service, user)` and constructs a transient friend record. LB uses `/1/user/{name}/playing-now`; Last.fm uses `user.getrecenttracks?limit=1` and checks `@attr.nowplaying === 'true'`.

**Acknowledgment toast for slow commands** (~L10847): right after URL parsing, the protocol handler fires a `showToast(..., 'info', null, { duration: 30000 })` for `play`, `import`, `chat`, and `listen-along` (skipped for `control/*`, `queue/*`, `shuffle/*`, `volume/*`, navigation — those complete instantly). Per-command messages: "Loading album…" / "Loading playlist…" / `Loading radio${name ? \`: ${name}\` : ''}…` / `Looking up "${title}" by ${artist}…` / "Importing…" / "Opening chat…" / `Connecting to ${user}…`. The 30s duration covers the worst-case cold-cache resolution window (URL fetch + JSPF parse + N=2 lookahead resolve); the success or error toast that fires when work completes naturally replaces the acknowledgment. Without the long duration, the default 3s timeout would dismiss the loading toast mid-resolution and the user would see a several-second silent gap.

### Android Parity Requirements (protocol play handlers)

This section is for the Android client. Every rule was learned from a real bug; skipping any one breaks the corresponding command. The desktop equivalent is in `app.js`'s protocol switch and the `activateSpinoffFromPool` / `parseProtocolTracklist` / `resolveProtocolPlayInput` helpers — cross-reference if anything below is unclear.

**Path-style URI convention is load-bearing.** Use `parachord://play/album`, `parachord://play/playlist`, `parachord://play/radio` — slash, not hyphen. `listen-along` stays hyphenated because it's a single feature noun, not a verb/object split. The existing protocol surface (`control/pause`, `queue/add`, `artist/<name>`, `album/<name>`, `settings/<tab>`, etc.) is path-style; matching that means publishers can predict the shape from the rest of the surface.

**Input shape priority** (when multiple are present): `mbid` → `spotify` → `applemusic` → `url` → `tracks` → `artist`+`title`. Per-command gates: `play/album` allows all six; `play/playlist` allows only `url`/`tracks`; `play/radio` Mode B is `artist`[+`title`], Mode C is `url`/`tracks`[+`refill`].

**Per-track tagging is mandatory before a track reaches `handlePlay` equivalent.** Every track in a play queue/pool MUST carry these three fields, or playback breaks in subtle ways:

| Field | Why |
|---|---|
| `id` (stable string) | The background resolver's flushToQueue/scheduler equivalents look up tracks by id; refilled tracks need stable ids too. Convention: `protocol-radio-${timestamp}-${index}`. |
| `sources: {}` (empty object, not `undefined`/`null`) | Resolver mutates `track.sources[resolverId]` and the queue UI calls `Object.keys(track.sources)` — throws on undefined. Tracks parsed from JSPF/JSON arrive without this field. |
| `_playbackContext: { type: 'spinoff'/'play/album'/etc, name, ... }` | `handlePlay`'s "should I exit spinoff?" guard reads `track._playbackContext.type` — without the tag, the very first play torpedoes spinoff/listen-along mode and restores `playbackContext` to whatever was before (often null after a `clearQueue`). Net effect: empty queue, no banner, dead next button. |

Refilled tracks (when LB radio returns a fresh batch mid-session) need the same three fields. Inherit `_playbackContext` from the existing pool's first track so it stays consistent.

**Pre-resolve the first track via the standard resolver pipeline before handing to `handlePlay`.** Don't rely on `handlePlay`'s on-demand fallback resolution — for unresolvable tracks (obscure live cuts, remixes not on user's enabled providers) that path surfaces a "No Source Found" dialog before any background resolution can complete.

- `play/album` / `play/playlist`: await resolution of the FIRST track only, then fire-and-forget the rest. If the first track has no sources after pre-resolve, show "Nothing to play."
- `play/radio`: walk through the pool, await resolution of each candidate, skip if unresolvable. Cap at 20 attempts so a fully-unresolvable pool can't loop. After finding a playable first track, **also await resolution of the next 2 lookahead tracks** before calling handlePlay; fire-and-forget resolution for the remainder. Without the lookahead, on heavy-CPU systems track 2's resolution may not finish before track 1 ends — handlePlay then falls into the on-demand resolution path which races against the previous track's teardown and produces a "skip after a couple of seconds" symptom. The bounded ~1s of extra latency before the first track plays is the right tradeoff for deterministic auto-advance.

**State-machine teardown order matters.** When firing a play protocol command:

1. Explicitly tear down active spinoff/listen-along (call `exitSpinoff` / `deactivateListenAlong` directly).
2. Call `clearQueue` (resets shuffle state, makes prior background resolution writes harmless because they look up by track-id against an empty queue).
3. Set the new queue + playback context.
4. Pre-resolve the first track.
5. Call `handlePlay`.

If you skip step 1, `handlePlay`'s internal exitSpinoff/listen-along cleanup runs AFTER your `setPlaybackContext`, restoring the prior context and overriding your new one. If you skip step 2, the prior queue's in-flight background resolution keeps competing with your new resolve calls for Apple Music throttle / MusicBrainz rate-limit budget.

**Apply the teardown to ALL commands that start playback**, not just the album/playlist/radio sub-actions. Concrete list of protocol commands that must do steps 1-2 before kicking off:

- `parachord://play?artist=&title=` (single-track default)
- `parachord://play/album`
- `parachord://play/playlist`
- `parachord://play/radio` (both Mode B and Mode C)
- `parachord://listen-along` (tear down spinoff + clearQueue, but DON'T tear down listen-along — switching from friend A to friend B should swap, not terminate)

Commands that do NOT clear the queue (intentionally): `queue/add` (additive), `control/*` (just transport), `shuffle/*`, `volume/*`, navigation cases (`artist/`, `album/`, `library`, etc. — these only navigate, they don't auto-play), `import` (writes to library, doesn't change current playback), `chat` (sends to AI). `collection-radio` delegates to the in-app starter, which is responsible for its own state hygiene — match the in-app behavior, don't add a separate clearQueue at the protocol layer.

**JSPF + LB lb-radio wrapper.** ListenBrainz wraps the JSPF response in `{ payload: { feedback, jspf: { playlist: { track: [...] } } } }`. Unwrap to the bare JSPF shape (`parsed.payload?.jspf || parsed`) before checking `playlist.track`. Failure mode if you don't: HTTP 200 + 0 tracks parsed → "no playable tracks for radio" toast.

JSPF track fields:
- `creator` (or `artist`) — required. Treat as artist. Accept array forms (some producers emit arrays); join with `", "`.
- `title` — required.
- `album` — optional.
- `identifier` — optional, single string or array. Match `musicbrainz.org/(recording|track)/<36-char-uuid>` URL form OR a bare 36-char UUID. Reject malformed (e.g. `abc-123` is NOT a valid MBID even though pre-fix code accepted it).

LB also embeds artist MBIDs in `track.extension['https://musicbrainz.org/doc/jspf#track'].artist_identifiers`. The desktop parser doesn't read those today (track recording MBID is what we need for resolution); Android can match the desktop's behavior or extend if useful.

Generic JSON shape: `{ title?, tracks: [{artist, title, album?, mbid?, isrc?}] }`. Same MBID UUID validation; trim whitespace; reject empty fields.

**Inline tracks: 100KB encoded cap, 500 tracks max** — same caps as `import` (existing constraint).

**Inline base64 tracks must be decoded as UTF-8.** The naive pattern `JSON.parse(atob(payload))` (and its Kotlin equivalent `JSON.parse(Base64.decode(payload).toString())` or `String(Base64.decode(payload))` without specifying a charset) treats the decoded bytes as Latin-1 / platform default — which silently mangles any UTF-8 multi-byte character: U+2019 right single quote (`'`) becomes `â€™`, em dashes become `â€"`, non-Latin scripts (Cyrillic, CJK, Arabic, etc.) become unreadable. Visible to the user as garbled track titles.

**Correct decode (round-trip bytes through UTF-8):**

```js
// Web/Electron — desktop's window.decodeBase64Utf8Json
const binary = atob(b64);
const bytes = new Uint8Array(binary.length);
for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
const text = new TextDecoder('utf-8').decode(bytes);
const decoded = JSON.parse(text);
```

```kotlin
// Android equivalent
val bytes = android.util.Base64.decode(payload, android.util.Base64.DEFAULT)
val text = String(bytes, Charsets.UTF_8)
val decoded = JSONObject(text)  // or your JSON parser of choice
```

The same fix must be applied at every base64-decode call site that processes user-supplied JSON — both `parachord://import` and `parachord://play/album|playlist|radio` (the latter via the shared input resolver). Don't deduplicate naively across sites by reusing one helper without auditing its charset behavior.

**SSRF guard at every URL fetch site.** Reject:

- Non-HTTP(S) schemes
- Hosts: `localhost` / `localhost.` / any `*.local` / `*.local.` (case-insensitive)
- IPv4: `0.0.0.0/8`, `127.0.0.0/8`, `10.0.0.0/8`, `100.64.0.0/10` (CGNAT / Tailscale), `169.254.0.0/16` (link-local + cloud metadata IP `169.254.169.254`), `172.16.0.0/12`, `192.168.0.0/16`. Boundary cases `172.15.x.x` and `172.32.x.x` ARE public.
- IPv6: bracketed `[::1]`, `[::]`, `[fe80::*]/10`, `[fc00::*]/7` (ULA), `[::ffff:*]/96` (IPv4-mapped). The URL parser canonicalizes decimal-int (`http://2130706433`) and octal (`http://0177.0.0.1`) forms to dotted-quad before the regex sees them — rely on that, don't try to canonicalize manually.

Apply on every fetch — initial AND refills (a publisher could supply a public initial URL that 302s elsewhere). Use the platform's "redirect: error" / `redirect: manual` equivalent so 3xx-to-private redirects also fail. **Does NOT defend against DNS rebinding** (a public hostname resolving to a private IP is accepted) — document this as a known limitation, don't try to fix in the guard.

**ListenBrainz auth token auto-attach.** As of mid-2026 the lb-radio endpoint requires `Authorization: Token <user_token>`. When the URL host is `api.listenbrainz.org`, auto-attach the user's already-configured LB token. **The token lives in the scrobbler plugin's config**, NOT in the basic "meta service" config:

- Desktop reads it from `window.listenbrainzScrobbler.getConfig().userToken`.
- Android equivalent: whatever store the LB scrobbler plugin writes its token into. The same store the user pasted their token into when they connected for scrobbling — there's typically a separate "meta service config" with just the username, but no token. Use the scrobbler-side store.

If the user has no LB token configured, fall through with no auth header. The fetch will 401 and surface as "Radio failed: Fetch failed: 401" via the standard error path.

**play/radio refill semantics.**

- Trigger: pool < 3 tracks remaining.
- Soft rate-limit: minimum 5 seconds between refill fetches.
- Stop condition: 3 consecutive empty refills (counter resets when fresh tracks arrive). On HTTP error, increment empty counter too.
- Dedup against existing pool by `mbid` → `isrc` → `(artist|title)` lowercase. If all refilled tracks dedupe to existing entries, count as empty.
- Reset all refill state in `exitSpinoff` equivalent: refillUrl ref, empty counter, last-fetch timestamp.

**`play/radio` Mode B vs Mode C dispatch.**

- Mode B: `?artist=` (with no `tracks` and no `url`). Seeds Parachord's existing in-app similar-tracks endpoint — same path as right-click → Spinoff in the UI. Ignore `?refill=` for Mode B.
- Mode C: `?url=` and/or `?tracks=` present. Externally-curated pool. `?refill=` overrides `?url=` for refill source; if neither, refill is disabled (static pool, ends when exhausted).

**`?name=` for play/radio Mode C** is the publisher's canonical station name. Display priority: `params.name || params.title || parser's r.displayName || "Radio"`. Used in the toast and the "Playing" banner.

**Pool-based spinoff banner rendering.** A pool-based spinoff has no source track (no specific song to "spin off from"), so its `sourceTrack.artist` is empty. The banner UI should branch on this: if `playbackContext.type === 'spinoff'` AND `!playbackContext.sourceTrack?.artist`, render just the station name (`sourceTrack.title`). Otherwise render the seed-mode "spun off from \"X\" by Y" template.

**listen-along transient friend.** If the target user isn't in the local friends list, construct a transient friend record by fetching their now-playing:

- ListenBrainz: `GET /1/user/{name}/playing-now` (auth required as of mid-2026 with `Authorization: Token <user_token>`). Read `payload.listens[0].track_metadata`.
- Last.fm: `user.getrecenttracks?limit=1` (no auth, just API key). Track is "now playing" only when `@attr.nowplaying === "true"` on the response track object.

If neither service returns a current track, surface "<user> is not currently listening on <service>." Don't error — a user simply not playing is the most common case and the UX should be calm.

**The friend record needed by activateListenAlong:**

```
{
  id: "transient:listenbrainz:foo",
  service: "listenbrainz" | "lastfm",
  username: "...",
  displayName: "...",
  cachedRecentTrack: { name, artist, album, timestamp },
  transient: true,  // distinguishes from saved friends
}
```

`cachedRecentTrack` is required (the activate function asserts it). Synthesize from the now-playing fetch: `{ name: track_name, artist: artist_name, album: release_name, timestamp: Date.now() }`.

## Common Patterns

- **Refs for stale closure avoidance**: Most state values have a companion ref (e.g., `volumeRef`, `isPlayingRef`) synced via `useEffect`. Always use refs in async callbacks.
- **Memoized sub-components**: `TrackRow` (L1375), `ResolverCard` (L2021), `FriendMiniPlaybar` (L3062) — defined outside main component via `React.memo`.
- **Toast notifications**: `showToast(message, type, action, options)` for transient feedback. The 4th `options` arg accepts:
  - `persistent: true` — toast never auto-dismisses; stays until replaced by another `showToast` call or manually closed.
  - `duration: <ms>` — override the default auto-dismiss timeout. Default is 3000ms (or 6000ms when an `action` button is present). Use this when an in-flight acknowledgment toast may take longer than 3s to be replaced — e.g. protocol acknowledgments at the `parachord://` URL handler entry use `duration: 30000` so the "Loading album…" / "Loading radio…" / etc. toast holds across the resolution window (URL fetch + parse + N=2 lookahead resolve) until the success/error toast fires to replace it. Calling `showToast` again at any time replaces the current toast immediately, so a longer duration only matters when no follow-up is queued.
  - `action: { label, onClick }` — adds a button to the toast (extends default to 6000ms unless `duration` overrides).
- **CSS variables for theming**: All colors use CSS vars, supporting light/dark themes.
- **useEffect dep array TDZ trap**: React evaluates a `useEffect`'s deps array synchronously during render — so any variable referenced in the deps array must be declared before the `useEffect` call site in source order. The callback body itself runs after render and captures by closure, so it can freely reference later-declared `const` / function values; only the deps array is constrained. Practical implication: if you're adding a new effect that depends on, say, `cacheLoaded` (declared at app.js ~L9066), the effect must live below that line. Logical-grouping with other related effects sometimes loses to this constraint — see the Cross-Resolver Enrichment slow-trickle effect, which lives in the cacheLoaded-effects cluster (~L9818) rather than next to its sibling background-sync effect (~L6177). A leading comment at the natural placement point ("moved past the cacheLoaded declaration — see L9820") keeps future readers from being surprised.

## Releasing

When tagging a new version, three places must agree on the version string. Missing any one of them ships a build whose internal version disagrees with the git tag:

1. `package.json` — `"version"` field.
2. `package-lock.json` — TWO `"version"` fields at the top (root and the `packages.""` entry). Both must match `package.json`.
3. `RELEASE_NOTES.md` — add a new entry at the top with `# Parachord vX.Y.Z` heading, release date, and grouped highlights. The in-app "What's New" modal renders this file (parsed via the bundled fallback or fetched from GitHub) so users see your bullet points on first launch after upgrade.

Then commit (`X.Y.Z` is conventional for the commit subject), push, and `git tag vX.Y.Z` + `git push origin vX.Y.Z`. The CI build picks up from the tag.
