# Recommended playlists by category

**Date:** 2026-11-12
**Status:** approved direction (option 2 of three mocked), spec for review
**Area:** the Recommendations page's Playlists section; the `getRecommendations` plugin contract

## Why

The Recommendations page blends every provider's playlists into one "Playlists" row and drops the providers' own section titles (`src/renderer/lib/recommendation-model.js`). With several services connected, that row mixes very different things: a personal discovery mix, an editors' "’70s Rock Essentials", a "Radiohead Fans Like" pick, a user-made community playlist. You can't tell why a playlist is there.

Showing each provider's titles as they are doesn't fix it. Apple's "Playlists Made for You" and Amazon's "Playlists for You" would sit as two near-identical rows, and every new service would add more.

So the page groups playlists into a few **generic categories** that every service maps onto, each row still blending all services.

## Goals

- Playlists on the Recommendations page are grouped by **why they're recommended**, in rows shared across services.
- The categories are generic: the app never checks a service's name to place a playlist (CLAUDE.md, "Route by the plugin registry, never by service name"). Each plugin says which category its playlists belong to.
- Nothing disappears: a playlist with no category still shows.
- The source filter keeps working across the category rows.

## Non-goals

- Categorizing albums, artists or songs. The same field could serve them later; not now.
- Showing Amazon's editorial shelves, which the Amazon plugin filters out today on purpose.
- Translating category labels (the app is English-only today).
- Changing Home. Home's playlists come from `getHistoryMixes` and the user's own playlists, not from this section.

## Anti-goals (would make this a failure even if it works)

- A row per provider section, or a service name in a row title.
- Parsing a service's display titles ("X Fans Like") in English to decide a category: it breaks in other languages and when the service renames a shelf.
- A page that gets longer for one user than today with nothing new in it (see "One category: one row").

## The categories

Five, in this fixed order:

| `category` | Row title | What belongs |
|---|---|---|
| `personal` | Made for you | Personalised mixes built from the user's own listening (Apple's discovery mixes, Amazon's "Playlists for You", ListenBrainz's Weekly Exploration) |
| `artist` | Because you like … | Playlists recommended because of a specific artist the user plays |
| `editorial` | From the editors | A service's editorial playlists |
| `community` | From other listeners | Playlists made by other users of the service |
| (none or unknown) | More playlists | Anything without a recognized category |

Notes:

- **"Because you like …" builds its title from seed artists**, in provider order, deduplicated without regard to case:
  - one: "Because you like Radiohead";
  - two: "Because you like Radiohead and Arctic Monkeys";
  - three: "Because you like Radiohead, Arctic Monkeys and The Strokes";
  - four or more: the first three, then "and more".
  - **No seed names (my call):** an `artist` row whose sections carry no `seedArtist` is titled "Because of artists you like".
- **Weekly playlists still lead.** Items carrying `weekly` (ListenBrainz Weekly Exploration and, for older apps, Weekly Jams) keep today's rule (newest week of each only, Exploration before Jams) and lead the **Made for you** row.
- **History mixes stay out.** Playlists whose id is also a history mix (`excludePlaylistIds`, the mixes Home shows) are still left out before grouping.

## Plugin contract

`getRecommendations` sections and items gain two optional fields. Both are documented in `docs/architecture/plugins.md` ("Recommendations").

- `section.category?: 'personal' | 'artist' | 'editorial' | 'community'`: the category of the section's playlist items.
- `item.category?`: the same values, set on one playlist item. It **overrides** its section's category, because a provider section can mix kinds (Apple's groups hold both editorial and personal playlists).
- `section.seedArtist?: string`: the artist an `artist` section is built around. It's ignored on any other category.

Rules:

- **Only playlists are affected.** The fields affect playlist items only. Albums, artists and songs in the same section are placed exactly as today.
- **Unknown values are treated as missing.** Anything outside the four values counts as no category, which lands in "More playlists" and isn't an error.
- **No `minAppVersion`.** Older apps ignore the fields and show today's single row, so plugins can ship them now (CLAUDE.md, "A plugin that needs a newer app declares `manifest.minAppVersion`").
- **Version bumps:** each plugin that starts sending the fields bumps `manifest.version`, and `marketplace-manifest.json` is committed (CLAUDE.md, "`plugins-src/` is the plugin source of truth").

## How each plugin maps (today's providers)

| Plugin | Playlists it sends | Mapping |
|---|---|---|
| **Apple Music** | from `/v1/me/recommendations` groups | Per item, from the playlist's `playlistType`, which is structured and language-independent: `personal-mix` → `personal`, `editorial` → `editorial`, `user-shared` → `community`, anything else → none. History mixes are already dropped (`isPlayHistoryMix`). **Seed artist: verify first.** Capture a live response and check whether Apple's group JSON names the artist behind an "X Fans Like" group in a structured field (an artist relationship or id on the group). If it does, those groups' playlists become `category: 'artist'`, overriding their `editorial`, with `seedArtist` set. If it doesn't, they stay `editorial`: don't parse the title. Record what the capture showed in `docs/architecture/plugins.md`. |
| **Amazon Music** | the `browse-home_playlistStrategy` and `browse-home_mp3CommunityPlaylistsStrategy` shelves | By section id's strategy name, which the plugin already parses (`isPersonal`): `playlistStrategy` → `personal`, `CommunityPlaylistsStrategy` → `community`. Any other strategy holding playlists → no category. |
| **ListenBrainz** | `weekly-exploration` (and `weekly-jams` for older apps) | Both sections → `personal`. |
| **Last.fm** | none | nothing to do |

## The page model

All of this is in `src/renderer/lib/recommendation-model.js` (`buildRecommendationPage`), which stays pure and unit-tested.

- **Rows:** the Playlists section's `subsections` become one row per category that has items, in the table's order. Each row is a normal subsection:
  - key `playlists:<category>`, with `playlists:other` for More playlists;
  - its title;
  - `blended`, `sources`, `items` and `pageable`, built exactly as today's single row builds them, but from that category's items only.
- **Item order within a row:** round-robin by provider, as today.
- **Dedupe:** a playlist appears **once on the page**, in the first row (by category order) whose items include it. Today's per-type dedupe identity applies across all the rows.
- **Paging (`pageable`):** a row lists the provider sections that fed it. A provider section whose playlists span two categories pages once (today's "one chain per provider section" rule); its later pages are sorted into rows by each item's category.
- **One category: one row.** If only one category has items (for example, a ListenBrainz-only user), the section is a single row with today's key `type:playlist` and title "Playlists", exactly as now. That keeps saved open or closed state and avoids a lone "Made for you" heading under "Playlists".
- **Other sections are untouched.** Songs, Albums, Artists and Listeners are unchanged.

## The page

All of this is in `src/renderer/app.js`, Recommendations view.

- **Heading:** each category row uses the page's existing row header (`subsectionHeader`: title, then "See all" / "Show less" on the right). Each row opens and closes on its own (`recommendationsExpandedSections` is already keyed per row).
- **Collapsed height (my call):**
  - with two or more category rows, each collapsed row shows **one** row of cards (the measured column count), so the section isn't several times longer than today;
  - a single-row Playlists section keeps today's two rows;
  - "See all" adds rows as it does now.
- **The source filter:**
  - it applies per row (`filterRowBySource`);
  - a row with nothing from the selected source hides;
  - if only one row is left after filtering, it keeps its category title, so the model doesn't re-merge on a filter change.
- **Cards:** unchanged. Each playlist card's second line still names its service, since rows blend services.
- **Loading skeleton:**
  - while the page has no playlists yet, the Playlists section's skeleton keeps today's shape;
  - when category rows render from cache, they render at once;
  - while providers are still being asked, the page's generic pending skeleton stands in, since nothing knows yet whether a provider will bring playlists; once rows are on the page, each row's loading tail is one collapsed row of cards (its `preview`), pinned in `tests/ui/loading-skeletons.test.js` (my call, after the final review).

## Tests

- **Model, in `tests/renderer/recommendation-model.test.js`:**
  - grouping by `section.category` and the `item.category` override;
  - row order;
  - unknown or missing categories go to More playlists;
  - a single category collapses to `type:playlist` / "Playlists";
  - weekly playlists lead Made for you;
  - cross-row dedupe;
  - the seed-artist title for 1, 2, 3 and 4+ seeds, case-insensitive dedupe, and the no-seed title;
  - `pageable` per row, and a two-category provider section paging once;
  - history-mix exclusion still applies.
- **Plugins:**
  - Apple's `playlistType` mapping, plus the seed-artist mapping if the capture supports it;
  - Amazon's strategy mapping;
  - ListenBrainz's sections;
  - version bumps.
- **Page, source-marker tests:**
  - per-row collapsed card counts;
  - the filter hides empty rows;
  - the skeleton shape.

## Docs, in the same PR

- `docs/architecture/plugins.md` ("Recommendations"): the new fields and their rules, each plugin's mapping, and Apple's seed-artist finding.
- `docs/features/RECOMMENDATIONS.md`: the Playlists section's rows, replacing "Each section is one blended row" for Playlists, and the collapsed-height rule.

## Mobile

This changes the shared plugin contract, so the Android and iOS apps need a ticket after the desktop PR merges. It should carry the field definitions, the category order and labels, the seed-title rule and the single-row fallback. Older mobile builds ignore the fields and keep one row.

## Review focus (the cases most likely to bite)

1. **A provider section mixing categories** (an Apple group with editorial and personal mixes). Each playlist must land by its own `item.category`, and the section must still page once.
2. **Only weekly playlists** (a ListenBrainz-only user). The page must stay exactly as today: one "Playlists" row.
3. **Filtering to a source with playlists in one category.** The other rows hide and the remaining row keeps its title; nothing re-merges or refetches.
4. **An older plugin with no categories, next to a new one.** Its playlists go to More playlists, not lost and not duplicated.
5. **Seed names:** long, duplicated across providers in different case, or missing. The title follows the 1/2/3/4+ rule and never prints an empty name.

## Settled after a builder's read

A reviewer read this spec against the code as its builder would. These are their questions, with the answers I settled on (all my calls, except the Amazon id, which I checked):

1. **Paged items get their section's category.** `expandRecommendationSection` pages return bare items, and `normalizeRecommendationItem` keeps no section context. When a page arrives, the model stamps the paged section's `category` (and `seedArtist`) onto each playlist item that has no `item.category` of its own. Both normalizers pass `category` and `seedArtist` through; today they keep only listed fields. A paged playlist that already shows in an earlier row stays there, under the same first-row dedupe.
2. **`item.weekly` means `personal`, whatever the plugin sends.** Weekly playlists lead Made for you even from a ListenBrainz plugin that predates categories, so a ListenBrainz-only user keeps today's single row with or without the plugin update.
3. **Collapsed height is decided at render, after filtering.** The model only builds the rows. The page counts the rows it is about to show, with the source filter applied:
   - two or more rows: one row of cards each;
   - exactly one: today's two rows.

   This includes a lone row left by a filter, which keeps its title but gets two rows of cards. `SECTION_PREVIEW` becomes a per-row value; the loading tail and `canExpand` read the same per-row value.
4. **Paging and the loading tail are tracked per row.** A provider section that feeds several rows is in each row's `pageable`, and opening any of them starts that section's one chain. The tail placeholder uses the categories the last page actually filled (`lastPageCategories`, next to today's `lastPageTypes`), so it only shows in a row the next page will add to. A row shows "See all" when it has more items than its preview or a `pageable` section that can still load more, as today.
5. **Amazon's synthesized "Playlists for You" section** has the id `uri:///recommendations/browse-home/browse-home_playlistStrategy` (`PLAYLISTS_SECTION_ID` in `amazon-web-player.js`), so the strategy mapping holds. Non-playlist items in Amazon's strategy sections are untouched.
6. **When providers disagree, the earliest category wins.** `mergeOwned` merges the same playlist from several providers into one card. If they give it different categories, the merged card takes the earliest in row order: personal, then artist, then editorial, then community.
7. **Apple's `artist` mapping is conditional.** If the capture finds no structured seed artist, Apple sends no `artist` category and the "Because you like …" row doesn't appear until some provider sends one. The model and page still support it, and its tests use fixtures.
8. **Old cached answers fall back gracefully.** Cached provider answers without categories land in More playlists until their next refresh, within the hour (`CACHE_TTL.recommendations`). A page where every playlist is uncategorized is a single category, so it falls back to today's one "Playlists" row.

## Calls I made (check these)

- The row titles: "Made for you", "Because you like …", "From the editors", "From other listeners", "More playlists".
- "Because of artists you like" as the title when there are no seed names.
- One row of cards per collapsed category row, keeping today's two rows when there's a single row.
- A single category falls back to today's "Playlists" row and key.
- After filtering, a lone remaining row keeps its category title.
- Apple's seed artists only from structured data, never from parsing titles.

## Left to the builder

- Whether category rows are built inside `buildRecommendationPage` or by a small helper it calls.
- How the Apple capture is taken (any account with "Fans Like" groups works) and where its notes go, as long as `plugins.md` records the result.
