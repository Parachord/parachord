# Viewport-Based Resolution Optimization - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Resolve only imminently-playable tracks based on visibility context, with proper abort handling when tracks leave visibility.

**Architecture:** A central `ResolutionScheduler` manages all resolution requests across 5 priority contexts (Queue, Hover, Pools, Page, Sidebar). Uses hybrid abort system: batch AbortController for page navigation, per-track AbortController for queue/pool/sidebar changes.

**Tech Stack:** Vanilla JS module, @tanstack/react-virtual hooks, AbortController API

---

## Task 1: Create ResolutionScheduler Module

**Files:**
- Create: `resolution-scheduler.js`
- Test: `tests/resolution-scheduler.test.js`

**Step 1: Write the failing test**

Create `tests/resolution-scheduler.test.js`:

```javascript
/**
 * ResolutionScheduler Unit Tests
 * Run with: node tests/resolution-scheduler.test.js
 */

// Test results tracking
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
  }
}

function assertDeepEqual(actual, expected, message = '') {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${message} Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`);
  }
}

// Import the scheduler
const { ResolutionScheduler, CONTEXT_PRIORITY } = require('../resolution-scheduler.js');

console.log('\n🧪 ResolutionScheduler Tests\n');

// Test: Context priorities are correct
test('CONTEXT_PRIORITY has correct order', () => {
  assertEqual(CONTEXT_PRIORITY.queue, 1, 'queue priority');
  assertEqual(CONTEXT_PRIORITY.hover, 2, 'hover priority');
  assertEqual(CONTEXT_PRIORITY.pool, 3, 'pool priority');
  assertEqual(CONTEXT_PRIORITY.page, 4, 'page priority');
  assertEqual(CONTEXT_PRIORITY.sidebar, 5, 'sidebar priority');
});

// Test: Can create scheduler instance
test('ResolutionScheduler can be instantiated', () => {
  const scheduler = new ResolutionScheduler();
  assertEqual(typeof scheduler.registerContext, 'function', 'has registerContext');
  assertEqual(typeof scheduler.unregisterContext, 'function', 'has unregisterContext');
  assertEqual(typeof scheduler.updateVisibility, 'function', 'has updateVisibility');
  assertEqual(typeof scheduler.setHoverTrack, 'function', 'has setHoverTrack');
  assertEqual(typeof scheduler.clearHoverTrack, 'function', 'has clearHoverTrack');
});

// Test: Register and unregister contexts
test('Can register and unregister contexts', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');
  assertEqual(scheduler.hasContext('page-1'), true, 'context registered');

  scheduler.unregisterContext('page-1');
  assertEqual(scheduler.hasContext('page-1'), false, 'context unregistered');
});

// Test: Enqueue tracks with priority ordering
test('Tracks are ordered by context priority', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('sidebar-1', 'sidebar');
  scheduler.registerContext('queue-1', 'queue');
  scheduler.registerContext('page-1', 'page');

  scheduler.enqueue('track-a', 'sidebar-1', { title: 'Sidebar Track' });
  scheduler.enqueue('track-b', 'page-1', { title: 'Page Track' });
  scheduler.enqueue('track-c', 'queue-1', { title: 'Queue Track' });

  const next = scheduler.peekNext();
  assertEqual(next.trackKey, 'track-c', 'queue track should be first');
});

// Test: Hover track gets priority 2
test('Hover track is prioritized above page but below queue', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('queue-1', 'queue');
  scheduler.registerContext('page-1', 'page');

  scheduler.enqueue('track-a', 'page-1', { title: 'Page Track' });
  scheduler.setHoverTrack('track-a', 'page-1');
  scheduler.enqueue('track-b', 'queue-1', { title: 'Queue Track' });

  // Queue should still be first
  const first = scheduler.peekNext();
  assertEqual(first.trackKey, 'track-b', 'queue track first');

  // Dequeue it
  scheduler.dequeue('track-b');

  // Hover should be next (not just page priority)
  const second = scheduler.peekNext();
  assertEqual(second.trackKey, 'track-a', 'hover track second');
  assertEqual(second.isHover, true, 'marked as hover');
});

// Test: Abort signal for track
test('Can get abort signal for enqueued track', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');
  scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

  const signal = scheduler.getAbortSignal('track-a');
  assertEqual(signal instanceof AbortSignal, true, 'returns AbortSignal');
  assertEqual(signal.aborted, false, 'not aborted initially');
});

// Test: Abort individual track
test('Can abort individual track', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('queue-1', 'queue');
  scheduler.enqueue('track-a', 'queue-1', { title: 'Track A' });

  const signal = scheduler.getAbortSignal('track-a');
  scheduler.abort('track-a');

  assertEqual(signal.aborted, true, 'signal aborted');
  assertEqual(scheduler.hasPending('track-a'), false, 'track removed from pending');
});

// Test: Abort context (after batch)
test('Abort context removes pending tracks', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');
  scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
  scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });
  scheduler.enqueue('track-c', 'page-1', { title: 'Track C' });

  scheduler.abortContext('page-1');

  assertEqual(scheduler.hasPending('track-a'), false, 'track-a removed');
  assertEqual(scheduler.hasPending('track-b'), false, 'track-b removed');
  assertEqual(scheduler.hasPending('track-c'), false, 'track-c removed');
});

// Test: Update visibility adds/removes tracks
test('updateVisibility adds new tracks and aborts hidden ones', () => {
  const scheduler = new ResolutionScheduler();
  let resolveCallCount = 0;

  scheduler.registerContext('page-1', 'page');

  // Initial visibility
  scheduler.updateVisibility('page-1', [
    { key: 'track-a', data: { title: 'Track A' } },
    { key: 'track-b', data: { title: 'Track B' } }
  ]);

  assertEqual(scheduler.hasPending('track-a'), true, 'track-a pending');
  assertEqual(scheduler.hasPending('track-b'), true, 'track-b pending');

  // Update visibility - track-a scrolls out, track-c scrolls in
  scheduler.updateVisibility('page-1', [
    { key: 'track-b', data: { title: 'Track B' } },
    { key: 'track-c', data: { title: 'Track C' } }
  ]);

  assertEqual(scheduler.hasPending('track-a'), false, 'track-a no longer pending');
  assertEqual(scheduler.hasPending('track-b'), true, 'track-b still pending');
  assertEqual(scheduler.hasPending('track-c'), true, 'track-c now pending');
});

// Summary
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
```

**Step 2: Run test to verify it fails**

Run: `node tests/resolution-scheduler.test.js`
Expected: FAIL with "Cannot find module '../resolution-scheduler.js'"

**Step 3: Write minimal implementation**

Create `resolution-scheduler.js`:

```javascript
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
    }

    // Clear hover if this was the hover track
    if (this.hoverTrack?.trackKey === trackKey) {
      this.hoverTrack = null;
    }
  }

  /**
   * Abort all pending tracks in a context
   * @param {string} contextId - Context ID
   */
  abortContext(contextId) {
    const context = this.contexts.get(contextId);
    if (!context) return;

    // Abort context-level controller
    context.abortController.abort();

    // Abort all tracks in this context
    for (const [trackKey, entry] of this.pending) {
      if (entry.contextId === contextId) {
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
```

**Step 4: Run test to verify it passes**

Run: `node tests/resolution-scheduler.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add resolution-scheduler.js tests/resolution-scheduler.test.js
git commit -m "feat: add ResolutionScheduler for viewport-based resolution"
```

---

## Task 2: Add Batch Completion Support

**Files:**
- Modify: `resolution-scheduler.js`
- Test: `tests/resolution-scheduler.test.js`

**Step 1: Add test for batch completion**

Add to `tests/resolution-scheduler.test.js` before the summary:

```javascript
// Test: Abort context waits for current batch
test('abortContext with afterCurrentBatch=true preserves in-progress', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');
  scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
  scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });

  // Mark track-a as in-progress
  scheduler.markInProgress('track-a');

  // Abort context but preserve in-progress
  scheduler.abortContext('page-1', { afterCurrentBatch: true });

  assertEqual(scheduler.hasPending('track-a'), true, 'in-progress track preserved');
  assertEqual(scheduler.hasPending('track-b'), false, 'queued track aborted');
});

// Test: Batch size tracking
test('Batch size is tracked correctly', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');
  scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
  scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });
  scheduler.enqueue('track-c', 'page-1', { title: 'Track C' });

  scheduler.markInProgress('track-a');
  scheduler.markInProgress('track-b');

  assertEqual(scheduler.getInProgressCount(), 2, 'two in progress');

  scheduler.dequeue('track-a');
  assertEqual(scheduler.getInProgressCount(), 1, 'one in progress after dequeue');
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/resolution-scheduler.test.js`
Expected: FAIL with "scheduler.markInProgress is not a function"

**Step 3: Update implementation**

Add to `ResolutionScheduler` class in `resolution-scheduler.js`:

```javascript
  constructor() {
    // ... existing code ...

    // Track in-progress resolutions
    this.inProgress = new Set();
  }

  /**
   * Mark a track as in-progress (being resolved)
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
   * Abort all pending tracks in a context
   * @param {string} contextId - Context ID
   * @param {object} options - { afterCurrentBatch: boolean }
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
```

**Step 4: Run test to verify it passes**

Run: `node tests/resolution-scheduler.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add resolution-scheduler.js tests/resolution-scheduler.test.js
git commit -m "feat: add batch completion support to ResolutionScheduler"
```

---

## Task 3: Add Queue Playback Lookahead

**Files:**
- Modify: `resolution-scheduler.js`
- Test: `tests/resolution-scheduler.test.js`

**Step 1: Add test for playback lookahead**

Add to `tests/resolution-scheduler.test.js`:

```javascript
// Test: Queue playback lookahead
test('Queue context includes playback lookahead tracks', () => {
  const scheduler = new ResolutionScheduler();

  // Register queue context with playback lookahead
  scheduler.registerContext('queue-1', 'queue', { playbackLookahead: 5 });

  // Set current playback index
  scheduler.setPlaybackIndex('queue-1', 3);

  // Get tracks that should be resolved (indices 3-7 for lookahead of 5)
  const lookaheadRange = scheduler.getPlaybackLookaheadRange('queue-1');

  assertDeepEqual(lookaheadRange, { start: 3, end: 8 }, 'lookahead range correct');
});

// Test: Playback lookahead is always visible
test('Playback lookahead tracks are always considered visible', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('queue-1', 'queue', { playbackLookahead: 5 });
  scheduler.setPlaybackIndex('queue-1', 10);

  // Check if indices in lookahead are considered visible
  assertEqual(scheduler.isInPlaybackLookahead('queue-1', 10), true, 'current track');
  assertEqual(scheduler.isInPlaybackLookahead('queue-1', 14), true, 'within lookahead');
  assertEqual(scheduler.isInPlaybackLookahead('queue-1', 15), false, 'outside lookahead');
  assertEqual(scheduler.isInPlaybackLookahead('queue-1', 9), false, 'before current');
});
```

**Step 2: Run test to verify it fails**

Run: `node tests/resolution-scheduler.test.js`
Expected: FAIL

**Step 3: Update implementation**

Update `registerContext` and add new methods in `resolution-scheduler.js`:

```javascript
  /**
   * Register a visibility context
   * @param {string} id - Unique context ID
   * @param {'queue'|'pool'|'page'|'sidebar'} type - Context type
   * @param {object} options - { playbackLookahead: number }
   */
  registerContext(id, type, options = {}) {
    if (!CONTEXT_PRIORITY[type]) {
      throw new Error(`Invalid context type: ${type}`);
    }

    this.contexts.set(id, {
      type,
      abortController: new AbortController(),
      visibleTracks: new Set(),
      playbackLookahead: options.playbackLookahead || 0,
      playbackIndex: 0
    });
  }

  /**
   * Set the current playback index for a context
   * @param {string} contextId - Context ID
   * @param {number} index - Current playback index
   */
  setPlaybackIndex(contextId, index) {
    const context = this.contexts.get(contextId);
    if (context) {
      context.playbackIndex = index;
    }
  }

  /**
   * Get the playback lookahead range for a context
   * @param {string} contextId - Context ID
   * @returns {{start: number, end: number}|null}
   */
  getPlaybackLookaheadRange(contextId) {
    const context = this.contexts.get(contextId);
    if (!context || !context.playbackLookahead) return null;

    return {
      start: context.playbackIndex,
      end: context.playbackIndex + context.playbackLookahead
    };
  }

  /**
   * Check if an index is within the playback lookahead
   * @param {string} contextId - Context ID
   * @param {number} index - Track index
   * @returns {boolean}
   */
  isInPlaybackLookahead(contextId, index) {
    const range = this.getPlaybackLookaheadRange(contextId);
    if (!range) return false;

    return index >= range.start && index < range.end;
  }
```

**Step 4: Run test to verify it passes**

Run: `node tests/resolution-scheduler.test.js`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add resolution-scheduler.js tests/resolution-scheduler.test.js
git commit -m "feat: add playback lookahead support for queue/pool contexts"
```

---

## Task 4: Integrate AbortSignal into resolveTrack

**Files:**
- Modify: `app.js:9556-9728` (resolveTrack function)

**Step 1: Identify the changes needed**

The current `resolveTrack` function doesn't accept or check AbortSignals. We need to:
1. Accept `signal` option
2. Check `signal.aborted` before starting and after each async operation
3. Pass signal to resolver calls
4. Handle AbortError silently

**Step 2: Update resolveTrack signature and add early abort check**

Find `resolveTrack` at line 9556 and update:

```javascript
const resolveTrack = async (track, artistName, options = {}) => {
  const { forceRefresh = false, isQueueResolution = false, signal } = options;

  // Early abort check
  if (signal?.aborted) {
    console.log(`⏹️ Resolution aborted for "${track.title}" before start`);
    return;
  }

  const trackKey = `${track.position}-${track.title}`;
  // ... rest of function
```

**Step 3: Add abort checks throughout the function**

After cache check (around line 9607), add:

```javascript
  if (signal?.aborted) return;
```

In the resolver promises map (around line 9683), update:

```javascript
  const resolverPromises = enabledResolvers.map(async (resolver) => {
    // Check abort before each resolver
    if (signal?.aborted) return;

    if (!resolver.capabilities.resolve || !resolver.play) {
      console.log(`  ⏭️ Skipping ${resolver.id}: resolve=${resolver.capabilities.resolve}, play=${!!resolver.play}`);
      return;
    }

    try {
      const config = await getResolverConfig(resolver.id);

      // Check abort after config fetch
      if (signal?.aborted) return;

      console.log(`  🔎 Trying ${resolver.id}...`);
      const result = await resolver.resolve(artistName, track.title, null, config);

      // Check abort before processing result
      if (signal?.aborted) return;

      if (result) {
        sources[resolver.id] = {
          ...result,
          confidence: calculateConfidence(track, result)
        };
        console.log(`  ✅ ${resolver.name}: Found match (confidence: ${(sources[resolver.id].confidence * 100).toFixed(0)}%)`);
      } else {
        console.log(`  ⚪ ${resolver.name}: No match found`);
      }
    } catch (error) {
      // Silently ignore abort errors
      if (error.name === 'AbortError') return;
      console.error(`  ❌ ${resolver.name} resolve error:`, error);
    }
  });
```

After `Promise.all` (around line 9710), add:

```javascript
  await Promise.all(resolverPromises);

  // Final abort check before state update
  if (signal?.aborted) {
    console.log(`⏹️ Resolution aborted for "${track.title}" before state update`);
    return;
  }
```

**Step 4: Update callers to pass options object**

Update calls to `resolveTrack` to use new signature. Example:

```javascript
// Old:
await resolveTrack(track, artistName, forceRefresh);

// New:
await resolveTrack(track, artistName, { forceRefresh });
```

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat: add AbortSignal support to resolveTrack"
```

---

## Task 5: Create useResolutionScheduler Hook

**Files:**
- Create: `hooks/use-resolution-scheduler.js` (inline in app.js for this project)
- Modify: `app.js`

**Step 1: Add the hook near other hooks in app.js**

Find a good location after other custom hooks (around line 2200) and add:

```javascript
// Resolution scheduler hook - manages viewport-based resolution
const useResolutionScheduler = (resolveTrackFn) => {
  const schedulerRef = useRef(null);

  // Initialize scheduler
  if (!schedulerRef.current) {
    // ResolutionScheduler is defined at top of file
    schedulerRef.current = new ResolutionScheduler();

    schedulerRef.current.setResolveCallback(async (trackData, signal) => {
      await resolveTrackFn(trackData.track, trackData.artistName, {
        signal,
        isQueueResolution: trackData.isQueueResolution
      });
    });
  }

  const scheduler = schedulerRef.current;

  // Context management
  const registerPageContext = useCallback((pageId) => {
    scheduler.registerContext(pageId, 'page');
    return () => scheduler.unregisterContext(pageId);
  }, [scheduler]);

  const registerQueueContext = useCallback((queueId, playbackLookahead = 5) => {
    scheduler.registerContext(queueId, 'queue', { playbackLookahead });
    return () => scheduler.unregisterContext(queueId);
  }, [scheduler]);

  const registerPoolContext = useCallback((poolId, playbackLookahead = 5) => {
    scheduler.registerContext(poolId, 'pool', { playbackLookahead });
    return () => scheduler.unregisterContext(poolId);
  }, [scheduler]);

  const registerSidebarContext = useCallback((sidebarId) => {
    scheduler.registerContext(sidebarId, 'sidebar');
    return () => scheduler.unregisterContext(sidebarId);
  }, [scheduler]);

  // Visibility updates
  const updateVisibility = useCallback((contextId, visibleTracks) => {
    scheduler.updateVisibility(contextId, visibleTracks);
  }, [scheduler]);

  // Hover
  const setHoverTrack = useCallback((trackKey, contextId) => {
    scheduler.setHoverTrack(trackKey, contextId);
  }, [scheduler]);

  const clearHoverTrack = useCallback(() => {
    scheduler.clearHoverTrack();
  }, [scheduler]);

  // Playback position
  const setPlaybackIndex = useCallback((contextId, index) => {
    scheduler.setPlaybackIndex(contextId, index);
  }, [scheduler]);

  // Abort
  const abortContext = useCallback((contextId, options) => {
    scheduler.abortContext(contextId, options);
  }, [scheduler]);

  return {
    registerPageContext,
    registerQueueContext,
    registerPoolContext,
    registerSidebarContext,
    updateVisibility,
    setHoverTrack,
    clearHoverTrack,
    setPlaybackIndex,
    abortContext,
    getPendingCount: () => scheduler.getPendingCount()
  };
};
```

**Step 2: Initialize the hook in the main App component**

Add after other hook initializations (around line 2550):

```javascript
// Resolution scheduler for viewport-based resolution
const resolutionScheduler = useResolutionScheduler(resolveTrack);
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add useResolutionScheduler hook"
```

---

## Task 6: Integrate Scheduler with VirtualizedQueueList

**Files:**
- Modify: `app.js` (VirtualizedQueueList component around line 385)

**Step 1: Add onItemsRendered callback to virtualizer**

The virtualizer already exists. We need to:
1. Pass scheduler functions as props
2. Use `onChange` from virtualizer to track visible items
3. Update scheduler when visibility changes

Update `VirtualizedQueueList` props to accept scheduler callbacks:

```javascript
const VirtualizedQueueList = React.memo(({
  queue,
  // ... existing props ...
  // New props for resolution scheduler
  onVisibilityChange,
  onTrackHover,
  onTrackHoverEnd,
  currentTrackIndex
}) => {
```

**Step 2: Add visibility tracking effect**

Inside `VirtualizedQueueList`, after virtualizer creation:

```javascript
  // Track visible items for resolution scheduler
  useEffect(() => {
    if (!virtualizer || !onVisibilityChange) return;

    const visibleRange = virtualizer.getVirtualItems();
    if (visibleRange.length === 0) return;

    const startIndex = visibleRange[0].index;
    const endIndex = visibleRange[visibleRange.length - 1].index;

    // Include overscan (10) which virtualizer already handles
    // Plus playback lookahead (5 from current track)
    const lookaheadStart = currentTrackIndex ?? 0;
    const lookaheadEnd = lookaheadStart + 5;

    // Build visible tracks list
    const visibleTracks = [];
    const seen = new Set();

    // Add viewport + overscan
    for (let i = Math.max(0, startIndex - 10); i <= Math.min(queue.length - 1, endIndex + 10); i++) {
      const track = queue[i];
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        visibleTracks.push({
          key: track.id,
          data: { track, artistName: track.artist, isQueueResolution: true }
        });
      }
    }

    // Add playback lookahead
    for (let i = lookaheadStart; i < Math.min(queue.length, lookaheadEnd); i++) {
      const track = queue[i];
      if (track && !seen.has(track.id)) {
        seen.add(track.id);
        visibleTracks.push({
          key: track.id,
          data: { track, artistName: track.artist, isQueueResolution: true }
        });
      }
    }

    onVisibilityChange(visibleTracks);
  }, [virtualizer?.getVirtualItems(), queue, currentTrackIndex, onVisibilityChange]);
```

**Step 3: Add hover handlers to track rows**

Update `renderQueueTrackRow` to include hover callbacks:

```javascript
  const renderQueueTrackRow = (track, index, virtualRow) => {
    // ... existing code ...

    return React.createElement('div', {
      key: track.id,
      // ... existing props ...
      onMouseEnter: () => {
        if (onTrackHover) onTrackHover(track.id);
      },
      onMouseLeave: () => {
        if (onTrackHoverEnd) onTrackHoverEnd();
      },
      // ... rest of existing props ...
    },
```

**Step 4: Wire up in parent component**

Where `VirtualizedQueueList` is rendered (around line 31912), add the new props:

```javascript
React.createElement(VirtualizedQueueList, {
  // ... existing props ...
  onVisibilityChange: (tracks) => resolutionScheduler.updateVisibility('queue', tracks),
  onTrackHover: (trackId) => resolutionScheduler.setHoverTrack(trackId, 'queue'),
  onTrackHoverEnd: () => resolutionScheduler.clearHoverTrack(),
  currentTrackIndex: currentQueue.findIndex(t => t.id === currentTrack?.id)
})
```

**Step 5: Register queue context on mount**

Add effect to register queue context:

```javascript
// Register queue context for resolution scheduler
useEffect(() => {
  return resolutionScheduler.registerQueueContext('queue', 5);
}, []);
```

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat: integrate resolution scheduler with VirtualizedQueueList"
```

---

## Task 7: Integrate Scheduler with Collection/Page Track Lists

**Files:**
- Modify: `app.js` (collection tracks rendering around line 21960)

**Step 1: Find the collection tracks rendering**

The collection tracks are rendered around line 21960-22221. This section needs:
1. Register page context on mount
2. Track visibility using IntersectionObserver or list virtualization
3. Abort on navigation away

**Step 2: Add page context registration**

Add effect near the collection rendering logic:

```javascript
// Register page context for collection tracks resolution
useEffect(() => {
  if (activeView === 'library' && collectionTab === 'tracks') {
    const cleanup = resolutionScheduler.registerPageContext('collection-tracks');
    return cleanup;
  }
}, [activeView, collectionTab]);

// Abort collection resolution when navigating away
useEffect(() => {
  return () => {
    resolutionScheduler.abortContext('collection-tracks', { afterCurrentBatch: true });
  };
}, [activeView, collectionTab]);
```

**Step 3: Add visibility tracking for collection tracks**

If the collection track list is virtualized, use similar pattern to queue. If not virtualized, we need to add IntersectionObserver.

Check if collection uses virtualization - if not, add a wrapper:

```javascript
// For non-virtualized lists, use IntersectionObserver
const trackRowRefs = useRef(new Map());
const observerRef = useRef(null);

useEffect(() => {
  if (activeView !== 'library' || collectionTab !== 'tracks') return;

  observerRef.current = new IntersectionObserver(
    (entries) => {
      const visibleTracks = [];
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const trackId = entry.target.dataset.trackId;
          const track = allTracks.find(t => t.id === trackId);
          if (track) {
            visibleTracks.push({
              key: trackId,
              data: { track, artistName: track.artist }
            });
          }
        }
      });
      resolutionScheduler.updateVisibility('collection-tracks', visibleTracks);
    },
    { rootMargin: '200px' } // 200px buffer above/below viewport
  );

  // Observe all track rows
  trackRowRefs.current.forEach((element) => {
    if (element) observerRef.current.observe(element);
  });

  return () => observerRef.current?.disconnect();
}, [activeView, collectionTab, allTracks]);
```

**Step 4: Add ref to track rows**

Update track row rendering to include ref:

```javascript
ref: (el) => {
  if (el) trackRowRefs.current.set(track.id, el);
  else trackRowRefs.current.delete(track.id);
},
'data-track-id': track.id,
```

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat: integrate resolution scheduler with collection track list"
```

---

## Task 8: Integrate Scheduler with Spinoff/Listen-Along Pools

**Files:**
- Modify: `app.js` (spinoff logic around line 14300-14360)

**Step 1: Register pool context when spinoff starts**

In `startSpinoff` function (around line 14300):

```javascript
const startSpinoff = async (track) => {
  // Register pool context
  resolutionScheduler.registerPoolContext('spinoff', 5);

  // ... existing spinoff logic ...

  // After populating spinoffTracksRef, update visibility
  const poolTracks = spinoffTracksRef.current.slice(0, 5).map((t, i) => ({
    key: `spinoff-${i}`,
    data: { track: t, artistName: t.artist }
  }));
  resolutionScheduler.updateVisibility('spinoff', poolTracks);
};
```

**Step 2: Update pool visibility when track advances**

In `handleNext` where spinoff tracks are consumed (around line 7172):

```javascript
if (spinoffModeRef.current && spinoffTracksRef.current.length > 0) {
  const nextSimilar = spinoffTracksRef.current.shift();

  // Update pool visibility for resolution
  const poolTracks = spinoffTracksRef.current.slice(0, 5).map((t, i) => ({
    key: `spinoff-${i}`,
    data: { track: t, artistName: t.artist }
  }));
  resolutionScheduler.updateVisibility('spinoff', poolTracks);
  resolutionScheduler.setPlaybackIndex('spinoff', 0);

  // ... rest of logic
}
```

**Step 3: Unregister pool on exit**

In `exitSpinoff` function (around line 14355):

```javascript
const exitSpinoff = () => {
  // Abort and unregister pool context
  resolutionScheduler.abortContext('spinoff');
  resolutionScheduler.unregisterContext?.('spinoff');

  // ... existing exit logic ...
};
```

**Step 4: Similar pattern for listen-along**

Apply same pattern to listen-along using 'listen-along' as context ID.

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat: integrate resolution scheduler with spinoff and listen-along pools"
```

---

## Task 9: Integrate Scheduler with Sidebar Friends

**Files:**
- Modify: `app.js` (friends sidebar rendering)

**Step 1: Find friends sidebar rendering**

Search for where pinned friends are rendered and add IntersectionObserver.

**Step 2: Register sidebar context**

```javascript
// Register sidebar context for friend tracks resolution
useEffect(() => {
  return resolutionScheduler.registerSidebarContext('friends-sidebar');
}, []);
```

**Step 3: Track visibility of friend entries**

Use IntersectionObserver on friend entries:

```javascript
const friendEntryRefs = useRef(new Map());

useEffect(() => {
  const observer = new IntersectionObserver(
    (entries) => {
      const visibleFriends = [];
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const friendId = entry.target.dataset.friendId;
          const friend = sortedPinnedFriends.find(f => f.id === friendId);
          if (friend?.cachedRecentTrack) {
            visibleFriends.push({
              key: `friend-${friendId}`,
              data: {
                track: friend.cachedRecentTrack,
                artistName: friend.cachedRecentTrack.artist
              }
            });
          }
        }
      });
      resolutionScheduler.updateVisibility('friends-sidebar', visibleFriends);
    },
    { rootMargin: '50px' }
  );

  friendEntryRefs.current.forEach(el => el && observer.observe(el));

  return () => observer.disconnect();
}, [sortedPinnedFriends]);
```

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat: integrate resolution scheduler with friends sidebar"
```

---

## Task 10: Remove Old Resolution Functions

**Files:**
- Modify: `app.js`

**Step 1: Remove resolveAllTracks**

The `resolveAllTracks` function (around line 9752-9778) is replaced by the scheduler. Remove it and update any callers to use the scheduler's page context.

**Step 2: Remove resolveQueueTracks**

The `resolveQueueTracks` function (around line 9784-9900) is replaced by the scheduler's queue context. Remove it and update callers.

**Step 3: Update resolveLibraryTracks**

The `resolveLibraryTracks` effect (around line 10297) should now use the scheduler:

```javascript
// Effect to resolve library and collection tracks when they change
useEffect(() => {
  // This is now handled by the page context when viewing collection
  // No need for blanket resolution of all tracks
}, []);
```

**Step 4: Clean up queueResolutionActiveRef**

This ref is no longer needed since the scheduler handles priorities. Remove it and its usages.

**Step 5: Commit**

```bash
git add app.js
git commit -m "refactor: remove old resolution functions, use scheduler exclusively"
```

---

## Task 11: Test End-to-End

**Files:**
- Manual testing

**Step 1: Test collection tracks resolution**

1. Open app with large Collected Songs list
2. Verify only visible tracks + buffer are being resolved (check console logs)
3. Scroll and verify new tracks resolve, old ones stop
4. Navigate away and verify resolution stops (after current batch)

**Step 2: Test queue resolution**

1. Add many tracks to queue
2. Verify playback lookahead (next 5) always resolves
3. Scroll queue and verify visibility-based resolution
4. Remove track from queue and verify its resolution aborts

**Step 3: Test hover priority**

1. Hover over a track in collection
2. Verify it gets prioritized (resolves faster than other page tracks)
3. Click to add to queue
4. Verify it becomes queue priority

**Step 4: Test spinoff pool**

1. Start spinoff
2. Verify next 5 similar tracks are resolved
3. Play through tracks and verify pool updates resolution

**Step 5: Commit test results**

```bash
git add .
git commit -m "test: verify viewport-based resolution works end-to-end"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Create ResolutionScheduler module | resolution-scheduler.js, tests/ |
| 2 | Add batch completion support | resolution-scheduler.js |
| 3 | Add queue playback lookahead | resolution-scheduler.js |
| 4 | Integrate AbortSignal into resolveTrack | app.js |
| 5 | Create useResolutionScheduler hook | app.js |
| 6 | Integrate with VirtualizedQueueList | app.js |
| 7 | Integrate with collection track list | app.js |
| 8 | Integrate with spinoff/listen-along | app.js |
| 9 | Integrate with friends sidebar | app.js |
| 10 | Remove old resolution functions | app.js |
| 11 | End-to-end testing | manual |

Each task is designed to be completed independently with its own commit, making it easy to review progress and roll back if needed.
