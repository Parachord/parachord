/**
 * Feed Playlist Manager Tests
 *
 * Tests for the orchestrator that manages social feed providers,
 * polling, and playlist accumulation.
 */

const FeedPlaylistManager = require('../../social-feeds/feed-playlist-manager');
const BaseSocialProvider = require('../../social-feeds/base-social-provider');

// Create a mock store backed by a plain object
function createMockStore() {
  const data = {};
  return {
    get: (key) => data[key] ?? null,
    set: (key, value) => { data[key] = value; },
    delete: (key) => { delete data[key]; },
    _data: data
  };
}

// Create a test provider that extends BaseSocialProvider with controllable feed
class TestProvider extends BaseSocialProvider {
  constructor(id, name) {
    super(id, name);
    this.feedPosts = [];
  }

  async startAuth() { return { authUrl: 'https://example.com/auth' }; }
  async handleAuthCallback() { return { username: 'testuser' }; }
  async checkAuth(store) {
    return { authenticated: !!this.getStoredToken(store) };
  }
  async refreshToken(store) {
    const newToken = 'refreshed_token';
    this.saveTokens(store, { accessToken: newToken, expiresIn: 3600 });
    return newToken;
  }
  async fetchFeed() {
    return this.feedPosts;
  }
}

describe('FeedPlaylistManager', () => {
  let store;
  let manager;
  let testProvider;

  beforeEach(() => {
    store = createMockStore();
    manager = new FeedPlaylistManager(store);
    testProvider = new TestProvider('test', 'TestService');
    manager.registerProvider(testProvider);
  });

  afterEach(() => {
    manager.stopAllPolling();
  });

  describe('Provider Registry', () => {
    test('registers and retrieves a provider', () => {
      expect(manager.getProvider('test')).toBe(testProvider);
    });

    test('returns null for unknown provider', () => {
      expect(manager.getProvider('nonexistent')).toBeNull();
    });

    test('getAllProviders returns all registered providers', () => {
      const second = new TestProvider('second', 'Second');
      manager.registerProvider(second);
      expect(manager.getAllProviders()).toHaveLength(2);
    });

    test('getStatus returns connection status for all providers', () => {
      const status = manager.getStatus();
      expect(status.test).toBeDefined();
      expect(status.test.connected).toBe(false);
    });

    test('getStatus reflects connected state after token is stored', () => {
      store.set('social-feed-test-token', 'abc123');
      const status = manager.getStatus();
      expect(status.test.connected).toBe(true);
    });
  });

  describe('Polling', () => {
    test('startPolling throws for unauthenticated provider', () => {
      expect(() => manager.startPolling('test')).toThrow(/not authenticated/);
    });

    test('startPolling throws for unknown provider', () => {
      expect(() => manager.startPolling('unknown')).toThrow(/Unknown/);
    });

    test('isPolling returns false initially', () => {
      expect(manager.isPolling('test')).toBe(false);
    });

    test('startPolling starts and isPolling returns true', () => {
      store.set('social-feed-test-token', 'token123');
      store.set('social-feed-test-token-expiry', Date.now() + 3600000);
      manager.startPolling('test', 60000);
      expect(manager.isPolling('test')).toBe(true);
    });

    test('stopPolling stops and isPolling returns false', () => {
      store.set('social-feed-test-token', 'token123');
      store.set('social-feed-test-token-expiry', Date.now() + 3600000);
      manager.startPolling('test', 60000);
      manager.stopPolling('test');
      expect(manager.isPolling('test')).toBe(false);
    });

    test('stopAllPolling stops all active pollers', () => {
      const second = new TestProvider('second', 'Second');
      manager.registerProvider(second);
      store.set('social-feed-test-token', 'token1');
      store.set('social-feed-test-token-expiry', Date.now() + 3600000);
      store.set('social-feed-second-token', 'token2');
      store.set('social-feed-second-token-expiry', Date.now() + 3600000);

      manager.startPolling('test', 60000);
      manager.startPolling('second', 60000);
      expect(manager.isPolling('test')).toBe(true);
      expect(manager.isPolling('second')).toBe(true);

      manager.stopAllPolling();
      expect(manager.isPolling('test')).toBe(false);
      expect(manager.isPolling('second')).toBe(false);
    });

    test('polling collects music links from posts', async () => {
      store.set('social-feed-test-token', 'token123');
      store.set('social-feed-test-token-expiry', Date.now() + 3600000);

      testProvider.feedPosts = [
        {
          id: 'p1',
          text: 'Check out https://open.spotify.com/track/abc123',
          author: 'user1',
          createdAt: '2025-01-15T10:00:00Z',
          url: 'https://example.com/p1'
        }
      ];

      const updatePromise = new Promise(resolve => {
        manager.onUpdate = (providerId, newItems) => {
          resolve({ providerId, newItems });
        };
      });

      manager.startPolling('test', 60000);

      const { providerId, newItems } = await updatePromise;
      expect(providerId).toBe('test');
      expect(newItems).toHaveLength(1);
      expect(newItems[0].service).toBe('spotify');
      expect(newItems[0].post.id).toBe('p1');
    });
  });

  describe('Playlist Management', () => {
    test('getPlaylist returns empty array initially', () => {
      expect(manager.getPlaylist('test')).toEqual([]);
    });

    test('getPlaylist returns stored playlist', () => {
      const items = [{ url: 'https://open.spotify.com/track/abc', service: 'spotify' }];
      store.set('social-feed-playlist-test', items);
      expect(manager.getPlaylist('test')).toEqual(items);
    });

    test('getMergedPlaylist merges and sorts by date', () => {
      const older = [{
        url: 'https://open.spotify.com/track/old',
        service: 'spotify',
        post: { createdAt: '2025-01-01T00:00:00Z' }
      }];
      const newer = [{
        url: 'https://youtu.be/new',
        service: 'youtube',
        post: { createdAt: '2025-06-01T00:00:00Z' }
      }];

      store.set('social-feed-playlist-test', older);

      const second = new TestProvider('second', 'Second');
      manager.registerProvider(second);
      store.set('social-feed-playlist-second', newer);

      const merged = manager.getMergedPlaylist();
      expect(merged).toHaveLength(2);
      // Newer should be first
      expect(merged[0].url).toBe('https://youtu.be/new');
      expect(merged[0].provider).toBe('second');
      expect(merged[1].url).toBe('https://open.spotify.com/track/old');
      expect(merged[1].provider).toBe('test');
    });

    test('clearPlaylist removes all items and resets cursor', () => {
      store.set('social-feed-playlist-test', [{ url: 'https://example.com' }]);
      store.set('social-feed-test-last-post-id', 'post123');
      testProvider.lastSeenPostId = 'post123';

      manager.clearPlaylist('test');

      expect(manager.getPlaylist('test')).toEqual([]);
      expect(store.get('social-feed-test-last-post-id')).toBeNull();
      expect(testProvider.lastSeenPostId).toBeNull();
    });

    test('removePlaylistItem removes a specific item by URL', () => {
      const items = [
        { url: 'https://open.spotify.com/track/keep', service: 'spotify' },
        { url: 'https://open.spotify.com/track/remove', service: 'spotify' }
      ];
      store.set('social-feed-playlist-test', items);

      const result = manager.removePlaylistItem('test', 'https://open.spotify.com/track/remove');
      expect(result).toHaveLength(1);
      expect(result[0].url).toBe('https://open.spotify.com/track/keep');
    });
  });
});
