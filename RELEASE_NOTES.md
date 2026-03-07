# Parachord v0.8.1-alpha.1

**Release date:** 2026-03-07

---

## Dark Mode & Theming Engine

Full dark mode support with a comprehensive design token system. Every surface, text color, border, shadow, and accent in the app now uses CSS custom properties — no more hardcoded hex values.

- **Dark mode toggle** — choose Light, Dark, or System in Settings; follows your OS preference by default
- **Flash-free startup** — the main process pre-applies the `dark` class before the window is shown, so there is no flash of light mode on launch
- **Design tokens** — 100+ CSS custom properties (`--bg-primary`, `--text-secondary`, `--accent-primary`, `--card-shadow`, etc.) defined in `:root` with `.dark` overrides
- **365+ hardcoded colors converted** — every inline `#hex` and `rgb()` value across cards, tooltips, modals, filter bars, inputs, scrollbars, and skeletons now references design tokens
- **System theme listener** — `nativeTheme.on('updated')` in the main process notifies the renderer when the OS switches between light and dark
- **Theme-aware focus rings** — all `focus-visible` outlines use `--accent-primary` with rounded corners
- **Shimmer and skeleton classes** — new `shimmer-light` and `shimmer-strong` utility classes replace per-element gradient definitions
- **Always-dark surfaces** — the player bar, queue drawer, and AI panels retain their dark appearance in both modes via dedicated `--surface-dark-*` tokens

## Concerts — Live Music Discovery

A brand-new Concerts page aggregates upcoming shows from multiple ticketing services, filtered by your location and listening history.

- **Four concert data sources** — new Bandsintown, Songkick, SeatGeek, and Ticketmaster plugins (`.axe` files) provide concert listings
- **AI concert disclaimer** — when AI-sourced concert results are present, a disclaimer badge flags them as potentially hallucinated
- **Location-aware filtering** — IP-based geolocation with multiple fallback services, plus a location autocomplete search dialog with configurable radius (miles)
- **On Tour indicator** — a purple dot next to the now-playing artist links directly to the On Tour tab when nearby concerts exist; hovering shows a tooltip
- **Artist page On Tour tab** — artist detail pages show an "On Tour" tab with that artist's upcoming concerts, with ticket links and loading skeletons
- **Concert row design** — large artist images, 3-column layout (date, image, venue/reason), ticket buttons with flyout menus linking to each service
- **Lineup and opener matching** — concerts are matched against your library by headliner, opener, and lineup members; tribute/cover band false positives are filtered out
- **Persistent cache** — concert results are cached for 24 hours and survive app restarts; `cache_concerts` added to the store key whitelist

## Fresh Drops — Reliability Improvements

- **Fixed stale cache loop** — `lastFullScan` is now tracked separately from `timestamp`; incremental refreshes no longer reset the full-scan clock, preventing an infinite refresh loop
- **Shuffled artist sources** — collection, library, and history artists are shuffled and interleaved in round-robin so every refresh discovers releases from different artists
- **Full re-scan after 24 hours** — when the last full scan is over 24 hours old, a complete re-scan runs instead of an incremental check
- **Fixed duplicate releases** — Fresh Drops no longer shows the same releases repeatedly

## Performance

- **Batch IPC on startup** — all `store.get()` calls during initialization are batched into a single `store-get-batch` IPC roundtrip, eliminating dozens of sequential Electron IPC calls and significantly reducing cold-start time
- **Background concert pre-loading** — concert data is fetched in the background after initial load, without blocking the UI

## UI & UX Polish

- **Search tab** — font size and icon size now match other sidebar tabs; subtle active-state indicator added
- **Filter pills** — consistent focus styling, rounded corners on focus-visible rings, standardized chip sizing across concerts and other filter bars
- **Artist cards** — collection and search artist cards now match album card styling with visible borders at rest and theme-aware colors
- **Sidebar tab colors** — brightened teal accent; highlight colors match page headers; fixed hover overflow and spin direction
- **Tooltip contrast** — dark mode tooltips use a lighter background for better readability; player bar tooltips stay dark in both modes
- **Playlist share button** — increased spacing above the Share button on playlist view
- **Refresh icon** — fixed spin direction to rotate clockwise; player bar skeleton shimmer now animates correctly
- **Close button** — capitalization fix ("Close" instead of "close"); uses theme-aware styling in Search header
- **Artist discography navigation** — BACK button no longer skips the artist discography when closing a release; it returns to the release list first

## Spotify API Resilience

- **Retry on 502/503/504** — both `spotifyRequest` and `spotifyFetch` now retry transient server errors with exponential backoff (up to 30 seconds between retries), instead of failing immediately

## Plugin Marketplace

- **New concert plugins** — Bandsintown, Songkick, SeatGeek, and Ticketmaster added to the marketplace manifest with icons, descriptions, and download URLs
- **New `concerts` category** — added to the marketplace category list

## Documentation

- **TypeScript migration plan** — comprehensive plan for migrating the JavaScript codebase to TypeScript
- **YouTube Music sync design** — design document for YouTube Music library sync using Google Data Portability API
- **Listening history import** — issue draft for cross-service listening history import
- **YouTube Music library import** — issue draft for YouTube Music library import feature
- **Bulk export research** — appendices covering Spotify extended streaming history and Apple Music bulk export
- **UI consistency audit** — remaining implementation plan for UI consistency work

## Bug Fixes

- Fixed Artist Suggestions card not loading discography on click
- Fixed playlist resolution stopping when navigating back
- Fixed shimmer animation not playing on resolver icon skeletons (switched from `background` shorthand to `background-image`)
- Fixed concert cache not bypassing when clicking the nav button
- Fixed geoIP location lookup failing by adding multiple fallback services
- Fixed dark mode styling inconsistencies across filter bars and modals
- Fixed concert false positives from tribute and cover bands leaking through the location filter
- Fixed concert refresh not clearing stale cache properly

---

# Parachord v0.8.0-alpha.12

**Release date:** 2026-03-03

---

*See git log for alpha.12 and earlier changes.*

---

<details>
<summary>v0.8.0-alpha.2 and earlier</summary>

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

</details>

---

**Full changelog:** `git log v0.8.0-alpha.12..v0.8.1-alpha.1`
