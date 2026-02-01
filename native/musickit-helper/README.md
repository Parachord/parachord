# MusicKit Helper

Native macOS helper app for Apple Music playback via MusicKit framework.

## Overview

This is a macOS `.app` bundle (not a CLI binary) that provides MusicKit integration for Parachord. It runs as a background agent (no Dock icon) and communicates with the Electron app via stdin/stdout JSON messages.

**Why an .app bundle?** Apple's `ApplicationMusicPlayer` requires a proper app bundle context with MusicKit entitlements. A simple CLI binary cannot use MusicKit for playback - it will fail with "permission denied".

## Requirements

- macOS 14.0 (Sonoma) or later
- Xcode Command Line Tools
- Active Apple Music subscription for playback

## Building

```bash
cd native/musickit-helper
./build.sh
```

This creates:
- `.build/release/MusicKitHelper.app` - The app bundle
- `../../resources/bin/darwin/MusicKitHelper.app` - Copy for Electron

## Structure

```
MusicKitHelper.app/
  Contents/
    Info.plist          # App metadata, LSUIElement (background agent)
    MacOS/
      MusicKitHelper    # Executable
    PkgInfo
```

## Signing

For development, the build script signs ad-hoc. For distribution:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./build.sh
```

## Features

- **Authorization** - Request Apple Music access (shows system dialog)
- **Search** - Search Apple Music catalog
- **Resolve** - Find tracks by artist/title
- **Playback** - Full track playback via ApplicationMusicPlayer
- **Queue** - Add tracks to queue
- **Controls** - Play, pause, stop, skip, seek

## Protocol

JSON messages over stdin/stdout:

**Request:**
```json
{
  "id": "req_1",
  "action": "play",
  "params": { "songId": "1234567890" }
}
```

**Response:**
```json
{
  "id": "req_1",
  "success": true,
  "data": { "playing": true },
  "error": null
}
```

## Actions

| Action | Params | Description |
|--------|--------|-------------|
| `checkAuthStatus` | - | Check current authorization |
| `authorize` | - | Request Apple Music access |
| `search` | `query`, `limit` | Search catalog |
| `resolve` | `artist`, `title`, `album` | Find specific track |
| `play` | `songId` | Play track by ID |
| `pause` | - | Pause playback |
| `resume` | - | Resume playback |
| `stop` | - | Stop playback |
| `skipToNext` | - | Next track |
| `skipToPrevious` | - | Previous track |
| `seek` | `position` | Seek to seconds |
| `getPlaybackState` | - | Get current state |
| `getNowPlaying` | - | Get now playing info |
| `addToQueue` | `songId` | Add to queue |
| `setVolume` | `volume` | Set volume (0-1) |
| `ping` | - | Health check |
| `quit` | - | Exit helper |

## User Experience

When a user connects Apple Music in Parachord:

1. Parachord launches the helper app (invisible background agent)
2. Helper requests MusicKit authorization
3. macOS shows system prompt: "Parachord MusicKit wants access to Apple Music"
4. User authorizes
5. Full playback works!

The authorization prompt shows "Parachord MusicKit" (from CFBundleName in Info.plist).

## Troubleshooting

### "Helper not found"
Run the build script to compile the helper:
```bash
cd native/musickit-helper && ./build.sh
```

### "Authorization failed"
- Ensure you have an active Apple Music subscription
- Check System Preferences > Privacy & Security > Media & Apple Music
- The "Parachord MusicKit" app needs to be allowed

### "Playback failed"
- Verify your Apple Music subscription is active
- Try signing out and back in to Apple Music in System Settings
- Check that the track is available in your region
- Ensure the app bundle is properly signed

### "Permission denied"
This usually means you're running the old CLI binary instead of the .app bundle. Rebuild with `./build.sh` to create the proper .app bundle.
