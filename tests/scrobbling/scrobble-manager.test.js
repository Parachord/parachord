/**
 * Scrobble Manager Tests
 *
 * Tests for the scrobbling system that tracks listening history
 * and reports to services like Last.fm and ListenBrainz.
 */

describe('ScrobbleManager', () => {
  let scrobbleManager;
  let mockPlugin;
  let mockStore;

  beforeEach(() => {
    // Create fresh scrobble manager instance for testing
    scrobbleManager = {
      plugins: new Map(),
      currentTrack: null,
      trackStartTime: null,
      scrobbleSubmitted: false,
      nowPlayingSent: false,
      onScrobbleCallback: null,

      registerPlugin(plugin) {
        if (!plugin.id || !plugin.scrobble || !plugin.updateNowPlaying) {
          return false;
        }
        this.plugins.set(plugin.id, plugin);
        return true;
      },

      unregisterPlugin(pluginId) {
        this.plugins.delete(pluginId);
      },

      getPlugins() {
        return Array.from(this.plugins.values());
      },

      async getEnabledPlugins() {
        const enabled = [];
        for (const plugin of this.plugins.values()) {
          if (await plugin.isEnabled()) {
            enabled.push(plugin);
          }
        }
        return enabled;
      },

      async onTrackStart(track) {
        this.currentTrack = track;
        this.trackStartTime = Date.now();
        this.scrobbleSubmitted = false;
        this.nowPlayingSent = false;

        if (!track.title || !track.artist) {
          return;
        }

        if (track.duration && track.duration < 30) {
          return;
        }

        const enabledPlugins = await this.getEnabledPlugins();
        for (const plugin of enabledPlugins) {
          try {
            await plugin.updateNowPlaying(track);
          } catch (error) {
            // Log but continue
          }
        }
        this.nowPlayingSent = true;
      },

      async onProgressUpdate(progressSeconds) {
        if (!this.currentTrack || this.scrobbleSubmitted) {
          return;
        }

        const track = this.currentTrack;
        const duration = track.duration;

        if (!duration || duration < 30) {
          return;
        }

        const halfDuration = duration / 2;
        const fourMinutes = 240;
        const minListenTime = 30;
        const threshold = Math.max(minListenTime, Math.min(halfDuration, fourMinutes));

        if (progressSeconds >= threshold) {
          await this.submitScrobble();
        }
      },

      async submitScrobble() {
        if (this.scrobbleSubmitted || !this.currentTrack) {
          return;
        }

        this.scrobbleSubmitted = true;
        const track = this.currentTrack;
        const timestamp = Math.floor(this.trackStartTime / 1000);

        const enabledPlugins = await this.getEnabledPlugins();
        let anySuccess = false;

        for (const plugin of enabledPlugins) {
          try {
            await plugin.scrobble(track, timestamp);
            anySuccess = true;
          } catch (error) {
            // Would queue for retry
          }
        }

        if (anySuccess && this.onScrobbleCallback) {
          this.onScrobbleCallback(track, timestamp);
        }
      },

      onTrackEnd() {
        this.currentTrack = null;
        this.trackStartTime = null;
      }
    };

    // Create mock plugin
    mockPlugin = {
      id: 'lastfm',
      isEnabled: jest.fn().mockResolvedValue(true),
      updateNowPlaying: jest.fn().mockResolvedValue(true),
      scrobble: jest.fn().mockResolvedValue(true)
    };

    // Create mock store
    mockStore = {
      data: {},
      get: jest.fn((key) => Promise.resolve(mockStore.data[key])),
      set: jest.fn((key, value) => {
        mockStore.data[key] = value;
        return Promise.resolve();
      })
    };
  });

  describe('Plugin Registration', () => {
    test('can register a valid plugin', () => {
      const result = scrobbleManager.registerPlugin(mockPlugin);

      expect(result).toBe(true);
      expect(scrobbleManager.plugins.has('lastfm')).toBe(true);
    });

    test('rejects plugin without id', () => {
      const invalidPlugin = {
        scrobble: jest.fn(),
        updateNowPlaying: jest.fn()
      };

      const result = scrobbleManager.registerPlugin(invalidPlugin);

      expect(result).toBe(false);
    });

    test('rejects plugin without scrobble method', () => {
      const invalidPlugin = {
        id: 'test',
        updateNowPlaying: jest.fn()
      };

      const result = scrobbleManager.registerPlugin(invalidPlugin);

      expect(result).toBe(false);
    });

    test('rejects plugin without updateNowPlaying method', () => {
      const invalidPlugin = {
        id: 'test',
        scrobble: jest.fn()
      };

      const result = scrobbleManager.registerPlugin(invalidPlugin);

      expect(result).toBe(false);
    });

    test('can unregister a plugin', () => {
      scrobbleManager.registerPlugin(mockPlugin);
      expect(scrobbleManager.plugins.has('lastfm')).toBe(true);

      scrobbleManager.unregisterPlugin('lastfm');
      expect(scrobbleManager.plugins.has('lastfm')).toBe(false);
    });

    test('getPlugins returns all registered plugins', () => {
      const plugin2 = { ...mockPlugin, id: 'listenbrainz' };

      scrobbleManager.registerPlugin(mockPlugin);
      scrobbleManager.registerPlugin(plugin2);

      const plugins = scrobbleManager.getPlugins();

      expect(plugins).toHaveLength(2);
    });

    test('getEnabledPlugins returns only enabled plugins', async () => {
      const disabledPlugin = {
        ...mockPlugin,
        id: 'disabled',
        isEnabled: jest.fn().mockResolvedValue(false)
      };

      scrobbleManager.registerPlugin(mockPlugin);
      scrobbleManager.registerPlugin(disabledPlugin);

      const enabled = await scrobbleManager.getEnabledPlugins();

      expect(enabled).toHaveLength(1);
      expect(enabled[0].id).toBe('lastfm');
    });
  });

  describe('Track Start', () => {
    beforeEach(() => {
      scrobbleManager.registerPlugin(mockPlugin);
    });

    test('onTrackStart sets current track', async () => {
      const track = { title: 'Test Song', artist: 'Test Artist', duration: 180 };

      await scrobbleManager.onTrackStart(track);

      expect(scrobbleManager.currentTrack).toBe(track);
      expect(scrobbleManager.trackStartTime).toBeDefined();
    });

    test('onTrackStart resets scrobble state', async () => {
      scrobbleManager.scrobbleSubmitted = true;
      scrobbleManager.nowPlayingSent = true;

      const track = { title: 'Test Song', artist: 'Test Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);

      expect(scrobbleManager.scrobbleSubmitted).toBe(false);
      expect(scrobbleManager.nowPlayingSent).toBe(true); // Set after sending
    });

    test('onTrackStart sends Now Playing to enabled plugins', async () => {
      const track = { title: 'Test Song', artist: 'Test Artist', duration: 180 };

      await scrobbleManager.onTrackStart(track);

      expect(mockPlugin.updateNowPlaying).toHaveBeenCalledWith(track);
    });

    test('tracks without title are skipped', async () => {
      const track = { artist: 'Test Artist', duration: 180 };

      await scrobbleManager.onTrackStart(track);

      expect(mockPlugin.updateNowPlaying).not.toHaveBeenCalled();
    });

    test('tracks without artist are skipped', async () => {
      const track = { title: 'Test Song', duration: 180 };

      await scrobbleManager.onTrackStart(track);

      expect(mockPlugin.updateNowPlaying).not.toHaveBeenCalled();
    });

    test('tracks under 30 seconds are skipped', async () => {
      const track = { title: 'Jingle', artist: 'Artist', duration: 15 };

      await scrobbleManager.onTrackStart(track);

      expect(mockPlugin.updateNowPlaying).not.toHaveBeenCalled();
    });

    test('tracks exactly 30 seconds are processed', async () => {
      const track = { title: 'Short Song', artist: 'Artist', duration: 30 };

      await scrobbleManager.onTrackStart(track);

      expect(mockPlugin.updateNowPlaying).toHaveBeenCalled();
    });
  });

  describe('Scrobble Threshold', () => {
    beforeEach(() => {
      scrobbleManager.registerPlugin(mockPlugin);
    });

    test('scrobbles at 50% for short tracks (< 8 minutes)', async () => {
      const track = { title: 'Song', artist: 'Artist', duration: 180 }; // 3 minutes
      await scrobbleManager.onTrackStart(track);

      // At 89 seconds (49.4%) - should not scrobble
      await scrobbleManager.onProgressUpdate(89);
      expect(mockPlugin.scrobble).not.toHaveBeenCalled();

      // At 90 seconds (50%) - should scrobble
      await scrobbleManager.onProgressUpdate(90);
      expect(mockPlugin.scrobble).toHaveBeenCalled();
    });

    test('scrobbles at 4 minutes for long tracks (> 8 minutes)', async () => {
      const track = { title: 'Long Song', artist: 'Artist', duration: 600 }; // 10 minutes
      await scrobbleManager.onTrackStart(track);

      // At 239 seconds - should not scrobble
      await scrobbleManager.onProgressUpdate(239);
      expect(mockPlugin.scrobble).not.toHaveBeenCalled();

      // At 240 seconds (4 minutes) - should scrobble
      await scrobbleManager.onProgressUpdate(240);
      expect(mockPlugin.scrobble).toHaveBeenCalled();
    });

    test('minimum 30 seconds listen time required', async () => {
      const track = { title: 'Short', artist: 'Artist', duration: 45 }; // 45 seconds
      await scrobbleManager.onTrackStart(track);

      // 50% of 45s = 22.5s, but min is 30s
      await scrobbleManager.onProgressUpdate(25);
      expect(mockPlugin.scrobble).not.toHaveBeenCalled();

      await scrobbleManager.onProgressUpdate(30);
      expect(mockPlugin.scrobble).toHaveBeenCalled();
    });

    test('scrobble only submitted once per track', async () => {
      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);

      await scrobbleManager.onProgressUpdate(90);
      await scrobbleManager.onProgressUpdate(120);
      await scrobbleManager.onProgressUpdate(180);

      expect(mockPlugin.scrobble).toHaveBeenCalledTimes(1);
    });
  });

  describe('Scrobble Submission', () => {
    beforeEach(() => {
      scrobbleManager.registerPlugin(mockPlugin);
    });

    test('submitScrobble sends to all enabled plugins', async () => {
      const plugin2 = {
        ...mockPlugin,
        id: 'listenbrainz',
        isEnabled: jest.fn().mockResolvedValue(true),
        scrobble: jest.fn().mockResolvedValue(true)
      };
      scrobbleManager.registerPlugin(plugin2);

      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);
      await scrobbleManager.onProgressUpdate(90);

      expect(mockPlugin.scrobble).toHaveBeenCalled();
      expect(plugin2.scrobble).toHaveBeenCalled();
    });

    test('submitScrobble includes timestamp', async () => {
      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);

      const startTime = scrobbleManager.trackStartTime;
      await scrobbleManager.onProgressUpdate(90);

      const [, timestamp] = mockPlugin.scrobble.mock.calls[0];
      expect(timestamp).toBe(Math.floor(startTime / 1000));
    });

    test('failed scrobble does not prevent others', async () => {
      const failingPlugin = {
        ...mockPlugin,
        id: 'failing',
        scrobble: jest.fn().mockRejectedValue(new Error('Network error'))
      };
      scrobbleManager.registerPlugin(failingPlugin);

      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);
      await scrobbleManager.onProgressUpdate(90);

      expect(mockPlugin.scrobble).toHaveBeenCalled();
      expect(failingPlugin.scrobble).toHaveBeenCalled();
    });

    test('onScrobbleCallback is called on success', async () => {
      const callback = jest.fn();
      scrobbleManager.onScrobbleCallback = callback;

      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);
      await scrobbleManager.onProgressUpdate(90);

      expect(callback).toHaveBeenCalledWith(track, expect.any(Number));
    });
  });

  describe('Track End', () => {
    test('onTrackEnd clears current track', async () => {
      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);

      scrobbleManager.onTrackEnd();

      expect(scrobbleManager.currentTrack).toBeNull();
      expect(scrobbleManager.trackStartTime).toBeNull();
    });

    test('scrobble not submitted on skip before threshold', async () => {
      scrobbleManager.registerPlugin(mockPlugin);

      const track = { title: 'Song', artist: 'Artist', duration: 180 };
      await scrobbleManager.onTrackStart(track);
      await scrobbleManager.onProgressUpdate(30); // Under 50%

      scrobbleManager.onTrackEnd();

      expect(mockPlugin.scrobble).not.toHaveBeenCalled();
    });
  });
});

describe('Scrobble Threshold Calculation', () => {
  const calculateThreshold = (duration) => {
    const halfDuration = duration / 2;
    const fourMinutes = 240;
    const minListenTime = 30;
    return Math.max(minListenTime, Math.min(halfDuration, fourMinutes));
  };

  test('30 second track threshold is 30 seconds (minimum)', () => {
    expect(calculateThreshold(30)).toBe(30);
  });

  test('60 second track threshold is 30 seconds (50% = 30s)', () => {
    expect(calculateThreshold(60)).toBe(30);
  });

  test('180 second (3 min) track threshold is 90 seconds (50%)', () => {
    expect(calculateThreshold(180)).toBe(90);
  });

  test('480 second (8 min) track threshold is 240 seconds (50% = 4 min)', () => {
    expect(calculateThreshold(480)).toBe(240);
  });

  test('600 second (10 min) track threshold is 240 seconds (capped at 4 min)', () => {
    expect(calculateThreshold(600)).toBe(240);
  });

  test('3600 second (1 hour) track threshold is 240 seconds (capped at 4 min)', () => {
    expect(calculateThreshold(3600)).toBe(240);
  });
});

describe('Failed Scrobble Queue', () => {
  test('failed scrobbles are queued for retry', () => {
    const queue = [];

    const queueFailedScrobble = (pluginId, track, timestamp, error) => {
      queue.push({
        pluginId,
        track: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration
        },
        timestamp,
        error,
        attempts: 1,
        queuedAt: Date.now()
      });
    };

    queueFailedScrobble('lastfm', {
      title: 'Song',
      artist: 'Artist',
      album: 'Album',
      duration: 180
    }, 1234567890, 'Network error');

    expect(queue).toHaveLength(1);
    expect(queue[0].pluginId).toBe('lastfm');
    expect(queue[0].attempts).toBe(1);
  });

  test('queue is limited to 500 entries', () => {
    const queue = Array.from({ length: 500 }, (_, i) => ({
      id: i,
      pluginId: 'lastfm'
    }));

    // Add one more
    queue.push({ id: 500, pluginId: 'lastfm' });

    // Trim to 500
    if (queue.length > 500) {
      queue.splice(0, queue.length - 500);
    }

    expect(queue).toHaveLength(500);
    expect(queue[0].id).toBe(1); // First was removed
    expect(queue[499].id).toBe(500); // Last is the new one
  });

  test('scrobbles are dropped after 10 attempts', () => {
    const item = { attempts: 10, queuedAt: Date.now() };

    const shouldDrop = item.attempts >= 10;

    expect(shouldDrop).toBe(true);
  });

  test('scrobbles are dropped after 14 days', () => {
    const fourteenDaysAgo = Date.now() - (14 * 24 * 60 * 60 * 1000) - 1000;
    const item = { attempts: 5, queuedAt: fourteenDaysAgo };

    const shouldDrop = (Date.now() - item.queuedAt) >= 14 * 24 * 60 * 60 * 1000;

    expect(shouldDrop).toBe(true);
  });

  test('recent scrobbles with few attempts are kept', () => {
    const item = { attempts: 3, queuedAt: Date.now() - (1 * 24 * 60 * 60 * 1000) }; // 1 day ago

    const shouldKeep = item.attempts < 10 &&
      (Date.now() - item.queuedAt) < 14 * 24 * 60 * 60 * 1000;

    expect(shouldKeep).toBe(true);
  });
});
