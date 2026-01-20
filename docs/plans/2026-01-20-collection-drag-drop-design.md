# Collection Drag-and-Drop Design

## Overview

Enable dragging album cards, artist cards, and tracks from anywhere in the app and dropping them on the Collection sidebar item to add them to your collection. The Collection has three independent tabs that act as separate "favorites" lists.

## Collection Model

The three Collection tabs are **completely independent**:

1. **Tracks** - Individual songs you like. Includes local files (loaded separately) plus any tracks you drag in. These are playable items.

2. **Albums** - Albums you've explicitly saved as favorites. Just metadata (title, artist, art, year). Clicking opens the album page. Not derived from tracks.

3. **Artists** - Artists you've explicitly saved as favorites. Just metadata (name, image). Clicking opens the artist page. Not derived from tracks.

**Key behavior:**
- Dropping a track adds only that track to Tracks
- Dropping an album adds only album metadata to Albums (tracks are NOT added)
- Dropping an artist adds only artist metadata to Artists (albums/tracks are NOT added)

## Data Model & Persistence

Three separate collections stored on disk as JSON via Electron:

```javascript
{
  tracks: [
    {
      id: string,          // Generated from artist-title-album
      title: string,
      artist: string,
      album: string,
      duration: number,
      albumArt: string,
      sources: { [resolverId]: { url, confidence } },
      addedAt: number      // Timestamp for "recent" sorting
    }
  ],
  albums: [
    {
      id: string,          // Generated from artist-title
      title: string,
      artist: string,
      year: number,
      art: string,
      addedAt: number
    }
  ],
  artists: [
    {
      id: string,          // Artist name normalized
      name: string,
      image: string,
      addedAt: number
    }
  ]
}
```

**Electron IPC methods:**
- `collection.load()` - Load all three lists on app start
- `collection.saveTracks(tracks)` - Save tracks list
- `collection.saveAlbums(albums)` - Save albums list
- `collection.saveArtists(artists)` - Save artists list

Local files are merged into the tracks view at runtime (loaded separately via existing `localFiles.search()`, displayed together).

## Drag-and-Drop Implementation

### Drag Data Formats

```javascript
// Album drag
{
  type: 'album',
  album: { id, title, artist, year, art }
}

// Artist drag
{
  type: 'artist',
  artist: { id, name, image }
}

// Track drag (extends existing format)
{
  type: 'track',
  track: { id, title, artist, album, duration, albumArt, sources }
}
```

### Drop Target

The Collection item in the sidebar becomes a drop zone:
- `onDragOver` - set drop effect to 'copy', show highlight
- `onDragEnter/Leave` - manage highlight state (purple border/glow)
- `onDrop` - parse data type, add to appropriate collection, show toast

## Component Changes

### Components Needing Drag Capability

1. **AlbumCard** - used in search results, artist pages
2. **ArtistCard** - used in search results
3. **Album art on Release/tracklist page** - the large album artwork
4. **Track rows** - already draggable for playlists, extend to work with Collection

### Collection View Changes

- Remove `useMemo` derivation of `collectionArtists` and `collectionAlbums` from library
- Replace with state loaded from persisted collection data
- Merge local files into tracks view at render time
- Keep existing filter/sort functionality (already compatible with item shapes)

## User Feedback

### Toast Notifications

- Success: "Added [Name] to Collection"
- Multi-track: "Added 3 tracks to Collection"
- Duplicate: "[Name] is already in your collection"

### Visual Feedback

- Collection nav item highlights (purple border/glow) when dragging valid items over it
- Standard "copy" cursor effect while dragging

## Edge Cases

- **Duplicates**: Don't add, show "already in collection" toast
- **Missing data**: Use fallbacks (e.g., "Unknown Artist" if artist name missing)
- **Local files**: Continue loading via existing Electron API, merge at display time
