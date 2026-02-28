/**
 * Server-side AI Chat Service
 *
 * Wires the existing AIChatService with server tool context,
 * giving the AI direct access to server services instead of going through IPC.
 */
const { AIChatService, createChatService } = require('../../services/ai-chat');
const { createToolContext, createContextGetter } = require('../../services/ai-chat-integration');

class ChatService {
  constructor({ resolverService, queueService, playbackService, playlistService, wsManager }) {
    this.resolver = resolverService;
    this.queue = queueService;
    this.playback = playbackService;
    this.playlists = playlistService;
    this.ws = wsManager;
    this.chatService = null;
  }

  /**
   * Initialize with a specific AI provider config
   * Provider is resolved from resolver plugins (chatgpt, claude, gemini, ollama)
   */
  initProvider(provider) {
    const toolContext = createToolContext({
      searchResolvers: (query) => this.resolver.search(query),
      playTrack: (track) => this.playback.play(track),
      addToQueue: (tracks) => this.queue.addTracks(Array.isArray(tracks) ? tracks : [tracks]),
      clearQueue: () => this.queue.clear(),
      handlePause: () => this.playback.pause(),
      handlePlay: () => this.playback.resume(),
      handleNext: () => this.playback.next(),
      handlePrevious: () => this.playback.previous(),
      setShuffle: (enabled) => enabled ? this.queue.shuffle() : this.queue.unshuffle(),
      createPlaylist: (name, tracks) => {
        const id = `ai-${Date.now()}`;
        const playlist = { id, name, tracks, createdAt: Date.now(), addedAt: Date.now() };
        this.playlists.save(playlist);
        return playlist;
      },
      getCurrentTrack: () => this.playback.currentTrack,
      getQueue: () => this.queue.getState().tracks,
      getIsPlaying: () => this.playback.state === 'playing'
    });

    const contextGetter = createContextGetter({
      getCurrentTrack: () => this.playback.currentTrack,
      getQueue: () => this.queue.getState().tracks,
      getIsPlaying: () => this.playback.state === 'playing'
    });

    this.chatService = createChatService(provider, toolContext, contextGetter);
  }

  /**
   * Send a chat message and get a response
   */
  async chat(message) {
    if (!this.chatService) {
      throw new Error('Chat service not initialized — configure an AI provider first');
    }

    const response = await this.chatService.chat(message);
    return response;
  }

  /**
   * Get conversation history
   */
  getHistory() {
    if (!this.chatService) return [];
    return this.chatService.getHistory();
  }

  /**
   * Clear conversation history
   */
  clearHistory() {
    if (this.chatService) {
      this.chatService.clearHistory();
    }
  }
}

module.exports = ChatService;
