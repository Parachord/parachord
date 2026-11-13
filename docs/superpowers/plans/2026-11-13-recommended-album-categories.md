# Recommended Albums by Category Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Recommendations page's Albums section shows category subsections under one "Albums" heading: New for you, Based on your listening, Because you like …, From the editors, More albums. This uses the same plugin fields and page layout as #1376's playlist categories.

**Architecture:**
- **Model:** #1376's playlist-only category code in `src/renderer/lib/recommendation-model.js` is generalized into per-type tables (playlist, album) behind generic helpers, so albums split into rows the same way.
- **Page:** the Recommendations view in `src/renderer/app.js` already renders any categorized section as subsections. It gains typed loading-tail tracking and puts Shuffleupagus's placeholder in "Based on your listening".
- **Plugins:** Amazon Music tags its album strategy shelves, and the host tags Shuffleupagus's albums.

**Tech Stack:** Electron renderer, React via `React.createElement` (no JSX), Jest (`--experimental-vm-modules`), `.axe` plugins built from `plugins-src/` by `scripts/build-axes.js`.

**Spec:** `docs/superpowers/specs/2026-11-13-recommended-album-categories-design.md`. Read its "Settled after a builder's read" section. It builds on `docs/superpowers/specs/2026-11-12-recommended-playlist-categories-design.md` (#1376). Ticket: Parachord/parachord#1377.

**Branch:** `docs/album-categories-spec`, which sits on #1376's branch and already holds the spec and this plan. It merges after #1376; open the PR against `main` once #1376 is in. If #1376 has merged by then, merge `origin/main` into this branch first.

## Global Constraints

- **Album categories, order and titles:**
  - `new` → "New for you";
  - `personal` → "Based on your listening";
  - `artist` → "Because you like …" (title from `artistRowTitle`, unchanged);
  - `editorial` → "From the editors";
  - none or unknown → "More albums", key suffix `other`.
- **Album row keys:** `albums:new`, `albums:personal`, `albums:artist`, `albums:editorial`, `albums:other`. With one category present, the section is today's single row: key `type:album`, title `Albums`, `category: null`.
- **Playlists are unchanged:** keys, titles and order exactly as #1376. `new` is valid on albums only. On a playlist it is unknown, so the playlist goes to More playlists. `community` on an album is unknown, so the album goes to More albums. Only playlists keep the `weekly` → personal rule.
- **Same rules as #1376:**
  - `item.category` overrides `section.category`;
  - stamping happens on copies;
  - when providers disagree, the earliest category in that type's table wins;
  - paged items take their section's category;
  - `pageable[].category` is set per row;
  - the filter hides empty rows;
  - with two or more visible rows, each collapsed row shows one row of cards;
  - category rows are subsections (`SectionHeader` `size: 'sub'`) under one section header, 32px apart.
- **Exports:** keep `PLAYLIST_CATEGORIES` and `playlistCategory` exported with their current behaviour; tests and docs reference them.
- **Route by the plugin registry, never by service name.** No `minAppVersion`.
- **Amazon Music → 1.12.0.** #1376 ships 1.11.0, so bump past it. Run `node scripts/build-axes.js` and commit `marketplace-manifest.json`. Never hand-edit `plugins/*.axe`.
- **Code and process rules:**
  - edit `src/renderer/app.js`, never the root `app.js`; no JSX; the model stays pure;
  - stage files by name;
  - commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - no em dashes in new comments, docs or commit messages;
  - tests run with `node --experimental-vm-modules node_modules/jest/bin/jest.js <path>` or `npm test`.

## Review Focus

1. **A playlist and an album share a category name** (`personal`): a page bringing one must not trigger the other row's loading tail. Test in Task 3.
2. **Shuffleupagus thinking while the Albums section already has category rows but no personal row:** one "Based on your listening" placeholder subsection inside Albums, and no separate "Albums" pending slot. Test in Task 3.
3. **Amazon's artist shelf whose albums don't share one artist:** the section keeps `artist` with no `seedArtist`, and the row is titled "Because of artists you like". Test in Task 4.
4. **Playlists after the generalization:** every existing playlist-category test still passes unchanged. Tasks 1 and 2 run the full model suite.
5. **Home's "Albums you might love" with album category rows:** it still lists albums from every row. Test in Task 3.

---

### Task 1: Per-type category tables and helpers

**Files:**
- Modify: `src/renderer/lib/recommendation-model.js`
  - `PLAYLIST_CATEGORIES`, `validCategory`, `playlistCategory` (~L50-66);
  - `CATEGORY_RANK` (~L253);
  - the normalizers' category handling (from #1376 Task 1);
  - `module.exports`.
- Test: `tests/renderer/recommendation-model.test.js`

**Interfaces:**
- Produces:
  - **`ALBUM_CATEGORIES`:** `[{ id: 'new', title: 'New for you' }, { id: 'personal', title: 'Based on your listening' }, { id: 'artist', title: null }, { id: 'editorial', title: 'From the editors' }, { id: 'other', title: 'More albums' }]`.
  - **`CATEGORY_TABLES`:** `{ playlist: PLAYLIST_CATEGORIES, album: ALBUM_CATEGORIES }`.
  - **`categoryFor(type, item, sectionCategory) -> string | null`:**
    - returns `null` for a type with no table;
    - for playlists, `item.weekly` returns `'personal'`;
    - otherwise it returns the first of `item.category` and `sectionCategory` that is valid for the type, else `'other'`;
    - "valid for the type" means an id in that type's table other than `'other'`.
  - **`playlistCategory(item, sectionCategory)`** is now `categoryFor('playlist', item, sectionCategory)`, with the same behaviour.
  - **Normalizers:** an item's `category` is kept when it is valid for that item's type, so albums can now carry `new` / `personal` / `artist` / `editorial`. `section.category` is kept when it is valid for any type. `section.seedArtist` is kept only when `section.category === 'artist'`, as now.

- [ ] **Step 1: Write the failing tests** (`describe('album categories: tables and helpers', ...)`):

```js
test('categoryFor: album values, playlist values, type-specific validity', () => {
  expect(m.categoryFor('album', { category: 'new' }, 'personal')).toBe('new');
  expect(m.categoryFor('album', {}, 'personal')).toBe('personal');
  expect(m.categoryFor('album', { category: 'community' }, undefined)).toBe('other');
  expect(m.categoryFor('playlist', { category: 'new' }, undefined)).toBe('other');
  expect(m.categoryFor('playlist', { weekly: { id: 'w' } }, 'editorial')).toBe('personal');
  expect(m.categoryFor('album', { weekly: { id: 'w' } }, 'editorial')).toBe('editorial');
  expect(m.categoryFor('song', { category: 'personal' }, 'personal')).toBeNull();
  expect(m.playlistCategory({ category: 'community' }, undefined)).toBe('community');
  expect(m.ALBUM_CATEGORIES.map(c => c.id)).toEqual(['new', 'personal', 'artist', 'editorial', 'other']);
});
test('normalizers keep album categories valid for albums only', () => {
  const out = m.normalizeRecommendationSections({ sections: [
    { id: 'n', title: 'New', category: 'new', items: [
      { type: 'album', id: 'a1', name: 'A1', artist: 'X' },
      { type: 'album', id: 'a2', name: 'A2', artist: 'X', category: 'community' },
      { type: 'playlist', id: 'p1', name: 'P1', category: 'new' },
    ] },
  ] }, { resolverId: 'x' });
  const [sec] = out.sections;
  expect(sec.category).toBe('new');
  expect(sec.items[1].category).toBeUndefined();
  expect(sec.items[2].category).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests to make sure they fail.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js -t "album categories"`. Expected: FAIL, because `categoryFor` is not a function.
- [ ] **Step 3: Implement** `ALBUM_CATEGORIES`, `CATEGORY_TABLES`, `categoryFor`, the normalizer validity per type, and the exports. Make `CATEGORY_RANK` a per-type map (`CATEGORY_RANK[type][id]`), and update its one reader in `mergeOwned`.
- [ ] **Step 4: Run the whole model file.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js`. Expected: PASS, including every #1376 playlist test, unchanged.
- [ ] **Step 5: Commit** `src/renderer/lib/recommendation-model.js` and `tests/renderer/recommendation-model.test.js` with message `feat(recommendations): per-type category tables, album categories`.

### Task 2: Album category rows in the model

**Files:**
- Modify: `src/renderer/lib/recommendation-model.js`
  - `stamp` (~L373) and `mergeOwned` (~L253-272);
  - `pageableByCategory` (~L366, ~L419);
  - `playlistCategoryRows` (~L497), generalized;
  - the type loop in `buildRecommendationPage` (~L440-480);
  - `shuffleupagusSection` (~L713).
- Test: `tests/renderer/recommendation-model.test.js`

**Interfaces:**
- Consumes: `categoryFor`, `CATEGORY_TABLES`, `artistRowTitle` (Task 1).
- Produces:
  - **Rows:** the Albums section's `subsections` become category rows exactly like Playlists. Each row has:
    - `key: 'albums:<id>'`, `type: 'album'`, `category: '<id>'`;
    - a title from `ALBUM_CATEGORIES`, or `artistRowTitle(seeds)` for `artist`;
    - `blended`, `sources`, `items` and `pageable` (entries carry `category`), and `canLoadMore`.
  - **Fallback:** with one album category present, a single row with key `type:album`, title `Albums`, `category: null`.
  - **Shared builder:** `categoryRows(type, items, pageableByCategory, order, names)` replaces `playlistCategoryRows`. It returns null for the single-category case. Key prefixes: `playlists:` for playlist, `albums:` for album.
  - **Shuffleupagus:** `shuffleupagusSection` tags its album section `category: 'personal'`.
- How it works:
  - **Stamping:** `stamp` covers albums too, with `category = categoryFor(item.type, item, section.category)` for any type with a table. `seedArtist` is set when the stamped category is `artist`.
  - **Paging:** `pageableByCategory` is keyed by type, then category. A section feeding album rows appears in each album row it feeds.
  - **Merging:** in `mergeOwned`, the earliest-category rule uses the item's type's rank.
  - **Order:** Albums keep today's order rules (round-robin by provider, Shuffleupagus last) before the split.

- [ ] **Step 1: Write the failing tests** (`describe('album category rows', ...)`), building `providers` with `m.normalizeRecommendationSections` and Shuffleupagus with `m.shuffleupagusSection`:
  - **'album rows follow the album order, keys and titles'**
    - Setup: a provider with `new` (1 album), `personal` (1), `editorial` (1) and uncategorized (1) sections.
    - Expect: the album section's keys are `['albums:new', 'albums:personal', 'albums:editorial', 'albums:other']`, titles `['New for you', 'Based on your listening', 'From the editors', 'More albums']`.
  - **'one album category: today's single Albums row'**
    - Setup: only uncategorized albums.
    - Expect: one subsection, key `type:album`, title `Albums`, `category: null`.
  - **'Shuffleupagus albums land in Based on your listening'**
    - Setup: one provider `editorial` album plus `shuffleupagusSection({ albums: [{ title: 'S', artist: 'Y', reason: 'r' }], artists: [] })`.
    - Expect: `albums:personal` holds the Shuffleupagus album.
  - **'an artist album row titles from its seeds'**
    - Setup: a section `{ category: 'artist', seedArtist: 'FIDLAR', items: [album] }` beside a `personal` album.
    - Expect: the `albums:artist` title is `'Because you like FIDLAR'`.
  - **'providers disagree on an album: the earliest album category wins'**
    - Setup: the same album (same artist and name) as `editorial` from A and `new` from B.
    - Expect: it's only in `albums:new`, and `sourceIds` holds both.
  - **'paged albums take their section category'**
    - Setup: `expandedSections` for an `editorial` album section's `pagingKey`, with one raw album, plus a `personal` section.
    - Expect: the paged album is in `albums:editorial`, after the first page.
  - **'playlist rows are unchanged beside album rows'**
    - Setup: a provider sending both a `personal` album section and a `personal` playlist section.
    - Expect: the playlist section has the single `type:playlist` row, and the album section is its single `type:album` row, since each has one category.
    - Then add a `community` playlist and expect `playlists:personal` and `playlists:community`.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js -t "album category rows"`. Expected: FAIL.
- [ ] **Step 3: Implement** the stamping, the typed merge rank and pageable map, `categoryRows`, the album branch in the type loop, and the Shuffleupagus tag.
- [ ] **Step 4: Run the model file and the page's other model readers.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendation-model.test.js tests/renderer/recommendations-wiring.test.js tests/renderer/recommendations-saved-cache.test.js`. Expected: PASS. If a test pins `type:album` as the only Albums key and fails for that reason, update it to the new rule and say so in the commit message.
- [ ] **Step 5: Commit** `src/renderer/lib/recommendation-model.js` and `tests/renderer/recommendation-model.test.js` (plus any updated test) with message `feat(recommendations): albums split into category rows`.

### Task 3: The page, Shuffleupagus's placeholder, and Home

**Files:**
- Modify: `src/renderer/app.js`, Recommendations view:
  - the `lastPageCategories` write, on page arrival (~L28317) and on the exhausted path;
  - `showLoadingTail` in `renderSubsection`;
  - `LLM_TAIL_ROWS`, `llmPlaceholder` and `llmSlot` (~L41100-41102, ~L41969);
  - `renderTypeSection`.
- Test:
  - `tests/renderer/recommendations-wiring.test.js`;
  - `tests/ui/loading-skeletons.test.js`;
  - the Home test that covers `recommendationAlbums`: find it with `grep -rln "recommendationAlbums" tests/`, or add the assertion to `tests/renderer/home-page-layout.test.js`.

**Interfaces:**
- Consumes: `categoryFor` (Task 1); album rows with `sub.category` (Task 2).
- Behaviour:
  - **Typed `lastPageCategories`:** it becomes `[...new Set(result.items.filter(i => i && (i.type === 'playlist' || i.type === 'album')).map(i => `${i.type}:${categoryFor(i.type, i, section.category)}`))]`. `showLoadingTail` for a row with `sub.category` checks `expansion.lastPageCategories.includes(`${sub.type}:${sub.category}`)`.
  - **Where Shuffleupagus's tail goes:** `LLM_TAIL_ROWS` is `new Set(['type:album', 'type:artist', 'albums:personal'])`.
  - **The placeholder subsection.** When `llmLoading`, the album section has category rows (`some(sub => sub.category)`) and no `albums:personal` row is visible, `renderTypeSection` renders a placeholder subsection:
    - a `SectionHeader` with `size: 'sub'`, title "Based on your listening", and no link;
    - one row of card skeletons (`RecommendationCardSkeleton`, count `(recommendationsGridColumns.cards || 6) * 1`, `lines: 2`), with key `albums:personal-pending`;
    - placed after `albums:new` if present, else first.
  - **The "Albums" pending slot.** `llmPlaceholder`, and so `llmSlot`, now applies only when the page has no album section at all. When an album section exists, the tail or the placeholder subsection covers it.
  - **Filtering:** Shuffleupagus's placeholder subsection follows the source filter like the tail does. It shows under All or the Shuffleupagus chip only.

- [ ] **Step 1: Write the failing tests:**
  - **In `recommendations-wiring.test.js`**, `test('album category rows: typed loading tail, Shuffleupagus placeholder in Based on your listening', ...)` asserts that the source contains:
    - the typed `lastPageCategories` expression;
    - `expansion.lastPageCategories.includes(\`${sub.type}:${sub.category}\`)`;
    - `'albums:personal'` in `LLM_TAIL_ROWS`;
    - `'albums:personal-pending'`;
    - the placeholder's title `'Based on your listening'`.
  - **In `loading-skeletons.test.js`**, assert that the placeholder subsection uses `RecommendationCardSkeleton` with `lines: 2` and a count of one row of cards.
  - **In the Home test**, render or exercise `recommendationAlbums` with recommendations whose Albums section has two category rows. Expect albums from both rows.
- [ ] **Step 2: Run the tests to make sure they fail.** Run `node --experimental-vm-modules node_modules/jest/bin/jest.js tests/renderer/recommendations-wiring.test.js tests/ui/loading-skeletons.test.js` (plus the Home test file). Expected: FAIL on the new tests.
- [ ] **Step 3: Implement** the behaviour above.
- [ ] **Step 4: Run the full suite.** Run `npm test`. Expected: PASS.
- [ ] **Step 5: Commit** the changed files by name with message `feat(recommendations): album category rows on the page, Shuffleupagus placeholder`.

### Task 4: Amazon Music tags its album shelves

**Files:**
- Modify:
  - `plugins-src/amazonmusic/implementation.js`: `categoryOf` and the section map from #1376 Task 4;
  - `plugins-src/amazonmusic/manifest.json` → `1.12.0`;
  - `marketplace-manifest.json`, which the build writes.
- Test: `tests/resolver/recommendation-categories-plugins.test.js` (the Amazon harness from #1376).

**Interfaces:**
- Produces, by strategy name, as `strategyName` parses it:
  - **`mp3YmlRecentPlaybackStrategy` and `mp3PrimeAlbumsStrategy`** → `category: 'personal'`.
  - **`mp3ByArtistStrategy`** → `category: 'artist'`. Add `seedArtist` when every album item in the section has the same non-blank `artist`, compared trimmed and without regard to case, using the first item's spelling.
  - **Unchanged:** `playlistStrategy` → `personal` and `mp3CommunityPlaylistsStrategy` → `community`. Any other strategy gets none.

- [ ] **Step 1: Write the failing tests:**
  - **'Amazon maps its album strategies'**: stubbed sections with the ids `uri:///recommendations/browse-home/browse-home_mp3YmlRecentPlaybackStrategy`, `…_mp3PrimeAlbumsStrategy` and `…_mp3ByArtistStrategy`. The artist shelf's albums all have `artist: 'FIDLAR'`, one of them `' fidlar '`. Expect `personal`, `personal`, `artist` with `seedArtist: 'FIDLAR'`, and the version `'1.12.0'`.
  - **'Amazon artist shelf with mixed artists has no seed'**: two different artists. Expect `category: 'artist'`, `seedArtist` undefined.
- [ ] **Step 2: Build and run the tests to make sure they fail.** Run `node scripts/build-axes.js && node --experimental-vm-modules node_modules/jest/bin/jest.js tests/resolver/recommendation-categories-plugins.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement** the mappings and the seed rule, and bump the manifest. Update any test that pins Amazon `'1.11.0'`.
- [ ] **Step 4: Build and run the tests to make sure they pass.** Run `node scripts/build-axes.js && node --experimental-vm-modules node_modules/jest/bin/jest.js tests/resolver/`. Expected: PASS.
- [ ] **Step 5: Commit** `plugins-src/amazonmusic/implementation.js`, `plugins-src/amazonmusic/manifest.json`, `marketplace-manifest.json` and the test, with message `feat(amazonmusic): recommended albums carry their category`.

### Task 5: Docs

**Files:**
- Modify:
  - **`docs/architecture/plugins.md`** ("Recommendations", "Categories"):
    - albums now read `category`;
    - the album table and titles;
    - `new` is album-only and `community` doesn't apply to albums;
    - Shuffleupagus's albums count as personal;
    - Amazon 1.12.0's album strategy mapping and its seed rule;
    - Apple's albums wait on #1378.
  - **`docs/features/RECOMMENDATIONS.md`:**
    - the Albums section's subsections, their titles and the single-row fallback;
    - Shuffleupagus's placeholder in "Based on your listening";
    - the line about each section being one blended row now carves out Albums too.
  - **`docs/architecture/amazon-music.md`** ("Recommendations"): version 1.12.0 and the album strategy tags.

- [ ] **Step 1: Edit the three docs.**
- [ ] **Step 2: Check nothing stale is left.** Run `grep -n "one blended row\|Albums row" docs/features/RECOMMENDATIONS.md docs/architecture/plugins.md`. Expected: no line says Albums is a single blended row without the category exception.
- [ ] **Step 3: Run the full suite.** Run `npm test`. Expected: PASS.
- [ ] **Step 4: Commit** the three docs with message `docs: recommended albums by category`.

### After the tasks

- **Live check:** run the app from the worktree only if the app ports are free. Expect:
  - with Amazon connected, "Based on your listening" (recents and Albums for You) and "Because you like <artist>" (the artist shelf), under one "Albums" heading;
  - Shuffleupagus's placeholder in "Based on your listening" while it thinks.
- **PR:** open it against `main` once #1376 has merged, closing #1377 and listing the docs changed.
- **Mobile ticket:** file it in parachord-mobile after merge, with the album table and titles, `new` being album-only, the seed rule and the fallback.
