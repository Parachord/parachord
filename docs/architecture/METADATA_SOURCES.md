# Metadata Sources

This document describes all external data sources used by Parachord for fetching metadata such as artist images, biographies, related artists, album art, and more.

## Overview

| Metadata Type | Primary Provider | Fallback 1 | Fallback 2 | Fallback 3 |
|---------------|------------------|------------|------------|------------|
| **Artist Images** | Spotify | MusicKit (Apple Music) | Wikipedia | Discogs |
| **Artist Bios** | Last.fm | Wikipedia | Discogs | - |
| **Related Artists** | Last.fm + ListenBrainz (merged) | - | - | - |
| **Album Art** | Cover Art Archive | Embedded metadata | Folder art | - |
| **Charts (Albums)** | Apple Music RSS | - | - | - |
| **Charts (Songs)** | Apple Music RSS | Last.fm | - | - |
| **Critics Picks** | RSS (Uncoveries) | - | - | - |
| **Recommendations** | Last.fm | ListenBrainz | - | - |
| **Scrobbling** | Last.fm | ListenBrainz | Libre.fm | - |
| **Library Sync** | Spotify | - | - | - |

---

## Artist Images

Used for artist page headers, related artists grid, recommendations, and playlist cover mosaics.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Spotify | `api.spotify.com/v1/search?type=artist` | OAuth token | Exact name match only |
| MusicKit | `/v1/catalog/us/search?types=artists` | Developer token | Fallback when Spotify unavailable |
| Wikipedia | `en.wikipedia.org/api/rest_v1/page/summary` | No | Via MusicBrainz→Wikidata chain |
| Discogs | `api.discogs.com/artists/{id}` | Optional PAT | Higher rate limits with token |

**Code Location:** `app.js` → `getArtistImage()` (~line 19180)

**Cache:** `artistImageCache` with 7-day TTL, persisted to electron store.

---

## Artist Biographies

Displayed on artist pages below the header.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=artist.getinfo` | API key | Returns summary + full bio |
| Wikipedia | `en.wikipedia.org/w/api.php?action=query&prop=extracts` | No | Via MusicBrainz MBID lookup |
| Discogs | `api.discogs.com/artists/{id}` | Optional PAT | Profile field |

**Code Location:** `app.js` → `getLastfmBio()` (~line 19328), `getWikipediaBio()` (~line 19458)

**Lookup Chain for Wikipedia:**
1. Search MusicBrainz for artist MBID
2. Fetch artist relations from MusicBrainz to find Wikidata ID
3. Query Wikidata for Wikipedia article title
4. Fetch article extract from Wikipedia API

---

## Related Artists

Displayed on artist pages in the "Similar Artists" section. Results from multiple sources are merged and deduplicated.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=artist.getsimilar` | API key | Match scores 0-1, limit 20 |
| ListenBrainz | `labs.api.listenbrainz.org/similar-artists/json` | No | ML-based, requires MBID |

**Code Location:** `app.js` → `getRelatedArtists()` (~line 20129)

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
| Embedded | Local file metadata | N/A | ID3v2/Vorbis tags |
| Folder | `cover.jpg`, `folder.jpg`, `album.jpg`, etc. | N/A | Same directory as audio files |

**Code Location:** `app.js` → `getAlbumArt()` (~line 18915)

**Lookup Process:**
1. Search MusicBrainz for release matching artist + album
2. Try Cover Art Archive with release-group ID
3. Fall back to release ID if release-group fails
4. Cache result with album-to-release-ID mapping

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

**Code Location:** `src/charts-utils.js`

---

## Critics Picks

Displayed on the "Critical Darlings" page.

| Source | Method | Notes |
|--------|--------|-------|
| Uncoveries RSS | `rssground.com/p/uncoveries` | Aggregated critic-acclaimed albums |

**Code Location:** `app.js` → `loadCriticsPicks()` (~line 16200)

**Data Includes:** Artist, album title, description/synopsis, publication date, Spotify URL

---

## Recommendations

Personalized recommendations displayed on the "Recommendations" page.

| Provider | Endpoint | Auth Required | Notes |
|----------|----------|---------------|-------|
| Last.fm | `last.fm/player/station/user/{username}/recommended` | API key | Artist recommendations |
| ListenBrainz | `api.listenbrainz.org/1/stats/user/{username}` | Bearer token | Based on listening stats |

**Additional Last.fm Endpoints:**
- `artist.gettoptracks` - Top tracks for recommended artists
- `track.getsimilar` - Similar tracks for seeding

**Code Location:** `app.js` → `loadRecommendations()` (~line 16700)

---

## Scrobbling

Track listening history to external services.

| Provider | Endpoint | Auth | Notes |
|----------|----------|------|-------|
| Last.fm | `ws.audioscrobbler.com/2.0/?method=track.scrobble` | Session key | MD5 signature auth |
| Last.fm | `ws.audioscrobbler.com/2.0/?method=track.updateNowPlaying` | Session key | Now playing updates |
| ListenBrainz | `api.listenbrainz.org/1/submit-listens` | Bearer token | Open source alternative |
| Libre.fm | `libre.fm/2.0/` | Session key | Last.fm-compatible API |

**Code Location:** `scrobblers/` directory

**Scrobble Rules:**
- Track must be >30 seconds long
- Must listen to >50% or >4 minutes (whichever is less)
- Now Playing updated at track start

---

## Library Sync

Import library from external services.

| Provider | Endpoints | Auth | Data Imported |
|----------|-----------|------|---------------|
| Spotify | `api.spotify.com/v1/me/tracks` | OAuth | Liked songs |
| Spotify | `api.spotify.com/v1/me/albums` | OAuth | Saved albums |
| Spotify | `api.spotify.com/v1/me/following?type=artist` | OAuth | Followed artists |
| Spotify | `api.spotify.com/v1/me/playlists` | OAuth | User playlists |

**Code Location:** `sync-providers/spotify.js`

**Rate Limiting:** 100ms delay between requests, respects 429 responses with retry-after header.

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
| `wikidata.org/w/api.php?action=wbgetentities&ids={id}&props=sitelinks` | Get Wikipedia article title from Wikidata ID |

---

## Code Reference

| Feature | File | Function |
|---------|------|----------|
| Artist images | `app.js` | `getArtistImage()` |
| Artist bios | `app.js` | `getLastfmBio()`, `getWikipediaBio()`, `getDiscogsBio()` |
| Related artists | `app.js` | `getRelatedArtists()`, `getLastfmSimilarArtists()`, `getListenBrainzSimilarArtists()` |
| Album art | `app.js` | `getAlbumArt()` |
| Charts | `src/charts-utils.js` | `parseAppleMusicAlbumsJSON()`, `parseLastfmChartsJSON()` |
| MusicKit artist images | `musickit-web.js` | `getArtistImage()` |
| Scrobblers | `scrobblers/*.js` | Individual scrobbler classes |
| Library sync | `sync-providers/spotify.js` | `SpotifySyncProvider` |

---

## Caching Strategy

All metadata is cached to reduce API calls and improve performance:

| Cache | TTL | Persisted | Key Format |
|-------|-----|-----------|------------|
| Artist Images | 7 days | Yes | `{normalized_artist_name}` |
| Album Art | 30 days | Yes | `{artist}-{album}` (normalized) |
| Artist Data | 24 hours | Yes | `{normalized_artist_name}` |
| Playlist Covers | 30 days | Yes | `{playlist_id}` |
| Album-to-Release ID | Indefinite | Yes | `{artist}-{album}` |

Caches are loaded from electron store on app startup and saved periodically.
