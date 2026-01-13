# Fixed: Resolvers Not Loading from Disk ✅

## The Problem

The .axe files WERE in the correct location (`resolvers/builtin/`), but the app couldn't load them because:

1. **App used `fetch()`** to load files
2. **`fetch()` doesn't work for local filesystem** in Electron
3. **Needed IPC bridge** to access files from main process

## The Root Cause

In Electron:
- **Renderer process** (app.js) - Can't access filesystem directly
- **Main process** (main.js) - Has full Node.js/filesystem access
- **Need IPC** to bridge between them

```javascript
// ❌ This doesn't work in Electron:
const response = await fetch('resolvers/builtin/spotify.axe');

// ✅ This works:
const resolvers = await window.electron.resolvers.loadBuiltin();
```

## The Solution

### 1. Updated `preload.js` - Expose Resolver Loading
```javascript
// Added to preload.js
resolvers: {
  loadBuiltin: () => ipcRenderer.invoke('resolvers-load-builtin')
}
```

### 2. Updated `main.js` - Add IPC Handler
```javascript
// Added to main.js
ipcMain.handle('resolvers-load-builtin', async () => {
  const fs = require('fs').promises;
  const path = require('path');
  
  const resolversDir = path.join(__dirname, 'resolvers', 'builtin');
  const resolvers = [];
  
  for (const filename of ['spotify.axe', 'bandcamp.axe', ...]) {
    const filepath = path.join(resolversDir, filename);
    const content = await fs.readFile(filepath, 'utf8');
    const axe = JSON.parse(content);
    resolvers.push(axe);
  }
  
  return resolvers;
});
```

### 3. Updated `app.js` - Use IPC Instead of Fetch
```javascript
// Updated loadBuiltinResolvers()
const loadBuiltinResolvers = async () => {
  if (window.electron?.resolvers?.loadBuiltin) {
    // ✅ Use Electron IPC
    return await window.electron.resolvers.loadBuiltin();
  } else {
    // Fallback to fetch for web/dev
    return await fetchResolvers();
  }
};
```

## How It Works Now

```
┌─────────────────────────────────────────────┐
│ Renderer Process (app.js)                   │
│                                             │
│  loadBuiltinResolvers()                    │
│     ↓                                       │
│  window.electron.resolvers.loadBuiltin()   │
└──────────────┬──────────────────────────────┘
               │ IPC
               ↓
┌─────────────────────────────────────────────┐
│ Main Process (main.js)                      │
│                                             │
│  ipcMain.handle('resolvers-load-builtin')  │
│     ↓                                       │
│  fs.readFile('resolvers/builtin/*.axe')   │
│     ↓                                       │
│  JSON.parse(content)                       │
│     ↓                                       │
│  return [spotify, bandcamp, qobuz, ...]    │
└──────────────┬──────────────────────────────┘
               │ IPC Response
               ↓
┌─────────────────────────────────────────────┐
│ Renderer Process (app.js)                   │
│                                             │
│  resolverLoader.loadResolvers(resolvers)   │
│  ✅ Resolvers loaded!                       │
└─────────────────────────────────────────────┘
```

## Expected Console Output

```
=== Load Builtin Resolvers ===
Loading resolvers from: /path/to/harmonix-desktop/resolvers/builtin
  Reading spotify.axe...
  ✅ Loaded Spotify
  Reading bandcamp.axe...
  ✅ Loaded Bandcamp
  Reading qobuz.axe...
  ✅ Loaded Qobuz
  Reading musicbrainz.axe...
  ✅ Loaded MusicBrainz
✅ Loaded 4 resolver(s) from disk

🔌 Initializing resolver plugin system...
📁 Loading resolvers via Electron IPC...
✅ Loaded 4 .axe files from disk
✅ Loaded 4 resolver plugins: Spotify, Bandcamp, Qobuz, MusicBrainz
```

## Files Updated

### ✅ preload.js
- Added `resolvers.loadBuiltin()` method

### ✅ main.js  
- Added `resolvers-load-builtin` IPC handler
- Reads .axe files from filesystem
- Returns parsed JSON to renderer

### ✅ app.js
- Updated `loadBuiltinResolvers()` to use IPC
- Falls back to fetch for non-Electron environments
- Still has embedded fallback resolvers as backup

## Benefits

✅ **Reads from actual filesystem** - Not HTTP requests
✅ **Works in Electron** - Uses proper IPC bridge
✅ **Secure** - Goes through preload context bridge
✅ **Has fallback** - Still works if .axe files missing
✅ **Debuggable** - Clear console output

## Testing

```bash
# 1. Update all 3 files
cp app.js main.js preload.js /path/to/harmonix-desktop/

# 2. Restart app
npm start

# 3. Check console - should show:
# ✅ Loaded 4 resolver(s) from disk
# ✅ Loaded 4 resolver plugins
```

## Troubleshooting

### Still seeing 404 errors?
- Make sure you updated ALL 3 files (app.js, main.js, preload.js)
- Restart Electron completely (not just refresh)

### Seeing "ResolverLoader not found"?
- Make sure resolver-loader.js is loaded in index.html
- Check browser console for script errors

### Seeing "Using embedded fallback resolvers"?
- IPC call failed or returned empty array
- Check main process console (terminal, not browser)
- Verify .axe files exist and are valid JSON

## Summary

The issue was **how** the files were being loaded, not **where** they were.

- **Before:** `fetch()` → 404 errors → files not loaded
- **After:** Electron IPC → filesystem access → ✅ files loaded

Now your resolvers will actually load from the `resolvers/builtin/` directory! 🎉
