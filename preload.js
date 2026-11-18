const { contextBridge, ipcRenderer } = require('electron');

console.log('Preload script loaded');

// Synchronous dev-mode detection. Sandboxed preloads don't have __dirname,
// so main.js passes the flag via webPreferences.additionalArguments
// (`--parachord-is-dev=true|false`). Falls back to true (dev) if the flag
// isn't present so we never accidentally silence logs in environments where
// detection failed. Read once at preload time so it's stable for the
// renderer's lifetime.
const __isDevBuild = (() => {
  try {
    const flag = (process.argv || []).find(a => a.startsWith('--parachord-is-dev='));
    if (!flag) return true; // default to dev — safer than accidentally muting prod debug
    return flag.split('=')[1] === 'true';
  } catch (e) {
    return true;
  }
})();

// The theme the window opened in ('light' | 'dark'), from main.js's
// --parachord-theme. index.html sets <html class="dark"> from it before the
// first paint, and the renderer seeds its theme state from that class.
const __initialTheme = (() => {
  try {
    const flag = (process.argv || []).find(a => a.startsWith('--parachord-theme='));
    return flag && flag.split('=')[1] === 'dark' ? 'dark' : 'light';
  } catch (e) {
    return 'light';
  }
})();

// The plugin-mediated licence relay's unsubscribe, while one is live — the
// subscription is SINGLE-OWNER (see onPluginLicenseRequest below): the first
// registration owns the relay until it unsubscribes.
let __pluginLicenseRelayUnsubscribe = null;
// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electron', {
  // Platform identifier (darwin, win32, linux)
  platform: process.platform,

  // Build mode (true when running unpackaged via `electron .`, false in
  // packaged builds). Used for the diagnostic-log buffer's console-pass-
  // through decision.
  isDev: __isDevBuild,

  // Storage operations
  store: {
    get: (key) => ipcRenderer.invoke('store-get', key),
    getBatch: (keys) => ipcRenderer.invoke('store-get-batch', keys),
    set: (key, value) => ipcRenderer.invoke('store-set', key, value),
    delete: (key) => ipcRenderer.invoke('store-delete', key),
    clear: () => ipcRenderer.invoke('store-clear'),
  },

  // N-way reconcile (parachord#911) — dormant; gated by the nway_shadow_enabled
  // / nway_propagate store flags (both default OFF). shadowRun() manually
  // triggers one reconcile cycle for validation (shadow = compute + log only).
  nway: {
    shadowRun: () => ipcRenderer.invoke('nway:shadow-run'),
    // Migration preview (#911): forced compute-only reconcile → named diff.
    preview: () => ipcRenderer.invoke('nway:preview'),
    // Armed drive (#911): run an N-way reconcile cycle now — REAL writes when the
    // client is in 'new' mode, no-op otherwise. Fired right after Accept.
    run: () => ipcRenderer.invoke('nway:run'),
  },

  // Spotify operations
  spotify: {
    authenticate: () => ipcRenderer.invoke('spotify-auth'),
    checkToken: (options) => ipcRenderer.invoke('spotify-check-token', options),
    disconnect: () => ipcRenderer.invoke('spotify-disconnect'),
    launchInBackground: () => ipcRenderer.invoke('spotify-launch-background'),
    scrapePlaylist: (playlistId) => ipcRenderer.invoke('spotify-scrape-playlist', playlistId),
    getCredentials: () => ipcRenderer.invoke('spotify-get-credentials'),
    setCredentials: (credentials) => ipcRenderer.invoke('spotify-set-credentials', credentials),
    // Spotify's rate-limit cooldown, kept by main across restarts (#909):
    // { pauseUntil, until } in ms. Reading it asks Spotify nothing.
    getCooldown: () => ipcRenderer.invoke('spotify-cooldown-get'),
    notePause: (until) => ipcRenderer.send('spotify-pause-note', Number(until) || 0),
    onCooldownChanged: (callback) => {
      const handler = (_event, cooldown) => callback(cooldown);
      ipcRenderer.on('spotify-cooldown-changed', handler);
      return () => ipcRenderer.removeListener('spotify-cooldown-changed', handler);
    },

    // Listen for auth success events from main process
    onAuthSuccess: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('spotify-auth-success', handler);
      return () => ipcRenderer.removeListener('spotify-auth-success', handler);
    },

    // Listen for auth error events from main process
    onAuthError: (callback) => {
      const handler = (event, error) => callback(error);
      ipcRenderer.on('spotify-auth-error', handler);
      return () => ipcRenderer.removeListener('spotify-auth-error', handler);
    },

    // Listen for "your Spotify session expired, sign in again" — emitted
    // by main when a token refresh returns invalid_grant (Spotify's
    // 6-month refresh-token expiry, effective 2026-07-20). The stored
    // token has already been discarded main-side; the renderer should
    // flip to disconnected and prompt re-auth.
    onReauthRequired: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('spotify:reauth-required', handler);
      return () => ipcRenderer.removeListener('spotify:reauth-required', handler);
    },

    // Main process polling controls (background-safe)
    polling: {
      start: (params) => ipcRenderer.invoke('spotify-polling-start', params),
      stop: () => ipcRenderer.invoke('spotify-polling-stop'),
      updateToken: (token) => ipcRenderer.invoke('spotify-polling-update-token', token),
      updateTrack: (params) => ipcRenderer.invoke('spotify-polling-update-track', params),
      seeked: (params) => ipcRenderer.invoke('spotify-polling-seeked', params),
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
      const handler = (event, data) => callback(data);
      ipcRenderer.on('soundcloud-auth-success', handler);
      return () => ipcRenderer.removeListener('soundcloud-auth-success', handler);
    },

    // Listen for auth error events from main process
    onAuthError: (callback) => {
      const handler = (event, error) => callback(error);
      ipcRenderer.on('soundcloud-auth-error', handler);
      return () => ipcRenderer.removeListener('soundcloud-auth-error', handler);
    }
  },

  // Shell operations - use IPC for better security
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  },

  // Proxy fetch - bypasses CORS for resolvers
  proxyFetch: (url, options) => ipcRenderer.invoke('proxy-fetch', url, options),
  // A URL a user or link supplied (hosted playlist, protocol tracklist,
  // SoundCloud short link): every redirect hop checked, body capped
  // (main-process/public-fetch.js). profile is a name, never limits.
  publicFetch: (url, profile, options) => ipcRenderer.invoke('public-fetch', url, profile, options),

  // MusicBrainz / Cover Art Archive over IPv4, the fallback when their IPv6
  // endpoint fails (src/renderer/lib/metabrainz-ipv4.js)
  metabrainzFetchIpv4: (url, options) => ipcRenderer.invoke('metabrainz-fetch-ipv4', url, options),
  // Plex talks to the user's own servers on the LAN (private IPs, *.plex.direct
  // hosts, sometimes self-signed TLS). Renderer fetch is blocked by CORS and
  // proxy-fetch refuses private IPs, so Plex requests go through a dedicated
  // main-process handler scoped to Plex hosts and the user's saved servers
  // (main-process/ipc/plex-fetch.js).
  plex: {
    fetch: (url, options) => ipcRenderer.invoke('plex-fetch', url, options)
  },

  // Crypto utilities for scrobbling
  crypto: {
    md5: (input) => ipcRenderer.invoke('crypto-md5', input)
  },

  // Media key handlers
  onMediaKey: (callback) => {
    const handler = (event, action) => callback(action);
    ipcRenderer.on('media-key', handler);
    return () => ipcRenderer.removeListener('media-key', handler);
  },

  // Media key settings
  mediaKeys: {
    getMode: () => ipcRenderer.invoke('media-keys-get-mode'),
    setMode: (mode) => ipcRenderer.invoke('media-keys-set-mode', mode),
    updatePlaybackSource: (source) => ipcRenderer.invoke('media-keys-update-playback-source', source)
  },

  // MPRIS Linux D-Bus integration (parachord#848). Renderer pushes
  // state updates here; receives DE control events via onMprisControl.
  // All no-ops on non-Linux platforms.
  mpris: {
    updateTrack: (track) => ipcRenderer.invoke('mpris:update-track', track),
    updatePlaybackState: (state) => ipcRenderer.invoke('mpris:update-playback-state', state),
    updatePosition: (positionSeconds) => ipcRenderer.invoke('mpris:update-position', positionSeconds),
    updateShuffle: (shuffle) => ipcRenderer.invoke('mpris:update-shuffle', shuffle),
    updateLoop: (loop) => ipcRenderer.invoke('mpris:update-loop', loop),
    onControl: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('mpris-control', handler);
      return () => ipcRenderer.removeListener('mpris-control', handler);
    }
  },

  // Discord Rich Presence. Deliberately thin: the renderer reports what is
  // playing and whether the toggle is on. The Discord socket, the Application
  // id and the reconnect schedule all live in the main process — nothing here
  // can read or write Discord state directly.
  discordPresence: {
    setEnabled: (enabled) => ipcRenderer.invoke('discordrpc:set-enabled', enabled),
    getStatus: () => ipcRenderer.invoke('discordrpc:get-status'),
    updateTrack: (track) => ipcRenderer.invoke('discordrpc:update-track', track),
    updateState: (patch) => ipcRenderer.invoke('discordrpc:update-state', patch),
    updatePlaybackState: (status) => ipcRenderer.invoke('discordrpc:update-playback-state', status),
    updatePosition: (positionSeconds) => ipcRenderer.invoke('discordrpc:update-position', positionSeconds),
    clear: () => ipcRenderer.invoke('discordrpc:clear')
  },

  // Local server port (parachord#958): Spotify/SoundCloud sign-in callbacks
  // and the parachord:// HTTP bridge. A saved port applies after a restart.
  authServer: {
    getStatus: () => ipcRenderer.invoke('auth-server:get-status'),
    setPort: (port) => ipcRenderer.invoke('auth-server:set-port', port),
    onError: (callback) => {
      const handler = (event, info) => callback(info);
      ipcRenderer.on('auth-server:error', handler);
      return () => ipcRenderer.removeListener('auth-server:error', handler);
    }
  },

  // Menu action handlers
  onMenuAction: (callback) => {
    const handler = (event, action) => callback(action);
    ipcRenderer.on('menu-action', handler);
    return () => ipcRenderer.removeListener('menu-action', handler);
  },

  // Protocol URL handlers (parachord:// deep links)
  onProtocolUrl: (callback) => {
    const handler = (event, url) => callback(url);
    ipcRenderer.on('protocol-url', handler);
    return () => ipcRenderer.removeListener('protocol-url', handler);
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
    showContextMenu: (resolverId, opts) => ipcRenderer.invoke('resolvers-show-context-menu', resolverId, opts),
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
    delete: (playlistId) => ipcRenderer.invoke('playlists-delete', playlistId),
    suppressSync: (providerId, externalId) => ipcRenderer.invoke('playlists-suppress-sync', providerId, externalId),
    deleteFromSource: (providerId, externalId) => ipcRenderer.invoke('playlists-delete-from-source', providerId, externalId)
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
    },
    onQueue: (callback) => {
      ipcRenderer.on('embed-queue', (event, data) => {
        callback(data);
      });
    }
  },

  // MCP server operations (Claude Desktop integration)
  mcp: {
    getInfo: () => ipcRenderer.invoke('mcp-get-info'),
    respond: (requestId, data) => ipcRenderer.invoke('mcp-response', { requestId, data }),
    onToolCall: (callback) => {
      ipcRenderer.on('mcp-tool-call', (event, data) => {
        callback(data);
      });
    },
    onGetState: (callback) => {
      ipcRenderer.on('mcp-get-state', (event, data) => {
        callback(data);
      });
    }
  },

  // Track/playlist context menu operations
  contextMenu: {
    showTrackMenu: (data) => ipcRenderer.invoke('show-track-context-menu', data),
    onAction: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('track-context-menu-action', handler);
      return () => ipcRenderer.removeListener('track-context-menu-action', handler);
    }
  },

  // Playbar source context menu operations
  playbarSourceMenu: {
    show: (data) => ipcRenderer.invoke('show-playbar-source-context-menu', data),
    onAction: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('playbar-source-context-menu-action', handler);
      return () => ipcRenderer.removeListener('playbar-source-context-menu-action', handler);
    }
  },

  // Local Files operations
  localFiles: {
    addWatchFolder: () => ipcRenderer.invoke('localFiles:addWatchFolder'),
    removeWatchFolder: (path) => ipcRenderer.invoke('localFiles:removeWatchFolder', path),
    getWatchFolders: () => ipcRenderer.invoke('localFiles:getWatchFolders'),
    rescanAll: () => ipcRenderer.invoke('localFiles:rescanAll'),
    rescanFolder: (path) => ipcRenderer.invoke('localFiles:rescanFolder', path),
    getAllTracks: () => ipcRenderer.invoke('localFiles:getAllTracks'),
    getTracksByPaths: (filePaths) => ipcRenderer.invoke('localFiles:getTracksByPaths', filePaths),
    search: (query) => ipcRenderer.invoke('localFiles:search', query),
    searchAlbums: (query) => ipcRenderer.invoke('localFiles:searchAlbums', query),
    getAlbumTracks: (params) => ipcRenderer.invoke('localFiles:getAlbumTracks', params),
    resolve: (params) => ipcRenderer.invoke('localFiles:resolve', params),
    resolveArt: (track) => ipcRenderer.invoke('localFiles:resolveArt', track),
    getStreamInfo: (filePath) => ipcRenderer.invoke('localFiles:stream-info', filePath),
    fileStatus: (filePath) => ipcRenderer.invoke('localFiles:file-status', filePath),
    findMissing: () => ipcRenderer.invoke('localFiles:find-missing'),
    removeMissing: (filePaths) => ipcRenderer.invoke('localFiles:remove-missing', filePaths),
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

  // In-app announcements (banner notifications fetched from achordion.xyz)
  announcements: {
    refresh: () => ipcRenderer.invoke('announcements:refresh'),
    recordEvent: (id, event) => ipcRenderer.invoke('announcements:record-event', { id, event }),
    onUpdated: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('announcements:updated', handler);
      return () => ipcRenderer.removeListener('announcements:updated', handler);
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
    playlistStatus: (providerId, playlistExternalId) => ipcRenderer.invoke('sync:playlist-status', providerId, playlistExternalId),
    setPlaylistPublic: (providerId, playlistExternalId, isPublic) => ipcRenderer.invoke('sync:set-playlist-public', providerId, playlistExternalId, isPublic),
    pushPlaylist: (providerId, playlistExternalId, tracks, metadata) => ipcRenderer.invoke('sync:push-playlist', providerId, playlistExternalId, tracks, metadata),
    createPlaylist: (providerId, name, description, tracks, localPlaylistId = null) => ipcRenderer.invoke('sync:create-playlist', providerId, name, description, tracks, localPlaylistId),
    // Per-playlist Sync channel toggle (parachord#911). enabled=false + { deleteRemote }
    // optionally deletes the remote, then detaches the local mirror.
    setChannel: (localPlaylistId, providerId, enabled, opts = {}) => ipcRenderer.invoke('sync:set-channel', localPlaylistId, providerId, enabled, opts),
    resolveTracks: (providerId, tracks) => ipcRenderer.invoke('sync:resolve-tracks', providerId, tracks),
    cleanupDuplicatePlaylists: (providerId) => ipcRenderer.invoke('sync:cleanup-duplicate-playlists', providerId),
    relinkOrphanedPlaylists: (providerId) => ipcRenderer.invoke('sync:relink-orphaned-playlists', providerId),
    saveTracks: (providerId, trackIds) => ipcRenderer.invoke('sync:save-tracks', providerId, trackIds),
    saveAlbums: (providerId, albumIds) => ipcRenderer.invoke('sync:save-albums', providerId, albumIds),
    removeTracks: (providerId, trackIds) => ipcRenderer.invoke('sync:remove-tracks', providerId, trackIds),
    removeAlbums: (providerId, albumIds) => ipcRenderer.invoke('sync:remove-albums', providerId, albumIds),
    followArtists: (providerId, artistIds) => ipcRenderer.invoke('sync:follow-artists', providerId, artistIds),
    unfollowArtists: (providerId, artistIds) => ipcRenderer.invoke('sync:unfollow-artists', providerId, artistIds),
    onProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('sync:progress', handler);
      return () => ipcRenderer.removeListener('sync:progress', handler);
    }
  },

  // Durable local→remote playlist ID links (survives syncedTo loss)
  syncLinks: {
    getAll: () => ipcRenderer.invoke('sync-links:get-all'),
    set: (localPlaylistId, providerId, externalId) => ipcRenderer.invoke('sync-links:set', localPlaylistId, providerId, externalId),
    remove: (localPlaylistId, providerId) => ipcRenderer.invoke('sync-links:remove', localPlaylistId, providerId)
  },

  // Track-level tombstones (parachord#864) — durable "user removed
  // this on purpose" markers that prevent the next sync from re-adding
  // a track whose remote-remove failed silently (or for AM, was never
  // attempted). Keyed by (providerId, externalId).
  tombstones: {
    addBatch: (entries) => ipcRenderer.invoke('sync:tombstones:add-batch', entries),
    clearBatch: (entries) => ipcRenderer.invoke('sync:tombstones:clear-batch', entries),
    list: () => ipcRenderer.invoke('sync:tombstones:list')
  },

  // Bandcamp's hidden embed, driven from main (main-process/ipc/bandcamp-embed.js)
  bandcampEmbed: {
    prepare: (source) => ipcRenderer.invoke('bandcamp-embed:prepare', source),
    start: (args) => ipcRenderer.invoke('bandcamp-embed:start', args),
    command: (args) => ipcRenderer.invoke('bandcamp-embed:command', args),
    stop: (args) => ipcRenderer.invoke('bandcamp-embed:stop', args),
    onState: (callback) => {
      ipcRenderer.on('bandcamp-embed:state', (event, state) => callback(state));
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

  // Release notes - load parsed highlights from RELEASE_NOTES.md
  releaseNotes: {
    get: () => ipcRenderer.invoke('release-notes-get')
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
    // Clear native MusicKit auth state (invalidate cache, stop helper)
    unauthorize: () => ipcRenderer.invoke('musickit:unauthorize'),
    // Fetch a Music User Token for REST API access (requires native MusicKit + dev token)
    // opts.ignoreCache: mint a fresh one (after Apple refused the stored token)
    fetchUserToken: (opts) => ipcRenderer.invoke('musickit:fetch-user-token', opts && opts.ignoreCache ? { ignoreCache: true } : undefined),
    // Diagnostic: get token generation status for debugging auth issues
    tokenStatus: () => ipcRenderer.invoke('musickit:token-status'),
    // Search for songs
    search: (query, limit = 25) => ipcRenderer.invoke('musickit:search', query, limit),
    // Resolve a track by artist/title/album
    resolve: (artist, title, album = null) => ipcRenderer.invoke('musickit:resolve', artist, title, album),
    // Playback controls
    // startTime (seconds, optional): start there instead of 0:00 (a resumed track, #1319).
    play: (songId, startTime) => ipcRenderer.invoke('musickit:play', songId, startTime),
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
    setVolume: (volume) => ipcRenderer.invoke('musickit:set-volume', volume),

    // Main process polling controls (background-safe, for auto-advance)
    polling: {
      start: (params) => ipcRenderer.invoke('applemusic-polling-start', params),
      stop: () => ipcRenderer.invoke('applemusic-polling-stop'),
      updateTrack: (params) => ipcRenderer.invoke('applemusic-polling-update-track', params),
      getStatus: () => ipcRenderer.invoke('applemusic-polling-status'),

      // Listen for polling events from main process
      onAdvance: (callback) => {
        ipcRenderer.on('applemusic-polling-advance', (event, data) => {
          callback(data);
        });
      },
      onProgress: (callback) => {
        ipcRenderer.on('applemusic-polling-progress', (event, data) => {
          callback(data);
        });
      }
    },

    // Fired when the Apple Music refresh callback has determined the
    // stored user token is unrecoverable (same stale token returned, or
    // bridge error). Renderer should prompt the user to reconnect.
    onReauthRequired: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('applemusic:reauth-required', handler);
      return () => ipcRenderer.removeListener('applemusic:reauth-required', handler);
    },

    // Cider-style auth flow (parachord#834). Opens a dedicated BrowserWindow
    // pointing at beta.music.apple.com so the user signs in on Apple's real
    // origin (where cookies set normally — Electron's default-session
    // partitioning blocks the popup-from-custom-scheme path that MusicKit JS
    // wants to use). The main process harvests `music.ampwebplay.*` cookies
    // from the auth window's session on completion, then pushes them via
    // `applemusic:recv-cookies` to the renderer's listener below. The
    // renderer writes them to localStorage (where MusicKit JS reads them on
    // init) and reloads so the next boot starts already-authorized.
    openAuthWindow: () => ipcRenderer.invoke('applemusic:open-auth-window'),
    onAuthCookies: (callback) => {
      const handler = (event, cookies) => callback(cookies);
      ipcRenderer.on('applemusic:recv-cookies', handler);
      return () => ipcRenderer.removeListener('applemusic:recv-cookies', handler);
    }
  },

  // The resolver-neutral Widevine/DASH bridge. The renderer's shared player
  // (lib/widevine-player.js) asks a main-side provider for the manifest and
  // relays license bytes through it, or — for a resolver that implements the
  // plugin-mediated pair (#1356 M4; Amazon's DRM pair since M9) — takes the
  // plugin-supplied manifest and forwards licence challenges back to the
  // plugin. This is the ONLY surface a stream resolver needs beyond its
  // search/sign-in channels.
  //
  // The plugin-mediated half (#1356 M4): a resolver that implements
  // getPlaybackManifest supplies the manifest renderer-side and declares it
  // UP (openSession carries only its length — the text stays renderer-side),
  // and its relayLicense answers main's forwarded license challenges
  // (onPluginLicenseRequest) — main keeps the sender/session/cap gates
  // either way. The plugin's context never crosses IPC: the renderer-side
  // router holds it and hands it back to the plugin's relayLicense.
  widevine: {
    getManifest: (resolverId, entity) => ipcRenderer.invoke('widevine:manifest', { resolverId, entity }),
    relayLicense: (resolverId, challenge, sessionId) => ipcRenderer.invoke('widevine:license', { resolverId, challenge, sessionId }),
    playerEvent: (resolverId, event) => ipcRenderer.invoke('widevine:player-event', { resolverId, event }),
    openSession: (resolverId, manifestLength, type, drm) =>
      ipcRenderer.invoke('widevine:open-session', { resolverId, manifestLength, type, drm }),
    // A plugin-mediated session's license challenges arrive here, one push
    // per relay. The callback gets { requestId, resolverId, sessionId,
    // challenge } and returns the license (base64) — no context rides the
    // push (the caller holds the plugin's context renderer-side). A thrown
    // error's fields (reason/licenseDenied/denialReason/message) answer in
    // the same shape a provider relayLicense rejection produces. The wrapper
    // ALWAYS answers — main's relay timeout is the net for a callback that
    // never settles.
    //
    // SINGLE-OWNER (#1434 review): the player registers this exactly once
    // (ensurePluginRelayRouter in lib/widevine-player.js), and main takes
    // the FIRST answer for a requestId — so a second subscriber that raced
    // its own answer ahead of the router would decide the play. The first
    // call wins; every later call gets a warning and a no-op unsubscribe
    // (a second registration is the caller's bug, not a supported relay).
    // Ownership is released when the owner unsubscribes, so a re-register
    // after a teardown is still possible.
    onPluginLicenseRequest: (callback) => {
      if (__pluginLicenseRelayUnsubscribe) {
        console.warn('widevine.onPluginLicenseRequest: a plugin license relay is already registered; ignoring the second registration');
        // null, not a no-op function: the caller can tell it was refused.
        return null;
      }
      const handler = (_event, request) => {
        if (!request || typeof request.requestId !== 'string') return;
        Promise.resolve()
          .then(() => callback(request))
          .then((license) => ipcRenderer.invoke('widevine:plugin-license-answer', { requestId: request.requestId, ok: true, license }))
          .catch((error) => ipcRenderer.invoke('widevine:plugin-license-answer', {
            requestId: request.requestId,
            ok: false,
            error: {
              message: String((error && (error.message || error)) || 'plugin license relay failed'),
              reason: (error && error.reason) || undefined,
              licenseDenied: !!(error && error.licenseDenied),
              denialReason: (error && typeof error.denialReason === 'string') ? error.denialReason : null
            }
          }))
          .catch(() => { /* the answer is best-effort; main's timeout is the net */ });
      };
      ipcRenderer.on('widevine:plugin-license', handler);
      const unsubscribe = () => {
        ipcRenderer.removeListener('widevine:plugin-license', handler);
        if (__pluginLicenseRelayUnsubscribe === unsubscribe) __pluginLicenseRelayUnsubscribe = null;
      };
      __pluginLicenseRelayUnsubscribe = unsubscribe;
      return unsubscribe;
    }
  },

  // The generic web-session bridge (#1356): a registered web-session host's
  // primitives over IPC, named per session (Amazon's is 'amazon-music').
  // Thin invoke wrappers for load/pageFetch/fetch/state/clear — payload and
  // error contract in docs/architecture/web-session.md, "The IPC bridge".
  // signIn keeps the host's shape: the wrapper runs the plugin's decide() on
  // every forwarded tick, answers with the verdict, and resolves from the
  // settled event (the host promise settles on the main side).
  //
  // LIVE since the track-search move (#1356 M5 — the bridge's first
  // consumer, the #1432 review's note-8 option: the layer that first drives
  // the bridge turns the surface on together with the session registration
  // in main.js).
  webSession: {
    load: (id, url, opts) => ipcRenderer.invoke('webSession:load', { id, url, opts }),
    pageFetch: (id, request) => ipcRenderer.invoke('webSession:pageFetch', { id, request }),
    fetch: (id, request) => ipcRenderer.invoke('webSession:fetch', { id, request }),
    state: (id) => ipcRenderer.invoke('webSession:state', { id }),
    clear: (id) => ipcRenderer.invoke('webSession:clear', { id }),
    // signIn(id, url, { decide, window }) → { success, signedIn }:
    // decide({ url, cookieNames, stableTicks }) is the plugin's pure verdict,
    // called once per tick; window is { width, height } for the visible
    // sign-in window — the window's TITLE is host config (#1432 review,
    // finding 3), never a caller choice. The promise always resolves:
    // settled { signedIn } on success, { success: false, reason, error } when
    // the invoke itself is refused (an unknown session, a gated sender).
    signIn: (id, url, opts = {}) => new Promise((resolve) => {
      let callId = null;   // set when the invoke's reply lands
      let stopped = false; // the promise settled: no listener or flush may act again
      // The race this buffers around: the bridge can settle a run BEFORE the
      // invoke's reply names our callId (a synchronous host.signIn throw
      // settles inside the handler, and the settled event can reach us ahead
      // of the reply). A callId filter alone would drop that settle and wedge
      // the promise forever — so while the invoke is outstanding, tick and
      // settled payloads are buffered, keyed by their own payload callIds:
      // when the reply lands, a buffered settle for OUR callId resolves the
      // promise, buffered ticks for our callId run their decide late (in
      // order), and payloads for any other callId (another window's concurrent
      // call) are discarded harmlessly. The refused-invoke paths never see a
      // callId: the buffers die with the failure.
      const earlySettled = [];
      const earlyTicks = [];
      const decide = typeof opts.decide === 'function' ? opts.decide : () => false;
      const stop = () => {
        if (stopped) return; // the listeners come off exactly once per call
        stopped = true;
        ipcRenderer.removeListener('webSession:sign-in-tick', onTick);
        ipcRenderer.removeListener('webSession:sign-in-settled', onSettled);
      };
      const runTick = (tick) => {
        // The plugin's decide sees the host's tick shape — the callId is the
        // protocol's routing key, not plugin input.
        const { callId: _callId, ...facts } = tick;
        let verdict = false;
        // A throwing decide is the plugin's bug, not a failed sign-in — the
        // host ignores one too (web-session.js ticks on).
        try { verdict = !!decide(facts); } catch { verdict = false; }
        ipcRenderer.invoke('webSession:sign-in-decide', { callId: tick.callId, verdict }).catch(() => {});
      };
      const settle = (settled) => {
        stop();
        resolve({ success: true, signedIn: !!settled.signedIn, ...(settled.error ? { error: settled.error } : {}) });
      };
      const onTick = (_event, tick) => {
        if (stopped || !tick || typeof tick.callId !== 'string') return;
        if (callId === null) { earlyTicks.push(tick); return; } // pre-reply: buffered, flushed when the reply names our callId
        if (tick.callId !== callId) return;
        runTick(tick);
      };
      const onSettled = (_event, settled) => {
        if (stopped || !settled || typeof settled.callId !== 'string') return;
        if (callId === null) { earlySettled.push(settled); return; } // pre-reply: buffered, resolved when the reply names our callId
        if (settled.callId !== callId) return;
        settle(settled);
      };
      // Subscribed before the invoke so no event of the run is MISSED; what
      // protects an event that beats the reply is the buffer above, not this
      // order — subscription order alone would leave the settle dropped by
      // the callId filter.
      ipcRenderer.on('webSession:sign-in-tick', onTick);
      ipcRenderer.on('webSession:sign-in-settled', onSettled);
      ipcRenderer.invoke('webSession:signIn', {
        id,
        url,
        // { width, height } only — the title is host config (finding 3).
        window: opts.window && typeof opts.window === 'object'
          ? { width: opts.window.width, height: opts.window.height }
          : undefined
      }).then((reply) => {
        if (stopped) return;
        if (!reply || !reply.success) {
          stop();
          resolve({ success: false, reason: reply && reply.reason, error: reply && reply.error });
          return;
        }
        callId = reply.callId;
        // A settle that raced the reply (the synchronous host throw) resolves
        // now; ticks that raced it run their decide late, in order — the
        // verdict's answer is one tick late exactly like every other one.
        const raced = earlySettled.find((s) => s.callId === callId);
        if (raced) { settle(raced); return; }
        for (const tick of earlyTicks) if (tick.callId === callId) runTick(tick);
      }, (error) => {
        if (stopped) return;
        stop();
        resolve({ success: false, error: String((error && (error.message || error)) || error) });
      });
    })
  },

  // Ollama operations (local AI)
  ollama: {
    start: () => ipcRenderer.invoke('ollama:start'),
    check: () => ipcRenderer.invoke('ollama:check')
  },

  // System volume monitoring (macOS)
  system: {
    onVolumeChanged: (callback) => {
      ipcRenderer.on('system-volume-changed', (event, data) => {
        callback(data);
      });
    }
  },

  // The window's size (main-process/ui-zoom.js): 0.9 to 1.5. onChanged
  // fires for Settings and the View menu's Zoom In / Out / Actual Size.
  ui: {
    getZoom: () => ipcRenderer.invoke('ui-zoom:get'),
    setZoom: (zoom) => ipcRenderer.invoke('ui-zoom:set', zoom),
    onZoomChanged: (callback) => {
      const handler = (event, zoom) => callback(zoom);
      ipcRenderer.on('ui-zoom-changed', handler);
      return () => ipcRenderer.removeListener('ui-zoom-changed', handler);
    }
  },

  // Theme management
  theme: {
    initial: __initialTheme,
    getSystem: () => ipcRenderer.invoke('theme-get-system'),
    setNative: (mode) => ipcRenderer.invoke('theme-set-native', mode),
    onChanged: (callback) => {
      const handler = (event, theme) => callback(theme);
      ipcRenderer.on('theme-changed', handler);
      return () => ipcRenderer.removeListener('theme-changed', handler);
    }
  },

  // Generic invoke removed for security — use specific API methods above
});

// What host bridges this app supplies (#1355): a plugin declares
// "requires": { "hostBridges": [...] } and the plugin loader hides it when
// this host doesn't carry every one (docs/architecture/plugins.md, "Required
// host bridges"). Keep the list in step with the window.electron blocks
// above — a bridge missing from this list is a bridge no plugin can require.
// webSession is advertised since the track-search move (#1356 M5, the
// bridge's first consumer — the advertisement moves WITH the wrapper).
// (contextBridge is how a sandboxed preload reaches the page world — a bare
// window assignment here stays preload-side.)
const HOST_BRIDGES = ['webSession'];
contextBridge.exposeInMainWorld('__parachordHostBridges', HOST_BRIDGES);
