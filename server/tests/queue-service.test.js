const QueueService = require('../services/queue-service');

function createMockStore() {
  const data = new Map();
  return {
    get: (key, def) => data.has(key) ? data.get(key) : def,
    set: (key, val) => data.set(key, val),
    delete: (key) => data.delete(key)
  };
}

function createMockWSManager() {
  return { broadcast: jest.fn(), send: jest.fn(), on: jest.fn(), off: jest.fn() };
}

describe('QueueService', () => {
  let queue;
  let wsManager;

  beforeEach(() => {
    wsManager = createMockWSManager();
    queue = new QueueService(createMockStore(), wsManager);
  });

  test('starts empty', () => {
    const state = queue.getState();
    expect(state.tracks).toEqual([]);
    expect(state.currentIndex).toBe(-1);
    expect(state.currentTrack).toBeNull();
  });

  test('addTracks adds to end', () => {
    queue.addTracks([
      { title: 'Song 1', artist: 'A' },
      { title: 'Song 2', artist: 'B' }
    ]);
    expect(queue.getState().length).toBe(2);
    expect(queue.getState().currentIndex).toBe(0);
  });

  test('addTracks with position next inserts after current', () => {
    queue.addTracks([{ title: 'First', artist: 'A' }, { title: 'Last', artist: 'A' }]);
    queue.addTracks([{ title: 'Inserted', artist: 'A' }], { position: 'next' });
    expect(queue.getState().tracks[1].title).toBe('Inserted');
    expect(queue.getState().tracks[2].title).toBe('Last');
  });

  test('removeTrack removes by index', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    queue.removeTrack(1);
    expect(queue.getState().length).toBe(2);
    expect(queue.getState().tracks[1].title).toBe('C');
  });

  test('removeTrack adjusts currentIndex when removing before current', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    queue.jumpTo(2);
    queue.removeTrack(0);
    expect(queue.getState().currentIndex).toBe(1);
  });

  test('clear empties the queue', () => {
    queue.addTracks([{ title: 'A' }]);
    queue.clear();
    expect(queue.getState().length).toBe(0);
    expect(queue.getState().currentIndex).toBe(-1);
  });

  test('reorder moves track', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    queue.reorder(0, 2);
    expect(queue.getState().tracks[2].title).toBe('A');
  });

  test('next advances and returns track', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }]);
    const track = queue.next();
    expect(track.title).toBe('B');
    expect(queue.getState().currentIndex).toBe(1);
  });

  test('next returns null at end', () => {
    queue.addTracks([{ title: 'A' }]);
    expect(queue.next()).toBeNull();
  });

  test('previous goes back', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }]);
    queue.next();
    const track = queue.previous();
    expect(track.title).toBe('A');
  });

  test('previous returns null at start', () => {
    queue.addTracks([{ title: 'A' }]);
    expect(queue.previous()).toBeNull();
  });

  test('jumpTo sets current index', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const track = queue.jumpTo(2);
    expect(track.title).toBe('C');
    expect(queue.getState().currentIndex).toBe(2);
  });

  test('shuffle randomizes order', () => {
    const tracks = Array.from({ length: 20 }, (_, i) => ({ title: `Song ${i}` }));
    queue.addTracks(tracks);
    queue.shuffle();
    expect(queue.getState().shuffled).toBe(true);
    expect(queue.getState().length).toBe(20);
    // Current track should be at index 0
    expect(queue.getState().currentIndex).toBe(0);
  });

  test('unshuffle restores original order', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const originalTitles = queue.getState().tracks.map(t => t.title);
    queue.shuffle();
    queue.unshuffle();
    expect(queue.getState().shuffled).toBe(false);
    expect(queue.getState().tracks.map(t => t.title)).toEqual(originalTitles);
  });

  test('getUpcoming returns next tracks', () => {
    queue.addTracks([{ title: 'A' }, { title: 'B' }, { title: 'C' }, { title: 'D' }]);
    const upcoming = queue.getUpcoming(2);
    expect(upcoming).toHaveLength(2);
    expect(upcoming[0].title).toBe('B');
    expect(upcoming[1].title).toBe('C');
  });

  test('broadcasts on every mutation', () => {
    queue.addTracks([{ title: 'A' }]);
    expect(wsManager.broadcast).toHaveBeenCalledWith('queue:updated', expect.any(Object));
  });
});
