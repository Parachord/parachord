# Playlists Feature Documentation

## Overview

Harmonix now supports **XSPF playlists** (XML Shareable Playlist Format) - a standard, open playlist format that stores track metadata and can be resolved across multiple streaming services.

## How It Works

### 1. Playlist Storage (XSPF Format)
Playlists are stored as **XSPF XML files** containing track metadata:
- Track title
- Artist name
- Album name
- Duration
- Annotations (optional)

### 2. Track Resolution
When you open a playlist:
1. App parses the XSPF file
2. Extracts track metadata (artist, title, album)
3. **Resolves each track** using active resolvers (Spotify, Bandcamp, Qobuz, etc.)
4. Displays tracks with available sources from each resolver
5. You can play from any resolver that found the track

### 3. Cross-Platform Playback
Because playlists store **metadata** (not URLs), the same playlist works across all resolvers:
- Same playlist can play from Spotify, Bandcamp, Qobuz, etc.
- Tracks resolve based on your active resolvers
- Each track shows which resolvers found it

## UI Features

### Playlists View
- **Grid layout** - Visual playlist cards
- **Click to open** - View playlist details
- **Playlist info** - Title and creator displayed

### Playlist Detail View
- **Album art style header** - Gradient placeholder
- **Play button** - Start playing from first track
- **Track list** - Shows all tracks with:
  - Track number
  - Title and artist
  - Album name
  - Resolver icons (clickable to play from specific source)
  - Duration
  - Resolution status (shows "Resolving..." while loading)

### Progressive Loading
- Tracks appear as they resolve
- No need to wait for all tracks
- Real-time updates as resolvers return results

## XSPF Format

### Basic Structure
```xml
<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>My Playlist</title>
  <creator>Username</creator>
  <annotation>Playlist description</annotation>
  <date>2026-01-12T00:00:00Z</date>
  
  <trackList>
    <track>
      <title>Track Name</title>
      <creator>Artist Name</creator>
      <album>Album Name</album>
      <duration>240000</duration>
      <annotation>Track notes</annotation>
    </track>
    <!-- More tracks... -->
  </trackList>
</playlist>
```

### Field Mapping

| XSPF Field | Harmonix Usage | Required |
|------------|----------------|----------|
| `playlist/title` | Playlist name | ✅ Yes |
| `playlist/creator` | Playlist creator | ✅ Yes |
| `playlist/annotation` | Playlist description | ❌ No |
| `playlist/date` | Creation date | ❌ No |
| `track/title` | Track title | ✅ Yes |
| `track/creator` | Artist name | ✅ Yes |
| `track/album` | Album name | ❌ No |
| `track/duration` | Duration (milliseconds) | ❌ No |
| `track/annotation` | Track notes | ❌ No |
| `track/location` | URL (not used for resolution) | ❌ No |

**Note:** Duration is in **milliseconds** in XSPF, but displayed as **seconds** in UI.

## Test Playlist

A test playlist "**Quarantine Angst Mix**" is included with 5 tracks:

1. Isolation Blues - *Songs from the Lockdown* (4:00)
2. Social Distance - *Songs from the Lockdown* (3:15)
3. Cabin Fever - *Pandemic Sessions* (3:38)
4. Zoom Fatigue - *Pandemic Sessions* (3:23)
5. Essential Worker - *2020 Vision* (4:16)

### How to Access
1. Click "**Playlists**" in sidebar
2. Click "**Quarantine Angst Mix**" card
3. Wait for tracks to resolve
4. Click **Play** or individual resolver icons

## Code Architecture

### State Management
```javascript
const [playlists, setPlaylists] = useState([]);           // All playlists
const [selectedPlaylist, setSelectedPlaylist] = useState(null); // Current playlist
const [playlistTracks, setPlaylistTracks] = useState([]); // Resolved tracks
```

### Key Functions

#### `parseXSPF(xspfString)`
Parses XSPF XML into JavaScript object:
```javascript
{
  title: "Playlist Name",
  creator: "Username",
  tracks: [
    {
      title: "Track Name",
      artist: "Artist Name",
      album: "Album Name",
      duration: 240,  // seconds
      location: ""
    }
  ]
}
```

#### `loadPlaylist(playlistId)`
1. Finds playlist by ID
2. Parses XSPF
3. Resolves each track using active resolvers
4. Updates UI progressively

### Resolution Flow
```
User clicks playlist
    ↓
parseXSPF() extracts metadata
    ↓
For each track:
    ↓
Loop through active resolvers
    ↓
Call resolver.resolve(artist, title, album, config)
    ↓
Store resolved sources
    ↓
Update UI with new track
    ↓
Repeat for next track
```

## Console Output

### Loading Playlist
```
📋 Loading playlist: Quarantine Angst Mix
🎵 Parsed 5 tracks from XSPF
🔍 Resolving: Quarantine Angst - Isolation Blues
  ✅ Spotify: Found match
  ✅ Bandcamp: Found match
  ❌ Qobuz: No match
🔍 Resolving: Quarantine Angst - Social Distance
  ✅ Spotify: Found match
  ✅ Bandcamp: Found match
...
✅ Resolved 5 tracks
```

## Benefits

### ✅ Portability
- One playlist works across all services
- Share playlists as XSPF files
- Import from other XSPF-compatible apps

### ✅ Service Agnostic
- Not locked to one streaming service
- Play from whichever resolver finds the track
- Add/remove resolvers without breaking playlists

### ✅ Open Standard
- XSPF is an open W3C standard
- Works with many music players (VLC, Amarok, etc.)
- Human-readable XML format

### ✅ Metadata Rich
- Store notes and descriptions
- Preserve album information
- Include creation dates

## Creating Playlists

### Manually (Current)
Create an XSPF file with track metadata:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>My Mix</title>
  <creator>Me</creator>
  <trackList>
    <track>
      <title>Track Name</title>
      <creator>Artist Name</creator>
      <album>Album Name</album>
      <duration>240000</duration>
    </track>
  </trackList>
</playlist>
```

Save as `my-mix.xspf` and load in app (future feature).

### From Search Results (Future)
1. Search for tracks
2. Click "Add to playlist" on each result
3. Export as XSPF

### From Album (Future)
1. View album page
2. Click "Save as Playlist"
3. Creates XSPF from album tracks

## Comparison with Tomahawk

Harmonix playlists work **exactly like Tomahawk** playlists:

| Feature | Tomahawk | Harmonix |
|---------|----------|----------|
| **Format** | XSPF | ✅ XSPF |
| **Storage** | Metadata-based | ✅ Metadata-based |
| **Resolution** | Multi-source | ✅ Multi-source |
| **Portability** | Cross-platform | ✅ Cross-platform |
| **Standard** | Open W3C | ✅ Open W3C |

## Future Enhancements

### 🔮 Playlist Management
- Create new playlists in app
- Edit existing playlists
- Delete tracks
- Reorder tracks
- Drag & drop tracks

### 🔮 Import/Export
- Import XSPF files
- Export playlists
- Share via link
- Import from Spotify/Apple Music

### 🔮 Smart Playlists
- Auto-generate from listening history
- Similar artist recommendations
- Mood-based curation

### 🔮 Collaborative Playlists
- Share with friends
- Multiple contributors
- Real-time updates

### 🔮 Playlist Folders
- Organize playlists
- Nested categories
- Smart folders

## Troubleshooting

### Tracks Not Resolving
**Problem:** Tracks show "Resolving..." forever

**Solutions:**
- Check if resolvers are enabled (Settings)
- Verify resolver authentication (Spotify requires login)
- Check artist/track spelling in XSPF
- Try different resolver (some may not have the track)

### No Playlists Showing
**Problem:** Playlists view is empty

**Solutions:**
- Check if test playlist loaded (console: "📋 Loaded test playlist")
- Verify playlists state is populated
- Refresh the page

### Play Button Disabled
**Problem:** Can't click Play button

**Solutions:**
- Wait for at least one track to resolve
- Check if any resolver found matches
- Enable more resolvers for better coverage

## XSPF Resources

- **Official Spec:** https://xspf.org/
- **Wikipedia:** https://en.wikipedia.org/wiki/XML_Shareable_Playlist_Format
- **Examples:** https://xspf.org/applications/

## Summary

✅ **XSPF playlists** - Standard, portable format
✅ **Multi-source resolution** - Works across all resolvers
✅ **Progressive loading** - Tracks appear as resolved
✅ **Service agnostic** - Not locked to one platform
✅ **Test playlist included** - Quarantine Angst Mix ready to use

**Open the Playlists view and try the test playlist!** 🎵
