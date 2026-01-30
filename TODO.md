# 🎯 Parachord - Feature Roadmap

> **Major features and enhancements**
> Last updated: 2026-01-30

---

## 🔥 High Priority

### Resolvers
- [ ] **Tidal resolver** - Hi-res streaming
- [ ] **Deezer resolver** - Additional streaming source
- [ ] **Local files resolver** - Scan user's music folder
- [ ] **Qobuz full streaming** - User authentication


### Playlists
- [x] **Import from Spotify/Apple Music** - Convert external playlists
- [ ] **Smart playlists** - Auto-generate from listening history

---

## 🎯 Medium Priority

### Library
- [x] **Persist library to disk** - Save user's library
- [ ] **Import/export library** - Backup and restore
- [ ] **Listening history stats** - Charts, most played

### Social
- [ ] **Collaborative playlists** - Multi-user editing
- [ ] **Listening parties** - Synchronized group listening

### Accessibility & UX
- [x] **Keyboard shortcuts** - Full keyboard navigation
- [ ] **Themes** - Light/dark mode toggle

---

## 💡 Future Considerations

### Platform & Distribution
- [x] **macOS build** - Apple Silicon support
- [x] **Linux builds** - .deb, .rpm, AppImage
- [ ] **Mobile apps** - iOS/Android
- [x] **Auto-updates** - Electron auto-updater

### Playback
- [ ] **Repeat modes** - Repeat one, repeat all, no repeat
- [ ] **Gapless playback** - Seamless track transitions
- [ ] **Crossfade** - Configurable fade between tracks
- [ ] **Lyrics display** - Synced lyrics from LRC files
- [ ] **Equalizer** - Adjustable EQ bands
- [ ] **Sleep timer** - Auto-stop after duration

### Advanced Features
- [ ] **Offline mode** - Work without internet
- [ ] **Backend server** - Optional server for advanced features
- [ ] **Discord Rich Presence** - Show now playing
- [x] **AI recommendations** - ML-based playlist generation

### Developer
- [ ] **TypeScript migration** - Type safety
- [ ] **Unit tests** - Test coverage for core features

---

## 🐛 Known Issues

- [ ] **Bandcamp autoplay** - Embedded player autoplay unreliable
- [ ] **Apple Music playlist extraction** - `serialized-server-data` parsing incomplete

---

## ✅ Completed Features

### Core (v0.1.x)
- Track resolution & multi-resolver playback
- Queue management with virtualization
- XSPF playlist support with drag & drop
- MusicBrainz artist/album pages with bios
- Search with fuzzy matching and filters
- Album art caching and lazy loading

### Resolvers
- Spotify Connect, YouTube, Bandcamp, Qobuz, SoundCloud
- Apple Music (search only), Wikipedia, Discogs
- Plugin system (.axe format) with marketplace
- Hot-reload and auto-sync

### Scrobbling & Social
- Last.fm, ListenBrainz, Libre.fm scrobbling
- Friends list with Listen Along and Spinoff modes
- Real-time now playing status

### Library Sync
- Spotify library sync (tracks, albums, artists, playlists)
- Background sync with update detection

### UI/UX
- Cinematic Light design system
- Resolution scheduler with viewport prioritization
- Browser extension with multi-platform support
- First-run tutorial

### Recent (2026-01)
- Shuffle mode with Collection Station
- Unified Plug-Ins page
- Embedded web player with smart links
- Charts tabs (Albums/Songs) with iTunes and Last.fm sources
- 24-hour chart caching

---

*See git history for detailed changelog*
