# Local Files Resolver Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a first-class Local Files resolver that lets users configure watch folders, index local music files into SQLite, and play them via HTML5 Audio.

**Architecture:** Main process handles SQLite database, file scanning, metadata extraction, and file watching. Renderer communicates via IPC. The `localfiles.axe` resolver participates in the normal resolution chain. HTML5 Audio handles playback of `file://` URLs.

**Tech Stack:** better-sqlite3, music-metadata, chokidar, Electron IPC

---

## Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Add dependencies to package.json**

Add to `dependencies`:
```json
"better-sqlite3": "^9.0.0",
"music-metadata": "^7.0.0",
"chokidar": "^3.5.0"
```

**Step 2: Install dependencies**

Run: `npm install`
Expected: Dependencies install successfully

**Step 3: Rebuild for Electron (better-sqlite3 has native bindings)**

Run: `npx electron-rebuild`
Expected: Native modules rebuilt for Electron

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add dependencies for local files resolver

- better-sqlite3 for fast SQLite database
- music-metadata for audio tag extraction
- chokidar for file system watching

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Create Database Module

**Files:**
- Create: `local-files/database.js`

**Step 1: Create the local-files directory and database module**

```javascript
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

class LocalFilesDatabase {
  constructor(userDataPath) {
    this.dbPath = path.join(userDataPath, 'local-files.db');
    this.db = null;
  }

  init() {
    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.createTables();
    return this;
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        file_path TEXT UNIQUE NOT NULL,
        file_hash TEXT,
        modified_at INTEGER,

        title TEXT NOT NULL,
        artist TEXT,
        album TEXT,
        album_artist TEXT,
        track_number INTEGER,
        disc_number INTEGER,
        year INTEGER,
        genre TEXT,
        duration REAL,

        format TEXT,
        bitrate INTEGER,
        sample_rate INTEGER,

        has_embedded_art INTEGER DEFAULT 0,
        folder_art_path TEXT,
        musicbrainz_art_url TEXT,

        musicbrainz_track_id TEXT,
        musicbrainz_artist_id TEXT,
        musicbrainz_release_id TEXT,
        enriched_at INTEGER,

        indexed_at INTEGER NOT NULL,

        title_normalized TEXT,
        artist_normalized TEXT,
        album_normalized TEXT
      );

      CREATE TABLE IF NOT EXISTS watch_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        enabled INTEGER DEFAULT 1,
        last_scan_at INTEGER,
        track_count INTEGER DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_tracks_artist ON tracks(artist_normalized);
      CREATE INDEX IF NOT EXISTS idx_tracks_title ON tracks(title_normalized);
      CREATE INDEX IF NOT EXISTS idx_tracks_album ON tracks(album_normalized);
      CREATE INDEX IF NOT EXISTS idx_tracks_file_path ON tracks(file_path);
    `);
  }

  normalize(str) {
    if (!str) return '';
    return str.toLowerCase().trim().replace(/[^\w\s]/g, '');
  }

  // Watch folder methods
  addWatchFolder(folderPath) {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO watch_folders (path, enabled, last_scan_at, track_count)
      VALUES (?, 1, NULL, 0)
    `);
    return stmt.run(folderPath);
  }

  removeWatchFolder(folderPath) {
    // Remove all tracks from this folder
    const deleteTracksStmt = this.db.prepare(`
      DELETE FROM tracks WHERE file_path LIKE ?
    `);
    deleteTracksStmt.run(folderPath + '%');

    // Remove the folder
    const deleteFolderStmt = this.db.prepare(`
      DELETE FROM watch_folders WHERE path = ?
    `);
    return deleteFolderStmt.run(folderPath);
  }

  getWatchFolders() {
    const stmt = this.db.prepare(`
      SELECT * FROM watch_folders ORDER BY path
    `);
    return stmt.all();
  }

  updateWatchFolderStats(folderPath, trackCount) {
    const stmt = this.db.prepare(`
      UPDATE watch_folders
      SET last_scan_at = ?, track_count = ?
      WHERE path = ?
    `);
    return stmt.run(Date.now(), trackCount, folderPath);
  }

  // Track methods
  insertTrack(track) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tracks (
        file_path, file_hash, modified_at,
        title, artist, album, album_artist,
        track_number, disc_number, year, genre, duration,
        format, bitrate, sample_rate,
        has_embedded_art, folder_art_path,
        indexed_at,
        title_normalized, artist_normalized, album_normalized
      ) VALUES (
        ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?,
        ?,
        ?, ?, ?
      )
    `);
    return stmt.run(
      track.filePath, track.fileHash, track.modifiedAt,
      track.title, track.artist, track.album, track.albumArtist,
      track.trackNumber, track.discNumber, track.year, track.genre, track.duration,
      track.format, track.bitrate, track.sampleRate,
      track.hasEmbeddedArt ? 1 : 0, track.folderArtPath,
      Date.now(),
      this.normalize(track.title), this.normalize(track.artist), this.normalize(track.album)
    );
  }

  removeTrack(filePath) {
    const stmt = this.db.prepare(`DELETE FROM tracks WHERE file_path = ?`);
    return stmt.run(filePath);
  }

  getTrackByPath(filePath) {
    const stmt = this.db.prepare(`SELECT * FROM tracks WHERE file_path = ?`);
    return stmt.get(filePath);
  }

  getAllTracks() {
    const stmt = this.db.prepare(`SELECT * FROM tracks ORDER BY artist, album, track_number`);
    return stmt.all();
  }

  search(query) {
    const normalized = this.normalize(query);
    const pattern = `%${normalized}%`;
    const stmt = this.db.prepare(`
      SELECT * FROM tracks
      WHERE title_normalized LIKE ?
         OR artist_normalized LIKE ?
         OR album_normalized LIKE ?
      ORDER BY
        CASE
          WHEN title_normalized LIKE ? THEN 1
          WHEN artist_normalized LIKE ? THEN 2
          ELSE 3
        END,
        artist, album, track_number
      LIMIT 50
    `);
    return stmt.all(pattern, pattern, pattern, pattern, pattern);
  }

  resolve(artist, track, album) {
    const artistNorm = this.normalize(artist);
    const trackNorm = this.normalize(track);
    const albumNorm = album ? this.normalize(album) : null;

    let stmt;
    let results;

    if (albumNorm) {
      stmt = this.db.prepare(`
        SELECT *,
          (CASE WHEN artist_normalized = ? THEN 40 ELSE 0 END) +
          (CASE WHEN title_normalized = ? THEN 40 ELSE 0 END) +
          (CASE WHEN album_normalized = ? THEN 15 ELSE 0 END) +
          (CASE WHEN artist_normalized LIKE ? THEN 20 ELSE 0 END) +
          (CASE WHEN title_normalized LIKE ? THEN 20 ELSE 0 END) AS score
        FROM tracks
        WHERE (artist_normalized LIKE ? OR artist_normalized = ?)
          AND (title_normalized LIKE ? OR title_normalized = ?)
        ORDER BY score DESC
        LIMIT 5
      `);
      const artistPattern = `%${artistNorm}%`;
      const trackPattern = `%${trackNorm}%`;
      results = stmt.all(
        artistNorm, trackNorm, albumNorm,
        artistPattern, trackPattern,
        artistPattern, artistNorm,
        trackPattern, trackNorm
      );
    } else {
      stmt = this.db.prepare(`
        SELECT *,
          (CASE WHEN artist_normalized = ? THEN 40 ELSE 0 END) +
          (CASE WHEN title_normalized = ? THEN 40 ELSE 0 END) +
          (CASE WHEN artist_normalized LIKE ? THEN 20 ELSE 0 END) +
          (CASE WHEN title_normalized LIKE ? THEN 20 ELSE 0 END) AS score
        FROM tracks
        WHERE (artist_normalized LIKE ? OR artist_normalized = ?)
          AND (title_normalized LIKE ? OR title_normalized = ?)
        ORDER BY score DESC
        LIMIT 5
      `);
      const artistPattern = `%${artistNorm}%`;
      const trackPattern = `%${trackNorm}%`;
      results = stmt.all(
        artistNorm, trackNorm,
        artistPattern, trackPattern,
        artistPattern, artistNorm,
        trackPattern, trackNorm
      );
    }

    // Calculate confidence based on score (max possible is 100)
    return results.map(r => ({
      ...r,
      confidence: Math.min((r.score + 5) / 100, 1.0) // +5 bonus for being local
    }));
  }

  getStats() {
    const trackCount = this.db.prepare(`SELECT COUNT(*) as count FROM tracks`).get();
    const folderCount = this.db.prepare(`SELECT COUNT(*) as count FROM watch_folders WHERE enabled = 1`).get();
    const lastScan = this.db.prepare(`SELECT MAX(last_scan_at) as last FROM watch_folders`).get();
    return {
      totalTracks: trackCount.count,
      totalFolders: folderCount.count,
      lastScan: lastScan.last
    };
  }

  getTracksNeedingEnrichment(limit = 100) {
    const stmt = this.db.prepare(`
      SELECT * FROM tracks
      WHERE enriched_at IS NULL
      ORDER BY indexed_at DESC
      LIMIT ?
    `);
    return stmt.all(limit);
  }

  updateTrackMusicBrainz(trackId, data) {
    const stmt = this.db.prepare(`
      UPDATE tracks SET
        musicbrainz_track_id = ?,
        musicbrainz_artist_id = ?,
        musicbrainz_release_id = ?,
        enriched_at = ?
      WHERE id = ?
    `);
    return stmt.run(
      data.musicbrainzTrackId,
      data.musicbrainzArtistId,
      data.musicbrainzReleaseId,
      Date.now(),
      trackId
    );
  }

  updateTrackArt(trackId, data) {
    const updates = [];
    const values = [];

    if (data.folderArtPath !== undefined) {
      updates.push('folder_art_path = ?');
      values.push(data.folderArtPath);
    }
    if (data.musicbrainzArtUrl !== undefined) {
      updates.push('musicbrainz_art_url = ?');
      values.push(data.musicbrainzArtUrl);
    }

    if (updates.length === 0) return;

    values.push(trackId);
    const stmt = this.db.prepare(`UPDATE tracks SET ${updates.join(', ')} WHERE id = ?`);
    return stmt.run(...values);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = LocalFilesDatabase;
```

**Step 2: Verify file was created**

Run: `ls -la local-files/`
Expected: `database.js` exists

**Step 3: Commit**

```bash
git add local-files/database.js
git commit -m "feat(local-files): add SQLite database module

Implements LocalFilesDatabase class with:
- Track and watch folder table schemas
- CRUD operations for tracks and folders
- Fuzzy search with normalized text matching
- Confidence-scored resolve for resolver integration
- MusicBrainz enrichment tracking
- Stats queries for UI

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Create Metadata Reader Module

**Files:**
- Create: `local-files/metadata-reader.js`

**Step 1: Create the metadata reader module**

```javascript
const mm = require('music-metadata');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

class MetadataReader {
  static SUPPORTED_EXTENSIONS = ['.mp3', '.m4a', '.flac', '.wav', '.aac'];

  static isSupported(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.SUPPORTED_EXTENSIONS.includes(ext);
  }

  static async readFile(filePath) {
    const stats = fs.statSync(filePath);
    const metadata = await mm.parseFile(filePath);

    // Generate a quick hash for change detection (first 64KB + file size)
    const fileHash = await this.generateQuickHash(filePath, stats.size);

    return {
      filePath,
      fileHash,
      modifiedAt: stats.mtimeMs,

      // Core metadata - use filename as fallback for title
      title: metadata.common.title || this.titleFromFilename(filePath),
      artist: metadata.common.artist || 'Unknown Artist',
      album: metadata.common.album || 'Unknown Album',
      albumArtist: metadata.common.albumartist || null,
      trackNumber: metadata.common.track?.no || null,
      discNumber: metadata.common.disk?.no || null,
      year: metadata.common.year || null,
      genre: metadata.common.genre?.[0] || null,
      duration: metadata.format.duration || 0,

      // Format info
      format: path.extname(filePath).slice(1).toLowerCase(),
      bitrate: metadata.format.bitrate || null,
      sampleRate: metadata.format.sampleRate || null,

      // Album art flag
      hasEmbeddedArt: (metadata.common.picture?.length || 0) > 0
    };
  }

  static titleFromFilename(filePath) {
    // Extract filename without extension
    let name = path.basename(filePath, path.extname(filePath));

    // Remove common track number prefixes: "01 - ", "01. ", "01_", "1 - ", etc.
    name = name.replace(/^\d+[\s._-]+/, '');

    // Remove leading/trailing whitespace
    name = name.trim();

    return name || 'Unknown Title';
  }

  static async generateQuickHash(filePath, fileSize) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('md5');
      const stream = fs.createReadStream(filePath, { start: 0, end: Math.min(65535, fileSize - 1) });

      // Include file size in hash for better uniqueness
      hash.update(String(fileSize));

      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  static async extractEmbeddedArt(filePath) {
    try {
      const metadata = await mm.parseFile(filePath);
      const picture = metadata.common.picture?.[0];

      if (picture) {
        return {
          data: picture.data,
          format: picture.format, // e.g., 'image/jpeg', 'image/png'
          type: picture.type // e.g., 'Cover (front)'
        };
      }
    } catch (error) {
      console.error('Error extracting album art:', error);
    }
    return null;
  }
}

module.exports = MetadataReader;
```

**Step 2: Commit**

```bash
git add local-files/metadata-reader.js
git commit -m "feat(local-files): add metadata reader module

Uses music-metadata library to extract:
- Core tags (title, artist, album, track number, etc.)
- Format info (bitrate, sample rate, duration)
- Embedded album art detection
- Quick file hash for change detection
- Filename fallback for missing title tags

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Create Scanner Module

**Files:**
- Create: `local-files/scanner.js`

**Step 1: Create the scanner module**

```javascript
const fs = require('fs');
const path = require('path');
const MetadataReader = require('./metadata-reader');

class FileScanner {
  constructor(db) {
    this.db = db;
    this.scanning = false;
    this.aborted = false;
    this.onProgress = null; // Callback: (current, total, currentFile) => void
  }

  abort() {
    this.aborted = true;
  }

  async scanFolder(folderPath, onProgress) {
    if (this.scanning) {
      throw new Error('Scan already in progress');
    }

    this.scanning = true;
    this.aborted = false;
    this.onProgress = onProgress;

    console.log(`[LocalFiles] Starting scan of: ${folderPath}`);

    try {
      // First, collect all audio files
      const files = await this.collectAudioFiles(folderPath);
      console.log(`[LocalFiles] Found ${files.length} audio files`);

      let processed = 0;
      let added = 0;
      let updated = 0;
      let errors = 0;

      for (const filePath of files) {
        if (this.aborted) {
          console.log('[LocalFiles] Scan aborted');
          break;
        }

        processed++;
        if (this.onProgress) {
          this.onProgress(processed, files.length, filePath);
        }

        try {
          const result = await this.processFile(filePath);
          if (result === 'added') added++;
          else if (result === 'updated') updated++;
        } catch (error) {
          console.error(`[LocalFiles] Error processing ${filePath}:`, error.message);
          errors++;
        }
      }

      // Update folder stats
      const trackCount = this.db.db.prepare(
        `SELECT COUNT(*) as count FROM tracks WHERE file_path LIKE ?`
      ).get(folderPath + '%').count;

      this.db.updateWatchFolderStats(folderPath, trackCount);

      console.log(`[LocalFiles] Scan complete: ${added} added, ${updated} updated, ${errors} errors`);

      return { processed, added, updated, errors, total: files.length };
    } finally {
      this.scanning = false;
      this.onProgress = null;
    }
  }

  async collectAudioFiles(folderPath) {
    const files = [];

    const walk = async (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        console.error(`[LocalFiles] Cannot read directory ${dir}:`, error.message);
        return;
      }

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await walk(fullPath);
        } else if (entry.isFile() && MetadataReader.isSupported(fullPath)) {
          files.push(fullPath);
        }
      }
    };

    await walk(folderPath);
    return files;
  }

  async processFile(filePath) {
    // Check if file already exists in DB
    const existing = this.db.getTrackByPath(filePath);

    // Get file stats
    const stats = fs.statSync(filePath);

    // If exists and hasn't changed, skip
    if (existing && existing.modified_at === stats.mtimeMs) {
      return 'skipped';
    }

    // Read metadata
    const metadata = await MetadataReader.readFile(filePath);

    // Check for folder art
    metadata.folderArtPath = await this.findFolderArt(filePath);

    // Insert or update in DB
    this.db.insertTrack(metadata);

    return existing ? 'updated' : 'added';
  }

  async findFolderArt(filePath) {
    const dir = path.dirname(filePath);
    const candidates = [
      'cover.jpg', 'cover.jpeg', 'cover.png',
      'folder.jpg', 'folder.jpeg', 'folder.png',
      'album.jpg', 'album.jpeg', 'album.png',
      'front.jpg', 'front.jpeg', 'front.png',
      'Cover.jpg', 'Cover.jpeg', 'Cover.png',
      'Folder.jpg', 'Folder.jpeg', 'Folder.png'
    ];

    for (const name of candidates) {
      const artPath = path.join(dir, name);
      if (fs.existsSync(artPath)) {
        return artPath;
      }
    }

    return null;
  }

  async processFileChange(filePath, changeType) {
    console.log(`[LocalFiles] File ${changeType}: ${filePath}`);

    if (changeType === 'add' || changeType === 'change') {
      if (!MetadataReader.isSupported(filePath)) return;

      try {
        const metadata = await MetadataReader.readFile(filePath);
        metadata.folderArtPath = await this.findFolderArt(filePath);
        this.db.insertTrack(metadata);
        console.log(`[LocalFiles] Indexed: ${metadata.title} by ${metadata.artist}`);
        return { action: changeType === 'add' ? 'added' : 'updated', track: metadata };
      } catch (error) {
        console.error(`[LocalFiles] Error processing ${filePath}:`, error.message);
        return { action: 'error', error: error.message };
      }
    } else if (changeType === 'unlink') {
      this.db.removeTrack(filePath);
      console.log(`[LocalFiles] Removed from index: ${filePath}`);
      return { action: 'removed', filePath };
    }
  }
}

module.exports = FileScanner;
```

**Step 2: Commit**

```bash
git add local-files/scanner.js
git commit -m "feat(local-files): add file scanner module

Implements FileScanner class with:
- Recursive directory walking
- Audio file collection by extension
- Incremental scanning (skip unchanged files)
- Folder art detection (cover.jpg, etc.)
- Progress callback for UI updates
- Individual file change processing for watcher

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Create File Watcher Module

**Files:**
- Create: `local-files/watcher.js`

**Step 1: Create the file watcher module**

```javascript
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
```

**Step 2: Commit**

```bash
git add local-files/watcher.js
git commit -m "feat(local-files): add file watcher module

Implements FileWatcher class with:
- Real-time chokidar watching in foreground
- 5-minute polling interval in background
- Debounced change processing (2s quiet period)
- Automatic mode switching on app focus/blur
- Support for add/change/unlink events
- Callback for notifying renderer of changes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Create Album Art Module

**Files:**
- Create: `local-files/album-art.js`

**Step 1: Create the album art module**

```javascript
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const MetadataReader = require('./metadata-reader');

class AlbumArtResolver {
  constructor(db, cacheDir) {
    this.db = db;
    this.cacheDir = cacheDir;

    // Ensure cache directory exists
    if (!fs.existsSync(this.cacheDir)) {
      fs.mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  async resolveArt(track) {
    // 1. Check for cached embedded art
    if (track.has_embedded_art || track.hasEmbeddedArt) {
      const cached = await this.getOrExtractEmbeddedArt(track);
      if (cached) return `file://${cached}`;
    }

    // 2. Check folder art
    if (track.folder_art_path || track.folderArtPath) {
      const artPath = track.folder_art_path || track.folderArtPath;
      if (fs.existsSync(artPath)) {
        return `file://${artPath}`;
      }
    }

    // 3. Check MusicBrainz cached art
    if (track.musicbrainz_art_url || track.musicbrainzArtUrl) {
      return track.musicbrainz_art_url || track.musicbrainzArtUrl;
    }

    // 4. Try to fetch from Cover Art Archive if we have release ID
    if (track.musicbrainz_release_id || track.musicbrainzReleaseId) {
      const releaseId = track.musicbrainz_release_id || track.musicbrainzReleaseId;
      const caaArt = await this.fetchFromCoverArtArchive(track.id, releaseId);
      if (caaArt) return `file://${caaArt}`;
    }

    // 5. No art found - return null (UI will show placeholder)
    return null;
  }

  async getOrExtractEmbeddedArt(track) {
    const filePath = track.file_path || track.filePath;
    const hash = crypto.createHash('md5').update(filePath).digest('hex');

    // Check if already cached
    const cachedJpg = path.join(this.cacheDir, `embedded-${hash}.jpg`);
    const cachedPng = path.join(this.cacheDir, `embedded-${hash}.png`);

    if (fs.existsSync(cachedJpg)) return cachedJpg;
    if (fs.existsSync(cachedPng)) return cachedPng;

    // Extract and cache
    try {
      const art = await MetadataReader.extractEmbeddedArt(filePath);
      if (art && art.data) {
        const ext = art.format?.includes('png') ? 'png' : 'jpg';
        const cachePath = path.join(this.cacheDir, `embedded-${hash}.${ext}`);
        fs.writeFileSync(cachePath, art.data);
        return cachePath;
      }
    } catch (error) {
      console.error(`[LocalFiles] Error extracting art from ${filePath}:`, error.message);
    }

    return null;
  }

  async fetchFromCoverArtArchive(trackId, releaseId) {
    const cachePath = path.join(this.cacheDir, `caa-${releaseId}.jpg`);

    // Check if already cached
    if (fs.existsSync(cachePath)) {
      return cachePath;
    }

    try {
      const url = `https://coverartarchive.org/release/${releaseId}/front-250`;
      console.log(`[LocalFiles] Fetching album art from CAA: ${releaseId}`);

      const response = await fetch(url);

      if (response.ok) {
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(cachePath, buffer);

        // Update database with cached URL
        if (trackId) {
          this.db.updateTrackArt(trackId, { musicbrainzArtUrl: `file://${cachePath}` });
        }

        return cachePath;
      }
    } catch (error) {
      // CAA might not have art for this release - this is normal
      console.log(`[LocalFiles] No CAA art for release ${releaseId}`);
    }

    return null;
  }

  // Clean up old cached files (call periodically)
  async cleanCache(maxAgeDays = 30) {
    const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
    const now = Date.now();

    try {
      const files = fs.readdirSync(this.cacheDir);
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(this.cacheDir, file);
        const stats = fs.statSync(filePath);

        if (now - stats.mtimeMs > maxAge) {
          fs.unlinkSync(filePath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[LocalFiles] Cleaned ${cleaned} old art cache files`);
      }
    } catch (error) {
      console.error('[LocalFiles] Error cleaning art cache:', error);
    }
  }
}

module.exports = AlbumArtResolver;
```

**Step 2: Commit**

```bash
git add local-files/album-art.js
git commit -m "feat(local-files): add album art resolver module

Implements AlbumArtResolver class with:
- Priority: embedded -> folder -> Cover Art Archive
- Embedded art extraction and caching
- Folder image detection (cover.jpg, etc.)
- CAA fetching with local caching
- Cache cleanup utility

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Create Main Service Module

**Files:**
- Create: `local-files/index.js`

**Step 1: Create the main service module**

```javascript
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
```

**Step 2: Commit**

```bash
git add local-files/index.js
git commit -m "feat(local-files): add main service module

Implements LocalFilesService class that coordinates:
- Database initialization
- File scanning
- File watching
- Album art resolution
- Track formatting for renderer
- Lifecycle management (foreground/background/shutdown)

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Add IPC Handlers to Main Process

**Files:**
- Modify: `main.js`

**Step 1: Add LocalFilesService import and initialization**

Near the top of main.js after other requires, add:
```javascript
const LocalFilesService = require('./local-files');
let localFilesService = null;
```

**Step 2: Initialize service in app.whenReady()**

Inside `app.whenReady().then(() => {`, after `startExtensionServer();`, add:
```javascript
  // Initialize Local Files service
  localFilesService = new LocalFilesService(app.getPath('userData'));
  localFilesService.init().then(() => {
    console.log('Local Files service ready');

    // Set up library change notifications
    localFilesService.setLibraryChangedCallback((changes) => {
      mainWindow?.webContents.send('localFiles:libraryChanged', changes);
    });
  }).catch(err => {
    console.error('Failed to initialize Local Files service:', err);
  });
```

**Step 3: Add foreground/background detection**

After the mainWindow creation, add event listeners:
```javascript
  mainWindow.on('focus', () => {
    localFilesService?.onAppForeground();
  });

  mainWindow.on('blur', () => {
    localFilesService?.onAppBackground();
  });
```

**Step 4: Add shutdown handler**

In `app.on('window-all-closed', ...)`, add before `app.quit()`:
```javascript
  if (localFilesService) {
    localFilesService.shutdown();
  }
```

**Step 5: Add IPC handlers at the end of main.js**

```javascript
// Local Files IPC handlers
ipcMain.handle('localFiles:addWatchFolder', async () => {
  console.log('=== Add Watch Folder ===');
  const { dialog } = require('electron');

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Watch Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    console.log('  User cancelled');
    return null;
  }

  const folderPath = result.filePaths[0];
  console.log('  Selected:', folderPath);

  try {
    const scanResult = await localFilesService.addWatchFolder(folderPath);
    return { success: true, folderPath, scanResult };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:removeWatchFolder', async (event, folderPath) => {
  console.log('=== Remove Watch Folder ===');
  console.log('  Path:', folderPath);

  try {
    await localFilesService.removeWatchFolder(folderPath);
    return { success: true };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:getWatchFolders', async () => {
  return localFilesService.getWatchFolders();
});

ipcMain.handle('localFiles:rescanAll', async () => {
  console.log('=== Rescan All Folders ===');

  try {
    const results = await localFilesService.rescanAll((current, total, file) => {
      mainWindow?.webContents.send('localFiles:scanProgress', { current, total, file });
    });
    return { success: true, results };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:rescanFolder', async (event, folderPath) => {
  console.log('=== Rescan Folder ===');
  console.log('  Path:', folderPath);

  try {
    const result = await localFilesService.scanFolder(folderPath, (current, total, file) => {
      mainWindow?.webContents.send('localFiles:scanProgress', { current, total, file });
    });
    return { success: true, result };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:search', async (event, query) => {
  return localFilesService.search(query);
});

ipcMain.handle('localFiles:resolve', async (event, params) => {
  return localFilesService.resolve(params);
});

ipcMain.handle('localFiles:getStats', async () => {
  return localFilesService.getStats();
});
```

**Step 6: Commit**

```bash
git add main.js
git commit -m "feat(local-files): add IPC handlers to main process

Adds:
- LocalFilesService initialization on app ready
- Foreground/background mode switching
- Graceful shutdown
- IPC handlers for all local files operations:
  - Watch folder management
  - Scanning
  - Search and resolve
  - Stats
  - Progress and library change events

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 9: Add Preload API

**Files:**
- Modify: `preload.js`

**Step 1: Add localFiles API section**

After the `contextMenu` section (around line 106), add:

```javascript
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
```

**Step 2: Commit**

```bash
git add preload.js
git commit -m "feat(local-files): add preload API bridge

Exposes localFiles API to renderer:
- Watch folder management
- Scanning operations
- Search and resolve queries
- Stats
- Progress and library change event listeners

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Create localfiles.axe Resolver

**Files:**
- Create: `resolvers/localfiles.axe`

**Step 1: Create the resolver file**

```json
{
  "manifest": {
    "id": "localfiles",
    "name": "Local Files",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Play music from your local library. Configure watch folders in settings.",
    "icon": "📁",
    "color": "#6366f1",
    "homepage": "",
    "email": ""
  },

  "capabilities": {
    "resolve": true,
    "search": true,
    "stream": true,
    "browse": false,
    "urlLookup": false
  },

  "urlPatterns": [],

  "settings": {
    "requiresAuth": false,
    "configurable": {}
  },

  "implementation": {
    "search": "async function(query, config) { if (!window.electron?.localFiles) { console.error('Local Files API not available'); return []; } try { const results = await window.electron.localFiles.search(query); return results || []; } catch (error) { console.error('Local Files search error:', error); return []; } }",

    "resolve": "async function(artist, track, album, config) { if (!window.electron?.localFiles) { console.error('Local Files API not available'); return null; } try { const results = await window.electron.localFiles.resolve({ artist, track, album }); if (!results || results.length === 0) return null; const best = results[0]; return { filePath: best.filePath, fileUrl: best.sources?.localfiles?.fileUrl || `file://${best.filePath}`, confidence: best.confidence || 0.95, duration: best.duration, albumArt: best.albumArt }; } catch (error) { console.error('Local Files resolve error:', error); return null; } }",

    "play": "async function(track, config) { console.log('Local Files play:', track); return { type: 'local', url: track.fileUrl || track.filePath }; }",

    "init": "async function(config) { console.log('Local Files resolver initialized'); return true; }",

    "cleanup": "async function() { console.log('Local Files resolver cleanup'); }"
  }
}
```

**Step 2: Commit**

```bash
git add resolvers/localfiles.axe
git commit -m "feat(local-files): add localfiles.axe resolver

First-class resolver that:
- Searches local library via IPC
- Resolves artist/track/album to local files
- Returns file:// URLs for HTML5 Audio playback
- Participates in normal resolver priority chain

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 11: Add Local File Playback to app.js

**Files:**
- Modify: `app.js`

**Step 1: Find the handlePlay function and add local file detection**

In `handlePlay`, after the resolver detection logic (around line 2018-2026), add a case for local files:

```javascript
      else if (trackOrSource.filePath || trackOrSource.fileUrl) resolverId = 'localfiles';
```

**Step 2: Add local file playback handler**

Before the `if (!resolver.capabilities.stream)` check (around line 2038), add:

```javascript
    // Handle local file playback directly with HTML5 Audio
    if (resolverId === 'localfiles') {
      console.log('🎵 Playing local file:', sourceToPlay.filePath || sourceToPlay.fileUrl);

      // Create audio element if needed
      if (!audioRef.current) {
        audioRef.current = new Audio();
        audioRef.current.addEventListener('timeupdate', () => {
          if (audioRef.current) {
            setProgress(audioRef.current.currentTime);
          }
        });
        audioRef.current.addEventListener('ended', () => {
          console.log('🎵 Local file playback ended');
          handleNext();
        });
        audioRef.current.addEventListener('error', (e) => {
          console.error('🎵 Audio error:', e.target.error);
          showConfirmDialog({
            type: 'error',
            title: 'Playback Error',
            message: 'Could not play this file. It may have been moved or deleted.'
          });
        });
      }

      const fileUrl = sourceToPlay.fileUrl || `file://${sourceToPlay.filePath}`;
      audioRef.current.src = fileUrl;
      audioRef.current.volume = volume / 100;

      try {
        await audioRef.current.play();

        // Set current track state
        const trackToSet = trackOrSource.sources ? {
          ...sourceToPlay,
          id: trackOrSource.id,
          artist: trackOrSource.artist,
          title: trackOrSource.title,
          album: trackOrSource.album,
          duration: sourceToPlay.duration || trackOrSource.duration,
          albumArt: sourceToPlay.albumArt || trackOrSource.albumArt,
          sources: trackOrSource.sources
        } : sourceToPlay;

        setCurrentTrack(trackToSet);
        setIsPlaying(true);
        setProgress(0);
        streamingPlaybackActiveRef.current = false;
        setBrowserPlaybackActive(false);
        setIsExternalPlayback(false);

        console.log('✅ Local file playing');
      } catch (error) {
        console.error('❌ Local file playback failed:', error);
        showConfirmDialog({
          type: 'error',
          title: 'Playback Error',
          message: 'Could not play this file: ' + error.message
        });
      }
      return;
    }
```

**Step 3: Add audioRef initialization**

Near other refs (around line 870), add:
```javascript
  const audioRef = useRef(null);
```

**Step 4: Update handlePlayPause for local files**

In `handlePlayPause` function, add handling for local file pause/resume:
```javascript
    // Handle local file playback
    if (audioRef.current && currentTrack?.sources?.localfiles) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.play();
        setIsPlaying(true);
      }
      return;
    }
```

**Step 5: Update volume control for local files**

Find where volume is applied (useEffect for volume changes) and add:
```javascript
    if (audioRef.current) {
      audioRef.current.volume = volume / 100;
    }
```

**Step 6: Add seeking support for local files**

Find the seek/progress bar click handler and add:
```javascript
    if (audioRef.current && currentTrack?.sources?.localfiles) {
      audioRef.current.currentTime = seekTime;
      setProgress(seekTime);
      return;
    }
```

**Step 7: Commit**

```bash
git add app.js
git commit -m "feat(local-files): add HTML5 Audio playback support

Integrates local file playback into handlePlay:
- Detects localfiles resolver from track sources
- Creates HTML5 Audio element for file:// URLs
- Handles play, pause, seek, volume
- Auto-advances on track end
- Error handling for missing files

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 12: Add Local Files Settings UI

**Files:**
- Modify: `app.js`

**Step 1: Add state for local files settings**

Near other useState declarations, add:
```javascript
  const [localFilesStats, setLocalFilesStats] = useState({ totalTracks: 0, totalFolders: 0, lastScan: null });
  const [watchFolders, setWatchFolders] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState({ current: 0, total: 0, file: '' });
```

**Step 2: Add useEffect to load local files data**

```javascript
  // Load local files data when settings tab changes to installed
  useEffect(() => {
    if (settingsTab === 'installed' && window.electron?.localFiles) {
      window.electron.localFiles.getStats().then(setLocalFilesStats);
      window.electron.localFiles.getWatchFolders().then(setWatchFolders);
    }
  }, [settingsTab]);

  // Listen for scan progress
  useEffect(() => {
    if (window.electron?.localFiles?.onScanProgress) {
      window.electron.localFiles.onScanProgress((data) => {
        setScanProgress(data);
      });
    }
    if (window.electron?.localFiles?.onLibraryChanged) {
      window.electron.localFiles.onLibraryChanged((changes) => {
        // Refresh stats when library changes
        window.electron.localFiles.getStats().then(setLocalFilesStats);
        window.electron.localFiles.getWatchFolders().then(setWatchFolders);
      });
    }
  }, []);
```

**Step 3: Add handler functions**

```javascript
  const handleAddWatchFolder = async () => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      const result = await window.electron.localFiles.addWatchFolder();
      if (result?.success) {
        setWatchFolders(await window.electron.localFiles.getWatchFolders());
        setLocalFilesStats(await window.electron.localFiles.getStats());
      }
    } finally {
      setIsScanning(false);
    }
  };

  const handleRemoveWatchFolder = async (folderPath) => {
    if (!window.electron?.localFiles) return;

    await window.electron.localFiles.removeWatchFolder(folderPath);
    setWatchFolders(await window.electron.localFiles.getWatchFolders());
    setLocalFilesStats(await window.electron.localFiles.getStats());
  };

  const handleRescanFolder = async (folderPath) => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      await window.electron.localFiles.rescanFolder(folderPath);
      setWatchFolders(await window.electron.localFiles.getWatchFolders());
      setLocalFilesStats(await window.electron.localFiles.getStats());
    } finally {
      setIsScanning(false);
    }
  };

  const handleRescanAll = async () => {
    if (!window.electron?.localFiles) return;

    setIsScanning(true);
    try {
      await window.electron.localFiles.rescanAll();
      setWatchFolders(await window.electron.localFiles.getWatchFolders());
      setLocalFilesStats(await window.electron.localFiles.getStats());
    } finally {
      setIsScanning(false);
    }
  };
```

**Step 4: Add UI in settings - find where selectedResolver panel is shown**

After the existing resolver settings panel, add a special case for localfiles:
```javascript
            // Local Files Settings Panel (shown when localfiles resolver is selected)
            selectedResolver?.id === 'localfiles' && React.createElement('div', {
              className: 'mt-8 bg-white border border-gray-200 rounded-lg p-6'
            },
              React.createElement('h3', { className: 'text-lg font-semibold text-gray-900 mb-4' }, 'Watch Folders'),
              React.createElement('p', { className: 'text-sm text-gray-500 mb-4' },
                'Add folders containing your music files. Parachord will automatically index and watch them for changes.'
              ),

              // Watch folders list
              React.createElement('div', { className: 'space-y-2 mb-4' },
                watchFolders.length === 0
                  ? React.createElement('p', { className: 'text-sm text-gray-400 italic' }, 'No watch folders configured')
                  : watchFolders.map(folder =>
                      React.createElement('div', {
                        key: folder.path,
                        className: 'flex items-center justify-between p-3 bg-gray-50 rounded-lg'
                      },
                        React.createElement('div', { className: 'flex-1 min-w-0' },
                          React.createElement('p', { className: 'text-sm font-medium text-gray-900 truncate' }, folder.path),
                          React.createElement('p', { className: 'text-xs text-gray-500' },
                            `${folder.track_count || 0} tracks`
                          )
                        ),
                        React.createElement('div', { className: 'flex items-center gap-2 ml-4' },
                          React.createElement('button', {
                            onClick: () => handleRescanFolder(folder.path),
                            disabled: isScanning,
                            className: 'p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-200 rounded transition-colors disabled:opacity-50',
                            title: 'Rescan folder'
                          }, '↻'),
                          React.createElement('button', {
                            onClick: () => handleRemoveWatchFolder(folder.path),
                            className: 'p-1.5 text-gray-500 hover:text-red-600 hover:bg-red-50 rounded transition-colors',
                            title: 'Remove folder'
                          }, '✕')
                        )
                      )
                    )
              ),

              // Add folder button
              React.createElement('button', {
                onClick: handleAddWatchFolder,
                disabled: isScanning,
                className: 'w-full px-4 py-2 border border-dashed border-gray-300 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:border-gray-400 transition-colors disabled:opacity-50 flex items-center justify-center gap-2'
              },
                React.createElement('span', null, '+'),
                'Add Watch Folder'
              ),

              // Scan progress
              isScanning && React.createElement('div', { className: 'mt-4' },
                React.createElement('div', { className: 'flex items-center gap-2 mb-2' },
                  React.createElement('div', { className: 'animate-spin w-4 h-4 border-2 border-purple-600 border-t-transparent rounded-full' }),
                  React.createElement('span', { className: 'text-sm text-gray-600' }, 'Scanning...')
                ),
                React.createElement('div', { className: 'w-full bg-gray-200 rounded-full h-2' },
                  React.createElement('div', {
                    className: 'bg-purple-600 h-2 rounded-full transition-all',
                    style: { width: `${scanProgress.total > 0 ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }
                  })
                ),
                React.createElement('p', { className: 'text-xs text-gray-500 mt-1 truncate' },
                  scanProgress.file || 'Preparing...'
                )
              ),

              // Stats
              React.createElement('div', { className: 'mt-6 pt-4 border-t border-gray-200' },
                React.createElement('h4', { className: 'text-sm font-medium text-gray-900 mb-2' }, 'Library Stats'),
                React.createElement('div', { className: 'grid grid-cols-2 gap-4 text-sm' },
                  React.createElement('div', null,
                    React.createElement('p', { className: 'text-gray-500' }, 'Total Tracks'),
                    React.createElement('p', { className: 'font-medium text-gray-900' }, localFilesStats.totalTracks.toLocaleString())
                  ),
                  React.createElement('div', null,
                    React.createElement('p', { className: 'text-gray-500' }, 'Last Scan'),
                    React.createElement('p', { className: 'font-medium text-gray-900' },
                      localFilesStats.lastScan
                        ? new Date(localFilesStats.lastScan).toLocaleDateString()
                        : 'Never'
                    )
                  )
                ),
                React.createElement('button', {
                  onClick: handleRescanAll,
                  disabled: isScanning || watchFolders.length === 0,
                  className: 'mt-4 px-4 py-2 text-sm text-purple-600 hover:bg-purple-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
                }, 'Rescan All Folders')
              )
            ),
```

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat(local-files): add settings UI for watch folders

Adds Local Files settings panel when resolver is selected:
- Watch folder list with track counts
- Add/remove folder buttons
- Rescan individual folder or all
- Scan progress bar
- Library stats display

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 13: Test the Implementation

**Step 1: Start the app**

Run: `npm start`
Expected: App launches without errors

**Step 2: Navigate to Settings > Installed Resolvers**

Expected: Local Files resolver appears in the list with 📁 icon

**Step 3: Click on Local Files resolver**

Expected: Watch folder settings panel appears

**Step 4: Add a watch folder**

Click "Add Watch Folder" and select a folder with music files
Expected:
- Folder picker opens
- After selection, scanning begins with progress bar
- Tracks are indexed and count shown

**Step 5: Search for a local track**

Use the main search to search for a song that's in your local library
Expected: Local file results appear with 📁 indicator

**Step 6: Play a local file**

Click play on a local file search result
Expected:
- Track plays via HTML5 Audio
- Progress bar updates
- Play/pause works
- Seeking works

**Step 7: Test resolver integration**

Search for a song that exists both locally and on Spotify
Expected: Both sources appear, priority order respected

**Step 8: Commit test verification**

```bash
git commit --allow-empty -m "test: verify local files resolver implementation

Manually tested:
- Resolver loads and appears in settings
- Watch folder add/remove works
- File scanning with progress
- Search returns local results
- Playback via HTML5 Audio works
- Play/pause/seek controls work
- Multi-source priority respected

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Task 14: Add MusicBrainz Enrichment (Optional Enhancement)

**Files:**
- Create: `local-files/musicbrainz-enricher.js`

**Step 1: Create the enricher module**

```javascript
const AlbumArtResolver = require('./album-art');

class MusicBrainzEnricher {
  constructor(db, albumArt) {
    this.db = db;
    this.albumArt = albumArt;
    this.lastRequestTime = 0;
    this.minRequestInterval = 1100; // 1 req/sec with buffer
  }

  async rateLimit() {
    const now = Date.now();
    const elapsed = now - this.lastRequestTime;
    if (elapsed < this.minRequestInterval) {
      await new Promise(resolve => setTimeout(resolve, this.minRequestInterval - elapsed));
    }
    this.lastRequestTime = Date.now();
  }

  async enrichTrack(track) {
    await this.rateLimit();

    const query = encodeURIComponent(`recording:"${track.title}" AND artist:"${track.artist}"`);

    try {
      const response = await fetch(
        `https://musicbrainz.org/ws/2/recording?query=${query}&fmt=json&limit=5`,
        {
          headers: {
            'User-Agent': 'Parachord/1.0.0 (https://github.com/parachord)'
          }
        }
      );

      if (!response.ok) {
        console.log(`[MB] Request failed: ${response.status}`);
        return null;
      }

      const data = await response.json();

      if (!data.recordings || data.recordings.length === 0) {
        return null;
      }

      // Find best match
      const best = this.selectBestMatch(track, data.recordings);
      if (!best) return null;

      // Update database
      const mbData = {
        musicbrainzTrackId: best.id,
        musicbrainzArtistId: best['artist-credit']?.[0]?.artist?.id || null,
        musicbrainzReleaseId: best.releases?.[0]?.id || null
      };

      this.db.updateTrackMusicBrainz(track.id, mbData);

      // Try to fetch album art if we have a release ID
      if (mbData.musicbrainzReleaseId && this.albumArt) {
        await this.albumArt.fetchFromCoverArtArchive(track.id, mbData.musicbrainzReleaseId);
      }

      console.log(`[MB] Enriched: ${track.title} by ${track.artist}`);
      return mbData;
    } catch (error) {
      console.error('[MB] Enrichment error:', error.message);
      return null;
    }
  }

  selectBestMatch(track, recordings) {
    const normalize = (s) => s?.toLowerCase().trim().replace(/[^\w\s]/g, '') || '';
    const trackTitle = normalize(track.title);
    const trackArtist = normalize(track.artist);

    let bestScore = 0;
    let bestRecording = null;

    for (const recording of recordings) {
      let score = 0;

      const recTitle = normalize(recording.title);
      const recArtist = normalize(recording['artist-credit']?.[0]?.name);

      // Title match
      if (recTitle === trackTitle) score += 50;
      else if (recTitle.includes(trackTitle) || trackTitle.includes(recTitle)) score += 30;

      // Artist match
      if (recArtist === trackArtist) score += 40;
      else if (recArtist.includes(trackArtist) || trackArtist.includes(recArtist)) score += 20;

      // Duration match (within 5 seconds)
      if (track.duration && recording.length) {
        const durationDiff = Math.abs(track.duration * 1000 - recording.length);
        if (durationDiff < 5000) score += 10;
      }

      if (score > bestScore) {
        bestScore = score;
        bestRecording = recording;
      }
    }

    // Require minimum score of 60 (at least partial title and artist match)
    return bestScore >= 60 ? bestRecording : null;
  }

  async enrichBatch(limit = 50) {
    const tracks = this.db.getTracksNeedingEnrichment(limit);
    console.log(`[MB] Enriching ${tracks.length} tracks...`);

    let enriched = 0;
    for (const track of tracks) {
      const result = await this.enrichTrack(track);
      if (result) enriched++;
    }

    console.log(`[MB] Batch complete: ${enriched}/${tracks.length} enriched`);
    return { total: tracks.length, enriched };
  }
}

module.exports = MusicBrainzEnricher;
```

**Step 2: Integrate into LocalFilesService**

In `local-files/index.js`, add:
```javascript
const MusicBrainzEnricher = require('./musicbrainz-enricher');

// In constructor:
this.enricher = null;

// In init(), after albumArt:
this.enricher = new MusicBrainzEnricher(this.db, this.albumArt);

// Add method:
async enrichLibrary(limit = 50) {
  if (!this.enricher) return null;
  return this.enricher.enrichBatch(limit);
}
```

**Step 3: Add IPC handler in main.js**

```javascript
ipcMain.handle('localFiles:enrichLibrary', async (event, limit) => {
  return localFilesService.enrichLibrary(limit);
});
```

**Step 4: Add to preload.js**

```javascript
enrichLibrary: (limit) => ipcRenderer.invoke('localFiles:enrichLibrary', limit),
```

**Step 5: Commit**

```bash
git add local-files/musicbrainz-enricher.js local-files/index.js main.js preload.js
git commit -m "feat(local-files): add MusicBrainz enrichment

Adds background metadata enrichment:
- Rate-limited MB API queries (1/sec)
- Best-match scoring algorithm
- Automatic Cover Art Archive fetching
- Batch processing support

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This plan implements:

1. **Database layer** (Task 2) - SQLite with better-sqlite3
2. **Metadata extraction** (Task 3) - music-metadata for tags
3. **File scanning** (Task 4) - Recursive with progress
4. **File watching** (Task 5) - chokidar + polling hybrid
5. **Album art** (Task 6) - Embedded, folder, CAA
6. **Service coordinator** (Task 7) - Main service class
7. **IPC bridge** (Tasks 8-9) - Main ↔ renderer communication
8. **Resolver** (Task 10) - localfiles.axe plugin
9. **Playback** (Task 11) - HTML5 Audio integration
10. **Settings UI** (Task 12) - Watch folder management
11. **Testing** (Task 13) - Manual verification
12. **MusicBrainz** (Task 14) - Optional enrichment

Total: ~14 tasks, each with clear steps and commits.
