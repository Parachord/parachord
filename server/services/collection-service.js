const fs = require('fs');
const path = require('path');

class CollectionService {
  constructor(dataDir, wsManager) {
    this.filePath = path.join(dataDir, 'collection.json');
    this.wsManager = wsManager;
    this.tracks = [];
    this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.tracks = JSON.parse(raw);
      }
    } catch (err) {
      console.error('[CollectionService] Failed to load:', err.message);
      this.tracks = [];
    }
  }

  _save() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.tracks, null, 2));
    } catch (err) {
      console.error('[CollectionService] Failed to save:', err.message);
    }
  }

  /**
   * Get tracks with pagination and optional search
   */
  getTracks({ page = 1, limit = 50, search = '' } = {}) {
    let filtered = this.tracks;

    if (search) {
      const q = search.toLowerCase();
      filtered = this.tracks.filter(t =>
        (t.title && t.title.toLowerCase().includes(q)) ||
        (t.artist && t.artist.toLowerCase().includes(q)) ||
        (t.album && t.album.toLowerCase().includes(q))
      );
    }

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit);

    return { tracks: items, total, page, limit, pages: Math.ceil(total / limit) };
  }

  /**
   * Add tracks to the collection
   */
  addTracks(newTracks) {
    if (!Array.isArray(newTracks)) newTracks = [newTracks];

    for (const track of newTracks) {
      // Deduplicate by title+artist
      const exists = this.tracks.some(t =>
        t.title === track.title && t.artist === track.artist
      );
      if (!exists) {
        this.tracks.push({ ...track, addedAt: Date.now() });
      }
    }

    this._save();
    this.wsManager.broadcast('collection:updated', { total: this.tracks.length });
    return { success: true, total: this.tracks.length };
  }

  /**
   * Remove a track from the collection
   */
  removeTrack(title, artist) {
    const before = this.tracks.length;
    this.tracks = this.tracks.filter(t =>
      !(t.title === title && t.artist === artist)
    );

    if (this.tracks.length === before) {
      throw new Error('Track not found in collection');
    }

    this._save();
    this.wsManager.broadcast('collection:updated', { total: this.tracks.length });
    return { success: true, total: this.tracks.length };
  }

  /**
   * Total track count
   */
  get total() {
    return this.tracks.length;
  }
}

module.exports = CollectionService;
