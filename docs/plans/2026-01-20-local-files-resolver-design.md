# Local Files Resolver Design

## Overview

A first-class resolver that lets users set watch folders on their computer and import local music files into their Parachord collection. The resolver participates in the normal resolution chain alongside streaming services.

## Core Requirements

- **Continuous sync** - Automatically detect when files are added/removed from watch folders
- **Multiple folders** - User can add multiple watch folders (Music, Downloads, External Drive, etc.)
- **Supported formats** - MP3, M4A/AAC, FLAC, WAV
- **Metadata** - Read embedded tags with MusicBrainz enrichment for missing/inconsistent data
- **Album art** - Embedded → folder images → Cover Art Archive → existing placeholder
- **Storage** - SQLite database for efficient querying of large libraries
- **File watching** - Real-time when app is in foreground, polling when backgrounded
- **Playback** - HTML5 Audio element with file:// URLs

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Renderer Process (app.js)                │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │ Local Files     │  │ Settings UI                      │  │
│  │ Resolver (.axe) │  │ - Add/remove watch folders       │  │
│  │ - search()      │  │ - View indexed track count       │  │
│  │ - resolve()     │  │ - Trigger manual rescan          │  │
│  │ - play()        │  │ - Enable/disable resolver        │  │
│  └────────┬────────┘  └──────────────────────────────────┘  │
│           │ IPC                                              │
└───────────┼─────────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────┐
│                    Main Process (main.js)                   │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │ LocalFilesIndex │  │ FileWatcher                      │  │
│  │ (SQLite via     │  │ - chokidar (foreground)          │  │
│  │  better-sqlite3)│  │ - polling interval (background)  │  │
│  │                 │  │ - debounced change processing    │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
│                                                             │
│  ┌─────────────────┐  ┌──────────────────────────────────┐  │
│  │ MetadataReader  │  │ AlbumArtResolver                 │  │
│  │ (music-metadata)│  │ - Embedded extraction            │  │
│  │ - ID3, Vorbis   │  │ - Folder image scan              │  │
│  │ - MP3/M4A/FLAC  │  │ - MusicBrainz Cover Art Archive  │  │
│  └─────────────────┘  └──────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## Data Model

### SQLite Schema

```sql
-- Track metadata indexed from local files
CREATE TABLE tracks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_path TEXT UNIQUE NOT NULL,
  file_hash TEXT,
  modified_at INTEGER,

  title TEXT NOT NULL,
  artist TEXT,
  album TEXT,
  album_artist TEXT,
  track_number INTEGER,
  disc_number INTEGER,
  year INTEGER,
  genre TEXT,
  duration REAL,

  format TEXT,
  bitrate INTEGER,
  sample_rate INTEGER,

  has_embedded_art INTEGER DEFAULT 0,
  folder_art_path TEXT,
  musicbrainz_art_url TEXT,

  musicbrainz_track_id TEXT,
  musicbrainz_artist_id TEXT,
  musicbrainz_release_id TEXT,
  enriched_at INTEGER,

  indexed_at INTEGER NOT NULL,

  title_normalized TEXT,
  artist_normalized TEXT,
  album_normalized TEXT
);

CREATE TABLE watch_folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT UNIQUE NOT NULL,
  enabled INTEGER DEFAULT 1,
  last_scan_at INTEGER,
  track_count INTEGER DEFAULT 0
);

CREATE INDEX idx_tracks_artist ON tracks(artist_normalized);
CREATE INDEX idx_tracks_title ON tracks(title_normalized);
CREATE INDEX idx_tracks_album ON tracks(album_normalized);
CREATE INDEX idx_tracks_file_path ON tracks(file_path);
```

### Track Object (returned to renderer)

```javascript
{
  id: "local-12345",
  title: "Song Name",
  artist: "Artist Name",
  album: "Album Name",
  duration: 245,
  albumArt: "file:///path/to/art.jpg" || "https://coverartarchive.org/...",
  filePath: "/Users/me/Music/Artist/Album/song.flac",
  format: "flac",
  bitrate: 1411,
  sources: {
    localfiles: {
      filePath: "/Users/me/Music/Artist/Album/song.flac",
      fileUrl: "file:///Users/me/Music/Artist/Album/song.flac",
      confidence: 1.0,
      duration: 245
    }
  }
}
```

## File Structure

```
parachord-desktop/
├── main.js                      # Add IPC handlers for localFiles
├── local-files/
│   ├── index.js                 # Main entry, exports LocalFilesService
│   ├── database.js              # SQLite connection and queries
│   ├── scanner.js               # File discovery and indexing
│   ├── metadata-reader.js       # Tag extraction (music-metadata)
│   ├── watcher.js               # File system watching (chokidar)
│   ├── album-art.js             # Art extraction and fetching
│   └── musicbrainz-enricher.js  # Optional MB metadata enrichment
└── resolvers/
    └── localfiles.axe           # The resolver plugin
```

## Resolver Implementation

### localfiles.axe Manifest

```javascript
{
  "manifest": {
    "id": "localfiles",
    "name": "Local Files",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Play music from your local library",
    "icon": "📁",
    "color": "#6366f1"
  },
  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": true,
    "browse": true,
    "urlLookup": false
  },
  "urlPatterns": [],
  "settings": {
    "requiresAuth": false,
    "configurable": {
      "watchFolders": {
        "type": "custom",
        "label": "Watch Folders"
      }
    }
  }
}
```

### Implementation Functions

- **search(query, config)** - IPC to main process, queries SQLite with fuzzy matching
- **resolve(artist, track, album, config)** - Find best local match with confidence scoring
- **play(source, config)** - Return file:// URL for HTML5 Audio playback
- **init(config)** - Start file watchers, verify folders exist

## IPC Bridge

### Preload API

```javascript
localFiles: {
  addWatchFolder: () => ipcRenderer.invoke('localFiles:addWatchFolder'),
  removeWatchFolder: (path) => ipcRenderer.invoke('localFiles:removeWatchFolder', path),
  getWatchFolders: () => ipcRenderer.invoke('localFiles:getWatchFolders'),
  rescanAll: () => ipcRenderer.invoke('localFiles:rescanAll'),
  rescanFolder: (path) => ipcRenderer.invoke('localFiles:rescanFolder', path),
  search: (query) => ipcRenderer.invoke('localFiles:search', query),
  resolve: (params) => ipcRenderer.invoke('localFiles:resolve', params),
  getStats: () => ipcRenderer.invoke('localFiles:getStats'),
  onScanProgress: (callback) => ipcRenderer.on('localFiles:scanProgress', callback),
  onLibraryChanged: (callback) => ipcRenderer.on('localFiles:libraryChanged', callback),
  onError: (callback) => ipcRenderer.on('localFiles:error', callback)
}
```

## Playback Integration

Local files use HTML5 Audio element:

```javascript
const playLocalFile = async (source) => {
  if (!audioRef.current) {
    audioRef.current = new Audio();
    audioRef.current.addEventListener('timeupdate', handleTimeUpdate);
    audioRef.current.addEventListener('ended', handleTrackEnded);
    audioRef.current.addEventListener('error', handleAudioError);
  }

  audioRef.current.src = source.fileUrl;
  audioRef.current.volume = volume / 100;
  await audioRef.current.play();
};
```

Existing playbar controls work automatically via audio element API.

## File Watcher Behavior

- **Foreground**: Real-time watching with chokidar, debounced (2s quiet period)
- **Background**: 5-minute polling interval to save resources
- **Supported events**: add, change, unlink (remove)

## Album Art Resolution Priority

1. Embedded art (extracted to cache)
2. Folder images (cover.jpg, folder.jpg, album.png, front.jpg)
3. Cover Art Archive (if MusicBrainz release ID available)
4. Existing app placeholder

## MusicBrainz Enrichment

- Runs as background task after initial scan
- Rate limited to 1 request/second per MB guidelines
- Updates missing/inconsistent metadata
- Provides release IDs for Cover Art Archive lookups

## Dependencies

```json
{
  "better-sqlite3": "^9.0.0",
  "music-metadata": "^7.0.0",
  "chokidar": "^3.5.0"
}
```

## Implementation Order

1. Database layer - SQLite schema, connection, basic CRUD
2. Metadata reader - Parse audio files, extract tags
3. Scanner - Discover files, populate database
4. IPC bridge - Wire up main ↔ renderer communication
5. Resolver (.axe) - search(), resolve(), play() implementations
6. Settings UI - Watch folder management panel
7. Playback integration - HTML5 Audio for file:// URLs
8. File watcher - Real-time + polling hybrid
9. Album art - Embedded extraction, folder scan, CAA fetch
10. MusicBrainz enrichment - Background metadata improvement
