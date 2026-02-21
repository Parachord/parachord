# System Requirements

Parachord is built on Electron 39 (Chromium 142, Node.js 22). The following are the OS-level requirements for running the app on each platform.

## macOS

| Requirement | Details |
|---|---|
| **Minimum version** | macOS 12 (Monterey) |
| **Architecture** | 64-bit Intel or Apple Silicon (universal binary) |
| **Disk space** | ~250 MB for application, plus space for local music database |
| **Distribution formats** | `.dmg`, `.zip` |

### Apple Music / MusicKit (optional)

Full Apple Music integration uses a native Swift helper that has additional requirements:

- macOS 14 (Sonoma) or later
- Xcode Command Line Tools (for building from source)
- Apple Developer certificate and provisioning profile (for MusicKit entitlement)

If the MusicKit helper is unavailable, Parachord falls back to the MusicKit JS web API and iTunes Search API.

## Windows

| Requirement | Details |
|---|---|
| **Minimum version** | Windows 10 |
| **Architecture** | x64, arm64 |
| **Disk space** | ~250 MB for application, plus space for local music database |
| **Distribution formats** | `.exe` (NSIS installer), portable |

No additional OS-level dependencies are required beyond a standard Windows 10+ installation.

## Linux

| Requirement | Details |
|---|---|
| **Minimum version** | Ubuntu 18.04, Debian 10, Fedora 32 (or equivalent) |
| **Architecture** | x64 |
| **Disk space** | ~250 MB for application, plus space for local music database |
| **Distribution formats** | `.AppImage`, `.deb`, `.rpm` |

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
| **Node.js** | v20 (LTS) |
| **npm** | Bundled with Node.js |
| **C/C++ toolchain** | Required for `better-sqlite3` native addon compilation |

### Platform-specific build tools

**macOS:**
- Xcode Command Line Tools (`xcode-select --install`)

**Windows:**
- Visual Studio Build Tools with the "Desktop development with C++" workload, or `npm install -g windows-build-tools`
- Python 3 (usually bundled with Visual Studio Build Tools)

**Linux (Debian/Ubuntu):**
```bash
sudo apt install build-essential python3
```

**Linux (Fedora/RHEL):**
```bash
sudo dnf groupinstall "Development Tools"
sudo dnf install python3
```

## Network Requirements

Parachord streams music from external services and requires internet access for most features. The following outbound connections are used:

- **Spotify** - Spotify Connect and Web API (`api.spotify.com`, `accounts.spotify.com`)
- **YouTube** - Audio streaming
- **Bandcamp** - Streaming and browsing (`bandcamp.com`)
- **SoundCloud** - Streaming (`api.soundcloud.com`)
- **Qobuz** - High-quality streaming (`www.qobuz.com`)
- **MusicBrainz** - Metadata (`musicbrainz.org`)
- **Last.fm** - Scrobbling and recommendations (`ws.audioscrobbler.com`)
- **Cover Art Archive** - Album artwork (`coverartarchive.org`)
- **GitHub** - Auto-update checks (`github.com`)

Local file playback works fully offline.
