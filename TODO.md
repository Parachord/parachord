# 🎯 Parachord - Feature Roadmap

> **Major features and enhancements**
> Last updated: 2026-02-05

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
- [ ] **Tour Dates/Tickets** - bandsintown/songkick

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
- Hot-reload and auto-sync

### Playback
- Seamless transitioning of mixed source playback, queuing and playlisting
- Standard transport controls (prev/next/play/pause/shuffle) that work consistently across all playback sources (even those like YT that playback in browser)
- Apple Music embedded playback with play/pause and seeking controls
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
- First-run tutorial
- In-app drag/drop of objects to playbar, queue and playlists
- Full keyboard navigation with shortcuts
- Skeleton loading animations in History tabs
- Advanced Settings UI for Apple Music developer token

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

## Development
- Automated CI/CD pipeline
- Automated builds for Mac/Windows/Linux
- Jest tests for charts utilities

---

*See git history for detailed changelog*
