# 🎯 Parachord - Feature Roadmap

> **Major features and enhancements**
> Last updated: 2026-02-12

---

## 🔥 High Priority

### Resolvers
- [ ] **Tidal resolver** - Hi-res streaming
- [ ] **Deezer resolver** - Additional streaming source
- [ ] **Qobuz full streaming** - User authentication


### Playlists
- [ ] **Smart playlists** - Auto-generate from listening history, smarterplaylists

---

## 🎯 Medium Priority

### Library
- [ ] **Import/export library** - Backup and restore

### Social
- [ ] **Collaborative playlists** - Multi-user editing
- [ ] **Listening parties** - Synchronized group listening

### Accessibility & UX
- [ ] **Themes** - Light/dark mode toggle

### Artist Pages
- [x] **Tour Dates/Tickets** - bandsintown/songkick (Concerts tab in Discover section)

---

## 💡 Future Considerations

### Platform & Distribution
- [ ] **Mobile apps** - iOS/Android
- [ ] **DMG installer background** - Custom background with drag arrow for Applications

### Playback
- [ ] **Repeat modes** - Repeat one, repeat all, no repeat
- [ ] **Gapless playback** - Seamless track transitions
- [ ] **Crossfade** - Configurable fade between tracks
- [ ] **Lyrics display** - Synced lyrics from LRC files
- [ ] **Equalizer** - Adjustable EQ bands
- [ ] **Sleep timer** - Auto-stop after duration

### Advanced Features
- [ ] **Backend server** - Optional server for advanced features
- [ ] **Discord Rich Presence** - Show now playing
- [ ] **Community features** - matrix.org

### Developer
- [ ] **TypeScript migration** - Type safety

---

## 🔧 Maintenance

- [ ] **Rotate MusicKit .p8 key** - Old key (`437JVHZMMK`) exposed in git history; revoke in Apple Developer Portal, generate new key, update `MUSICKIT_PRIVATE_KEY` GitHub secret and key ID in `main.js`

---

## 🐛 Known Issues

- [ ] **Bandcamp autoplay** - Embedded player autoplay unreliable
- [ ] **Apple Music playlist extraction** - `serialized-server-data` parsing incomplete

---

## ✅ Completed Features

### Core (v0.1.x)
- Track resolution & multi-source playback
- Resolution scheduler with viewport prioritization
- MusicBrainz artist/album pages with bios
- Search with fuzzy matching and filters
- Album art caching and lazy loading
- Data portability of music data & playlists (in and out)

### Plug-Ins (content resolvers and metadata providers)
- Spotify Connect, YouTube, Bandcamp, Qobuz, SoundCloud
- Apple Music (search only), Wikipedia, Discogs
- Local files resolver (scan user's music folder)
- Plugin system (.axe format) with marketplace
- Ship all resolvers as .axe files; marketplace cache overrides shipped versions
- Hot-reload and auto-sync

### Playback
- Seamless transitioning of mixed source playback, queuing and playlisting
- Standard transport controls (prev/next/play/pause/shuffle) that work consistently across all playback sources (even those like YT that playback in browser)
- Apple Music embedded playback with play/pause and seeking controls
- Apple Music switched to SystemMusicPlayer with proper system volume monitoring
- Volume normalization settings persisted between launches
- Fixed Spotify/Apple Music phantom auto-play on pause (polling stopped)
- "Top Loader" Queue with virtualization and option to save queue between sessions
- "Spinoff" radio station from currently playing song while saving queue for when you return
- Media Key support
- Quick Look artist bio tooltip
- Background pre-resolution for collection and playlist tracks
- Persist resolved sources to collection/playlists for faster playback
- Improved Apple Music end-of-track detection with auto-advance
- Resolver fallback when primary resolver playback fails
- Collection Radio via AI and protocol URL

### AI DJ (Shuffleupagus)
- Conversational AI assistant for music control and discovery
- Natural language commands: "play something chill", "skip this", "add to queue"
- Tool-based architecture with search, play, queue, shuffle, create_playlist
- Claude and Ollama provider support with pluggable backend architecture
- Rich context injection (now playing, queue, listening history, friends)
- Clickable ChatCards for tracks, albums, artists, and playlists in responses
- Recommendation blocklist ("don't recommend X anymore")
- Per-provider chat history persistence
- Progress indicators for tool execution

### Protocol URLs & External Control
- `parachord://` deep link protocol for external app integration
- Playback control URLs: play, pause, skip, queue, shuffle, collection-radio
- Navigation URLs: artist pages, albums, library, search, settings
- AI chat URL with prompt parameter
- HTTP endpoint (port 8888) for apps that can't use custom protocols
- Raycast extension with full playback control, search, AI chat, Collection Radio
- Raycast Extension discovery UI in Settings and Home page

### Playlists
- Drag/drop/import of Spotify, Apple Music and hosted .XSPF playlists
- AI/Prompted Playlists via ChatGPT and/or Google Gemini
- Two-way playlist sync with Spotify (tracks added/removed in Parachord sync back to Spotify)
- Manage/edit playlists
- Export playlists (as .xspf files)

### Scrobbling & Social
- Last.fm, ListenBrainz, Libre.fm scrobbling
- Imported Friends/Curators with detailed profiles, recently playing and charts for each
- Active Friends appear in sidebar with now playing info (or pin friends to always be in sidebar)
- Auto-unpin friends from sidebar when they stop listening (unless manually pinned)
- Listen Along to friends in almost-real-time (via Last.fm and Listenbrainz data)
- Fixed listen-along auto-resuming playback when user explicitly paused
- Friend pinning: drag-drop reorder and Save & Unpin cleanup

### Home Page
- Dynamic home page of personlized content - both of stuff you love and stuff you may love

### Artist Pages
- Filterable discography (including studio albums, singles, compilations and live recordings)
- Artist image
- Artist bio and background (via Wikipedia, Discogs and MusicBrainz)
- Related Artists (via Last.fm and ListenBrainz)
- Artist Top Tracks "radio"

### Library & History
- Spotify library sync (tracks, albums, artists, playlists)
- Background sync with update detection
- Shuffle mode with Collection Station
- Personal charts (over varying time frames), listening history
- Persist library to disk for offline access

### Discovery
- Charts tabs (Albums/Songs) with iTunes, Last.fm, and Apple Music sources
- Last.fm Charts with country/genre filtering and Global option
- Apple Music top songs chart with country/region support
- Recommendations (Artists/Albums) with Last.fm and Listenbrainz sources
- Weekly Jam playlists (this week & last) via ListenBrainz
- Critically acclaimed albums (aggregated and filtered editorial reviews from across the web)

### UI/UX
- Cinematic Light design system
- First-run tutorial with fresh install UX overhaul (canonical resolver order, proper state management)
- In-app drag/drop of objects to playbar, queue and playlists
- Full keyboard navigation with shortcuts
- Skeleton loading animations in History tabs
- Advanced Settings UI for Apple Music developer token
- Inline error states for Charts and Critics Picks (replaced modal dialogs)
- Home page: Songs card and improved AI card

## Web
- Embedded web player with smart links
- Browser extension for one-click imports and YT playback control
- Parchord.com website

### Platform
- macOS build with Apple Silicon support
- Linux builds (.deb, .rpm, AppImage)
- Auto-updates via Electron auto-updater
- macOS dock icon properly renders without gray outline (square SVG source)
- Icon generation scripts for all platforms
- DMG installer with Applications folder icon

### Smart Links (v0.7.x)
- Publish Smart Links from context menu — shareable web pages for any track
- Cloudflare Workers backend with KV storage at go.parachord.com
- Embedded player with WebSocket connection to Parachord desktop app ("Play in Parachord")
- Apple Music support in smart links
- Official service logos (Spotify, YouTube, SoundCloud, Apple Music, Bandcamp)
- Copy Embed Code for embedding smart link players in websites
- Auto-copy link URL to clipboard on publish

### MCP Server (v0.7.x)
- MCP server for Claude Desktop integration (playback control, search, queue management)
- stdio bridge for Claude Desktop compatibility
- One-click Claude Desktop setup in General settings

### AI DJ Improvements (v0.7.x)
- "Share my data" toggle gates ALL personal data (now playing, queue, collection, history, playlists, friends) — off by default
- AI prompts user to enable data sharing when needed (e.g. "what's playing?", "add similar songs")
- Toggle visible to all users (not just scrobbler users)
- Fixed first song playing twice when AI queues multiple tracks (dedup in queue_add + system prompt fix)
- "Surprise Me" button gated on data sharing toggle

### Auth & API Management (v0.6.x–v0.7.x)
- Spotify OAuth migrated to PKCE flow (no client secret needed)
- Spotify BYOK mandatory — each user registers their own Spotify Developer app (bypasses 5-user dev mode limit)
- Rate limit detection (HTTP 429) with debounced BYOK toast for Last.fm and SoundCloud
- MusicKit private key moved from repo to CI secrets (injected at build time)
- SoundCloud fallback API credentials for out-of-box OAuth
- SoundCloud advanced config restored for optional BYOK API credentials
- API credential fields masked with password input type
- Spotify library sync migrated to unified /me/library endpoints (Feb 2026 API)

### Stability & Performance (v0.7.x)
- Parallelized app startup for faster launch
- Fixed track resolver constantly re-resolving cached tracks
- Validate auth tokens when restoring saved resolver settings
- Handle denied MusicKit auth gracefully; removed Spotify from default resolver order
- Prevent resolvers from vanishing when in resolverOrder but not yet loaded
- Activate Swift helper to foreground before requesting Apple Music auth
- Increased Apple Music authorization timeout
- Fixed Apple Music pause not working after source switching
- Fixed friend unpinning bug (stale closures in polling)
- Pinned userData path before setting app.name to prevent data loss
- Fixed MusicKit auth dialog showing "appName" instead of "Parachord"
- Fixed update error toast showing "undefined"
- Fixed app menu name from "parachord-desktop" to "Parachord"
- Auto-updater now finds pre-release builds
- SoundCloud credential error toast only shows when fallback also fails

### Social (v0.7.x)
- Friends section always visible in sidebar for discoverability

### Security (v0.6.x)
- Comprehensive security and code review
- Fixed critical, high, and medium severity vulnerabilities
- MusicKit .p8 key removed from git tree, injected via GitHub Actions secret

## Development
- Automated CI/CD pipeline
- Automated builds for Mac/Windows/Linux
- CI artifact names include version to prevent confusion
- MusicKit key injected from `MUSICKIT_PRIVATE_KEY` GitHub secret during CI builds
- Jest tests for charts utilities and comprehensive AI/chat test suite (130 tests)
- Auto-updates enabled (publish releases as non-draft)
- Reverse sync workflow from dedicated plugin/extension repos to monorepo

---

*See git history for detailed changelog*
