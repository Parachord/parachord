// social-feeds/x-provider.js
// X (formerly Twitter) social feed provider — stub.
// Will use the X API v2 with OAuth 2.0 PKCE for feed retrieval.

const BaseSocialProvider = require('./base-social-provider');

const X_API_BASE = 'https://api.x.com/2';

class XProvider extends BaseSocialProvider {
  constructor() {
    super('x', 'X');
  }

  async startAuth() {
    // TODO: Implement X OAuth 2.0 PKCE flow
    throw new Error('X integration is not yet implemented');
  }

  async handleAuthCallback() {
    throw new Error('X integration is not yet implemented');
  }

  async checkAuth(store) {
    const token = this.getStoredToken(store);
    if (!token) return { authenticated: false };
    return { authenticated: false, error: 'X integration coming soon' };
  }

  async refreshToken() {
    throw new Error('X integration is not yet implemented');
  }

  async fetchFeed() {
    throw new Error('X integration is not yet implemented');
  }
}

module.exports = XProvider;
