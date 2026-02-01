/**
 * Queue Management Tests
 *
 * Tests for queue operations: add, remove, move, clear, and set operations.
 * Also tests queue integrity during playback and edge cases.
 */

describe('Queue Operations', () => {
  describe('Add to Queue', () => {
    let queueState;

    beforeEach(() => {
      queueState = {
        currentQueue: [],
        currentTrack: null,

        addToQueue(tracks, append = true) {
          const tracksArray = Array.isArray(tracks) ? tracks : [tracks];
          if (append) {
            this.currentQueue = [...this.currentQueue, ...tracksArray];
          } else {
            this.currentQueue = [...tracksArray, ...this.currentQueue];
          }
          return this.currentQueue;
        }
      };
    });

    test('adds single track to empty queue', () => {
      const track = { id: 'track1', title: 'Track 1' };

      queueState.addToQueue(track);

      expect(queueState.currentQueue).toHaveLength(1);
      expect(queueState.currentQueue[0].id).toBe('track1');
    });

    test('adds multiple tracks to queue', () => {
      const tracks = [
        { id: 'track1', title: 'Track 1' },
        { id: 'track2', title: 'Track 2' },
        { id: 'track3', title: 'Track 3' }
      ];

      queueState.addToQueue(tracks);

      expect(queueState.currentQueue).toHaveLength(3);
    });

    test('appends tracks to end of existing queue', () => {
      queueState.currentQueue = [{ id: 'existing', title: 'Existing' }];

      queueState.addToQueue({ id: 'new', title: 'New Track' });

      expect(queueState.currentQueue).toHaveLength(2);
      expect(queueState.currentQueue[1].id).toBe('new');
    });

    test('can prepend tracks to queue', () => {
      queueState.currentQueue = [{ id: 'existing', title: 'Existing' }];

      queueState.addToQueue({ id: 'new', title: 'New Track' }, false);

      expect(queueState.currentQueue[0].id).toBe('new');
      expect(queueState.currentQueue[1].id).toBe('existing');
    });

    test('preserves track order when adding', () => {
      const tracks = [
        { id: 'a', title: 'A' },
        { id: 'b', title: 'B' },
        { id: 'c', title: 'C' }
      ];

      queueState.addToQueue(tracks);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['a', 'b', 'c']);
    });
  });

  describe('Remove from Queue', () => {
    let queueState;

    beforeEach(() => {
      queueState = {
        currentQueue: [
          { id: 'track1', title: 'Track 1' },
          { id: 'track2', title: 'Track 2' },
          { id: 'track3', title: 'Track 3' }
        ],

        removeFromQueue(trackId) {
          this.currentQueue = this.currentQueue.filter(t => t.id !== trackId);
          return this.currentQueue;
        }
      };
    });

    test('removes track by ID', () => {
      queueState.removeFromQueue('track2');

      expect(queueState.currentQueue).toHaveLength(2);
      expect(queueState.currentQueue.find(t => t.id === 'track2')).toBeUndefined();
    });

    test('preserves order of remaining tracks', () => {
      queueState.removeFromQueue('track2');

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['track1', 'track3']);
    });

    test('removing non-existent track is no-op', () => {
      const originalLength = queueState.currentQueue.length;

      queueState.removeFromQueue('nonexistent');

      expect(queueState.currentQueue).toHaveLength(originalLength);
    });

    test('can remove first track', () => {
      queueState.removeFromQueue('track1');

      expect(queueState.currentQueue[0].id).toBe('track2');
    });

    test('can remove last track', () => {
      queueState.removeFromQueue('track3');

      expect(queueState.currentQueue).toHaveLength(2);
      expect(queueState.currentQueue[1].id).toBe('track2');
    });
  });

  describe('Move in Queue', () => {
    let queueState;

    beforeEach(() => {
      queueState = {
        currentQueue: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' }
        ],

        moveInQueue(fromIndex, toIndex) {
          if (fromIndex < 0 || fromIndex >= this.currentQueue.length) return;
          if (toIndex < 0 || toIndex >= this.currentQueue.length) return;

          const newQueue = [...this.currentQueue];
          const [removed] = newQueue.splice(fromIndex, 1);
          newQueue.splice(toIndex, 0, removed);
          this.currentQueue = newQueue;
        }
      };
    });

    test('moves track forward in queue', () => {
      queueState.moveInQueue(0, 2);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['b', 'c', 'a', 'd']);
    });

    test('moves track backward in queue', () => {
      queueState.moveInQueue(3, 1);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['a', 'd', 'b', 'c']);
    });

    test('moving to same position is no-op', () => {
      queueState.moveInQueue(1, 1);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('invalid fromIndex is no-op', () => {
      queueState.moveInQueue(-1, 2);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('invalid toIndex is no-op', () => {
      queueState.moveInQueue(0, 10);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('move to end of queue', () => {
      queueState.moveInQueue(0, 3);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['b', 'c', 'd', 'a']);
    });

    test('move to beginning of queue', () => {
      queueState.moveInQueue(3, 0);

      expect(queueState.currentQueue.map(t => t.id)).toEqual(['d', 'a', 'b', 'c']);
    });
  });

  describe('Clear Queue', () => {
    let queueState;

    beforeEach(() => {
      queueState = {
        currentQueue: [
          { id: 'track1' },
          { id: 'track2' },
          { id: 'track3' }
        ],
        currentTrack: { id: 'playing' },

        clearQueue() {
          this.currentQueue = [];
        }
      };
    });

    test('clears all tracks from queue', () => {
      queueState.clearQueue();

      expect(queueState.currentQueue).toHaveLength(0);
    });

    test('does not affect current track', () => {
      queueState.clearQueue();

      expect(queueState.currentTrack).toBeDefined();
      expect(queueState.currentTrack.id).toBe('playing');
    });

    test('clearing empty queue is no-op', () => {
      queueState.currentQueue = [];

      queueState.clearQueue();

      expect(queueState.currentQueue).toHaveLength(0);
    });
  });

  describe('Set Queue with Context', () => {
    let queueState;

    beforeEach(() => {
      queueState = {
        currentQueue: [],

        setQueueWithContext(tracks, context) {
          this.currentQueue = tracks.map(track => ({
            ...track,
            _playbackContext: context
          }));
        }
      };
    });

    test('sets queue with context metadata', () => {
      const tracks = [{ id: 'track1' }, { id: 'track2' }];
      const context = { type: 'library', name: 'Collection Station' };

      queueState.setQueueWithContext(tracks, context);

      expect(queueState.currentQueue).toHaveLength(2);
      expect(queueState.currentQueue[0]._playbackContext).toEqual(context);
      expect(queueState.currentQueue[1]._playbackContext).toEqual(context);
    });

    test('replaces existing queue', () => {
      queueState.currentQueue = [{ id: 'old1' }, { id: 'old2' }];

      queueState.setQueueWithContext([{ id: 'new1' }], { type: 'playlist' });

      expect(queueState.currentQueue).toHaveLength(1);
      expect(queueState.currentQueue[0].id).toBe('new1');
    });

    test('context types are preserved', () => {
      const contexts = [
        { type: 'library', name: 'Collection Station' },
        { type: 'spinoff', name: 'Artist Name' },
        { type: 'listenAlong', name: 'Friend Name' },
        { type: 'playlist', name: 'My Playlist' }
      ];

      contexts.forEach(context => {
        queueState.setQueueWithContext([{ id: 'test' }], context);
        expect(queueState.currentQueue[0]._playbackContext.type).toBe(context.type);
      });
    });
  });
});

describe('Queue State Integrity', () => {
  describe('During Playback', () => {
    let playbackState;

    beforeEach(() => {
      playbackState = {
        currentQueue: [
          { id: 'track2' },
          { id: 'track3' },
          { id: 'track4' }
        ],
        currentTrack: { id: 'track1' },
        playHistory: [],

        handleNext() {
          if (this.currentQueue.length === 0) return null;

          // Push current to history
          if (this.currentTrack) {
            this.playHistory.push(this.currentTrack);
          }

          // Pop from queue
          const next = this.currentQueue.shift();
          this.currentTrack = next;
          return next;
        },

        handlePrevious() {
          if (this.playHistory.length === 0) return null;

          // Put current back at front of queue
          if (this.currentTrack) {
            this.currentQueue.unshift(this.currentTrack);
          }

          // Pop from history
          this.currentTrack = this.playHistory.pop();
          return this.currentTrack;
        }
      };
    });

    test('handleNext removes track from queue front', () => {
      const next = playbackState.handleNext();

      expect(next.id).toBe('track2');
      expect(playbackState.currentQueue).toHaveLength(2);
      expect(playbackState.currentQueue[0].id).toBe('track3');
    });

    test('handleNext adds current to history', () => {
      playbackState.handleNext();

      expect(playbackState.playHistory).toHaveLength(1);
      expect(playbackState.playHistory[0].id).toBe('track1');
    });

    test('handlePrevious restores from history', () => {
      playbackState.handleNext(); // track1 -> history, track2 -> current
      playbackState.handlePrevious(); // track1 -> current, track2 -> queue front

      expect(playbackState.currentTrack.id).toBe('track1');
      expect(playbackState.currentQueue[0].id).toBe('track2');
    });

    test('handlePrevious with no history returns null', () => {
      const result = playbackState.handlePrevious();

      expect(result).toBeNull();
    });

    test('handleNext with empty queue returns null', () => {
      playbackState.currentQueue = [];

      const result = playbackState.handleNext();

      expect(result).toBeNull();
    });

    test('multiple next/previous navigations work correctly', () => {
      playbackState.handleNext(); // history: [1], current: 2, queue: [3, 4]
      playbackState.handleNext(); // history: [1, 2], current: 3, queue: [4]
      playbackState.handlePrevious(); // history: [1], current: 2, queue: [3, 4]
      playbackState.handlePrevious(); // history: [], current: 1, queue: [2, 3, 4]

      expect(playbackState.currentTrack.id).toBe('track1');
      expect(playbackState.currentQueue.map(t => t.id)).toEqual(['track2', 'track3', 'track4']);
      expect(playbackState.playHistory).toHaveLength(0);
    });
  });

  describe('Error Track Handling', () => {
    test('error tracks are skipped when finding next', () => {
      const queue = [
        { id: 'error1', status: 'error' },
        { id: 'error2', status: 'error' },
        { id: 'good', status: 'ready' }
      ];

      const nextPlayable = queue.findIndex(t => t.status !== 'error');

      expect(nextPlayable).toBe(2);
      expect(queue[nextPlayable].id).toBe('good');
    });

    test('all error tracks returns -1', () => {
      const queue = [
        { id: 'error1', status: 'error' },
        { id: 'error2', status: 'error' }
      ];

      const nextPlayable = queue.findIndex(t => t.status !== 'error');

      expect(nextPlayable).toBe(-1);
    });

    test('no explicit status is treated as playable', () => {
      const queue = [
        { id: 'track1' }, // No status field
        { id: 'track2', status: 'ready' }
      ];

      const nextPlayable = queue.findIndex(t => t.status !== 'error');

      expect(nextPlayable).toBe(0);
    });
  });

  describe('Duplicate Handling', () => {
    test('same track ID can appear multiple times', () => {
      const queue = [
        { id: 'track1', _position: 0 },
        { id: 'track2', _position: 1 },
        { id: 'track1', _position: 2 } // Same ID, different position
      ];

      expect(queue.filter(t => t.id === 'track1')).toHaveLength(2);
    });

    test('tracks distinguished by ID + resolver', () => {
      const queue = [
        { id: 'track1', _activeResolver: 'spotify' },
        { id: 'track1', _activeResolver: 'localfiles' }
      ];

      const getUniqueKey = (t) => `${t.id}:${t._activeResolver}`;

      const keys = queue.map(getUniqueKey);
      expect(new Set(keys).size).toBe(2);
    });

    test('prevent duplicate on re-queue during previous', () => {
      const currentTrack = { id: 'track1' };
      let queue = [
        { id: 'track2' },
        { id: 'track3' }
      ];

      // Check before adding back to queue
      const isDuplicate = queue.some(t => t.id === currentTrack.id);

      if (!isDuplicate) {
        queue = [currentTrack, ...queue];
      }

      expect(queue).toHaveLength(3);
      expect(queue[0].id).toBe('track1');
    });
  });
});

describe('Queue Edge Cases', () => {
  test('empty queue after all tracks played', () => {
    let queue = [{ id: 'last' }];
    let current = null;
    let isPlaying = true;

    // Play last track
    current = queue.shift();

    // Attempt next with empty queue
    if (queue.length === 0) {
      isPlaying = false;
    }

    expect(queue).toHaveLength(0);
    expect(isPlaying).toBe(false);
  });

  test('single track queue', () => {
    const queue = [{ id: 'only' }];

    expect(queue).toHaveLength(1);

    const next = queue.shift();
    expect(next.id).toBe('only');
    expect(queue).toHaveLength(0);
  });

  test('very large queue', () => {
    const largeQueue = Array.from({ length: 10000 }, (_, i) => ({
      id: `track${i}`,
      title: `Track ${i}`
    }));

    expect(largeQueue).toHaveLength(10000);

    // Operations should still work
    largeQueue.push({ id: 'new' });
    expect(largeQueue).toHaveLength(10001);

    largeQueue.shift();
    expect(largeQueue).toHaveLength(10000);
  });

  test('queue with undefined/null tracks filtered', () => {
    let queue = [
      { id: 'track1' },
      null,
      undefined,
      { id: 'track2' }
    ];

    queue = queue.filter(t => t != null);

    expect(queue).toHaveLength(2);
  });

  test('queue modification during iteration', () => {
    const queue = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const processed = [];

    // Safe iteration with copy
    [...queue].forEach((track, index) => {
      processed.push(track.id);
      if (index === 0) {
        queue.push({ id: 'd' }); // Modifying during iteration
      }
    });

    expect(processed).toEqual(['a', 'b', 'c']);
    expect(queue).toHaveLength(4);
  });

  test('rapid queue modifications', () => {
    let queue = [];

    // Rapid add/remove
    for (let i = 0; i < 100; i++) {
      queue.push({ id: `track${i}` });
      if (i % 2 === 0 && queue.length > 0) {
        queue.shift();
      }
    }

    // Queue should be stable after operations
    expect(Array.isArray(queue)).toBe(true);
    expect(queue.every(t => t && t.id)).toBe(true);
  });
});

describe('Spinoff Mode', () => {
  describe('Spinoff Initialization', () => {
    let spinoffState;

    beforeEach(() => {
      spinoffState = {
        spinoffMode: false,
        spinoffSourceTrack: null,
        spinoffTracks: [],
        currentQueue: [{ id: 'queue1' }, { id: 'queue2' }],
        previousContext: null,

        async startSpinoff(sourceTrack, similarTracks) {
          // Save current context
          this.previousContext = {
            queue: [...this.currentQueue]
          };

          // Enter spinoff mode
          this.spinoffMode = true;
          this.spinoffSourceTrack = {
            title: sourceTrack.title,
            artist: sourceTrack.artist
          };
          this.spinoffTracks = similarTracks;

          return true;
        },

        exitSpinoff() {
          this.spinoffMode = false;
          this.spinoffSourceTrack = null;
          this.spinoffTracks = [];

          // Restore previous context
          if (this.previousContext) {
            this.currentQueue = this.previousContext.queue;
            this.previousContext = null;
          }
        }
      };
    });

    test('spinoff mode activates with source track', async () => {
      const sourceTrack = { title: 'Song A', artist: 'Artist A' };
      const similar = [{ title: 'Similar 1' }, { title: 'Similar 2' }];

      await spinoffState.startSpinoff(sourceTrack, similar);

      expect(spinoffState.spinoffMode).toBe(true);
      expect(spinoffState.spinoffSourceTrack.title).toBe('Song A');
      expect(spinoffState.spinoffSourceTrack.artist).toBe('Artist A');
    });

    test('similar tracks are loaded into spinoff pool', async () => {
      const sourceTrack = { title: 'Song A', artist: 'Artist A' };
      const similar = [
        { title: 'Similar 1', artist: 'Artist B', match: 0.95 },
        { title: 'Similar 2', artist: 'Artist C', match: 0.90 },
        { title: 'Similar 3', artist: 'Artist D', match: 0.85 }
      ];

      await spinoffState.startSpinoff(sourceTrack, similar);

      expect(spinoffState.spinoffTracks).toHaveLength(3);
    });

    test('previous context is saved on spinoff start', async () => {
      const originalQueue = [...spinoffState.currentQueue];

      await spinoffState.startSpinoff({ title: 'X', artist: 'Y' }, []);

      expect(spinoffState.previousContext.queue).toEqual(originalQueue);
    });

    test('exitSpinoff restores previous context', async () => {
      const originalQueue = [...spinoffState.currentQueue];

      await spinoffState.startSpinoff({ title: 'X', artist: 'Y' }, []);
      spinoffState.currentQueue = []; // Queue might change during spinoff

      spinoffState.exitSpinoff();

      expect(spinoffState.spinoffMode).toBe(false);
      expect(spinoffState.currentQueue).toEqual(originalQueue);
    });

    test('exitSpinoff clears spinoff pool', async () => {
      await spinoffState.startSpinoff(
        { title: 'X', artist: 'Y' },
        [{ title: 'S1' }, { title: 'S2' }]
      );

      spinoffState.exitSpinoff();

      expect(spinoffState.spinoffTracks).toHaveLength(0);
    });
  });

  describe('Spinoff Playback', () => {
    let playbackState;

    beforeEach(() => {
      playbackState = {
        spinoffMode: true,
        spinoffTracks: [
          { title: 'Similar 1', artist: 'Artist A' },
          { title: 'Similar 2', artist: 'Artist B' },
          { title: 'Similar 3', artist: 'Artist C' }
        ],
        currentQueue: [{ id: 'queue1' }],
        currentTrack: { title: 'Current', artist: 'Current Artist' },

        handleNextInSpinoff() {
          if (this.spinoffMode && this.spinoffTracks.length > 0) {
            const next = this.spinoffTracks.shift();
            this.currentTrack = next;
            return { source: 'spinoff', track: next };
          }
          return null;
        }
      };
    });

    test('handleNext uses spinoff pool when in spinoff mode', () => {
      const result = playbackState.handleNextInSpinoff();

      expect(result.source).toBe('spinoff');
      expect(result.track.title).toBe('Similar 1');
    });

    test('spinoff tracks are consumed in order', () => {
      playbackState.handleNextInSpinoff(); // Similar 1
      playbackState.handleNextInSpinoff(); // Similar 2

      expect(playbackState.spinoffTracks).toHaveLength(1);
      expect(playbackState.spinoffTracks[0].title).toBe('Similar 3');
    });

    test('spinoff bypasses main queue', () => {
      playbackState.handleNextInSpinoff();

      expect(playbackState.currentQueue).toHaveLength(1); // Unchanged
    });

    test('spinoff pool exhaustion returns null', () => {
      playbackState.spinoffTracks = [];

      const result = playbackState.handleNextInSpinoff();

      expect(result).toBeNull();
    });
  });

  describe('Spinoff Context', () => {
    test('tracks have spinoff playback context', () => {
      const sourceTrack = { title: 'Original', artist: 'Original Artist' };
      const spinoffTrack = {
        title: 'Similar Track',
        artist: 'Similar Artist',
        _playbackContext: {
          type: 'spinoff',
          sourceTrack: {
            title: sourceTrack.title,
            artist: sourceTrack.artist
          }
        }
      };

      expect(spinoffTrack._playbackContext.type).toBe('spinoff');
      expect(spinoffTrack._playbackContext.sourceTrack.title).toBe('Original');
    });

    test('spinoff context shows source track info', () => {
      const context = {
        type: 'spinoff',
        sourceTrack: { title: 'Bohemian Rhapsody', artist: 'Queen' }
      };

      const displayText = `spun off from "${context.sourceTrack.title}"`;

      expect(displayText).toBe('spun off from "Bohemian Rhapsody"');
    });
  });

  describe('Spinoff Availability Check', () => {
    test('spinoffAvailable states', () => {
      // null = unchecked/loading
      // true = similar tracks exist
      // false = no similar tracks found
      const states = [null, true, false];

      states.forEach(state => {
        const buttonDisabled = state === null || state === false;
        expect(typeof buttonDisabled).toBe('boolean');
      });
    });

    test('null state shows loading indicator', () => {
      const spinoffAvailable = null;
      const showLoading = spinoffAvailable === null;

      expect(showLoading).toBe(true);
    });

    test('false state disables button', () => {
      const spinoffAvailable = false;
      const buttonDisabled = !spinoffAvailable;

      expect(buttonDisabled).toBe(true);
    });

    test('true state enables button', () => {
      const spinoffAvailable = true;
      const buttonDisabled = !spinoffAvailable;

      expect(buttonDisabled).toBe(false);
    });
  });

  describe('Spinoff Pool Management', () => {
    test('pool tracks are resolved in batches of 5', () => {
      const pool = Array.from({ length: 20 }, (_, i) => ({
        title: `Track ${i}`,
        resolved: false
      }));

      // Simulate batch resolution
      const batchSize = 5;
      const batch = pool.slice(0, batchSize);

      batch.forEach(t => t.resolved = true);

      expect(pool.filter(t => t.resolved)).toHaveLength(5);
    });

    test('pool updates visibility after each track plays', () => {
      let pool = Array.from({ length: 10 }, (_, i) => ({ title: `Track ${i}` }));
      let currentIndex = 0;

      const playNext = () => {
        if (currentIndex < pool.length) {
          currentIndex++;
          return pool.slice(currentIndex, currentIndex + 5); // Next 5 visible
        }
        return [];
      };

      playNext(); // Index 1, visible: 1-5
      playNext(); // Index 2, visible: 2-6

      const visible = playNext(); // Index 3, visible: 3-7
      expect(visible).toHaveLength(5);
      expect(visible[0].title).toBe('Track 3');
    });
  });
});

describe('Listen-Along Mode', () => {
  describe('Listen-Along Queue Behavior', () => {
    let listenAlongState;

    beforeEach(() => {
      listenAlongState = {
        listenAlongMode: false,
        listenAlongFriend: null,
        currentTrack: null,

        startListenAlong(friend, track) {
          this.listenAlongMode = true;
          this.listenAlongFriend = friend;
          this.currentTrack = {
            ...track,
            _playbackContext: {
              type: 'listenAlong',
              name: friend.name
            }
          };
        },

        exitListenAlong() {
          this.listenAlongMode = false;
          this.listenAlongFriend = null;
        }
      };
    });

    test('listen-along mode sets friend info', () => {
      const friend = { id: 'friend1', name: 'Alice' };
      const track = { title: 'Shared Track', artist: 'Artist' };

      listenAlongState.startListenAlong(friend, track);

      expect(listenAlongState.listenAlongMode).toBe(true);
      expect(listenAlongState.listenAlongFriend.name).toBe('Alice');
    });

    test('track has listen-along context', () => {
      const friend = { id: 'friend1', name: 'Alice' };
      const track = { title: 'Shared Track', artist: 'Artist' };

      listenAlongState.startListenAlong(friend, track);

      expect(listenAlongState.currentTrack._playbackContext.type).toBe('listenAlong');
      expect(listenAlongState.currentTrack._playbackContext.name).toBe('Alice');
    });

    test('listen-along exits spinoff mode', () => {
      let spinoffMode = true;
      let listenAlongMode = false;

      // Starting listen-along
      if (spinoffMode) {
        spinoffMode = false; // Exit spinoff first
      }
      listenAlongMode = true;

      expect(spinoffMode).toBe(false);
      expect(listenAlongMode).toBe(true);
    });
  });
});

describe('Queue Persistence', () => {
  test('queue can be serialized to JSON', () => {
    const queue = [
      { id: 'track1', title: 'Track 1', _playbackContext: { type: 'library' } },
      { id: 'track2', title: 'Track 2', sources: { spotify: { uri: 'spotify:track:123' } } }
    ];

    const serialized = JSON.stringify(queue);
    const deserialized = JSON.parse(serialized);

    expect(deserialized).toEqual(queue);
  });

  test('queue with circular references handled', () => {
    const queue = [{ id: 'track1' }];
    // Create circular reference (shouldn't happen in practice, but good to test)
    queue[0].self = queue[0];

    // Serialize with circular reference handling
    const serialize = (obj) => {
      const seen = new WeakSet();
      return JSON.stringify(obj, (key, value) => {
        if (typeof value === 'object' && value !== null) {
          if (seen.has(value)) return undefined;
          seen.add(value);
        }
        return value;
      });
    };

    const serialized = serialize(queue);
    expect(() => JSON.parse(serialized)).not.toThrow();
  });
});
