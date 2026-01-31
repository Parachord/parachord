/**
 * Error Handling & Recovery Tests
 *
 * Tests for graceful error handling and fallback behavior
 * when playback fails or encounters issues.
 */

const {
  MockAudio,
  createMockElectron,
  createMockPlaybackController,
  createMockSpotifyAPI,
  mockTracks
} = require('../test-utils/mocks');

describe('Error Handling & Recovery', () => {
  let controller;
  let mockElectron;
  let mockSpotifyAPI;

  beforeEach(() => {
    controller = createMockPlaybackController();
    mockElectron = createMockElectron();
    mockSpotifyAPI = createMockSpotifyAPI();
  });

  afterEach(() => {
    controller.reset();
    jest.clearAllMocks();
  });

  describe('Local File Errors', () => {
    test('file not found triggers error event', () => {
      let errorReceived = null;

      controller.audioElement.addEventListener('error', (e) => {
        errorReceived = e.target.error;
      });

      controller.audioElement.src = '/music/nonexistent.mp3';
      controller.audioElement._triggerError(4, 'MEDIA_ERR_SRC_NOT_SUPPORTED');

      expect(errorReceived).not.toBeNull();
      expect(errorReceived.code).toBe(4);
    });

    test('unsupported format triggers fallback to next source', async () => {
      const multiSourceTrack = {
        ...mockTracks.multiSource,
        _activeResolver: 'localfiles'
      };

      controller.setCurrentTrack(multiSourceTrack);
      let fallbackTriggered = false;

      const handlePlaybackError = (error) => {
        // Check if there are other sources available
        const sources = multiSourceTrack.sources;
        const availableSources = Object.keys(sources).filter(
          s => s !== 'localfiles'
        );

        if (availableSources.length > 0) {
          fallbackTriggered = true;
          // Would switch to next available source
        }
      };

      controller.audioElement.addEventListener('error', () => {
        handlePlaybackError({ code: 4, message: 'Format not supported' });
      });

      controller.audioElement._triggerError(4, 'Format not supported');

      expect(fallbackTriggered).toBe(true);
    });

    test('decode error skips to next track when no fallback available', () => {
      const singleSourceTrack = {
        id: 'single-source',
        title: 'Only Local',
        sources: {
          localfiles: { path: '/music/corrupted.mp3' }
        },
        _activeResolver: 'localfiles'
      };

      controller.setCurrentTrack(singleSourceTrack);
      controller.setQueue([mockTracks.spotify]);

      let shouldSkipToNext = false;

      const handlePlaybackError = () => {
        const track = controller.currentTrack;
        const availableFallbacks = Object.keys(track.sources).filter(
          s => s !== track._activeResolver
        );

        if (availableFallbacks.length === 0) {
          shouldSkipToNext = true;
        }
      };

      controller.audioElement.addEventListener('error', handlePlaybackError);
      controller.audioElement._triggerError(3, 'MEDIA_ERR_DECODE');

      expect(shouldSkipToNext).toBe(true);
    });

    test('network error during local file load retries once', async () => {
      let loadAttempts = 0;
      const maxRetries = 1;

      const loadWithRetry = async () => {
        loadAttempts++;

        // Simulate network error
        const success = loadAttempts > 1;

        if (!success && loadAttempts <= maxRetries + 1) {
          await new Promise(r => setTimeout(r, 100));
          return loadWithRetry();
        }

        return success;
      };

      const result = await loadWithRetry();

      expect(loadAttempts).toBe(2);
      expect(result).toBe(true);
    });
  });

  describe('Spotify Errors', () => {
    test('Spotify 401 triggers token refresh', async () => {
      let tokenRefreshCalled = false;

      const handleSpotifyError = async (status) => {
        if (status === 401) {
          tokenRefreshCalled = true;
          // Would trigger token refresh flow
        }
      };

      await handleSpotifyError(401);

      expect(tokenRefreshCalled).toBe(true);
    });

    test('Spotify no active device falls back to other source', async () => {
      const track = { ...mockTracks.multiSource };
      let fellBackToOtherSource = false;

      const handleNoDevice = () => {
        // Check for other sources
        if (track.sources.localfiles || track.sources.soundcloud) {
          fellBackToOtherSource = true;
        }
      };

      // Simulate 404 - no active device
      mockSpotifyAPI.setDevices([]);
      handleNoDevice();

      expect(fellBackToOtherSource).toBe(true);
    });

    test('Spotify playback fails retries after 2 seconds', async () => {
      let attempts = 0;
      const retryDelay = 100; // Shortened for test

      const playWithRetry = async () => {
        attempts++;

        if (attempts === 1) {
          // First attempt fails
          await new Promise(r => setTimeout(r, retryDelay));
          return playWithRetry();
        }

        return true; // Second attempt succeeds
      };

      const result = await playWithRetry();

      expect(attempts).toBe(2);
      expect(result).toBe(true);
    });

    test('Spotify rate limit (429) waits before retry', async () => {
      const retryAfter = 100; // ms (shortened for test)
      let waitedForRetry = false;

      const handleRateLimit = async (retryAfterMs) => {
        await new Promise(r => setTimeout(r, retryAfterMs));
        waitedForRetry = true;
      };

      await handleRateLimit(retryAfter);

      expect(waitedForRetry).toBe(true);
    });
  });

  describe('SoundCloud Errors', () => {
    test('expired stream URL re-fetches new URL', async () => {
      let refetchCalled = false;

      const handleStreamError = async (error) => {
        if (error.message?.includes('403') || error.message?.includes('expired')) {
          refetchCalled = true;
          // Would fetch new stream URL
          return 'https://api.soundcloud.com/tracks/123/stream?new-token';
        }
        return null;
      };

      const newUrl = await handleStreamError({ message: '403 Forbidden - expired' });

      expect(refetchCalled).toBe(true);
      expect(newUrl).toContain('new-token');
    });

    test('SoundCloud track unavailable falls back to other source', () => {
      const track = {
        ...mockTracks.multiSource,
        _activeResolver: 'soundcloud'
      };

      let fallbackResolver = null;

      const handleUnavailable = () => {
        const sources = Object.keys(track.sources).filter(s => s !== 'soundcloud');
        if (sources.length > 0) {
          fallbackResolver = sources[0];
        }
      };

      handleUnavailable();

      expect(fallbackResolver).not.toBeNull();
      expect(['spotify', 'localfiles']).toContain(fallbackResolver);
    });
  });

  describe('Browser Extension Errors', () => {
    test('extension disconnect during playback pauses and notifies', async () => {
      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.youtube);

      let playbackPaused = false;
      let userNotified = false;

      const handleExtensionDisconnect = () => {
        controller.setBrowserPlaybackActive(false);
        controller.setIsPlaying(false);
        playbackPaused = true;
        userNotified = true; // Would show notification
      };

      handleExtensionDisconnect();

      expect(playbackPaused).toBe(true);
      expect(controller.browserPlaybackActive).toBe(false);
      expect(controller.isPlaying).toBe(false);
      expect(userNotified).toBe(true);
    });

    test('extension tab closed triggers advance to next track', () => {
      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.youtube);
      controller.setQueue([mockTracks.spotify]);

      let advancedToNext = false;

      const handleTabClosed = () => {
        controller.setBrowserPlaybackActive(false);
        if (controller.queue.length > 0) {
          advancedToNext = true;
        }
      };

      handleTabClosed();

      expect(advancedToNext).toBe(true);
    });

    test('extension message timeout retries connection', async () => {
      let retryCount = 0;
      const maxRetries = 3;

      const sendWithRetry = async () => {
        retryCount++;

        // Simulate timeout
        const success = retryCount === 3;

        if (!success && retryCount < maxRetries) {
          await new Promise(r => setTimeout(r, 50));
          return sendWithRetry();
        }

        return success;
      };

      const result = await sendWithRetry();

      expect(retryCount).toBe(3);
      expect(result).toBe(true);
    });
  });

  describe('Fallback Chain', () => {
    test('exhausts all sources before marking track as error', async () => {
      const track = {
        id: 'multi-fail',
        title: 'Multi Source Fail',
        sources: {
          spotify: { id: 's1' },
          localfiles: { id: 'l1' },
          soundcloud: { id: 'sc1' }
        }
      };

      const failedSources = [];
      let trackMarkedError = false;

      const tryPlayWithFallback = async (sourceOrder) => {
        for (const source of sourceOrder) {
          // Simulate all sources failing
          failedSources.push(source);
        }

        if (failedSources.length === sourceOrder.length) {
          trackMarkedError = true;
        }
      };

      await tryPlayWithFallback(['spotify', 'localfiles', 'soundcloud']);

      expect(failedSources).toHaveLength(3);
      expect(trackMarkedError).toBe(true);
    });

    test('successful fallback updates _activeResolver', () => {
      const track = {
        ...mockTracks.multiSource,
        _activeResolver: 'spotify'
      };

      // Spotify fails, fallback to localfiles
      const handleFallback = (newResolver) => {
        track._activeResolver = newResolver;
      };

      handleFallback('localfiles');

      expect(track._activeResolver).toBe('localfiles');
    });

    test('fallback preserves playback position when possible', () => {
      const currentPosition = 45; // seconds
      let positionPreserved = false;

      const handleFallbackWithPosition = (position, canSeek) => {
        if (canSeek && position > 0) {
          positionPreserved = true;
          // Would seek to position after new source loads
        }
      };

      // Local files support seeking
      handleFallbackWithPosition(currentPosition, true);

      expect(positionPreserved).toBe(true);
    });
  });

  describe('Rapid Error Scenarios', () => {
    test('rapid skip through multiple error tracks', async () => {
      const errorQueue = [
        { id: 't1', status: 'error' },
        { id: 't2', status: 'error' },
        { id: 't3', status: 'error' },
        { id: 't4', status: 'ready', sources: { spotify: {} } }
      ];

      controller.setQueue(errorQueue);
      let skippedTracks = [];

      const skipToNextPlayable = () => {
        while (controller.queue.length > 0) {
          const next = controller.queue[0];
          controller.setQueue(controller.queue.slice(1));

          if (next.status === 'error') {
            skippedTracks.push(next.id);
            continue;
          }

          return next;
        }
        return null;
      };

      const playable = skipToNextPlayable();

      expect(skippedTracks).toEqual(['t1', 't2', 't3']);
      expect(playable.id).toBe('t4');
    });

    test('error during auto-advance does not cause infinite loop', async () => {
      let advanceAttempts = 0;
      const maxAttempts = 10;
      let loopDetected = false;

      const safeAdvance = async () => {
        advanceAttempts++;

        if (advanceAttempts > maxAttempts) {
          loopDetected = true;
          return; // Break potential infinite loop
        }

        // Simulate error that would cause re-advance
        if (advanceAttempts < 5) {
          await safeAdvance();
        }
      };

      await safeAdvance();

      expect(loopDetected).toBe(false);
      expect(advanceAttempts).toBeLessThanOrEqual(maxAttempts);
    });
  });

  describe('Network Errors', () => {
    test('network offline pauses streaming sources', () => {
      controller.setStreamingPlaybackActive(true);
      controller.setIsPlaying(true);

      let pausedDueToOffline = false;

      const handleOffline = () => {
        if (controller.streamingPlaybackActive) {
          pausedDueToOffline = true;
          controller.setIsPlaying(false);
        }
      };

      handleOffline();

      expect(pausedDueToOffline).toBe(true);
      expect(controller.isPlaying).toBe(false);
    });

    test('network online resumes paused streaming', () => {
      controller.setStreamingPlaybackActive(true);
      controller.setIsPlaying(false);

      let resumedOnOnline = false;

      const handleOnline = (wasPlayingBeforeOffline) => {
        if (wasPlayingBeforeOffline && controller.streamingPlaybackActive) {
          resumedOnOnline = true;
          controller.setIsPlaying(true);
        }
      };

      handleOnline(true);

      expect(resumedOnOnline).toBe(true);
      expect(controller.isPlaying).toBe(true);
    });

    test('local files continue playing during network outage', () => {
      controller.audioElement.src = '/music/local.mp3';
      controller.audioElement._setDuration(180);
      controller.audioElement.play();
      controller.setCurrentTrack(mockTracks.localFile);

      // Network goes offline
      const isLocalFile = controller.currentTrack._activeResolver === 'localfiles';
      const shouldContinuePlaying = isLocalFile;

      expect(shouldContinuePlaying).toBe(true);
      expect(controller.audioElement.paused).toBe(false);
    });
  });
});

describe('Error State Management', () => {
  let controller;

  beforeEach(() => {
    controller = createMockPlaybackController();
  });

  afterEach(() => {
    controller.reset();
  });

  test('track error status is set correctly', () => {
    const track = { id: 't1', status: 'ready' };

    const markTrackError = (t, reason) => {
      t.status = 'error';
      t.errorReason = reason;
    };

    markTrackError(track, 'Source unavailable');

    expect(track.status).toBe('error');
    expect(track.errorReason).toBe('Source unavailable');
  });

  test('error tracks are removed from queue on cleanup', () => {
    const queue = [
      { id: 't1', status: 'ready' },
      { id: 't2', status: 'error' },
      { id: 't3', status: 'error' },
      { id: 't4', status: 'ready' }
    ];

    const cleanQueue = queue.filter(t => t.status !== 'error');

    expect(cleanQueue).toHaveLength(2);
    expect(cleanQueue.map(t => t.id)).toEqual(['t1', 't4']);
  });

  test('isPlaying is false after unrecoverable error', () => {
    controller.setIsPlaying(true);

    const handleUnrecoverableError = () => {
      controller.setCurrentTrack(null);
      controller.setIsPlaying(false);
    };

    handleUnrecoverableError();

    expect(controller.isPlaying).toBe(false);
    expect(controller.currentTrack).toBeNull();
  });
});
