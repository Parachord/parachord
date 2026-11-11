/**
 * Repeat off / all / one (parachord#1319 item 1), the mobile apps' shared
 * QueueAdvancePolicy (parachord-mobile shared/.../playback/QueueAdvancePolicy.kt
 * and QueueManager.wrapToStart). Desktop's repeat button was a commented-out
 * placeholder.
 *   - repeat one replays a track that ended; Next always moves on;
 *   - repeat all wraps at the end of the queue on a track end, on Next, and on
 *     an unplayable last track, but only after something played since the
 *     last wrap, so a queue where nothing plays can't loop;
 *   - the wrap covers this queue's tracks only: history from an earlier queue,
 *     spinoff pool tracks and Listen Along tracks stay out (_offLap);
 *   - repeat can't be changed during a spinoff or Listen Along.
 */
const fs = require('fs');
const path = require('path');

const {
  REPEAT_MODES, nextRepeatMode, normalizeRepeatMode, advanceAction,
  markOffLap, withoutLapMark, repeatLap, REPEAT_UNAVAILABLE_MESSAGE,
  repeatModeFromLoop, loopFromRepeatMode,
} = require('../../src/renderer/lib/playback-helpers');

const root = path.join(__dirname, '../..');
const app = fs.readFileSync(path.join(root, 'src/renderer/app.js'), 'utf8');
const engine = fs.readFileSync(path.join(root, 'src/renderer/hooks/use-playback-engine.js'), 'utf8');
const queueHook = fs.readFileSync(path.join(root, 'src/renderer/hooks/use-playback-queue.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'main-process/ipc/store.js'), 'utf8');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a === -1) throw new Error(`not found: ${from}`);
  const b = src.indexOf(to, a + from.length);
  if (b === -1) throw new Error(`not found: ${to}`);
  return src.slice(a, b);
};

describe('the repeat button cycles off, all, one, off', () => {
  test('the modes and the cycle', () => {
    expect(REPEAT_MODES).toEqual(['off', 'all', 'one']);
    expect(nextRepeatMode('off')).toBe('all');
    expect(nextRepeatMode('all')).toBe('one');
    expect(nextRepeatMode('one')).toBe('off');
  });
  test('anything else reads as off', () => {
    expect(normalizeRepeatMode(undefined)).toBe('off');
    expect(normalizeRepeatMode('loop')).toBe('off');
    expect(nextRepeatMode(null)).toBe('all');
  });
  test('MPRIS LoopStatus maps both ways', () => {
    expect(repeatModeFromLoop('track')).toBe('one');
    expect(repeatModeFromLoop('playlist')).toBe('all');
    expect(repeatModeFromLoop('none')).toBe('off');
    expect(loopFromRepeatMode('one')).toBe('track');
    expect(loopFromRepeatMode('all')).toBe('playlist');
    expect(loopFromRepeatMode('off')).toBe('none');
  });
});

describe('advanceAction, mobile\'s rule', () => {
  const base = { hasNext: true, hasCurrent: true, playedSinceWrap: true };
  test('a track that ended plays the next one', () => {
    expect(advanceAction({ ...base, trigger: 'ended', repeatMode: 'off' })).toBe('next');
  });
  test('only a track that ended replays under repeat one; Next and a failure move on', () => {
    expect(advanceAction({ ...base, trigger: 'ended', repeatMode: 'one' })).toBe('replay');
    expect(advanceAction({ ...base, trigger: 'next', repeatMode: 'one' })).toBe('next');
    expect(advanceAction({ ...base, trigger: 'unplayable', repeatMode: 'one' })).toBe('next');
  });
  test('repeat one with no current track plays the next', () => {
    expect(advanceAction({ ...base, hasCurrent: false, trigger: 'ended', repeatMode: 'one' })).toBe('next');
  });
  test('the end of the queue stops with repeat off or one (on Next)', () => {
    expect(advanceAction({ ...base, hasNext: false, trigger: 'ended', repeatMode: 'off' })).toBe('stop');
    expect(advanceAction({ ...base, hasNext: false, trigger: 'next', repeatMode: 'one' })).toBe('stop');
  });
  test('repeat all wraps on a track end and on Next', () => {
    expect(advanceAction({ ...base, hasNext: false, trigger: 'ended', repeatMode: 'all' })).toBe('wrap');
    expect(advanceAction({ ...base, hasNext: false, trigger: 'next', repeatMode: 'all' })).toBe('wrap');
    expect(advanceAction({ ...base, hasNext: false, playedSinceWrap: false, trigger: 'next', repeatMode: 'all' })).toBe('wrap');
  });
  test('an unplayable skip at the end wraps only when something played since the last wrap', () => {
    expect(advanceAction({ ...base, hasNext: false, trigger: 'unplayable', repeatMode: 'all' })).toBe('wrap');
    expect(advanceAction({ ...base, hasNext: false, playedSinceWrap: false, trigger: 'unplayable', repeatMode: 'all' })).toBe('stop');
  });
});

describe('the lap', () => {
  const a = { id: 'a', title: 'A' };
  const b = { id: 'b', title: 'B' };
  const c = { id: 'c', title: 'C' };
  const d = { id: 'd', title: 'D' };

  test('history, the current track and the queue, in played order', () => {
    const lap = repeatLap({ history: [a, b], current: c, queue: [d], shuffle: false });
    expect(lap.first).toBe(a);
    expect(lap.rest).toEqual([b, c, d]);
    expect(lap.originalOrder).toBeNull();
  });

  test('tracks out of the lap stay out', () => {
    const old = markOffLap({ id: 'old', title: 'From an earlier queue' });
    const pool = markOffLap({ id: 'p', title: 'Spinoff pool track' });
    const lap = repeatLap({ history: [old, a, b], current: pool, queue: [], shuffle: false });
    expect([lap.first, ...lap.rest].map(t => t.id)).toEqual(['a', 'b']);
  });

  test('nothing in the lap is nothing to wrap', () => {
    expect(repeatLap({ history: [markOffLap(a)], current: null, queue: [], shuffle: false })).toBeNull();
  });

  test('a track that failed before gets another try', () => {
    const lap = repeatLap({ history: [a], current: null, queue: [{ ...b, status: 'error' }], shuffle: false });
    expect(lap.rest[0]).toEqual({ id: 'b', title: 'B' });
  });

  test('with shuffle on, every track once, and the original order is the rest in played order', () => {
    const random = () => 0; // Fisher-Yates with 0 rotates: deterministic
    const lap = repeatLap({ history: [a, b], current: c, queue: [], shuffle: true, random });
    const ids = [lap.first, ...lap.rest].map(t => t.id).sort();
    expect(ids).toEqual(['a', 'b', 'c']);
    expect(lap.originalOrder.map(t => t.id)).toEqual(['a', 'b', 'c'].filter(id => id !== lap.first.id));
  });

  test('wrapping a single track replays it', () => {
    const lap = repeatLap({ history: [], current: a, queue: [], shuffle: true });
    expect(lap.first).toBe(a);
    expect(lap.rest).toEqual([]);
    expect(lap.originalOrder).toBeNull();
  });

  test('the mark comes off a track that joins a new queue', () => {
    expect(withoutLapMark(markOffLap(a))).toEqual(a);
    expect(withoutLapMark(a)).toBe(a);
    expect(markOffLap(markOffLap(a))._offLap).toBe(true);
  });
});

describe('handleNext asks the rule', () => {
  const next = between(engine, 'const handleNext = async (', 'const handlePrevious = async () => {');

  test('it knows what moved the queue', () => {
    expect(next).toMatch(/const handleNext = async \(userInitiated = false, \{ trigger = 'next' \} = \{\}\) => \{/);
    expect(next).toMatch(/let advanceTrigger = userInitiated \? 'next' : trigger;/);
  });

  test('leaving a spinoff or Listen Along goes back to the queue, never replays its last track', () => {
    expect((next.match(/advanceTrigger = leaveSessionTrigger\(advanceTrigger\);/g) || []).length).toBe(3);
  });

  test('spinoff pool tracks are out of the lap', () => {
    expect(next).toMatch(/handlePlay\(\{\s*\.\.\.nextSimilar,\s*_offLap: true,/);
  });

  test('replay, wrap, stop or play the next', () => {
    expect(next).toMatch(/const action = advanceAction\(\{\s*trigger: advanceTrigger,\s*repeatMode: repeatModeRef\.current,\s*hasNext: nextTrackIndex !== -1,\s*hasCurrent: !!track,\s*playedSinceWrap: playedSinceWrapRef\.current\s*\}\);/);
    expect(next).toMatch(/if \(action === 'replay'\) \{[\s\S]{0,200}?handlePlay\(track\);\s*return;/);
    expect(next).toMatch(/const lap = repeatLap\(\{ history: playHistoryRef\.current, current: track, queue, shuffle: shuffleModeRef\.current \}\);/);
    expect(next).toMatch(/playHistoryRef\.current = \[\];\s*playedSinceWrapRef\.current = false;\s*originalQueueRef\.current = lap\.originalOrder;\s*setCurrentQueue\(lap\.rest\);/);
    expect(next).toMatch(/if \(action === 'stop'\) \{\s*endOfQueue\(/);
  });

  test('a track that starts playing counts as played since the wrap', () => {
    expect((engine.match(/playedSinceWrapRef\.current = true;/g) || []).length).toBe(6);
  });
});

describe('every caller says what moved the queue', () => {
  test('a track that ended', () => {
    expect((engine.match(/handleNextRef\.current\?\.\(false, \{ trigger: 'ended' \}\);/g) || []).length).toBe(2);
    expect((app.match(/handleNextRef\.current\(false, \{ trigger: 'ended' \}\)/g) || []).length).toBe(6);
  });
  test('a track that couldn\'t play', () => {
    expect((engine.match(/handleNextRef\.current\(false, \{ trigger: 'unplayable' \}\)/g) || []).length).toBe(2);
    expect(engine).toMatch(/handleNextRef\.current\?\.\(false, \{ trigger: 'unplayable' \}\);/);
    expect((app.match(/handleNext\(false, \{ trigger: 'unplayable' \}\);/g) || []).length).toBe(3);
  });
});

describe('a new queue starts a new lap', () => {
  test('history from before it leaves the lap, and nothing has played yet', () => {
    expect(queueHook).toMatch(/const startNewLap = \(\) => \{\s*playHistoryRef\.current = playHistoryRef\.current\.map\(markOffLap\);\s*playedSinceWrapRef\.current = false;\s*\};/);
    for (const fn of ['const clearQueue = () => {', 'const setQueueWithContext = (', 'const playTrackCollection = (']) {
      const body = between(queueHook, fn, '\n  };\n');
      expect(body).toMatch(/startNewLap\(\);/);
    }
  });
  test('tracks joining a queue lose an old mark', () => {
    expect((queueHook.match(/withoutLapMark\(track\)/g) || []).length).toBeGreaterThanOrEqual(3);
  });
  test('Listen Along tracks are out of the lap', () => {
    expect(between(app, 'const listenAlongTrackFor = ', '\n  };\n')).toMatch(/_offLap: true/);
  });
});

describe('the button, MPRIS and persistence', () => {
  test('one door, refused during a spinoff or Listen Along', () => {
    const door = between(app, 'const requestRepeat = (want', 'const requestRepeatRef');
    expect(door).toMatch(/if \(!shuffleAllowed\(\{ spinoff: spinoffModeRef\.current, listenAlong: !!listenAlongFriendRef\.current \}\)\) \{\s*if \(toast\) showToast\(REPEAT_UNAVAILABLE_MESSAGE\);\s*return false;/);
    expect(door).toMatch(/const mode = want === 'cycle' \? nextRepeatMode\(repeatModeRef\.current\) : normalizeRepeatMode\(want\);/);
    expect(door).toMatch(/window\.electron\.store\.set\('repeat_mode', mode\)/);
    expect(REPEAT_UNAVAILABLE_MESSAGE).toBe("Repeat isn't available during a spinoff or Listen Along");
  });
  test('the playbar button cycles it and is disabled during a spinoff or Listen Along', () => {
    expect(app).not.toMatch(/Repeat \(coming soon\)/);
    expect(app).toMatch(/onClick: repeatDisabled \? undefined : \(\) => requestRepeat\('cycle'\),/);
  });
  test('MPRIS sets and shows it', () => {
    expect(app).toMatch(/case 'set-loop':[\s\S]{0,200}?if \(requestRepeatRef\.current\?\.\(repeatModeFromLoop\(event\.value\)\) === false\) \{/);
    expect(app).toMatch(/window\.electron\.mpris\.updateLoop\(loopFromRepeatMode\(repeatMode\)\)/);
  });
  test('the mode is saved and loaded', () => {
    expect(store).toMatch(/'repeat_mode'/);
    expect(app).toMatch(/'saved_queue', 'saved_queue_position', 'saved_playback_context', 'saved_shuffle_state', 'repeat_mode',/);
    expect(app).toMatch(/setRepeatMode\(d\['repeat_mode'\]\);/);
  });
});
