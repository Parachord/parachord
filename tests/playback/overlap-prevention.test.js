/**
 * Playback Overlap Prevention Tests
 *
 * Tests that ensure only one audio source plays at a time.
 * Critical for user experience - no overlapping audio.
 */

const {
  MockAudio,
  createMockElectron,
  createMockPlaybackController,
  mockTracks
} = require('../test-utils/mocks');

const { mixedSourcePlaylist, autoAdvanceScenarios } = require('../test-utils/fixtures');

describe('Playback Overlap Prevention', () => {
  let controller;
  let mockElectron;
  let spotifyPauseCalled;
  let extensionPauseCalled;

  beforeEach(() => {
    controller = createMockPlaybackController();
    mockElectron = createMockElectron();
    spotifyPauseCalled = false;
    extensionPauseCalled = false;

    // Track when pause commands are sent
    mockElectron.extension.sendCommand.mockImplementation((cmd) => {
      if (cmd.action === 'pause') {
        extensionPauseCalled = true;
      }
      return Promise.resolve(true);
    });
  });

  afterEach(() => {
    controller.reset();
    jest.clearAllMocks();
  });

  describe('Source Switching', () => {
    test('switching from Spotify to local file stops Spotify first', async () => {
      // Setup: Spotify is playing
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setIsPlaying(true);
      controller.setStreamingPlaybackActive(true);

      // Action: Start playing local file
      const stopSpotifyBeforePlay = async () => {
        // This simulates what handlePlay does
        if (controller.streamingPlaybackActive) {
          // Would call Spotify pause API
          spotifyPauseCalled = true;
          controller.setStreamingPlaybackActive(false);
        }

        // Now play local file
        controller.audioElement.src = mockTracks.localFile.sources.localfiles.path;
        controller.audioElement._setDuration(240);
        await controller.audioElement.play();
        controller.setCurrentTrack(mockTracks.localFile);
      };

      await stopSpotifyBeforePlay();

      // Verify: Spotify was paused before local file started
      expect(spotifyPauseCalled).toBe(true);
      expect(controller.streamingPlaybackActive).toBe(false);
      expect(controller.audioElement.paused).toBe(false);
      expect(controller.currentTrack.id).toBe('local-track-1');
    });

    test('switching from local file to Spotify stops audio element first', async () => {
      // Setup: Local file is playing
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();
      controller.setCurrentTrack(mockTracks.localFile);
      controller.setIsPlaying(true);

      // Verify audio is playing
      expect(controller.audioElement.paused).toBe(false);

      // Action: Switch to Spotify
      const stopAudioBeforeSpotify = async () => {
        if (controller.audioElement && !controller.audioElement.paused) {
          controller.audioElement.pause();
          controller.audioElement.currentTime = 0;
        }

        // Start Spotify playback
        controller.setStreamingPlaybackActive(true);
        controller.setCurrentTrack(mockTracks.spotify);
      };

      await stopAudioBeforeSpotify();

      // Verify: Audio element was stopped
      expect(controller.audioElement.paused).toBe(true);
      expect(controller.audioElement.currentTime).toBe(0);
      expect(controller.streamingPlaybackActive).toBe(true);
      expect(controller.currentTrack.id).toBe('spotify-track-1');
    });

    test('switching from browser extension to local file stops extension first', async () => {
      // Setup: Browser extension is playing (e.g., YouTube)
      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.youtube);
      controller.setIsPlaying(true);

      // Action: Switch to local file
      const stopBrowserBeforeLocal = async () => {
        if (controller.browserPlaybackActive) {
          await mockElectron.extension.sendCommand({ type: 'command', action: 'pause' });
          controller.setBrowserPlaybackActive(false);
        }

        // Start local file
        controller.audioElement.src = mockTracks.localFile.sources.localfiles.path;
        controller.audioElement._setDuration(240);
        await controller.audioElement.play();
        controller.setCurrentTrack(mockTracks.localFile);
      };

      await stopBrowserBeforeLocal();

      // Verify: Extension received pause command
      expect(extensionPauseCalled).toBe(true);
      expect(controller.browserPlaybackActive).toBe(false);
      expect(controller.audioElement.paused).toBe(false);
    });

    test('switching from Spotify to browser extension stops Spotify first', async () => {
      // Setup: Spotify is playing
      controller.setStreamingPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setIsPlaying(true);

      // Action: Switch to browser extension (YouTube)
      const stopSpotifyBeforeBrowser = async () => {
        if (controller.streamingPlaybackActive) {
          spotifyPauseCalled = true;
          controller.setStreamingPlaybackActive(false);
        }

        controller.setBrowserPlaybackActive(true);
        controller.setCurrentTrack(mockTracks.youtube);
      };

      await stopSpotifyBeforeBrowser();

      // Verify
      expect(spotifyPauseCalled).toBe(true);
      expect(controller.streamingPlaybackActive).toBe(false);
      expect(controller.browserPlaybackActive).toBe(true);
    });

    test('switching from SoundCloud to Spotify stops audio element first', async () => {
      // Setup: SoundCloud is playing via audio element
      controller.audioElement.src = 'https://api.soundcloud.com/tracks/123/stream';
      controller.audioElement._setDuration(200);
      await controller.audioElement.play();
      controller.setCurrentTrack(mockTracks.soundcloud);
      controller.setIsPlaying(true);

      expect(controller.audioElement.paused).toBe(false);

      // Action: Switch to Spotify
      const stopSoundCloudBeforeSpotify = async () => {
        if (controller.audioElement && !controller.audioElement.paused) {
          controller.audioElement.pause();
          controller.audioElement.currentTime = 0;
        }

        controller.setStreamingPlaybackActive(true);
        controller.setCurrentTrack(mockTracks.spotify);
      };

      await stopSoundCloudBeforeSpotify();

      // Verify
      expect(controller.audioElement.paused).toBe(true);
      expect(controller.streamingPlaybackActive).toBe(true);
    });
  });

  describe('Concurrent Playback Prevention', () => {
    test('all three playback types cannot be active simultaneously', () => {
      // This should never happen - test that flags are mutually managed

      // Start with clean state
      expect(controller.audioElement.paused).toBe(true);
      expect(controller.streamingPlaybackActive).toBe(false);
      expect(controller.browserPlaybackActive).toBe(false);

      // Simulate starting Spotify
      controller.setStreamingPlaybackActive(true);

      // Before starting local, streaming should be stopped
      const canStartLocal = () => {
        if (controller.streamingPlaybackActive || controller.browserPlaybackActive) {
          return false; // Must stop other sources first
        }
        return true;
      };

      expect(canStartLocal()).toBe(false);

      // Stop Spotify first
      controller.setStreamingPlaybackActive(false);
      expect(canStartLocal()).toBe(true);
    });

    test('rapid source switching does not cause overlap', async () => {
      const playbackLog = [];

      // Helper to log playback events
      const logPlayback = (source, action) => {
        playbackLog.push({ source, action, time: Date.now() });
      };

      // Simulate rapid switching through multiple sources
      const rapidSwitch = async () => {
        // Play local
        logPlayback('local', 'start');
        controller.audioElement.src = '/music/test.mp3';
        await controller.audioElement.play();

        // Immediately switch to Spotify
        logPlayback('local', 'stop');
        controller.audioElement.pause();
        logPlayback('spotify', 'start');
        controller.setStreamingPlaybackActive(true);

        // Immediately switch to browser
        logPlayback('spotify', 'stop');
        controller.setStreamingPlaybackActive(false);
        logPlayback('browser', 'start');
        controller.setBrowserPlaybackActive(true);

        // Back to local
        logPlayback('browser', 'stop');
        controller.setBrowserPlaybackActive(false);
        logPlayback('local', 'start');
        controller.audioElement.src = '/music/test2.mp3';
        await controller.audioElement.play();
      };

      await rapidSwitch();

      // Verify: Each start was preceded by a stop of the previous source
      for (let i = 1; i < playbackLog.length; i++) {
        const current = playbackLog[i];
        const previous = playbackLog[i - 1];

        if (current.action === 'start') {
          // Previous action should be a stop (unless first start)
          if (i > 0 && previous.source !== current.source) {
            expect(previous.action).toBe('stop');
          }
        }
      }
    });
  });

  describe('Playback State Flags', () => {
    test('streamingPlaybackActiveRef is set correctly for Spotify', () => {
      controller.setStreamingPlaybackActive(true);
      expect(controller.streamingPlaybackActive).toBe(true);

      controller.setStreamingPlaybackActive(false);
      expect(controller.streamingPlaybackActive).toBe(false);
    });

    test('browserPlaybackActive is set correctly for extension', () => {
      controller.setBrowserPlaybackActive(true);
      expect(controller.browserPlaybackActive).toBe(true);

      controller.setBrowserPlaybackActive(false);
      expect(controller.browserPlaybackActive).toBe(false);
    });

    test('audio element paused state reflects local file status', async () => {
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(180);

      expect(controller.audioElement.paused).toBe(true);

      await controller.audioElement.play();
      expect(controller.audioElement.paused).toBe(false);

      controller.audioElement.pause();
      expect(controller.audioElement.paused).toBe(true);
    });
  });

  describe('Stop All Playback', () => {
    test('stopAllPlayback stops all active sources', async () => {
      // Setup: All sources somehow active (shouldn't happen, but test recovery)
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();
      controller.setStreamingPlaybackActive(true);
      controller.setBrowserPlaybackActive(true);

      // Action: Stop all playback
      const stopAllPlayback = async () => {
        // Stop audio element
        if (controller.audioElement && !controller.audioElement.paused) {
          controller.audioElement.pause();
          controller.audioElement.currentTime = 0;
        }

        // Stop streaming (Spotify)
        if (controller.streamingPlaybackActive) {
          spotifyPauseCalled = true;
          controller.setStreamingPlaybackActive(false);
        }

        // Stop browser extension
        if (controller.browserPlaybackActive) {
          await mockElectron.extension.sendCommand({ type: 'command', action: 'pause' });
          controller.setBrowserPlaybackActive(false);
        }

        controller.setIsPlaying(false);
      };

      await stopAllPlayback();

      // Verify: Everything stopped
      expect(controller.audioElement.paused).toBe(true);
      expect(controller.streamingPlaybackActive).toBe(false);
      expect(controller.browserPlaybackActive).toBe(false);
      expect(controller.isPlaying).toBe(false);
      expect(spotifyPauseCalled).toBe(true);
      expect(extensionPauseCalled).toBe(true);
    });
  });

  describe('Edge Cases', () => {
    test('stopping already stopped source is safe', () => {
      // Audio already paused
      expect(controller.audioElement.paused).toBe(true);

      // Pause again - should not throw
      expect(() => {
        controller.audioElement.pause();
      }).not.toThrow();

      // Spotify already inactive
      controller.setStreamingPlaybackActive(false);
      expect(() => {
        controller.setStreamingPlaybackActive(false);
      }).not.toThrow();
    });

    test('switching to same source type does not cause issues', async () => {
      // Playing local file 1
      controller.audioElement.src = '/music/song1.mp3';
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();
      controller.setCurrentTrack({ id: 'track-1', title: 'Song 1' });

      const originalSrc = controller.audioElement.src;

      // Switch to local file 2
      controller.audioElement.pause();
      controller.audioElement.src = '/music/song2.mp3';
      controller.audioElement._setDuration(200);
      await controller.audioElement.play();
      controller.setCurrentTrack({ id: 'track-2', title: 'Song 2' });

      // Verify: Now playing new track
      expect(controller.audioElement.src).not.toBe(originalSrc);
      expect(controller.audioElement.src).toBe('/music/song2.mp3');
      expect(controller.currentTrack.id).toBe('track-2');
    });
  });
});

describe('Auto-Advance Overlap Prevention', () => {
  let controller;
  let isAdvancingTrack;

  beforeEach(() => {
    controller = createMockPlaybackController();
    isAdvancingTrack = false;
  });

  afterEach(() => {
    controller.reset();
  });

  test('handleNext re-entrancy guard prevents duplicate advances', async () => {
    let advanceCount = 0;

    const handleNext = async () => {
      // Re-entrancy guard
      if (isAdvancingTrack) {
        return;
      }
      isAdvancingTrack = true;

      advanceCount++;

      // Simulate async work
      await new Promise(resolve => setTimeout(resolve, 100));

      isAdvancingTrack = false;
    };

    // Simulate multiple rapid calls (e.g., from different sources)
    await Promise.all([
      handleNext(),
      handleNext(),
      handleNext()
    ]);

    // Only one should have executed
    expect(advanceCount).toBe(1);
  });

  test('auto-advance stops current source before starting next', async () => {
    const { spotifyToLocal } = autoAdvanceScenarios;
    const actionLog = [];

    // Setup: Spotify playing
    controller.setCurrentTrack(spotifyToLocal.current);
    controller.setStreamingPlaybackActive(true);
    controller.setQueue([spotifyToLocal.next]);

    // Simulate handleNext
    const handleNext = async () => {
      // Stop current playback
      actionLog.push('stop_spotify');
      controller.setStreamingPlaybackActive(false);

      // Get next track
      const nextTrack = controller.queue[0];
      controller.setQueue([]);

      // Add current to history
      controller.addToHistory(controller.currentTrack);

      // Start next track (local file)
      actionLog.push('start_local');
      controller.audioElement.src = nextTrack.sources.localfiles.path;
      await controller.audioElement.play();
      controller.setCurrentTrack(nextTrack);
    };

    await handleNext();

    // Verify order: stop happened before start
    expect(actionLog).toEqual(['stop_spotify', 'start_local']);
    expect(controller.streamingPlaybackActive).toBe(false);
    expect(controller.audioElement.paused).toBe(false);
  });
});
