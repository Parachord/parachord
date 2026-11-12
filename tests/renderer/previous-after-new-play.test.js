/**
 * Previous reaches the track a play from outside the queue replaced (#1329,
 * the desktop half of parachord-mobile#605 / #630).
 *
 * Before: the play history grew only when the queue moved on (Next, the end
 * of the queue). A track row, a DJ play or a parachord://play link replaced
 * the current track without recording it, so Previous skipped past it.
 * Now, as in mobile's shared QueueManager:
 *   - a play that replaces the current track puts that track on history, out
 *     of the repeat-all lap (Previous reaches it, repeat all doesn't wrap it);
 *   - playing the same track again adds nothing;
 *   - a jump within the queue (the queue panel) keeps the outgoing track in
 *     the lap, like Next;
 *   - history is capped at 200, dropping the oldest out-of-lap entries first
 *     and never the current lap.
 */

const fs = require('fs');
const path = require('path');
const {
  PLAY_HISTORY_MAX,
  isSameTrack,
  trimPlayHistory,
  pushPlayHistory,
  historyForReplacedTrack,
  trackBehindPlaceholder,
  repeatLap
} = require('../../src/renderer/lib/playback-helpers');

const t = (id, extra = {}) => ({ id, title: `T${id}`, artist: 'A', ...extra });

describe('play history helpers', () => {
  test('a replaced track goes on top of history, out of the lap', () => {
    const history = [t('a'), t('b')];
    const next = historyForReplacedTrack(history, t('c'), t('x'));
    expect(next.map(e => e.id)).toEqual(['a', 'b', 'c']);
    expect(next[2]._offLap).toBe(true);
    expect(next[0]._offLap).toBeUndefined();
    // The input isn't mutated.
    expect(history).toHaveLength(2);
  });

  test('the same track played again adds nothing (restart, repeat one, a source fallback)', () => {
    const history = [t('a')];
    expect(historyForReplacedTrack(history, t('c'), t('c', { preferredResolver: 'spotify' }))).toBe(history);
  });

  test('a link\'s loading placeholder never goes on history: the track behind it does', () => {
    const history = [t('a')];
    const placeholder = { id: '__protocol-loading-1', title: 'Loading album…', artist: '', status: 'resolving', _protocolLoading: true, _replaces: t('b') };
    const next = historyForReplacedTrack(history, placeholder, t('x'));
    expect(next.map(e => e.id)).toEqual(['a', 'b']);
    expect(next[1]._offLap).toBe(true);
    // Nothing behind it (the playbar was empty): nothing to record.
    expect(historyForReplacedTrack(history, { ...placeholder, _replaces: null }, t('x'))).toBe(history);
    // The link plays the track that was behind it: nothing to record either.
    expect(historyForReplacedTrack(history, placeholder, t('b'))).toBe(history);
  });

  test('trackBehindPlaceholder sees through stacked placeholders', () => {
    const inner = { id: '__protocol-loading-1', _protocolLoading: true, _replaces: t('b') };
    const outer = { id: '__protocol-loading-2', _protocolLoading: true, _replaces: inner };
    expect(trackBehindPlaceholder(outer).id).toBe('b');
    expect(trackBehindPlaceholder(t('c')).id).toBe('c');
    expect(trackBehindPlaceholder(null)).toBeNull();
    expect(trackBehindPlaceholder({ _protocolLoading: true })).toBeNull();
  });

  test('nothing playing: nothing to record', () => {
    const history = [t('a')];
    expect(historyForReplacedTrack(history, null, t('x'))).toBe(history);
  });

  test('isSameTrack: by id, or by title and artist when neither has one', () => {
    expect(isSameTrack(t('a'), t('a'))).toBe(true);
    expect(isSameTrack(t('a'), t('b'))).toBe(false);
    expect(isSameTrack(t('a'), { title: 'Ta', artist: 'A' })).toBe(false);
    expect(isSameTrack({ title: 'Song', artist: 'Band' }, { title: 'song', artist: 'BAND' })).toBe(true);
    expect(isSameTrack({ title: 'Song', artist: 'Band' }, { title: 'Other', artist: 'Band' })).toBe(false);
  });

  test('the queue moving on keeps the outgoing track\'s lap mark', () => {
    expect(pushPlayHistory([], t('a'))[0]._offLap).toBeUndefined();
    expect(pushPlayHistory([], t('a', { _offLap: true }))[0]._offLap).toBe(true);
  });

  test('the cap drops the oldest out-of-lap entries first and never the lap', () => {
    expect(PLAY_HISTORY_MAX).toBe(200);
    const off = Array.from({ length: 5 }, (_, i) => t(`o${i}`, { _offLap: true }));
    const lap = Array.from({ length: 3 }, (_, i) => t(`l${i}`));
    const trimmed = trimPlayHistory([...off.slice(0, 3), ...lap, ...off.slice(3)], 6);
    expect(trimmed.map(e => e.id)).toEqual(['o2', 'l0', 'l1', 'l2', 'o3', 'o4']);
    // All lap, over the cap: nothing is dropped (repeat all keeps its lap).
    const allLap = Array.from({ length: 8 }, (_, i) => t(`l${i}`));
    expect(trimPlayHistory(allLap, 6)).toHaveLength(8);
    // Under the cap: the same array back.
    const small = [t('a')];
    expect(trimPlayHistory(small, 6)).toBe(small);
  });

  test('repeat all never wraps a replaced track', () => {
    // Queue A, B, C playing B; a track row plays X with its own queue Y.
    const history = historyForReplacedTrack([t('A')], t('B'), t('X'));
    const lap = repeatLap({ history, current: t('X'), queue: [t('Y')], shuffle: false });
    expect([lap.first, ...lap.rest].map(e => e.id)).toEqual(['A', 'X', 'Y']);
  });
});

describe('the engine wiring', () => {
  const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
  const lists = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/track-lists.js'), 'utf8');

  test('handlePlay records the track it replaces unless the caller already did', () => {
    const start = engine.slice(engine.indexOf('const handlePlay = async (trackOrSource, { historyHandled = false, fromQueue = false } = {}) => {'));
    expect(start.slice(0, 600)).toMatch(/if \(!historyHandled\) \{\s*const outgoing = currentTrackRef\.current;\s*playHistoryRef\.current = fromQueue\s*\? \(outgoing && !isSameTrack\(outgoing, trackOrSource\) \? pushPlayHistory\(playHistoryRef\.current, outgoing\) : playHistoryRef\.current\)\s*: historyForReplacedTrack\(playHistoryRef\.current, outgoing, trackOrSource\);/);
  });

  test('Next, Previous and the repeat-all wrap handle history themselves', () => {
    expect(engine).toMatch(/console\.log\(`➡️ Playing next track: [^\n]*\n\s*handlePlay\(nextTrack, \{ historyHandled: true \}\);/);
    expect(engine).toMatch(/console\.log\(`⬅️ Going back to previous track: [^\n]*\n\s*handlePlay\(previousTrack, \{ historyHandled: true \}\);/);
    expect(engine).toMatch(/setPlaybackContext\(lap\.first\._playbackContext \|\| null\);\s*handlePlay\(lap\.first, \{ historyHandled: true \}\);/);
  });

  test('every push to history goes through the capped helpers', () => {
    expect(engine).not.toMatch(/playHistoryRef\.current = \[\.\.\.playHistoryRef\.current/);
  });

  test('a queue-panel click is a jump within the queue', () => {
    expect(lists).toMatch(/setCurrentQueue\(prev => prev\.slice\(index \+ 1\)\);\s*handlePlay\(track, \{ fromQueue: true \}\);/);
  });
});
