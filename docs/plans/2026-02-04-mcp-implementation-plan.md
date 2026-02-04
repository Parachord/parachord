# Conversational DJ Implementation Plan

**Based on:** `docs/plans/2026-02-03-mcp-server-design.md`
**Created:** 2026-02-04
**Status:** Planning

---

## Overview

This document provides a detailed, actionable implementation plan for adding a Conversational DJ feature to Parachord with pluggable AI backends. The plan follows the phased rollout from the design doc while accounting for the existing codebase structure.

### Key Integration Points

| Existing Infrastructure | Location | How We'll Use It |
|------------------------|----------|------------------|
| Plugin system (`.axe` files) | `resolver-loader.js` | Add `chat` capability to meta-services |
| AI service management | `app.js:5736-5741` (`getAiServices()`) | Extend to filter by `chat` capability |
| Listening context | `app.js:10777-10930` | Reuse for context injection |
| AI state management | `app.js:3443-3450` | Extend with chat-specific state |
| Results sidebar | `app.js` (`resultsSidebar` state) | Reference pattern for chat panel |
| Queue/playback controls | Throughout `app.js` | Expose as DJ tools |

---

## Phase 1: Core Infrastructure

**Goal:** Build the foundation for tool execution and chat orchestration.

### Task 1.1: Create DJ Tools Module

**File:** `tools/dj-tools.js` (new)

Create tool definitions with JSON Schema parameters and executor functions.

```javascript
// Structure for each tool:
{
  name: string,
  description: string,
  parameters: JSONSchema,
  execute: async (args, appContext) => result
}
```

**Tools to implement:**

| Tool | Priority | Depends On |
|------|----------|------------|
| `control` | P0 | Playback handlers from app.js |
| `search` | P0 | Existing search infrastructure |
| `play` | P0 | search + playTrack |
| `queue_add` | P0 | search + addToQueue |
| `queue_clear` | P1 | clearQueue handler |
| `shuffle` | P1 | setShuffle handler |
| `create_playlist` | P2 | createPlaylist handler |

**Subtasks:**
- [ ] Create `tools/` directory
- [ ] Define tool interfaces and JSON schemas
- [ ] Implement tool executors with proper error handling
- [ ] Add type annotations with JSDoc
- [ ] Export tool registry as array + lookup map

**Estimated complexity:** Medium

---

### Task 1.2: Create Chat Orchestration Service

**File:** `services/ai-chat.js` (new)

Build the `AIChatService` class that manages:
- Conversation history (messages array)
- Provider abstraction (call any chat-capable plugin)
- Tool execution loop
- Context injection

```javascript
class AIChatService {
  constructor(provider, tools, getContext)
  async sendMessage(userMessage) // Main entry point
  async executeTools(toolCalls)  // Run tools, collect results
  buildSystemPrompt(context)     // Inject current state
  clearHistory()                 // Reset conversation
}
```

**Subtasks:**
- [ ] Create `services/` directory
- [ ] Implement AIChatService class per design doc
- [ ] Handle multi-turn tool calling (tool call → result → follow-up)
- [ ] Add conversation memory limits (prevent runaway context)
- [ ] Add timeout handling for provider calls
- [ ] Export factory function for creating service instances

**Key decision:** Tool results should be summarized before adding to history to prevent context bloat.

**Estimated complexity:** High

---

### Task 1.3: Create Context Builder

**File:** `services/ai-chat.js` (part of Task 1.2)

Build the system prompt template and context gathering function.

**Context data to include:**
- `nowPlaying` - Current track (title, artist, album, source, position, duration)
- `playbackState` - "playing" | "paused"
- `queue` - Array of queued tracks (limit to 20 for context size)
- `history` - Top artists/tracks from Last.fm/ListenBrainz (reuse existing)
- `shuffle` - Current shuffle state
- `repeat` - Current repeat state

**Subtasks:**
- [ ] Create Handlebars-style template for system prompt
- [ ] Build `getContext()` function that pulls from app state
- [ ] Add context size limits to prevent token overflow
- [ ] Support configurable context (user can disable history sharing)

**Estimated complexity:** Medium

---

### Task 1.4: Wire Up Tool Context

**File:** `app.js` (modifications)

Create a stable reference object that tools can use to call app functions.

```javascript
// Create ref to pass to tools
const toolContextRef = useRef({
  search: searchResolvers,
  playTrack: (track) => { /* ... */ },
  addToQueue: (tracks, position) => { /* ... */ },
  clearQueue: () => setCurrentQueue([]),
  handlePause, handlePlay, handleNext, handlePrevious,
  setShuffle: (enabled) => setShuffleEnabled(enabled),
  createPlaylist: async (name, tracks) => { /* ... */ },
  // Getters for current state
  getCurrentTrack: () => currentTrack,
  getQueue: () => currentQueue,
  getIsPlaying: () => isPlaying,
});
```

**Subtasks:**
- [ ] Identify all required handlers in app.js
- [ ] Create stable ref object with handlers
- [ ] Update ref when handlers change (useEffect)
- [ ] Document which handlers are exposed

**Estimated complexity:** Medium

---

## Phase 2: Ollama Provider Plugin

**Goal:** Create the first chat provider (local, free) to test the full loop.

### Task 2.1: Create Ollama Plugin

**File:** `plugins/ollama.axe` (new)

```json
{
  "manifest": {
    "id": "ollama",
    "name": "Ollama (Local)",
    "type": "meta-service",
    "version": "1.0.0",
    "icon": "🦙",
    "color": "#000000",
    "description": "Run AI locally with Ollama. Free, private, works offline."
  },
  "capabilities": {
    "chat": true
  },
  "settings": {
    "requiresAuth": false,
    "configurable": {
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
    }
  },
  "implementation": {
    "chat": "async function(messages, tools, config) { /* ... */ }"
  }
}
```

**Subtasks:**
- [ ] Create plugin file with manifest and settings
- [ ] Implement chat function using Ollama API `/api/chat`
- [ ] Map tools to Ollama's function calling format
- [ ] Handle tool call response parsing
- [ ] Add connection test/health check function
- [ ] Test with different Ollama models

**Ollama API reference:**
- Endpoint: `POST /api/chat`
- Tool format: Same as OpenAI (`tools` array with `function` objects)
- Response: `{ message: { content, tool_calls } }`

**Estimated complexity:** Medium

---

### Task 2.2: Update Resolver Loader for Chat Capability

**File:** `resolver-loader.js` (modifications)

**Subtasks:**
- [ ] Add `chat` to capability types in loader
- [ ] Create `getChatProviders()` method to filter by chat capability
- [ ] Ensure chat function is properly extracted from implementation
- [ ] Add validation for chat function signature

```javascript
getChatProviders() {
  return this.resolvers.filter(r =>
    r.capabilities?.chat && r.enabled
  );
}
```

**Estimated complexity:** Low

---

### Task 2.3: Integration Test Harness

Create a minimal test to verify the full loop works.

**Subtasks:**
- [ ] Create test script that:
  1. Loads Ollama plugin
  2. Creates AIChatService instance
  3. Sends test message "What's playing?"
  4. Verifies response comes back
  5. Sends "Skip this track"
  6. Verifies tool call is executed
- [ ] Document Ollama setup requirements for testing

**Estimated complexity:** Low

---

## Phase 3: Chat UI

**Goal:** Build the user-facing chat interface.

### Task 3.1: Create Chat Panel Component

**File:** `app.js` (new component section) or `components/ChatPanel.js` (new)

Following the existing pattern in app.js where components are defined inline with React.memo.

**Component structure:**
```javascript
const ChatPanel = React.memo(({
  isOpen,
  messages,
  onSend,
  onClose,
  isLoading,
  providers,
  selectedProvider,
  onProviderChange
}) => {
  // Chat UI implementation
});
```

**UI elements:**
- Collapsible panel (slide in from right)
- Message list with virtual scrolling (if needed)
- Message bubbles (user/assistant styling)
- Tool call indicators (subtle badges showing actions taken)
- Input field with send button
- Provider selector dropdown
- Clear conversation button
- Loading indicator

**Subtasks:**
- [ ] Create ChatPanel component structure
- [ ] Implement message rendering with bubbles
- [ ] Add input field with Enter-to-send
- [ ] Add provider selector dropdown
- [ ] Implement slide-in/out animation (CSS transform)
- [ ] Add loading state indicator
- [ ] Support keyboard shortcut to toggle (Cmd+J / Ctrl+J)
- [ ] Auto-scroll to bottom on new messages
- [ ] Add tool result badges/indicators

**Estimated complexity:** High

---

### Task 3.2: Add Chat State to App

**File:** `app.js` (state additions around line 3443)

```javascript
// Chat-specific state
const [chatOpen, setChatOpen] = useState(false);
const [chatMessages, setChatMessages] = useState([]);
const [chatProvider, setChatProvider] = useState(null);
const [chatLoading, setChatLoading] = useState(false);
const [chatError, setChatError] = useState(null);

// Chat service ref
const chatServiceRef = useRef(null);
```

**Subtasks:**
- [ ] Add state variables
- [ ] Add useEffect to initialize/update chat service when provider changes
- [ ] Add `handleChatSend` function
- [ ] Add `handleChatClear` function
- [ ] Add `getChatProviders` helper
- [ ] Persist selected provider to electron-store

**Estimated complexity:** Medium

---

### Task 3.3: Add Chat Toggle Button

**File:** `app.js` (header/playbar area)

**Subtasks:**
- [ ] Add chat toggle button (💬 icon) to header near existing buttons
- [ ] Add keyboard shortcut handler for Cmd+J / Ctrl+J
- [ ] Show indicator when chat is "active" (unread messages or loading)
- [ ] Add tooltip with keyboard shortcut hint

**Estimated complexity:** Low

---

### Task 3.4: Style Chat Components

**File:** `app.js` (or separate CSS if extracted)

Using existing Tailwind patterns from the codebase.

**Subtasks:**
- [ ] Style chat panel container (width, shadow, background)
- [ ] Style message bubbles (user: blue/right, AI: gray/left)
- [ ] Style input area
- [ ] Style provider selector to match existing dropdowns
- [ ] Add dark mode support (follow existing patterns)
- [ ] Ensure responsive behavior on different window sizes

**Estimated complexity:** Medium

---

## Phase 4: Cloud Providers

**Goal:** Extend existing ChatGPT/Gemini plugins and add new providers.

### Task 4.1: Extend ChatGPT Plugin

**File:** `plugins/chatgpt.axe` (modify existing)

**Changes:**
1. Add `"chat": true` to capabilities
2. Add `chat` function to implementation

```javascript
// Chat function addition
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

**Subtasks:**
- [ ] Add chat capability flag
- [ ] Implement chat function
- [ ] Handle streaming (optional, for better UX)
- [ ] Test with gpt-4o-mini and gpt-4o

**Estimated complexity:** Medium

---

### Task 4.2: Extend Gemini Plugin

**File:** `plugins/gemini.axe` (modify existing)

**Changes:**
1. Add `"chat": true` to capabilities
2. Add `chat` function with Gemini-specific formatting

Gemini uses different message format and function declaration syntax.

**Subtasks:**
- [ ] Add chat capability flag
- [ ] Convert messages to Gemini format (`parts` array)
- [ ] Convert tools to Gemini function declarations
- [ ] Map Gemini response back to standard format
- [ ] Test with Gemini 2.0 Flash

**Estimated complexity:** Medium (format conversion)

---

### Task 4.3: Create Claude Plugin

**File:** `plugins/claude.axe` (new)

```json
{
  "manifest": {
    "id": "claude",
    "name": "Claude",
    "type": "meta-service",
    "version": "1.0.0",
    "icon": "🧡",
    "color": "#D97757",
    "description": "Anthropic's Claude - thoughtful and capable."
  },
  "capabilities": {
    "chat": true
  },
  "settings": {
    "requiresAuth": true,
    "authType": "apikey",
    "configurable": {
      "model": {
        "type": "select",
        "label": "Model",
        "options": ["claude-sonnet-4-20250514", "claude-3-5-haiku-20241022"],
        "default": "claude-sonnet-4-20250514"
      }
    }
  }
}
```

**Subtasks:**
- [ ] Create plugin with manifest
- [ ] Implement chat using Anthropic Messages API
- [ ] Handle Claude's tool use format
- [ ] Map response to standard format

**Estimated complexity:** Medium

---

### Task 4.4: Create Groq Plugin

**File:** `plugins/groq.axe` (new)

Groq uses OpenAI-compatible API, so implementation is similar to ChatGPT.

**Subtasks:**
- [ ] Create plugin with manifest
- [ ] Implement chat using Groq API (OpenAI-compatible)
- [ ] Test with Llama and Mistral models

**Estimated complexity:** Low (similar to ChatGPT)

---

## Phase 5: Polish

**Goal:** Error handling, loading states, settings, and refinements.

### Task 5.1: Comprehensive Error Handling

**Files:** `services/ai-chat.js`, `app.js`

**Error types to handle:**

| Error | Detection | User Message |
|-------|-----------|--------------|
| Ollama not running | Connection refused | "Ollama isn't running. Start it with `ollama serve`" |
| Invalid API key | 401 response | "Invalid API key. Check your settings." |
| Rate limit | 429 response | "Rate limit reached. Try again in a moment." |
| Model not found | 404 or model error | "Model not found. Try a different model." |
| Network error | fetch failure | "Couldn't connect. Check your internet." |
| Tool execution error | exception in executor | "I couldn't complete that action: [error]" |
| Timeout | Promise timeout | "The request took too long. Please try again." |

**Subtasks:**
- [ ] Add try/catch around provider calls
- [ ] Classify errors by type
- [ ] Show user-friendly error messages in chat
- [ ] Add retry button for transient errors
- [ ] Log errors for debugging (console + optional telemetry)

**Estimated complexity:** Medium

---

### Task 5.2: Loading States

**File:** `app.js` (ChatPanel component)

**Subtasks:**
- [ ] Show typing indicator while waiting for AI response
- [ ] Disable input during loading
- [ ] Show progress for tool execution (e.g., "Searching..." "Adding to queue...")
- [ ] Cancel button for long-running requests

**Estimated complexity:** Low

---

### Task 5.3: Settings UI

**File:** `app.js` (Settings view, around line 36500+)

Add "AI DJ" section to Settings page.

**Settings to include:**
- Provider selection (radio buttons)
- Per-provider configuration (API keys, model selection)
- Connection status indicators
- Keyboard shortcut customization (optional)
- Context sharing options:
  - [ ] Include listening history
  - [ ] Include current queue
  - [ ] Include playlist names (default off for privacy)

**Subtasks:**
- [ ] Add "AI DJ" section header
- [ ] List available providers with status
- [ ] Add configure button per provider
- [ ] Add context sharing toggles
- [ ] Save settings to electron-store
- [ ] Add Ollama connection test button

**Estimated complexity:** Medium

---

### Task 5.4: Keyboard Shortcuts

**File:** `app.js` (keyboard handler section)

**Subtasks:**
- [ ] Add Cmd+J / Ctrl+J to toggle chat panel
- [ ] Add Escape to close chat panel (when focused)
- [ ] Add Cmd+Enter / Ctrl+Enter to send message (alternative)
- [ ] Document shortcuts in settings/help

**Estimated complexity:** Low

---

### Task 5.5: Conversation Persistence

**File:** `services/ai-chat.js`, `app.js`

**Subtasks:**
- [ ] Save conversation history to sessionStorage (in-session persistence)
- [ ] Restore conversation on chat panel reopen
- [ ] Clear conversation on explicit user action
- [ ] Option: Persist across sessions (electron-store, optional)
- [ ] Limit conversation size (e.g., last 50 messages)

**Estimated complexity:** Medium

---

### Task 5.6: Welcome Message

**File:** `app.js` (ChatPanel)

When chat opens with empty history, show a welcome message:

```
AI DJ: What would you like to listen to? I can:
• Play specific songs or artists
• Control playback (pause, skip, etc.)
• Find music based on mood or activity
• Answer questions about what's playing
```

**Subtasks:**
- [ ] Add welcome message on empty state
- [ ] Show provider name in message
- [ ] Add quick action buttons (optional)

**Estimated complexity:** Low

---

## Testing Plan

### Unit Tests

| Module | Test Cases |
|--------|------------|
| `dj-tools.js` | Tool schema validation, executor error handling |
| `ai-chat.js` | Message formatting, tool call parsing, context building |

### Integration Tests

| Scenario | Description |
|----------|-------------|
| Full conversation loop | User message → AI response → Tool call → Result → Follow-up |
| Provider switching | Change provider mid-conversation, verify state preserved |
| Error recovery | Network failure, retry, successful response |
| Context injection | Verify now-playing data appears in AI responses |

### Manual Testing Checklist

- [ ] Ollama: Start conversation, ask about now playing, ask to skip
- [ ] ChatGPT: Same flow with API key
- [ ] Gemini: Same flow with API key
- [ ] Chat panel opens/closes with button and keyboard
- [ ] Messages display correctly with tool indicators
- [ ] Error messages are user-friendly
- [ ] Settings persist across app restart
- [ ] No memory leaks on long conversations

---

## Dependencies & Prerequisites

### External Dependencies

| Dependency | Purpose | Required For |
|------------|---------|--------------|
| Ollama (optional) | Local AI inference | Phase 2 |
| OpenAI API key (optional) | ChatGPT provider | Phase 4 |
| Google AI API key (optional) | Gemini provider | Phase 4 |

### Internal Dependencies

```
Phase 1: Core Infrastructure (no dependencies)
    ↓
    ├──→ Phase 2: Ollama Provider (depends on Phase 1)
    │        ↓
    ├──→ Phase 3: Chat UI (depends on Phase 1, can parallel Phase 2)
    │        ↓
    ├──→ Phase 4: Cloud Providers (depends on Phase 1)
    │        ↓
    └──→ Phase 6: External Protocol (depends on Phase 1, can parallel 2-5)
             ↓
         Phase 5: Polish (depends on all above)
```

**Note:** Phase 6 (External Protocol) can be developed in parallel with Phases 2-4 since it only depends on Phase 1's DJ tools.

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Ollama tool calling unreliable | Medium | Fall back to prompt-based parsing |
| Context too large for models | Medium | Implement context truncation |
| Tool execution side effects | High | Add confirmation for destructive actions |
| Provider API changes | Low | Version lock plugins, test on updates |
| Performance with long conversations | Medium | Limit history, summarize older messages |

---

## Phase 6: External Control Protocol

**Goal:** Expose DJ tools via `parachord:` URL scheme for external apps (browser extension, Raycast, Alfred, Shortcuts, etc.)

### Context

The existing infrastructure includes:
- WebSocket server on port 9876 for browser extension (`docs/plans/2026-01-18-browser-extension-design.md`)
- `local-audio://` protocol for local file playback
- `parachord://` mentioned in mobile docs for OAuth callbacks

This phase extends `parachord:` to support control commands, complementing:
- **Embedded chat** (Phase 1-5) — for in-app AI conversations
- **External MCP Server** (future) — for AI tool calling from Claude Desktop, etc.
- **`parachord:` protocol** (this phase) — for simple URL-based commands from any app

### Task 6.1: Register parachord: Protocol Handler

**File:** `main.js`

Register the custom URL scheme with Electron.

```javascript
// Add to protocol.registerSchemesAsPrivileged (before app.whenReady)
{
  scheme: 'parachord',
  privileges: {
    secure: true,
    supportFetchAPI: false,
    standard: true
  }
}

// In app.whenReady():
app.setAsDefaultProtocolClient('parachord');

// Handle protocol URLs
app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

// Windows/Linux: handle via second-instance
app.on('second-instance', (event, argv) => {
  const url = argv.find(arg => arg.startsWith('parachord://'));
  if (url) handleProtocolUrl(url);
});
```

**Subtasks:**
- [ ] Register `parachord` scheme as privileged
- [ ] Set app as default protocol client
- [ ] Handle `open-url` event (macOS)
- [ ] Handle `second-instance` for Windows/Linux
- [ ] Forward protocol URLs to renderer via IPC

**Estimated complexity:** Medium

---

### Task 6.2: Define Protocol URL Schema

**Documentation:** `docs/protocol-schema.md` (new)

Define URL formats for all DJ commands:

| Command | URL Format | Example |
|---------|------------|---------|
| Play track | `parachord://play?artist={}&title={}` | `parachord://play?artist=Big%20Thief&title=Vampire%20Empire` |
| Control | `parachord://control/{action}` | `parachord://control/pause` |
| Search | `parachord://search?q={}` | `parachord://search?q=big%20thief` |
| Queue add | `parachord://queue/add?artist={}&title={}` | `parachord://queue/add?artist=Big%20Thief&title=Sparrow` |
| Queue clear | `parachord://queue/clear` | `parachord://queue/clear` |
| Shuffle | `parachord://shuffle/{on\|off}` | `parachord://shuffle/on` |
| Open chat | `parachord://chat?prompt={}` | `parachord://chat?prompt=play%20something%20chill` |
| Volume | `parachord://volume/{0-100}` | `parachord://volume/75` |

**Query parameters:**
- All text parameters are URL-encoded
- Multiple tracks: `parachord://queue/add?tracks=[{...},{...}]` (JSON array)

**Subtasks:**
- [ ] Define URL schema for all DJ tools
- [ ] Document in `docs/protocol-schema.md`
- [ ] Include examples for each command
- [ ] Define error responses (via notification)

**Estimated complexity:** Low

---

### Task 6.3: Implement Protocol URL Parser

**File:** `services/protocol-handler.js` (new)

Parse incoming URLs and dispatch to appropriate handlers.

```javascript
export function parseProtocolUrl(url) {
  const parsed = new URL(url);
  const path = parsed.pathname.replace(/^\/+/, '');
  const params = Object.fromEntries(parsed.searchParams);

  // parachord://control/pause → { command: 'control', action: 'pause' }
  // parachord://play?artist=X&title=Y → { command: 'play', artist: 'X', title: 'Y' }

  const [command, ...rest] = path.split('/');

  return {
    command,
    action: rest[0],
    params
  };
}

export function validateProtocolCommand(parsed) {
  // Validate required params exist
  // Return { valid: true } or { valid: false, error: '...' }
}
```

**Subtasks:**
- [ ] Create URL parser function
- [ ] Add validation for each command type
- [ ] Handle malformed URLs gracefully
- [ ] Return structured command objects

**Estimated complexity:** Medium

---

### Task 6.4: Connect Protocol to DJ Tools

**File:** `app.js` or `services/protocol-handler.js`

Reuse the DJ tools from Phase 1 to execute protocol commands.

```javascript
// In renderer, handle IPC from main process
window.electron.onProtocolUrl(async (url) => {
  const { command, action, params } = parseProtocolUrl(url);

  try {
    switch (command) {
      case 'play':
        await djTools.play.execute(params, toolContext);
        break;
      case 'control':
        await djTools.control.execute({ action }, toolContext);
        break;
      case 'search':
        await djTools.search.execute({ query: params.q }, toolContext);
        // Open search results in UI
        break;
      case 'queue':
        if (action === 'add') {
          await djTools.queue_add.execute({ tracks: [params] }, toolContext);
        } else if (action === 'clear') {
          await djTools.queue_clear.execute({}, toolContext);
        }
        break;
      case 'chat':
        setChatOpen(true);
        if (params.prompt) {
          handleChatSend(params.prompt);
        }
        break;
      // ...
    }
    showNotification(`✓ ${command} executed`);
  } catch (error) {
    showNotification(`✗ ${command} failed: ${error.message}`);
  }
});
```

**Subtasks:**
- [ ] Add IPC handler in preload.js for protocol URLs
- [ ] Map protocol commands to DJ tool executors
- [ ] Show toast notifications for success/failure
- [ ] Focus app window when protocol URL received

**Estimated complexity:** Medium

---

### Task 6.5: Browser Extension Integration

**File:** `parachord-extension/popup.js` (modify)

Update browser extension to use `parachord:` URLs as fallback when WebSocket is unavailable.

```javascript
// If WebSocket not connected, fall back to protocol URL
function sendToParachord(command) {
  if (wsConnected) {
    ws.send(JSON.stringify(command));
  } else {
    // Fall back to protocol URL
    const url = buildProtocolUrl(command);
    window.location.href = url;
  }
}
```

**Subtasks:**
- [ ] Add protocol URL fallback in extension
- [ ] Test extension → protocol → app flow
- [ ] Document when fallback is used

**Estimated complexity:** Low

---

### Task 6.6: External App Examples

**File:** `docs/integrations/` (new directory)

Create documentation and examples for external integrations.

**Raycast extension:**
```typescript
// raycast-parachord/src/pause.ts
import { open } from "@raycast/api";

export default async function Command() {
  await open("parachord://control/pause");
}
```

**Alfred workflow:**
```bash
# Play a song
open "parachord://play?artist={query}&title={query2}"
```

**macOS Shortcuts:**
- "Open URL" action with `parachord://control/pause`

**Subtasks:**
- [ ] Create Raycast extension template
- [ ] Create Alfred workflow example
- [ ] Document macOS Shortcuts integration
- [ ] Document Stream Deck integration
- [ ] Add examples to README or docs

**Estimated complexity:** Low (documentation only)

---

### Task 6.7: Security Considerations

**File:** `main.js`, `services/protocol-handler.js`

Prevent abuse of protocol URLs.

**Mitigations:**
- Rate limiting: Max 10 commands per second
- Validate all input parameters
- No arbitrary code execution
- Log protocol URL usage for debugging

```javascript
const rateLimiter = {
  lastCall: 0,
  callCount: 0,

  check() {
    const now = Date.now();
    if (now - this.lastCall > 1000) {
      this.callCount = 0;
      this.lastCall = now;
    }
    this.callCount++;
    return this.callCount <= 10;
  }
};
```

**Subtasks:**
- [ ] Add rate limiting
- [ ] Sanitize all URL parameters
- [ ] Add logging for debugging
- [ ] Test with malformed URLs

**Estimated complexity:** Low

---

## Success Criteria

### MVP (Phases 1-3)

- [ ] User can have multi-turn conversation with Ollama
- [ ] AI can control playback (pause, skip, etc.)
- [ ] AI can search and play/queue tracks
- [ ] Chat panel opens/closes smoothly
- [ ] Basic error handling works

### Full Release (Phases 4-6)

- [ ] Multiple providers work (Ollama, ChatGPT, Gemini, Claude)
- [ ] Settings UI allows provider configuration
- [ ] Polished error messages
- [ ] Keyboard shortcuts work
- [ ] `parachord:` protocol works from external apps
- [ ] No major bugs or crashes

---

## Appendix: File Changes Summary

### New Files

| File | Description |
|------|-------------|
| `tools/dj-tools.js` | Tool definitions and executors |
| `services/ai-chat.js` | Chat orchestration service |
| `services/protocol-handler.js` | `parachord:` URL parser and validator |
| `plugins/ollama.axe` | Ollama chat provider |
| `plugins/claude.axe` | Claude chat provider |
| `plugins/groq.axe` | Groq chat provider |
| `docs/protocol-schema.md` | `parachord:` URL scheme documentation |
| `docs/integrations/raycast.md` | Raycast integration example |
| `docs/integrations/alfred.md` | Alfred workflow example |

### Modified Files

| File | Changes |
|------|---------|
| `main.js` | Register `parachord:` protocol handler |
| `preload.js` | Add IPC for protocol URLs |
| `resolver-loader.js` | Add `getChatProviders()` method |
| `app.js` | Add chat state, ChatPanel component, settings UI, protocol handling |
| `plugins/chatgpt.axe` | Add `chat` capability and function |
| `plugins/gemini.axe` | Add `chat` capability and function |
| `parachord-extension/popup.js` | Add protocol URL fallback |

---

## Next Steps

1. **Review this plan** with stakeholders
2. **Set up Phase 1** branch and start with `dj-tools.js`
3. **Install Ollama** for local testing during development
4. **Create tracking issues** for each phase in GitHub

---

*This plan will be updated as implementation progresses.*
