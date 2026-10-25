# Metadata Sources

This document describes all external data sources used by Parachord for fetching metadata such as artist images, biographies, related artists, album art, and more.

## Overview

| Metadata Type | Primary Provider | Fallback 1 | Fallback 2 | Fallback 3 |
|---------------|------------------|------------|------------|------------|
| **Artist Images** | Spotify (if connected) | MusicKit (Apple Music) | Wikipedia | Discogs |
| **Artist Bios** | Last.fm | Wikipedia | Discogs | - |
| **Related Artists** | Last.fm + ListenBrainz (merged) | - | - | - |
| **Album Art** | Cover Art Archive | Embedded metadata | Folder art | - |
| **Charts (Albums)** | Apple Music RSS | - | - | - |
| **Charts (Songs)** | Apple Music RSS | Last.fm | - | - |
| **Critics Picks** | Achordion RSS (Critical Darlings) | RSSground (transitional) | - | - |
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
4. Fetch article extract from Wikipedia API

Wikidata comes first so a MusicBrainz outage doesn't take the Wikipedia bio with it: the url-rels request waits in the 1 req/s MusicBrainz queue, and during an outage that queue is full of retrying requests (Wild Pink's Biography tab showed its skeleton, then nothing, on 2026-10-25). The Wikipedia artist image uses the same lookup.

**Session cache:** bios go through `artistBioCache` (same file), shared by the playbar tooltip and the artist page, keyed by artist name plus MBID (a bio fetched without an MBID skipped Wikipedia, so it can't answer a request that has one). Found bios are kept for 6 hours; "no bio" is never kept, since it may mean a source was down. Concurrent requests for the same artist share one fetch. Only the artist page's `getArtistBio` sets `loadingBio`; the playbar calls `fetchArtistBio`, because the Biography tab skips its fetch while `loadingBio` is set.

---

## Related Artists

Displayed on artist pages in the "Similar Artists" section. Results from multiple sources are merged and deduplicated.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=artist.getsimilar` | API key | Match scores 0-1, limit 20 |
| ListenBrainz | `labs.api.listenbrainz.org/similar-artists/json` | No | ML-based, requires MBID |

**Code Location:** `src/renderer/app.js` → `getRelatedArtists()`

**Merging Logic:**
- Fetch from both sources in parallel
- Deduplicate by normalized artist name
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

### Apple Music Charts

| Endpoint | Auth | Notes |
|----------|------|-------|
| `rss.applemarketingtools.com/api/v2/{country}/music/most-played/{limit}/albums.json` | No | Top albums |
| `rss.applemarketingtools.com/api/v2/{country}/music/most-played/{limit}/songs.json` | No | Top songs |

**Supported Countries:** US, GB, CA, AU, DE, FR, JP, KR, BR, MX, ES, IT, NL, SE, PL

### Last.fm Charts

| Endpoint | Auth | Notes |
|----------|------|-------|
| `ws.audioscrobbler.com/2.0/?method=chart.gettoptracks` | API key | Global charts |
| `ws.audioscrobbler.com/2.0/?method=geo.gettoptracks&country={country}` | API key | Country-specific |

**Code Location:** `src/renderer/app.js` → `loadCharts()` (Apple Music albums), `loadAppleMusicSongsCharts()`, `loadLastfmCharts()`. `src/charts-utils.js` holds copies of the parsing helpers that only `tests/charts/charts.test.js` uses; the app does not load it.

---

## Critics Picks

Displayed on the "Critical Darlings" page.

| Source | Method | Notes |
|--------|--------|-------|
| Achordion RSS | `achordion.xyz/api/critical-darlings/feed.xml` | Aggregated critic-acclaimed albums (public, no auth) |
| RSSground (transitional) | `rssground.com/p/uncoveries` | Legacy feed, client-side union top-up during the Achordion store's ramp-up; self-deactivates and is removed once the store is populated (achordion#83) |

**Code Location:** `src/renderer/app.js` → `loadCriticsPicks()`

**Data Includes:** Artist, album title, description/synopsis, publication date, Spotify URL

---

## Recommendations

Every recommendation and discovery surface (Recommendations page, Weekly Jams, Shuffleupagus suggestions and chat, Related Artists, Fresh Drops, Critical Darlings, charts, Spinoff, Collection Radio, protocol radio, Concerts, friends) is inventoried in [docs/features/RECOMMENDATIONS.md](../features/RECOMMENDATIONS.md), with the endpoint, seed data and output type for each.

The Recommendations page itself uses:

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `last.fm/player/station/user/{username}/recommended` | None (website JSON, no API key) | Recommended tracks |
| ListenBrainz | `api.listenbrainz.org/1/user/{username}/playlists/recommendations`, then `/1/playlist/{id}` | None | Falls back to `/1/stats/user/{username}/recordings?range=month` when no recommendation playlist exists |

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

**Rate Limiting:** 100ms delay between Spotify requests, respects 429 responses with retry-after header. Apple Music catalog calls go through a dedicated limiter.

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
| Related artists | `src/renderer/app.js` | `getRelatedArtists()`, `getLastfmSimilarArtists()`, `getListenBrainzSimilarArtists()` |
| Album art | `src/renderer/app.js` | `getAlbumArt()` |
| Charts | `src/renderer/app.js` | `loadCharts()`, `loadAppleMusicSongsCharts()`, `loadLastfmCharts()` |
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
