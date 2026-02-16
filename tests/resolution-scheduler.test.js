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

// Test: Priority promotion for already-pending tracks from lower-priority context
test('updateVisibility promotes priority for tracks already pending from background', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('background', 'background');
  scheduler.registerContext('page-1', 'page');

  // Background pre-resolution enqueues tracks at background priority (6)
  scheduler.enqueue('track-a', 'background', { title: 'Track A' });
  scheduler.enqueue('track-b', 'background', { title: 'Track B' });

  // Verify they have background priority
  let next = scheduler.peekNext();
  assertEqual(next.priority, CONTEXT_PRIORITY.background, 'initially background priority');

  // User navigates to playlist — page visibility update sees the same tracks
  scheduler.updateVisibility('page-1', [
    { key: 'track-a', data: { title: 'Track A' } },
    { key: 'track-b', data: { title: 'Track B' } }
  ]);

  // Tracks should now have page priority (4), not background (6)
  next = scheduler.peekNext();
  assertEqual(next.priority, CONTEXT_PRIORITY.page, 'promoted to page priority');
});

// Test: Same-priority tracks are ordered by visibility index (top-to-bottom)
test('Same-priority tracks resolve in visibility order (top first)', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');

  // Enqueue tracks with explicit visibility indices (simulating bottom-first insertion)
  scheduler.enqueue('track-bottom', 'page-1', { title: 'Bottom Track' }, 2);
  scheduler.enqueue('track-middle', 'page-1', { title: 'Middle Track' }, 1);
  scheduler.enqueue('track-top', 'page-1', { title: 'Top Track' }, 0);

  // Despite bottom being inserted first, top should be picked first
  const next = scheduler.peekNext();
  assertEqual(next.trackKey, 'track-top', 'top track (visibilityIndex 0) should be first');

  scheduler.dequeue('track-top');
  const second = scheduler.peekNext();
  assertEqual(second.trackKey, 'track-middle', 'middle track (visibilityIndex 1) should be second');

  scheduler.dequeue('track-middle');
  const third = scheduler.peekNext();
  assertEqual(third.trackKey, 'track-bottom', 'bottom track (visibilityIndex 2) should be third');
});

// Test: updateVisibility enqueues tracks with correct visibility indices
test('updateVisibility assigns visibility indices in list order', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('page-1', 'page');

  scheduler.updateVisibility('page-1', [
    { key: 'track-1', data: { title: 'First' } },
    { key: 'track-2', data: { title: 'Second' } },
    { key: 'track-3', data: { title: 'Third' } }
  ]);

  // First track in the visibility list should be picked first
  const next = scheduler.peekNext();
  assertEqual(next.trackKey, 'track-1', 'first visible track should be picked first');
});

// Test: Background tracks at bottom don't resolve before promoted top tracks
test('Promoted top tracks resolve before unpromoted bottom background tracks', () => {
  const scheduler = new ResolutionScheduler();

  scheduler.registerContext('background', 'background');
  scheduler.registerContext('page-1', 'page');

  // Background enqueues tracks 1-5 (simulating pre-resolution)
  scheduler.enqueue('track-1', 'background', { title: 'Track 1' });
  scheduler.enqueue('track-2', 'background', { title: 'Track 2' });
  scheduler.enqueue('track-3', 'background', { title: 'Track 3' });
  scheduler.enqueue('track-4', 'background', { title: 'Track 4' });
  scheduler.enqueue('track-5', 'background', { title: 'Track 5' });

  // User opens playlist, viewport shows tracks 1-3
  scheduler.updateVisibility('page-1', [
    { key: 'track-1', data: { title: 'Track 1' } },
    { key: 'track-2', data: { title: 'Track 2' } },
    { key: 'track-3', data: { title: 'Track 3' } }
  ]);

  // Tracks 1-3 should be promoted to page priority and resolve before 4-5
  const first = scheduler.peekNext();
  assertEqual(first.trackKey, 'track-1', 'promoted track-1 should be first');
  assertEqual(first.priority, CONTEXT_PRIORITY.page, 'should have page priority');

  scheduler.dequeue('track-1');
  const second = scheduler.peekNext();
  assertEqual(second.trackKey, 'track-2', 'promoted track-2 should be second');

  scheduler.dequeue('track-2');
  const third = scheduler.peekNext();
  assertEqual(third.trackKey, 'track-3', 'promoted track-3 should be third');

  scheduler.dequeue('track-3');
  const fourth = scheduler.peekNext();
  // Tracks 4-5 still at background priority, but should still resolve
  assertEqual(fourth.trackKey, 'track-4', 'background track-4 should be fourth');
  assertEqual(fourth.priority, CONTEXT_PRIORITY.background, 'should still have background priority');
});

// Summary
console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
