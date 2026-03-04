# Feature: YouTube Music Library Import via Google Data Portability API

## Summary

Add a YouTube Music sync provider that imports a user's YouTube Music library (liked songs, uploads, playlists) into Parachord using Google's Data Portability API. Unlike the real-time REST APIs used for Spotify and Apple Music sync, this provider uses an async archive-based workflow — bulk CSV export via signed download URLs.

Imported tracks arrive with YouTube Video IDs pre-populated in `sources.youtube`, enabling instant playback resolution through the existing YouTube resolver plugin with no additional search/matching step.

## Motivation

- YouTube Music is the **third most popular streaming service** and Parachord currently has no library sync for it
- The YouTube Data API v3 is poorly suited for library access: no structured music metadata (only video title + channel), 10K unit/day quota, no access to uploads
- Google's Data Portability API provides **structured CSV data** with separate Song Title, Album Title, Artist Name, and Video ID columns — far superior for cross-resolver matching
- Video IDs enable **instant resolution** at confidence 1.0 through the existing YouTube resolver, with no fuzzy search needed

## Technical Approach

### Authentication

- Google OAuth 2.0 with PKCE (same pattern as Spotify BYOK — user provides their own Client ID)
- Required scopes:
  - `dataportability.youtube.music` — Library songs + uploads
  - `dataportability.youtube.private_playlists` — Private playlists
  - `dataportability.youtube.public_playlists` — Public playlists
- All scopes are **Sensitive** (not Restricted): 3–5 day Google verification review required before public use; can use unverified with test users during development

### Archive Workflow

1. User authorizes via OAuth → token received
2. `POST /v1/portabilityArchive:initiate` with YouTube Music resources
3. Poll `GET /v1/archiveJobs/{id}` (5s → 30s exponential backoff)
4. Download ZIP from signed GCS URL (valid 6 hours) when complete
5. Parse CSV files from ZIP

### Data Available

| CSV File | Fields | Notes |
|----------|--------|-------|
| `Music Library Songs.csv` | Video Id, Song Title, Album Title, Artist Name | Liked/saved songs |
| `Music Uploads.csv` | Song Title, Album Title, Artist Name, Duration | User-uploaded tracks (no Video ID) |
| `Playlists/{name}.csv` | Video Id, Song Title, Album Title, Artist Name | Per-playlist export |

### Implementation Plan

New files:
- `lib/csv-parser.js` — RFC 4180 CSV parser (handles quoted fields, embedded commas/newlines)
- `lib/archive-poller.js` — Archive job polling with exponential backoff + timeout
- `sync-providers/youtubemusic.js` — SyncProvider implementation (fetch, transform, diff)

Modified files:
- `sync-engine/index.js` — Register YouTube Music provider
- `app.js` — Add YouTube Music to sync UI (settings, progress modal)

### Track Transformation

```js
{
  id: "rick-astley-never-gonna-give-you-up-whenever-you-need-somebody",
  title: "Never Gonna Give You Up",
  artist: "Rick Astley",
  album: "Whenever You Need Somebody",
  sources: {
    youtube: {
      id: "dQw4w9WgXcQ",
      url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      confidence: 1.0
    }
  },
  syncedFrom: ["youtubemusic"]
}
```

## Known Limitations

- **Read-only** — No write-back to YouTube Music (Data Portability API is export-only)
- **Not real-time** — Archives take 1 minute to several hours to generate; minimum 24h between re-exports
- **No `addedAt` timestamps** — CSV does not include when songs were added to library
- **No duration for library songs** — Only uploads include duration
- **No album-level library** — Only individual songs and playlists are exported
- **BYOK required** — Each user (or distributor) must provide their own Google Cloud Client ID due to scope verification requirements

## Out of Scope (for initial implementation)

- Write-back to YouTube Music via YouTube Data API v3
- Real-time sync / webhook-based updates
- YouTube Music listening history import (separate feature — see #listening-history-import)
- Automated re-export scheduling

## Related

- Design doc: `docs/plans/2026-03-04-youtube-music-sync-design.md`
- YouTube resolver plugin: `plugins/youtube.axe`
- Listening history import issue: `docs/plans/issues/listening-history-import.md`
- Existing sync providers: `sync-providers/spotify.js`, `sync-providers/applemusic.js`

## Labels

`enhancement`, `sync`, `youtube-music`, `data-import`
