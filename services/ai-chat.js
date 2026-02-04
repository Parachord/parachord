/**
 * AI Chat Service
 *
 * Orchestrates conversations with AI providers for the Conversational DJ feature.
 * Manages conversation history, context injection, and tool execution.
 */

const { executeTool, getSimpleToolDefinitions } = require('../tools/dj-tools');

/**
 * Maximum number of messages to keep in conversation history
 * to prevent context overflow
 */
const MAX_HISTORY_LENGTH = 50;

/**
 * Maximum number of tool call iterations to prevent infinite loops
 */
const MAX_TOOL_ITERATIONS = 5;

/**
 * System prompt template for the DJ assistant
 */
const SYSTEM_PROMPT_TEMPLATE = `You are a helpful music DJ assistant for Parachord, a multi-source music player.
You can control playback, search for music, manage the queue, and answer questions about the user's music.

TODAY'S DATE: {{currentDate}}

CURRENT STATE:
{{currentState}}

GUIDELINES:
- Be concise and helpful
- When taking actions, confirm what you did
- If you need to play or queue music, use the search tool first to find tracks, then use play or queue_add
- For playback control (pause, skip, etc.), use the control tool
- If a track isn't found, suggest alternatives or ask for clarification
- Keep responses brief - this is a music app, not a chat app
- When users ask about "recent" or "last X years", use today's date to calculate the correct time range`;

/**
 * @typedef {Object} Message
 * @property {'user'|'assistant'|'system'|'tool'} role
 * @property {string} content
 * @property {Array} [tool_calls] - For assistant messages with tool calls
 * @property {string} [tool_call_id] - For tool result messages
 */

/**
 * @typedef {Object} ChatProvider
 * @property {function(Array<Message>, Array, Object): Promise<{content: string, tool_calls?: Array}>} chat
 * @property {Object} config
 */

/**
 * @typedef {Object} ToolContext
 * @property {function(string): Promise<Array>} search
 * @property {function(Object): Promise<void>} playTrack
 * @property {function(Array, string): Promise<void>} addToQueue
 * @property {function(): void} clearQueue
 * @property {function(): void} handlePause
 * @property {function(): void} handlePlay
 * @property {function(): void} handleNext
 * @property {function(): void} handlePrevious
 * @property {function(boolean): void} setShuffle
 * @property {function(string, Array): Promise<Object>} createPlaylist
 * @property {function(): Object|null} getCurrentTrack
 * @property {function(): Array} getQueue
 * @property {function(): boolean} getIsPlaying
 */

/**
 * AI Chat Service class
 */
class AIChatService {
  /**
   * @param {ChatProvider} provider - AI provider with chat function
   * @param {ToolContext} toolContext - Context with app functions for tool execution
   * @param {function(): Object} getContext - Function to get current app state
   */
  constructor(provider, toolContext, getContext) {
    this.provider = provider;
    this.toolContext = toolContext;
    this.getContext = getContext;
    this.messages = [];
    this.tools = getSimpleToolDefinitions();
  }

  /**
   * Send a message and get a response
   * @param {string} userMessage - The user's message
   * @returns {Promise<{content: string, toolResults?: Array}>}
   */
  async sendMessage(userMessage) {
    // Add user message to history
    this.messages.push({ role: 'user', content: userMessage });

    // Trim history if too long
    this.trimHistory();

    // Build messages array with system prompt
    const context = await this.getContext();
    const systemPrompt = this.buildSystemPrompt(context);
    const messagesWithSystem = [
      { role: 'system', content: systemPrompt },
      ...this.messages
    ];

    // Call AI provider
    let response;
    try {
      response = await this.provider.chat(
        messagesWithSystem,
        this.tools,
        this.provider.config
      );
    } catch (error) {
      console.error('AI provider error:', error);
      const errorMessage = this.formatProviderError(error);
      this.messages.push({ role: 'assistant', content: errorMessage });
      return { content: errorMessage, error: true };
    }

    // Handle tool calls if any
    if (response.tool_calls && response.tool_calls.length > 0) {
      return await this.handleToolCalls(response, systemPrompt);
    }

    // No tool calls, just return response
    this.messages.push({ role: 'assistant', content: response.content });
    return { content: response.content };
  }

  /**
   * Handle tool calls from the AI response
   * @param {Object} response - AI response with tool_calls
   * @param {string} systemPrompt - System prompt for follow-up
   * @returns {Promise<{content: string, toolResults: Array}>}
   */
  async handleToolCalls(response, systemPrompt) {
    let toolResults = [];
    let iterations = 0;
    let currentResponse = response;

    // Iterate until no more tool calls or max iterations reached
    while (currentResponse.tool_calls && currentResponse.tool_calls.length > 0 && iterations < MAX_TOOL_ITERATIONS) {
      iterations++;

      // Add assistant message with tool calls
      this.messages.push({
        role: 'assistant',
        content: currentResponse.content || '',
        tool_calls: currentResponse.tool_calls
      });

      // Execute each tool call
      const results = [];
      for (const call of currentResponse.tool_calls) {
        const result = await executeTool(call.name, call.arguments, this.toolContext);
        results.push({
          tool: call.name,
          arguments: call.arguments,
          result
        });

        // Add tool result message
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id || call.name,
          content: JSON.stringify(result)
        });
      }

      toolResults = toolResults.concat(results);

      // Get follow-up response
      const messagesWithSystem = [
        { role: 'system', content: systemPrompt },
        ...this.messages
      ];

      try {
        currentResponse = await this.provider.chat(
          messagesWithSystem,
          this.tools,
          this.provider.config
        );
      } catch (error) {
        console.error('AI provider error during tool follow-up:', error);
        const errorMessage = 'I encountered an error while processing. Please try again.';
        this.messages.push({ role: 'assistant', content: errorMessage });
        return { content: errorMessage, toolResults, error: true };
      }
    }

    // Add final response
    const finalContent = currentResponse.content || this.summarizeToolResults(toolResults);
    this.messages.push({ role: 'assistant', content: finalContent });

    return { content: finalContent, toolResults };
  }

  /**
   * Build the system prompt with current context
   * @param {Object} context - Current app state
   * @returns {string}
   */
  buildSystemPrompt(context) {
    const stateString = this.formatContext(context);
    const currentDate = new Date().toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
    return SYSTEM_PROMPT_TEMPLATE
      .replace('{{currentDate}}', currentDate)
      .replace('{{currentState}}', stateString);
  }

  /**
   * Format context object into a readable string
   * @param {Object} context - Current app state
   * @returns {string}
   */
  formatContext(context) {
    const lines = [];

    // Now playing
    if (context.nowPlaying) {
      lines.push(`Now Playing: "${context.nowPlaying.title}" by ${context.nowPlaying.artist}`);
      if (context.nowPlaying.album) {
        lines.push(`  Album: ${context.nowPlaying.album}`);
      }
      if (context.nowPlaying.source) {
        lines.push(`  Source: ${context.nowPlaying.source}`);
      }
      lines.push(`  State: ${context.playbackState || 'unknown'}`);
    } else {
      lines.push('Nothing is currently playing.');
    }

    // Queue
    if (context.queue && context.queue.length > 0) {
      lines.push('');
      lines.push(`Queue (${context.queue.length} tracks):`);
      const displayQueue = context.queue.slice(0, 10); // Show first 10
      displayQueue.forEach((track, i) => {
        lines.push(`  ${i + 1}. "${track.title}" by ${track.artist}`);
      });
      if (context.queue.length > 10) {
        lines.push(`  ... and ${context.queue.length - 10} more`);
      }
    } else {
      lines.push('');
      lines.push('Queue is empty.');
    }

    // Listening history summary
    if (context.history) {
      lines.push('');
      lines.push('Recent Listening:');
      if (context.history.topArtists && context.history.topArtists.length > 0) {
        const artists = context.history.topArtists.slice(0, 5)
          .map(a => `${a.name} (${a.plays} plays)`)
          .join(', ');
        lines.push(`  Top Artists: ${artists}`);
      }
      if (context.history.totalPlays) {
        lines.push(`  Total Plays: ${context.history.totalPlays}`);
      }
    }

    // Shuffle state
    if (context.shuffle !== undefined) {
      lines.push('');
      lines.push(`Shuffle: ${context.shuffle ? 'On' : 'Off'}`);
    }

    return lines.join('\n');
  }

  /**
   * Summarize tool results into a user-friendly message
   * @param {Array} toolResults - Array of tool execution results
   * @returns {string}
   */
  summarizeToolResults(toolResults) {
    if (!toolResults || toolResults.length === 0) {
      return 'Done.';
    }

    const summaries = toolResults.map(({ tool, result }) => {
      if (!result.success) {
        return `Failed to ${tool}: ${result.error}`;
      }

      switch (tool) {
        case 'play':
          return result.track
            ? `Now playing "${result.track.title}" by ${result.track.artist}`
            : 'Started playback';
        case 'control':
          return result.action === 'skipped' && result.nowPlaying
            ? `Skipped. Now playing "${result.nowPlaying.title}" by ${result.nowPlaying.artist}`
            : `Playback ${result.action}`;
        case 'search':
          return `Found ${result.results?.length || 0} results`;
        case 'queue_add':
          return `Added ${result.added} track${result.added !== 1 ? 's' : ''} to queue`;
        case 'queue_clear':
          return 'Queue cleared';
        case 'create_playlist':
          return `Created playlist "${result.playlist?.name}"`;
        case 'shuffle':
          return `Shuffle ${result.shuffle ? 'enabled' : 'disabled'}`;
        default:
          return `${tool} completed`;
      }
    });

    return summaries.join('. ') + '.';
  }

  /**
   * Format provider errors into user-friendly messages
   * @param {Error} error - The error object
   * @returns {string}
   */
  formatProviderError(error) {
    const message = error.message || '';

    if (message.includes('ECONNREFUSED') || message.includes('fetch failed')) {
      if (this.provider.config?.endpoint?.includes('localhost:11434')) {
        return "I can't connect to Ollama. Make sure it's running with `ollama serve`.";
      }
      return "I couldn't connect to the AI service. Please check your internet connection.";
    }

    if (message.includes('401') || message.includes('Unauthorized')) {
      return 'Invalid API key. Please check your settings.';
    }

    if (message.includes('429') || message.includes('rate limit')) {
      return 'Rate limit reached. Please try again in a moment.';
    }

    if (message.includes('404') || message.includes('not found')) {
      return "The AI model wasn't found. Please check your settings.";
    }

    return `Sorry, I encountered an error: ${message}`;
  }

  /**
   * Trim conversation history to prevent context overflow
   */
  trimHistory() {
    if (this.messages.length > MAX_HISTORY_LENGTH) {
      // Keep first message (might be important) and last N messages
      const toKeep = MAX_HISTORY_LENGTH - 1;
      this.messages = [
        this.messages[0],
        ...this.messages.slice(-toKeep)
      ];
    }
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    this.messages = [];
  }

  /**
   * Get current conversation history
   * @returns {Array<Message>}
   */
  getHistory() {
    return [...this.messages];
  }

  /**
   * Set a new provider
   * @param {ChatProvider} provider - New AI provider
   */
  setProvider(provider) {
    this.provider = provider;
    // Optionally clear history when switching providers
    // this.clearHistory();
  }

  /**
   * Update the tool context
   * @param {ToolContext} toolContext - New tool context
   */
  setToolContext(toolContext) {
    this.toolContext = toolContext;
  }
}

/**
 * Create a new AIChatService instance
 * @param {ChatProvider} provider - AI provider
 * @param {ToolContext} toolContext - Tool context
 * @param {function(): Object} getContext - Context getter
 * @returns {AIChatService}
 */
function createChatService(provider, toolContext, getContext) {
  return new AIChatService(provider, toolContext, getContext);
}

module.exports = {
  AIChatService,
  createChatService,
  SYSTEM_PROMPT_TEMPLATE,
  MAX_HISTORY_LENGTH,
  MAX_TOOL_ITERATIONS
};
