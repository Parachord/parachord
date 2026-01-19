# Add to Queue Context Menu Design

## Overview

Add right-click context menus to tracks, playlists, and releases that allow adding items to the bottom of the playback queue.

## Behavior

- **Right-click a single track** (in playlist, album, library, queue) → "Add to Queue" adds that one track
- **Right-click a playlist card** (in Playlists grid view) → "Add All to Queue" adds all tracks from that playlist
- **Right-click an album/release card** (in artist discography grid) → "Add All to Queue" adds all tracks from that release

## Architecture

### Core Function

```javascript
const addToQueue = (tracks) => {
  const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
  setCurrentQueue(prev => [...prev, ...tracksArray]);
  console.log(`➕ Added ${tracksArray.length} track(s) to queue`);
};
```

### IPC Flow

1. **Renderer** - `onContextMenu` event triggers `window.electron.showTrackContextMenu(data)`
2. **Main process** - Builds native menu with "Add to Queue" option, shows it
3. **Main process** - On click, sends action back via `track-context-menu-action` channel
4. **Renderer** - Listener receives action, calls `addToQueue()` with the track(s)

### Data Passed to Context Menu

- For tracks: `{ type: 'track', track: { id, title, artist, album, sources, ... } }`
- For playlists: `{ type: 'playlist', name, tracks: [...] }`
- For albums/releases: `{ type: 'release', title, tracks: [...] }`

## Implementation Locations

### Preload.js

```javascript
showTrackContextMenu: (data) => ipcRenderer.invoke('show-track-context-menu', data),
onTrackContextMenuAction: (callback) => ipcRenderer.on('track-context-menu-action', (_, data) => callback(data))
```

### Main.js

Single IPC handler `show-track-context-menu` that builds menu based on `data.type`:
- `track` → "Add to Queue" (single track)
- `playlist` → "Add All to Queue"
- `release` → "Add All to Queue"

### Renderer (app.js)

Context menu triggers:

| Location | Element | Data passed |
|----------|---------|-------------|
| Playlist detail view | Track row | `{ type: 'track', track }` |
| Release/album track list | Track row | `{ type: 'track', track }` |
| Library view | Track row | `{ type: 'track', track }` |
| Queue drawer | Track row | `{ type: 'track', track }` |
| Playlists grid | Playlist card | `{ type: 'playlist', name, tracks }` |
| Artist discography | Release card | `{ type: 'release', title, tracks }` |

Action listener: One `useEffect` that listens for `track-context-menu-action` and calls `addToQueue(data.tracks)`.

## Track Data Preparation

For individual tracks: Already have the right shape from their respective views.

For playlist cards: Pass the full `playlistTracks` array (resolved with sources) or raw playlist tracks.

For release/album cards: Build track objects with metadata:

```javascript
const tracksForQueue = release.tracks.map(t => ({
  ...t,
  id: `${artist}-${t.title}-${release.title}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
  artist: release.artist?.name || artist,
  album: release.title,
  albumArt: release.albumArt,
  sources: trackSources[`${t.position}-${t.title}`] || {}
}));
```

Tracks may not have resolved sources yet - the existing queue sync mechanism handles updating them when sources resolve, or they resolve on-demand when played.

## User Feedback

The existing `queueAnimating` state triggers a pulse animation on the queue button when tracks are added.

## Files to Modify

1. **preload.js** - Add IPC bridge methods
2. **main.js** - Add IPC handler for context menu
3. **app.js** - Add `addToQueue`, listener, and `onContextMenu` handlers
