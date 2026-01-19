# Browser Extension for Parachord

## Overview

A browser extension that extends Parachord's capabilities in three ways:

1. **Playback Control** - Remote control of YouTube/Bandcamp playback from Parachord's transport controls
2. **Page Scraping** - Extract track metadata from music sites (like Tomahklet) and send to Parachord
3. **URL Resolution** - Send any URL to Parachord for resolver lookup

## Problems Solved

### Playback Control
Currently when Parachord plays a YouTube or Bandcamp track:
1. It opens the URL in the default browser via `shell.openExternal()`
2. Parachord loses all control - can't pause, can't detect when track ends
3. Transport controls in Parachord don't work for browser-based playback
4. Queue can't auto-advance because Parachord doesn't know when track finishes

### Page Scraping
Users browsing music sites (Pitchfork, album reviews, etc.) can't easily add tracks to Parachord without manually searching.

### URL Resolution
Users can't send a URL they're viewing directly to Parachord for playback.

## Solution

A browser extension that:
- Connects to Parachord via WebSocket
- Receives play/pause commands and executes them on the page
- Reports playback state (playing, paused, ended) back to Parachord
- Enables Parachord's transport controls to work with browser playback
- Scrapes track metadata from supported sites and sends as XSPF
- Sends URLs to Parachord for resolver lookup

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

// Page scraping - extension scraped tracks from current page
{ "type": "scrape", "tracks": [{ "artist": "...", "track": "...", "album": "..." }], "source": "pitchfork.com" }

// URL resolution - user wants to play current page URL
{ "type": "resolveUrl", "url": "https://..." }
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
├── content.js             # Content script - executes injected code, runs scrapers
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic (scrape button, send URL button)
├── scrapers/
│   ├── index.js           # Scraper registry and URL matcher
│   ├── pitchfork.js       # Pitchfork album reviews
│   ├── bandcamp.js        # Bandcamp pages
│   ├── soundcloud.js      # SoundCloud pages
│   └── generic.js         # Fallback: LD+JSON, Open Graph, etc.
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
- Runs scrapers when requested by popup

### popup.js

- Shows extension popup when user clicks icon
- "Scrape Page" button - runs matching scraper, sends tracks to Parachord
- "Send URL" button - sends current page URL to Parachord for resolution
- Shows connection status (connected/disconnected to Parachord)
- Shows scrape results preview before sending

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

## Page Scraping (Tomahklet-style)

The extension includes built-in scrapers for extracting track metadata from music sites. This logic lives in the extension itself, not in resolvers, because:

- Scrapers run in browser context and need DOM access
- Resolvers are designed for server-side operations (search, resolve URLs)
- Extension can be updated independently of Parachord
- Cleaner separation of concerns

### Extension Structure with Scrapers

```
parachord-extension/
├── manifest.json
├── background.js
├── content.js
├── scrapers/
│   ├── index.js           # Scraper registry and matcher
│   ├── pitchfork.js       # Pitchfork album reviews
│   ├── bandcamp.js        # Bandcamp pages
│   ├── soundcloud.js      # SoundCloud pages
│   └── generic.js         # Fallback: LD+JSON, Open Graph, etc.
└── icons/
```

### Scraper Interface

Each scraper exports:

```javascript
// scrapers/pitchfork.js
export default {
  // URL patterns this scraper handles
  patterns: ['pitchfork.com/reviews/albums/*'],

  // Extract tracks from the page
  scrape: () => {
    const artist = document.querySelector('.artist-name')?.textContent;
    const album = document.querySelector('.album-title')?.textContent;
    const tracks = Array.from(document.querySelectorAll('.track-list li'))
      .map(li => ({
        artist,
        album,
        track: li.textContent.trim()
      }));
    return tracks;
  }
};
```

### Generic Fallback Scraper

For sites without specific scrapers, try common metadata formats:

```javascript
// scrapers/generic.js
export default {
  patterns: ['*'], // Fallback for any site

  scrape: () => {
    // Try LD+JSON (schema.org)
    const ldJson = document.querySelector('script[type="application/ld+json"]');
    if (ldJson) {
      const data = JSON.parse(ldJson.textContent);
      if (data['@type'] === 'MusicAlbum' || data['@type'] === 'MusicRecording') {
        return extractFromLdJson(data);
      }
    }

    // Try Open Graph tags
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content;
    const ogType = document.querySelector('meta[property="og:type"]')?.content;
    if (ogType === 'music.song' || ogType === 'music.album') {
      return extractFromOpenGraph();
    }

    // Try common CSS patterns
    return extractFromCommonPatterns();
  }
};
```

### User Flow

```
User browses to Pitchfork album review
    ↓
Extension detects pitchfork.com/reviews/albums/*
    ↓
Extension shows badge: "5 tracks found"
    ↓
User clicks extension icon or badge
    ↓
Extension runs pitchfork scraper
    ↓
Extension sends: { type: "scrape", tracks: [...], source: "pitchfork.com" }
    ↓
Parachord receives tracks, creates XSPF playlist
    ↓
Parachord shows: "Added 5 tracks from Pitchfork"
```

### Desktop Handling

```javascript
// In extension event handler
case 'scrape':
  const xspf = createXspfFromTracks(event.tracks, event.source);
  importPlaylist(xspf);
  break;
```

## URL Resolution

User can send any URL to Parachord for resolver lookup.

### User Flow

```
User is on youtube.com/watch?v=xyz or bandcamp.com/track/xyz
    ↓
User clicks "Send to Parachord" button in extension
    ↓
Extension sends: { type: "resolveUrl", url: "https://..." }
    ↓
Parachord receives URL
    ↓
Parachord finds resolver that matches URL pattern (YouTube, Bandcamp, etc.)
    ↓
Resolver extracts track info from URL
    ↓
Parachord plays or queues the track
```

### Resolver URL Matching

Resolvers define URL patterns they can handle:

```json
{
  "manifest": { "id": "youtube" },
  "urlPatterns": ["youtube.com/watch*", "youtu.be/*"],
  "capabilities": { "resolve": true, "resolveUrl": true }
}
```

### Desktop Handling

```javascript
// In extension event handler
case 'resolveUrl':
  const resolver = findResolverForUrl(event.url);
  if (resolver) {
    const track = await resolver.resolveUrl(event.url);
    playTrack(track);
  } else {
    showNotification("No resolver found for this URL");
  }
  break;
```

## Future Considerations

- **Seeking**: Add `browserSeek(position)` function to resolvers
- **Volume control**: Add `browserSetVolume(level)` function
- **Progress tracking**: Periodically report `currentTime` for progress bar
- **Multiple browser support**: Firefox extension (same WebSocket approach)
- **SoundCloud, Vimeo**: Just add resolvers with `browserControl` capability
- **More scrapers**: Add scrapers for more music sites (AllMusic, Discogs, RateYourMusic, etc.)
