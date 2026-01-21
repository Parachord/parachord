# Last.fm Meta Service Plug-in Design

## Overview

Create a Last.fm plug-in that authenticates users and provides their username for personalized recommendations. Introduces "Meta Service" as a new plug-in type for services that provide data/features without resolving playable content.

## Plug-in Architecture

### New Plug-in Type

The `.axe` manifest gains a `type` field:
- `"resolver"` (default) - Content resolvers with priority ordering
- `"meta-service"` - Services providing data without playback (Last.fm, future: Discogs, MusicBrainz)

### Last.fm Manifest

```json
{
  "manifest": {
    "id": "lastfm",
    "name": "Last.fm",
    "type": "meta-service",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Personalized music recommendations powered by your Last.fm listening history",
    "icon": "🎧",
    "color": "#D51007"
  },
  "capabilities": {
    "recommendations": true,
    "metadata": true
  },
  "settings": {
    "requiresAuth": true,
    "authType": "username",
    "configurable": {
      "username": { "type": "text", "label": "Last.fm Username", "required": true },
      "apiKey": { "type": "text", "label": "API Key (Optional)", "advanced": true },
      "apiSecret": { "type": "text", "label": "API Secret (Optional)", "advanced": true }
    }
  }
}
```

## Installed Plug-Ins Page Layout

Two distinct sections:

**Content Resolvers** (top)
- Header: "Content Resolvers" / "Drag to reorder playback priority"
- Draggable grid with priority numbers
- Shows plug-ins where `type === "resolver"` or type is undefined

**Meta Services** (bottom)
- Header: "Meta Services" / "Connected services for recommendations and metadata"
- Simple grid, no drag handles or priority
- Shows plug-ins where `type === "meta-service"`
- Cards show connection status

## Last.fm Detail Panel

**Header:** Icon, name, version, author (no enable/disable toggle)

**Configuration:**
- "Last.fm Username" text input
- "Connect" button → validates and saves
- When connected: "Connected as {username}" + "Disconnect" button

**Advanced Section** (collapsed accordion):
- "API Key" text input
- "API Secret" text input
- Help text about avoiding rate limiting

**Status:**
- Not configured: "Enter your Last.fm username to enable personalized recommendations"
- Connected: Green checkmark "Connected to Last.fm"

## Data Flow

**Storage:**
- Config stored via electron-store: `lastfm_config: { username, apiKey, apiSecret }`
- React state: `metaServiceConfigs` object keyed by service ID

**Recommendations Page:**
- Check if Last.fm plug-in configured
- If yes: fetch from `https://www.last.fm/player/station/user/${username}/recommended`
- If no: show empty state with link to Settings

**API Key Usage:**
- User's API key used for Last.fm API calls (metadata) when provided
- Falls back to app's default API key
- Recommendations feed doesn't require API key

## Future Considerations

Architecture supports multiple recommendation providers (Spotify, ListenBrainz, etc.) - user could choose which powers their discovery experience.

## Implementation

**Files to modify:**
- `app.js` - Meta services state, two-section UI, Last.fm detail panel, Recommendations integration
- `main.js` - IPC handlers for meta service config
- `preload.js` - Expose meta service config methods

**New file:**
- `resolvers/lastfm.axe` - Last.fm meta service plug-in
