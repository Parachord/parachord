# Recommendations Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Recommendations page becomes five type sections (Songs, Albums, Artists, Playlists, Friends). Each starts with a blended "For you" row whose source tags filter it, followed by the providers' named rows. The weekly ListenBrainz playlists move there from Home, and similar listeners come from ListenBrainz and Last.fm.

**Architecture:**
- The pure model (`src/renderer/lib/recommendation-model.js`) turns the provider answers into sections of subsections. It stays filter-free; source filters are applied at render through a pure helper.
- Two plugin capabilities carry the new data:
  - the ListenBrainz plugin's `getRecommendations` gains the weekly playlist sections;
  - a new `similarUsers` capability (`getSimilarUsers`) is implemented by ListenBrainz (its API) and Last.fm (friends-of-friends plus a taste score).
- The renderer fetches, caches and renders through the existing paths (`loadRecommendations`, `cache_recommendations`, `refreshMergedRecommendations`).

**Tech Stack:** Electron renderer, React via `React.createElement` (no JSX), Tailwind, jest. Plugins live in `plugins-src/` and are built by `scripts/build-axes.js`.

**Spec:** `docs/superpowers/specs/2026-11-11-recommendations-redesign-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Work in the worktree `../parachord-recs-redesign` (branch `feat/recommendations-redesign`). Stage files by name, never `git add -A`.
- Edit `src/renderer/app.js`, never the generated root `app.js`. Plugins are edited only in `plugins-src/`; bump each changed plugin's `manifest.version` and commit `marketplace-manifest.json` after `node scripts/build-axes.js`.
- Route by the plugin registry, never by service name: providers are found by `capabilities.similarUsers` / `capabilities.recommendations`.
- Section order, verbatim: Songs, Albums, Artists, Playlists, Friends. A section with no subsections doesn't render.
- Preview sizes stay 6 cards and 5 song rows.
- "See all" / "Show less" use Home's link classes, exactly: `text-sm text-purple-600 hover:text-purple-700 font-medium`.
- Source tags:
  - plain label: `text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded` over `var(--placeholder-bg)` / `var(--text-secondary)`;
  - filter tags: a real `<button>` with `aria-pressed`. Colors come only from CSS variables.
- **No Shuffleupagus Refresh button on this page.** No per-item source badges. No item counts beside titles.
- Filters last for the session only and are never persisted.
- Friends drops: people the user already follows, people the user removed (`hiddenFriendKeys`, `friendKey(service, username)`), and the user themself. Last.fm also drops the user's own Last.fm friends.
- Last.fm's Friends work, in numbers:
  - candidates: friends of up to 20 of your Last.fm friends, from one page of up to 50 each; the top 30 by mutual-friend count are scored;
  - score: `user.getTopArtists` with period `6month` and limit 50, cosine similarity with rank weight `1 / (1 + rank)`, and anyone under 0.05 dropped;
  - pacing: at most 4 requests a second, and a 429 or any failed request throws.
- The Last.fm API key never appears in a log line.
- No em dashes in new user-facing copy. Comments explain why, citing the spec where it decided something.
- Every layout change ships with its matching skeleton (CLAUDE.md).

## Review Focus

1. **An all-duplicate source.** When every pick a source sent is also another source's, its tag still shows, and turning the other source off keeps the shared item visible. Pinned in Task 1.
2. **A provider older than this change**, such as a marketplace ListenBrainz plugin without `getSimilarUsers` or the weekly sections. The page renders with no Friends and no weekly rows, and no error toast. Pinned in Task 4.
3. **Two open splits of one Amazon section.** Opening "Hot Playlists" in Playlists and the same section's split in Albums never fetches one page twice or appends it twice. Pinned in Task 4.
4. **A stale cached Friends answer that now includes someone you followed since.** That person is gone on the next merge without a refetch. Pinned in Task 1, since the exclusions apply at merge.
5. **Last.fm with no Last.fm friends, or a 429 mid-run.** No friends gives `[]` with no further requests. A 429 throws, so nothing empty is cached. Pinned in Task 3.

---

### Task 1: The grouped display model

**Files:**
- Modify: `src/renderer/lib/recommendation-model.js`
- Test: `tests/renderer/recommendation-model.test.js`. Replace the `buildRecommendationSections` describe block; keep the rest.

**Interfaces:**
- Produces:
  - `TYPE_SECTIONS`: `[{type:'song',title:'Songs'},{type:'album',title:'Albums'},{type:'artist',title:'Artists'},{type:'playlist',title:'Playlists'},{type:'friend',title:'Friends'}]`.
  - `buildRecommendationPage({ providers, shuffleupagus, expandedSections, expandableResolverIds, similarUsers, exclude })` returns `Section[]`.
    - `Section = { type, title, subsections: Subsection[] }`.
    - `Subsection = { key, type, title, description, blended, sources:[{id,name}], resolverId, resolverName, sectionId, pagingKey, canLoadMore, nextCursor, items }`.
    - `pagingKey` is `${resolverId}|${sectionId||title}`, and it is null for For you rows.
    - `similarUsers`: `[{ resolverId, resolverName, users:[{username, similarity, avatarUrl?}] }]`.
    - `exclude`: `{ friendKeys: Set<string>, selfKeys: Set<string> }`, keys in `friendKey` form `service:username-lowercased`.
  - Every merged item carries `sourceIds: string[]`, the first-seen provider first.
  - Friend items: `{ type:'friend', id:'similar:<service>:<username>', name:username, service, similarity, avatarUrl, resolverId }`, where `service === resolverId`.
  - `filterSubsectionItems(subsection, offIds: Set<string>)` returns `items[]`. An item is dropped only when every one of its `sourceIds` is in `offIds`.
  - `flattenRecommendationItems(sections)` returns every subsection's items, in page order.
  - `normalizeRecommendationItem` also passes through `raw.weekly` when it is `{ id: string, contextType: 'weekly-jam'|'weekly-exploration', label: string, weekLabel: string, date?: string }`.
  - `buildRecommendationSections` and `GENERIC_BUCKET_ORDER` are removed. `shuffleupagusSection` stays as is.

- [ ] **Step 1: Write the failing tests** in `describe('buildRecommendationPage')`:
  - `test('sections come in the five-type order and empty ones are left out')`: song and album inputs only, so `page.map(s => s.type)` is `['song','album']`.
  - `test('For you interleaves providers round-robin with Shuffleupagus last')`: lastfm sends untitled songs `[a,b,c]`, listenbrainz `[d,e]`, so the For you song names are `['a','d','b','e','c']`. Album inputs from listenbrainz `[x,y]` and Shuffleupagus `[s1,s2]` give `['x','s1','y','s2']`.
  - `test('a duplicate keeps the first provider and records every source')`: the same song from lastfm and listenbrainz gives one item with `sourceIds` `['lastfm','listenbrainz']`, and the row's `sources` ids are `['lastfm','listenbrainz']`.
  - `test('a Shuffleupagus duplicate keeps its reason on the merged item')`.
  - `test('derived artists join Artists For you with the song provider as source')`.
  - `test('a mixed titled section splits by type and every split shares one pagingKey')`: amazon section `{id:'s1', title:'Hot', items:[playlist, album]}` gives subsections keyed `amazonmusic:s1:playlist` and `amazonmusic:s1:album`, both with `pagingKey` `'amazonmusic|s1'`. They come after For you in their sections.
  - `test('expanded items land only in the split of their type')`.
  - `test('weekly sections come first among Playlists titled rows, Exploration before Jams')`: listenbrainz titled sections with ids `weekly-jams` and `weekly-exploration`, plus an amazon playlist section, give Playlists keys in this order: For you if any, then `listenbrainz:weekly-exploration:playlist`, `listenbrainz:weekly-jams:playlist`, then amazon.
  - `test('Friends drops followed, removed and self, and blends providers round-robin')`: `exclude.friendKeys` has `'lastfm:bob'` and `exclude.selfKeys` has `'listenbrainz:me'`. Those two never appear, and the Friends subsection is `blended: true` with sources lastfm and listenbrainz.
  - `test('Friends with one provider is a single-source row')`: `blended` is false.
  - `test('filterSubsectionItems hides an item only when every source is off')`.
  - `test('filterSubsectionItems on one row never touches another')`: the helper is pure, and the other subsection is unchanged.
  - `test('flattenRecommendationItems returns every item in page order')`.
  - `test('normalizeRecommendationItem keeps a valid weekly field and drops a malformed one')`.

- [ ] **Step 2: Run them and confirm they fail.** Run `node --experimental-vm-modules node_modules/.bin/jest tests/renderer/recommendation-model.test.js`. Expect them to fail with `buildRecommendationPage is not a function`.

- [ ] **Step 3: Implement the exports above.** Deduping uses `recommendationItemKey` per type: the first item wins position and fields, later duplicates add their `resolverId` to `sourceIds`, and a later Shuffleupagus `reason` is copied when the kept item has none. The For you interleave takes one item per provider per round, in the order of `providers`, with Shuffleupagus appended as the last provider. Friend items get their own key `${service}:${username.toLowerCase()}` for exclusion and dedupe. Update the module header comment to describe the new shape.

- [ ] **Step 4: Run them and confirm they pass**, with the same command. Expect PASS.

- [ ] **Step 5: Commit** with `git add src/renderer/lib/recommendation-model.js tests/renderer/recommendation-model.test.js` and `git commit -m "feat(recommendations): five type sections with blended For you rows"`.

---

### Task 2: ListenBrainz plugin: weekly sections and similar users

**Files:**
- Modify: `plugins-src/listenbrainz/implementation.js` and `plugins-src/listenbrainz/manifest.json` (`version` goes to `1.3.0`, and `capabilities.similarUsers: true` is added).
- Modify: `marketplace-manifest.json`, through the build script.
- Test: `tests/resolver/listenbrainz-recommendations.test.js`. If a ListenBrainz plugin test already exists under `tests/resolver/`, extend it instead.

**Interfaces:**
- Produces:
  - `getRecommendations(config)` returns `{ sections }`, where `sections` is today's untitled songs section followed by up to two titled sections:
    - `{ id:'weekly-exploration', title:'Weekly Exploration', items }`;
    - `{ id:'weekly-jams', title:'Weekly Jams', items }`.
    - Each has at most 4 playlist items, newest first: `{ type:'playlist', id:<playlistId>, name:<weekLabel>, url:'https://listenbrainz.org/playlist/<playlistId>/', weekly:{ id, contextType:'weekly-exploration'|'weekly-jam', label:'Weekly Exploration'|'Weekly Jams', weekLabel, date } }`.
    - `weekLabel` is one of `This Week`, `Last Week`, `2 Weeks Ago`, `3 Weeks Ago`.
    - The data comes from one call to `GET /1/user/{u}/playlists/createdfor?count=100`, matched by title with the same rules as today's `loadWeeklyPlaylists`. A failed request throws.
  - `getSimilarUsers(config)` returns `[{ username, similarity }]`, sorted by similarity descending. It reads `GET /1/user/{u}/similar-users`. With no username it returns `[]` and makes no request; a failed request throws.

- [ ] **Step 1: Write the failing tests.** Load the implementation the way the existing resolver tests do (check `tests/resolver/` for the helper that materializes a plugin function).
  - `test('weekly sections: four newest of each, labels in order, Exploration and Jams ids')`.
  - `test('no weekly playlists: only the songs section')`.
  - `test('createdfor failure throws')`.
  - `test('getSimilarUsers maps and sorts the similar-users answer')`.
  - `test('getSimilarUsers without a username makes no request')`.

- [ ] **Step 2: Run them and confirm they fail.** Run `node --experimental-vm-modules node_modules/.bin/jest tests/resolver/listenbrainz-recommendations.test.js` and expect FAIL.

- [ ] **Step 3: Implement both functions.** Each function materializes in isolation, so the `fetchListenBrainz` retry helper is embedded per function, as the file's header says. The new `createdfor` fetch goes after the existing playlist pick.

- [ ] **Step 4: Run them and confirm they pass**, then run `node scripts/build-axes.js`.

- [ ] **Step 5: Commit** with `git add plugins-src/listenbrainz/implementation.js plugins-src/listenbrainz/manifest.json marketplace-manifest.json tests/resolver/listenbrainz-recommendations.test.js` and `git commit -m "feat(listenbrainz): weekly playlist sections and similar users"`.

---

### Task 3: Last.fm plugin: similar users from friends-of-friends

**Files:**
- Modify: `plugins-src/lastfm/implementation.js` and `plugins-src/lastfm/manifest.json` (`version` goes to `1.2.0`, and `capabilities.similarUsers: true` is added).
- Modify: `marketplace-manifest.json`.
- Test: `tests/resolver/lastfm-similar-users.test.js`.

**Interfaces:**
- Consumes: `config = { username, apiKey, excludeUsernames?: string[] }`. Task 4 supplies `apiKey` and `excludeUsernames` (the lowercased usernames already followed or removed on Last.fm).
- Produces: `getSimilarUsers(config)` returns `[{ username, similarity, avatarUrl }]`, sorted by similarity descending. It returns `[]` with no request when `username` or `apiKey` is missing.

- [ ] **Step 1: Write the failing tests**, each with a mocked `fetch` keyed by method and user:
  - `test('candidates are friends of friends ranked by mutual count, top 30 scored')`;
  - `test('reads at most 20 friends lists')`;
  - `test('drops self, your Last.fm friends and excludeUsernames')`;
  - `test('cosine with rank weights: identical lists score 1, disjoint score 0, cutoff 0.05')`, on fixed artist lists;
  - `test('avatar is the largest image')`;
  - `test('no friends: [] after one request')`;
  - `test('a 429 throws')`;
  - `test('never more than 4 requests in any 1000ms')`, using jest fake timers and the recorded call times;
  - `test('the API key never reaches console output')`, which spies on `console.*`.

- [ ] **Step 2: Run them and confirm they fail.** Run `node --experimental-vm-modules node_modules/.bin/jest tests/resolver/lastfm-similar-users.test.js`.

- [ ] **Step 3: Implement `getSimilarUsers`.**
  - It calls `ws.audioscrobbler.com/2.0/` with `user.getfriends` (limit 50) and `user.gettopartists` (period `6month`, limit 50), each with `format=json`.
  - The pacer is a small serial queue that waits so that no more than 4 requests start in any 1000ms window.
  - The score is a cosine over the union of artist names, compared lowercased, with weight `1/(1+rank)`, where rank is 0-based.

- [ ] **Step 4: Run them and confirm they pass**, then run `node scripts/build-axes.js`.

- [ ] **Step 5: Commit** with `git add plugins-src/lastfm/implementation.js plugins-src/lastfm/manifest.json marketplace-manifest.json tests/resolver/lastfm-similar-users.test.js` and `git commit -m "feat(lastfm): similar users from friends of friends"`.

---

### Task 4: Fetching, caching and the model's readers in the renderer

**Files:**
- Modify: `resolver-loader.js`, next to `getRecommendationResolvers` (around L386-L440).
- Modify `src/renderer/app.js`:
  - the meta-service gate (around L8528 and L8654);
  - `_fetchResolverConfig` (around L12614);
  - `loadRecommendations` and `saveRecommendationsCache` (around L27180-L27360);
  - `refreshMergedRecommendations` (around L27120);
  - `loadMoreRecommendationSection` and the auto-paging effect (around L27421 and L27503);
  - the readers at about L19328, L23151, L23169, L27165 and L31286;
  - delete `loadWeeklyPlaylists` and the Home weekly effect (around L27544-L27648).
- Test: `tests/renderer/recommendations-wiring.test.js` (extend), `tests/resolver/similar-users-capability.test.js` (new), and `tests/renderer/recommendations-saved-cache.test.js` (extend).

**Interfaces:**
- Consumes: Task 1's `buildRecommendationPage`, `flattenRecommendationItems`; Task 2/3's `getSimilarUsers`.
- Produces:
  - `ResolverLoader#getSimilarUsersResolvers()` returns the resolvers with `capabilities.similarUsers` and a `getSimilarUsers` function.
  - `ResolverLoader#getSimilarUsers(resolverId, config)` returns `users[]`, or `[]` when the capability is missing. It rejects when the plugin throws.
  - `recommendations.sections` now holds the `Section[]` from Task 1, and every reader goes through `flattenRecommendationItems`.
  - The saved cache value becomes `{ providers, similarUsers: { [id]: { users, fetchedAt } }, savedAt }`. Old caches with no `similarUsers` still load.
  - `homeData.weeklyJams` / `weeklyExploration` are set from the ListenBrainz weekly sections' `item.weekly` entries, in Home's old entry shape `{ id, title: label, weekLabel, description, date, tracks: [], tracksLoaded: false }`. Entries that already loaded their tracks keep them.
  - The paging in-flight guard is keyed by `subsection.pagingKey`.

- [ ] **Step 1: Write the failing tests.**
  - In `similar-users-capability.test.js`:
    - `test('getSimilarUsers answers [] for a resolver without the capability')`;
    - `test('getSimilarUsersResolvers lists only capable resolvers')`.
  - In `recommendations-wiring.test.js` (source-marker style):
    - the meta-service gate admits `similarUsers && getSimilarUsers`;
    - `_fetchResolverConfig` gives `lastfm` the key from `getLastfmApiKey()`;
    - `loadRecommendations` checks `getSimilarUsersResolvers` before calling, never names a service, and passes `excludeUsernames`;
    - `loadMoreRecommendationSection` guards on `section.pagingKey`;
    - all five readers call `flattenRecommendationItems`;
    - `loadWeeklyPlaylists` no longer exists, and no `playlists/createdfor` URL is left in `app.js`.
  - In `recommendations-saved-cache.test.js`:
    - `test('a cache without similarUsers loads')`;
    - `test('similarUsers entries older than recommendationsStale are not saved')`.

- [ ] **Step 2: Run them and confirm they fail.** Run `node --experimental-vm-modules node_modules/.bin/jest tests/renderer/recommendations-wiring.test.js tests/resolver/similar-users-capability.test.js tests/renderer/recommendations-saved-cache.test.js`.

- [ ] **Step 3: Implement.**
  - The similar-users fetch runs inside `loadRecommendations`'s existing `Promise.all`, under the same 20s bound and generation guard, and only on a full load (never `metaServicesOnly`).
  - `exclude` is built from `friends` (`friendKey(f.service, f.username)`), `hiddenFriendKeys`, and the user's own usernames from `metaServiceConfigs`. It is applied at every merge, so a follow made since the cache was filled takes effect at once.
  - Mention `cache_recommendations`'s new field in its `ALLOWED_STORE_KEYS` comment, if the key has one there; the key itself is already allowed.

- [ ] **Step 4: Run the full suite with `npm test`.** Expect every suite to pass. The page render still reads the old shape until Task 5, so fix only compile-level breaks there, and keep the page rendering a flat list from `flattenRecommendationItems` in the meantime.

- [ ] **Step 5: Commit** with `git add resolver-loader.js src/renderer/app.js tests/renderer/recommendations-wiring.test.js tests/resolver/similar-users-capability.test.js tests/renderer/recommendations-saved-cache.test.js` and `git commit -m "feat(recommendations): similar users, weekly sections and grouped model wiring"`.

---

### Task 5: The page render, skeletons and Home

**Files:**
- Create: `src/renderer/components/recommendations-page.js`. This is optional per the spec. If it's created, it is a `React.memo` module fed stable props, with `React.useState`-style hooks, and it is added to `tests/renderer/page-memo.test.js`. If it isn't, the render stays inline in `app.js` (around L39765-L40540).
- Modify:
  - `src/renderer/components/recommendation-skeletons.js`;
  - `src/renderer/components/home-page.js`: remove the Weekly section (around L664-L797) and the `loadWeeklyJamTracks` prop if it's now unused there;
  - `src/renderer/app.js`: the queue-drawer go-to-source (around L54190) and the `pendingPlaylistLoad` timeout fallback (around L19414-L19425) both go to `'recommendations'`;
  - `vendor/tailwind.css`, via `npm run build:css`, if a new class appears.
- Test:
  - `tests/renderer/recommendations-wiring.test.js`, extended;
  - `tests/ui/loading-skeletons.test.js`, extended;
  - `tests/renderer/component-render-smoke.test.js`, which already renders every export: confirm the new skeletons are covered.

**Interfaces:**
- Consumes: Task 1's `Section[]`, `filterSubsectionItems`; Task 4's state.
- Produces:
  - Filter state is `recommendationSourceFilters`, shaped `{ [subsectionKey]: Set<resolverId> }`. It lives in session state and is never persisted.
  - Rows add `playbackContext.rowKey = subsection.key` (the `name` stays the subsection title for the queue drawer). `isNowPlaying` compares `rowKey`.
  - New skeleton exports:
    - `RecommendationSubsectionSkeleton({ kind:'songs'|'cards'|'friends', lines })`;
    - `RecommendationFriendSkeleton({ index })`.
    - `RecommendationsPageSkeleton` is redrawn as section heading, then a subsection header (title bar plus a tag bar), then the row.

- [ ] **Step 1: Write the failing tests.**
  - Wiring:
    - the See all button carries the exact link classes from Global Constraints;
    - no `fetchAiRecommendations` call and no "Refresh" string inside the Recommendations render;
    - filter tags render a `button` with `aria-pressed`;
    - the empty-filter note is present;
    - `rowKey` is set in the row's queue context and compared in `isNowPlaying`;
    - the weekly cards call `loadPlaylist` with `isEphemeral: true` and play with `type: item.weekly.contextType`;
    - a friend card calls `navigateToFriend` with `id: 'similar:'`;
    - `home-page.js` has no `Weekly Exploration` string;
    - both back paths say `navigateTo('recommendations')`.
  - Skeletons:
    - each new export renders under Node, with `aria-hidden`;
    - the page skeleton contains a tag bar;
    - the friend skeleton uses the hexagon clip-path from `collection-page.js`.

- [ ] **Step 2: Run them and confirm they fail.**

- [ ] **Step 3: Implement the render** per the spec's "Rendering" section.
  - Weekly cards keep Home's mosaic from `weeklyJamCovers` and its click and play handlers, moved over.
  - Shuffleupagus loading shows a card-skeleton tail on the Albums and Artists For you rows. When neither row exists, it shows one `RecommendationSubsectionSkeleton` there.
  - The pending-provider skeleton sits after the last rendered section, before Friends.
  - Friends shows `RecommendationFriendSkeleton`s while its answer is pending and nothing is cached.
  - Each split is expanded on its own (expanded state keyed by `subsection.key`).
  - A split's loading tail shows only while a page is in flight for its `pagingKey` and the split's last page brought it at least one item of its type. Otherwise it would keep a skeleton while the provider section pages for its other splits.

- [ ] **Step 4: Run the checks.** Run `npm run build:css`, then `npm test`, and expect PASS.

- [ ] **Step 5: Commit** the changed files by name, with the message `"feat(recommendations): five-section page with source filters; weekly playlists move from Home"`.

---

### Task 6: Follow from a recommended profile

**Files:**
- Modify: `src/renderer/app.js`: `addFriend` (around L29125-L29219), plus the friend page header (around L41570-L41600).
- Test: `tests/renderer/follow-recommended-friend.test.js`, new.

**Interfaces:**
- Consumes: Task 5's friend-shaped object `{ id:'similar:<service>:<username>', username, service, displayName, avatarUrl }`.
- Produces:
  - `addFriendCore({ service, username })` returns `Promise<Friend>`.
    - It looks the user up with `fetchListenbrainzUserInfo` / `fetchLastfmUserInfo` for that exact service, with no fallback to the other one.
    - It adds the friend to `friends`, auto-pins them, un-hides them, and calls `followOnService`.
    - It throws when the person is already a friend or isn't found.
  - `addFriend(input)` keeps its modal behavior and calls `addFriendCore`.

- [ ] **Step 1: Write the failing tests** (source markers):
  - `addFriendCore` exists and doesn't touch `setAddFriendModalOpen`;
  - `addFriend` calls `addFriendCore`;
  - the friend header renders a Follow `button` only when `!friends.some(f => f.id === currentFriend.id)`;
  - Follow calls `addFriendCore({ service: currentFriend.service, username: currentFriend.username })` and then `setCurrentFriend` with the returned friend.

- [ ] **Step 2: Run it and confirm it fails.**

- [ ] **Step 3: Implement.** The toast after Follow reads `Following ${displayName}`. Check that every friend loader the page calls on open works for a friend who isn't in `friends`, and fix any that assumes membership, such as the sidebar `isSelected` or the unread state.

- [ ] **Step 4: Run `npm test` and expect PASS.**

- [ ] **Step 5: Commit** with `git add src/renderer/app.js tests/renderer/follow-recommended-friend.test.js` and `git commit -m "feat(friends): follow a recommended listener from their profile"`.

---

### Task 7: Docs, release notes, live run

**Files:**
- Modify:
  - `docs/features/RECOMMENDATIONS.md`;
  - `docs/architecture/renderer-patterns.md`;
  - `docs/DESIGN_SYSTEM.md`;
  - `docs/architecture/plugins.md`: the `similarUsers` contract, both implementations, and the weekly sections;
  - `docs/architecture/friends.md`;
  - `RELEASE_NOTES.md`: rewrite the "grouped into sections" bullet, and add a Friends bullet and a weekly-playlists-moved bullet.

- [ ] **Step 1: Update each doc** so nothing describes the old layout, Home's weekly section, or a Shuffleupagus section with Refresh. Check with `grep -n "Show all\|Shuffleupagus section\|Weekly Jams" docs/features/RECOMMENDATIONS.md docs/architecture/renderer-patterns.md docs/DESIGN_SYSTEM.md`: only correct mentions remain.

- [ ] **Step 2: Live run on the user's profile.** Follow the live-test rules in this session's standing instructions: check the ports, back up and restore the native-messaging host and the queue, and launch with `npm start -- --remote-debugging-port=9333 --inspect=9339`. Confirm:
  - a cold start shows the skeleton, then the five sections;
  - a stale start shows cached rows and refreshes them in place;
  - Amazon rows land in the right sections, and See all pages them in the background;
  - a filter toggle hides only that row's picks;
  - a weekly playlist opens, plays, and the queue drawer's source goes to Recommendations;
  - a ListenBrainz and a Last.fm listener each open, Follow works, and the person leaves Friends.

  Report anything not checked.

- [ ] **Step 3: Commit** the docs and notes by name with the message `"docs: Recommendations redesign"`. Then ask the mobile parity question: Friends and `similarUsers` are a shared capability, so offer a mobile ticket.
