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

The renderer has **two independent code paths** that can call `sync.createPlaylist`:

- Background sync timer (every 15 min, app.js L5750+)
- Manual sync post-IIFE after the wizard completes (app.js L9377+)

Both loops read `local_playlists`, iterate, and push. Without coordination they race: both read a playlist without `syncedTo`, both call `sync.createPlaylist`, both create remotes.

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
- **Main.js `sync:start` clears `syncedFrom` when the remote no longer exists** — but only if the response looks complete (>70% of previously-synced playlists still present). Guards against mass-duplicate creation on partial API responses.
- **Bulk save on Android** must guarantee `sync_playlist_links` writes are durable independently of playlist object writes (separate keys, separate transactions). The whole point of the map is to survive playlist-save bugs.

### Track/Album/Artist Sync
- After playback, fire-and-forget pushes to enabled sync providers
- Checks `track.spotifyId` or `track.sources?.spotify?.spotifyId`

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
