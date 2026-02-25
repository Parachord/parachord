#!/usr/bin/env node
'use strict';

// Parachord Native Messaging Host
//
// Relays messages between Chrome's native messaging protocol (stdin/stdout)
// and the Parachord desktop app via a local IPC socket.
//
// Chrome launches this process when the extension calls
// chrome.runtime.connectNative('com.parachord.desktop').
//
// Protocol (both native messaging and IPC socket):
//   [4-byte uint32 LE length] [UTF-8 JSON payload]

const net = require('net');
const path = require('path');
const os = require('os');

// --- IPC socket path (must match main.js) ---

function getSocketPath() {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\parachord-native-messaging';
  }
  // macOS / Linux: use a well-known path in the user's home directory
  return path.join(os.homedir(), '.parachord', 'native-messaging.sock');
}

// --- Native messaging protocol (stdin/stdout) ---

function readLengthPrefixedMessages(stream, callback) {
  let buffer = Buffer.alloc(0);
  let expectedLen = null;

  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    // Process as many complete messages as available
    while (true) {
      if (expectedLen === null) {
        if (buffer.length < 4) break;
        expectedLen = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
      }

      if (buffer.length < expectedLen) break;

      const json = buffer.subarray(0, expectedLen).toString('utf8');
      buffer = buffer.subarray(expectedLen);
      expectedLen = null;

      try {
        callback(JSON.parse(json));
      } catch (e) {
        // Skip malformed messages
      }
    }
  });
}

function writeLengthPrefixedMessage(stream, msg) {
  const json = JSON.stringify(msg);
  const payload = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  stream.write(header);
  stream.write(payload);
}

// --- Main ---

const socketPath = getSocketPath();

const ipc = net.createConnection(socketPath, () => {
  // Identify ourselves so the desktop app knows this is the native messaging host
  writeLengthPrefixedMessage(ipc, { type: '_nm_hello' });
});

ipc.on('error', (err) => {
  // Desktop app not running or socket not available — exit so Chrome can retry
  process.stderr.write(`[Parachord NM Host] IPC error: ${err.message}\n`);
  process.exit(1);
});

ipc.on('close', () => {
  process.exit(0);
});

// Relay: Chrome (stdin) → Desktop (IPC socket)
readLengthPrefixedMessages(process.stdin, (msg) => {
  writeLengthPrefixedMessage(ipc, msg);
});

// Relay: Desktop (IPC socket) → Chrome (stdout)
readLengthPrefixedMessages(ipc, (msg) => {
  writeLengthPrefixedMessage(process.stdout, msg);
});

// Clean exit when Chrome closes the native messaging channel
process.stdin.on('end', () => {
  ipc.end();
  process.exit(0);
});

process.on('SIGTERM', () => {
  ipc.end();
  process.exit(0);
});
