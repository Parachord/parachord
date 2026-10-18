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
- **Buy Links** - Bandcamp purchase buttons surfaced for any track that can be found, even when streaming from a different source

### Supported Sources
- **Spotify** - Full Spotify Connect integration with remote playback (Premium required)
- **Apple Music** - Full playback via native MusicKit on macOS or MusicKit JS on Windows and Linux (subscription required). Windows and Linux playback needs the Widevine CDM, which Parachord downloads on first launch (see [System Requirements](#system-requirements))
- **YouTube** - Stream audio from YouTube videos
- **Bandcamp** - Browse, play, and purchase from independent artists
- **SoundCloud** - Stream from SoundCloud's catalog
- **Local Files** - Scan and play your local music library with metadata extraction

### Plug-in Architecture
- **Sandboxed Execution** - Plug-ins run securely isolated from your system
- **Marketplace** - Browse and install plug-ins from the built-in marketplace
- **.axe Format** - Simple JSON-based plug-in format for content resolvers, meta services, and AI backends
- **Hot Reload** - Develop and test plug-ins without restarting

### AI Companion
- **Shuffleupagus** - Built-in AI DJ that can recommend music, generate playlists, and control playback
- **Multiple AI Backends** - Choose from ChatGPT, Claude, Google Gemini, Ollama (local/offline), or any OpenAI- or Anthropic-compatible endpoint via the Custom LLM plug-in (LM Studio, vLLM, llama.cpp, OpenRouter, ...)
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
- **Export** - Save any playlist, or the current queue, as an .xspf file
- **Queue Management** - Add tracks, reorder, and manage your listening queue
- **Shuffle & Spinoff** - Shuffle your queue, or "spinoff" from any track into a radio station of similar music
- **Mixed-Source Queues** - Seamlessly play tracks from different services
- **Resolver Blocklist** - Report and block bad source matches without disabling an entire resolver

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
- **Recommendations** - Personalized suggestions via Last.fm, ListenBrainz Weekly Jams, and AI (full inventory in [docs/features/RECOMMENDATIONS.md](docs/features/RECOMMENDATIONS.md); import and sync paths in [docs/features/PLAYLIST_IMPORT_AND_SYNC.md](docs/features/PLAYLIST_IMPORT_AND_SYNC.md))
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
- Full Apple Music playback needs Google's Widevine CDM, downloaded automatically on first launch (about 20 MB on disk)

### Linux
- **Ubuntu 18.04+**, **Debian 10+**, **Fedora 32+**, or equivalent
- x64
- PulseAudio or PipeWire (for audio output)
- Full Apple Music playback needs Google's Widevine CDM, downloaded automatically on first launch (about 20 MB on disk)

### Building from Source
- **Node.js 20 or newer** (CI builds on 20 and runs the tests on 22; the app itself runs on the Node 22 inside Electron 39)
- A C/C++ toolchain for native addon compilation (`better-sqlite3`):
  - macOS: Xcode Command Line Tools (also provides the Swift toolchain that `npm run build:mac` uses for the MusicKit helper)
  - Windows: Visual Studio Build Tools with C++ workload
  - Linux: `build-essential` and `python3`
- To VMP-sign a local build (optional, see below): Python 3 with `pip install castlabs-evs`

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

# Install dependencies (fetches castlabs Electron from GitHub, builds better-sqlite3)
npm install

# Start the app (the renderer bundle is built first, see Development)
npm start
```

Parachord is built on [castlabs Electron for Content Security](https://github.com/castlabs/electron-releases) (ECS), a fork of Electron with the Widevine CDM. It isn't on the npm registry, so `npm install` fetches it from castlabs' GitHub releases. Stock Electron has no Widevine, so DRM-protected services (Apple Music on Windows and Linux) can't play full tracks on it.

**If `npm start` says Electron failed to install or `node_modules/electron/dist` is missing**, the package's `postinstall` (which downloads the ~100 MB binary from castlabs' releases) did not run. The usual reasons: `ignore-scripts=true` in your npm config, `ELECTRON_SKIP_BINARY_DOWNLOAD` in the environment, or an install that skipped devDependencies (`NODE_ENV=production`, `--omit=dev`). Run it by hand and it says what went wrong:

```bash
node node_modules/electron/install.js
```

Locally built apps carry castlabs' development VMP signature. That's enough for Widevine's test servers, but Apple's licence server refuses it, so Apple Music on Windows and Linux plays only 30-second previews in a local build. Release builds get a production signature through [castlabs EVS](https://github.com/castlabs/electron-releases/wiki/EVS) in CI (see [CI/CD](#cicd)). To sign a local build yourself, create a free EVS account and run `python3 -m castlabs_evs.vmp sign-pkg dist/<platform-dir>` before code signing on macOS or after it on Windows.

## Architecture

```
parachord/
├── src/renderer/app.js    # React application (single file, no JSX) — the source
├── app.js                 # Generated renderer bundle (esbuild, gitignored; never edit)
├── main.js                # Electron main process
├── main-process/          # Main-process modules (IPC handlers, sync links)
├── preload.js             # Electron preload script (IPC bridge)
├── index.html             # Application shell (loads vendor/ scripts, then app.js)
├── vendor/                # React, Tailwind CSS build, fuse.js (committed, no CDN)
├── resolver-loader.js     # Plug-in system loader
├── plugins-src/<id>/      # Plug-in sources: manifest.json + implementation.js
├── plugins/               # Generated .axe files (node scripts/build-axes.js; never edit)
├── marketplace-manifest.json  # Plug-in catalog (versions generator-synced)
├── sync-providers/        # Spotify / Apple Music / ListenBrainz playlist sync
├── local-files/           # Local music library module
│   ├── scanner.js         # Directory scanner
│   ├── metadata-reader.js # ID3/audio metadata extraction
│   ├── database.js        # SQLite music database
│   └── watcher.js         # File system watcher
├── musickit-helper/       # Native MusicKit helper (Swift, macOS only)
├── scripts/               # Build scripts (renderer bundle, .axe generator, VMP signing, notarization)
├── tests/                 # Jest suites
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

Plug-ins use the `.axe` format - a JSON file containing metadata and JavaScript implementation. See `docs/architecture/AXE_FORMAT_SPEC.md` for details. The bundled `.axe` files are generated from `plugins-src/<id>/` (see [Development](#development)); community plug-ins live in [Parachord/parachord-plugins](https://github.com/Parachord/parachord-plugins).

## Tech Stack

- **castlabs Electron for Content Security** - Electron fork with the Widevine CDM, for DRM-protected streaming
- **React 18** - UI framework, `React.createElement` only (no JSX); vendored in `vendor/`, bundled by esbuild with no transforms
- **Tailwind CSS** - Utility-first styling; the CSS is built into `vendor/tailwind.css` (`npm run build:css`), nothing loads from a CDN
- **SQLite** - Local music library database (via better-sqlite3)
- **Express** - OAuth callback server for Spotify
- **WebSocket** - Real-time communication with browser extension
- **electron-updater** - Auto-update functionality

## Development

```bash
# Run in development mode with DevTools
npm run dev

# Rebuild the renderer bundle on every save (run alongside npm run dev)
npm run dev:renderer

# Build for distribution
npm run build:mac    # macOS (.dmg, .zip) — also compiles the MusicKit helper
npm run build:win    # Windows (.exe, portable)
npm run build:linux  # Linux (.AppImage, .deb, .rpm)
```

### The renderer is a generated bundle

Edit `src/renderer/app.js`. The root `app.js` that `index.html` loads is an esbuild bundle of it (plain IIFE, no minify, no transforms, with a source map), gitignored and rebuilt by the `prestart`, `predev`, `pretest` and `prebuild` hooks, so a plain `npm start` or `npm test` never runs stale code. Edits to the root file are overwritten on the next build.

### Plug-ins are generated too

The source of a bundled plug-in is `plugins-src/<id>/manifest.json` plus `implementation.js`, a real module you can `require` in tests. `node scripts/build-axes.js` (also `npm run axes`) writes `plugins/<id>.axe`, the matching fallback entry in the renderer, and the version in `marketplace-manifest.json`. Bump `manifest.version` when the implementation changes, or installed copies won't re-download. `npm run axes:check` fails on any drift and runs in the test suite, so never hand-edit an `.axe`.

### Checks

CI runs these on every push and pull request; run them locally first:

```bash
npm run lint        # ESLint — strict on the extracted modules, warnings only on the legacy files
npm run typecheck   # tsc over the modules that opted into checkJs
npm test            # Jest (builds the renderer bundle first)
```

### Bumping Electron

`package.json` pins castlabs Electron by GitHub tag (`castlabs/electron-releases#v39.8.10+wvcus`) and `build.electronDownload.mirror` points electron-builder at the same releases. Bump both together, then run `npx electron-builder install-app-deps` so `better-sqlite3` is rebuilt against the new Node ABI. castlabs supports the three latest Electron majors; an older major still inside their window can download a CDM but gets no fixes.

### CI/CD

The project uses GitHub Actions for automated builds on all platforms. Builds are triggered on:
- Push to main/master branches
- Pull requests to main/master
- Version tags (v*)

Tagged releases automatically create draft GitHub Releases with all platform artifacts.

macOS and Windows builds are VMP-signed through castlabs EVS (`scripts/vmp-sign.js`), so Widevine's production licence servers accept them. The signing runs before Apple code signing on macOS and after Authenticode on Windows; Linux needs no VMP signature. CI logs in to EVS from the `EVS_ACCOUNT_NAME` and `EVS_PASSWD` repository secrets on every run. Pull-request builds from forks have no secrets, so they keep the development signature; release tags fail instead of shipping an unsigned build.

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
