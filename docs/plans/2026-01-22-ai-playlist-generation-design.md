# AI Playlist Generation Design

## Overview

A playbar button opens a text input for natural language playlist requests. An AI provider (OpenAI or Google Gemini, user's API key) generates track suggestions. Results appear in a slide-in right sidebar where users can review, edit, and add to queue or save as playlist.

## User Flow

```
1. User clicks "✨" button in playbar
2. Text input expands/appears near playbar
3. User types: "upbeat 90s hip hop for a workout"
4. Press Enter → loading state
5. AI returns track list → right sidebar slides in
6. Sidebar shows: track list with remove buttons, "Add to Queue" / "Save as Playlist" actions
7. User edits list if needed, clicks action
8. Tracks resolve in background, sidebar closes
```

**Key Principles:**
- Non-blocking: music keeps playing throughout
- Lightweight: no modal dialogs, everything slides/fades
- Forgiving: easy to dismiss, edit, or retry

## Plugin Architecture

Each AI provider is its own `.axe` plugin, matching the existing resolver pattern.

**New `.axe` Plugins:**

| Plugin | File | Purpose |
|--------|------|---------|
| OpenAI | `resolvers/openai.axe` | ChatGPT playlist generation |
| Gemini | `resolvers/gemini.axe` | Google Gemini playlist generation |

**New Capability Type:** `"generate"` (distinct from `resolve`, `search`, `stream`)

```json
{
  "manifest": {
    "id": "openai",
    "name": "OpenAI",
    "description": "Generate playlists using ChatGPT",
    "icon": "🤖",
    "color": "#10a37f"
  },
  "capabilities": {
    "generate": true
  },
  "settings": {
    "requiresAuth": true,
    "authType": "apiKey",
    "configurable": ["apiKey", "model"]
  },
  "implementation": {
    "generate": "async function(prompt, config) { ... }"
  }
}
```

**How It Works:**
- Resolver loader detects plugins with `capabilities.generate`
- UI shows AI button only if at least one generate-capable plugin is enabled
- If multiple AI plugins enabled, user picks which to use (or set a default)

## UI Components

### 1. AI Prompt Button (Playbar)

Location: Playbar, near volume controls

```
┌─────────────────────────────────────────────────────────┐
│ ◀ ▶ ▮▮  Track Name - Artist    ────●───── 2:34  🔀 🔁 ✨ 🔊 │
└─────────────────────────────────────────────────────────┘
                                                      ^ AI button
```

- Icon: Sparkle (✨) - indicates "magic" generation
- Disabled/hidden if no AI resolvers enabled
- Tooltip: "Generate playlist with AI"

### 2. AI Prompt Input

On click, expands as a small floating panel near the button:

```
┌────────────────────────────────────────────────┐
│ ✨ What do you want to listen to?              │
│ ┌────────────────────────────────────────┐     │
│ │ upbeat 90s hip hop for a workout       │  →  │
│ └────────────────────────────────────────┘     │
│                            [OpenAI ▼]          │
└────────────────────────────────────────────────┘
```

- Text input with placeholder
- Submit on Enter or arrow button
- Provider selector only shows if multiple AI plugins enabled
- Escape or click-outside to dismiss

### 3. Results Sidebar

Slides in from right edge, ~350px wide:

```
                                    ┌──────────────────┐
                                    │ ✨ AI Playlist   ✕│
                                    │ "upbeat 90s..."   │
                                    ├──────────────────┤
                                    │ ○ Juicy - Biggie │
                                    │ ○ Jump Around... │
                                    │ ○ Regulate - ... │
                                    │ ○ ...            │
                                    ├──────────────────┤
                                    │ [Add to Queue]   │
                                    │ [Save Playlist]  │
                                    └──────────────────┘
```

- Header: title + close button
- Subtitle: shows the original prompt
- Track list: artist - title, with remove (✕) button on hover per track
- Action buttons at bottom
- Clicking outside or ✕ dismisses without action
- No resolution in sidebar - tracks resolve after user commits

## API Layer

**Plugin Implementation (OpenAI example):**

```javascript
// resolvers/openai.axe - implementation.generate
async function(prompt, config) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + config.apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: [{
        role: 'system',
        content: `You are a music recommendation assistant. When given a prompt, return a JSON array of 10-15 tracks. Each track must have "artist" and "title" fields. Only return valid JSON, no explanation.`
      }, {
        role: 'user',
        content: prompt
      }],
      response_format: { type: 'json_object' }
    })
  });

  const data = await response.json();
  const parsed = JSON.parse(data.choices[0].message.content);
  return parsed.tracks; // [{artist, title}, ...]
}
```

**Gemini:** Same pattern, different endpoint (`generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent`)

**Response Format:**
Both plugins normalize to the same shape:
```javascript
[
  { artist: "The Notorious B.I.G.", title: "Juicy" },
  { artist: "House of Pain", title: "Jump Around" },
  // ...
]
```

**Error Handling:**
- Invalid API key → Show error in prompt UI, link to settings
- Rate limit → "Too many requests, try again in a moment"
- Parse error → "AI returned unexpected format, try again"
- Network error → "Couldn't reach AI service"

## Settings UI

**Location:** Settings → General tab, new section above "Cache Management"

```
┌─────────────────────────────────────────────────────────────┐
│ AI INTEGRATION                                              │
│ Connect AI services to generate playlists from natural      │
│ language prompts                                            │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ 🤖 OpenAI                                    [Enabled ▼] │ │
│ │                                                         │ │
│ │ API Key                                                 │ │
│ │ ┌─────────────────────────────────────────┐             │ │
│ │ │ ••••••••••••••••••••sk-proj   👁        │             │ │
│ │ └─────────────────────────────────────────┘             │ │
│ │ Get your API key at platform.openai.com                 │ │
│ │                                                         │ │
│ │ Model                                                   │ │
│ │ ┌─────────────────────────────────────────┐             │ │
│ │ │ gpt-4o-mini (Recommended)            ▼  │             │ │
│ │ └─────────────────────────────────────────┘             │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ ✦ Google Gemini                              [Disabled] │ │
│ │                                                         │ │
│ │ (Enable to configure)                                   │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Lists all installed resolvers with `capabilities.generate`
- Enable/disable toggle per provider
- Collapsed when disabled, expands when enabled
- API key stored in electron-store (per-resolver config)
- Model dropdown with sensible defaults
- Help link to get API key

**Storage:**
```javascript
// Stored via existing resolver config pattern
resolverConfigs: {
  openai: { apiKey: 'sk-...', model: 'gpt-4o-mini', enabled: true },
  gemini: { apiKey: 'AIza...', model: 'gemini-1.5-flash', enabled: false }
}
```

## Data Flow

```
User clicks ✨ → Prompt input opens
       ↓
Types prompt, hits Enter
       ↓
aiResolver.generate(prompt, config)
       ↓
API returns [{artist, title}, ...]
       ↓
Results sidebar opens with track list
       ↓
User reviews, removes unwanted tracks
       ↓
┌─────────────┬──────────────────┐
│ Add to Queue│ Save as Playlist │
└─────────────┴──────────────────┘
       ↓                ↓
addToQueue(tracks)    Create XSPF, save
       ↓                ↓
resolveTracksInBackground() kicks in
       ↓
Tracks resolve across enabled resolvers
       ↓
Playback ready
```

## File Changes

| File | Changes |
|------|---------|
| `resolvers/openai.axe` | **New** - OpenAI plugin |
| `resolvers/gemini.axe` | **New** - Gemini plugin |
| `resolver-loader.js` | Add `generate` capability handling |
| `app.js` | AI button, prompt input, results sidebar, settings section |
| `preload.js` | No changes (uses existing `proxyFetch`) |
| `main.js` | No changes needed |

## New State (app.js)

```javascript
// AI prompt UI
const [aiPromptOpen, setAiPromptOpen] = useState(false);
const [aiPrompt, setAiPrompt] = useState('');
const [aiLoading, setAiLoading] = useState(false);
const [aiError, setAiError] = useState(null);

// Results sidebar (generic/reusable)
const [resultsSidebar, setResultsSidebar] = useState(null);
// Shape: { title, subtitle, tracks: [], onAddToQueue, onSavePlaylist }
```

## Scope Estimate

- 2 new `.axe` files (~50 lines each)
- ~200 lines for settings UI section
- ~150 lines for prompt input component
- ~200 lines for results sidebar component
- Minor resolver-loader updates
