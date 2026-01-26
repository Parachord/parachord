# Resolver Library Sync Design

## Overview

Resolver Library Sync is a generalized system that treats connected resolver accounts as "hosted sources" (similar to hosted XSPFs). When a resolver is connected and authorized, Parachord can automatically sync that service's library data to the local Collection and Playlists.

This document defines the core sync framework and uses Spotify as the reference implementation. Other resolvers (Apple Music, Qobuz, Tidal, YouTube Music, etc.) can implement the same sync provider interface to enable library sync for their services.

### Spotify Implementation

When connected and authorized, Spotify syncs:

- Liked Songs → Tracks Collection
- Saved Albums → Albums Collection
- Followed Artists → Artists Collection
- Playlists → Playlists (user selects which ones)

Sync is automatic and continuous for connected accounts. Users can disconnect to stop syncing.

## Sync Provider Interface

Each resolver that supports library sync implements a `SyncProvider` interface:

```typescript
interface SyncProvider {
  // Resolver identifier (e.g., "spotify", "applemusic", "qobuz")
  id: string;

  // Human-readable name for UI
  displayName: string;

  // What this provider can sync
  capabilities: {
    tracks: boolean;      // Liked/saved songs
    albums: boolean;      // Saved albums
    artists: boolean;     // Followed artists
    playlists: boolean;   // User playlists
    playlistFolders: boolean;  // Hierarchical playlist organization
  };

  // Fetch methods - return arrays of normalized items
  fetchTracks(token: string): Promise<SyncTrack[]>;
  fetchAlbums(token: string): Promise<SyncAlbum[]>;
  fetchArtists(token: string): Promise<SyncArtist[]>;
  fetchPlaylists(token: string): Promise<SyncPlaylist[]>;
  fetchPlaylistTracks(playlistId: string, token: string): Promise<SyncTrack[]>;

  // For playlist change detection
  getPlaylistSnapshot(playlistId: string, token: string): Promise<string>;

  // Rate limit handling
  getRateLimitDelay(): number;
}
```

This allows the core sync engine to work identically across all providers while each resolver handles its own API specifics.

## Data Model

### Provenance Tracking

Each Collection item gains a `syncSources` field to track where it came from. Keys are resolver IDs:

```javascript
{
  id: "artist-title-album",
  title: "Track Name",
  artist: "Artist Name",
  album: "Album Name",
  // ... existing fields
  syncSources: {
    spotify: {
      addedAt: 1699999999999,  // when service reported it
      syncedAt: 1700000000000  // last sync check
    },
    applemusic: {
      addedAt: 1699888888888,
      syncedAt: 1700000000000
    },
    manual: {
      addedAt: 1698888888888   // user added directly
    }
  }
}
```

An item is only removed when ALL its sync sources are gone. If a user manually added a track AND it was synced from Spotify AND Apple Music, removing from Spotify only removes that source - the item stays because `manual` and `applemusic` sources remain.

### Playlist Sync Metadata

Synced playlists are snapshot-based with change detection:

```javascript
{
  id: "spotify-playlist-xyz",
  syncedFrom: {
    resolver: "spotify",        // which resolver this came from
    externalId: "xyz",          // ID in the source service
    snapshotId: "abc123",       // service's version identifier (if supported)
  },
  hasUpdates: false,           // true when remote snapshot differs
  locallyModified: false,      // true if user edited in Parachord
  syncSources: {
    spotify: { addedAt: ..., syncedAt: ... }
  },
  // ... tracks, metadata
}
```

`locallyModified` is set to `true` when user adds, removes, or reorders tracks in Parachord.

Note: A playlist can only be synced from one source (unlike tracks which can have multiple sources). This is because playlists are ordered collections with specific track lists.

### Sync Settings Store

Persisted in electron-store. Settings are keyed by resolver ID for extensibility:

```javascript
{
  resolverSync: {
    spotify: {
      enabled: true,
      lastSyncAt: 1700000000000,
      syncTracks: true,
      syncAlbums: true,
      syncArtists: true,
      syncPlaylists: true,
      selectedPlaylistIds: ["playlist-id-1", "playlist-id-2", ...]
    },
    applemusic: {
      enabled: true,
      lastSyncAt: 1700000000000,
      syncTracks: true,
      syncAlbums: false,
      syncArtists: true,
      syncPlaylists: true,
      selectedPlaylistIds: [...]
    }
    // ... other resolvers
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

Quick access view showing status for all active sync providers:

```
Library Sync
─────────────────────────────────
⬤ Spotify - Last sync 5 min ago
  847 tracks, 52 albums, 124 artists, 8 playlists

⬤ Apple Music - Last sync 12 min ago
  234 tracks, 18 albums, 45 artists, 3 playlists

[Sync Now]                    [Manage settings →]
```

- Shows all connected providers with sync enabled
- "Sync Now" triggers sync for all providers
- Link to Settings for granular control

### Settings/Plugins Page - Resolver Sections

For each resolver that implements `SyncProvider`, show "Library Sync" section under its settings:

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

- Only shown for resolvers with sync capability
- Toggles reflect the provider's capabilities (e.g., hide "Playlists" if provider doesn't support it)
- "Manage..." opens playlist picker (with folders if supported)
- "Stop Syncing" initiates disconnect flow for that provider only

### Playlist Update Indicator

In Playlists sidebar/grid:
- Synced playlists show small badge with source resolver icon (Spotify, Apple Music, etc.)
- Playlists with `hasUpdates: true` show notification dot on the badge
- Opening playlist shows banner: "This playlist has been updated on [Source]. [Update] [Dismiss]"

## Error Handling

### Token Expiration

- If a resolver's token expires mid-sync, attempt silent refresh via existing OAuth refresh flow
- If refresh fails, pause sync for that provider and show notification: "[Provider] sync paused - reconnect required"
- Sync resumes automatically once re-authenticated
- Other providers continue syncing unaffected

### Disconnecting a Sync Provider

When user clicks "Stop Syncing" on any provider:

1. Prompt: **"Stop syncing your [Provider] library?"**

   Options:
   - **Keep imported items** - Synced music stays in Collection as local items
   - **Remove synced items** - Remove everything synced from [Provider]

2. If "Keep imported items":
   - Remove `syncSources.[provider]` from all items
   - Items remain in Collection with no sync association to that provider
   - Synced playlists from that provider become independent local playlists

3. If "Remove synced items":
   - Remove all items where `syncSources.[provider]` exists AND no other sources
   - Items with multiple sources (e.g., `manual` + `spotify` + `applemusic`): only remove that provider's source, item stays
   - Remove synced playlists from that provider where `locallyModified: false`
   - Keep synced playlists where `locallyModified: true` as local copies

### Rate Limiting

- Each provider has different rate limits; `SyncProvider.getRateLimitDelay()` returns appropriate backoff
- If rate limited during sync, queue remaining work and retry after delay
- Show subtle indicator: "[Provider] sync in progress... (retrying)"
- Rate limits on one provider don't affect others - they sync independently

### Large Libraries

- Spotify API paginates at 50 items; fetch all pages sequentially
- For initial sync of very large libraries (1000+ items), show progress bar with counts
- Process in background; user can continue using app

### Playlist Deleted on Source Service

If a synced playlist no longer exists on its source service:
- Show banner on playlist: "This playlist was deleted on [Source]. [Keep Local Copy] [Remove]"
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

1. **Sync Engine** (`src/services/syncEngine.ts`) - Core sync orchestration, scheduling, diff calculations
2. **Sync Provider Interface** (`src/services/syncProviders/types.ts`) - TypeScript interfaces for providers
3. **Spotify Sync Provider** (`src/services/syncProviders/spotify.ts`) - Spotify-specific API implementation
4. **Sync Setup Modal** (`src/components/SyncSetupModal.tsx`) - Initial setup flow with folder picker
5. **Sync Status Modal** (`src/components/SyncStatusModal.tsx`) - Quick status view from Collection
6. **Playlist Update Banner** (`src/components/PlaylistUpdateBanner.tsx`) - "Updates available" UI component

### Modified Files

1. **Collection Store/State** - Add `syncSources` field handling, merge logic
2. **Playlist Store/State** - Add sync metadata fields (`syncedFrom`, `snapshotId`, `hasUpdates`, `locallyModified`)
3. **Resolver Settings UI** - Add Library Sync section (generic, shown for resolvers with sync capability)
4. **Collection Header** - Add Sync button
5. **Spotify OAuth Config** - Add new required scopes
6. **Playlist Edit Operations** - Set `locallyModified: true` on user changes

## Future Resolver Implementations

The sync provider interface is designed to accommodate various services:

| Resolver | Tracks | Albums | Artists | Playlists | Folders | Notes |
|----------|--------|--------|---------|-----------|---------|-------|
| Spotify | ✓ | ✓ | ✓ | ✓ | ✓ | Reference implementation |
| Apple Music | ✓ | ✓ | ✓ | ✓ | ✗ | Requires MusicKit JS |
| Qobuz | ✓ | ✓ | ✓ | ✓ | ✗ | API access may be limited |
| Tidal | ✓ | ✓ | ✓ | ✓ | ✓ | Has folder support |
| YouTube Music | ✓ | ✓ | ✓ | ✓ | ✗ | Unofficial API concerns |
| Deezer | ✓ | ✓ | ✓ | ✓ | ✓ | Has folder support |
| Last.fm | ✓ | ✓ | ✓ | ✗ | ✗ | Loved tracks, no playlists |

Each new provider only needs to implement the `SyncProvider` interface - the sync engine, UI components, and data model work unchanged.
