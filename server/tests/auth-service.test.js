const AuthService = require('../services/auth-service');

function createMockStore() {
  const data = new Map();
  return {
    get: (key, def) => data.has(key) ? data.get(key) : def,
    set: (key, val) => data.set(key, val),
    delete: (key) => data.delete(key),
    has: (key) => data.has(key)
  };
}

function createMockWSManager() {
  return { broadcast: jest.fn(), send: jest.fn(), on: jest.fn(), off: jest.fn() };
}

describe('AuthService', () => {
  let auth;
  let store;
  let wsManager;

  beforeEach(() => {
    store = createMockStore();
    wsManager = createMockWSManager();
    auth = new AuthService(store, wsManager);
  });

  describe('getSpotifyCredentials', () => {
    test('returns user-configured credentials first', () => {
      store.set('spotify_client_id', 'user-id');
      expect(auth.getSpotifyCredentials()).toEqual({ clientId: 'user-id', source: 'user' });
    });

    test('falls back to env', () => {
      process.env.SPOTIFY_CLIENT_ID = 'env-id';
      expect(auth.getSpotifyCredentials()).toEqual({ clientId: 'env-id', source: 'env' });
      delete process.env.SPOTIFY_CLIENT_ID;
    });

    test('returns none if no credentials', () => {
      expect(auth.getSpotifyCredentials()).toEqual({ clientId: null, source: 'none' });
    });
  });

  describe('startSpotifyAuth', () => {
    test('returns error if no client ID', () => {
      const result = auth.startSpotifyAuth();
      expect(result.success).toBe(false);
      expect(result.error).toBe('no_client_id');
    });

    test('returns authUrl with PKCE if client ID exists', () => {
      store.set('spotify_client_id', 'test-id');
      const result = auth.startSpotifyAuth();
      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('accounts.spotify.com/authorize');
      expect(result.authUrl).toContain('code_challenge');
    });
  });

  describe('startSoundCloudAuth', () => {
    test('returns error if no client ID', () => {
      const result = auth.startSoundCloudAuth();
      expect(result.success).toBe(false);
    });

    test('returns authUrl with PKCE and state', () => {
      store.set('soundcloud_client_id', 'sc-id');
      store.set('soundcloud_client_secret', 'sc-secret');
      const result = auth.startSoundCloudAuth();
      expect(result.success).toBe(true);
      expect(result.authUrl).toContain('secure.soundcloud.com/authorize');
      expect(result.authUrl).toContain('state=');
    });
  });

  describe('getStatus', () => {
    test('returns connected:false when no token', () => {
      expect(auth.getStatus('spotify')).toEqual({ connected: false, expiresAt: null });
    });

    test('returns connected:true when valid token exists', () => {
      store.set('spotify_token', 'tok');
      store.set('spotify_token_expiry', Date.now() + 3600000);
      const status = auth.getStatus('spotify');
      expect(status.connected).toBe(true);
    });

    test('returns connected:false when token is expired', () => {
      store.set('spotify_token', 'tok');
      store.set('spotify_token_expiry', Date.now() - 1000);
      expect(auth.getStatus('spotify').connected).toBe(false);
    });
  });

  describe('disconnect', () => {
    test('clears tokens and broadcasts', () => {
      store.set('spotify_token', 'tok');
      store.set('spotify_refresh_token', 'ref');
      store.set('spotify_token_expiry', 123);

      auth.disconnect('spotify');

      expect(store.has('spotify_token')).toBe(false);
      expect(store.has('spotify_refresh_token')).toBe(false);
      expect(wsManager.broadcast).toHaveBeenCalledWith(
        'auth:status-changed',
        { provider: 'spotify', connected: false }
      );
    });

    test('clears SoundCloud-specific keys', () => {
      store.set('soundcloud_last_refresh', 123);
      auth.disconnect('soundcloud');
      expect(store.has('soundcloud_last_refresh')).toBe(false);
    });
  });

  describe('setSpotifyCredentials', () => {
    test('stores client ID', () => {
      auth.setSpotifyCredentials('my-id');
      expect(store.get('spotify_client_id')).toBe('my-id');
    });

    test('clears credentials when null', () => {
      store.set('spotify_client_id', 'old');
      auth.setSpotifyCredentials(null);
      expect(store.has('spotify_client_id')).toBe(false);
    });
  });

  describe('setSoundCloudCredentials', () => {
    test('stores both ID and secret', () => {
      auth.setSoundCloudCredentials('id', 'secret');
      expect(store.get('soundcloud_client_id')).toBe('id');
      expect(store.get('soundcloud_client_secret')).toBe('secret');
    });

    test('returns error when only one is provided', () => {
      const result = auth.setSoundCloudCredentials('id', null);
      expect(result.success).toBe(false);
    });
  });
});
