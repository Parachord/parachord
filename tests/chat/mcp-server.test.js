/**
 * MCP Server Tests
 *
 * Tests for the MCP (Model Context Protocol) server logic.
 * Recreates the pure protocol handling functions from services/mcp-server.js
 * to test without requiring express/electron dependencies.
 */

// --- Recreate core MCP server logic for testing ---

const MCP_PORT = 9421;
const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'parachord';
const SERVER_VERSION = '0.6.0';

const pendingRequests = new Map();
let mainWindowRef = null;

function generateRequestId() {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function handleRendererResponse(requestId, data) {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    pending.resolve(data);
  }
}

function requestFromRenderer(channel, payload, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!mainWindowRef || mainWindowRef.isDestroyed?.()) {
      reject(new Error('Parachord window is not available'));
      return;
    }

    const requestId = generateRequestId();

    const timer = setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId);
        reject(new Error('Request timed out'));
      }
    }, timeout);

    pendingRequests.set(requestId, {
      resolve: (data) => {
        clearTimeout(timer);
        resolve(data);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      }
    });

    mainWindowRef.webContents.send(channel, { requestId, ...payload });
  });
}

// Simplified tool definitions matching dj-tools.js
const djToolDefs = [
  { name: 'play', description: 'Play a specific track', parameters: { type: 'object', properties: { artist: { type: 'string' }, title: { type: 'string' } }, required: ['artist', 'title'] } },
  { name: 'control', description: 'Control playback', parameters: { type: 'object', properties: { action: { type: 'string', enum: ['pause', 'resume', 'skip', 'previous'] } }, required: ['action'] } },
  { name: 'search', description: 'Search for tracks', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] } },
  { name: 'queue_add', description: 'Add tracks to queue', parameters: { type: 'object', properties: { tracks: { type: 'array' }, position: { type: 'string' } }, required: ['tracks'] } },
  { name: 'queue_clear', description: 'Clear the queue', parameters: { type: 'object', properties: {}, required: [] } },
  { name: 'create_playlist', description: 'Create a playlist', parameters: { type: 'object', properties: { name: { type: 'string' }, tracks: { type: 'array' } }, required: ['name', 'tracks'] } },
  { name: 'shuffle', description: 'Toggle shuffle', parameters: { type: 'object', properties: { enabled: { type: 'boolean' } }, required: ['enabled'] } },
  { name: 'block_recommendation', description: 'Block from recommendations', parameters: { type: 'object', properties: { type: { type: 'string' } }, required: ['type'] } }
];

function getMcpTools() {
  return djToolDefs.map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters || { type: 'object', properties: {} }
  }));
}

async function handleJsonRpcRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: { name: SERVER_NAME, version: SERVER_VERSION }
        }
      };

    case 'notifications/initialized':
      return null;

    case 'ping':
      return { jsonrpc: '2.0', id, result: {} };

    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: getMcpTools() } };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      if (!toolName) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing tool name' } };
      }

      try {
        const result = await requestFromRenderer('mcp-tool-call', { toolName, args: toolArgs });
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: JSON.stringify({ success: false, error: error.message }) }], isError: true }
        };
      }
    }

    case 'resources/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            { uri: 'parachord://now-playing', name: 'Now Playing', description: 'Currently playing track', mimeType: 'application/json' },
            { uri: 'parachord://queue', name: 'Queue', description: 'Current playback queue', mimeType: 'application/json' }
          ]
        }
      };

    case 'resources/read': {
      const uri = params?.uri;
      if (!uri) {
        return { jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing resource URI' } };
      }

      try {
        const state = await requestFromRenderer('mcp-get-state', {});
        let contents;
        if (uri === 'parachord://now-playing') {
          contents = {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ track: state.currentTrack || null, isPlaying: state.isPlaying || false }, null, 2)
          };
        } else if (uri === 'parachord://queue') {
          contents = {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({ tracks: state.queue || [], count: state.queue?.length || 0 }, null, 2)
          };
        } else {
          return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown resource: ${uri}` } };
        }
        return { jsonrpc: '2.0', id, result: { contents: [contents] } };
      } catch (error) {
        return { jsonrpc: '2.0', id, error: { code: -32603, message: error.message } };
      }
    }

    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } };
  }
}

// --- Tests ---

describe('MCP Server', () => {
  beforeEach(() => {
    pendingRequests.clear();
    mainWindowRef = null;
  });

  describe('getMcpTools', () => {
    it('should return tool definitions with inputSchema', () => {
      const tools = getMcpTools();

      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);

      tools.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('description');
        expect(tool).toHaveProperty('inputSchema');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.description).toBe('string');
      });
    });

    it('should include core DJ tools', () => {
      const tools = getMcpTools();
      const toolNames = tools.map(t => t.name);

      expect(toolNames).toContain('play');
      expect(toolNames).toContain('control');
      expect(toolNames).toContain('search');
      expect(toolNames).toContain('queue_add');
      expect(toolNames).toContain('queue_clear');
      expect(toolNames).toContain('create_playlist');
      expect(toolNames).toContain('shuffle');
    });

    it('should have proper inputSchema for play tool', () => {
      const tools = getMcpTools();
      const playTool = tools.find(t => t.name === 'play');

      expect(playTool.inputSchema.type).toBe('object');
      expect(playTool.inputSchema.properties).toHaveProperty('artist');
      expect(playTool.inputSchema.properties).toHaveProperty('title');
      expect(playTool.inputSchema.required).toContain('artist');
      expect(playTool.inputSchema.required).toContain('title');
    });

    it('should have proper inputSchema for control tool', () => {
      const tools = getMcpTools();
      const controlTool = tools.find(t => t.name === 'control');

      expect(controlTool.inputSchema.properties.action.enum).toEqual(
        expect.arrayContaining(['pause', 'resume', 'skip', 'previous'])
      );
    });
  });

  describe('handleJsonRpcRequest - initialize', () => {
    it('should return server info and capabilities', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          clientInfo: { name: 'claude-desktop', version: '1.0' }
        }
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(1);
      expect(response.result.protocolVersion).toBe('2025-03-26');
      expect(response.result.serverInfo.name).toBe('parachord');
      expect(response.result.serverInfo.version).toBe('0.6.0');
      expect(response.result.capabilities).toHaveProperty('tools');
      expect(response.result.capabilities).toHaveProperty('resources');
    });

    it('should preserve the request id', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 'abc-123',
        method: 'initialize',
        params: {}
      });

      expect(response.id).toBe('abc-123');
    });
  });

  describe('handleJsonRpcRequest - notifications/initialized', () => {
    it('should return null (no response for notifications)', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        method: 'notifications/initialized'
      });

      expect(response).toBeNull();
    });
  });

  describe('handleJsonRpcRequest - ping', () => {
    it('should return empty result', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping'
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(2);
      expect(response.result).toEqual({});
    });
  });

  describe('handleJsonRpcRequest - tools/list', () => {
    it('should return all DJ tools in MCP format', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list'
      });

      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(3);
      expect(Array.isArray(response.result.tools)).toBe(true);

      const toolNames = response.result.tools.map(t => t.name);
      expect(toolNames).toContain('play');
      expect(toolNames).toContain('search');
      expect(toolNames).toContain('control');
      expect(toolNames).toContain('queue_add');
    });

    it('should return tools with inputSchema (not parameters)', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/list'
      });

      response.result.tools.forEach(tool => {
        expect(tool).toHaveProperty('inputSchema');
        expect(tool).not.toHaveProperty('parameters');
      });
    });
  });

  describe('handleJsonRpcRequest - tools/call', () => {
    it('should return error when tool name is missing', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: {}
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Missing tool name');
    });

    it('should return error when window is not available', async () => {
      // mainWindowRef is null by default in tests
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 6,
        method: 'tools/call',
        params: { name: 'play', arguments: { artist: 'Big Thief', title: 'Vampire Empire' } }
      });

      expect(response.result.isError).toBe(true);
      expect(response.result.content[0].type).toBe('text');
      const parsed = JSON.parse(response.result.content[0].text);
      expect(parsed.success).toBe(false);
      expect(parsed.error).toContain('not available');
    });

    it('should forward tool call to renderer and return result', async () => {
      const mockSend = jest.fn();
      mainWindowRef = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      };

      // Start the tool call (will await renderer response)
      const resultPromise = handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 7,
        method: 'tools/call',
        params: { name: 'control', arguments: { action: 'pause' } }
      });

      // Wait for the IPC send to happen
      await new Promise(resolve => setTimeout(resolve, 10));

      // Verify it sent the right IPC message
      expect(mockSend).toHaveBeenCalledWith('mcp-tool-call', expect.objectContaining({
        toolName: 'control',
        args: { action: 'pause' }
      }));

      // Simulate renderer responding
      const sentData = mockSend.mock.calls[0][1];
      handleRendererResponse(sentData.requestId, { success: true, action: 'paused' });

      const response = await resultPromise;
      expect(response.jsonrpc).toBe('2.0');
      expect(response.id).toBe(7);

      const resultText = JSON.parse(response.result.content[0].text);
      expect(resultText.success).toBe(true);
      expect(resultText.action).toBe('paused');
    });
  });

  describe('handleJsonRpcRequest - resources/list', () => {
    it('should return available resources', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 8,
        method: 'resources/list'
      });

      expect(response.result.resources).toBeDefined();
      const uris = response.result.resources.map(r => r.uri);
      expect(uris).toContain('parachord://now-playing');
      expect(uris).toContain('parachord://queue');
    });

    it('should include proper resource metadata', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 9,
        method: 'resources/list'
      });

      const nowPlaying = response.result.resources.find(r => r.uri === 'parachord://now-playing');
      expect(nowPlaying.name).toBe('Now Playing');
      expect(nowPlaying.mimeType).toBe('application/json');
      expect(nowPlaying.description).toBeTruthy();
    });
  });

  describe('handleJsonRpcRequest - resources/read', () => {
    it('should return error when URI is missing', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 10,
        method: 'resources/read',
        params: {}
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Missing resource URI');
    });

    it('should return now-playing state from renderer', async () => {
      const mockSend = jest.fn();
      mainWindowRef = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      };

      const resultPromise = handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 11,
        method: 'resources/read',
        params: { uri: 'parachord://now-playing' }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSend).toHaveBeenCalledWith('mcp-get-state', expect.any(Object));

      const sentData = mockSend.mock.calls[0][1];
      handleRendererResponse(sentData.requestId, {
        currentTrack: { artist: 'Big Thief', title: 'Vampire Empire', album: 'Dragon New Warm Mountain' },
        isPlaying: true,
        currentTime: 45,
        duration: 245,
        queue: []
      });

      const response = await resultPromise;
      expect(response.result.contents).toHaveLength(1);

      const content = response.result.contents[0];
      expect(content.uri).toBe('parachord://now-playing');
      expect(content.mimeType).toBe('application/json');

      const parsed = JSON.parse(content.text);
      expect(parsed.track.artist).toBe('Big Thief');
      expect(parsed.isPlaying).toBe(true);
    });

    it('should return queue state from renderer', async () => {
      const mockSend = jest.fn();
      mainWindowRef = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      };

      const resultPromise = handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 12,
        method: 'resources/read',
        params: { uri: 'parachord://queue' }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentData = mockSend.mock.calls[0][1];
      handleRendererResponse(sentData.requestId, {
        currentTrack: null,
        isPlaying: false,
        queue: [
          { artist: 'Big Thief', title: 'Simulation Swarm' },
          { artist: 'MJ Lenderman', title: 'Rudolph' }
        ]
      });

      const response = await resultPromise;
      const parsed = JSON.parse(response.result.contents[0].text);
      expect(parsed.tracks).toHaveLength(2);
      expect(parsed.count).toBe(2);
      expect(parsed.tracks[0].artist).toBe('Big Thief');
    });

    it('should return error for unknown resource URI', async () => {
      const mockSend = jest.fn();
      mainWindowRef = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      };

      const resultPromise = handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 13,
        method: 'resources/read',
        params: { uri: 'parachord://unknown-resource' }
      });

      await new Promise(resolve => setTimeout(resolve, 10));

      const sentData = mockSend.mock.calls[0][1];
      handleRendererResponse(sentData.requestId, { currentTrack: null, queue: [] });

      const response = await resultPromise;
      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32602);
      expect(response.error.message).toContain('Unknown resource');
    });
  });

  describe('handleJsonRpcRequest - unknown method', () => {
    it('should return method not found error', async () => {
      const response = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 14,
        method: 'unknown/method'
      });

      expect(response.error).toBeDefined();
      expect(response.error.code).toBe(-32601);
      expect(response.error.message).toContain('Method not found');
      expect(response.error.message).toContain('unknown/method');
    });
  });

  describe('handleRendererResponse', () => {
    it('should resolve pending request', () => {
      const mockResolve = jest.fn();
      pendingRequests.set('test-123', {
        resolve: mockResolve,
        reject: jest.fn()
      });

      handleRendererResponse('test-123', { success: true, track: { artist: 'Big Thief' } });

      expect(mockResolve).toHaveBeenCalledWith({ success: true, track: { artist: 'Big Thief' } });
      expect(pendingRequests.has('test-123')).toBe(false);
    });

    it('should ignore unknown request IDs', () => {
      handleRendererResponse('nonexistent-id', { data: 'test' });
      expect(pendingRequests.size).toBe(0);
    });

    it('should remove request from pending map after resolving', () => {
      pendingRequests.set('req-1', { resolve: jest.fn(), reject: jest.fn() });
      pendingRequests.set('req-2', { resolve: jest.fn(), reject: jest.fn() });

      handleRendererResponse('req-1', { result: 'ok' });

      expect(pendingRequests.has('req-1')).toBe(false);
      expect(pendingRequests.has('req-2')).toBe(true);
    });
  });

  describe('requestFromRenderer', () => {
    it('should reject when window is null', async () => {
      mainWindowRef = null;

      await expect(
        requestFromRenderer('test-channel', { data: 'test' })
      ).rejects.toThrow('not available');
    });

    it('should reject when window is destroyed', async () => {
      mainWindowRef = { isDestroyed: () => true, webContents: { send: jest.fn() } };

      await expect(
        requestFromRenderer('test-channel', { data: 'test' })
      ).rejects.toThrow('not available');
    });

    it('should send IPC message with request ID', async () => {
      const mockSend = jest.fn();
      mainWindowRef = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      };

      const promise = requestFromRenderer('test-channel', { foo: 'bar' });

      await new Promise(resolve => setTimeout(resolve, 10));

      expect(mockSend).toHaveBeenCalledTimes(1);
      expect(mockSend).toHaveBeenCalledWith('test-channel', expect.objectContaining({
        requestId: expect.stringMatching(/^mcp-/),
        foo: 'bar'
      }));

      // Resolve to clean up
      const requestId = mockSend.mock.calls[0][1].requestId;
      handleRendererResponse(requestId, { ok: true });

      const result = await promise;
      expect(result.ok).toBe(true);
    });

    it('should timeout if renderer does not respond', async () => {
      const mockSend = jest.fn();
      mainWindowRef = {
        isDestroyed: () => false,
        webContents: { send: mockSend }
      };

      await expect(
        requestFromRenderer('test-channel', { data: 'test' }, 100) // 100ms timeout
      ).rejects.toThrow('timed out');
    }, 5000);
  });

  describe('MCP_PORT', () => {
    it('should be 9421', () => {
      expect(MCP_PORT).toBe(9421);
    });
  });

  describe('JSON-RPC response format', () => {
    it('should always include jsonrpc version in responses', async () => {
      const methods = [
        { method: 'initialize', params: {} },
        { method: 'ping', params: {} },
        { method: 'tools/list', params: {} },
        { method: 'resources/list', params: {} },
        { method: 'unknown', params: {} }
      ];

      for (let i = 0; i < methods.length; i++) {
        const response = await handleJsonRpcRequest({
          jsonrpc: '2.0',
          id: 100 + i,
          ...methods[i]
        });

        if (response !== null) {
          expect(response.jsonrpc).toBe('2.0');
          expect(response.id).toBe(100 + i);
        }
      }
    });

    it('should have either result or error, never both', async () => {
      const successResponse = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 200,
        method: 'ping'
      });

      expect(successResponse.result).toBeDefined();
      expect(successResponse.error).toBeUndefined();

      const errorResponse = await handleJsonRpcRequest({
        jsonrpc: '2.0',
        id: 201,
        method: 'nonexistent'
      });

      expect(errorResponse.error).toBeDefined();
      expect(errorResponse.result).toBeUndefined();
    });
  });
});
