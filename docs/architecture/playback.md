# Playback, resolvers and source selection

> Moved verbatim out of `CLAUDE.md` on 2026-10-22 so the always-loaded guide stays short; `CLAUDE.md` indexes this file. Line references such as `app.js L####` date from when each passage was written and have drifted: search for the named function instead. Cross-references to other sections point at sibling files in `docs/architecture/`.

## Playback

### Resolver System
- Resolvers provide playback, search, and metadata (Spotify, Apple Music, Amazon Music, SoundCloud, YouTube, Bandcamp, local files)
- `CANONICAL_RESOLVER_ORDER` (L1266): `['spotify', 'applemusic', 'amazonmusic', 'bandcamp', 'soundcloud', 'localfiles', 'youtube']`
- Each track has a `sources` object keyed by resolver ID — playback picks the highest-priority available source above the confidence floor
- Resolvers loaded into `loadedResolversRef` (L7756) with `.play()`, `.search()`, `.capabilities`

### Resolver Result Shape

Resolver `.search()` and `.resolve()` results spread into `track.sources[resolverId]` via `{ ...result, confidence }`. The shape is conventional rather than typed — fields a resolver populates show up as `track.sources[id].<field>`. The required fields are obvious from the resolver implementations: `id`, `title`, `artist`, `album`, `duration`. The interesting set is the **optional cross-cutting metadata** that downstream consumers walk for, regardless of which resolver populated it:

- **`isrc?: string`** — recording ISRC, normalized to upper-case + trimmed, format `[A-Z]{2}[A-Z0-9]{3}\d{7}`. Capture from every API response that exposes it; leave undefined for the rest. Currently populated by: Spotify (`external_ids.isrc` on `/v1/search`, `/v1/tracks/{id}`, `/v1/playlists/{id}/tracks` — parachord#893), Apple Music native MusicKit (`song.isrc`), local files (ID3 TSRC / Vorbis ISRC / MP4 atom via music-metadata's `common.isrc` — parachord#895). Bandcamp / SoundCloud / YouTube / iTunes Search API don't expose ISRC; leave undefined. **Downstream consumers** walk `track.sources[*].isrc` (with top-level `track.isrc` as fallback) via `window.pickTrackIsrc(track)` — currently used by the ISRC→MBID fallback in `resolveMbidForLove` tier 3 + `enrichTrackWithMbid` (parachord#888 + #894) and the achordion submit ISRC-only fallback (parachord#892). New consumers should reuse `pickTrackIsrc` rather than reading `track.isrc` directly so a Spotify-resolved track with no top-level ISRC still works.

- **`streamQuality?: object`** — technical parameters of the stream the resolver delivers: `{ tier?, codec, container, bitrate (kbps), sampleRate (Hz), bitDepth?, channels?, origin: 'measured' | 'claimed' }`, all fields optional. `tier` is the resolver's own quality vocabulary when it has one (Amazon: SD/HD/Ultra HD). **Presence of the record IS the capability** — a resolver that can't know (Spotify Connect, MusicKit JS) attaches nothing and surfaces render exactly as before. Unlike `isrc`, this describes the *playing stream*, not the track: consumers MUST key it off the resolver actually playing via `window.pickStreamQuality(track, playingResolverId)` (root `stream-quality.js`, loaded by index.html, also `require`-able) — never "any source on the track", because a Spotify-played track with a localfiles source attached is streaming through Spotify. Display via `window.formatStreamQuality(q)` → `"Ultra HD · FLAC · 48.0 kHz · 24-bit · 1478 kbps"`. Currently populated by: localfiles (play-time parse, see "Stream quality HUD" under Local Files Library) and amazonmusic (see "Stream quality capture" under the Amazon Music resolver — measured median bitrate + captured DASH manifest/init params, nothing fabricated). **Do NOT add scan-time DB columns for it** — play-time parsing was chosen deliberately (works for every file day one, no migration/backfill window; see that section).

The principle generalizes: any cross-cutting metadata (ISRC today; potentially BPM, key, release year, etc. later) belongs on the source record so downstream consumers can walk sources and pick from any resolver that captured it. Resolver-specific identifiers (`spotifyId`, `appleMusicId`, `bandcampUrl`) stay on the source record for the resolver that owns them.

### Match Confidence + Selection Floor

Source selection is a **two-stage gate**: validate, then sort. Without the floor, a higher-priority resolver's wrong-artist match silently outranks a correct lower-priority result, because confidence is otherwise only a within-priority tiebreaker.

**Stage 1 — Validation.** `validateResolvedTrack(result, targetArtist, targetTitle)` (`sync-providers/confidence-scoring.js`, exposed to the renderer as `window.ConfidenceScoring`) returns true only when BOTH the artist and title containment-match the target after `normalizeStr` (lowercase + strip non-alphanumeric). Single-axis matches — same title, different artist; or same artist, different title — fail.

**Stage 2 — Scoring.** `calculateConfidence(track, result)` (same module; `Parachord` aliases it) returns:
- `1.0`: **identity tier** (2026-10): the original and the result carry the same ISRC (`pickIsrc`: top-level `isrc`, else any `sources[*].isrc`; normalised and shape-validated as `[A-Z]{2}[A-Z0-9]{3}\d{7}`) or the same recording MBID (`mbid` / `recordingMbid`, case-insensitive). Checked before any name comparison, so a "Various Artists / Track 1" tag on a self-hosted rip still matches when the ids agree; Spotify and Apple Music results carry ISRCs too. A missing, malformed or different id falls through to the name gate unchanged. `handlePlay`'s `findBestMatch` uses the same order when it picks among a resolver's search results: MBID, then ISRC, then the exact normalised name, then the contains passes. **Cross-platform invariant** with mobile's `ResolverScoring.kt`; mobile parity ticket: Parachord/parachord-mobile#402.
- `0.95` — both axes pass `validateResolvedTrack`
- `0.50` — single-axis match, or no match
- `1.0` (or whatever the resolver supplied ≥ 0.95) — direct-ID match (cached `spotifyId`/`appleMusicId`/etc), preserved as-is

**Stage 3 — Selection floor.** `MIN_CONFIDENCE_THRESHOLD = 0.6` (same module). The source-selection sort in `handlePlay` drops sources below this floor BEFORE the priority sort runs. A 0.50 source never reaches selection.

**Stage 4 — Priority + confidence sort.** Sources passing the floor sort by user-configured resolver priority; confidence is the within-priority tiebreaker.

**What `handlePlay` actually does at selection time.** For each resolver with a non-`noMatch` source on the track it re-scores the source with `confidenceForSource` against the track's own artist and title (a cached source from an older code path may lack a `confidence` field). The one exception is a local-files row with a `filePath` but no artist or title: it keeps its stored score (1.0 when none), because re-scoring a nameless row would return 0.50 and drop a file that is on disk. Then, in order: keep only resolvers in `activeResolvers`; apply the floor; drop sources on the per-result blocklist (`resolverBlocklistRef`, matched on resolver, normalized artist and title, and source id); sort with `track.preferredResolver` first (if set), then priority ascending, then confidence descending. The first survivor plays.

Worked example. Resolver order `[spotify, bandcamp]`, track "Yesterday" by The Beatles. Spotify's top hit is a different artist's "Yesterday" (0.50), Bandcamp's is the right recording (0.95). Without the floor Spotify wins on priority and plays the wrong song; with it, Spotify is dropped before the sort and Bandcamp plays. If both sources score 0.50, nothing survives and `handlePlay` shows the "No Enabled Source" dialog (or auto-skips in auto-advance and spinoff contexts, see `autoSkipIfAdvancing` below), after logging a per-candidate scorecard (`Source selection scorecard`) that covers floor drops, inactive resolvers and blocklisted sources alike.

**Per-resolver play buttons are a preference, not a bypass.** The resolver badges in the list views call `handlePlay({ ...track, preferredResolver: resolverId })`. That only moves the resolver to the front of the sort; a source that is disabled, below the floor or blocklisted still cannot play.

**Tests.** `tests/resolver/confidence-scoring.test.js` covers `normalizeStr` (case folding, punctuation, Unicode), `validateResolvedTrack` (both-axes containment, missing and empty inputs), `calculateConfidence` (0.95 both-match, 0.50 single-axis, direct-ID 1.0 preserved, a wrong-artist result rejected even when the resolver claims 1.0) and the 0.6 threshold. It mirrors Android's `ConfidenceScoringTest`.

**History.** Tightened on 2026-05-04 (`acb167d`). Before that, `calculateConfidence` ignored the artist (title and duration only), so a same-titled track by another artist could score 0.85, and with no floor it outranked a correct lower-priority source. The fix required both axes, added the 0.6 floor before the priority sort, and replaced three hardcoded `confidence: 0.9` stamps in background resolution with scoring plus a skip-on-reject. Android applied the same tightening to `scoreConfidence` in parachord-mobile.

**All resolution paths gate on `MIN_CONFIDENCE_THRESHOLD`** and skip the attach entirely (with a warn log) when a result fails — three background paths (normal resolver pipeline, rate-limited iTunes, per-track flush) plus five `calculateConfidence`-using sites (search-page `resolveRecording`, validation pipeline, missing-resolver flush, bandcamp-shortcut path, scheduler flush). All eight follow the same pattern: `const confidence = calculateConfidence(track, result); if (confidence < MIN_CONFIDENCE_THRESHOLD) skip-and-warn; else attach`. This prevents wrong-artist results from ever entering `track.sources` (and so from rendering pale resolver badges) and from polluting `track.album` / `track.albumArt` fallback fields.

**Badge dim logic is absolute (≥ 0.95 = full opacity), not relative-to-best.** `getBestSourceConfidence(sources)` (src/renderer/components/track-lists.js — moved there with its pre-component consumers in Track 2b slice 2; the 10 in-component badge call sites bind it via the require-back destructure in app.js) returns the constant `0.95` regardless of input. Each badge renders dimmed (opacity 0.6) when its confidence is strictly less than 0.95, full otherwise — `(source.confidence || 0) < bestConf ? 0.6 : 1`. Since the upstream `MIN_CONFIDENCE_THRESHOLD = 0.6` floor drops sub-floor results before they reach `track.sources`, in normal operation the only values present are 0.95 (fuzzy validated) and 1.0 (direct-ID), so nothing dims unless a resolver explicitly returns a non-standard sub-0.95 value. The function signature is preserved (takes `sources`, returns a number) so the 11 badge call sites compile unchanged; the argument is ignored. **Historical note:** the prior relative-to-best model dimmed a 0.95 fuzzy match whenever a sibling resolver had 1.0, which users read as "wrong" when the match was actually correct — flipped to absolute on 2026-05-08. Applied at all 11 badge call sites (TrackRow + 10 list-view variants).

**Cross-platform invariant.** `sync-providers/confidence-scoring.js` is the **canonical desktop module** (`normalizeStr` / `validateResolvedTrack` / `calculateConfidence` / `MIN_CONFIDENCE_THRESHOLD` / `pickConfidentMatch`); `tests/helpers/confidence-scoring.js` is now a thin **re-export** of it (was a parallel byte-copy — collapsed to a re-export so the two can't drift). app.js now consumes the module directly (`window.ConfidenceScoring` aliases — the three inline copies, one of which had already drifted, are gone); the Kotlin equivalents (`parachord-mobile/shared/.../resolver/ResolverModels.kt#scoreConfidence`, `ResolverScoring.kt#MIN_CONFIDENCE_THRESHOLD`) remain the other byte-identical copies of the *function bodies*. All must agree byte-for-byte on the gate semantics — drift on any platform produces inconsistent source selection between desktop and Android for the same track. Test cases at `tests/resolver/confidence-scoring.test.js` mirror Android's `ConfidenceScoringTest`.

**Sync hydration (`resolveTracks`) gates on the same floor (parachord#911 D-Legacy-1).** `sync-providers/spotify.js` and `sync-providers/applemusic.js` `resolveTracks` mint a provider ID for an ID-less playlist track via search. The legacy code ended candidate selection in an unguarded `|| items[0]`, minting the top hit's URI with no confidence floor when no exact match existed — writing a wrong-song URI (e.g. local "Intro" by The xx → "Intro" by Alt-J) that then stuck fleet-wide via provider-ID equality. Both now route candidates through `pickConfidentMatch(track, candidates)` (best `calculateConfidence` ≥ `MIN_CONFIDENCE_THRESHOLD`, else `null` → drop to `unresolved`). Apple Music additionally (D-Legacy-2): tries an **ISRC-exact catalog lookup first** (`GET /catalog/{storefront}/songs?filter[isrc]=`, authoritative — recording identity, matches mobile's `getCatalogSongIdByIsrc`) and is **storefront-aware** (`getUserStorefront` via `/me/storefront`, falling back to `us`) instead of hardcoding `/catalog/us/` — so desktop and mobile mint the *same* catalog id for a given (ISRC, storefront) and don't create permanent AM duplicates. Fixtures: `tests/sync/resolve-tracks-identity.test.js`.

### handlePlay (L13213)
- Central async playback function; manages `playbackGenerationRef` to supersede stale requests
- Stops all competing audio (Spotify, Apple Music, browser, local, SoundCloud, YouTube, Bandcamp) before starting new track
- Retry logic for Spotify: if `.play()` fails, retries after 2s with fresh token, then falls back to next resolver

**Shared HTML5 audio element.** Local files, SoundCloud and Subsonic play through one `audioRef` element. `ensureSharedAudioElement()` attaches every listener the first time any of those paths creates it. Resolver-specific listeners (local-file network-share seek retry, each path's error dialog) key off the element's `src` — `local-audio:` / `blob:` / `http(s)` — not off `track.sources`. A track can carry a Subsonic source while a local file is playing; if the first session play created the element, the other path's listeners must still run. A new HTML5 resolver adds its branch inside that function, it does not attach its own listeners on create.

**Failure-path auto-skip in auto-advance contexts.** Near the top of `handlePlay` is `autoSkipIfAdvancing(reason)` which all 9 failure paths (No Source Found, No Enabled Source, Local Playback Error ×2, SoundCloud Not Connected, SoundCloud Playback Error ×2, Track Re-resolved ×2: `play()` returned falsy, and `play()` threw) call before showing a dialog. Both Track Re-resolved dialogs name the resolver (`resolver.name`) and the thrown one includes `error.message`; a bare "Playback failed" sent a resolver author looking for a Parachord bug while his own `play()` was returning false. The helper returns true when `isAdvancingTrackRef.current || spinoffModeRef.current` — i.e. handleNext is in flight, or we're inside a spinoff/radio session. In that case it logs `⏭️ Auto-skip "X" — <reason>`, marks the track's queue entry status: 'error' (no-op for spinoff-pool tracks since they aren't in the queue), schedules another `handleNext` via `setTimeout(... 600)` (after the 500ms re-entrancy lock releases), and returns true so the caller skips the dialog. User-initiated single-track plays from outside spinoff/auto-advance still surface the dialog as before. This makes radio/spinoff sessions resilient: a single unplayable track gets silently passed over instead of stopping playback with a modal.

### Cross-Resolver Enrichment (Eager Gate + Slow Trickle)

When a track has a persisted source from one resolver but is missing slots for other enabled resolvers, `resolveTrack` (app.js ~L23598) has two complementary code paths for filling those missing slots. The split exists because of a real performance regression — a user with 376 local FLACs and Bandcamp enabled saw ~1 minute of pinwheel + constant CPU on every library navigation, because library-page navigation tagged 374 tracks at page-priority and the scheduler walked them all firing Bandcamp searches that returned 0 every time.

**Eager gate (foreground, in-handler):** If the persisted sources include a `localfiles` source with no `noMatch` flag and confidence ≥ 1.0, the missing-resolver fill is skipped entirely. Localfiles confidence-1.0 means "this file exists on disk and plays" — cross-resolver enrichment for it is speculative (the user's obscure Japanese reggae rip is unlikely to also be on Bandcamp) and the burst pattern destroys UX. **Scoped specifically to `localfiles`**, not all confidence-1.0 sources: a confidence-1.0 Spotify match (cached spotifyId from sync) DOES carry cross-platform intent — those still fire the eager fill, because finding the matching Apple Music ID is useful.

**Slow trickle (background, separate useEffect):** A setInterval-driven loop walks `collectionTracksRef.current` looking for tracks with at least one real source but missing some enabled non-localfiles resolver. Fires `resolveTrack(..., { forceEnrichment: true })` on at most one candidate every 10 seconds, ONLY while the window is unfocused (mirroring the "do work while user is away" principle from background sync). The `forceEnrichment` option flips the gate inside resolveTrack so the same fill code path runs, just stretched over hours instead of seconds. Per-session `enrichmentAttemptedRef: Set<trackId>` prevents re-trying within a launch; cross-launch dedup is handled by the existing `noMatch` sentinel persistence in `cache_track_sources`.

This split preserves the Achordion contribution path: local-only listeners playing tracks that DO exist on streaming services eventually get those mappings resolved (during background time) and submitted to Achordion's match cache. See [parachord#791](https://github.com/Parachord/parachord/issues/791) for the polish backlog (negative cache per-(resolver, artist), telemetry, integration with ResolutionScheduler vs the parallel setInterval).

**Critical placement note:** the slow-trickle useEffect references `cacheLoaded` in its dep array, so it MUST live AFTER the `useState` line that declares `cacheLoaded` (~L9066). It's intentionally separated from its logical sibling (the background-sync useEffect around L6177) for this reason. See the placement comment in app.js and the React useEffect TDZ note in [Common Patterns](../../CLAUDE.md#renderer-patterns).

### Spotify Playback (Connect only)
- **Spotify Connect is the only mode.** The resolver's `play` (`plugins-src/spotify/implementation.js`) and `playOnSpotifyConnect` (app.js ~L36591) drive an external Spotify client (desktop app, phone, speaker) through the REST API (`/v1/me/player` endpoints). There is no in-app Spotify player: the Web Playback SDK is not loaded anywhere. In-app playback via the SDK on the castlabs Widevine build is tracked in parachord#1077.
- `streamingPlaybackActiveRef.current = true` is not a Spotify mode. It is set whenever any resolver with `capabilities.stream` starts playback, so browser-extension playback events are ignored while a streaming resolver owns playback.

### Apple Music

Apple Music has two playback backends, tried in this order by the resolver's `play` (`plugins-src/applemusic/implementation.js`):

1. **Native MusicKit (macOS).** A Swift helper app (`native/musickit-helper/`, driven from `musickit-bridge.js` over stdin/stdout JSON, macOS only) uses `ApplicationMusicPlayer` and the system's Apple Music sign-in, so it needs no developer token. Its own README lists the commands.
2. **MusicKit JS (every platform).** `musickit-web.js` loads Apple's MusicKit JS in the renderer and plays through the castlabs Widevine CDM (see [platform.md](platform.md)). It needs a developer token. Apple's licence server accepts only a production VMP-signed build, and the stream is 256 kbps AAC.

**Developer token.** `main.js` generates the MusicKit JWT at startup (ES256, signed with Node's `crypto`, 180-day expiry) from the `AuthKey_<keyId>.p8` key it finds in `resources/keys/` (packaged as `keys/`). The renderer reads it through the `config-get` IPC (`MUSICKIT_DEVELOPER_TOKEN`), which returns, in order, the `MUSICKIT_DEVELOPER_TOKEN` environment variable, the generated token, or a token the user saved in Settings (`applemusic_developer_token`). With none of these, MusicKit JS cannot be configured.

**Search and lookups.** `window.appleMusicSearchWithMusicKit` tries native MusicKit, then MusicKit JS, then the unauthenticated iTunes Search API. The plugin implements `lookupUrl`, `lookupAlbum` and `lookupPlaylist`; playlist lookup goes through `window.appleMusicLookupPlaylist`, a MusicKit JS catalog call that returns nothing when MusicKit JS is not configured.

**Catalog throttle.** Every native catalog call goes through `window.nativeMusicKitLimiter` (`createLimiter` from `resolver-limiter.js`: 3 concurrent, 150 ms minimum gap, an 8-second cooldown after 3 consecutive throttle errors such as a 429 or `MusicDataRequest` failure). Apple's catalog throttle is per token and spills across endpoints, so an unthrottled search fan-out also breaks playback.

**Sync.** `sync-providers/applemusic.js` is the playlist and library sync provider (ISRC-first and storefront-aware track resolution, the PUT-then-POST degrade for playlist writes). See [sync.md](sync.md).

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
