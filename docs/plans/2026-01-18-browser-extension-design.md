# Browser Extension for Parachord

## Overview

A browser extension that bridges the gap between web browsing and Parachord desktop. It provides three key capabilities:

1. **Playback Control** - Remote control YouTube/Bandcamp playback from Parachord
2. **Page Scraping** - Extract track metadata from music pages and send to Parachord as XSPF playlists
3. **URL Resolution** - Send any URL to Parachord for resolver lookup

Inspired by [Tomahawklet](https://github.com/jherskowitz/tomahklet), which scraped music sites to generate XSPF playlists for Tomahawk.

## Problems Solved

**Playback Control:**
- Currently when Parachord plays a YouTube or Bandcamp track via `shell.openExternal()`, it loses all control
- Can't pause, can't detect when track ends, queue can't auto-advance

**Content Discovery:**
- User finds a great playlist on a blog or music site
- Currently no way to get that into Parachord without manually searching each track
- Need to scrape page metadata and import as playlist

**URL Sharing:**
- User is browsing and finds a track/album URL they want to play
- Should be able to send it to Parachord with one click

## Solution

A browser extension that:
- Connects to Parachord via WebSocket
- Receives play/pause commands and executes them on the page
- Reports playback state (playing, paused, ended) back to Parachord
- Scrapes track metadata from supported pages and generates XSPF
- Sends current page URL to Parachord for resolution

## Architecture

```
┌─────────────────────────┐         ┌─────────────────────────┐
│   Parachord Desktop     │         │   Browser Extension     │
│                         │         │                         │
│  ┌───────────────────┐  │  ws://  │  ┌───────────────────┐  │
│  │ WebSocket Server  │◄─┼─────────┼──│ WebSocket Client  │  │
│  │ (localhost:9876)  │  │         │  │                   │  │
│  └───────────────────┘  │         │  └───────────────────┘  │
│           │             │         │           │             │
│           ▼             │         │           ▼             │
│  ┌───────────────────┐  │         │  ┌───────────────────┐  │
│  │ Transport UI      │  │         │  │ Content Scripts   │  │
│  │ (play/pause/etc)  │  │         │  │ (injected code)   │  │
│  └───────────────────┘  │         │  └───────────────────┘  │
└─────────────────────────┘         └─────────────────────────┘
```

### Why WebSocket

- No additional native host installation for users
- Bidirectional real-time communication
- Desktop app already runs Express server for OAuth - easy to add WebSocket
- Extension just connects to `ws://localhost:9876`

## Message Protocol

### Desktop → Extension (Commands)

```json
{ "type": "command", "action": "play" }
{ "type": "command", "action": "pause" }
{ "type": "command", "action": "stop" }
{ "type": "command", "action": "closeTab", "tabId": 123 }
{ "type": "command", "action": "injectCode", "code": { "browserPlay": "...", "browserPause": "...", ... } }
```

### Extension → Desktop (Events)

```json
{ "type": "event", "event": "connected", "site": "youtube", "url": "...", "tabId": 123 }
{ "type": "event", "event": "playing", "site": "youtube" }
{ "type": "event", "event": "paused", "site": "youtube" }
{ "type": "event", "event": "ended", "site": "youtube", "tabId": 123 }
{ "type": "event", "event": "tabClosed", "tabId": 123 }
{ "type": "event", "event": "disconnected" }
```

## Resolver-Defined Browser Control

Site-specific playback control logic lives in the resolver `.axe` file, not hardcoded in the extension. This allows adding new sites without updating the extension.

### New Resolver Capability

```json
{
  "manifest": { "id": "youtube", ... },
  "capabilities": {
    "resolve": true,
    "search": true,
    "browserControl": true
  },
  "urlPatterns": ["youtube.com/watch*", "youtu.be/*"],
  "implementation": {
    "search": "async function(query, config) { ... }",
    "play": "async function(track, config) { ... }",

    "browserPlay": "function() { document.querySelector('video')?.play(); }",
    "browserPause": "function() { document.querySelector('video')?.pause(); }",
    "browserGetState": "function() { const v = document.querySelector('video'); return v ? (v.paused ? 'paused' : 'playing') : null; }",
    "browserOnEnded": "function(callback) { document.querySelector('video')?.addEventListener('ended', callback); }"
  }
}
```

### Extension Behavior

1. Extension connects to Parachord
2. When user navigates to a supported URL, extension sends `connected` event
3. Parachord responds with `injectCode` command containing resolver's browser control functions
4. Extension injects code and sets up event listeners
5. Extension executes injected functions when receiving commands

## Tab Management

### One Active Tab

- Extension tracks one "now playing" tab at a time
- Previous tab is closed when next track opens
- Prevents accumulation of finished track tabs

### Flow

```
Track 1 (YouTube) ends
    ↓
Extension sends: { type: "event", event: "ended", tabId: 123 }
    ↓
Parachord stores pendingCloseTabId = 123
    ↓
Parachord calls handleNext() → opens Track 2
    ↓
shell.openExternal(track2Url) opens new tab
    ↓
Extension detects new tab connected
    ↓
Extension sends: { type: "event", event: "connected", tabId: 456, ... }
    ↓
Parachord sends: { type: "command", action: "closeTab", tabId: 123 }
    ↓
Extension closes old tab
```

### User Closes Tab

If user manually closes the browser tab, treat it as "skip to next":

```
User closes browser tab
    ↓
Extension sends: { type: "event", event: "tabClosed", tabId: 123 }
    ↓
Parachord calls handleNext()
```

### Edge Cases

- **Queue empty when track ends**: Tab stays open (user might want to browse)
- **Next track is different resolver** (YouTube → Spotify): Old browser tab still closed
- **User closes tab with empty queue**: Nothing happens, queue remains empty

## Extension Structure

```
parachord-extension/
├── manifest.json          # Chrome extension manifest v3
├── background.js          # Service worker - WebSocket connection
├── content.js             # Generic content script - executes injected code
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### background.js

- Maintains WebSocket connection to `ws://localhost:9876`
- Routes commands to content script in active tab
- Forwards events from content script to desktop
- Handles reconnection if desktop app restarts
- Tracks which tab is currently "active" for playback

### content.js

- Injected into pages matching resolver URL patterns
- Receives code to inject from background script
- Executes `browserPlay()`, `browserPause()`, etc.
- Sets up media event listeners (`ended`, `play`, `pause`)
- Reports state changes back to background script

## Desktop App Changes

### Main Process (main.js)

**New WebSocket server:**

```javascript
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 9876 });
let extensionSocket = null;

wss.on('connection', (ws) => {
  extensionSocket = ws;
  mainWindow?.webContents.send('extension-connected');

  ws.on('message', (data) => {
    const message = JSON.parse(data);
    mainWindow?.webContents.send('extension-event', message);
  });

  ws.on('close', () => {
    extensionSocket = null;
    mainWindow?.webContents.send('extension-disconnected');
  });
});
```

**New IPC handlers:**

```javascript
ipcMain.handle('extension-send-command', (event, command) => {
  if (extensionSocket) {
    extensionSocket.send(JSON.stringify(command));
    return true;
  }
  return false;
});

ipcMain.handle('extension-get-status', () => {
  return { connected: extensionSocket !== null };
});
```

### Preload (preload.js)

```javascript
extension: {
  sendCommand: (command) => ipcRenderer.invoke('extension-send-command', command),
  getStatus: () => ipcRenderer.invoke('extension-get-status'),
  onEvent: (callback) => ipcRenderer.on('extension-event', (_, data) => callback(data)),
  onConnected: (callback) => ipcRenderer.on('extension-connected', callback),
  onDisconnected: (callback) => ipcRenderer.on('extension-disconnected', callback),
}
```

### Renderer (app.js)

**New state:**

```javascript
const [extensionConnected, setExtensionConnected] = useState(false);
const [browserPlaybackState, setBrowserPlaybackState] = useState(null);
const [activeTabId, setActiveTabId] = useState(null);
const [pendingCloseTabId, setPendingCloseTabId] = useState(null);
```

**Extension event handling:**

```javascript
useEffect(() => {
  window.electron.extension.onConnected(() => setExtensionConnected(true));
  window.electron.extension.onDisconnected(() => setExtensionConnected(false));

  window.electron.extension.onEvent((event) => {
    switch (event.event) {
      case 'connected':
        setActiveTabId(event.tabId);
        // Send resolver's browser control code
        sendBrowserControlCode(event.site);
        // Close previous tab if pending
        if (pendingCloseTabId) {
          window.electron.extension.sendCommand({
            type: 'command',
            action: 'closeTab',
            tabId: pendingCloseTabId
          });
          setPendingCloseTabId(null);
        }
        break;
      case 'playing':
        setBrowserPlaybackState('playing');
        break;
      case 'paused':
        setBrowserPlaybackState('paused');
        break;
      case 'ended':
        setPendingCloseTabId(event.tabId);
        handleNext();
        break;
      case 'tabClosed':
        handleNext();
        break;
    }
  });
}, []);
```

**Transport control integration:**

```javascript
const handlePause = () => {
  if (extensionConnected && currentResolverHasBrowserControl()) {
    window.electron.extension.sendCommand({ type: 'command', action: 'pause' });
  } else {
    // Existing pause logic for Spotify, etc.
  }
};

const handlePlay = () => {
  if (extensionConnected && currentResolverHasBrowserControl()) {
    window.electron.extension.sendCommand({ type: 'command', action: 'play' });
  } else {
    // Existing play logic
  }
};
```

## Playback Flows

### Starting Playback

```
User clicks YouTube track in Parachord
    ↓
handlePlay() checks resolver → youtube has browserControl: true
    ↓
shell.openExternal(youtubeUrl) opens browser (unchanged)
    ↓
Extension content script detects youtube.com/watch page
    ↓
Extension sends: { type: "event", event: "connected", site: "youtube", url: "...", tabId: 123 }
    ↓
Parachord receives → sets extensionConnected: true, activeTabId: 123
    ↓
Parachord sends resolver's browserControl code to extension
    ↓
Extension injects code, sets up 'ended' listener
```

### Using Transport Controls

```
User clicks Pause in Parachord
    ↓
handlePause() sees extensionConnected && resolver has browserControl
    ↓
Sends: { type: "command", action: "pause" }
    ↓
Extension executes browserPause() on page
    ↓
Video pauses, extension sends: { type: "event", event: "paused" }
    ↓
Parachord updates browserPlaybackState to 'paused'
```

### Track Ends

```
Video finishes playing
    ↓
Extension's 'ended' listener fires
    ↓
Extension sends: { type: "event", event: "ended", tabId: 123 }
    ↓
Parachord sets pendingCloseTabId = 123
    ↓
Parachord calls handleNext()
    ↓
Next track opens → new tab connects → old tab closed
```

## Feature 2: Page Scraping (Tomahklet-style)

### Concept

Extract track metadata from the current page and send to Parachord as an XSPF playlist. Like the original Tomahklet, this lets users capture playlists from blogs, music sites, and streaming services.

### Supported Sites (Initial)

Scraping logic can be defined in resolver `.axe` files:

```json
{
  "manifest": { "id": "bandcamp", ... },
  "capabilities": {
    "resolve": true,
    "search": true,
    "browserScrape": true
  },
  "urlPatterns": ["*.bandcamp.com/*"],
  "implementation": {
    "browserScrape": "function() {
      const tracks = [];
      document.querySelectorAll('.track_row_view').forEach(row => {
        tracks.push({
          title: row.querySelector('.title').textContent.trim(),
          artist: document.querySelector('#name-section .artist a')?.textContent.trim(),
          album: document.querySelector('.trackTitle')?.textContent.trim(),
          duration: parseTime(row.querySelector('.time').textContent)
        });
      });
      return { tracks, title: document.title, creator: 'Bandcamp' };
    }"
  }
}
```

### Extension UI

**Popup with options:**
- "Send to Parachord" button (always visible)
- Track count if scrapeable: "Found 12 tracks on this page"
- Options: "Play Now" vs "Add to Queue" vs "Create Playlist"

### Message Protocol

**Extension → Desktop:**
```json
{
  "type": "scrape",
  "data": {
    "title": "Album Name",
    "creator": "Bandcamp",
    "tracks": [
      { "title": "Track 1", "artist": "Artist", "album": "Album", "duration": 234 },
      { "title": "Track 2", "artist": "Artist", "album": "Album", "duration": 198 }
    ]
  },
  "action": "play" | "queue" | "playlist"
}
```

**Desktop response:**
```json
{ "type": "scrape-result", "success": true, "trackCount": 12, "playlistId": "..." }
```

### Flow

```
User clicks extension icon on Bandcamp album page
    ↓
Extension popup shows: "Found 12 tracks - Send to Parachord?"
    ↓
User clicks "Play Now"
    ↓
Extension executes resolver's browserScrape() function
    ↓
Extension sends scrape data to Parachord via WebSocket
    ↓
Parachord receives, creates XSPF, loads into queue
    ↓
Parachord starts playing first track
    ↓
Extension shows confirmation: "Playing 12 tracks in Parachord"
```

### Scrapers by Site

**Bandcamp:**
- Album pages: All tracks with title, duration
- Artist pages: Discography list
- Collection pages: Purchased albums

**YouTube:**
- Playlist pages: All videos in playlist
- Channel pages: Recent uploads
- Single video: Title parsed for "Artist - Title"

**Last.fm:**
- User library: Loved tracks, recent scrobbles
- Artist pages: Top tracks
- Album pages: Full tracklist

**SoundCloud:**
- Playlists and sets
- User likes
- Artist tracks

**Generic (fallback):**
- Look for schema.org MusicRecording markup
- Parse `<meta>` tags for track info
- Look for common patterns (Artist - Title in page title)

---

## Feature 3: URL Resolution

### Concept

User can send any URL to Parachord for resolution. Extension provides a simple "Send to Parachord" action that works on any page.

### How It Works

1. User right-clicks on page or clicks extension icon
2. Selects "Send URL to Parachord"
3. Extension sends current URL to Parachord
4. Parachord uses `resolverLoader.lookupUrl()` to find matching resolver
5. Resolver extracts metadata (existing functionality)
6. Track is added to queue or played

### Message Protocol

**Extension → Desktop:**
```json
{ "type": "url", "url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "action": "play" | "queue" }
```

**Desktop → Extension (response):**
```json
{ "type": "url-result", "success": true, "track": { "title": "...", "artist": "..." } }
```
or
```json
{ "type": "url-result", "success": false, "error": "No resolver found for this URL" }
```

### Context Menu Integration

Extension adds context menu items:
- "Send to Parachord → Play Now"
- "Send to Parachord → Add to Queue"

Works on:
- Page background (sends current page URL)
- Links (sends link URL)
- YouTube video thumbnails, etc.

### Flow

```
User right-clicks on a Bandcamp link
    ↓
Selects "Send to Parachord → Play Now"
    ↓
Extension sends: { type: "url", url: "https://artist.bandcamp.com/track/song", action: "play" }
    ↓
Parachord receives, calls resolverLoader.lookupUrl(url)
    ↓
Bandcamp resolver extracts track metadata
    ↓
Parachord adds to queue and plays
    ↓
Extension shows notification: "Now playing: Song by Artist"
```

---

## Updated Extension Structure

```
parachord-extension/
├── manifest.json          # Chrome extension manifest v3
├── background.js          # Service worker - WebSocket, context menus
├── content.js             # Generic content script - playback control & scraping
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic - scrape preview, send actions
├── scrapers/              # Site-specific scraping logic (optional, can come from resolvers)
│   ├── bandcamp.js
│   ├── youtube.js
│   └── generic.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

### manifest.json Additions

```json
{
  "permissions": [
    "activeTab",
    "contextMenus",
    "storage"
  ],
  "action": {
    "default_popup": "popup.html",
    "default_icon": "icons/icon48.png"
  },
  "background": {
    "service_worker": "background.js"
  },
  "content_scripts": [{
    "matches": ["<all_urls>"],
    "js": ["content.js"]
  }]
}
```

---

## Updated Message Protocol Summary

### Extension → Desktop

| Type | Purpose | Example |
|------|---------|---------|
| `event` | Playback state changes | `{ type: "event", event: "ended", tabId: 123 }` |
| `scrape` | Send scraped tracks | `{ type: "scrape", data: {...}, action: "play" }` |
| `url` | Send URL for resolution | `{ type: "url", url: "...", action: "queue" }` |

### Desktop → Extension

| Type | Purpose | Example |
|------|---------|---------|
| `command` | Playback control | `{ type: "command", action: "pause" }` |
| `scrape-result` | Scrape confirmation | `{ type: "scrape-result", success: true }` |
| `url-result` | URL resolution result | `{ type: "url-result", success: true, track: {...} }` |

---

## Desktop App Changes (Additional)

### New IPC Handlers

```javascript
// Handle scraped content from extension
ipcMain.handle('extension-import-scrape', async (event, data) => {
  // Convert to XSPF format
  const xspf = generateXSPF(data.title, data.creator, data.tracks);
  // Import as playlist or add to queue based on action
  return { success: true, playlistId: '...' };
});

// Handle URL from extension
ipcMain.handle('extension-resolve-url', async (event, url, action) => {
  // Use resolver loader to look up URL
  const result = await resolverLoader.lookupUrl(url);
  if (result) {
    // Add to queue or play based on action
    return { success: true, track: result.track };
  }
  return { success: false, error: 'No resolver found' };
});
```

---

## Future Considerations

- **Seeking**: Add `browserSeek(position)` function to resolvers
- **Volume control**: Add `browserSetVolume(level)` function
- **Progress tracking**: Periodically report `currentTime` for progress bar
- **Multiple browser support**: Firefox extension (same WebSocket approach)
- **SoundCloud, Vimeo**: Just add resolvers with `browserControl` capability
- **Keyboard shortcut**: Global hotkey to send current tab URL to Parachord
- **Badge indicator**: Show track count on extension icon when scrapeable page detected
- **Offline queue**: Store URLs/scrapes locally if Parachord not running, sync when connected
