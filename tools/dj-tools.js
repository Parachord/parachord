/**
 * DJ Tools Module
 *
 * Tool definitions and executors for the Conversational DJ feature.
 * These tools are used by AI providers to control Parachord playback,
 * search for music, and manage the queue.
 *
 * Each tool follows the JSON Schema format for parameters, compatible
 * with OpenAI, Anthropic, Ollama, and other LLM tool calling APIs.
 */

/**
 * @typedef {Object} ToolContext
 * @property {function(string): Promise<Array>} search - Search for tracks
 * @property {function(Object): Promise<void>} playTrack - Play a single track
 * @property {function(Array, string): Promise<void>} addToQueue - Add tracks to queue
 * @property {function(): void} clearQueue - Clear the queue
 * @property {function(): void} handlePause - Pause playback
 * @property {function(): void} handlePlay - Resume playback
 * @property {function(): void} handleNext - Skip to next track
 * @property {function(): void} handlePrevious - Go to previous track
 * @property {function(boolean): void} setShuffle - Set shuffle mode
 * @property {function(string, Array): Promise<Object>} createPlaylist - Create a playlist
 * @property {function(): Object|null} getCurrentTrack - Get current track
 * @property {function(): Array} getQueue - Get current queue
 * @property {function(): boolean} getIsPlaying - Get playback state
 */

/**
 * @typedef {Object} Tool
 * @property {string} name - Tool name
 * @property {string} description - Tool description for the LLM
 * @property {Object} [parameters] - JSON Schema for parameters
 * @property {function(Object, ToolContext): Promise<Object>} execute - Execute the tool
 */

/**
 * Play a specific track by searching and starting playback
 * @type {Tool}
 */
const playTool = {
  name: 'play',
  description: 'Play a specific track by searching for it and starting playback immediately',
  parameters: {
    type: 'object',
    properties: {
      artist: {
        type: 'string',
        description: 'The artist name'
      },
      title: {
        type: 'string',
        description: 'The track title'
      }
    },
    required: ['artist', 'title']
  },
  execute: async ({ artist, title }, context) => {
    const query = `${artist} ${title}`;
    // Use earlyReturn for faster single-track search
    const results = await context.search(query, {
      earlyReturn: true,
      targetArtist: artist,
      targetTitle: title
    });

    if (!results || results.length === 0) {
      return {
        success: false,
        error: `Could not find "${title}" by ${artist}`
      };
    }

    // Find best match (exact artist/title match preferred)
    const bestMatch = results.find(r =>
      r.artist?.toLowerCase() === artist.toLowerCase() &&
      r.title?.toLowerCase() === title.toLowerCase()
    ) || results[0];

    await context.playTrack(bestMatch);

    return {
      success: true,
      track: {
        artist: bestMatch.artist,
        title: bestMatch.title,
        album: bestMatch.album,
        source: bestMatch.source
      }
    };
  }
};

/**
 * Control playback state (pause, resume, skip, previous)
 * @type {Tool}
 */
const controlTool = {
  name: 'control',
  description: 'Control music playback - pause, resume, skip to next, go to previous track',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['pause', 'resume', 'skip', 'previous'],
        description: 'The playback action to perform'
      }
    },
    required: ['action']
  },
  execute: async ({ action }, context) => {
    switch (action) {
      case 'pause':
        context.handlePause();
        return { success: true, action: 'paused' };

      case 'resume':
        context.handlePlay();
        return { success: true, action: 'resumed' };

      case 'skip':
        context.handleNext();
        const nextTrack = context.getCurrentTrack();
        return {
          success: true,
          action: 'skipped',
          nowPlaying: nextTrack ? {
            artist: nextTrack.artist,
            title: nextTrack.title
          } : null
        };

      case 'previous':
        context.handlePrevious();
        return { success: true, action: 'previous' };

      default:
        return { success: false, error: `Unknown action: ${action}` };
    }
  }
};

/**
 * Search for tracks across all music sources
 * @type {Tool}
 */
const searchTool = {
  name: 'search',
  description: 'Search for tracks across all music sources. Returns a list of matching tracks.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search query (artist name, track title, or both)'
      },
      limit: {
        type: 'number',
        description: 'Maximum number of results to return (default 10)'
      }
    },
    required: ['query']
  },
  execute: async ({ query, limit = 10 }, context) => {
    const results = await context.search(query);

    if (!results || results.length === 0) {
      return {
        success: true,
        results: [],
        message: `No results found for "${query}"`
      };
    }

    const limitedResults = results.slice(0, limit).map(r => ({
      artist: r.artist,
      title: r.title,
      album: r.album,
      source: r.source
    }));

    return {
      success: true,
      results: limitedResults,
      total: results.length
    };
  }
};

/**
 * Add tracks to the playback queue
 * @type {Tool}
 */
const queueAddTool = {
  name: 'queue_add',
  description: 'Add one or more tracks to the playback queue',
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
          },
          required: ['artist', 'title']
        },
        description: 'Tracks to add to the queue'
      },
      position: {
        type: 'string',
        enum: ['next', 'last'],
        description: 'Add after current track (next) or at end of queue (last). Default: last'
      }
    },
    required: ['tracks']
  },
  execute: async ({ tracks, position = 'last' }, context) => {
    const nothingPlaying = !context.getCurrentTrack?.();
    let startedPlaying = false;
    let tracksToQueue = tracks;

    // If nothing is playing, resolve and play the first track immediately
    if (nothingPlaying && tracks.length > 0) {
      const firstTrack = tracks[0];
      const results = await context.search(`${firstTrack.artist} ${firstTrack.title}`, {
        earlyReturn: true,
        targetArtist: firstTrack.artist,
        targetTitle: firstTrack.title
      });
      if (results && results.length > 0) {
        const match = results.find(r =>
          r.artist?.toLowerCase() === firstTrack.artist.toLowerCase() &&
          r.title?.toLowerCase() === firstTrack.title.toLowerCase()
        ) || results[0];
        await context.playTrack(match);
        startedPlaying = true;
      }
      tracksToQueue = tracks.slice(1);
    }

    // Add remaining tracks to queue as unresolved metadata
    // The queue's ResolutionScheduler will resolve them in priority order
    if (tracksToQueue.length > 0) {
      const metadataTracks = tracksToQueue.map(t => ({
        artist: t.artist,
        title: t.title,
        album: t.album || null
      }));
      await context.addToQueue(metadataTracks, position);
    }

    const totalAdded = tracksToQueue.length + (startedPlaying ? 1 : 0);
    return {
      success: totalAdded > 0,
      added: totalAdded,
      nowPlaying: startedPlaying
    };
  }
};

/**
 * Clear the playback queue
 * @type {Tool}
 */
const queueClearTool = {
  name: 'queue_clear',
  description: 'Clear all tracks from the playback queue',
  parameters: {
    type: 'object',
    properties: {},
    required: []
  },
  execute: async (_, context) => {
    context.clearQueue();
    return { success: true };
  }
};

/**
 * Create a new playlist with specified tracks
 * @type {Tool}
 */
const createPlaylistTool = {
  name: 'create_playlist',
  description: 'Create a new playlist with the specified tracks',
  parameters: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Name for the new playlist'
      },
      tracks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            artist: { type: 'string' },
            title: { type: 'string' }
          },
          required: ['artist', 'title']
        },
        description: 'Tracks to include in the playlist'
      }
    },
    required: ['name', 'tracks']
  },
  execute: async ({ name, tracks }, context) => {
    if (!tracks || tracks.length === 0) {
      return {
        success: false,
        error: 'No tracks specified for playlist'
      };
    }

    // Create playlist with track metadata - no need to resolve
    // Tracks will be resolved when played from the playlist
    const metadataTracks = tracks.map(t => ({
      artist: t.artist,
      title: t.title,
      album: t.album || null
    }));

    const playlist = await context.createPlaylist(name, metadataTracks);

    return {
      success: true,
      playlist: {
        id: playlist.id,
        name: playlist.title || name,
        trackCount: metadataTracks.length
      }
    };
  }
};

/**
 * Toggle shuffle mode
 * @type {Tool}
 */
const shuffleTool = {
  name: 'shuffle',
  description: 'Turn shuffle mode on or off',
  parameters: {
    type: 'object',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'true to enable shuffle, false to disable'
      }
    },
    required: ['enabled']
  },
  execute: async ({ enabled }, context) => {
    context.setShuffle(enabled);
    return {
      success: true,
      shuffle: enabled
    };
  }
};

/**
 * All DJ tools as an array
 * @type {Tool[]}
 */
const djTools = [
  playTool,
  controlTool,
  searchTool,
  queueAddTool,
  queueClearTool,
  createPlaylistTool,
  shuffleTool
];

/**
 * Tool lookup map for quick access by name
 * @type {Map<string, Tool>}
 */
const toolMap = new Map(djTools.map(tool => [tool.name, tool]));

/**
 * Get a tool by name
 * @param {string} name - Tool name
 * @returns {Tool|undefined}
 */
function getTool(name) {
  return toolMap.get(name);
}

/**
 * Get tool definitions in the format expected by LLM APIs
 * (OpenAI, Anthropic, Ollama compatible)
 * @returns {Array<Object>}
 */
function getToolDefinitions() {
  return djTools.map(tool => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters || { type: 'object', properties: {}, required: [] }
    }
  }));
}

/**
 * Get simplified tool definitions (name, description, parameters only)
 * @returns {Array<Object>}
 */
function getSimpleToolDefinitions() {
  return djTools.map(tool => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters || { type: 'object', properties: {}, required: [] }
  }));
}

/**
 * Execute a tool by name
 * @param {string} name - Tool name
 * @param {Object} args - Tool arguments
 * @param {ToolContext} context - Tool context with app functions
 * @returns {Promise<Object>}
 */
async function executeTool(name, args, context) {
  const tool = toolMap.get(name);

  if (!tool) {
    return {
      success: false,
      error: `Unknown tool: ${name}`
    };
  }

  try {
    return await tool.execute(args, context);
  } catch (error) {
    console.error(`Tool execution error (${name}):`, error);
    return {
      success: false,
      error: error.message || 'Tool execution failed'
    };
  }
}

module.exports = {
  djTools,
  getTool,
  getToolDefinitions,
  getSimpleToolDefinitions,
  executeTool
};
