# MCP Server Integration Design

## Overview

A Model Context Protocol (MCP) server that exposes Parachord's playback state and controls to external AI assistants like Claude Desktop. This enables natural language music control, contextual queries about your library/listening history, and AI-assisted music discovery that goes beyond the existing prompt-based playlist generation.

**Key Difference from Existing AI Plugins:**

| Aspect | ChatGPT/Gemini Plugins | MCP Server |
|--------|------------------------|------------|
| Direction | One-way (prompt → tracks) | Bidirectional (read + write) |
| Context | Only what user types | Full access to app state |
| Control | None — generates lists only | Can control playback |
| Location | Inside Parachord UI | From any MCP client |
| Initiation | Click ✨, type prompt | Conversational, ambient |

## Problems Solved

### 1. No External AI Access
Currently, AI assistants like Claude Desktop cannot interact with Parachord at all. Users must manually copy/paste information or use the in-app AI prompt.

### 2. Limited Context for AI
The existing AI plugins only receive what the user types plus optional listening history. They can't see:
- What's currently playing
- The current queue
- User's playlists
- Real-time playback state

### 3. No Voice/Conversational Control
Users can't control Parachord through natural language from external interfaces. Commands like "skip this" or "play something similar" require manual UI interaction.

## User Flows

### Flow 1: Conversational Playback Control

```
User (in Claude Desktop): "What's playing in Parachord right now?"
    ↓
Claude reads parachord://now-playing resource
    ↓
Claude: "You're listening to 'Vampire Empire' by Big Thief"
    ↓
User: "Nice, queue up more songs like this"
    ↓
Claude uses search tool + queue_add tool
    ↓
Claude: "I've added 5 similar indie folk tracks to your queue"
```

### Flow 2: Library Queries

```
User: "What have I been listening to most this week?"
    ↓
Claude reads parachord://history resource
    ↓
Claude: "Your top artists this week are Big Thief, MJ Lenderman,
         and Waxahatchee. You've played 'Rudolph' 8 times!"
```

### Flow 3: Hands-Free Control

```
User: "Pause the music"
    ↓
Claude calls control("pause") tool
    ↓
Claude: "Paused."
    ↓
User: "Skip to the next track"
    ↓
Claude calls control("skip") tool
    ↓
Claude: "Now playing 'Manning Fireworks' by MJ Lenderman"
```

### Flow 4: Smart Playlist Creation

```
User: "Create a playlist from my queue and save it"
    ↓
Claude reads parachord://queue resource
    ↓
Claude calls create_playlist tool with queue tracks
    ↓
Claude: "Created playlist 'Queue Snapshot - Feb 3' with 12 tracks"
```

## Architecture

### Option A: Standalone MCP Server (Recommended)

```
┌─────────────────┐         ┌─────────────────┐         ┌─────────────────┐
│  Claude Desktop │────────▶│  MCP Server     │────────▶│  Parachord      │
│  (MCP Client)   │  stdio  │  (Node process) │   WS    │  (Electron)     │
└─────────────────┘         └─────────────────┘         └─────────────────┘
                                    │
                                    │ Launched by Claude Desktop
                                    │ via claude_desktop_config.json
                                    │
                            ┌───────┴───────┐
                            │ Resources     │
                            │ - now-playing │
                            │ - queue       │
                            │ - history     │
                            │ - playlists   │
                            │ - library     │
                            ├───────────────┤
                            │ Tools         │
                            │ - play        │
                            │ - control     │
                            │ - search      │
                            │ - queue_add   │
                            │ - create_playlist │
                            └───────────────┘
```

**Why Standalone:**
- Claude Desktop launches the MCP server via stdio
- MCP server connects to Parachord via WebSocket (existing infra)
- Parachord doesn't need modification to its startup
- Clean separation: MCP server is optional, doesn't bloat main app
- Can be developed/tested independently

### Communication Flow

```
Claude Desktop                MCP Server                    Parachord
     │                            │                             │
     │──── MCP Request ──────────▶│                             │
     │     (read now-playing)     │                             │
     │                            │──── WS: getNowPlaying ─────▶│
     │                            │                             │
     │                            │◀─── WS: {artist, title} ────│
     │◀─── MCP Response ──────────│                             │
     │     (resource content)     │                             │
     │                            │                             │
     │──── MCP Tool Call ────────▶│                             │
     │     (control: pause)       │                             │
     │                            │──── WS: control(pause) ────▶│
     │                            │                             │
     │                            │◀─── WS: {success: true} ────│
     │◀─── MCP Tool Result ───────│                             │
     │                            │                             │
```

## MCP Resources

Resources are read-only data that AI assistants can query.

### `parachord://now-playing`

Current track information.

```json
{
  "track": {
    "title": "Vampire Empire",
    "artist": "Big Thief",
    "album": "Dragon New Warm Mountain I Believe in You",
    "duration": 245,
    "source": "spotify"
  },
  "playback": {
    "state": "playing",
    "position": 67,
    "volume": 0.8
  }
}
```

Returns `null` if nothing is playing.

### `parachord://queue`

Current playback queue.

```json
{
  "currentIndex": 2,
  "tracks": [
    { "title": "Simulation Swarm", "artist": "Big Thief", "resolved": true },
    { "title": "Sparrow", "artist": "Big Thief", "resolved": true },
    { "title": "Vampire Empire", "artist": "Big Thief", "resolved": true },
    { "title": "Rudolph", "artist": "MJ Lenderman", "resolved": false },
    { "title": "Manning Fireworks", "artist": "MJ Lenderman", "resolved": false }
  ],
  "shuffle": false,
  "repeat": "off"
}
```

### `parachord://history`

Recent listening history (last 7 days).

```json
{
  "period": "7d",
  "totalPlays": 147,
  "topArtists": [
    { "name": "Big Thief", "plays": 34 },
    { "name": "MJ Lenderman", "plays": 28 },
    { "name": "Waxahatchee", "plays": 19 }
  ],
  "topTracks": [
    { "title": "Rudolph", "artist": "MJ Lenderman", "plays": 8 },
    { "title": "Vampire Empire", "artist": "Big Thief", "plays": 6 }
  ],
  "recentTracks": [
    { "title": "Vampire Empire", "artist": "Big Thief", "playedAt": "2026-02-03T14:23:00Z" },
    { "title": "Rudolph", "artist": "MJ Lenderman", "playedAt": "2026-02-03T14:19:00Z" }
  ]
}
```

### `parachord://playlists`

User's playlists.

```json
{
  "playlists": [
    {
      "id": "abc123",
      "name": "Morning Coffee",
      "trackCount": 24,
      "createdAt": "2026-01-15T10:00:00Z"
    },
    {
      "id": "def456",
      "name": "Workout Mix",
      "trackCount": 42,
      "createdAt": "2026-01-20T16:30:00Z"
    }
  ]
}
```

### `parachord://playlists/{id}`

Specific playlist details (dynamic resource).

```json
{
  "id": "abc123",
  "name": "Morning Coffee",
  "tracks": [
    { "title": "Simulation Swarm", "artist": "Big Thief" },
    { "title": "Right Back to It", "artist": "Waxahatchee" }
  ]
}
```

### `parachord://library/stats`

Local library statistics.

```json
{
  "tracks": 4521,
  "artists": 312,
  "albums": 489,
  "totalDuration": 982800,
  "watchFolders": ["/Users/me/Music", "/Volumes/External/Music"]
}
```

## MCP Tools

Tools are actions that AI assistants can execute.

### `play`

Play a specific track by searching for it.

**Parameters:**
```json
{
  "artist": { "type": "string", "description": "Artist name", "required": true },
  "title": { "type": "string", "description": "Track title", "required": true },
  "album": { "type": "string", "description": "Album name (optional)", "required": false }
}
```

**Behavior:**
1. Search across all enabled resolvers
2. Auto-resolve best match
3. Start playback immediately
4. Return success/failure

**Response:**
```json
{
  "success": true,
  "track": { "title": "Vampire Empire", "artist": "Big Thief", "source": "spotify" }
}
```

### `control`

Control playback state.

**Parameters:**
```json
{
  "action": {
    "type": "string",
    "enum": ["pause", "resume", "skip", "previous", "stop"],
    "required": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "newState": "paused"
}
```

### `seek`

Seek to a position in the current track.

**Parameters:**
```json
{
  "position": { "type": "number", "description": "Position in seconds", "required": true }
}
```

### `volume`

Set playback volume.

**Parameters:**
```json
{
  "level": { "type": "number", "description": "Volume level 0.0-1.0", "required": true }
}
```

### `search`

Search for tracks across all sources.

**Parameters:**
```json
{
  "query": { "type": "string", "description": "Search query", "required": true },
  "limit": { "type": "number", "description": "Max results (default 10)", "required": false }
}
```

**Response:**
```json
{
  "results": [
    { "title": "Vampire Empire", "artist": "Big Thief", "album": "...", "source": "spotify" },
    { "title": "Vampire Empire (Live)", "artist": "Big Thief", "source": "youtube" }
  ]
}
```

### `queue_add`

Add tracks to the queue.

**Parameters:**
```json
{
  "tracks": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "artist": { "type": "string" },
        "title": { "type": "string" }
      }
    },
    "required": true
  },
  "position": {
    "type": "string",
    "enum": ["next", "last"],
    "description": "Add after current track or at end (default: last)",
    "required": false
  }
}
```

**Response:**
```json
{
  "success": true,
  "added": 5,
  "queueLength": 12
}
```

### `queue_clear`

Clear the queue.

**Response:**
```json
{
  "success": true,
  "removed": 10
}
```

### `create_playlist`

Create a new playlist.

**Parameters:**
```json
{
  "name": { "type": "string", "description": "Playlist name", "required": true },
  "tracks": {
    "type": "array",
    "items": {
      "type": "object",
      "properties": {
        "artist": { "type": "string" },
        "title": { "type": "string" }
      }
    },
    "required": true
  }
}
```

**Response:**
```json
{
  "success": true,
  "playlist": {
    "id": "xyz789",
    "name": "AI Generated Mix",
    "trackCount": 15
  }
}
```

### `shuffle`

Toggle or set shuffle mode.

**Parameters:**
```json
{
  "enabled": { "type": "boolean", "description": "Enable/disable shuffle", "required": false }
}
```

If `enabled` is omitted, toggles current state.

## WebSocket Protocol Extension

Extends the existing WebSocket server (port 21863) used by the browser extension.

### New Message Types

**Request Format:**
```json
{
  "id": "req-123",
  "type": "mcp",
  "action": "getNowPlaying" | "getQueue" | "getHistory" | "getPlaylists" | "control" | "search" | ...,
  "params": { ... }
}
```

**Response Format:**
```json
{
  "id": "req-123",
  "type": "mcp-response",
  "success": true,
  "data": { ... }
}
```

**Error Format:**
```json
{
  "id": "req-123",
  "type": "mcp-response",
  "success": false,
  "error": { "code": "NOT_PLAYING", "message": "No track is currently playing" }
}
```

### MCP Actions

| Action | Description | Params |
|--------|-------------|--------|
| `getNowPlaying` | Get current track + playback state | — |
| `getQueue` | Get queue tracks | — |
| `getHistory` | Get listening history | `{ period: "7d" }` |
| `getPlaylists` | List all playlists | — |
| `getPlaylist` | Get specific playlist | `{ id: "abc123" }` |
| `getLibraryStats` | Get local library stats | — |
| `play` | Play a track | `{ artist, title, album? }` |
| `control` | Playback control | `{ action: "pause" \| "resume" \| ... }` |
| `seek` | Seek position | `{ position: 120 }` |
| `volume` | Set volume | `{ level: 0.8 }` |
| `search` | Search tracks | `{ query, limit? }` |
| `queueAdd` | Add to queue | `{ tracks: [...], position? }` |
| `queueClear` | Clear queue | — |
| `createPlaylist` | Create playlist | `{ name, tracks: [...] }` |
| `shuffle` | Toggle shuffle | `{ enabled?: boolean }` |

## File Structure

```
parachord/
├── mcp-server/
│   ├── package.json           # MCP server dependencies
│   ├── index.js               # Main MCP server entry point
│   ├── resources/
│   │   ├── now-playing.js     # Now playing resource handler
│   │   ├── queue.js           # Queue resource handler
│   │   ├── history.js         # History resource handler
│   │   ├── playlists.js       # Playlists resource handler
│   │   └── library.js         # Library stats resource handler
│   ├── tools/
│   │   ├── playback.js        # play, control, seek, volume tools
│   │   ├── queue.js           # queue_add, queue_clear tools
│   │   ├── search.js          # search tool
│   │   └── playlists.js       # create_playlist tool
│   └── parachord-client.js    # WebSocket client to connect to Parachord
├── main.js                    # Add MCP message handlers to existing WS server
├── app.js                     # Add IPC handlers for MCP actions
└── preload.js                 # Expose MCP IPC to renderer
```

## Implementation

### Phase 1: WebSocket Protocol Extension

Extend existing WebSocket server in `main.js` to handle MCP messages.

```javascript
// main.js - In WebSocket message handler
ws.on('message', (data) => {
  const message = JSON.parse(data);

  // Existing extension handling
  if (message.type === 'extension') {
    // ... existing code
  }

  // New MCP handling
  if (message.type === 'mcp') {
    handleMcpMessage(ws, message);
  }
});

async function handleMcpMessage(ws, message) {
  const { id, action, params } = message;

  try {
    let data;

    switch (action) {
      case 'getNowPlaying':
        data = await getNowPlayingFromRenderer();
        break;
      case 'getQueue':
        data = await getQueueFromRenderer();
        break;
      case 'control':
        data = await sendControlToRenderer(params.action);
        break;
      // ... etc
    }

    ws.send(JSON.stringify({
      id,
      type: 'mcp-response',
      success: true,
      data
    }));
  } catch (error) {
    ws.send(JSON.stringify({
      id,
      type: 'mcp-response',
      success: false,
      error: { code: error.code || 'UNKNOWN', message: error.message }
    }));
  }
}
```

### Phase 2: Renderer IPC Handlers

Add IPC handlers in `app.js` to expose state to main process.

```javascript
// app.js - Register IPC handlers for MCP
useEffect(() => {
  window.electron.ipcRenderer.on('mcp-get-now-playing', (event, requestId) => {
    const data = currentTrack ? {
      track: {
        title: currentTrack.title,
        artist: currentTrack.artist,
        album: currentTrack.album,
        duration: currentTrack.duration,
        source: currentTrack.source
      },
      playback: {
        state: isPlaying ? 'playing' : 'paused',
        position: currentPosition,
        volume: volume
      }
    } : null;

    window.electron.ipcRenderer.send('mcp-response', { requestId, data });
  });

  window.electron.ipcRenderer.on('mcp-control', (event, requestId, action) => {
    switch (action) {
      case 'pause': handlePause(); break;
      case 'resume': handlePlay(); break;
      case 'skip': handleNext(); break;
      case 'previous': handlePrevious(); break;
    }
    window.electron.ipcRenderer.send('mcp-response', { requestId, data: { success: true } });
  });

  // ... more handlers
}, [currentTrack, isPlaying, ...]);
```

### Phase 3: MCP Server

Create standalone MCP server that connects via WebSocket.

```javascript
// mcp-server/index.js
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ParachordClient } from "./parachord-client.js";

const server = new McpServer({
  name: "parachord",
  version: "1.0.0",
});

const parachord = new ParachordClient("ws://localhost:21863");

// Resources
server.resource("now-playing", "parachord://now-playing", async () => {
  const data = await parachord.send({ type: "mcp", action: "getNowPlaying" });
  return {
    contents: [{
      uri: "parachord://now-playing",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2)
    }]
  };
});

server.resource("queue", "parachord://queue", async () => {
  const data = await parachord.send({ type: "mcp", action: "getQueue" });
  return {
    contents: [{
      uri: "parachord://queue",
      mimeType: "application/json",
      text: JSON.stringify(data, null, 2)
    }]
  };
});

// Tools
server.tool(
  "play",
  "Play a track by artist and title",
  {
    artist: { type: "string", description: "Artist name" },
    title: { type: "string", description: "Track title" }
  },
  async ({ artist, title }) => {
    const result = await parachord.send({
      type: "mcp",
      action: "play",
      params: { artist, title }
    });
    return {
      content: [{
        type: "text",
        text: result.success
          ? `Now playing: ${title} by ${artist}`
          : `Failed to play: ${result.error.message}`
      }]
    };
  }
);

server.tool(
  "control",
  "Control playback (pause, resume, skip, previous)",
  {
    action: {
      type: "string",
      enum: ["pause", "resume", "skip", "previous", "stop"],
      description: "Playback action"
    }
  },
  async ({ action }) => {
    const result = await parachord.send({
      type: "mcp",
      action: "control",
      params: { action }
    });
    return {
      content: [{ type: "text", text: `Executed: ${action}` }]
    };
  }
);

// ... more tools

// Start server
await parachord.connect();
const transport = new StdioServerTransport();
await server.connect(transport);
```

### Phase 4: Claude Desktop Configuration

User adds to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "parachord": {
      "command": "node",
      "args": ["/Applications/Parachord.app/Contents/Resources/mcp-server/index.js"]
    }
  }
}
```

Or if installed via npm:

```json
{
  "mcpServers": {
    "parachord": {
      "command": "npx",
      "args": ["@parachord/mcp-server"]
    }
  }
}
```

## Error Handling

### Connection Errors

| Error | Code | Message |
|-------|------|---------|
| Parachord not running | `NOT_CONNECTED` | "Parachord is not running. Please start the app." |
| WebSocket timeout | `TIMEOUT` | "Connection to Parachord timed out." |
| WebSocket closed | `DISCONNECTED` | "Lost connection to Parachord." |

### Action Errors

| Error | Code | Message |
|-------|------|---------|
| Nothing playing | `NOT_PLAYING` | "No track is currently playing." |
| Track not found | `NOT_FOUND` | "Could not find '{title}' by {artist}." |
| Queue empty | `QUEUE_EMPTY` | "The queue is empty." |
| Invalid action | `INVALID_ACTION` | "Unknown action: {action}" |

### MCP Server Startup

If Parachord isn't running when the MCP server starts:
1. Log warning to stderr (visible in Claude Desktop logs)
2. Retry connection every 5 seconds
3. Return helpful error messages for requests until connected

## Security Considerations

### Local-Only Access

- WebSocket server only binds to `localhost`
- No authentication needed for local connections
- MCP server runs locally, spawned by Claude Desktop

### Scope of Control

MCP can:
- Read playback state, queue, playlists, history
- Control playback (play, pause, skip, volume)
- Search and queue tracks
- Create playlists

MCP cannot:
- Access API keys or credentials
- Modify resolver settings
- Access files outside the app's scope
- Delete playlists (V1 - could add later with confirmation)

## Testing

### Manual Testing

1. Start Parachord
2. Start MCP server: `node mcp-server/index.js`
3. Use MCP Inspector or Claude Desktop to test

### Automated Testing

```javascript
// tests/mcp-server.test.js
describe('MCP Server', () => {
  test('getNowPlaying returns current track', async () => {
    // Mock WebSocket connection
    // Send getNowPlaying
    // Verify response shape
  });

  test('control(pause) pauses playback', async () => {
    // ...
  });

  test('search returns results from multiple sources', async () => {
    // ...
  });
});
```

## Future Enhancements (V2+)

### Additional Resources

- `parachord://friends` - Friend activity (from Last.fm/ListenBrainz)
- `parachord://recommendations` - AI-generated recommendations based on listening
- `parachord://artist/{name}` - Artist info and discography

### Additional Tools

- `add_to_playlist` - Add tracks to existing playlist
- `delete_playlist` - Delete a playlist (with confirmation)
- `import_playlist` - Import from URL (Spotify, Apple Music, etc.)
- `scrobble` - Manual scrobble a track
- `like` / `dislike` - Feedback for recommendations

### Event Subscriptions

MCP 2.0 may support server-sent events. This would enable:
- Real-time now-playing updates
- Queue change notifications
- Track end notifications

### Voice Integration

The MCP server could be extended for voice assistants:
- Siri Shortcuts integration on macOS
- Voice-activated commands via system accessibility

### Multi-Instance Support

For users running multiple Parachord instances:
- Dynamic port selection
- Instance discovery
- Named instances in MCP config

## Dependencies

### MCP Server

```json
{
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "ws": "^8.14.2"
  }
}
```

### Parachord (main.js)

No new dependencies - uses existing `ws` package.

## Rollout Plan

1. **Phase 1**: WebSocket protocol extension (main.js, app.js)
2. **Phase 2**: Basic MCP server with now-playing + control
3. **Phase 3**: Full resource set (queue, history, playlists)
4. **Phase 4**: Full tool set (search, queue management, playlist creation)
5. **Phase 5**: Documentation + Claude Desktop config instructions
6. **Phase 6**: npm package for easy installation
