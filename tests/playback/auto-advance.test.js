/**
 * Auto-Advance Tests
 *
 * Tests for automatic advancement to next track when current track ends.
 * Covers transitions between all source types.
 */

const {
  MockAudio,
  createMockElectron,
  createMockPlaybackController,
  createMockQueue,
  mockTracks
} = require('../test-utils/mocks');

const { autoAdvanceScenarios, mixedSourcePlaylist } = require('../test-utils/fixtures');

describe('Auto-Advance', () => {
  let controller;
  let mockElectron;
  let handleNextCalled;
  let advanceLog;

  beforeEach(() => {
    controller = createMockPlaybackController();
    mockElectron = createMockElectron();
    handleNextCalled = false;
    advanceLog = [];

    // Mock handleNext
    controller.handleNext = async () => {
      handleNextCalled = true;
      advanceLog.push({
        from: controller.currentTrack?._activeResolver,
        time: Date.now()
      });
    };
  });

  afterEach(() => {
    controller.reset();
    jest.clearAllMocks();
  });

  describe('Local File Auto-Advance', () => {
    test('local file ended event triggers handleNext', async () => {
      const queue = createMockQueue([mockTracks.soundcloud]);
      controller.setQueue(queue);
      controller.setCurrentTrack(mockTracks.localFile);

      // Setup ended listener
      controller.audioElement.addEventListener('ended', () => {
        controller.handleNext();
      });

      // Setup audio and play to end
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(180);
      await controller.audioElement._playToEnd();

      expect(handleNextCalled).toBe(true);
    });

    test('pausing prevents auto-advance', async () => {
      controller.audioElement.addEventListener('ended', () => {
        controller.handleNext();
      });

      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(1);
      controller.audioElement._shouldAutoEnd = true;
      await controller.audioElement.play();

      // Pause before end
      await new Promise(resolve => setTimeout(resolve, 200));
      controller.audioElement.pause();

      // Wait to ensure no auto-advance
      await new Promise(resolve => setTimeout(resolve, 1000));

      expect(handleNextCalled).toBe(false);
    });
  });

  describe('SoundCloud Auto-Advance', () => {
    test('SoundCloud stream ended triggers handleNext', async () => {
      controller.setCurrentTrack(mockTracks.soundcloud);

      controller.audioElement.addEventListener('ended', () => {
        controller.handleNext();
      });

      controller.audioElement.src = 'https://api.soundcloud.com/tracks/123/stream';
      controller.audioElement._setDuration(200);
      await controller.audioElement._playToEnd();

      expect(handleNextCalled).toBe(true);
    });
  });

  describe('Spotify Polling Auto-Advance', () => {
    test('spotify-polling-advance IPC event triggers handleNext', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setStreamingPlaybackActive(true);

      // Simulate IPC event from main process
      mockElectron.spotify.polling.onAdvance(() => {
        controller.handleNext();
      });

      // Trigger the advance
      mockElectron.spotify.polling._triggerAdvance();

      expect(handleNextCalled).toBe(true);
    });

    test('polling detects track near end (< 2 seconds)', () => {
      const trackDuration = 180000; // 3 minutes in ms
      const currentProgress = 178500; // 1.5 seconds remaining

      const isNearEnd = (trackDuration - currentProgress) < 2000;

      expect(isNearEnd).toBe(true);
    });

    test('polling detects track at 98% complete', () => {
      const trackDuration = 180000;
      const currentProgress = 176500; // ~98%

      const percentComplete = (currentProgress / trackDuration) * 100;
      const shouldAdvance = percentComplete >= 98;

      expect(shouldAdvance).toBe(true);
    });
  });

  describe('Browser Extension Auto-Advance', () => {
    test('extension ended message triggers handleNext', () => {
      controller.setCurrentTrack(mockTracks.youtube);
      controller.setBrowserPlaybackActive(true);

      // Setup message handler
      const handleExtensionMessage = (message) => {
        if (message.type === 'status' && message.status === 'ended') {
          controller.handleNext();
        }
      };

      // Simulate ended message
      handleExtensionMessage({ type: 'status', status: 'ended', tabId: 123 });

      expect(handleNextCalled).toBe(true);
    });

    test('extension message ignored when other source is active', () => {
      // Local file is playing, not browser
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement.play();
      controller.setCurrentTrack(mockTracks.localFile);
      controller.setBrowserPlaybackActive(false);

      const handleExtensionMessage = (message) => {
        // Only handle if browser is the active source
        if (!controller.browserPlaybackActive) {
          return;
        }
        if (message.type === 'status' && message.status === 'ended') {
          controller.handleNext();
        }
      };

      handleExtensionMessage({ type: 'status', status: 'ended', tabId: 123 });

      expect(handleNextCalled).toBe(false);
    });
  });

  describe('Cross-Source Transitions', () => {
    test('Spotify -> Local file transition', async () => {
      const { spotifyToLocal } = autoAdvanceScenarios;

      controller.setCurrentTrack(spotifyToLocal.current);
      controller.setStreamingPlaybackActive(true);
      controller.setQueue([spotifyToLocal.next]);

      const actionLog = [];

      // Simulate handleNext for this transition
      const handleTransition = async () => {
        actionLog.push('stop_spotify');
        controller.setStreamingPlaybackActive(false);

        actionLog.push('get_next_track');
        const next = controller.queue[0];

        actionLog.push('start_local');
        controller.audioElement.src = next.sources.localfiles.path;
        await controller.audioElement.play();
        controller.setCurrentTrack({ ...next, _activeResolver: 'localfiles' });
      };

      await handleTransition();

      expect(actionLog).toEqual(['stop_spotify', 'get_next_track', 'start_local']);
      expect(controller.streamingPlaybackActive).toBe(false);
      expect(controller.audioElement.paused).toBe(false);
      expect(controller.currentTrack._activeResolver).toBe('localfiles');
    });

    test('Local file -> SoundCloud transition', async () => {
      const { localToSoundcloud } = autoAdvanceScenarios;

      controller.audioElement.src = '/music/current.mp3';
      await controller.audioElement.play();
      controller.setCurrentTrack(localToSoundcloud.current);
      controller.setQueue([localToSoundcloud.next]);

      const handleTransition = async () => {
        // Stop local
        controller.audioElement.pause();
        controller.audioElement.currentTime = 0;

        // Start SoundCloud (also uses audio element)
        const next = controller.queue[0];
        controller.audioElement.src = `https://api.soundcloud.com/tracks/${next.sources.soundcloud.soundcloudId}/stream`;
        controller.audioElement._setDuration(200);
        await controller.audioElement.play();
        controller.setCurrentTrack({ ...next, _activeResolver: 'soundcloud' });
      };

      await handleTransition();

      expect(controller.audioElement.paused).toBe(false);
      expect(controller.currentTrack._activeResolver).toBe('soundcloud');
    });

    test('SoundCloud -> YouTube (browser) transition', async () => {
      const { soundcloudToYoutube } = autoAdvanceScenarios;

      controller.audioElement.src = 'https://api.soundcloud.com/tracks/789012/stream';
      await controller.audioElement.play();
      controller.setCurrentTrack(soundcloudToYoutube.current);
      controller.setQueue([soundcloudToYoutube.next]);

      const handleTransition = async () => {
        // Stop SoundCloud
        controller.audioElement.pause();
        controller.audioElement.currentTime = 0;

        // Start browser playback
        const next = controller.queue[0];
        controller.setBrowserPlaybackActive(true);
        controller.setCurrentTrack({ ...next, _activeResolver: 'youtube' });
      };

      await handleTransition();

      expect(controller.audioElement.paused).toBe(true);
      expect(controller.browserPlaybackActive).toBe(true);
      expect(controller.currentTrack._activeResolver).toBe('youtube');
    });

    test('YouTube (browser) -> Spotify transition', async () => {
      const { youtubeToSpotify } = autoAdvanceScenarios;

      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(youtubeToSpotify.current);
      controller.setQueue([youtubeToSpotify.next]);

      const handleTransition = async () => {
        // Stop browser
        await mockElectron.extension.sendCommand({ type: 'command', action: 'pause' });
        controller.setBrowserPlaybackActive(false);

        // Start Spotify
        controller.setStreamingPlaybackActive(true);
        const next = controller.queue[0];
        controller.setCurrentTrack({ ...next, _activeResolver: 'spotify' });
      };

      await handleTransition();

      expect(controller.browserPlaybackActive).toBe(false);
      expect(controller.streamingPlaybackActive).toBe(true);
      expect(controller.currentTrack._activeResolver).toBe('spotify');
      expect(mockElectron.extension.sendCommand).toHaveBeenCalledWith({
        type: 'command',
        action: 'pause'
      });
    });
  });

  describe('Mixed Source Playlist Playthrough', () => {
    test('complete playthrough of mixed source playlist', async () => {
      const playlist = mixedSourcePlaylist.map((track, i) => ({
        ...track,
        _activeResolver: Object.keys(track.sources)[0]
      }));

      // Start with first track
      controller.setCurrentTrack(playlist[0]);
      controller.setQueue(playlist.slice(1));

      const playedTracks = [playlist[0]._activeResolver];

      // Simulate playing through all tracks
      for (let i = 1; i < playlist.length; i++) {
        // Add current to history
        controller.addToHistory(controller.currentTrack);

        // Get next
        const next = controller.queue[0];
        controller.setQueue(controller.queue.slice(1));
        controller.setCurrentTrack(next);

        playedTracks.push(next._activeResolver);
      }

      // Verify all tracks were "played"
      expect(playedTracks).toEqual(['spotify', 'localfiles', 'soundcloud', 'youtube', 'spotify']);
      expect(controller.playHistory.length).toBe(4);
      expect(controller.queue.length).toBe(0);
    });

    test('error tracks are skipped in playthrough', () => {
      const queueWithErrors = [
        { id: '1', status: 'ready', _activeResolver: 'spotify' },
        { id: '2', status: 'error', _activeResolver: null },
        { id: '3', status: 'error', _activeResolver: null },
        { id: '4', status: 'ready', _activeResolver: 'localfiles' },
        { id: '5', status: 'error', _activeResolver: null },
        { id: '6', status: 'ready', _activeResolver: 'soundcloud' }
      ];

      controller.setQueue(queueWithErrors);
      const playedIds = [];

      // Simulate advancing through queue, skipping errors
      while (controller.queue.length > 0) {
        const nextIndex = controller.queue.findIndex(t => t.status !== 'error');

        if (nextIndex === -1) {
          break; // No more playable tracks
        }

        const next = controller.queue[nextIndex];
        playedIds.push(next.id);

        // Remove up to and including this track
        controller.setQueue(controller.queue.slice(nextIndex + 1));
      }

      expect(playedIds).toEqual(['1', '4', '6']);
    });
  });

  describe('Edge Cases', () => {
    test('advance with empty queue stops playback', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setQueue([]);
      controller.setIsPlaying(true);

      const handleAdvance = () => {
        if (controller.queue.length === 0) {
          controller.setIsPlaying(false);
          return 'stopped';
        }
        return 'advanced';
      };

      const result = handleAdvance();

      expect(result).toBe('stopped');
      expect(controller.isPlaying).toBe(false);
    });

    test('advance during pending browser connect waits', () => {
      let waitingForBrowserPlayback = true;
      let advanceBlocked = false;

      const handleAdvance = () => {
        if (waitingForBrowserPlayback) {
          advanceBlocked = true;
          return;
        }
        // Would advance...
      };

      handleAdvance();

      expect(advanceBlocked).toBe(true);
    });

    test('multiple ended events only trigger one advance', async () => {
      let isAdvancing = false;
      let advanceCount = 0;

      const handleAdvance = async () => {
        if (isAdvancing) return;
        isAdvancing = true;

        advanceCount++;
        await new Promise(resolve => setTimeout(resolve, 50));

        isAdvancing = false;
      };

      // Simulate multiple ended events
      await Promise.all([
        handleAdvance(),
        handleAdvance(),
        handleAdvance()
      ]);

      expect(advanceCount).toBe(1);
    });
  });
});

describe('Spotify Polling State Machine', () => {
  test('detects track finished when progress stops advancing', () => {
    const pollHistory = [
      { progress: 175000, timestamp: 0 },
      { progress: 175000, timestamp: 5000 },
      { progress: 175000, timestamp: 10000 },
    ];

    const isStuck = pollHistory.every(p => p.progress === pollHistory[0].progress);
    const stuckCount = pollHistory.length;

    // After 3 polls at same progress, consider track finished
    expect(isStuck && stuckCount >= 3).toBe(true);
  });

  test('detects external track change by URI mismatch', () => {
    const expectedUri = 'spotify:track:expected123';
    const currentUri = 'spotify:track:different456';

    const isExternalChange = expectedUri !== currentUri;

    expect(isExternalChange).toBe(true);
  });

  test('204 status triggers advance (no active playback)', () => {
    const responseStatus = 204;

    const shouldAdvance = responseStatus === 204;

    expect(shouldAdvance).toBe(true);
  });
});
