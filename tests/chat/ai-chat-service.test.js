/**
 * AIChatService Tests
 *
 * Tests for the chat service class that manages conversation flow,
 * tool calling loops, system prompt building, and error handling.
 */

// Recreate the core classes from app.js for testing
const djTools = [
  { name: 'play', description: 'Play a track', parameters: { type: 'object', properties: { artist: { type: 'string' }, title: { type: 'string' } }, required: ['artist', 'title'] } },
  { name: 'control', description: 'Control playback', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'start', 'skip', 'previous'] } }, required: ['action'] } },
  { name: 'search', description: 'Search tracks', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } },
  { name: 'queue_add', description: 'Add to queue', parameters: { type: 'object', properties: { tracks: { type: 'array' } }, required: ['tracks'] } },
  { name: 'queue_remove', description: 'Remove from queue', parameters: { type: 'object', properties: { artist: { type: 'string' }, title: { type: 'string' } } } },
  { name: 'queue_clear', description: 'Clear queue', parameters: { type: 'object', properties: {} } },
  { name: 'create_playlist', description: 'Create playlist', parameters: { type: 'object', properties: { name: { type: 'string' }, tracks: { type: 'array' } }, required: ['name', 'tracks'] } },
  { name: 'shuffle', description: 'Toggle shuffle', parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] } },
  { name: 'collection_radio', description: 'Start collection radio', parameters: { type: 'object', properties: {} } }
];

const getSimpleToolDefinitions = () => djTools.map(t => ({
  name: t.name,
  description: t.description,
  parameters: t.parameters
}));

// Simplified executeDjTool for service tests
const executeDjTool = async (name, args, context) => {
  switch (name) {
    case 'play': return { success: true, track: { artist: args.artist, title: args.title } };
    case 'search': return { success: true, results: [], total: 0 };
    case 'control': return { success: true, action: args.action };
    case 'queue_add': return { success: true, added: args.tracks?.length || 0 };
    case 'shuffle': return { success: true, shuffle: args.enabled };
    default: return { success: true };
  }
};

const AI_CHAT_SYSTEM_PROMPT = `You are a music DJ assistant. TODAY'S DATE: {{currentDate}}\nCURRENT STATE:\n{{currentState}}`;

class AIChatService {
  constructor(provider, toolContext, getContext) {
    this.provider = provider;
    this.toolContext = toolContext;
    this.getContext = getContext;
    this.messages = [];
    this.tools = getSimpleToolDefinitions();
    this.onProgress = null;
  }

  setProgressCallback(callback) { this.onProgress = callback; }

  _reportProgress(status) {
    if (this.onProgress) {
      try { this.onProgress(status); } catch (e) {}
    }
  }

  async sendMessage(userMessage) {
    this.messages.push({ role: 'user', content: userMessage });
    if (this.messages.length > 50) {
      this.messages = [this.messages[0], ...this.messages.slice(-49)];
    }

    const context = await this.getContext();
    const systemPrompt = this.buildSystemPrompt(context);
    const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...this.messages];

    let response;
    try {
      response = await this.provider.chat(messagesWithSystem, this.tools, this.provider.config);
    } catch (error) {
      this._lastErrorType = null;
      const errorMessage = this.formatProviderError(error);
      this.messages.push({ role: 'assistant', content: errorMessage });
      const result = { content: errorMessage, error: true };
      if (this._lastErrorType === 'ollama_connection') {
        result.ollamaUnavailable = true;
      }
      return result;
    }

    const toolCalls = response.toolCalls || response.tool_calls;
    if (toolCalls && toolCalls.length > 0) {
      return await this.handleToolCalls({ ...response, tool_calls: toolCalls }, systemPrompt);
    }

    let content = response.content;
    const lowerContent = content.toLowerCase();
    const mentionsAction = lowerContent.includes("i'll play") || lowerContent.includes("playing");

    if (mentionsAction && !toolCalls) {
      content += "\n\n⚠️ Note: I described an action but couldn't execute it. This model may not support tool calling well. Try using ChatGPT or a larger Ollama model like llama3.1 or qwen2.5.";
    }

    this.messages.push({ role: 'assistant', content: content });
    return { content: content };
  }

  async handleToolCalls(response, systemPrompt) {
    let toolResults = [];
    let iterations = 0;
    let currentResponse = response;

    while ((currentResponse.tool_calls || currentResponse.toolCalls) && iterations < 5) {
      iterations++;
      const calls = currentResponse.tool_calls || currentResponse.toolCalls;

      this.messages.push({
        role: 'assistant',
        content: currentResponse.content || '',
        tool_calls: calls
      });

      for (const call of calls) {
        const toolLabels = {
          search: 'Searching...',
          play: 'Playing track...',
          queue_add: 'Adding to queue...',
          shuffle: call.arguments?.enabled ? 'Enabling shuffle...' : 'Disabling shuffle...'
        };
        this._reportProgress(toolLabels[call.name] || `Running ${call.name}...`);

        const result = await executeDjTool(call.name, call.arguments, this.toolContext);
        toolResults.push({ tool: call.name, arguments: call.arguments, result });
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id || call.name,
          content: JSON.stringify(result)
        });
      }

      const messagesWithSystem = [{ role: 'system', content: systemPrompt }, ...this.messages];
      try {
        currentResponse = await this.provider.chat(messagesWithSystem, this.tools, this.provider.config);
        if (currentResponse.toolCalls && !currentResponse.tool_calls) {
          currentResponse.tool_calls = currentResponse.toolCalls;
        }
      } catch (error) {
        this.messages.push({ role: 'assistant', content: 'I encountered an error while processing.' });
        return { content: 'I encountered an error while processing.', toolResults, error: true };
      }
    }

    const finalContent = currentResponse.content || this.summarizeToolResults(toolResults);
    this.messages.push({ role: 'assistant', content: finalContent });
    return { content: finalContent, toolResults };
  }

  buildSystemPrompt(context) {
    const lines = [];
    if (context.nowPlaying) {
      lines.push(`Now Playing: "${context.nowPlaying.title}" by ${context.nowPlaying.artist}`);
      lines.push(`  State: ${context.playbackState || 'unknown'}`);
    } else {
      lines.push('Nothing is currently playing.');
    }
    if (context.queue && context.queue.length > 0) {
      lines.push(`\nQueue (${context.queue.length} tracks):`);
      context.queue.slice(0, 10).forEach((t, i) => lines.push(`  ${i + 1}. "${t.title}" by ${t.artist}`));
    }
    if (context.shuffle !== undefined) lines.push(`\nShuffle: ${context.shuffle ? 'On' : 'Off'}`);

    if (context.collection) {
      const { favoriteArtists } = context.collection;
      if (favoriteArtists?.length > 0) {
        lines.push(`\nUSER COLLECTION:`);
        lines.push(`  Favorite artists: ${favoriteArtists.slice(0, 10).join(', ')}`);
      }
    }

    if (context.timeContext) {
      const { timeOfDay, dayOfWeek, isWeekend } = context.timeContext;
      lines.push(`\nTIME CONTEXT: ${timeOfDay} on ${dayOfWeek}${isWeekend ? ' (weekend)' : ''}`);
    }

    const now = new Date();
    const currentDate = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const currentYear = now.getFullYear();
    return AI_CHAT_SYSTEM_PROMPT
      .replace('{{currentDate}}', currentDate)
      .replace('{{currentState}}', lines.join('\n'));
  }

  summarizeToolResults(toolResults) {
    if (!toolResults || toolResults.length === 0) return 'Done.';
    return toolResults.map(({ tool, result }) => {
      if (!result.success) return `Failed to ${tool}: ${result.error}`;
      switch (tool) {
        case 'play': return result.track ? `Now playing "${result.track.title}" by ${result.track.artist}` : 'Started playback';
        case 'control': return `Playback ${result.action}`;
        case 'search': return `Found ${result.results?.length || 0} results`;
        case 'queue_add': return `Added ${result.added} track(s) to queue`;
        case 'queue_clear': return 'Queue cleared';
        case 'shuffle': return `Shuffle ${result.shuffle ? 'enabled' : 'disabled'}`;
        default: return `${tool} completed`;
      }
    }).join('. ') + '.';
  }

  formatProviderError(error) {
    const message = error.message || '';
    const lowerMessage = message.toLowerCase();

    if (lowerMessage.includes('failed to fetch') || lowerMessage.includes('econnrefused')) {
      const endpoint = this.provider.config?.endpoint || '';
      if (endpoint.includes('localhost:11434') || this.provider.id === 'ollama') {
        this._lastErrorType = 'ollama_connection';
        return "Can't connect to Ollama. Attempting to start it...";
      }
      return "Can't connect to the AI service. Check your internet connection.";
    }
    if (lowerMessage.includes('quota') || lowerMessage.includes('exceeded')) {
      return "API quota exceeded. Check your plan limits or try again later.";
    }
    if (message.includes('429') || lowerMessage.includes('rate limit')) {
      return "Rate limit reached. Please wait a moment and try again.";
    }
    if (message.includes('401') || lowerMessage.includes('unauthorized')) {
      return "Invalid API key. Please check your settings.";
    }
    if (message.includes('404') || lowerMessage.includes('not found')) {
      const endpoint = this.provider.config?.endpoint || '';
      if (endpoint.includes('localhost:11434') || this.provider.id === 'ollama') {
        const model = this.provider.config?.model || 'llama3.1';
        return `Model "${model}" not installed. Run: ollama pull ${model}`;
      }
      return "AI model not found. Check your settings or try a different model.";
    }
    if (lowerMessage.includes('content policy') || lowerMessage.includes('safety')) {
      return "Request was blocked by content policy. Try rephrasing.";
    }
    const shortMessage = message.length > 100 ? message.substring(0, 100) + '...' : message;
    return `Error: ${shortMessage}`;
  }

  clearHistory() { this.messages = []; }
  restoreHistory(messages) { this.messages = messages || []; }
  getHistory() { return [...this.messages]; }
}


// --- Tests ---

function createMockProvider(overrides = {}) {
  return {
    id: 'test-provider',
    name: 'Test Provider',
    chat: jest.fn().mockResolvedValue({ content: 'Hello!', toolCalls: null }),
    config: { apiKey: 'test-key', model: 'test-model' },
    ...overrides
  };
}

function createMockGetContext(overrides = {}) {
  return jest.fn().mockResolvedValue({
    nowPlaying: null,
    playbackState: 'stopped',
    queue: [],
    shuffle: false,
    collection: null,
    listeningHistory: null,
    playlists: [],
    timeContext: { timeOfDay: 'evening', dayOfWeek: 'Friday', isWeekend: true },
    ...overrides
  });
}

describe('AIChatService', () => {
  let provider;
  let getContext;
  let toolContext;
  let service;

  beforeEach(() => {
    provider = createMockProvider();
    getContext = createMockGetContext();
    toolContext = {};
    service = new AIChatService(provider, toolContext, getContext);
  });

  describe('sendMessage', () => {
    test('sends user message and gets response', async () => {
      const result = await service.sendMessage('Play some music');

      expect(result.content).toBe('Hello!');
      expect(provider.chat).toHaveBeenCalledTimes(1);
    });

    test('adds user message to history', async () => {
      await service.sendMessage('Hello');

      const history = service.getHistory();
      expect(history[0]).toEqual({ role: 'user', content: 'Hello' });
    });

    test('adds assistant response to history', async () => {
      await service.sendMessage('Hello');

      const history = service.getHistory();
      expect(history[1]).toEqual({ role: 'assistant', content: 'Hello!' });
    });

    test('includes system prompt in provider call', async () => {
      await service.sendMessage('Hello');

      const calledMessages = provider.chat.mock.calls[0][0];
      expect(calledMessages[0].role).toBe('system');
      expect(calledMessages[0].content).toContain('music DJ assistant');
    });

    test('passes tools to provider', async () => {
      await service.sendMessage('Hello');

      const calledTools = provider.chat.mock.calls[0][1];
      expect(calledTools.length).toBe(9);
      expect(calledTools.map(t => t.name)).toContain('play');
      expect(calledTools.map(t => t.name)).toContain('search');
    });

    test('truncates history at 50 messages', async () => {
      // Fill history
      for (let i = 0; i < 55; i++) {
        service.messages.push({ role: 'user', content: `Message ${i}` });
      }

      await service.sendMessage('One more');

      expect(service.messages.length).toBeLessThanOrEqual(52); // 50 + assistant response + truncation
    });

    test('warns when model describes action without tool call', async () => {
      provider.chat.mockResolvedValue({ content: "I'll play some Radiohead for you!", toolCalls: null });

      const result = await service.sendMessage('Play Radiohead');

      expect(result.content).toContain("⚠️ Note: I described an action but couldn't execute it");
    });

    test('does not warn for normal text responses', async () => {
      provider.chat.mockResolvedValue({ content: 'Sure, what genre do you like?', toolCalls: null });

      const result = await service.sendMessage('Recommend something');

      expect(result.content).not.toContain('⚠️');
    });
  });

  describe('handleToolCalls', () => {
    test('executes tool and returns result', async () => {
      provider.chat
        .mockResolvedValueOnce({
          content: 'Let me play that',
          toolCalls: [{ id: 'call-1', name: 'play', arguments: { artist: 'Radiohead', title: 'Creep' } }]
        })
        .mockResolvedValueOnce({
          content: 'Now playing Creep by Radiohead!',
          toolCalls: null
        });

      const result = await service.sendMessage('Play Creep');

      expect(result.content).toBe('Now playing Creep by Radiohead!');
      expect(result.toolResults).toHaveLength(1);
      expect(result.toolResults[0].tool).toBe('play');
    });

    test('handles multiple tool calls in one response', async () => {
      provider.chat
        .mockResolvedValueOnce({
          content: '',
          toolCalls: [
            { id: 'call-1', name: 'play', arguments: { artist: 'Radiohead', title: 'Creep' } },
            { id: 'call-2', name: 'queue_add', arguments: { tracks: [{ artist: 'Radiohead', title: 'Karma Police' }] } }
          ]
        })
        .mockResolvedValueOnce({
          content: 'Playing Creep and queued Karma Police!',
          toolCalls: null
        });

      const result = await service.sendMessage('Play Creep then queue Karma Police');

      expect(result.toolResults).toHaveLength(2);
    });

    test('handles multi-turn tool calling (up to 5 iterations)', async () => {
      // First call: search
      provider.chat
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: '1', name: 'search', arguments: { query: 'chill music' } }]
        })
        // Second call: play from search results
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: '2', name: 'play', arguments: { artist: 'Radiohead', title: 'Creep' } }]
        })
        // Final response
        .mockResolvedValueOnce({
          content: 'Found and playing something chill!', toolCalls: null
        });

      const result = await service.sendMessage('Find me something chill');

      expect(result.toolResults).toHaveLength(2);
      expect(provider.chat).toHaveBeenCalledTimes(3);
    });

    test('stops after 5 iterations to prevent infinite loops', async () => {
      // Always return tool calls
      provider.chat.mockResolvedValue({
        content: '', toolCalls: [{ id: '1', name: 'search', arguments: { query: 'test' } }]
      });

      const result = await service.sendMessage('Loop test');

      // 1 initial + 5 iterations = 6 calls max
      expect(provider.chat).toHaveBeenCalledTimes(6);
    });

    test('reports progress for each tool', async () => {
      const progressUpdates = [];
      service.setProgressCallback((status) => progressUpdates.push(status));

      provider.chat
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: '1', name: 'search', arguments: { query: 'test' } }]
        })
        .mockResolvedValueOnce({ content: 'Done!', toolCalls: null });

      await service.sendMessage('Search');

      expect(progressUpdates).toContain('Searching...');
    });

    test('adds tool results to message history', async () => {
      provider.chat
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: 'call-1', name: 'play', arguments: { artist: 'Test', title: 'Song' } }]
        })
        .mockResolvedValueOnce({ content: 'Played!', toolCalls: null });

      await service.sendMessage('Play something');

      const history = service.getHistory();
      const toolMessage = history.find(m => m.role === 'tool');
      expect(toolMessage).toBeDefined();
      expect(toolMessage.tool_call_id).toBe('call-1');
      expect(JSON.parse(toolMessage.content)).toHaveProperty('success', true);
    });

    test('handles provider error during tool follow-up', async () => {
      provider.chat
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: '1', name: 'play', arguments: { artist: 'Test', title: 'Song' } }]
        })
        .mockRejectedValueOnce(new Error('API error'));

      const result = await service.sendMessage('Play something');

      expect(result.error).toBe(true);
      expect(result.content).toContain('error while processing');
    });

    test('uses summarizeToolResults when no final content', async () => {
      provider.chat
        .mockResolvedValueOnce({
          content: '', toolCalls: [{ id: '1', name: 'play', arguments: { artist: 'Test', title: 'Song' } }]
        })
        .mockResolvedValueOnce({ content: '', toolCalls: null });

      const result = await service.sendMessage('Play something');

      expect(result.content).toContain('Now playing');
    });
  });

  describe('buildSystemPrompt', () => {
    test('includes now playing info', () => {
      const context = {
        nowPlaying: { title: 'Creep', artist: 'Radiohead' },
        playbackState: 'playing',
        queue: []
      };

      const prompt = service.buildSystemPrompt(context);

      expect(prompt).toContain('Now Playing: "Creep" by Radiohead');
      expect(prompt).toContain('State: playing');
    });

    test('shows nothing playing when idle', () => {
      const prompt = service.buildSystemPrompt({ queue: [] });

      expect(prompt).toContain('Nothing is currently playing');
    });

    test('includes queue tracks (up to 10)', () => {
      const queue = Array.from({ length: 15 }, (_, i) => ({
        title: `Track ${i}`, artist: `Artist ${i}`
      }));

      const prompt = service.buildSystemPrompt({ queue });

      expect(prompt).toContain('Queue (15 tracks)');
      expect(prompt).toContain('Track 0');
      expect(prompt).toContain('Track 9');
      expect(prompt).not.toContain('Track 10');
    });

    test('includes shuffle state', () => {
      const prompt = service.buildSystemPrompt({ queue: [], shuffle: true });
      expect(prompt).toContain('Shuffle: On');
    });

    test('includes collection data', () => {
      const prompt = service.buildSystemPrompt({
        queue: [],
        collection: {
          favoriteArtists: ['Radiohead', 'Nirvana', 'Pixies']
        }
      });

      expect(prompt).toContain('USER COLLECTION');
      expect(prompt).toContain('Radiohead, Nirvana, Pixies');
    });

    test('includes time context', () => {
      const prompt = service.buildSystemPrompt({
        queue: [],
        timeContext: { timeOfDay: 'morning', dayOfWeek: 'Saturday', isWeekend: true }
      });

      expect(prompt).toContain('morning on Saturday (weekend)');
    });

    test('includes current date', () => {
      const prompt = service.buildSystemPrompt({ queue: [] });
      const year = new Date().getFullYear();
      expect(prompt).toContain(String(year));
    });
  });

  describe('summarizeToolResults', () => {
    test('summarizes play result', () => {
      const summary = service.summarizeToolResults([
        { tool: 'play', result: { success: true, track: { artist: 'Radiohead', title: 'Creep' } } }
      ]);

      expect(summary).toBe('Now playing "Creep" by Radiohead.');
    });

    test('summarizes multiple results', () => {
      const summary = service.summarizeToolResults([
        { tool: 'queue_add', result: { success: true, added: 3 } },
        { tool: 'shuffle', result: { success: true, shuffle: true } }
      ]);

      expect(summary).toContain('Added 3 track(s)');
      expect(summary).toContain('Shuffle enabled');
    });

    test('includes failure messages', () => {
      const summary = service.summarizeToolResults([
        { tool: 'play', result: { success: false, error: 'Not found' } }
      ]);

      expect(summary).toContain('Failed to play: Not found');
    });

    test('returns Done for empty results', () => {
      expect(service.summarizeToolResults([])).toBe('Done.');
      expect(service.summarizeToolResults(null)).toBe('Done.');
    });
  });

  describe('formatProviderError', () => {
    test('identifies Ollama connection error', () => {
      const ollamaProvider = createMockProvider({
        id: 'ollama',
        config: { endpoint: 'http://localhost:11434', model: 'llama3.1' }
      });
      const svc = new AIChatService(ollamaProvider, {}, getContext);

      const msg = svc.formatProviderError(new Error('Failed to fetch'));

      expect(msg).toContain('Ollama');
      expect(svc._lastErrorType).toBe('ollama_connection');
    });

    test('identifies generic connection error', () => {
      const msg = service.formatProviderError(new Error('Failed to fetch'));

      expect(msg).toContain('internet connection');
    });

    test('identifies rate limit', () => {
      const msg = service.formatProviderError(new Error('429 Too Many Requests'));

      expect(msg).toContain('Rate limit');
    });

    test('identifies auth error', () => {
      const msg = service.formatProviderError(new Error('401 Unauthorized'));

      expect(msg).toContain('Invalid API key');
    });

    test('identifies quota exceeded', () => {
      const msg = service.formatProviderError(new Error('Quota exceeded'));

      expect(msg).toContain('quota exceeded');
    });

    test('identifies Ollama model not found', () => {
      const ollamaProvider = createMockProvider({
        id: 'ollama',
        config: { endpoint: 'http://localhost:11434', model: 'mistral' }
      });
      const svc = new AIChatService(ollamaProvider, {}, getContext);

      const msg = svc.formatProviderError(new Error('404 Not Found'));

      expect(msg).toContain('mistral');
      expect(msg).toContain('ollama pull');
    });

    test('identifies content policy error', () => {
      const msg = service.formatProviderError(new Error('Content policy violation'));

      expect(msg).toContain('content policy');
    });

    test('truncates long error messages', () => {
      const longMsg = 'x'.repeat(200);
      const msg = service.formatProviderError(new Error(longMsg));

      expect(msg.length).toBeLessThan(150);
      expect(msg).toContain('...');
    });
  });

  describe('history management', () => {
    test('clearHistory empties messages', async () => {
      await service.sendMessage('Hello');
      expect(service.getHistory().length).toBeGreaterThan(0);

      service.clearHistory();
      expect(service.getHistory()).toEqual([]);
    });

    test('restoreHistory sets messages', () => {
      const messages = [
        { role: 'user', content: 'Previous message' },
        { role: 'assistant', content: 'Previous response' }
      ];

      service.restoreHistory(messages);

      expect(service.getHistory()).toEqual(messages);
    });

    test('restoreHistory handles null', () => {
      service.restoreHistory(null);
      expect(service.getHistory()).toEqual([]);
    });

    test('getHistory returns a copy', () => {
      service.messages.push({ role: 'user', content: 'test' });

      const history = service.getHistory();
      history.push({ role: 'user', content: 'injected' });

      expect(service.messages).toHaveLength(1);
    });
  });

  describe('provider error during sendMessage', () => {
    test('returns error result on provider failure', async () => {
      provider.chat.mockRejectedValue(new Error('API down'));

      const result = await service.sendMessage('Hello');

      expect(result.error).toBe(true);
      expect(result.content).toBeDefined();
    });

    test('adds error response to history', async () => {
      provider.chat.mockRejectedValue(new Error('API down'));

      await service.sendMessage('Hello');

      const history = service.getHistory();
      const assistantMsg = history.find(m => m.role === 'assistant');
      expect(assistantMsg).toBeDefined();
    });

    test('sets ollamaUnavailable flag for Ollama errors', async () => {
      const ollamaProvider = createMockProvider({
        id: 'ollama',
        config: { endpoint: 'http://localhost:11434' }
      });
      ollamaProvider.chat.mockRejectedValue(new Error('Failed to fetch'));
      const svc = new AIChatService(ollamaProvider, {}, getContext);

      const result = await svc.sendMessage('Hello');

      expect(result.ollamaUnavailable).toBe(true);
    });
  });
});
