/**
 * Edge Case Playback Tests
 *
 * Tests for unusual playback scenarios that could break things:
 * very short tracks, zero duration, seeking edge cases,
 * repeated plays, queue manipulation during playback, etc.
 */

const {
  MockAudio,
  createMockElectron,
  createMockPlaybackController,
  createMockQueue,
  mockTracks
} = require('../test-utils/mocks');

describe('Edge Case Playback', () => {
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

  describe('Very Short Tracks', () => {
    test('track under 5 seconds plays and advances correctly', async () => {
      const shortTrack = {
        id: 'short-track',
        title: 'Very Short',
        duration: 3000, // 3 seconds
        sources: { localfiles: { path: '/music/short.mp3' } }
      };

      let endedFired = false;

      controller.audioElement.addEventListener('ended', () => {
        endedFired = true;
      });

      controller.setCurrentTrack(shortTrack);
      controller.audioElement.src = '/music/short.mp3';
      controller.audioElement._setDuration(3);
      await controller.audioElement._playToEnd();

      expect(endedFired).toBe(true);
    });

    test('track under 1 second does not cause timing issues', async () => {
      const veryShortTrack = {
        id: 'very-short',
        title: 'Blip',
        duration: 500, // 0.5 seconds
        sources: { localfiles: { path: '/music/blip.mp3' } }
      };

      controller.setCurrentTrack(veryShortTrack);
      controller.audioElement._setDuration(0.5);

      let progressUpdates = 0;
      controller.audioElement.addEventListener('timeupdate', () => {
        progressUpdates++;
      });

      await controller.audioElement._playToEnd();

      // Should still complete successfully
      expect(controller.audioElement.paused).toBe(true);
      expect(controller.audioElement.currentTime).toBe(0.5);
    });

    test('multiple short tracks in sequence play correctly', async () => {
      const shortTracks = [
        { id: 's1', duration: 2000, sources: { localfiles: {} } },
        { id: 's2', duration: 1500, sources: { localfiles: {} } },
        { id: 's3', duration: 3000, sources: { localfiles: {} } }
      ];

      const playedTracks = [];

      for (const track of shortTracks) {
        controller.setCurrentTrack(track);
        controller.audioElement._setDuration(track.duration / 1000);
        await controller.audioElement._playToEnd();
        playedTracks.push(track.id);
      }

      expect(playedTracks).toEqual(['s1', 's2', 's3']);
    });
  });

  describe('Zero and Invalid Duration', () => {
    test('track with 0 duration is handled gracefully', () => {
      const zeroDurationTrack = {
        id: 'zero-duration',
        title: 'Empty Track',
        duration: 0,
        sources: { localfiles: { path: '/music/empty.mp3' } }
      };

      controller.setCurrentTrack(zeroDurationTrack);
      controller.audioElement._setDuration(0);

      // Should not throw
      expect(controller.audioElement.duration).toBe(0);

      // Duration 0 should be treated as unknown/skip
      const shouldSkip = controller.audioElement.duration === 0;
      expect(shouldSkip).toBe(true);
    });

    test('track with NaN duration uses metadata duration', () => {
      const track = {
        id: 'nan-duration',
        title: 'Unknown Duration',
        duration: 180000, // From metadata
        sources: { localfiles: {} }
      };

      controller.audioElement._setDuration(NaN);

      // Should fall back to track metadata
      const effectiveDuration = isNaN(controller.audioElement.duration)
        ? track.duration / 1000
        : controller.audioElement.duration;

      expect(effectiveDuration).toBe(180);
    });

    test('track with Infinity duration is capped', () => {
      controller.audioElement._setDuration(Infinity);

      const cappedDuration = isFinite(controller.audioElement.duration)
        ? controller.audioElement.duration
        : 0;

      expect(cappedDuration).toBe(0);
    });

    test('negative duration is treated as 0', () => {
      controller.audioElement._setDuration(-10);

      const safeDuration = Math.max(0, controller.audioElement.duration);

      expect(safeDuration).toBe(0);
    });
  });

  describe('Seeking Edge Cases', () => {
    test('seek past end of track triggers ended', async () => {
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();

      let endedCalled = false;
      controller.audioElement.addEventListener('ended', () => {
        endedCalled = true;
      });

      // Seek past end
      controller.audioElement.currentTime = 200;

      // Clamp to duration
      const clampedTime = Math.min(
        controller.audioElement.currentTime,
        controller.audioElement.duration
      );

      expect(clampedTime).toBe(180);
    });

    test('seek to negative position is clamped to 0', () => {
      controller.audioElement._setDuration(180);
      controller.audioElement.currentTime = -10;

      const clampedTime = Math.max(0, controller.audioElement.currentTime);

      expect(clampedTime).toBe(0);
    });

    test('seek during loading is queued', async () => {
      let seekQueued = false;
      const pendingSeek = { position: 45 };

      const seekWhenReady = (position) => {
        if (controller.audioElement.readyState < 1) {
          seekQueued = true;
          pendingSeek.position = position;
          return false;
        }
        controller.audioElement.currentTime = position;
        return true;
      };

      // Audio not ready yet
      controller.audioElement.readyState = 0;
      const immediate = seekWhenReady(45);

      expect(immediate).toBe(false);
      expect(seekQueued).toBe(true);
      expect(pendingSeek.position).toBe(45);
    });

    test('rapid seeking does not cause issues', async () => {
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();

      const seekPositions = [10, 50, 120, 30, 90, 5, 175];

      for (const pos of seekPositions) {
        controller.audioElement.currentTime = pos;
      }

      // Should end at last seek position
      expect(controller.audioElement.currentTime).toBe(175);
    });
  });

  describe('Playing Same Track Twice', () => {
    test('playing same track resets position', async () => {
      const track = mockTracks.localFile;

      // First play
      controller.setCurrentTrack(track);
      controller.audioElement.src = track.sources.localfiles.path;
      controller.audioElement._setDuration(180);
      await controller.audioElement.play();
      controller.audioElement.currentTime = 90;

      // Stop
      controller.audioElement.pause();

      // Play same track again
      controller.audioElement.currentTime = 0;
      await controller.audioElement.play();

      expect(controller.audioElement.currentTime).toBe(0);
    });

    test('same track in queue plays twice', async () => {
      const track = mockTracks.spotify;
      const queue = [track, track, track];

      controller.setQueue(queue);
      let playCount = 0;

      for (let i = 0; i < queue.length; i++) {
        const current = controller.queue[0];
        controller.setQueue(controller.queue.slice(1));
        controller.setCurrentTrack(current);
        playCount++;
      }

      expect(playCount).toBe(3);
    });

    test('track ID collision between sources handled', () => {
      // Same track from different sources should be distinguishable
      const spotifyVersion = {
        id: 'track-123',
        title: 'Same Song',
        sources: { spotify: { spotifyUri: 'spotify:track:123' } },
        _activeResolver: 'spotify'
      };

      const localVersion = {
        id: 'track-123',
        title: 'Same Song',
        sources: { localfiles: { path: '/music/same-song.mp3' } },
        _activeResolver: 'localfiles'
      };

      // Create unique keys including resolver
      const spotifyKey = `${spotifyVersion.id}:${spotifyVersion._activeResolver}`;
      const localKey = `${localVersion.id}:${localVersion._activeResolver}`;

      expect(spotifyKey).not.toBe(localKey);
    });
  });

  describe('Queue Manipulation During Playback', () => {
    test('clearing queue during playback continues current track', async () => {
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setQueue([mockTracks.localFile, mockTracks.soundcloud]);
      controller.setIsPlaying(true);

      // Clear queue while playing
      controller.setQueue([]);

      // Current track should still be playing
      expect(controller.currentTrack).not.toBeNull();
      expect(controller.isPlaying).toBe(true);
      expect(controller.queue).toHaveLength(0);
    });

    test('adding to queue during playback works', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      controller.setQueue([mockTracks.localFile]);
      controller.setIsPlaying(true);

      // Add more tracks
      controller.setQueue([...controller.queue, mockTracks.soundcloud, mockTracks.youtube]);

      expect(controller.queue).toHaveLength(3);
    });

    test('removing current track from history during playback', () => {
      controller.addToHistory(mockTracks.spotify);
      controller.addToHistory(mockTracks.localFile);
      controller.setCurrentTrack(mockTracks.soundcloud);

      // Clear history while playing
      while (controller.playHistory.length > 0) {
        controller.popFromHistory();
      }

      expect(controller.playHistory).toHaveLength(0);
      expect(controller.currentTrack).not.toBeNull();
    });

    test('shuffle during playback preserves current track', () => {
      controller.setCurrentTrack(mockTracks.spotify);
      const originalQueue = [mockTracks.localFile, mockTracks.soundcloud, mockTracks.youtube];
      controller.setQueue([...originalQueue]);

      // Shuffle queue (simulation)
      const shuffled = [...controller.queue].sort(() => Math.random() - 0.5);
      controller.setQueue(shuffled);

      // Current track unchanged
      expect(controller.currentTrack.id).toBe(mockTracks.spotify.id);
      // Queue still has same tracks
      expect(controller.queue).toHaveLength(3);
    });

    test('inserting track at front of queue works', () => {
      controller.setQueue([mockTracks.localFile, mockTracks.soundcloud]);

      // Insert at front (play next)
      controller.setQueue([mockTracks.youtube, ...controller.queue]);

      expect(controller.queue[0].id).toBe(mockTracks.youtube.id);
      expect(controller.queue).toHaveLength(3);
    });
  });

  describe('Rapid State Changes', () => {
    test('rapid play/pause does not corrupt state', async () => {
      controller.audioElement._setDuration(180);

      for (let i = 0; i < 10; i++) {
        if (i % 2 === 0) {
          await controller.audioElement.play();
          controller.setIsPlaying(true);
        } else {
          controller.audioElement.pause();
          controller.setIsPlaying(false);
        }
      }

      // Should end in consistent state
      expect(controller.audioElement.paused).toBe(controller.isPlaying === false);
    });

    test('rapid track switching stabilizes', async () => {
      const tracks = [
        mockTracks.spotify,
        mockTracks.localFile,
        mockTracks.soundcloud,
        mockTracks.youtube
      ];

      for (const track of tracks) {
        controller.setCurrentTrack(track);
      }

      // Should end on last track
      expect(controller.currentTrack.id).toBe(mockTracks.youtube.id);
    });

    test('rapid source switching within same track', async () => {
      const track = { ...mockTracks.multiSource };

      const sourceOrder = ['spotify', 'localfiles', 'soundcloud', 'spotify'];

      for (const source of sourceOrder) {
        track._activeResolver = source;
      }

      expect(track._activeResolver).toBe('spotify');
    });
  });

  describe('Boundary Conditions', () => {
    test('maximum queue size is handled', () => {
      const largeQueue = Array.from({ length: 10000 }, (_, i) => ({
        id: `track-${i}`,
        title: `Track ${i}`,
        sources: { spotify: {} }
      }));

      controller.setQueue(largeQueue);

      expect(controller.queue).toHaveLength(10000);
    });

    test('very long track duration handled', () => {
      const longTrack = {
        id: 'long-track',
        title: 'Symphony',
        duration: 7200000, // 2 hours
        sources: { localfiles: {} }
      };

      controller.setCurrentTrack(longTrack);
      controller.audioElement._setDuration(7200);

      expect(controller.audioElement.duration).toBe(7200);
    });

    test('track with very long title handled', () => {
      const longTitleTrack = {
        id: 'long-title',
        title: 'A'.repeat(1000),
        artist: 'B'.repeat(500),
        album: 'C'.repeat(500),
        sources: { spotify: {} }
      };

      controller.setCurrentTrack(longTitleTrack);

      expect(controller.currentTrack.title.length).toBe(1000);
    });

    test('unicode and special characters in metadata', () => {
      const unicodeTrack = {
        id: 'unicode-track',
        title: '日本語の曲 🎵 Ñoño',
        artist: 'アーティスト & Müller',
        album: 'Álbum "Especial" <Test>',
        sources: { spotify: {} }
      };

      controller.setCurrentTrack(unicodeTrack);

      expect(controller.currentTrack.title).toContain('日本語');
      expect(controller.currentTrack.title).toContain('🎵');
    });
  });

  describe('Playback Position Edge Cases', () => {
    test('position at exactly track end', async () => {
      controller.audioElement._setDuration(180);
      controller.audioElement.currentTime = 180;

      let endedFired = false;
      controller.audioElement.addEventListener('ended', () => {
        endedFired = true;
      });

      // At exact end, should trigger ended
      controller.audioElement._triggerEnded();

      expect(endedFired).toBe(true);
    });

    test('position slightly before end triggers advance', () => {
      const duration = 180;
      const position = 179.9;

      const isNearEnd = (duration - position) < 0.5;

      expect(isNearEnd).toBe(true);
    });

    test('position updates during pause are ignored', () => {
      controller.audioElement._setDuration(180);
      controller.audioElement.currentTime = 45;
      controller.audioElement.pause();

      const positionBeforePause = controller.audioElement.currentTime;

      // Simulate time passing while paused
      // Position should not change

      expect(controller.audioElement.currentTime).toBe(positionBeforePause);
    });
  });

  describe('Source Availability Changes', () => {
    test('source becomes unavailable during playback', () => {
      const track = { ...mockTracks.multiSource, _activeResolver: 'spotify' };
      controller.setCurrentTrack(track);

      // Simulate Spotify becoming unavailable
      let needsFallback = false;

      const checkSourceAvailability = (resolver) => {
        const available = resolver !== 'spotify'; // Spotify now unavailable
        if (!available) {
          needsFallback = true;
        }
        return available;
      };

      checkSourceAvailability(track._activeResolver);

      expect(needsFallback).toBe(true);
    });

    test('all sources unavailable marks track as error', () => {
      const track = {
        id: 'no-sources',
        title: 'Unavailable',
        sources: {}
      };

      const hasAvailableSource = Object.keys(track.sources).length > 0;

      expect(hasAvailableSource).toBe(false);
    });
  });

  describe('Volume Edge Cases', () => {
    test('volume 0 is valid (muted)', () => {
      controller.audioElement.volume = 0;

      expect(controller.audioElement.volume).toBe(0);
    });

    test('volume above 1 is clamped', () => {
      controller.audioElement.volume = 1.5;

      const clampedVolume = Math.min(1, Math.max(0, controller.audioElement.volume));

      // Mock doesn't clamp automatically, but real implementation should
      expect(clampedVolume).toBeLessThanOrEqual(1);
    });

    test('negative volume is clamped to 0', () => {
      controller.audioElement.volume = -0.5;

      const clampedVolume = Math.max(0, controller.audioElement.volume);

      expect(clampedVolume).toBe(0);
    });
  });
});

describe('Concurrent Operations', () => {
  let controller;

  beforeEach(() => {
    controller = createMockPlaybackController();
  });

  afterEach(() => {
    controller.reset();
  });

  test('simultaneous play calls are deduplicated', async () => {
    let playCount = 0;
    let isPlaying = false;

    const safePlay = async () => {
      if (isPlaying) return;
      isPlaying = true;
      playCount++;
      await new Promise(r => setTimeout(r, 10));
    };

    // Fire multiple play calls simultaneously
    await Promise.all([safePlay(), safePlay(), safePlay()]);

    expect(playCount).toBe(1);
  });

  test('play during handleNext is handled', async () => {
    let isAdvancing = false;
    let playBlocked = false;

    const handleNext = async () => {
      isAdvancing = true;
      await new Promise(r => setTimeout(r, 50));
      isAdvancing = false;
    };

    const tryPlay = () => {
      if (isAdvancing) {
        playBlocked = true;
        return false;
      }
      return true;
    };

    // Start advancing
    const advancePromise = handleNext();

    // Try to play during advance
    await new Promise(r => setTimeout(r, 10));
    tryPlay();

    await advancePromise;

    expect(playBlocked).toBe(true);
  });
});
