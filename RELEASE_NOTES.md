# Parachord v0.7.0-alpha.3

**Release date:** 2026-02-13

---

## Page Support Indicator (Browser Extension)

Know at a glance when Parachord can scrape the page you're viewing.

- **Green dot indicator** in the extension popup when the current page is a supported playlist or album
- Shows the content name (e.g. "Discover Weekly" or "OK Computer") when detected
- Supported on Spotify, Apple Music, SoundCloud, Bandcamp, YouTube, and more

## Apple Music Scraping Improvements

Major reliability improvements for importing Apple Music playlists and albums.

- Fixed missing artist names — now extracts artists from JSON-LD metadata and supplements with DOM fallback
- Fixed URL pattern matching — trailing wildcards now correctly match multiple path segments
- Added automatic scrape retry logic for more reliable imports
- Restored Bandcamp playback to use the embedded player window

## Windows & Linux Support

- **Windows context menus fixed** — right-click menus now work correctly with `titleBarOverlay` instead of `-webkit-app-region: drag` on the title bar
- **Drag-to-playlist on Windows** — "New Playlist" drop target works on all platforms
- Linux continues to work with the standard drag region (Electron 34+ fix)

## Playlist Management

- **Create New Playlist button** added to the playlists page for quick playlist creation

## Queue & Playback Fixes

- **Play Next** now inserts at the correct position in the queue
- **Context banner** updates properly when the queue changes
- **Local library** now shows all tracks instead of being capped at 50

## Resolver Blocklist

Report and block bad source matches without disabling an entire resolver.

- **Blocklist specific results** — flag individual bad matches from the context menu
- Blocklisted results are skipped during future resolution without affecting other tracks from the same resolver

## Build & Update

- Auto-updater manifest files now included in build artifacts and releases
- Suppressed spurious auto-updater error toast on startup

---

**Full changelog:** `git log v0.7.0-alpha.2..v0.7.0-alpha.3`
