# Parachord Protocol URL Schema

Parachord supports deep linking via the `parachord://` URL scheme, enabling external apps to control playback, navigate the app, and interact with the AI DJ.

## Quick Reference

| Category | Example URL |
|----------|-------------|
| Play track | `parachord://play?artist=Radiohead&title=Karma%20Police` |
| Pause | `parachord://control/pause` |
| Add to queue | `parachord://queue/add?artist=Radiohead&title=Paranoid%20Android` |
| Open artist | `parachord://artist/Radiohead` |
| Search | `parachord://search?q=shoegaze` |
| AI chat | `parachord://chat?prompt=play%20something%20chill` |

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
| `period` | No | Time range: `week`, `month`, `year`, `all` |

**Examples:**
```
parachord://history
parachord://history/top-tracks
parachord://history/top-artists?period=month
parachord://history/recent?period=week
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
| `period` | No | Time range: `week`, `month`, `year`, `all` |

**Examples:**
```
parachord://friend/john_doe
parachord://friend/john_doe/top-tracks
parachord://friend/jane123/top-artists?period=month
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

```
parachord://chat?prompt={text}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `prompt` | No | Text to send to the AI DJ |

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

```typescript
// raycast-parachord/src/pause.ts
import { open } from "@raycast/api";

export default async function Command() {
  await open("parachord://control/pause");
}
```

### Alfred Workflow

```bash
# Play a song
open "parachord://play?artist={query}&title={query2}"

# Toggle pause
open "parachord://control/pause"
```

### Stream Deck

Configure a "Website" action with the protocol URL:
- URL: `parachord://control/skip`

### Command Line

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

## Error Handling

Invalid protocol URLs will show a toast notification with the error. Common errors:

- Unknown command
- Missing required parameters
- Track/playlist not found
- Friend not found

The app will log protocol URL handling to the console for debugging.
