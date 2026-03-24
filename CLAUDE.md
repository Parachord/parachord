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

### Playlist Sync
- `syncSetupModal` (L5361): Multi-step wizard (options -> playlists -> syncing -> complete)
- Providers: spotify, applemusic (primary); also librefm, listenbrainz for scrobbling
- Settings loaded via `window.electron.syncSettings.load()`, saved per-provider via `.setProvider()`
- `suppressSync(providerId, externalId)`: Prevents future auto-sync for a removed playlist

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

### Where We Use It (Electron app)
1. **Playbar artist bio** — mapper resolves artist MBID from current track in ~4ms instead of MB artist search (~500ms+)
2. **Artist page loading** — when navigating from current track's artist, uses cached/live mapper MBID for direct `/ws/2/artist/{id}` lookup instead of fuzzy search
3. **Fresh Drops (new releases)** — checks mapper cache for artist MBIDs before hitting rate-limited MB search (saves 1100ms per cache hit)
4. **Track resolution fallback** — when all resolvers fail to find a match, retries with mapper's canonical artist/recording names

### Cache Strategy
- **Key**: `"artist_lowercase|title_lowercase"` → `{ result, timestamp }`
- **TTL**: 90 days (MBIDs are permanent identifiers)
- **Null caching**: misses are cached too to avoid repeated lookups for unknown tracks
- **Persisted**: saved/loaded via `electron.store` key `cache_mbid_mapper`
- **Helper**: `getArtistMbidFromMapperCache(artistName)` scans cache for any track by that artist

### Integration Pattern for Android
When implementing in the Android app, the same strategy applies:
1. **Cache aggressively** — MBIDs don't change. Use a Room/SQLite table with `artist|title` as key, 90-day TTL
2. **Fire in parallel** — mapper calls should run concurrently with resolver searches, not block them
3. **Use for artist MBID shortcutting** — any time you need an artist MBID and have a track title available, prefer the mapper (~4ms) over MB artist search (~500ms + rate limit risk)
4. **Canonical name retry** — when resolver string matching fails, retry with mapper's `artist_credit_name` + `recording_name` as the search query
5. **Don't use for album-only lookups** — the mapper requires a recording name; album lookups still need MB `/ws/2/release-group` search
6. **Don't depend on for ISRC** — the mapper doesn't return ISRCs. Spotify deprecated `external_ids` (including ISRC) in Feb 2026 (partially reverted in March 2026), making ISRC-based cross-service matching unreliable

### MusicBrainz API Calls That Benefit
| Use case | Before | After (with mapper) |
|---|---|---|
| Artist MBID from track context | `/ws/2/artist?query=...` search (~500ms, rate limited) | Mapper cache hit (~0ms) or live call (~4ms) |
| Artist page initial load | Fuzzy search + validation | Direct `/ws/2/artist/{mbid}` lookup |
| Fresh Drops batch (50 artists) | 50 × 1100ms = ~55s worst case | Cache hits skip MB search entirely |
| Playbar bio MBID resolution | MB artist search per track change | Mapper with MB fallback |

### MusicBrainz API Calls That Don't Benefit
- Discography fetch (`/ws/2/release-group?artist={mbid}`) — still needs MB, mapper has no release-group data
- Release details (`/ws/2/release/{id}?inc=recordings`) — need full tracklist, mapper only maps single recordings
- Album art (`/ws/2/release?query=...`) — need release ID for Cover Art Archive, mapper's `release_mbid` could help but only when we have a track name
- Global search (artist/album/track) — open-ended queries need MB's fuzzy search, not mapper's exact lookup

## Common Patterns

- **Refs for stale closure avoidance**: Most state values have a companion ref (e.g., `volumeRef`, `isPlayingRef`) synced via `useEffect`. Always use refs in async callbacks.
- **Memoized sub-components**: `TrackRow` (L1375), `ResolverCard` (L2021), `FriendMiniPlaybar` (L3062) — defined outside main component via `React.memo`.
- **Toast notifications**: `showToast(message, type)` for transient feedback.
- **CSS variables for theming**: All colors use CSS vars, supporting light/dark themes.
