/**
 * Bluesky Provider Tests
 *
 * Tests for the Bluesky social feed provider including auth flows,
 * feed fetching, and link extraction from AT Protocol posts.
 */

const BlueskyProvider = require('../../social-feeds/bluesky-provider');

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

describe('BlueskyProvider', () => {
  let provider;
  let store;

  beforeEach(() => {
    provider = new BlueskyProvider();
    store = createMockStore();
  });

  describe('Constructor', () => {
    test('has correct id and name', () => {
      expect(provider.id).toBe('bluesky');
      expect(provider.name).toBe('Bluesky');
    });
  });

  describe('startAuth', () => {
    test('throws because Bluesky uses app password flow', async () => {
      await expect(provider.startAuth()).rejects.toThrow('saveManualToken');
    });
  });

  describe('handleAuthCallback', () => {
    test('throws because Bluesky uses app password flow', async () => {
      await expect(provider.handleAuthCallback()).rejects.toThrow('saveManualToken');
    });
  });

  describe('checkAuth', () => {
    test('returns unauthenticated when no token', async () => {
      const result = await provider.checkAuth(store);
      expect(result.authenticated).toBe(false);
    });

    test('returns unauthenticated when token is expired and refresh fails', async () => {
      store.set('social-feed-bluesky-token', 'expired-token');
      store.set('social-feed-bluesky-token-expiry', Date.now() - 10000);
      const result = await provider.checkAuth(store);
      expect(result.authenticated).toBe(false);
    });
  });

  describe('refreshToken', () => {
    test('throws when no refresh token stored', async () => {
      await expect(provider.refreshToken(store)).rejects.toThrow('No refresh token');
    });
  });

  describe('saveManualToken', () => {
    test('calls createSession API with identifier and password', async () => {
      const mockResponse = {
        accessJwt: 'test-access-jwt',
        refreshJwt: 'test-refresh-jwt',
        handle: 'testuser.bsky.social',
        did: 'did:plc:test123'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse)
      });

      const result = await provider.saveManualToken(store, 'testuser.bsky.social', 'app-pass-1234');

      expect(fetch).toHaveBeenCalledWith(
        'https://bsky.social/xrpc/com.atproto.server.createSession',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identifier: 'testuser.bsky.social', password: 'app-pass-1234' })
        })
      );
      expect(result.username).toBe('testuser.bsky.social');
      expect(store.get('social-feed-bluesky-token')).toBe('test-access-jwt');
      expect(store.get('social-feed-bluesky-refresh-token')).toBe('test-refresh-jwt');
      expect(store.get('social-feed-bluesky-username')).toBe('testuser.bsky.social');
      expect(store.get('social-feed-bluesky-user-id')).toBe('did:plc:test123');
    });

    test('throws on invalid credentials', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: () => Promise.resolve({ message: 'Invalid identifier or password' })
      });

      await expect(
        provider.saveManualToken(store, 'bad-user', 'bad-pass')
      ).rejects.toThrow('Invalid identifier or password');
    });
  });

  describe('fetchFeed', () => {
    test('fetches timeline and extracts post data', async () => {
      const mockTimeline = {
        feed: [
          {
            post: {
              uri: 'at://did:plc:abc/app.bsky.feed.post/123',
              author: { handle: 'musicfan.bsky.social', displayName: 'Music Fan' },
              record: {
                text: 'Check out this track https://open.spotify.com/track/abc123',
                createdAt: '2026-02-10T12:00:00Z'
              },
              indexedAt: '2026-02-10T12:00:01Z'
            }
          },
          {
            post: {
              uri: 'at://did:plc:def/app.bsky.feed.post/456',
              author: { handle: 'djfriend.bsky.social' },
              record: {
                text: 'Great album!',
                createdAt: '2026-02-10T11:00:00Z',
                embed: {
                  external: { uri: 'https://music.apple.com/us/album/test/1234' }
                }
              },
              indexedAt: '2026-02-10T11:00:01Z'
            }
          }
        ],
        cursor: 'next-page'
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTimeline)
      });

      const posts = await provider.fetchFeed('test-token', null);

      expect(fetch).toHaveBeenCalledWith(
        'https://bsky.social/xrpc/app.bsky.feed.getTimeline?limit=50',
        { headers: { Authorization: 'Bearer test-token' } }
      );
      expect(posts).toHaveLength(2);
      expect(posts[0].text).toContain('https://open.spotify.com/track/abc123');
      expect(posts[0].author).toBe('musicfan.bsky.social');
      expect(posts[0].id).toBe('at://did:plc:abc/app.bsky.feed.post/123');
      expect(posts[0].url).toContain('bsky.app/profile/musicfan.bsky.social');
      // Embedded link appended to text
      expect(posts[1].text).toContain('https://music.apple.com/us/album/test/1234');
    });

    test('extracts links from facets', async () => {
      const mockTimeline = {
        feed: [{
          post: {
            uri: 'at://did:plc:ghi/app.bsky.feed.post/789',
            author: { handle: 'linker.bsky.social' },
            record: {
              text: 'New track on SoundCloud',
              createdAt: '2026-02-10T10:00:00Z',
              facets: [{
                features: [{
                  $type: 'app.bsky.richtext.facet#link',
                  uri: 'https://soundcloud.com/artist/track-name'
                }]
              }]
            },
            indexedAt: '2026-02-10T10:00:01Z'
          }
        }]
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTimeline)
      });

      const posts = await provider.fetchFeed('test-token', null);
      expect(posts).toHaveLength(1);
      expect(posts[0].text).toContain('https://soundcloud.com/artist/track-name');
    });

    test('passes cursor for pagination', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ feed: [] })
      });

      await provider.fetchFeed('test-token', 'cursor123');
      expect(fetch).toHaveBeenCalledWith(
        'https://bsky.social/xrpc/app.bsky.feed.getTimeline?limit=50&cursor=cursor123',
        expect.any(Object)
      );
    });

    test('throws on 401 with session expired message', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401
      });

      await expect(provider.fetchFeed('bad-token', null)).rejects.toThrow('session expired');
    });
  });

  describe('disconnect', () => {
    test('clears all stored data', async () => {
      store.set('social-feed-bluesky-token', 'test-token');
      store.set('social-feed-bluesky-refresh-token', 'test-refresh');
      store.set('social-feed-bluesky-username', 'test.bsky.social');
      store.set('social-feed-bluesky-user-id', 'did:plc:test');

      await provider.disconnect(store);
      expect(store.get('social-feed-bluesky-token')).toBeNull();
      expect(store.get('social-feed-bluesky-refresh-token')).toBeNull();
      expect(store.get('social-feed-bluesky-username')).toBeNull();
      expect(store.get('social-feed-bluesky-user-id')).toBeNull();
    });
  });

  describe('getConnectionStatus', () => {
    test('returns disconnected when no token', () => {
      const status = provider.getConnectionStatus(store);
      expect(status.connected).toBe(false);
      expect(status.username).toBeNull();
    });

    test('returns connected with username', () => {
      store.set('social-feed-bluesky-token', 'test-token');
      store.set('social-feed-bluesky-token-expiry', Date.now() + 600000);
      store.set('social-feed-bluesky-username', 'testuser.bsky.social');

      const status = provider.getConnectionStatus(store);
      expect(status.connected).toBe(true);
      expect(status.username).toBe('testuser.bsky.social');
      expect(status.expired).toBe(false);
    });
  });
});
