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
    showContextMenu: (resolverId, isUserInstalled) => ipcRenderer.invoke('resolvers-show-context-menu', resolverId, isUserInstalled),
    onContextMenuAction: (callback) => {
      ipcRenderer.on('resolver-context-menu-action', (event, data) => {
        callback(data);
      });
    }
  },

  // Playlist operations
  playlists: {
    load: () => ipcRenderer.invoke('playlists-load'),
    import: () => ipcRenderer.invoke('playlists-import'),
    save: (filename, xspfContent) => ipcRenderer.invoke('playlists-save', filename, xspfContent),
    export: (defaultFilename, xspfContent) => ipcRenderer.invoke('playlists-export', defaultFilename, xspfContent)
  }
});
