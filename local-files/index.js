const path = require('path');
const LocalFilesDatabase = require('./database');
const FileScanner = require('./scanner');
const FileWatcher = require('./watcher');
const AlbumArtResolver = require('./album-art');

class LocalFilesService {
  constructor(userDataPath) {
    this.userDataPath = userDataPath;
    this.db = new LocalFilesDatabase(userDataPath);
    this.scanner = null;
    this.watcher = null;
    this.albumArt = null;
    this.initialized = false;
  }

  async init() {
    if (this.initialized) return this;

    console.log('[LocalFiles] Initializing service...');

    // Initialize database
    this.db.init();

    // Initialize scanner
    this.scanner = new FileScanner(this.db);

    // Initialize watcher
    this.watcher = new FileWatcher(this.db, this.scanner);

    // Initialize album art resolver
    const artCacheDir = path.join(this.userDataPath, 'album-art-cache');
    this.albumArt = new AlbumArtResolver(this.db, artCacheDir);

    // Start watching configured folders
    await this.watcher.startWatching();

    this.initialized = true;
    console.log('[LocalFiles] Service initialized');

    return this;
  }

  // Watch folder management
  async addWatchFolder(folderPath) {
    console.log(`[LocalFiles] Adding watch folder: ${folderPath}`);
    this.db.addWatchFolder(folderPath);

    // Start watching immediately
    this.watcher.watchFolder(folderPath);

    // Trigger initial scan
    return this.scanFolder(folderPath);
  }

  async removeWatchFolder(folderPath) {
    console.log(`[LocalFiles] Removing watch folder: ${folderPath}`);

    // Stop watching
    this.watcher.unwatchFolder(folderPath);

    // Remove from database (also removes tracks)
    this.db.removeWatchFolder(folderPath);

    return { success: true };
  }

  getWatchFolders() {
    return this.db.getWatchFolders();
  }

  // Scanning
  async scanFolder(folderPath, onProgress) {
    return this.scanner.scanFolder(folderPath, onProgress);
  }

  async rescanAll(onProgress) {
    const folders = this.db.getWatchFolders();
    const results = [];

    for (const folder of folders) {
      if (folder.enabled) {
        const result = await this.scanner.scanFolder(folder.path, onProgress);
        results.push({ folder: folder.path, ...result });
      }
    }

    return results;
  }

  // Querying (used by resolver via IPC)
  search(query) {
    const dbResults = this.db.search(query);
    return dbResults.map(track => this.formatTrackForRenderer(track));
  }

  async resolve({ artist, track, album }) {
    const dbResults = this.db.resolve(artist, track, album);

    if (dbResults.length === 0) return null;

    // Return the best match with resolved album art
    const results = [];
    for (const dbTrack of dbResults) {
      const formatted = await this.formatTrackForRendererWithArt(dbTrack);
      formatted.confidence = dbTrack.confidence;
      results.push(formatted);
    }

    return results;
  }

  getTrackByPath(filePath) {
    const track = this.db.getTrackByPath(filePath);
    return track ? this.formatTrackForRenderer(track) : null;
  }

  // Stats
  getStats() {
    return this.db.getStats();
  }

  // Format track for renderer
  formatTrackForRenderer(track) {
    return {
      id: `local-${track.id}`,
      title: track.title,
      artist: track.artist,
      album: track.album,
      albumArtist: track.album_artist,
      trackNumber: track.track_number,
      discNumber: track.disc_number,
      year: track.year,
      genre: track.genre,
      duration: track.duration,
      format: track.format,
      bitrate: track.bitrate,
      filePath: track.file_path,
      hasEmbeddedArt: !!track.has_embedded_art,
      folderArtPath: track.folder_art_path,
      sources: {
        localfiles: {
          filePath: track.file_path,
          fileUrl: `file://${track.file_path}`,
          confidence: track.confidence || 1.0,
          duration: track.duration
        }
      }
    };
  }

  async formatTrackForRendererWithArt(track) {
    const formatted = this.formatTrackForRenderer(track);
    formatted.albumArt = await this.albumArt.resolveArt(track);
    return formatted;
  }

  // Lifecycle
  setLibraryChangedCallback(callback) {
    if (this.watcher) {
      this.watcher.onLibraryChanged = callback;
    }
  }

  onAppForeground() {
    if (this.watcher) {
      this.watcher.onAppForeground();
    }
  }

  onAppBackground() {
    if (this.watcher) {
      this.watcher.onAppBackground();
    }
  }

  async shutdown() {
    console.log('[LocalFiles] Shutting down...');

    if (this.watcher) {
      await this.watcher.stopAll();
    }

    if (this.db) {
      this.db.close();
    }

    this.initialized = false;
  }
}

module.exports = LocalFilesService;
