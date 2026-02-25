# Privacy Policy — Parachord

*Last updated: February 25, 2026*

This policy covers the **Parachord desktop application** and the **Parachord browser extension**. Parachord is a local-first music player — your data stays on your machine unless you explicitly connect a third-party service.

---

## 1. Browser Extension

### What the extension accesses

The extension runs **only on supported music sites** (YouTube, Bandcamp, Spotify, Apple Music, SoundCloud, Last.fm, ListenBrainz, and Pitchfork) and accesses:

- **Page URLs** — to detect supported sites and send music links to the desktop app when you choose to.
- **Page content** — content scripts read media playback state (play/pause, track title, artist, album, progress) so the desktop app can display and control playback.
- **Tab information** — tab IDs route playback commands to the correct browser tab.

### How extension data is used

All data from the extension is sent **exclusively to the Parachord desktop app on your own computer** via Chrome's native messaging API — a direct, local-only channel managed by the browser. No data leaves your machine through the extension.

### Extension local storage

The extension stores a small amount of preferences in `chrome.storage.local` (e.g., whether link interception is enabled). This data never leaves your browser.

### Extension permissions

| Permission | Purpose |
|---|---|
| `activeTab` / `tabs` | Detect which tab is playing music and send commands to it. |
| `scripting` | Inject content scripts that read playback state on supported sites. |
| `nativeMessaging` | Communicate with the desktop app via a secure, local-only channel. |
| `contextMenus` | "Send to Parachord" right-click menu on supported links and pages. |
| `storage` | Store extension preferences locally. |
| `alarms` | Keep the service worker alive to maintain the desktop connection. |
| `webNavigation` | Detect navigation to music URLs for optional link interception. |
| Host permissions | Content scripts run only on the specific music sites listed in the manifest. |

---

## 2. Desktop Application

### Data stored locally

All application data is stored on your computer using Electron's local storage (`electron-store`) and local files. This includes:

- **Playlists and collection** — your saved playlists, queue, and library metadata.
- **Search history** — recent searches (stored locally, capped at 50 entries).
- **Settings and preferences** — media key handling, resolver configuration, UI preferences.
- **OAuth tokens** — access and refresh tokens for services you connect (Spotify, SoundCloud, Apple Music). These are stored locally and never shared.
- **API keys you provide** — if you supply your own API keys (Spotify client ID, SoundCloud credentials, AI provider keys), they are stored locally in your app settings.
- **Local music library index** — if you add local music folders, the app indexes file paths and metadata (artist, album, title, duration) on your machine.

### Third-party services the desktop app connects to

Parachord connects to external services **only when you explicitly enable or use them**. The app never sends data to a service you have not configured.

| Service | What is sent | When |
|---|---|---|
| **Spotify** (api.spotify.com) | Search queries, playback commands, library sync requests | When you search, play, or sync via Spotify |
| **Apple Music** (amp-api.music.apple.com, itunes.apple.com) | Search queries, playback commands | When you search or play via Apple Music |
| **SoundCloud** (api-v2.soundcloud.com) | Search queries, playback commands | When you search or play via SoundCloud |
| **YouTube** (youtube.com) | Video URLs via the browser or embedded player | When you play YouTube content |
| **Last.fm** (ws.audioscrobbler.com) | Track artist, title, album, duration, timestamp | When scrobbling is enabled |
| **ListenBrainz** (api.listenbrainz.org) | Track artist, title, album, duration, timestamp | When scrobbling is enabled |
| **MusicBrainz** (musicbrainz.org/ws/2) | Search queries for metadata lookup | When resolving track or album metadata |
| **Discogs** (api.discogs.com) | Artist/album search queries | When fetching additional metadata |
| **Wikipedia** (en.wikipedia.org/api) | Artist name lookups | When displaying artist biographies |
| **Apple RSS** (rss.applemarketingtools.com) | No user data; fetches public chart feeds | When viewing charts |
| **AI providers** (OpenAI, Anthropic, Google, Ollama) | Prompts containing artist/track names from your library | Only when you use AI-powered features, with the provider and API key you configure |
| **GitHub** (github.com) | Standard update check metadata | When checking for app updates (electron-updater) |

### What the desktop app does NOT do

- Does **not** include analytics, telemetry, or crash reporting.
- Does **not** send data to Parachord servers — there are none.
- Does **not** create user accounts or require sign-up.
- Does **not** sell, share, or monetize any data.
- Does **not** access files outside the music folders you explicitly add.

### Auto-updater

The app uses `electron-updater` to check for new versions from GitHub Releases. This sends a standard HTTPS request to GitHub to compare version numbers. No personal data is included. Auto-download is disabled by default — you choose whether to download and install updates.

### MCP Server

Parachord includes an optional MCP (Model Context Protocol) server that allows AI assistants to interact with your music library. It is off by default and only runs locally on your machine when enabled. No data is exposed to the network.

---

## 3. General

### No remote data collection

Parachord has no backend servers, no user accounts, and no analytics. All data processing happens locally on your device.

### Data security

- **Browser extension**: Uses Chrome's native messaging API, which cryptographically verifies that only the registered Parachord desktop app can communicate with the extension.
- **Desktop app**: OAuth tokens and API keys are stored in the app's local data directory. Network requests use HTTPS.
- **Local files**: The app accesses only the music folders you explicitly add in Settings.

### Children's privacy

Parachord does not knowingly collect personal information from anyone, including children under 13.

### Changes to this policy

We may update this policy from time to time. Changes will be posted in this file with an updated date. Continued use of Parachord after changes constitutes acceptance of the revised policy.

### Contact

If you have questions about this privacy policy, please open an issue on the [Parachord GitHub repository](https://github.com/Parachord/parachord).
