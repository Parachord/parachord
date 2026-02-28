jest.mock('../../tools/dj-tools', () => ({
  executeTool: jest.fn(),
  getSimpleToolDefinitions: jest.fn(() => [
    { name: 'play', description: 'Play a track', inputSchema: { type: 'object', properties: {} } },
    { name: 'search', description: 'Search for music', inputSchema: { type: 'object', properties: {} } }
  ])
}));

const MCPService = require('../services/mcp-service');
const { executeTool, getSimpleToolDefinitions } = require('../../tools/dj-tools');

function createMockServices() {
  return {
    resolverService: { search: jest.fn() },
    queueService: {
      addTracks: jest.fn(),
      clear: jest.fn(),
      shuffle: jest.fn(),
      unshuffle: jest.fn(),
      getState: jest.fn(() => ({ tracks: [] }))
    },
    playbackService: {
      play: jest.fn(),
      pause: jest.fn(),
      resume: jest.fn(),
      next: jest.fn(),
      previous: jest.fn(),
      currentTrack: null,
      state: 'idle'
    },
    playlistService: {
      save: jest.fn()
    }
  };
}

describe('MCPService', () => {
  let services, mcp;

  beforeEach(() => {
    services = createMockServices();
    mcp = new MCPService(services);
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    test('returns protocol version and server info', async () => {
      const result = await mcp.handleRequest({
        method: 'initialize', id: 1, params: {}
      });
      expect(result).toEqual({
        jsonrpc: '2.0',
        id: 1,
        result: {
          protocolVersion: '2025-03-26',
          serverInfo: { name: 'parachord-server', version: '0.1.0' },
          capabilities: { tools: {} }
        }
      });
    });
  });

  describe('tools/list', () => {
    test('returns tool definitions', async () => {
      const result = await mcp.handleRequest({
        method: 'tools/list', id: 2, params: {}
      });
      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe(2);
      expect(result.result.tools).toHaveLength(2);
      expect(getSimpleToolDefinitions).toHaveBeenCalled();
    });
  });

  describe('tools/call', () => {
    test('executes tool and returns result', async () => {
      executeTool.mockResolvedValue({ tracks: [{ title: 'Song' }] });

      const result = await mcp.handleRequest({
        method: 'tools/call',
        id: 3,
        params: { name: 'search', arguments: { query: 'test' } }
      });

      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe(3);
      expect(result.result.content).toHaveLength(1);
      expect(result.result.content[0].type).toBe('text');
      expect(JSON.parse(result.result.content[0].text)).toEqual({ tracks: [{ title: 'Song' }] });
      expect(executeTool).toHaveBeenCalledWith('search', { query: 'test' }, mcp.toolContext);
    });

    test('returns error on tool execution failure', async () => {
      executeTool.mockRejectedValue(new Error('Tool failed'));

      const result = await mcp.handleRequest({
        method: 'tools/call',
        id: 4,
        params: { name: 'play', arguments: {} }
      });

      expect(result.jsonrpc).toBe('2.0');
      expect(result.id).toBe(4);
      expect(result.error).toEqual({ code: -32000, message: 'Tool failed' });
    });
  });

  describe('ping', () => {
    test('returns empty result', async () => {
      const result = await mcp.handleRequest({
        method: 'ping', id: 5, params: {}
      });
      expect(result).toEqual({ jsonrpc: '2.0', id: 5, result: {} });
    });
  });

  describe('unknown method', () => {
    test('returns method not found error', async () => {
      const result = await mcp.handleRequest({
        method: 'unknown/method', id: 6, params: {}
      });
      expect(result.error.code).toBe(-32601);
      expect(result.error.message).toContain('unknown/method');
    });
  });

  describe('tool context', () => {
    test('search delegates to resolverService', async () => {
      services.resolverService.search.mockResolvedValue([{ title: 'Result' }]);
      const result = await mcp.toolContext.search('test query');
      expect(services.resolverService.search).toHaveBeenCalledWith('test query');
      expect(result).toEqual([{ title: 'Result' }]);
    });

    test('playTrack delegates to playbackService', async () => {
      const track = { title: 'Song', artist: 'Artist' };
      await mcp.toolContext.playTrack(track);
      expect(services.playbackService.play).toHaveBeenCalledWith(track);
    });

    test('addToQueue wraps single track in array', async () => {
      const track = { title: 'Song' };
      await mcp.toolContext.addToQueue(track);
      expect(services.queueService.addTracks).toHaveBeenCalledWith([track]);
    });

    test('addToQueue passes array directly', async () => {
      const tracks = [{ title: 'Song1' }, { title: 'Song2' }];
      await mcp.toolContext.addToQueue(tracks);
      expect(services.queueService.addTracks).toHaveBeenCalledWith(tracks);
    });

    test('createPlaylist creates and saves playlist', () => {
      const tracks = [{ title: 'S1' }];
      const result = mcp.toolContext.createPlaylist('My List', tracks);
      expect(result.name).toBe('My List');
      expect(result.tracks).toBe(tracks);
      expect(result.id).toMatch(/^mcp-/);
      expect(services.playlistService.save).toHaveBeenCalledWith(result);
    });

    test('getCurrentTrack returns playback current track', () => {
      services.playbackService.currentTrack = { title: 'Now Playing' };
      expect(mcp.toolContext.getCurrentTrack()).toEqual({ title: 'Now Playing' });
    });

    test('getIsPlaying returns true when playing', () => {
      services.playbackService.state = 'playing';
      expect(mcp.toolContext.getIsPlaying()).toBe(true);
    });

    test('getIsPlaying returns false when not playing', () => {
      services.playbackService.state = 'paused';
      expect(mcp.toolContext.getIsPlaying()).toBe(false);
    });
  });
});
