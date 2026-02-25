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
- **Local music library index** — if you add local music folders, the app scans file paths and reads audio metadata (artist, album, title, track number, year, genre, duration, bitrate). This index is stored in a local SQLite database. The app does not read audio content — only metadata tags.
- **Metadata caches** — artist info, album art URLs, track resolution results, and AI suggestion responses are cached locally to reduce repeated API calls. Caches expire automatically.
- **Scrobble retry queue** — if a scrobble submission fails, it is stored locally and retried for up to 14 days (max 500 queued entries).
- **AI conversation history** — if you use the AI DJ feature, conversation history (up to 50 messages per session) is stored locally. You can clear it at any time.

### Third-party services the desktop app connects to

Parachord connects to external services **only when you explicitly enable or use them**. The app never sends data to a service you have not configured.

#### Streaming and playback

| Service | What is sent | When |
|---|---|---|
| **Spotify** (api.spotify.com) | Search queries, playback commands, library sync requests | When you search, play, or sync via Spotify |
| **Apple Music** (amp-api.music.apple.com, itunes.apple.com) | Search queries, playback commands, library sync requests | When you search, play, or sync via Apple Music |
| **SoundCloud** (api-v2.soundcloud.com) | Search queries, playback commands | When you search or play via SoundCloud |
| **YouTube** (youtube.com) | Video URLs via the browser or embedded player | When you play YouTube content |
| **Bandcamp** (bandcamp.com) | Search queries | When you search Bandcamp |

#### Scrobbling (listening history)

Scrobbling is **opt-in** — you must explicitly enable and authenticate each service. When enabled, the following is sent after a track has been played for at least 30 seconds and either 50% of its duration or 4 minutes (whichever comes first):

| Service | What is sent |
|---|---|
| **Last.fm** (ws.audioscrobbler.com) | Track artist, title, album, duration, play timestamp |
| **ListenBrainz** (api.listenbrainz.org) | Track artist, title, album, duration, play timestamp |
| **Libre.fm** (libre.fm) | Track artist, title, album, duration, play timestamp |

#### Metadata and enrichment

These services are queried to display artist info, album art, and metadata. Only public search queries are sent — no user data or listening history.

| Service | What is sent | When |
|---|---|---|
| **MusicBrainz** (musicbrainz.org) | Artist/track/album name queries | When resolving or enriching metadata |
| **Cover Art Archive** (coverartarchive.org) | MusicBrainz release IDs | When fetching album artwork |
| **Discogs** (api.discogs.com) | Artist/album name queries | When fetching additional metadata |
| **Wikipedia** (en.wikipedia.org) | Artist name lookups | When displaying artist biographies |
| **Apple RSS** (rss.applemarketingtools.com) | No user data; fetches public chart feeds | When viewing charts |

#### AI-powered features (optional)

If you enable the AI DJ feature, Parachord sends prompts to the LLM provider you configure. **You must supply your own API key.** The context sent to the provider includes:

- Current playing track (title, artist, album)
- Your playback queue (up to 10 tracks)
- Listening history summary (top artists, play counts) — only if you opt in
- Conversation history for the current session

| Provider | Notes |
|---|---|
| **OpenAI** (api.openai.com) | Uses your API key. Data sent to OpenAI's servers. |
| **Anthropic** (api.anthropic.com) | Uses your API key. Data sent to Anthropic's servers. |
| **Google Gemini** (generativelanguage.googleapis.com) | Uses your API key. Data sent to Google's servers. |
| **Ollama** (localhost:11434) | Runs entirely on your machine. No data leaves your computer. |
| **Custom endpoints** | Data sent to whatever endpoint you configure. |

Each provider's own privacy policy governs how they handle the data they receive.

#### Shareable links

| Service | What is sent | When |
|---|---|---|
| **Parachord Smart Links** (go.parachord.com) | Playlist data (track names, artists, service URLs) | When you create a shareable link |

#### App updates

| Service | What is sent | When |
|---|---|---|
| **GitHub** (github.com) | App version and platform | When checking for updates |

### Library sync

If you enable Spotify or Apple Music library sync, Parachord reads your saved tracks and playlists from that service and stores them locally. Sync is bidirectional — if you add or remove tracks from a synced playlist in Parachord, those changes are pushed back to the streaming service. You can suppress individual playlists from syncing.

### What the desktop app does NOT do

- Does **not** include analytics, telemetry, or crash reporting.
- Does **not** send data to Parachord servers (go.parachord.com is only used when you explicitly create a shareable link).
- Does **not** create user accounts or require sign-up.
- Does **not** sell, share, or monetize any data.
- Does **not** access files outside the music folders you explicitly add.

### Auto-updater

The app uses `electron-updater` to check for new versions from GitHub Releases. This sends a standard HTTPS request to GitHub to compare version numbers. No personal data is included. Auto-download is disabled by default — you choose whether to download and install updates.

### MCP Server

Parachord includes an optional MCP (Model Context Protocol) server that allows AI assistants (such as Claude Desktop) to search your library, control playback, and manage your queue. It listens only on localhost (127.0.0.1:9421) and is not exposed to the network. When an AI assistant is connected via MCP, it can see your current playing track, queue contents, and search results.

---

## 3. General

### No remote data collection

Parachord has no backend servers, no user accounts, and no analytics. All data processing happens locally on your device. External services are only contacted when you use features that require them.

### Data security

- **Browser extension**: Uses Chrome's native messaging API, which cryptographically verifies that only the registered Parachord desktop app can communicate with the extension.
- **Desktop app**: OAuth tokens and API keys are stored in the app's local data directory. All network requests to third-party services use HTTPS.
- **Local files**: The app accesses only the music folders you explicitly add in Settings. Only metadata tags are read — not audio content.

### Children's privacy

Parachord does not knowingly collect personal information from anyone, including children under 13.

### Changes to this policy

We may update this policy from time to time. Changes will be posted in this file with an updated date. Continued use of Parachord after changes constitutes acceptance of the revised policy.

### Contact

If you have questions about this privacy policy, please open an issue on the [Parachord GitHub repository](https://github.com/Parachord/parachord).
