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

Install from the [Chrome Web Store](https://chromewebstore.google.com/detail/parachord/gibkgapadebfoillbakpgmgpnppjlnie) (works with Chrome, Edge, and other Chromium browsers).

### From Firefox Add-ons

Install from [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/parachord/).

## Usage

1. Make sure Parachord desktop is running
2. Click the Parachord icon in your browser toolbar to open the popup
3. The extension connects to Parachord automatically through native messaging: the browser launches Parachord's native messaging host (`com.parachord.desktop`, registered by the desktop app when it starts), which relays messages to the running app. No network port is involved

### Context Menu

Right-click any link on a webpage and select **Send to Parachord** to queue the track.

### Now Playing

When you're on a supported site (YouTube, Spotify, etc.), the extension will detect what's currently playing and display it in the popup.

## Development

The extension uses Manifest V3 with (the Firefox build is generated from the same manifest by `scripts/package-extension.js`):

- `background.js` - Service worker for handling connections and context menus
- `content.js` - Generic content script for YouTube and Bandcamp
- `content-spotify.js` - Spotify-specific content script
- `content-applemusic.js` - Apple Music-specific content script
- `content-soundcloud.js` - SoundCloud-specific content script
- `content-pitchfork.js` - Pitchfork review page content script
- `content-inline.js` - Adds inline "Send to Parachord" buttons next to supported music links and embeds on other sites
- `popup.html/js` - Extension popup UI

## Requirements

- Chrome, Edge, another Chromium-based browser, or Firefox
- Parachord desktop app installed and running locally (it registers the native messaging host the extension needs)

## License

MIT
