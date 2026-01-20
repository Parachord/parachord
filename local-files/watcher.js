const chokidar = require('chokidar');
const MetadataReader = require('./metadata-reader');

class FileWatcher {
  constructor(db, scanner) {
    this.db = db;
    this.scanner = scanner;
    this.watchers = new Map(); // folderPath -> chokidar instance
    this.pollInterval = null;
    this.isForeground = true;
    this.pendingChanges = [];
    this.debounceTimer = null;
    this.onLibraryChanged = null; // Callback for notifying renderer
  }

  async startWatching() {
    const folders = this.db.getWatchFolders();
    for (const folder of folders) {
      if (folder.enabled) {
        this.watchFolder(folder.path);
      }
    }
  }

  watchFolder(folderPath) {
    if (this.watchers.has(folderPath)) {
      console.log(`[LocalFiles] Already watching: ${folderPath}`);
      return;
    }

    console.log(`[LocalFiles] Starting watch on: ${folderPath}`);

    const watcher = chokidar.watch(folderPath, {
      ignored: /(^|[\/\\])\../, // Ignore dotfiles
      persistent: true,
      ignoreInitial: true, // Don't fire for existing files
      awaitWriteFinish: {
        stabilityThreshold: 2000,
        pollInterval: 100
      },
      depth: 99 // Recursive
    });

    watcher.on('add', (path) => {
      if (MetadataReader.isSupported(path)) {
        this.queueChange('add', path);
      }
    });

    watcher.on('change', (path) => {
      if (MetadataReader.isSupported(path)) {
        this.queueChange('change', path);
      }
    });

    watcher.on('unlink', (path) => {
      if (MetadataReader.isSupported(path)) {
        this.queueChange('unlink', path);
      }
    });

    watcher.on('error', (error) => {
      console.error(`[LocalFiles] Watcher error for ${folderPath}:`, error);
    });

    this.watchers.set(folderPath, watcher);
  }

  unwatchFolder(folderPath) {
    const watcher = this.watchers.get(folderPath);
    if (watcher) {
      console.log(`[LocalFiles] Stopping watch on: ${folderPath}`);
      watcher.close();
      this.watchers.delete(folderPath);
    }
  }

  queueChange(type, filePath) {
    console.log(`[LocalFiles] Queued ${type}: ${filePath}`);
    this.pendingChanges.push({ type, filePath, time: Date.now() });
    this.scheduleProcessing();
  }

  scheduleProcessing() {
    // Debounce: wait 2 seconds of quiet before processing
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.processPendingChanges();
    }, 2000);
  }

  async processPendingChanges() {
    if (this.pendingChanges.length === 0) return;

    const changes = [...this.pendingChanges];
    this.pendingChanges = [];

    console.log(`[LocalFiles] Processing ${changes.length} file changes`);

    const results = [];
    for (const change of changes) {
      try {
        const result = await this.scanner.processFileChange(change.filePath, change.type);
        if (result) results.push(result);
      } catch (error) {
        console.error(`[LocalFiles] Error processing change:`, error);
      }
    }

    // Notify renderer of library changes
    if (results.length > 0 && this.onLibraryChanged) {
      this.onLibraryChanged(results);
    }
  }

  // Called when app goes to background
  onAppBackground() {
    if (!this.isForeground) return;

    console.log('[LocalFiles] App backgrounded, switching to polling mode');
    this.isForeground = false;

    // Stop real-time watchers
    for (const [folderPath, watcher] of this.watchers) {
      watcher.close();
    }
    this.watchers.clear();

    // Start polling every 5 minutes
    this.pollInterval = setInterval(() => {
      this.pollForChanges();
    }, 5 * 60 * 1000);
  }

  // Called when app comes to foreground
  onAppForeground() {
    if (this.isForeground) return;

    console.log('[LocalFiles] App foregrounded, switching to real-time watching');
    this.isForeground = true;

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Restart real-time watchers
    this.startWatching();
  }

  async pollForChanges() {
    console.log('[LocalFiles] Polling for changes...');

    const folders = this.db.getWatchFolders();
    for (const folder of folders) {
      if (folder.enabled) {
        // Do a quick scan to detect changes
        await this.scanner.scanFolder(folder.path);
      }
    }

    if (this.onLibraryChanged) {
      this.onLibraryChanged([{ action: 'poll-complete' }]);
    }
  }

  async stopAll() {
    // Stop debounce timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    // Stop polling
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    // Stop all watchers
    for (const [_, watcher] of this.watchers) {
      await watcher.close();
    }
    this.watchers.clear();
  }
}

module.exports = FileWatcher;
