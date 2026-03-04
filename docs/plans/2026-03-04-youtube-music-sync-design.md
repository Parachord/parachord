# YouTube Music Library Sync via Google Data Portability API

## Overview

Add a YouTube Music sync provider that imports a user's YouTube Music library (liked songs, playlists) into Parachord using Google's Data Portability API. Unlike Spotify/Apple Music which use real-time REST APIs, this provider uses Google's bulk data export system — an async archive-based workflow.

This is **read-only import** (no write-back to YouTube Music). Tracks are imported with their YouTube Video IDs pre-populated in `sources.youtube`, enabling instant playback resolution through the existing YouTube resolver plugin.

---

## Why Data Portability API (Not YouTube Data API v3)

| Factor | YouTube Data API v3 | Data Portability API |
|--------|---------------------|----------------------|
| Library access | `GET /playlistItems` on "Liked Music" playlist only | Full music library export (songs, uploads, playlists) |
| Music metadata | Video title + channel (no structured artist/album) | Structured: Song Title, Album Title, Artist Name |
| Quota | 10,000 units/day shared across all operations | No quota — one archive per auth |
| Auth complexity | Standard OAuth | Standard OAuth + archive flow |
| Playlist access | Requires guessing system playlist IDs | All playlists exported in structured format |
| Uploads | Not accessible | Included with duration metadata |
| Write support | Yes (add/remove from playlists) | No (read-only export) |

**Decision:** Use Data Portability API for library import. The structured music metadata (separate artist/album/title fields) is vastly superior for cross-resolver matching vs. parsing video titles. The YouTube Data API v3 can be used later for write-back if needed.

---

## Google Data Portability API — Technical Details

### Authentication & Scopes

**OAuth 2.0 with PKCE** (same flow pattern as Spotify BYOK):

```
Authorization URL: https://accounts.google.com/o/oauth2/v2/auth
Token URL:         https://oauth2.googleapis.com/token
```

**Required scopes:**
- `https://www.googleapis.com/auth/dataportability.youtube.music` — Library songs + uploads
- `https://www.googleapis.com/auth/dataportability.youtube.private_playlists` — Private playlists
- `https://www.googleapis.com/auth/dataportability.youtube.public_playlists` — Public playlists

All three are **Sensitive** scopes (not Restricted), requiring Google verification review (3–5 business days). During development, can use unverified with test users.

### Archive Lifecycle

```
1. User authorizes → OAuth token received
2. POST /v1/portabilityArchive:initiate
   Body: { resources: ["youtube.music", "youtube.private_playlists", "youtube.public_playlists"] }
   Response: { archiveJobId: "job-abc123" }

3. Poll: GET /v1/archiveJobs/job-abc123
   Response: { state: "IN_PROGRESS" | "COMPLETE" | "FAILED", urls: [...] }
   Poll interval: start at 5s, back off to 30s max

4. When COMPLETE: download ZIP from signed GCS URL (valid 6 hours)

5. Parse CSV files from ZIP
```

### Data Schema

**Music Library Songs CSV** (`YouTube Music/Music Library Songs.csv`):
```csv
Video Id,Song Title,Album Title,Artist Name
dQw4w9WgXcQ,Never Gonna Give You Up,Whenever You Need Somebody,Rick Astley
```

**Music Uploads CSV** (`YouTube Music/Music Uploads.csv`):
```csv
Song Title,Album Title,Artist Name,Duration
My Custom Song,My Album,My Band,243.5s
```

**Playlists CSV** (`YouTube Music/Playlists/Playlist Name.csv`):
```csv
Video Id,Song Title,Album Title,Artist Name
```

### Constraints

- **One-time vs time-based access:** User can grant single export OR recurring access (every 24h for 30/180 days)
- **Must initiate within 24 hours** of authorization
- **Archive takes 1 minute to several hours** depending on library size
- **Download URLs expire after 6 hours**
- **14-day data retention** after export completes

---

## Architecture

### How It Fits the SyncProvider Interface

The async archive flow is encapsulated entirely within `fetchTracks()` / `fetchPlaylists()`. From the sync engine's perspective, these are just slow async calls — the internal polling is transparent.

```javascript
// The sync engine doesn't care HOW the data is fetched
const tracks = await provider.fetchTracks(token, onProgress, refreshToken);
// Could take 5 seconds (Spotify) or 5 minutes (YouTube Music) — same interface
```

The `onProgress` callback reports multi-phase progress:

```javascript
onProgress({ phase: 'initiating', message: 'Starting YouTube Music export...' });
onProgress({ phase: 'archiving', message: 'Google is preparing your data...', elapsed: 45 });
onProgress({ phase: 'downloading', message: 'Downloading archive...', percent: 65 });
onProgress({ phase: 'parsing', message: 'Processing 847 tracks...', current: 400, total: 847 });
```

### File Structure

```
sync-providers/
  spotify.js          (existing)
  applemusic.js       (existing)
  youtubemusic.js     (NEW — sync provider)

lib/
  csv-parser.js       (NEW — lightweight CSV parser, no dependencies)
  archive-poller.js   (NEW — archive job polling with backoff)

tests/sync/
  sync-engine.test.js         (existing — add YouTube Music registration tests)
  youtubemusic-provider.test.js  (NEW — provider-specific tests)
  csv-parser.test.js          (NEW — CSV parsing edge cases)
```

---

## Implementation Plan

### Step 1: CSV Parser (`lib/csv-parser.js`)

Lightweight RFC 4180 CSV parser. No npm dependency needed — the YouTube Music CSVs are simple (4 columns, minimal quoting).

```javascript
/**
 * Parse CSV text into array of objects using header row as keys.
 * Handles quoted fields with embedded commas and newlines.
 * @param {string} csvText - Raw CSV content
 * @returns {Object[]} - Array of { [header]: value } objects
 */
function parseCSV(csvText) { ... }
```

Key behaviors:
- First row = headers, subsequent rows = data
- Handle quoted fields: `"Song With ""Quotes"" And, Commas"`
- Handle UTF-8 BOM (Google exports may include it)
- Trim whitespace from field values
- Skip empty rows

### Step 2: Archive Poller (`lib/archive-poller.js`)

Manages the async archive lifecycle with adaptive polling.

```javascript
/**
 * Initiate a Data Portability archive and poll until complete.
 * @param {string} token - OAuth access token
 * @param {string[]} resources - Resource types to export
 * @param {Function} onProgress - Progress callback
 * @param {Object} options - { maxWaitMs, pollIntervalMs, refreshToken }
 * @returns {Promise<string[]>} - Array of download URLs
 */
async function initiateAndPollArchive(token, resources, onProgress, options) { ... }
```

Polling strategy:
- Initial interval: 5 seconds
- Backoff: multiply by 1.5 each iteration, cap at 30 seconds
- Timeout: 2 hours default (configurable)
- Report elapsed time via `onProgress` for UI display

Error handling:
- `FAILED` state → throw with Google's error message
- Timeout → throw with suggestion to retry
- Network errors during polling → retry up to 3 times before failing
- 401 during polling → attempt token refresh, retry

### Step 3: YouTube Music Sync Provider (`sync-providers/youtubemusic.js`)

```javascript
const YouTubeMusicSyncProvider = {
  id: 'youtubemusic',
  displayName: 'YouTube Music',

  capabilities: {
    tracks: true,
    albums: false,    // CSV doesn't provide album-level library data
    artists: false,   // CSV doesn't provide followed artists
    playlists: true,
    playlistFolders: false
  },

  /**
   * Fetch all library tracks via Data Portability archive.
   * Flow: initiate archive → poll → download ZIP → parse CSV → transform
   */
  async fetchTracks(token, onProgress, refreshToken, options) {
    // 1. Initiate archive (or use cached archive if within same session)
    // 2. Poll until complete
    // 3. Download and unzip
    // 4. Parse "Music Library Songs.csv" + "Music Uploads.csv"
    // 5. Transform to SyncTrack[]
  },

  async fetchPlaylists(token, onProgress, refreshToken) {
    // Uses same archive download (cached from fetchTracks if already fetched)
    // Parses playlist CSVs from the ZIP
  },

  async fetchPlaylistTracks(playlistId, token, onProgress, refreshToken) {
    // playlistId maps to playlist CSV filename
    // Returns tracks from cached archive data
  },

  getPlaylistSnapshot(playlistId) {
    // No real-time snapshots — return hash of track list
    // Used for change detection between syncs
  },

  getRateLimitDelay() {
    return 0; // No rate limit needed — single archive download
  },

  async checkAuth(token) {
    // Verify token with Google's tokeninfo endpoint
  }
};
```

#### Track Transformation

```javascript
const transformTrack = (row, isUpload = false) => {
  const artist = row['Artist Name'] || 'Unknown Artist';
  const title = row['Song Title'] || 'Unknown Title';
  const album = row['Album Title'] || '';
  const videoId = row['Video Id'] || null;

  // Parse duration from uploads: "243.5s" → 244
  let duration = 0;
  if (isUpload && row['Duration']) {
    duration = Math.round(parseFloat(row['Duration'].replace('s', '')));
  }

  return {
    id: generateTrackId(artist, title, album),
    externalId: videoId,
    title,
    artist,
    album,
    duration,
    albumArt: videoId ? `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg` : null,
    addedAt: Date.now(), // CSV doesn't include add date
    // Pre-populate YouTube resolver source for instant playback
    sources: videoId ? {
      youtube: {
        id: `youtube-${videoId}`,
        title,
        artist,
        album,
        duration,
        youtubeId: videoId,
        youtubeUrl: `https://www.youtube.com/watch?v=${videoId}`,
        thumbnail: `https://i.ytimg.com/vi/${videoId}/default.jpg`,
        albumArt: `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`,
        confidence: 1.0
      }
    } : {}
  };
};
```

**Key insight:** Because the CSV includes Video IDs, every track is pre-resolved for the YouTube plugin at confidence 1.0. No search/resolution step needed for YouTube playback. Other resolvers (Spotify, SoundCloud) will still need to resolve via search.

#### Archive Caching

The archive contains ALL data (tracks + playlists). To avoid downloading twice when the sync engine calls `fetchTracks()` then `fetchPlaylists()`, cache the parsed archive data in memory for the duration of a sync session:

```javascript
let cachedArchiveData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

async function getArchiveData(token, onProgress, refreshToken) {
  if (cachedArchiveData && (Date.now() - cacheTimestamp) < CACHE_TTL) {
    return cachedArchiveData;
  }
  // ... initiate, poll, download, parse
  cachedArchiveData = parsedData;
  cacheTimestamp = Date.now();
  return parsedData;
}
```

### Step 4: Google OAuth Setup

**BYOK model** (same as Spotify): Each user creates their own Google Cloud project.

Add to `API_CREDENTIALS_SETUP.md`:

```markdown
### YouTube Music (BYOK — Bring Your Own Key)

**Status:** Each user must provide their own Google Client ID

1. Go to: https://console.cloud.google.com/
2. Create a new project (or use existing)
3. Enable **Data Portability API**
4. Go to APIs & Services → Credentials → Create OAuth Client ID
   - Application type: Desktop app (or Web application)
   - Redirect URI: `http://127.0.0.1:8888/callback/google`
5. Copy Client ID (PKCE flow — no client secret needed)
6. Go to OAuth consent screen → Add scopes:
   - `dataportability.youtube.music`
   - `dataportability.youtube.private_playlists`
   - `dataportability.youtube.public_playlists`

**Note:** Until your app is verified by Google, only test users you
add explicitly in the consent screen can authorize. Google verification
for Sensitive scopes takes 3–5 business days.
```

Environment variables:
```bash
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_REDIRECT_URI=http://127.0.0.1:8888/callback/google
```

OAuth flow uses PKCE (same as Spotify) — no client secret stored.

### Step 5: UI — Progress & Background Dismissal

The archive process can take minutes to hours. UX flow:

```
1. User clicks "Connect YouTube Music" in Settings
2. OAuth flow opens in browser → user authorizes
3. Modal appears: "Importing YouTube Music Library"
   ┌──────────────────────────────────────────────┐
   │  Importing YouTube Music Library              │
   │                                                │
   │  ⏳ Google is preparing your data export...    │
   │     This may take a few minutes.              │
   │                                                │
   │  Elapsed: 0:45                                │
   │                                                │
   │  [Continue in Background]       [Cancel]       │
   └──────────────────────────────────────────────┘

4a. User waits → modal updates through phases:
    "Preparing export..." → "Downloading..." → "Processing 847 tracks..."
    → "Done! Imported 847 tracks and 12 playlists."

4b. User clicks "Continue in Background":
    - Modal closes, small indicator in status bar: "YouTube Music import in progress"
    - When complete: notification toast + badge update
    - User can click status indicator to re-open progress modal
```

Implementation:
- Archive polling runs in main process (survives renderer navigation)
- Progress reported via IPC to renderer
- State persisted in electron-store so import survives app restart:
  ```javascript
  {
    youtubeMusic: {
      archiveJobId: "job-abc123",
      archiveState: "IN_PROGRESS",
      startedAt: 1709500000000,
      token: "encrypted-token"
    }
  }
  ```

### Step 6: Incremental Sync Considerations

The Data Portability API doesn't support cheap "has anything changed?" checks like Spotify's count+latest-ID probe. Options:

**Recommended approach — Time-based access:**
- Request 30-day recurring access during OAuth
- Re-export every 24 hours (minimum allowed interval)
- Compare new export against previous to calculate diff
- The `onProgress` callback can report "Checking for changes..." during this process

**Optimization — Hash comparison:**
- Store SHA-256 hash of previous CSV data
- If new archive hash matches → skip parsing, report "no changes"
- Saves CPU on large libraries when nothing changed

**Fallback — Manual sync only:**
- If user granted one-time access, sync is a one-shot import
- UI shows "Last imported on [date]" with "Re-import" button (triggers new OAuth)

### Step 7: Tests (`tests/sync/youtubemusic-provider.test.js`)

Following existing test patterns from `sync-engine.test.js`:

```javascript
describe('YouTube Music Sync Provider', () => {
  describe('CSV Parsing', () => {
    test('parses library songs CSV with all fields');
    test('parses music uploads with duration');
    test('handles quoted fields with commas');
    test('handles UTF-8 BOM');
    test('skips empty rows');
    test('handles missing fields gracefully');
  });

  describe('Track Transformation', () => {
    test('generates consistent track IDs from artist-title-album');
    test('pre-populates YouTube source with video ID');
    test('sets confidence 1.0 for tracks with video ID');
    test('handles uploads without video ID');
    test('parses duration string "243.5s" to integer 244');
    test('uses YouTube thumbnail as album art');
  });

  describe('Archive Flow', () => {
    test('initiates archive with correct resources');
    test('polls with exponential backoff');
    test('respects timeout');
    test('handles FAILED archive state');
    test('caches archive data across fetchTracks and fetchPlaylists');
    test('invalidates cache after TTL');
  });

  describe('Playlist Import', () => {
    test('discovers playlists from ZIP directory listing');
    test('generates playlist snapshot from track list hash');
    test('preserves track order from CSV');
  });

  describe('Provider Interface Compliance', () => {
    test('has correct id and displayName');
    test('capabilities reflect tracks and playlists only');
    test('getRateLimitDelay returns 0');
    test('checkAuth validates Google token');
  });
});
```

---

## Limitations & Known Constraints

1. **No real-time sync** — Archives are bulk exports, minimum 24h between re-exports
2. **No write-back** — Can't add tracks to YouTube Music library from Parachord
3. **No `addedAt` date** — CSV doesn't include when tracks were added; use import timestamp
4. **No album art from CSV** — Use YouTube video thumbnails (may not match actual album art)
5. **No album-level or artist-level library** — CSV only exports songs; albums/artists must be inferred
6. **Duration only for uploads** — Library songs from the CSV don't include duration; can fetch via YouTube oEmbed as enrichment
7. **Google verification required** — Sensitive scopes need 3–5 day review before public use
8. **Archive can be slow** — Large libraries may take hours; UX must handle gracefully

## Future Enhancements

- **YouTube Data API v3 write-back** — Add `saveTracks()` / `removeTracks()` using playlist manipulation
- **Duration enrichment** — Batch-fetch durations via YouTube oEmbed API for library songs
- **Album art enrichment** — Use MusicBrainz/Discogs to find real album art for imported tracks
- **Selective playlist import** — Let users pick which playlists to import (like Spotify's picker)
- **Subscription channel import** — Import subscribed artist channels as followed artists
- **Lifetime listening history import** — Import full play history from Spotify/Apple Music GDPR data exports (see [issue draft](../issues/listening-history-import.md))

---

## Summary

| Component | File | Effort |
|-----------|------|--------|
| CSV parser | `lib/csv-parser.js` | Small |
| Archive poller | `lib/archive-poller.js` | Medium |
| Sync provider | `sync-providers/youtubemusic.js` | Medium |
| Google OAuth + BYOK setup | `app.js` + docs | Medium |
| Progress UI (modal + background) | `app.js` renderer code | Medium |
| Archive state persistence | `main.js` electron-store | Small |
| Tests | `tests/sync/youtubemusic-provider.test.js` + `tests/sync/csv-parser.test.js` | Medium |
| Credentials setup doc update | `docs/setup/API_CREDENTIALS_SETUP.md` | Small |

Total: ~7 files new, ~3 files modified.

---

## Appendix A: Spotify Bulk Data Export Research

### Does Spotify Have a Bulk Export API?

**No.** Spotify has no programmatic bulk export endpoint. The only bulk export is the manual "Download your data" feature at Account > Privacy Settings, which:

1. Is triggered manually via web UI (no API)
2. Requires email confirmation
3. Takes hours to 30 days to prepare
4. Delivers a ZIP of JSON files

**There is no equivalent to Google's Data Portability API for Spotify.**

### What's in the Spotify Data Dump?

Spotify offers **two tiers** of data export, both manual:

#### Standard Export (hours to ~5 days)

All JSON files in a ZIP:

| File | Contents |
|------|----------|
| `YourLibrary.json` | Liked songs, saved podcasts, followed artists, hidden items |
| `Playlist1.json` (etc.) | User playlists with track listings |
| `StreamingHistory0.json` (etc.) | Last ~1 year of play history (track name, artist, ms played, timestamp) |
| `SearchQueries.json` | Search history |
| `Userdata.json` | Account info |

#### Extended Streaming History (up to 30 days)

A separate request that includes **lifetime play history** with richer fields:

| Field | Description |
|-------|-------------|
| `ts` | Timestamp (ISO 8601) |
| `master_metadata_track_name` | Track name |
| `master_metadata_album_artist_name` | Artist name |
| `master_metadata_album_album_name` | Album name |
| `spotify_track_uri` | Full Spotify URI (e.g. `spotify:track:abc123`) |
| `ms_played` | Milliseconds played |
| `reason_start` / `reason_end` | Why playback started/ended (e.g. `trackdone`, `fwdbtn`, `clickrow`) |
| `shuffle`, `skipped`, `offline` | Booleans |
| `platform` | Device/OS |
| `episode_name` / `episode_show_name` | Podcast fields |

This is the only way to get full lifetime play history with track URIs from Spotify.

### Data Quality Compared to Web API

The GDPR export is **significantly less useful** than the Web API Parachord already uses:

| Field | GDPR Export | Web API (current) |
|-------|-------------|-------------------|
| Track IDs | Standard: missing; Extended: full `spotify_track_uri` | Full Spotify IDs |
| Album art | Not included | Multiple sizes |
| `added_at` timestamps | Not included | Included |
| Duration | Not included | Included |
| Artist/Album IDs | Not included | Included |
| Playlist track IDs | Names only | Full track objects |
| Write-back | No | Yes |
| Continuous sync | No | Yes (polling) |
| Change detection | No | `snapshot_id` + count probes |

### Verdict for Parachord

**No action needed for library sync.** The paginated REST API approach in `sync-providers/spotify.js` is definitively the correct approach for library/playlist sync. The GDPR dump is:
- Not triggerable programmatically
- Less data-rich for library data (missing art, `added_at`, durations in standard export)
- Not suitable for continuous or two-way sync

**Potential future use:** Like Apple Music's privacy export, the **Extended Streaming History** contains **full lifetime play history** with track URIs — data that the Web API doesn't expose (the Web API only gives recently played, deduplicated). If Parachord ever wants to import listening history (scrobbling backfill, recommendation seeding, stats), a manual Spotify data dump import could be valuable. The extended export is higher quality than Apple's equivalent since it includes proper `spotify_track_uri` identifiers.

### Note: Feb 2026 API Restrictions

Spotify's Web API now requires Premium for Dev Mode apps, and Extended Quota Mode (for >25 users) requires 250K MAU and business registration. This is a business/compliance concern for Parachord's BYOK model, not a technical data export concern.

---

## Appendix B: Apple Music Bulk Data Export Research

### Does Apple Have a Bulk Export API?

**No.** Apple has two related mechanisms, neither of which is a programmatic music export:

1. **privacy.apple.com** — Manual web portal for GDPR data download. Covers Apple Music but is not programmatic.
2. **Account Data Transfer API** (EU DMA) — Only covers App Store data (transactions/downloads), **not** Apple Music.

### What's in the Apple Music Data Dump?

Mixed CSV and JSON in a ZIP, prepared in up to 7 days:

| File | Format | Contents |
|------|--------|----------|
| `Apple Music Library Tracks.json` | JSON | Full library with title, artist, album, genre, year, duration, play count, date added, skip count |
| `Apple Music Play Activity.csv` | CSV | Lifetime play history (~45 columns, but no dedicated artist column — must parse from "Item Description") |
| `Apple Music - Play History Daily Tracks.csv` | CSV | Simplified daily play aggregation |
| `Apple Music Likes and Dislikes.csv` | CSV | Ratings with timestamps |
| `Apple Music - Container Details.csv` | CSV | Playlist/container metadata (but not full playlist track listings) |

### Data Quality Issues

- **No dedicated Artist Name column** in Play Activity CSV — artist must be parsed from combined "Item Description" field
- **Playlist contents are incomplete** — the export has container metadata but not full track listings per playlist
- **Data quality widely described as "awful"** by developers who've worked with it
- Library Tracks JSON is the best file — has proper structured metadata

### Comparison to MusicKit API (current Parachord approach)

| Aspect | Privacy Export | MusicKit API (current) |
|--------|---------------|----------------------|
| Access | Manual, up to 7 days | Real-time REST API |
| Library | Yes (JSON, good quality) | Yes (`/v1/me/library/songs`) |
| Playlists | Metadata only, no track lists | Full contents (`/v1/me/library/playlists`) |
| Play history | Full lifetime | Recent only (limited, deduplicated) |
| Write access | None | Create/modify playlists, ratings |
| Programmatic | No | Yes |

### Verdict for Parachord

**No action needed for library sync.** The MusicKit API approach in `sync-providers/applemusic.js` provides better data for library/playlist import.

**One potential future use:** The privacy export contains **full lifetime play history**, which the MusicKit API does not expose. If Parachord ever wants to import listening history (for scrobbling backfill, recommendation seeding, or stats), a manual Apple Music data dump import could be valuable. But this is a separate feature from library sync.

### DMA Status

Apple Music is **not designated as a gatekeeper core platform service** under the EU DMA. Apple's DMA obligations cover iOS, App Store, and Safari — not Apple Music specifically. No music-specific data portability API is mandated.
