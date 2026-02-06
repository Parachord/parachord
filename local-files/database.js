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
    // Escape LIKE wildcards in folder path to prevent pattern injection
    const escapedPath = folderPath.replace(/[%_]/g, '\\$&');
    const deleteTracksStmt = this.db.prepare(`
      DELETE FROM tracks WHERE file_path LIKE ? ESCAPE '\\'
    `);
    deleteTracksStmt.run(escapedPath + '%');

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

  updateTrackMetadata(filePath, tags) {
    const setClauses = [];
    const values = [];

    if (tags.title !== undefined) {
      setClauses.push('title = ?');
      setClauses.push('title_normalized = ?');
      values.push(tags.title);
      values.push(this.normalize(tags.title));
    }
    if (tags.artist !== undefined) {
      setClauses.push('artist = ?');
      setClauses.push('artist_normalized = ?');
      values.push(tags.artist);
      values.push(this.normalize(tags.artist));
    }
    if (tags.album !== undefined) {
      setClauses.push('album = ?');
      setClauses.push('album_normalized = ?');
      values.push(tags.album);
      values.push(this.normalize(tags.album));
    }
    if (tags.trackNumber !== undefined) {
      setClauses.push('track_number = ?');
      values.push(tags.trackNumber);
    }
    if (tags.year !== undefined) {
      setClauses.push('year = ?');
      values.push(tags.year);
    }

    if (setClauses.length === 0) return;

    values.push(filePath);
    const stmt = this.db.prepare(`
      UPDATE tracks SET ${setClauses.join(', ')} WHERE file_path = ?
    `);
    return stmt.run(...values);
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

    return results.map(r => ({
      ...r,
      confidence: Math.min((r.score + 5) / 100, 1.0)
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

  updateTrackHasEmbeddedArt(filePath, hasArt) {
    const stmt = this.db.prepare(`UPDATE tracks SET has_embedded_art = ? WHERE file_path = ?`);
    return stmt.run(hasArt ? 1 : 0, filePath);
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = LocalFilesDatabase;
