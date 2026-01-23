# Listening-Informed AI Recommendations Design

## Overview

When generating AI playlists, users can opt-in to include their listening history. This enriches the prompt with their top artists and tracks from the last 3 months, pulled from their connected Last.fm or ListenBrainz account.

**Key constraints:**
- No new data storage — piggyback on existing scrobbler data
- User controls when history is used (toggle per prompt)
- Fixed 3-month window for consistency
- Works with existing Last.fm and ListenBrainz plugins

## User Flow

```
1. User clicks ✨ in playbar → prompt input opens
2. If Last.fm or ListenBrainz connected, toggle appears: "Include my listening history"
3. User types prompt, optionally enables toggle
4. If toggle on: fetch top artists (10) + top tracks (25) from scrobbler
5. Combine with user's prompt → send to AI
6. AI returns recommendations informed by taste
```

## Data Contract

### What We Send to the AI

When the toggle is enabled, we prepend listening context to the user's prompt:

```json
{
  "listening_context": {
    "window": "last_3_months",
    "top_artists": ["Big Thief", "MJ Lenderman", "Waxahatchee", "..."],
    "top_tracks": [
      { "artist": "Big Thief", "title": "Vampire Empire" },
      { "artist": "MJ Lenderman", "title": "Rudolph" }
    ]
  },
  "prompt": "upbeat songs for a road trip"
}
```

- 10 top artists
- 25 top tracks (artist + title)

### Token Cost

Rough estimate for context payload:
- 10 artists × ~15 chars = 150 chars
- 25 tracks × ~40 chars = 1000 chars
- ~300 tokens added per request (minimal cost impact)

## Prompt Engineering

### Updated System Prompt

```
You are a music recommendation assistant. Given a prompt and optionally the user's
listening history, return a JSON object with a "tracks" array containing 10-15 track
recommendations. Each track must have "artist" and "title" fields.

When listening history is provided, use it to understand the user's taste but don't
just recommend what they already listen to. Find tracks that complement their taste
while honoring the prompt. Prioritize discovery over familiarity.

Only return valid JSON, no explanation or markdown.
```

## UI Changes

### AI Prompt Input

Expanded from current design to include listening history toggle:

```
┌────────────────────────────────────────────────┐
│ ✨ What do you want to listen to?              │
│ ┌────────────────────────────────────────┐     │
│ │ upbeat songs for a road trip           │  →  │
│ └────────────────────────────────────────┘     │
│                                                │
│ ☑ Include my listening history    [OpenAI ▼]  │
└────────────────────────────────────────────────┘
```

**Behavior:**
- Checkbox only visible if Last.fm or ListenBrainz is connected + authenticated
- Checkbox state persisted to electron-store (user preference)
- Label could show source: "Include my Last.fm history" / "Include my ListenBrainz history"

## Implementation

### File Changes

| File | Changes |
|------|---------|
| `resolvers/chatgpt.axe` | Update system prompt, accept listening context in generate() |
| `resolvers/gemini.axe` | Same updates |
| `app.js` | Add toggle state, fetch scrobbler data when toggled on, pass to generate() |

### New Helper Function (in app.js)

```javascript
async function fetchListeningContext() {
  // Returns { top_artists: [...], top_tracks: [...] } or null
  // Tries Last.fm first, falls back to ListenBrainz
  // Uses 3month / quarter period
  // Returns null if no scrobbler connected
}
```

### Generate Flow Change

```javascript
// Current
const tracks = await resolver.generate(prompt, config);

// New
const listeningContext = includeHistory ? await fetchListeningContext() : null;
const tracks = await resolver.generate(prompt, config, listeningContext);
```

### Scrobbler Period Mapping

| Service | Period Parameter |
|---------|------------------|
| Last.fm | `3month` |
| ListenBrainz | `quarter` |

### API Endpoints Used

**Last.fm:**
- `user.gettopartists` with `period=3month&limit=10`
- `user.gettoptracks` with `period=3month&limit=25`

**ListenBrainz:**
- `/1/stats/user/{username}/artists?range=quarter&count=10`
- `/1/stats/user/{username}/recordings?range=quarter&count=25`

## Future Enhancements (V2+)

These are explicitly out of scope for V1 but worth noting:

- **Behavioral signals**: Skip rate, repeat rate, new artist acceptance (requires local tracking)
- **Audio features**: Tempo/energy/acousticness trends from Spotify API
- **Session context**: Time of day, exploratory vs comfort listening mode
- **Configurable time window**: Let user pick period instead of fixed 3 months
