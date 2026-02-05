/**
 * AI Chat Integration
 *
 * Bridges the AI Chat Service with Parachord's app state and functions.
 * Creates the tool context needed for DJ tools to control the app.
 */

const { AIChatService, createChatService } = require('./ai-chat');

/**
 * Create the tool context from app state and handlers
 *
 * @param {Object} params - App references
 * @param {Function} params.searchResolvers - Function to search across resolvers
 * @param {Function} params.playTrack - Function to play a track
 * @param {Function} params.addToQueue - Function to add tracks to queue
 * @param {Function} params.clearQueue - Function to clear the queue
 * @param {Function} params.handlePause - Function to pause playback
 * @param {Function} params.handlePlay - Function to resume playback
 * @param {Function} params.handleNext - Function to skip to next track
 * @param {Function} params.handlePrevious - Function to go to previous track
 * @param {Function} params.setShuffle - Function to set shuffle mode
 * @param {Function} params.createPlaylist - Function to create a playlist
 * @param {Function} params.getCurrentTrack - Function to get current track
 * @param {Function} params.getQueue - Function to get current queue
 * @param {Function} params.getIsPlaying - Function to get playback state
 * @returns {Object} Tool context for DJ tools
 */
function createToolContext({
  searchResolvers,
  playTrack,
  addToQueue,
  clearQueue,
  handlePause,
  handlePlay,
  handleNext,
  handlePrevious,
  setShuffle,
  createPlaylist,
  getCurrentTrack,
  getQueue,
  getIsPlaying
}) {
  return {
    // Search for tracks across active resolvers
    search: async (query) => {
      const results = await searchResolvers(query);
      return results || [];
    },

    // Play a single track
    playTrack: async (track) => {
      await playTrack(track);
    },

    // Add tracks to the queue
    // position: 'next' = after current, 'last' = end of queue
    addToQueue: async (tracks, position = 'last') => {
      // The app's addToQueue function handles array or single track
      addToQueue(tracks, { type: 'aiPlaylist', name: 'AI DJ' });
    },

    // Clear the playback queue
    clearQueue: () => {
      clearQueue();
    },

    // Pause playback
    handlePause: () => {
      handlePause();
    },

    // Resume playback
    handlePlay: () => {
      handlePlay();
    },

    // Skip to next track
    handleNext: () => {
      handleNext();
    },

    // Go to previous track
    handlePrevious: () => {
      handlePrevious();
    },

    // Set shuffle mode
    setShuffle: (enabled) => {
      setShuffle(enabled);
    },

    // Create a new playlist
    createPlaylist: async (name, tracks) => {
      const playlist = await createPlaylist(name, tracks);
      return playlist;
    },

    // Get current track
    getCurrentTrack: () => {
      return getCurrentTrack();
    },

    // Get current queue
    getQueue: () => {
      return getQueue();
    },

    // Get playback state
    getIsPlaying: () => {
      return getIsPlaying();
    }
  };
}

/**
 * Create the context getter function for the AI chat service
 *
 * @param {Object} params - State getters
 * @param {Function} params.getCurrentTrack - Get current track
 * @param {Function} params.getQueue - Get queue
 * @param {Function} params.getIsPlaying - Get playing state
 * @param {Function} params.getShuffleMode - Get shuffle mode
 * @param {Function} params.getListeningHistory - Get listening history/stats
 * @returns {Function} Context getter
 */
function createContextGetter({
  getCurrentTrack,
  getQueue,
  getIsPlaying,
  getShuffleMode,
  getListeningHistory
}) {
  return async () => {
    const nowPlaying = getCurrentTrack();
    const queue = getQueue();
    const isPlaying = getIsPlaying();
    const shuffle = getShuffleMode();

    // Build context object
    const context = {
      nowPlaying: nowPlaying ? {
        title: nowPlaying.title,
        artist: nowPlaying.artist,
        album: nowPlaying.album,
        source: nowPlaying.source || nowPlaying.resolverId
      } : null,
      playbackState: isPlaying ? 'playing' : 'paused',
      queue: queue.slice(0, 20).map(t => ({
        title: t.title,
        artist: t.artist,
        album: t.album
      })),
      shuffle: shuffle
    };

    // Add listening history if available
    if (getListeningHistory) {
      try {
        const history = await getListeningHistory();
        if (history) {
          context.history = history;
        }
      } catch (e) {
        // History is optional
      }
    }

    return context;
  };
}

/**
 * Create the chat provider wrapper from a loaded plugin
 *
 * @param {Object} plugin - Loaded plugin with chat capability
 * @param {Object} config - Plugin configuration
 * @returns {Object} Chat provider
 */
function createChatProvider(plugin, config) {
  if (!plugin || !plugin.chat) {
    throw new Error('Plugin does not have chat capability');
  }

  return {
    chat: plugin.chat,
    config: config,
    id: plugin.id || plugin.manifest?.id,
    name: plugin.name || plugin.manifest?.name
  };
}

/**
 * Initialize a complete AI chat service with all integrations
 *
 * @param {Object} params - All required parameters
 * @param {Object} params.plugin - The AI plugin with chat capability
 * @param {Object} params.pluginConfig - Plugin configuration (API keys, etc.)
 * @param {Object} params.appHandlers - App handlers (playTrack, handlePause, etc.)
 * @param {Object} params.stateGetters - State getter functions
 * @returns {AIChatService}
 */
function initializeChatService({ plugin, pluginConfig, appHandlers, stateGetters }) {
  // Create the provider
  const provider = createChatProvider(plugin, pluginConfig);

  // Create tool context
  const toolContext = createToolContext(appHandlers);

  // Create context getter
  const getContext = createContextGetter(stateGetters);

  // Create and return the service
  return createChatService(provider, toolContext, getContext);
}

module.exports = {
  createToolContext,
  createContextGetter,
  createChatProvider,
  initializeChatService
};
