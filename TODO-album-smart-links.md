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
