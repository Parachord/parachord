# Discogs & Wikipedia Metaservice Plugins Design

**Date:** 2026-01-24
**Status:** Approved

## Overview

Add two new metaservice plugins to fetch artist biography data and images from Discogs and Wikipedia. These integrate with the existing Artist Bio page, providing richer content with fallback logic.

## Goals

- Fetch artist biographies from Wikipedia and Discogs
- Provide fallback images when Spotify doesn't have artist photos
- Maintain priority order: Wikipedia > Discogs > Last.fm for bios
- Maintain priority order: Spotify > Wikipedia > Discogs for images
- Use MusicBrainz ID (MBID) as the primary lookup key

## Plugin Architecture

### wikipedia.axe

```json
{
  "manifest": {
    "id": "wikipedia",
    "name": "Wikipedia",
    "type": "meta-service",
    "version": "1.0.0",
    "author": "Parachord",
    "description": "Artist biographies and images from Wikipedia",
    "icon": "📚",
    "color": "#000000",
    "homepage": "https://www.wikipedia.org"
  },
  "capabilities": {
    "metadata": true,
    "biography": true,
    "artistImages": true
  },
  "settings": {
    "requiresAuth": false,
    "authType": "none",
    "configurable": {}
  }
}
```

### discogs.axe

```json
{
  "manifest": {
    "id": "discogs",
    "name": "Discogs",
    "type": "meta-service",
    "version": "1.0.0",
    "author": "Parachord",
    "description": "Artist biographies and images from Discogs",
    "icon": "📀",
    "color": "#333333",
    "homepage": "https://www.discogs.com"
  },
  "capabilities": {
    "metadata": true,
    "biography": true,
    "artistImages": true
  },
  "settings": {
    "requiresAuth": false,
    "authType": "token",
    "configurable": {
      "personalAccessToken": {
        "type": "password",
        "label": "Personal Access Token",
        "required": false,
        "advanced": true,
        "placeholder": "Optional - improves rate limits",
        "description": "Get a token from discogs.com/settings/developers",
        "helpUrl": "https://www.discogs.com/settings/developers"
      }
    }
  }
}
```

## API Integration

### Wikipedia/Wikidata Flow

1. **MBID → Wikidata Entity**
   - Query: `https://www.wikidata.org/w/api.php?action=wbgetentities&sites=musicbrainz&titles={mbid}&format=json`
   - Alternative: Use MusicBrainz API to get Wikidata relation directly

2. **Wikidata → Wikipedia Article**
   - Extract `sitelinks.enwiki.title` from Wikidata entity

3. **Fetch Wikipedia Summary**
   - Endpoint: `https://en.wikipedia.org/api/rest_v1/page/summary/{title}`
   - Returns: `extract` (plain text), `content_urls.desktop.page`, `thumbnail.source`

### Discogs Flow

1. **Search by MBID or Artist Name**
   - Endpoint: `https://api.discogs.com/database/search?type=artist&q={artistName}`
   - Headers: `User-Agent: Parachord/1.0`
   - Optional: `Authorization: Discogs token={token}`

2. **Fetch Artist Details**
   - Endpoint: `https://api.discogs.com/artists/{discogs_id}`
   - Returns: `profile` (bio), `images[]`, `uri`

### Rate Limits

| Service | Unauthenticated | Authenticated |
|---------|-----------------|---------------|
| Wikipedia | Respectful use (~100ms delays) | N/A |
| Discogs | 25 req/min | 60 req/min |

## Data Structures

### ArtistBio (enhanced)

```typescript
interface ArtistBio {
  bio: string;
  url: string;
  source: 'wikipedia' | 'discogs' | 'lastfm';
  allSources?: {
    wikipedia?: { bio: string; url: string };
    discogs?: { bio: string; url: string };
    lastfm?: { bio: string; url: string };
  };
}
```

### ArtistMetadata (from plugins)

```typescript
interface ArtistMetadata {
  bio: string;
  url: string;
  imageUrl?: string;
  source: 'wikipedia' | 'discogs';
}
```

## Implementation Details

### Bio Aggregation

```javascript
const getArtistBio = async (artistName, artistMbid) => {
  setLoadingBio(true);
  try {
    // Fetch from all sources in parallel
    const [wikipediaBio, discogsBio, lastfmBio] = await Promise.all([
      getWikipediaBio(artistMbid),
      getDiscogsBio(artistMbid, artistName),
      getLastfmBioData(artistName)
    ]);

    // Store all sources for potential future use
    const allSources = {
      wikipedia: wikipediaBio,
      discogs: discogsBio,
      lastfm: lastfmBio
    };

    // Select best bio based on priority
    const selected = wikipediaBio ?? discogsBio ?? lastfmBio;

    if (selected) {
      return { ...selected, allSources };
    }
    return null;
  } finally {
    setLoadingBio(false);
  }
};
```

### Image Fallback

```javascript
const getArtistImage = async (artist) => {
  // 1. Spotify image already present
  if (artist.imageUrl) return artist.imageUrl;

  // 2. Try Wikipedia
  if (artist.mbid) {
    const wikiImage = await getWikipediaArtistImage(artist.mbid);
    if (wikiImage) return wikiImage;
  }

  // 3. Fall back to Discogs
  const discogsImage = await getDiscogsArtistImage(artist.mbid, artist.name);
  if (discogsImage) return discogsImage;

  return null;
};
```

### UI Updates

- Display source attribution below bio: "From Wikipedia" / "From Discogs" / "From Last.fm"
- "Read more" link points to selected source's URL
- No visual changes to image display (same component, different source)

## Files to Modify

### New Files

- `/resolvers/wikipedia.axe` - Wikipedia metaservice plugin manifest
- `/resolvers/discogs.axe` - Discogs metaservice plugin manifest

### Modified Files

- `/app.js`
  - Add `getWikipediaBio(mbid)` function
  - Add `getDiscogsBio(mbid, artistName)` function
  - Add `getWikipediaArtistImage(mbid)` function
  - Add `getDiscogsArtistImage(mbid, artistName)` function
  - Modify `getArtistBio()` to use parallel fetch + priority selection
  - Modify artist image loading to include fallbacks
  - Update bio rendering to show source attribution

## Out of Scope

- Album/release metadata enrichment
- User-configurable priority order
- Image gallery from multiple sources
- Explicit bio caching layer

## Testing

1. Artist with all three sources available → should show Wikipedia bio
2. Artist with only Discogs + Last.fm → should show Discogs bio
3. Artist with only Last.fm → should show Last.fm bio (existing behavior)
4. Artist with no MBID → should fall back to Last.fm only
5. Artist without Spotify image → should try Wikipedia, then Discogs
6. Discogs with/without token → verify both work with different rate limits
