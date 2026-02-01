/**
 * Test Mocks for Parachord
 * Provides mock implementations for Audio, Electron IPC, Spotify API, etc.
 */

/**
 * Mock HTML5 Audio Element
 * Simulates audio playback with controllable state
 */
class MockAudio {
  constructor(src = '') {
    this.src = src;
    this.paused = true;
    this.currentTime = 0;
    this.duration = 0;
    this.volume = 1;
    this.muted = false;
    this.playbackRate = 1;
    this.readyState = 0;
    this.error = null;

    // Event listeners
    this._eventListeners = {};

    // Playback simulation
    this._playbackInterval = null;
    this._shouldAutoEnd = true;
  }

  addEventListener(event, callback) {
    if (!this._eventListeners[event]) {
      this._eventListeners[event] = [];
    }
    this._eventListeners[event].push(callback);
  }

  removeEventListener(event, callback) {
    if (this._eventListeners[event]) {
      this._eventListeners[event] = this._eventListeners[event].filter(cb => cb !== callback);
    }
  }

  _emit(event, data = {}) {
    const listeners = this._eventListeners[event] || [];
    listeners.forEach(cb => cb({ target: this, ...data }));
  }

  play() {
    return new Promise((resolve, reject) => {
      if (this.error) {
        reject(this.error);
        return;
      }

      this.paused = false;
      this._emit('play');
      this._emit('playing');

      // Simulate playback progress
      if (this._shouldAutoEnd && this.duration > 0) {
        this._playbackInterval = setInterval(() => {
          if (!this.paused && this.currentTime < this.duration) {
            this.currentTime += 0.25;
            this._emit('timeupdate');

            if (this.currentTime >= this.duration) {
              this.currentTime = this.duration;
              this.paused = true;
              clearInterval(this._playbackInterval);
              this._emit('ended');
            }
          }
        }, 250);
      }

      resolve();
    });
  }

  pause() {
    this.paused = true;
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
    }
    this._emit('pause');
  }

  load() {
    this.readyState = 4;
    this._emit('loadedmetadata');
    this._emit('canplay');
  }

  // Test helpers
  _setDuration(duration) {
    this.duration = duration;
    this._emit('durationchange');
    this._emit('loadedmetadata');
  }

  _triggerError(code, message) {
    this.error = { code, message };
    this._emit('error');
  }

  _triggerEnded() {
    this.paused = true;
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
    }
    this._emit('ended');
  }

  _cleanup() {
    if (this._playbackInterval) {
      clearInterval(this._playbackInterval);
    }
    this._eventListeners = {};
  }

  // Simulate playing to completion quickly for tests
  async _playToEnd() {
    this.paused = false;
    this._emit('play');
    this._emit('playing');
    this.currentTime = this.duration;
    this.paused = true;
    this._emit('ended');
  }
}

/**
 * Mock Electron IPC
 * Simulates window.electron API
 */
function createMockElectron() {
  const ipcCallbacks = {};
  const spotifyPollingCallbacks = {
    onAdvance: [],
    onProgress: [],
    onTokenExpired: []
  };

  return {
    // Extension API
    extension: {
      sendCommand: jest.fn().mockResolvedValue(true),
      onMessage: jest.fn((callback) => {
        ipcCallbacks.extensionMessage = callback;
        return () => { ipcCallbacks.extensionMessage = null; };
      }),
      _simulateMessage: (message) => {
        if (ipcCallbacks.extensionMessage) {
          ipcCallbacks.extensionMessage(message);
        }
      }
    },

    // Spotify API
    spotify: {
      polling: {
        start: jest.fn(),
        stop: jest.fn(),
        onAdvance: jest.fn((callback) => {
          spotifyPollingCallbacks.onAdvance.push(callback);
          return () => {
            spotifyPollingCallbacks.onAdvance = spotifyPollingCallbacks.onAdvance.filter(cb => cb !== callback);
          };
        }),
        onProgress: jest.fn((callback) => {
          spotifyPollingCallbacks.onProgress.push(callback);
          return () => {
            spotifyPollingCallbacks.onProgress = spotifyPollingCallbacks.onProgress.filter(cb => cb !== callback);
          };
        }),
        onTokenExpired: jest.fn((callback) => {
          spotifyPollingCallbacks.onTokenExpired.push(callback);
          return () => {
            spotifyPollingCallbacks.onTokenExpired = spotifyPollingCallbacks.onTokenExpired.filter(cb => cb !== callback);
          };
        }),
        _triggerAdvance: () => {
          spotifyPollingCallbacks.onAdvance.forEach(cb => cb());
        },
        _triggerProgress: (data) => {
          spotifyPollingCallbacks.onProgress.forEach(cb => cb(data));
        }
      }
    },

    // Playback window (for Bandcamp)
    playbackWindow: {
      open: jest.fn(),
      close: jest.fn()
    },

    // Resolvers
    resolvers: {
      loadBuiltin: jest.fn().mockResolvedValue([])
    },

    // Store
    store: {
      get: jest.fn(),
      set: jest.fn()
    }
  };
}

/**
 * Mock Spotify API
 */
function createMockSpotifyAPI() {
  let currentPlayback = null;
  let devices = [];

  return {
    setDevices: (deviceList) => {
      devices = deviceList;
    },
    setCurrentPlayback: (playback) => {
      currentPlayback = playback;
    },
    fetch: jest.fn((url, options = {}) => {
      const method = options.method || 'GET';

      // PUT /me/player/pause
      if (url.includes('/me/player/pause') && method === 'PUT') {
        if (currentPlayback) {
          currentPlayback.is_playing = false;
        }
        return Promise.resolve({ status: 204 });
      }

      // PUT /me/player/play
      if (url.includes('/me/player/play') && method === 'PUT') {
        if (currentPlayback) {
          currentPlayback.is_playing = true;
        }
        return Promise.resolve({ status: 204 });
      }

      // GET /me/player/devices
      if (url.includes('/me/player/devices')) {
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve({ devices })
        });
      }

      // GET /me/player (current playback state) - must be after specific endpoints
      if (url.match(/\/me\/player\/?$/) || url.includes('/me/player?')) {
        if (!currentPlayback) {
          return Promise.resolve({ status: 204 });
        }
        return Promise.resolve({
          status: 200,
          json: () => Promise.resolve(currentPlayback)
        });
      }

      return Promise.resolve({ status: 404 });
    })
  };
}

/**
 * Mock Track Data
 */
const mockTracks = {
  spotify: {
    id: 'spotify-track-1',
    title: 'Test Song',
    artist: 'Test Artist',
    album: 'Test Album',
    duration: 180000,
    _activeResolver: 'spotify',
    sources: {
      spotify: {
        id: 'spotify-track-1',
        spotifyUri: 'spotify:track:abc123',
        confidence: 0.95
      }
    }
  },
  localFile: {
    id: 'local-track-1',
    title: 'Local Song',
    artist: 'Local Artist',
    album: 'Local Album',
    duration: 240000,
    _activeResolver: 'localfiles',
    sources: {
      localfiles: {
        id: 'local-track-1',
        path: '/music/local-song.mp3',
        confidence: 1.0
      }
    }
  },
  soundcloud: {
    id: 'soundcloud-track-1',
    title: 'SoundCloud Song',
    artist: 'SoundCloud Artist',
    album: '',
    duration: 200000,
    _activeResolver: 'soundcloud',
    sources: {
      soundcloud: {
        id: '123456789',
        soundcloudId: '123456789',
        streamUrl: 'https://api.soundcloud.com/tracks/123456789/stream',
        confidence: 0.9
      }
    }
  },
  youtube: {
    id: 'youtube-track-1',
    title: 'YouTube Song',
    artist: 'YouTube Artist',
    album: '',
    duration: 300000,
    _activeResolver: 'youtube',
    sources: {
      youtube: {
        id: 'youtube-track-1',
        youtubeId: 'dQw4w9WgXcQ',
        confidence: 0.85
      }
    }
  },
  multiSource: {
    id: 'multi-source-track',
    title: 'Multi Source Song',
    artist: 'Various Artist',
    album: 'Compilation',
    duration: 210000,
    sources: {
      spotify: {
        id: 'multi-spotify',
        spotifyUri: 'spotify:track:multi123',
        confidence: 0.95
      },
      localfiles: {
        id: 'multi-local',
        path: '/music/multi-song.mp3',
        confidence: 1.0
      },
      soundcloud: {
        id: '987654321',
        soundcloudId: '987654321',
        confidence: 0.88
      }
    }
  }
};

/**
 * Mock Queue
 */
function createMockQueue(tracks = []) {
  return tracks.map((track, index) => ({
    ...track,
    queueIndex: index,
    status: track.status || 'ready'
  }));
}

/**
 * Create a mock playback controller that simulates the core playback logic
 */
function createMockPlaybackController() {
  let currentTrack = null;
  let isPlaying = false;
  let queue = [];
  let playHistory = [];
  let streamingPlaybackActive = false;
  let browserPlaybackActive = false;
  const audioElement = new MockAudio();

  return {
    // State
    get currentTrack() { return currentTrack; },
    get isPlaying() { return isPlaying; },
    get queue() { return queue; },
    get playHistory() { return playHistory; },
    get streamingPlaybackActive() { return streamingPlaybackActive; },
    get browserPlaybackActive() { return browserPlaybackActive; },
    get audioElement() { return audioElement; },

    // Actions
    setCurrentTrack: (track) => { currentTrack = track; },
    setIsPlaying: (playing) => { isPlaying = playing; },
    setQueue: (newQueue) => { queue = newQueue; },
    setStreamingPlaybackActive: (active) => { streamingPlaybackActive = active; },
    setBrowserPlaybackActive: (active) => { browserPlaybackActive = active; },

    addToHistory: (track) => {
      playHistory = [...playHistory, track];
    },

    popFromHistory: () => {
      if (playHistory.length === 0) return null;
      const track = playHistory[playHistory.length - 1];
      playHistory = playHistory.slice(0, -1);
      return track;
    },

    // Reset for testing
    reset: () => {
      currentTrack = null;
      isPlaying = false;
      queue = [];
      playHistory = [];
      streamingPlaybackActive = false;
      browserPlaybackActive = false;
      audioElement._cleanup();
      audioElement.src = '';
      audioElement.paused = true;
      audioElement.currentTime = 0;
    }
  };
}

module.exports = {
  MockAudio,
  createMockElectron,
  createMockSpotifyAPI,
  createMockPlaybackController,
  createMockQueue,
  mockTracks
};
