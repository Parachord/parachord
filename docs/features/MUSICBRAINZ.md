# MusicBrainz Integration Guide

## What is MusicBrainz?

**MusicBrainz** is a free, open-source music encyclopedia that aims to be the ultimate source of music information. It's like Wikipedia for music metadata!

### Key Features:
- ✅ **Free & Open**: No API keys required
- ✅ **Comprehensive Database**: Millions of tracks, artists, albums
- ✅ **Community-Driven**: Constantly updated by volunteers
- ✅ **Metadata Only**: Provides info, not playback
- ✅ **No Rate Limits** (just be respectful - 1 req/sec)

---

## What I Added

### 🎵 MusicBrainz Search
- Searches MusicBrainz database alongside Spotify
- Returns track metadata (title, artist, album, duration)
- Shows "♪ MusicBrainz" badge on results
- Runs in parallel with other searches for speed

### 🎨 Visual Integration
- **Purple badge**: "♪ MusicBrainz" on search results
- **New resolver**: MusicBrainz in sidebar (enabled by default)
- **Matches design**: Same style as Spotify badge

### 🔧 Technical Details
- Uses MusicBrainz Web Service v2 API
- Searches recordings (individual tracks)
- Returns top 20 results
- User-Agent header included (required by MusicBrainz)

---

## How It Works

### Search Flow:
1. **You type** in search bar (e.g., "Bohemian Rhapsody")
2. **App searches all enabled resolvers** in parallel:
   - Local library
   - Spotify (if connected & enabled)
   - MusicBrainz (if enabled)
3. **Results combined** and displayed together
4. **Badges show source**: Green for Spotify, Purple for MusicBrainz

### Data Format:
```javascript
{
  id: 'musicbrainz-abc123',
  title: 'Bohemian Rhapsody',
  artist: 'Queen',
  album: 'A Night at the Opera',
  duration: 354,
  sources: ['musicbrainz'],
  musicbrainzId: 'abc123...'
}
```

---

## Usage

### Searching:
1. **Make sure MusicBrainz is enabled** (toggle in sidebar - ON by default)
2. **Type your search** in the search bar
3. **See results from multiple sources**:
   - Spotify results with green "♫ Spotify" badge
   - MusicBrainz results with purple "♪ MusicBrainz" badge
4. **Click any result** to play (Spotify) or see info (MusicBrainz)

### Playing MusicBrainz Tracks:
**Important**: MusicBrainz provides **metadata only**, not audio playback!

When you click a MusicBrainz track:
- You'll see: "MusicBrainz provides metadata only..."
- **Solution**: Search for the same track again with Spotify enabled
- Or wait for YouTube/SoundCloud integration (coming soon!)

---

## Why Add MusicBrainz?

### 1. **More Search Results**
- Find tracks that might not be on Spotify
- Especially useful for:
  - Independent artists
  - Regional music
  - Older/rare recordings
  - Classical music

### 2. **No Authentication Required**
- Works immediately, no setup
- No API keys needed
- No rate limits to worry about

### 3. **Complementary to Spotify**
- See what exists even if not on Spotify
- Discover metadata for tracks
- Plan for future multi-source playback

### 4. **Open Source Ethos**
- Supports open music metadata
- Community-driven database
- Aligns with Tomahawk's philosophy

---

## Examples

### Search: "Taylor Swift"
**Results might include:**
- 🟢 Spotify: Taylor Swift tracks with album art (playable)
- 🟣 MusicBrainz: Additional Taylor Swift recordings (metadata)

### Search: "Rare B-side track"
**Results might include:**
- 🟢 Spotify: If it's on Spotify
- 🟣 MusicBrainz: May have metadata even if not on Spotify

### Search: "Classical symphony"
**Results might include:**
- 🟣 MusicBrainz: Detailed classical music metadata with proper cataloging

---

## Future Enhancements

### What Could Be Added:

1. **Lookup by MusicBrainz ID**
   - Click MusicBrainz result
   - Automatically search for it on Spotify/YouTube
   - Auto-match and play

2. **Cover Art from MusicBrainz**
   - MusicBrainz has Cover Art Archive
   - Could show album art for MusicBrainz results

3. **Extended Metadata**
   - Show recording date
   - Show label/publisher
   - Link to artist/album pages

4. **Smart Matching**
   - Use MusicBrainz IDs to find same track on other services
   - Cross-reference between resolvers

---

## Settings

### Enable/Disable MusicBrainz:
1. Look in **sidebar** at resolvers section
2. Find **"MusicBrainz"** with purple dot
3. **Toggle switch** to enable/disable
4. When enabled, it searches automatically

### Active Resolvers Badge:
When searching, you'll see which resolvers are active:
- "Searching: Spotify, MusicBrainz"
- Shows at top of search results

---

## Technical Details

### API Endpoint:
```
https://musicbrainz.org/ws/2/recording
?query={search_query}
&limit=20
&fmt=json
```

### Required Headers:
```
User-Agent: Harmonix/1.0.0 (https://github.com/harmonix)
```

### Rate Limiting:
- MusicBrainz requests 1 request per second average
- For search, this is plenty fast
- No hard limits, just be respectful

### Response Format:
Returns array of recordings with:
- `id`: MusicBrainz Recording ID
- `title`: Track title
- `artist-credit`: Array of artists
- `releases`: Array of albums/releases
- `length`: Duration in milliseconds

---

## Comparison: Spotify vs MusicBrainz

| Feature | Spotify | MusicBrainz |
|---------|---------|-------------|
| Playback | ✅ Yes | ❌ No (metadata only) |
| Album Art | ✅ Yes | ⚠️ Separate API |
| Authentication | ⚠️ Required | ✅ None needed |
| Database Size | ~100M tracks | ~30M recordings |
| Rate Limits | ✅ High | ✅ Reasonable |
| Cost | ⚠️ Premium for playback | ✅ Free |
| Metadata Quality | 🟢 Good | 🟢 Excellent |
| Classical Music | 🟡 OK | 🟢 Excellent |
| Indie/Rare | 🟡 Varies | 🟢 Often has it |

---

## Summary

**MusicBrainz is now integrated!** 🎉

- ✅ Search multiple sources simultaneously
- ✅ See more comprehensive results
- ✅ Discover tracks not on Spotify
- ✅ No setup required (works immediately)
- ⚠️ Metadata only (no playback yet)

**Perfect for:**
- Finding track information
- Discovering what exists
- Planning future multi-source playback
- Supporting open music data

**Next Steps:**
Try searching for your favorite artist and see results from both Spotify and MusicBrainz side-by-side!
