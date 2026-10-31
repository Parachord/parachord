# System Requirements

Parachord is built on Electron 44 (Chromium 152, Node.js 24). The following are the OS-level requirements for running the app on each platform.

## macOS

| Requirement | Details |
|---|---|
| **Minimum version** | macOS 13 (Ventura) — Electron 44 (Chromium 152) no longer supports macOS 12 |
| **Architecture** | 64-bit Intel or Apple Silicon (universal binary) |
| **Disk space** | ~250 MB for application, plus space for local music database |
| **Distribution formats** | `.dmg`, `.zip` |

### Apple Music / MusicKit (optional)

Full Apple Music integration uses a native Swift helper that has additional requirements:

- macOS 14 (Sonoma) or later
- Xcode Command Line Tools (for building from source)
- Apple Developer certificate and provisioning profile (for MusicKit entitlement)

If the MusicKit helper is unavailable, Parachord falls back to the MusicKit JS web API and iTunes Search API.

### Widevine CDM

Amazon Music always plays through the Widevine CDM, on macOS as well as Windows and Linux, so it needs the same first-launch CDM download (about 20 MB on disk) described for those platforms below.

## Windows

| Requirement | Details |
|---|---|
| **Minimum version** | Windows 10 |
| **Architecture** | x64, arm64 |
| **Disk space** | ~250 MB for application, plus space for local music database |
| **Distribution formats** | `.exe` (NSIS installer), portable |
| **Widevine CDM** | Downloaded automatically on first launch (about 20 MB on disk); needed for full Apple Music playback and for all Amazon Music playback |

No additional OS-level dependencies are required beyond a standard Windows 10+ installation.

## Linux

| Requirement | Details |
|---|---|
| **Minimum version** | Ubuntu 18.04, Debian 10, Fedora 32 (or equivalent) |
| **Architecture** | x64 |
| **Disk space** | ~250 MB for application, plus space for local music database |
| **Distribution formats** | `.AppImage`, `.deb`, `.rpm` |
| **Widevine CDM** | Downloaded automatically on first launch (about 20 MB on disk); needed for full Apple Music playback and for all Amazon Music playback |

### Audio subsystem

Electron uses Chromium's audio stack, which relies on PulseAudio or PipeWire on Linux. Most desktop distributions ship with one of these. If audio does not work, ensure one of the following is installed:

- `pulseaudio` (and `libpulse0` / `libpulse`)
- `pipewire` with the PulseAudio compatibility layer (`pipewire-pulse`)

ALSA alone is generally not sufficient for Electron-based apps.

### Sandbox dependencies

Some distributions require additional packages for the Chromium sandbox:

- `libnss3`
- `libatk-bridge2.0-0` (or `at-spi2-core`)
- `libdrm2`
- `libgbm1`
- `libgtk-3-0`
- `libxshmfence1`

On Debian/Ubuntu, these are typically already present on a desktop installation. On minimal server or container environments they may need to be installed manually.

## Building from Source

Building Parachord from source has the following additional requirements on all platforms:

| Requirement | Details |
|---|---|
| **Node.js** | v22 or newer to build and run; v24.9 or newer to run the test suite (CI builds on 22, tests on 24) |
| **npm** | Bundled with Node.js |
| **C/C++ toolchain** | Not needed. `better-sqlite3`, the only native module, ships prebuilt binaries (Linux x64/arm64 glibc and musl, macOS, Windows). macOS release builds need the Xcode Command Line Tools for the Swift MusicKit helper |
| **Electron** | Package fetched by `npm install` from [castlabs' GitHub releases](https://github.com/castlabs/electron-releases) (not the npm registry); the ~100 MB binary downloads on the first `npm start`. See the README for why stock Electron is not a substitute |
| **Python 3 + `castlabs-evs`** | Only to VMP-sign a local build; CI does this for releases |

### Platform-specific build tools

**macOS:**
- Xcode Command Line Tools (`xcode-select --install`); they also provide the Swift toolchain that `npm run build:mac` uses to compile the MusicKit helper in `native/musickit-helper/`

**Windows and Linux:** none. Nothing is compiled; see the C/C++ toolchain row above. Packaging for a Linux distribution is covered in [LINUX_PACKAGING.md](LINUX_PACKAGING.md).

## Network Requirements

Parachord streams music from external services and requires internet access for most features. The following outbound connections are used:

- **Spotify** - Spotify Connect and Web API (`api.spotify.com`, `accounts.spotify.com`)
- **YouTube** - Audio streaming
- **Bandcamp** - Streaming and browsing (`bandcamp.com`)
- **SoundCloud** - Streaming (`api.soundcloud.com`)
- **Apple Music** - Catalog and playback (`api.music.apple.com`, `music.apple.com`), MusicKit JS (`js-cdn.music.apple.com`), iTunes Search fallback and charts (`itunes.apple.com`, `rss.marketingtools.apple.com`)
- **Amazon Music** - Amazon's web player and its GraphQL API (`music.amazon.com`, `gql.music.amazon.com`), plus Amazon's sign-in pages
- **MusicBrainz** - Metadata (`musicbrainz.org`)
- **Last.fm** - Scrobbling and recommendations (`ws.audioscrobbler.com`)
- **Cover Art Archive** - Album artwork (`coverartarchive.org`)
- **GitHub** - Auto-update checks (`github.com`)
- **Google** - Widevine CDM download and updates via Chromium's component updater (`update.googleapis.com`, `clients2.google.com`, plus Google's download CDN). Fetched once on first launch; without it, Apple Music on Windows and Linux plays only previews and Amazon Music does not play, and startup waits up to 10 seconds for the download before giving up for that launch

Local file playback works fully offline.
