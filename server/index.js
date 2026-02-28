const path = require('path');
const config = require('./lib/config');
const Store = require('./lib/store');
const WSManager = require('./lib/ws-manager');
const createServer = require('./lib/server');
const ResolverService = require('./services/resolver-service');
const AuthService = require('./services/auth-service');
const QueueService = require('./services/queue-service');
const PlaybackService = require('./services/playback-service');
const PlaylistService = require('./services/playlist-service');
const CollectionService = require('./services/collection-service');
const ScrobbleService = require('./services/scrobble-service');
const SyncService = require('./services/sync-service');
const ChatService = require('./services/chat-service');
const MCPService = require('./services/mcp-service');
const SearchHistoryService = require('./services/search-history-service');
const LocalFilesService = require('../local-files');
const createResolverRoutes = require('./routes/resolvers');
const createConfigRoutes = require('./routes/config');
const createAuthRoutes = require('./routes/auth');
const createQueueRoutes = require('./routes/queue');
const createPlaybackRoutes = require('./routes/playback');
const createStreamRoutes = require('./routes/stream');
const createPlaylistRoutes = require('./routes/playlists');
const createCollectionRoutes = require('./routes/collection');
const createScrobblerRoutes = require('./routes/scrobblers');
const createLocalFilesRoutes = require('./routes/local-files');
const createSyncRoutes = require('./routes/sync');
const createChatRoutes = require('./routes/chat');
const createSearchHistoryRoutes = require('./routes/search-history');
const createHealthRoutes = require('./routes/health');

async function main() {
  // Initialize store
  const store = new Store(path.join(config.dataDir, 'store.json'));

  // Initialize WebSocket manager
  const wsManager = new WSManager();

  // Create server
  const { httpServer, mountRoutes } = createServer(wsManager);

  // Initialize services
  const resolverService = new ResolverService(store, wsManager, config.pluginDirs);
  await resolverService.loadPlugins();

  const authService = new AuthService(store, wsManager);
  const queueService = new QueueService(store, wsManager);
  const playbackService = new PlaybackService({
    queueService, resolverService, authService, wsManager
  });
  const playlistService = new PlaylistService(store, wsManager);
  const collectionService = new CollectionService(config.dataDir, wsManager);
  const scrobbleService = new ScrobbleService(store, wsManager);
  const syncService = new SyncService(store, authService, wsManager);
  const chatService = new ChatService({
    resolverService, queueService, playbackService, playlistService, wsManager
  });
  const mcpService = new MCPService({
    resolverService, queueService, playbackService, playlistService
  });
  const searchHistoryService = new SearchHistoryService(store);

  // Hook scrobbling into playback events
  wsManager.on('client:progress', (payload) => {
    if (payload.position) scrobbleService.onProgressUpdate(payload.position);
  });

  // Initialize local files service
  const localFilesService = new LocalFilesService(config.dataDir);
  await localFilesService.init();

  // Pipe local files events to WS
  if (localFilesService.watcher) {
    localFilesService.watcher.onScanProgress = (progress) => {
      wsManager.broadcast('localFiles:scanProgress', progress);
    };
    localFilesService.watcher.onLibraryChanged = () => {
      wsManager.broadcast('localFiles:libraryChanged', {});
    };
  }

  // Mount routes
  const resolverRoutes = createResolverRoutes(resolverService);
  const configRoutes = createConfigRoutes(store);
  const authRoutes = createAuthRoutes(authService);
  const queueRoutes = createQueueRoutes(queueService);
  const playbackRoutes = createPlaybackRoutes(playbackService);
  const streamRoutes = createStreamRoutes(localFilesService);
  const playlistRoutes = createPlaylistRoutes(playlistService);
  const collectionRoutes = createCollectionRoutes(collectionService);
  const scrobblerRoutes = createScrobblerRoutes(scrobbleService);
  const localFilesRoutes = createLocalFilesRoutes(localFilesService);
  const syncRoutes = createSyncRoutes(syncService);
  const chatRoutes = createChatRoutes(chatService, mcpService);
  const searchHistoryRoutes = createSearchHistoryRoutes(searchHistoryService);
  const healthRoutes = createHealthRoutes(resolverService);
  mountRoutes({
    resolverRoutes, configRoutes, authRoutes,
    queueRoutes, playbackRoutes, streamRoutes,
    playlistRoutes, collectionRoutes, scrobblerRoutes,
    localFilesRoutes, syncRoutes, chatRoutes,
    searchHistoryRoutes, healthRoutes
  });

  // Start listening
  httpServer.listen(config.port, config.host, () => {
    console.log(`[Parachord Server] Listening on http://${config.host}:${config.port}`);
    console.log(`[Parachord Server] WebSocket available at ws://${config.host}:${config.port}`);
    console.log(`[Parachord Server] ${resolverService.getAllResolvers().length} resolvers loaded`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('\n[Parachord Server] Shutting down...');
    store.flushSync();
    httpServer.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('[Parachord Server] Fatal:', err);
  process.exit(1);
});
