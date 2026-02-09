#!/usr/bin/env node

/**
 * Parachord MCP Stdio Bridge
 *
 * Bridges between Claude Desktop's stdio MCP transport and
 * Parachord's HTTP MCP server running on port 9421.
 *
 * Claude Desktop launches this script as a subprocess and communicates
 * via JSON-RPC over stdin/stdout. This script forwards those requests
 * to Parachord's HTTP endpoint and returns the responses.
 *
 * Usage in Claude Desktop config:
 *   {
 *     "mcpServers": {
 *       "parachord": {
 *         "command": "node",
 *         "args": ["/path/to/parachord/mcp-stdio.js"]
 *       }
 *     }
 *   }
 */

const http = require('http');

const MCP_HOST = '127.0.0.1';
const MCP_PORT = 9421;
const MCP_PATH = '/mcp';

/**
 * Send a JSON-RPC request to Parachord's HTTP MCP server
 * @param {Object} body - JSON-RPC request body
 * @returns {Promise<Object|null>} Response body or null for 204
 */
function sendToParachord(body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);

    const req = http.request({
      hostname: MCP_HOST,
      port: MCP_PORT,
      path: MCP_PATH,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    }, (res) => {
      let responseData = '';
      res.on('data', chunk => { responseData += chunk; });
      res.on('end', () => {
        if (res.statusCode === 204 || !responseData) {
          resolve(null);
          return;
        }
        try {
          resolve(JSON.parse(responseData));
        } catch (e) {
          reject(new Error(`Invalid JSON response: ${responseData}`));
        }
      });
    });

    req.on('error', (err) => {
      // If Parachord isn't running, return a friendly error
      if (err.code === 'ECONNREFUSED') {
        reject(new Error('Parachord is not running. Please start Parachord first.'));
      } else {
        reject(err);
      }
    });

    req.write(data);
    req.end();
  });
}

/**
 * Write a JSON-RPC message to stdout
 * @param {Object} message - JSON-RPC response
 */
function writeMessage(message) {
  const json = JSON.stringify(message);
  process.stdout.write(json + '\n');
}

/**
 * Process a single JSON-RPC request from stdin
 * @param {Object} request - Parsed JSON-RPC request
 */
async function processRequest(request) {
  try {
    const response = await sendToParachord(request);
    if (response) {
      writeMessage(response);
    }
  } catch (error) {
    // If this is a request (has an id), send an error response
    if (request.id !== undefined && request.id !== null) {
      writeMessage({
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: error.message
        }
      });
    }
    // For notifications (no id), silently discard errors
  }
}

// Read JSON-RPC messages from stdin (newline-delimited JSON)
let buffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;

  // Process complete lines
  let newlineIndex;
  while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, newlineIndex).trim();
    buffer = buffer.slice(newlineIndex + 1);

    if (!line) continue;

    try {
      const request = JSON.parse(line);
      processRequest(request);
    } catch (e) {
      // Invalid JSON - send parse error
      writeMessage({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32700,
          message: 'Parse error'
        }
      });
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

// Handle uncaught errors gracefully
process.on('uncaughtException', (err) => {
  if (err.code === 'EPIPE') return; // stdout closed
  process.stderr.write(`MCP bridge error: ${err.message}\n`);
});
