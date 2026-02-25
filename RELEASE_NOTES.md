# Parachord v0.8.0-alpha.2

**Release date:** 2026-02-25

---

## Browser Extension v0.3.0 — Chrome & Firefox

The browser extension no longer uses WebSocket to talk to the desktop app. Communication now goes through Chrome's native messaging API — a secure, local-only channel verified by the browser.

- **Native messaging** — new relay host bridges Chrome's stdin/stdout protocol to the desktop app over a local IPC socket (Unix socket on macOS/Linux, named pipe on Windows)
- **Auto-installer** — registers the host manifest for Chrome, Chromium, Edge, Brave, and Firefox on macOS, Linux, and Windows
- **Firefox support** — packaging script produces both Chrome and Firefox zips; native messaging installer registers for both browser families
- **Spotify URL lookup** — the Spotify resolver now handles `open.spotify.com` and `spotify:` URIs directly (tracks, albums, playlists), so link interception actually delivers tracks to the queue
- **Link intercept fixes** — intercepted tabs only close when the URL is delivered to the desktop app; handles Chrome MV3 service worker restarts gracefully
- **Chrome Web Store packaging** — `npm run package:extension` validates the manifest and produces store-ready zips
- **Store listings** — Chrome Web Store and Firefox Add-ons store descriptions added
- **Privacy policy** — comprehensive policy covering the desktop app and extension

## Smart Links — Large Embed

- **`?size=large` embed** — 600px-wide player with album art (or playlist mosaic), Play All button, streaming service icons, and the complete tracklist with per-track durations and service badges
- **oEmbed support** — `?size=large` returns correct iframe dimensions (dynamic height based on track count)
- **Favicon** — all go.parachord.com pages now have favicon.ico, icon.svg, and apple-touch-icon

## Universal Mac Build

The macOS build was producing arm64-only binaries, causing "not compatible" errors on Intel Macs.

- **Universal binary** — DMG and zip now contain both Intel and Apple Silicon slices
- **MusicKit helper** — Swift build updated to compile for both `arm64` and `x86_64`
- **CI workflow** — now passes `--universal` to electron-builder
- **x64ArchFiles** — tells `@electron/universal` how to merge native `.node` modules
- **Bundle cleanup** — excluded `native/` source directory that was confusing the universal merge

## Spotify Sync — Pre-resolved Sources

- **Synced tracks skip re-resolution** — tracks from Spotify library sync now carry their Spotify source data, so the resolution system skips redundant Search API calls
- **Token refresh retry** — Spotify API calls that fail with HTTP 400 now automatically refresh the token and retry

## Fresh Drops Reliability

- **Cache persistence fixed** — Fresh Drops now correctly survives app restarts (fixed falsy-timestamp sentinel, cache ref overwrite during rebuild, and missing store key whitelist entries)
- **Faster loading** — releases stream in more quickly with a visible loading indicator
- **"Coming" badge** — upcoming releases are highlighted with a "Coming" prefix
- **10s fetch timeout** — MusicBrainz calls now have a timeout to prevent indefinite hangs

## Bug Fixes

- Fixed queue not restoring on restart due to a race condition with resolver settings initialization
- Fixed Spotify synced tracks not resolving (missing source data)
- Fixed "Play Playlist Next" incorrectly creating a library playlist
- Fixed AI Suggestions and New Releases caches silently failing to persist (missing `ALLOWED_STORE_KEYS` entries)
- Replaced text "Refresh" link with spinning refresh icon on AI Suggestions
- Added favicon to go.parachord.com share pages

---

# Parachord v0.8.0-alpha.1

**Release date:** 2026-02-24

---

## AI-Powered Suggestions

The Home tab now features personalized album and artist suggestions powered by your configured AI service (OpenAI or Gemini).

- **Album Suggestions** — 5 AI-recommended studio albums, validated against MusicBrainz to ensure they're real, full-length releases
- **Artist Suggestions** — 5 AI-recommended artists with one-line explanations of why they fit your taste
- **Progressive streaming** — suggestions appear one by one as they validate, with skeleton placeholders for remaining slots
- **Hover actions** — play or queue an album/artist's top tracks directly from the suggestion card
- **Variety on refresh** — 10 rotating variety themes (hidden gems, different decades, global scenes, genre-crossing, etc.) steer each batch in a different direction, and previously suggested items are excluded
- **Expanded listening context** — the AI prompt now draws from your full listening history across all time periods (weekly, monthly, 6-month, all-time), top tracks, and artists/albums extracted from saved songs in your Collection
- **Persistent suggestions** — cached between sessions so suggestions appear instantly on launch, with fresh ones loading in the background

## Fresh Drops

A new section on the Home tab showing recent album releases from artists you listen to.

- **Automatic discovery** — pulls new releases from all your connected artist sources (Collection, listening history, scrobbling services)
- **Incremental refresh** — new albums stream in as they're found; stale broadcasts are filtered out
- **Hover actions and context menus** — play, queue, or share albums directly from the card
- **Instant on launch** — cached between sessions with skeleton loading states

## Album & Playlist Smart Links

Share any album or playlist as a web link that works across streaming services.

- **Album smart links** — service icon row (Spotify, Apple Music, YouTube, etc.) with album-level URLs, full tracklist with per-track play buttons when Parachord is connected
- **Playlist smart links** — 2x2 album art mosaic cover, creator attribution, per-track playback, and `.xspf` download for portable playlist export
- **Server-side enrichment** — missing service URLs are resolved server-side so links show maximum coverage
- **Share button** — added to album and playlist detail pages with a styled flyout menu
- **Context menus** — smart link and share options available on album cards, album page art, playlist pages, Home playlist cards, top albums in history, and friend activity albums

## Embeddable "Send to Parachord" Button

Third-party websites can embed a button that sends playlists directly into Parachord.

- **Three-tier delivery** — WebSocket (instant), HTTP POST fallback, and `parachord://` protocol handler as last resort
- **Hosted on Cloudflare Pages** — `button.js` is CDN-delivered for easy integration
- **HTTPS-compatible** — WebSocket connection upgraded for secure pages; HTTP fetch fallback when WebSocket is blocked

## Listen Along

- **Graceful disconnect** — when a friend goes offline, the current song now finishes playing before the listen-along session ends

## Home Tab Layout

- **Weekly Jams and Weekly Exploration** separated into distinct side-by-side columns
- **Collection section header** added above the stats grid
- **Album art tooltip** now shows both click and drag-to-playlist actions

## Bug Fixes

- Fixed stale closure bug causing resolvers to never execute after settings changes
- Fixed album smart links sometimes returning 0 tracks due to a race condition
- Fixed album-level enrichment matching against track name instead of album name
- Fixed AI recommendations not loading due to race condition with plugin initialization
- Fixed double-encoded HTML entities in Critics Picks descriptions
- Fixed suggestion tooltips clipped by scroll container overflow
- Fixed missing previous weeks in Weekly Jams/Exploration playlists
- Fixed gray screen crash when queuing tracks from certain views
- Fixed multiple TDZ (temporal dead zone) crashes in collection tab and album track fetching
- Fixed collection sidebar showing empty when synced data exists on other tabs
- Fixed cached suggestions not appearing on launch
- Fixed album page crash when Share props were missing
- Fixed WebSocket connection failures from HTTPS-served embed pages
- Fixed Fresh Drops header layout bouncing with few albums
- Fixed New Releases not including all artist sources fairly
- Album art fallback now uses enabled resolvers instead of hardcoded iTunes API

---

<details>
<summary>v0.7.0-alpha.15 and earlier</summary>

## v0.7.0-alpha.5

**Release date:** 2026-02-17

### Resolution Performance

- **Incremental resolver results** — results appear in the UI as they're found
- **Parallel album resolution** — all tracks in an album resolve concurrently
- **Bandcamp pre-resolution** — embedded player pre-resolves track IDs for faster playback

### Apple Music Improvements

- Switched to native MusicKit catalog API with iTunes Search fallback
- Album-aware caching to prevent cross-album mismatches
- Fixed auth failing when Music.app is not running on macOS

### Resolver Fixes

- Track resolution order — pending tracks get promoted when navigated to
- Fixed resolvers with no match being re-queried endlessly
- Fixed sequential playlist re-resolution when resolver settings change

### Sync Safety

- Mass-removal safeguard — bulk deletions are detected and blocked

### UI & Playback Fixes

- Fixed black screen and "Render frame was disposed" error
- Fixed playbar showing wrong album art after reporting a bad match

</details>

---

**Full changelog:** `git log v0.8.0-alpha.1..v0.8.0-alpha.2`
