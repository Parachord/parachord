# Conversational DJ with Pluggable AI Backends

## Overview

An embedded conversational AI assistant within Parachord that can control playback, answer questions about your music, and act as an intelligent DJ. Unlike the existing ChatGPT/Gemini plugins which only generate playlists, this feature provides full bidirectional control with context awareness.

**Key Design Principles:**
- **Pluggable AI backends** — Users choose their provider (local or cloud)
- **Local-first option** — Ollama support means free, private, offline-capable
- **Extends existing architecture** — New `chat` capability for `.axe` plugins
- **Full context awareness** — AI sees now-playing, queue, history, library
- **Bidirectional control** — AI can read state AND take actions

## Comparison with Existing AI Plugins

| Aspect | Current (generate) | New (chat) |
|--------|-------------------|------------|
| Interaction | Single prompt → playlist | Multi-turn conversation |
| Context | Listening history only | Full app state |
| Control | None | Play, pause, skip, queue, etc. |
| Memory | None | Session-based conversation |
| Interface | Modal prompt | Persistent chat panel |

## User Flows

### Flow 1: Conversational Control

```
User: "What's playing right now?"
    ↓
AI reads now-playing context
    ↓
AI: "You're listening to 'Vampire Empire' by Big Thief
     from the album Dragon New Warm Mountain."
    ↓
User: "Nice, play more like this"
    ↓
AI calls search() + queue_add() tools
    ↓
AI: "I've queued up 5 similar indie folk tracks:
     - 'Simulation Swarm' by Big Thief
     - 'Right Back to It' by Waxahatchee
     - ..."
```

### Flow 2: Hands-Free Commands

```
User: "Pause"
    ↓
AI calls control("pause")
    ↓
AI: "Paused."
    ↓
User: "Skip to the next one"
    ↓
AI calls control("skip")
    ↓
AI: "Now playing 'Manning Fireworks' by MJ Lenderman"
```

### Flow 3: Library Queries

```
User: "What have I been listening to lately?"
    ↓
AI reads history context
    ↓
AI: "This week you've mostly been playing Big Thief (34 plays),
     MJ Lenderman (28 plays), and Waxahatchee (19 plays).
     'Rudolph' is your most-played track with 8 plays!"
```

### Flow 4: Smart Requests

```
User: "I'm going for a run, put on something energetic"
    ↓
AI considers: listening history, time of day, request
    ↓
AI calls queue_clear() + queue_add() with high-energy tracks
    ↓
AI: "I've set up a running playlist based on your taste.
     Starting with 'Running Up That Hill' - enjoy your run!"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Parachord                                                      │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Chat Panel (collapsible sidebar or modal)              │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │ AI: What would you like to listen to?           │    │    │
│  │  │ You: Play something chill for working           │    │    │
│  │  │ AI: I've queued up some ambient tracks...       │    │    │
│  │  │ You: Skip this one                              │    │    │
│  │  │ AI: Skipped. Now playing "Outro" by M83        │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  │  ┌─────────────────────────────────────────────────┐    │    │
│  │  │ Type a message...                          [⏎] │    │    │
│  │  └─────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  AI Provider Layer (pluggable .axe plugins)             │    │
│  │                                                         │    │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐        │    │
│  │  │ Ollama  │ │ OpenAI  │ │ Gemini  │ │ Claude  │ ...    │    │
│  │  │ (local) │ │ (cloud) │ │ (cloud) │ │ (cloud) │        │    │
│  │  └─────────┘ └─────────┘ └─────────┘ └─────────┘        │    │
│  │       ▲           ▲           ▲           ▲             │    │
│  │       └───────────┴───────────┴───────────┘             │    │
│  │                        │                                │    │
│  │              Unified Tool Interface                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Context & Tools                                        │    │
│  │                                                         │    │
│  │  Context (read-only):     Tools (actions):              │    │
│  │  • now_playing            • play(artist, title)         │    │
│  │  • queue                  • control(action)             │    │
│  │  • history                • search(query)               │    │
│  │  • playlists              • queue_add(tracks)           │    │
│  │  • library_stats          • queue_clear()               │    │
│  │                           • create_playlist(name, tracks)│    │
│  │                           • shuffle(enabled)            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                  │
│                              ▼                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Parachord Core (existing)                              │    │
│  │  • Playback engine                                      │    │
│  │  • Queue management                                     │    │
│  │  • Resolver system                                      │    │
│  │  • Playlist storage                                     │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

## AI Provider Plugins

### New Plugin Capability: `chat`

Extends the existing `.axe` plugin format with a new capability for conversational AI.

```json
{
  "manifest": {
    "id": "ollama",
    "name": "Ollama (Local)",
    "type": "meta-service",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Run AI locally with Ollama. Free, private, works offline."
  },
  "capabilities": {
    "chat": true
  },
  "settings": {
    "model": {
      "type": "select",
      "label": "Model",
      "options": ["llama3.1", "llama3.1:70b", "mistral", "mixtral", "qwen2.5"],
      "default": "llama3.1"
    },
    "endpoint": {
      "type": "text",
      "label": "Ollama URL",
      "default": "http://localhost:11434"
    }
  },
  "implementation": {
    "chat": "async function(messages, tools, config) { ... }"
  }
}
```

### Supported Providers

| Provider | Type | Cost | Tool Calling | Notes |
|----------|------|------|--------------|-------|
| **Ollama** | Local | Free | Yes (Llama 3.1+) | Requires Ollama installed |
| **LM Studio** | Local | Free | Varies | Alternative local option |
| **OpenAI** | Cloud | Paid | Yes | GPT-4o, GPT-4o-mini |
| **Google Gemini** | Cloud | Free tier | Yes | Gemini 2.0 Flash |
| **Anthropic Claude** | Cloud | Paid | Yes | Claude 3.5 Sonnet |
| **Groq** | Cloud | Free tier | Yes | Fast Llama/Mistral inference |
| **Mistral** | Cloud | Paid | Yes | Mistral Large |

### Migrating Existing ChatGPT/Gemini Plugins

The existing ChatGPT and Gemini plugins have a `generate` capability for one-shot playlist generation. To support the new conversational DJ, they need to add the `chat` capability alongside `generate`.

**Current structure (generate only):**

```json
{
  "manifest": {
    "id": "chatgpt",
    "name": "ChatGPT",
    "type": "meta-service"
  },
  "capabilities": {
    "generate": true
  },
  "implementation": {
    "generate": "async function(prompt, config, listeningContext) { ... }"
  }
}
```

**Updated structure (generate + chat):**

```json
{
  "manifest": {
    "id": "chatgpt",
    "name": "ChatGPT",
    "type": "meta-service"
  },
  "capabilities": {
    "generate": true,
    "chat": true
  },
  "implementation": {
    "generate": "async function(prompt, config, listeningContext) { ... }",
    "chat": "async function(messages, tools, config) { ... }"
  }
}
```

**Key differences between `generate` and `chat`:**

| Aspect | `generate` | `chat` |
|--------|-----------|--------|
| **Purpose** | One-shot playlist generation | Multi-turn conversation with tool use |
| **Input** | Single prompt + optional listening context | Message history + tool definitions |
| **Output** | Array of `{artist, title}` tracks | Text response + optional tool calls |
| **State** | Stateless | Maintains conversation history |
| **Tools** | None | play, control, search, queue_add, etc. |

**Changes required for chatgpt.axe:**

1. Add `"chat": true` to capabilities
2. Add `chat` function to implementation that:
   - Accepts `messages` array (conversation history)
   - Accepts `tools` array (DJ tool definitions)
   - Calls OpenAI's chat completions API with `tools` parameter
   - Returns `{content, tool_calls}` instead of track array

**Changes required for gemini.axe:**

1. Add `"chat": true` to capabilities
2. Add `chat` function to implementation that:
   - Converts message format to Gemini's expected structure
   - Calls Gemini's generateContent API with function declarations
   - Maps Gemini's function call response to standard `{content, tool_calls}` format

**Backward compatibility:**

- The existing `generate` capability continues to work unchanged
- The ✨ button in the playbar still uses `generate` for quick playlist creation
- The new chat panel uses `chat` for conversational interaction
- Users with existing API keys don't need to reconfigure anything

**Example: Adding chat to existing ChatGPT plugin:**

```javascript
// Existing generate function (unchanged)
async function generate(prompt, config, listeningContext) {
  // ... existing implementation returns [{artist, title}, ...]
}

// New chat function (added)
async function chat(messages, tools, config) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: messages,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }))
    })
  });

  const data = await response.json();
  const choice = data.choices[0];

  return {
    content: choice.message.content,
    tool_calls: choice.message.tool_calls?.map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }))
  };
}
```

### Plugin Implementation Pattern

Each chat provider implements the same interface:

```javascript
// Implementation signature
async function chat(messages, tools, config) {
  // messages: Array of {role: "user"|"assistant"|"system", content: string}
  // tools: Array of tool definitions (standardized format)
  // config: Plugin settings (model, apiKey, endpoint, etc.)
  //
  // Returns: {
  //   content: string,           // AI's text response
  //   tool_calls?: Array<{       // Optional tool calls
  //     name: string,
  //     arguments: object
  //   }>
  // }
}
```

### Example: Ollama Plugin

```javascript
async function chat(messages, tools, config) {
  const response = await fetch(`${config.endpoint}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      messages: messages,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      })),
      stream: false
    })
  });

  const data = await response.json();

  return {
    content: data.message.content,
    tool_calls: data.message.tool_calls?.map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }))
  };
}
```

### Example: OpenAI Plugin (extends existing)

```javascript
async function chat(messages, tools, config) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model || 'gpt-4o-mini',
      messages: messages,
      tools: tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters
        }
      }))
    })
  });

  const data = await response.json();
  const choice = data.choices[0];

  return {
    content: choice.message.content,
    tool_calls: choice.message.tool_calls?.map(tc => ({
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }))
  };
}
```

## Tool Definitions

Tools are defined once and work across all providers. They follow the JSON Schema format that most LLM APIs support.

### `play`

Play a specific track.

```json
{
  "name": "play",
  "description": "Play a specific track by searching for it and starting playback immediately",
  "parameters": {
    "type": "object",
    "properties": {
      "artist": {
        "type": "string",
        "description": "The artist name"
      },
      "title": {
        "type": "string",
        "description": "The track title"
      }
    },
    "required": ["artist", "title"]
  }
}
```

### `control`

Control playback state.

```json
{
  "name": "control",
  "description": "Control music playback - pause, resume, skip to next, go to previous track",
  "parameters": {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": ["pause", "resume", "skip", "previous"],
        "description": "The playback action to perform"
      }
    },
    "required": ["action"]
  }
}
```

### `search`

Search for tracks.

```json
{
  "name": "search",
  "description": "Search for tracks across all music sources",
  "parameters": {
    "type": "object",
    "properties": {
      "query": {
        "type": "string",
        "description": "Search query (artist name, track title, or both)"
      },
      "limit": {
        "type": "number",
        "description": "Maximum number of results (default 10)"
      }
    },
    "required": ["query"]
  }
}
```

### `queue_add`

Add tracks to the queue.

```json
{
  "name": "queue_add",
  "description": "Add one or more tracks to the playback queue",
  "parameters": {
    "type": "object",
    "properties": {
      "tracks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "artist": { "type": "string" },
            "title": { "type": "string" }
          },
          "required": ["artist", "title"]
        },
        "description": "Tracks to add to the queue"
      },
      "position": {
        "type": "string",
        "enum": ["next", "last"],
        "description": "Add after current track (next) or at end (last). Default: last"
      }
    },
    "required": ["tracks"]
  }
}
```

### `queue_clear`

Clear the queue.

```json
{
  "name": "queue_clear",
  "description": "Clear all tracks from the playback queue"
}
```

### `create_playlist`

Create a new playlist.

```json
{
  "name": "create_playlist",
  "description": "Create a new playlist with the specified tracks",
  "parameters": {
    "type": "object",
    "properties": {
      "name": {
        "type": "string",
        "description": "Name for the new playlist"
      },
      "tracks": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "artist": { "type": "string" },
            "title": { "type": "string" }
          }
        },
        "description": "Tracks to include in the playlist"
      }
    },
    "required": ["name", "tracks"]
  }
}
```

### `shuffle`

Toggle shuffle mode.

```json
{
  "name": "shuffle",
  "description": "Turn shuffle mode on or off",
  "parameters": {
    "type": "object",
    "properties": {
      "enabled": {
        "type": "boolean",
        "description": "true to enable shuffle, false to disable"
      }
    },
    "required": ["enabled"]
  }
}
```

## Context Injection

Before each AI request, Parachord injects current state into the system prompt.

### System Prompt Template

```
You are a helpful music DJ assistant for Parachord, a multi-source music player.
You can control playback, search for music, manage the queue, and answer questions
about the user's music.

CURRENT STATE:
{{#if nowPlaying}}
Now Playing: "{{nowPlaying.title}}" by {{nowPlaying.artist}}
  Album: {{nowPlaying.album}}
  Source: {{nowPlaying.source}}
  Position: {{formatTime nowPlaying.position}} / {{formatTime nowPlaying.duration}}
  State: {{playbackState}}
{{else}}
Nothing is currently playing.
{{/if}}

Queue ({{queue.length}} tracks):
{{#each queue}}
  {{@index}}. "{{this.title}}" by {{this.artist}}
{{/each}}

{{#if history}}
Recent Listening (last 7 days):
  Top Artists: {{#each history.topArtists}}{{this.name}} ({{this.plays}}){{#unless @last}}, {{/unless}}{{/each}}
  Total Plays: {{history.totalPlays}}
{{/if}}

Respond concisely. When taking actions, confirm what you did. If you need to play
or queue music, use the search tool first to find tracks, then use play or queue_add.
```

### Context Data Structure

```javascript
const context = {
  nowPlaying: {
    title: "Vampire Empire",
    artist: "Big Thief",
    album: "Dragon New Warm Mountain I Believe in You",
    source: "spotify",
    position: 67,      // seconds
    duration: 245      // seconds
  },
  playbackState: "playing", // or "paused"
  queue: [
    { title: "Simulation Swarm", artist: "Big Thief" },
    { title: "Sparrow", artist: "Big Thief" },
    // ...
  ],
  history: {
    topArtists: [
      { name: "Big Thief", plays: 34 },
      { name: "MJ Lenderman", plays: 28 }
    ],
    topTracks: [
      { title: "Rudolph", artist: "MJ Lenderman", plays: 8 }
    ],
    totalPlays: 147
  },
  shuffle: false,
  repeat: "off"
};
```

## UI Design

### Option A: Chat Sidebar (Recommended)

A collapsible panel on the right side, similar to Spotify's friend activity.

```
┌─────────────────────────────────────────────────────────────────────┐
│  [Parachord]                                    [≡] [🔍] [💬]       │
├─────────────────────────────────────────────────┬───────────────────┤
│                                                 │ AI DJ             │
│                                                 │ ─────────────────│
│                                                 │ ○ What would you  │
│                                                 │   like to listen  │
│           Main Content Area                     │   to?             │
│           (Queue, Search, Artist, etc.)         │                   │
│                                                 │ ● Play something  │
│                                                 │   chill           │
│                                                 │                   │
│                                                 │ ○ I've queued up  │
│                                                 │   some ambient... │
│                                                 │                   │
│                                                 │ ● Skip this one   │
│                                                 │                   │
│                                                 │ ○ Skipped. Now    │
│                                                 │   playing "Outro" │
│                                                 │                   │
│                                                 ├───────────────────┤
│                                                 │ [Type a message...│
├─────────────────────────────────────────────────┴───────────────────┤
│   advancement controls                                                │
└─────────────────────────────────────────────────────────────────────┘
```

**Behavior:**
- Toggle with 💬 button in header or keyboard shortcut (Cmd+J?)
- Persists across navigation
- Remembers conversation within session
- Collapses to icon when closed

### Option B: Expanded ✨ Modal

Extend the existing AI prompt modal into a full chat interface.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AI DJ                              [×]     │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ○ What would you like to listen to?                                │
│                                                                     │
│  ● I want something upbeat for a morning workout                    │
│                                                                     │
│  ○ I've put together an energetic mix for your workout:             │
│    • "Running Up That Hill" - Kate Bush                             │
│    • "Physical" - Dua Lipa                                          │
│    • "Don't Start Now" - Dua Lipa                                   │
│    • "Levitating" - Dua Lipa                                        │
│    • "Blinding Lights" - The Weeknd                                 │
│    Starting playback now!                                           │
│                                                                     │
│  ● Perfect! But skip the Kate Bush, not feeling it today            │
│                                                                     │
│  ○ Skipped! Now playing "Physical" by Dua Lipa.                     │
│                                                                     │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ Type a message...                                           │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Provider: [Ollama (Local) ▼]                    [Clear Chat]       │
└─────────────────────────────────────────────────────────────────────┘
```

### UI Components

**Message Bubble:**
```javascript
const MessageBubble = ({ message, isUser }) => (
  <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}>
    <div className={`max-w-[80%] rounded-2xl px-4 py-2 ${
      isUser
        ? 'bg-blue-500 text-white'
        : 'bg-gray-100 text-gray-900'
    }`}>
      {message.content}
      {message.toolResults && (
        <div className="mt-2 text-xs opacity-75">
          {message.toolResults.map(r => `✓ ${r.tool}`).join(' ')}
        </div>
      )}
    </div>
  </div>
);
```

**Provider Selector:**
```javascript
const ProviderSelector = ({ providers, selected, onChange }) => (
  <select
    value={selected}
    onChange={e => onChange(e.target.value)}
    className="text-sm bg-transparent border rounded px-2 py-1"
  >
    {providers.map(p => (
      <option key={p.id} value={p.id}>
        {p.name} {p.isLocal ? '(Local)' : ''}
      </option>
    ))}
  </select>
);
```

## Implementation

### File Structure

```
parachord/
├── app.js                          # Add chat state, UI, tool execution
├── components/
│   └── ChatPanel.js                # Chat UI component (new)
├── services/
│   └── ai-chat.js                  # Chat orchestration logic (new)
├── tools/
│   └── dj-tools.js                 # Tool definitions and executors (new)
└── plugins/                        # Downloaded .axe files
    ├── ollama.axe                  # Ollama chat provider (new)
    ├── chatgpt.axe                 # Extend with chat capability
    ├── gemini.axe                  # Extend with chat capability
    ├── claude.axe                  # Claude chat provider (new)
    └── groq.axe                    # Groq chat provider (new)
```

### Chat Orchestration (ai-chat.js)

```javascript
class AIChatService {
  constructor(provider, tools, getContext) {
    this.provider = provider;
    this.tools = tools;
    this.getContext = getContext;
    this.messages = [];
  }

  async sendMessage(userMessage) {
    // Add user message to history
    this.messages.push({ role: 'user', content: userMessage });

    // Build system prompt with current context
    const context = await this.getContext();
    const systemPrompt = this.buildSystemPrompt(context);

    // Call AI provider
    const response = await this.provider.chat(
      [{ role: 'system', content: systemPrompt }, ...this.messages],
      this.tools,
      this.provider.config
    );

    // Handle tool calls if any
    if (response.tool_calls?.length > 0) {
      const toolResults = await this.executeTools(response.tool_calls);

      // Add assistant message with tool calls
      this.messages.push({
        role: 'assistant',
        content: response.content,
        tool_calls: response.tool_calls
      });

      // Add tool results
      this.messages.push({
        role: 'tool',
        content: JSON.stringify(toolResults)
      });

      // Get follow-up response
      const followUp = await this.provider.chat(
        [{ role: 'system', content: systemPrompt }, ...this.messages],
        this.tools,
        this.provider.config
      );

      this.messages.push({ role: 'assistant', content: followUp.content });
      return { content: followUp.content, toolResults };
    }

    // No tool calls, just return response
    this.messages.push({ role: 'assistant', content: response.content });
    return { content: response.content };
  }

  async executeTools(toolCalls) {
    const results = [];
    for (const call of toolCalls) {
      const tool = this.tools.find(t => t.name === call.name);
      if (tool) {
        const result = await tool.execute(call.arguments);
        results.push({ tool: call.name, result });
      }
    }
    return results;
  }

  buildSystemPrompt(context) {
    // Template from earlier in this doc
    return `You are a helpful music DJ assistant...`;
  }

  clearHistory() {
    this.messages = [];
  }
}
```

### Tool Executors (dj-tools.js)

```javascript
// Tool definitions with executors
export const djTools = [
  {
    name: 'play',
    description: 'Play a specific track by searching for it and starting playback',
    parameters: {
      type: 'object',
      properties: {
        artist: { type: 'string', description: 'Artist name' },
        title: { type: 'string', description: 'Track title' }
      },
      required: ['artist', 'title']
    },
    execute: async ({ artist, title }, { search, playTrack }) => {
      const results = await search(`${artist} ${title}`);
      if (results.length === 0) {
        return { success: false, error: `Could not find "${title}" by ${artist}` };
      }
      await playTrack(results[0]);
      return { success: true, track: results[0] };
    }
  },

  {
    name: 'control',
    description: 'Control playback (pause, resume, skip, previous)',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['pause', 'resume', 'skip', 'previous'] }
      },
      required: ['action']
    },
    execute: async ({ action }, { handlePause, handlePlay, handleNext, handlePrevious }) => {
      switch (action) {
        case 'pause': handlePause(); break;
        case 'resume': handlePlay(); break;
        case 'skip': handleNext(); break;
        case 'previous': handlePrevious(); break;
      }
      return { success: true, action };
    }
  },

  {
    name: 'search',
    description: 'Search for tracks across all sources',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'number', description: 'Max results (default 10)' }
      },
      required: ['query']
    },
    execute: async ({ query, limit = 10 }, { search }) => {
      const results = await search(query);
      return {
        success: true,
        results: results.slice(0, limit).map(r => ({
          artist: r.artist,
          title: r.title,
          album: r.album,
          source: r.source
        }))
      };
    }
  },

  {
    name: 'queue_add',
    description: 'Add tracks to the queue',
    parameters: {
      type: 'object',
      properties: {
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              artist: { type: 'string' },
              title: { type: 'string' }
            }
          }
        },
        position: { type: 'string', enum: ['next', 'last'] }
      },
      required: ['tracks']
    },
    execute: async ({ tracks, position = 'last' }, { search, addToQueue }) => {
      const resolved = [];
      for (const track of tracks) {
        const results = await search(`${track.artist} ${track.title}`);
        if (results.length > 0) {
          resolved.push(results[0]);
        }
      }
      await addToQueue(resolved, position);
      return { success: true, added: resolved.length };
    }
  },

  {
    name: 'queue_clear',
    description: 'Clear the playback queue',
    execute: async (_, { clearQueue }) => {
      await clearQueue();
      return { success: true };
    }
  },

  {
    name: 'create_playlist',
    description: 'Create a new playlist',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Playlist name' },
        tracks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              artist: { type: 'string' },
              title: { type: 'string' }
            }
          }
        }
      },
      required: ['name', 'tracks']
    },
    execute: async ({ name, tracks }, { createPlaylist }) => {
      const playlist = await createPlaylist(name, tracks);
      return { success: true, playlist };
    }
  },

  {
    name: 'shuffle',
    description: 'Toggle shuffle mode',
    parameters: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' }
      },
      required: ['enabled']
    },
    execute: async ({ enabled }, { setShuffle }) => {
      setShuffle(enabled);
      return { success: true, shuffle: enabled };
    }
  }
];
```

### Integration with app.js

```javascript
// New state for chat
const [chatMessages, setChatMessages] = useState([]);
const [chatProvider, setChatProvider] = useState(null);
const [chatOpen, setChatOpen] = useState(false);
const [chatLoading, setChatLoading] = useState(false);

// Initialize chat service
const chatServiceRef = useRef(null);

useEffect(() => {
  if (chatProvider) {
    chatServiceRef.current = new AIChatService(
      chatProvider,
      djTools,
      () => ({
        nowPlaying: currentTrack,
        playbackState: isPlaying ? 'playing' : 'paused',
        queue: queue,
        history: listeningHistory,
        shuffle: shuffleEnabled
      })
    );
  }
}, [chatProvider]);

// Send message handler
const handleChatSend = async (message) => {
  if (!chatServiceRef.current) return;

  setChatMessages(prev => [...prev, { role: 'user', content: message }]);
  setChatLoading(true);

  try {
    const response = await chatServiceRef.current.sendMessage(message);
    setChatMessages(prev => [...prev, {
      role: 'assistant',
      content: response.content,
      toolResults: response.toolResults
    }]);
  } catch (error) {
    setChatMessages(prev => [...prev, {
      role: 'assistant',
      content: `Sorry, I encountered an error: ${error.message}`,
      isError: true
    }]);
  } finally {
    setChatLoading(false);
  }
};

// Get chat-capable providers
const getChatProviders = () => {
  return resolverLoaderRef.current?.getAllResolvers().filter(r =>
    r.capabilities?.chat && r.enabled
  ) || [];
};
```

## Settings UI

Add a section in Settings for AI DJ configuration.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Settings > AI DJ                                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  AI Provider                                                        │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ [●] Ollama (Local)                              [Configure] │    │
│  │     Free, private, runs on your computer                    │    │
│  │     Status: ✓ Connected (llama3.1)                          │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ [○] OpenAI                                      [Configure] │    │
│  │     GPT-4o, requires API key                                │    │
│  │     Status: Not configured                                  │    │
│  └─────────────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │ [○] Google Gemini                               [Configure] │    │
│  │     Free tier available                                     │    │
│  │     Status: ✓ API key set                                   │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  Keyboard Shortcut                                                  │
│  Open AI DJ: [Cmd+J]                                                │
│                                                                     │
│  Context Sharing                                                    │
│  [✓] Include listening history                                      │
│  [✓] Include current queue                                          │
│  [ ] Include playlist names                                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Error Handling

### Provider Errors

| Scenario | User Message |
|----------|--------------|
| Ollama not running | "Ollama isn't running. Start it with `ollama serve` or check the connection." |
| Invalid API key | "Invalid API key. Check your settings." |
| Rate limit (429) | "Rate limit reached. Try again in a moment, or switch to a local provider." |
| Model not found | "Model 'llama3.1' not found. Pull it with `ollama pull llama3.1`." |
| Network error | "Couldn't connect to the AI service. Check your internet connection." |

### Tool Execution Errors

| Scenario | AI Should Say |
|----------|---------------|
| Track not found | "I couldn't find that track. Would you like me to search for something similar?" |
| Queue empty | "The queue is already empty." |
| Playback failed | "I couldn't start playback. The track might not be available on your connected services." |

## Privacy Considerations

### Local-First

- **Ollama** runs entirely on user's machine — no data leaves the computer
- Recommended as default for privacy-conscious users
- No API keys, no cloud dependencies, works offline

### Cloud Providers

When using cloud providers:
- Only current context (now playing, queue, history summary) is sent
- No audio data is transmitted
- No personal identifiers beyond listening data
- Users can disable specific context in settings

### Data Sent to AI

```javascript
// Example of what gets sent (no PII, no credentials)
{
  "messages": [...],
  "context": {
    "nowPlaying": { "artist": "Big Thief", "title": "Vampire Empire" },
    "queue": [/* track list */],
    "history": { "topArtists": [...], "totalPlays": 147 }
  }
}
```

## Future Enhancements

### V2: Voice Input

- Add microphone button for voice commands
- Use Web Speech API or Whisper for transcription
- "Hey DJ, play something upbeat"

### V2: Proactive Suggestions

- AI notices queue is almost empty → suggests additions
- Detects listening patterns → "You usually listen to jazz at this time"
- End of playlist → "Want me to keep the music going?"

### V3: External MCP Server

For users who want to control Parachord from Claude Desktop or other MCP clients:
- Expose the same tools via MCP protocol
- Standalone server that connects via WebSocket
- See Appendix A for MCP server design

### V3: Learning & Personalization

- Remember user preferences across sessions
- Learn which suggestions get accepted/skipped
- Build taste profile for better recommendations

## Rollout Plan

1. **Phase 1**: Core infrastructure
   - Tool definitions and executors
   - Chat orchestration service
   - Context injection

2. **Phase 2**: Ollama provider
   - Local-first, no API key needed
   - Test tool calling with Llama 3.1

3. **Phase 3**: Chat UI
   - Sidebar panel
   - Message rendering
   - Provider selector

4. **Phase 4**: Cloud providers
   - Extend existing ChatGPT/Gemini with `chat` capability
   - Add Claude, Groq providers

5. **Phase 5**: Polish
   - Error handling
   - Loading states
   - Keyboard shortcuts
   - Settings UI

---

## Appendix A: External MCP Server (Future)

For users who want to access Parachord from external MCP clients like Claude Desktop, a standalone MCP server can be added later. This would:

- Run as a separate process
- Connect to Parachord via WebSocket (port 21863)
- Expose the same tools via MCP protocol
- Be launched by Claude Desktop via stdio

This is complementary to the embedded chat — the embedded version is for in-app use, while MCP would allow external AI assistants to control Parachord.

See original MCP server design for implementation details.
