# Drag & Drop Track URL Design

## Overview

Enable users to drag and drop track URLs from music services onto the app. The URL is looked up to extract track metadata, then resolved across all enabled resolvers to find playable sources.

**Key use case:** Someone sends you an Apple Music link, you drop it, and it plays from Spotify (or your preferred service).

## Behavior

### Drop Zones

Two drop targets with different behaviors:

1. **Now Playing area** - Drop to play immediately
2. **Queue area** - Drop to insert as next track

Future: Playlist panel drops (out of scope for this design).

### Drop Logic

- **Empty queue:** Play immediately regardless of drop zone
- **Has queue:**
  - Now Playing zone → Play immediately
  - Queue zone → Insert at position 1 (next up), animate queue icon + increment count

### URL Resolution Flow

```
URL dropped
    ↓
Find matching resolver by URL pattern
    ↓
No match? → Show error toast "Unsupported URL"
    ↓
Match found → Create placeholder in queue/now-playing
    ↓
Call resolver.lookupUrl(url) → Extract metadata
    ↓
Lookup fails? → Show error state on placeholder
    ↓
Success → Run normal resolve() flow across ALL enabled resolvers
    ↓
Update placeholder with full track data + sources
```

**Important:** URL lookup only extracts metadata. Playback sources always come from the standard resolve flow, enabling cross-service playback.

## Resolver URL Capability

### Schema Extension

```javascript
// In .axe resolver file
{
  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": true,
    "urlLookup": true  // New capability flag
  },

  "urlPatterns": [
    "open.spotify.com/track/*",
    "spotify.link/*",
    "spotify:track:*"
  ],

  "implementation": {
    // Existing methods...

    // New method: extracts track metadata from URL
    "lookupUrl": "async function(url, config) {
      // Returns: { title, artist, album, duration, albumArt, sourceUrl }
      // Or null if URL can't be parsed
    }"
  }
}
```

### URL Patterns by Resolver

**Spotify:**
- `open.spotify.com/track/*`
- `open.spotify.com/intl-*/track/*`
- `spotify.link/*`
- `spotify:track:*`

**Bandcamp:**
- `*.bandcamp.com/track/*`

**YouTube:**
- `youtube.com/watch?v=*`
- `www.youtube.com/watch?v=*`
- `youtu.be/*`
- `music.youtube.com/watch?v=*`

**Qobuz:**
- `play.qobuz.com/track/*`
- `open.qobuz.com/track/*`

## Track Placeholder Lifecycle

### States

```javascript
{
  id: `pending-${Date.now()}`,
  status: 'loading',  // 'loading' | 'ready' | 'error'
  sourceUrl: 'https://open.spotify.com/track/...',
  title: null,
  artist: null,
  album: null,
  duration: null,
  albumArt: null,
  sources: {},
  errorMessage: null  // Set when status is 'error'
}
```

### Loading State
- Immediately insert placeholder on drop
- Show pulsing/skeleton animation
- Display source domain: "Loading from spotify.com..."
- Disable play/skip-to for this track

### Ready State
- Update with resolved metadata
- Replace temporary ID with proper `artist-title-album` ID
- Normal track card appearance
- Fully playable

### Error State
- Show error icon and message
- Muted/dimmed appearance
- Retry button and Remove button
- Queue playback automatically skips error tracks

## Visual Feedback

### Drop Zone Overlays

When dragging a valid URL over the app:

- Semi-transparent background (`rgba(0, 0, 0, 0.7)`)
- Centered icon + text
- **Now Playing zone:** Play icon ▶ + "Drop to Play Now"
- **Queue zone:** Queue icon + "Drop to Play Next"
- Smooth fade in/out on drag enter/leave

### Queue Icon Animation

On successful placeholder insertion:
- Brief scale pulse (1.0 → 1.2 → 1.0) over ~300ms
- Count badge increments with subtle highlight flash

### Placeholder Card Visual States

**Loading:**
- Pulsing/skeleton animation
- Source domain subtitle
- Spinner or animated dots

**Ready:**
- Normal track card appearance
- Album art, title, artist display

**Error:**
- Muted/dimmed appearance
- Error icon (⚠ or ✕)
- "Couldn't load track" text
- Retry and Remove buttons
- Not clickable for playback

## Implementation Files

### Modify

1. **`resolver-loader.js`**
   - Parse `urlPatterns` from resolver files
   - Build URL pattern → resolver ID registry
   - Add `findResolverForUrl(url)` method
   - Add `lookupUrl(resolverId, url, config)` method

2. **`app.js`**
   - Add drag/drop event listeners to app container
   - Add drop zone detection (now-playing vs queue)
   - Add `handleUrlDrop(url, zone)` function
   - Modify queue rendering to handle `status` field
   - Modify `handleNext()` to skip error tracks
   - Add placeholder insertion logic

3. **`app.css`** (or styled components)
   - Drop zone overlay styling
   - Placeholder loading animation
   - Error state styling
   - Queue icon pulse animation

4. **Resolver files** (`spotify.axe`, `bandcamp.axe`, `youtube.axe`, `qobuz.axe`)
   - Add `urlPatterns` arrays
   - Add `lookupUrl` implementations

### Create

- `DropZoneOverlay` component - Semi-transparent overlay with icon/message

## Scope Boundaries

**In scope:**
- Single track URL drops
- Four resolvers: Spotify, Bandcamp, YouTube, Qobuz
- Two drop zones: now playing, queue

**Out of scope (future work):**
- Multiple URL drops
- Playlist/album URL support
- Playlist panel drop target
- Apple Music resolver (requires separate resolver implementation)
