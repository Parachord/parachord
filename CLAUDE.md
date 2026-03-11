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

## Resolver Pipeline

The resolver system resolves a (artist, track) pair into playable sources across multiple services.

### .axe Plugin Format

Each `.axe` file is JSON with a manifest, capabilities, URL patterns, settings, and an `implementation` object containing JavaScript functions as strings (`resolve`, `search`, `play`, `lookupUrl`, `init`, `cleanup`). Functions are instantiated via `new Function()` in a sandboxed context.

### Resolution Flow

1. **ResolverLoader** (`resolver-loader.js`) loads `.axe` files, converts string functions to callable functions, and registers URL patterns
2. **ResolutionScheduler** (`resolution-scheduler.js`) prioritizes which tracks to resolve based on visibility context:
   - queue (1) > hover (2) > pool (3) > page (4) > sidebar (5) > background (6)
   - Rate-limited: 150ms between resolutions
   - Supports abort via AbortController when tracks scroll out of view
3. **resolveTrack()** (in `app.js`) queries all enabled resolvers in parallel, flushes results to UI as each completes
4. **Background pre-resolution** runs during idle periods with a 30s startup grace period, ramping from 5 to 25 tracks per batch

### Resolution Caching (3 layers)

| Layer | TTL | Scope |
|-------|-----|-------|
| In-memory `trackSourcesCache` | 7 days | Session, keyed by `artist\|title` |
| Persisted `track.sources` | 30 days | Collection/playlist DB, per resolver |
| No-match sentinels | Session | Prevents re-querying resolvers that found nothing |

Canonical resolver order: Spotify → Apple Music → Bandcamp → SoundCloud → Local Files → YouTube. Fallback resolvers are embedded in `app.js` if `.axe` files fail to load.

## Metadata Providers

Metadata is fetched from multiple sources with fallback chains. MusicBrainz is the primary hub.

### Album Art Fallback Chain

1. Check `albumToReleaseIdCache` (artist-album → MusicBrainz release/release-group IDs)
2. Search MusicBrainz for release if not cached
3. Fetch from Cover Art Archive: try `/release-group/{id}/front-250`, fall back to `/release/{id}/front-250`
4. Fall back to resolver plugins (Spotify, Apple Music, etc.) via `getAlbumArtFromResolvers()`

### Artist Bio Fallback Chain (fetched in parallel, priority-selected)

1. **Wikipedia** (highest) — MusicBrainz → Wikidata → Wikipedia extract
2. **Discogs** (medium) — requires optional personal access token
3. **Last.fm** (lowest) — artist name lookup, strips HTML

### Artist Images

1. Spotify API search (exact name match)
2. MusicKit fallback (Apple Music)
3. Wikipedia/Discogs fallback for when neither is available

### Artist Data Fallback

1. MusicBrainz (primary — releases, relations, members, URLs)
2. Spotify resolver
3. Apple Music MusicKit
4. Last.fm
5. Discogs

### Related Artists

- ListenBrainz Labs API (requires MBID, scored similarity)
- Last.fm similar artists (name-based, percentage match)

## Cover Art Cache

### Disk Cache (local files only)

- **Directory:** `{userDataPath}/album-art-cache/`
- **Embedded art:** `embedded-{md5(filePath)}.{jpg|png}` — extracted via `music-metadata`
- **CAA art:** `caa-{releaseId}.jpg` — fetched from Cover Art Archive
- **Folder art:** auto-detected `cover.jpg`, `folder.jpg`, `album.jpg`, `front.jpg` (+ png/jpeg variants)
- Managed by `AlbumArtResolver` in `local-files/album-art.js`

### In-Memory Cache (renderer)

| Cache | Key | TTL | Persisted |
|-------|-----|-----|-----------|
| `albumArtCache` | Release ID or Release Group ID | 90 days | Yes (`cache_album_art`) |
| `albumToReleaseIdCache` | `"artist-album"` | No expiry | Yes (`cache_album_release_ids`) |
| `resolverArtCache` | `"artist-album"` | Session | No |
| `artistImageCache` | Artist name | 90 days | Yes |

### All Cache TTLs

| Cache | TTL |
|-------|-----|
| Album art | 90 days |
| Artist images | 90 days |
| Artist data | 30 days |
| Artist extended info | 30 days |
| Track sources | 7 days |
| Persisted sources | 30 days |
| Playlist covers | 30 days |
| Recommendations | 1 hour |
| Charts | 24 hours |
| New releases | 6 hours |
| Concerts | 24 hours |

Caches are loaded from `electron.store` at startup (expired entries filtered) and saved periodically.

## Key Details

- `.axe` plugin files are JSON with embedded JavaScript — treat them as data files with code strings
- `app.js` is a bundled output file (~2.8MB) — do not edit it directly
- Environment variables for API keys are configured in `.env` (see `.env.example`)
- Native macOS MusicKit helper is built separately via `npm run build:native`
- SQLite (better-sqlite3) is used for the local music library database
