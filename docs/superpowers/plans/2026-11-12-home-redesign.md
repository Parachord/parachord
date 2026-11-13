# Home Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Home so one click plays something you love. It shows your services' history mixes, freshest-first playlists and blended album picks, Fresh Drops, Critical Darlings and concerts, a dismissable setup checklist, a Home-only announcement slot and an Ask Shuffleupagus prompt.

**Architecture:**
- **Pure logic in libs, tested in isolation.** What Home shows and in what order lives in pure modules under `src/renderer/lib/`: the banner list, the setup checklist, and the Home model (tiles, ordering, badges, example prompt).
- **Presentational components.** Sections render from props-driven components in `src/renderer/components/`. `home-page.js` wires them.
- **Two new data paths.** History mixes come from a new optional plugin method (`getHistoryMixes`). Playlist freshness comes from a stamp written at the one choke point every `local_playlists` write passes through: the split store.

**Tech Stack:** Electron, React (`React.createElement`, no JSX), Tailwind plus CSS variables, Jest (with `--experimental-vm-modules`), `.axe` plugins built from `plugins-src/`.

**Spec:** `docs/superpowers/specs/2026-11-12-home-redesign-design.md`. Read it first. Issue: Parachord/parachord#1350. Mock: "Parachord Home Redesign" canvas, board A (light) and "A · dark mode".

## Delivery

Four PRs, each green on its own, in this order.

| Phase | PR content | Tasks |
|---|---|---|
| **A** | Banner slot, setup checklist, in-app chat origin | 1–4 |
| **B** | The new layout on existing data, skeletons | 5–9 |
| **C** | `getHistoryMixes` in the loader, app and plugins | 10–11 |
| **D** | Playlist freshness stamps | 12 |

Branching:
- **Phase A** builds on `docs/home-redesign-spec` rebased onto `origin/main`, so PR A carries the spec and this plan.
- **Each later phase** branches from `origin/main` after the previous PR merges.
- **Before Phase B**, Phase B's freshness reads fall back to `lastModified`. Phase D only makes them accurate.

## Global Constraints

**Source and build rules**
- Edit `src/renderer/app.js`, never root `app.js` (generated).
- No JSX.
- Extracted modules use `React.useState`-style qualified hooks and load under plain Node (`globalThis`, not `window`, at module scope).
- After adding a Tailwind class: `npm run build:css`, and commit `vendor/tailwind.css`.

**HomePage props and data**
- `HomePage` stays `React.memo`.
- Every new plain-function prop is listed in `HOME_PAGE_HANDLERS` (`home-page.js`) and `homePageHandlers` (`app.js`). `tests/renderer/page-memo.test.js` must pass.
- Every new persisted key goes in `ALLOWED_STORE_KEYS` (`main-process/ipc/store.js`): `home_setup_dismissed` and `cache_history_mixes`.
- All art comes through `getAlbumArt` / `getTrackArt` (background by default). A broken cover goes to `window.reportBrokenAlbumArt`.
- MusicBrainz work started from Home uses the background lane (`mbBackground: true`). Nothing new runs on Home's first-paint path.
- Route by the plugin registry (`resolver-loader.js`), never by service name. Check a capability before calling it.

**Styling**
- Colors come from theme variables only, except two exceptions the spec allows:
  - filled play buttons use `#7c3aed` in both themes;
  - chips and buttons drawn over album art use a light chip with `#111827` text.
- Secondary text is `var(--text-secondary)`, never `var(--text-tertiary)`.
- Banner severity colors (both themes): info `#2563eb`, success `#15803d`, warn `#b45309`, error `#b91c1c`.

**Fixed values from the spec**
- Prompt cap: 500 characters.
- Badge window: 7 days.
- Recent loves: 50.
- Row sizes:
  - Jump back in: 4 tiles.
  - Made from your listening: 6 cards.
  - Your playlists: 6 cards.
  - Albums you might love: 6 cards.
  - Fresh Drops and Critical Darlings: 3 cards each.
  - Concerts: 4 cards.

**Plugins**
- Plugin changes: bump `manifest.version` and commit `marketplace-manifest.json` (written by `node scripts/build-axes.js`).
- Never hand-edit `plugins/*.axe`.

**Git, PRs and docs**
- Stage files by name; never `git add -A`.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Docs change in the same PR as the behavior they describe:
  - `docs/architecture/announcements.md` (A);
  - `docs/protocol-schema.md` and `docs/architecture/protocol.md` (A);
  - `docs/architecture/plugins.md` (C);
  - `docs/architecture/sync.md` and `state-persistence.md` (D);
  - `README.md` / `docs/features/` wherever Home is described (B).

## Review Focus

1. **A brand-new install** (no collection, playlists, services or chat plugin): Home shows the header, Albums you might love when Shuffleupagus answers, Fresh Drops, Critical Darlings, a "Set up Shuffleupagus" button and the import empty card. No blank boxes or bare spinners. *Task 5: `homeSections` empty case. Task 8: smoke render.*
2. **A prompt with `&`, `?`, `#`, quotes or emoji, or over 500 characters**, sent from the Ask box: arrives intact, capped at 500. *Task 4: `buildChatPromptUrl` test.*
3. **A hosted playlist refreshed with the same tracks reordered:** counts as a change (fresh), adds 0, and shows no "+0" badge. *Task 5: `changeBadge`. Task 12: `stampTrackChanges`.*
4. **The playing or queued item is also the freshest playlist or the latest love's album:** Jump back in skips it and takes the next candidate, never a duplicate tile. *Task 5: `jumpBackInTiles`.*
5. **Dismissing the last banner item:** the slot collapses completely. Release notes stay reachable from the setup element, which turns into a What's new link once setup is done (Task 4b). *Task 1: `homeBannerItems`. Task 2: smoke render.*

---

## Phase A

### Task 1: Banner list model

**Files:**
- Create: `src/renderer/lib/home-banners.js`
- Test: `tests/renderer/home-banners.test.js`

**Interfaces:**
- Produces:
  - `BANNER_SEVERITY_COLORS`: `{ info, success, warn, error }` hex strings (values in Global Constraints).
  - `homeBannerItems({ whatsNew, announcements })`: returns `Array<{ id, kind: 'whats-new'|'announcement', title, body, icon, iconUrl, cta, severity }>`.
    - `whatsNew` is `null` or `{ version, title, body }`.
    - `announcements` is the already-filtered `activeAnnouncements` array.
    - What's New comes first, then the announcements in their given order.
    - Its id is `whats-new:<version>`, with severity `'info'`.

- [ ] **Step 1: Write the failing tests.**
  - `homeBannerItems({ whatsNew: null, announcements: [] })` returns `[]`.
  - With `whatsNew: { version: '0.9.14', title: "What's new in 0.9.14" }` and two announcements:
    - three items;
    - `[0].id === 'whats-new:0.9.14'`;
    - `[0].kind === 'whats-new'`;
    - items 1 and 2 keep the announcements' order.
  - An announcement without `severity` gets `'info'`.
  - Every value in `BANNER_SEVERITY_COLORS` has contrast ≥ 4.5 against `#ffffff`. Compute WCAG relative luminance in the test.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/renderer/home-banners.test.js`, expecting "Cannot find module".
- [ ] **Step 3: Implement** the module (CommonJS, plain Node).
- [ ] **Step 4: Run them and see them pass.** Same command.
- [ ] **Step 5: Commit** with the message `feat(home): banner list model with What's New first`.

### Task 2: Home-only banner slot

**Files:**
- Create: `src/renderer/components/home-banner.js`
- Modify:
  - `src/renderer/app.js`: the global banner render (search `// In-app announcement banner`); the `view` telemetry effect after `activeAnnouncements`.
  - `src/renderer/components/home-page.js`
  - `docs/architecture/announcements.md`
- Test: `tests/renderer/home-banner.test.js`

**Interfaces:**
- Consumes: `homeBannerItems`, `BANNER_SEVERITY_COLORS` (Task 1).
- Produces:
  - `HomeBanner({ items, onDismiss(item), onCta(item) })`. It renders `items[0]`, or `null` when `items` is empty.
  - New HomePage props: `bannerItems` (array) and the handlers `dismissHomeBanner` and `openHomeBannerCta`.

Behavior:
- `dismissHomeBanner(item)`:
  - for `kind === 'whats-new'`, sets `whats_new_dismissed_version` as today's What's New dismissal does;
  - otherwise, calls today's announcement dismiss path, telemetry included.
- `openHomeBannerCta(item)`:
  - What's New opens the What's New modal (`setWhatsNewOpen(true)`);
  - an announcement records `cta-click` and opens the URL as today.
- The `view` telemetry effect fires only while `activeView === 'home'`. Keep its per-session dedupe.
- Delete the global banner render, and delete Home's old What's New suggestion card (`home-page.js`, "What's New card").
- The icon falls back as today: `iconUrl`, then `icon`.

- [ ] **Step 1: Write the failing tests.**
  - Render with `react-dom/server` (see `tests/renderer/use-playback-queue.test.js` for the setup):
    - `HomeBanner({ items: [] })` renders `''`;
    - with two items it renders the first title only;
    - the dismiss button has `aria-label="Dismiss announcement"`.
  - Source test: `src/renderer/app.js` no longer contains `// In-app announcement banner`, and the view effect contains `activeView !== 'home'`.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/renderer/home-banner.test.js`.
- [ ] **Step 3: Implement** the component, wire the props and handlers (add them to `HOME_PAGE_HANDLERS` and `homePageHandlers`), and remove the old renders. Update `announcements.md`: it now renders only on Home, and `view` fires when Home paints it.
- [ ] **Step 4: Run the tests and the memo test.** `npx jest tests/renderer/home-banner.test.js tests/renderer/page-memo.test.js`, expecting PASS.
- [ ] **Step 5: Commit** with the message `feat(home): announcements and What's New render in a Home-only slot`.

### Task 3: Setup checklist

**Files:**
- Create:
  - `src/renderer/lib/home-setup.js`
  - `src/renderer/components/home-setup.js`
- Modify:
  - `main-process/ipc/store.js` (add `home_setup_dismissed` to `ALLOWED_STORE_KEYS`)
  - `src/renderer/app.js`: bulk load, state `homeSetupDismissed`, and handler `dismissHomeSetupItem(id)`
  - `src/renderer/components/home-page.js`: delete "Enhance Your Experience" (search `// SECTION: Enhance Your Experience`)
- Test: `tests/renderer/home-setup.test.js`

**Interfaces:**
- Produces:
  - `homeSetupItems({ missingPopularResolvers, lastfmConnected, listenbrainzConnected, spotifyConnected, extensionConnected, isMac, dismissed })`. It returns `{ items: Array<{ id, label, done, action }>, done: number, total: number, visible: boolean }`.
  - Ids, labels and actions, in this order:
    - `resolvers` → "Add more music sources" (`action: 'resolvers'`). Done when `missingPopularResolvers === 0`.
    - `lastfm` → "Connect Last.fm".
    - `listenbrainz` → "Connect ListenBrainz".
    - `spotify` → "Connect Spotify".
    - `browser-extension` → "Install the browser extension". Done unless `extensionConnected === false`, exactly as today.
    - `raycast` → "Add the Raycast extension". Present only when `isMac`.
  - Counting:
    - Dismissed ids drop out of `items` and out of `total`.
    - `visible` is false when every remaining item is done.
  - `HomeSetupButton({ setup, onAction(id), onDismiss(id) })`: the "Finish setting up · {done} of {total}" pill plus its popover, open and closed with `React.useState`.
  - Store key: `home_setup_dismissed` is a `string[]`.

- [ ] **Step 1: Write the failing tests.**
  - Everything connected and `isMac: false` gives `visible === false`.
  - `extensionConnected: null` makes `browser-extension` done.
  - `dismissed: ['raycast']` with `isMac: true` gives `total === 5`.
  - `missingPopularResolvers: 2` gives one `resolvers` item, not done.
  - Source test: `main-process/ipc/store.js` contains `'home_setup_dismissed'`.
  - Render test: `HomeSetupButton` shows `Finish setting up · 2 of 4` for 2 done out of 4.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/renderer/home-setup.test.js`.
- [ ] **Step 3: Implement.**
  - Each `onAction` maps to today's card actions: the resolvers tab, Last.fm and ListenBrainz settings, `openSyncSetupModal('spotify')`, `setExtensionInfoOpen(true)`, `setRaycastInfoOpen(true)`.
  - `dismissHomeSetupItem` appends to the array and persists it.
- [ ] **Step 4: Run them and see them pass.** `npx jest tests/renderer/home-setup.test.js tests/renderer/page-memo.test.js`.
- [ ] **Step 5: Commit** with the message `feat(home): setup checklist replaces the Enhance Your Experience cards`.

### Task 4: Ask Shuffleupagus through `parachord://chat` with an in-app origin

**Files:**
- Modify:
  - `protocol-url.js`: add a builder.
  - `src/renderer/app.js`: protocol callback (search `window.electron.onProtocolUrl(async (url)`), `case 'chat'`, and new handler `askShuffleupagus`.
  - `docs/protocol-schema.md` (AI Chat)
  - `docs/architecture/protocol.md`
- Test: `tests/protocol/chat-origin.test.js`

**Interfaces:**
- Produces:
  - `buildChatPromptUrl(prompt)` in `protocol-url.js` and its `api`. Returns `parachord://chat?prompt=<encodeURIComponent(prompt.slice(0, 500))>`.
  - In `app.js`:
    - The callback becomes `const dispatchProtocolUrl = async (url, { origin = 'external' } = {}) => {…}`.
    - `dispatchProtocolUrlRef.current = dispatchProtocolUrl`.
    - IPC registers `window.electron.onProtocolUrl((url) => dispatchProtocolUrl(url))`. No origin can come from IPC.
  - `askShuffleupagus(prompt)` calls `dispatchProtocolUrlRef.current(buildChatPromptUrl(prompt), { origin: 'home' })`. It goes in `HOME_PAGE_HANDLERS`.
  - `case 'chat'`: when `origin === 'home'`, it calls `handleAiChatSendRef.current(prompt)` directly. Otherwise it shows the existing confirm dialog, unchanged.

- [ ] **Step 1: Write the failing tests.**
  - `buildChatPromptUrl('rock & roll? #1 "yes" 🎸')` round-trips through `new URL(...).searchParams.get('prompt')` to the same string.
  - A 600-character prompt comes back as 500 characters.
  - Source tests on `app.js`:
    - `onProtocolUrl((url) => dispatchProtocolUrl(url))` is present;
    - the chat case contains `origin === 'home'`;
    - `showConfirmDialog` is still reachable when it isn't;
    - no `params.origin` read anywhere in the protocol callback.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/protocol/chat-origin.test.js`.
- [ ] **Step 3: Implement**, and update the two docs:
  - in-app origin skips the confirmation;
  - links from the OS, `/protocol` or the extension always confirm.
- [ ] **Step 4: Run the protocol tests.** `npx jest tests/protocol`, expecting PASS.
- [ ] **Step 5: Commit** with the message `feat(protocol): Home's Ask Shuffleupagus sends through parachord://chat without the external-link confirmation`.

### Task 4b: Release notes move into the setup element (the user's correction)

The banner slot is only for announcements created on the backend and pushed to Parachord and/or Achordion. Release notes never use it. They live in the "Finish setting up" element instead.

**Files:**
- Modify:
  - `src/renderer/lib/home-banners.js`
  - `src/renderer/components/home-banner.js`
  - `src/renderer/lib/home-setup.js`
  - `src/renderer/components/home-setup.js`
  - `src/renderer/app.js`: `bannerItems`, `dismissHomeBanner`, `openHomeBannerCta`, and the new `openWhatsNew`.
  - `src/renderer/components/home-page.js`
  - `docs/architecture/announcements.md`
- Test:
  - `tests/renderer/home-banners.test.js`
  - `tests/renderer/home-banner.test.js`
  - `tests/renderer/home-setup.test.js`

**Interfaces:**
- Banner: `homeBannerItems({ announcements })` returns only `kind: 'announcement'` items. The `whatsNew` input and the `'whats-new'` kind are removed everywhere, including the What's New branches in `dismissHomeBanner` and `openHomeBannerCta`. `bannerViewId` stays.
- Setup model: `homeSetupItems({ …existing, appVersion, whatsNewUnread })` adds `whatsNew: { version, unread }` to its result.
  - What's New is never one of `items`, and never counts toward `done` or `total`.
  - `visible` becomes `mode: 'setup' | 'whats-new'`. It is `'setup'` while any item is open, else `'whats-new'`. The element always renders.
- `HomeSetupButton({ setup, onAction, onDismiss, onOpenWhatsNew })`:
  - In `'setup'` mode:
    - the pill reads "Finish setting up · {done} of {total}", plus an accent dot (`aria-label="New release notes"`) when `setup.whatsNew.unread`;
    - the popover's first row is "What's new in v{version}" with the same dot. It has no ×, and clicking it calls `onOpenWhatsNew`.
  - In `'whats-new'` mode: the pill reads "What's new in v{version}", plus the dot when unread, and a click calls `onOpenWhatsNew` directly, with no popover.
  - Theme variables only.
- `openWhatsNew()` in `app.js`, added to `HOME_PAGE_HANDLERS` and `homePageHandlers`:
  - calls `setWhatsNewOpen(true)`;
  - writes `whats_new_dismissed_version` = the current version (the same write the modal's own dismiss does).
  - `whatsNewUnread` is `whatsNewDismissedVersion !== appVersion`.

- [ ] **Step 1: Write the failing tests.**
  - `homeBannerItems` ignores `whatsNew`, and never outputs `kind: 'whats-new'`.
  - `homeSetupItems`:
    - with everything connected, `mode === 'whats-new'`;
    - with one open item, `mode === 'setup'`;
    - `whatsNew` is never counted in `total`.
  - Render tests:
    - `'setup'` mode shows "Finish setting up" and, when unread, the dot labelled "New release notes";
    - `'whats-new'` mode shows "What's new in v0.9.14".
  - Source check: no `'whats-new'` kind in `app.js`, `home-banner.js` or `home-banners.js`.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement**, and update `announcements.md`: the banner is for backend-pushed announcements only, and release notes live in the setup element.
- [ ] **Step 4: Run the focused tests and page-memo**, then `npm test`.
- [ ] **Step 5: Commit** with the message `fix(home): release notes live in the setup element; the banner is for announcements only`.

Then run `npm test`, open PR A ("Home redesign 1/4"), referencing #1350 and listing the docs changed.

---

## Phase B

### Task 5: Home model

**Files:**
- Create: `src/renderer/lib/home-model.js`
- Test: `tests/renderer/home-model.test.js`

**Interfaces:**
- Produces:
  - `playlistFreshness(p)`: returns a number. It is `p.tracksChangedAt ?? p.lastModified ?? p.createdAt ?? 0`.
  - `freshestPlaylists(playlists, limit = 6)`: sorted by `playlistFreshness`, descending.
  - `recentLoves(tracks, limit = 50)`: sorted by `addedAt` descending. Tracks without `addedAt` go last, in input order.
  - `changeBadge(p, now)`: returns `'+N'` when `p.lastChangeAdded > 0` and `now - p.tracksChangedAt <= 7*86400000`, else `null`.
  - `freshChangeLine(p, now)`: returns a string like `"Daily Brew picked up 12 new tracks this morning"` (wording from the spec), or `null` when `changeBadge` is `null`.
  - `isActiveContext(candidate, { playing, queued })`: returns a boolean.
    - `candidate` is `{ kind: 'playlist'|'album'|'loves'|'mix', id?, mbid?, album?, artist? }`.
    - `playing` and `queued` are playback contexts.
    - Matching: a playlist and a mix by `id`; an album by `mbid`, else by `normalize(album)+normalize(artist)`; loves by context type `'loves'`.
  - `latestLoveAlbum(loves, active)`: returns the first love's `{ album, artist, mbid?, trackTitle }`. It skips loves with no `album` and loves where `isActiveContext({ kind: 'album', … }, active)` is true.
  - `jumpBackInTiles({ playlists, loves, mixes, active })`: returns up to 4 tiles `[{ kind, item, subtitle }]`, in the kind order playlist, loves, album, mix. Each kind takes its first non-active candidate.
  - `playlistSubtitle(p, now)`: returns `"Refreshed <relative time> · since <year of createdAt>"`, for example `"Refreshed 2h ago · since 2023"`. It omits the `· since` part when `createdAt` is missing.
  - `homeSections({ bannerItems, tiles, mixes, playlists, albums, fresh, critical, concerts, concertsLocation })`, all arrays except `concertsLocation` (a string). Returns `{ banner, jump, importCard, mixes, playlists, albums, fresh, critical, concerts, ask }`, each a boolean "renders".
    - Sections with no items are `false`.
    - `concerts` is also `false` when `concertsLocation` is empty.
    - `importCard` is `true` exactly when `tiles` is empty.
    - `ask` is always `true`.
  - `exampleShufflePrompt(artists, seed)`: built from the first 3 artist names with one of 4 fixed phrasings, chosen by `seed % 4`. With no artists it returns `"Make me a playlist for right now"`.
  - `filterBySource(items, sourceId)`: `'All'` returns `items` unchanged.

- [ ] **Step 1: Write the failing tests** with exact values for each function. Include:
  - A renamed playlist (`lastModified` newer, `tracksChangedAt` older) sorts by `tracksChangedAt`.
  - `changeBadge({ lastChangeAdded: 0, tracksChangedAt: now })` is `null`. (Review Focus 3.)
  - `changeBadge({ lastChangeAdded: 12, tracksChangedAt: now - 8*86400000 }, now)` is `null`.
  - `jumpBackInTiles`, where the playing context is the freshest playlist's id: the playlist tile is the second-freshest. (Review Focus 4.)
  - `latestLoveAlbum` skips a love whose album is queued.
  - `homeSections` with everything empty: only `ask` and `importCard` are true, plus `albums` when Shuffleupagus items exist. (Review Focus 1.)
  - `playlistSubtitle({ tracksChangedAt: now - 2*3600000, createdAt: Date.UTC(2023,0,1) }, now)` returns `'Refreshed 2h ago · since 2023'`.
  - `exampleShufflePrompt([], 0)` returns the generic prompt.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/renderer/home-model.test.js`.
- [ ] **Step 3: Implement** (pure; no `window`).
- [ ] **Step 4: Run them and see them pass.**
- [ ] **Step 5: Commit** with the message `feat(home): pure model for tiles, freshness, badges and the example prompt`.

### Task 6: Skeletons

**Files:**
- Create: `src/renderer/components/home-skeletons.js`
- Modify: `tests/ui/loading-skeletons.test.js`

**Interfaces:**
- Produces:
  - `JumpBackInSkeleton()`, `CardRowSkeleton({ count, columns })`, `ConcertRowSkeleton()`.
  - The constants `HOME_TILE_HEIGHT = 72`, `HOME_ROW_CARDS = 6`, `HOME_HALF_ROW_CARDS = 3`, `HOME_CONCERT_CARDS = 4`.
- Skeleton shimmer uses the existing shimmer variables, never hex.

- [ ] **Step 1: Write the failing test** in `loading-skeletons.test.js`: a `describe('Home skeletons match the Home rows')` that reads `home-sections.js` (Task 7) and `home-skeletons.js` and asserts that both use the same `HOME_*` constants and the same `repeat(N, minmax(0, 1fr))` grid strings.
- [ ] **Step 2: Run it and see it fail.** `npx jest tests/ui/loading-skeletons.test.js`.
- [ ] **Step 3: Implement** (the section side lands in Task 7; commit both together if needed).
- [ ] **Step 4: Run it and see it pass**, after Task 7.
- [ ] **Step 5: Commit** with the message `feat(home): loading skeletons for every Home row`.

### Task 7: Section components with per-asset hover actions

**Files:**
- Create: `src/renderer/components/home-sections.js`
- Test: `tests/renderer/home-sections.test.js`

**Interfaces:**
- Consumes:
  - the Task 5 tile and section shapes;
  - the Task 6 constants;
  - `HomeBanner` and `HomeSetupButton`.
- Produces: the props-driven components below, using `React.*` qualified hooks.
  - `JumpBackIn({ tiles, onPlayTile, onContextMenu, onImport })`: the whole tile is a `<button>` that plays. With no tiles it renders the import empty card, whose button calls `onImport`. That card replaces today's "Build Your Collection" card and reuses its action.
  - `AlbumCard({ album, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onHoverPrefetch })`:
    - on hover and `:focus-within`, a dimmed overlay with Add to Playlist / Play / Add to Queue;
    - the play button is 52px and `#7c3aed`;
    - the others are 40px light chips;
    - `onHoverPrefetch` is called after a 250 ms dwell.
  - `PlaylistCard({ playlist, badge, subtitle, onOpen, onPlay, onQueue, onContextMenu })`: Add to Queue and Play at the bottom-right of the art, on hover and `:focus-within`.
  - `SourceFilter({ sources, value, onChange })`: chips with `aria-pressed`.
  - `MixesRow`, `PlaylistsRow`, `AlbumsRow`, `FreshCriticalRow`, `ConcertsRow({ concerts, onOpenTickets })`, `AskShuffleupagus({ initialPrompt, chatAvailable, onAsk, onSetup })`.
    - `MixesRow` and `AlbumsRow` each own a `SourceFilter`. Its state is local to the row.
    - `ConcertsRow` cards take their fields (date, artist, venue, city, ticket sources) from the Concerts page's card in `app.js`. A card click calls `onOpenTickets`, which opens the same ticket flyout the Concerts page opens.
    - Each row's "See all" carries `aria-label="See all in <Page>"` and calls `navigateTo('<view>')`. The views: `playlists`, `recommendations`, `new-releases` (Fresh Drops), `critics-picks`, `concerts`. Check each view id against `navigateTo` callers in `app.js`.
    - `AskShuffleupagus`: an `<input maxLength=500>` with a `<label>`, and a submit button "Ask". With `chatAvailable === false` it renders only a "Set up Shuffleupagus" button.

- [ ] **Step 1: Write the failing tests.**
  - Render each component with `react-dom/server`:
    - `AlbumCard` has three buttons labelled `Add <title> to a playlist`, `Play <title>`, `Add <title> to the queue`;
    - `PlaylistCard` has two;
    - `AskShuffleupagus` with `chatAvailable: false` has no `<input>`.
  - Theme test: the source of `home-sections.js`, `home-skeletons.js`, `home-banner.js` and `home-setup.js` contains no hex neutrals. Match `/#(?:fff|ffffff|111827|374151|4b5563|6b7280|9ca3af|d1d5db|e5e7eb|f3f4f6|f9fafb)\b/i`, allowing only the two listed exceptions, which are marked `// on-art` or `// fill-accent`.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/renderer/home-sections.test.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass**, plus `npx jest tests/renderer/component-render-smoke.test.js`. Add the new modules to that smoke list.
- [ ] **Step 5: Commit** with the message `feat(home): section components with album, playlist and concert hover actions`.

### Task 8: Wire the new Home

**Files:**
- Modify:
  - `src/renderer/components/home-page.js`: replace the body; delete the old sections listed below.
  - `src/renderer/app.js`: new props and handlers; background loads.
- Test:
  - `tests/renderer/home-page-layout.test.js`
  - `tests/renderer/page-memo.test.js` (must still pass)

**Interfaces:**
- Consumes: Tasks 1–7.
- Produces:
  - **New props:** `bannerItems`, `homeSetup`, `concerts`, `concertsLocation`, `mixes` (`[]` until Phase C), `recommendationAlbums`, `chatAvailable`.
    - `recommendationAlbums` is the album items from `flattenRecommendationItems(recommendations.sections)` plus `homeData.aiRecommendations.albums` mapped to `{ …, resolverId: 'shuffleupagus', reason }`. It is a `useMemo` in `app.js`.
  - **New handlers:** `openServicePlaylist(item, sourceName)`, `loadConcerts`, `loadRecommendations`, `askShuffleupagus`, `dismissHomeBanner`, `openHomeBannerCta`, `dismissHomeSetupItem`, `showHomeContextMenu(kind, item)`.
    - `openServicePlaylist` is extracted from the Recommendations page's inline `openRecommendationPlaylist` (search it in `app.js`); both pages then call the one function.
    - `showHomeContextMenu` maps to `window.electron.contextMenu.showTrackMenu` with `type: 'album' | 'playlist'`, as the other pages do.
    - For the recent-loves tile it uses a new `type: 'loves'`. Add that type to the `show-track-context-menu` handler in `main.js` with two items, "Add to Queue" and "Open in Collection" (Collection's songs, newest loved first). They are answered through the existing context-menu action channel.
    - Add every handler to `HOME_PAGE_HANDLERS` and `homePageHandlers`.
  - **Page order:** banner, header (greeting, `freshChangeLine`, `HomeSetupButton`, and Play Collection Radio styled as a play action, with a white circle and play triangle inside a `#7c3aed` pill calling `handleStartCollectionStation`), Jump back in, Made from your listening, Your playlists, Albums you might love, Fresh Drops + Critical Darlings, Concerts, Ask Shuffleupagus.
    - A section renders when `homeSections` says so, and shows its skeleton while its data is loading.
  - **Background loads.** One `useEffect` in `HomePage`, keyed on mount, runs after first paint via `requestIdleCallback`, falling back to `setTimeout(…, 0)`. It calls:
    - `loadRecommendations()` when `recommendations.sections` is empty or stale (the existing cache TTL decides inside the function);
    - `loadNewReleases()`, `loadCriticsPicks()` and `loadConcerts()` when not yet loaded.
  - **Old sections deleted:** Continue Listening, Recently Added, Your Playlists + Friend Activity, Discover, Album/Artist Suggestions (keep `loadAiRecommendations` and its Refresh, now an icon button on Albums you might love), Collection, the gradient hero.

- [ ] **Step 1: Write the failing tests.**
  - Source test on `home-page.js`: these strings are absent: `'Continue Listening'`, `'Recently Added'`, `'Friend Activity'`, `'Enhance Your Experience'`. These are present, in this order: `JumpBackIn`, `MixesRow`, `PlaylistsRow`, `AlbumsRow`, `FreshCriticalRow`, `ConcertsRow`, `AskShuffleupagus`.
  - The background-load effect uses `requestIdleCallback`.
  - `page-memo.test.js` passes with the new handlers.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/renderer/home-page-layout.test.js`.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them and see them pass**, then `npm test`.
- [ ] **Step 5: Commit** with the message `feat(home): the redesigned Home layout`.

### Task 9: Tailwind, docs, live check

**Files:**
- Modify:
  - `vendor/tailwind.css`
  - `README.md` and `docs/features/*` wherever Home's sections are described (search for "Continue Listening" and "Recently Added")

- [ ] **Step 1: Rebuild and test.** Run `npm run build:css` and then `npx jest tests/ci/tailwind-css-fresh.test.js`, expecting PASS.
- [ ] **Step 2: Update the docs** so they describe the new sections.
- [ ] **Step 3: Live check.**
  - Check the ports first: `lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8888|9876|9421|9333|9339) '` must be empty.
  - Launch from the worktree with `npm start -- --remote-debugging-port=9333 --inspect=9339`.
  - Check in light and dark:
    - every section renders or hides;
    - each card type's hover actions work;
    - Ask sends to Shuffleupagus with no dialog;
    - a `parachord://chat?prompt=x` from the terminal (`open "parachord://chat?prompt=x"`) still asks for confirmation.
- [ ] **Step 4: Commit** with the message `docs: Home redesign in the README and feature docs`. Open PR B ("Home redesign 2/4").

---

## Phase C

### Task 10: `getHistoryMixes` in the loader and app

**Files:**
- Modify:
  - `resolver-loader.js`: next to `getRecommendationResolvers` / `getRecommendations`.
  - `src/renderer/app.js`:
    - the meta-service capability gates (search `axe.capabilities?.recommendations && axe.implementation?.getRecommendations`; there are two sites);
    - new `loadHistoryMixes`;
    - Recommendations filtering.
  - `main-process/ipc/store.js` (`cache_history_mixes`)
  - `docs/architecture/plugins.md`
- Test: `tests/resolver/history-mixes-loader.test.js`

**Interfaces:**
- Produces:
  - `resolverLoader.getHistoryMixResolvers()`: resolvers with `capabilities.historyMixes && typeof getHistoryMixes === 'function'`.
  - `resolverLoader.getHistoryMixes(resolverId, configOverride)`: returns `Promise<Array<{ type: 'playlist', id, name, description?, imageUrl?, url }>>`. It is `[]` when the resolver lacks the capability, and it rethrows a plugin throw.
  - `loadHistoryMixes({ forceRefresh })` in `app.js`:
    - per provider, ordered like `recommendationProviders()`;
    - cached in `cache_history_mixes` as `{ providers: { [id]: { items, fetchedAt } } }`, with the same TTL as `CACHE_TTL.recommendations`;
    - a provider that threw keeps its previous cached items.
  - `historyMixIds`: a `useMemo` `Set` of every cached mix id.
  - The Recommendations page drops playlist items whose `id` is in `historyMixIds`. This lets older ListenBrainz plugins keep returning Weekly and Daily Jams to older apps.
  - Home's `mixes` prop becomes the flattened mixes, each with `resolverId` and `resolverName`.
  - Home's background effect also calls `loadHistoryMixes()`.

- [ ] **Step 1: Write the failing tests.**
  - Loader with a fake resolver lacking the capability gives `[]`.
  - With the capability, it returns the plugin's `mixes`.
  - A plugin throw rejects.
  - Source tests:
    - both gates include `capabilities?.historyMixes && axe.implementation?.getHistoryMixes`;
    - `store.js` contains `'cache_history_mixes'`;
    - the Recommendations build filters by `historyMixIds`.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/resolver/history-mixes-loader.test.js`.
- [ ] **Step 3: Implement**, and document the method in `plugins.md`:
  - its return shape;
  - that it throws on failure;
  - that history mixes never go in `getRecommendations` for new plugins.
- [ ] **Step 4: Run them and see them pass**, then `npm test`.
- [ ] **Step 5: Commit** with the message `feat(plugins): getHistoryMixes capability, cache and Recommendations de-duplication`.

### Task 11: Plugins return their history mixes

**Files:**
- Modify:
  - `plugins-src/applemusic/implementation.js` and `manifest.json`
  - `plugins-src/listenbrainz/implementation.js` and `manifest.json`
  - `plugins-src/amazonmusic/implementation.js` and `manifest.json` (only if Step 0 finds shelves)
  - `marketplace-manifest.json`
- Test:
  - `tests/resolver/applemusic-history-mixes.test.js`
  - `tests/resolver/listenbrainz-history-mixes.test.js`

**Interfaces:**
- Consumes: the Task 10 contract (`capabilities.historyMixes: true`, `getHistoryMixes(config)` returning `{ mixes }`).
- Produces:
  - **Apple Music:**
    - `isPlayHistoryMix` moves to module scope, unchanged.
    - `getHistoryMixes` returns those playlists from the same personal-recommendations body, ids `applemusic-playlist-<id>`.
    - A host without the hook returns `{ mixes: [] }`.
    - `getRecommendations` is unchanged.
  - **ListenBrainz:** `getHistoryMixes` returns the newest `daily-jams` and newest `weekly-jams` playlist, using the existing `typeOf`, ids `listenbrainz-playlist-<mbid>`. A failed request throws.
  - Bump each changed plugin's minor version and run `node scripts/build-axes.js`.

- [ ] **Step 0: Amazon (live).** With the user's app closed and the ports free, launch the worktree build and log the Amazon home gql section ids and titles. Never log cookie or csrf values. Look for a play-history shelf.
  - If one is clearly history, add `getHistoryMixes` for it with a test from the captured shape.
  - If not, leave Amazon out and note that in the PR.
- [ ] **Step 1: Write the failing tests.**
  - Apple: a fixture body with Heavy Rotation, Replay and "Chill Mix" gives two mixes.
  - ListenBrainz: a fixture list with daily-jams, weekly-jams and weekly-exploration gives exactly the jams pair, newest of each.
  - A 503 rejects.
- [ ] **Step 2: Run them and see them fail.**
- [ ] **Step 3: Implement**, bump versions, run `build-axes`, and commit `marketplace-manifest.json`.
- [ ] **Step 4: Run them and see them pass**, then `npm test`.
- [ ] **Step 5: Commit** with the message `feat(applemusic, listenbrainz): history mixes for Home`. Open PR C ("Home redesign 3/4").

---

## Phase D

### Task 12: Freshness stamps on every playlist write

**Files:**
- Create: `playlist-freshness.js` (repo root, CommonJS; loaded by `main-process/split-store.js` and required by `src/renderer/app.js`)
- Modify:
  - `main-process/split-store.js` (`set`)
  - `src/renderer/app.js` (`savePlaylistToStore`)
  - `docs/architecture/sync.md`
  - `docs/architecture/state-persistence.md`
- Test: `tests/main-process/playlist-freshness.test.js`

**Interfaces:**
- Produces:
  - `trackIdsOf(playlist)`: returns `string[]` (each track's `id`, in order).
  - `stampTrackChanges(prevList, nextList, now)`: returns `nextList`.
    - Each next playlist whose `trackIdsOf` differs from its previous version (by id; order matters) gets `tracksChangedAt: now` and `lastChangeAdded` set to the count of ids in next but not in prev.
    - A new playlist gets `tracksChangedAt: now` and `lastChangeAdded` set to its track count.
    - An unchanged playlist keeps its existing fields.
    - It also keeps a `tracksChangedAt` that the incoming record already moved forward. That covers the renderer stamping first.
  - `split-store` `set`: when the key is `'local_playlists'` (or is in an object passed to `set`), it writes `stampTrackChanges(current, value, Date.now())`, where `current` is the stored list.
  - `savePlaylistToStore` stamps against `playlistsRef.current`'s copy before saving and updating state, so Home sees the change without a reload.

- [ ] **Step 1: Write the failing tests.**
  - A rename only gives an unchanged `tracksChangedAt`.
  - The same tracks reordered give a stamp with `lastChangeAdded: 0`. (Review Focus 3.)
  - Two tracks added give `lastChangeAdded: 2`.
  - A sync-pull-shaped write (`store.set('local_playlists', list)` through `createSplitStore` with a fake key store) stamps.
  - A 5,000-track playlist diff finishes and is correct. Use `Set`s.
  - Source test: `savePlaylistToStore` calls `stampTrackChanges`, and every other playlist save still goes through `window.buildPlaylistSavePayload`.
- [ ] **Step 2: Run them and see them fail.** `npx jest tests/main-process/playlist-freshness.test.js`.
- [ ] **Step 3: Implement**, and document both fields in `sync.md` and `state-persistence.md`: local only, never pushed to a service.
- [ ] **Step 4: Run them and see them pass**, then `npm test`.
- [ ] **Step 5: Commit** with the message `feat(playlists): tracksChangedAt and lastChangeAdded stamped on every playlist write`. Open PR D ("Home redesign 4/4").

### After PR D merges

Ask the user whether to file the parachord-mobile ticket. Per the CLAUDE.md "Mobile parity" rule, it carries:
- the `getHistoryMixes` contract and the history-mix de-duplication rule;
- the freshness fields and the stamping rule;
- the setup item ids and dismissal key;
- the in-app chat origin rule.
