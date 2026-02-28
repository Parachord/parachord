const { v4: uuidv4 } = require('uuid');

class WSManager {
  constructor() {
    this.clients = new Map(); // id -> { ws, metadata }
    this.handlers = new Map(); // type -> Set<handler>
  }

  /**
   * Register a new WebSocket connection
   */
  addClient(ws) {
    const id = uuidv4();
    this.clients.set(id, { ws, metadata: {} });

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type) {
          this._dispatch(msg.type, msg.payload, id);
        }
      } catch (err) {
        console.error('[WS] Invalid message:', err.message);
      }
    });

    ws.on('close', () => {
      this.clients.delete(id);
      this._dispatch('client:disconnected', { clientId: id });
    });

    ws.on('error', (err) => {
      console.error(`[WS] Client ${id} error:`, err.message);
      this.clients.delete(id);
    });

    this._dispatch('client:connected', { clientId: id });
    return id;
  }

  /**
   * Send a message to a specific client
   */
  send(clientId, type, payload) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) { // WebSocket.OPEN
      client.ws.send(JSON.stringify({ type, payload }));
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  broadcast(type, payload) {
    const msg = JSON.stringify({ type, payload });
    for (const [, client] of this.clients) {
      if (client.ws.readyState === 1) {
        client.ws.send(msg);
      }
    }
  }

  /**
   * Register a handler for a message type
   */
  on(type, handler) {
    if (!this.handlers.has(type)) {
      this.handlers.set(type, new Set());
    }
    this.handlers.get(type).add(handler);
  }

  /**
   * Remove a handler
   */
  off(type, handler) {
    const set = this.handlers.get(type);
    if (set) {
      set.delete(handler);
    }
  }

  _dispatch(type, payload, clientId) {
    const set = this.handlers.get(type);
    if (set) {
      for (const handler of set) {
        try {
          handler(payload, clientId);
        } catch (err) {
          console.error(`[WS] Handler error for ${type}:`, err.message);
        }
      }
    }
  }

  /**
   * Number of connected clients
   */
  get clientCount() {
    return this.clients.size;
  }
}

module.exports = WSManager;
