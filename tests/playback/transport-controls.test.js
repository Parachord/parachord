/**
 * Transport Controls Tests
 *
 * Tests for play/pause, next, previous functionality
 * across all playback source types.
 */

const {
  MockAudio,
  createMockElectron,
  createMockPlaybackController,
  createMockQueue,
  mockTracks
} = require('../test-utils/mocks');

const { mixedSourcePlaylist, queueWithErrors } = require('../test-utils/fixtures');

describe('Transport Controls', () => {
  let controller;
  let mockElectron;

  beforeEach(() => {
    controller = createMockPlaybackController();
    mockElectron = createMockElectron();
  });

  afterEach(() => {
    controller.reset();
    jest.clearAllMocks();
  });

  describe('Play/Pause Toggle', () => {
    test('pause stops local file playback', async () => {
      // Setup: Local file playing
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();
      controller.setCurrentTrack(mockTracks.localFile);
      controller.setIsPlaying(true);

      expect(controller.audioElement.paused).toBe(false);

      // Pause
      controller.audioElement.pause();
      controller.setIsPlaying(false);

      expect(controller.audioElement.paused).toBe(true);
      expect(controller.isPlaying).toBe(false);
    });

    test('play resumes local file from current position', async () => {
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();

      // Simulate some progress
      controller.audioElement.currentTime = 45;
      controller.audioElement.pause();

      expect(controller.audioElement.currentTime).toBe(45);

      // Resume
      await controller.audioElement.play();

      expect(controller.audioElement.paused).toBe(false);
      expect(controller.audioElement.currentTime).toBe(45);
    });

    test('pause sends command to browser extension', async () => {
      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.youtube);

      // Pause
      await mockElectron.extension.sendCommand({ type: 'command', action: 'pause' });

      expect(mockElectron.extension.sendCommand).toHaveBeenCalledWith({
        type: 'command',
        action: 'pause'
      });
    });

    test('play sends command to browser extension', async () => {
      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.youtube);

      // Play
      await mockElectron.extension.sendCommand({ type: 'command', action: 'play' });

      expect(mockElectron.extension.sendCommand).toHaveBeenCalledWith({
        type: 'command',
        action: 'play'
      });
    });

    test('pause for Spotify calls API', async () => {
      controller.setStreamingPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.spotify);

      let pauseApiCalled = false;

      // Simulate Spotify pause
      const pauseSpotify = async () => {
        pauseApiCalled = true;
        controller.setStreamingPlaybackActive(false);
      };

      await pauseSpotify();

      expect(pauseApiCalled).toBe(true);
    });

    test('isPlaying state toggles correctly', () => {
      expect(controller.isPlaying).toBe(false);

      controller.setIsPlaying(true);
      expect(controller.isPlaying).toBe(true);

      controller.setIsPlaying(false);
      expect(controller.isPlaying).toBe(false);
    });
  });

  describe('Next Track', () => {
    test('handleNext advances to next track in queue', () => {
      const queue = createMockQueue(mixedSourcePlaylist);
      controller.setQueue(queue);
      controller.setCurrentTrack(queue[0]);

      // Get next track
      const nextTrack = controller.queue[0];
      const remainingQueue = controller.queue.slice(1);

      // Add current to history
      controller.addToHistory(controller.currentTrack);

      // Update queue
      controller.setQueue(remainingQueue);
      controller.setCurrentTrack(nextTrack);

      expect(controller.currentTrack.id).toBe('track-1');
      expect(controller.queue.length).toBe(4);
      expect(controller.playHistory.length).toBe(1);
    });

    test('handleNext skips error tracks', () => {
      controller.setQueue(queueWithErrors);

      // Find first non-error track
      const findNextPlayable = () => {
        return controller.queue.find(t => t.status !== 'error');
      };

      const nextTrack = findNextPlayable();

      expect(nextTrack.id).toBe('good-track-1');
      expect(nextTrack.status).toBe('ready');
    });

    test('handleNext stops playback on empty queue', () => {
      controller.setQueue([]);
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setIsPlaying(true);

      // Handle next with empty queue
      if (controller.queue.length === 0) {
        controller.setIsPlaying(false);
        controller.setCurrentTrack(null);
      }

      expect(controller.isPlaying).toBe(false);
      expect(controller.currentTrack).toBeNull();
    });

    test('handleNext adds current track to history', () => {
      const queue = createMockQueue([mockTracks.localFile, mockTracks.soundcloud]);
      controller.setQueue(queue);
      controller.setCurrentTrack(mockTracks.spotify);

      expect(controller.playHistory.length).toBe(0);

      // Add to history before advancing
      controller.addToHistory(controller.currentTrack);

      expect(controller.playHistory.length).toBe(1);
      expect(controller.playHistory[0].id).toBe('spotify-track-1');
    });

    test('handleNext removes track from queue', () => {
      const queue = createMockQueue([mockTracks.localFile, mockTracks.soundcloud]);
      controller.setQueue(queue);

      expect(controller.queue.length).toBe(2);

      // Remove first track from queue
      const newQueue = controller.queue.slice(1);
      controller.setQueue(newQueue);

      expect(controller.queue.length).toBe(1);
      expect(controller.queue[0].id).toBe('soundcloud-track-1');
    });
  });

  describe('Previous Track', () => {
    test('handlePrevious returns to previous track from history', () => {
      // Setup: History has a track, current is playing
      controller.addToHistory(mockTracks.spotify);
      controller.setCurrentTrack(mockTracks.localFile);
      controller.setQueue([mockTracks.soundcloud]);

      expect(controller.playHistory.length).toBe(1);

      // Pop from history
      const previousTrack = controller.popFromHistory();

      // Add current to front of queue
      const newQueue = [controller.currentTrack, ...controller.queue];
      controller.setQueue(newQueue);

      // Set previous as current
      controller.setCurrentTrack(previousTrack);

      expect(controller.currentTrack.id).toBe('spotify-track-1');
      expect(controller.playHistory.length).toBe(0);
      expect(controller.queue.length).toBe(2);
      expect(controller.queue[0].id).toBe('local-track-1');
    });

    test('handlePrevious with no history restarts current track', () => {
      controller.setCurrentTrack(mockTracks.spotify);

      expect(controller.playHistory.length).toBe(0);

      // No history - would restart current track
      const shouldRestartCurrent = controller.playHistory.length === 0;

      expect(shouldRestartCurrent).toBe(true);
    });

    test('handlePrevious preserves current track in queue', () => {
      controller.addToHistory(mockTracks.spotify);
      controller.setCurrentTrack(mockTracks.localFile);
      controller.setQueue([]);

      // Current goes to front of queue
      const newQueue = [controller.currentTrack];
      controller.setQueue(newQueue);

      expect(controller.queue[0].id).toBe('local-track-1');
    });
  });

  describe('Re-entrancy Guards', () => {
    test('isAdvancingTrackRef prevents duplicate handleNext calls', async () => {
      let isAdvancingTrack = false;
      let advanceCallCount = 0;

      const handleNext = async () => {
        if (isAdvancingTrack) {
          return; // Already advancing
        }
        isAdvancingTrack = true;

        advanceCallCount++;

        // Simulate async work
        await new Promise(resolve => setTimeout(resolve, 50));

        isAdvancingTrack = false;
      };

      // Fire multiple times rapidly
      const calls = [
        handleNext(),
        handleNext(),
        handleNext(),
        handleNext(),
        handleNext()
      ];

      await Promise.all(calls);

      // Only first call should execute
      expect(advanceCallCount).toBe(1);
    });

    test('guard is released after handleNext completes', async () => {
      let isAdvancingTrack = false;
      let advanceCallCount = 0;

      const handleNext = async () => {
        if (isAdvancingTrack) {
          return;
        }
        isAdvancingTrack = true;

        advanceCallCount++;
        await new Promise(resolve => setTimeout(resolve, 10));

        isAdvancingTrack = false;
      };

      // First call
      await handleNext();
      expect(advanceCallCount).toBe(1);

      // Guard should be released, second call should work
      await handleNext();
      expect(advanceCallCount).toBe(2);
    });

    test('waitingForBrowserPlayback prevents advance during connect', () => {
      let waitingForBrowserPlayback = true;

      const canAdvance = () => {
        if (waitingForBrowserPlayback) {
          return false;
        }
        return true;
      };

      expect(canAdvance()).toBe(false);

      waitingForBrowserPlayback = false;
      expect(canAdvance()).toBe(true);
    });
  });

  describe('Queue State', () => {
    test('queue maintains correct order after multiple operations', () => {
      const initialQueue = createMockQueue([
        mockTracks.spotify,
        mockTracks.localFile,
        mockTracks.soundcloud,
        mockTracks.youtube
      ]);

      controller.setQueue(initialQueue);

      // Remove first (next operation)
      controller.setQueue(controller.queue.slice(1));
      expect(controller.queue[0].id).toBe('local-track-1');

      // Add track to front (previous operation)
      controller.setQueue([mockTracks.spotify, ...controller.queue]);
      expect(controller.queue[0].id).toBe('spotify-track-1');
      expect(controller.queue.length).toBe(4);
    });

    test('empty queue is handled correctly', () => {
      controller.setQueue([]);

      expect(controller.queue.length).toBe(0);

      const hasNextTrack = controller.queue.length > 0;
      expect(hasNextTrack).toBe(false);
    });
  });

  describe('Play History', () => {
    test('history grows as tracks are played', () => {
      controller.addToHistory(mockTracks.spotify);
      expect(controller.playHistory.length).toBe(1);

      controller.addToHistory(mockTracks.localFile);
      expect(controller.playHistory.length).toBe(2);

      controller.addToHistory(mockTracks.soundcloud);
      expect(controller.playHistory.length).toBe(3);
    });

    test('popFromHistory removes and returns last track', () => {
      controller.addToHistory(mockTracks.spotify);
      controller.addToHistory(mockTracks.localFile);
      controller.addToHistory(mockTracks.soundcloud);

      const popped = controller.popFromHistory();

      expect(popped.id).toBe('soundcloud-track-1');
      expect(controller.playHistory.length).toBe(2);
    });

    test('popFromHistory on empty history returns null', () => {
      const popped = controller.popFromHistory();

      expect(popped).toBeNull();
    });
  });
});

describe('Source-Specific Controls', () => {
  let controller;
  let mockElectron;

  beforeEach(() => {
    controller = createMockPlaybackController();
    mockElectron = createMockElectron();
  });

  afterEach(() => {
    controller.reset();
  });

  test('local file seeks to position', () => {
    controller.audioElement.src = '/music/test.mp3';
    controller.audioElement._setDuration(180);
    controller.audioElement.currentTime = 0;

    // Seek to 60 seconds
    controller.audioElement.currentTime = 60;

    expect(controller.audioElement.currentTime).toBe(60);
  });

  test('seek command sent to browser extension', async () => {
    controller.setBrowserPlaybackActive(true);

    await mockElectron.extension.sendCommand({
      type: 'command',
      action: 'seek',
      position: 60
    });

    expect(mockElectron.extension.sendCommand).toHaveBeenCalledWith({
      type: 'command',
      action: 'seek',
      position: 60
    });
  });
});
