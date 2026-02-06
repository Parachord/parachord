I'm excited - and nervous - to announce Parachord, a music player that builds on the legacy of Tomahawk and unifies all your music sources into one seamless experience.

![Parachord Screenshot](assets/artist-page2.png)

# The Problem We’re Solving
If you’re like us, your music is scattered everywhere. You have playlists on Spotify, purchased albums on Bandcamp, rare live recordings on YouTube, and a carefully curated local library of FLAC files. Switching between apps to listen to a single playlist is exhausting.

Parachord changes that.

# How It Works
At its core, Parachord is a metadata-first music player. Instead of being locked to a single streaming service, Parachord understands what song, album, or playlist you want to play and finds the best available source based on your preferences.

Want to prioritize your local files? Done. Prefer Bandcamp when available to support artists directly? Easy. Fall back to YouTube for rare recordings that aren’t on streaming services? Automatic.

# Key Features
- **Rich Music Catalog Data:** Artist and album pages complete with biographies and artist information, full discographies including studio, live and compilations releases
- **Recommendations and Related:** Related artist information, personalized recommendations (from Last.fm and Listenbrainz)
- **Quick Listening Experiences:** One-click to listen to your entire collection on shuffle, or "spinoff" from a currently playing song into a station of related songs and then seamlessly back to your queue
- **Listen Along:** Import friends and curators from Last.fm and Listenbrainz, see what they are playing and join their listening sessions in (almost) real-time
- **AI Companion:** Shuffleupagus, your AI companion, can recommend music, control your playback experience and integrates with other AI agents so they can control it too (via MCP)
- **Plugin Architecture:** Connect any number of music sources, metadata providers, scrobblers and AI models through our extensible plugin system
- **Buy Links:** Bandcamp buy buttons are surfaced for any track we can find them - even if you are streaming from somewhere else
- **Cross-Platform Collections:** Sync your playlists and favorites across services (Spotify and Apple Music) and keep everything in one place
- **Own Your Playlists:** Export in standard XSPF format that works forever and are portable across services
- **Import Music (Metadata) from Anywhwere** - using the browser extension, you can easily import playlists (e.g. from Spotify & Apple Music), albums from reviews and more directly into Parachord where they can be played from your sources

- Read more as it happens on our [blog](https://parachord.com/blog/)

Welcome to Parachord.

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

If you want some technical background on what is going on, check out:
- https://parachord.com/blog/2026/02/03/how-content-resolution-works/
- 

### 1. Enable Plug-ins

Go to **Settings > Plug-ins** and enable the sources you want to use:

**Recommended:**
- **Spotify** (requires Premium and Spotify desktop to be running in the background) - Full playback and library sync
- **Apple Music** - Full playback via MusicKit (sign in with your Apple ID)
- **YouTube** - Stream audio from YouTube
- **Bandcamp** - Stream and buy more directly from independent artists
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

### 3. Connect Apple Music

1. Go to **Settings > Plug-ins > Apple Music**
2. Click **Authorize** — you'll be prompted to sign in with your Apple ID
3. Your Apple Music subscription will be available for full playback
4. Once connected, click **Sync Collection** to import your saved albums and playlists

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
- Do you ever get in scenarios where multiple songs are playing at the same time? Or it starts playing on it's own?
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

### DJ Shuffleupagus
- How do you find the AI features? Good? Bad?
- What do you wish they would do/not do?


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
[https://parachord.slack.com](https://join.slack.com/t/parachord/shared_invite/zt-3p81slpg5-_KYJLUwV3Kc~RCC1zQaipA)

**GitHub Discussions** (for longer-form ideas/questions):
https://github.com/Parachord/parachord/discussions

## Known Limitations (Alpha)

- **Apple Music**: Full playback and library sync on all platforms (macOS, Windows, Linux) via MusicKit
- **Spotify**: Requires Spotify to be open on desktop (can be in background)
- **YouTube**: Audio-only, quality varies - add the browser extension to improve the experience
- **Auto-updates**: Enabled - you'll be prompted when a new version is available

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
