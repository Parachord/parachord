# 🎯 Harmonix Desktop - Future Enhancements TODO

> **Comprehensive TODO list compiled from all documentation**
> Last updated: 2026-01-30

---

## 🎵 Playback & Queue Management

### High Priority
- [x] **Shuffle mode** - Randomize queue order
- [ ] **Repeat modes** - Repeat one, repeat all, no repeat
- [ ] **Gapless playback** - No pause between tracks
- [ ] **Crossfade** - Fade between tracks (configurable duration)
- [ ] **Context menus** - Right-click menus for tracks, albums, playlists (add to queue, add to playlist, etc.)


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
- [ ] **Animations & transitions** - Smooth page transitions
- [ ] **Themes** - Light/dark mode toggle
- [ ] **Custom themes** - User-created color schemes

### Navigation
- [ ] **Mini-player mode** - Compact player view

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

---

## 🔍 Resolver & Search Features

### Bandcamp
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
- ✅ Virtualized queue with scheduler integration - Efficient rendering with viewport-based resolution
- ✅ Fixed virtualized queue for large lists - Correct handling of 1000+ track queues

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
- ✅ Viewport-prioritized album art loading - Visible albums load first in parallel batches
- ✅ Album art passed to release page - Use cached art instead of re-fetching
- ✅ Album info propagation - Album metadata flows from resolvers to track display
- ✅ Improved error handling with retry - Exponential backoff for network failures

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
- ✅ Spotify auto-launch - Automatically launch Spotify when needed for playback
- ✅ Spotify auto-fallback - Seamless fallback when device unavailable
- ✅ Plugin marketplace remote fetch - Fetch plugins from remote marketplace
- ✅ Plugin auto-sync with marketplace - Automatically sync plugins on startup
- ✅ Plugins architecture refactor - Moved plugins to separate repo as submodule
- ✅ Bandcamp playback improvements - Event listener timing and next button fixes

### Scrobbling
- ✅ Last.fm scrobbling - Track listening history
- ✅ ListenBrainz scrobbling
- ✅ Libre.fm scrobbling
- ✅ Scrobble spec compliance - Enforce 30s minimum listen time per Last.fm/ListenBrainz spec
- ✅ Listening history cache updates - Update cache when scrobbling new tracks

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
- ✅ Reduced header padding on Search and Settings pages
- ✅ Close button on Settings page header
- ✅ Volume controls only for enabled content resolvers - Hide irrelevant volume sliders

### Friends & Social
- ✅ Friends list with Last.fm and ListenBrainz support
- ✅ Friends sidebar with pinned friends and on-air indicators
- ✅ Friend mini-playbar showing current track
- ✅ Listen Along mode - sync playback with friends
- ✅ Spinoff mode - radio-like playback of similar tracks
- ✅ Auto-pin/unpin friends based on activity
- ✅ Friend collection page with hex avatars
- ✅ Context banners for Listen Along and Spinoff sessions
- ✅ Now playing status - See what friends are listening to
- ✅ Resolution scheduler integration - Friends sidebar uses scheduler for track resolution
- ✅ Spinoff/Listen-Along scheduler contexts - Proper abort handling when switching modes
- ✅ Async image resolution for friend top albums - Background loading for album art

### Architecture
- ✅ WebSocket support - Real-time updates
- ✅ Resolution scheduler architecture - Centralized viewport-based resolution with contexts
- ✅ useResolutionScheduler hook - React integration for scheduler
- ✅ AbortSignal support for resolution - Cancel pending resolutions on context change
- ✅ Batch completion support - Efficient handling of multiple track resolutions
- ✅ Playback lookahead - Pre-resolve upcoming tracks in queue

### Power User Features
- ✅ Advanced search - Boolean operators, filters

### Library Sync
- ✅ Spotify library sync - Sync tracks, albums, artists, playlists from Spotify
- ✅ Sync setup modal - Configure what to sync with visual feedback
- ✅ Playlist ownership filter - Filter between owned/following playlists during sync
- ✅ Preserve Spotify dates - Use original added_at dates for synced content
- ✅ Collection loading skeletons - Loading states for Collection tabs and counts
- ✅ Artist bio loading fix - Proper skeleton loading before bio fetch completes
- ✅ Background sync timer - Auto-sync every 15 minutes
- ✅ Sync status modal - Quick view of sync progress with close button
- ✅ Stop syncing flow - Keep/remove option for synced content
- ✅ Playlist update detection - Track changes to synced playlists
- ✅ Collection ID alignment - Consistent ID generation between sync providers
- ✅ Collection track list scheduler integration - Viewport-based resolution for collection view

### Performance
- ✅ Virtualized queue drawer - Handle large tracklists efficiently
- ✅ Resolution scheduler - Viewport-based track resolution with priority queue
- ✅ Viewport-prioritized album art loading - Parallel batches for visible albums, sequential for background
- ✅ Caching for listening history and top tracks - Reduce API calls
- ✅ Recommendations caching with pre-populated artist images

### UI Design
- ✅ Cinematic Light design - Applied to modals and dialogs
- ✅ Tooltip component - With Cinematic Light styling
- ✅ Album grid hover buttons - Play/queue action buttons on hover
- ✅ Enlarged artist grids - With hover overlay play buttons
- ✅ Refined Critics Picks layout - List layout with synopses
- ✅ Add-to-playlist flyout - Multi-select and filtering
- ✅ Quick search improvements - Hover controls and more results page
- ✅ Playbar resolver selector - Dropdown with album art
- ✅ Muted resolver icon colors - Subtler appearance in queue
- ✅ Browser extension popup styling - Aligned with main app aesthetic
- ✅ Browser extension dynamic buttons - Button text changes based on page type (track, album, playlist)
- ✅ Browser extension "Play Next" for collections - Albums/playlists insert at position 1 instead of end of queue
- ✅ Spotify playlist URL lookup - Supports all playlists via browser extension (API for user playlists, DOM scraping fallback for editorial playlists)
- ✅ Generative artist placeholders - Unique patterns instead of generic purple
- ✅ Smooth transitions for sidebar friend list - Animated friend list updates
- ✅ Playlist detail card styling - Refined to match grid view
- ✅ Sync update banner redesign - Matches app aesthetic
- ✅ Release page card treatment - Matches artist page styling
- ✅ Three-state pattern for artist image loading - Proper loading states
- ✅ Browser extension Add to Friends - Add Last.fm/ListenBrainz friends from user profile pages

### 2026-01-30 Completed
- ✅ Unified Plug-Ins page - Combined Installed and Marketplace tabs into single page
- ✅ Plugin filter dropdown - Filter by All/Installed/Available
- ✅ Plugin visual states - Installed (checkmark), available (faded with download arrow), needs config (! badge)
- ✅ Extensions section - New category on Plug-Ins page for browser extension
- ✅ Browser extension info modal - Installation instructions for developer mode
- ✅ Plugin architecture description - Restored explanatory text from old Marketplace tab
- ✅ SoundCloud logo fix - Replaced complex SVG path with simple rect elements
- ✅ Browser extension repo - Created dedicated repo with README at Parachord/parachord-browser-extension
- ✅ Browser extension releases link - Settings page links to GitHub releases

### 2026-01-29 Completed
- ✅ Embedded web player - Dual-mode player (standalone + Parachord-connected)
- ✅ Smart link generator tool - Generate shareable links for tracks/albums
- ✅ Spotify embed improvements - Correct format and height for embedded player
- ✅ Parachord URL resolution in embed - Resolve actual service URLs when connected
- ✅ Embed URL caching - Cache resolved URLs after Parachord disconnects
- ✅ Spotify auth error dialog - Show error when Spotify authentication fails
- ✅ Fallback Last.fm API keys - Default keys for fresh installs
- ✅ Spotify bring-your-own-key - Fallback credentials and user API key support
- ✅ Last.fm user API key support - Use user-configured API key when available
- ✅ SoundCloud bring-your-own-key - User API key configuration
- ✅ Last.fm/Libre.fm auth polling - Auto-detect authentication completion
- ✅ electron-updater optional - Make module optional for development builds
- ✅ Album art click fix - Prevent images from intercepting click events

### 2026-01-27 Completed
- ✅ Shuffle mode - Randomize queue order with restore functionality
- ✅ Collection Station shuffle - Shuffle entire collection from one button
- ✅ Shuffle disabled in special modes - Auto-disable in spinoff and listen-along
- ✅ YouTube playback fix - Prevent tracks from immediately auto-advancing
- ✅ Queue drawer scrollbar styling - Consistent scrollbar appearance
- ✅ Apple Music playlist scraper - Improved with JSON-LD extraction
- ✅ First-run tutorial - Interactive setup experience for new users
- ✅ Tutorial theme matching - Aligned with app's light cinematic theme
- ✅ Browser extension SoundCloud support - Scrape tracks, playlists, artist pages
- ✅ Browser extension Pitchfork scrapers - Album and track review extraction
- ✅ Browser extension MusicBrainz lookup - Find MBIDs from Pitchfork reviews
- ✅ Browser extension Bandcamp improvements - DOM scraping for tracks, albums, playlists
- ✅ Parachord wordmark SVG - Updated to scalable vector component
- ✅ Wikipedia logo SVG fix - Corrected logo rendering
- ✅ Marketplace IPC handlers - Exposed in preload.js for plugin system

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

**Total Features: 160+**
**Completed: 80+**
**Remaining: 80+**

*This TODO is a living document. Add, remove, or reprioritize as needed!* 🎵
