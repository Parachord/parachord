# Recommendations and Discovery

Every surface in Parachord that suggests music the user did not ask for by name, what feeds it, and what it produces. Written from the code as of November 2026, not from the design plans. Functions are in `src/renderer/app.js` unless another file is named.

Related: [METADATA_SOURCES.md](../architecture/METADATA_SOURCES.md) (artist images, bios, album art), [PLAYLIST_IMPORT_AND_SYNC.md](PLAYLIST_IMPORT_AND_SYNC.md), [protocol-schema.md](../protocol-schema.md).

## Summary

| Surface | Where in the UI | Algorithm / source | Seeded by | Produces | Needs |
|---|---|---|---|---|---|
| Recommendations | Sidebar "Recommendations"; Home "For You" | Plugins with the `recommendations` capability (Last.fm station, ListenBrainz playlists, Amazon Music home) and the `similarUsers` capability (ListenBrainz, Last.fm); Shuffleupagus | Server-side, from the user's listening history + AI | Five sections (Songs, Albums, Artists, Playlists, Friends), each opening with a blended "For you" row, then the providers' titled rows | Last.fm or ListenBrainz username, an active recommendations resolver, or an enabled AI chat provider |
| Weekly Jams / Weekly Exploration | Recommendations page, first in the Playlists section | ListenBrainz `createdfor` playlists, through the plugin's `getRecommendations` | ListenBrainz's own weekly generation | Track playlists | ListenBrainz username |
| Shuffleupagus suggestions | Home "AI Suggestions" section (Shuffleupagus badge, with Refresh); Recommendations page, blended into the Albums and Artists sections | AI chat plugin, one prompt per visit (either page) | Listening history, collection, prior suggestions | Albums and artists (with reasons) | AI chat plugin + "Share my data" |
| Shuffleupagus chat | Playbar AI button; Home; `parachord://chat` | AI chat plugin with tools | Listening history, collection, queue, playlists, friends | Anything the model plays, queues or saves | AI chat plugin |
| AI Playlist (one shot) | Prompt panel | AI `generate` plugin | Listening history when sharing is on | Track list | AI generate plugin |
| Related Artists | Artist page tab | Last.fm `artist.getsimilar` merged with ListenBrainz labs `similar-artists` | The artist | Artists | Nothing |
| Fresh Drops | Sidebar; Home "New from artists you love" | MusicBrainz release groups per artist | Collection, library, listening history | Release groups (albums, EPs, singles) | Nothing (empty with no collection or scrobbler) |
| Critical Darlings | Sidebar; Home "Acclaimed by critics" | Achordion critics feed | Not personalized | Albums | Nothing |
| Pop of the Tops | Sidebar | Apple Music RSS charts; Last.fm charts | Not personalized | Albums, tracks | Nothing |
| Spinoff | Playbar button | Last.fm `track.getsimilar`, topped up from `artist.getsimilar` + `artist.gettoptracks` | The playing track | Tracks | Nothing |
| Collection Radio | Home; Collection page; menu; `parachord://collection-radio` | Shuffle of the user's own tracks | Collection + local library | Tracks | Nothing |
| Protocol radio | `parachord://play/radio` | External pool (JSPF / XSPF / JSON), e.g. ListenBrainz lb-radio | Publisher-supplied | Tracks | ListenBrainz token for lb-radio URLs |
| Concerts | Sidebar "Concerts"; artist page "On Tour" | Bandsintown, Songkick, SeatGeek, Ticketmaster plugins | Collection, listening history | Events | At least one concert plugin with a key |
| Friend activity | Sidebar friends; Home "Friend Activity"; friend page | Last.fm / ListenBrainz recent tracks and stats | Friends' listening | Tracks, artists, albums | Last.fm or ListenBrainz username |

Nothing in the app calls ListenBrainz `cf/recommendation` or labs `similar-recordings`, Spotify `/v1/recommendations`, or any Achordion recommendation endpoint. There is no "because you listened to" or daily-mix style surface. ListenBrainz `similar-users` is called, by the Friends section (below).

## Shared mechanics

**Last.fm API key.** `getLastfmApiKey` uses the user's key when set and otherwise a key built into main.js. The "no API key" branches in the Last.fm code only run if that fallback is removed, so Last.fm-backed surfaces that need no username (Related Artists, Spinoff, charts) work out of the box.

**"Configured" for a scrobbler** means a username is stored in the Last.fm or ListenBrainz meta-service config. No recommendation surface needs the ListenBrainz token. The token is only attached to lb-radio fetches over the protocol.

**Unread dots.** `generateDiscoveryHash` joins the first ten item IDs of a surface. `checkDiscoveryUnread` compares that against the persisted `discovery_seen_{recommendations|criticsPicks|charts|newReleases|concerts}` keys. The first load is never marked unread. Dots can be hidden with the `showDiscoveryBadges` setting.

**Cache lifetimes** (`CACHE_TTL` in src/renderer/app.js): recommendations are cached PER PROVIDER for 1 hour (`recommendationsCache`, saved to `cache_recommendations`), similar users for 7 days, plus a 20s bound per provider fetch (`recommendationProvider`); charts 24 hours, Fresh Drops 6 hours, concerts 24 hours. Critical Darlings are refetched after 4 hours (checked in `loadCriticsPicks`, not a `CACHE_TTL` entry).

**Recommendation blocklist.** `addToRecommendationBlocklist` stores `{ artists, albums, tracks }` under the store key `recommendation_blocklist`, written by the `block_recommendation` tool from in-app chat or MCP. `recommendation-blocklist.js` (root, loaded by index.html as `window.recommendationBlocklist`) decides what "blocked" means: a blocked artist blocks everything by them, a blocked album blocks that album and tracks on it, a blocked track blocks that track only, all case-insensitive and exact. It is applied by the Recommendations page (at MERGE time, so a block made since a provider cache was filled takes effect immediately — the item pick is `blockedItemPick` in `src/renderer/lib/recommendation-model.js`), Fresh Drops, the Shuffleupagus suggestions (filtered in code and listed in the prompt), and the chat system prompt (a BLOCKLIST section after the "do not recommend" list). Charts, Critical Darlings and Spinoff are not personalized and do not consult it. There is no UI to view or clear the list yet.

## Recommendations page

Code: `loadRecommendations`, `loadMoreRecommendationSection`, `refreshMergedRecommendations` in src/renderer/app.js; the pure model is `src/renderer/lib/recommendation-model.js`. Loaded on navigation to the page and for the Home "For You" card (Home asks only the scrobbler meta-services, so a content resolver's recommendation fetches are the page's own to ask for and a Home visit never queues them ahead of track resolution).

The page is provider-driven: every plugin with the `recommendations` capability answers `getRecommendations` with sections of typed items (artist / album / song / playlist, each with an optional image URL, reason, and stable ids the service already knows; an MBID or ISRC rides onto a song's track so MBID enrichment and the exact-MBID match tier need no extra lookup; see "Recommendations" in [../architecture/plugins.md](../architecture/plugins.md)). The layout is five sections, in this order: **Songs, Albums, Artists, Playlists, Friends**.

- **Each section is one blended row** (key `type:<type>`; Listeners is its own row of people). It interleaves every provider's picks of that type, untitled and titled sections alike, with Shuffleupagus's (albums and artists only), round-robin across sources with Shuffleupagus last, so no source buries another. A provider's section titles ("Albums for You", "Based on Your Recents") are not shown: an Amazon album lands in Albums next to Last.fm's. A pick two sources agree on appears once: the first provider keeps it and the item records every source in `sourceIds` (keyed per type; a weekly playlist by its own id, since its names repeat). The Artists row is also fed by artists derived from the providers' untitled songs.
- **A filter bar under the hero**, as on the other tabs (Fresh Drops' bar and pills): All, then one pill per source on the page (`pageSources`), no counts; like the other tabs' pills, each has its own active colour (All the tabs' purple, a source its plugin manifest's `color`, Shuffleupagus the accent). One pick filters every section (`filterRowBySource`: an item shows when that source sent it, so a pick two sources share shows under either), and a section left empty is hidden. Session-only: nothing persists, and a source that leaves the page falls back to All.
- **A collapsed section shows two full rows of cards** for Albums, Artists and Playlists (as many as fit across at the current width, measured with a ResizeObserver), one row of people for Listeners and five song rows for Songs, so "See all" only ever adds rows. **"See all" / "Show less"** sits on the right of the heading, in Home's purple link style, and carry no item counts. Opening a section also pages every provider section in it that can paginate (a provider that implements `expandRecommendationSection`, Amazon Music; the row lists them in `pageable`, and a provider section holding two types pages once for both): pages keep arriving in the background while the section stays open, and collapsing stops the chain. Paged items append after the blended first pages, so nothing on screen moves. The chain is bounded from below and above: a page repeating the cursor it was sent (no advance), or ten pages fetched, exhausts that provider section no matter what the provider says.
- **Shuffleupagus has no section of its own and no Refresh here.** Its suggestions are interleaved into the Albums and Artists sections (round-robin with the providers, Shuffleupagus last in each round); they refresh from Home (the Home "AI Suggestions" Refresh, or the every-visit setting). While it is thinking, each section it will land in shows 3 placeholder cards after the real ones; with neither section on the page, one placeholder section stands where Albums will be, under an Albums heading. With a source picked in the filter bar, only the Shuffleupagus pick keeps these placeholders.
- **Weekly playlists lead the Playlists section** (see below).
- **Listeners** is its own row of people (see below).
- Songs resolve through the shared resolution scheduler (source badges, per-resolver play) like every other track list. Albums open through `handleCollectionAlbumClick` and offer Play / Add to Queue / Add to Playlist on hover. Every playlist card's second line names its source ("ListenBrainz", "Amazon Music"), since the row blends services. Playlists open in the playlist view through the ephemeral external-playlist flow (`loadPlaylist` with an `isEphemeral` playlist; tracks from the generic `lookupPlaylist` path, track ids `trackSlug(artist, title)`, creator/source from the item's resolver and that source's name on the row); on hover a playlist card offers the standard playlist set (Add to Playlist, Play, Add to Queue, as on the Playlists page), all three loading the tracks the same way without opening the playlist. Importing is the playlist view's SAVE, which runs `handleImportPlaylistFromUrl`.

Providers: Last.fm (the recommended station, `plugins-src/lastfm/implementation.js`), ListenBrainz (the recommendation playlists, `plugins-src/listenbrainz/implementation.js`), Amazon Music (on Music Unlimited and Prime alike: a Prime account's music tab is refused, so the bridge reads its full home instead; the music home gql, meaning the "Albums for You" style sections plus the "Playlists for You" section with the user's mixes, "My Discovery Mix" included. Only the personal sections reach the page: the plugin keeps sections whose id is a named strategy and drops Amazon's editorial shelves ("Top Playlists", "Featured This Week", "Amazon Music Live", the genre shelf "Soundtracks", the onboarding "Let's Get Started", "Recently Played"); see [../architecture/amazon-music.md](../architecture/amazon-music.md)). The fetches used to live in app.js; they moved into the plugins so the page is capability-driven and mobile can mirror the same contract. A provider that is not configured answers `[]` without a request; a readiness failure (signed out) is kept out of the cache so the next visit asks again.

- **Last.fm**: one request to `https://www.last.fm/player/station/user/{username}/recommended`. This is the website's recommended-station JSON, not a documented API method, and it takes no API key. It returns a `playlist` of tracks.
- **ListenBrainz**: `GET /1/user/{username}/playlists/recommendations`, then the tracks of the playlists it picks from `GET /1/playlist/{id}`. The list is newest first and mixes Daily Jams, Weekly Jams, Weekly Exploration and the yearly "Top Discoveries of <year>" and "Top Missed Recordings of <year>" round-ups, so the plugin picks by type (the playlist's `source_patch`, or its title when that's missing): for the Songs picks, Weekly Exploration if it's under 14 days old, else the newest Daily Jams or Weekly Jams, else an older Weekly Exploration. It never uses the yearly round-ups, since "Top Discoveries" is the user's own listening. With none of those, the songs pick is empty (no fallback to the user's own top recordings, parachord#1021). The weekly playlists are separate titled sections (below), and they survive a songs-pick miss. Requests retry 429 and 503 with 1.5s, 3s and 6s waits.
- Loading: an empty page shows a skeleton of the Songs and Albums sections it opens with, in their real layout (a section heading, then song rows or cards); the filter bar shows All until sources arrive. While a similar-users lookup with nothing cached is out, a row of people placeholders sits under the Friends heading; a provider whose last answer had nobody gets none. Once some sections are on screen, a section skeleton stands in for providers still being asked, until each provider's answer lands (answers apply one by one, in provider order). It carries no provider name because a provider can answer "not ready" (an active resolver the account can't use, such as Amazon Music without a subscription), and a provider whose last answer this session was empty or not ready gets no skeleton on later loads, though it is still asked. An expanded section fetching its next page shows placeholder cards or rows where the new items will land. The skeletons are `src/renderer/components/recommendation-skeletons.js`.
- Not configured (no scrobbler username, no active recommendations resolver, no enabled chat provider with sharing on): a "Connect a music service" card with buttons for each service.
- Cache: per provider, saved as `cache_recommendations` (its own file under `userData/store/`, read with the critical keys at launch) after every fetch round. An answer under an hour old is used without asking again; one up to seven days old (`CACHE_TTL.recommendationsStale`) shows at once while its provider refreshes, so a launch opens on last time's sections instead of a skeleton. Each answer records its account (a meta-service's username), so a changed Last.fm or ListenBrainz user never sees the old one's sections. An empty answer is stored but never served; a not-ready answer drops the saved sections; a transient failure keeps them. Answers apply one by one as they land, so a slow provider doesn't hold back the others, and an answer after the 20s per-provider bound still applies and saves (the bound only ends its skeleton). Similar users are cached beside the providers under `similarUsers` (see Friends below).

## Weekly Jams and Weekly Exploration (Recommendations, Playlists section)

Code: the ListenBrainz plugin's `getRecommendations`; `weeklyHomeEntries` in `src/renderer/lib/recommendation-model.js`; `loadWeeklyJamTracks`.

They moved here from Home. The plugin answers two titled sections, `weekly-exploration` and `weekly-jams`, whose playlist items carry a `weekly` marker, fetched from `GET /1/user/{username}/playlists/createdfor?count=100` (playlists whose title contains "weekly jams" or "weekly exploration"; up to four weeks each: This Week, Last Week, 2 Weeks Ago, 3 Weeks Ago). The page keeps only the newest week of each (latest `date`, else the plugin's first) and places them first in the Playlists section, Exploration before Jams; a card is titled with the playlist's name, its source under it. Tracks come from `GET /1/playlist/{id}`; cover art from the Cover Art Archive via the playlist's `caa_release_mbid`. Home no longer shows them; its weekly state mirrors the page's weekly rows only so the playlist view's lookup and the covers keep working. A weekly playlist's "go to source" in the queue drawer, and the ephemeral-playlist fallback when its library copy is gone, go to Recommendations. Needs a ListenBrainz username; the rows are absent otherwise. They ride the page's per-provider cache.

## Listeners (Recommendations)

Code: `similarUsersProviders`, `refreshMergedRecommendations`, `followRecommendedFriend` in src/renderer/app.js.

The Listeners section: a row of people whose taste is close to yours, each service's most similar first, the services alternating (their scores are on different scales, so one sort across both would always put one service first), only people who listened in the last month or so (ListenBrainz: stats this month or last; Last.fm: top artists in the last month; a check that fails keeps the person), each card showing the similarity score as a badge on the hexagon, the person's name, the service they came from, and up to two lines of their top recent artists, from plugins with the `similarUsers` capability (`getSimilarUsers(config)` returns `[{ username, similarity, avatarUrl?, topArtists? }]`; contract in [../architecture/plugins.md](../architecture/plugins.md)). ListenBrainz uses its similar-users API. Last.fm has no such method, so its plugin works it out from friends of friends, scored by shared top artists (Parachord's own computation, so it needs the API key, the user's or the app's, and costs about 60 requests). Results are cached under `similarUsers` in `cache_recommendations` and refetched only after 7 days, an empty answer included (a successful empty answer is a real answer; a failed lookup throws and stores nothing); concurrent runs share one lookup, and a missing key counts as "not ready" so it is asked again later instead of cached as empty. The row excludes people you already follow, people you removed from Friends, yourself and, for Last.fm, your own Last.fm friends. Opening a person goes to their profile; Follow there adds them like Add Friend (pinned to the sidebar and, for a ListenBrainz person, followed on ListenBrainz too), after which they leave the row. Only Last.fm and ListenBrainz people can appear, since Follow looks a person up on one of those two.

## Shuffleupagus suggestions (Recommendations page)

Code: `loadAiRecommendations` + the `fetchAiRecommendations` effect (src/renderer/app.js); interleaved into the Albums and Artists sections, round-robin with the providers and last in each round (`shuffleupagusSection` in the model). They used to be Home's "Album Suggestions" / "Artist Suggestions" rows; Home keeps its "AI Suggestions" section, which is where they are refreshed.

Runs only when the Recommendations view is active, at least one AI plugin with the `chat` capability is enabled, and "Share my data" (`ai_include_history`) is on. By default the suggestions stay until the user presses Refresh on Home's AI Suggestions section (this page has no Refresh of its own); the page fetches on its own only when it has no albums to show. Settings › General › Discover › "Refresh Shuffleupagus suggestions on every visit" (`home_suggestions_auto_refresh`, off by default) fetches a new batch on each page visit instead. The decision is `shouldAutoRefreshHomeSuggestions` in `src/renderer/lib/home-suggestions-refresh.js`. It calls the selected chat provider (or the first enabled one) with no tools and asks for 12 albums and 20 artists as JSON.

Prompt context:
- `fetchListeningContext()` output: recently played (15), top artists (25), top tracks (20), top albums (15).
- Collection favourites: 15 artists and 10 albums, plus artists and albums of saved collection tracks.
- A random "variety theme".
- An exclusion list of earlier suggestions (last 20 albums, last 50 artists) so refreshes do not repeat.

Each suggested album is checked against a MusicBrainz release-group search (`primarytype:album`, excluding live, compilation, remix, soundtrack and similar) at one request per 1.1s, stopping at five valid albums. The section shows the reasons as tooltips and the album art / artist photos arrive through the page's shared image pipeline (`recommendationImages`). Results persist in the store as `cache_ai_suggestions`. While the LLM thinks with nothing cached, the section skeleton-shimmers.

## Shuffleupagus chat

Code: `AIChatService`, `AI_CHAT_SYSTEM_PROMPT`, `buildSystemPrompt`, context from `getContext`, tool dispatch in `executeDjTool`.

Entry points: the playbar AI button (opens chat whenever any chat provider is enabled), "Chat with Shuffleupagus" on Home, and `parachord://chat?prompt=` (asks for confirmation first).

Tools offered to the model (the inline `djTools` list in src/renderer/app.js): play, control, search, queue_add, queue_remove, queue_clear, create_playlist, shuffle, collection_radio, block_recommendation, get_playlists, get_playlist_tracks, add_to_playlist, remove_from_playlist, reorder_playlist, rename_playlist, delete_playlist. The playlist tools are only offered when "Share my data" is on. `tests/chat/dj-tools-executor-parity.test.js` fails if a registry tool other than `seek` and `get_position` is missing from this list.

Context injected when sharing is on: now playing, the next 10 queue items, shuffle state, 10 collection artists, 8 albums and 10 tracks, listening history per period (5 each) and 10 recently played, a "do not recommend" list of up to 30 artists the user already knows, 15 playlists with sample tracks, time of day, 8 recent session items, 5 recent searches, up to 5 friends' weekly favourites, and whether local files are enabled. With sharing off the model gets a minimal prompt that asks it to suggest enabling sharing once.

Listening context (`fetchListeningContext`) is shared with the Home suggestions and the one-shot generator. It pulls Last.fm `user.gettopartists`, `gettoptracks` and `gettopalbums` for 7day, 1month, 6month and overall plus `user.getrecenttracks&limit=50`, and ListenBrainz `/1/stats/user/{u}/artists|recordings|releases` for this_week, this_month, half_yearly and all_time plus `/1/user/{u}/listens?count=50`, deduplicated across periods and merged across services. Recently played is reused from the History cache if it is under 10 minutes old.

## MCP server

`services/mcp-server.js` advertises the registry in `tools/dj-tools.js` (17 tools) to external agents such as Claude Desktop. That set differs from the in-app chat list: it includes `seek` and `get_position` and lacks `queue_remove` and `collection_radio`. Both dispatch through `executeDjTool` in app.js with their own context objects; the playlist methods are built once by `buildPlaylistToolContext` and spread into both. The MCP context has no "Share my data" gate because the MCP server is its own opt-in. `tests/chat/dj-tools-executor-parity.test.js` fails if a registry tool has no executor case or if the MCP context lacks a method the executor calls.

## AI Playlist (one shot)

Code: `handleAiGenerate` (src/renderer/app.js), which also renders the prompt panel.

Sends the user's prompt to a plugin with the `generate` capability (ChatGPT, Gemini and Custom LLM have it; Claude and Ollama are chat only). When "Share my data" is on, the `fetchListeningContext` result is serialised into the system prompt. The result is a list of `{ title, artist }` shown in an "AI Playlist" sidebar with Play, Add to Queue and Add to Playlist. A "Surprise Me" button appears when sharing is on.

The playbar AI button opens chat whenever any chat provider is enabled and only falls back to this panel otherwise. Every bundled plugin that can generate can also chat, so with bundled plugins this panel is not reachable from that button. See "Known gaps".

## Related Artists (artist page)

Code: `getRelatedArtists`, `getLastfmSimilarArtists`, `getListenBrainzSimilarArtists`. Loaded when the tab opens.

- Last.fm `artist.getsimilar&limit=20`; `match` becomes a percentage.
- ListenBrainz: `POST https://labs.api.listenbrainz.org/similar-artists/json` with the artist's MBID and the `session_based_days_7500_session_300_contribution_5_threshold_10_limit_100_filter_True_skip_30` algorithm. The first row (the artist itself) is dropped and the next 20 kept. Skipped when the artist has no MBID.
- Merge: keyed by lowercase name, Last.fm first. Duplicates keep the higher match, prefer the ListenBrainz MBID, and are tagged `source: 'both'`. Sorted by match descending, with All / ListenBrainz / Last.fm / Both pills.

Needs nothing from the user. Results are kept in React state and reset when the artist changes.

## Fresh Drops

Code: `gatherNewReleasesArtists`, `fetchReleasesForArtists`, `loadNewReleases`. Preloaded in the background once the store cache is ready.

Seed artists, each group shuffled then interleaved, capped at 50: collection artists, artists of collection tracks, artists of collection albums, and listening history (the History page's top artists if loaded, otherwise Last.fm `user.gettopartists&period=12month&limit=50` and ListenBrainz `/1/stats/user/{u}/artists?range=year&count=50`).

For each artist: resolve an MBID (artist cache, then the MBID mapper cache, then MusicBrainz artist search), then `GET /ws/2/release-group?artist={mbid}&limit=100`. Keep release groups dated from six months ago to 14 days ahead, dropping broadcast, compilation and live. MusicBrainz calls run at one per 1.1s, which is why the artist cap exists. A refresh within 24 hours of the last full scan only looks for releases newer than the newest cached one; results merge with earlier runs so the whole library is covered over several sessions.

Produces release groups, including EPs and singles. Art (`fetchNewReleasesAlbumArt`, four releases in flight): the Cover Art Archive release-group front (`coverartarchive.org/release-group/{id}/front-250`), verified with a HEAD request and cached as the final redirected URL; when CAA has no front, `getAlbumArtFromResolvers` (enabled resolvers, then iTunes and Deezer). An unverified CAA guess restored from an older cache is treated as missing and looked up again. Cache 6 hours as `cache_new_releases`. With an empty collection and no scrobbler the list is empty with no error card.

## Critical Darlings

Code: `loadCriticsPicks`.

Source: `https://achordion.xyz/api/critical-darlings/feed.xml`. Fresh items first, topped up to 25 from the local cache of earlier picks. If the Achordion fetch fails, the cache is shown, and an empty cache shows an error. The legacy RSSground feed that used to top the list up during Achordion's ramp-up was removed in #964, once the feed carried 25 or more picks on its own. Art (`fetchCriticsPicksAlbumArt`): `getCachedAlbumArt` first, then `getAlbumArt` (the one album-art pipeline: MusicBrainz and the Cover Art Archive, then resolvers, iTunes and Deezer). Picks restored from the cache without a cover get another art pass at startup once resolvers are ready, since a cache under 4 hours old skips `loadCriticsPicks`. Not personalized, nothing to configure. Cache `cache_critics_picks`, refetched after 4 hours; the unread dot only tracks the fresh feed.

## Pop of the Tops (charts)

Code: `loadCharts`, `loadAppleMusicSongsCharts`, `loadLastfmCharts`.

- **Albums tab**: `rss.applemarketingtools.com/api/v2/us/music/most-played/50/albums.json`. US only, no country picker. Refetched after 4 hours.
- **Songs tab**: a source dropdown (Apple Music or Last.fm) and a country dropdown with 15 countries (`CHARTS_COUNTRIES`). Apple Music uses `rss.marketingtools.apple.com/api/v2/{cc}/music/most-played/50/songs.json`; Last.fm uses `chart.gettoptracks&limit=50` for Global or `geo.gettoptracks&country=`. Cached 24 hours per source and country as `cache_charts`.

Not personalized. No other chart sources exist. `src/charts-utils.js` is a copy of the parsing helpers used only by `tests/charts/charts.test.js`; app.js has its own.

## Spinoff

Code: `startSpinoff` (playback hook), the pool and availability rules in `src/renderer/lib/spinoff-pool.js`, availability check `checkSpinoffAvailability` (app.js).

The playbar Spinoff button seeds from the playing track with Last.fm `track.getsimilar&limit=20`, shuffled. The availability check calls `track.getsimilar&limit=1` on every track change. The pool lives in `spinoffTracksRef`; the next five tracks are resolved ahead. When the pool runs out, spinoff exits and playback returns to the queue. Seed spinoff has no refill. No ListenBrainz or Achordion source is used.

**Few similar tracks (#1281).** Last.fm has no similar-track data for some of the most played songs ("Shape of You" answers an empty list). When `track.getsimilar` returns fewer than 5 tracks, the pool is topped up from the seed artist's similar artists: `artist.getsimilar` (top 8), then `artist.gettoptracks&limit=3` for each, dealt round-robin with the artist order shuffled every round so no two tracks in a row share an artist. Last.fm's own similar tracks come first, and the seed track and duplicates are left out. Only an empty answer or Last.fm's error 6 ("not found") falls back; a failed request stops there, so an outage costs one request, not ten. The availability check asks `artist.getsimilar&limit=1` only when `track.getsimilar&limit=1` is empty, so the button is disabled only when both are.

## Collection Radio

Code: `handleStartCollectionStation`, context name "Collection Station".

Shuffles the local library plus collection tracks, deduplicated. Buttons on Home and the Collection page, a menu entry, `parachord://collection-radio`, and the chat tool `collection_radio`. There is no recommendation step; it only plays what the user already has.

## Protocol radio (`parachord://play/radio`)

Code: the `switch (command)` protocol handler, `activateSpinoffFromPool`, `refillSpinoffPool`, parser `parseProtocolTracklist`. Public docs in [protocol-schema.md](../protocol-schema.md).

- **Mode B** (`?artist=`, optionally `&title=`): calls the in-app spinoff starter. With no title, `resolveSpinoffSeed` picks the artist's top Last.fm track as the seed before the queue is cleared; if none is found the queue is kept and an error toast is shown (parachord#1005).
- **Mode C** (`?tracks=` inline and/or `?url=` / `?refill=`): an externally curated pool. Supports `shuffle=1` and `name=` or `title=`. Skips up to 20 unplayable tracks, resolves two tracks ahead, refills when fewer than three remain (at most once per 5 seconds, stopping after three empty refills), deduplicates by MBID, then ISRC, then artist|title, and applies the public-URL guard and a 100 KB body cap.
- **ListenBrainz lb-radio** works only through Mode C with a URL such as `https://api.listenbrainz.org/1/explore/lb-radio?prompt=...`. `buildProtocolFetchHeaders` attaches the user's ListenBrainz token from the scrobbler config for `api.listenbrainz.org`; without one the request fails with 401. There is no in-app lb-radio prompt box.

## Concerts

Code: `gatherConcertsArtists`, `loadConcerts`, `loadArtistConcerts`, providers from `getConcertServices`.

Seed artists, interleaved and capped at 40 (not shuffled): collection artists, collection tracks and albums, then history (Last.fm `period=6month&limit=40`, ListenBrainz `range=half_yearly&count=40`).

Providers are plugins with the `concerts` capability and a `searchArtistEvents` function whose credential is set:

| Plugin | Credential | Endpoint |
|---|---|---|
| Bandsintown | `appId` | `rest.bandsintown.com/artists/{artist}/events?date=upcoming` |
| Songkick | `apiKey` | artist search, then `artists/{id}/calendar.json` |
| SeatGeek | `clientId` | `/2/performers?q=`, then `/2/events?performers.slug=` |
| Ticketmaster | `apiKey` | Discovery v2 `attractions.json`, then `events.json` |

Each provider has its own limiter (2 concurrent, 400 ms apart, cooldown after 429s; `src/renderer/lib/concert-limiters.js`), so providers run side by side; they used to share one, which queued SeatGeek behind Ticketmaster. Events are deduplicated by date, artist and venue prefix, or by location within about 2 km, with ticket links combined. Past events are dropped. Location filtering uses Nominatim for search and browser geolocation with IP fallbacks, default radius 50 miles. Loads in the background about three minutes after startup. Cache 24 hours as `cache_concerts`; per-artist results cached 24 hours in memory. Not configured: a "No Concert Services Configured" card. The artist page "On Tour" tab only appears when that artist has events.

An AI concert path (`getAiConcertServices`) needs a plugin with both `concerts` and `chat`; no bundled plugin declares both, so it never runs.

## Friends

Code: `refreshPinnedFriends`, `fetchFriendWeeklyStats`, the friend page loaders that follow them, `syncFriendsFromServices`.

Pinned and saved friends are polled every two minutes (15 seconds during listen-along) with Last.fm `user.getrecenttracks&limit=1` or ListenBrainz `/1/user/{u}/listens?count=1`. A friend is "on air" when their last track is under ten minutes old. Weekly stats (5 top artists and tracks per friend) refresh every 30 minutes and are used only as chat context. The friend page shows Recent, Top Tracks, Top Artists and Top Albums for a chosen period. There is no "friends' top tracks" recommendation surface and no similar-users lookup. Friend graph sync is documented in [docs/architecture/friends.md](../architecture/friends.md).

## Meta-service plugin capabilities

From the manifests in `plugins/*.axe`. The app reads `generate`, `chat`, `concerts`, `playbackTelemetry` and `recommendations`; `metadata` and `listeningHistory` are declared but not consulted.

| Plugin | Capabilities | Auth |
|---|---|---|
| lastfm | recommendations, similarUsers, metadata | username, optional API key and secret |
| listenbrainz | recommendations, similarUsers, metadata, listeningHistory | username, optional user token |
| librefm | scrobbling | OAuth |
| achordion | playbackTelemetry | none |
| discogs | metadata, biography, artistImages | optional token |
| wikipedia | metadata, biography, artistImages | none |
| chatgpt | generate, chat | API key |
| gemini | generate, chat | API key |
| claude | chat | API key |
| customllm | generate, chat | none required (optional API key); base URL, API dialect, model, max tokens, reasoning effort |
| ollama | chat; declares `mobile: false` (desktop only) | none; local endpoint |
| bandsintown | concerts | appId |
| songkick | concerts | apiKey |
| seatgeek | concerts | clientId |
| ticketmaster | concerts | apiKey |

## Known gaps

Found while writing this inventory; none are fixed by this document.

1. The one-shot AI Playlist panel cannot be opened from the playbar button with bundled plugins, because chat takes priority whenever a chat-capable plugin is enabled. (parachord#1020)
2. There is no UI to view or clear the recommendation blocklist. (parachord#1022)

Fixed since the first version: artist-only radio links now seed from the artist's top track (parachord#1005), the blocklist is applied and listed in the chat prompt (parachord#1006), in-app chat offers `block_recommendation` (parachord#1007), the MCP playlist tools work (parachord#1008), and with no ListenBrainz recommendation playlist the page says so instead of showing the user's own most-played tracks (parachord#1021).
