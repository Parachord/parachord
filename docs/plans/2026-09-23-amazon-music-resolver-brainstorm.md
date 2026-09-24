# Amazon Music Resolver — Exploration Findings & Architecture Brainstorm

Date: 2026-09-23
Status: **implemented** — shipped in the same working session as parachord#988 (resolver
`amazonmusic`, CDP controller in main.js, poller, manage-app consent flow, tests). Live
end-to-end validated: search (catalog + library merge), play, pause, resume, seek, stop,
cached replay, and the near-end auto-advance signal. This document now serves as the
RE reference / protocol notes; the operational invariants live in CLAUDE.md § Amazon Music
Resolver.

## TL;DR

An Amazon Music resolver is very feasible via **CDP control of the Amazon Music desktop
app**, and *not* feasible via a pure-API approach (streams are Widevine-DRM'd DASH,
which stock Electron cannot play). The app honors `--remote-debugging-port`, exposing
its full native bridge (`window.Native`) — search, playback, transport, queue — all
validated working on 2026-09-23.

```
Parachord ──CDP (ws://127.0.0.1:9224)──> Amazon Music app (CEF) ──> Widevine DASH
                                          does the DRM + audio output
```

This is architecturally a sibling of the Spotify Connect resolver: the external client
is the audio engine; Parachord is the remote control and search client.

## What the Amazon Music app actually is

- CEF (Chromium Embedded Framework) app, codename "Morpho" 9.5.2.2478, Intel x86_64
  (runs under Rosetta on Apple Silicon — this machine's copy does).
- UI is not bundled: the shell loads `https://www.amazon.com/morpho/webapp/index.html`
  — a Vue 2 + webpack SPA — and talks to the native side through a JS bridge
  (`window.Native`, see below).
- Native playback via the "Harley" pipeline + **Widevine**
  (`Frameworks/libwidevine_cdm_secured_mac.dylib`).
- Auth token in Keychain: `com.amazon.music` / `amazon_cloud_player_remember_me`
  ("Amazon Music Account Login"). Tokens are "panda" tokens (see web API below).
- Streams: `POST https://music.amazon.com/NA/api/dmls/getDashManifestsV2` +
  `getLicenseForPlaybackV2` → DRM-protected MPEG-DASH. Track identity is
  `asin://B0XXXXXXXX:tracknum:deviceId`.
- Also connects to Arcus MQTT (`arcus-uswest.amazon.com`) for push updates, and
  reports metrics to Cirrus.

## Why a pure reverse-engineered API resolver doesn't work (for playback)

The web player at music.amazon.com uses the **MESK API** (same API family that powers
Alexa/Echo devices):

- Base: `https://na.web.skill.music.a2z.com/api/*`
- Auth: amazon.com cookies → `GET /horizonte/pandaToken` → `accessToken` inside the
  `x-amzn-authentication` header; CSRF from `POST /config.json`.
- Surface (recovered from the web bundle `WebSF/app.modern.*.js`): `showSearch`,
  `showSearchSuggestions`, `showCatalogTrack/Album/Playlist`, `playCatalogTrack(s)`,
  `playCatalogAlbum`, `playStation(FromTrack/FromArtist)`, `queueNext*/queueLast*`,
  `playbackStarted/Paused/Resumed/Finished/Stopped`, `showLibrary*`, `showPurchasedTracks`,
  `showUserPlaylists`, etc.
- Requests are `Content-Type: text/plain` POSTs with a stringified `headers` object
  (CORS-friendly), responses are giant "template" JSON trees.

Catalog search works unauthenticated but only returns podcast verticals; music
verticals need the logged-in accessToken. That part is fine — but **playback is
dash.js + Widevine EME**, identical DRM posture to the desktop app. Stock Electron
ships no Widevine CDM, so Parachord cannot decrypt Amazon streams in-process.
Switching to a Widevine-enabled Electron fork is a much bigger commitment (licensing,
VMP signing, every platform) than this resolver justifies.

=> API knowledge is still useful later for a sync provider or metadata-only
enrichment (both work fine with cookie-authenticated MESK), but playback must
route through the app.

## The validated approach: CDP control of the desktop app

### Launch

The app honors the CEF flag:

```
open -a "Amazon Music" --args --remote-debugging-port=9224
# or directly:
"/Applications/Amazon Music.app/Contents/MacOS/Amazon Music" --remote-debugging-port=9224
```

- The app is single-instance ("MorphoAlreadyRunning" — a second launch just forwards
  args to the running one). If the app is already running *without* the flag, the
  resolver must quit it (AppleScript `quit app "Amazon Music"`, wait, kill "Amazon
  Music Helper" if it lingers) and relaunch with the flag. This should be a
  one-time opt-in ("Allow Parachord to manage Amazon Music"), not something the
  resolver does silently mid-session.
- CDP binds to 127.0.0.1 only (default) — but note: *any local process* can control
  the app while the port is open. Document this in the resolver settings copy.
- CDP speaks WebSocket — a resolver can talk to it from the Parachord renderer
  directly (no CORS restriction on raw WebSocket); only app-launching needs a tiny
  main.js spawn helper.

### The bridge: `window.Native`

After connecting CDP, the webapp exposes `window.Native` with sub-objects:
`Player`, `Library`, `Account`, `Media`, `Core`, `CoreAPI`, `Marketplace`, `Recents`,
`Services`, `FileSystem`, `Image`, `DownloadQueue`, `Metrics`, `Exceptions`.

Calling convention (recovered from the webapp's `NativeProxy` module): the bridge
validates argument counts strictly — call with exactly the right arity, single
object args, no callbacks ("incorrectArguments" otherwise). Results that return
data are **live CEF proxy objects** that populate in place (poll until loaded, then
`Native.Library.release(ref._id)` when done).

### Validated API surface (all tested live on 2026-09-23)

**Search** — works, returns library+catalog:
```js
const r = Native.Library.getSearchResults({ keyword: "...", allowCorrection: true });
// r is a live proxy; poll until r.prime.state === 'loaded' (≈1-3s)
// r.library.sections: [{type: "artist"|"track"|"album"|"playlist", items: [...]}]
// track item: { uniqueId, asin, title, artist: {name, asin}, album: {name, asin, image, albumArtist},
//              duration (s), genre, trackNumber, explicitStatus, isMusicSubscription, isPrime,
//              contentEncoding: ["hdAvailable", ...], image ... }
// when done: Native.Library.release(r._id)
```

**Play** — works (audio actually played during the test):
```js
Native.Player.setVolume(0.15);   // 0..1
Native.Player.startPlayback(
  [{ id: track.uniqueId, asin: track.asin, type: "track", name: track.title,
     isMusicSubscription: track.isMusicSubscription, isPrime: track.isPrime,
     playbackStartedFrom: "parachord" }],   // selectionObjs
  { pageType: "search", resourceType: "browse" },  // containerInfo (metrics)
  { startTimestamp: String(Date.now()) },           // metricsData
  0,          // startIndex
  false,      // shouldUseCQOnlinePattern
  track.uniqueId  // uniqueId
);
// Native.Player.playerModel.state → "PLAYING"; .currentPlayable.track.{title, asin}
// Native.Player.playbackProgress.currentTime (ms)
```

**Transport** — all present on the bridge:
`setPaused(bool)`, `playNext()`, `playPrevious()`, `seek(ms)`, `stopPlayback(reason)`,
`setVolume(0..1)`, `toggleMute()`, `setShuffle(bool)`, `toggleRepeat()`.

**Queue**: `appendTracks(selectionObjs, ...)`, `insertNext(...)`, `removeFromPlayQueue`,
`reorderPlayables`, `getPlayQueue()`.

**Status polling**: `Native.Player.playerModel` (`state`, `currentPlayable`,
`nextPlayable`, `hasPrev`) and `playbackProgress` (`currentTime`, `buffered`) are live
proxies — read on an interval (500-1000ms) while a Parachord-initiated playback is
active. `state` transitions observed: `EMPTY` → `PLAYING` (+ presumably
`PAUSED`/`FINISHED`/`STOPPED` — verify against the webapp constants when implementing).

**Also available** (future, not resolver-scope): `Library.getPlaylists`,
`getPlaylistDetail`, `createPlaylist`, `appendTracksToPlaylist`,
`addPlaylistToLibraryByAsin`, `Account.customerInfo`, `Recents.getRecentlyPlayed` —
i.e. a future **sync provider** for Amazon Music (import/push playlists) is feasible
through the same channel, no additional RE needed.

## Proposed resolver design

### Shape

- Resolver id: `amazonmusic`. Capabilities: `search` + `play` (remote-control style) —
  no in-app streaming, no `streamUrl`.
- Placement: like Spotify Connect, this needs a privileged touchpoint (app launch +
  CDP), so a bundled built-in resolver (or a bundled `.axe` + small main.js support)
  is right. CDP itself needs no main.js (WebSocket from renderer works); only the
  app launcher needs a spawn IPC.
- Add to `CANONICAL_RESOLVER_ORDER` near the streaming services (e.g. after
  `applemusic`); do NOT add to the resolver-limiter skip set — its searches are local
  IPC to the app, not network calls to rate-limited services. (Still respect the
  global resolver pattern of gating attach on `MIN_CONFIDENCE_THRESHOLD`.)

### Playback flow (handlePlay integration)

Mirror the Spotify Connect "device handoff" mode:

1. Ensure app is running with the debug port (opt-in managed relaunch if not).
2. `.play(track)`: search by `artist + title` via `getSearchResults` → pick best via
   existing `calculateConfidence`/`pickConfidentMatch` (floor 0.6, validated 0.95)
   → `startPlayback(selectionObjs...)` with `setVolume(getEffectiveVolume()/100)`.
3. Poll `playerModel`/`playbackProgress` @ ~1s while playing; surface state in the
   Parachord transport UI (progress bar, current track confirmation).
4. On `state === "FINISHED"` (or track-change) during auto-advance contexts → call
   `handleNext` so the Parachord queue stays authoritative (same pattern as other
   resolvers; the failure paths already auto-skip via `autoSkipIfAdvancing`).
5. Volume changes from Parachord → debounced `setVolume` (like the Spotify volume
   debounce). Seek → `Player.seek(ms)`.
6. Stopping/switching resolvers → `stopPlayback("parachord")`, like other handoff
   resolvers stop competing audio.
7. Persist the ASIN match on `track.sources.amazonmusic = { asin, uniqueId, title,
   artist, album, duration, confidence }` so replays skip the search (direct-ID match
   → confidence 1.0 per the standard model).

### UX details

- Resolver settings section needs the opt-in: "Let Parachord manage Amazon Music
  (relaunches it with a local control port)". Show status: app running / port open /
  logged-in.
- If the user manually uses the Amazon app while Parachord drives it, last writer
  wins (same as Spotify Connect). Consider showing an "Amazon Music is playing" chip.
- `showToast` on handoff ("Playing via Amazon Music") to make the handoff legible.

### Risks / unknowns

- **App updates**: the app self-updates via its Updater; a CEF update could drop
  `--remote-debugging-port` support or change the bridge. The webapp itself is
  cloud-loaded and re-versioned independently (webapp version 5.4.2.x observed).
  Bridge calls are behind stable names (`Player.startPlayback` etc.), but expect
  occasional breakage; version-gate and fail soft (resolver errors, not app crashes).
- **`uniqueId` volatility**: `ML-<uuid>` ids from search look session-scoped. Rely on
  ASIN for persistence; re-search to mint fresh `uniqueId`s when replaying.
- **Search result skew**: results mix the user's cloud library and catalog
  (library entries first). Fine for resolver matching — `validateResolvedTrack`
  still applies — but catalog-only filtering isn't obvious from the API used
  (`filter: {IsLibrary: ["false"]}` exists on the MESK side; check whether the
  desktop bridge accepts it).
- **Search history pollution**: searches through the app land in the app's search
  suggestions history (visible in the app UI). Cosmetic; mention in the settings copy.
  No single-item removal API (`Library.clearSearchHistory` wipes everything — do not
  call it).
- **Content restrictions**: explicit-language filter ("ELF") in the user's Amazon
  account can make tracks unplayable; treat "No Source Found" like other resolvers.
- **Android parity**: no equivalent path (Android app is a different animal; MESK
  API there would need its own RE). Per the mobile-parity rule this is a
  desktop-only resolver — flag to the mobile repo only if/when we standardize an
  "external player control" contract (not worth it for one service).
- **DRM/licensing**: playing through the user's own app+subscription is the same
  entitlement posture as the user clicking play themselves; no ToS-gray stream
  extraction happens anywhere.

## Alternative approaches considered (and why not)

1. **CastLabs/Widevine-enabled Electron + MESK playback** — biggest lift, licensing +
   VMP signing, and couples the whole app to a custom Electron. Revisit only if
   in-app playback for Amazon ever becomes a must-have.
2. **Embed music.amazon.com web player in a BrowserView and drive it** — same Widevine
   gap in stock Electron; would ALSO need the login cookie session. Dead end for
   playback, fine for auth'd metadata.
3. **`amazoncloudplayer://` URL scheme** — registered by the app but (per Info.plist
   strings) only a viewer/deeplink role; no documented `play track X` semantics.
   CDP supersedes it.
4. **AppleScript/media keys** — the app answers basic AppleScript `name` (standard
   suite) and registers media-key handling, but there's no track-selection surface.
   Transport-only; CDP gives strictly more.

## Open questions to settle before implementation

1. Exact `playerModel.state` values + the transition that signals track-finished
   (poll for `FINISHED` vs. `currentPlayable` id change — handle both defensively).
2. Does `startPlayback` support album/playlist selectionObjs (type: "album" with asin)
   for cheap `parachord://play/album` support? The webapp maps them
   (`type: "album"|"playlist"|"artist"|"station"`), so likely yes — verify.
3. Whether the desktop bridge's `getSearchResults` accepts an `IsLibrary` filter.
4. Best UX for the initial "app not under management" state — auto-relaunch prompt vs
   manual instructions.

## Appendix: repro notes

- Launch: `open -a "Amazon Music" --args --remote-debugging-port=9224`
- CDP: `curl http://127.0.0.1:9224/json/list` → page target =
  `https://www.amazon.com/morpho/webapp/index.html#/...` → WebSocket → `Runtime.evaluate`.
- Webapp bundles for bridge semantics: `https://www.amazon.com/morpho/webapp/js/app.js`
  (NativeProxy = module "6586", player service = "0903", selection mapper = "056b",
  StartPlayback command has the exact 6-arg order).
- Web player API bundles (MESK): `https://d5fx445wy2wpk.cloudfront.net/release/WebSF/app.modern.*.js`
- Desktop app logs: `~/Library/Application Support/Amazon Music/Logs/AmazonMusic.log`
  (DMLS calls visible with full request URIs).
