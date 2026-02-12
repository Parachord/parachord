# Parachord v0.7.0-alpha.2

**Release date:** 2026-02-12

---

## Smart Links

Share any track as a beautiful, embeddable web page.

- **Publish Smart Link** from the right-click context menu on any track
- Hosted at **go.parachord.com** via Cloudflare Workers + KV
- Embedded player with links to Spotify, YouTube, Apple Music, SoundCloud, and Bandcamp
- **Play in Parachord** button — connects to the desktop app over WebSocket
- **Copy Embed Code** for embedding the player on external sites
- Official service logos matching the desktop app

## MCP Server (Claude Desktop Integration)

Control Parachord from Claude Desktop using natural language.

- MCP server with tools for playback control, search, and queue management
- stdio bridge for Claude Desktop compatibility
- One-click setup in **Settings > General**

## AI DJ Privacy Controls

All personal data is now gated behind an explicit opt-in toggle.

- **"Share my data" toggle** (off by default) controls whether the AI receives now playing, queue, collection, listening history, playlists, session data, recent searches, and friend stats
- When off, the AI can still search and play music from explicit requests ("play Radiohead")
- When data is needed (e.g. "what's playing?", "recommend something based on my taste"), the AI prompts the user to enable the toggle
- Toggle is now visible to **all users**, not just those with a scrobbler connected

## AI DJ Bug Fixes

- Fixed first song playing twice when the AI queues multiple tracks — `queue_add` now deduplicates against the currently playing track
- Updated system prompt: multi-track requests use a single `queue_add` call instead of `play` + `queue_add`

## Stability & Performance

- **Faster startup** — app initialization parallelized
- **Resolver caching fix** — tracks no longer constantly re-resolve when already cached
- **Auth token validation** — saved resolver settings are validated on restore; invalid tokens prompt re-auth
- **Apple Music auth** — Swift helper activates to foreground; increased authorization timeout; handles denied auth gracefully
- **Apple Music pause** — fixed pause not working after switching sources
- **Friend unpinning** — fixed stale closures in polling causing unpin to fail
- **userData path** — pinned before `app.name` is set to prevent data loss on upgrade
- **App identity** — menu bar shows "Parachord" instead of "parachord-desktop"; MusicKit auth dialog shows correct app name
- **Auto-updater** — now finds pre-release builds; error toast no longer shows "undefined"
- **SoundCloud errors** — credential error toast only fires when fallback credentials also fail

## Auth & API

- **SoundCloud BYOK** — advanced API credentials config restored for users who want to use their own keys
- **Credential masking** — Client ID and API Key fields use password input type
- **Spotify API migration** — library sync updated to unified `/me/library` endpoints (Feb 2026 API changes)

## Social

- Friends section always visible in sidebar for discoverability (no longer hidden when empty)

## Development

- Reverse sync workflow from dedicated plugin and browser extension repos back to the monorepo

---

**Full changelog:** See `TODO.md` or `git log v0.6.0-alpha.2..v0.7.0-alpha.2`
