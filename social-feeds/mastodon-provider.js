// social-feeds/mastodon-provider.js
// Mastodon social feed provider — stub.
// Will use the Mastodon REST API with OAuth 2.0 for feed retrieval.
// Supports any Mastodon-compatible instance (user configures their instance URL).

const BaseSocialProvider = require('./base-social-provider');

class MastodonProvider extends BaseSocialProvider {
  constructor() {
    super('mastodon', 'Mastodon');
    this.instanceUrl = null; // User must configure their instance
  }

  async startAuth() {
    // TODO: Implement Mastodon OAuth 2.0 flow
    // Step 1: Register app on the user's instance via POST /api/v1/apps
    // Step 2: Redirect to instance authorize URL
    throw new Error('Mastodon integration is not yet implemented');
  }

  async handleAuthCallback() {
    throw new Error('Mastodon integration is not yet implemented');
  }

  async checkAuth(store) {
    const token = this.getStoredToken(store);
    if (!token) return { authenticated: false };
    return { authenticated: false, error: 'Mastodon integration coming soon' };
  }

  async refreshToken() {
    throw new Error('Mastodon integration is not yet implemented');
  }

  async fetchFeed() {
    throw new Error('Mastodon integration is not yet implemented');
  }
}

module.exports = MastodonProvider;
