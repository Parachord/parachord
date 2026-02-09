# Parachord Browser Extension

Connect your browser to [Parachord](https://github.com/Parachord/parachord) desktop for playback control and content discovery.

## Features

- **Send to Parachord** - Right-click any link to send it to Parachord for playback - or pin the extension to your browser toolbar and just click it
- **Now Playing Detection** - Automatically detects what's playing on supported sites
- **Quick Add** - Add tracks from supported sites directly to your Parachord queue

### Supported Sites

- YouTube
- Spotify
- Apple Music
- SoundCloud
- Bandcamp
- Pitchfork (reviews)
- Last.fm
- ListenBrainz

## Installation

### From Source (Developer Mode)

1. Download or clone this repository
2. Open Chrome/Edge and go to `chrome://extensions`
3. Enable **Developer mode** (toggle in top right)
4. Click **Load unpacked**
5. Select the extension folder

### From Chrome Web Store

Coming soon.

## Usage

1. Make sure Parachord desktop is running
2. Click the Parachord icon in your browser toolbar to open the popup
3. The extension will automatically connect to Parachord on `localhost:21863`

### Context Menu

Right-click any link on a webpage and select **Send to Parachord** to queue the track.

### Now Playing

When you're on a supported site (YouTube, Spotify, etc.), the extension will detect what's currently playing and display it in the popup.

## Development

The extension uses Chrome Manifest V3 with:

- `background.js` - Service worker for handling connections and context menus
- `content.js` - Generic content script for YouTube and Bandcamp
- `content-spotify.js` - Spotify-specific content script
- `content-applemusic.js` - Apple Music-specific content script
- `content-soundcloud.js` - SoundCloud-specific content script
- `content-pitchfork.js` - Pitchfork review page content script
- `popup.html/js` - Extension popup UI

## Requirements

- Chrome, Edge, or other Chromium-based browser
- Parachord desktop app running locally

## License

MIT
