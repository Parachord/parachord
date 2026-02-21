# Parachord

https://parachord.com

A modern multi-source music player inspired by [Tomahawk](https://github.com/tomahawk-player/tomahawk). Play music from Spotify, YouTube, Bandcamp, SoundCloud, local files, and more - all in one unified interface.

![Parachord Screenshot](assets/artist-page2.png)

## Features

### Multi-Source Playback
- **Unified Library** - Search and play from multiple services simultaneously
- **Smart Resolution** - Automatically finds the best available source for each track, with incremental results as resolvers respond
- **Source Priority** - Drag to reorder which services are preferred
- **Volume Normalization** - Balance loudness between different sources
- **Buy Links** - Bandcamp and Qobuz purchase buttons surfaced for any track, even when streaming from a different source

### Supported Sources
- **Spotify** - Full Spotify Connect integration with remote playback (Premium required)
- **Apple Music** - Full playback via native MusicKit on macOS or MusicKit JS on other platforms (subscription required)
- **YouTube** - Stream audio from YouTube videos
- **Bandcamp** - Browse, play, and purchase from independent artists
- **SoundCloud** - Stream from SoundCloud's catalog
- **Local Files** - Scan and play your local music library with metadata extraction


### AI Companion
- **Shuffleupagus** - Built-in AI DJ that can recommend music, generate playlists, and control playback
- **Multiple AI Backends** - Choose from ChatGPT, Claude, Google Gemini, or Ollama (local/offline)
- **MCP Server** - Exposes playback and queue controls to external AI agents like Claude Desktop via the Model Context Protocol

### Library Sync
- **Import from Streaming Services** - Sync your playlists and liked songs from Spotify, Apple Music, and more
- **Collection Management** - Build a unified collection from multiple sources
- **Favorites** - Star tracks to add them to your collection
- **Sync Safety** - Mass-removal safeguard detects and blocks bulk deletions to prevent accidental data loss

### Artist Discovery
- **Rich Artist Pages** - Browse full discographies powered by MusicBrainz, with biographies from Wikipedia and Discogs
- **Related Artists** - Discover similar artists via Last.fm
- **Album Art** - High-quality artwork from Cover Art Archive
- **Release Filtering** - Filter by albums, EPs, singles, live releases, and compilations
- **Charts** - Browse top albums and songs from iTunes and Last.fm, filterable by country

### Playlists & Queue
- **URL Import** - Paste Spotify, Apple Music, or hosted .xspf playlist URLs
- **File Import** - Load local .xspf playlist files
- **Export** - Save your queue as an .xspf playlist
- **Queue Management** - Add tracks, reorder, and manage your listening queue
- **Shuffle & Spinoff** - Shuffle your queue, or "spinoff" from any track into a radio station of similar music
- **Mixed-Source Queues** - Seamlessly play tracks from different services
- **Resolver Blocklist** - Report and block bad source matches without disabling an entire resolver

### Plug-in Architecture
- **Sandboxed Execution** - Plug-ins run securely isolated from your system
- **Marketplace** - Browse and install plug-ins from the built-in marketplace
- **.axe Format** - Simple JSON-based plug-in format for content resolvers, meta services, and AI backends
- **Hot Reload** - Develop and test plug-ins without restarting

### Browser Extension
- **Send to Parachord** - Right-click any song link to send it to the desktop app
- **Page Detection** - Green badge indicator when the current page is a supported playlist or album
- **Import Playlists & Albums** - Scrape Spotify, Apple Music, Bandcamp, SoundCloud, and YouTube pages directly into your queue
- **WebSocket Communication** - Real-time connection between browser and desktop app

### Social Features
- **Friend Activity** - See what your friends are listening to in real-time via Last.fm and ListenBrainz
- **Listen Along** - Join a friend's listening session in near-real-time
- **Listening History** - Browse your play history and track your activity

### Additional Features
- **Global Search** - Search across all sources with unified results
- **Collection View** - Browse your aggregated music collection
- **Recommendations** - Personalized suggestions via Last.fm, ListenBrainz Weekly Jams, and AI
- **Scrobbling** - Track your listening history with Last.fm, ListenBrainz, and Libre.fm
- **Smart Links** - Generate shareable cross-service links for any track
- **Deep Links** - `parachord://` protocol for opening artists, albums, playlists, and search from other apps
- **Application Menu** - Full menu bar with keyboard shortcuts
- **Auto-Updates** - Automatic update checking with GitHub Releases
- **Configurable Media Keys** - Control media key behavior when Spotify is running

## System Requirements

### macOS
- **macOS 12 (Monterey)** or later
- 64-bit Intel or Apple Silicon
- Apple Music integration via the native MusicKit helper requires **macOS 14 (Sonoma)** and Xcode Command Line Tools; without it, Parachord falls back to web-based APIs

### Windows
- **Windows 10** or later
- x64 or arm64

### Linux
- **Ubuntu 18.04+**, **Debian 10+**, **Fedora 32+**, or equivalent
- x64
- PulseAudio or PipeWire (for audio output)

### Building from Source
- **Node.js 20** (LTS)
- A C/C++ toolchain for native addon compilation (`better-sqlite3`):
  - macOS: Xcode Command Line Tools
  - Windows: Visual Studio Build Tools with C++ workload
  - Linux: `build-essential` and `python3`

See [docs/setup/SYSTEM_REQUIREMENTS.md](docs/setup/SYSTEM_REQUIREMENTS.md) for full details including network requirements and Linux sandbox dependencies.

## Installation

### Download
Download the latest release for your platform from the [Releases](https://github.com/Parachord/parachord/releases) page:
- **macOS**: `.dmg` or `.zip`
- **Windows**: `.exe` installer or portable
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

### Build from Source

```bash
# Clone the repository
git clone https://github.com/Parachord/parachord.git
cd parachord

# Install dependencies
npm install

# Start the app
npm start
```

## Configuration

### Spotify Setup
1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Copy `.env.example` to `.env`
3. Add your Spotify Client ID and Secret
4. Add `http://localhost:8888/callback` to your Redirect URIs
5. Restart the app and connect via Settings > Installed Plug-Ins > Spotify

### Last.fm Setup
1. Create an API account at https://www.last.fm/api/account/create
2. Add your API key in Settings > Installed Plug-Ins > Last.fm

### Local Files
1. Go to Settings > Installed Plug-Ins > Local Files
2. Add folders containing your music
3. The app will scan and index your library automatically

## Architecture

```
parachord/
├── app.js                 # React application (single-file)
├── main.js                # Electron main process
├── preload.js             # Electron preload script (IPC bridge)
├── index.html             # Application shell
├── resolver-loader.js     # Plug-in system loader
├── local-files/           # Local music library module
│   ├── scanner.js         # Directory scanner
│   ├── metadata-reader.js # ID3/audio metadata extraction
│   ├── database.js        # SQLite music database
│   └── watcher.js         # File system watcher
├── resolvers/             # Content resolver plug-ins (.axe)
├── parachord-extension/   # Browser extension source
└── .github/workflows/     # CI/CD pipeline
```

### Plug-in System

Parachord uses a plug-in architecture with two types:

**Content Resolvers** - Find and play music from services
- Implement `search(query)` and `resolve(artist, track, album)`
- Return playable stream URLs or embed codes
- Examples: Spotify, YouTube, Bandcamp, SoundCloud

**Meta Services** - Provide metadata and recommendations
- Implement service-specific APIs for artist info, recommendations, scrobbling
- Examples: Last.fm, ListenBrainz, MusicBrainz

Plug-ins use the `.axe` format - a JSON file containing metadata and JavaScript implementation. See `docs/architecture/AXE_FORMAT_SPEC.md` for details.

## Tech Stack

- **Electron** - Desktop application framework
- **React 18** - UI framework (via CDN, no build step)
- **Tailwind CSS** - Utility-first styling (via CDN)
- **SQLite** - Local music library database (via better-sqlite3)
- **Express** - OAuth callback server for Spotify
- **WebSocket** - Real-time communication with browser extension
- **electron-updater** - Auto-update functionality

## Development

```bash
# Run in development mode with DevTools
npm run dev

# Build for distribution
npm run build:mac    # macOS (.dmg, .zip)
npm run build:win    # Windows (.exe, portable)
npm run build:linux  # Linux (.AppImage, .deb, .rpm)
```

### CI/CD

The project uses GitHub Actions for automated builds on all platforms. Builds are triggered on:
- Push to main/master branches
- Pull requests to main/master
- Version tags (v*)

Tagged releases automatically create draft GitHub Releases with all platform artifacts.

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| New Playlist | Cmd/Ctrl+N |
| Find/Search | Cmd/Ctrl+F |
| Play/Pause | Space |
| Next Track | Cmd/Ctrl+Right |
| Toggle Shuffle | Cmd/Ctrl+S |

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Credits

- [Tomahawk](https://github.com/tomahawk-player/tomahawk) - Original inspiration
- [MusicBrainz](https://musicbrainz.org/) - Music metadata
- [Cover Art Archive](https://coverartarchive.org/) - Album artwork
- [Last.fm](https://www.last.fm/) - Recommendations and scrobbling

---

**Parachord** - Your music is everywhere but you shouldn't have to be.
