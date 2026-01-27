# Quick Start Commands

## 1. Setup Directory Structure

```bash
cd ~/path/to/parachord

# Create directories
mkdir -p resolvers/builtin
mkdir -p resolvers/user
```

## 2. Copy .axe Files

```bash
# If you have the .axe files downloaded to ~/Downloads:
cp ~/Downloads/spotify.axe resolvers/builtin/
cp ~/Downloads/bandcamp.axe resolvers/builtin/
cp ~/Downloads/qobuz.axe resolvers/builtin/
cp ~/Downloads/musicbrainz.axe resolvers/builtin/

# Or copy all at once:
cp ~/Downloads/*.axe resolvers/builtin/
```

## 3. Verify Files

```bash
ls -la resolvers/builtin/
# Should show:
# spotify.axe
# bandcamp.axe
# qobuz.axe
# musicbrainz.axe
```

## 4. Update app.js

Replace your current `app.js` with the new refactored version.

## 5. Start the App

```bash
npm start
```

## Expected Output

```
🔌 Initializing resolver plugin system...
📁 Loading resolver .axe files from resolvers/builtin/...
✅ Loaded Spotify resolver from resolvers/builtin/spotify.axe
✅ Loaded Bandcamp resolver from resolvers/builtin/bandcamp.axe
✅ Loaded Qobuz resolver from resolvers/builtin/qobuz.axe
✅ Loaded MusicBrainz resolver from resolvers/builtin/musicbrainz.axe
✅ Loaded 4 resolver plugins: Spotify, Bandcamp, Qobuz, MusicBrainz
```

## Troubleshooting

### If you see: "Failed to load resolvers/builtin/spotify.axe: 404"

Check file locations:
```bash
pwd  # Should be in parachord
ls resolvers/builtin/  # Should show .axe files
```

### If you see: "No resolvers loaded!"

Verify .axe files are valid JSON:
```bash
cat resolvers/builtin/spotify.axe | head -5
# Should show JSON like:
# {
#   "manifest": {
#     "id": "spotify",
```

## All Set! 🎉

Your resolver system is now fully modular. You can:
- ✅ Update any resolver by editing its .axe file
- ✅ Add new resolvers by creating new .axe files
- ✅ Share resolvers with others
- ✅ No need to touch app.js for resolver changes!
