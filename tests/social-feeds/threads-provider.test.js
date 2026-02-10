/**
 * Threads Provider Tests
 *
 * Tests for the Threads social feed provider including auth flows
 * and feed fetching.
 */

const ThreadsProvider = require('../../social-feeds/threads-provider');

// Create a mock store
function createMockStore() {
  const data = {};
  return {
    get: (key) => data[key] ?? null,
    set: (key, value) => { data[key] = value; },
    delete: (key) => { delete data[key]; },
    _data: data
  };
}

describe('ThreadsProvider', () => {
  let provider;
  let store;

  beforeEach(() => {
    provider = new ThreadsProvider();
    store = createMockStore();
  });

  describe('Constructor', () => {
    test('has correct id and name', () => {
      expect(provider.id).toBe('threads');
      expect(provider.name).toBe('Threads');
    });
  });

  describe('startAuth', () => {
    test('returns a valid auth URL', async () => {
      const result = await provider.startAuth(store, 'test-client-id', 'http://localhost:8888/callback/threads');
      expect(result.authUrl).toContain('threads.net/oauth/authorize');
      expect(result.authUrl).toContain('client_id=test-client-id');
      expect(result.authUrl).toContain('response_type=code');
      expect(result.authUrl).toContain('threads_basic');
    });

    test('encodes redirect URI', async () => {
      const result = await provider.startAuth(store, 'id', 'http://localhost:8888/callback/threads');
      expect(result.authUrl).toContain(encodeURIComponent('http://localhost:8888/callback/threads'));
    });
  });

  describe('handleAuthCallback', () => {
    test('exchanges code for tokens and fetches profile', async () => {
      // Mock fetch for the three API calls:
      // 1. Token exchange (short-lived)
      // 2. Long-lived token exchange
      // 3. Profile fetch
      const originalFetch = global.fetch;
      let callCount = 0;

      global.fetch = jest.fn(async (url, options) => {
        callCount++;

        // Short-lived token exchange
        if (url === 'https://graph.threads.net/oauth/access_token' && options?.method === 'POST') {
          return {
            ok: true,
            json: async () => ({ access_token: 'short_token', token_type: 'bearer' })
          };
        }

        // Long-lived token exchange
        if (typeof url === 'string' && url.includes('th_exchange_token')) {
          return {
            ok: true,
            json: async () => ({ access_token: 'long_token', expires_in: 5184000 })
          };
        }

        // Profile fetch
        if (typeof url === 'string' && url.includes('/me?fields=id,username')) {
          return {
            ok: true,
            json: async () => ({ id: '12345', username: 'testuser' })
          };
        }

        return { ok: false, status: 404, text: async () => 'Not found' };
      });

      try {
        const result = await provider.handleAuthCallback(
          {
            code: 'auth_code_123',
            clientId: 'client_id',
            clientSecret: 'client_secret',
            redirectUri: 'http://localhost:8888/callback/threads'
          },
          store
        );

        expect(result.username).toBe('testuser');
        expect(store.get('social-feed-threads-token')).toBe('long_token');
        expect(store.get('social-feed-threads-username')).toBe('testuser');
        expect(store.get('social-feed-threads-user-id')).toBe('12345');
        expect(store.get('social-feed-threads-token-expiry')).toBeGreaterThan(Date.now());
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('throws on token exchange failure', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 400,
        text: async () => 'Invalid code'
      }));

      try {
        await expect(
          provider.handleAuthCallback(
            { code: 'bad', clientId: 'id', clientSecret: 'secret', redirectUri: 'http://localhost/cb' },
            store
          )
        ).rejects.toThrow(/token exchange failed/);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('checkAuth', () => {
    test('returns unauthenticated when no token', async () => {
      const result = await provider.checkAuth(store);
      expect(result.authenticated).toBe(false);
    });

    test('returns authenticated when valid token and profile succeeds', async () => {
      store.set('social-feed-threads-token', 'valid_token');
      store.set('social-feed-threads-token-expiry', Date.now() + 3600000);

      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ id: '12345', username: 'testuser' })
      }));

      try {
        const result = await provider.checkAuth(store);
        expect(result.authenticated).toBe(true);
        expect(result.username).toBe('testuser');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('refreshToken', () => {
    test('refreshes and stores new token', async () => {
      store.set('social-feed-threads-token', 'old_token');

      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ access_token: 'new_token', expires_in: 5184000 })
      }));

      try {
        const newToken = await provider.refreshToken(store);
        expect(newToken).toBe('new_token');
        expect(store.get('social-feed-threads-token')).toBe('new_token');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('throws when no token exists', async () => {
      await expect(provider.refreshToken(store)).rejects.toThrow(/No token/);
    });

    test('throws on API failure', async () => {
      store.set('social-feed-threads-token', 'old_token');

      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      }));

      try {
        await expect(provider.refreshToken(store)).rejects.toThrow(/refresh failed/);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('fetchFeed', () => {
    test('fetches and transforms posts', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({
          data: [
            {
              id: '123',
              text: 'Listening to https://open.spotify.com/track/abc',
              timestamp: '2025-01-15T10:00:00Z',
              permalink: 'https://threads.net/t/123'
            },
            {
              id: '122',
              text: 'Just a regular post',
              timestamp: '2025-01-15T09:00:00Z',
              permalink: 'https://threads.net/t/122'
            }
          ]
        })
      }));

      try {
        const posts = await provider.fetchFeed('valid_token');
        expect(posts).toHaveLength(2);
        expect(posts[0].id).toBe('123');
        expect(posts[0].text).toContain('spotify.com');
        expect(posts[0].createdAt).toBe('2025-01-15T10:00:00Z');
        expect(posts[0].url).toBe('https://threads.net/t/123');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('throws on 401 response', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: false,
        status: 401
      }));

      try {
        await expect(provider.fetchFeed('expired_token')).rejects.toThrow(/expired/);
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('handles empty feed', async () => {
      const originalFetch = global.fetch;
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ data: [] })
      }));

      try {
        const posts = await provider.fetchFeed('valid_token');
        expect(posts).toHaveLength(0);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('disconnect', () => {
    test('clears all stored data', async () => {
      store.set('social-feed-threads-token', 'token');
      store.set('social-feed-threads-refresh-token', 'refresh');
      store.set('social-feed-threads-token-expiry', 123456);
      store.set('social-feed-threads-username', 'user');
      store.set('social-feed-threads-user-id', '123');

      await provider.disconnect(store);

      expect(store.get('social-feed-threads-token')).toBeNull();
      expect(store.get('social-feed-threads-refresh-token')).toBeNull();
      expect(store.get('social-feed-threads-token-expiry')).toBeNull();
      expect(store.get('social-feed-threads-username')).toBeNull();
      expect(store.get('social-feed-threads-user-id')).toBeNull();
    });
  });
});
