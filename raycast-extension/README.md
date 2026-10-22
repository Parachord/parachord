# Parachord Raycast Extension

Control Parachord music player directly from Raycast.

## Features

- **Play/Pause** - Toggle playback with a single command
- **Next/Previous** - Skip tracks quickly
- **Search & Play** - Search for music and play instantly
- **Add to Queue** - Queue up tracks without interrupting playback
- **AI DJ Chat** - Send prompts to the AI DJ for recommendations
- **Volume Control** - Adjust volume from Raycast
- **Shuffle Toggle** - Turn shuffle on/off
- **Open Artist** - Jump directly to an artist page
- **Collection Radio** - Shuffle and play your entire collection

## Installation

### From Source

1. Clone this repository
2. Install dependencies:
   ```bash
   cd raycast-extension
   npm install
   ```
3. Import into Raycast:
   - Open Raycast
   - Go to Extensions
   - Click "+" and select "Import Extension"
   - Navigate to this folder

### Development

```bash
npm run dev
```

## Commands

| Command | Description | Shortcut Suggestion |
|---------|-------------|---------------------|
| Play/Pause | Toggle playback | `⌘ ⇧ P` |
| Next Track | Skip to next | `⌘ ⇧ →` |
| Previous Track | Go back | `⌘ ⇧ ←` |
| Search & Play | Find and play music | |
| Add to Queue | Add track to queue | |
| AI DJ Chat | Chat with AI | |
| Set Volume | Adjust volume | |
| Toggle Shuffle | Shuffle on/off | |
| Clear Queue | Clear playback queue | |
| Open Parachord | Show the home page (the app must already be running) | |
| Open Artist | Go to artist page | |
| Collection Radio | Shuffle and play your entire collection | |

## Usage Tips

### Search & Play
- Use "Artist - Track" format for direct play: `Radiohead - Karma Police`
- Or just type a search query to open search in Parachord

### AI DJ Chat
- Use quick prompts from the action menu (`⌘ K`)
- Or type your own request like "play something chill"

### Keyboard Shortcuts
Set up your own shortcuts in Raycast Preferences → Extensions → Parachord

## Requirements

- [Parachord](https://parachord.com) desktop app must be installed
- macOS 10.15 or later
- Raycast 1.64.0 or later

## How It Works

Each command builds a `parachord://` URL and sends it to the running app over HTTP: `GET http://127.0.0.1:8888/protocol?url=<encoded parachord:// URL>` (see `src/utils.ts`). The port is hardcoded to 8888, Parachord's default local server port. If you change the port in Parachord (Settings → General → Local Server Port), the extension cannot reach the app and reports "Parachord not running"; set it back to 8888 or edit `PARACHORD_HTTP_PORT` in `src/utils.ts`.

## License

MIT
