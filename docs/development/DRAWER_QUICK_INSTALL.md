# Quick Install: Embed Drawer Feature

## 🎯 What You're Getting

A **sliding drawer** that emerges from your playbar to show:
- 🎸 **Bandcamp** embedded players
- 📺 **YouTube** music videos

Keeps everything in-app - no more switching to browser windows!

---

## 📥 Installation (3 Steps)

### Step 1: Update app.js

1. Download the updated **app.js** (link above)
2. Replace it in your project: `~/Development/parachord-desktop/app.js`

### Step 2: Install Resolvers

1. Download both resolver files:
   - **bandcamp-embed.axe**
   - **youtube.axe**

2. Save them anywhere (Desktop is fine)

3. In Parachord:
   - Click ⚙️ Settings
   - Scroll to "Resolver Plugins"
   - Click "📦 Install Resolver"
   - Select `bandcamp-embed.axe`
   - Repeat for `youtube.axe`

### Step 3: Enable Resolvers

In Settings, toggle ON both:
- ✅ **Bandcamp (Embedded)**
- ✅ **YouTube**

---

## ✨ Try It!

1. **Search for music** (try "Thank You Scientist")
2. **Click a Bandcamp result**
3. **Watch drawer slide up!** 🎸

Or:

1. **Search for** "Bohemian Rhapsody"
2. **Click YouTube result**
3. **Video plays in drawer!** 📺

---

## 🎨 How It Looks

```
┌─────────────────────────────────┐
│  Your Music Library             │
│                                 │
├─────────────────────────────────┤
│  ↑ Drawer slides up from here! │
│  ┌───────────────────────────┐ │
│  │ 🎸 Track Title            │ │
│  │ Streaming from Bandcamp   │ │
│  ├───────────────────────────┤ │
│  │  [Bandcamp Player]        │ │
│  │                           │ │
│  └───────────────────────────┘ │
├─────────────────────────────────┤
│  [◄◄] [▶] [►►]   Now Playing   │
└─────────────────────────────────┘
```

---

## 🔧 What's New in app.js

- Added drawer state management
- Created slide-up animation
- Exposed `window.openEmbedDrawer()` for resolvers
- Drawer auto-sizes to fit screen minus playbar

---

## 📦 Resolver Details

### Bandcamp (Embedded)
- Shows full Bandcamp player
- Preview clips for free
- "Buy" button works in iframe
- Fallback to browser if drawer fails

### YouTube
- Searches YouTube Music
- Embeds video player
- Auto-plays when opened
- Full controls in iframe

---

## 🎯 Benefits

✅ **Stay in app** - No more browser windows  
✅ **Smooth animations** - Polished feel  
✅ **Reusable pattern** - Works for any embed  
✅ **Easy to close** - Click ✕ anytime  
✅ **Discoverable** - Slides from familiar playbar  

---

## 🚀 That's It!

Your Parachord now has a professional drawer UI for embedded content!

**Enjoy streaming from Bandcamp and YouTube without leaving the app!** 🎵
