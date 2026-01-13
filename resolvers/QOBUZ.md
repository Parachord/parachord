# Qobuz Resolver Integration

## What is Qobuz?

**Qobuz** is a premium music streaming and download service focused on **high-fidelity audio**. It offers:
- 🎵 **CD Quality** (16-bit/44.1kHz FLAC) streaming
- 💎 **Hi-Res Audio** up to 24-bit/192kHz
- 📚 **Extensive catalog** with focus on jazz, classical, and audiophile music
- 📝 **Editorial content** and artist interviews
- 💿 **Purchase & download** tracks and albums

---

## ✨ What I Implemented

### 🔍 Search Integration
- Searches Qobuz catalog via their public API
- Returns track metadata including quality information
- Shows album artwork from Qobuz
- Indicates Hi-Res quality (24-bit/192kHz)

### 🎵 Preview Playback
- Plays **30-second previews** directly in the app
- No authentication needed for previews
- HTML5 Audio element for streaming
- Volume control integrated

### 🎨 Visual Elements
- **Blue badge**: "◆ Qobuz" on search results
- **Resolver toggle**: Qobuz in sidebar (enabled by default)
- Shows audio quality info (CD Quality, Hi-Res, etc.)

---

## 🎯 How It Works

### Search Flow:
1. **You search** (e.g., "Miles Davis")
2. **App queries** Qobuz API
3. **Returns results** with quality indicators
4. **Shows blue badge** for Qobuz tracks

### Playback:
1. **Click Qobuz track** in results
2. **Plays 30-second preview** in-app
3. **Auto-advances** to next track when preview ends
4. **Full tracks** require Qobuz subscription (not implemented yet)

### Data Format:
```javascript
{
  id: 'qobuz-12345',
  title: 'So What',
  artist: 'Miles Davis',
  album: 'Kind of Blue',
  duration: 562,
  sources: ['qobuz'],
  qobuzId: 12345,
  albumArt: 'https://...',
  previewUrl: 'https://sample.qobuz.com/...',
  streamable: true,
  quality: '24bit/96kHz' // or 'CD Quality'
}
```

---

## ⚡ Current Implementation

### ✅ Working:
- Search Qobuz catalog
- Display results with artwork
- Show quality information
- Play 30-second previews
- Volume control
- Auto-advance to next track

### ⏳ Not Implemented (Yet):
- Full track streaming (requires subscription)
- User authentication
- Favorites/playlists
- Purchase links
- Hi-Res indicator in UI

---

## 🔐 API Credentials

### Current Setup:
The app uses Qobuz's **public demo app_id**: `285473059`

This allows:
- ✅ Searching the catalog
- ✅ Playing 30-second previews
- ✅ Viewing metadata

This doesn't allow:
- ❌ Full track streaming
- ❌ User authentication
- ❌ Favorites access

### For Production:
To enable full features, you need your own credentials:

1. Go to: https://github.com/Qobuz/api-documentation
2. Request API access from Qobuz
3. Get your `app_id` and `secret`
4. Add to `.env`:
   ```bash
   QOBUZ_APP_ID=your_app_id_here
   QOBUZ_SECRET=your_secret_here
   ```

**Note:** Qobuz API access requires approval and may have restrictions.

---

## 🎵 Audio Quality

Qobuz is known for high-quality audio:

| Quality Level | Bit Depth | Sample Rate | File Size |
|---------------|-----------|-------------|-----------|
| MP3 | N/A | 320kbps | Small |
| CD Quality | 16-bit | 44.1kHz | ~30MB/album |
| Hi-Res | 24-bit | 96kHz | ~80MB/album |
| Studio Master | 24-bit | 192kHz | ~150MB/album |

The search results include quality indicators so you know what you're getting!

---

## 🎨 UI Elements

### Badge:
- **Color:** Blue (#0E7EBF)
- **Icon:** "◆ Qobuz"
- **Location:** Next to artist name in results

### Quality Indicator:
Shows in track metadata:
- "CD Quality" for 16-bit/44.1kHz
- "24bit/96kHz" for Hi-Res
- "24bit/192kHz" for Studio Master

---

## 🔧 Technical Details

### API Endpoint:
```
GET https://www.qobuz.com/api.json/0.2/track/search
?query={search_query}
&limit=20
&app_id={app_id}
```

### Preview Streaming:
- Uses HTML5 Audio element
- Streams from Qobuz CDN
- 30-second samples
- No authentication required

### Response Format:
```json
{
  "tracks": {
    "items": [
      {
        "id": 12345,
        "title": "Track Name",
        "performer": {"name": "Artist"},
        "album": {
          "title": "Album Name",
          "image": {
            "small": "url",
            "thumbnail": "url"
          }
        },
        "duration": 300,
        "preview_url": "https://...",
        "streamable": true,
        "maximum_bit_depth": 24,
        "maximum_sampling_rate": 96
      }
    ]
  }
}
```

---

## 🎧 Use Cases

### Perfect For:
- **Audiophiles** - Hi-Res quality
- **Jazz fans** - Extensive jazz catalog
- **Classical music** - Great classical selection
- **Quality seekers** - Better than MP3/streaming
- **Music collectors** - Purchase & own tracks

### Examples:

**Search: "Coltrane"**
- Results: Jazz albums with Hi-Res quality
- Play: 30-second previews
- Quality: See "24bit/96kHz" indicators

**Search: "Mozart Symphony"**
- Results: Classical recordings
- Multiple versions with different orchestras
- Quality info for each version

**Search: "Indie artist"**
- May not have as many results (Qobuz focuses on quality over quantity)
- Better coverage for established artists

---

## ⚠️ Limitations

### 1. **Preview Only (for now)**
- Only 30-second previews play in-app
- Full streaming requires:
  - Qobuz subscription
  - User authentication
  - Implementation of streaming API

### 2. **API Rate Limits**
- Public demo app_id may have rate limits
- Get your own credentials for production

### 3. **Catalog Coverage**
- Strong on: Jazz, Classical, Audiophile recordings
- Weaker on: Pop, Hip-Hop, Latest releases
- Smaller catalog than Spotify

### 4. **Authentication Not Implemented**
- Can't access user's favorites
- Can't stream full tracks (yet)
- Can't save preferences

---

## 🚀 Future Enhancements

### Possible Additions:

1. **Full Track Streaming**
   - Implement user authentication
   - Stream complete tracks (requires subscription)
   - Maintain playback state

2. **Hi-Res Indicator**
   - Badge showing "Hi-Res" in UI
   - Color-coded quality levels
   - Bit depth/sample rate in tooltip

3. **Purchase Links**
   - Link to buy tracks/albums on Qobuz
   - Show prices
   - One-click purchase

4. **Favorites Integration**
   - Sync with Qobuz favorites
   - Save tracks to Qobuz
   - Playlist integration

5. **Quality Settings**
   - User preference for quality level
   - Bandwidth-aware quality selection
   - Download for offline playback

---

## 📊 Comparison: Qobuz vs Others

| Feature | Spotify | Qobuz | MusicBrainz |
|---------|---------|-------|-------------|
| Search | ✅ Fast | ✅ Fast | ✅ Fast |
| Playback | ✅ Full (Premium) | ⚠️ Preview only | ❌ None |
| Quality | 🟡 320kbps | ✅ Hi-Res (24-bit) | N/A |
| Catalog | 🟢 Huge | 🟡 Curated | 🟢 Huge |
| Price | $9.99/mo | $12.99/mo (Studio) | Free |
| Focus | Pop/Mainstream | Audiophile/Jazz | Metadata |
| API Access | ✅ Free | ⚠️ Requires approval | ✅ Free |

---

## 🔧 Configuration

### Enable/Disable:
- **Sidebar toggle** for Qobuz resolver
- **Filter badge** to show/hide results
- **Enabled by default**

### .env Settings:
```bash
# Use public demo (current)
QOBUZ_APP_ID=285473059

# Or use your own (future)
QOBUZ_APP_ID=your_app_id
QOBUZ_SECRET=your_secret
```

---

## 🐛 Troubleshooting

### No Qobuz Results:
**Problem:** Search returns no Qobuz tracks

**Solutions:**
1. Check console for API errors
2. Try different search terms
3. Qobuz has smaller catalog - normal for some artists
4. API rate limit may be reached

### Preview Won't Play:
**Problem:** 30-second preview doesn't play

**Solutions:**
1. Check browser console for errors
2. Make sure track has `previewUrl`
3. Network may be blocking Qobuz CDN
4. Try different track

### "Qobuz is not defined" Error:
**Problem:** Resolver not loading

**Solutions:**
1. Make sure Qobuz is in active resolvers list
2. Check app.js has `searchQobuz` function
3. Restart app
4. Clear cache

---

## 💡 Tips

### Best Search Practices:
- **Use artist names** for best results
- **Try album names** for specific releases
- **Search jazz/classical** for best coverage
- **Look for "Hi-Res" quality** indicators

### For Audiophiles:
- Qobuz results show quality level
- Look for "24bit/96kHz" or higher
- Preview quality is lower (for bandwidth)
- Full quality requires subscription

---

## 📚 Resources

- **Qobuz Website:** https://www.qobuz.com
- **API Documentation:** https://github.com/Qobuz/api-documentation
- **Quality Guide:** https://www.qobuz.com/us-en/page/about-hi-res
- **Pricing:** https://www.qobuz.com/us-en/discover/subscription

---

## 🎉 Summary

**Qobuz resolver is now integrated!**

### What Works:
- ✅ Search Qobuz catalog
- ✅ Display with album art
- ✅ Show quality indicators
- ✅ Play 30-second previews
- ✅ Independent toggle/filter
- ✅ Volume control

### What's Next:
- Full track streaming (requires subscription auth)
- Hi-Res badge in UI
- Purchase links
- Favorites sync

**Perfect for:** High-quality music lovers, jazz/classical fans, and audiophiles who want better-than-Spotify quality!

Try searching for "Miles Davis" or "Mozart" to see Hi-Res Qobuz results! 🎵
