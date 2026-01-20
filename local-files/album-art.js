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
