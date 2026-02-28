const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const createAuthMiddleware = require('../middleware/auth');
const errorHandler = require('../middleware/error-handler');

/**
 * Create the Express app and HTTP server with WebSocket upgrade
 */
function createServer(wsManager) {
  const app = express();
  app.use(express.json());

  // API key auth (only active when PARACHORD_API_KEY is set)
  app.use(createAuthMiddleware());

  const httpServer = http.createServer(app);

  // WebSocket upgrade
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wsManager.addClient(ws);
    });
  });

  /**
   * Mount routes onto the app. Called after services are initialized.
   */
  function mountRoutes(routes) {
    const {
      resolverRoutes, configRoutes, authRoutes,
      queueRoutes, playbackRoutes, streamRoutes,
      playlistRoutes, collectionRoutes,
      localFilesRoutes, syncRoutes
    } = routes;

    // Core
    app.use('/api/resolvers', resolverRoutes);
    app.use('/api/config', configRoutes);

    // Auth routes — OAuth callbacks at /auth/*, API at /api/auth/*
    if (authRoutes) {
      app.use('/auth', authRoutes);
      app.use('/api/auth', authRoutes);
    }

    // Queue and playback
    if (queueRoutes) app.use('/api/queue', queueRoutes);
    if (playbackRoutes) app.use('/api/playback', playbackRoutes);
    if (streamRoutes) app.use('/api/stream', streamRoutes);

    // Playlists and collection
    if (playlistRoutes) app.use('/api/playlists', playlistRoutes);
    if (collectionRoutes) app.use('/api/collection', collectionRoutes);

    // Scrobblers
    if (routes.scrobblerRoutes) app.use('/api/scrobblers', routes.scrobblerRoutes);

    // Local files and sync
    if (localFilesRoutes) app.use('/api/local-files', localFilesRoutes);
    if (syncRoutes) app.use('/api/sync', syncRoutes);

    // Search history
    if (routes.searchHistoryRoutes) app.use('/api/search-history', routes.searchHistoryRoutes);

    // Health and version
    if (routes.healthRoutes) app.use('/api', routes.healthRoutes);

    // Chat and MCP
    if (routes.chatRoutes) {
      app.use('/api/chat', routes.chatRoutes);
      app.post('/mcp', (req, res, next) => { req.url = '/mcp'; routes.chatRoutes(req, res, next); });
      app.get('/mcp', (req, res, next) => { req.url = '/mcp'; routes.chatRoutes(req, res, next); });
    }

    // Mount search at top level (from resolver routes)
    app.get('/api/search', (req, res, next) => {
      // Delegate to the resolver router's search handler
      req.url = '/search?q=' + encodeURIComponent(req.query.q || '');
      resolverRoutes(req, res, next);
    });

    // Resolve and lookup at top level
    app.post('/api/resolve', (req, res, next) => {
      req.url = '/resolve';
      resolverRoutes(req, res, next);
    });

    app.post('/api/lookup-url', (req, res, next) => {
      req.url = '/lookup-url';
      resolverRoutes(req, res, next);
    });

    // Error handler last
    app.use(errorHandler);
  }

  return { app, httpServer, wss, mountRoutes };
}

module.exports = createServer;
