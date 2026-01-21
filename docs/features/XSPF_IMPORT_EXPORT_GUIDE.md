# XSPF Playlist Import/Export Guide

## ✅ What's Implemented

Harmonix now has **full XSPF playlist support**:

1. **Auto-load** playlists from `playlists/` folder
2. **Import** external .xspf files
3. **Export** playlists to share or backup
4. **Edit** .xspf files directly and reload

---

## 📁 Directory Structure

```
harmonix-desktop/
├── app.js
├── main.js
├── preload.js
└── playlists/              ← Place your .xspf files here
    ├── my-favorites.xspf
    ├── workout-mix.xspf
    └── chill-vibes.xspf
```

**On app startup**, all `.xspf` files in the `playlists/` folder are automatically loaded.

---

## 🎵 How to Use

### Method 1: Create XSPF Files Manually

1. **Create a file** in `playlists/` folder:
   ```
   harmonix-desktop/playlists/my-mix.xspf
   ```

2. **Add XSPF content:**
   ```xml
   <?xml version="1.0" encoding="UTF-8"?>
   <playlist version="1" xmlns="http://xspf.org/ns/0/">
     <title>My Mix</title>
     <creator>Your Name</creator>
     
     <trackList>
       <track>
         <title>Song Title</title>
         <creator>Artist Name</creator>
         <album>Album Name</album>
         <duration>240000</duration>
       </track>
     </trackList>
   </playlist>
   ```

3. **Restart the app** - Your playlist will appear!

### Method 2: Import Existing XSPF Files

1. Click **"Playlists"** in sidebar
2. Click **"📥 Import Playlist"** button (top right)
3. Select an `.xspf` file from anywhere on your computer
4. File is automatically copied to `playlists/` folder
5. Playlist appears immediately!

### Method 3: Export Your Playlists

1. Open a playlist (click any playlist card)
2. Click **"📤 Export"** button (next to Play)
3. Choose where to save
4. Share the .xspf file with friends!

---

## 📝 XSPF Format Reference

### Basic Structure

```xml
<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <!-- Playlist metadata -->
  <title>Playlist Name</title>
  <creator>Creator Name</creator>
  <annotation>Optional description</annotation>
  <date>2026-01-12T00:00:00Z</date>
  
  <!-- Track list -->
  <trackList>
    <track>
      <title>Track Title</title>
      <creator>Artist Name</creator>
      <album>Album Name</album>
      <duration>240000</duration>  <!-- milliseconds -->
    </track>
    <!-- More tracks... -->
  </trackList>
</playlist>
```

### Required Fields

| Field | Required | Description |
|-------|----------|-------------|
| `<title>` (playlist) | ✅ Yes | Playlist name shown in UI |
| `<creator>` (playlist) | ✅ Yes | Shown under playlist title |
| `<track/title>` | ✅ Yes | Song title for resolution |
| `<track/creator>` | ✅ Yes | Artist name for resolution |
| `<track/album>` | ❌ No | Helps with resolution |
| `<track/duration>` | ❌ No | In milliseconds (240000 = 4:00) |

### Duration Format

**Duration is in milliseconds:**
- 3:00 (3 minutes) = 180000
- 4:30 (4.5 minutes) = 270000
- 2:45 (2 min 45 sec) = 165000

Formula: `(minutes × 60 + seconds) × 1000`

---

## 🔄 Editing Playlists

### Edit Directly in File

1. Open `playlists/my-playlist.xspf` in any text editor
2. Modify the XML:
   - Change `<title>` to rename playlist
   - Add/remove `<track>` elements
   - Update artist/song names
3. **Restart the app** to see changes

### Example Edit

**Before:**
```xml
<track>
  <title>Old Song Name</title>
  <creator>Old Artist</creator>
</track>
```

**After:**
```xml
<track>
  <title>New Song Name</title>
  <creator>New Artist</creator>
  <album>New Album</album>
</track>
```

Restart → Changes appear!

---

## 🎯 Use Cases

### 1. Organize Music by Mood
```
playlists/
├── workout-energy.xspf
├── study-focus.xspf
├── sleep-ambient.xspf
└── party-bangers.xspf
```

### 2. Share with Friends
```bash
# Export playlist
harmonix → Playlists → Open playlist → Export

# Share the .xspf file
Send workout-energy.xspf to friend

# Friend imports
harmonix → Playlists → Import Playlist → Select file
```

### 3. Backup Playlists
```bash
# Copy entire folder
cp -r harmonix-desktop/playlists ~/Backups/

# Restore later
cp -r ~/Backups/playlists harmonix-desktop/
```

### 4. Version Control
```bash
# Track playlists in git
cd harmonix-desktop
git add playlists/*.xspf
git commit -m "Updated playlists"
```

---

## 🔍 How Resolution Works

### When You Open a Playlist:

1. **Parse XSPF** - Extract track metadata
2. **Resolve each track** - Call active resolvers with:
   - Artist name
   - Track title
   - Album name (optional)
3. **Display results** - Show resolver icons for available sources
4. **Play from any source** - Click resolver icon to choose

### Example Resolution:

**Track in XSPF:**
```xml
<track>
  <title>Bohemian Rhapsody</title>
  <creator>Queen</creator>
  <album>A Night at the Opera</album>
</track>
```

**Resolution process:**
```
🔍 Resolving: Queen - Bohemian Rhapsody
  ✅ Spotify: Found match
  ✅ Bandcamp: Found match
  ❌ Qobuz: Not available

UI shows: [♫ Spotify] [🎸 Bandcamp]
```

Click either icon to play from that source!

---

## 🎨 UI Elements

### Playlists View

```
┌─────────────────────────────────────────────┐
│  Playlists                [📥 Import]       │
├─────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  │
│  │  📋     │  │  📋     │  │  📋     │  │
│  │ Workout  │  │ Chill   │  │ Party   │  │
│  │ Mix      │  │ Vibes   │  │ Hits    │  │
│  └──────────┘  └──────────┘  └──────────┘  │
└─────────────────────────────────────────────┘
```

### Playlist Detail View

```
┌──────────────────────────────────────────────────┐
│  📋        PLAYLIST                              │
│  [Icon]    My Workout Mix                        │
│            Created by Me                         │
│            [▶ Play] [📤 Export] [Back]           │
├──────────────────────────────────────────────────┤
│  1  Song Title 1           ♫ 🎸        3:45    │
│  2  Song Title 2           ♫           4:20    │
│  3  Song Title 3           ♫ 🎸 🎵     3:12    │
└──────────────────────────────────────────────────┘
```

---

## 📋 Example Playlists

### Rock Classics
```xml
<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>Rock Classics</title>
  <creator>Music Lover</creator>
  
  <trackList>
    <track>
      <title>Bohemian Rhapsody</title>
      <creator>Queen</creator>
      <album>A Night at the Opera</album>
      <duration>354000</duration>
    </track>
    <track>
      <title>Stairway to Heaven</title>
      <creator>Led Zeppelin</creator>
      <album>Led Zeppelin IV</album>
      <duration>482000</duration>
    </track>
    <track>
      <title>Hotel California</title>
      <creator>Eagles</creator>
      <album>Hotel California</album>
      <duration>391000</duration>
    </track>
  </trackList>
</playlist>
```

### Workout Energy
```xml
<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>Workout Energy</title>
  <creator>Fitness Fan</creator>
  <annotation>High-energy tracks for intense workouts</annotation>
  
  <trackList>
    <track>
      <title>Eye of the Tiger</title>
      <creator>Survivor</creator>
      <album>Eye of the Tiger</album>
      <duration>246000</duration>
    </track>
    <track>
      <title>Thunderstruck</title>
      <creator>AC/DC</creator>
      <album>The Razors Edge</album>
      <duration>292000</duration>
    </track>
  </trackList>
</playlist>
```

---

## 🛠️ Technical Details

### Auto-Loading on Startup

**In `app.js` useEffect:**
```javascript
const loadedPlaylists = await window.electron.playlists.load();
// Returns array of { id, filename, xspf } objects
```

**Main process** (`main.js`):
- Reads `playlists/` directory
- Loads all `.xspf` files
- Returns content to renderer

### Import Process

1. **User clicks Import** → Opens file picker
2. **Select .xspf file** → Reads content
3. **Validate XML** → Ensures valid XSPF
4. **Save to playlists/** → Copies file
5. **Add to state** → Shows immediately in UI

### Export Process

1. **User clicks Export** → Opens save dialog
2. **Choose location** → User picks where to save
3. **Write XSPF** → Saves playlist content
4. **Confirm** → Shows success message

### File Naming

- **ID** = filename without `.xspf`
- Example: `my-mix.xspf` → ID: `my-mix`
- Used for internal tracking

---

## ⚠️ Important Notes

### 1. Restart to See File Changes
**Playlists only load on app startup.** To see manual edits:
```bash
# Edit file
vim playlists/my-playlist.xspf

# Restart app
Ctrl+C
npm start
```

### 2. Filename = Playlist ID
**Don't rename files after import:**
- `workout.xspf` → ID: `workout`
- Renaming breaks the link
- If you must rename, restart app

### 3. UTF-8 Encoding
**Always use UTF-8 for .xspf files:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
```

Special characters (é, ñ, 中) work correctly.

### 4. Duration Optional
**Duration not required for resolution:**
- Used only for display
- Resolution uses artist/title/album
- Can be omitted or set to 0

---

## 🐛 Troubleshooting

### Playlist Not Appearing

**Check:**
1. File is in `harmonix-desktop/playlists/`
2. File ends with `.xspf`
3. XML is valid (open in browser to test)
4. App was restarted after adding file

### Import Failed

**Error: "Not a valid XSPF playlist file"**
- File must contain `<playlist>` and `</playlist>` tags
- Must be valid XML
- Check for typos in tags

### Tracks Not Resolving

**Tracks show "Resolving..." forever:**
- Check resolver is enabled
- Verify artist/track names are correct
- Try different spelling or simpler names
- Some tracks may not be available on all services

### Export Button Greyed Out

**Can't click Export:**
- This shouldn't happen - report if it does!

---

## 🚀 Advanced Tips

### 1. Bulk Create Playlists

```python
# Python script to generate XSPF
import json

tracks = [
    {"title": "Song 1", "artist": "Artist 1", "album": "Album 1"},
    {"title": "Song 2", "artist": "Artist 2", "album": "Album 2"},
]

xspf = """<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>Generated Playlist</title>
  <creator>Script</creator>
  <trackList>
"""

for track in tracks:
    xspf += f"""    <track>
      <title>{track['title']}</title>
      <creator>{track['artist']}</creator>
      <album>{track['album']}</album>
    </track>
"""

xspf += """  </trackList>
</playlist>"""

with open("playlists/generated.xspf", "w") as f:
    f.write(xspf)
```

### 2. Convert from Other Formats

Many tools can convert to XSPF:
- VLC Media Player
- Amarok
- foobar2000
- Online converters

### 3. Sync Across Devices

```bash
# Use Dropbox/iCloud/Google Drive
ln -s ~/Dropbox/harmonix-playlists harmonix-desktop/playlists

# Now playlists sync automatically!
```

---

## 📊 Comparison with Other Formats

| Format | Harmonix Support | Notes |
|--------|------------------|-------|
| **XSPF** | ✅ Full support | Open standard, recommended |
| **M3U** | ❌ Not supported | URL-based, not metadata |
| **PLS** | ❌ Not supported | URL-based, not metadata |
| **JSON** | ❌ Not supported | No standard format |

**Why XSPF?**
- Open W3C standard
- Metadata-based (not URLs)
- Service-agnostic
- Human-readable XML
- Widely supported

---

## 🎉 Summary

✅ **Auto-load** from `playlists/` folder
✅ **Import** external .xspf files with dialog
✅ **Export** to share or backup
✅ **Edit** files directly
✅ **Multi-source** resolution
✅ **Standard format** (XSPF)

**Get Started:**
```bash
1. Create playlists/ folder
2. Add .xspf files
3. Restart app
4. Enjoy your playlists!
```

🎵 **Happy listening!**
