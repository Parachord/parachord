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
    this.initPromise = null;
  }

  async init() {
    if (this.initialized) return this;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
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
    })();

    return this.initPromise;
  }

  // Wait for initialization to complete (for use in IPC handlers)
  async waitForInit() {
    if (this.initialized) return this;
    if (this.initPromise) return this.initPromise;
    // If init hasn't been called yet, call it
    return this.init();
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

    // Notify renderer that library has changed
    if (this.watcher?.onLibraryChanged) {
      console.log(`[LocalFiles] Watch folder removed, notifying renderer`);
      this.watcher.onLibraryChanged([{ action: 'folder-removed', folder: folderPath }]);
    }

    return { success: true };
  }

  getWatchFolders() {
    return this.db.getWatchFolders();
  }

  // Scanning
  async scanFolder(folderPath, onProgress) {
    const result = await this.scanner.scanFolder(folderPath, onProgress);

    // Notify renderer that library has changed after scan completes
    if (result && (result.added > 0 || result.updated > 0) && this.watcher?.onLibraryChanged) {
      console.log(`[LocalFiles] Scan complete, notifying renderer of ${result.added} added, ${result.updated} updated tracks`);
      this.watcher.onLibraryChanged([{ action: 'scan-complete', folder: folderPath, ...result }]);
    }

    return result;
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

    // Notify renderer that library has changed after all scans complete
    const totalAdded = results.reduce((sum, r) => sum + (r.added || 0), 0);
    const totalUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0);
    if ((totalAdded > 0 || totalUpdated > 0) && this.watcher?.onLibraryChanged) {
      console.log(`[LocalFiles] Rescan complete, notifying renderer of ${totalAdded} added, ${totalUpdated} updated tracks`);
      this.watcher.onLibraryChanged([{ action: 'rescan-complete', results }]);
    }

    return results;
  }

  // Querying (used by resolver via IPC)
  search(query) {
    const dbResults = this.db.search(query);
    return dbResults.map(track => this.formatTrackForRenderer(track));
  }

  async resolve({ artist, track, album }) {
    console.log(`[LocalFiles] Resolving: artist="${artist}", track="${track}", album="${album}"`);
    const dbResults = this.db.resolve(artist, track, album);
    console.log(`[LocalFiles] Found ${dbResults.length} result(s)`);

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

  async saveId3Tags(filePath, tags) {
    console.log(`[LocalFiles] Saving ID3 tags for: ${filePath}`);
    console.log(`[LocalFiles] Tags:`, tags);

    try {
      const NodeID3 = require('node-id3');
      const fs = require('fs');
      const https = require('https');
      const http = require('http');

      // Verify file exists
      if (!fs.existsSync(filePath)) {
        console.error(`[LocalFiles] File not found: ${filePath}`);
        return { success: false, error: 'File not found' };
      }

      // Check if it's an MP3 file (node-id3 only works with MP3)
      const ext = filePath.toLowerCase().split('.').pop();
      if (ext !== 'mp3') {
        console.log(`[LocalFiles] File is ${ext}, not MP3 - only updating database`);
        // For non-MP3 files, just update the database
        this.db.updateTrackMetadata(filePath, tags);

        // Notify of library change
        if (this.watcher?.onLibraryChanged) {
          this.watcher.onLibraryChanged({
            type: 'update',
            filePath,
            tags
          });
        }

        return { success: true, warning: 'ID3 tags only supported for MP3 files. Database updated.' };
      }

      // Build tag object for node-id3
      const id3Tags = {};
      if (tags.title) id3Tags.title = tags.title;
      if (tags.artist) id3Tags.artist = tags.artist;
      if (tags.album) id3Tags.album = tags.album;
      if (tags.trackNumber) id3Tags.trackNumber = String(tags.trackNumber);
      if (tags.year) id3Tags.year = String(tags.year);

      // Handle album art if provided
      if (tags.albumArtUrl) {
        console.log(`[LocalFiles] Downloading album art from: ${tags.albumArtUrl}`);
        try {
          const imageBuffer = await this.downloadImage(tags.albumArtUrl);
          if (imageBuffer) {
            // Determine MIME type from URL or default to JPEG
            let mime = 'image/jpeg';
            if (tags.albumArtUrl.toLowerCase().includes('.png')) {
              mime = 'image/png';
            }

            id3Tags.image = {
              mime: mime,
              type: { id: 3, name: 'Front cover' },
              description: 'Album Art',
              imageBuffer: imageBuffer
            };
            console.log(`[LocalFiles] Album art downloaded, size: ${imageBuffer.length} bytes`);
          }
        } catch (artError) {
          console.error(`[LocalFiles] Failed to download album art:`, artError);
          // Continue without album art - don't fail the entire save
        }
      }

      console.log(`[LocalFiles] Writing ID3 tags:`, Object.keys(id3Tags));

      // Use update to preserve existing tags (like album art if not replacing)
      const result = NodeID3.update(id3Tags, filePath);

      console.log(`[LocalFiles] NodeID3.update result:`, result);

      // NodeID3.update returns true on success, or an error object on failure
      if (result === true) {
        // Update database record
        this.db.updateTrackMetadata(filePath, tags);

        // Update has_embedded_art flag if we added album art
        if (tags.albumArtUrl) {
          this.db.updateTrackHasEmbeddedArt(filePath, true);
        }

        // Notify of library change
        if (this.watcher?.onLibraryChanged) {
          this.watcher.onLibraryChanged({
            type: 'update',
            filePath,
            tags
          });
        }

        console.log(`[LocalFiles] ID3 tags saved successfully`);
        return { success: true };
      } else {
        const errorMsg = result?.message || 'Failed to write tags to file';
        console.error(`[LocalFiles] Failed to write ID3 tags:`, errorMsg);
        return { success: false, error: errorMsg };
      }
    } catch (error) {
      console.error(`[LocalFiles] Error saving ID3 tags:`, error);
      return { success: false, error: error.message };
    }
  }

  // Helper to download image from URL
  async downloadImage(url) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? require('https') : require('http');

      const request = protocol.get(url, (response) => {
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`[LocalFiles] Following redirect to: ${response.headers.location}`);
          this.downloadImage(response.headers.location).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const buffer = Buffer.concat(chunks);
          resolve(buffer);
        });
        response.on('error', reject);
      });

      request.on('error', reject);
      request.setTimeout(30000, () => {
        request.destroy();
        reject(new Error('Download timeout'));
      });
    });
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
