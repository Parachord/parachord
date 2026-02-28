const ScrobbleService = require('../services/scrobble-service');

// Mock fetch globally
global.fetch = jest.fn();

function createMockStore() {
  const data = {};
  return {
    get: jest.fn((key, def) => data[key] !== undefined ? data[key] : def),
    set: jest.fn((key, val) => { data[key] = val; }),
    delete: jest.fn((key) => { delete data[key]; }),
    _data: data
  };
}

function createMockWsManager() {
  return { broadcast: jest.fn() };
}

describe('ScrobbleService', () => {
  let store, ws, service;

  beforeEach(() => {
    store = createMockStore();
    ws = createMockWsManager();
    service = new ScrobbleService(store, ws);
    jest.clearAllMocks();
  });

  describe('plugin registration', () => {
    test('registers built-in scrobblers', () => {
      const plugins = service.getPlugins();
      expect(plugins).toHaveLength(3);
      const ids = plugins.map(p => p.id);
      expect(ids).toContain('listenbrainz');
      expect(ids).toContain('lastfm');
      expect(ids).toContain('librefm');
    });

    test('all plugins start disconnected', () => {
      const plugins = service.getPlugins();
      for (const p of plugins) {
        expect(p.connected).toBe(false);
      }
    });

    test('getPlugin returns specific plugin', () => {
      const lb = service.getPlugin('listenbrainz');
      expect(lb).toBeDefined();
      expect(lb.id).toBe('listenbrainz');
    });

    test('getPlugin returns undefined for unknown', () => {
      expect(service.getPlugin('nonexistent')).toBeUndefined();
    });
  });

  describe('playback integration', () => {
    test('onTrackStart sets current track and resets state', async () => {
      const track = { title: 'Song', artist: 'Artist', duration: 200 };
      await service.onTrackStart(track);
      expect(service.currentTrack).toBe(track);
      expect(service.scrobbleSubmitted).toBe(false);
    });

    test('onTrackStart skips now-playing for tracks without title/artist', async () => {
      // Enable a plugin
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      global.fetch.mockResolvedValue({ ok: true });

      await service.onTrackStart({ duration: 200 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('onTrackStart skips now-playing for short tracks', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      global.fetch.mockResolvedValue({ ok: true });

      await service.onTrackStart({ title: 'Short', artist: 'A', duration: 20 });
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('onProgressUpdate submits scrobble at threshold', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      global.fetch.mockResolvedValue({ ok: true });

      service.currentTrack = { title: 'Song', artist: 'Artist', duration: 200 };
      service.trackStartTime = Date.now();
      service.scrobbleSubmitted = false;

      // threshold = max(30, min(100, 240)) = 100
      await service.onProgressUpdate(100);
      expect(service.scrobbleSubmitted).toBe(true);
      expect(ws.broadcast).toHaveBeenCalledWith('scrobble:submitted', expect.objectContaining({
        pluginId: 'listenbrainz'
      }));
    });

    test('onProgressUpdate does not double-submit', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      global.fetch.mockResolvedValue({ ok: true });

      service.currentTrack = { title: 'Song', artist: 'Artist', duration: 200 };
      service.trackStartTime = Date.now();
      service.scrobbleSubmitted = false;

      await service.onProgressUpdate(100);
      const callCount = global.fetch.mock.calls.length;
      await service.onProgressUpdate(150);
      expect(global.fetch.mock.calls.length).toBe(callCount);
    });

    test('onTrackEnd clears state', () => {
      service.currentTrack = { title: 'Song', artist: 'Artist' };
      service.trackStartTime = Date.now();
      service.onTrackEnd();
      expect(service.currentTrack).toBeNull();
      expect(service.trackStartTime).toBeNull();
    });
  });

  describe('failed scrobble queue', () => {
    test('queues failed scrobbles', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      global.fetch.mockResolvedValue({ ok: false, status: 500 });

      service.currentTrack = { title: 'Song', artist: 'Artist', duration: 200 };
      service.trackStartTime = Date.now();
      service.scrobbleSubmitted = false;

      await service.onProgressUpdate(200);
      expect(store.set).toHaveBeenCalledWith('scrobble-failed-queue', expect.arrayContaining([
        expect.objectContaining({ pluginId: 'listenbrainz' })
      ]));
    });

    test('retryFailed processes queue', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      store._data['scrobble-failed-queue'] = [
        { pluginId: 'listenbrainz', track: { title: 'Song', artist: 'A' }, timestamp: 123, attempts: 1, queuedAt: Date.now() }
      ];

      global.fetch.mockResolvedValue({ ok: true });
      const result = await service.retryFailed();
      expect(result.retried).toBe(1);
      expect(result.remaining).toBe(0);
    });

    test('retryFailed keeps items that fail again within limits', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      store._data['scrobble-failed-queue'] = [
        { pluginId: 'listenbrainz', track: { title: 'Song', artist: 'A' }, timestamp: 123, attempts: 1, queuedAt: Date.now() }
      ];

      global.fetch.mockResolvedValue({ ok: false, status: 500 });
      const result = await service.retryFailed();
      expect(result.retried).toBe(0);
      expect(result.remaining).toBe(1);
    });

    test('retryFailed drops expired items', async () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      store._data['scrobble-failed-queue'] = [
        { pluginId: 'listenbrainz', track: { title: 'Song', artist: 'A' }, timestamp: 123, attempts: 9, queuedAt: Date.now() - 15 * 24 * 60 * 60 * 1000 }
      ];

      global.fetch.mockResolvedValue({ ok: false, status: 500 });
      const result = await service.retryFailed();
      expect(result.retried).toBe(0);
      expect(result.remaining).toBe(0);
    });

    test('retryFailed returns zero when queue is empty', async () => {
      const result = await service.retryFailed();
      expect(result).toEqual({ retried: 0, remaining: 0 });
    });
  });

  describe('scrobbler connection status', () => {
    test('ListenBrainz isEnabled when token present', () => {
      const lb = service.getPlugin('listenbrainz');
      expect(lb.isEnabled()).toBe(false);
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      expect(lb.isEnabled()).toBe(true);
    });

    test('Last.fm isEnabled when sessionKey and apiKey present', () => {
      const lf = service.getPlugin('lastfm');
      expect(lf.isEnabled()).toBe(false);
      store._data['scrobbler-config-lastfm'] = { enabled: true, sessionKey: 'sk' };
      // Still false — no apiKey in env
      lf.apiKey = 'test-key';
      expect(lf.isEnabled()).toBe(true);
    });

    test('disconnect clears config', () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok' };
      const lb = service.getPlugin('listenbrainz');
      lb.disconnect();
      expect(store.delete).toHaveBeenCalledWith('scrobbler-config-listenbrainz');
    });

    test('getConnectionStatus returns status shape', () => {
      store._data['scrobbler-config-listenbrainz'] = { enabled: true, userToken: 'tok', username: 'testuser' };
      const lb = service.getPlugin('listenbrainz');
      const status = lb.getConnectionStatus();
      expect(status).toEqual({ connected: true, username: 'testuser' });
    });
  });
});
