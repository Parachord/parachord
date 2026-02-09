# Parachord Smart Links

Shareable music links powered by Cloudflare Pages + KV. Similar to feature.fm or linkfire.

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

This will deploy to `https://parachord-links.pages.dev`

### 4. Custom Domain (Optional)

In Cloudflare dashboard:
1. Go to Pages > parachord-links > Custom domains
2. Add `links.parachord.app` (or your preferred subdomain)

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
  "url": "https://links.parachord.app/abc12345"
}
```

### View Link

```
GET /:id
```

Returns the smart link page HTML.

### Embed Link

```
GET /:id/embed
```

Returns a compact embeddable player (152px height).

### oEmbed

```
GET /api/oembed?url=https://links.parachord.app/abc12345
```

Returns oEmbed JSON for rich embeds.

## Project Structure

```
smart-links/
├── functions/
│   ├── api/
│   │   ├── create.js     # POST /api/create
│   │   └── oembed.js     # GET /api/oembed
│   └── [[path]].js       # GET /:id and /:id/embed
├── lib/
│   └── html.js           # Shared HTML generation
├── package.json
├── wrangler.toml
└── README.md
```
