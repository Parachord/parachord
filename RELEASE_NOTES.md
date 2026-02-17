# Parachord v0.7.0-alpha.5

**Release date:** 2026-02-17

---

## Resolution Performance

Track resolution is significantly faster and more responsive.

- **Incremental resolver results** — results now appear in the UI as they're found instead of waiting for all resolvers to finish
- **Parallel album resolution** — all tracks in an album resolve concurrently with incremental UI updates
- **Concurrent resolution with config caching** on album pages for faster load times
- **Bandcamp pre-resolution** — embedded player pre-resolves track IDs for faster playback

## Apple Music Improvements

- **Switched to native MusicKit catalog API** with iTunes Search fallback for more accurate results
- **Album-aware caching** — resolution cache is now keyed by album context to prevent cross-album mismatches
- Fixed auth failing when Music.app is not running on macOS

## Resolver Fixes

- **Track resolution order** — already-pending tracks get promoted in the queue when you navigate to them
- Fixed resolvers with no match being re-queried endlessly
- Fixed sequential playlist re-resolution when resolver settings change
- Fixed albums not re-resolving when local files are added to the watch list

## Sync Safety

- **Mass-removal safeguard** — the sync engine now detects and blocks bulk deletions to prevent accidental data loss

## UI & Playback Fixes

- Fixed black screen and "Render frame was disposed" error
- Fixed playbar showing wrong album art after reporting a bad match
- Fixed Local Files icon flashing when no local match is found
- Fixed Bandcamp window loading the full page instead of the embedded player

---

## v0.7.0-alpha.3 & v0.7.0-alpha.4

<details>
<summary>Earlier changes (2026-02-13)</summary>

### Page Support Indicator (Browser Extension)

Know at a glance when Parachord can scrape the page you're viewing.

- **Green dot indicator** in the extension popup when the current page is a supported playlist or album
- Shows the content name (e.g. "Discover Weekly" or "OK Computer") when detected
- Supported on Spotify, Apple Music, SoundCloud, Bandcamp, YouTube, and more

### Apple Music Scraping Improvements

Major reliability improvements for importing Apple Music playlists and albums.

- Fixed missing artist names — now extracts artists from JSON-LD metadata and supplements with DOM fallback
- Fixed URL pattern matching — trailing wildcards now correctly match multiple path segments
- Added automatic scrape retry logic for more reliable imports
- Restored Bandcamp playback to use the embedded player window

### Windows & Linux Support

- **Windows context menus fixed** — right-click menus now work correctly with `titleBarOverlay` instead of `-webkit-app-region: drag` on the title bar
- **Drag-to-playlist on Windows** — "New Playlist" drop target works on all platforms
- Linux continues to work with the standard drag region (Electron 34+ fix)

### Playlist Management

- **Create New Playlist button** added to the playlists page for quick playlist creation

### Queue & Playback Fixes

- **Play Next** now inserts at the correct position in the queue
- **Context banner** updates properly when the queue changes
- **Local library** now shows all tracks instead of being capped at 50

### Resolver Blocklist

Report and block bad source matches without disabling an entire resolver.

- **Blocklist specific results** — flag individual bad matches from the context menu
- Blocklisted results are skipped during future resolution without affecting other tracks from the same resolver

### Build & Update

- Auto-updater manifest files now included in build artifacts and releases
- Suppressed spurious auto-updater error toast on startup

</details>

---

**Full changelog:** `git log v0.7.0-alpha.2..v0.7.0-alpha.5`
