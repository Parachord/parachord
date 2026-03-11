# CLAUDE.md

## Project Overview

Parachord is a multi-source music player desktop app (Electron) that unifies playback from Spotify, Apple Music, YouTube, Bandcamp, SoundCloud, and local files. It uses a plugin-based resolver system (.axe format) for extensibility.

## Common Commands

```bash
npm start              # Run app in dev mode (opens DevTools)
npm run dev            # Same as npm start
npm test               # Run Jest test suite
npm run test:watch     # Run tests in watch mode
npm run test:coverage  # Run tests with coverage report
npm run test:playback  # Run only playback tests
npm run test:resolver  # Run only resolver tests
npm run test:legacy    # Run legacy tests (custom framework, not Jest)
npm run build:css      # Rebuild Tailwind CSS
npm run build:mac      # Build macOS binaries
npm run build:win      # Build Windows binaries
npm run build:linux    # Build Linux binaries
```

## Architecture

- **main.js** — Electron main process (window management, IPC, OAuth, WebSocket)
- **preload.js** — IPC bridge exposing Electron APIs to renderer
- **app.js** — Bundled React 18 application (single-file build, do not edit directly)
- **plugins/** — .axe resolver plugins (JSON files with embedded JS)
- **services/** — Service integrations (MCP server, AI chat, protocol handler)
- **scrobblers/** — Last.fm, ListenBrainz, Libre.fm scrobbling
- **local-files/** — Local music library (scanner, metadata reader, SQLite DB, watcher)
- **sync-engine/** & **sync-providers/** — Library sync from Spotify/Apple Music
- **parachord-extension/** — Browser extension (Chrome/Firefox, manifest v3)
- **raycast-extension/** — Raycast integration (TypeScript)
- **tests/** — Jest tests organized by feature area

## Testing

- Framework: Jest (v30)
- Config: `jest.config.js`
- Tests live in `tests/` organized by feature (playback, resolver, queue, sync, etc.)
- Three legacy test files are excluded from Jest and run via `npm run test:legacy`
- Test timeout: 10 seconds

## Code Style

- JavaScript (Node.js 20 LTS), no TypeScript in main app (raycast-extension uses TS)
- React 18 loaded via CDN (no JSX build step)
- Tailwind CSS for styling (pre-built, rebuild with `npm run build:css`)
- No ESLint config in root — follow existing code conventions

## Key Details

- `.axe` plugin files are JSON with embedded JavaScript — treat them as data files with code strings
- `app.js` is a bundled output file (~2.8MB) — do not edit it directly
- Environment variables for API keys are configured in `.env` (see `.env.example`)
- Native macOS MusicKit helper is built separately via `npm run build:native`
- SQLite (better-sqlite3) is used for the local music library database
