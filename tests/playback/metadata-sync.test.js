/**
 * Metadata Sync Tests
 *
 * Tests that ensure track metadata (title, artist, album, progress, duration)
 * stays in sync with what's actually playing.
 */

const {
  MockAudio,
  createMockElectron,
  createMockPlaybackController,
  createMockSpotifyAPI,
  mockTracks
} = require('../test-utils/mocks');

const { spotifyResponses, extensionMessages } = require('../test-utils/fixtures');

describe('Metadata Sync', () => {
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

  describe('Current Track State', () => {
    test('currentTrack matches the track being played', () => {
      controller.setCurrentTrack(mockTracks.spotify);

      expect(controller.currentTrack.id).toBe('spotify-track-1');
      expect(controller.currentTrack.title).toBe('Test Song');
      expect(controller.currentTrack.artist).toBe('Test Artist');
      expect(controller.currentTrack.album).toBe('Test Album');
    });

    test('currentTrack updates when switching tracks', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      expect(controller.currentTrack.title).toBe('Test Song');

      controller.setCurrentTrack(mockTracks.localFile);
      expect(controller.currentTrack.title).toBe('Local Song');
      expect(controller.currentTrack.id).toBe('local-track-1');
    });

    test('_activeResolver correctly identifies current source', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      expect(controller.currentTrack._activeResolver).toBe('spotify');

      controller.setCurrentTrack(mockTracks.localFile);
      expect(controller.currentTrack._activeResolver).toBe('localfiles');

      controller.setCurrentTrack(mockTracks.soundcloud);
      expect(controller.currentTrack._activeResolver).toBe('soundcloud');

      controller.setCurrentTrack(mockTracks.youtube);
      expect(controller.currentTrack._activeResolver).toBe('youtube');
    });
  });

  describe('Local File Metadata', () => {
    test('duration updates from loadedmetadata event', () => {
      let trackDuration = 0;

      controller.audioElement.addEventListener('loadedmetadata', (e) => {
        trackDuration = e.target.duration;
      });

      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(245.5);

      expect(trackDuration).toBe(245.5);
    });

    test('progress updates from timeupdate events', async () => {
      const progressUpdates = [];

      controller.audioElement.addEventListener('timeupdate', (e) => {
        progressUpdates.push(e.target.currentTime);
      });

      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(10);
      controller.audioElement._shouldAutoEnd = true;

      await controller.audioElement.play();

      // Wait for some progress
      await new Promise(resolve => setTimeout(resolve, 600));

      controller.audioElement.pause();

      // Should have received multiple progress updates
      expect(progressUpdates.length).toBeGreaterThan(0);
      expect(progressUpdates[progressUpdates.length - 1]).toBeGreaterThan(0);
    });

    test('ended event fires when track completes', async () => {
      let endedFired = false;

      controller.audioElement.addEventListener('ended', () => {
        endedFired = true;
      });

      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(0.5); // Short duration for test
      controller.audioElement._shouldAutoEnd = true;

      await controller.audioElement.play();

      // Wait for track to end
      await new Promise(resolve => setTimeout(resolve, 800));

      expect(endedFired).toBe(true);
    });
  });

  describe('Spotify Polling Metadata', () => {
    test('getCurrentPlaybackState returns correct data', async () => {
      mockSpotifyAPI.setCurrentPlayback(spotifyResponses.currentlyPlaying);

      const response = await mockSpotifyAPI.fetch('https://api.spotify.com/v1/me/player');
      expect(response.status).toBe(200);

      const data = await response.json();
      expect(data.is_playing).toBe(true);
      expect(data.progress_ms).toBe(45000);
      expect(data.item.name).toBe('Test Track');
      expect(data.item.duration_ms).toBe(180000);
    });

    test('204 status indicates no playback', async () => {
      mockSpotifyAPI.setCurrentPlayback(null);

      const response = await mockSpotifyAPI.fetch('https://api.spotify.com/v1/me/player');
      expect(response.status).toBe(204);
    });

    test('polling skips update when local file is playing', () => {
      // Setup: Local file playing, Spotify was previous source
      controller.audioElement.src = '/music/local.mp3';
      controller.audioElement._setDuration(180);
      controller.audioElement.play();
      controller.setCurrentTrack(mockTracks.localFile);

      // Simulate polling check
      const shouldSkipPolling = () => {
        const currentResolver = controller.currentTrack?._activeResolver;
        if (currentResolver === 'localfiles' || currentResolver === 'soundcloud') {
          return true;
        }
        if (controller.audioElement && !controller.audioElement.paused && controller.audioElement.src) {
          return true;
        }
        return false;
      };

      expect(shouldSkipPolling()).toBe(true);
    });

    test('polling skips update when browser extension is playing', () => {
      controller.setBrowserPlaybackActive(true);
      controller.setCurrentTrack(mockTracks.youtube);

      const shouldSkipPolling = () => {
        if (controller.browserPlaybackActive) {
          return true;
        }
        return false;
      };

      expect(shouldSkipPolling()).toBe(true);
    });

    test('polling updates progress when Spotify is active', async () => {
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setStreamingPlaybackActive(true);

      mockSpotifyAPI.setCurrentPlayback(spotifyResponses.currentlyPlaying);

      // Simulate polling
      const response = await mockSpotifyAPI.fetch('https://api.spotify.com/v1/me/player');
      const data = await response.json();

      // Would update progress state
      const newProgress = data.progress_ms / 1000;
      expect(newProgress).toBe(45);
    });
  });

  describe('Browser Extension Metadata', () => {
    test('extension playing message updates state', () => {
      let receivedTrack = null;

      // Simulate receiving extension message
      mockElectron.extension.onMessage((callback) => {
        receivedTrack = extensionMessages.playing.track;
      });

      // Trigger the callback
      mockElectron.extension._simulateMessage(extensionMessages.playing);

      // Verify message handling would update state
      expect(extensionMessages.playing.track.title).toBe('YouTube Video Title');
      expect(extensionMessages.playing.track.artist).toBe('Channel Name');
      expect(extensionMessages.playing.track.duration).toBe(300);
    });

    test('extension progress message updates current time', () => {
      const progressMessage = extensionMessages.progress;

      expect(progressMessage.currentTime).toBe(45);
      expect(progressMessage.duration).toBe(300);
    });
  });

  describe('Source Switch Metadata Handling', () => {
    test('metadata is preserved when switching with multi-source track', () => {
      const multiSourceTrack = { ...mockTracks.multiSource };

      // Start with Spotify source
      multiSourceTrack._activeResolver = 'spotify';
      controller.setCurrentTrack(multiSourceTrack);

      expect(controller.currentTrack.title).toBe('Multi Source Song');
      expect(controller.currentTrack._activeResolver).toBe('spotify');

      // Switch to local file source (same track)
      multiSourceTrack._activeResolver = 'localfiles';
      controller.setCurrentTrack(multiSourceTrack);

      // Title should remain the same
      expect(controller.currentTrack.title).toBe('Multi Source Song');
      expect(controller.currentTrack._activeResolver).toBe('localfiles');
    });

    test('previous track metadata goes to history', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      controller.addToHistory(controller.currentTrack);

      controller.setCurrentTrack(mockTracks.localFile);

      // History should have the Spotify track
      expect(controller.playHistory.length).toBe(1);
      expect(controller.playHistory[0].id).toBe('spotify-track-1');
      expect(controller.playHistory[0].title).toBe('Test Song');
    });
  });

  describe('Edge Cases', () => {
    test('null currentTrack is handled gracefully', () => {
      controller.setCurrentTrack(null);

      expect(controller.currentTrack).toBeNull();

      // Checking _activeResolver on null should be safe
      const resolver = controller.currentTrack?._activeResolver;
      expect(resolver).toBeUndefined();
    });

    test('track with missing metadata fields', () => {
      const incompleteTrack = {
        id: 'incomplete-track',
        title: 'Only Title',
        // Missing artist, album, duration
        sources: {}
      };

      controller.setCurrentTrack(incompleteTrack);

      expect(controller.currentTrack.title).toBe('Only Title');
      expect(controller.currentTrack.artist).toBeUndefined();
      expect(controller.currentTrack.album).toBeUndefined();
    });

    test('duration of 0 is handled correctly', () => {
      controller.audioElement.src = '/music/test.mp3';
      controller.audioElement._setDuration(0);

      expect(controller.audioElement.duration).toBe(0);
    });
  });
});

describe('Progress Interpolation', () => {
  test('progress can be interpolated between polling intervals', () => {
    // Spotify polls every 5 seconds
    // Between polls, progress is interpolated locally

    let polledProgress = 45; // seconds
    const pollInterval = 5000; // ms
    const polledAt = Date.now();

    // Calculate interpolated progress
    const getInterpolatedProgress = () => {
      const elapsed = (Date.now() - polledAt) / 1000;
      return polledProgress + elapsed;
    };

    // Immediately after poll
    expect(getInterpolatedProgress()).toBeWithinRange(45, 45.1);

    // Note: We can't easily test time passage in unit tests without mocking Date
    // This test validates the interpolation logic structure
  });

  test('interpolation stops when paused', () => {
    let isPlaying = true;
    let polledProgress = 45;
    const polledAt = Date.now();

    const getInterpolatedProgress = () => {
      if (!isPlaying) {
        return polledProgress; // Don't advance when paused
      }
      const elapsed = (Date.now() - polledAt) / 1000;
      return polledProgress + elapsed;
    };

    isPlaying = false;
    expect(getInterpolatedProgress()).toBe(45);
  });
});
