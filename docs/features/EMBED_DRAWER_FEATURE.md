# Embed Drawer Feature - Bandcamp & YouTube Streaming

## 🎵 What's New

A sliding drawer that emerges from the playbar to show embedded players from Bandcamp and YouTube! This keeps users in the app while streaming from external services.

## ✨ Features

### Embed Drawer
- **Slides up from playbar** with smooth animation
- **Full-height player** for embedded content
- **Close button** to dismiss drawer
- **Header shows** source icon, track title, and service name
- **Reusable** for any embeddable content

### Supported Services
- **🎸 Bandcamp** - Full Bandcamp player with purchase links
- **📺 YouTube** - YouTube video player with music videos

---

## 🎯 How It Works

### User Experience

1. **Search for music** as normal
2. **Click a Bandcamp or YouTube track**
3. **Drawer slides up** from the bottom
4. **Embedded player loads** in the drawer
5. **Control playback** within the iframe
6. **Click ✕** or press Escape to close

### Visual Flow

```
┌─────────────────────────────────┐
│  Main App Content               │
│  (Search, Library, etc.)        │
│                                 │
├─────────────────────────────────┤
│  ▼ Drawer slides up from here  │
│  ┌───────────────────────────┐ │
│  │ 🎸 Song Title             │ │ ← Header
│  │ Streaming from Bandcamp   │ │
│  ├───────────────────────────┤ │
│  │                           │ │
│  │  [Bandcamp Player Iframe] │ │ ← Content
│  │                           │ │
│  │                           │ │
│  └───────────────────────────┘ │
├─────────────────────────────────┤
│  🎵 Now Playing - Track Info    │ ← Playbar
│  [◄◄] [▶] [►►]                 │
└─────────────────────────────────┘
```

---

## 🔧 Implementation Details

### State Management

```javascript
const [embedDrawer, setEmbedDrawer] = useState({
  isOpen: false,
  type: null,      // 'bandcamp', 'youtube', etc.
  url: null,       // Embed URL
  title: null      // Track title
});
```

### Helper Functions

```javascript
// Open drawer
const openEmbedDrawer = (type, url, title) => {
  setEmbedDrawer({
    isOpen: true,
    type,
    url,
    title: title || currentTrack?.title
  });
};

// Close drawer
const closeEmbedDrawer = () => {
  setEmbedDrawer({
    isOpen: false,
    type: null,
    url: null,
    title: null
  });
};
```

### Drawer Component

```javascript
React.createElement('div', {
  className: `fixed bottom-0 left-0 right-0 bg-slate-900/98 backdrop-blur-xl 
    border-t border-white/10 transition-transform duration-300 ease-out z-40 ${
    embedDrawer.isOpen ? 'translate-y-0' : 'translate-y-full'
  }`,
  style: {
    height: embedDrawer.isOpen ? 
      (currentTrack ? 'calc(100vh - 120px)' : 'calc(100vh - 20px)') : '0'
  }
})
```

---

## 📦 New Resolvers

### Bandcamp (Embedded) - `bandcamp-embed.axe`

**Features:**
- ✅ Searches Bandcamp for tracks
- ✅ Opens tracks in embed drawer
- ✅ Shows full Bandcamp player with purchase options
- ✅ Fallback to browser if drawer unavailable

**Installation:**
1. Download `bandcamp-embed.axe`
2. Go to Settings → Resolver Plugins
3. Click "Install Resolver"
4. Select `bandcamp-embed.axe`
5. Enable the resolver

### YouTube - `youtube.axe`

**Features:**
- ✅ Searches YouTube for music
- ✅ Opens videos in embed drawer
- ✅ Full YouTube player controls
- ✅ Auto-plays when opened

**Installation:**
1. Download `youtube.axe`
2. Go to Settings → Resolver Plugins
3. Click "Install Resolver"  
4. Select `youtube.axe`
5. Enable the resolver

---

## 🎨 Styling

### Drawer Animation

```css
transition: transform 300ms ease-out
transform: translateY(0)     /* Open */
transform: translateY(100%)  /* Closed */
```

### Header Design

- **Background:** `bg-slate-900/98` with backdrop blur
- **Border:** Top border with `border-white/10`
- **Icons:** Emoji icons for each service (🎸, 📺)
- **Close Button:** Hover effect with `hover:bg-white/10`

### Iframe Container

```javascript
<iframe
  src={embedUrl}
  className="w-full h-full border-0"
  allow="autoplay; encrypted-media"
  allowFullScreen={true}
  sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
/>
```

---

## 🔌 Integration with Resolvers

### How Resolvers Use the Drawer

Resolvers call `window.openEmbedDrawer()` in their `play` function:

```javascript
"play": "async function(track, config) {
  if (window.openEmbedDrawer) {
    window.openEmbedDrawer('bandcamp', track.bandcampUrl, track.title);
    return true;
  }
  // Fallback to browser
  window.open(track.bandcampUrl, '_blank');
  return true;
}"
```

### Available Globally

```javascript
// Exposed to window in useEffect
window.openEmbedDrawer = openEmbedDrawer;

// Resolvers can now call it:
window.openEmbedDrawer(type, url, title);
```

---

## 🎯 Use Cases

### 1. Bandcamp Streaming
- User searches for indie artist
- Clicks Bandcamp result
- Drawer opens with Bandcamp player
- Can listen to preview and purchase if they like it

### 2. YouTube Music Videos
- User searches for popular song
- Clicks YouTube result
- Drawer opens with music video
- Can watch video while browsing library

### 3. Future Services
- SoundCloud embeds
- Mixcloud embeds  
- Spotify Web Player
- Apple Music embeds (if available)

---

## ⚙️ Configuration

### Drawer Height Calculation

```javascript
height: embedDrawer.isOpen ? 
  (currentTrack ? 'calc(100vh - 120px)' : 'calc(100vh - 20px)') 
  : '0'
```

**Logic:**
- **With playbar:** Leave 120px for player controls
- **Without playbar:** Leave only 20px margin
- **Closed:** Height is 0 (still exists in DOM)

### Z-Index Layering

```
z-50: Settings Modal (top)
z-40: Embed Drawer (middle)
z-30: Player bar (bottom)
z-20: Main content
```

---

## 🧪 Testing

### Test Bandcamp

1. Enable "Bandcamp (Embedded)" resolver
2. Search for "Thank You Scientist"
3. Click any result
4. Verify drawer slides up
5. Verify Bandcamp player loads
6. Test "Buy" button works
7. Close drawer

### Test YouTube

1. Install `youtube.axe` resolver
2. Search for "Bohemian Rhapsody"
3. Click YouTube result
4. Verify drawer slides up
5. Verify video auto-plays
6. Test full-screen button
7. Close drawer

---

## 🐛 Known Issues & Limitations

### Cross-Origin Restrictions

- **Can't control iframe directly** via JavaScript
- **Can't read iframe state** (play/pause status)
- **Can't sync with main player** (independent playback)

### Workarounds

1. **User controls playback** within iframe
2. **Drawer shows embed title** for context
3. **Close button** always accessible

### Bandcamp Limitations

- **Preview clips only** for unpurchased tracks
- **Full streaming** requires purchase
- **Artist pages** may have limited embeds

### YouTube Limitations

- **Ads may play** before content
- **Requires internet** (no offline mode)
- **Copyright claims** may block some videos

---

## 🚀 Future Enhancements

### Player Sync

If we can communicate with iframes:
```javascript
// Pause drawer when main player plays
iframe.contentWindow.postMessage({ action: 'pause' }, '*');
```

### Progress Tracking

```javascript
// Listen for iframe progress events
window.addEventListener('message', (event) => {
  if (event.data.type === 'progress') {
    updateProgress(event.data.currentTime);
  }
});
```

### Picture-in-Picture

```javascript
// Minimize drawer to corner when browsing
const minimizeDrawer = () => {
  setDrawerMode('pip'); // Picture-in-picture mode
};
```

### Multiple Drawers

```javascript
// Stack multiple sources
const [drawerQueue, setDrawerQueue] = useState([]);
```

---

## 📝 Code Structure

### Files Modified

**app.js:**
- Added `embedDrawer` state
- Added `openEmbedDrawer` and `closeEmbedDrawer` functions
- Exposed `window.openEmbedDrawer`
- Added drawer component to JSX

### Files Created

**bandcamp-embed.axe:**
- Bandcamp resolver with drawer integration
- Updates `play` function to use drawer

**youtube.axe:**
- YouTube resolver with drawer integration  
- Searches YouTube and opens in drawer

---

## 🎨 Design Philosophy

### Why a Drawer?

1. **Stays in app** - No external browser windows
2. **Familiar pattern** - Like Spotify's "Now Playing" view
3. **Flexible** - Works for any embeddable content
4. **Smooth** - Animated transitions feel polished
5. **Discoverable** - Easy to close and reopen

### Why Not a Modal?

- **Modals block content** - Drawer lets you browse
- **Modals feel disruptive** - Drawer feels integrated
- **Modals are temporary** - Drawer can stay open

### Why Not Replace Main Player?

- **Keep playbar visible** - User always knows what's playing
- **Allow multitasking** - Browse while listening
- **Preserve queue** - Don't lose your place

---

## ✅ Checklist for Adding New Embeds

To add support for a new embeddable service:

- [ ] Create `.axe` resolver file
- [ ] Add search implementation
- [ ] Update play function to call `window.openEmbedDrawer(type, url, title)`
- [ ] Choose unique emoji icon
- [ ] Add service name to drawer header switch
- [ ] Test embed loads correctly
- [ ] Test close button works
- [ ] Document any limitations

---

## 🎵 Try It Now!

### Installation

1. Download updated files:
   - `app.js` (has drawer implementation)
   - `bandcamp-embed.axe`
   - `youtube.axe`

2. Replace `app.js` in your project

3. Install resolvers:
   - Settings → Resolver Plugins → Install Resolver
   - Select `bandcamp-embed.axe`
   - Select `youtube.axe`

4. Enable both resolvers

5. Search for music and enjoy! 🎸📺

---

**The drawer makes Parachord feel like a complete music app - all your sources in one beautiful interface!** 🎵✨
