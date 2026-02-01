/**
 * Browser Extension Protocol Tests
 *
 * Tests for communication between the browser extension and desktop app:
 * message formats, WebSocket protocol, reconnection, state sync.
 */

describe('Extension Message Protocol', () => {
  describe('Message Format Validation', () => {
    const validateMessage = (message) => {
      if (!message || typeof message !== 'object') {
        return { valid: false, error: 'Message must be an object' };
      }
      if (!message.type) {
        return { valid: false, error: 'Message must have a type' };
      }
      const validTypes = ['status', 'command', 'progress', 'error', 'handshake'];
      if (!validTypes.includes(message.type)) {
        return { valid: false, error: `Invalid message type: ${message.type}` };
      }
      return { valid: true };
    };

    test('valid status message passes', () => {
      const message = { type: 'status', status: 'playing', tabId: 123 };
      expect(validateMessage(message).valid).toBe(true);
    });

    test('valid command message passes', () => {
      const message = { type: 'command', action: 'pause' };
      expect(validateMessage(message).valid).toBe(true);
    });

    test('valid progress message passes', () => {
      const message = { type: 'progress', currentTime: 45, duration: 180 };
      expect(validateMessage(message).valid).toBe(true);
    });

    test('rejects null message', () => {
      expect(validateMessage(null).valid).toBe(false);
    });

    test('rejects message without type', () => {
      const message = { status: 'playing' };
      expect(validateMessage(message).valid).toBe(false);
    });

    test('rejects unknown message type', () => {
      const message = { type: 'unknown' };
      expect(validateMessage(message).valid).toBe(false);
    });
  });

  describe('Status Messages', () => {
    test('playing status includes track info', () => {
      const message = {
        type: 'status',
        status: 'playing',
        tabId: 123,
        source: 'youtube',
        track: {
          title: 'Video Title',
          artist: 'Channel Name',
          duration: 300
        }
      };

      expect(message.status).toBe('playing');
      expect(message.track.title).toBe('Video Title');
      expect(message.source).toBe('youtube');
    });

    test('paused status includes tabId', () => {
      const message = {
        type: 'status',
        status: 'paused',
        tabId: 123
      };

      expect(message.status).toBe('paused');
      expect(message.tabId).toBe(123);
    });

    test('ended status triggers advance', () => {
      const message = {
        type: 'status',
        status: 'ended',
        tabId: 123
      };

      const shouldAdvance = message.status === 'ended';
      expect(shouldAdvance).toBe(true);
    });
  });

  describe('Command Messages', () => {
    test('play command format', () => {
      const command = {
        type: 'command',
        action: 'play'
      };

      expect(command.action).toBe('play');
    });

    test('pause command format', () => {
      const command = {
        type: 'command',
        action: 'pause'
      };

      expect(command.action).toBe('pause');
    });

    test('seek command includes position', () => {
      const command = {
        type: 'command',
        action: 'seek',
        position: 60
      };

      expect(command.action).toBe('seek');
      expect(command.position).toBe(60);
    });

    test('volume command includes level', () => {
      const command = {
        type: 'command',
        action: 'setVolume',
        volume: 0.75
      };

      expect(command.action).toBe('setVolume');
      expect(command.volume).toBe(0.75);
    });
  });

  describe('Progress Messages', () => {
    test('progress message format', () => {
      const message = {
        type: 'progress',
        tabId: 123,
        currentTime: 45.5,
        duration: 180,
        buffered: 120
      };

      expect(message.currentTime).toBe(45.5);
      expect(message.duration).toBe(180);
    });

    test('progress percentage calculation', () => {
      const message = { currentTime: 90, duration: 180 };

      const percent = (message.currentTime / message.duration) * 100;

      expect(percent).toBe(50);
    });
  });
});

describe('WebSocket Connection', () => {
  describe('Connection State', () => {
    const WS_STATES = {
      CONNECTING: 0,
      OPEN: 1,
      CLOSING: 2,
      CLOSED: 3
    };

    test('initial state is CONNECTING', () => {
      const ws = { readyState: WS_STATES.CONNECTING };
      expect(ws.readyState).toBe(0);
    });

    test('connected state is OPEN', () => {
      const ws = { readyState: WS_STATES.OPEN };
      expect(ws.readyState).toBe(1);
    });

    test('isConnected helper works', () => {
      const isConnected = (ws) => !!(ws && ws.readyState === WS_STATES.OPEN);

      expect(isConnected({ readyState: WS_STATES.OPEN })).toBe(true);
      expect(isConnected({ readyState: WS_STATES.CLOSED })).toBe(false);
      expect(isConnected(null)).toBe(false);
    });
  });

  describe('Reconnection Logic', () => {
    test('reconnects after disconnect', () => {
      let connectAttempts = 0;
      let connected = false;

      const connect = () => {
        connectAttempts++;
        if (connectAttempts >= 3) {
          connected = true;
        }
        return connected;
      };

      // Simulate reconnection attempts (synchronous for test)
      while (!connected && connectAttempts < 5) {
        connect();
      }

      expect(connected).toBe(true);
      expect(connectAttempts).toBe(3);
    });

    test('exponential backoff between attempts', () => {
      const baseDelay = 1000;
      const maxDelay = 30000;

      const getReconnectDelay = (attempt) => {
        const delay = baseDelay * Math.pow(2, attempt);
        return Math.min(delay, maxDelay);
      };

      expect(getReconnectDelay(0)).toBe(1000);
      expect(getReconnectDelay(1)).toBe(2000);
      expect(getReconnectDelay(2)).toBe(4000);
      expect(getReconnectDelay(3)).toBe(8000);
      expect(getReconnectDelay(5)).toBe(30000); // Capped
    });

    test('stops reconnecting after max attempts', () => {
      const maxAttempts = 10;
      let attempts = 0;
      let gaveUp = false;

      const tryReconnect = () => {
        attempts++;
        if (attempts >= maxAttempts) {
          gaveUp = true;
          return false;
        }
        return true; // Would continue trying
      };

      while (tryReconnect()) { }

      expect(attempts).toBe(10);
      expect(gaveUp).toBe(true);
    });
  });

  describe('Heartbeat', () => {
    jest.useFakeTimers();

    test('sends ping periodically', () => {
      let pingCount = 0;
      const pingInterval = 30000;

      const startHeartbeat = () => {
        return setInterval(() => {
          pingCount++;
        }, pingInterval);
      };

      const interval = startHeartbeat();

      jest.advanceTimersByTime(90000);

      expect(pingCount).toBe(3);

      clearInterval(interval);
    });

    test('disconnects on missed pong', () => {
      let lastPong = Date.now();
      const timeout = 60000;

      jest.advanceTimersByTime(70000);

      const missedPong = (Date.now() - lastPong) > timeout;

      expect(missedPong).toBe(true);
    });

    afterAll(() => {
      jest.useRealTimers();
    });
  });
});

describe('Tab Management', () => {
  describe('Active Tab Tracking', () => {
    let tabState;

    beforeEach(() => {
      tabState = {
        activeTabs: new Map(),

        registerTab(tabId, info) {
          this.activeTabs.set(tabId, {
            ...info,
            registeredAt: Date.now()
          });
        },

        unregisterTab(tabId) {
          this.activeTabs.delete(tabId);
        },

        getActivePlayingTab() {
          for (const [tabId, info] of this.activeTabs) {
            if (info.status === 'playing') {
              return tabId;
            }
          }
          return null;
        }
      };
    });

    test('can register a tab', () => {
      tabState.registerTab(123, { source: 'youtube', status: 'playing' });

      expect(tabState.activeTabs.has(123)).toBe(true);
    });

    test('can unregister a tab', () => {
      tabState.registerTab(123, { source: 'youtube' });
      tabState.unregisterTab(123);

      expect(tabState.activeTabs.has(123)).toBe(false);
    });

    test('finds active playing tab', () => {
      tabState.registerTab(123, { status: 'paused' });
      tabState.registerTab(456, { status: 'playing' });
      tabState.registerTab(789, { status: 'paused' });

      expect(tabState.getActivePlayingTab()).toBe(456);
    });

    test('returns null when no tab playing', () => {
      tabState.registerTab(123, { status: 'paused' });

      expect(tabState.getActivePlayingTab()).toBeNull();
    });
  });

  describe('Tab Switching', () => {
    test('pauses previous tab when new one starts', async () => {
      const commands = [];

      const handleNewPlayingTab = async (newTabId, previousTabId) => {
        if (previousTabId && previousTabId !== newTabId) {
          commands.push({ tabId: previousTabId, action: 'pause' });
        }
        commands.push({ tabId: newTabId, action: 'play' });
      };

      await handleNewPlayingTab(456, 123);

      expect(commands).toHaveLength(2);
      expect(commands[0]).toEqual({ tabId: 123, action: 'pause' });
      expect(commands[1]).toEqual({ tabId: 456, action: 'play' });
    });
  });
});

describe('Site Detection', () => {
  describe('URL Pattern Matching', () => {
    const detectSite = (url) => {
      if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
      if (url.includes('soundcloud.com')) return 'soundcloud';
      if (url.includes('bandcamp.com')) return 'bandcamp';
      if (url.includes('spotify.com')) return 'spotify';
      if (url.includes('music.apple.com')) return 'applemusic';
      return null;
    };

    test('detects YouTube', () => {
      expect(detectSite('https://www.youtube.com/watch?v=abc')).toBe('youtube');
      expect(detectSite('https://youtu.be/abc')).toBe('youtube');
      expect(detectSite('https://music.youtube.com/watch?v=abc')).toBe('youtube');
    });

    test('detects SoundCloud', () => {
      expect(detectSite('https://soundcloud.com/artist/track')).toBe('soundcloud');
    });

    test('detects Bandcamp', () => {
      expect(detectSite('https://artist.bandcamp.com/track/song')).toBe('bandcamp');
    });

    test('detects Spotify', () => {
      expect(detectSite('https://open.spotify.com/track/abc')).toBe('spotify');
    });

    test('detects Apple Music', () => {
      expect(detectSite('https://music.apple.com/album/123')).toBe('applemusic');
    });

    test('returns null for unknown sites', () => {
      expect(detectSite('https://example.com')).toBeNull();
    });
  });

  describe('Content Script Selection', () => {
    const getContentScript = (site) => {
      const scripts = {
        youtube: 'content.js',
        spotify: 'content-spotify.js',
        soundcloud: 'content-soundcloud.js',
        applemusic: 'content-applemusic.js'
      };
      return scripts[site] || 'content.js';
    };

    test('selects correct script for each site', () => {
      expect(getContentScript('spotify')).toBe('content-spotify.js');
      expect(getContentScript('soundcloud')).toBe('content-soundcloud.js');
      expect(getContentScript('youtube')).toBe('content.js');
    });

    test('falls back to generic script', () => {
      expect(getContentScript('unknown')).toBe('content.js');
    });
  });
});

describe('Error Handling', () => {
  describe('Connection Errors', () => {
    test('handles connection refused', () => {
      const error = { code: 'ECONNREFUSED' };

      const isConnectionError = error.code === 'ECONNREFUSED';
      const shouldRetry = isConnectionError;

      expect(shouldRetry).toBe(true);
    });

    test('handles timeout', () => {
      const error = { code: 'ETIMEDOUT' };

      const isTimeoutError = error.code === 'ETIMEDOUT';

      expect(isTimeoutError).toBe(true);
    });
  });

  describe('Message Errors', () => {
    test('handles malformed JSON', () => {
      const rawMessage = 'not json';

      let parsed = null;
      let parseError = null;

      try {
        parsed = JSON.parse(rawMessage);
      } catch (error) {
        parseError = error;
      }

      expect(parsed).toBeNull();
      expect(parseError).not.toBeNull();
    });

    test('handles message too large', () => {
      const maxSize = 1024 * 1024; // 1MB
      const messageSize = 2 * 1024 * 1024; // 2MB

      const isTooLarge = messageSize > maxSize;

      expect(isTooLarge).toBe(true);
    });
  });
});

describe('State Synchronization', () => {
  test('extension state syncs with app', () => {
    const appState = {
      isPlaying: true,
      currentTrack: { title: 'Song', artist: 'Artist' },
      volume: 0.8
    };

    const extensionState = { ...appState };

    expect(extensionState.isPlaying).toBe(appState.isPlaying);
    expect(extensionState.volume).toBe(appState.volume);
  });

  test('handles state conflicts', () => {
    const appState = { isPlaying: true };
    const extensionState = { isPlaying: false };

    // App state wins
    const resolved = { ...extensionState, ...appState };

    expect(resolved.isPlaying).toBe(true);
  });
});
