# Harmonix Resolver Plugin Format (.axe)

## File Format Specification

A `.axe` (Harmonix Resolver Extension) file is a JSON file containing resolver metadata and JavaScript implementation.

## Structure

```json
{
  "manifest": {
    "id": "spotify",
    "name": "Spotify",
    "version": "1.0.0",
    "author": "Harmonix Team",
    "description": "Stream from Spotify via Spotify Connect",
    "icon": "♫",
    "color": "#1DB954",
    "homepage": "https://spotify.com",
    "email": "support@harmonix.app"
  },
  
  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": true,
    "browse": false,
    "urlLookup": false
  },
  
  "settings": {
    "requiresAuth": true,
    "authType": "oauth",
    "configurable": {
      "quality": {
        "type": "select",
        "label": "Audio Quality",
        "default": "high",
        "options": ["low", "normal", "high", "very_high"]
      }
    }
  },
  
  "implementation": {
    "search": "function(query, config) { /* implementation */ }",
    "resolve": "function(artist, track, album, config) { /* implementation */ }",
    "play": "function(track, config) { /* implementation */ }",
    "init": "function(config) { /* initialization */ }",
    "cleanup": "function() { /* cleanup */ }"
  }
}
```

## Manifest Fields

- **id** (required): Unique identifier (lowercase, no spaces)
- **name** (required): Display name
- **version** (required): Semantic version (e.g., "1.0.0")
- **author** (required): Plugin author
- **description** (required): Brief description
- **icon** (optional): Emoji or single character icon
- **color** (optional): Brand color (hex format)
- **homepage** (optional): Website URL
- **email** (optional): Contact email

## Capabilities

Boolean flags indicating what the resolver can do:
- **resolve**: Can resolve artist+track to stream URL
- **search**: Can search for tracks
- **stream**: Can stream audio directly
- **browse**: Can browse catalog
- **urlLookup**: Can parse and open service URLs
- **purchase**: Supports purchasing tracks (shows "Buy" button in playbar)

## Settings

- **requiresAuth**: Whether authentication is required
- **authType**: Type of authentication ("oauth", "apikey", "userpass", "none")
- **configurable**: User-configurable settings with UI

## Implementation Functions

All functions are provided as strings containing JavaScript code.
They are executed in a sandboxed context with access to:
- `fetch` - HTTP requests
- `console` - Logging
- `config` - User configuration
- Standard JavaScript APIs

**Important:** Since implementation functions are stored as JSON strings, JavaScript template literals (backticks) must be converted to string concatenation:
- ❌ Bad: `` `Hello ${name}` ``
- ✅ Good: `'Hello ' + name`

### Function Signatures

```javascript
// Search for tracks
async function search(query, config) {
  // Returns: Array of track objects
  return [{
    id: 'spotify-123',
    title: 'Track Name',
    artist: 'Artist Name',
    album: 'Album Name',
    duration: 180,
    sources: ['spotify'],
    // Resolver-specific fields (examples):
    spotifyId: '...',        // Spotify track ID
    bandcampUrl: '...',      // Bandcamp track URL (also used for purchase)
    qobuzId: '...',          // Qobuz track ID (used to construct purchase URL)
    youtubeId: '...',        // YouTube video ID
    soundcloudId: '...',     // SoundCloud track ID
  }];
}

// Resolve a specific track
async function resolve(artist, track, album, config) {
  // Returns: Single track object or null
  return { /* track object */ };
}

// Play a track
async function play(track, config) {
  // Returns: true on success, false on failure
  return true;
}

// Initialize resolver (called once on load)
async function init(config) {
  // Setup, authentication, etc.
}

// Cleanup (called on disable/unload)
async function cleanup() {
  // Cleanup resources
}
```

## Example: Minimal Resolver

```json
{
  "manifest": {
    "id": "example",
    "name": "Example Resolver",
    "version": "1.0.0",
    "author": "Your Name",
    "description": "An example resolver",
    "icon": "🎵",
    "color": "#FF0000"
  },
  
  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": false,
    "browse": false,
    "urlLookup": false
  },
  
  "settings": {
    "requiresAuth": false,
    "authType": "none"
  },
  
  "implementation": {
    "search": "async function(query, config) { const response = await fetch('https://api.example.com/search?q=' + encodeURIComponent(query)); const data = await response.json(); return data.tracks.map(t => ({ id: 'example-' + t.id, title: t.name, artist: t.artist, album: t.album, duration: t.duration, sources: ['example'] })); }",
    
    "resolve": "async function(artist, track, album, config) { const query = artist + ' ' + track; const results = await this.search(query, config); return results[0] || null; }"
  }
}
```

## Loading .axe Files

Harmonix loads .axe files from:
1. `/resolvers/builtin/` - Built-in resolvers
2. `/resolvers/user/` - User-installed resolvers

## Security Considerations

- All resolver code runs in an isolated context
- No access to filesystem (except via Electron APIs)
- No access to user credentials (except through auth flow)
- Rate limiting applied to API calls
- User must explicitly enable each resolver

## Installation

Users can install .axe files:
1. **From File**: Settings → Install Resolver → Select .axe file
2. **From URL**: Settings → Install from URL → Enter URL
3. **From Repo**: Browse resolver directory (future)

## Versioning

Resolvers follow semantic versioning:
- **Major**: Breaking changes to API/behavior
- **Minor**: New features, backward compatible
- **Patch**: Bug fixes

## Best Practices

1. **Keep implementation functions concise** - Easier to debug and maintain
2. **Use descriptive error messages** - Help users understand issues
3. **Respect rate limits** - Don't abuse API quotas
4. **Cache results when appropriate** - Improve performance
5. **Follow service ToS** - Stay compliant with terms of service
6. **Provide accurate metadata** - Better user experience
7. **Test thoroughly before publishing** - Ensure reliability
8. **Validate query length** - Check minimum length requirements:
   ```javascript
   // If API requires minimum 3 characters
   if (query.trim().length < 3) {
     console.log('Query too short (min 3 chars)');
     return [];
   }
   ```
9. **Handle errors gracefully** - Return empty arrays, don't throw
10. **Log useful debug info** - Help troubleshoot issues
