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
    }
  },

  // Shell operations - use IPC for better security
  shell: {
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url)
  },

  // Proxy fetch - bypasses CORS for resolvers
  proxyFetch: (url, options) => ipcRenderer.invoke('proxy-fetch', url, options),

  // Media key handlers
  onMediaKey: (callback) => {
    ipcRenderer.on('media-key', (event, action) => {
      callback(action);
    });
  },

  // Resolver operations
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
    getMarketplaceManifest: () => ipcRenderer.invoke('marketplace-get-manifest'),
    downloadResolver: (url) => ipcRenderer.invoke('marketplace-download-resolver', url)
  },

  // Playlist operations
  playlists: {
    load: () => ipcRenderer.invoke('playlists-load'),
    import: () => ipcRenderer.invoke('playlists-import'),
    save: (filename, xspfContent) => ipcRenderer.invoke('playlists-save', filename, xspfContent),
    export: (defaultFilename, xspfContent) => ipcRenderer.invoke('playlists-export', defaultFilename, xspfContent)
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

  // Track/playlist context menu operations
  contextMenu: {
    showTrackMenu: (data) => ipcRenderer.invoke('show-track-context-menu', data),
    onAction: (callback) => {
      ipcRenderer.on('track-context-menu-action', (event, data) => {
        callback(data);
      });
    }
  },

  // Playback window operations (for Bandcamp, etc. with autoplay)
  playbackWindow: {
    open: (url, options) => ipcRenderer.invoke('open-playback-window', url, options),
    close: () => ipcRenderer.invoke('close-playback-window'),
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

  // Config - expose select environment variables to renderer
  config: {
    get: (key) => ipcRenderer.invoke('config-get', key)
  }
});
