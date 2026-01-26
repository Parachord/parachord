/**
 * ResolutionScheduler - Manages track resolution across visibility contexts
 *
 * Resolves only imminently-playable tracks based on:
 * 1. Queue (viewport + overscan + playback lookahead)
 * 2. Hover (single hovered track)
 * 3. Pools (spinoff/listen-along next 5)
 * 4. Page (viewport + overscan)
 * 5. Sidebar (visible friend tracks)
 */

const CONTEXT_PRIORITY = {
  queue: 1,
  hover: 2,
  pool: 3,
  page: 4,
  sidebar: 5
};

class ResolutionScheduler {
  constructor() {
    // Map of contextId -> { type, abortController, visibleTracks }
    this.contexts = new Map();

    // Map of trackKey -> { contextId, data, abortController, priority }
    this.pending = new Map();

    // Set of trackKeys currently being resolved
    this.inProgress = new Set();

    // Currently hovered track
    this.hoverTrack = null;

    // Processing state
    this.isProcessing = false;
    this.resolveCallback = null;
  }

  /**
   * Set the resolve callback function
   * @param {Function} callback - (trackData, signal) => Promise
   */
  setResolveCallback(callback) {
    this.resolveCallback = callback;
  }

  /**
   * Register a visibility context
   * @param {string} id - Unique context ID
   * @param {'queue'|'pool'|'page'|'sidebar'} type - Context type
   */
  registerContext(id, type) {
    if (!CONTEXT_PRIORITY[type]) {
      throw new Error(`Invalid context type: ${type}`);
    }

    this.contexts.set(id, {
      type,
      abortController: new AbortController(),
      visibleTracks: new Set()
    });
  }

  /**
   * Unregister a context and abort its pending tracks
   * @param {string} id - Context ID
   */
  unregisterContext(id) {
    const context = this.contexts.get(id);
    if (!context) return;

    // Abort all tracks in this context
    this.abortContext(id);

    this.contexts.delete(id);
  }

  /**
   * Check if a context exists
   * @param {string} id - Context ID
   * @returns {boolean}
   */
  hasContext(id) {
    return this.contexts.has(id);
  }

  /**
   * Update which tracks are visible in a context
   * @param {string} contextId - Context ID
   * @param {Array<{key: string, data: object}>} visibleTracks - Currently visible tracks
   */
  updateVisibility(contextId, visibleTracks) {
    const context = this.contexts.get(contextId);
    if (!context) return;

    const newVisibleKeys = new Set(visibleTracks.map(t => t.key));
    const oldVisibleKeys = context.visibleTracks;

    // Abort tracks that scrolled out of view
    for (const key of oldVisibleKeys) {
      if (!newVisibleKeys.has(key)) {
        this.abort(key);
      }
    }

    // Enqueue new visible tracks
    for (const track of visibleTracks) {
      if (!oldVisibleKeys.has(track.key) && !this.pending.has(track.key)) {
        this.enqueue(track.key, contextId, track.data);
      }
    }

    context.visibleTracks = newVisibleKeys;
  }

  /**
   * Enqueue a track for resolution
   * @param {string} trackKey - Unique track key
   * @param {string} contextId - Context ID
   * @param {object} data - Track data
   */
  enqueue(trackKey, contextId, data) {
    if (this.pending.has(trackKey)) return; // Already pending

    const context = this.contexts.get(contextId);
    if (!context) return;

    const priority = CONTEXT_PRIORITY[context.type];

    this.pending.set(trackKey, {
      contextId,
      data,
      priority,
      abortController: new AbortController()
    });

    // Start processing if not already
    this._maybeProcess();
  }

  /**
   * Set the currently hovered track (promotes to priority 2)
   * @param {string} trackKey - Track key
   * @param {string} contextId - Context ID
   */
  setHoverTrack(trackKey, contextId) {
    this.hoverTrack = { trackKey, contextId };
  }

  /**
   * Clear the hover track
   */
  clearHoverTrack() {
    this.hoverTrack = null;
  }

  /**
   * Peek at the next track to resolve (highest priority)
   * @returns {object|null}
   */
  peekNext() {
    let best = null;
    let bestPriority = Infinity;

    for (const [trackKey, entry] of this.pending) {
      let priority = entry.priority;
      let isHover = false;

      // Check if this is the hover track
      if (this.hoverTrack?.trackKey === trackKey) {
        priority = CONTEXT_PRIORITY.hover;
        isHover = true;
      }

      if (priority < bestPriority) {
        bestPriority = priority;
        best = { trackKey, ...entry, isHover };
      }
    }

    return best;
  }

  /**
   * Dequeue a track (mark as no longer pending)
   * @param {string} trackKey - Track key
   */
  dequeue(trackKey) {
    const entry = this.pending.get(trackKey);
    if (entry) {
      this.pending.delete(trackKey);
      this.inProgress.delete(trackKey);

      // Remove from context's visible set
      const context = this.contexts.get(entry.contextId);
      if (context) {
        context.visibleTracks.delete(trackKey);
      }
    }
  }

  /**
   * Get abort signal for a track
   * @param {string} trackKey - Track key
   * @returns {AbortSignal|null}
   */
  getAbortSignal(trackKey) {
    const entry = this.pending.get(trackKey);
    return entry?.abortController.signal || null;
  }

  /**
   * Abort a specific track's resolution
   * @param {string} trackKey - Track key
   */
  abort(trackKey) {
    const entry = this.pending.get(trackKey);
    if (entry) {
      entry.abortController.abort();
      this.pending.delete(trackKey);
      this.inProgress.delete(trackKey);
    }

    // Clear hover if this was the hover track
    if (this.hoverTrack?.trackKey === trackKey) {
      this.hoverTrack = null;
    }
  }

  /**
   * Abort all pending tracks in a context
   * @param {string} contextId - Context ID
   * @param {object} options - Options
   * @param {boolean} options.afterCurrentBatch - If true, preserve in-progress tracks
   */
  abortContext(contextId, options = {}) {
    const { afterCurrentBatch = false } = options;
    const context = this.contexts.get(contextId);
    if (!context) return;

    // Abort context-level controller
    context.abortController.abort();

    // Abort all tracks in this context (except in-progress if afterCurrentBatch)
    for (const [trackKey, entry] of this.pending) {
      if (entry.contextId === contextId) {
        if (afterCurrentBatch && this.inProgress.has(trackKey)) {
          continue; // Preserve in-progress track
        }
        entry.abortController.abort();
        this.pending.delete(trackKey);
      }
    }

    context.visibleTracks.clear();

    // Create new controller for future use
    context.abortController = new AbortController();
  }

  /**
   * Check if a track is pending resolution
   * @param {string} trackKey - Track key
   * @returns {boolean}
   */
  hasPending(trackKey) {
    return this.pending.has(trackKey);
  }

  /**
   * Get count of pending tracks
   * @returns {number}
   */
  getPendingCount() {
    return this.pending.size;
  }

  /**
   * Mark a track as in-progress (currently being resolved)
   * @param {string} trackKey - Track key
   */
  markInProgress(trackKey) {
    if (this.pending.has(trackKey)) {
      this.inProgress.add(trackKey);
    }
  }

  /**
   * Get count of in-progress tracks
   * @returns {number}
   */
  getInProgressCount() {
    return this.inProgress.size;
  }

  /**
   * Start processing if not already
   * @private
   */
  _maybeProcess() {
    if (this.isProcessing || !this.resolveCallback) return;
    this._processNext();
  }

  /**
   * Process the next track in the queue
   * @private
   */
  async _processNext() {
    const next = this.peekNext();
    if (!next) {
      this.isProcessing = false;
      return;
    }

    this.isProcessing = true;
    const { trackKey, data, abortController } = next;

    try {
      // Check if still visible before resolving
      if (!this.pending.has(trackKey)) {
        // Already aborted, move on
        this._processNext();
        return;
      }

      await this.resolveCallback(data, abortController.signal);

      // Remove from pending after successful resolution
      this.dequeue(trackKey);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error(`Resolution error for ${trackKey}:`, error);
      }
      this.dequeue(trackKey);
    }

    // Rate limit: 150ms between resolutions
    await new Promise(resolve => setTimeout(resolve, 150));

    this._processNext();
  }
}

// Export for Node.js (tests) and browser
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ResolutionScheduler, CONTEXT_PRIORITY };
}
