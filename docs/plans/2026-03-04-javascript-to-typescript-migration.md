# JavaScript to TypeScript Migration Plan — Parachord

## Context

Parachord is a ~91,800-line Electron music player with 89 JS files, no bundler, and no TypeScript tooling. The codebase has grown complex enough (15+ API integrations, IPC bridge, plugin system, sync engine, AI features) that type safety would meaningfully reduce bugs and improve maintainability. Several modules already have JSDoc `@typedef` annotations (`sync-providers/types.js`, `services/ai-chat.js`, `tools/dj-tools.js`), making them natural starting points.

This plan uses a **strictly incremental, low-risk approach**: each phase is independently shippable, tests pass throughout, and JS/TS coexist via `allowJs`.

---

## Phase 0: Foundation (Infrastructure Setup)

**Goal**: Install TypeScript tooling without changing any source files.

### Steps:
1. **Install dependencies**:
   ```
   npm install --save-dev typescript ts-jest @types/node @types/better-sqlite3 @types/express @types/ws
   ```

2. **Create `tsconfig.json`** at project root:
   ```json
   {
     "compilerOptions": {
       "target": "ES2021",
       "module": "commonjs",
       "lib": ["ES2021"],
       "outDir": "./dist",
       "rootDir": ".",
       "strict": true,
       "allowJs": true,
       "checkJs": false,
       "esModuleInterop": true,
       "skipLibCheck": true,
       "forceConsistentCasingInFileNames": true,
       "resolveJsonModule": true,
       "declaration": true,
       "declarationMap": true,
       "sourceMap": true,
       "moduleResolution": "node"
     },
     "include": [
       "services/**/*",
       "scrobblers/**/*",
       "sync-providers/**/*",
       "sync-engine/**/*",
       "local-files/**/*",
       "smart-links/lib/**/*",
       "tools/**/*",
       "scrobble-manager.*",
       "types/**/*"
     ],
     "exclude": ["node_modules", "dist", "raycast-extension", "parachord-extension", "tests"]
   }
   ```

3. **Update `jest.config.js`** to support both JS and TS tests:
   - Add `preset: 'ts-jest/presets/js-with-ts'`
   - Extend `testMatch` to include `*.test.ts`
   - Add `moduleFileExtensions: ['ts', 'js', 'json']`

4. **Add npm scripts**:
   - `"typecheck": "tsc --noEmit"` (type checking without build)
   - `"build:ts": "tsc"` (compile TS to JS for production)

5. **Create `types/` directory** for shared type definitions (see Phase 1)

### Files to create/modify:
- `tsconfig.json` (new)
- `package.json` (add deps + scripts)
- `jest.config.js` (update for TS support)
- `types/` directory (new)

### Verification:
- `npm test` passes unchanged (no source files modified)
- `npx tsc --noEmit` runs without error (allowJs + checkJs:false means no complaints)
- `npm start` still launches the app normally

### Rollback: Delete `tsconfig.json`, `types/`, revert `package.json` and `jest.config.js`

---

## Phase 1: Shared Type Definitions

**Goal**: Create the core TypeScript interfaces used across the entire app, based on existing JSDoc types.

### Steps:
1. **Convert `sync-providers/types.js` → `sync-providers/types.ts`**
   - Transform JSDoc `@typedef` blocks into TypeScript `interface` / `type` exports
   - Already has: `SyncProviderCapabilities`, `SyncTrack`, `SyncAlbum`, `SyncArtist`, `SyncPlaylist`, `SyncPlaylistFolder`, `SyncProgress`, `SyncResult`, `SyncProvider`

2. **Create `types/track.ts`** — Core Track interface:
   ```ts
   export interface Track {
     id: string;
     title: string;
     artist: string;
     album: string;
     duration: number;
     sources: string[];
     spotifyId?: string;
     spotifyUri?: string;
     appleMusicId?: string;
     soundcloudId?: string;
     bandcampUrl?: string;
     albumArt?: string;
     isrc?: string;
     source?: string;
     resolved?: boolean;
     error?: string;
   }
   ```

3. **Create `types/playlist.ts`** — Playlist interface

4. **Create `types/index.ts`** — Re-exports all shared types

### Files to create/modify:
- `sync-providers/types.js` → `sync-providers/types.ts` (rename + convert)
- `types/track.ts` (new)
- `types/playlist.ts` (new)
- `types/index.ts` (new)

### Verification:
- `npx tsc --noEmit` passes
- `npm test` passes (JS files importing from `sync-providers/types` still work via `allowJs`)
- Existing JS consumers unaffected (module.exports compatibility preserved)

---

## Phase 2: Leaf Modules (Zero Internal Dependencies)

**Goal**: Convert the simplest, most self-contained modules — these have no internal `require()` calls to other project files.

### Files to convert (in order):
1. **`services/protocol-handler.js` → `.ts`** (~184 lines)
   - Pure logic, already has JSDoc `@param`/`@returns`
   - Functions: `parseProtocolUrl()`, `validateProtocolCommand()`, `mapTabName()`

2. **`scrobble-manager.js` → `.ts`** (~160 lines)
   - No module imports, class with Map-based plugin management

3. **`tools/dj-tools.js` → `.ts`** (~200 lines)
   - Already has `@typedef Tool` and `@typedef ToolContext`
   - Convert to proper TS interfaces

4. **`smart-links/lib/enrich.js` → `.ts`** (~232 lines)
   - Pure async functions, only uses `fetch`

5. **`smart-links/lib/html.js` → `.ts`** (~650 lines)
   - Pure string generation functions

### Verification:
- `npx tsc --noEmit` passes after each file conversion
- `npm test` passes after each file conversion
- `npm start` — app launches and basic functionality works

---

## Phase 3: Sync & Scrobbler Modules

**Goal**: Convert the sync providers and scrobblers, which form clean dependency chains.

### 3a: Sync Providers
1. **`sync-providers/spotify.js` → `.ts`** (~672 lines)
   - Already has JSDoc `@type` annotations
   - Import types from `sync-providers/types.ts` (Phase 1)

2. **`sync-providers/applemusic.js` → `.ts`** (~351 lines)
   - Parallel structure to Spotify

### 3b: Scrobblers (convert bottom-up)
3. **`scrobblers/base-scrobbler.js` → `.ts`** (~66 lines, base class)
4. **`scrobblers/lastfm-scrobbler.js` → `.ts`** (~180 lines, extends base)
5. **`scrobblers/listenbrainz-scrobbler.js` → `.ts`** (~lines, extends base)
6. **`scrobblers/librefm-scrobbler.js` → `.ts`** (~lines, extends lastfm)
7. **`scrobblers/index.js` → `.ts`** (barrel file)

### 3c: Sync Engine
8. **`sync-engine/index.js` → `.ts`** (~293 lines)
   - Depends on sync-providers (already converted above)

### Verification:
- `npx tsc --noEmit` passes
- `npm test` — run sync and scrobbler tests: `jest tests/sync/ tests/scrobbling/`
- Manual test: trigger a library sync in the app

---

## Phase 4: Local Files Module

**Goal**: Convert the local files subsystem bottom-up by dependency order.

### Convert in order:
1. **`local-files/metadata-reader.js` → `.ts`** (~179 lines, depends on `music-metadata`)
2. **`local-files/album-art.js` → `.ts`** (~137 lines, depends on metadata-reader)
3. **`local-files/database.js` → `.ts`** (~360 lines, depends on `better-sqlite3`)
4. **`local-files/scanner.js` → `.ts`** (~200 lines, depends on database + metadata-reader)
5. **`local-files/watcher.js` → `.ts`** (~192 lines, depends on `chokidar` + metadata-reader)
6. **`local-files/index.js` → `.ts`** (~401 lines, orchestrates all above)

### Verification:
- `npm test` — run local files tests: `jest tests/local-files/`
- Manual test: add a watch folder, verify scanning works

---

## Phase 5: Services Layer

**Goal**: Convert the service modules that depend on previously converted code.

### Convert in order:
1. **`services/mcp-server.js` → `.ts`** (~418 lines)
   - Depends on `express`, `tools/dj-tools`, Electron IPC
   - Uses `@types/express`

### Verification:
- `npm test` — run chat tests: `jest tests/chat/`
- Manual test: open AI DJ chat, verify MCP server responds

---

## Phase 6: Root-Level Modules (Higher Risk)

**Goal**: Convert the loader and scheduler files that bridge between the module layer and the main app files.

### Files:
1. **`scrobbler-loader.js` → `.ts`** (~950 lines)
2. **`resolver-loader.js` → `.ts`**
3. **`resolution-scheduler.js` → `.ts`**
4. **`musickit-web.js` → `.ts`** (~753 lines)

### Verification:
- `npm test` — full test suite
- Manual test: play a track, verify resolution and scrobbling work end-to-end

---

## Phase 7: Core Files (Highest Risk — Future)

**Goal**: Convert the three largest files. These should be **split into smaller modules first**, then converted. This phase is a longer-term effort.

### Files:
1. **`preload.js`** (19K lines) — IPC bridge
   - Split by domain: playback IPC, sync IPC, local-files IPC, etc.
   - Each split module gets typed interfaces for IPC channel contracts

2. **`main.js`** (5,840 lines) — Electron main process
   - Split by responsibility: window management, IPC handlers, app lifecycle

3. **`app.js`** (54K lines) — Monolithic React UI
   - This is the largest effort and should be a separate project
   - Split into React components first, then convert to TSX

### Note: Phase 7 is out of scope for the initial migration. Phases 0–6 cover all modular code and provide the type foundation that Phase 7 would build on.

---

## Files NOT Converted (Out of Scope)

- `parachord-extension/` — Browser extension (separate project)
- `raycast-extension/` — Already TypeScript
- `plugins/*.axe` — Plugin config files, not JS
- `smart-links/functions/` — Cloudflare Workers (separate deploy pipeline)
- `vendor/` — Third-party libraries
- `scripts/` — Build scripts (low value)

---

## Verification Strategy (All Phases)

After each phase:
1. **`npx tsc --noEmit`** — Type checking passes
2. **`npm test`** — All Jest tests pass
3. **`npm start`** — App launches and runs
4. **Commit** — Each phase is a separate commit for easy rollback

End-to-end smoke test after Phase 6:
- Launch app, search for a track, play it
- Add to queue, skip tracks
- Open AI DJ chat
- Trigger library sync
- Verify scrobbling
- Add a local files watch folder

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Breaking `require()` paths | `allowJs: true` lets JS files import from TS seamlessly |
| Test failures | Convert one file at a time, run tests after each |
| Electron packaging breaks | `outDir: ./dist` keeps compiled output separate; electron-builder config unchanged until Phase 7 |
| CI pipeline breaks | Add `typecheck` step to CI only after Phase 0 is stable |
| Team unfamiliar with TS | Phases 0–2 are the simplest possible conversions to build familiarity |
