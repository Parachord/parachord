# MusicKit Helper

Native macOS helper for Apple Music integration via MusicKit framework.

## Requirements

- macOS 12.0 (Monterey) or later
- Xcode Command Line Tools
- Apple Music subscription (for playback)

## Building

```bash
cd native/musickit-helper
./build.sh
```

This will:
1. Build the Swift executable
2. Copy it to `resources/bin/darwin/musickit-helper`
3. Sign it with ad-hoc signature (or your Apple Developer certificate if `APPLE_SIGNING_IDENTITY` is set)

## Signing for Distribution

For distribution, the helper should be signed with a valid Apple Developer certificate:

```bash
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID)" ./build.sh
```

## How It Works

The helper is a command-line tool that communicates with Parachord via JSON over stdin/stdout:

1. Parachord spawns the helper process
2. Commands are sent as JSON lines to stdin
3. Responses are returned as JSON lines from stdout

### Supported Commands

| Command | Parameters | Description |
|---------|------------|-------------|
| `checkAuthStatus` | - | Check if user has authorized Apple Music |
| `authorize` | - | Request Apple Music authorization (shows system dialog) |
| `search` | `query`, `limit` | Search Apple Music catalog |
| `resolve` | `artist`, `title`, `album` | Find a specific track |
| `play` | `songId` | Play a track by Apple Music ID |
| `pause` | - | Pause playback |
| `resume` | - | Resume playback |
| `stop` | - | Stop playback |
| `skipToNext` | - | Skip to next track |
| `skipToPrevious` | - | Skip to previous track |
| `seek` | `position` | Seek to position (seconds) |
| `getPlaybackState` | - | Get current playback state |
| `getNowPlaying` | - | Get now playing info |
| `addToQueue` | `songId` | Add track to queue |
| `setVolume` | `volume` | Set volume (0.0-1.0) |

### Example Communication

Request:
```json
{"id":"req_1","action":"search","params":{"query":"Taylor Swift","limit":10}}
```

Response:
```json
{"id":"req_1","success":true,"data":{"songs":[...]}}
```

## Integration with Parachord

The helper is automatically started when needed by the Electron main process via `musickit-bridge.js`. The preload script exposes the API to the renderer process via `window.electron.musicKit`.

## Troubleshooting

### "Helper not found"
Run the build script to compile the helper binary.

### "Authorization failed"
- Ensure you have an active Apple Music subscription
- Check System Preferences > Privacy & Security > Media & Apple Music
- The app may need to be added to the allowed apps list

### "Playback failed"
- Verify your Apple Music subscription is active
- Try signing out and back in to Apple Music
- Check that the track is available in your region
