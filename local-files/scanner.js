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
      // Verify the watch folder is actually accessible before doing
      // anything destructive. If the volume is unmounted, the network share
      // is offline, or permissions lapsed transiently, statSync throws —
      // and we must NOT proceed to the diff-and-delete loop, otherwise an
      // unreadable folder gets interpreted as "all files deleted" and we
      // wipe the entire DB section for that folder. The user's library
      // would then "reappear" on the next scan once the volume came back,
      // matching real reports of disappearing/reappearing libraries.
      try {
        const rootStat = fs.statSync(folderPath);
        if (!rootStat.isDirectory()) {
          console.warn(`[LocalFiles] Watch root is not a directory: ${folderPath}; skipping scan to preserve existing DB entries.`);
          return { processed: 0, added: 0, updated: 0, removed: 0, errors: 0, total: 0, skipped: 'not-a-directory' };
        }
      } catch (rootErr) {
        console.warn(`[LocalFiles] Watch root unreadable (${rootErr.code || rootErr.message}); skipping scan to preserve existing DB entries: ${folderPath}`);
        return { processed: 0, added: 0, updated: 0, removed: 0, errors: 0, total: 0, skipped: 'unreadable' };
      }

      // First, collect all audio files
      const collectResult = await this.collectAudioFiles(folderPath);
      if (!collectResult.ok) {
        console.warn(`[LocalFiles] Root walk failed for ${folderPath}: ${collectResult.error}; skipping scan to preserve existing DB entries.`);
        return { processed: 0, added: 0, updated: 0, removed: 0, errors: 0, total: 0, skipped: 'walk-failed' };
      }
      const files = collectResult.files;
      const fileSet = new Set(files);
      console.log(`[LocalFiles] Found ${files.length} audio files`);

      // Existing rows for this folder.
      const existingTracks = this.db.db.prepare(
        `SELECT file_path FROM tracks WHERE file_path LIKE ?`
      ).all(folderPath + '%');

      // Safety guard: if the folder previously had tracks but the scan
      // finds zero, treat that as suspicious — almost always an
      // environmental issue (volume mounted but empty, FS race during
      // mount, permissions partially restricted) rather than a legit
      // wholesale deletion. Refuse to delete and let the next scan
      // re-evaluate. Mirrors the >70% completeness guard in sync:start.
      if (files.length === 0 && existingTracks.length > 0) {
        console.warn(`[LocalFiles] Scan returned 0 files for ${folderPath} but DB has ${existingTracks.length} entries; refusing to wipe. Re-run the scan manually if the folder is genuinely empty.`);
        // Still update folder stats so we don't keep retrying immediately.
        this.db.updateWatchFolderStats(folderPath, existingTracks.length);
        return { processed: 0, added: 0, updated: 0, removed: 0, errors: 0, total: 0, skipped: 'empty-but-db-populated' };
      }

      // Remove stale entries (files that no longer exist at their paths)
      let removed = 0;
      for (const track of existingTracks) {
        if (!fileSet.has(track.file_path)) {
          // File no longer exists at this path - remove from database
          this.db.removeTrack(track.file_path);
          removed++;
          console.log(`[LocalFiles] Removed stale entry: ${track.file_path}`);
        }
      }

      if (removed > 0) {
        console.log(`[LocalFiles] Removed ${removed} stale entries`);
      }

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

      console.log(`[LocalFiles] Scan complete: ${added} added, ${updated} updated, ${removed} removed, ${errors} errors`);

      return { processed, added, updated, removed, errors, total: files.length };
    } finally {
      this.scanning = false;
      this.onProgress = null;
    }
  }

  async collectAudioFiles(folderPath) {
    const files = [];

    // The root walk's success matters — a failure there means the folder
    // is unreadable (unmounted, permissions, etc.) and the caller must
    // NOT treat the empty list as authoritative. Failures inside subdirs
    // are still tolerated (logged and skipped); we only escalate the
    // root-level error.
    const walk = async (dir, isRoot) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch (error) {
        if (isRoot) {
          // Bubble up — caller decides whether to abort the scan.
          throw error;
        }
        console.error(`[LocalFiles] Cannot read directory ${dir}:`, error.message);
        return;
      }

      for (const entry of entries) {
        // Skip hidden files and directories
        if (entry.name.startsWith('.')) continue;

        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Skip symlinks to prevent traversal outside watched folders
          if (entry.isSymbolicLink && entry.isSymbolicLink()) continue;
          try {
            const stat = fs.lstatSync(fullPath);
            if (stat.isSymbolicLink()) continue;
          } catch (_) { /* skip inaccessible entries */ continue; }
          await walk(fullPath, false);
        } else if (entry.isFile() && MetadataReader.isSupported(fullPath)) {
          files.push(fullPath);
        }
      }
    };

    try {
      await walk(folderPath, true);
      return { ok: true, files };
    } catch (error) {
      return { ok: false, error: error.message || String(error), code: error.code };
    }
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
