# Quick Start: Parachord Rename

## 🎯 What Just Happened

All instances of "Harmonix" have been replaced with "Parachord" in your codebase!

---

## ✅ Files Updated

- ✅ **app.js** - Component name, UI strings, resolver metadata
- ✅ **main.js** - Dialog titles, comments
- ✅ **index.html** - Page title
- ✅ **package.json** - App name, product name, app ID
- ✅ **resolver-loader.js** - Comments

---

## 🚀 To Complete the Rename

### 1. Rename Your Project Directory

```bash
# Navigate to parent directory
cd /path/to/parent-directory

# Rename the folder
mv harmonix-desktop parachord-desktop

# Enter the renamed directory
cd parachord-desktop
```

### 2. Clean and Reinstall

```bash
# Remove old builds and dependencies
rm -rf dist/ node_modules/

# Install fresh dependencies
npm install
```

### 3. Test the App

```bash
# Start the app
npm start
```

**Verify:**
- ✅ Window title: "Parachord Desktop"
- ✅ About section: "Parachord Desktop v1.0.0"
- ✅ No "Harmonix" references in UI

---

## 📋 That's It!

Your app is now **Parachord Desktop**! 🎵

### Optional Next Steps

- Update README.md (if you have one)
- Update Git remote repository name
- Design a logo with parachute/chord theme
- Register parachord.app domain

---

## 🔍 Check for Leftovers

```bash
# Search for any remaining "Harmonix" in code
grep -r "Harmonix" *.js *.html *.json

# Should return no results
```

---

## 📝 Key Changes

| Old | New |
|-----|-----|
| Harmonix Desktop | Parachord Desktop |
| harmonix-desktop | parachord-desktop |
| com.harmonix.desktop | com.parachord.desktop |
| support@harmonix.app | support@parachord.app |
| Harmonix Team | Parachord Team |

---

**Welcome to Parachord! 🪂🎵**
