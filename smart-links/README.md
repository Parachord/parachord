# Parachord Smart Links

Shareable music links powered by Cloudflare Pages + KV, served at `go.parachord.com`. Similar to feature.fm or linkfire.

> **Status:** the desktop app no longer creates links here. Its "Copy link" now produces an [Achordion](https://achordion.xyz) page instead (see the `achordion.xyz` link builders in `src/renderer/app.js`). This backend stays deployed so links published before the switch keep working: it serves the link pages and embeds (`/:id`, `/:id/embed`, `/:id/playlist.xspf`), oEmbed, `/api/lookup` (the iOS app resolves a `go.parachord.com/<id>` link through it), the iOS Universal Links manifest (`/.well-known/apple-app-site-association`), and `button.js`, the embeddable "Send to Parachord" button. `POST /api/create` still exists but nothing in this repo calls it.

## Features

- Create shareable links with multiple streaming service URLs
- Automatic oEmbed support for rich embeds on Discord, Slack, etc.
- Open Graph & Twitter Cards for social media previews
- Parachord integration - "Play in Parachord" button when app is running
- View counting analytics
- Free tier: 100k views/day, 1k new links/day

## Setup

### 1. Install Wrangler

```bash
npm install -g wrangler
wrangler login
```

### 2. Create KV Namespace

```bash
cd smart-links
npm run kv:create
```

Copy the namespace ID and add it to `wrangler.toml`:

```toml
[[kv_namespaces]]
binding = "LINKS"
id = "your-namespace-id-here"
```

### 3. Deploy

```bash
npm run deploy
```

This will deploy to `https://parachord-links.pages.dev`. Pushes to main that touch `smart-links/` deploy automatically (`.github/workflows/deploy-smart-links.yml`).

### 4. Custom Domain

Production is served at `go.parachord.com` (Cloudflare dashboard: Pages > parachord-links > Custom domains).

## Local Development

```bash
npm run dev
```

This starts a local server at `http://localhost:8788`

## API

### Create Link

```bash
POST /api/create
Content-Type: application/json

{
  "title": "Song Title",
  "artist": "Artist Name",
  "albumArt": "https://...",
  "type": "track",
  "urls": {
    "spotify": "https://open.spotify.com/track/...",
    "youtube": "https://www.youtube.com/watch?v=...",
    "soundcloud": "https://soundcloud.com/...",
    "bandcamp": "https://....bandcamp.com/track/..."
  }
}
```

Response:
```json
{
  "id": "abc12345",
  "url": "https://go.parachord.com/abc12345"
}
```

### View Link

```
GET /:id
```

Returns the smart link page HTML. Links without stored enrichment get missing service URLs filled in the background (`lib/enrich.js`).

### Lookup Link

```
GET /api/lookup?id=:id
```

Returns the stored link payload as JSON (`{ title, artist, creator, albumArt, type, urls, tracks, deeplink, createdAt, enrichedAt }`), with CORS open. The iOS app calls this when a user opens a `go.parachord.com/<id>` link.

### Playlist XSPF

```
GET /:id/playlist.xspf
```

Returns the link's tracklist as an XSPF download.

### Embed Link

```
GET /:id/embed
```

Returns a compact embeddable player (400×152px). Shows album art, title, artist, and Play button.

#### Large Embed

```
GET /:id/embed?size=large
```

Returns a full-page embeddable player (600px wide) for albums and playlists. Includes album art (or playlist mosaic), title, artist, Play All button, streaming service icons, and the complete tracklist with per-track service badges and durations. Supports Parachord WebSocket integration for individual track playback.

Example iframe:
```html
<iframe src="https://go.parachord.com/abc12345/embed?size=large" width="600" height="500" frameborder="0" style="border-radius: 8px;"></iframe>
```

### oEmbed

```
GET /api/oembed?url=https://go.parachord.com/abc12345
GET /api/oembed?url=https://go.parachord.com/abc12345&size=large
```

Returns oEmbed JSON for rich embeds. Pass `size=large` to get the large embed iframe dimensions and URL in the response.

## Project Structure

```
smart-links/
├── functions/
│   ├── api/
│   │   ├── create.js     # POST /api/create (no longer called by the desktop app)
│   │   ├── lookup.js     # GET /api/lookup?id= (stored payload, used by iOS)
│   │   └── oembed.js     # GET /api/oembed
│   └── [[path]].js       # GET /:id, /:id/embed, /:id/playlist.xspf, and the AASA manifest
├── lib/
│   ├── enrich.js         # Server-side enrichment of missing service URLs (iTunes, YouTube, Spotify)
│   └── html.js           # Shared HTML generation
├── public/               # Static assets: button.js (copy of ../parachord-button.js), icons, index.html
├── package.json
├── wrangler.toml
└── README.md
```
