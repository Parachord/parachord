// social-feeds/base-social-provider.js
// Base class for social media feed providers.
// Each provider monitors a social platform's feed for music links
// and surfaces them for playlist generation.

class BaseSocialProvider {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.pollInterval = null;
    this.lastSeenPostId = null;
  }

  // ---- Auth lifecycle ----

  // Start the OAuth flow. Returns { authUrl } for the renderer to open.
  async startAuth() {
    throw new Error('Subclass must implement startAuth()');
  }

  // Handle the OAuth callback with the authorization code / token.
  async handleAuthCallback(params) {
    throw new Error('Subclass must implement handleAuthCallback()');
  }

  // Check whether the user is authenticated and the token is still valid.
  // Returns { authenticated: boolean, username?: string, error?: string }
  async checkAuth() {
    throw new Error('Subclass must implement checkAuth()');
  }

  // Refresh an expired access token using the stored refresh token.
  // Returns the new access token or throws.
  async refreshToken() {
    throw new Error('Subclass must implement refreshToken()');
  }

  // Disconnect — clear stored tokens.
  async disconnect(store) {
    store.delete(`social-feed-${this.id}-token`);
    store.delete(`social-feed-${this.id}-refresh-token`);
    store.delete(`social-feed-${this.id}-token-expiry`);
    store.delete(`social-feed-${this.id}-username`);
    store.delete(`social-feed-${this.id}-user-id`);
    store.delete(`social-feed-${this.id}-last-post-id`);
  }

  // ---- Feed operations ----

  // Fetch the latest posts from the user's feed.
  // Returns an array of post objects: { id, text, author, createdAt, url }
  // `since` is an optional post ID — only return posts newer than this.
  async fetchFeed(token, since) {
    throw new Error('Subclass must implement fetchFeed()');
  }

  // ---- Polling lifecycle (managed by FeedPlaylistManager) ----

  // Start periodic feed polling. `onNewPosts` is called with an array of new posts.
  startPolling(intervalMs, fetchFn, onNewPosts) {
    this.stopPolling();
    const poll = async () => {
      try {
        const posts = await fetchFn(this.lastSeenPostId);
        if (posts.length > 0) {
          this.lastSeenPostId = posts[0].id;
          onNewPosts(posts);
        }
      } catch (err) {
        console.error(`[${this.name}] Poll error:`, err.message);
      }
    };
    // Immediate first poll, then on interval
    poll();
    this.pollInterval = setInterval(poll, intervalMs);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  // ---- Helpers ----

  // Get stored config from electron-store via the store reference passed in.
  getStoredToken(store) {
    return store.get(`social-feed-${this.id}-token`) || null;
  }

  getStoredRefreshToken(store) {
    return store.get(`social-feed-${this.id}-refresh-token`) || null;
  }

  getTokenExpiry(store) {
    return store.get(`social-feed-${this.id}-token-expiry`) || 0;
  }

  isTokenExpired(store) {
    const expiry = this.getTokenExpiry(store);
    return !expiry || Date.now() >= expiry;
  }

  saveTokens(store, { accessToken, refreshToken, expiresIn, username, userId }) {
    store.set(`social-feed-${this.id}-token`, accessToken);
    if (refreshToken) {
      store.set(`social-feed-${this.id}-refresh-token`, refreshToken);
    }
    if (expiresIn) {
      store.set(`social-feed-${this.id}-token-expiry`, Date.now() + (expiresIn * 1000));
    }
    if (username) {
      store.set(`social-feed-${this.id}-username`, username);
    }
    if (userId) {
      store.set(`social-feed-${this.id}-user-id`, userId);
    }
  }

  getConnectionStatus(store) {
    const token = this.getStoredToken(store);
    const username = store.get(`social-feed-${this.id}-username`) || null;
    return {
      connected: !!token,
      username,
      expired: token ? this.isTokenExpired(store) : false
    };
  }
}

module.exports = BaseSocialProvider;
