# Parachord Protocol URL Schema

Parachord supports deep linking via the `parachord://` URL scheme, enabling external apps to control playback, navigate the app, and interact with the AI DJ.

## Access Methods

There are two ways to send protocol commands to Parachord:

### 1. Protocol URLs (Production)

Use `parachord://` URLs directly. Works with built/installed app:
```bash
open "parachord://control/pause"
```

### 2. HTTP Endpoint (Development & Scripting)

Send protocol URLs via HTTP to `localhost:8888/protocol`. Works reliably in all environments:
```bash
curl "http://127.0.0.1:8888/protocol?url=parachord://control/pause"
```

The HTTP endpoint is recommended for:
- Development environments
- Scripts and automation
- Raycast/Alfred extensions
- Any programmatic access

## Quick Reference

| Category | Example URL |
|----------|-------------|
| Play track | `parachord://play?artist=Radiohead&title=Karma%20Police` |
| Pause | `parachord://control/pause` |
| Add to queue | `parachord://queue/add?artist=Radiohead&title=Paranoid%20Android` |
| Open artist | `parachord://artist/Radiohead` |
| Search | `parachord://search?q=shoegaze` |
| AI chat | `parachord://chat` |
| Import playlist | `parachord://import?url=https://example.com/playlist.xspf` |

---

## Playback Control

### Play Track

Play a specific track by searching and starting playback.

```
parachord://play?artist={artist}&title={title}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `artist` | Yes | Artist name |
| `title` | Yes | Track title |

**Example:**
```
parachord://play?artist=Big%20Thief&title=Vampire%20Empire
```

### Playback Control

Control the current playback state.

```
parachord://control/{action}
```

| Action | Description |
|--------|-------------|
| `pause` | Pause playback |
| `resume` | Resume playback |
| `play` | Resume playback (alias for resume) |
| `skip` | Skip to next track |
| `next` | Skip to next track (alias) |
| `previous` | Go to previous track |

**Examples:**
```
parachord://control/pause
parachord://control/resume
parachord://control/skip
parachord://control/previous
```

### Queue Management

Add tracks to the queue or clear it.

**Add to queue:**
```
parachord://queue/add?artist={artist}&title={title}&album={album}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `artist` | Yes | Artist name |
| `title` | Yes | Track title |
| `album` | No | Album name |

**Clear queue:**
```
parachord://queue/clear
```

**Examples:**
```
parachord://queue/add?artist=Radiohead&title=Paranoid%20Android
parachord://queue/add?artist=Bjork&title=Hyperballad&album=Post
parachord://queue/clear
```

### Shuffle

Toggle shuffle mode on or off.

```
parachord://shuffle/{on|off}
```

**Examples:**
```
parachord://shuffle/on
parachord://shuffle/off
```

### Volume

Set the playback volume (0-100).

```
parachord://volume/{level}
```

| Parameter | Description |
|-----------|-------------|
| `level` | Volume level from 0 to 100 |

**Examples:**
```
parachord://volume/75
parachord://volume/0
parachord://volume/100
```

---

## Navigation

### Home

Navigate to the home page.

```
parachord://home
```

### Artist Page

Open an artist's page.

```
parachord://artist/{name}/{tab?}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `name` | Yes | Artist name |
| `tab` | No | Tab to open: `music`, `biography`, `related` |

**Examples:**
```
parachord://artist/Radiohead
parachord://artist/Big%20Thief/biography
parachord://artist/Bjork/related
```

### Album Page

Open an album's page.

```
parachord://album/{artist}/{title}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `artist` | Yes | Artist name |
| `title` | Yes | Album title |

**Example:**
```
parachord://album/Big%20Thief/Dragon%20New%20Warm%20Mountain%20I%20Believe%20in%20You
```

### Library

Open the library/collection view.

```
parachord://library/{tab?}?sort={field}&order={asc|desc}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tab` | No | Tab: `tracks`, `albums`, `artists`, `friends` |
| `sort` | No | Sort field |
| `order` | No | Sort order: `asc` or `desc` |

**Examples:**
```
parachord://library
parachord://library/albums
parachord://library/artists
parachord://library/tracks?sort=recent&order=desc
```

### History

Open listening history.

```
parachord://history/{tab?}?period={range}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tab` | No | Tab: `top-tracks`, `top-albums`, `top-artists`, `recent` |
| `period` | No | Time range: `7day`, `1month`, `3month`, `6month`, `12month`, `overall` |

**Examples:**
```
parachord://history
parachord://history/top-tracks
parachord://history/top-artists?period=1month
parachord://history/recent?period=7day
```

### Friend History

View a friend's listening history.

```
parachord://friend/{id}/{tab?}?period={range}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Friend ID or username |
| `tab` | No | Tab: `recent`, `top-tracks`, `top-artists` |
| `period` | No | Time range: `7day`, `1month`, `3month`, `6month`, `12month`, `overall` |

**Examples:**
```
parachord://friend/john_doe
parachord://friend/john_doe/top-tracks
parachord://friend/jane123/top-artists?period=1month
```

### Recommendations

Open the recommendations page.

```
parachord://recommendations/{tab?}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tab` | No | Tab: `artists`, `songs` |

**Examples:**
```
parachord://recommendations
parachord://recommendations/artists
parachord://recommendations/songs
```

### Charts

Open the charts/discover page.

```
parachord://charts
```

### Critics Picks

Open the critics picks page.

```
parachord://critics-picks
```

### Playlists

Open the playlists list or a specific playlist.

**All playlists:**
```
parachord://playlists
```

**Specific playlist:**
```
parachord://playlist/{id}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Playlist ID or name |

**Examples:**
```
parachord://playlists
parachord://playlist/summer-vibes
parachord://playlist/abc123
```

### Import Playlist

Import a playlist into Parachord from an external source. Supports hosted XSPF URLs or inline track data. This is the primary mechanism used by the embeddable "Send to Parachord" button.

> **User confirmation required.** Because this command can be triggered by external sources, Parachord shows a confirmation dialog before fetching a remote URL or saving imported tracks. See [Security Considerations](#security-considerations).

**From hosted XSPF URL:**
```
parachord://import?url={xspf_url}
```

**From inline track data (base64-encoded JSON):**
```
parachord://import?title={title}&creator={creator}&tracks={base64_json}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes* | URL to a hosted XSPF playlist file (HTTP/HTTPS only) |
| `title` | No | Playlist title (used with `tracks`) |
| `creator` | No | Playlist creator/source name (used with `tracks`) |
| `tracks` | Yes* | Base64-encoded JSON array of track objects (used without `url`). Max 100KB encoded, 500 tracks. |

\* Either `url` or `tracks` must be provided.

**Track object format (within the JSON array):**
```json
{ "title": "Track Name", "artist": "Artist Name", "album": "Album Name", "duration": 180 }
```
- `title` and `artist` are required; `album` and `duration` (seconds) are optional.

**Examples:**
```
parachord://import?url=https%3A%2F%2Fexample.com%2Fplaylist.xspf
parachord://import?title=Road%20Trip&creator=MyApp&tracks=W3sidGl0bGUiOiJLYXJtYSBQb2xpY2UiLCJhcnRpc3QiOiJSYWRpb2hlYWQifV0%3D
```

---

### Settings

Open the settings page.

```
parachord://settings/{tab?}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `tab` | No | Tab: `plugins`, `general`, `about` |

**Examples:**
```
parachord://settings
parachord://settings/plugins
parachord://settings/general
```

---

## Search

Perform a search query.

```
parachord://search?q={query}&source={source}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `q` | Yes | Search query |
| `source` | No | Filter by source (e.g., `spotify`, `youtube`) |

The query supports boolean operators:
- `artist:Name` - Search for artist
- `album:Title` - Search for album
- `track:Title` - Search for track
- `year:2024` - Filter by year

**Examples:**
```
parachord://search?q=big%20thief
parachord://search?q=artist:Radiohead
parachord://search?q=album:OK%20Computer
parachord://search?q=artist:Bjork%20track:Hyperballad
parachord://search?q=shoegaze&source=spotify
```

---

## AI Chat

Open the AI DJ chat panel, optionally with a pre-filled prompt.

> **User confirmation required.** When a `prompt` parameter is provided, Parachord shows a confirmation dialog displaying the message before sending it to the AI. This prevents external sources from silently injecting prompts. See [Security Considerations](#security-considerations).

```
parachord://chat?prompt={text}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | No | Text to send to the AI DJ (max 500 characters) |

**Examples:**
```
parachord://chat
parachord://chat?prompt=play%20something%20chill
parachord://chat?prompt=recommend%20albums%20like%20OK%20Computer
parachord://chat?prompt=what%20am%20I%20listening%20to
```

---

## Integration Examples

### macOS Shortcuts

Create a Shortcut that opens a URL:
1. Add "Open URLs" action
2. Enter: `parachord://control/pause`

### Raycast

Parachord includes a full Raycast extension in `raycast-extension/`. It uses the HTTP endpoint for reliable communication:

```typescript
// raycast-extension/src/utils.ts
const PARACHORD_HTTP_PORT = 8888;

export async function openParachord(
  command: string,
  segments: string[] = [],
  params: Record<string, string> = {},
  hudMessage?: string
): Promise<void> {
  const protocolUrl = buildProtocolUrl(command, segments, params);
  const httpUrl = `http://127.0.0.1:${PARACHORD_HTTP_PORT}/protocol?url=${encodeURIComponent(protocolUrl)}`;

  const response = await fetch(httpUrl);
  if (response.ok && hudMessage) {
    await showHUD(hudMessage);
  }
}

// Example command: raycast-extension/src/play-pause.ts
import { openParachord } from "./utils";

export default async function Command() {
  await openParachord("control", ["resume"], {}, "Toggled playback");
}
```

To install the Raycast extension:
```bash
cd raycast-extension
npm install
npm run dev
```

### Alfred Workflow

```bash
# Using HTTP endpoint (recommended)
curl "http://127.0.0.1:8888/protocol?url=parachord://play?artist={query}&title={query2}"

# Using protocol URL (requires built app)
open "parachord://play?artist={query}&title={query2}"
```

### Stream Deck

Configure a "System: Open" action or use the Multi Actions plugin with curl:
- Protocol URL: `parachord://control/skip`
- HTTP (more reliable): `curl "http://127.0.0.1:8888/protocol?url=parachord://control/skip"`

### Command Line

**Using HTTP endpoint (recommended):**
```bash
# Works on all platforms when Parachord is running
curl "http://127.0.0.1:8888/protocol?url=parachord://play?artist=Radiohead&title=Karma%20Police"

# Pause
curl "http://127.0.0.1:8888/protocol?url=parachord://control/pause"

# Skip
curl "http://127.0.0.1:8888/protocol?url=parachord://control/skip"
```

**Using protocol URLs (requires built app):**
```bash
# macOS
open "parachord://play?artist=Radiohead&title=Karma%20Police"

# Linux (with xdg-open)
xdg-open "parachord://play?artist=Radiohead&title=Karma%20Police"

# Windows
start parachord://play?artist=Radiohead&title=Karma%20Police
```

### Browser Extension

The browser extension can fall back to protocol URLs when WebSocket is unavailable:

```javascript
function sendToParachord(command) {
  if (wsConnected) {
    ws.send(JSON.stringify(command));
  } else {
    const url = buildProtocolUrl(command);
    window.location.href = url;
  }
}
```

### Embeddable "Send to Parachord" Button

For third-party websites that want to let users send playlists to Parachord. Include `parachord-button.js` and use either declarative HTML or the JavaScript API.

**Declarative (data attributes):**
```html
<script src="https://go.parachord.com/button.js"></script>

<!-- Inline tracks -->
<div class="parachord-button"
     data-title="Road Trip Mix"
     data-creator="MyWebsite"
     data-tracks='[{"title":"Karma Police","artist":"Radiohead"},{"title":"Hyperballad","artist":"Bjork"}]'>
</div>

<!-- Or from a hosted XSPF URL -->
<div class="parachord-button"
     data-xspf-url="https://example.com/playlist.xspf">
</div>
```

**Programmatic (JavaScript API):**
```javascript
// Send a playlist directly
Parachord.sendPlaylist({
  title: "Road Trip Mix",
  creator: "MyWebsite",
  tracks: [
    { title: "Karma Police", artist: "Radiohead", album: "OK Computer" },
    { title: "Hyperballad", artist: "Bjork", album: "Post" }
  ]
});

// Or send a hosted XSPF URL
Parachord.sendXspfUrl("https://example.com/playlist.xspf");

// Create a button element to insert anywhere
const btn = Parachord.createButton({
  title: "My Playlist",
  tracks: [{ title: "Song", artist: "Artist" }]
}, { label: "Open in Parachord" });
document.getElementById('my-container').appendChild(btn);

// Check if Parachord is running
if (Parachord.isConnected) {
  console.log("Parachord is running!");
}
```

The button automatically detects whether Parachord is running locally via WebSocket. If connected, playlists are sent directly. If not, it falls back to opening a `parachord://import` protocol URL which will launch the app.

---

## URL Encoding

All parameter values must be URL-encoded. Common encodings:

| Character | Encoded |
|-----------|---------|
| Space | `%20` |
| `&` | `%26` |
| `=` | `%3D` |
| `/` | `%2F` |
| `?` | `%3F` |
| `#` | `%23` |

**Example:**
- Artist: "Guns N' Roses" → `Guns%20N'%20Roses`
- Title: "Sweet Child O' Mine" → `Sweet%20Child%20O'%20Mine`

---

## HTTP API Reference

The HTTP endpoint provides programmatic access to protocol commands.

### Endpoint

```
GET http://127.0.0.1:8888/protocol?url={encoded_protocol_url}
```

### Parameters

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Yes | URL-encoded `parachord://` protocol URL |

### Response

**Success (200):**
```json
{
  "success": true,
  "url": "parachord://control/pause"
}
```

**Error (400 - Invalid URL):**
```json
{
  "error": "Invalid protocol URL"
}
```

**Error (503 - App not ready):**
```json
{
  "error": "Parachord not ready"
}
```

### Examples

```bash
# Pause playback
curl "http://127.0.0.1:8888/protocol?url=parachord%3A%2F%2Fcontrol%2Fpause"

# Play a track (URL encoding required for special characters)
curl "http://127.0.0.1:8888/protocol?url=$(python3 -c 'import urllib.parse; print(urllib.parse.quote("parachord://play?artist=Radiohead&title=Karma Police"))')"

# Open AI chat with prompt
curl "http://127.0.0.1:8888/protocol?url=parachord%3A%2F%2Fchat%3Fprompt%3Dplay%2520something%2520chill"
```

---

## Security Considerations

Protocol URLs can be triggered by **any application on the system** — a webpage, an email client, another app, etc. There is no way to verify who sent a `parachord://` URL, so every command is treated as untrusted input.

### Threat model

- **Prompt injection via `chat`:** A malicious link could auto-send instructions to the AI DJ. Mitigated by requiring user confirmation before any prompt is sent, and capping prompt length at 500 characters.
- **SSRF via `import`:** A crafted URL could make Parachord fetch an attacker-controlled or internal URL. Mitigated by validating the URL protocol (only HTTP/HTTPS allowed) and requiring user confirmation that shows the target hostname before fetching.
- **Data stuffing via `import`:** An oversized base64 payload could consume memory or disk. Mitigated by capping the encoded payload at 100KB and limiting imports to 500 tracks.
- **Silent side effects:** Commands like `play`, `queue/add`, `queue/clear`, `control/*`, `shuffle`, and `volume` execute without confirmation. These are considered low-risk since they only affect local playback state and are easily reversed.

### Input validation

All parameters extracted from protocol URLs are validated before use:

- **Navigation tabs** (`history`, `friend`, `library`, `settings`, `recommendations`): Only values from a known allowlist are accepted. Unknown values are silently ignored.
- **History periods**: Only accepted values are `7day`, `1month`, `3month`, `6month`, `12month`, `overall`.
- **Settings tabs**: Only accepted values are `general`, `plugins`, `about`.
- **Volume**: Must be an integer between 0 and 100.
- **Unknown commands**: Silently ignored — only the documented command set is handled.

### For integrators

If you are building an integration that constructs `parachord://` URLs from user input (e.g. a search box), always URL-encode parameter values to prevent injection of additional parameters. Use `encodeURIComponent()` in JavaScript or equivalent in your language.

---

## Error Handling

Invalid protocol URLs will show a toast notification with the error. Common errors:

- Unknown command
- Missing required parameters
- Track/playlist not found
- Friend not found

The app will log protocol URL handling to the console for debugging.
