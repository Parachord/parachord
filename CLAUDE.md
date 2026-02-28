# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Parachord is a multi-source music player desktop app (Electron + React) inspired by Tomahawk. It plays music from Spotify, YouTube, Apple Music, Bandcamp, SoundCloud, and local files through a unified interface with a plugin architecture.

## Commands

```bash
npm start              # Launch the app
npm run dev            # Launch with DevTools open (--dev flag)
npm test               # Run all Jest tests
npm run test:watch     # Jest in watch mode
npm run test:coverage  # Jest with coverage report
npm run test:playback  # Only playback tests
npm run test:resolver  # Only resolver tests
npm run test:legacy    # Run legacy tests (custom framework, not Jest)
npx jest tests/path/to/specific.test.js  # Run a single test file
npm run build:mac      # Build macOS .dmg/.zip
npm run build:win      # Build Windows .exe
npm run build:linux    # Build Linux AppImage/deb/rpm
```

## Architecture

### Process Model (Electron)
- **Main process** (`main.js`): App lifecycle, IPC handlers, Spotify background polling, MCP server, OAuth server (Express on port 8888)
- **Preload script** (`preload.js`): Secure IPC bridge exposing service APIs to the renderer
- **Renderer** (`app.js`): Single-file ~2.5MB React application (React/Tailwind loaded via CDN, no build step)

### Plugin System (.axe format)
Plugins live in `plugins/` as `.axe` files — JSON containing a manifest and JavaScript implementation as a string. Two types:
- **Content Resolvers**: search + resolve + stream music (Spotify, YouTube, Bandcamp, etc.)
- **Meta Services**: metadata, recommendations, scrobbling (Last.fm, ListenBrainz, Wikipedia, etc.)
- **AI Backends**: ChatGPT, Claude, Gemini, Ollama plugins for the built-in AI DJ

See `docs/architecture/AXE_FORMAT_SPEC.md` for the full plugin specification.

### Playback Strategies
Each source uses a different playback mechanism:
- **Local files / Bandcamp**: HTML5 `<audio>` element
- **Spotify**: Spotify Connect web playback + polling loop in main process
- **Apple Music**: Native MusicKit on macOS (via `native/musickit-helper/`), MusicKit JS fallback elsewhere
- **YouTube / SoundCloud**: Embedded iframe players (coordinated via browser extension WebSocket on port 21863)

### Key Modules
- `local-files/` — Local library: scanning, SQLite DB (better-sqlite3, synchronous), metadata extraction, file watching (chokidar)
- `services/mcp-server.js` — MCP HTTP server (port 9421) exposing playback/queue tools to external AI agents
- `services/ai-chat.js` + `services/ai-chat-integration.js` — AI DJ conversation engine with tool use
- `scrobblers/` — Last.fm, ListenBrainz, Libre.fm integrations (inherit from `base-scrobbler.js`)
- `sync-providers/` + `sync-engine/` — Library sync from streaming services
- `parachord-extension/` — Chrome MV3 browser extension (WebSocket to desktop app)
- `raycast-extension/` — Raycast macOS integration via `parachord://` protocol URLs
- `smart-links/` — Cloudflare Worker for cross-service shareable links

### IPC Pattern
Main ↔ renderer communication uses Electron IPC with dashed channel names (e.g., `spotify-auth`, `local-files-scan`). Sensitive operations route through the preload bridge. The MCP server forwards tool calls to the renderer via IPC.

## Tech Choices

- **Plain JavaScript** throughout (no TypeScript)
- **CommonJS** (`require`/`module.exports`)
- **No UI build step** — React 18 and Tailwind CSS loaded from CDN
- **SQLite** via better-sqlite3 (synchronous API, stored in Electron's userData directory)
- **Jest 30** for testing; three legacy tests use a custom framework (`npm run test:legacy`)

## Testing

Tests are in `tests/` organized by domain: `playback/`, `queue/`, `resolver/`, `chat/`, `local-files/`, `scrobbling/`, `sync/`, `extension/`, `charts/`. Shared mocks and fixtures are in `tests/test-utils/` (`setup.js`, `mocks.js`, `fixtures.js`). Test environment is Node (not jsdom).

## Environment Variables

Copy `.env.example` for the template. Key variables: `SPOTIFY_CLIENT_ID`, `YOUTUBE_API_KEY`, `SOUNDCLOUD_CLIENT_ID`, `LASTFM_API_KEY`, `MUSICKIT_DEVELOPER_TOKEN`. Spotify uses PKCE (no client secret needed). OAuth callback defaults to `http://127.0.0.1:8888/callback`.
