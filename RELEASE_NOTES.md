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

**Full changelog:** `git log v0.7.0-alpha.15..v0.8.0-alpha.1`
