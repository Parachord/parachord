# Quick Guide: Installing Resolvers

## How to Install a New Resolver

### Step 1: Get a .axe File
Download a resolver from:
- Community repository (future)
- Friend/colleague
- Create your own (see AXE_FORMAT_SPEC.md)

### Step 2: Open Settings
Click the **⚙️ Settings** icon in the app

### Step 3: Click "Install New Resolver"
Scroll down to the bottom of the resolver list and click the purple button:
```
┌───────────────────────────────┐
│ 📦 Install New Resolver      │
└───────────────────────────────┘
```

### Step 4: Select Your File
1. File picker dialog opens
2. Navigate to your .axe file
3. Select it and click "Install"

### Step 5: Done!
The app will:
- ✅ Validate the file
- ✅ Install to `resolvers/user/`
- ✅ Show success message
- ✅ Auto-reload

Your new resolver is now active! 🎉

## Example Resolvers to Install

### YouTube Resolver (Future)
- Search YouTube for music videos
- Stream directly in app
- Access official music videos

### SoundCloud Resolver (Future)
- Browse SoundCloud tracks
- Stream independent artists
- Discover new music

### Tidal Resolver (Future)
- High-fidelity audio streaming
- Exclusive content
- Hi-Res audio support

## Creating Your Own Resolver

See `AXE_FORMAT_SPEC.md` for full documentation.

Basic template:
```json
{
  "manifest": {
    "id": "my-resolver",
    "name": "My Resolver",
    "version": "1.0.0",
    "icon": "🎵",
    "color": "#FF5500"
  },
  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": true
  },
  "implementation": {
    "search": "async function(query, config) { ... }",
    "resolve": "async function(artist, track, album, config) { ... }",
    "play": "async function(track, config) { ... }"
  }
}
```

Save as `my-resolver.axe` and install!

## Troubleshooting

### "Invalid .axe file"
- Make sure it's valid JSON
- Check it has `manifest.id` and `manifest.name`
- Validate with: `cat file.axe | jq`

### "Already installed"
- Click "Yes" to overwrite
- Or rename your .axe file to install side-by-side

### "Permission denied"
- Make sure app has write access to its directory
- Try running as administrator (not recommended normally)

### Resolver doesn't appear
- Check it installed: `ls resolvers/user/`
- Check console for errors
- Make sure app reloaded

## Uninstalling Resolvers

To remove a user-installed resolver:
```bash
rm resolvers/user/youtube.axe
```

Then restart the app.

## Sharing Resolvers

To share a resolver with someone:
1. Find it in `resolvers/user/youtube.axe`
2. Send them the .axe file
3. They use "Install New Resolver" button
4. Done!

## Where Are Resolvers Stored?

```
parachord/
└── resolvers/
    ├── builtin/    ← Built-in (don't modify)
    └── user/       ← Your installed resolvers
```

User resolvers persist across app updates!

## Tips

💡 **Organize by source**: Name resolvers clearly (e.g., `youtube-official.axe`, `youtube-music.axe`)

💡 **Version control**: Keep .axe files in a separate folder for easy reinstall

💡 **Share configs**: If a resolver needs config (API keys), share instructions with the .axe file

💡 **Test before sharing**: Make sure your resolver works before sharing it

## Coming Soon

🔮 **Resolver marketplace** - Browse and install from online repository
🔮 **Auto-updates** - Get notified when resolvers have updates
🔮 **Resolver manager** - Enable/disable/uninstall from UI
🔮 **Import/Export** - Share resolver sets with one click

---

Happy resolving! 🎸
