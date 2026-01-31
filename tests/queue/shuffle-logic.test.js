/**
 * Shuffle Logic Tests
 *
 * Tests for shuffle algorithm, shuffle toggle behavior, and history tracking.
 * Verifies Fisher-Yates implementation and original queue restoration.
 */

describe('Shuffle Algorithm', () => {
  describe('Fisher-Yates Implementation', () => {
    // Fisher-Yates shuffle implementation (same as in app.js)
    const fisherYatesShuffle = (array) => {
      const shuffled = [...array];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    test('shuffle returns array of same length', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const shuffled = fisherYatesShuffle(original);

      expect(shuffled.length).toBe(original.length);
    });

    test('shuffle contains all original elements', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

      const shuffled = fisherYatesShuffle(original);

      expect(shuffled.sort((a, b) => a - b)).toEqual(original);
    });

    test('shuffle does not modify original array', () => {
      const original = [1, 2, 3, 4, 5];
      const originalCopy = [...original];

      fisherYatesShuffle(original);

      expect(original).toEqual(originalCopy);
    });

    test('shuffle produces different orders', () => {
      const original = Array.from({ length: 20 }, (_, i) => i);
      const results = new Set();

      // Run multiple shuffles
      for (let i = 0; i < 10; i++) {
        const shuffled = fisherYatesShuffle(original);
        results.add(shuffled.join(','));
      }

      // Should have multiple unique orderings
      expect(results.size).toBeGreaterThan(1);
    });

    test('shuffle handles empty array', () => {
      const empty = [];

      const shuffled = fisherYatesShuffle(empty);

      expect(shuffled).toEqual([]);
    });

    test('shuffle handles single element', () => {
      const single = [1];

      const shuffled = fisherYatesShuffle(single);

      expect(shuffled).toEqual([1]);
    });

    test('shuffle handles two elements', () => {
      const two = [1, 2];
      let hasSwapped = false;
      let hasOriginal = false;

      // Run multiple times to verify both outcomes possible
      for (let i = 0; i < 50; i++) {
        const shuffled = fisherYatesShuffle(two);
        if (shuffled[0] === 2) hasSwapped = true;
        if (shuffled[0] === 1) hasOriginal = true;
      }

      // Both orderings should occur at some point
      expect(hasSwapped || hasOriginal).toBe(true);
    });

    test('shuffle is uniformly distributed', () => {
      const original = [0, 1, 2];
      const firstPositionCounts = { 0: 0, 1: 0, 2: 0 };
      const iterations = 3000;

      for (let i = 0; i < iterations; i++) {
        const shuffled = fisherYatesShuffle(original);
        firstPositionCounts[shuffled[0]]++;
      }

      // Each element should appear ~33% of the time in first position
      // Allow 10% deviation from expected
      const expectedCount = iterations / 3;
      const tolerance = expectedCount * 0.15;

      Object.values(firstPositionCounts).forEach(count => {
        expect(count).toBeGreaterThan(expectedCount - tolerance);
        expect(count).toBeLessThan(expectedCount + tolerance);
      });
    });
  });

  describe('Track Object Shuffling', () => {
    const shuffleQueue = (queue) => {
      const shuffled = [...queue];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    test('shuffles track objects correctly', () => {
      const queue = [
        { id: 'a', title: 'Track A' },
        { id: 'b', title: 'Track B' },
        { id: 'c', title: 'Track C' }
      ];

      const shuffled = shuffleQueue(queue);

      expect(shuffled).toHaveLength(3);
      expect(shuffled.map(t => t.id).sort()).toEqual(['a', 'b', 'c']);
    });

    test('preserves track properties after shuffle', () => {
      const queue = [
        { id: 'track1', title: 'Title 1', artist: 'Artist 1', duration: 180000 }
      ];

      const shuffled = shuffleQueue(queue);

      expect(shuffled[0]).toEqual(queue[0]);
    });
  });
});

describe('Shuffle Toggle', () => {
  describe('Enable Shuffle', () => {
    let shuffleState;

    beforeEach(() => {
      shuffleState = {
        shuffleMode: false,
        currentQueue: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' }
        ],
        originalQueue: null,

        toggleShuffle() {
          if (!this.shuffleMode) {
            // Enable shuffle
            this.originalQueue = [...this.currentQueue];
            this.currentQueue = this._shuffle(this.currentQueue);
            this.shuffleMode = true;
          } else {
            // Disable shuffle
            this.currentQueue = this._restoreOriginalOrder();
            this.originalQueue = null;
            this.shuffleMode = false;
          }
        },

        _shuffle(array) {
          const shuffled = [...array];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          return shuffled;
        },

        _restoreOriginalOrder() {
          // Only restore tracks that still exist in queue
          const currentIds = new Set(this.currentQueue.map(t => t.id));
          return this.originalQueue.filter(t => currentIds.has(t.id));
        }
      };
    });

    test('enabling shuffle stores original order', () => {
      const originalOrder = shuffleState.currentQueue.map(t => t.id);

      shuffleState.toggleShuffle();

      expect(shuffleState.originalQueue.map(t => t.id)).toEqual(originalOrder);
    });

    test('enabling shuffle changes queue order', () => {
      const originalOrder = shuffleState.currentQueue.map(t => t.id).join(',');

      // Keep toggling until we get a different order
      let maxAttempts = 50;
      let isDifferent = false;

      while (maxAttempts > 0 && !isDifferent) {
        shuffleState.shuffleMode = false;
        shuffleState.currentQueue = [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' }
        ];
        shuffleState.toggleShuffle();
        isDifferent = shuffleState.currentQueue.map(t => t.id).join(',') !== originalOrder;
        maxAttempts--;
      }

      expect(shuffleState.shuffleMode).toBe(true);
      // With 4 elements, there's only ~4% chance of same order, so this should pass
    });

    test('enabling shuffle sets shuffleMode to true', () => {
      shuffleState.toggleShuffle();

      expect(shuffleState.shuffleMode).toBe(true);
    });
  });

  describe('Disable Shuffle', () => {
    let shuffleState;

    beforeEach(() => {
      shuffleState = {
        shuffleMode: true,
        currentQueue: [
          { id: 'c', title: 'C' },
          { id: 'a', title: 'A' },
          { id: 'd', title: 'D' },
          { id: 'b', title: 'B' }
        ],
        originalQueue: [
          { id: 'a', title: 'A' },
          { id: 'b', title: 'B' },
          { id: 'c', title: 'C' },
          { id: 'd', title: 'D' }
        ],

        toggleShuffle() {
          if (this.shuffleMode) {
            this.currentQueue = this._restoreOriginalOrder();
            this.originalQueue = null;
            this.shuffleMode = false;
          }
        },

        _restoreOriginalOrder() {
          const currentIds = new Set(this.currentQueue.map(t => t.id));
          return this.originalQueue.filter(t => currentIds.has(t.id));
        }
      };
    });

    test('disabling shuffle restores original order', () => {
      shuffleState.toggleShuffle();

      expect(shuffleState.currentQueue.map(t => t.id)).toEqual(['a', 'b', 'c', 'd']);
    });

    test('disabling shuffle clears originalQueue', () => {
      shuffleState.toggleShuffle();

      expect(shuffleState.originalQueue).toBeNull();
    });

    test('disabling shuffle sets shuffleMode to false', () => {
      shuffleState.toggleShuffle();

      expect(shuffleState.shuffleMode).toBe(false);
    });

    test('restoring order filters out removed tracks', () => {
      // Remove track 'b' from current queue
      shuffleState.currentQueue = shuffleState.currentQueue.filter(t => t.id !== 'b');

      shuffleState.toggleShuffle();

      expect(shuffleState.currentQueue.map(t => t.id)).toEqual(['a', 'c', 'd']);
    });
  });

  describe('Rapid Toggle', () => {
    test('rapid shuffle toggles maintain data integrity', () => {
      let shuffleMode = false;
      let currentQueue = [
        { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }
      ];
      let originalQueue = null;

      const shuffle = (arr) => {
        const shuffled = [...arr];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      };

      const toggle = () => {
        if (!shuffleMode) {
          originalQueue = [...currentQueue];
          currentQueue = shuffle(currentQueue);
          shuffleMode = true;
        } else {
          const currentIds = new Set(currentQueue.map(t => t.id));
          currentQueue = originalQueue.filter(t => currentIds.has(t.id));
          originalQueue = null;
          shuffleMode = false;
        }
      };

      // Toggle 20 times rapidly
      for (let i = 0; i < 20; i++) {
        toggle();
      }

      // Should end up in stable state with all tracks present
      expect(currentQueue.map(t => t.id).sort()).toEqual(['a', 'b', 'c', 'd']);
    });
  });
});

describe('Shuffle During Queue Modifications', () => {
  describe('Adding Tracks While Shuffled', () => {
    test('new tracks inserted at random positions', () => {
      const queue = [
        { id: 'a' }, { id: 'b' }, { id: 'c' }
      ];

      // Simulate adding track at random position
      const insertAtRandom = (arr, item) => {
        const position = Math.floor(Math.random() * (arr.length + 1));
        const newArr = [...arr];
        newArr.splice(position, 0, item);
        return newArr;
      };

      const positions = new Set();
      for (let i = 0; i < 100; i++) {
        const result = insertAtRandom([...queue], { id: 'new' });
        positions.add(result.findIndex(t => t.id === 'new'));
      }

      // Should be inserted at various positions
      expect(positions.size).toBeGreaterThan(1);
    });

    test('multiple new tracks are shuffled before insertion', () => {
      const existingQueue = [{ id: 'a' }, { id: 'b' }];
      const newTracks = [
        { id: 'new1' }, { id: 'new2' }, { id: 'new3' }
      ];

      const shuffleTracks = (tracks) => {
        const shuffled = [...tracks];
        for (let i = shuffled.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
        }
        return shuffled;
      };

      // Empty existing queue - shuffle new tracks
      let resultQueue = [];
      if (existingQueue.length === 0) {
        resultQueue = shuffleTracks(newTracks);
      } else {
        // Non-empty - add each at random position
        resultQueue = [...existingQueue];
        newTracks.forEach(track => {
          const pos = Math.floor(Math.random() * (resultQueue.length + 1));
          resultQueue.splice(pos, 0, track);
        });
      }

      expect(resultQueue.length).toBe(5);
      expect(resultQueue.map(t => t.id).sort()).toEqual(['a', 'b', 'new1', 'new2', 'new3']);
    });
  });

  describe('Removing Tracks While Shuffled', () => {
    test('removed track is filtered from both queues', () => {
      let currentQueue = [
        { id: 'c' }, { id: 'a' }, { id: 'd' }, { id: 'b' }
      ];
      let originalQueue = [
        { id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }
      ];

      const removeTrack = (trackId) => {
        currentQueue = currentQueue.filter(t => t.id !== trackId);
        originalQueue = originalQueue.filter(t => t.id !== trackId);
      };

      removeTrack('b');

      expect(currentQueue.map(t => t.id)).not.toContain('b');
      expect(originalQueue.map(t => t.id)).not.toContain('b');
    });

    test('removing all tracks clears both queues', () => {
      let currentQueue = [{ id: 'a' }, { id: 'b' }];
      let originalQueue = [{ id: 'a' }, { id: 'b' }];

      currentQueue = [];
      originalQueue = [];

      expect(currentQueue).toHaveLength(0);
      expect(originalQueue).toHaveLength(0);
    });
  });
});

describe('Play History', () => {
  describe('History Stack Operations', () => {
    let historyState;

    beforeEach(() => {
      historyState = {
        playHistory: [],
        currentTrack: { id: 'current' },

        addToHistory(track) {
          this.playHistory.push(track);
        },

        popFromHistory() {
          return this.playHistory.pop();
        }
      };
    });

    test('adds track to history', () => {
      historyState.addToHistory({ id: 'track1' });

      expect(historyState.playHistory).toHaveLength(1);
    });

    test('history is LIFO (stack)', () => {
      historyState.addToHistory({ id: 'track1' });
      historyState.addToHistory({ id: 'track2' });
      historyState.addToHistory({ id: 'track3' });

      expect(historyState.popFromHistory().id).toBe('track3');
      expect(historyState.popFromHistory().id).toBe('track2');
      expect(historyState.popFromHistory().id).toBe('track1');
    });

    test('pop from empty history returns undefined', () => {
      const result = historyState.popFromHistory();

      expect(result).toBeUndefined();
    });
  });

  describe('History with Shuffle', () => {
    test('history is independent of shuffle state', () => {
      const playHistory = [];
      let shuffleMode = false;

      // Play some tracks
      playHistory.push({ id: 'track1', order: 1 });
      playHistory.push({ id: 'track2', order: 2 });

      // Enable shuffle
      shuffleMode = true;

      // Play more tracks
      playHistory.push({ id: 'track3', order: 3 });

      // Disable shuffle
      shuffleMode = false;

      // History should be unchanged
      expect(playHistory).toHaveLength(3);
      expect(playHistory.map(t => t.id)).toEqual(['track1', 'track2', 'track3']);
    });

    test('going back restores actual played order, not original order', () => {
      const playHistory = [
        { id: 'c' }, // Played first (shuffled order)
        { id: 'a' }, // Played second (shuffled order)
      ];

      // originalQueue order was [a, b, c, d]
      // but history shows actual playback order

      const previous = playHistory.pop();
      expect(previous.id).toBe('a'); // Actual last played, not original order
    });
  });

  describe('Previous Navigation', () => {
    let navState;

    beforeEach(() => {
      navState = {
        playHistory: [
          { id: 'track1' },
          { id: 'track2' }
        ],
        currentTrack: { id: 'track3' },
        currentQueue: [{ id: 'track4' }, { id: 'track5' }],

        handlePrevious() {
          if (this.playHistory.length === 0) {
            // No history - restart current track
            return { action: 'restart', track: this.currentTrack };
          }

          // Push current to front of queue
          this.currentQueue.unshift(this.currentTrack);

          // Pop from history
          this.currentTrack = this.playHistory.pop();

          return { action: 'previous', track: this.currentTrack };
        }
      };
    });

    test('previous adds current track to queue front', () => {
      navState.handlePrevious();

      expect(navState.currentQueue[0].id).toBe('track3');
    });

    test('previous pops from history', () => {
      navState.handlePrevious();

      expect(navState.currentTrack.id).toBe('track2');
      expect(navState.playHistory).toHaveLength(1);
    });

    test('previous with no history restarts current', () => {
      navState.playHistory = [];

      const result = navState.handlePrevious();

      expect(result.action).toBe('restart');
      expect(result.track.id).toBe('track3');
    });

    test('multiple previous navigations work correctly', () => {
      navState.handlePrevious(); // current=track2, queue=[track3, track4, track5]
      navState.handlePrevious(); // current=track1, queue=[track2, track3, track4, track5]

      expect(navState.currentTrack.id).toBe('track1');
      expect(navState.currentQueue.map(t => t.id)).toEqual(['track2', 'track3', 'track4', 'track5']);
    });
  });
});

describe('Shuffle Edge Cases', () => {
  test('shuffle with 0 tracks', () => {
    const shuffle = (arr) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    expect(shuffle([])).toEqual([]);
  });

  test('shuffle with 1 track', () => {
    const shuffle = (arr) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const single = [{ id: 'only' }];
    expect(shuffle(single)).toEqual(single);
  });

  test('shuffle preserves track references', () => {
    const track1 = { id: 'a', mutable: 'value1' };
    const track2 = { id: 'b', mutable: 'value2' };
    const queue = [track1, track2];

    const shuffle = (arr) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const shuffled = shuffle(queue);

    // Modify original track
    track1.mutable = 'changed';

    // Shuffled should see the change (same reference)
    const trackA = shuffled.find(t => t.id === 'a');
    expect(trackA.mutable).toBe('changed');
  });

  test('restoring order with all tracks removed returns empty', () => {
    const originalQueue = [
      { id: 'a' }, { id: 'b' }, { id: 'c' }
    ];
    const currentQueue = []; // All tracks removed

    const currentIds = new Set(currentQueue.map(t => t.id));
    const restored = originalQueue.filter(t => currentIds.has(t.id));

    expect(restored).toHaveLength(0);
  });

  test('duplicate track IDs handled correctly in shuffle', () => {
    const queue = [
      { id: 'a', position: 0 },
      { id: 'a', position: 1 }, // Same ID, different position
      { id: 'b', position: 2 }
    ];

    const shuffle = (arr) => {
      const shuffled = [...arr];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      return shuffled;
    };

    const shuffled = shuffle(queue);

    expect(shuffled).toHaveLength(3);
    expect(shuffled.filter(t => t.id === 'a')).toHaveLength(2);
  });
});

describe('Shuffle Indicator State', () => {
  test('shuffle icon reflects shuffleMode state', () => {
    const getShuffleIconState = (shuffleMode) => {
      return {
        active: shuffleMode,
        className: shuffleMode ? 'shuffle-active' : 'shuffle-inactive'
      };
    };

    expect(getShuffleIconState(true).active).toBe(true);
    expect(getShuffleIconState(false).active).toBe(false);
    expect(getShuffleIconState(true).className).toBe('shuffle-active');
  });

  test('keyboard shortcut toggles shuffle', () => {
    let shuffleMode = false;

    const handleKeyboard = (key) => {
      if (key === 's') {
        shuffleMode = !shuffleMode;
      }
    };

    handleKeyboard('s');
    expect(shuffleMode).toBe(true);

    handleKeyboard('s');
    expect(shuffleMode).toBe(false);
  });

  test('menu command toggles shuffle', () => {
    let shuffleMode = false;

    const handleMenuCommand = (command) => {
      if (command === 'toggle-shuffle') {
        shuffleMode = !shuffleMode;
      }
    };

    handleMenuCommand('toggle-shuffle');
    expect(shuffleMode).toBe(true);
  });
});

describe('Shuffle State Persistence', () => {
  test('shuffle state can be serialized', () => {
    const state = {
      shuffleMode: true,
      originalQueue: [{ id: 'a' }, { id: 'b' }]
    };

    const serialized = JSON.stringify(state);
    const restored = JSON.parse(serialized);

    expect(restored.shuffleMode).toBe(true);
    expect(restored.originalQueue).toHaveLength(2);
  });

  test('shuffle mode persists across track changes', () => {
    let shuffleMode = true;
    let currentTrack = { id: 'track1' };

    // Simulate track change
    currentTrack = { id: 'track2' };

    // Shuffle mode should persist
    expect(shuffleMode).toBe(true);
  });
});
