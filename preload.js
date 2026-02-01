const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Storage operations
  store: {
    get: (key) => ipcRenderer.invoke('store-get', key),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
    debug: () => ipcRenderer.invoke('debug-store')
  },

  // Spotify operations
  spotify: {
    authenticate: () => ipcRenderer.invoke('spotify-auth'),
    checkToken: () => ipcRenderer.invoke('spotify-check-token'),
    launchInBackground: () => ipcRenderer.invoke('spotify-launch-background'),
    getCredentials: () => ipcRenderer.invoke('spotify-get-credentials'),
    setCredentials: (credentials) => ipcRenderer.invoke('spotify-set-credentials', credentials),

    // Listen for auth success events from main process
    onAuthSuccess: (callback) => {
      ipcRenderer.on('spotify-auth-success', (event, data) => {
        callback(data);
      });
    },

    // Listen for auth error events from main process
    onAuthError: (callback) => {
      ipcRenderer.on('spotify-auth-error', (event, error) => {
        callback(error);
      });
    },

    // Main process polling controls (background-safe)
    polling: {
      start: (params) => ipcRenderer.invoke('spotify-polling-start', params),
      stop: () => ipcRenderer.invoke('spotify-polling-stop'),
      updateToken: (token) => ipcRenderer.invoke('spotify-polling-update-token', token),
      updateTrack: (params) => ipcRenderer.invoke('spotify-polling-update-track', params),
      getStatus: () => ipcRenderer.invoke('spotify-polling-status'),

      // Listen for polling events from main process
      onAdvance: (callback) => {
        ipcRenderer.on('spotify-polling-advance', (event, data) => {
          callback(data);
        });
      },
      onProgress: (callback) => {
        ipcRenderer.on('spotify-polling-progress', (event, data) => {
          callback(data);
        });
      },
      onTokenExpired: (callback) => {
        ipcRenderer.on('spotify-polling-token-expired', () => {
          callback();
        });
      }
    }
  },

  // SoundCloud operations
  soundcloud: {
    authenticate: () => ipcRenderer.invoke('soundcloud-auth'),
    checkToken: () => ipcRenderer.invoke('soundcloud-check-token'),
    disconnect: () => ipcRenderer.invoke('soundcloud-disconnect'),
    getCredentials: () => ipcRenderer.invoke('soundcloud-get-credentials'),
    setCredentials: (credentials) => ipcRenderer.invoke('soundcloud-set-credentials', credentials),

    // Listen for auth success events from main process
    onAuthSuccess: (callback) => {
      ipcRenderer.on('soundcloud-auth-success', (event, data) => {
        callback(data);
      });
    },

    // Listen for auth error events from main process
    onAuthError: (callback) => {
      ipcRenderer.on('soundcloud-auth-error', (event, error) => {
        callback(error);
      });
    }
  },

  // Shell operations - use IPC for better security
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  },

  // Proxy fetch - bypasses CORS for resolvers
  proxyFetch: (url, options) => ipcRenderer.invoke('proxy-fetch', url, options),

  // Crypto utilities for scrobbling
  crypto: {
    md5: (input) => ipcRenderer.invoke('crypto-md5', input)
  },

  // Media key handlers
  onMediaKey: (callback) => {
    ipcRenderer.on('media-key', (event, action) => {
      callback(action);
    });
  },

  // Media key settings
  mediaKeys: {
    getMode: () => ipcRenderer.invoke('media-keys-get-mode'),
    setMode: (mode) => ipcRenderer.invoke('media-keys-set-mode', mode),
    updatePlaybackSource: (source) => ipcRenderer.invoke('media-keys-update-playback-source', source)
  },

  // Menu action handlers
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (event, action) => {
      callback(action);
    });
  },

  // Auto-updater
  updater: {
    check: () => ipcRenderer.invoke('updater-check'),
    download: () => ipcRenderer.invoke('updater-download'),
    install: () => ipcRenderer.invoke('updater-install'),
    getVersion: () => ipcRenderer.invoke('updater-get-version'),
    onStatus: (callback) => {
      ipcRenderer.on('updater-status', (event, status) => {
        callback(status);
      });
    }
  },

  // Plugin operations
  resolvers: {
    loadBuiltin: () => ipcRenderer.invoke('resolvers-load-builtin'),
    pickFile: () => ipcRenderer.invoke('resolvers-pick-file'),
    install: (axeContent, filename) => ipcRenderer.invoke('resolvers-install', axeContent, filename),
    uninstall: (resolverId) => ipcRenderer.invoke('resolvers-uninstall', resolverId),
    showContextMenu: (resolverId) => ipcRenderer.invoke('resolvers-show-context-menu', resolverId),
    onContextMenuAction: (callback) => {
      ipcRenderer.on('resolver-context-menu-action', (event, data) => {
        callback(data);
      });
    },
    // Marketplace operations
    syncMarketplace: () => ipcRenderer.invoke('plugins-sync-marketplace'),
    getMarketplaceManifest: () => ipcRenderer.invoke('marketplace-get-manifest'),
    downloadFromMarketplace: (url) => ipcRenderer.invoke('marketplace-download-resolver', url)
  },

  // Playlist operations
  playlists: {
    load: () => ipcRenderer.invoke('playlists-load'),
    import: () => ipcRenderer.invoke('playlists-import'),
    save: (filename, xspfContent) => ipcRenderer.invoke('playlists-save', filename, xspfContent),
    export: (defaultFilename, xspfContent) => ipcRenderer.invoke('playlists-export', defaultFilename, xspfContent),
    delete: (playlistId) => ipcRenderer.invoke('playlists-delete', playlistId)
  },

  // Browser extension operations
  extension: {
    sendCommand: (command) => ipcRenderer.invoke('extension-send-command', command),
    getStatus: () => ipcRenderer.invoke('extension-get-status'),
    onMessage: (callback) => {
      ipcRenderer.on('extension-message', (event, message) => {
        callback(message);
      });
    },
    onConnected: (callback) => {
      ipcRenderer.on('extension-connected', () => {
        callback();
      });
    },
    onDisconnected: (callback) => {
      ipcRenderer.on('extension-disconnected', () => {
        callback();
      });
    }
  },

  // Embedded player operations
  embed: {
    respond: (requestId, data) => ipcRenderer.invoke('embed-response', { requestId, data }),
    broadcast: (eventType, data) => ipcRenderer.invoke('embed-broadcast', { eventType, data }),
    onGetState: (callback) => {
      ipcRenderer.on('embed-get-state', (event, data) => {
        callback(data);
      });
    },
    onSearch: (callback) => {
      ipcRenderer.on('embed-search', (event, data) => {
        callback(data);
      });
    },
    onPlay: (callback) => {
      ipcRenderer.on('embed-play', (event, data) => {
        callback(data);
      });
    },
    onPause: (callback) => {
      ipcRenderer.on('embed-pause', () => {
        callback();
      });
    },
    onResume: (callback) => {
      ipcRenderer.on('embed-resume', () => {
        callback();
      });
    },
    onNext: (callback) => {
      ipcRenderer.on('embed-next', () => {
        callback();
      });
    },
    onPrevious: (callback) => {
      ipcRenderer.on('embed-previous', () => {
        callback();
      });
    },
    onSetVolume: (callback) => {
      ipcRenderer.on('embed-set-volume', (event, data) => {
        callback(data);
      });
    }
  },

  // Track/playlist context menu operations
  contextMenu: {
    showTrackMenu: (data) => ipcRenderer.invoke('show-track-context-menu', data),
    onAction: (callback) => {
      ipcRenderer.on('track-context-menu-action', (event, data) => {
        callback(data);
      });
    }
  },

  // Local Files operations
  localFiles: {
    addWatchFolder: () => ipcRenderer.invoke('localFiles:addWatchFolder'),
    removeWatchFolder: (path) => ipcRenderer.invoke('localFiles:removeWatchFolder', path),
    getWatchFolders: () => ipcRenderer.invoke('localFiles:getWatchFolders'),
    rescanAll: () => ipcRenderer.invoke('localFiles:rescanAll'),
    rescanFolder: (path) => ipcRenderer.invoke('localFiles:rescanFolder', path),
    search: (query) => ipcRenderer.invoke('localFiles:search', query),
    resolve: (params) => ipcRenderer.invoke('localFiles:resolve', params),
    getStats: () => ipcRenderer.invoke('localFiles:getStats'),
    saveId3Tags: (filePath, tags) => ipcRenderer.invoke('localFiles:saveId3Tags', filePath, tags),

    // Event listeners
    onScanProgress: (callback) => {
      ipcRenderer.on('localFiles:scanProgress', (event, data) => {
        callback(data);
      });
    },
    onLibraryChanged: (callback) => {
      ipcRenderer.on('localFiles:libraryChanged', (event, changes) => {
        callback(changes);
      });
    }
  },

  // Collection operations (favorites)
  collection: {
    load: () => ipcRenderer.invoke('collection:load'),
    save: (collection) => ipcRenderer.invoke('collection:save', collection)
  },

  // Sync settings operations
  syncSettings: {
    load: () => ipcRenderer.invoke('sync-settings:load'),
    save: (settings) => ipcRenderer.invoke('sync-settings:save', settings),
    getProvider: (providerId) => ipcRenderer.invoke('sync-settings:get-provider', providerId),
    setProvider: (providerId, settings) => ipcRenderer.invoke('sync-settings:set-provider', providerId, settings)
  },

  // Sync operations (library sync from resolvers)
  sync: {
    getProviders: () => ipcRenderer.invoke('sync:get-providers'),
    checkAuth: (providerId) => ipcRenderer.invoke('sync:check-auth', providerId),
    start: (providerId, options) => ipcRenderer.invoke('sync:start', providerId, options),
    cancel: (providerId) => ipcRenderer.invoke('sync:cancel', providerId),
    fetchPlaylists: (providerId) => ipcRenderer.invoke('sync:fetch-playlists', providerId),
    fetchPlaylistTracks: (providerId, playlistExternalId) => ipcRenderer.invoke('sync:fetch-playlist-tracks', providerId, playlistExternalId),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('sync:progress', handler);
      return () => ipcRenderer.removeListener('sync:progress', handler);
    }
  },

  // Playback window operations (for Bandcamp, etc. with autoplay)
  playbackWindow: {
    open: (url, options) => ipcRenderer.invoke('open-playback-window', url, options),
    close: () => ipcRenderer.invoke('close-playback-window'),
    toggle: () => ipcRenderer.invoke('playback-window-toggle'),
    onClosed: (callback) => {
      ipcRenderer.on('playback-window-closed', () => {
        callback();
      });
    },
    onEvent: (callback) => {
      ipcRenderer.on('playback-window-event', (event, eventType) => {
        callback(eventType);
      });
    }
  },

  // App lifecycle events - for background/foreground handling
  app: {
    onForeground: (callback) => {
      ipcRenderer.on('app-foreground', () => {
        callback();
      });
    },
    onBackground: (callback) => {
      ipcRenderer.on('app-background', () => {
        callback();
      });
    }
  },

  // Config - expose select environment variables to renderer
  config: {
    get: (key) => ipcRenderer.invoke('config-get', key)
  },

  // Scrobbler config - get Last.fm API credentials from main process
  getScrobblerConfig: () => ipcRenderer.invoke('get-scrobbler-config'),

  // Search history operations
  searchHistory: {
    load: () => ipcRenderer.invoke('search-history-load'),
    save: (entry) => ipcRenderer.invoke('search-history-save', entry),
    clear: (entryQuery) => ipcRenderer.invoke('search-history-clear', entryQuery)
  },

  // MusicKit (Apple Music) native bridge operations - macOS only
  musicKit: {
    // Check if native MusicKit helper is available
    isAvailable: () => ipcRenderer.invoke('musickit:available'),
    // Start the helper process
    start: () => ipcRenderer.invoke('musickit:start'),
    // Check authorization status (uses cache by default for speed)
    checkAuth: (forceRefresh = false) => ipcRenderer.invoke('musickit:check-auth', forceRefresh),
    // Get cached auth status (very fast, no IPC to helper)
    getCachedAuth: () => ipcRenderer.invoke('musickit:get-cached-auth'),
    // Request user authorization (shows Apple ID sign-in)
    authorize: () => ipcRenderer.invoke('musickit:authorize'),
    // Search for songs
    search: (query, limit = 25) => ipcRenderer.invoke('musickit:search', query, limit),
    // Resolve a track by artist/title/album
    resolve: (artist, title, album = null) => ipcRenderer.invoke('musickit:resolve', artist, title, album),
    // Playback controls
    play: (songId) => ipcRenderer.invoke('musickit:play', songId),
    pause: () => ipcRenderer.invoke('musickit:pause'),
    resume: () => ipcRenderer.invoke('musickit:resume'),
    stop: () => ipcRenderer.invoke('musickit:stop'),
    skipNext: () => ipcRenderer.invoke('musickit:skip-next'),
    skipPrevious: () => ipcRenderer.invoke('musickit:skip-previous'),
    seek: (position) => ipcRenderer.invoke('musickit:seek', position),
    // State queries
    getPlaybackState: () => ipcRenderer.invoke('musickit:get-playback-state'),
    getNowPlaying: () => ipcRenderer.invoke('musickit:get-now-playing'),
    // Queue management
    addToQueue: (songId) => ipcRenderer.invoke('musickit:add-to-queue', songId),
    // Volume control
    setVolume: (volume) => ipcRenderer.invoke('musickit:set-volume', volume)
  },

  // Generic invoke for IPC calls
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args)
});
