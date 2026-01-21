# Quick Start: Playlists

## 🎵 Try the Test Playlist

1. **Start the app**
   ```bash
   npm start
   ```

2. **Navigate to Playlists**
   - Click "**Playlists**" in the left sidebar

3. **Open the test playlist**
   - Click on "**Quarantine Angst Mix**" card

4. **Watch tracks resolve**
   - Tracks will appear progressively
   - See which resolvers found each track
   - Console shows resolution progress

5. **Play!**
   - Click the purple "**Play**" button, or
   - Click individual resolver icons to play from specific source

## 📋 What You'll See

### Playlists View
```
┌─────────────────────────────────────┐
│  📋                                 │
│  Quarantine Angst Mix               │
│  Harmonix User                      │
└─────────────────────────────────────┘
```

### Playlist Detail View
```
┌──────────────────────────────────────────────────────────┐
│  📋        PLAYLIST                                       │
│  [Icon]    Quarantine Angst Mix                          │
│            Created by Harmonix User                      │
│            [Play] [Back to Playlists]                    │
├──────────────────────────────────────────────────────────┤
│  1  Isolation Blues                  ♫ 🎸      4:00     │
│     Quarantine Angst                                     │
│                                                          │
│  2  Social Distance                  ♫ 🎸      3:15     │
│     Quarantine Angst                                     │
│                                                          │
│  3  Cabin Fever                      ♫ 🎸      3:38     │
│     Quarantine Angst                                     │
│                                                          │
│  ...                                                     │
└──────────────────────────────────────────────────────────┘
```

## 🔍 Console Output

```
📋 Loaded test playlist: Quarantine Angst Mix
📋 Loading playlist: Quarantine Angst Mix
🎵 Parsed 5 tracks from XSPF
🔍 Resolving: Quarantine Angst - Isolation Blues
  ✅ Spotify: Found match
  ✅ Bandcamp: Found match
🔍 Resolving: Quarantine Angst - Social Distance
  ✅ Spotify: Found match
  ✅ Bandcamp: Found match
...
✅ Resolved 5 tracks
```

## 🎯 Features to Try

### 1. Progressive Loading
- Watch tracks appear one by one
- No waiting for full resolution
- Real-time UI updates

### 2. Multi-Source Playback
- Each track shows available sources
- Click resolver icons to choose source
- Spotify: ♫, Bandcamp: 🎸, Qobuz: 🎵

### 3. Source Selection
- Click "Play" = Uses default (first resolver)
- Click resolver icon = Play from that specific source

## 📝 Tracks in Test Playlist

1. **Isolation Blues** - Songs from the Lockdown (4:00)
2. **Social Distance** - Songs from the Lockdown (3:15)
3. **Cabin Fever** - Pandemic Sessions (3:38)
4. **Zoom Fatigue** - Pandemic Sessions (3:23)
5. **Essential Worker** - 2020 Vision (4:16)

All tracks by **Quarantine Angst**.

## 🛠️ Technical Details

### How It Works
1. XSPF file embedded in app.js
2. On load: Parsed to extract metadata
3. For each track: Calls `resolver.resolve(artist, title, album)`
4. Stores results: `track.sources[resolverId] = resolvedTrack`
5. UI updates: Shows resolver icons for available sources

### What Gets Resolved
- **Artist**: "Quarantine Angst"
- **Title**: Track name (e.g., "Isolation Blues")
- **Album**: Album name (e.g., "Songs from the Lockdown")

### Resolution Logic
```javascript
for (const track of playlist.tracks) {
  for (const resolver of activeResolvers) {
    const result = await resolver.resolve(
      track.artist, 
      track.title, 
      track.album
    );
    if (result) {
      track.sources[resolverId] = result;
    }
  }
}
```

## 🎨 UI Components

### Playlist Card
- Gradient icon (📋)
- Playlist title
- Creator name
- Hover effect

### Playlist Header
- Large icon
- Playlist metadata
- Play button
- Back button

### Track Row
- Track number
- Title & artist
- Album name
- Resolver icons (clickable)
- Duration

## 💡 Tips

### Enable More Resolvers
More resolvers = More sources per track
- Go to Settings
- Enable Spotify, Bandcamp, Qobuz
- More icons will appear on tracks

### Check Console
Watch resolution progress:
- Which resolvers found each track
- Resolution time
- Success/failure status

### Try Different Sources
- Click different resolver icons
- Compare audio quality
- Some may have better matches

## 🔮 Coming Soon

- **Create playlists** - From search results
- **Edit playlists** - Add/remove/reorder tracks
- **Import XSPF** - Load external playlist files
- **Export playlists** - Share with others
- **Playlist folders** - Organize collections

## 🐛 Troubleshooting

### "Resolving..." Never Finishes
- Enable at least one resolver
- Check resolver authentication (Spotify needs login)
- Verify resolver is active (toggle in Settings)

### No Tracks Showing
- Wait a few seconds for resolution
- Check console for errors
- Try refreshing the page

### Can't Click Play
- Wait for at least one track to resolve
- Ensure resolver found a match
- Check console: Should see "✅ Found match"

## 🎸 Ready to Try!

```bash
# Start the app
npm start

# Click: Playlists → Quarantine Angst Mix → Play!
```

Enjoy! 🎵
