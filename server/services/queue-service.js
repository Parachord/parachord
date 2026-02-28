const { v4: uuidv4 } = require('uuid');

class QueueService {
  constructor(store, wsManager) {
    this.store = store;
    this.wsManager = wsManager;
    this.tracks = [];
    this.currentIndex = -1;
    this.shuffled = false;
    this._originalOrder = null;
  }

  /**
   * Get the full queue state
   */
  getState() {
    return {
      tracks: this.tracks,
      currentIndex: this.currentIndex,
      currentTrack: this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null,
      shuffled: this.shuffled,
      length: this.tracks.length
    };
  }

  /**
   * Add tracks to the queue
   */
  addTracks(newTracks, { position = 'end' } = {}) {
    if (!Array.isArray(newTracks)) newTracks = [newTracks];

    // Tag each track with a queue ID for unique identification
    const tagged = newTracks.map(t => ({ ...t, _queueId: uuidv4() }));

    if (position === 'next' && this.currentIndex >= 0) {
      this.tracks.splice(this.currentIndex + 1, 0, ...tagged);
    } else {
      this.tracks.push(...tagged);
    }

    // If queue was empty and we added tracks, set index to 0
    if (this.currentIndex < 0 && this.tracks.length > 0) {
      this.currentIndex = 0;
    }

    this._broadcast();
    return { added: tagged.length, total: this.tracks.length };
  }

  /**
   * Remove a track from the queue by index
   */
  removeTrack(index) {
    if (index < 0 || index >= this.tracks.length) {
      throw new Error('Index out of bounds');
    }

    this.tracks.splice(index, 1);

    // Adjust current index
    if (this.tracks.length === 0) {
      this.currentIndex = -1;
    } else if (index < this.currentIndex) {
      this.currentIndex--;
    } else if (index === this.currentIndex && this.currentIndex >= this.tracks.length) {
      this.currentIndex = this.tracks.length - 1;
    }

    this._broadcast();
  }

  /**
   * Clear the queue
   */
  clear() {
    this.tracks = [];
    this.currentIndex = -1;
    this.shuffled = false;
    this._originalOrder = null;
    this._broadcast();
  }

  /**
   * Reorder a track from one index to another
   */
  reorder(fromIndex, toIndex) {
    if (fromIndex < 0 || fromIndex >= this.tracks.length) throw new Error('fromIndex out of bounds');
    if (toIndex < 0 || toIndex >= this.tracks.length) throw new Error('toIndex out of bounds');

    const [track] = this.tracks.splice(fromIndex, 1);
    this.tracks.splice(toIndex, 0, track);

    // Adjust current index
    if (this.currentIndex === fromIndex) {
      this.currentIndex = toIndex;
    } else if (fromIndex < this.currentIndex && toIndex >= this.currentIndex) {
      this.currentIndex--;
    } else if (fromIndex > this.currentIndex && toIndex <= this.currentIndex) {
      this.currentIndex++;
    }

    this._broadcast();
  }

  /**
   * Shuffle the queue (Fisher-Yates), preserving current track position
   */
  shuffle() {
    if (this.tracks.length <= 1) return;

    this._originalOrder = [...this.tracks];
    const currentTrack = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;

    // Fisher-Yates shuffle
    for (let i = this.tracks.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.tracks[i], this.tracks[j]] = [this.tracks[j], this.tracks[i]];
    }

    // Move current track to front
    if (currentTrack) {
      const idx = this.tracks.findIndex(t => t._queueId === currentTrack._queueId);
      if (idx > 0) {
        [this.tracks[0], this.tracks[idx]] = [this.tracks[idx], this.tracks[0]];
      }
      this.currentIndex = 0;
    }

    this.shuffled = true;
    this._broadcast();
  }

  /**
   * Unshuffle — restore original order
   */
  unshuffle() {
    if (!this._originalOrder) return;

    const currentTrack = this.currentIndex >= 0 ? this.tracks[this.currentIndex] : null;
    this.tracks = this._originalOrder;
    this._originalOrder = null;
    this.shuffled = false;

    if (currentTrack) {
      this.currentIndex = this.tracks.findIndex(t => t._queueId === currentTrack._queueId);
      if (this.currentIndex < 0) this.currentIndex = 0;
    }

    this._broadcast();
  }

  /**
   * Move to a specific index in the queue
   */
  jumpTo(index) {
    if (index < 0 || index >= this.tracks.length) {
      throw new Error('Index out of bounds');
    }
    this.currentIndex = index;
    this._broadcast();
    return this.tracks[this.currentIndex];
  }

  /**
   * Advance to next track. Returns the track or null if at end.
   */
  next() {
    if (this.currentIndex < this.tracks.length - 1) {
      this.currentIndex++;
      this._broadcast();
      return this.tracks[this.currentIndex];
    }
    return null;
  }

  /**
   * Go to previous track. Returns the track or null if at start.
   */
  previous() {
    if (this.currentIndex > 0) {
      this.currentIndex--;
      this._broadcast();
      return this.tracks[this.currentIndex];
    }
    return null;
  }

  /**
   * Get upcoming tracks (for pre-resolution)
   */
  getUpcoming(count = 3) {
    const start = this.currentIndex + 1;
    return this.tracks.slice(start, start + count);
  }

  _broadcast() {
    this.wsManager.broadcast('queue:updated', this.getState());
  }
}

module.exports = QueueService;
