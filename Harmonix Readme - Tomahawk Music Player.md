# 🎵 Harmonix Desktop - Multi-Source Music Player

A beautiful, modern music player for macOS, Windows, and Linux that aggregates music from multiple sources (YouTube, Spotify, SoundCloud) into one unified interface.

## 🚀 Quick Start

### Prerequisites
- Node.js 18+ ([download here](https://nodejs.org/))
- npm (comes with Node.js)

### Installation

1. **Run the setup script:**
```bash
bash setup.sh
```

2. **Navigate to the project:**
```bash
cd harmonix-desktop
```

3. **Copy the app code:**
   - The `app.js` file has been created with the full application code
   - No additional changes needed!

4. **Install dependencies:**
```bash
npm install
```

5. **Run the app:**
```bash
npm start
```

## 📦 Building for Distribution

### macOS
```bash
npm run build:mac
```
Creates:
- `dist/Harmonix.app` - Standalone app
- `dist/Harmonix-1.0.0.dmg` - Installer

### Windows
```bash
npm run build:win
```
Creates:
- `dist/Harmonix Setup 1.0.0.exe` - Installer
- `dist/Harmonix 1.0.0.exe` - Portable version

### Linux
```bash
npm run build:linux
```
Creates:
- `dist/Harmonix-1.0.0.AppImage` - Portable
- `dist/harmonix_1.0.0_amd64.deb` - Debian package

## 🎨 Adding Custom Icons

Replace placeholder icons with your own:

1. **macOS** - Create `assets/icon.icns`:
```bash
# Install iconutil (comes with Xcode)
# Create iconset from PNG
mkdir MyIcon.iconset
# Add various sizes (see Apple docs)
iconutil -c icns MyIcon.iconset
mv MyIcon.icns assets/icon.icns
```

2. **Windows** - Create `assets/icon.ico`:
   - Use online converter or tools like GIMP
   - Recommended sizes: 16x16, 32x32, 48x48, 64x64, 128x128, 256x256

3. **Linux** - Create `assets/icon.png`:
   - PNG format, 512x512 recommended

## 🔧 Configuration

### Spotify Integration

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Add redirect URI: `http://localhost:8888/callback`
4. Copy your Client ID
5. Replace in `app.js`:
```javascript
const SPOTIFY_CLIENT_ID = 'your_client_id_here';
```

### YouTube API

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project
3. Enable YouTube Data API v3
4. Create API credentials (API Key)
5. Replace in `app.js`:
```javascript
const YOUTUBE_API_KEY = 'your_api_key_here';
```

## ⌨️ Keyboard Shortcuts

The app responds to system media keys:

- **Play/Pause** - Media Play/Pause key
- **Next Track** - Media Next Track key
- **Previous Track** - Media Previous Track key

## 🎵 Features

### ✅ Implemented
- Multi-source music resolution (YouTube, Spotify, SoundCloud)
- Audio playback with Web Audio API
- Queue management
- Search across all sources
- Volume control
- Progress tracking
- Media key support
- Persistent settings

### 🚧 To Implement
- Real YouTube API integration (remove CSP restrictions)
- Real Spotify API integration
- Download/cache management
- Playlist creation and editing
- Friend features (listen along, sharing)
- Lyrics display
- Equalizer
- Last.fm scrobbling

## 📁 Project Structure

```
harmonix-desktop/
├── main.js              # Electron main process
├── preload.js           # Preload script (IPC bridge)
├── index.html           # HTML shell
├── app.js               # React application
├── package.json         # Project config
├── assets/              # Icons and images
└── README.md           # This file
```

## 🔒 Security Notes

### Content Security Policy
The Electron app removes CSP restrictions that exist in web artifacts, allowing:
- Direct API calls to YouTube, Spotify, etc.
- Loading external media files
- Full network access

### API Keys
- Never commit API keys to git
- Use environment variables in production
- Rotate keys regularly

## 🐛 Troubleshooting

### "Cannot find module 'electron'"
```bash
npm install
```

### App won't start
```bash
# Clear cache and reinstall
rm -rf node_modules
npm install
npm start
```

### Build fails on macOS
```bash
# Install Xcode Command Line Tools
xcode-select --install
```

### Audio not playing
- Check system volume
- Check app volume slider
- Ensure audio context is allowed (click play to start)

## 📝 Development

### Running with DevTools
```bash
npm run dev
```

### Hot Reload
Install `electron-reload`:
```bash
npm install --save-dev electron-reload
```

Add to `main.js`:
```javascript
require('electron-reload')(__dirname);
```

## 🤝 Contributing

This is a personal project, but suggestions welcome!

## 📄 License

MIT License - feel free to use and modify!

## 🙏 Credits

- Built with [Electron](https://www.electronjs.org/)
- UI with [React](https://react.dev/) and [Tailwind CSS](https://tailwindcss.com/)
- Icons from [Lucide](https://lucide.dev/)
- Inspired by [Tomahawk Player](https://github.com/tomahawk-player/tomahawk)

---

**Enjoy your music! 🎶**
