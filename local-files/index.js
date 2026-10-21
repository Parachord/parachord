const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const LocalFilesDatabase = require('./database');
const FileScanner = require('./scanner');
const FileWatcher = require('./watcher');
const AlbumArtResolver = require('./album-art');
const MetadataReader = require('./metadata-reader');
const { findMissingFiles, removeMissingFiles } = require('./missing-files');

// 'present' | 'missing' | 'unknown'. Only a definite ENOENT/ENOTDIR is
// missing; a permission error or a stalled network mount is unknown.
async function pathStatus(filePath) {
  try {
    await fs.promises.access(filePath);
    return 'present';
  } catch (err) {
    return err && (err.code === 'ENOENT' || err.code === 'ENOTDIR') ? 'missing' : 'unknown';
  }
}

async function folderReadable(folderPath) {
  try {
    const stats = await fs.promises.stat(folderPath);
    if (!stats.isDirectory()) return false;
    await fs.promises.readdir(folderPath);
    return true;
  } catch {
    return false;
  }
}

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
    if (result && (result.added > 0 || result.updated > 0 || result.removed > 0) && this.watcher?.onLibraryChanged) {
      console.log(`[LocalFiles] Scan complete, notifying renderer of ${result.added} added, ${result.updated} updated, ${result.removed || 0} removed tracks`);
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
    const totalRemoved = results.reduce((sum, r) => sum + (r.removed || 0), 0);
    if ((totalAdded > 0 || totalUpdated > 0 || totalRemoved > 0) && this.watcher?.onLibraryChanged) {
      console.log(`[LocalFiles] Rescan complete, notifying renderer of ${totalAdded} added, ${totalUpdated} updated, ${totalRemoved} removed tracks`);
      this.watcher.onLibraryChanged([{ action: 'rescan-complete', results }]);
    }

    return results;
  }

  // Return all indexed tracks (used to populate the Library view)
  getAllTracks() {
    const dbResults = this.db.getAllTracks();
    const artIndex = this.buildArtIndex();
    return dbResults.map(track => this.formatTrackForRenderer(track, artIndex));
  }

  // One library load used to make 2-3 synchronous fs.existsSync calls per
  // track to find album art (#784): 300k+ blocking syscalls in the main
  // process for a 150k-track library, on every reload, stalling every IPC
  // meanwhile. This index answers the same questions with one readdir of the
  // art cache (the embedded-*/caa-* files) and one memoized check per OTHER
  // path, so a folder's cover.jpg is checked once for the whole folder
  // instead of once per track. Built per call: it only has to be right for
  // the duration of one load. Measured on a local SSD, 150k tracks: 915 ms
  // of blocking checks down to 387 ms (the rest is the per-track md5);
  // on a network or external drive the per-folder memo matters far more.
  buildArtIndex() {
    const cacheDir = this.albumArt && this.albumArt.cacheDir;
    let cacheFiles = null;
    if (cacheDir) {
      try {
        cacheFiles = new Set(fs.readdirSync(cacheDir));
      } catch {
        cacheFiles = null; // fall back to per-file checks
      }
    }
    const memo = new Map();
    return {
      exists(filePath) {
        if (cacheFiles && path.dirname(filePath) === cacheDir) {
          return cacheFiles.has(path.basename(filePath));
        }
        if (memo.has(filePath)) return memo.get(filePath);
        const found = fs.existsSync(filePath);
        memo.set(filePath, found);
        return found;
      },
    };
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

  // Is a library file still on disk? (parachord#1002) Used when local
  // playback fails, to tell "the file is gone" from "the file won't decode".
  // Answers only for paths the library knows ('unknown' otherwise), so the
  // renderer cannot probe arbitrary paths. Never deletes the row: a whole
  // volume going away looks the same as a deleted file from here, and the
  // scanner's empty-folder guard exists to keep exactly that from wiping
  // the library.
  async fileStatus(filePath) {
    if (!filePath || typeof filePath !== 'string') return 'unknown';
    if (!this.db.getTrackByPath(filePath)) return 'unknown';
    return pathStatus(filePath);
  }

  // Library rows whose file is gone, for "Remove missing files" (#1002).
  // Read-only: the renderer shows the count and asks before anything is
  // deleted. Watch folders whose root cannot be read are skipped and
  // reported, so an unmounted drive never reads as "all missing".
  async findMissingFiles() {
    return findMissingFiles({
      folders: this.db.getWatchFolders().map((f) => f.path),
      filePaths: this.db.getAllFilePaths(),
      folderReadable,
      fileStatus: pathStatus,
    });
  }

  // Deletes the rows for the given paths that are still missing (each one is
  // re-checked), then tells the renderer the library changed.
  async removeMissingFiles(filePaths) {
    const result = await removeMissingFiles({
      filePaths: Array.isArray(filePaths) ? filePaths : [],
      folders: this.db.getWatchFolders().map((f) => f.path),
      isKnown: (p) => !!this.db.getTrackByPath(p),
      folderReadable,
      fileStatus: pathStatus,
      removeTrack: (p) => this.db.removeTrack(p),
    });
    if (result.removed.length > 0) {
      if (this.watcher?.onLibraryChanged) {
        this.watcher.onLibraryChanged([{ action: 'missing-removed', count: result.removed.length }]);
      }
    }
    return { removed: result.removed.length, kept: result.kept.length };
  }

  // Stats
  getStats() {
    return this.db.getStats();
  }

  // Format track for renderer. `artIndex` (from buildArtIndex) batches the
  // art existence checks for a whole-library load; single-track callers
  // omit it and check directly.
  formatTrackForRenderer(track, artIndex = null) {
    const exists = artIndex ? (p) => artIndex.exists(p) : (p) => fs.existsSync(p);
    const formatted = {
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
          duration: track.duration,
          isrc: track.isrc || null
        }
      }
    };
    // Sync warm-cache fast-path for album art (issue #786). Only checks
    // already-extracted/already-existing files: no I/O beyond existence
    // checks, which a whole-library load batches through buildArtIndex. Cold cache (track has embedded art
    // but cache hasn't been populated yet) returns no albumArt here; the
    // renderer's lazy background extraction kicks in to warm the cache so
    // subsequent loads pick it up. See LocalFilesService.resolveArtForTrack
    // for the on-demand IPC entry point.
    //
    // Three tiers, matching the first three tiers of the async resolveArt()
    // resolver in album-art.js. Tier 4 (Cover Art Archive fetch) is async
    // and intentionally skipped — that happens during play-time resolve().
    if (track.folder_art_path && exists(track.folder_art_path)) {
      formatted.albumArt = `file://${track.folder_art_path}`;
    } else if (track.has_embedded_art && this.albumArt) {
      const hash = crypto.createHash('md5').update(track.file_path).digest('hex');
      const jpg = path.join(this.albumArt.cacheDir, `embedded-${hash}.jpg`);
      const png = path.join(this.albumArt.cacheDir, `embedded-${hash}.png`);
      if (exists(jpg)) formatted.albumArt = `file://${jpg}`;
      else if (exists(png)) formatted.albumArt = `file://${png}`;
    }
    // Tier 3: MusicBrainz / Cover Art Archive art written to the DB by a
    // prior play-time resolveArt() (fetchFromCoverArtArchive caches the
    // image to disk and persists the `file://` URL in musicbrainz_art_url).
    // Only used when tiers 1+2 didn't hit, since folder/embedded art is
    // closer to the user's actual file. The existsSync guard handles the
    // case where cleanCache() pruned the file but left the stale DB row.
    if (!formatted.albumArt && track.musicbrainz_art_url) {
      const stored = track.musicbrainz_art_url;
      if (stored.startsWith('file://')) {
        if (exists(stored.slice('file://'.length))) {
          formatted.albumArt = stored;
        }
      } else {
        // Non-file URL (e.g. legacy direct CAA URL) — pass through; the
        // renderer's <img> tag will request it directly.
        formatted.albumArt = stored;
      }
    }
    return formatted;
  }

  // On-demand art resolution. Used by the renderer's lazy background
  // extraction loop to warm the cache for tracks that don't have a cached
  // extraction yet (typical for fresh installs). Routes through the existing
  // 5-tier resolver (embedded → folder → MB cache → CAA → null), which
  // extracts and writes to cache as a side effect.
  async resolveArtForTrack(track) {
    if (!this.albumArt) return null;
    try {
      return await this.albumArt.resolveArt(track);
    } catch (err) {
      console.warn('[LocalFiles] resolveArtForTrack failed:', err && err.message ? err.message : err);
      return null;
    }
  }

  // Stream info for the playing file (stream-quality.js contract) — parsed at
  // play time, not scan time, so no DB columns and no backfill window for
  // files indexed before the feature existed. Cached per (path, mtime):
  // replays and scrubbing are free, a changed file re-parses.
  // See MetadataReader.getStreamInfo for the shape/normalization notes.
  async getStreamInfo(filePath) {
    if (!filePath || typeof filePath !== 'string') return null;
    try {
      // Async stat: this runs in the main process on every track start, and a
      // sync stat on an SMB/NFS mount blocks the whole main process.
      const stats = await fs.promises.stat(filePath);
      const cached = this._streamInfoCache && this._streamInfoCache.get(filePath);
      if (cached && cached.mtimeMs === stats.mtimeMs) return cached.info;
      const info = await MetadataReader.getStreamInfo(filePath);
      if (!this._streamInfoCache) this._streamInfoCache = new Map();
      if (this._streamInfoCache.size > 500) this._streamInfoCache.clear();
      this._streamInfoCache.set(filePath, { mtimeMs: stats.mtimeMs, info });
      return info;
    } catch (err) {
      // Missing/unreadable file — the resolver's play path surfaces the
      // playback error; the HUD just renders nothing.
      console.warn('[LocalFiles] getStreamInfo failed:', err && err.message ? err.message : err);
      return null;
    }
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
  async downloadImage(url, _redirectDepth = 0) {
    const MAX_REDIRECTS = 5;
    const MAX_RESPONSE_SIZE = 10 * 1024 * 1024; // 10 MB

    if (_redirectDepth > MAX_REDIRECTS) {
      throw new Error('Too many redirects');
    }

    // Validate URL protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error('Only HTTP and HTTPS URLs are allowed');
    }

    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? require('https') : require('http');

      const request = protocol.get(url, (response) => {
        // Handle redirects with depth limit
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          console.log(`[LocalFiles] Following redirect to: ${response.headers.location}`);
          this.downloadImage(response.headers.location, _redirectDepth + 1).then(resolve).catch(reject);
          return;
        }

        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode}`));
          return;
        }

        const chunks = [];
        let totalSize = 0;
        response.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > MAX_RESPONSE_SIZE) {
            request.destroy();
            reject(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
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
