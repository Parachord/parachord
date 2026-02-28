/**
 * MCP (Model Context Protocol) Service for the standalone server.
 *
 * Implements MCP JSON-RPC endpoints with direct tool execution
 * (no IPC — tools call server services directly).
 */
const { executeTool, getSimpleToolDefinitions } = require('../../tools/dj-tools');

const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'parachord-server';
const SERVER_VERSION = '0.1.0';

class MCPService {
  constructor({ resolverService, queueService, playbackService, playlistService }) {
    this.resolver = resolverService;
    this.queue = queueService;
    this.playback = playbackService;
    this.playlists = playlistService;

    // Build tool context for direct execution
    this.toolContext = {
      search: (query) => this.resolver.search(query),
      playTrack: (track) => this.playback.play(track),
      addToQueue: (tracks) => this.queue.addTracks(Array.isArray(tracks) ? tracks : [tracks]),
      clearQueue: () => this.queue.clear(),
      handlePause: () => this.playback.pause(),
      handlePlay: () => this.playback.resume(),
      handleNext: () => this.playback.next(),
      handlePrevious: () => this.playback.previous(),
      setShuffle: (enabled) => enabled ? this.queue.shuffle() : this.queue.unshuffle(),
      createPlaylist: (name, tracks) => {
        const id = `mcp-${Date.now()}`;
        const playlist = { id, name, tracks, createdAt: Date.now(), addedAt: Date.now() };
        this.playlists.save(playlist);
        return playlist;
      },
      getCurrentTrack: () => this.playback.currentTrack,
      getQueue: () => this.queue.getState().tracks,
      getIsPlaying: () => this.playback.state === 'playing'
    };
  }

  /**
   * Handle a JSON-RPC request
   */
  async handleRequest(body) {
    const { method, params, id } = body;

    try {
      let result;

      switch (method) {
        case 'initialize':
          result = {
            protocolVersion: MCP_PROTOCOL_VERSION,
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            capabilities: { tools: {} }
          };
          break;

        case 'tools/list':
          result = { tools: getSimpleToolDefinitions() };
          break;

        case 'tools/call': {
          const { name, arguments: args } = params;
          const toolResult = await executeTool(name, args, this.toolContext);
          result = {
            content: [{ type: 'text', text: JSON.stringify(toolResult) }]
          };
          break;
        }

        case 'ping':
          result = {};
          break;

        default:
          return {
            jsonrpc: '2.0', id,
            error: { code: -32601, message: `Method not found: ${method}` }
          };
      }

      return { jsonrpc: '2.0', id, result };
    } catch (err) {
      return {
        jsonrpc: '2.0', id,
        error: { code: -32000, message: err.message }
      };
    }
  }
}

module.exports = MCPService;
