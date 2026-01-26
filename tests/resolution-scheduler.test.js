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
