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
 * @property {function(): Array} getPlaylists - Get all playlists
 * @property {function(string): Object|null} findPlaylist - Find playlist by name
 * @property {function(string, Array): void} addTracksToPlaylist - Add tracks to playlist
 * @property {function(string, number): void} removeTrackFromPlaylist - Remove track by index
 * @property {function(string, number, number): void} moveTrackInPlaylist - Reorder track
 * @property {function(string, string): void} renamePlaylist - Rename playlist
 * @property {function(string): Promise} deletePlaylist - Delete playlist
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
  description: 'Play a specific track by searching for it and starting playback immediately. Clears the queue before playing.',
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

    // Clear the queue before playing (user expects fresh start when they say "play")
    context.clearQueue();
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
  description: 'Add one or more tracks to the playback queue. By default (playFirst=true), clears the queue, plays the first track immediately, and queues the rest. Set playFirst to false to add tracks to the existing queue without clearing it or starting playback.',
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
      },
      playFirst: {
        type: 'boolean',
        description: 'If true (default), clears the queue, plays the first track immediately, and queues the rest. If false, adds tracks to existing queue without clearing or starting playback.'
      }
    },
    required: ['tracks']
  },
  execute: async ({ tracks, position = 'last', playFirst = true }, context) => {
    let startedPlaying = false;
    let playedTrack = null;

    // If playFirst is true, clear the existing queue first (user expects fresh start)
    if (playFirst) {
      context.clearQueue();
    }

    // If playFirst is true and we have tracks, play the first track immediately
    if (playFirst && tracks.length > 0) {
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
        playedTrack = firstTrack;
      }
    }

    // Add remaining tracks to queue as unresolved metadata
    // Filter out the track we just played to prevent duplicates
    // The queue's ResolutionScheduler will resolve them in priority order
    const tracksToQueue = playedTrack
      ? tracks.filter(t => !(t.artist === playedTrack.artist && t.title === playedTrack.title))
      : tracks;

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
 * Block an artist, album, or track from future recommendations
 * @type {Tool}
 */
const blockRecommendationTool = {
  name: 'block_recommendation',
  description: 'Block an artist, album, or track from future AI recommendations. Use when user says "don\'t recommend X", "I don\'t like X", "stop suggesting X", etc.',
  parameters: {
    type: 'object',
    properties: {
      type: {
        type: 'string',
        enum: ['artist', 'album', 'track'],
        description: 'What to block: artist (blocks all their music), album, or track'
      },
      name: {
        type: 'string',
        description: 'For artists: the artist name. Not used for albums/tracks.'
      },
      title: {
        type: 'string',
        description: 'For albums/tracks: the album or track title'
      },
      artist: {
        type: 'string',
        description: 'For albums/tracks: the artist name'
      }
    },
    required: ['type']
  },
  execute: async ({ type, name, title, artist }, context) => {
    if (type === 'artist') {
      if (!name) {
        return { success: false, error: 'Artist name is required' };
      }
      context.blockRecommendation('artist', { name });
      return {
        success: true,
        blocked: { type: 'artist', name },
        message: `I won't recommend ${name} again.`
      };
    } else if (type === 'album') {
      if (!title || !artist) {
        return { success: false, error: 'Album title and artist are required' };
      }
      context.blockRecommendation('album', { title, artist });
      return {
        success: true,
        blocked: { type: 'album', title, artist },
        message: `I won't recommend the album "${title}" by ${artist} again.`
      };
    } else if (type === 'track') {
      if (!title || !artist) {
        return { success: false, error: 'Track title and artist are required' };
      }
      context.blockRecommendation('track', { title, artist });
      return {
        success: true,
        blocked: { type: 'track', title, artist },
        message: `I won't recommend "${title}" by ${artist} again.`
      };
    }
    return { success: false, error: 'Invalid type. Use artist, album, or track.' };
  }
};

/**
 * Get all playlists with names, IDs, and track counts
 * @type {Tool}
 */
const getPlaylistsTool = {
  name: 'get_playlists',
  description: "Get all of the user's playlists with names, IDs, and track counts. Use when the user asks about their playlists, wants to browse them, or before modifying a playlist.",
  parameters: { type: 'object', properties: {}, required: [] },
  execute: async (_, context) => {
    const playlists = context.getPlaylists();
    return {
      success: true,
      playlists: playlists.map(p => ({
        id: p.id,
        name: p.name,
        trackCount: p.trackCount,
        sampleTracks: p.tracks.slice(0, 5).map(t => ({ artist: t.artist, title: t.title }))
      })),
      total: playlists.length
    };
  }
};

/**
 * Get full track listing for a specific playlist
 * @type {Tool}
 */
const getPlaylistTracksTool = {
  name: 'get_playlist_tracks',
  description: 'Get the full track listing for a specific playlist by name. Returns all tracks with their index positions. Use this before reordering or removing tracks.',
  parameters: {
    type: 'object',
    properties: {
      playlist_name: { type: 'string', description: 'The playlist name to look up (case-insensitive partial match)' }
    },
    required: ['playlist_name']
  },
  execute: async ({ playlist_name }, context) => {
    const playlist = context.findPlaylist(playlist_name);
    if (!playlist) {
      return { success: false, error: `Could not find a playlist matching "${playlist_name}"` };
    }
    return {
      success: true,
      playlist: {
        id: playlist.id,
        name: playlist.title || playlist.name,
        trackCount: (playlist.tracks || []).length,
        tracks: (playlist.tracks || []).map((t, i) => ({
          index: i, artist: t.artist, title: t.title, album: t.album
        }))
      }
    };
  }
};

/**
 * Add tracks to an existing playlist
 * @type {Tool}
 */
const addToPlaylistTool = {
  name: 'add_to_playlist',
  description: 'Add one or more tracks to an existing playlist.',
  parameters: {
    type: 'object',
    properties: {
      playlist_name: { type: 'string', description: 'Name of the playlist to add tracks to (case-insensitive partial match)' },
      tracks: {
        type: 'array',
        items: {
          type: 'object',
          properties: { artist: { type: 'string' }, title: { type: 'string' } },
          required: ['artist', 'title']
        },
        description: 'Tracks to add to the playlist'
      }
    },
    required: ['playlist_name', 'tracks']
  },
  execute: async ({ playlist_name, tracks }, context) => {
    const playlist = context.findPlaylist(playlist_name);
    if (!playlist) {
      return { success: false, error: `Could not find a playlist matching "${playlist_name}"` };
    }
    if (!tracks || tracks.length === 0) {
      return { success: false, error: 'No tracks specified' };
    }
    const tracksToAdd = tracks.map(t => ({
      artist: t.artist, title: t.title, album: t.album || null,
      id: `${t.artist}-${t.title}`.toLowerCase().replace(/[^a-z0-9-]/g, '')
    }));
    context.addTracksToPlaylist(playlist.id, tracksToAdd);
    return {
      success: true,
      playlist: { name: playlist.title || playlist.name },
      added: tracksToAdd.length,
      newTrackCount: (playlist.tracks || []).length + tracksToAdd.length
    };
  }
};

/**
 * Remove a track from a playlist
 * @type {Tool}
 */
const removeFromPlaylistTool = {
  name: 'remove_from_playlist',
  description: 'Remove a track from a playlist. Specify either the track index (0-based) or artist/title to match.',
  parameters: {
    type: 'object',
    properties: {
      playlist_name: { type: 'string', description: 'Name of the playlist (case-insensitive partial match)' },
      track_index: { type: 'number', description: 'Index of the track to remove (0-based)' },
      artist: { type: 'string', description: 'Artist name to match for removal' },
      title: { type: 'string', description: 'Track title to match for removal' }
    },
    required: ['playlist_name']
  },
  execute: async ({ playlist_name, track_index, artist, title }, context) => {
    const playlist = context.findPlaylist(playlist_name);
    if (!playlist) {
      return { success: false, error: `Could not find a playlist matching "${playlist_name}"` };
    }
    const tracks = playlist.tracks || [];
    let idx = -1;
    if (track_index !== undefined && track_index !== null) {
      idx = track_index;
    } else if (artist || title) {
      const fa = artist?.toLowerCase();
      const ft = title?.toLowerCase();
      idx = tracks.findIndex(t => {
        const ma = fa && t.artist?.toLowerCase().includes(fa);
        const mt = ft && t.title?.toLowerCase().includes(ft);
        if (fa && ft) return ma && mt;
        return ma || mt;
      });
    }
    if (idx < 0 || idx >= tracks.length) {
      return { success: false, error: 'Track not found in playlist' };
    }
    const removed = tracks[idx];
    context.removeTrackFromPlaylist(playlist.id, idx);
    return {
      success: true,
      removed: { artist: removed.artist, title: removed.title },
      playlist: { name: playlist.title || playlist.name },
      newTrackCount: tracks.length - 1
    };
  }
};

/**
 * Reorder tracks within a playlist
 * @type {Tool}
 */
const reorderPlaylistTool = {
  name: 'reorder_playlist',
  description: 'Move a track from one position to another within a playlist. Use get_playlist_tracks first to see current positions.',
  parameters: {
    type: 'object',
    properties: {
      playlist_name: { type: 'string', description: 'Name of the playlist (case-insensitive partial match)' },
      from_index: { type: 'number', description: 'Current position of the track (0-based)' },
      to_index: { type: 'number', description: 'New position for the track (0-based)' }
    },
    required: ['playlist_name', 'from_index', 'to_index']
  },
  execute: async ({ playlist_name, from_index, to_index }, context) => {
    const playlist = context.findPlaylist(playlist_name);
    if (!playlist) {
      return { success: false, error: `Could not find a playlist matching "${playlist_name}"` };
    }
    const tracks = playlist.tracks || [];
    if (from_index < 0 || from_index >= tracks.length || to_index < 0 || to_index >= tracks.length) {
      return { success: false, error: `Invalid index. Playlist has ${tracks.length} tracks (indices 0-${tracks.length - 1}).` };
    }
    context.moveTrackInPlaylist(playlist.id, from_index, to_index);
    const movedTrack = tracks[from_index];
    return {
      success: true,
      moved: { artist: movedTrack.artist, title: movedTrack.title },
      from: from_index, to: to_index,
      playlist: { name: playlist.title || playlist.name }
    };
  }
};

/**
 * Rename a playlist
 * @type {Tool}
 */
const renamePlaylistTool = {
  name: 'rename_playlist',
  description: 'Rename an existing playlist.',
  parameters: {
    type: 'object',
    properties: {
      playlist_name: { type: 'string', description: 'Current name of the playlist (case-insensitive partial match)' },
      new_name: { type: 'string', description: 'New name for the playlist' }
    },
    required: ['playlist_name', 'new_name']
  },
  execute: async ({ playlist_name, new_name }, context) => {
    const playlist = context.findPlaylist(playlist_name);
    if (!playlist) {
      return { success: false, error: `Could not find a playlist matching "${playlist_name}"` };
    }
    context.renamePlaylist(playlist.id, new_name);
    return { success: true, oldName: playlist.title || playlist.name, newName: new_name };
  }
};

/**
 * Delete a playlist
 * @type {Tool}
 */
const deletePlaylistTool = {
  name: 'delete_playlist',
  description: 'Delete a playlist permanently. Always confirm with the user before calling this tool.',
  parameters: {
    type: 'object',
    properties: {
      playlist_name: { type: 'string', description: 'Name of the playlist to delete (case-insensitive partial match)' }
    },
    required: ['playlist_name']
  },
  execute: async ({ playlist_name }, context) => {
    const playlist = context.findPlaylist(playlist_name);
    if (!playlist) {
      return { success: false, error: `Could not find a playlist matching "${playlist_name}"` };
    }
    await context.deletePlaylist(playlist.id);
    return { success: true, deleted: { name: playlist.title || playlist.name } };
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
  shuffleTool,
  blockRecommendationTool,
  getPlaylistsTool,
  getPlaylistTracksTool,
  addToPlaylistTool,
  removeFromPlaylistTool,
  reorderPlaylistTool,
  renamePlaylistTool,
  deletePlaylistTool
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
