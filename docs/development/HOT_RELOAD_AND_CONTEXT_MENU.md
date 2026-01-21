# Hot-Reload Resolvers & Right-Click Uninstall ✅

## New Features

### 🔥 Hot-Reload Installation
Install resolvers **without restarting the app!** New resolvers are loaded instantly.

### 🗑️ Right-Click Context Menu
Right-click any user-installed resolver to uninstall it. No app restart needed!

### 📦 User-Installed Badge
User-installed resolvers now show a blue "📦 User" badge so you know which ones you can uninstall.

---

## How to Use

### Installing a Resolver (Hot-Reload)

**Before:**
```
1. Click "Install New Resolver"
2. Select .axe file
3. ⚠️ App restarts automatically
4. Wait for reload...
```

**After:**
```
1. Click "Install New Resolver"
2. Select .axe file  
3. ✅ Instant! No restart needed!
4. Resolver appears immediately
```

### Uninstalling a Resolver (Right-Click)

**Steps:**
1. Open Settings (⚙️)
2. **Right-click** on any user-installed resolver (has blue "📦 User" badge)
3. Click "Uninstall Resolver" from context menu
4. Confirm deletion
5. ✅ Resolver removed instantly!

**Visual:**
```
┌────────────────────────────────┐
│ ⋮⋮ 5 📺 YouTube  📦 User      │ ← Right-click here!
└────────────────────────────────┘
         ↓
   ┌────────────────┐
   │ Uninstall      │
   │ Resolver       │
   └────────────────┘
```

---

## User Interface Changes

### Resolver List - Before
```
⋮⋮ 1 ♫ Spotify               🔑 Auth Required
⋮⋮ 2 🎸 Bandcamp
⋮⋮ 3 🎵 Qobuz
⋮⋮ 4 📚 MusicBrainz
```

### Resolver List - After
```
⋮⋮ 1 ♫ Spotify               🔑 Auth Required
⋮⋮ 2 🎸 Bandcamp
⋮⋮ 3 🎵 Qobuz
⋮⋮ 4 📚 MusicBrainz
⋮⋮ 5 📺 YouTube     📦 User   ← New badge!
⋮⋮ 6 ☁️ SoundCloud  📦 User   ← Right-click to uninstall
```

---

## Technical Implementation

### Hot-Reload Install

**Old Flow:**
```
Install → Save to disk → Reload entire app → Load all resolvers
```

**New Flow:**
```
Install → Save to disk → Load single resolver → Add to state → Done!
```

**Code:**
```javascript
// Old (required restart)
await window.electron.resolvers.install(content, filename);
window.location.reload(); // ❌ Full page reload

// New (hot-reload)
await window.electron.resolvers.install(content, filename);
const newResolver = await resolverLoader.current.loadResolver(axe);
setLoadedResolvers(prev => [...prev, newResolver]); // ✅ Instant!
```

### Hot-Reload Uninstall

**Flow:**
```
Right-click → Context menu → Confirm → Delete file → Remove from state → Done!
```

**Code:**
```javascript
const handleUninstallResolver = async (resolverId) => {
  // Delete from disk
  await window.electron.resolvers.uninstall(resolverId);
  
  // Remove from state (no reload!)
  setLoadedResolvers(prev => prev.filter(r => r.id !== resolverId));
  setResolverOrder(prev => prev.filter(id => id !== resolverId));
  setActiveResolvers(prev => prev.filter(id => id !== resolverId));
};
```

### Context Menu (Native)

**Main Process (main.js):**
```javascript
const { Menu } = require('electron');

const menu = Menu.buildFromTemplate([
  {
    label: 'Uninstall Resolver',
    click: () => {
      mainWindow.webContents.send('resolver-context-menu-action', {
        action: 'uninstall',
        resolverId: resolverId
      });
    }
  }
]);

menu.popup({ window: mainWindow });
```

**Renderer Process (app.js):**
```javascript
// Listen for context menu actions
useEffect(() => {
  window.electron.resolvers.onContextMenuAction(async (data) => {
    if (data.action === 'uninstall') {
      await handleUninstallResolver(data.resolverId);
    }
  });
}, []);

// Right-click handler on resolver item
onContextMenu: (e) => {
  e.preventDefault();
  if (resolver._userInstalled) {
    window.electron.resolvers.showContextMenu(resolver.id, true);
  }
}
```

### User-Installed Tracking

**Metadata Added:**
```javascript
// When loading resolvers
axe._userInstalled = true;  // User-installed
axe._filename = 'youtube.axe';

// Or
axe._userInstalled = false; // Built-in
axe._filename = 'spotify.axe';
```

**UI Badge:**
```javascript
resolver._userInstalled && React.createElement('span', {
  className: 'text-xs px-2 py-0.5 bg-blue-900/30 text-blue-400 rounded-full',
  title: 'User-installed resolver (right-click to uninstall)'
}, '📦 User')
```

---

## Console Output

### Installing (Hot-Reload)
```
📦 Opening file picker for resolver...
Installing resolver: YouTube
✅ Installed YouTube
➕ Added resolver: YouTube
[Alert] ✅ Successfully installed "YouTube"!

# No page reload! App continues running.
```

### Updating Existing
```
Installing resolver: YouTube
✅ Installed YouTube
🔄 Updated resolver: YouTube
[Alert] ✅ Successfully updated "YouTube"!
```

### Uninstalling (Hot-Reload)
```
🗑️ Uninstalling resolver: YouTube
✅ Uninstalled YouTube
[Alert] ✅ Successfully uninstalled "YouTube"!

# Resolver disappears from list instantly!
```

---

## Files Modified

### ✅ app.js
**Added:**
- `handleUninstallResolver()` - Hot-uninstall function
- Context menu listener useEffect
- Right-click handler on resolver items
- User-installed badge UI
- Updated `handleInstallResolver()` for hot-reload

**Key Changes:**
```javascript
// Install now hot-reloads
const newResolver = await resolverLoader.current.loadResolver(axe);
setLoadedResolvers(prev => [...prev, newResolver]); // No restart!

// Uninstall now hot-reloads
setLoadedResolvers(prev => prev.filter(r => r.id !== resolverId)); // No restart!
```

### ✅ main.js
**Added:**
- `resolvers-uninstall` IPC handler
- `resolvers-show-context-menu` IPC handler
- `_userInstalled` and `_filename` metadata tracking

**Updated:**
- `resolvers-load-builtin` now marks built-in vs user-installed

### ✅ preload.js
**Added:**
```javascript
resolvers: {
  uninstall: (resolverId) => ipcRenderer.invoke('resolvers-uninstall', resolverId),
  showContextMenu: (resolverId, isUserInstalled) => ipcRenderer.invoke('resolvers-show-context-menu', resolverId, isUserInstalled),
  onContextMenuAction: (callback) => {
    ipcRenderer.on('resolver-context-menu-action', (event, data) => {
      callback(data);
    });
  }
}
```

---

## Benefits

### ✅ Instant Installation
- No wait for app restart
- Resolver available immediately
- Better user experience

### ✅ Easy Uninstallation
- Right-click to uninstall
- Native context menu
- Instant removal from UI

### ✅ Clear Distinction
- Blue "📦 User" badge shows user-installed resolvers
- Built-in resolvers have no badge
- Can only uninstall user-installed ones

### ✅ Better UX
- No interruption to workflow
- No need to close/reopen settings
- Smooth, professional feel

---

## Comparison

| Feature | Before | After |
|---------|--------|-------|
| **Install** | Restart required | ✅ Hot-reload |
| **Uninstall** | Manual file deletion | ✅ Right-click menu |
| **Badge** | None | ✅ "📦 User" badge |
| **Context menu** | None | ✅ Native menu |
| **Time to install** | ~5 seconds | ✅ Instant |
| **Workflow** | Interrupted | ✅ Seamless |

---

## Edge Cases Handled

### ✅ Installing Over Existing
```
Resolver "YouTube" is already installed.
Do you want to overwrite it?
→ Yes: Updates in-place (hot-reload)
→ No: Cancels installation
```

### ✅ Uninstalling Active Resolver
```javascript
// Automatically removed from:
- loadedResolvers (can't search with it anymore)
- resolverOrder (priority list)
- activeResolvers (enabled list)
```

### ✅ Built-in Resolvers
```
Right-click on Spotify → Nothing happens
Built-in resolvers cannot be uninstalled
```

### ✅ Hot-Reload Failure
```
Resolver installed but failed to load.
Please restart the app.

Error: [specific error message]
```

---

## Security

### ✅ Only User-Installed Resolvers
- Context menu only shows for `_userInstalled === true`
- Built-in resolvers protected from uninstallation
- File system access limited to `resolvers/user/`

### ✅ Confirmation Required
- Always asks "Are you sure?" before uninstalling
- Shows resolver name in confirmation
- Can't accidentally uninstall

---

## Testing

### Test Case 1: Hot Install
```bash
1. Open Settings
2. Click "Install New Resolver"
3. Select youtube.axe
4. Expected:
   - No page reload
   - YouTube appears in list
   - Has "📦 User" badge
   - Can search immediately
```

### Test Case 2: Hot Uninstall
```bash
1. Right-click on YouTube (user-installed)
2. Click "Uninstall Resolver"
3. Confirm
4. Expected:
   - No page reload
   - YouTube removed from list
   - Can't search with it anymore
```

### Test Case 3: Update Existing
```bash
1. Install youtube.axe (v1.0)
2. Install youtube.axe (v2.0) again
3. Click "Yes" to overwrite
4. Expected:
   - Hot-updates to v2.0
   - No duplicate entries
   - No page reload
```

### Test Case 4: Built-in Protection
```bash
1. Right-click on Spotify (built-in)
2. Expected:
   - No context menu appears
   - Cannot uninstall
```

---

## Future Enhancements

### 🔮 Multi-Select Uninstall
```javascript
// Select multiple resolvers
// Uninstall all at once
```

### 🔮 Drag to Trash
```javascript
// Drag resolver to trash icon
// Uninstall with animation
```

### 🔮 Undo Uninstall
```javascript
// Keep deleted .axe in temp
// "Undo" button for 5 seconds
```

### 🔮 Export/Import
```javascript
// Right-click → Export resolver
// Share .axe file easily
```

---

## Summary

✅ **Install resolvers instantly** - No restart required
✅ **Right-click to uninstall** - Native context menu
✅ **Clear visual indicators** - Blue "📦 User" badge
✅ **Hot-reload everything** - Seamless experience
✅ **Protected built-ins** - Can't delete core resolvers

**Result: Professional, smooth resolver management!** 🚀
