# Metadata Sources

This document describes all external data sources used by Parachord for fetching metadata such as artist images, biographies, related artists, album art, and more.

## Overview

| Metadata Type | Primary Provider | Fallback 1 | Fallback 2 | Fallback 3 |
|---------------|------------------|------------|------------|------------|
| **Artist Images** | Spotify (plug-in on and signed in) | MusicKit (Apple Music, plug-in on) | Wikipedia | Discogs |
| **Artist Bios** | Last.fm | Wikipedia | Discogs | - |
| **Related Artists** | Last.fm + ListenBrainz (merged) | - | - | - |
| **Album Art** | Cover Art Archive | Embedded metadata | Folder art | - |
| **Charts (Albums)** | Plug-ins with `charts`, in the user's order (Apple Music, ListenBrainz) | - | - | - |
| **Charts (Songs)** | Plug-ins with `charts`, in the user's order (Apple Music, Last.fm, ListenBrainz) | - | - | - |
| **Critics Picks** | Achordion RSS (Critical Darlings) | - | - | - |
| **Recommendations** | Last.fm | ListenBrainz | - | - |
| **Scrobbling** | Last.fm | ListenBrainz | Libre.fm | - |
| **Library Sync** | Spotify | Apple Music | ListenBrainz (playlists) | - |

---

## Artist Images

Used for artist page headers, related artists grid, recommendations, and playlist cover mosaics.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Spotify | `api.spotify.com/v1/search?type=artist` | OAuth token | Exact name match only |
| MusicKit | `/v1/catalog/us/search?types=artists` | Developer token | Fallback when Spotify unavailable |
| Wikipedia | `en.wikipedia.org/api/rest_v1/page/summary` | No | Via the Wikidata id (see the Wikipedia bio lookup chain) |
| Discogs | `api.discogs.com/artists/{id}` | Optional PAT | Higher rate limits with token |

Spotify and Apple Music are asked only while their plug-ins are on (`activeResolversRef`), the same rule as the plug-in artist-image steps. A saved Spotify sign-in survives turning the plug-in off, so a token check alone kept sending every uncached artist photo to Spotify after the user switched it off, and tripped its rate-limit pause (2026-11-16).

**Code Location:** `src/renderer/app.js` → `getArtistImage()`

**Cache:** `artistImageCache` with a 90-day TTL (`CACHE_TTL.artistImage`), persisted to electron store.

---

## Artist Biographies

Displayed on artist pages below the header.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=artist.getinfo` | API key | Returns summary + full bio |
| Wikipedia | `en.wikipedia.org/w/api.php?action=query&prop=extracts` | No | Needs the artist MBID |
| Discogs | `api.discogs.com/artists/{id}` | Optional PAT | Profile field |

**Code Location:** `src/renderer/app.js` → `getLastfmBio()`, `getWikipediaBio()`, `getDiscogsBio()`

**Lookup Chain for Wikipedia:**
1. The artist MBID (from the artist page, or the MBID mapper / a MusicBrainz search for the playbar)
2. The Wikidata id: Wikidata's own search for the entity whose MusicBrainz artist ID (P434) is that MBID; only when Wikidata has none, the artist's MusicBrainz url-rels. `lookupWikidataId` (`src/renderer/lib/artist-bio.js`) keeps found ids for the session.
3. Query Wikidata for Wikipedia article title
4. Fetch the whole article as plain text from the Wikipedia API (`prop=extracts&explaintext=1`, no `exintro`), then trim it with `bioFromWikipediaExtract` (`src/renderer/lib/wikipedia-bio.js`):
   - a lead of 150 words or more is the whole bio;
   - otherwise prose paragraphs from the following sections are added in article order until the bio reaches 400 words (whole paragraphs only);
   - sections that aren't a bio (References, External links, See also, Notes, Discography, Band members, Personnel, Tours, Accolades, Timeline, ...) are skipped with their subsections;
   - inside kept sections only prose survives (ends like a sentence, at least 4 words), so member and release lists don't;
   - headings are dropped and paragraphs are separated by a blank line.

   The lead alone was too thin when an article's lead is short (Wild Pink's is one sentence), and the whole article (what Android showed) carried the lists, empty headings, link stubs and raw `== History ==` markup. parachord-mobile mirrors this rule.

Wikidata comes first so a MusicBrainz outage doesn't take the Wikipedia bio with it: the url-rels request waits in the 1 req/s MusicBrainz queue, and during an outage that queue is full of retrying requests (Wild Pink's Biography tab showed its skeleton, then nothing, on 2026-10-25). The Wikipedia artist image uses the same lookup.

**Session cache:** bios go through `artistBioCache` (same file), shared by the playbar tooltip and the artist page, keyed by artist name plus MBID (a bio fetched without an MBID skipped Wikipedia, so it can't answer a request that has one). Found bios are kept for 6 hours; "no bio" is never kept, since it may mean a source was down. Concurrent requests for the same artist share one fetch. Only the artist page's `getArtistBio` sets `loadingBio`; the playbar calls `fetchArtistBio`, because the Biography tab skips its fetch while `loadingBio` is set.

---

## Related Artists

Displayed on artist pages in the "Related Artists" tab. Every plug-in with the `similarArtists` capability is asked (#1539), and the answers are merged and deduplicated.

| Plug-in | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=artist.getsimilar` | API key | Match scores 0-1, limit 20 |
| ListenBrainz | `labs.api.listenbrainz.org/similar-artists/json` | No | ML-based, requires MBID; raw-count scores, scaled against the top one |

**Code Location:** `plugins-src/lastfm/` and `plugins-src/listenbrainz/` (`getSimilarArtists`), `src/renderer/lib/similar-music.js`, `src/renderer/app.js` → `getRelatedArtists()`

**Merging Logic:**
- Ask every similar-artists plug-in in parallel; one that fails is left out
- Deduplicate by normalized artist name, recording every plug-in that named it (`sources`)
- Keep higher match score when duplicate found
- Sort by match score descending

---

## Album Art

Used throughout the app for album displays, track lists, and playlist mosaics.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Cover Art Archive | `coverartarchive.org/release-group/{id}/front` | No | Via MusicBrainz release lookup |
| Cover Art Archive | `coverartarchive.org/release/{id}/front` | No | Fallback if release-group fails |
| Enabled resolvers | Each resolver's `search()` results (`albumArt` field) | Per resolver | Spotify, Apple Music, Bandcamp, SoundCloud, YouTube |
| iTunes Search | `itunes.apple.com/search?entity=album` (or `song`) | No | Through `window.iTunesRateLimiter`; hit must name the artist and album |
| Deezer | `api.deezer.com/search/album` (or `/search`) | No | Through the main-process proxy (no CORS for file://); hit must name the artist and album |
| Embedded | Local file metadata | N/A | ID3v2/Vorbis tags |
| Folder | `cover.jpg`, `folder.jpg`, `album.jpg`, etc. | N/A | Same directory as audio files |

**Code Location:** `src/renderer/app.js` → `getAlbumArt()` (the one pipeline; search for "THE album-art pipeline"), `getAlbumArtFromResolvers()`, `getTrackArt()`; `album-art-catalog.js` (iTunes → Deezer chain, tests in `tests/resolver/album-art-catalog.test.js`)

**Lookup Process (one pipeline for every surface):**
1. Caches: `albumArtCache` by MusicBrainz id, plus `resolver:` / `catalog:` keys by artist+album
2. Search MusicBrainz for the release, then Cover Art Archive by release-group id, then release id
3. Enabled resolvers' search results, walked in priority order until one returns a result with art
4. iTunes Search, then Deezer, validated against the requested artist and album
5. A miss is remembered for the session only when every source answered; thrown searches are retried next time

Callers that have a track title but no album (chat cards from prose) use `getTrackArt()`, the catalog chain's song search. Don't add surface-specific shortcuts: the chat card had a resolvers-only "fast" path and that is why AI-recommended tracks showed no art.

**Cache:** `albumArtCache` and `albumToReleaseIdCache`, persisted to electron store.

---

## Charts

Displayed on the "Pop of the Tops" page.

Every chart comes from a plug-in with the `charts` capability (#1539 step 3); the page lists them in the user's order and the user picks one per tab. See docs/architecture/plugins.md "Charts".

| Plug-in | Endpoint | Auth | Charts |
|---------|----------|------|--------|
| Apple Music | `rss.marketingtools.apple.com/api/v2/{country}/music/most-played/{limit}/{albums,songs}.json` | No | Albums and tracks, by country (US, GB, CA, AU, DE, FR, JP, KR, BR, MX, ES, IT, NL, SE, PL) |
| Last.fm | `ws.audioscrobbler.com/2.0/?method=chart.gettoptracks`, `geo.gettoptracks&country={name}` | API key | Tracks, Global or by country |
| ListenBrainz | `api.listenbrainz.org/1/stats/sitewide/{recordings,release-groups}?range=week` | No (the user's token goes along when there is one) | Tracks and albums, Global, this week |

**Code Location:** `src/renderer/app.js` → `loadCharts()` (Albums tab), `loadSongsCharts()` (Tracks tab), `loadChartFor()`; `src/renderer/lib/charts.js`; the plug-ins' `getCharts`.

---

## Critics Picks

Displayed on the "Critical Darlings" page.

| Source | Method | Notes |
|--------|--------|-------|
| Achordion RSS | `achordion.xyz/api/critical-darlings/feed.xml` | Aggregated critic-acclaimed albums (public, no auth) |

**Code Location:** `src/renderer/app.js` → `loadCriticsPicks()`

**Data Includes:** Artist, album title, description/synopsis, publication date, Spotify URL

---

## Recommendations

Every recommendation and discovery surface (Recommendations page, Weekly Jams and Exploration on it, Shuffleupagus suggestions and chat, Related Artists, Fresh Drops, Critical Darlings, charts, Spinoff, Collection Radio, protocol radio, Concerts, friends) is inventoried in [docs/features/RECOMMENDATIONS.md](../features/RECOMMENDATIONS.md), with the endpoint, seed data and output type for each.

The Recommendations page itself uses:

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `last.fm/player/station/user/{username}/recommended` | None (website JSON, no API key) | Recommended tracks |
| Last.fm (similar users) | `user.getfriends`, `user.gettopartists` (API key, the user's or the app's) | API key | Friends row: friends of friends scored by shared top artists, about 60 requests, cached 7 days |
| ListenBrainz (similar users) | `api.listenbrainz.org/1/user/{username}/similar-users` | None | Friends row |
| ListenBrainz | `api.listenbrainz.org/1/user/{username}/playlists/recommendations`, then `/1/playlist/{id}` for one playlist picked by type (see docs/features/RECOMMENDATIONS.md) | None | No fallback: with no recommendation playlist the page says so (parachord#1021) |

**Code Location:** `src/renderer/app.js` → `loadRecommendations()`

---

## Scrobbling

Track listening history to external services.

| Provider | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=track.scrobble` | Session key | MD5 signature auth |
| Last.fm | `ws.audioscrobbler.com/2.0/?method=track.updateNowPlaying` | Session key | Now playing updates |
| ListenBrainz | `api.listenbrainz.org/1/submit-listens` | Bearer token | Open source alternative |
| Libre.fm | `libre.fm/2.0/` | Session key | Last.fm-compatible API |

**Code Location:** `scrobbler-loader.js` (`ScrobbleManager` plus one class per service)

**Scrobble Rules:**
- Track must be >30 seconds long
- Must listen to >50% or >4 minutes (whichever is less)
- Now Playing updated at track start

---

## Library Sync

Import library and playlists from external services, and keep playlists mirrored to them. Every import path (URL, drag and drop, XSPF files, deep links, the browser extension, hosted playlists, AI chat, MCP) and the sync behaviour per provider is inventoried in [docs/features/PLAYLIST_IMPORT_AND_SYNC.md](../features/PLAYLIST_IMPORT_AND_SYNC.md). Sync internals (data model, duplicate prevention, push semantics) are in [sync.md](sync.md).

| Provider | Module | Auth | Data |
|----------|--------|------|------|
| Spotify | `sync-providers/spotify.js` | OAuth | Liked songs, saved albums, followed artists, playlists |
| Apple Music | `sync-providers/applemusic.js` | MusicKit user token | Library songs, albums, artists, playlists (append-only writes) |
| ListenBrainz | `sync-providers/listenbrainz.js` | User token | Playlists only (JSPF, recording MBID per track) |

**Rate Limiting:** 100ms delay between Spotify requests. A 429 is honoured: sync waits out a `Retry-After` of up to 60 s, and a longer one opens the sync breaker (`sync-engine/spotify-breaker.js`) until it has passed instead of sleeping inside the request; the Spotify plugin sends no search until it has passed. Every other Spotify Web API call waits too: each process keeps one pause (`sync-providers/spotify-pause.js`) that any 429 starts or extends. The renderer's fetch gate (`installSpotifyPause` in `src/renderer/app.js`) answers every `api.spotify.com` request with the same 429, without sending it, while the pause runs: plugin searches, playback controls, volume, seek, the discography fallback. A pause over a minute shows one toast. In the main process the playback poller, its recovery loop and the pause on quit skip their request, and the sync provider's guard fails fast. The sync sign-in check (`checkAuthStatus`) answers 429 without a request too, and a 429 from it starts the pause.

**The pause outlives a restart and is shared by both processes (#909).** Main saves `sharedPause` to the store as `spotify_pause_until` on every lengthening and restores it when `main.js` loads, before anything can call Spotify. The renderer adopts main's pause at startup (`spotify-cooldown-get`) and on every change (`spotify-cooldown-changed`), and hands its own 429s to main (`spotify-pause-note`). `extendTo` only ever lengthens a pause and caps a saved one at 24 hours, so the two sides settle on the later end and an echo between them stops at once. A restarted app's first Spotify call is therefore answered locally rather than sent into a running limit, so it gets no new 429 and repeats no toast. The cooldown shown to the user is the later of the pause and the sync breaker's (`spotify_breaker_state`), worked out locally, so reading it asks Spotify nothing. Collection's Sync menu shows it on Spotify's row as "Paused until 4:05 PM" (`syncPausedUntil`; the time comes from `lib/until-label.js`, which the slow-down toast uses too), and the label goes away when the cooldown ends.

Apple Music catalog calls go through a dedicated limiter.

---

## Supporting Services

### MusicBrainz

Central metadata database used for disambiguation and linking to other services.

| Endpoint | Purpose |
|----------|---------|
| `/ws/2/artist?query={name}` | Artist search, get MBID |
| `/ws/2/artist/{id}?inc=url-rels` | Artist relations (Wikipedia, Wikidata links) |
| `/ws/2/release-group?artist={id}` | Artist discography |
| `/ws/2/release?query={query}` | Release search for album art |

**Rate Limit:** ~1 request/second
**User-Agent:** Required, set to `Parachord/1.0`

### Wikidata

Bridge between MusicBrainz and Wikipedia.

| Endpoint | Purpose |
|----------|---------|
| `wikidata.org/w/api.php?action=query&list=search&srsearch=haswbstatement:P434={mbid}` | Find the Wikidata id for a MusicBrainz artist id |
| `wikidata.org/w/api.php?action=wbgetentities&ids={id}&props=sitelinks` | Get Wikipedia article title from Wikidata ID |

---

## Code Reference

| Feature | File | Function |
|---------|------|----------|
| Artist images | `src/renderer/app.js` | `getArtistImage()` |
| Artist bios | `src/renderer/app.js` | `getLastfmBio()`, `getWikipediaBio()`, `getDiscogsBio()` |
| Related artists | `src/renderer/app.js`, `src/renderer/lib/similar-music.js` | `getRelatedArtists()`, `findSimilarArtists()`; the plug-ins' `getSimilarArtists` |
| Artist top tracks | `src/renderer/app.js`, `src/renderer/lib/similar-music.js` | `findArtistTopTracks()`, `getArtistTopTracks()`; the plug-ins' `getArtistTopTracks` (Last.fm `artist.gettoptracks`; ListenBrainz `/1/popularity/top-recordings-for-artist/{mbid}`, signed in only) |
| Artist discography fallback | `src/renderer/app.js`, `src/renderer/lib/similar-music.js` | `fetchArtistFromPlugins()` (`askInTurn`); the plug-ins' `getArtistReleases` (Spotify, Apple Music, Last.fm `artist.gettopalbums`, Discogs) |
| Album art | `src/renderer/app.js` | `getAlbumArt()` |
| Charts | `src/renderer/app.js`, `src/renderer/lib/charts.js` | `loadCharts()`, `loadSongsCharts()`, `loadChartFor()`; the plug-ins' `getCharts` |
| MusicKit artist images | `musickit-web.js` | `getArtistImage()` |
| Scrobblers | `scrobbler-loader.js` | `ScrobbleManager`, `LastFmScrobbler`, `ListenBrainzScrobbler`, `LibreFmScrobbler` |
| Library sync | `sync-providers/spotify.js`, `sync-providers/applemusic.js`, `sync-providers/listenbrainz.js` | One provider per service |

---

## Caching Strategy

All metadata is cached to reduce API calls and improve performance:

TTLs come from `CACHE_TTL` in `src/renderer/app.js`:

| Cache | TTL (`CACHE_TTL` key) |
|-------|-----|
| Album art | 90 days (`albumArt`) |
| Artist images | 90 days (`artistImage`) |
| Artist data | 30 days (`artistData`) |
| Artist extended info | 30 days (`artistExtendedInfo`) |
| Playlist covers | 30 days (`playlistCover`) |
| Track sources | 7 days (`trackSources`) |
| Sources persisted to collection and playlists | 30 days (`persistedSources`) |
| Release details (tracklists) | 30 days (`releaseDetails`) |
| MBID mapper | 90 days (`mbidMapper`) |
| Recommendations | 1 hour (`recommendations`) |
| Charts | 24 hours (`charts`) |
| New releases | 6 hours (`newReleases`) |
| Concerts | 24 hours (`concerts`) |

`albumToReleaseIdCache` (artist + album to MusicBrainz release id) has no TTL.

Caches are loaded from electron store on app startup and saved periodically.
