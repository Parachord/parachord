# Parachord - Claude Code Guide

## Architecture

Single-file React app (`app.js`, ~58k lines). No JSX — uses `React.createElement()` exclusively. Styling via Tailwind CSS classes + inline styles with CSS variables (`var(--accent-primary)`, `var(--card-bg)`, etc.).

Main component: `const Parachord = () => { ... }` (L4951), rendered via `ReactDOM.createRoot`.

## Playback

### Resolver System
- Resolvers provide playback, search, and metadata (Spotify, Apple Music, SoundCloud, YouTube, Bandcamp, local files)
- `CANONICAL_RESOLVER_ORDER` (L1266): `['spotify', 'applemusic', 'bandcamp', 'soundcloud', 'localfiles', 'youtube']`
- Each track has a `sources` object keyed by resolver ID — playback picks the highest-priority available source
- Resolvers loaded into `loadedResolversRef` (L7756) with `.play()`, `.search()`, `.capabilities`

### handlePlay (L13213)
- Central async playback function; manages `playbackGenerationRef` to supersede stale requests
- Stops all competing audio (Spotify, Apple Music, browser, local, SoundCloud, YouTube, Bandcamp) before starting new track
- Retry logic for Spotify: if `.play()` fails, retries after 2s with fresh token, then falls back to next resolver

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

### In-Session Mutex

The renderer has **two independent code paths** that call `sync.createPlaylist` and `sync.pushPlaylist`:

- Background sync timer (every 15 min, app.js L5750+)
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

### Track/Album/Artist Sync
- After playback, fire-and-forget pushes to enabled sync providers
- Checks `track.spotifyId` or `track.sources?.spotify?.spotifyId`

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

## Common Patterns

- **Refs for stale closure avoidance**: Most state values have a companion ref (e.g., `volumeRef`, `isPlayingRef`) synced via `useEffect`. Always use refs in async callbacks.
- **Memoized sub-components**: `TrackRow` (L1375), `ResolverCard` (L2021), `FriendMiniPlaybar` (L3062) — defined outside main component via `React.memo`.
- **Toast notifications**: `showToast(message, type)` for transient feedback.
- **CSS variables for theming**: All colors use CSS vars, supporting light/dark themes.
