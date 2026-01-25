# 🎯 Harmonix Desktop - Future Enhancements TODO

> **Comprehensive TODO list compiled from all documentation**
> Last updated: 2025-01-24

---

## 🎵 Playback & Queue Management

### High Priority
- [ ] **Shuffle mode** - Randomize queue order
- [ ] **Repeat modes** - Repeat one, repeat all, no repeat
- [ ] **Gapless playback** - No pause between tracks
- [ ] **Crossfade** - Fade between tracks (configurable duration)
- [ ] **Context menus** - Right-click menus for tracks, albums, playlists (add to queue, add to playlist, etc.)

### Nice to Have
- [ ] **Queue history** - See previously played tracks

---

## 📋 Playlist Features

### High Priority
- [ ] **Import from Spotify/Apple Music** - Convert external playlists to XSPF

### Medium Priority
- [ ] **Playlist metadata editing** - Change title, creator, description
- [ ] **Duplicate playlist** - Copy existing playlists
- [ ] **Share via link** - Generate shareable links
- [ ] **Collaborative playlists** - Multi-user editing
- [ ] **Playlist folders** - Organize playlists into categories

### Advanced Features
- [ ] **Smart playlists** - Auto-generate from listening history
- [ ] **Similar artist recommendations** - Auto-add related tracks
- [ ] **Mood-based curation** - AI-powered playlist generation
- [ ] **Virtual scrolling** - Handle 1000+ track playlists efficiently
- [ ] **Scroll position memory** - Remember where user was in long playlists
- [ ] **Scroll indicators** - Visual feedback for scroll position
- [ ] **Jump to top/bottom** - Quick navigation buttons

---

## 🎨 UI/UX Improvements

### Visual Enhancements
- [ ] **Implement Jordi's designs** - Update aesthetic to match new design specs
- [ ] **Hi-Res quality badges** - Show "Hi-Res" indicator for Qobuz tracks
- [ ] **Animations & transitions** - Smooth page transitions
- [ ] **Themes** - Light/dark mode toggle
- [ ] **Custom themes** - User-created color schemes

### Navigation
- [ ] **Breadcrumb navigation** - Show path in artist → album flow
- [ ] **Recent history** - Quick access to recently viewed pages
- [ ] **Search history** - Save recent searches
- [ ] **Favorites/bookmarks** - Mark favorite artists/albums
- [ ] **Mini-player mode** - Compact player view
- [ ] **Remove resolver toggles from sidebar** - Clean up sidebar UI

### Accessibility
- [ ] **Keyboard shortcuts** - Full keyboard navigation
- [ ] **Screen reader support** - Improve ARIA labels
- [ ] **High contrast mode** - Accessibility theme
- [ ] **Font size controls** - User-adjustable text size

---

## 🎤 Artist & Album Pages

### Artist Pages
- [ ] **Preview on hover** - 30-second previews
- [ ] **Better single matching** - Smarter search for singles
- [ ] **More metadata** - Record labels, genres, bio

### Album Pages
- [ ] **Liner notes** - Show album credits, producers
- [ ] **Release variants** - Show different editions
- [ ] **Track credits** - Individual track contributors
- [ ] **Album reviews** - Aggregate review scores

### Discover Page
- [ ] **Add Uncoveries** - Integrate Uncoveries content into Discover page

---

## 🔍 Resolver & Search Features

### Bandcamp
- [ ] **Album art scraping** - Parse image URLs from search results
- [ ] **Backend proxy** - Avoid CORS, cache results
- [ ] **Bandcamp Daily integration** - Featured artists/albums
- [ ] **Collection integration** - Login, show purchases
- [ ] **Direct streaming** - Play Bandcamp tracks (if API allows)
- [ ] **Debug embedded player autoplay** - Playback window opens but autoplay is unreliable (reports "paused" immediately after "playing"). Need to investigate Bandcamp's embedded player behavior and possibly adjust injection timing or use a different approach

### MusicBrainz
- [ ] **Lookup by MBID** - Auto-match on Spotify/YouTube
- [ ] **Cover Art Archive** - Show album art for results
- [ ] **Extended metadata** - Recording date, label, publisher
- [ ] **Smart matching** - Use MBIDs to cross-reference resolvers

### Qobuz
- [ ] **Full track streaming** - Implement user auth
- [ ] **Quality indicators** - Show bit depth/sample rate
- [ ] **Purchase links** - Link to buy tracks/albums
- [ ] **Favorites integration** - Sync with Qobuz account
- [ ] **Download purchased tracks** - Local storage

### Spotify
- [ ] **Spotify Web Playback SDK** - Full integration
- [ ] **User playlists** - Access Spotify playlists
- [ ] **Liked songs** - Show user's saved tracks
- [ ] **Recommendations** - Spotify's algorithm suggestions

### General Resolvers
- [ ] **SoundCloud resolver** - Add SoundCloud support
- [ ] **Apple Music playlist URL extraction** - WIP: The HTML is fetched successfully via proxyFetch but track extraction from `serialized-server-data` (base64-encoded JSON) isn't working. Need to investigate the actual data structure in the decoded JSON. See `resolvers/applemusic.axe` lookupPlaylist function.
- [ ] **Tidal resolver** - Hi-res streaming
- [ ] **Deezer resolver** - Another streaming option
- [ ] **Local files resolver** - Scan user's music folder

---

## 💾 Data & Library Management

### Library Features
- [ ] **Persist library to disk** - Save user's library
- [ ] **Import/export library** - Backup and restore
- [ ] **Tag editing** - Edit track metadata
- [ ] **Duplicate detection** - Find and merge duplicates
- [ ] **Library stats** - Charts, most played, etc.
- [ ] **Listening history** - Track play counts, timestamps

### Sync & Backup
- [ ] **Cloud sync** - Sync library across devices
- [ ] **Auto-backup** - Scheduled backups
- [ ] **Import from iTunes/Media Player** - Migrate existing libraries
- [ ] **Export to CSV** - Data portability

---

## 🎼 Playback Features

### Audio Processing
- [ ] **Equalizer** - Adjustable EQ bands
- [ ] **Audio effects** - Reverb, bass boost, etc.
- [ ] **Normalization** - Volume leveling
- [ ] **Spatial audio** - 3D audio effects
- [ ] **Lyrics display** - Synced lyrics (from LRC files)

### Playback Controls
- [ ] **Playback speed** - Adjust tempo
- [ ] **Pitch shift** - Change pitch without speed
- [ ] **A-B repeat** - Loop specific section
- [ ] **Sleep timer** - Auto-stop after duration
- [ ] **Fade in/out** - Volume fade on play/stop

---

## 👥 Social Features

### Friends & Sharing
- [ ] **Friends list** - Add/manage friends
- [ ] **Now playing status** - See what friends are listening to
- [ ] **Share tracks** - Send tracks to friends
- [ ] **Collaborative playlists** - Edit playlists together
- [ ] **Listening parties** - Synchronized group listening

### Discovery
- [ ] **Friend activity feed** - See recent friend activity
- [ ] **Recommendations from friends** - Suggested tracks
- [ ] **Public profiles** - Shareable music taste profiles
- [ ] **Top tracks/artists** - Personal listening stats

---

## 🔧 Technical Improvements

### Performance
- [ ] **Virtual scrolling** - For large lists (1000+ items)
- [ ] **Offline mode** - Work without internet (cached content)
- [ ] **Service worker** - PWA capabilities

### Architecture
- [ ] **Database integration** - Use SQLite for local storage
- [ ] **Backend server** - Optional backend for advanced features
- [ ] **WebSocket support** - Real-time updates
- [ ] **Plugin system expansion** - More plugin capabilities
- [ ] **Auto-update** - Electron auto-updater
- [ ] **Re-implement title bar dragging** - Allow dragging app window by title bar

### Developer Experience
- [ ] **TypeScript migration** - Type safety
- [ ] **Unit tests** - Test coverage for core features
- [ ] **Integration tests** - E2E testing
- [ ] **Documentation site** - Hosted docs
- [ ] **Developer API** - Public API for third-party extensions

---

## 🌐 Platform & Distribution

### Cross-Platform
- [ ] **macOS build** - Apple Silicon support
- [ ] **Linux builds** - .deb, .rpm, AppImage
- [ ] **ARM support** - Raspberry Pi, ARM Macs
- [ ] **Mobile apps** - iOS/Android (React Native?)

### Distribution
- [ ] **Auto-updates** - Seamless version updates
- [ ] **Crash reporting** - Sentry integration
- [ ] **Usage analytics** - (Optional, privacy-respecting)
- [ ] **App Store distribution** - macOS App Store, Windows Store

---

## 📱 Advanced Features

### Integration
- [ ] **Discord Rich Presence** - Show now playing in Discord
- [ ] **System media controls** - OS-level play/pause
- [ ] **Global hotkeys** - System-wide shortcuts
- [ ] **Notifications** - Now playing notifications

### AI & Smart Features
- [ ] **Smart playlists** - ML-based recommendations
- [ ] **Mood detection** - Analyze track mood
- [ ] **BPM analysis** - Tempo detection for DJ features
- [ ] **Audio fingerprinting** - Identify unknown tracks
- [ ] **Genre classification** - Auto-tag genres

### Power User Features
- [ ] **Advanced search** - Boolean operators, filters
- [ ] **Batch operations** - Bulk edit metadata
- [ ] **Scripting support** - Automation via scripts
- [ ] **API webhooks** - Integration with other services
- [ ] **Custom visualizations** - Audio spectrum, waveforms

---

## 📊 Priority Matrix

### 🔥 High Priority (Next Sprint)
1. Shuffle & repeat modes
2. Keyboard shortcuts
3. Context menus (right-click)
4. Gapless playback
5. Crossfade

### 🎯 Medium Priority (Next Month)
1. Lyrics display
2. Listening history
3. Smart playlists
4. Browser extension for external playback control

### 💡 Future Considerations
1. Mobile apps
2. Collaborative features
3. AI recommendations
4. Advanced audio processing
5. Backend server

---

## ✅ Completed Features

*(Features already implemented)*

### Core Playback
- ✅ Track resolution & playback
- ✅ Next/previous track navigation
- ✅ Progress bar
- ✅ Volume control with mute toggle
- ✅ Spotify volume slider (with device-specific disable for unsupported devices)
- ✅ Always-visible playbar with empty state
- ✅ Condensed playbar layout (controls + track info on same row)
- ✅ Smart queue loading (only tracks after clicked position)
- ✅ Skip non-playable resolvers during resolution
- ✅ Track highlight preserved when playing from album view
- ✅ Fixed track skipping from stale browser events

### Queue Management
- ✅ Queue view UI - Show current queue in drawer
- ✅ Queue management - Add/remove/reorder tracks in queue
- ✅ Save queue as playlist - Convert current queue to permanent playlist
- ✅ Clear queue - Button to clear all queued tracks

### Playlists
- ✅ XSPF playlist support
- ✅ Import/export playlists
- ✅ Create playlists in-app
- ✅ Edit playlists - Add/remove/reorder tracks
- ✅ Delete tracks from playlists
- ✅ Drag & drop tracks - Reorder by dragging
- ✅ Drag and drop from album pages to playlists
- ✅ Scrollable album/playlist pages
- ✅ Playlist cover images with artist image fallback
- ✅ Smooth fade-in for playlist cover images
- ✅ Cover cache invalidation when tracks change

### Artist & Album Pages
- ✅ MusicBrainz artist pages
- ✅ Album art on artist pages
- ✅ Track listings on albums - Click album to see all tracks
- ✅ Full album playback - Play entire albums
- ✅ Album art caching - Remember loaded images
- ✅ Stay on page playback - Play without leaving artist view
- ✅ Artist bio - Fetch from Last.fm, Wikipedia, Discogs (with fallback)
- ✅ Bio source attribution - Show where bio came from
- ✅ Wikipedia/Discogs artist image fallbacks
- ✅ Similar artists - Show related artists from Last.fm
- ✅ Fix "Alls" typo on Discography - Should be "All"
- ✅ Critics Picks redesigned to list layout with synopses

### Search
- ✅ Search history - Save and display recent searches
- ✅ Search history with images - Artist/album/track images in history
- ✅ Clickable search history - Play tracks or navigate directly from history
- ✅ Fuzzy re-ranking with fuse.js
- ✅ Lucene query preprocessing with typed filters
- ✅ Fixed typeahead race condition with AbortController

### Resolvers
- ✅ Multi-resolver search
- ✅ Spotify Connect integration
- ✅ Bandcamp resolver
- ✅ Qobuz resolver
- ✅ YouTube resolver
- ✅ Apple Music resolver (search/lookup only, no playback)
- ✅ Resolver priority system
- ✅ Plugin system (.axe format)
- ✅ Hot-reload resolvers
- ✅ Resolver marketplace
- ✅ Wikipedia metaservice plugin
- ✅ Discogs metaservice plugin

### Scrobbling
- ✅ Last.fm scrobbling - Track listening history
- ✅ ListenBrainz scrobbling
- ✅ Libre.fm scrobbling

### UI/UX
- ✅ Album art throughout app - Fetch from Cover Art Archive
- ✅ Loading skeletons - Better loading states with shimmer animations
- ✅ Consistent resolver icons throughout app
- ✅ Request caching (artist data, images, album art with TTL)
- ✅ Image lazy loading
- ✅ Right-click context menu on now playing track
- ✅ Draggable album art to playlists from playbar
- ✅ Updated app icons and branding
- ✅ Fixed flash of default state on app load
- ✅ Sidebar separator under Search
- ✅ Reduced Settings button height

---

## 📝 Notes

### Implementation Guidelines

**When adding new features:**
1. Check if a skill exists (in `/mnt/skills/`)
2. Follow existing patterns (see album pages, playlist pages)
3. Add documentation to this TODO
4. Update CHANGELOG
5. Test across platforms

**Priority Criteria:**
- User impact (how many users benefit)
- Development time (quick wins vs. long-term)
- Dependencies (blocking other features)
- Technical debt (refactoring needs)

**Before Starting:**
- Review related documentation
- Check for similar implementations
- Consider backward compatibility
- Plan testing strategy

---

## 🤝 Contributing

Want to tackle any of these? Great!

1. Pick an unchecked item
2. Check if there's related documentation
3. Create a branch: `feature/[feature-name]`
4. Follow the code style
5. Add tests if applicable
6. Update this TODO when complete

---

## 📅 Roadmap

### Version 0.2.0 (Q1 2025)
- [x] Queue management UI ✅
- [x] Playlist creation/editing ✅
- [x] Search history ✅
- [x] Last.fm/ListenBrainz scrobbling ✅
- [x] Volume control fixes ✅
- [ ] Keyboard shortcuts
- [ ] Lyrics display

### Version 0.3.0 (Q2 2025)
- [ ] Browser extension for external playback control
- [ ] Smart playlists
- [ ] Collaborative features

### Version 1.0.0 (Q3 2025)
- [ ] Mobile apps
- [ ] Backend server
- [ ] Advanced audio features
- [ ] Full offline mode

---

**Total Features: 150+**
**Completed: 67+**
**Remaining: 83+**

*This TODO is a living document. Add, remove, or reprioritize as needed!* 🎵
