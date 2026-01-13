# Tomahawk Resolver Compatibility Guide

## TL;DR

**Yes, with conversion!** Tomahawk resolvers can work, but need format conversion:
- ✅ Core logic is compatible
- ✅ Same concepts (resolve, search, play)
- ⚠️ Different format (.js → .axe JSON)
- ⚠️ Different APIs (Tomahawk.* → standard JS)
- ⚠️ Manual conversion required

## What Would Work

### ✅ Core Concepts
Both systems share the same architecture:
- **Resolver plugins** - Modular, installable plugins
- **Capabilities** - resolve, search, browse, stream
- **Metadata** - name, version, author, icon
- **JavaScript-based** - Same language, same APIs

### ✅ These Services Would Likely Work
If the Tomahawk resolver still exists and the service API hasn't changed:

**Definitely Compatible:**
- ✅ **YouTube** - Public API, still works
- ✅ **SoundCloud** - Public API, still exists
- ✅ **Bandcamp** - We already have this one!
- ✅ **Jamendo** - Still has API
- ✅ **Last.fm** - Still active

**Probably Compatible (with updates):**
- ⚠️ **Spotify** - API changed, need new auth flow (we have this)
- ⚠️ **Deezer** - API still exists, may need updates
- ⚠️ **Qobuz** - API exists (we have this)
- ⚠️ **Tidal** - API exists but different auth

**Dead/Incompatible:**
- ❌ **Grooveshark** - Shut down in 2015
- ❌ **Rdio** - Shut down in 2015
- ❌ **Beats Music** - Became Apple Music
- ❌ **MOG** - Shut down in 2014
- ❌ **8tracks** - Still exists but limited API

### ✅ Logic That Translates Directly
```javascript
// Tomahawk: Search logic
var url = 'https://api.example.com/search?q=' + encodeURIComponent(query);

// Harmonix: Same logic!
const url = 'https://api.example.com/search?q=' + encodeURIComponent(query);
```

```javascript
// Tomahawk: Process results
var results = data.tracks.map(function(track) {
  return {
    artist: track.artist,
    track: track.title
  };
});

// Harmonix: Same logic!
const results = data.tracks.map(track => ({
  artist: track.artist,
  title: track.title
}));
```

## What Needs Changing

### ⚠️ File Format

**Tomahawk .js:**
```javascript
var SpotifyResolver = Tomahawk.extend(TomahawkResolver, {
    settings: {
        name: 'Spotify',
        icon: 'icon.png',
        weight: 95
    },
    resolve: function(qid, artist, album, title) {
        // Logic here
    }
});

Tomahawk.resolver.instance = SpotifyResolver;
```

**Harmonix .axe:**
```json
{
  "manifest": {
    "id": "spotify",
    "name": "Spotify",
    "icon": "♫",
    "version": "1.0.0"
  },
  "capabilities": {
    "resolve": true
  },
  "implementation": {
    "resolve": "async function(artist, track, album, config) { /* logic */ }"
  }
}
```

### ⚠️ API Calls

| Tomahawk API | Harmonix Equivalent |
|--------------|---------------------|
| `Tomahawk.asyncRequest(url, callback)` | `await fetch(url)` |
| `Tomahawk.addTrackResults(results)` | `return results` |
| `Tomahawk.log(msg)` | `console.log(msg)` |
| `Tomahawk.settings.get(key)` | `config.key` |
| `Tomahawk.addCustomUrlHandler()` | Not needed (handled by play()) |

### ⚠️ Function Signatures

**Tomahawk:**
```javascript
resolve: function(qid, artist, album, title) { ... }
search: function(qid, searchString) { ... }
```

**Harmonix:**
```javascript
resolve: async function(artist, track, album, config) { ... }
search: async function(query, config) { ... }
```

### ⚠️ Result Format

**Tomahawk:**
```javascript
{
  artist: "Radiohead",
  track: "Creep",
  source: "Spotify",
  url: "spotify:track:123",
  score: 0.95
}
```

**Harmonix:**
```javascript
{
  id: "spotify-123",
  title: "Creep",
  artist: "Radiohead",
  album: "Pablo Honey",
  duration: 238,
  sources: ["spotify"],
  spotifyUri: "spotify:track:123"
}
```

### ⚠️ Callbacks → Async/Await

**Tomahawk (Old):**
```javascript
resolve: function(qid, artist, album, title) {
    var url = API_URL + '?q=' + artist + ' ' + title;
    
    Tomahawk.asyncRequest(url, function(xhr) {
        var data = JSON.parse(xhr.responseText);
        var results = processResults(data);
        Tomahawk.addTrackResults({ qid: qid, results: results });
    });
}
```

**Harmonix (New):**
```javascript
resolve: async function(artist, track, album, config) {
    const url = API_URL + '?q=' + artist + ' ' + track;
    
    const response = await fetch(url);
    const data = await response.json();
    const results = processResults(data);
    return results[0] || null;
}
```

## Real World Example: YouTube

### Original Tomahawk Resolver
```javascript
var YoutubeResolver = Tomahawk.extend(TomahawkResolver, {
    settings: {
        name: 'YouTube',
        icon: 'youtube.png',
        weight: 70
    },

    resolve: function(qid, artist, album, title) {
        var url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=' + 
                  encodeURIComponent(artist + ' ' + title);
        
        Tomahawk.asyncRequest(url, function(xhr) {
            var data = JSON.parse(xhr.responseText);
            var results = data.items.map(function(item) {
                return {
                    artist: artist,
                    track: title,
                    source: 'YouTube',
                    url: 'https://www.youtube.com/watch?v=' + item.id.videoId,
                    duration: item.contentDetails.duration,
                    score: 0.9
                };
            });
            Tomahawk.addTrackResults({ qid: qid, results: results });
        });
    }
});
```

### Converted .axe Resolver
```json
{
  "manifest": {
    "id": "youtube",
    "name": "YouTube",
    "version": "1.0.0",
    "author": "Converted from Tomahawk",
    "icon": "📺",
    "color": "#FF0000"
  },
  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": true
  },
  "implementation": {
    "resolve": "async function(artist, track, album, config) { const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=' + encodeURIComponent(artist + ' ' + track) + '&key=' + config.apiKey; const response = await fetch(url); const data = await response.json(); return data.items.map(item => ({ id: 'youtube-' + item.id.videoId, title: track, artist: artist, album: album || 'Unknown', duration: 180, sources: ['youtube'], youtubeId: item.id.videoId, thumbnail: item.snippet.thumbnails.default.url }))[0] || null; }",
    "search": "async function(query, config) { const url = 'https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&q=' + encodeURIComponent(query) + '&maxResults=20&key=' + config.apiKey; const response = await fetch(url); const data = await response.json(); return data.items.map(item => ({ id: 'youtube-' + item.id.videoId, title: item.snippet.title, artist: item.snippet.channelTitle, album: 'YouTube', duration: 180, sources: ['youtube'], youtubeId: item.id.videoId, thumbnail: item.snippet.thumbnails.default.url })); }"
  }
}
```

## Conversion Checklist

For each Tomahawk resolver:

### ✅ Structure
- [ ] Copy resolver name, icon, description
- [ ] Convert to .axe JSON format
- [ ] Set capabilities based on functions present

### ✅ Functions
- [ ] Convert `resolve()` function
  - [ ] Change params: `(qid, artist, album, title)` → `(artist, track, album, config)`
  - [ ] Replace `Tomahawk.asyncRequest()` with `fetch()`
  - [ ] Replace `Tomahawk.addTrackResults()` with `return`
  - [ ] Convert callbacks to async/await
  - [ ] Update result format

- [ ] Convert `search()` function
  - [ ] Change params: `(qid, searchString)` → `(query, config)`
  - [ ] Same API replacements as resolve
  
- [ ] Convert `play()` function (if exists)
  - [ ] Usually involves opening URL or streaming

### ✅ Authentication
- [ ] Check if service needs API keys
- [ ] Add to `settings.configurable`
- [ ] Pass via `config` parameter

### ✅ Testing
- [ ] Validate JSON syntax
- [ ] Test search functionality
- [ ] Test resolve functionality
- [ ] Test playback

## Services Worth Converting

Based on Tomahawk's old resolver library:

### High Priority (Still Active, Popular)
1. **YouTube** - Most popular, API still works
2. **SoundCloud** - Large library, API works
3. **Jamendo** - Free music, API works
4. **Mixcloud** - DJ sets/podcasts
5. **Archive.org** - Public domain music

### Medium Priority (Requires API Keys)
6. **Deezer** - Popular in Europe
7. **Tidal** - Hi-fi streaming
8. **Napster** - Rebranded, still exists

### Low Priority (Niche)
9. **Subsonic** - Personal servers
10. **Ampache** - Personal servers
11. **ownCloud Music** - Self-hosted

## Automated Conversion Tool

I've created `tomahawk-to-axe.js` that:
- ✅ Extracts metadata (name, icon, weight)
- ✅ Identifies functions (resolve, search)
- ✅ Creates .axe template
- ⚠️ Requires manual function conversion

**Usage:**
```bash
node tomahawk-to-axe.js spotify-resolver.js
# Creates: spotify-resolver.axe (template)
# Creates: spotify-resolver-conversion-guide.md
```

Then manually convert the functions following the guide.

## Limitations

### ❌ Cannot Auto-Convert
- Complex function logic
- Service-specific quirks
- Authentication flows
- Error handling
- API changes since Tomahawk

### ❌ Dead Services
Many Tomahawk resolvers won't work because:
- Service shut down (Grooveshark, Rdio)
- API deprecated
- Authentication changed completely
- Website redesigned

## Conclusion

**Yes, Tomahawk resolvers CAN work, but:**
1. Need format conversion (.js → .axe)
2. Need API updates (Tomahawk → standard JS)
3. Need manual testing
4. Only if service still exists

**Best candidates:**
- YouTube (definitely)
- SoundCloud (probably)
- Jamendo (probably)
- Archive.org (probably)

**Worth the effort?**
- If you have a specific resolver you want: **Yes!**
- Converting the entire Tomahawk library: **Probably not**
- Focus on popular, still-active services

The **core logic is compatible** - it's just a matter of:
1. Converting the wrapper format
2. Updating API calls
3. Testing

So yes, in theory (and practice), old Tomahawk resolvers can be ported to Harmonix! 🎸
