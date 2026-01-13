# Debugging Guide - Scrollbar & Spotify Auth

## Issues to Fix:
1. ❌ Scrollbar not visible
2. ❌ Spotify button not working

---

## 🔧 Quick Fixes:

### Step 1: Replace Files
Make sure you've replaced:
- ✅ `app.js` - Updated with debug logging
- ✅ `index.html` - Updated with scrollbar CSS

### Step 2: Hard Refresh
1. **Completely close the app** (Cmd+Q on Mac, Alt+F4 on Windows)
2. **Restart:** `npm start`
3. **Open DevTools:** View → Toggle Developer Tools (or Cmd+Option+I)

---

## 🐛 Debugging Spotify Auth:

### Test 1: Click "Connect Spotify" and watch console

**Expected output:**
```
=== Connect Spotify Clicked ===
window.electron: true
window.electron.spotify: true
Calling authenticate...
Auth server running on http://127.0.0.1:8888
```

**If you see:**
```
window.electron: false
```
→ Preload script not loading. Check main.js preload path.

**If you see:**
```
window.electron.spotify: false
```
→ Preload.js not exposing Spotify API correctly.

**If nothing happens:**
→ Button click not registering. Check if another element is blocking.

### Test 2: Check window.electron manually

Open DevTools console (Cmd+Option+I) and type:
```javascript
window.electron
```

**Expected:**
```
{
  store: {...},
  spotify: {...},
  shell: {...},
  onMediaKey: function
}
```

**If undefined:**
→ Preload script failed to load.

### Test 3: Manual authentication test

In DevTools console:
```javascript
window.electron.spotify.authenticate()
```

**If browser opens:**
→ Spotify auth is working, just button click issue.

**If error:**
→ Check the error message for details.

---

## 📜 Debugging Scrollbar:

### Test 1: Check if content overflows

The scrollbar only shows when content is taller than the container.

**Quick test:**
1. Search for something with many results
2. Scrollbar should appear

**If no scrollbar:**
→ Not enough content to overflow yet.

### Test 2: Force overflow

Add this to DevTools console:
```javascript
document.querySelector('.scrollable-content').style.minHeight = '3000px';
```

**If scrollbar appears:**
→ CSS is working, just need more content.

**If still no scrollbar:**
→ CSS not applying correctly.

### Test 3: Check CSS loaded

In DevTools, inspect the main content area:
1. Right-click in content area → "Inspect Element"
2. Look for class `scrollable-content`
3. Check Computed styles for `overflow-y: scroll`

**If class missing:**
→ app.js not updated correctly.

**If overflow-y is not 'scroll':**
→ CSS not loading.

---

## 🔍 Common Issues:

### Issue 1: Files Not Updated
**Symptom:** Changes don't appear after restart

**Fix:**
1. Verify file dates are recent
2. Check you're editing the right directory
3. Try: `rm -rf node_modules/.cache`
4. Restart app

### Issue 2: Cached JavaScript
**Symptom:** Old code still running

**Fix:**
1. Close app completely
2. Clear Electron cache: 
   - Mac: `~/Library/Application Support/harmonix-desktop`
   - Windows: `%APPDATA%/harmonix-desktop`
3. Restart app

### Issue 3: Preload Not Loading
**Symptom:** window.electron is undefined

**Fix:**
1. Check main.js has correct preload path:
   ```javascript
   preload: path.join(__dirname, 'preload.js')
   ```
2. Check preload.js is in same folder as main.js
3. Check console for preload errors

---

## ✅ Verification Checklist:

### For Scrollbar:
```
□ index.html has scrollbar CSS (lines 12-40)
□ app.js has 'scrollable-content' class (line ~1195)
□ app.js has 'overflow-y-scroll' (line ~1195)
□ Hard refresh performed
□ Content actually overflows (many search results)
```

### For Spotify:
```
□ app.js updated with debug logging
□ preload.js in correct location
□ main.js has correct preload path
□ .env has correct Spotify credentials
□ Hard refresh performed
□ DevTools console open to see logs
```

---

## 🎯 Step-by-Step Spotify Debug:

1. **Open app with DevTools** (Cmd+Option+I)

2. **Click "Connect Spotify"** 

3. **Check console output:**

   **Good output:**
   ```
   === Connect Spotify Clicked ===
   window.electron: true
   window.electron.spotify: true
   Calling authenticate...
   ```
   
   **Bad output:**
   ```
   === Connect Spotify Clicked ===
   window.electron: false
   Electron API not available!
   ```

4. **If window.electron is false:**
   - Check terminal for preload errors
   - Verify preload.js path in main.js
   - Check file permissions

5. **If authenticate() is called but browser doesn't open:**
   - Check main.js has spotify-auth handler
   - Check .env has SPOTIFY_CLIENT_ID
   - Check terminal for auth server errors

---

## 🆘 Emergency Fix:

If nothing works, try this:

1. **Backup your files**
2. **Fresh start:**
   ```bash
   rm -rf node_modules
   npm install
   ```
3. **Verify .env exists and has credentials**
4. **Replace all files:**
   - main.js
   - preload.js
   - app.js
   - index.html
5. **Start fresh:**
   ```bash
   npm start
   ```

---

## 📊 What to Share:

If still not working, share these:

### From DevTools Console (F12):
```
1. window.electron
2. Output after clicking "Connect Spotify"
3. Any errors in red
```

### From Terminal (where npm start runs):
```
1. Full output when app starts
2. Output after clicking "Connect Spotify"
3. Any error messages
```

### Screenshots:
1. DevTools console after clicking button
2. Terminal output
3. The Spotify button itself

---

This will help identify exactly what's wrong! 🔍
