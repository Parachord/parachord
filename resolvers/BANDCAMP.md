# Bandcamp Resolver Integration

## What is Bandcamp?

**Bandcamp** is the #1 platform for independent artists to sell music directly to fans. It's perfect for discovering unique, independent music that often isn't available on major streaming platforms.

### Key Features:
- ✅ **Independent Artists**: Support artists directly
- ✅ **High Quality**: Often lossless audio available
- ✅ **Fair Pricing**: Artists get 80-85% of revenue
- ✅ **Diverse Catalog**: Genres from experimental to mainstream
- ✅ **Direct Links**: Opens tracks in browser for streaming/purchase

---

## What I Added

### 🎵 Bandcamp Search Integration
- Searches Bandcamp's catalog for tracks
- Parses search results from Bandcamp's search page
- Shows cyan "▶ Bandcamp" badge on results
- Clicking opens track in your default browser

### 🎨 Visual Elements
- **Cyan badge**: "▶ Bandcamp" on search results
- **Resolver toggle**: Bandcamp in sidebar (enabled by default)
- **Browser integration**: Opens Bandcamp pages directly

### 🔧 Technical Implementation
- Web scraping of Bandcamp search results
- HTML parsing for track, artist, album info
- External URL launching via Electron shell

---

## How It Works

### Search Flow:
1. **You search** (e.g., "indie rock")
2. **App scrapes** Bandcamp search page
3. **Parses HTML** for track information
4. **Shows results** with cyan Bandcamp badge

### Click to Play:
1. **Click Bandcamp track** in results
2. **Opens in browser** (default web browser)
3. **You can stream** or purchase on Bandcamp
4. **Supports artists directly!**

### Data Format:
```javascript
{
  id: 'bandcamp-1234567890-0',
  title: 'Track Name',
  artist: 'Artist Name',
  album: 'Album Name',
  duration: 210, // 3:30 default
  sources: ['bandcamp'],
  bandcampUrl: 'https://artistname.bandcamp.com/track/...'
}
```

---

## Important Notes

### ⚠️ CORS Limitations
Bandcamp search uses **web scraping** since they don't have a public API. This means:

- **May be blocked by CORS** in some environments
- **Electron handles this better** than regular web browsers
- **Fails gracefully** - other resolvers still work

If Bandcamp search doesn't work:
1. Check browser console for CORS errors
2. Other resolvers (Spotify, MusicBrainz) will still work
3. You can still manually visit bandcamp.com to search

### 🌐 No Direct Playback
Unlike Spotify, Bandcamp tracks **open in your browser**:
- Bandcamp doesn't provide an embed/playback API
- Clicking a track opens the Bandcamp page
- You can then stream or purchase the track
- This supports artists directly!

---

## Usage

### Searching:
1. **Enable Bandcamp** resolver in sidebar (ON by default)
2. **Search** for any artist or track
3. **See cyan badges** for Bandcamp results
4. **Click to open** in browser

### Filtering:
1. **Click badges** in search header to filter
2. **Show/hide** Bandcamp results independently
3. **Mix with other sources** like Spotify

---

## Why Add Bandcamp?

### 1. **Support Independent Artists**
- Buy music directly from artists
- Artists keep 80-85% of revenue
- No middleman taking cuts

### 2. **Discover Unique Music**
- Music not on Spotify/Apple Music
- Experimental, niche, local artists
- Limited releases and rare tracks

### 3. **High Quality Audio**
- Often offers FLAC/lossless
- Better than streaming quality
- You own what you buy

### 4. **Direct Artist Connection**
- Message artists directly
- Get updates on new releases
- Support your favorite creators

---

## Examples

### Search: "chiptune"
**Results might include:**
- 🟢 Spotify: Mainstream chiptune tracks
- 🔵 Bandcamp: Underground chiptune artists
- 🟣 MusicBrainz: Metadata for chiptune recordings

### Search: "your local band name"
**Results might include:**
- 🔵 Bandcamp: Their albums and singles (may be exclusive to Bandcamp!)
- 🟣 MusicBrainz: If they're in the database

### Search: "experimental ambient"
**Results might include:**
- 🔵 Bandcamp: Tons of experimental artists
- 🟢 Spotify: Some mainstream experimental
- Better coverage on Bandcamp for this genre!

---

## Technical Details

### Search Method:
```
1. Fetch: https://bandcamp.com/search?q={query}&item_type=t
2. Parse: HTML response for .searchresult items
3. Extract: Title, artist, album, URL
4. Return: Array of track objects
```

### HTML Structure:
Bandcamp search results contain:
- `.searchresult` - Each result container
- `.heading` - Track title
- `.subhead` - "by Artist, from Album" text
- `.itemurl` - Link to track page

### Parsing Logic:
```javascript
Artist: Extract from "by Artist, from Album"
Album: Extract from "from Album" or default to artist name
URL: Direct link to Bandcamp track page
Duration: Default 3:30 (not available in search)
```

---

## Limitations & Solutions

### ⚠️ Limitation: CORS Blocking
**Problem:** Some environments block cross-origin requests

**Solutions:**
1. Use Electron (handles CORS better)
2. Implement a backend proxy
3. Fails gracefully - doesn't break other resolvers

### ⚠️ Limitation: No Duration Info
**Problem:** Bandcamp search doesn't show track length

**Solution:** Defaults to 3:30 (210 seconds)

### ⚠️ Limitation: No Album Art
**Problem:** Scraping doesn't easily get album covers

**Possible Enhancement:** 
- Parse image URLs from search results
- Fetch album pages for artwork
- Add to track objects

### ⚠️ Limitation: No Direct Playback
**Problem:** Can't play in-app like Spotify

**Why:** 
- Bandcamp doesn't offer playback API
- Embedding requires artist permission
- Opening in browser supports artists better

---

## Future Enhancements

### Possible Improvements:

1. **Album Art Scraping**
   - Parse image URLs from search results
   - Show thumbnails in track list

2. **Backend Proxy**
   - Set up proxy server to avoid CORS
   - More reliable search
   - Could cache results

3. **Bandcamp Daily Integration**
   - Fetch Bandcamp Daily articles
   - Show featured artists/albums
   - Discover section integration

4. **Collection Integration**
   - Login to Bandcamp
   - Show your purchases
   - Play tracks you own

5. **Genre Browsing**
   - Browse by Bandcamp tags
   - Discover new genres
   - "Similar artists" feature

---

## Comparison: Bandcamp vs Other Services

| Feature | Spotify | Bandcamp | MusicBrainz |
|---------|---------|----------|-------------|
| Playback | ✅ In-app | 🌐 Browser | ❌ No |
| Independent Artists | 🟡 Some | ✅ Primary focus | ✅ All music |
| Artist Revenue | 🟡 ~$0.003/stream | ✅ 80-85% of sale | N/A |
| Discovery | ✅ Excellent | ✅ Excellent | 🟡 Metadata only |
| Free Tier | ✅ Yes (ads) | ✅ Streaming | ✅ Always free |
| Purchase | ❌ No | ✅ Yes | ❌ No |
| Quality | 🟡 320kbps | ✅ Up to FLAC | N/A |

---

## Use Cases

### **For Fans:**
- Discover new independent artists
- Support artists directly
- Find music not on streaming
- Buy high-quality downloads

### **For Artists:**
- Get discovered by fans
- Earn fair revenue
- Sell music directly
- Build direct fan relationships

### **For Curators:**
- Find unique music for playlists
- Discover underground scenes
- Support independent music
- Share direct artist links

---

## Settings

### Enable/Disable:
- **Sidebar toggle** for Bandcamp resolver
- **Filter badge** to show/hide results
- **Both enabled by default**

### When Disabled:
- Bandcamp search doesn't run
- Saves search time
- Reduces API calls
- Other resolvers still work

---

## Summary

**Bandcamp integration is complete!** 🎉

### What Works:
- ✅ Search Bandcamp catalog
- ✅ Parse track, artist, album info
- ✅ Show cyan badge on results
- ✅ Open in browser when clicked
- ✅ Independent toggle/filter
- ✅ Graceful CORS handling

### What to Know:
- 🌐 Opens in browser (not in-app playback)
- 💾 May fail due to CORS (fails gracefully)
- 💰 Supports artists directly!
- 🎨 No album art (yet)

### Perfect For:
- Supporting independent artists
- Discovering unique music
- Finding music not on Spotify
- High-quality audio purchases

**Try it:** Search for your favorite indie artist and see Bandcamp results with direct links to support them! 🎵
