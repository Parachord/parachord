# Parachord maintainability refactor — plan

Two structural problems dominate the maintenance cost of this repo:

1. **`app.js` is a 3.2 MB / 67,457-line file whose center of mass is a single
   61,130-line React component** (`const Parachord` at L6325 → close brace at
   L67455). 384 `useState`, 248 `useEffect`, 258 `useRef`, 125 `handle*`
   functions in one closure. Jest excludes it from coverage as a "bundled
   file". CLAUDE.md's architecture map is line-number archaeology that rots on
   every PR — 164 commits touched app.js in the last 6 months.
2. **`.axe` plugins are JSON with implementation functions stored as string
   literals** — e.g. `plugins/spotify.axe`'s `search` is a single 4,349-char
   JSON string on one line. No syntax highlighting, no lint, no diff
   readability, and only testable by eval'ing the string the same way
   `resolver-loader.js` does at runtime.

Both problems already have **proven in-repo solutions that were never
generalized**:

- The dual-load pure-module pattern (`stream-quality.js`, `mbid-lookup.js`,
  `recommendation-blocklist.js`, `sync-providers/confidence-scoring.js`):
  an IIFE that assigns `window.*` AND `module.exports`, loaded by index.html
  before app.js, `require`-able from jest and the main process.
- The `.axe` generator pattern (`scripts/sync-subsonic-axe.js`,
  `scripts/sync-amazon-axe.js`): readable implementation functions in a .js
  file as source of truth; the script writes the pretty `.axe`, the
  byte-identical compact `FALLBACK_RESOLVERS` copy in app.js, and the
  marketplace-manifest entry; `--check` mode + a jest test fail on drift.

This plan generalizes both, plus decomposes `main.js` (396 KB / 9,928 lines)
along the same seams.

## Constraints — what must not change

- **The `.axe` wire format is frozen.** The Android client materializes these
  same strings with its own runtime (`parachord-plugins/<service>.axe`); some
  plugins must stay ES5-level ("engine-portable" — see the note in
  `scripts/sync-subsonic-axe.js`). `plugins/*.axe` stay committed (they're the
  marketplace source via sync-repos.yml) and community edits still land in them
  via reverse-sync.yml.
- **Marketplace hot-push keeps working**: a plugin can update without an app
  release. Nothing here changes that.
- **No behavior change.** Every step is extract-and-rewire; tests stay green
  throughout; each step is independently shippable.
- **The renderer stays a classic-script world.** No ESM-over-file:// (Chromium
  blocks `file://` module imports from the `null` origin — a sharp edge not
  worth fighting). Cross-file references remain globals or, under Track 2b,
  real imports bundled back into one classic script.
- **The window.\* public surface stays.** The ~23 module-scope `window.*`
  assignments in app.js (and the loaders' globals: `resolverLoader`,
  `scrobbleManager`, …) are the seam the main process, protocol handlers,
  mobile notes, and tests all rely on. They are load-bearing; extraction moves
  code behind them, it does not remove them.

---

## Track 1 — `.axe` authoring pipeline: `plugins-src/` + one generator

> **Status: SHIPPED (2026-10-15).** `scripts/build-axes.js` + `plugins-src/` for
> all 23 bundled plugins; the two per-plugin generators
> (`sync-subsonic-axe.js`, `sync-amazon-axe.js`) were absorbed and deleted;
> drift guard in `tests/plugins/axes-drift.test.js`. The migration was proven
> semantics-preserving by an AST-level old-vs-new comparison of all 131 changed
> functions (only difference: prettier's quoted-property-key unquoting) and the
> full jest suite (1712 tests green). app.js changed exactly its 8 FALLBACK
> lines (line count identical, so CLAUDE.md line refs stay valid);
> marketplace-manifest.json byte-unchanged (no version bumps — the .axe churn is
> whitespace/quote-level only, so clients keeping the cached old version are
> running identical code).

**Highest value-to-risk ratio. Self-contained. Do it first.**

### Problem detail

- 23 bundled `.axe` files are hand-edited JSON. Reviews of plugin changes are
  reviews of giant escaped strings.
- Every bundled plugin lives in **three hand-synced places**: `plugins/<id>.axe`
  (pretty), `app.js` `FALLBACK_RESOLVERS` (compact, byte-identical), and
  `marketplace-manifest.json` (version). CLAUDE.md documents the footgun
  ("Critical: Both Files Must Be Updated"). Two plugins already escape this via
  per-plugin generator scripts; the other 21 don't.
- Testing an implementation means `JSON.parse` + `new Function('return ' + src)`
  harnesses (`tests/resolver/subsonic-resolver.test.js#instantiate`).

### Design

```
plugins-src/
  <id>/
    manifest.json        # manifest + capabilities + settings + urlPatterns
    implementation.js     # real module: module.exports = { search, resolve, play, ... }
scripts/
  build-axes.js          # THE generator (replaces sync-subsonic-axe.js +
                         # sync-amazon-axe.js; absorbs their behavior)
```

`node scripts/build-axes.js`:

1. For each `plugins-src/<id>/`, emits `plugins/<id>.axe` — manifest
   pretty-printed exactly as today, each implementation function
   `String(fn)`-serialized, same conventions as the current generator output
   (this is byte-compatible with the wire format; the loader is untouched).
2. Rewrites the `FALLBACK_RESOLVERS` block in app.js's owning source file from
   the generated `.axe` (single flow: source → `.axe` → manifest + fallback —
   the three-way hand-sync becomes one artifact chain).
3. Syncs `marketplace-manifest.json` (version + entry) from the source
   manifest — the "bump both files" footgun disappears.
4. `--check` mode writes nothing, exits non-zero on any drift. Wired into jest
   (extend `tests/plugins/bundled-plugin-consistency.test.js` or add
   `tests/plugins/axes-drift.test.js`) so CI enforces it on every PR.
5. `--import` mode: one-shot reverse direction — parse an existing `.axe`
   (community edit landed via reverse-sync) back into `plugins-src/<id>/` so
   the source of truth absorbs it before the next writer run (the subsonic
   script documents exactly this hazard in its header comment).
6. Per-plugin `es5: true` flag in `manifest.json` → generator runs esbuild
   `--target=es5` over the implementation before serializing, so
   engine-portable plugins stay engine-portable even if authored in modern JS.

Migration of the existing 23 plugins is mechanical: a small importer script
reads each `.axe` (valid JSON — `JSON.parse` is what main.js uses), writes
`plugins-src/<id>/implementation.js` with the function text pretty-printed,
then `build-axes.js` regenerates and the `--check` test proves the round-trip
is byte-stable. Review the initial migration PR per plugin (or in a couple of
batches).

### What this buys

- **Plugin diffs become normal code diffs.** Review happens on
  `plugins-src/*.js`; the `.axe` diff is a generated artifact you verify with
  `--check` instead of reading 4 KB escaped lines.
- **The implementation is a real module** → jest imports and tests the
  functions directly (still passing the same mocked `config`/`window` the
  eval-harness passes today — no test-semantics change).
- **ESLint covers plugin code** (it currently can't lint a JSON string).
- **Drift class eliminated** for manifest/fallback/marketplace copies.
- **Mobile needs nothing** — the wire format is unchanged. No parity ticket.

---

## Track 2 — app.js decomposition

### 2a. Pure logic out of app.js → dual-load modules (no tooling change)

Continue the established pattern aggressively. CLAUDE.md already names the
hand-maintained "SYNCed with tests/helpers/X" byte-copy pairs — each is a
drift bug waiting to happen, and `tests/helpers/confidence-scoring.js` shows
the fix: make the test helper a thin `require()` re-export of the production
module.

Extraction candidates (already pure, already documented, most already have a
test-side mirror):

| Helper (app.js) | Mirror today | Notes |
|---|---|---|
| `parseProtocolTracklist` (~L36978) | `tests/helpers/tracklist-parser.js` | biggest one |
| `classifyPlaylistUrl` (~L219) | `tests/helpers/playlist-url-classify.js` | |
| `window.isPublicHttpUrl` SSRF guard (~L188) | `tests/helpers/url-safety.js` | security-critical — deserves direct tests |
| `hostedPlaylistFetchProblem` (~L220) | same file | |
| `buildPlaylistSavePayload` (module scope) | `tests/sync/playlist-save-payload.test.js` | the "don't drop syncedTo" invariant |
| `decodeBase64Utf8Json` | inline in tests | |
| `getBestSourceConfidence` + the confidence floor trio | inline copy + Kotlin + sync-providers module | make app.js consume the canonical module instead of its inline copy (dual-load pattern) — one less byte-identical copy to hand-maintain; Android's Kotlin stays the other copy |
| `handleImportPlaylistFromUrl`'s URL-type classification, XSPF/JSPF parsing internals | — | after the above |

Method per extraction (the amazon-music-logic precedent):

1. Move the pure code into a root module with the dual `window.*` +
   `module.exports` export.
2. Convert the tests/helpers mirror to a re-export; move/keep tests against
   the module.
3. Rewire app.js call sites to the module (delete the inline copy).
4. Update CLAUDE.md's map (line refs die; module paths replace them).
5. PR is shippable alone; app.js shrinks monotonically; jest coverage starts
   covering code that was excluded while inline.

### 2b. Split the Parachord component (needs a module system — decide bundler first)

The component is 90% of the file. Two things make the split tractable:

1. **Presentational subtrees first (mechanical, low risk).** The tree already
   has large identifiable view blocks — `ReleasePage` alone is ~1,940 lines
   (L4387–6325); each tab view, settings section, and dialog cluster follows.
   These move out as files with explicit props; no state changes.
2. **State domains second, one at a time (higher risk — the stale-closure
   invariants documented across CLAUDE.md live here).** Extract per-domain
   custom hooks (`usePlaybackQueue`, `useSpinoffRadio`, `useSyncPushLoops`,
   `useProtocolCommands`, …), keeping the ref-sync patterns intact. Do NOT
   introduce Context or a state library in the same pass — one axis of change
   at a time.

The open decision is **how files reference each other**:

**Option A — esbuild bundler (recommended).**

- Plain-JS, no JSX required — `React.createElement` code passes through
  untouched; zero code-style change.
- One entry → one output file; index.html still loads exactly one `app.js`;
  the 14 existing script tags before it (vendor React, loaders, …) are
  untouched classic globals the bundle simply references.
- ~100 ms cold builds; `--watch` + sourcemaps for dev; fits the existing
  prebuild chain (`build:css`, `build-native` — the project is already
  build-scripted, this is not a new tax).
- Real `import`/`export` — no window-global choreography at scale, jest imports
  the same source files directly, tree-shaking available later.
- Unlocks the shelved TS plan (`docs/plans/2026-03-04-javascript-to-typescript-migration.md`)
  and kills the remaining hand-synced byte-copy pairs (e.g. the confidence
  floor's app.js inline copy) by importing the canonical module.
- Mechanics: `src/renderer/` tree; `app.js` becomes generated output,
  gitignored (like `collection.json` is today), built by `prebuild` (CI) and
  `prestart` (dev). `build-axes.js` rewrites the `FALLBACK_RESOLVERS` slice in
  its owning src file. `npm run dev:watch` wraps esbuild --watch + electron.
- Costs: dev now has a build step (imperceptible at ~100 ms; prestart makes it
  invisible); anyone grepping the repo sees a generated app.js (built locally,
  so present).

**Option B — no bundler, window-scoped component files.**

- Each extracted component file does `window.ReleasePage = …`, index.html
  gains one script tag per file before app.js (the resolver-loader precedent).
- Preserves the zero-build property entirely; jest needs `@jest-environment
  jsdom` per-component test files.
- Costs: definition-order coupling, `window.*` namespacing everywhere, no
  import graph, and the TS plan stays blocked.

Both are viable; the deciding factor is whether a build step is acceptable
today. If yes, A is strictly better long-term.

---

## Track 3 — main.js decomposition (no new tooling at all)

> **Status: slices 1–5 shipped** — `main-process/ipc/store.js` (allowlist + the
> five `store-*` handlers), `main-process/ipc/musickit.js` (the 21 bridge-
> delegating `musickit:*` handlers; `musickit:token-status` stays with the token
> cluster it diagnoses), `main-process/ipc/local-files.js` (the 12 `localFiles:*`
> handlers incl. the resolveArt renderer→DB translation),
> `main-process/sync-links.js` (the durable link map + migration +
> `sync-links:*` IPC), and `main-process/ipc/sync-create.js` (the
> `sync:create-playlist` three-layer-dedup gateway + `sync:resolve-tracks`,
> with the duplicated provider-token block unified into one injected
> `resolveProviderToken`), `main-process/ipc/sync-start.js` (the ~800-line
> inbound engine: activeSyncs + sync:get-providers / sync:check-auth /
> sync:start / sync:cancel, with the MusicKit generated-token wait unified
> into injected getGeneratedMusicKitToken; tests caught a missing path
> require that plain-Node 26 masked via its path global). Remaining: none — main-process/ipc/sync-playlists.js (fetch/push/cleanup/relink/save/remove/tombstones/follow + getSyncProviderToken) completes the sync surface. Track 3 is done for the sync/store/musickit/localfiles surfaces; main.js keeps the thin channel/state/nway/settings handlers whose support code (channel map, sync-state model, N-way drive) remains the composition root logic.

The main process is CommonJS — plain `require()` works; the extraction
precedent already shipped (`amazon-music-poller.js`, `amazon-music-logic.js`,
`amazon-web-player.js` at 68 KB live outside main.js). Group the IPC handlers
into modules under `main-process/`:

- `main-process/ipc/sync.js` — the `sync:*` surface; the three-layer dedup
  (`sync:create-playlist`) and staggered/cancel logic (all documented in
  CLAUDE.md, all unit-testable once extracted).
- `main-process/ipc/store.js` — `ALLOWED_STORE_KEYS` + the batch get/set handlers
  (the allowlist trap becomes visible and diffable; the
  `tests/store/allowed-store-keys.test.js` contract stays).
- `main-process/ipc/amazon-music.js`, `main-process/ipc/local-files.js`, … — thin handlers
  delegating to the already-extracted service modules.
- Keep main.js as the composition root: window creation, lifecycle, handler
  registration.

Same method as 2a: extract module → tests → rewire. No bundler, no renderer
changes.

---

## Track 4 — guardrails (cheap, compounding)

- **ESLint** (flat config), adopted per-directory: strict on `plugins-src/`,
  `main/`, and extracted root modules from day one; lenient (or off) on app.js
  until it shrinks — avoid a 67k-line reformat diff. Turn on `--fix`-safe
  style rules only for new/extracted code.
- **`// @ts-check` + jsconfig.json** on extracted pure modules, typing via
  JSDoc — the incremental-typing half of the shelved TS plan without any
  migration. `sync-providers/types.js` shows the convention.
- **CI drift gates**: `build-axes --check` (jest), the existing
  bundled-plugin-consistency and allowed-store-keys tests, and the
  byte-identical parity tests stay load-bearing — they now guard generated
  artifacts instead of hand-synced ones.
- **CLAUDE.md upkeep rule**: every extraction PR updates the map (module paths
  replace line numbers). The doc is the architecture map for every agent
  session; keep it truthful or the map rots.

> **Status: Track 2b enabler SHIPPED** — esbuild bundles src/renderer/app.js into the generated, gitignored app.js (IIFE, no transforms; pretest/prestart/predev/prebuild hooks; build-axes owns the FALLBACK block in the source and regenerates the bundle). The component split (presentational subtrees first, then state domains one at a time) is the continuing work on this foundation. **Slices 1–4 shipped (presentational split COMPLETE)** — slice 4: settings-cards.js (ResolverCard, McpSettingsSection, ScrobblerSettingsCard, FriendMiniPlaybar; 15 bare hooks qualified — hygiene: in the bundle the module wrappers share the entry IIFE scope with app.js's hook destructure, so bare hooks resolve by accident and only fail under a plain Node require / jest render); slice 3: cards.js (the card family + ReleaseCard/ReleasePage + generateArtistPattern/PlayTop10Icon/QueueTop10Icon, both icons exported after review caught app.js destructuring non-exports) and lib/hash-string.js; slice 2: track-lists.js (TrackRow, the two windowed lists, getBestSourceConfidence — exported back for the 10 in-component badge sites) + icons.js — the one real runtime bug of the split surfaced here: the pre-component VirtualizedQueueList called Parachord-internal handlePlaylistDragEnd, unreachable from module scope, a ReferenceError on every queue-row drag-end; now a prop; slice 1: ui-atoms.js (Tooltip/FixedTooltip, the SERVICE_LOGO*/ResolverIcon badge kit, ParachordWordmark, PlaybackProgress). Guard tests (tests/renderer/): component-exports.test.js (every name app.js destructures from require('./components/*') must be exported — the non-exported-destructure class throws React #130 at launch and is invisible to lint/jest/bundle) and component-render-smoke.test.js (every module loads under Node with the vendor globals and every component export renders — the bare-hook class). What remains in app.js's pre-component scope: constants (Icons destructure, CONTEXT_PRIORITY, FALLBACK_RESOLVERS (build-axes-owned — never move), CHARTS_COUNTRIES), non-presentational helpers, and the DJ-tools + AI-chat block.

## Suggested order

| Step | What | Why this order |
|---|---|---|
| 1 | Track 1 (`.axe` pipeline) | Self-contained, immediately improves every plugin PR, removes a documented footgun class |
| 2 | Track 3 (main.js) | No tooling decision needed; pure win; can interleave with 2a |
| 3 | Track 2a (pure modules out of app.js) | Steady grind; each step shippable; builds the test seam 2b relies on |
| 4 | Track 2b (bundler decision + component split) | Big one; do after the logic has tests around it and the file has shrunk |

> **Status: Track 4 SHIPPED** — ESLint flat config (strict on main-process/, plugins-src/, the root dual-load modules, and the build scripts; parse-level on the big legacy files; no stylistic rules so lint can never churn a reformat through app.js), jsconfig.json, `// @ts-check` on protocol-url.js (JSDoc-cast window exposure; tsc clean) with the CI typecheck step, and lint+typecheck wired into the Test workflow. Lint found a real bug on its first run: sync-start.js was missing the getChannelOverride injection (fix applied in the sync-start PR itself so no merge window carries it); a registration smoke test (tests/main-process/registration-smoke.test.js) covers the missed-injection and duplicate-channel classes for all six IPC modules at once.

## Explicitly rejected / deferred

- **TypeScript everywhere now** — the shelved plan is good but premature before
  modularization; JSDoc + @ts-check captures most of the win incrementally.
- **JSX conversion** — massive diff noise with no behavioral value; esbuild
  makes it *possible* later, per-file, if ever wanted.
- **State-management rewrite (Context/Redux/zustand) as part of the split** —
  one axis of change at a time; the ref-sync invariants are too subtle to
  mix with a paradigm change.
- **ESM in the renderer without a bundler** — `file://` module CORS in
  Chromium; not worth the sharp edges.
- **Changing the `.axe` format** (e.g. real .js plugins with a manifest sidecar
  shipped directly) — breaks the mobile runtime and the marketplace
  ecosystem's expectations; authoring-side fixes deliver the reviewability
  without touching the wire format.
