# Quick Setup: XSPF Playlists

## 🚀 Get Started in 3 Steps

### Step 1: Create the Playlists Folder
```bash
cd harmonix-desktop
mkdir playlists
```

### Step 2: Add Your Edited XSPF File
```bash
# Copy your edited quarantine-angst-mix.xspf file
cp ~/path/to/your/quarantine-angst-mix.xspf playlists/
```

Or create a new one:
```bash
# Create a new playlist
cat > playlists/my-playlist.xspf << 'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <title>My Playlist</title>
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
EOF
```

### Step 3: Start the App
```bash
npm start
```

Your playlists will automatically load! 🎵

---

## 📋 Using the UI

### Import a Playlist
1. Click **"Playlists"** in sidebar
2. Click **"📥 Import Playlist"** button (top right)
3. Select your .xspf file
4. Done! It's automatically saved to `playlists/` folder

### Export a Playlist
1. Open any playlist (click the card)
2. Click **"📤 Export"** button
3. Choose where to save
4. Share with friends!

---

## 🎯 What You Asked For

You wanted to **load and save XSPF playlists**. Here's what you can now do:

✅ **Load from files** - Put .xspf files in `playlists/` folder
✅ **Import via UI** - Click Import button to add playlists
✅ **Export via UI** - Click Export to save/share playlists
✅ **Edit files** - Modify .xspf files directly, restart to see changes
✅ **Auto-load** - All playlists load automatically on startup

---

## 📝 Example: Your Edited Playlist

If you edited `quarantine-angst-mix.xspf` with real song titles:

```bash
# 1. Place it in playlists folder
cp quarantine-angst-mix.xspf harmonix-desktop/playlists/

# 2. Restart app
cd harmonix-desktop
npm start

# 3. It will load automatically with your real songs!
```

---

## 🔄 Workflow

### Daily Use:
1. **Open app** → Playlists auto-load
2. **Click playlist** → Tracks resolve
3. **Click Play** → Enjoy!

### Adding Playlists:
- **Option A:** Use Import button (GUI)
- **Option B:** Drop .xspf in `playlists/` folder, restart

### Editing Playlists:
- **Option A:** Export → Edit → Import
- **Option B:** Edit file in `playlists/` directly, restart

### Sharing:
- Click Export
- Send .xspf file
- Friend clicks Import

---

## 🎵 Ready to Go!

Your edited XSPF file with real song titles will now load properly. Just:

1. Copy it to `harmonix-desktop/playlists/`
2. Restart the app
3. Click the playlist
4. Watch it resolve your real songs!

**Enjoy! 🎸**
