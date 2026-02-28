# Parachord Server Extraction Plan

## Context

Parachord is currently a monolithic Electron app where backend logic (auth, search, queue, sync, scrobbling, plugin execution) is split between `main.js` (5,523 lines, 104 IPC handlers) and `app.js` (~2.5MB React renderer). This plan extracts those backend concerns into a standalone `server/` Express + WebSocket server, enabling a future web client. The Electron app stays as-is for now.

The server is the **source of truth** for playback state, queue, and track resolution. Clients are audio renderers that receive "play this" commands and report progress back.

---

## Phase 1: Foundation — Server Skeleton, Store, Resolvers, Search

**Goal**: Running server that loads plugins and returns search results.
**Demo**: `curl http://localhost:3000/api/search?q=radiohead`

### Files to create

```
server/
  package.json                  # express, ws, dotenv, uuid, jest, supertest
  index.js                      # Entry point: creates app, starts listening
  lib/
    config.js                   # dotenv + env variable access with defaults
    store.js                    # JSON file store at ~/.parachord-server/store.json
                                #   (replaces electron-store: sync reads, debounced writes)
    server.js                   # Express app factory + WS upgrade
    ws-manager.js               # WS connection tracking, broadcast(type, payload), on(type, handler)
  services/
    resolver-service.js         # Wraps ResolverLoader: load plugins, search, resolve, URL lookup
  routes/
    resolvers.js                # GET /api/resolvers, PUT .../enable|disable
                                # GET /api/search?q=, POST /api/resolve, POST /api/lookup-url
    config.js                   # GET/PUT /api/config/:key
  middleware/
    error-handler.js            # Centralized error responses
```

### Reused modules (require directly, zero changes)
- `../../resolver-loader.js` — plugin loading and execution
- `../../services/protocol-handler.js` — URL type detection

### Key design
- **Store**: `fs.readFileSync` on startup, in-memory Map, `fs.writeFile` debounced 200ms on mutations. Same sync-read semantics as electron-store.
- **ResolverService.search()**: Iterates enabled resolvers calling `resolver.search(query, config)`, merges results. Extracted from app.js renderer logic. Can stream incremental results over WS via `search:results` events.
- **Resolver configs**: Stored in `store.get('resolver_configs')`. Each resolver gets its config (tokens, API keys) via `resolverService.getResolverConfig(id)`.
- Plugins loaded from `../../plugins/` (bundled) and `~/.parachord-server/plugins/` (user-installed).

---

## Phase 2: Auth — OAuth Flows and Token Management

**Goal**: Spotify/SoundCloud OAuth via server, token storage and auto-refresh.
**Demo**: Browser → `http://localhost:3000/auth/spotify` → complete OAuth → `GET /api/auth/spotify/status` returns connected.

### Files to create

```
server/
  lib/
    crypto.js                   # PKCE verifier/challenge, MD5 helper (crypto.createHash)
  services/
    auth-service.js             # OAuth orchestration, token storage/refresh
  routes/
    auth.js                     # GET /auth/spotify (redirect), GET /auth/spotify/callback,
                                # GET /api/auth/spotify/status, DELETE /api/auth/spotify,
                                # PUT /api/auth/spotify/credentials
                                # Same pattern for soundcloud
```

### Extracted from
- `main.js` lines 2376–2680: PKCE generation, code exchange, token refresh
- `main.js` lines 717–849: Express callback routes (`/callback`, `/callback/soundcloud`)

### Key design
- `authService.getToken(provider)` — returns valid token, auto-refreshes if expired. Used by resolver-service, sync-service, playback-service.
- WS event: `auth:status-changed` on connect/disconnect.

---

## Phase 3: Queue and Playback State Machine

**Goal**: Server owns queue and playback state. Clients connect via WS, receive play commands, report progress.
**Demo**: `POST /api/queue/add` with tracks → WS client receives `playback:play` → reports progress → server auto-advances.

### Files to create

```
server/
  services/
    queue-service.js            # Queue CRUD, shuffle (Fisher-Yates), reorder
    playback-service.js         # State machine (idle→loading→playing→paused→idle),
                                # auto-advance, track resolution for playback
  routes/
    queue.js                    # GET /api/queue, POST /api/queue/add, DELETE /api/queue,
                                # POST /api/queue/reorder, POST /api/queue/shuffle
    playback.js                 # POST /api/playback/play, /pause, /resume, /next, /previous, /seek
```

### WS protocol

Server → Client:
- `playback:play` — `{ track, source, credentials, streamUrl }` (everything client needs to render audio)
- `playback:pause`, `playback:stop`, `playback:state-changed`
- `queue:updated` — full queue + currentIndex on any mutation

Client → Server:
- `client:progress` — `{ position, duration }` (periodic, e.g. every 5s)
- `client:track-ended` — triggers auto-advance
- `client:error` — `{ error, source }` (triggers fallback resolution or skip)

### Key design
- `playbackService.play(track)` resolves the track via `resolverService`, picks best source, attaches credentials from `authService`, sends `playback:play` over WS.
- Auto-advance: on `client:track-ended`, calls `next()` which picks next queue track and plays it.
- Pre-resolution: when a track starts playing, pre-resolve the next 2–3 queue tracks in background.
- Local file streaming: `GET /api/stream/local?path=...` with HTTP range support (replaces Electron's `local-audio://` protocol handler from main.js lines 1459–1547).

---

## Phase 4: Scrobbling

**Goal**: Server-side scrobbling triggered by playback progress.
**Demo**: Play a track, see it scrobbled to Last.fm.

### Files to create

```
server/
  services/
    scrobble-service.js         # Adapted from scrobbler-loader.js + scrobble-manager.js
  routes/
    scrobblers.js               # GET /api/scrobblers, POST .../connect, DELETE .../disconnect
```

### Adapted from (3 targeted changes)
- `scrobbler-loader.js`, `scrobble-manager.js`, `scrobblers/*.js`
- Replace `window.electron.store` → server `Store` instance
- Replace `window.electron.proxyFetch` → native `fetch` (no CORS on server)
- Replace `window.electron.crypto.md5` → `crypto.createHash('md5')` from `lib/crypto.js`

### Integration
- `playbackService` calls `scrobbleService.onTrackStart()`, `.onProgressUpdate()`, `.onTrackEnd()` at appropriate state transitions.

---

## Phase 5: Playlists and Collection

**Goal**: CRUD for playlists and unified collection. Can run in parallel with Phases 2–4.
**Demo**: `GET /api/playlists`, `POST /api/collection/tracks`

### Files to create

```
server/
  services/
    playlist-service.js         # CRUD, XSPF import/export
    collection-service.js       # Load/save collection.json, search, pagination
  routes/
    playlists.js                # CRUD + import/export
    collection.js               # GET with pagination, search, add/remove tracks
```

### Storage
- Playlists: `store.get('local_playlists')` (same format as electron-store)
- Collection: `~/.parachord-server/collection.json` (same format as existing)

---

## Phase 6: Local Files and Sync

**Goal**: Server manages local file scanning/watching and library sync from streaming services.
**Demo**: `POST /api/local-files/folders` adds a watch folder, tracks appear; `POST /api/sync/spotify/start` syncs library.

### Files to create

```
server/
  services/
    sync-service.js             # Orchestrates sync, uses auth-service for tokens
  routes/
    local-files.js              # Folders, rescan, search, stream audio
    sync.js                     # Providers, start/cancel, fetch playlists
```

### Reused modules (require directly, zero changes)
- `../../local-files/` — entire directory (SQLite + chokidar + metadata, all Node-native)
- `../../sync-engine/index.js` — diff calculation
- `../../sync-providers/spotify.js` — Spotify API calls (pure fetch)
- `../../sync-providers/applemusic.js`

### Key design
- `LocalFilesService` instantiated with server data dir, events piped to WS (`localFiles:scanProgress`, `localFiles:libraryChanged`).
- `SyncService` uses `authService.getToken()` for provider tokens, streams `sync:progress` over WS.

---

## Phase 7: AI Chat and MCP

**Goal**: AI DJ runs server-side with direct tool access. MCP server wired to services.
**Demo**: `POST /api/chat { message: "play something by Radiohead" }` → searches, queues, responds.

### Files to create

```
server/
  services/
    chat-service.js             # Wires AIChatService with server tool context
    mcp-service.js              # MCP JSON-RPC, direct tool execution (no IPC)
  routes/
    chat.js                     # POST /api/chat, GET /api/chat/history, DELETE /api/chat/history
```

### Reused modules (require directly, zero changes)
- `../../services/ai-chat.js` — conversation orchestration
- `../../services/ai-chat-integration.js` — createToolContext, createContextGetter
- `../../tools/dj-tools.js` — tool definitions and executors

### Key design
- Tool context wired to server services: `searchResolvers → resolverService.search`, `playTrack → playbackService.play`, `addToQueue → queueService.addTracks`, etc.
- MCP routes (`POST /mcp`, `GET /mcp`, `DELETE /mcp`): reuse JSON-RPC structure from `services/mcp-server.js`, replace `requestFromRenderer()` with direct `executeTool()` calls.

---

## Phase 8: Polish — Migration, API Auth, Health

### Files to create

```
server/
  lib/
    migration.js                # Import from Electron's electron-store + collection.json
  services/
    search-history-service.js
  routes/
    health.js                   # GET /api/health, GET /api/version
  middleware/
    auth.js                     # Bearer token from PARACHORD_API_KEY env var
```

---

## Phase Dependencies

```
Phase 1 (Foundation) ──┬── Phase 2 (Auth) ──┬── Phase 3 (Queue/Playback) ── Phase 4 (Scrobbling)
                       │                     └── Phase 6 (Local Files + Sync)
                       └── Phase 5 (Playlists/Collection)

Phase 3 + Phase 5 ───── Phase 7 (AI Chat + MCP)
All phases ──────────── Phase 8 (Polish)
```

Phases 5 can be done in parallel with 2–4.

---

## Verification

After each phase:
1. Run `npm test` in `server/` — unit + integration tests (Jest + supertest)
2. Start server with `npm run dev` (uses `node --watch`)
3. Manual verification with curl / wscat for REST and WebSocket endpoints
4. After Phase 3: connect a WS client, add tracks to queue, verify playback commands are sent and auto-advance works on `client:track-ended`
5. After Phase 7: test MCP with Claude Desktop pointing at `http://localhost:3000/mcp`
