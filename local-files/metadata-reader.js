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
