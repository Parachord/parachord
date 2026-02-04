# Parachord Alpha Quick Start Guide

Welcome to the [Parachord](https://parachord.com) alpha! Thanks for helping us test. This guide will get you set up and explain what we're looking for feedback on.

## Download

Download the latest release for your platform:
- **macOS**: `.dmg` (Apple Silicon)

In theory, Windows and Linux builds work too - but I've never tried either. So good luck and let me know how it goes!
- **Windows**: `Parachord.Setup.x.x.x.exe` (installer) or `Parachord.x.x.x.exe` (portable)
- **Linux**: `.AppImage`, `.deb`, or `.rpm`

[Download from Releases](https://github.com/Parachord/parachord/releases)

## Getting Started

### 1. Enable Plug-ins

Go to **Settings > Plug-ins** and enable the sources you want to use:

**Recommended:**
- **Spotify** (requires Premium) - Full playback and library sync
- **Apple Music** (macOS only) - Playback via MusicKit
- **YouTube** - Stream audio from YouTube
- **Bandcamp** - Support independent artists
- **Local Files** - Your own music library

**For metadata & discovery:**
- **Last.fm** - Scrobbling, recommendations, and artist images
- **MusicBrainz** - Artist discographies and release info

### 2. Connect Spotify (Recommended)

If you have Spotify Premium:
1. Go to **Settings > Plug-ins > Spotify**
2. Click **Connect**
3. Authorize in the browser
4. Once connected, click **Sync Collection** to import your saved albums and playlists

### 3. Connect Apple Music (macOS)

1. Go to **Settings > Plug-ins > Apple Music**
2. Click **Authorize** - this will prompt for Music app access
3. Your Apple Music library will be available for playback

### 4. Install the Browser Extension

Send songs to Parachord directly from your browser:
1. Download from [Chrome Web Store](#) or [Firefox Add-ons](#) *(links coming soon)*
2. Or load unpacked from `parachord-extension/` in the repo
3. Right-click any song link to send it to Parachord

### 5. Add Friends

See what others are listening to in real-time:
1. Go to **Collection > Friends > Add Friend**
2. Add friends by Last.fm username:
   - `jherskowitz`
   - *(add other testers)*

## What to Test

We're especially interested in feedback on:

### Playback
- Does playback work reliably across different sources?
- Any audio glitches, gaps, or sync issues?
- Does source switching work smoothly in mixed queues?
- Do you ever get in scenarios where multiple songs are playing at the same time?
- Volume normalization between sources?

### Performance
- How does the app feel on your machine?
- Any lag or slowness in the UI?
- Do you find yourself waiting too long for things to become playable?
- Memory usage over time?
- Large library handling (1000+ tracks)?

### User Experience
- Is anything confusing or unintuitive?
- Missing features you expected?
- Rough edges in the interface?
- Error messages that aren't helpful?

### Source-Specific
- Spotify Connect reliability
- Apple Music authorization flow
- YouTube audio quality/reliability
- Bandcamp/SoundCloud playback
- Local file scanning and metadata

## Reporting Issues

**Found a bug?** Open an issue on GitHub:
https://github.com/Parachord/parachord/issues

Please include:
- What you were doing
- What you expected to happen
- What actually happened
- Your OS and version
- Screenshots or screen recordings if helpful

## Join the Discussion

**Slack** (preferred for quick chat):
https://parachord.slack.com

**GitHub Discussions** (for longer-form ideas/questions):
https://github.com/Parachord/parachord/discussions

## Known Limitations (Alpha)

- **Apple Music**: macOS only, playback support (no library sync yet)
- **Spotify**: Requires Spotify to be open on desktop (can be in background)
- **YouTube**: Audio-only, quality varies - add the browser extension to improve the experience
- **Auto-updates**: Not yet enabled - check releases manually

## Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Play/Pause | `Space` |
| Next Track | `Cmd/Ctrl + Right` |
| Previous Track | `Cmd/Ctrl + Left` |
| Search | `Cmd/Ctrl + F` |
| Toggle Shuffle | `Cmd/Ctrl + S` |

---

Thanks for testing Parachord! Your feedback helps shape the future of the app.

**Parachord** - Your music is everywhere but you shouldn't have to be.
