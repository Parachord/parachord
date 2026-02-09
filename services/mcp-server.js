/**
 * MCP (Model Context Protocol) Server for Parachord
 *
 * Exposes Parachord's DJ tools and playback state to external MCP clients
 * like Claude Desktop. Runs an HTTP server on port 9421 implementing the
 * MCP Streamable HTTP transport.
 *
 * Architecture:
 * - MCP server runs in Electron main process
 * - Tool calls are forwarded to the renderer via IPC
 * - Renderer executes tools using existing DJ tools infrastructure
 * - Results are returned to the MCP client
 */

const express = require('express');
const { getSimpleToolDefinitions } = require('../tools/dj-tools');

const MCP_PORT = 9421;
const MCP_PROTOCOL_VERSION = '2025-03-26';
const SERVER_NAME = 'parachord';
const SERVER_VERSION = '0.6.0';

/**
 * Pending requests waiting for renderer responses
 * @type {Map<string, {resolve: Function, reject: Function}>}
 */
const pendingRequests = new Map();

/** @type {import('electron').BrowserWindow|null} */
let mainWindowRef = null;

/** @type {import('http').Server|null} */
let httpServer = null;

/** @type {boolean} */
let initialized = false;

/**
 * Generate a unique request ID
 */
function generateRequestId() {
  return `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Send a request to the renderer and wait for a response
 * @param {string} channel - IPC channel name
 * @param {Object} payload - Data to send
 * @param {number} [timeout=30000] - Timeout in ms
 * @returns {Promise<Object>}
 */
function requestFromRenderer(channel, payload, timeout = 30000) {
  return new Promise((resolve, reject) => {
    if (!mainWindowRef || mainWindowRef.isDestroyed()) {
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

/**
 * Handle a response from the renderer
 * @param {string} requestId
 * @param {Object} data
 */
function handleRendererResponse(requestId, data) {
  const pending = pendingRequests.get(requestId);
  if (pending) {
    pendingRequests.delete(requestId);
    pending.resolve(data);
  }
}

/**
 * Build the MCP tools list from DJ tool definitions
 */
function getMcpTools() {
  return getSimpleToolDefinitions().map(tool => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters || { type: 'object', properties: {} }
  }));
}

/**
 * Handle a JSON-RPC request
 * @param {Object} request - JSON-RPC request object
 * @returns {Promise<Object>} JSON-RPC response
 */
async function handleJsonRpcRequest(request) {
  const { id, method, params } = request;

  switch (method) {
    case 'initialize':
      initialized = true;
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: {}
          },
          serverInfo: {
            name: SERVER_NAME,
            version: SERVER_VERSION
          }
        }
      };

    case 'notifications/initialized':
      // Client acknowledges initialization - no response needed for notifications
      return null;

    case 'ping':
      return {
        jsonrpc: '2.0',
        id,
        result: {}
      };

    case 'tools/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: getMcpTools()
        }
      };

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};

      if (!toolName) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Missing tool name'
          }
        };
      }

      try {
        const result = await requestFromRenderer('mcp-tool-call', {
          toolName,
          args: toolArgs
        });

        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result, null, 2)
              }
            ]
          }
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify({ success: false, error: error.message })
              }
            ],
            isError: true
          }
        };
      }
    }

    case 'resources/list':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: [
            {
              uri: 'parachord://now-playing',
              name: 'Now Playing',
              description: 'Currently playing track and playback state',
              mimeType: 'application/json'
            },
            {
              uri: 'parachord://queue',
              name: 'Queue',
              description: 'Current playback queue',
              mimeType: 'application/json'
            }
          ]
        }
      };

    case 'resources/read': {
      const uri = params?.uri;

      if (!uri) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Missing resource URI'
          }
        };
      }

      try {
        const state = await requestFromRenderer('mcp-get-state', {});

        let contents;
        if (uri === 'parachord://now-playing') {
          contents = {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              track: state.currentTrack || null,
              isPlaying: state.isPlaying || false,
              currentTime: state.currentTime || 0,
              duration: state.duration || 0
            }, null, 2)
          };
        } else if (uri === 'parachord://queue') {
          contents = {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify({
              tracks: state.queue || [],
              count: state.queue?.length || 0
            }, null, 2)
          };
        } else {
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32602,
              message: `Unknown resource: ${uri}`
            }
          };
        }

        return {
          jsonrpc: '2.0',
          id,
          result: { contents: [contents] }
        };
      } catch (error) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32603,
            message: error.message
          }
        };
      }
    }

    default:
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      };
  }
}

/**
 * Start the MCP HTTP server
 * @param {import('electron').BrowserWindow} mainWindow - The main Electron window
 * @returns {import('http').Server}
 */
function startMcpServer(mainWindow) {
  if (httpServer) return httpServer;

  mainWindowRef = mainWindow;

  const app = express();
  app.use(express.json());

  // MCP Streamable HTTP endpoint
  app.post('/mcp', async (req, res) => {
    const body = req.body;

    // Handle single request
    if (!Array.isArray(body)) {
      // Notifications have no id
      if (body.id === undefined || body.id === null) {
        await handleJsonRpcRequest(body);
        res.status(204).end();
        return;
      }

      const response = await handleJsonRpcRequest(body);
      if (response === null) {
        res.status(204).end();
        return;
      }
      res.json(response);
      return;
    }

    // Handle batch request
    const responses = [];
    for (const request of body) {
      const response = await handleJsonRpcRequest(request);
      if (response !== null) {
        responses.push(response);
      }
    }

    if (responses.length === 0) {
      res.status(204).end();
      return;
    }

    res.json(responses);
  });

  // SSE endpoint for server-to-client notifications (required by spec)
  app.get('/mcp', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Keep connection alive
    const keepAlive = setInterval(() => {
      res.write(':keepalive\n\n');
    }, 30000);

    req.on('close', () => {
      clearInterval(keepAlive);
    });
  });

  // Session termination
  app.delete('/mcp', (req, res) => {
    initialized = false;
    res.status(204).end();
  });

  httpServer = app.listen(MCP_PORT, '127.0.0.1', () => {
    console.log(`MCP server running on http://127.0.0.1:${MCP_PORT}/mcp`);
  });

  return httpServer;
}

/**
 * Stop the MCP server
 */
function stopMcpServer() {
  if (httpServer) {
    httpServer.close();
    httpServer = null;
  }
  mainWindowRef = null;
  initialized = false;
  pendingRequests.clear();
}

/**
 * Update the main window reference (e.g., after window recreation)
 * @param {import('electron').BrowserWindow} mainWindow
 */
function setMcpMainWindow(mainWindow) {
  mainWindowRef = mainWindow;
}

module.exports = {
  startMcpServer,
  stopMcpServer,
  setMcpMainWindow,
  handleRendererResponse,
  handleJsonRpcRequest,
  MCP_PORT,
  // Exported for testing
  pendingRequests,
  getMcpTools
};
