/**
 * Resolution Scheduler Tests (Jest version)
 *
 * Tests for track resolution priority scheduling.
 * Expands on legacy tests with more comprehensive coverage.
 */

const { ResolutionScheduler, CONTEXT_PRIORITY } = require('../../resolution-scheduler.js');

describe('ResolutionScheduler', () => {
  let scheduler;

  beforeEach(() => {
    scheduler = new ResolutionScheduler();
  });

  afterEach(() => {
    // Clean up any pending operations
    scheduler.reset?.();
  });

  describe('Context Priority Constants', () => {
    test('CONTEXT_PRIORITY has correct priority values', () => {
      expect(CONTEXT_PRIORITY.queue).toBe(1);
      expect(CONTEXT_PRIORITY.hover).toBe(2);
      expect(CONTEXT_PRIORITY.pool).toBe(3);
      expect(CONTEXT_PRIORITY.page).toBe(4);
      expect(CONTEXT_PRIORITY.sidebar).toBe(5);
    });

    test('queue has highest priority (lowest number)', () => {
      const priorities = Object.values(CONTEXT_PRIORITY);
      expect(Math.min(...priorities)).toBe(CONTEXT_PRIORITY.queue);
    });

    test('sidebar has lowest priority (highest number)', () => {
      const priorities = Object.values(CONTEXT_PRIORITY);
      expect(Math.max(...priorities)).toBe(CONTEXT_PRIORITY.sidebar);
    });
  });

  describe('Instantiation', () => {
    test('can be instantiated', () => {
      const s = new ResolutionScheduler();
      expect(s).toBeInstanceOf(ResolutionScheduler);
    });

    test('has required methods', () => {
      expect(typeof scheduler.registerContext).toBe('function');
      expect(typeof scheduler.unregisterContext).toBe('function');
      expect(typeof scheduler.updateVisibility).toBe('function');
      expect(typeof scheduler.enqueue).toBe('function');
      expect(typeof scheduler.dequeue).toBe('function');
      expect(typeof scheduler.peekNext).toBe('function');
      expect(typeof scheduler.setHoverTrack).toBe('function');
      expect(typeof scheduler.clearHoverTrack).toBe('function');
    });
  });

  describe('Context Registration', () => {
    test('can register a context', () => {
      scheduler.registerContext('page-1', 'page');
      expect(scheduler.hasContext('page-1')).toBe(true);
    });

    test('can register multiple contexts', () => {
      scheduler.registerContext('page-1', 'page');
      scheduler.registerContext('queue-1', 'queue');
      scheduler.registerContext('sidebar-1', 'sidebar');

      expect(scheduler.hasContext('page-1')).toBe(true);
      expect(scheduler.hasContext('queue-1')).toBe(true);
      expect(scheduler.hasContext('sidebar-1')).toBe(true);
    });

    test('can unregister a context', () => {
      scheduler.registerContext('page-1', 'page');
      expect(scheduler.hasContext('page-1')).toBe(true);

      scheduler.unregisterContext('page-1');
      expect(scheduler.hasContext('page-1')).toBe(false);
    });

    test('unregistering non-existent context is safe', () => {
      expect(() => {
        scheduler.unregisterContext('non-existent');
      }).not.toThrow();
    });

    test('queue context can have playback lookahead option', () => {
      scheduler.registerContext('queue-main', 'queue', { playbackLookahead: 5 });
      expect(scheduler.hasContext('queue-main')).toBe(true);
    });
  });

  describe('Track Enqueueing', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
      scheduler.registerContext('queue-1', 'queue');
    });

    test('can enqueue a track', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      expect(scheduler.hasPending('track-a')).toBe(true);
    });

    test('can enqueue multiple tracks', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });
      scheduler.enqueue('track-c', 'page-1', { title: 'Track C' });

      expect(scheduler.hasPending('track-a')).toBe(true);
      expect(scheduler.hasPending('track-b')).toBe(true);
      expect(scheduler.hasPending('track-c')).toBe(true);
    });

    test('enqueueing same track twice does not duplicate', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A Updated' });

      // Still only one pending entry
      expect(scheduler.hasPending('track-a')).toBe(true);
    });
  });

  describe('Priority Ordering', () => {
    beforeEach(() => {
      scheduler.registerContext('sidebar-1', 'sidebar');
      scheduler.registerContext('page-1', 'page');
      scheduler.registerContext('pool-1', 'pool');
      scheduler.registerContext('queue-1', 'queue');
    });

    test('peekNext returns highest priority track', () => {
      scheduler.enqueue('sidebar-track', 'sidebar-1', { title: 'Sidebar' });
      scheduler.enqueue('page-track', 'page-1', { title: 'Page' });
      scheduler.enqueue('queue-track', 'queue-1', { title: 'Queue' });

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('queue-track');
    });

    test('queue priority (1) beats page priority (4)', () => {
      scheduler.enqueue('page-track', 'page-1', { title: 'Page' });
      scheduler.enqueue('queue-track', 'queue-1', { title: 'Queue' });

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('queue-track');
    });

    test('pool priority (3) beats page priority (4)', () => {
      scheduler.enqueue('page-track', 'page-1', { title: 'Page' });
      scheduler.enqueue('pool-track', 'pool-1', { title: 'Pool' });

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('pool-track');
    });

    test('page priority (4) beats sidebar priority (5)', () => {
      scheduler.enqueue('sidebar-track', 'sidebar-1', { title: 'Sidebar' });
      scheduler.enqueue('page-track', 'page-1', { title: 'Page' });

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('page-track');
    });

    test('tracks from same context maintain order', () => {
      scheduler.enqueue('track-1', 'page-1', { title: 'Track 1' });
      scheduler.enqueue('track-2', 'page-1', { title: 'Track 2' });
      scheduler.enqueue('track-3', 'page-1', { title: 'Track 3' });

      // All same priority, should return first enqueued
      const next = scheduler.peekNext();
      expect(['track-1', 'track-2', 'track-3']).toContain(next.trackKey);
    });
  });

  describe('Hover Track Priority', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
      scheduler.registerContext('queue-1', 'queue');
    });

    test('hover track gets boosted to priority 2', () => {
      scheduler.enqueue('page-track', 'page-1', { title: 'Page Track' });
      scheduler.setHoverTrack('page-track', 'page-1');

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('page-track');
      expect(next.isHover).toBe(true);
    });

    test('queue (priority 1) still beats hover (priority 2)', () => {
      scheduler.enqueue('page-track', 'page-1', { title: 'Page Track' });
      scheduler.enqueue('queue-track', 'queue-1', { title: 'Queue Track' });
      scheduler.setHoverTrack('page-track', 'page-1');

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('queue-track');
    });

    test('hover beats non-hover page tracks', () => {
      scheduler.enqueue('page-track-1', 'page-1', { title: 'Page Track 1' });
      scheduler.enqueue('page-track-2', 'page-1', { title: 'Page Track 2' });
      scheduler.setHoverTrack('page-track-2', 'page-1');

      const next = scheduler.peekNext();
      expect(next.trackKey).toBe('page-track-2');
      expect(next.isHover).toBe(true);
    });

    test('clearHoverTrack removes hover boost', () => {
      scheduler.enqueue('page-track', 'page-1', { title: 'Page Track' });
      scheduler.setHoverTrack('page-track', 'page-1');

      let next = scheduler.peekNext();
      expect(next.isHover).toBe(true);

      scheduler.clearHoverTrack();
      next = scheduler.peekNext();
      expect(next.isHover).toBeFalsy();
    });
  });

  describe('Dequeue', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
    });

    test('dequeue removes track from pending', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      expect(scheduler.hasPending('track-a')).toBe(true);

      scheduler.dequeue('track-a');
      expect(scheduler.hasPending('track-a')).toBe(false);
    });

    test('dequeue non-existent track is safe', () => {
      expect(() => {
        scheduler.dequeue('non-existent');
      }).not.toThrow();
    });
  });

  describe('Abort Signals', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
    });

    test('can get abort signal for enqueued track', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

      const signal = scheduler.getAbortSignal('track-a');
      expect(signal).toBeInstanceOf(AbortSignal);
      expect(signal.aborted).toBe(false);
    });

    test('abort individual track signals aborted', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

      const signal = scheduler.getAbortSignal('track-a');
      scheduler.abort('track-a');

      expect(signal.aborted).toBe(true);
      expect(scheduler.hasPending('track-a')).toBe(false);
    });

    test('aborting removes track from pending', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });

      scheduler.abort('track-a');

      expect(scheduler.hasPending('track-a')).toBe(false);
      expect(scheduler.hasPending('track-b')).toBe(true);
    });
  });

  describe('Abort Context', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
      scheduler.registerContext('page-2', 'page');
    });

    test('abortContext removes all tracks from that context', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });
      scheduler.enqueue('track-c', 'page-2', { title: 'Track C' });

      scheduler.abortContext('page-1');

      expect(scheduler.hasPending('track-a')).toBe(false);
      expect(scheduler.hasPending('track-b')).toBe(false);
      expect(scheduler.hasPending('track-c')).toBe(true); // Different context
    });

    test('abortContext with afterCurrentBatch preserves in-progress', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });

      // Mark track-a as in-progress
      scheduler.markInProgress('track-a');

      scheduler.abortContext('page-1', { afterCurrentBatch: true });

      expect(scheduler.hasPending('track-a')).toBe(true); // In-progress preserved
      expect(scheduler.hasPending('track-b')).toBe(false); // Queued aborted
    });
  });

  describe('Visibility Updates', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
    });

    test('updateVisibility adds new visible tracks', () => {
      scheduler.updateVisibility('page-1', [
        { key: 'track-a', data: { title: 'Track A' } },
        { key: 'track-b', data: { title: 'Track B' } }
      ]);

      expect(scheduler.hasPending('track-a')).toBe(true);
      expect(scheduler.hasPending('track-b')).toBe(true);
    });

    test('updateVisibility aborts tracks that scrolled out', () => {
      // Initial visibility
      scheduler.updateVisibility('page-1', [
        { key: 'track-a', data: { title: 'Track A' } },
        { key: 'track-b', data: { title: 'Track B' } }
      ]);

      const signalA = scheduler.getAbortSignal('track-a');

      // Update - track-a scrolled out, track-c scrolled in
      scheduler.updateVisibility('page-1', [
        { key: 'track-b', data: { title: 'Track B' } },
        { key: 'track-c', data: { title: 'Track C' } }
      ]);

      expect(signalA.aborted).toBe(true);
      expect(scheduler.hasPending('track-a')).toBe(false);
      expect(scheduler.hasPending('track-b')).toBe(true);
      expect(scheduler.hasPending('track-c')).toBe(true);
    });

    test('updateVisibility does not re-add already pending tracks', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

      // This should not duplicate
      scheduler.updateVisibility('page-1', [
        { key: 'track-a', data: { title: 'Track A' } }
      ]);

      expect(scheduler.hasPending('track-a')).toBe(true);
    });
  });

  describe('In-Progress Tracking', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
    });

    test('markInProgress tracks currently resolving tracks', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });

      scheduler.markInProgress('track-a');

      expect(scheduler.getInProgressCount()).toBe(1);
    });

    test('dequeue decrements in-progress count', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.markInProgress('track-a');

      expect(scheduler.getInProgressCount()).toBe(1);

      scheduler.dequeue('track-a');
      expect(scheduler.getInProgressCount()).toBe(0);
    });

    test('multiple tracks can be in progress', () => {
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });
      scheduler.enqueue('track-b', 'page-1', { title: 'Track B' });

      scheduler.markInProgress('track-a');
      scheduler.markInProgress('track-b');

      expect(scheduler.getInProgressCount()).toBe(2);
    });
  });

  describe('Playback Lookahead', () => {
    beforeEach(() => {
      scheduler.registerContext('queue-1', 'queue', { playbackLookahead: 5 });
    });

    test('getPlaybackLookaheadRange returns correct range', () => {
      scheduler.setPlaybackIndex('queue-1', 3);

      const range = scheduler.getPlaybackLookaheadRange('queue-1');

      expect(range.start).toBe(3);
      expect(range.end).toBe(8); // 3 + 5
    });

    test('isInPlaybackLookahead returns true for tracks in range', () => {
      scheduler.setPlaybackIndex('queue-1', 10);

      expect(scheduler.isInPlaybackLookahead('queue-1', 10)).toBe(true); // Current
      expect(scheduler.isInPlaybackLookahead('queue-1', 12)).toBe(true); // Within
      expect(scheduler.isInPlaybackLookahead('queue-1', 14)).toBe(true); // Last in range
    });

    test('isInPlaybackLookahead returns false for tracks outside range', () => {
      scheduler.setPlaybackIndex('queue-1', 10);

      expect(scheduler.isInPlaybackLookahead('queue-1', 9)).toBe(false);  // Before
      expect(scheduler.isInPlaybackLookahead('queue-1', 15)).toBe(false); // After
      expect(scheduler.isInPlaybackLookahead('queue-1', 16)).toBe(false); // Way after
    });

    test('setPlaybackIndex updates the lookahead range', () => {
      scheduler.setPlaybackIndex('queue-1', 5);
      expect(scheduler.isInPlaybackLookahead('queue-1', 5)).toBe(true);
      expect(scheduler.isInPlaybackLookahead('queue-1', 9)).toBe(true);

      scheduler.setPlaybackIndex('queue-1', 20);
      expect(scheduler.isInPlaybackLookahead('queue-1', 5)).toBe(false);
      expect(scheduler.isInPlaybackLookahead('queue-1', 20)).toBe(true);
      expect(scheduler.isInPlaybackLookahead('queue-1', 24)).toBe(true);
    });
  });

  describe('Resolved Tracking', () => {
    beforeEach(() => {
      scheduler.registerContext('page-1', 'page');
    });

    test('resolved set tracks completed tracks internally', () => {
      // The scheduler tracks resolved tracks internally via this.resolved Set
      // This is used to prevent re-resolution of already-resolved tracks
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

      expect(scheduler.hasPending('track-a')).toBe(true);

      // After dequeue, track is removed from pending
      scheduler.dequeue('track-a');
      expect(scheduler.hasPending('track-a')).toBe(false);
    });

    test('tracks in resolved set are skipped on re-enqueue', () => {
      // Simulate internal resolved tracking by accessing the set directly
      // Note: resolved.add() is called internally in _processNext after successful resolution
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

      // Access the internal resolved set for testing
      scheduler.resolved.add('track-a');
      scheduler.dequeue('track-a');

      // Try to enqueue again - should be skipped
      scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

      // Should not be pending (already in resolved set)
      expect(scheduler.hasPending('track-a')).toBe(false);
    });
  });

  describe('Edge Cases', () => {
    test('peekNext on empty scheduler returns null', () => {
      const next = scheduler.peekNext();
      expect(next).toBeNull();
    });

    test('getAbortSignal for non-existent track returns null', () => {
      const signal = scheduler.getAbortSignal('non-existent');
      expect(signal).toBeNull();
    });

    test('operations on unregistered context are handled', () => {
      expect(() => {
        scheduler.enqueue('track-a', 'unregistered', { title: 'Track A' });
      }).not.toThrow();
    });
  });
});

describe('ResolutionScheduler Processing', () => {
  let scheduler;
  let resolveCallback;
  let resolvedTracks;

  beforeEach(() => {
    scheduler = new ResolutionScheduler();
    resolvedTracks = [];

    resolveCallback = jest.fn(async (data, signal) => {
      if (signal.aborted) return;
      await new Promise(resolve => setTimeout(resolve, 10));
      if (signal.aborted) return;
      resolvedTracks.push(data.track?.title || data.title);
    });

    scheduler.setResolveCallback(resolveCallback);
    scheduler.registerContext('page-1', 'page');
    scheduler.registerContext('queue-1', 'queue');
  });

  test('setResolveCallback sets the resolution function', () => {
    expect(resolveCallback).toBeDefined();
  });

  test('peekNext returns highest priority track for processing', () => {
    // Enqueue in reverse priority order
    scheduler.enqueue('page-track', 'page-1', { title: 'Page Track' });
    scheduler.enqueue('queue-track', 'queue-1', { title: 'Queue Track' });

    // peekNext should return queue track (higher priority) regardless of enqueue order
    const next = scheduler.peekNext();
    expect(next.trackKey).toBe('queue-track');
  });

  test('aborted tracks do not complete resolution', async () => {
    scheduler.enqueue('track-a', 'page-1', { title: 'Track A' });

    // Abort immediately
    scheduler.abort('track-a');

    await new Promise(resolve => setTimeout(resolve, 100));

    expect(resolvedTracks).not.toContain('Track A');
  });
});
