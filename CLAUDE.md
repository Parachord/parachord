# Parachord - Claude Code Guide

The always-loaded guide: architecture, where to read before changing an area, the invariants that apply to every change, and how releases and contributor communication work. Subsystem detail is in `docs/architecture/` (index below).

## Architecture

**app.js is a GENERATED artifact** — esbuild bundles `src/renderer/app.js` (the source of truth, same content, classic IIFE script, no transforms: target esnext, no minify) into `app.js` + `app.js.map` (both gitignored). Built by `pretest`/`prestart`/`predev`/`prebuild` hooks (`node scripts/build-renderer.js`; dev watch: `npm run dev:renderer`). Never hand-edit root `app.js` — edit `src/renderer/app.js`. CLAUDE.md's `app.js L####` line refs refer to `src/renderer/app.js` (identical content). Source-marker tests read `src/renderer/app.js`; tests that read the generated `app.js` rely on `pretest` having built it. **The component split has begun (Track 2b):** the leaf UI atoms (Tooltip/FixedTooltip, the SERVICE_LOGO*/ResolverIcon badge kit, ParachordWordmark, PlaybackProgress) live in `src/renderer/components/ui-atoms.js`, required by `src/renderer/app.js` (`const { ... } = require('./components/ui-atoms')`). `src/renderer/components/**` is in the ESLint **strict tier**. Extracted component modules use `React.useState`-style qualified hooks, never bare destructured ones — app.js's module-scope `const { useState, ... } = React` destructure masks bare hooks from lint in the legacy file, and in the esbuild bundle they resolve **by accident** (the `__commonJS` module wrappers close over the entry IIFE's scope, where app.js's destructure lives), so a bare hook is invisible until the module is required under plain Node/jest. `no-undef` caught FixedTooltip's bare `useState`/`useRef` on the move (hygiene, not a would-be crash — the bundle would have resolved it; `tests/renderer/component-render-smoke.test.js` renders every export under Node so the class is caught there regardless). Presentational components are props-driven; they must not grow app-state references — state-domain hooks are the later phase.

**ESM-only dependencies in a CommonJS main process.** `chokidar` (5), `electron-store` (12) and `music-metadata` (12) ship no CommonJS build. `main.js` and `local-files/` still `require()` them: Electron 44's Node (24.21) supports `require(esm)` for graphs without top-level await, and that is what runs in the app. Two consequences: `require('electron-store')` is the module namespace, so the class is `.default` (the bare require gave "Store is not a constructor"); and jest needs two things to follow — the `module-sync` export condition in `jest.config.js` (music-metadata publishes only `import`/`module-sync`, so without it the package is "not found") and `--experimental-vm-modules` on the Node that runs jest (the `test` scripts pass it), which jest's own require(esm) requires on Node 24.9+. The test workflow runs Node 24 for that reason; the build workflow stays on 22 because electron-builder never loads these. Don't "fix" a future ESM-only bump by adding a Babel transform for node_modules; this path is the supported one. `dotenv` 17+ logs an "injecting env" tip on `config()`, so every call passes `{ quiet: true }`. (2026-10-18, parachord deps PR.)

No JSX — uses `React.createElement()` exclusively. Styling via Tailwind CSS classes + inline styles with CSS variables (`var(--accent-primary)`, `var(--card-bg)`, etc.).

Main component: `const Parachord = () => { ... }` (L4951), rendered via `ReactDOM.createRoot`.

## Before you change an area, read its doc

Subsystem detail lives in `docs/architecture/`, moved there verbatim from this file on 2026-10-22 so the always-loaded guide stays short. **Read the matching file before changing that area**: each one carries the incident history behind its rules, and most of its rules exist because something broke. Code comments that cite `CLAUDE.md "<section>"` from before the split point at text now in one of these files; search `docs/architecture/` for the quoted phrase.

| Area | Read first | Main code |
|---|---|---|
| Playback, resolvers, source selection, match confidence, cross-resolver enrichment, volume, Spotify Connect devices | [playback.md](docs/architecture/playback.md) | `handlePlay` / `handleNext` in `src/renderer/app.js`, `resolver-loader.js`, `sync-providers/confidence-scoring.js` |
| Amazon Music resolver; embedded web players and the OS media-surface hijack | [amazon-music.md](docs/architecture/amazon-music.md) | `amazon-web-player.js`, `amazon-music-logic.js`, `amazon-music-poller.js`, `amazon-player-preload.js`, `embedded-player-kit.js`, `plugins-src/amazonmusic/` |
| Now playing: Discord Rich Presence, MPRIS, `navigator.mediaSession` | [now-playing.md](docs/architecture/now-playing.md) | `discord-presence*.js`, `main-process/ipc/discord-presence.js`, `mpris-player.js` |
| Widevine / castlabs Electron, VMP signing; the local server port (OAuth callbacks, `/protocol`) | [platform.md](docs/architecture/platform.md) | `main.js`, `scripts/vmp-sign.js`, `main-process/auth-port.js` |
| Album art | [album-art.md](docs/architecture/album-art.md) | `getAlbumArt` in `src/renderer/app.js`, `album-art-catalog.js`, `src/renderer/lib/broken-art.js` |
| Playlist sync (Spotify, Apple Music, ListenBrainz), mirrors, hosted XSPF, loved tracks | [sync.md](docs/architecture/sync.md) | `main-process/ipc/sync-*.js`, `main-process/sync-links.js`, `sync-engine/`, `sync-providers/` |
| What the Android client must match (sync, protocol handlers) | [android-parity.md](docs/architecture/android-parity.md) | (the parachord-mobile repo) |
| Friend sync | [friends.md](docs/architecture/friends.md) | friend sync in `src/renderer/app.js` |
| Local files library | [local-files.md](docs/architecture/local-files.md) | `local-files/`, `main-process/ipc/local-files.js` |
| Persistence: bulk load, store allowlist, split store | [state-persistence.md](docs/architecture/state-persistence.md) | `main-process/ipc/store.js`, `main-process/split-store.js` |
| MBID mapper and its outage fallback | [mbid-mapper.md](docs/architecture/mbid-mapper.md) | `mbid-lookup.js` |
| Scrobbling; the Achordion submit plugin | [scrobbling.md](docs/architecture/scrobbling.md) | `scrobbler-loader.js`, `plugins-src/achordion/` |
| In-app announcements | [announcements.md](docs/architecture/announcements.md) | announcement fetch in `main.js`, banner in `src/renderer/app.js` |
| Plugins (`.axe`), the marketplace, generated artifacts, AI model lists | [plugins.md](docs/architecture/plugins.md) | `plugins-src/`, `scripts/build-axes.js`, `resolver-loader.js` |
| AI chat (Shuffleupagus) and the DJ tools | [ai-chat.md](docs/architecture/ai-chat.md) | `tools/dj-tools.js`, `executeDjTool` in `src/renderer/app.js` |
| `parachord://` deep links | [protocol.md](docs/architecture/protocol.md), [docs/protocol-schema.md](docs/protocol-schema.md) | `protocol-url.js`, the protocol switch in `src/renderer/app.js` |
| Renderer patterns, full text (summary below) | [renderer-patterns.md](docs/architecture/renderer-patterns.md) | `src/renderer/` |

## Invariants that apply everywhere

One line each; the linked doc has the reasons and the incidents behind them.

- **Route by the plugin registry, never by service name.** "Given a provider URL or entity, do X" goes through `resolver-loader.js` (`findResolverForUrl`, `getUrlType`, `lookupPlaylist`, ...), so a new service is a `.axe` drop-in. Check a capability exists before using it. ([plugins.md](docs/architecture/plugins.md))
- **Source selection is validate, then sort.** A result must match artist AND title to reach `MIN_CONFIDENCE_THRESHOLD` (0.6); every resolution path drops sub-floor results before they touch `track.sources`. `sync-providers/confidence-scoring.js` is canonical and must stay byte-equivalent with the Kotlin copies. ([playback.md](docs/architecture/playback.md))
- **Cross-cutting metadata lives on the source record.** Read ISRC through `window.pickTrackIsrc(track)`; read stream quality through `window.pickStreamQuality(track, playingResolverId)`, keyed on the resolver actually playing. ([playback.md](docs/architecture/playback.md))
- **One album-art pipeline.** Every cover comes from `getAlbumArt` (or `getTrackArt`); no surface-specific shortcuts, never cache a URL that was not requested, and a cover that fails to load is reported through `window.reportBrokenAlbumArt` rather than only hidden. ([album-art.md](docs/architecture/album-art.md))
- **Playlist saves keep every sync field.** Build save payloads by spreading the whole playlist (`window.buildPlaylistSavePayload`), never by listing fields. Create remote playlists only through `sync:create-playlist`, always passing `localPlaylistId`. The push loops' `syncedFrom` guard is provider-scoped. ([sync.md](docs/architecture/sync.md))
- **Every persisted key must be in `ALLOWED_STORE_KEYS`** (`main-process/ipc/store.js`), or the write is silently refused. `local_playlists`, `sync_playlist_state` and every `cache_*` key live in their own files under `userData/store/`. Only the 5-minute timer reliably persists the big caches. ([state-persistence.md](docs/architecture/state-persistence.md))
- **Regenerate `package-lock.json` only with the npm that ships with `build.yml`'s Node** (Node 22 today, so `npx npm@10.9.9 install --package-lock-only --ignore-scripts`, then `npx npm@10.9.9 ci --dry-run`; check the version again when `build.yml`'s Node changes). A lock regenerated with npm 11+ is restructured in a way npm 10 rejects, and every Build platform then fails at `npm ci` with "`npm ci` can only install packages when your package.json and package-lock.json are in sync" followed by `Missing: <package>@<version> from lock file` lines. The jest job runs Node 24 (npm 11), which accepts such a lock, so only the four Build jobs catch it.
- **`plugins-src/` is the plugin source of truth.** Never hand-edit `plugins/*.axe` or the generated fallback module (`src/renderer/lib/fallback-resolvers.generated.js`) — all gitignored; bump `manifest.version` when a plugin changes, or marketplace clients never re-download it. `build-axes.js` also syncs the one TRACKED writer output left (the `marketplace-manifest.json` versions), and a PR must commit it; a check that runs after a hook ran the writer cannot catch a missing commit. ([plugins.md](docs/architecture/plugins.md))
- **`src/renderer/app.js` is the renderer source**; root `app.js` is generated (see Architecture).
- **The local-files scanner must never read an unreadable folder as "everything deleted"**: keep the three guards in `scanner.scanFolder`. ([local-files.md](docs/architecture/local-files.md))
- **Every URL fetched on behalf of a deep link goes through the SSRF guard**, and play commands tear down spinoff/listen-along and clear the queue before starting. ([protocol.md](docs/architecture/protocol.md))
- **A DJ tool needs its registry entry, its `executeDjTool` case, and its context method**, or it is advertised but unimplemented. ([ai-chat.md](docs/architecture/ai-chat.md))
- **The renderer never talks to Discord**; the main process owns the socket, and only https art without credential-shaped query parameters is sent. ([now-playing.md](docs/architecture/now-playing.md))
- **Redirect URIs use the bound auth-server port**, never a hard-coded 8888. ([platform.md](docs/architecture/platform.md))
- **Leaving an Amazon track halts it, never only pauses it.** ([amazon-music.md](docs/architecture/amazon-music.md))

## Renderer patterns

Summary; the full text, with the incidents behind each rule, is in [renderer-patterns.md](docs/architecture/renderer-patterns.md).

- **Track ids come from `trackSlug` / `slug`** (`src/renderer/lib/track-slug.js`). An ASCII-only strip collapses every non-Latin track on a release to one id.
- **Every setState is a full-app render; coalesce bursts.** Per-item writes during a scroll go through `window.createCoalescedUpdater` (`queueTrackSources`, the art writers); hover prefetch waits for a 250ms dwell; header collapse goes through `window.headerCollapseDecision`; derived lists built from big state are component-scope `useMemo`s.
- **A click changes the view before its MusicBrainz lookup**, and only what the user asked for takes the foreground lane: speculative prefetches, covers (`getAlbumArt` defaults to background), bios, photos and refreshes use the background lane (`mbBackground: true`), because every MusicBrainz request starts at most once per 1.1s (two in flight, one always kept for the foreground).
- **Pages are `React.memo`'d modules fed stable props** (Collection, Home, playlist view, artist page, Search). Plain functions go through `useStableHandlers`; `tests/renderer/page-memo.test.js` fails on an unstable prop; a module must load under plain Node (`globalThis`, not `window`, at module scope).
- **Extracted modules use `React.useState`-style qualified hooks**, never bare destructured ones.
- **In the resolver queues, a play click goes first, track resolution next, covers last** (`config.__lane` → `laneRunOptions`; see "Resolver queue lanes" in [playback.md](docs/architecture/playback.md)).
- **Use refs in async callbacks** (`volumeRef`, `isPlayingRef`, `currentTrackRef`, ...) to avoid stale closures.
- **`showToast(message, type, action, options)`**: `options.persistent`, `options.duration` (ms), and `action: { label, onClick }`.
- **Colors come from CSS variables** (`var(--accent-primary)`, `var(--card-bg)`, ...) so both themes work.
- **A `useEffect` / `useMemo` dependency array is evaluated during render**, so everything it names must be declared above it in the component (the TDZ trap).

## Dialog Patterns

All dialogs follow the same pattern: state object with `show` boolean, rendered conditionally in the component tree at z-[60].

- `confirmDialog` (L6581): Simple OK dialog `{ show, type, title, message, onConfirm }`
- `syncDeleteDialog` (L6605): Multi-action dialog `{ show, playlist }`
- `devicePickerDialog` (L4989): Promise-based picker `{ show, devices[], onSelect }`

## Releasing

When tagging a new version, three places must agree on the version string. Missing any one of them ships a build whose internal version disagrees with the git tag:

1. `package.json` — `"version"` field.
2. `package-lock.json` — TWO `"version"` fields at the top (root and the `packages.""` entry). Both must match `package.json`.
3. `RELEASE_NOTES.md` — add a new entry at the top with `# Parachord vX.Y.Z` heading, release date, and grouped highlights. The in-app "What's New" modal renders this file (parsed via the bundled fallback or fetched from GitHub) so users see your bullet points on first launch after upgrade.

Then commit (`X.Y.Z` is conventional for the commit subject), push, and `git tag vX.Y.Z` + `git push origin vX.Y.Z`. The CI build picks up from the tag.

Two release-only failure modes to know about:

- **Apple notarization 403 "A required agreement is missing or has expired"** (surfaces as `Unexpected token 'E', "Error: HTT"... is not valid JSON` from @electron/notarize). Apple periodically requires the account holder to accept an updated agreement at developer.apple.com/account; until then every notarization is refused. Accept it, then `gh run rerun <id> --failed`. Acceptance can take a minute to propagate, so a job that started just before may need one more rerun (v0.9.8 did).
- **VMP signing** (see the Widevine section): release tags set `EVS_REQUIRED=1`, so if EVS is down or the `EVS_*` secrets are missing, the Mac and Windows builds fail on purpose rather than ship a build Apple's licence server would refuse.

## Voice when responding to external contributors

Parachord is a solo-maintainer project. When commenting on issues or PRs from external contributors (anyone other than @jherskowitz), don't use phrases that imply a team: "the maintainers," "we'd appreciate," "the team prefers." That framing reads as evasive once a contributor notices the project is essentially one person, and it understates the bus-factor reality.

The honest framing is also more recruitment-effective. Use first-person singular and admit limits: "I'm the only maintainer right now and X isn't where my expertise is — would love your help." Solo-maintainer projects with self-aware leads attract better contributors than ones pretending to be teams.

This applies to issue triage, PR review, RFC discussion, and any other contributor-facing communication. The single exception is when the comment is on behalf of a specific named co-author (Claude, an external contributor, etc.) — in which case attribute that person rather than using a plural.

## Mobile parity — proactively file the Android ticket

**Every bug fix or behavior change ends with the question.** Before you call one done, ask whether the mobile app may need the same fix or change, and if it might, ask the user whether to write a mobile ticket. Check the mobile code first when you can (a bug desktop just fixed is often still live there), and say what you found. Don't skip the question because the change looks desktop-sized; the exclusions below are the only reasons not to ask.

When desktop ships a new feature or architectural change that the Android client at [Parachord/parachord-mobile](https://github.com/Parachord/parachord-mobile) needs for parity, **offer to file a mobile ticket as part of the same workflow**. Don't wait to be asked; surface the question proactively, then file once the user confirms (or just file it if they've already said "and write a mobile issue" / similar). The Android side has its own agent operating in a separate repo — the issue is the handoff.

### When this applies

Anything that creates a shared invariant or data shape that Android also has to honor, including:

- Sync data-model changes (new playlist fields, new persistence keys, new IPC contracts that the Android-side equivalent has to mirror — see the "Android Parity Requirements" sections in [android-parity.md](docs/architecture/android-parity.md))
- Scrobble payload extensions (LB `additional_info` fields, Last.fm extras) — example: [parachord-mobile#170](https://github.com/Parachord/parachord-mobile/issues/170) mirroring the desktop's `origin_url` / `music_service` / MBID enrichment
- Track / album / artist data-model invariants (new fields, removal tombstones, suppression maps) — example: [parachord-mobile#172](https://github.com/Parachord/parachord-mobile/issues/172) mirroring the track-tombstones architecture from parachord#864 / parachord#865
- Resolver scoring / confidence model changes — `confidence-scoring.js` ↔ `ResolverScoring.kt` byte-equivalence is the strictest mirror requirement
- Achordion-facing endpoints (writer endpoints that the desktop calls and Android should also call, or where Android's submit semantics need to match)
- Protocol surface additions (`parachord://` deep links — see "Android Parity Requirements (protocol play handlers)" in [android-parity.md](docs/architecture/android-parity.md))

### When this does NOT apply

Don't file mobile parity issues for:

- **Desktop-only fixes** — Electron-specific code (AppImage MCP path #867, Linux/Mac/Windows package format quirks, `BrowserWindow` config, IPC surface refactors)
- **Trivial bugs that don't touch shared semantics** — typo fixes, log-line additions, doc-only changes, single-file UI tweaks
- **Anything Android already has** — check before filing; desktop sometimes catches up to Android (e.g. Android shipped correct Spotify DELETE endpoints before desktop #863 fixed the broken `/me/library` endpoint, so no mobile ticket was needed there)

### Ticket shape

Write the Android issue to be **self-sufficient** — the parachord-mobile agent doesn't have desktop's context, so the issue must carry it:

- Reference the desktop PR / commit that shipped the change
- Reproduce the schema decisions (TTL, key shape, persistence-store key names) verbatim, not just "match desktop"
- Include the pure-JS reference module's API surface (function signatures, return shapes) so the Kotlin port has a target
- Note the cross-platform invariant explicitly — what would break if mobile drifted (e.g. "a track tombstoned on desktop reappears via Android's sync re-import")
- Sequence the work — wait for desktop merge before opening, OR open simultaneously with explicit "wait for parachord#XXX to merge first" note
- Same voice as #voice — solo-maintainer first-person, honest about limits, don't imply a team

### Anti-pattern: silent assumption that Android will catch up

The mobile client has lagged behind desktop on multiple invariants in the past — `suppressSync` for playlists, the `syncedFrom` heal for imported playlists, the AM endpoint-degradation rules. Each gap manifested as cross-platform data drift (corruption propagating from buggy client → shared remote → healthy client). **Don't assume "someone will get to it" — file the issue or accept that drift is permanent.** The cost of writing a thorough Android-side ticket is far smaller than the cost of debugging cross-platform sync corruption six months later.
