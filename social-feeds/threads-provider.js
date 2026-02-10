// social-feeds/threads-provider.js
// Threads (Meta) social feed provider.
// Uses the Threads API (threads.net) with OAuth 2.0 for authentication
// and feed retrieval.
//
// API docs: https://developers.facebook.com/docs/threads

const BaseSocialProvider = require('./base-social-provider');

const THREADS_API_BASE = 'https://graph.threads.net';
const THREADS_AUTH_URL = 'https://threads.net/oauth/authorize';
const THREADS_TOKEN_URL = 'https://graph.threads.net/oauth/access_token';
const THREADS_LONG_LIVED_TOKEN_URL = 'https://graph.threads.net/access_token';

class ThreadsProvider extends BaseSocialProvider {
  constructor() {
    super('threads', 'Threads');
  }

  // ---- Auth ----

  async startAuth(store, clientId, redirectUri) {
    // Threads uses a standard OAuth 2.0 flow.
    // Scopes: threads_basic gives us profile + feed access.
    const scopes = 'threads_basic';
    const authUrl =
      `${THREADS_AUTH_URL}?client_id=${clientId}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scopes)}` +
      `&response_type=code`;

    return { authUrl };
  }

  // Exchange the auth code for short-lived + long-lived tokens.
  async handleAuthCallback(params, store) {
    const { code, clientId, clientSecret, redirectUri } = params;

    // Step 1: Exchange code for short-lived token
    const shortBody = new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code
    });

    const shortRes = await fetch(THREADS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: shortBody.toString()
    });

    if (!shortRes.ok) {
      const err = await shortRes.text();
      throw new Error(`Threads token exchange failed: ${shortRes.status} ${err}`);
    }

    const shortData = await shortRes.json();

    // Step 2: Exchange short-lived token for long-lived token (60 days)
    const longRes = await fetch(
      `${THREADS_LONG_LIVED_TOKEN_URL}?grant_type=th_exchange_token` +
      `&client_secret=${clientSecret}` +
      `&access_token=${shortData.access_token}`,
      { method: 'GET' }
    );

    if (!longRes.ok) {
      const err = await longRes.text();
      throw new Error(`Threads long-lived token exchange failed: ${longRes.status} ${err}`);
    }

    const longData = await longRes.json();

    // Fetch user profile to get username
    const profile = await this._fetchProfile(longData.access_token);

    this.saveTokens(store, {
      accessToken: longData.access_token,
      expiresIn: longData.expires_in || 5184000, // 60 days default
      username: profile.username,
      userId: profile.id
    });

    return { username: profile.username };
  }

  async checkAuth(store) {
    const token = this.getStoredToken(store);
    if (!token) {
      return { authenticated: false };
    }

    // Token expired — try refresh
    if (this.isTokenExpired(store)) {
      try {
        await this.refreshToken(store);
      } catch {
        return { authenticated: false, error: 'Token expired and refresh failed' };
      }
    }

    try {
      const profile = await this._fetchProfile(this.getStoredToken(store));
      return { authenticated: true, username: profile.username };
    } catch (err) {
      return { authenticated: false, error: err.message };
    }
  }

  // Threads long-lived tokens can be refreshed once they're at least
  // 24 hours old (and before they expire).
  async refreshToken(store) {
    const currentToken = this.getStoredToken(store);
    if (!currentToken) throw new Error('No token to refresh');

    const res = await fetch(
      `${THREADS_LONG_LIVED_TOKEN_URL}?grant_type=th_refresh_token` +
      `&access_token=${currentToken}`,
      { method: 'GET' }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Threads token refresh failed: ${res.status} ${err}`);
    }

    const data = await res.json();
    this.saveTokens(store, {
      accessToken: data.access_token,
      expiresIn: data.expires_in || 5184000
    });

    return data.access_token;
  }

  // ---- Feed ----

  // Fetch the authenticated user's Threads feed.
  // The Threads API provides the user's own threads via /me/threads.
  // For a "home timeline" equivalent, we use /me/threads since the
  // public API currently only exposes the user's own posts.
  // When the API expands, this can be updated to fetch the home feed.
  async fetchFeed(token, since) {
    const fields = 'id,text,timestamp,permalink,media_type,media_url';
    let url = `${THREADS_API_BASE}/me/threads?fields=${fields}&limit=50&access_token=${token}`;

    if (since) {
      url += `&since=${since}`;
    }

    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 401) {
        throw new Error('Threads token expired');
      }
      throw new Error(`Threads API error: ${res.status}`);
    }

    const data = await res.json();
    const posts = (data.data || []).map(post => ({
      id: post.id,
      text: post.text || '',
      author: null, // own posts — author is the authenticated user
      createdAt: post.timestamp,
      url: post.permalink
    }));

    // If `since` was supplied, only return posts newer than that ID.
    if (since) {
      const sinceIndex = posts.findIndex(p => p.id === since);
      if (sinceIndex > 0) {
        return posts.slice(0, sinceIndex);
      }
    }

    return posts;
  }

  // ---- Manual token ----

  // Save a manually-provided access token (from the Meta developer console
  // User Token Generator). Validates by fetching the profile first.
  async saveManualToken(store, accessToken) {
    const profile = await this._fetchProfile(accessToken);

    this.saveTokens(store, {
      accessToken,
      expiresIn: 5184000, // 60 days for long-lived tokens
      username: profile.username,
      userId: profile.id
    });

    return { username: profile.username };
  }

  // ---- Internal helpers ----

  async _fetchProfile(token) {
    const res = await fetch(
      `${THREADS_API_BASE}/me?fields=id,username&access_token=${token}`
    );
    if (!res.ok) {
      throw new Error(`Threads profile fetch failed: ${res.status}`);
    }
    return res.json();
  }
}

module.exports = ThreadsProvider;
