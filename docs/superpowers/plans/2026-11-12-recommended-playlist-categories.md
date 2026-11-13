# Recommended Playlists by Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Recommendations page's Playlists section shows a few generic category rows (Made for you, Because you like …, From the editors, From other listeners, More playlists), each blending every service, with plugins declaring each playlist's category.

**Architecture:** Two optional fields join the `getRecommendations` contract (`category`, `seedArtist`). The pure model (`src/renderer/lib/recommendation-model.js`) splits the Playlists section into category rows, with a single-row fallback. The Recommendations view in `src/renderer/app.js` sizes, filters and tails each row on its own. The Apple Music, Amazon Music and ListenBrainz plugins send the fields.

**Tech Stack:** Electron renderer, React via `React.createElement` (no JSX), Jest (`--experimental-vm-modules`), `.axe` plugins built from `plugins-src/` by `scripts/build-axes.js`.

**Spec:** `docs/superpowers/specs/2026-11-12-recommended-playlist-categories-design.md`. Read its "Settled after a builder's read" section: it decides paging, merging and the per-row preview. Ticket: Parachord/parachord#1373.

**Branch:** work on `docs/playlist-categories-spec` (it already holds the spec and this plan) and open one PR against `main`.

## Global Constraints

- **Categories, their order and row titles:**
  - `personal` → "Made for you";
  - `artist` → "Because you like …" (title built from seeds; see Task 1);
  - `editorial` → "From the editors";
  - `community` → "From other listeners";
  - none or unknown → "More playlists", key suffix `other`.
- **Row keys:** `playlists:personal`, `playlists:artist`, `playlists:editorial`, `playlists:community`, `playlists:other`. When only one category has playlists, the section is today's single row, key `type:playlist`, title `Playlists`.
- **The fields affect playlist items only.** `item.category` overrides `section.category`. `seedArtist` counts only on `artist`. `item.weekly` always means `personal`.
- **Route by the plugin registry, never by service name.** The model and page never test a resolver id to place a playlist.
- **No `minAppVersion`.** Bump `manifest.version` for every plugin you change (Apple Music 1.4.1 → 1.5.0, Amazon Music 1.10.0 → 1.11.0, ListenBrainz 1.5.1 → 1.6.0), run `node scripts/build-axes.js`, and commit `marketplace-manifest.json`. Never hand-edit `plugins/*.axe`.
- **Renderer rules:**
  - edit `src/renderer/app.js`, never the root `app.js`;
  - no JSX;
  - the model stays pure and loads under plain Node.
- **Tests and docs:**
  - every test runs with `--experimental-vm-modules`: `node --experimental-vm-modules node_modules/jest/bin/jest.js <path>`, or `npm test` for everything;
  - docs change in the same PR (`docs/architecture/plugins.md`, `docs/features/RECOMMENDATIONS.md`).
- **Git and style:**
  - stage files by name, never `git add -A`;
  - commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - no em dashes in new comments, docs or commit messages.

## Review Focus

1. **A provider section mixing categories** (an Apple group with editorial and personal mixes). Each playlist lands by its own `item.category`, and the section's `pagingKey` appears in each row it feeds, with one fetch chain. Test in Task 2.
2. **Only weekly playlists** (a ListenBrainz-only user, with or without the plugin update). One row, key `type:playlist`, titled `Playlists`, as today. Test in Task 2.
3. **Filtering to a source that fills one category.** The other rows hide; the remaining row keeps its title and gets two rows of cards; nothing re-merges. Test in Task 3.
4. **An uncategorized older plugin beside a categorized one.** Its playlists go to More playlists, once each. Test in Task 2.
5. **Seed names that repeat across providers in different case, are blank, or are missing.** The title follows the 1/2/3/4+ rule and never prints an empty name. Test in Task 1.

---

### Task 1: The contract fields and the category helpers (model)

**Files:**
- Modify: `src/renderer/lib/recommendation-model.js`: `normalizeRecommendationItem` (~L47-122), `normalizeRecommendationSections` (~L128-155), and `module.exports` (~L627).
- Test: `tests/renderer/recommendation-model.test.js`

**Interfaces:**
- Produces:
  - `PLAYLIST_CATEGORIES`: `[{ id: 'personal', title: 'Made for you' }, { id: 'artist', title: null }, { id: 'editorial', title: 'From the editors' }, { id: 'community', title: 'From other listeners' }, { id: 'other', title: 'More playlists' }]`, in this order. The `artist` title is built by `artistRowTitle`.
  - `playlistCategory(item, sectionCategory) -> 'personal' | 'artist' | 'editorial' | 'community' | 'other'`. Precedence: `item.weekly` → `'personal'`; else a valid `item.category`; else a valid `sectionCategory`; else `'other'`. A value is valid when it is one of the four named ids.
  - `artistRowTitle(seeds: string[]) -> string`. It trims, drops blanks, and dedupes without regard to case, keeping the first spelling.
  - The normalizers now keep a valid `category` on playlist items. `normalizeRecommendationSections` keeps a valid `section.category`, and a trimmed non-blank `section.seedArtist` only when the section's category is `'artist'`. Invalid values are dropped, not kept.

- [ ] **Step 1: Write the failing tests** in `tests/renderer/recommendation-model.test.js`:

```js
describe('playlist categories: contract and helpers', () => {
  test('playlistCategory: weekly, then item, then section, then other', () => {
    expect(m.playlistCategory({ weekly: { id: 'w' }, category: 'editorial' }, 'community')).toBe('personal');
    expect(m.playlistCategory({ category: 'editorial' }, 'community')).toBe('editorial');
    expect(m.playlistCategory({}, 'community')).toBe('community');
    expect(m.playlistCategory({ category: 'bogus' }, 'nope')).toBe('other');
    expect(m.playlistCategory({}, undefined)).toBe('other');
  });
  test('artistRowTitle: one, two, three, four or more; blanks and case-repeats dropped', () => {
    expect(m.artistRowTitle(['Radiohead'])).toBe('Because you like Radiohead');
    expect(m.artistRowTitle(['Radiohead', 'Arctic Monkeys'])).toBe('Because you like Radiohead and Arctic Monkeys');
    expect(m.artistRowTitle(['Radiohead', 'Arctic Monkeys', 'The Strokes'])).toBe('Because you like Radiohead, Arctic Monkeys and The Strokes');
    expect(m.artistRowTitle(['A', 'B', 'C', 'D'])).toBe('Because you like A, B, C and more');
    expect(m.artistRowTitle(['Radiohead', ' radiohead ', '', '  ', 'Blur'])).toBe('Because you like Radiohead and Blur');
    expect(m.artistRowTitle([])).toBe('Because of artists you like');
  });
  test('normalizers keep valid category and seedArtist, on playlists only', () => {
    const out = m.normalizeRecommendationSections({ sections: [
      { id: 's1', title: 'Fans Like', category: 'artist', seedArtist: ' Radiohead ', items: [
        { type: 'playlist', id: 'p1', name: 'P1', category: 'editorial' },
        { type: 'album', id: 'a1', name: 'A1', artist: 'X', category: 'editorial' },
      ] },
      { id: 's2', title: 'Odd', category: 'bogus', seedArtist: 'Ignored', items: [{ type: 'playlist', id: 'p2', name: 'P2', category: 'nope' }] },
      { id: 's3', title: 'Mixes', category: 'personal', seedArtist: 'Ignored', items: [{ type: 'playlist', id: 'p3', name: 'P3' }] },
    ] }, { resolverId: 'x' });
    const [s1, s2, s3] = out.sections;
    expect(s1.category).toBe('artist');
    expect(s1.seedArtist).toBe('Radiohead');
    expect(s1.items[0].category).toBe('editorial');
    expect(s1.items[1].category).toBeUndefined();
    expect(s2.category).toBeUndefined();
    expect(s2.seedArtist).toBeUndefined();
    expect(s2.items[0].category).toBeUndefined();
    expect(s3.seedArtist).toBeUndefined();
    expect(m.PLAYLIST_CATEGORIES.map(c => c.id)).toEqual(['personal', 'artist', 'editorial', 'community', 'other']);
  });
});
```

- [ ] **Step 2: Run the tests to make sure they fail.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js -t "playlist categories"`. Expected: FAIL, because `playlistCategory` is not a function.
- [ ] **Step 3: Implement** `PLAYLIST_CATEGORIES`, `playlistCategory` and `artistRowTitle`, the normalizer changes, and the exports, in `src/renderer/lib/recommendation-model.js`.
- [ ] **Step 4: Run the whole model file.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js`. Expected: PASS, every test in the file.
- [ ] **Step 5: Commit** `src/renderer/lib/recommendation-model.js` and `tests/renderer/recommendation-model.test.js` with message `feat(recommendations): category and seedArtist on playlist sections and items`.

### Task 2: Category rows in the Playlists section (model)

**Files:**
- Modify: `src/renderer/lib/recommendation-model.js`: `mergeOwned` (~L205), `buildRecommendationPage` (~L285-401), and the `subsection` builder (~L235, which gains `category`).
- Test: `tests/renderer/recommendation-model.test.js`

**Interfaces:**
- Consumes:
  - `PLAYLIST_CATEGORIES`, `playlistCategory` and `artistRowTitle` (Task 1).
- Produces:
  - **The Playlists section** is `{ type: 'playlist', title: 'Playlists', subsections: Row[] }`.
  - **With two or more categories present,** each `Row` is a `subsection` with:
    - `key: 'playlists:<id>'`, `type: 'playlist'`;
    - `category: '<id>'`;
    - `title`: from `PLAYLIST_CATEGORIES`, or from `artistRowTitle(seeds)` for `artist`;
    - `blended`, `sources` and `items` as today;
    - `pageable`: entries gain `category` (the section's category, or `null`);
    - `canLoadMore`.
  - **With one category present,** there is one row: `key: 'type:playlist'`, `title: 'Playlists'`, `category: null`, exactly today's shape.
  - **Every other subsection** gets `category: null`.
- How it works:
  - **Each playlist gets a category once.** Before merging, stamp each playlist item with `category = playlistCategory(item, its section's category)`. For `artist` items, also stamp `seedArtist` from the section. Paged (`fetched`) items take their paged section's category the same way (spec "Settled" item 1).
  - **Merging keeps the earliest category.** In `mergeOwned`, when a later provider sends a playlist already kept, `existing.category` becomes whichever of the two comes first in `PLAYLIST_CATEGORIES` order (spec "Settled" item 6).
  - **Today's playlist rules run once, first.** The newest-week rule, weekly-first order and `excludePlaylistIds` filter run on the merged playlist list exactly as now. Only then are the items split by `item.category` into rows, in `PLAYLIST_CATEGORIES` order, keeping their relative order. That puts weekly items first in Made for you.
  - **`pageable` per row:** a row lists every provider section whose playlist items (first page or paged) include that row's category.
  - **Seeds:** an `artist` row's seeds are its items' `seedArtist`, in row order.

- [ ] **Step 1: Write the failing tests** (`describe('playlist category rows', ...)`). Build `providers` with `m.normalizeRecommendationSections` as the existing tests do:
  - **'rows follow category order and blend providers'**
    - Setup: provider A has a `personal` section (2 playlists) and a `community` section (1). Provider B has an `editorial` section (1) and an uncategorized section (1).
    - Expect: `section.subsections.map(s => s.key)` to equal `['playlists:personal', 'playlists:editorial', 'playlists:community', 'playlists:other']`, and the matching titles `['Made for you', 'From the editors', 'From other listeners', 'More playlists']`.
  - **'an item category overrides its section, and a mixed section feeds two rows with one pagingKey each'**
    - Setup: a provider in `expandableResolverIds`, with a section `{ id: 'g', title: 'G', category: 'editorial', items: [{ type: 'playlist', id: 'e1', name: 'E1' }, { type: 'playlist', id: 'p1', name: 'P1', category: 'personal' }] }`.
    - Expect: `playlists:personal` holds `p1`, and `playlists:editorial` holds `e1`. Both rows' `pageable` have exactly one entry with `pagingKey: '<resolver>|g'`, carrying `category: 'editorial'`.
  - **'one category: today's single Playlists row'**
    - Setup: only ListenBrainz-shaped weekly items, with no `category` on anything.
    - Expect: `subsections.length === 1`, key `type:playlist`, title `Playlists`, and weekly first.
  - **'weekly items lead Made for you even without a category'**
    - Setup: an uncategorized weekly item from provider A beside provider B's `personal` playlist and an `editorial` one.
    - Expect: `playlists:personal` items start with the weekly item.
  - **'an uncategorized older plugin beside a categorized one'**
    - Setup: provider A uncategorized (2 playlists), provider B `personal` (1).
    - Expect: A's two playlists are in `playlists:other`, appear once on the page, and B's is in `playlists:personal`.
  - **'two providers disagree: the earliest category wins'**
    - Setup: the same playlist id from A as `editorial` and from B as `personal`.
    - Expect: it appears only in `playlists:personal`, with `sourceIds` containing both.
  - **'artist row title from seeds'**
    - Setup: two `artist` sections with `seedArtist` values `'Radiohead'` and `'radiohead'`, plus a third with `'Blur'`, and a `personal` section so there are two rows.
    - Expect: the `playlists:artist` title is `'Because you like Radiohead and Blur'`.
  - **'paged items take their section category'**
    - Setup: `expandedSections` for a `community` section's `pagingKey` with one raw paged playlist with no category, plus a `personal` section elsewhere.
    - Expect: the paged playlist lands in `playlists:community`, after the first-page items.
  - **'history mixes still excluded before the split'**
    - Setup: `excludePlaylistIds` holding a `personal` playlist's id.
    - Expect: it is absent from every row.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js -t "playlist category rows"`. Expected: FAIL.
- [ ] **Step 3: Implement** the stamping, the `mergeOwned` category rule and the row split in `buildRecommendationPage`, plus `category` on `subsection`.
- [ ] **Step 4: Run the model file and the page's other model readers.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js tests/renderer/recommendations-saved-cache.test.js tests/renderer/recommendations-wiring.test.js`. Expected: PASS. `weeklyHomeEntries` already walks every subsection; if a wiring test pins `type:playlist` as the only Playlists key, update it to the new rule and say so in the commit.
- [ ] **Step 5: Commit** `src/renderer/lib/recommendation-model.js` and `tests/renderer/recommendation-model.test.js` (plus any updated wiring test) with message `feat(recommendations): playlists split into category rows`.

### Task 3: The page renders category rows

**Files:**
- Modify: `src/renderer/app.js`, Recommendations view.
  - **`renderSubsection` (~L41905):** the preview count and the loading tail.
  - **`renderTypeSection` (~L41974):** hides rows with nothing to show and passes the per-row card count.
  - **`lastPageTypes` (~L28323):** gets a `lastPageCategories` sibling, also on the exhausted path (~L28296).
- Test: `tests/renderer/recommendations-wiring.test.js` (source markers) and `tests/ui/loading-skeletons.test.js`.

**Interfaces:**
- Consumes:
  - The rows from Task 2, including `sub.category` and the `pageable[].category` entries.
  - `playlistCategory` from Task 1, which `app.js` imports from `./lib/recommendation-model` alongside its existing imports.
- Behaviour, all decided at render after `filterRowBySource`:
  - **Hiding:** in a type section, a row whose filtered items are empty and which isn't loading isn't rendered.
  - **Card rows:**
    - two or more rows still visible in the Playlists section: `cardRows = 1`;
    - otherwise `cardRows = 2` (today's `CARD_ROWS`);
    - the row's `preview` for cards is `(recommendationsGridColumns.cards || 6) * cardRows`;
    - the loading tail's placeholder count and `canExpand` use that same `preview`.
  - **Recording a page:** on each page arrival, `lastPageCategories` is `[...new Set(result.items.filter(i => i && i.type === 'playlist').map(i => playlistCategory(i, section.category)))]`. `section` is the pageable entry, which now carries `category`. The exhausted path sets `lastPageCategories: []`.
  - **The loading tail:** for a row with `sub.category`, `showLoadingTail` also requires `expansion.lastPageCategories` to be missing or to include `sub.category`. Other rows keep the type check.

- [ ] **Step 1: Write the failing tests.** In `tests/renderer/recommendations-wiring.test.js`, `test('playlist category rows: per-row preview, hidden empty rows, tail by category', ...)` reads `src/renderer/app.js` and asserts that it contains:
  - `lastPageCategories: [...new Set(result.items.filter(i => i && i.type === 'playlist').map(i => playlistCategory(i, section.category)))]`;
  - `expansion.lastPageCategories.includes(sub.category)`;
  - a `cardRows` that is `1` when more than one row is visible (match `visibleRows.length > 1 ? 1 : CARD_ROWS`);
  - `preview` computed as `(recommendationsGridColumns.cards || 6) * cardRows` for card rows.

  In `tests/ui/loading-skeletons.test.js`, assert that the loading tail's `Array.from({ length: ... })` for cards uses the row's `preview`, not `SECTION_PREVIEW`.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendations-wiring.test.js tests/ui/loading-skeletons.test.js`. Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** the behaviour above in `src/renderer/app.js`. `renderSubsection(sub, { cardRows })` takes the count from `renderTypeSection`, which computes `visibleRows` once per section.
- [ ] **Step 4: Run the full suite.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Check it live.**
  - **Launch:** check the ports first (`lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(8888|9876|9421|9333|9339) '`). Launch from this worktree only if nothing is listening, and back up `~/.parachord/native-messaging-host` first, restoring it afterwards.
  - **Check:** open Recommendations with Apple Music, Amazon Music and ListenBrainz connected. The Playlists section shows category rows; picking Amazon Music hides the rows it doesn't fill; the remaining row keeps its title and shows two rows of cards.
- [ ] **Step 6: Commit** `src/renderer/app.js`, `tests/renderer/recommendations-wiring.test.js` and `tests/ui/loading-skeletons.test.js` with message `feat(recommendations): category rows on the page, filtered and paged per row`.

### Task 4: Amazon Music and ListenBrainz send categories

**Files:**
- Modify:
  - `plugins-src/amazonmusic/implementation.js`: the `getRecommendations` section map (~L578-586), and `manifest.json` → `1.11.0`;
  - `plugins-src/listenbrainz/implementation.js`: the sections at ~L166-167, and `manifest.json` → `1.6.0`;
  - `marketplace-manifest.json`, which the build writes.
- Test: `tests/resolver/recommendation-categories-plugins.test.js` (new). Use the harnesses from `tests/resolver/amazon-music-resolver.test.js` and `tests/resolver/listenbrainz-history-mixes.test.js`, which load the built `.axe` and stub its bridge and fetch.

**Interfaces:**
- Produces:
  - **Amazon:** a section whose id's strategy name, as the plugin's `isPersonal` already parses it, is `playlistStrategy` gets `category: 'personal'`. `mp3CommunityPlaylistsStrategy` gets `'community'`. Anything else gets no category.
  - **ListenBrainz:** the `weekly-exploration` and `weekly-jams` sections get `category: 'personal'`.

- [ ] **Step 1: Write the failing tests.**
  - **'Amazon maps its playlist strategies'**
    - Stub the bridge to return sections with these ids:
      - `uri:///recommendations/browse-home/browse-home_playlistStrategy`;
      - `uri:///recommendations/browse-home/browse-home_mp3CommunityPlaylistsStrategy`;
      - `uri:///recommendations/browse-home/browse-home_mp3PrimeAlbumsStrategy`.
    - Expect: `category` `'personal'`, `'community'` and `undefined`, and the manifest version `'1.11.0'`.
  - **'ListenBrainz weekly sections are personal'**
    - Expect: both sections have `category: 'personal'`, and the version is `'1.6.0'`.
- [ ] **Step 2: Build and run the tests to make sure they fail.** Run `node scripts/build-axes.js && node --experimental-vm-modules node_modules/jest/bin/jest.js tests/resolver/recommendation-categories-plugins.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** both mappings and bump both manifests.
- [ ] **Step 4: Build and run the tests to make sure they pass.** Run `node scripts/build-axes.js && node --experimental-vm-modules node_modules/jest/bin/jest.js tests/resolver/recommendation-categories-plugins.test.js tests/resolver/listenbrainz-history-mixes.test.js tests/resolver/amazon-music-resolver.test.js`. Expected: PASS. `listenbrainz-history-mixes.test.js` pins the version `'1.5.1'`, so update it to `'1.6.0'`.
- [ ] **Step 5: Commit** the two `implementation.js` files, both `manifest.json` files, `marketplace-manifest.json` and the tests, with message `feat(amazonmusic, listenbrainz): recommended playlists carry their category`.

### Task 5: Apple Music sends categories, plus seed artists if Apple names them

**Files:**
- Modify: `plugins-src/applemusic/implementation.js`: `mapItem`'s playlist branch (~L123-126) and `addGroup` (~L136-149). Bump `manifest.json` to `1.5.0` and commit `marketplace-manifest.json`.
- Test: `tests/resolver/recommendation-categories-plugins.test.js`, using the harness in `tests/resolver/applemusic-history-mixes.test.js`, which stubs `window.appleMusicPersonalRecommendations`.

**Interfaces:**
- Produces:
  - **The `playlistType` mapping:** a playlist item's `category` comes from its `attributes.playlistType`:
    - `personal-mix` → `'personal'`;
    - `editorial` → `'editorial'`;
    - `user-shared` → `'community'`;
    - anything else → none.

    History mixes are still dropped first (`isPlayHistoryMix`).
  - **The seed artist (conditional):** only if Step 1 finds a structured field naming the artist behind an "X Fans Like" group, set `category: 'artist'` and `seedArtist` on that group's section. Its playlists then carry `category: 'artist'`, overriding the `playlistType` mapping. If there is no such field, do nothing for seeds. Never parse the title.

- [ ] **Step 1: Capture Apple's group shape.** Do this once, with the app running and signed in to Apple Music, following Task 3 Step 5's launch rules.
  - **Fetch:** in the renderer, through the Chrome DevTools Protocol, run `await window.appleMusicPersonalRecommendations(25)`.
  - **Record only key names and kinds.** For one "X Fans Like" group, record its `attributes` keys, its `relationships` keys, and whether any relationship holds an `artists` resource. Never print token values.
  - **Write it down** in `docs/architecture/plugins.md`, under Apple Music in "Recommendations". Say which field names the artist, or "no structured seed artist (checked 2026-11-NN)".
- [ ] **Step 2: Write the failing tests.**
  - **'Apple maps playlistType to category'**
    - Stub a group whose contents are three playlists with `playlistType` `personal-mix` (not a history mix: the name `'Chill Mix'`), `editorial` and `user-shared`.
    - Expect: categories `'personal'`, `'editorial'` and `'community'`, and the version `'1.5.0'`.
  - **Only if Step 1 found a field:** **'Apple marks a Fans Like group as artist with its seed'**
    - Stub that field.
    - Expect: the section has `category: 'artist'` and `seedArtist`.
  - **Otherwise:** **'Apple sends no artist category'**
    - Expect: no section has `category: 'artist'`.
- [ ] **Step 3: Build and run the tests to make sure they fail.** Run `node scripts/build-axes.js && node --experimental-vm-modules node_modules/jest/bin/jest.js tests/resolver/recommendation-categories-plugins.test.js -t Apple`. Expected: FAIL.
- [ ] **Step 4: Implement** the mapping and bump the manifest. Update any Apple test that pins `'1.4.1'`.
- [ ] **Step 5: Build and run the tests to make sure they pass.** Run `node scripts/build-axes.js && node --experimental-vm-modules node_modules/jest/bin/jest.js tests/resolver/`. Expected: PASS.
- [ ] **Step 6: Commit** `plugins-src/applemusic/implementation.js`, `plugins-src/applemusic/manifest.json`, `marketplace-manifest.json`, the test, and the `plugins.md` capture note, with message `feat(applemusic): recommended playlists carry their category`.

### Task 6: Docs

**Files:**
- Modify:
  - **`docs/architecture/plugins.md`, the "Recommendations" contract paragraph:**
    - the `category` and `seedArtist` fields and their rules (playlists only, item overrides section, `weekly` means personal, unknown means none, no `minAppVersion`);
    - each plugin's mapping, with the versions.
  - **`docs/features/RECOMMENDATIONS.md`:**
    - the Playlists section's category rows, their order and titles, and the single-row fallback;
    - the collapsed-height rule (one row of cards per row when two or more show, after filtering);
    - the filter hiding empty rows;
    - the line "Each section is one blended row" carves out Playlists.

- [ ] **Step 1: Edit both docs.**
- [ ] **Step 2: Check nothing stale is left.** Run `grep -n "one blended row\|Playlists row" docs/features/RECOMMENDATIONS.md docs/architecture/plugins.md`. Expected: no line says Playlists is a single blended row without the category exception.
- [ ] **Step 3: Run the full suite.** Run `npm test`. Expected: PASS.
- [ ] **Step 4: Commit** both docs with message `docs: recommended playlists by category`.

### After the tasks

- Open one PR from `docs/playlist-categories-spec` to `main`, closing #1373, and listing the docs changed.
- Once it merges, file the mobile ticket in Parachord/parachord-mobile. Carry the field definitions, the category order and titles, the seed-title rule, the single-row fallback, `weekly` means personal, and the plugin versions. Mobile runs the same plugins, so only its page needs the rows.
