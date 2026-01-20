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
