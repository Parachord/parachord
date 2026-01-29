# TODO: Album Smart Links Support

Currently smart links only work for individual tracks. To support albums:

## 1. Data Model Changes

Add album-specific IDs to track/album objects:
- `spotifyAlbumId` - Spotify album ID
- `bandcampAlbumUrl` - Full Bandcamp album URL (e.g., `https://artist.bandcamp.com/album/name`)
- `soundcloudPlaylistUrl` - SoundCloud "sets" URL for albums
- `youtubePlaylistId` - YouTube playlist ID (optional, YouTube doesn't have albums)

## 2. URL Construction

Update `getServiceUrl()` in `embed.html` and `app.js` to handle album URLs:

```javascript
function getServiceUrl(item, type = 'track') {
  if (type === 'album') {
    if (item.spotifyAlbumId) return `https://open.spotify.com/album/${item.spotifyAlbumId}`;
    if (item.bandcampAlbumUrl) return item.bandcampAlbumUrl;
    if (item.soundcloudPlaylistUrl) return item.soundcloudPlaylistUrl;
    // YouTube fallback to search
    if (item.artist && item.title) {
      return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${item.artist} ${item.title} full album`)}`;
    }
  }
  // ... existing track logic
}
```

## 3. Context Menu Changes

In `main.js`, when generating smart link for a release/album, pass album-specific IDs:

```javascript
if (data.type === 'release') {
  mainWindow.webContents.send('track-context-menu-action', {
    action: 'generate-smart-link',
    item: {
      title: data.name,
      artist: data.artist,
      albumArt: data.albumArt,
      spotifyAlbumId: data.spotifyAlbumId,
      bandcampAlbumUrl: data.bandcampAlbumUrl,
      // etc.
    },
    type: 'album'
  });
}
```

## 4. Resolver Changes

Each resolver needs to:
1. Store album IDs when fetching/displaying albums
2. Optionally add `searchAlbums()` method for album-specific search

### Spotify Resolver
- Already has album data via API
- Need to pass `spotifyAlbumId` through to UI

### Bandcamp Resolver
- Album URLs are already full URLs
- Just need to pass `bandcampAlbumUrl` through

### SoundCloud Resolver
- Albums are "sets" - need to capture set URL
- Pass as `soundcloudPlaylistUrl`

### YouTube Resolver
- No native album concept
- Fall back to search query: `{artist} {album} full album`

## 5. Smart Link Generator Updates

- Accept `type` parameter ('track' | 'album')
- Use appropriate URL construction based on type
- Update UI text ("Listen to this album" vs "Listen to this track")

## Files to Modify

- `embed.html` - getServiceUrl(), generateSmartLinkHtml()
- `app.js` - generateSmartLink(), context menu handler
- `main.js` - context menu data passing
- Individual resolver files - pass album IDs through

---

# TODO: Smart Link Backend Service

To serve smart links on the web (like feature.fm or linkfire), a simple backend is needed.

## Architecture Options

### Option 1: Static Hosting + Serverless (Cheapest)

**Cost: Free - $5/month**

Components:
- **Cloudflare Pages / Netlify / Vercel** - Free static hosting
- **Cloudflare KV / Upstash Redis** - Key-value store for link data (free tier available)
- **Serverless function** - Generate and retrieve links

Flow:
1. User generates link in Parachord → POST to serverless function
2. Function stores link data in KV with short ID (e.g., `abc123`)
3. Returns URL like `https://links.parachord.app/abc123`
4. When visited, serverless function fetches data from KV, renders HTML

```
Parachord → POST /api/create → KV Store
                                   ↓
Browser → GET /abc123 → Function → Render HTML
```

### Option 2: Simple VPS (More Control)

**Cost: $5-10/month**

Components:
- **DigitalOcean / Vultr / Hetzner** droplet ($4-6/month)
- **SQLite** or **PostgreSQL** for storage
- **Node.js + Express** or **Go + Chi**
- **Caddy** for auto-HTTPS

```javascript
// Minimal Express server
const express = require('express');
const Database = require('better-sqlite3');
const { nanoid } = require('nanoid');

const app = express();
const db = new Database('links.db');

db.exec(`CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  data JSON NOT NULL,
  created_at INTEGER DEFAULT (unixepoch())
)`);

app.post('/api/create', express.json(), (req, res) => {
  const id = nanoid(8);
  db.prepare('INSERT INTO links (id, data) VALUES (?, ?)').run(id, JSON.stringify(req.body));
  res.json({ url: `https://links.parachord.app/${id}` });
});

app.get('/:id', (req, res) => {
  const link = db.prepare('SELECT data FROM links WHERE id = ?').get(req.params.id);
  if (!link) return res.status(404).send('Not found');
  const data = JSON.parse(link.data);
  res.send(generateHtml(data)); // Reuse existing generateSmartLinkHtml()
});

app.listen(3000);
```

## Database Schema

```sql
CREATE TABLE links (
  id TEXT PRIMARY KEY,           -- Short ID (nanoid, 8 chars)
  title TEXT,                    -- Track/album title
  artist TEXT,                   -- Artist name
  album_art TEXT,                -- Album art URL
  type TEXT DEFAULT 'track',     -- 'track' or 'album'
  urls JSON,                     -- { spotify: "...", youtube: "...", etc }
  created_at INTEGER,            -- Unix timestamp
  views INTEGER DEFAULT 0        -- Optional analytics
);
```

## API Endpoints

```
POST /api/create
  Body: { title, artist, albumArt, type, urls: { spotify, youtube, ... } }
  Response: { id: "abc123", url: "https://links.parachord.app/abc123" }

GET /:id
  Response: Rendered HTML page (smart link)

GET /api/stats/:id (optional)
  Response: { views, created_at }
```

## Parachord Integration

Add "Publish Smart Link" option that:
1. Generates the smart link HTML locally (existing code)
2. Extracts the resolved URLs
3. POSTs to backend API
4. Shows shareable URL to user with copy button

```javascript
async function publishSmartLink(track, resolvedUrls) {
  const response = await fetch('https://links.parachord.app/api/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: track.title,
      artist: track.artist,
      albumArt: track.albumArt,
      type: 'track',
      urls: resolvedUrls
    })
  });
  const { url } = await response.json();
  return url; // e.g., "https://links.parachord.app/abc123"
}
```

## Hosting Recommendations

| Provider | Type | Cost | Pros |
|----------|------|------|------|
| Cloudflare Pages + KV | Serverless | Free | Zero config, global CDN |
| Vercel | Serverless | Free | Easy deploy, good DX |
| Deno Deploy | Serverless | Free | Simple, fast |
| fly.io | Container | Free tier | Real server, SQLite works |
| Hetzner VPS | VPS | €4/month | Full control, EU hosting |
| DigitalOcean | VPS | $6/month | Simple, good docs |

## Domain

- Use subdomain: `links.parachord.app` or `l.parachord.app`
- Or dedicated domain: `prchrd.link` (short URLs)

## Future Enhancements

- Analytics dashboard (view counts, referrers)
- Custom slugs (`links.parachord.app/my-cool-song`)
- QR code generation
- Social preview images (og:image with album art)
- Expiring links
- User accounts for managing links
