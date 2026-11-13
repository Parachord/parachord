# Recommended albums by category

**Date:** 2026-11-13
**Status:** spec for review
**Builds on:** recommended playlists by category (Parachord/parachord#1373, PR #1376, spec `2026-11-12-recommended-playlist-categories-design.md`). This lands after #1376.
**Area:** the Recommendations page's Albums section; the `getRecommendations` plugin contract

## Why

The Albums section blends every provider's album picks into one row, as the Playlists section did before #1376. The picks are just as mixed:
- new releases for you (Apple "New Releases for You", "New Country Releases");
- albums by or like one artist (Apple "More from Frog", Amazon's artist shelf, e.g. "FIDLAR");
- picks from your listening (Amazon "Based on Your Recents" and "Albums for You", Shuffleupagus);
- editorial shelves (Apple "Classic British Rock", "2010s").

Grouping them the same way playlists are grouped tells you why each album is there.

## Goals

- Albums on the Recommendations page are grouped into category subsections under one "Albums" heading, exactly as playlists are under "Playlists" (#1376's layout, fallback, filter and paging rules).
- It's the same contract: the existing optional `category` and `seedArtist` fields, now also read on album items. The app never checks a service's name.

## Non-goals

- Artists and songs. Artist picks are one kind (Shuffleupagus, or derived from Last.fm/ListenBrainz songs), and songs are a station's worth of tracks, so categories would only add headings.
- Home's "Albums you might love". It keeps showing every album pick as one row.
- New provider shelves. Amazon's editorial shelves stay filtered out, as today.

## The categories (albums)

| `category` | Subsection title | What belongs |
|---|---|---|
| `new` | New for you | New or upcoming releases picked for you |
| `personal` | Based on your listening | Picks built from what you play, including Shuffleupagus's |
| `artist` | Because you like … | Albums recommended because of one artist (title from seed artists, #1376's rule) |
| `editorial` | From the editors | A service's editorial album shelves |
| (none or unknown) | More albums | Anything else; nothing disappears |

- **`new` is a new value, valid on albums only.** On a playlist it is unknown, so the playlist lands in More playlists. `community` is not an album category; an album sent with it goes to More albums.
- **Titles are per type.** The same id gets a different title on albums. For example, `personal` is "Based on your listening" on albums and stays "Made for you" on playlists.

## Contract changes

- **What's read:** `section.category` and `item.category` are now read for album items too, with the values above. `section.seedArtist` works as it does for playlists.
- **No `minAppVersion`:** older apps ignore the fields.
- **Version bumps:** every plugin that starts sending album categories bumps `manifest.version` and commits `marketplace-manifest.json`.

## How each provider maps

| Provider | Album sections | Mapping |
|---|---|---|
| **Amazon Music** | Its personal strategy shelves | <ul><li>`mp3YmlRecentPlaybackStrategy` and `mp3PrimeAlbumsStrategy` → `personal`.</li><li>`mp3ByArtistStrategy` → `artist`, with `seedArtist` taken from the items when every album in the section has the same `artist`. If they don't all match, it gets no `seedArtist` and keeps `artist`; the row title then falls back.</li><li>Any other strategy → none.</li></ul> |
| **Shuffleupagus** | The host builds its section (`shuffleupagusSection` in `recommendation-model.js`) | The host tags its albums `personal`. |
| **Apple Music** | `/v1/me/recommendations` groups | <ul><li>**Verify first:** a live capture with a signed-in Apple Music session, the same capture #1376's "Because you like" check needs. Find out whether a group carries a structured kind, or an artist reference, that separates new-releases groups, "More from <artist>" and editorial shelves.</li><li>Map only from structured data, never from titles. Until the capture is done, Apple's album sections carry no category and land in More albums. One capture can settle both specs.</li></ul> |
| **Last.fm, ListenBrainz** | none | nothing |

## The model

This extends #1376's split. Generalize it rather than copying it.

- **One table per type.** The per-type category tables (playlists as now, albums as above) drive one row builder, keyed by type. Keys are `albums:<id>`, with `albums:other` for More albums.
- **Same rules as playlists:**
  - stamp each album's category once, on a copy;
  - when providers disagree, the earliest category in the albums table wins;
  - paged album items take their paged section's category;
  - `pageable[].category` is set per row;
  - when only one category is present, the section falls back to today's single row (key `type:album`, title "Albums").

## The page

- **Layout:** the same as Playlists. One "Albums" section header, then each category as a 15px subsection (`SectionHeader` `size: 'sub'`) with its own See all.
- **Rows:** one row of cards per collapsed row when two or more show after the filter; hide a row with nothing for the selected source; the loading tail follows `lastPageCategories`. The gap between rows is 32px.
- **Shuffleupagus's loading tail and slot.**
  - **The tail** (`LLM_TAIL_ROWS`) is keyed `type:album`. With album categories, the tail goes on the row Shuffleupagus feeds: `albums:personal`, or `type:album` in the single-row case. Artists keep `type:artist`.
  - **The slot.** While Shuffleupagus is thinking and no album row is on the page yet, the existing Albums placeholder (`type:album-pending`) still stands in.
- **Release-date badges** ("Coming <date>") are unchanged.
- **Home** reads every album subsection through `recommendationAlbums`, which already walks all of a section's subsections, so "Albums you might love" is unaffected. A test should pin that.

## Tests and docs

- **Model:**
  - grouping;
  - `new` valid on albums and unknown on playlists;
  - per-type titles;
  - the single-row fallback, with key `type:album`;
  - earliest category wins;
  - paged stamping;
  - the Amazon artist-section seed rule (all items share one artist).
- **Plugins:**
  - the Amazon strategy mapping and its `seedArtist`;
  - version bumps.
- **Page:**
  - the Shuffleupagus tail lands on `albums:personal` when categorized;
  - the `type:album-pending` slot still shows;
  - Home's `recommendationAlbums` still sees every album row.
- **Docs:** `docs/architecture/plugins.md` (album categories in the contract, the Amazon mapping), `docs/features/RECOMMENDATIONS.md` (the Albums subsections) and `docs/architecture/amazon-music.md`.

## Mobile

Mobile runs the same plugins, so this goes in one parachord-mobile ticket after it merges: the album category table and titles, `new` being album-only, and the seed rule.

## Settled after a builder's read

A reviewer read this against the code as its builder would. These are their questions, with my answers (all my calls):

1. **Where Shuffleupagus's loading tail goes.**
   - **Single-row case:** the tail goes on `type:album`, as today.
   - **Categorized, with an `albums:personal` row:** the tail goes on that row.
   - **Categorized, without one yet:** the section shows a placeholder subsection titled "Based on your listening" (a 15px subsection header and one row of card skeletons) in that row's place, until Shuffleupagus answers. This replaces the tail on whichever row happens to be first, so the placeholder sits where the picks will land.
   - **No Albums section at all:** the existing `type:album-pending` slot stands in.
   - **The source filter:** filtering happens at render, so it never changes row keys. Picking Shuffleupagus keeps `albums:personal`; the keys don't flip.
2. **Amazon's strategy sections.** Captured on 2026-11-12, they held only albums (recents 15, "Albums for You" 15, the artist shelf 13).
   - **If one ever carries playlists,** the section's category applies to them too. That's correct in meaning: recents playlists are "Made for you", and an artist shelf's playlists are "Because you like".
   - **Album items carry `artist`,** since the normalizer keeps it, so the seed rule reads that field.
3. **Generalizing the helpers.** One `CATEGORY_TABLES = { playlist, album }` drives validity, rank, titles and rows, through a generic `categoryFor(type, item, sectionCategory)`. Only playlists keep the `weekly` → personal rule.
   - `PLAYLIST_CATEGORIES` and `playlistCategory` stay as exported names, so existing tests and docs keep working.
   - `playlistCategory` becomes `categoryFor('playlist', …)`.
4. **The single-row fallback works as it does for playlists.** The row's `category` is null, items keep their stamped categories, and pageable entries carry the section's category. Nothing downstream reads the item categories on a single row.
5. **`new` ships now, unused at first.** It stays in the album table and is documented as unused until a provider sends it (Apple, after the capture). That avoids a second contract change.
6. **Open/closed state resets when the row set flips** between one row and several, as it does for playlists. This is a known, accepted minor.

## Calls I made (check these)

- The album titles: "New for you", "Based on your listening", "Because you like …", "From the editors", "More albums".
- `new` is album-only; `community` doesn't apply to albums.
- Shuffleupagus's albums count as `personal`.
- Amazon's artist shelf takes its seed from the albums' shared artist, never from the shelf title.
- Apple waits for the live capture, and lands in More albums until then.
