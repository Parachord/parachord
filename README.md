# Parachord Desktop

A multi-source music player with cross-platform resolver support.

## ✨ Features

- 🎵 **Multi-Source Playback** - Search and play from Spotify, Bandcamp, Qobuz, and more
- 🔌 **Plugin System** - Extensible .axe resolver format
- 📋 **XSPF Playlists** - Import/export standard playlists
- 🎨 **Modern UI** - Clean, responsive interface built with React
- 🎯 **Smart Resolution** - Automatically finds the best available source
- 🔄 **Spotify Connect** - Full Spotify integration with remote playback
- 🎤 **Artist Pages** - Browse discographies with MusicBrainz integration
- 📦 **Album Art** - Beautiful album artwork from Cover Art Archive

## 🚀 Installation

```bash
# Clone the repository
git clone https://github.com/YOUR_USERNAME/parachord-desktop.git
cd parachord-desktop

# Install dependencies
npm install

# Start the app
npm start
```

## 🛠️ Development

```bash
# Run in development mode with DevTools
npm run dev

# The app will open with Chrome DevTools
```

## 📦 Building

```bash
# Build for macOS
npm run build:mac

# Build for Windows
npm run build:win

# Build for Linux
npm run build:linux
```

## 🔌 Resolvers

Parachord supports multiple music sources through its resolver system:

### Built-in Resolvers

- **Spotify** - Stream via Spotify Connect (Premium required for full playback)
- **Bandcamp** - Browse and purchase independent music
- **Qobuz** - High-quality audio streaming (30-second previews)
- **MusicBrainz** - Comprehensive music metadata database

### Adding Custom Resolvers

Place `.axe` resolver files in:
- **Built-in:** `resolvers/builtin/`
- **User-installed:** `resolvers/user/`

Use the in-app resolver installer or drop .axe files directly into the folders.

## 📋 Playlist Support

- **Import** - Load XSPF playlists from anywhere
- **Export** - Save playlists to share or backup
- **Auto-load** - Place .xspf files in `playlists/` folder for automatic loading
- **Multi-resolver** - Tracks resolve from all enabled sources

## 🎮 Usage

1. **Search for Music** - Use the search bar to find tracks, artists, or albums
2. **Browse Artists** - Click on artist names to view full discographies
3. **View Albums** - See track listings with multi-source resolution
4. **Create Playlists** - Import XSPF playlists or create your own
5. **Play Music** - Click any track to play from the best available source
6. **Manage Queue** - Use Next/Previous buttons to navigate

## ⚙️ Configuration

### Spotify Setup

1. Create a Spotify app at https://developer.spotify.com/dashboard
2. Copy `.env.example` to `.env`
3. Add your Spotify Client ID and Secret
4. Add `http://localhost:8888/callback` to your Redirect URIs
5. Restart the app and connect Spotify

### Resolver Configuration

- **Enable/Disable** - Toggle resolvers in Settings
- **Reorder Priority** - Drag to change resolver priority
- **Install New** - Click "Install Resolver" to add .axe files

## 🏗️ Tech Stack

- **Electron** - Desktop application framework
- **React 18** - UI framework (via CDN)
- **Tailwind CSS** - Utility-first CSS (via CDN)
- **Express** - OAuth server for Spotify authentication
- **Node.js** - Backend runtime

## 📁 Project Structure

```
parachord-desktop/
├── app.js                  # Main React application
├── main.js                 # Electron main process
├── preload.js             # Electron preload script
├── index.html             # Application HTML
├── resolver-loader.js     # Resolver system
├── package.json           # Dependencies and scripts
├── .env                   # Environment variables (not committed)
├── playlists/            # XSPF playlists folder
│   └── example-playlist.xspf
└── resolvers/
    ├── builtin/          # Built-in resolver plugins
    └── user/             # User-installed resolver plugins
```

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Development Workflow

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📝 License

MIT License - see LICENSE file for details

## 🙏 Credits

- **MusicBrainz** - Music metadata
- **Cover Art Archive** - Album artwork
- **Spotify** - Music streaming
- **Bandcamp** - Independent music platform
- **Qobuz** - Hi-res audio streaming

## 🐛 Known Issues

- Spotify requires Premium for remote playback
- Album art loading can be slow for large discographies
- Some XSPF features not yet supported

## 🗺️ Roadmap

- [ ] Queue view UI
- [ ] Playlist creation/editing in-app
- [ ] Lyrics display
- [ ] Last.fm scrobbling
- [ ] YouTube resolver
- [ ] Shuffle and repeat modes
- [ ] Keyboard shortcuts
- [ ] Mini-player mode

## 📧 Contact

For questions or suggestions, please open an issue on GitHub.

---

**Made with ❤️ for music lovers**

🎵 **Parachord Desktop** - Your music, from everywhere
