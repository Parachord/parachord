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

### 3. Universal / App Links (Shareable HTTPS)

Every `parachord://<verb>` URL has an equivalent `https://parachord.com/<verb>` form — byte-identical path and query. This is the shareable form (works in emails, SMS, Slack, social posts where custom schemes get stripped):

```
parachord://play/playlist?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F<id>
↔
https://parachord.com/play/playlist?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F<id>
```

Tapped on mobile (iOS Universal Links / Android App Links) or macOS (Associated Domains) with the app installed: the OS routes directly to Parachord with the URL above. Without the app installed: parachord.com renders a landing page with a "Get Parachord" CTA and an auto-trigger script that attempts the `parachord://` bounce.

The website worker that serves these landing pages and the `.well-known/assetlinks.json` + `.well-known/apple-app-site-association` files: [parachord-website](https://github.com/Parachord/parachord-website). URL conventions are documented in [its CLAUDE.md](https://github.com/Parachord/parachord-website/blob/main/CLAUDE.md).

## Quick Reference

| Category | Example URL |
|----------|-------------|
| Play track | `parachord://play?artist=Radiohead&title=Karma%20Police` |
| Play album | `parachord://play/album?mbid=b1392450-e666-3926-a536-22c65f834433` |
| Play playlist | `parachord://play/playlist?url=https://example.com/playlist.xspf` |
| Play radio | `parachord://play/radio?url=https://api.listenbrainz.org/1/explore/lb-radio?prompt=tag%3Ashoegaze&mode=easy` |
| Listen along | `parachord://listen-along?service=listenbrainz&user=mr_monkey` |
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

## External Source Playback

A family of commands designed for external sites (ListenBrainz, lyric pages, blog embeds) to start playback in Parachord with a single click. All four accept overlapping input shapes so a publisher can use whatever identifier they have at hand:

| Input | What it carries |
|---|---|
| `mbid` | MusicBrainz release-group ID (album commands only) |
| `spotify` / `applemusic` | Provider catalog ID (album commands only) |
| `url` | XSPF or JSPF/JSON tracklist endpoint |
| `tracks` | Base64-encoded JSON array of `{artist, title, album?, mbid?, isrc?}` |
| `artist` (+ `title`) | Search-by-name fallback |

The four commands differ only in how they consume the resolved tracklist:

| Command | Behavior | Refills |
|---|---|---|
| `play/album` | Plays in tracklist order | No |
| `play/playlist` | Plays in given order (optionally shuffled) | No |
| `play/radio` | Treats tracklist as initial pool; auto-extends from a refill URL | Yes |
| `listen-along` | Syncs to a remote user's now-playing on LB or Last.fm | Driven by the remote user |

> **No confirmation prompt.** Play actions are read-equivalent to clicking a Spotify or Apple Music share link; they only affect local playback state, are easily reversed (skip / pause), and don't write to the user's library. If a publisher wants to *save* a playlist to the user's library too, that's [`parachord://import`](#import-playlist) — which DOES prompt.

### Play Album

Play an album. Tracklist resolution priority: `mbid` → `spotify`/`applemusic` → `url` → `tracks` → `artist`+`title`.

```
parachord://play/album?mbid={release_group_mbid}
parachord://play/album?spotify={album_id}
parachord://play/album?applemusic={album_id}
parachord://play/album?artist={artist}&title={album_title}
parachord://play/album?url={xspf_or_json_url}
parachord://play/album?tracks={base64_json}&title={display_name}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `mbid` | Either this, a provider ID, `url`, `tracks`, or `artist`+`title` | MusicBrainz release-group ID |
| `spotify` | " | Spotify album ID |
| `applemusic` | " | Apple Music album ID |
| `url` | " | URL to a hosted XSPF or JSPF/JSON tracklist (HTTP/HTTPS, public hosts only) |
| `tracks` | " | Base64-encoded JSON array (same shape as `import` — see Track object format above) |
| `artist` | With `title` | Album artist |
| `title` | With `artist` | Album title |
| `shuffle` | No | `1` to shuffle the album's tracks |

**Example:**
```
parachord://play/album?artist=Radiohead&title=OK%20Computer
parachord://play/album?mbid=b1392450-e666-3926-a536-22c65f834433
```

### Play Playlist

Play a list of tracks. Same input shapes as `play/album` but without the album-only identifiers (`mbid`, `spotify`, `applemusic`).

```
parachord://play/playlist?url={xspf_or_json_url_or_provider_playlist_page}
parachord://play/playlist?tracks={base64_json}&title={display_name}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Either `url` or `tracks` | URL to a hosted tracklist document (XSPF / JSPF / JSON), **or** a provider playlist page (see "Provider URL sniffing" below) |
| `tracks` | " | Base64-encoded JSON array (max 100KB encoded, 500 tracks) |
| `title` | No | Display name for the playlist context |
| `creator` | No | Attribution shown in the playback context |
| `shuffle` | No | `1` to shuffle |

> Use `parachord://import` instead if you want the playlist saved to the user's library. `play/playlist` only plays — nothing persists.

#### Provider URL sniffing

`play/playlist?url=` accepts both **hosted tracklist documents** (XSPF / JSPF / JSON — the original shape) and **provider playlist page URLs**. The host is sniffed and routed accordingly. **Sniffing is gated to `play/playlist` only** — `play/album?url=` and `play/radio?url=` stay tracklist-document-only by design.

| URL host | Resolved via |
|---|---|
| `open.spotify.com/playlist/<id>` | Spotify playlist import |
| `music.apple.com/<region>/playlist/<slug>/<id>` | Apple Music playlist import |
| `soundcloud.com/<user>/sets/<slug>` | SoundCloud playlist import |
| `on.soundcloud.com/<short-id>` | Short-link — app follows the 302 to `soundcloud.com/<user>/sets/...` itself, then re-validates the final host before importing. The website does NOT pre-resolve the short link. |
| `achordion.xyz/playlist/<mbid>` | Fetched from `https://achordion.xyz/api/playlist/<mbid>/xspf` (public, returns XSPF) — the page itself is bot-challenged by Vercel; only the `/api/` route is reachable from the app's IP. |
| anything else | Falls back to the original behavior: fetch the URL and parse as XSPF / JSPF / JSON tracklist. |

A pure host classifier helper lives in [`tests/helpers/playlist-url-classify.js`](../tests/helpers/playlist-url-classify.js) with tests in [`tests/protocol/playlist-url-classify.test.js`](../tests/protocol/playlist-url-classify.test.js).

**Examples:**
```
parachord://play/playlist?url=https%3A%2F%2Fexample.com%2Fmix.xspf
parachord://play/playlist?url=https%3A%2F%2Fopen.spotify.com%2Fplaylist%2F37i9dQZF1DXcBWIGoYBM5M
parachord://play/playlist?url=https%3A%2F%2Fmusic.apple.com%2Fus%2Fplaylist%2Ftodays-hits%2Fpl.f4d106fed2bd41149aaacabb233eb5eb
parachord://play/playlist?url=https%3A%2F%2Fsoundcloud.com%2Fjherskowitz%2Fsets%2Ffrozen-in-time-2026
parachord://play/playlist?url=https%3A%2F%2Fon.soundcloud.com%2FDrk2sCLhCHVNugYtAP
parachord://play/playlist?url=https%3A%2F%2Fachordion.xyz%2Fplaylist%2Fc2accebd-ccd1-42c6-8ce7-ec0e8cf6cd13
```

The HTTPS share form of any of these (e.g. `https://parachord.com/play/playlist?url=https%3A%2F%2Fopen.spotify.com%2F...`) is byte-identical and works in any context that strips custom schemes — see [Universal / App Links](#3-universal--app-links-shareable-https) above.

### Play Radio

Play a never-ending pool. Differs from `play/playlist` in that the pool auto-extends from a refill URL when running low. Two seeding modes:

**Mode B — seed from artist (or artist+title):** Parachord generates the pool using its existing in-app similar-tracks endpoint. Same UX as right-clicking a track and choosing "Spinoff."

```
parachord://play/radio?artist={artist}
parachord://play/radio?artist={artist}&title={title}
```

**Mode C — externally curated pool:** the caller supplies the initial tracks (and optionally a refill URL). When the pool falls below 3 tracks remaining, Parachord re-fetches from the refill URL, dedupes against the existing pool, and appends new tracks. Refills stop after three consecutive empty fetches.

```
parachord://play/radio?url={refill_url}                              # initial pool fetched, refilled from same URL
parachord://play/radio?tracks={base64_json}                          # static pool (no refill)
parachord://play/radio?tracks={base64_json}&refill={refill_url}      # inline first-play, refills from refill_url
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `url` | Either this, `tracks`, or `artist` | Initial pool URL. If `refill` is omitted, this URL is also re-hit for refills. |
| `tracks` | " | Base64-encoded JSON array of initial pool |
| `refill` | No | URL to fetch additional tracks from when the pool runs low. If omitted, the radio is static after the initial pool exhausts (unless `url` was used). |
| `artist` | Mode B | Seed artist |
| `title` | Mode B (optional) | Seed track title within `artist`. In Mode C, also accepted as the station's display name. |
| `name` | No (Mode C) | Display name for the station (shown in the toast and the queue's "Playing" banner). Takes precedence over `title` and any name in the fetched playlist. |
| `shuffle` | No | `1` to shuffle the initial pool (Mode C only — Mode B's similarity ordering is preserved) |

The refill endpoint can return either XSPF (`Content-Type: application/xml`/`application/xspf+xml`) or JSPF/JSON (`Content-Type: application/json`). For ListenBrainz integrators, `https://api.listenbrainz.org/1/explore/lb-radio?...` returns JSPF.

> **ListenBrainz auth.** As of mid-2026 the lb-radio endpoint requires `Authorization: Token <user_token>`. Parachord auto-attaches the user's already-configured LB token (the same one used for scrobbling and friends) on every request whose host is `api.listenbrainz.org`. Publishers don't need to add anything to the URL — if the user has LB configured, it just works. If not, the call returns 401 and surfaces a "Radio failed: Fetch failed: 401" toast.

Refill rate-limit: minimum 5 seconds between fetches.

**Example:**
```
parachord://play/radio?url=https%3A%2F%2Fapi.listenbrainz.org%2F1%2Fexplore%2Flb-radio%3Fprompt%3Dtag%3Ashoegaze%26mode%3Deasy
parachord://play/radio?artist=Slowdive
```

### Listen Along

Start syncing playback to another user's now-playing on Last.fm or ListenBrainz. Reuses the in-app friend listen-along feature; if the user isn't in the local friends list, a transient friend record is constructed for the session.

```
parachord://listen-along?service={listenbrainz|lastfm}&user={username}
```

| Parameter | Required | Description |
|-----------|----------|-------------|
| `service` | Yes | `listenbrainz` or `lastfm` |
| `user` | Yes | Username on that service |

If the target user isn't currently listening, a toast surfaces "<user> is not currently listening on <service>." Otherwise listen-along activates immediately.

**Example:**
```
parachord://listen-along?service=listenbrainz&user=mr_monkey
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

The button uses a three-tier delivery mechanism:

1. **WebSocket** (`ws://127.0.0.1:9876`) — preferred when Parachord is detected as running. Provides a persistent connection indicator (green dot) and instant delivery.
2. **HTTP POST** (`http://127.0.0.1:9876/import`) — fallback when WebSocket is blocked (e.g., HTTPS pages subject to Private Network Access restrictions). Sends the playlist payload as JSON.
3. **Protocol URL** (`parachord://import?…`) — last resort. Opens the OS protocol handler which may show a confirmation dialog and launch the app.

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

### Embed Import Endpoint

The extension/embed server on port `9876` also accepts direct HTTP POST requests for importing playlists. This is used by the embeddable button as a fallback when WebSocket is blocked.

```
POST http://127.0.0.1:9876/import
Content-Type: application/json
```

**Request body (XSPF URL):**
```json
{
  "xspfUrl": "https://example.com/playlist.xspf"
}
```

**Request body (inline tracks):**
```json
{
  "title": "Road Trip Mix",
  "creator": "MyWebsite",
  "tracks": [
    { "title": "Karma Police", "artist": "Radiohead", "album": "OK Computer" },
    { "title": "Hyperballad", "artist": "Bjork", "album": "Post" }
  ]
}
```

**Response:**
```json
{ "success": true }
```

> **Note:** This endpoint handles CORS and [Private Network Access](https://developer.chrome.com/blog/private-network-access-preflight/) preflight requests so that HTTPS pages can reach it.

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
- **SSRF via URL parameters:** Crafted URLs in `import?url=`, `play/album?url=`, `play/playlist?url=`, or `play/radio?url=`/`refill=` could make Parachord fetch attacker-controlled or internal URLs. Mitigated by `isPublicHttpUrl` which rejects non-HTTP(S) schemes and any literal IP in the loopback (`127.0.0.0/8`, `0.0.0.0/8`, `::1`), RFC1918 (`10/8`, `172.16/12`, `192.168/16`), CGNAT (`100.64/10`), link-local (`169.254/16` — including the AWS/GCP/Azure cloud-metadata IP), `.local` mDNS, IPv6 link-local (`fe80::/10`), IPv6 ULA (`fc00::/7`), and IPv4-mapped IPv6 (`::ffff:0:0/96`) ranges. `import` additionally requires user confirmation showing the target hostname; `play-*` commands rely on the SSRF guard without confirmation since they only affect playback. **The guard does NOT defend against DNS rebinding** — a public hostname resolving to a private IP is accepted.
- **Data stuffing via `import` / `play-*`:** An oversized base64 payload in `tracks` could consume memory or disk. `import` caps the encoded payload at 100KB and 500 tracks; `play/album` / `play/playlist` / `play/radio` apply the same caps.
- **Silent side effects:** Commands like `play`, `play/album`, `play/playlist`, `play/radio`, `listen-along`, `queue/add`, `queue/clear`, `control/*`, `shuffle`, and `volume` execute without confirmation. These are considered low-risk since they only affect local playback state and are easily reversed (skip / pause / exit listen-along). `import` and `chat` are the two commands that DO prompt because they write to library state or send to the AI.
- **Refill loop abuse via `play/radio`:** A misbehaving refill endpoint could be hammered if Parachord retried in a tight loop. Mitigated by a 5-second soft rate-limit between refill fetches and an automatic stop after three consecutive empty fetches.

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
