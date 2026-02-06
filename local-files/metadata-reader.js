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

    // Handle duration - if missing, try to calculate for WAV files with ID3 tags
    let duration = metadata.format.duration || 0;
    if (duration === 0) {
      const calculatedDuration = await this.calculateDurationFallback(filePath, metadata);
      if (calculatedDuration > 0) {
        duration = calculatedDuration;
      }
    }

    return {
      filePath,
      fileHash,
      modifiedAt: stats.mtimeMs,

      // Core metadata - use filename as fallback for title
      title: metadata.common.title || this.titleFromFilename(filePath),
      artist: metadata.common.artist || 'Unknown Artist',
      album: metadata.common.album || null,
      albumArtist: metadata.common.albumartist || null,
      trackNumber: metadata.common.track?.no || null,
      discNumber: metadata.common.disk?.no || null,
      year: metadata.common.year || null,
      genre: metadata.common.genre?.[0] || null,
      duration,

      // Format info
      format: path.extname(filePath).slice(1).toLowerCase(),
      bitrate: metadata.format.bitrate || null,
      sampleRate: metadata.format.sampleRate || null,

      // Album art flag
      hasEmbeddedArt: (metadata.common.picture?.length || 0) > 0
    };
  }

  /**
   * Fallback duration calculation for files where music-metadata fails
   * (e.g., WAV files with prepended ID3 tags)
   */
  static async calculateDurationFallback(filePath, metadata) {
    const ext = path.extname(filePath).toLowerCase();

    if (ext === '.wav') {
      try {
        // Read the file to find the RIFF/WAV header
        const fd = fs.openSync(filePath, 'r');
        const headerBuf = Buffer.alloc(12);
        fs.readSync(fd, headerBuf, 0, 12, 0);

        // Check if file starts with ID3 tag
        if (headerBuf.toString('ascii', 0, 3) === 'ID3') {
          // Parse ID3v2 header to find its size
          // ID3v2 size is stored in bytes 6-9 as syncsafe integer
          const sizeBuf = Buffer.alloc(4);
          fs.readSync(fd, sizeBuf, 0, 4, 6);
          const id3Size = ((sizeBuf[0] & 0x7f) << 21) |
                          ((sizeBuf[1] & 0x7f) << 14) |
                          ((sizeBuf[2] & 0x7f) << 7) |
                          (sizeBuf[3] & 0x7f);
          const id3TotalSize = 10 + id3Size; // 10 byte header + size

          // Read RIFF header after ID3 tag
          const riffHeaderBuf = Buffer.alloc(12);
          fs.readSync(fd, riffHeaderBuf, 0, 12, id3TotalSize);

          if (riffHeaderBuf.toString('ascii', 0, 4) === 'RIFF' &&
              riffHeaderBuf.toString('ascii', 8, 12) === 'WAVE') {

            // Iterate through WAV chunks to find fmt and data
            let offset = id3TotalSize + 12; // After RIFF header
            const chunkBuf = Buffer.alloc(8);
            const fileSize = fs.fstatSync(fd).size;
            let byteRate = 0;

            while (offset < fileSize - 8) {
              fs.readSync(fd, chunkBuf, 0, 8, offset);
              const chunkId = chunkBuf.toString('ascii', 0, 4);
              const chunkSize = chunkBuf.readUInt32LE(4);

              if (chunkId === 'fmt ') {
                // Read format chunk to get byte rate
                const fmtBuf = Buffer.alloc(Math.min(chunkSize, 16));
                fs.readSync(fd, fmtBuf, 0, fmtBuf.length, offset + 8);
                byteRate = fmtBuf.readUInt32LE(8);
              }

              if (chunkId === 'data' && byteRate > 0) {
                fs.closeSync(fd);
                // Duration = data size / byte rate
                const duration = chunkSize / byteRate;
                console.log(`[MetadataReader] Calculated WAV duration from ID3+WAV file: ${duration.toFixed(2)}s`);
                return duration;
              }

              offset += 8 + chunkSize;
              // Pad to even boundary
              if (chunkSize % 2 !== 0) offset += 1;
            }
          }
        }

        fs.closeSync(fd);
      } catch (err) {
        // Ensure file descriptor is closed on error to prevent FD leaks
        try { if (typeof fd !== 'undefined' && fd !== null) fs.closeSync(fd); } catch (_) {}
        console.error(`[MetadataReader] Error calculating fallback duration:`, err.message);
      }
    }

    return 0;
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
