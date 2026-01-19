# Last.fm Artist Image Cache Design

## Overview

Add Last.fm as a metadata service to fetch artist images, with a caching system mirroring the existing album art cache.

## Requirements

- Fetch artist images from Last.fm API
- Cache images with 90-day TTL (matching album art)
- Display in: artist detail view header, search results, artist cards/tiles
- Cache extralarge/mega size, let CSS handle scaling

## Architecture

### Data Flow

```
Component needs artist image
    ↓
Check artistImageCache[artistName]
    ├─ Cache Hit & Valid → Return URL
    └─ Cache Miss/Expired →
        1. Call Last.fm API: artist.getInfo
        2. Extract extralarge/mega image URL
        3. Store in artistImageCache with timestamp
        4. Return URL
    ↓
Periodic save to electron-store (cache_artist_images)
```

### Cache Structure

```javascript
// In-memory (useRef)
artistImageCache = {
  "Radiohead": {
    url: "https://lastfm.freetls.fastly.net/i/u/300x300/...",
    timestamp: 1705612800000
  },
  "Björk": { url: "...", timestamp: ... }
}

// Persisted to electron-store under key: cache_artist_images
```

### TTL Configuration

```javascript
const CACHE_TTL = {
  albumArt: 90 * 24 * 60 * 60 * 1000,      // 90 days (existing)
  artistData: 30 * 24 * 60 * 60 * 1000,    // 30 days (existing)
  trackSources: 7 * 24 * 60 * 60 * 1000,   // 7 days (existing)
  artistImage: 90 * 24 * 60 * 60 * 1000    // 90 days (new)
};
```

## Implementation

### Environment Variables

Already added to `.env`:
```
LASTFM_API_KEY=3b09ef20686c217dbd8e2e8e5da1ec7a
LASTFM_API_SECRET=37d8a3d50b2aa55124df13256b7ec929
```

### New Cache Ref

```javascript
const artistImageCache = useRef({});  // artistName -> {url, timestamp}
```

### Core Function

```javascript
const getArtistImage = async (artistName) => {
  if (!artistName) return null;

  const normalizedName = artistName.trim().toLowerCase();
  const cached = artistImageCache.current[normalizedName];
  const now = Date.now();

  // Check cache validity
  if (cached && (now - cached.timestamp) < CACHE_TTL.artistImage) {
    return cached.url;
  }

  try {
    const apiKey = '3b09ef20686c217dbd8e2e8e5da1ec7a';
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artistName)}&api_key=${apiKey}&format=json`;

    const response = await fetch(url);
    const data = await response.json();

    if (data.artist?.image) {
      // Get largest available image (extralarge or mega)
      const images = data.artist.image;
      const imageUrl = images.find(img => img.size === 'mega')?.['#text'] ||
                       images.find(img => img.size === 'extralarge')?.['#text'] ||
                       images.find(img => img.size === 'large')?.['#text'];

      if (imageUrl && imageUrl.length > 0) {
        artistImageCache.current[normalizedName] = {
          url: imageUrl,
          timestamp: now
        };
        return imageUrl;
      }
    }

    return null; // No image available, don't cache failure
  } catch (error) {
    console.error('Failed to fetch artist image from Last.fm:', error);
    return null; // Don't cache failures
  }
};
```

### Persistence Functions

Update `loadCacheFromStore()`:
```javascript
// Add to existing function
const artistImageData = await window.electron.store.get('cache_artist_images') || {};
Object.entries(artistImageData).forEach(([key, value]) => {
  if (now - value.timestamp < CACHE_TTL.artistImage) {
    artistImageCache.current[key] = value;
  }
});
```

Update `saveCacheToStore()`:
```javascript
// Add to existing function
await window.electron.store.set('cache_artist_images', artistImageCache.current);
```

## Integration Points

### 1. Artist Detail View (Header)

When `selectedArtist` changes, fetch and display artist image in the header background.

### 2. Search Results

When artist results return from MusicBrainz search, call `getArtistImage()` for each artist to populate thumbnails.

### 3. Artist Cards/Tiles

When rendering browse/discover views, use cached artist images for card backgrounds.

## Error Handling

- If Last.fm returns no image or API fails, return `null`
- UI shows placeholder when no image available
- Don't cache failures (allow retry on next request)
- Rate limiting: Last.fm allows 5 req/sec, no special handling needed for typical usage

## Files to Modify

1. `app.js` - Add cache ref, TTL, `getArtistImage()`, update load/save functions
2. UI components - Integrate `getArtistImage()` calls where artist images are needed
