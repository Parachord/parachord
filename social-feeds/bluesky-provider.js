// social-feeds/bluesky-provider.js
// Bluesky (AT Protocol) social feed provider — stub.
// Will use the Bluesky Public API / AT Protocol for feed retrieval.
// Auth uses app passwords or OAuth (when available).

const BaseSocialProvider = require('./base-social-provider');

const BLUESKY_API_BASE = 'https://bsky.social/xrpc';

class BlueskyProvider extends BaseSocialProvider {
  constructor() {
    super('bluesky', 'Bluesky');
  }

  async startAuth() {
    // TODO: Implement Bluesky auth (app password or OAuth)
    throw new Error('Bluesky integration is not yet implemented');
  }

  async handleAuthCallback() {
    throw new Error('Bluesky integration is not yet implemented');
  }

  async checkAuth(store) {
    const token = this.getStoredToken(store);
    if (!token) return { authenticated: false };
    return { authenticated: false, error: 'Bluesky integration coming soon' };
  }

  async refreshToken() {
    throw new Error('Bluesky integration is not yet implemented');
  }

  async fetchFeed() {
    throw new Error('Bluesky integration is not yet implemented');
  }
}

module.exports = BlueskyProvider;
