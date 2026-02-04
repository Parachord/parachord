# Parachord

A modern multi-source music player inspired by [Tomahawk](https://github.com/tomahawk-player/tomahawk). Play music from Spotify, YouTube, Bandcamp, SoundCloud, local files, and more - all in one unified interface.

![Parachord Screenshot](assets/artist-page.png)

## Features

### Multi-Source Playback
- **Unified Library** - Search and play from multiple services simultaneously
- **Smart Resolution** - Automatically finds the best available source for each track
- **Source Priority** - Drag to reorder which services are preferred
- **Volume Normalization** - Balance loudness between different sources

### Supported Sources
- **Spotify** - Full Spotify Connect integration with remote playback (Premium required)
- **YouTube** - Stream audio from YouTube videos
- **Bandcamp** - Browse and play from independent artists
- **SoundCloud** - Stream from SoundCloud's catalog
- **Qobuz** - High-quality audio streaming
- **Local Files** - Scan and play your local music library with metadata extraction
- **Apple Music** - Preview support

### Library Sync
- **Import from Streaming Services** - Sync your playlists and liked songs from Spotify, Apple Music, and more
- **Collection Management** - Build a unified collection from multiple sources
- **Favorites** - Star tracks to add them to your collection

### Artist Discovery
- **Rich Artist Pages** - Browse full discographies powered by MusicBrainz
- **Related Artists** - Discover similar artists via Last.fm
- **Album Art** - High-quality artwork from Cover Art Archive
- **Release Filtering** - Filter by albums, EPs, singles, live releases, and compilations

### Playlists & Queue
- **URL Import** - Paste Spotify, Apple Music, or hosted .xspf playlist URLs
- **File Import** - Load local .xspf playlist files
- **Export** - Save your queue as an .xspf playlist
- **Queue Management** - Add tracks, reorder, and manage your listening queue
- **Shuffle Mode** - Randomize your playback
- **Mixed-Source Queues** - Seamlessly play tracks from different services

### Plug-in Architecture
- **Sandboxed Execution** - Plug-ins run securely isolated from your system
- **Marketplace** - Browse and install plug-ins from the built-in marketplace
- **.axe Format** - Simple JSON-based plug-in format for content resolvers and meta services
- **Hot Reload** - Develop and test plug-ins without restarting

### Browser Extension
- **Send to Parachord** - Right-click any song link to send it to the desktop app
- **Bandcamp Integration** - Play Bandcamp pages directly in Parachord
- **YouTube Support** - Queue YouTube videos from your browser
- **WebSocket Communication** - Real-time connection between browser and desktop app

### Social Features
- **Friend Activity** - See what your friends are listening to in real-time
- **Add Friends** - Connect with other Parachord users
- **Listening History** - Track your listening activity

### Additional Features
- **Global Search** - Search across all sources with unified results
- **Collection View** - Browse your aggregated music collection
- **Recommendations** - Personalized suggestions via Last.fm
- **Scrobbling** - Track your listening history with Last.fm
- **Application Menu** - Full menu bar with keyboard shortcuts
- **Auto-Updates** - Automatic update checking with GitHub Releases
- **Configurable Media Keys** - Control media key behavior when Spotify is running
- **Dark Player Bar** - Modern UI with glassmorphism effects

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
