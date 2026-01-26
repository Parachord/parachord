# Spotify Library Sync Design

## Overview

Spotify Library Sync treats a connected Spotify account as a "hosted source" (similar to hosted XSPFs). When connected and authorized, Parachord automatically syncs:

- Liked Songs → Tracks Collection
- Saved Albums → Albums Collection
- Followed Artists → Artists Collection
- Playlists → Playlists (user selects which ones)

Sync is automatic and continuous for connected accounts. Users can disconnect to stop syncing.

## Data Model

### Provenance Tracking

Each Collection item gains a `syncSources` field to track where it came from:

```javascript
{
  id: "artist-title-album",
  title: "Track Name",
  artist: "Artist Name",
  album: "Album Name",
  // ... existing fields
  syncSources: {
    spotify: {
      addedAt: 1699999999999,  // when Spotify reported it
      syncedAt: 1700000000000  // last sync check
    },
    manual: {
      addedAt: 1698888888888   // user added directly
    }
  }
}
```

An item is only removed when ALL its sync sources are gone. If a user manually added a track AND it was synced from Spotify, unliking on Spotify removes the `spotify` source but the item stays (because `manual` source remains).

### Playlist Sync Metadata

Synced playlists are snapshot-based with change detection:

```javascript
{
  id: "spotify-playlist-xyz",
  spotifyId: "xyz",
  snapshotId: "abc123",        // Spotify's version identifier
  hasUpdates: false,           // true when Spotify snapshot differs
  locallyModified: false,      // true if user edited in Parachord
  syncSources: {
    spotify: { addedAt: ..., syncedAt: ... }
  },
  // ... tracks, metadata
}
```

`locallyModified` is set to `true` when user adds, removes, or reorders tracks in Parachord.

### Sync Settings Store

Persisted in electron-store:

```javascript
{
  spotifySync: {
    enabled: true,
    lastSyncAt: 1700000000000,
    syncLikedSongs: true,
    syncSavedAlbums: true,
    syncFollowedArtists: true,
    syncPlaylists: true,
    selectedPlaylistIds: ["playlist-id-1", "playlist-id-2", ...]
  }
}
```

## Sync Mechanics

### Frequency & Triggers

- **Background sync**: Every 15 minutes while app is running (consistent with hosted XSPF behavior)
- **On app launch**: Sync runs after Spotify token is validated
- **Manual trigger**: User can click "Sync Now" for immediate refresh

### Sync Process

1. **Fetch from Spotify API**:
   - `GET /v1/me/tracks` (Liked Songs, paginated at 50)
   - `GET /v1/me/albums` (Saved Albums, paginated at 50)
   - `GET /v1/me/following?type=artist` (Followed Artists, paginated at 50)
   - `GET /v1/me/playlists` (User's playlists, for change detection)
   - `GET /v1/playlists/{id}` (Individual playlist tracks when updating)

2. **Diff against local state**:
   - New items in Spotify → Add to Collection with `syncSources.spotify`
   - Items removed from Spotify → Remove `syncSources.spotify`; delete item only if no other sources remain
   - For playlists: Compare `snapshot_id` to detect changes, set `hasUpdates: true`

3. **Batch updates**: Collect all changes, save once to avoid thrashing disk

### Playlist Change Handling

When a synced playlist's `snapshot_id` differs from stored:
- Set `hasUpdates: true` on the playlist
- Show indicator badge in Playlists view
- User clicks "Update" to pull latest tracks (replaces current)
- Or "Dismiss" to acknowledge but keep current version

### Merge Logic

When syncing a track that already exists in Collection (matched by artist + title + album):
- Do not create duplicate
- Add `spotify` to existing item's `syncSources`
- Preserves any existing `manual` source

## Initial Setup Flow

### First-Time Sync

1. User connects Spotify via existing OAuth flow
2. After successful auth, modal appears: **"Sync Your Spotify Library"**
3. Modal shows four toggles (all on by default):
   - ☑ Liked Songs → Tracks Collection
   - ☑ Saved Albums → Albums Collection
   - ☑ Followed Artists → Artists Collection
   - ☑ Playlists (click to select which ones)

4. If "Playlists" is checked, expands to show playlist picker with folder support:

```
☑ Playlists
  ├─ 📁 Chill Vibes (folder)
  │   ☑ Select entire folder
  │   ├─ ☑ Late Night Jazz (42 tracks)
  │   ├─ ☑ Acoustic Mornings (28 tracks)
  │   └─ ☑ Rainy Day Reads (35 tracks)
  │
  ├─ 📁 Workout (folder)
  │   ☐ Select entire folder
  │   ├─ ☐ High Energy (67 tracks)
  │   └─ ☐ Cool Down (23 tracks)
  │
  ├─ ☑ Road Trip 2024 (54 tracks)
  └─ ☑ Discover Weekly (30 tracks) - by Spotify
```

- Folders show with icon and "Select entire folder" toggle
- Toggling folder selects/deselects all playlists inside
- Individual playlists can still be toggled independently
- Partial folder selection shows indeterminate checkbox state
- Unfiled playlists appear at root level
- Search/filter for users with many playlists

5. User clicks **"Start Sync"**
6. Progress indicator shows import status
7. On completion: "Synced X tracks, Y albums, Z artists, N playlists"

### Subsequent Connections

If user disconnects and reconnects Spotify, show the setup modal again with previous selections remembered.

## UI Components

### Collection Page - Header Button

- Add "Sync" button/icon next to existing controls
- Clicking opens Sync Status Modal
- Shows small badge if any synced playlists have updates available

### Sync Status Modal (from Collection)

Quick access view showing:
- Sync status: "Last synced 5 minutes ago"
- "Sync Now" button
- Summary: "Syncing 847 tracks, 52 albums, 124 artists, 8 playlists"
- Link to "Manage sync settings →" (navigates to Settings)

### Settings/Plugins Page - Spotify Section

Under existing Spotify resolver settings, new "Library Sync" section:

```
Library Sync
─────────────────────────────────
Status: ● Active - Last sync 5 min ago    [Sync Now]

Syncing:
  ☑ Liked Songs (847 tracks)
  ☑ Saved Albums (52 albums)
  ☑ Followed Artists (124 artists)
  ☑ Playlists (8 of 23)         [Manage...]

[Stop Syncing]
```

- Toggles allow enabling/disabling sync per data type
- "Manage..." opens playlist folder picker modal
- "Stop Syncing" initiates disconnect flow

### Playlist Update Indicator

In Playlists sidebar/grid:
- Synced playlists show small Spotify badge
- Playlists with `hasUpdates: true` show notification dot
- Opening playlist shows banner: "This playlist has been updated on Spotify. [Update] [Dismiss]"

## Error Handling

### Token Expiration

- If Spotify token expires mid-sync, attempt silent refresh via existing OAuth refresh flow
- If refresh fails, pause sync and show notification: "Spotify sync paused - reconnect required"
- Sync resumes automatically once re-authenticated

### Disconnecting Spotify

When user clicks "Stop Syncing":

1. Prompt: **"Stop syncing your Spotify library?"**

   Options:
   - **Keep imported items** - Synced music stays in Collection as local items
   - **Remove synced items** - Remove everything synced from Spotify

2. If "Keep imported items":
   - Remove `syncSources.spotify` from all items
   - Items remain in Collection with no sync association
   - Synced playlists become independent local playlists

3. If "Remove synced items":
   - Remove all items where `syncSources.spotify` exists AND no other sources
   - Items with both `manual` and `spotify` sources: remove `spotify` source, item stays
   - Remove synced playlists where `locallyModified: false`
   - Keep synced playlists where `locallyModified: true` as local copies

### Rate Limiting

- Spotify API has rate limits; implement exponential backoff
- If rate limited during sync, queue remaining work and retry after delay
- Show subtle indicator: "Sync in progress... (retrying)"

### Large Libraries

- Spotify API paginates at 50 items; fetch all pages sequentially
- For initial sync of very large libraries (1000+ items), show progress bar with counts
- Process in background; user can continue using app

### Playlist Deleted on Spotify

If a synced playlist no longer exists on Spotify:
- Show banner on playlist: "This playlist was deleted on Spotify. [Keep Local Copy] [Remove]"
- "Keep Local Copy" removes sync metadata, playlist becomes independent
- "Remove" deletes the playlist from Parachord

## API Requirements

### New Spotify API Scopes

Add to existing OAuth request:
- `user-library-read` (liked songs, saved albums)
- `user-follow-read` (followed artists)
- `playlist-read-private` (user's playlists including private)

### Spotify API Endpoints Used

- `GET /v1/me/tracks` - Liked songs (paginated)
- `GET /v1/me/albums` - Saved albums (paginated)
- `GET /v1/me/following?type=artist` - Followed artists (paginated)
- `GET /v1/me/playlists` - User's playlists with folder info (paginated)
- `GET /v1/playlists/{id}` - Individual playlist details and tracks

## Implementation Scope

### New Files

1. **Spotify Sync Service** - Core sync logic, API calls, diff calculations, background timer
2. **Sync Setup Modal** - Initial setup flow with folder picker
3. **Sync Status Modal** - Quick status view from Collection
4. **Playlist Update Banner** - "Updates available" UI component

### Modified Files

1. **Collection Store/State** - Add `syncSources` field handling, merge logic
2. **Playlist Store/State** - Add sync metadata fields (`spotifyId`, `snapshotId`, `hasUpdates`, `locallyModified`)
3. **Spotify Resolver Settings UI** - Add Library Sync section with controls
4. **Collection Header** - Add Sync button
5. **Spotify OAuth Config** - Add new required scopes
6. **Playlist Edit Operations** - Set `locallyModified: true` on user changes
