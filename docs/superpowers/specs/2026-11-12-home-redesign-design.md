# Home page redesign

Date: 2026-11-12. Mock: "Parachord Home Redesign", a private claude.ai Design canvas. Board **A · Quick Play shelf** is the chosen direction. Board B was the alternative; A borrowed the setup checklist from it (and briefly its "More to explore" row, since replaced by the Shuffleupagus prompt).

## Why

Home is the first thing you see, and its job is to get you playing something in one click. Usually that's a playlist that just changed, or your recent loves. Today's Home is in the way:

- **Recently Added** goes weeks without changing.
- **Two playlist blocks** read as the same thing.
- **Continue Listening** repeats the track that is already in the player and the queue.
- **Setup prompts** keep showing after the thing is done (the browser extension, for one), and there's no way to dismiss them.
- **Remote announcements** sit above every page, not just Home.

## Goals

- **One click to play.** The first row has four things you're likely to want right now, each with a play button.
- Show what you love, what you might love, and what changed in your playlists and listening.
- Show, without taking over the page:
  - the play-history mixes your services make (#1342 kept them off Recommendations so they could go here);
  - Fresh Drops, Critical Darlings and concerts.
- **Smarter setup prompts.** They disappear once done, can each be dismissed, and live behind one small button, not cards in the page.
- **The remote announcement banner becomes a Home-only slot.**

## Non-goals

- No change to the Recommendations page. It keeps its five sections (#1334). Home shows a slice of the same answers.
- No new recommendation sources. Home reads what the plugins and the existing pages already fetch.
- No change to the announcement schema, the Achordion endpoint, dismissals or telemetry. Only where the banner renders changes.
- No friends section. The sidebar already shows friends.

## Anti-goals (a failure even if it technically works)

- **Home grows a request budget.** Opening Home starts new MusicBrainz or service requests on its critical path that today's Home doesn't.
- **A section shows empty or as a bare spinner.** Every section has a skeleton while it loads and disappears when it has nothing to show.
- **The first row repeats what's playing or queued.**
- **A setup item comes back after it was dismissed or done.**
- **An old app shows history mixes on Recommendations.** The plugin change below must not undo #1342 on apps that predate this redesign.
- **The page re-renders on every app state change.** Home is a `React.memo`'d module fed stable props (`page-memo.test.js`), and stays that way.

## The page, top to bottom

Each section below names its content, where the data comes from, its order, its "See all" target, and what happens when it's empty. Sections render in this order and none of them is optional in the layout. A section hides only when it has nothing to show.

### 1. Announcement banner (Home only)

Today's banner moves from the main content area (`activeAnnouncements` in `src/renderer/app.js`) to the top of Home.

- One banner at a time. Dismissing it shows the next one, and the slot closes completely once none are left.
- Same schema as today:
  - icon or `iconUrl`;
  - title and body;
  - optional CTA;
  - the × to dismiss;
  - severity colours.
- Same per-id dismissal, and the same view, dismiss and CTA telemetry. The `view` event now fires only when Home paints it.
- The success and warn colours get darker so white text passes 4.5:1 (today's green fails).
- Other pages show no banner.

### 2. Header

- "Good evening" (by time of day), with one line under it saying what changed, from the freshest playlist ("Daily Brew picked up 12 new tracks this morning").
  - Builder's call when nothing changed: show a different line, or none.
- On the right:
  - **Finish setting up · N of M**, the setup checklist (below).
  - **Play Collection Radio**, styled as a play action: a white circle with a play triangle inside an accent pill. It replaces "Start Collection Radio".
- Today's gradient hero header goes. My call: it pushed the first play button down the page.

### 3. Jump back in

One row of four tiles (two by two when the page is narrow). Each tile has art, a title, a subtitle and its own Play button; clicking the rest of the tile opens the item (see "Decisions after the first build"). There's one tile of each kind, in this order:

1. **Freshest playlist.** The playlist with the most recent `lastModified` (see Your playlists for what counts as a change). The subtitle says what changed ("Playlist · 12 new today").
2. **Recent loves.** Your last 50 loved tracks: collection tracks, newest `addedAt` first, played as a queue.
3. **The album behind your latest love.** The album of the most recently loved track.
   - Skip to the next love when that track is a single with no album, or the album is already playing or in the queue.
   - The subtitle names the track ("Frog · the album behind your latest love, Hartsdale Hotbox").
4. **A history mix.** The first mix from "Made from your listening".

A tile whose source has nothing is left out, and the row shows what remains. The row never shows what's already playing or queued; if a tile would, it takes the next candidate.

This replaces **Continue Listening**.

### 4. Made from your listening

The play-history mixes your services make, led by Recent loves, up to six cards.

- **Recent loves always comes first**: your last 50 loved tracks, as a card with a mosaic of the newest loved albums. It opens Collection's songs newest loved first, and plays and queues under the `loves` context. It's no service's, so it adds no filter chip and shows whatever chip is selected.

- Each card shows the mix's title and a one-line description. The row's source filter names the services, so the card carries no service label.
- **Source filters**: All, then one chip per service that returned at least one mix. A chip filters only this row.
- **No "See all"**, because no page lists these: Recommendations leaves them out on purpose.
- **Hidden** when there are no loves and no service returns a mix.

Which mixes count as play history:

- **Apple Music:** Heavy Rotation, Your Essentials / Favorites, Replay. These are the mixes `isPlayHistoryMix` already identifies in `plugins-src/applemusic/implementation.js`.
- **ListenBrainz:** Daily Jams and Weekly Jams. Weekly Exploration is new music, so it stays on Recommendations.
  - My call. #1334 moved the weekly rows to Recommendations' Playlists section, and this moves the two history ones back.
- **Amazon Music:** whichever home-page shelves are play history. To be identified against the live gql, the way #1310 did for its personal shelves.

**The plugin contract (decided).** History mixes come from a new optional plugin method, `getHistoryMixes(config)`, which returns `{ mixes: [playlist, ...] }`. They do not come back in `getRecommendations`.

- Reason: an app older than this redesign ignores a method it doesn't know. If the mixes came back inside `getRecommendations` with a marker, an older app would show them on Recommendations again and undo #1342.
- Route by the registry and check the capability before calling, per the CLAUDE.md invariant.
- Bump each plugin's `manifest.version`, and commit `marketplace-manifest.json`.
- A failed call throws. Never return `[]` for a failure.

### 5. Your playlists, freshest first

Six playlist cards, ordered by **when each playlist last changed**, not by when it was created. A playlist that refreshes itself (a hosted XSPF, a synced mirror) stays up front however old it is.

- The art is a 2×2 mosaic.
- A badge shows how many tracks the latest change added ("Δ 12"), while that change is recent. See point 3 of "Settled after a builder's read".
- The subtitle reads "Refreshed 2h ago · since 2023": when it last changed, and the year it was created.
- **See all** opens the Playlists page.
- **Hidden** with no playlists.

**What counts as a change.** Tracks added, removed or reordered, whether locally, by a sync pull, or by a hosted playlist's refresh. A metadata-only write is not a change: a `syncedFrom` heal, a sync-state stamp, a rename.

`lastModified` doesn't follow that rule, because renames bump it, so freshness uses a new `tracksChangedAt` field. See point 2 of "Settled after a builder's read". Build save payloads with `window.buildPlaylistSavePayload` as always.

This replaces both of today's playlist blocks.

### 6. Albums you might love

Six album cards from every source that recommends albums:

- the plugins' `getRecommendations` album picks (Apple Music, Amazon Music, ListenBrainz, Last.fm);
- Shuffleupagus's album suggestions.

Each card names its source and why it was picked ("Last.fm · like Hovvdy"). Shuffleupagus's reason is a badge with a tooltip instead (see "Decisions after the first build").

- **Source filters**: All, then one chip per source with at least one album. A chip filters only this row.
- **See all** opens Recommendations.
- Home reads the answers Recommendations caches (`cache_recommendations`). When that cache is empty or stale, Home fills it itself, in the background. See point 1 of "Settled after a builder's read".
- No Refresh control on this section. Shuffleupagus's batch refreshes from the Recommendations page's Refresh, or on every visit with the "Refresh Home suggestions on every visit" setting (`lib/home-suggestions-refresh.js`).
- **Hidden** when no source has albums.

This replaces the Discover, Album Suggestions and Artist Suggestions sections.

- My call: artist suggestions leave Home. They live on Recommendations' Artists section.

### 7. Fresh Drops and Critical Darlings

Two rows side by side, each with three album cards, a short description and a **See all** link to its own page.

- **Fresh Drops**: new releases from artists in your collection, from the Fresh Drops data (`newReleases`). Each card wears the Fresh Drops page's release-type badge (Album, EP, Single) in the art's top-right corner, in that page's colours.
- **Both halves** are cards that open with a slim band copied from their pages' heroes: the same gradient (emerald to cyan, amber to red) and the collapsed hero's uppercase light title, with the sidebar's icon and a "See all" link. The cards sit below on the page background.
- **Critical Darlings**: from `criticsPicks`, with its score or source as the tag. A pick with a critics' summary carries it in a lower-right badge with a tooltip.
- Each half hides on its own when it's empty, and a half that is alone stays half width.
- Home starts neither fetch on its critical path. When the data isn't loaded yet, it loads in the background lane, after the sections above have their data.

### 8. Concerts near you

Four concert cards from the Concerts page's data (`concerts`, filtered by `concertsLocation`). Each card shows:

- a date block;
- the artist;
- the venue and city;
- a Tickets link, the card's only action (see "Decisions after the first build").

**See all** opens Concerts. The section is **hidden** when no location is set or no shows are coming up. Same background-loading rule as section 7.

### 9. Ask Shuffleupagus

A prompt box at the bottom of Home, with an example prompt already filled in. It replaces the "More to explore" chips; the other pages stay reachable from the sidebar.

**The example prompt.** It's built from what you've been playing, for example "A rainy Sunday playlist built around Hovvdy, Nap Eyes and Frog".
- It's made locally from the top few artists in your recent plays and loves, with no AI call.
- It changes on each visit.
- The builder chooses the phrasings, from a small fixed set.

**Editing.** The box is an ordinary text input: you can edit the example or replace it. It is capped at 500 characters, the `parachord://chat` limit.

**Ask** (or Enter) opens the Shuffleupagus panel and sends the prompt.
- It goes through the existing deep link, `parachord://chat?prompt=…` (see `docs/protocol-schema.md`, "AI Chat"), so Home and outside links share one code path.

**The confirmation dialog.**
- That link asks for confirmation before sending a prompt, so an outside link can't inject one. Home skips the dialog, because the user typed or approved the prompt in the app.
- The skip comes from an in-app origin flag the renderer passes when it calls the protocol handler directly. It is never a URL parameter.
- A `parachord://chat` link arriving from outside the app (the OS, the local `/protocol` endpoint, the browser extension) always confirms, as today. A test pins both paths.

**No chat plugin enabled.** The section shows a "Set up Shuffleupagus" button in place of the box, and the button opens the AI plugin settings.
- This keeps Home from offering a chat that #1020 shows can be unreachable.

## Card hover actions by asset type

Every card on Home matches what the same kind of thing does elsewhere in the app. The section it sits in doesn't change that.

- **Album:**
  - **Where:** the album tile in Jump back in, Albums you might love, Fresh Drops, Critical Darlings.
  - **On hover:** the art dims, with three buttons over it (the `CollectionAlbumCard` / `ReleaseCard` pattern):
    - **Add to Playlist** on the left;
    - **Play** in the centre, larger;
    - **Add to Queue** on the right.
  - **Clicking the card** opens the album page (placeholder first, lookup after, per the renderer rules).
  - **Right-click** opens the album context menu.
  - **Hovering for 250 ms** prefetches the tracklist, background lane, like the other album grids.
- **Playlist:**
  - **Where:** the playlist tile in Jump back in, Your playlists, Made from your listening.
  - **On hover:** **Add to Queue** and **Play** at the bottom-right of the art.
  - **Clicking the card** opens the playlist view. For a service mix that isn't a local playlist, it opens the same remote-playlist view the Recommendations page's playlist cards open.
  - **Right-click** opens the playlist context menu.
- **Recent loves tile:**
  - **On hover:** shows play.
  - **Clicking** plays the loves as a queue.
  - **Right-click** offers Add to Queue and "Open in Collection" (Collection's songs, newest loved first).
- **Jump back in tiles in general:** clicking the tile opens the item (the playlist, the album page, Collection's songs for recent loves, the remote-playlist view for a mix), and a separate Play button on the tile plays it. Adding to the queue is in the right-click menu for its type. (This replaces "the whole tile is the play button"; see "Decisions after the first build".)
- **Concert:**
  - **The card has no click action.** Tickets is its only action.
  - **One seller:** Tickets is a direct link to that seller.
  - **Several sellers:** Tickets is a disclosure button that shows a list of links, one per seller. It closes on an outside click, on Escape (focus returns to Tickets) and when focus leaves it.

Every action button has an `aria-label` naming the item. Actions appear on `:focus-within` as well as hover, so a keyboard user can reach them.

## Dark mode

Home works in both themes. The mock has a dark board, "A · dark mode", drawn from the app's dark tokens in `index.html`.

**Colours.**
- Every surface, border and text colour comes from the theme variables (`var(--bg-primary)`, `var(--bg-secondary)`, `var(--card-bg)`, `var(--border-default)`, `var(--text-primary)`, `var(--text-secondary)`, `var(--accent-surface)` and so on). No hard-coded neutral colours, per the CLAUDE.md rule.

**Contrast in dark mode.**
- Secondary and label text use `--text-secondary` (#9ca3af), never `--text-tertiary` (#6b7280). That one fails 4.5:1 on #161616.
- Filled play buttons keep white text and icons, so their fill must pass 4.5:1 against white in dark mode too. Dark mode's `--accent-primary` (#a78bfa) doesn't, so filled buttons use the light accent (#7c3aed) in both themes. Text links and outlines use `--accent-primary` / `--accent-soft`.

**Things that stay the same in both themes.**
- Badges and buttons drawn over album art keep a light chip with dark text, since they sit on artwork, not on the page.
- The announcement banner's severity colours are identical in both themes. They already pass with white text.

**Pinning it.**
- Skeletons use the existing shimmer variables, so they follow the theme.
- A test pins that the new Home modules contain no hex neutrals outside album-art placeholders.

## The setup checklist

Today's "Enhance Your Experience" cards (`home-page.js`, around L232) become the **Finish setting up · N of M** button in the header. It opens a short list.

- **The items** come from today's checks:
  - popular resolvers not installed;
  - Last.fm, ListenBrainz and Spotify connected;
  - the browser extension connected (only when it's explicitly false, as today);
  - Raycast (Mac only).
- **Done items** show checked and struck through. Open items have an action button and a ×.
- **Dismissing** an item hides it for good. It's stored under a new key, `home_setup_dismissed` (an array of item ids). Add the key to `ALLOWED_STORE_KEYS`.
- **Finishing.** Once every item is done or dismissed, the pill turns into the What's new link (below), and doesn't disappear.
- **Release notes live in this element too** (the user's call). They never use the banner.
  - The popover's first row is **What's new in vX.Y.Z**. It opens the existing What's New modal, and shows a dot until this version's notes are opened (`whats_new_dismissed_version`).
  - The row can't be dismissed and doesn't count toward N of M.
  - While this version's notes are unread, the pill carries the same dot.
  - Once every setup item is done or dismissed, the pill doesn't disappear. It becomes **What's new in vX.Y.Z** (with the dot while unread), and a click opens the notes directly. So the release notes always have an entry point.
- **An empty collection** isn't a setup item. Home shows its own empty state for a new user (below).

## A new user

With no collection, no playlists and no services connected, most sections hide.

- What remains: the header (with the checklist), Albums you might love (Shuffleupagus may still answer), Fresh Drops, Critical Darlings and Ask Shuffleupagus (with an example prompt that needs no history, or the set-up button).
- Plus an empty-state card in Jump back in's place pointing at importing a collection. This replaces today's "Build Your Collection" card.
- The builder designs that card's look, in the page's style.

## Constraints from the codebase (CLAUDE.md)

- **Skeletons.**
  - Every section ships with a skeleton in the same grid, card box and item count.
  - The skeletons live in a components module next to the page, like `recommendation-skeletons.js`.
  - Pin the shared dimensions in `tests/ui/loading-skeletons.test.js`.
- **Memoisation.**
  - `HomePage` stays `React.memo`'d with stable props. New plain functions go through `HOME_PAGE_HANDLERS`.
  - Derived lists are `useMemo`s:
    - the freshest-playlist order;
    - recent loves;
    - the latest love's album;
    - the filtered rows.
- **Album art.** All art goes through `getAlbumArt` / `getTrackArt` (background lane). Broken covers report through `window.reportBrokenAlbumArt`.
- **MusicBrainz.** Any lookups (the latest love's album, say) use the background lane. A click changes the view before its lookup.
- **Registry.** Route by the plugin registry, never by service name. Source names and labels come from the resolver records.
- **Store keys.** Any new persisted key goes in `ALLOWED_STORE_KEYS`.
- **Tailwind.** New Tailwind classes mean `npm run build:css` and committing `vendor/tailwind.css`.
- **Docs.** Update in the same PR:
  - `docs/architecture/announcements.md` (the banner is Home-only now);
  - `plugins.md` (`getHistoryMixes`);
  - `docs/protocol-schema.md` (the in-app origin skips the chat confirmation; outside links still confirm);
  - `docs/features/` if Home is described there;
  - the README if it describes Home.

## Settled after a builder's read

A fresh reviewer read this spec as its builder and raised the points below. Each is settled here; the ones marked *my call* are mine, not the user's.

1. **Home fetches what it shows (my call).**
   - Home never waits on Recommendations having been opened. When `cache_recommendations` is empty or stale, Home runs the same load Recommendations runs (`loadRecommendations`, same per-provider cache, 20s bound and generation guard).
   - History mixes get their own cache key, `cache_history_mixes` (in `ALLOWED_STORE_KEYS`, saved like the other `cache_*` keys), with the same freshness window as the recommendations cache.
   - Both run in the background, after Home's local sections (Jump back in, Your playlists) have painted. "No new requests on the critical path" means exactly that: nothing Home needs for its first paint waits on the network.
2. **Freshness gets its own field (my call).**
   - `lastModified` is bumped by renames and other non-track writes, so it can't be the freshness signal. Add `tracksChangedAt`, set only where a playlist's tracks change: local edits, sync pulls, hosted refreshes.
   - Also store `lastChangeAdded`, the number of tracks the latest change added (new ids minus old ids), computed at the same moment.
   - Both ride along in the save payload through `buildPlaylistSavePayload`'s spread. No field list changes, and no sync contract changes, because neither field is pushed to a service.
   - A playlist saved before the field exists falls back to `lastModified` until its tracks next change.
3. **The "Δ N" badge and "N new" lines use the latest change, not "since your last visit" (my call; this replaces the window stated in section 5).**
   - The badge shows `+lastChangeAdded` while `tracksChangedAt` is within the last 7 days, and is hidden otherwise.
   - The header line and the freshest tile's subtitle use the same two fields ("picked up 12 new tracks this morning", "12 new today"), with the time phrase taken from `tracksChangedAt`.
   - No visit timestamp or per-playlist snapshot is stored.
4. **Loves and the latest love's album.**
   - "Loved" means a track in the collection; its `addedAt` is the love time. The builder checks that synced loves (Spotify and others) carry `addedAt`, and sorts any track without one last.
   - The album tile needs no lookup to render: it shows the track's album name and artist, with art from `getAlbumArt` in the background lane.
   - Opening it uses the normal album opener (placeholder first, lookup after), so nothing lands on the critical path.
5. **Release notes are not a banner (the user's correction, 2026-11-12).**
   - The banner slot is only for announcements created on the backend and pushed to Parachord and/or Achordion.
   - Release notes live in the "Finish setting up" element (the user's call): a "What's new in vX.Y.Z" row in its popover. Once setup is done, the pill itself becomes that link. See "The setup checklist".
   - #1352 tracks any further polish.
6. **"Already playing or queued" (my call).** Jump back in compares each candidate against the playback context of what's playing and of what's queued:
   - a playlist by its id;
   - an album by its MBID, else normalised album and artist;
   - recent loves by a `loves` context type.
   - It doesn't compare track sets.
7. **Setup items (my call).**
   - Stable ids: `resolvers` (one item for all popular resolvers not yet installed, "Add more music sources"), `lastfm`, `listenbrainz`, `spotify`, `browser-extension` and `raycast`.
   - N of M counts these items, leaving out any the platform doesn't offer (Raycast off macOS).
8. **What Play does.**
   - Every play action on Home, tiles and Play Collection Radio included, does what Play does everywhere else in the app: it replaces the queue through `handlePlay` with the item's context, under the same spinoff and listen-along rules.
   - Add to Queue is the non-destructive path.
9. **Shuffleupagus's reason.** Its album suggestions already carry `reason` (today's Home shows it in a tooltip). Superseded by the user's later call: the reason is a lower-right badge with a tooltip, not a text line (see "Decisions after the first build").

## Decisions after the first build

The user's calls after reviewing the built page (2026-11-12). They override anything above that says otherwise, and PRs 3 and 4 and the Android ticket should follow them.

1. **Jump back in tiles open the item, with a separate Play button.** Clicking a tile opens what it shows; its own Play button plays it. The row is four tiles across, and two by two below about 920px of row width.
2. **Concert cards have no card click.** Tickets is the only action: a direct link for one seller, a disclosure list of links for several. Only http(s) ticket URLs are linked.
3. **The Shuffleupagus reason and the critics' summary are badges.** Each is a round badge in the art's lower-right corner with a tooltip (Shuffleupagus's icon for both), not a text line. The text is also the badge button's accessible description, so a screen reader gets it without the tooltip. A Critical Darlings pick with no summary has no badge. Escape dismisses the tooltip.
4. **Source filter pills are colour-coded.** Each source's pill takes its plugin's `resolver.color` (Shuffleupagus uses the fill accent): a dot in that colour when idle, the colour as the fill when selected. The selected pill's text colour is picked by `readableTextOn` (`src/renderer/lib/readable-text.js`) by strict WCAG contrast against the fill. "All" stays neutral.
5. **Rows use a 24px gap** between cards (`HOME_ROW_GAP`), shared with the skeletons.
6. **Playlist subtitles are two lines**: the refresh age, then "Since 2023".

Also settled while fixing the first build's review (my calls):

- **Fresh Drops and Critical Darlings** each sit at a fixed half-width basis. A half still loading draws its skeleton in its own place while the other half shows cards, so nothing moves when data lands.
- **The import card** shows only for a new user: no collection and no playlists. A collection with nothing in Jump back in hides the row instead.
- **A playlist with no covers yet** shows the Playlists page's playlist glyph. Covers the cache holds go on screen at once, and missing ones are fetched freshest first, Home's order.
- **Home's recommendations load** is skipped when a full recommendations load finished in the last 10 minutes.
- **The Ask example** strips control and bidi characters from artist names and caps each at 40 characters.

## Left to the builder

- The visual details beyond the mock: spacing, hover states, card sizes at narrow widths. Narrow widths must work: rows wrap or scroll, and nothing overflows.
- How many of each card show at narrow widths. The skeletons follow the choice.
- The exact Amazon shelves that count as history.
- The header's change-line wording, and whether the line shows when nothing changed.
- How to split the work into PRs. A suggested order:
  1. the banner move and the setup checklist;
  2. the layout with the existing data;
  3. `getHistoryMixes` in the plugins;
  4. the freshness rule for playlists.

## Mobile

Android has its own Home. Once this lands, a parachord-mobile ticket should carry over these items, since they're shared invariants:
- the `getHistoryMixes` contract;
- the freshness rule;
- the setup-dismissal behaviour.
