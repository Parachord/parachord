# Recommendations page redesign

Date: 2026-11-11. Mock: "Recommendations Page Redesign" (a private claude.ai Design canvas, shared with theli-ua for feedback). This replaces the sectioned layout that shipped in #1309, as extended by #1310 (Amazon), #1317 (now-playing rows) and #1328 (skeletons, saved cache).

## Why

The page that shipped in #1309 and #1310 grew one section per provider section. With Amazon connected that's about 22 rows, each with its own title, and no shared structure. Shuffleupagus sits in a separate section at the bottom. The "see more" controls are grey pills that look like nothing else in the app. The redesign fixes three things:

1. **One structure.** The page has five sections, always in this order: Songs, Albums, Artists, Playlists, Friends.
2. **Shuffleupagus blends in.** Its albums and artists mix into the same rows as Last.fm's and ListenBrainz's.
3. **"See all" matches the app.** It uses Home's purple text link.

## Goals

- Five type sections. Each one holds subsections, and a section with no subsections doesn't render.
- In each section, the first subsection is a blended **For you** row. It mixes every provider's untitled picks of that type with Shuffleupagus's picks of that type.
- Every provider's titled sections (Amazon's "Albums for You", "My Mixes" and so on) become subsections of the section that matches their item type.
- Sources appear as tags in the subsection title, never as badges on items.
  - In a blended row, each tag is an on/off filter for that row.
  - In a single-source row, the tag is a plain label.
- ListenBrainz's Weekly Exploration and Weekly Jams move from Home into Playlists. Home loses that section.
- A new Friends section lists people who listen like you and whom you don't already follow, from ListenBrainz and Last.fm. Clicking one opens their profile, which offers Follow.

## Non-goals

- No per-item source badges. They read as resolver icons, and the user rejected them.
- **No Refresh button for Shuffleupagus on this page.** The user's call on 2026-11-11. The batch is the one Home shows, and it refreshes from Home: Home's Refresh, or the "Refresh Home suggestions on every visit" setting (`lib/home-suggestions-refresh.js`).
- No change to how providers fetch (apart from the ListenBrainz plugin's two new sections): the `getRecommendations` contract, `expandRecommendationSection` paging, the per-provider cache (`cache_recommendations`), the 20s bound and the generation guard stay as #1328 left them. The redesign is a new display model on top of the same provider answers.
- No change to Home's Shuffleupagus suggestions or its other sections.

## Anti-goals (a failure even if it technically works)

- Amazon's rows lose their names, or a mixed Amazon row gets dumped whole into one section.
- A source filter that hides items in another row or section.
- A layout change without matching skeletons. CLAUDE.md requires every new layout to ship with its loading skeleton.
- The now-playing row indicator from #1317 stops lighting up, or lights up in two rows at once.
- Recommended people get followed or saved automatically.

## The display model

`src/renderer/lib/recommendation-model.js` stays the pure model. `buildRecommendationSections` is replaced by a builder that returns **sections of subsections**:

```
[
  { type: 'song',     title: 'Songs',     subsections: [...] },
  { type: 'album',    title: 'Albums',    subsections: [...] },
  { type: 'artist',   title: 'Artists',   subsections: [...] },
  { type: 'playlist', title: 'Playlists', subsections: [...] },
  { type: 'friend',   title: 'Friends',   subsections: [...] }
]
```

A section with no subsections is left out of the array.

Each subsection keeps today's display-section fields: `key`, `title`, `description`, `resolverId`, `resolverName`, `sectionId`, `canLoadMore`, `nextCursor`, `items`. It adds:

- `blended: boolean`.
- `sources: [{ id, name }]`, the providers with at least one item in the row, in provider order.

### Building it

1. **For you (blended)**, one per type, using the key `foryou:<type>`.
   - **Its items:** every provider's untitled items of that type (today's generic buckets), plus Shuffleupagus's items of that type.
   - **Derived artists still count.** Today's generic Artists bucket also gets artists taken from the generic songs, and they keep the `resolverId` of the song they came from.
   - **The order is interleaved round-robin by provider**, in provider order, with Shuffleupagus last. A row's first few items then show every source instead of one provider's whole list. *My call: the order isn't in the mock.*
   - **Duplicates:** an item is deduplicated per type as today. The first provider in priority order keeps the item's position and fields, but the merged item records **every** provider that sent it in `sourceIds`. If one of them is Shuffleupagus, its `reason` stays on the merged item. *My call.*
   - **Its sources:** the row's `sources` lists every provider in any item's `sourceIds`, so a provider whose picks were all duplicates still gets a tag and can be filtered.
2. **Titled sections**, one subsection per provider section **per item type**.
   - A section that holds a single type becomes one subsection of that type's section.
   - A section that mixes types splits by type. It keeps its title in every section where it has items, and the keys are `<resolverId>:<sectionId|title>:<type>`.
   - **Placement:** titled subsections come after For you, in provider order and then in the provider's own section order. #1310's paging (`canLoadMore`, `nextCursor`, `expandedSections`) is keyed by the provider section, and every split of that section shares it. Loading more for "Hot Playlists" adds only playlists to the Playlists split.
3. **Weekly Exploration and Weekly Jams** (ListenBrainz, Playlists only).
   - **They are two titled subsections:** `listenbrainz:weekly-exploration` and `listenbrainz:weekly-jams`, each with that playlist's four weeks.
   - **They come right after Playlists' For you row:** Exploration first, since it's the new-music one, then Jams, then the other providers' playlist subsections. *My call, made earlier in the mock conversation.*
   - **They come from the ListenBrainz plugin, not the app.** Today `loadWeeklyPlaylists` (app.js, around L27544) calls ListenBrainz's `playlists/createdfor` by name, which goes against the "route by the plugin registry" invariant. The plugin's `getRecommendations` already reads the user's recommendation playlists, so it now also returns two titled playlist sections, "Weekly Exploration" and "Weekly Jams": four weeks each, every item carrying its ListenBrainz playlist id. Because they're ordinary provider sections, the saved cache, the stale display, the 20s bound and the generation guard cover them for free, and a stale start shows them at once. The plugin's `manifest.version` is bumped. *My call.*
   - **Opening and playing one** still goes through the existing weekly path: `loadWeeklyJamTracks(id)` and the `weekly-jam` / `weekly-exploration` playback contexts. The page keeps `homeData.weeklyJams` / `weeklyExploration` filled from those two sections, because the playlist view's `pendingPlaylistLoad` lookup reads them. `loadWeeklyPlaylists` and its Home effect are deleted.
4. **Friends.**
   - **One blended subsection, "Listen like you",** from every provider with the new `similarUsers` capability (ListenBrainz and Last.fm, below). Like the other For you rows, its source tags are filters, and it interleaves round-robin by provider, because the two services' scores aren't on the same scale.
   - The same name on both services stays two entries: a Last.fm user and a ListenBrainz user with the same name aren't known to be the same person.

### Filters

- Filter state is `{ [subsectionKey]: Set<resolverId> }` of sources that are turned **off**, and it lives in renderer state.
- An item is hidden only when **every** id in its `sourceIds` is off, so turning ListenBrainz off keeps an artist Shuffleupagus also picked.
- **They last for the session.** A restart turns every source back on. *My call; noted as a guess in the mock and not objected to.*
- **The builder stays filter-free.** The render applies the filters, so filtering never refetches or re-merges anything.
- A row with every source off shows an empty note ("Every source is turned off for this row…"), as in the mock, instead of disappearing. The tags you'd use to turn a source back on stay visible.
- A single-source row has no filter.

### Shuffleupagus

- Its items lose their separate section and keep `resolverId: 'shuffleupagus'` and their `reason`.
- The reason stays the hover tooltip, as on Home.
- A batch that's still loading shows as a skeleton tail on the Albums and Artists For you rows, instead of the separate "Shuffleupagus · thinking…" section skeleton.
- There's no Refresh on this page, and no button replaces it.
- With no AI provider enabled, its tag simply doesn't appear.

## Rendering

- **Page shell stays:** the hero header, the collapse behavior, the not-configured and error states, and the scroll container. The "From your connected services and Shuffleupagus" line stays.
- **Section heading:** the section title at Home's section-heading size (`text-lg font-semibold`). No item count. The count next to each title goes away. *My call: the mock has none, and with subsections a section-level count says little.*
- **Subsection header:**
  - The title in a smaller weight, then the source tags, then "See all" on the right.
  - **The tags:**
    - The plain-label style is #1310's tag: `text-[10px] font-semibold uppercase tracking-wider`, over `--placeholder-bg`.
    - A filter tag that's on is tinted with the accent and has `aria-pressed="true"`.
    - A filter tag that's off is outlined and struck through, with `aria-pressed="false"`.
    - Every color comes from CSS variables, so both themes work.
- **See all / Show less:**
  - It uses Home's link style: `text-sm text-purple-600 hover:text-purple-700 font-medium`.
  - It opens the row in place, and once open the same link reads "Show less".
  - It only shows when the row has more than its preview (6 cards, or 5 song rows) or can load more.
  - **#1310's background paging stays as is:** opening a row that can load more starts the page fetches, and the row shows its skeleton tail while a page loads.
- **Cards, song rows and their hover actions:** unchanged from today, including the playlist hover set from #1328.
  - The now-playing check from #1317 is keyed on `playbackContext.name === section.title` (app.js, around L40210) today. Two subsections can share a title (a split Amazon section, or "For you" in every section), and the queue drawer displays the name, so playing from a row adds a separate `playbackContext.rowKey` (the subsection key), and the check compares that instead. A song in both For you and "Your Frequent Plays" lights up only in the row you played it from.
- **Friends grid:**
  - Hexagon avatars like Collection → Friends. Last.fm users show their Last.fm picture; ListenBrainz users use ListenBrainz's generated placeholder, since its similar-users lookup sends no pictures.
  - Each one shows the username and "NN% similar", the provider's similarity as a whole percent.
- **Weekly playlist cards** open and play exactly as they do on Home today, including saving them. They keep the `weekly-jam` / `weekly-exploration` playback contexts.

### Paging guards

The in-flight guard and the expanded state are keyed by the display row today (app.js, around L27424 and L27504). With splits:
- the **in-flight guard is keyed by the provider section** (`resolverId|sectionId`), so two open splits of one Amazon section never fetch the same page twice;
- each split stays expandable on its own;
- a split stops showing its loading tail when a page brings it no items of its type, even if the provider section keeps paging for the other splits.

### Other readers of `recommendations.sections`

The shape change touches five readers besides the page, and each needs a flat view of the items (a `flattenRecommendationItems(sections)` helper in the model is the suggested route):
- the song resolution scheduler list (app.js, around L23151);
- Home's For You card preview (around L23169), which Home still renders;
- the image fetch (around L31286);
- the discovery-unread hash (around L19328 and L27165);
- the auto-paging effect (around L27503).

## Friends: the new capability

Both plugins implement `getSimilarUsers(config)` and declare the `similarUsers` capability. It returns `[{ username, similarity, avatarUrl? }]`, sorted by similarity, with `similarity` between 0 and 1. With no configured username it returns `[]` and makes no request.

### ListenBrainz

`plugins-src/listenbrainz/`: it calls `GET https://api.listenbrainz.org/1/user/{username}/similar-users` and maps the answer. ListenBrainz computes the similarity.

### Last.fm: worked out from friends-of-friends (the user's call)

Last.fm has no lookup for this: on 2026-11-11, `user.getNeighbours`, `user.getSimilar`, `artist.getTopFans` and `tasteometer.compare` all return "Invalid Method". So the Last.fm plugin (`plugins-src/lastfm/`) works it out from two calls that still exist:

1. **Candidates are friends of your Last.fm friends.** `user.getFriends` for your own account (one page, up to 50), then `user.getFriends` for up to 20 of those friends (one page each). People you follow already, people you removed and yourself are dropped (the same rules as below), and so are your own Last.fm friends: you know them already. The rest are ranked by how many of your friends know them, and the top 30 go on to step 2.
2. **Similarity is shared taste.** `user.getTopArtists` (period `6month`, limit 50) for you and for each candidate. The score is the cosine similarity of the two artist lists, with each artist weighted by its rank (`1 / (1 + rank)`), giving a number from 0 to 1. Candidates under 0.05 are dropped. *My call: a simple, explainable score. The builder may tune the weights and the cutoff against a real account, and must say what they chose.*
3. **Avatars** come from `user.getFriends`'s image list (the largest size).

**The API key.** Today the Last.fm plugin's only call is the website's recommended-station JSON, which needs no key. These are API calls, so the plugin needs one. The config passed to `getSimilarUsers` must carry the effective key from `getLastfmApiKey()`: the user's own key from Settings if set, otherwise the app's. Check whether `getResolverConfig('lastfm')` already includes it, and add it if not. The key never goes in a log line.

**Cost and pacing.** About 50 requests a run. The plugin's `fetch` doesn't go through the app's `lastfmFetch` (its 429 toast), so the plugin paces itself (no more than 4 requests a second) and treats a 429 or any failed request as a failure that throws. The page then keeps what it has, and nothing empty gets cached. It runs only from the Recommendations page's load, never from Home, and its answer is cached with the rest of the page (below), so it reruns only when the page's cache is stale (7 days).

**When it finds no one.** With no Last.fm friends there are no candidates, and the plugin returns `[]`. Last.fm offers no other way to find strangers with similar taste, so Friends then shows only ListenBrainz's people, or nothing.

### Both

- **How the app finds providers:** through the plugin registry, never by service name (CLAUDE.md invariant). It looks for meta-services or resolvers whose manifest declares the `similarUsers` capability, the same way the `recommendations` capability works.
- **Plugin versions:** bump both plugins' `manifest.version`, and commit `marketplace-manifest.json`.
  - The app has to cope with an older plugin that doesn't have the method, since marketplace installs update on their own schedule. It checks the capability first, so that provider adds nothing to Friends.
- **Which people to drop:**
  - people the user already follows: same service, same username, case-insensitive;
  - people the user removed (`hiddenFriendKeys`, the `friendKey(service, username)` form). *My call.*
  - the user themself.
- **The cache:** the result is cached with the rest of the page's provider answers, in the `cache_recommendations` entry, under the provider's id. It goes through the same fetch, timeout and generation guard, so the saved cache and the stale display cover it. If it would be simpler, a separate key also works. A new key would have to be added to `ALLOWED_STORE_KEYS`.
- **Opening a profile:** `navigateToFriend` with a friend-shaped object that isn't in `friends`: `{ id: 'similar:<service>:<username>', username, service, displayName: username, avatarUrl }`, where `service` is `'listenbrainz'` or `'lastfm'`.
  - The friend loaders already work from `service` and `username` alone. The builder has to confirm that nothing on that path assumes the friend is in `friends`, the sidebar selection for one.
- **Follow on the profile:**
  - When the friend on screen isn't in `friends`, the friend page's header shows **Follow**.
  - It must not call `addFriend` with a bare username: `parseFriendInput` has no `listenbrainz:<username>` form, and a plain username tries Last.fm first, which could add a different person. Split `addFriend`'s core (look up the ListenBrainz user, build the friend, add it) out of its modal handling (closing the modal, clearing the input, the toast) and have it return the new friend. Follow calls the core with the person's `service` set explicitly.
  - Follow does what Add Friend does today: it pins the person to the sidebar and calls `followOnService`, which follows them on your ListenBrainz account (a no-op for Last.fm, which has no follow API). *My call, pending your answer: the question was asked and not yet answered.*
  - Once followed, the page switches to the real friend object, and the person drops out of the Friends section on the next merge.
  - No follow happens anywhere else.

## Moving the weekly playlists off Home

- Remove the Weekly Jams and Weekly Exploration section from `components/home-page.js`.
- The fetch that fills `homeData.weeklyJams` / `weeklyExploration` runs today when Home is open (app.js, around the `activeView === 'home' && ... !homeData.weeklyJams` effect). It's replaced by the ListenBrainz plugin's two sections (see "Building it"), and the page fills those state fields from them.
  - Renaming those fields is optional cleanup; if they're renamed, every reader has to change.
- **Places that send you back to Home** have to send you to Recommendations instead:
  - the queue drawer's "go to source" for `weekly-jam` / `weekly-exploration` contexts, which today calls `navigateTo('home')` (app.js, around L54190);
  - the `pendingPlaylistLoad` timeout fallback for ephemeral ListenBrainz playlists (around L19414-19425), "fall back to home (where Weekly Jams are displayed)". The view's real back button follows view history and needs no change.
- **One overlap is accepted (the user's call):** since #1315, the ListenBrainz picks in Songs' For you come from this week's Weekly Exploration. The same songs also appear in that week's playlist under Playlists.

## Loading skeletons

CLAUDE.md requires a layout change to ship with its matching skeleton.

- **`RecommendationsPageSkeleton`** gets redrawn to the new shape: a section heading, then a subsection header (title plus a tag), then the row. Songs get song rows; Albums get cards.
- **`recommendationsPending`** (the providers still being asked) keeps one unlabeled pending skeleton.
  - It sits after the last rendered section and before Friends. Friends is last, so a pending provider never pushes content down from above.
  - It stays unlabeled, for #1328's reason: a provider may answer "not ready".
- **Shuffleupagus:** while it thinks, a card-skeleton tail sits at the end of the Albums and Artists For you rows when those rows exist. When they don't, a one-subsection skeleton sits in the section's place.
- **A Friends skeleton:** a row of hexagon placeholders, used while the similar-users answer is pending and nothing is cached.
- **Tests:** `tests/ui/loading-skeletons.test.js` must cover the new components, and the render smoke test must render each one.

## Testing

- **Model unit tests** (`tests/renderer/recommendation-model.test.js`):
  - five-section order;
  - empty sections dropped;
  - the blended interleave, and dedupe across providers;
  - Shuffleupagus items landing in Albums and Artists For you;
  - derived artists keeping their source;
  - a mixed titled section splitting by type with a shared paging key;
  - the weekly subsections placed first in Playlists;
  - Friends filtering out followed users and self;
  - each row's `sources`.
- **Filter tests:** a pure helper that applies the off-set to a subsection. It covers the "all off" case and checks that one row's filter doesn't touch another.
- **Wiring tests** in the existing source-marker style, for:
  - "See all" using the purple link classes;
  - no Shuffleupagus Refresh on the page;
  - Home no longer rendering the weekly section;
  - the back navigation pointing to Recommendations;
  - the similar-users capability being checked before it's called.
- **Plugin tests:** each `getSimilarUsers`, with a mocked fetch, a missing username, and sorting. For Last.fm also: candidate ranking by mutual friends, the 20-friend and 30-candidate caps, dropping followed, removed, your own friends and self, the cosine score on fixed artist lists, the pacing, and a 429 throwing.
- **Live run on the user's profile before calling it done** (lesson from #1328):
  - cold start;
  - stale start;
  - Amazon connected, with its rows landing in the right sections and paging still working;
  - a filter toggle;
  - opening a similar user from each service and following them;
  - a weekly playlist opened, played, and navigated back from.

## Docs to update in the same PR

- `docs/features/RECOMMENDATIONS.md`: the page's structure.
- `docs/architecture/renderer-patterns.md`, wherever it describes the Recommendations sections and skeletons.
- `docs/DESIGN_SYSTEM.md`: the "See all" link and the tag styles.
- `docs/architecture/plugins.md`: the `similarUsers` capability and the method's contract.
- `docs/architecture/friends.md`: recommended people, and Follow on the profile.
- `docs/architecture/android-parity.md`, only if the `similarUsers` contract becomes something mobile should mirror. The mobile ticket question is the last step, as for every change.

## Release notes

The Recommendations page is unreleased (#1309 and #1310 are both in the "unreleased" block), so the existing "The Recommendations page is grouped into sections" bullet gets rewritten rather than a new one added. Two new bullets:

- one for Friends;
- one for the weekly playlists moving off Home, since Home already shipped and users will notice that change.

## Left to the builder

- Component boundaries. Pulling the page into `src/renderer/components/recommendations-page.js` (a `React.memo`'d module fed stable props, like Home and Collection) is encouraged but not required. If it's done, the module follows the page-memo rules and the `React.useState`-style hooks rule.
- The exact copy of the empty-filter note and the tags' tooltips.
- Whether the Friends answer lives in `cache_recommendations` or its own key.

## Open questions for theli-ua (feedback, not blockers)

The mock lists the seven decisions above, and theli hasn't commented yet. Feedback that changes one of them would change the build.
