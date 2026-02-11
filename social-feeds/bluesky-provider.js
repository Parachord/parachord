// social-feeds/bluesky-provider.js
// Bluesky (AT Protocol) social feed provider.
// Uses the Bluesky API (bsky.social) for feed retrieval.
// Auth uses app passwords — user creates one in Bluesky Settings > App Passwords.
//
// API docs: https://docs.bsky.app/docs/api/

const BaseSocialProvider = require('./base-social-provider');

const BLUESKY_API_BASE = 'https://bsky.social/xrpc';

class BlueskyProvider extends BaseSocialProvider {
  constructor() {
    super('bluesky', 'Bluesky');
  }

  // ---- Auth ----

  // Bluesky uses app passwords — no OAuth flow needed.
  // The user provides their handle + app password, and we create a session.
  async saveManualToken(store, identifier, appPassword) {
    // Create session with handle + app password
    const res = await fetch(`${BLUESKY_API_BASE}/com.atproto.server.createSession`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identifier, password: appPassword })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Bluesky auth failed: ${res.status}`);
    }

    const data = await res.json();

    // Store the session
    this.saveTokens(store, {
      accessToken: data.accessJwt,
      refreshToken: data.refreshJwt,
      expiresIn: 7200, // access JWTs are valid ~2 hours
      username: data.handle,
      userId: data.did
    });

    // Also store the service endpoint (PDS) if provided
    if (data.didDoc?.service?.[0]?.serviceEndpoint) {
      store.set(`social-feed-${this.id}-pds`, data.didDoc.service[0].serviceEndpoint);
    }

    return { username: data.handle };
  }

  async startAuth() {
    // Not used — Bluesky uses app password flow via saveManualToken
    throw new Error('Use saveManualToken() for Bluesky auth');
  }

  async handleAuthCallback() {
    throw new Error('Use saveManualToken() for Bluesky auth');
  }

  async checkAuth(store) {
    const token = this.getStoredToken(store);
    if (!token) return { authenticated: false };

    // If expired, try refresh
    if (this.isTokenExpired(store)) {
      try {
        await this.refreshToken(store);
      } catch {
        return { authenticated: false, error: 'Session expired and refresh failed' };
      }
    }

    try {
      const profile = await this._fetchProfile(this.getStoredToken(store));
      return { authenticated: true, username: profile.handle };
    } catch (err) {
      return { authenticated: false, error: err.message };
    }
  }

  async refreshToken(store) {
    const refreshJwt = this.getStoredRefreshToken(store);
    if (!refreshJwt) throw new Error('No refresh token');

    const res = await fetch(`${BLUESKY_API_BASE}/com.atproto.server.refreshSession`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${refreshJwt}` }
    });

    if (!res.ok) {
      throw new Error(`Bluesky session refresh failed: ${res.status}`);
    }

    const data = await res.json();
    this.saveTokens(store, {
      accessToken: data.accessJwt,
      refreshToken: data.refreshJwt,
      expiresIn: 7200,
      username: data.handle,
      userId: data.did
    });

    return data.accessJwt;
  }

  // ---- Feed ----

  // Fetch the user's home timeline — posts and replies from people they follow.
  // `since` is a post URI used to filter out already-seen posts client-side.
  // Note: Bluesky's cursor is an opaque pagination token, NOT a post URI,
  // so we always fetch the latest posts and filter locally.
  async fetchFeed(token, since) {
    const url = `${BLUESKY_API_BASE}/app.bsky.feed.getTimeline?limit=50`;

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!res.ok) {
      if (res.status === 401) throw new Error('Bluesky session expired');
      throw new Error(`Bluesky API error: ${res.status}`);
    }

    const data = await res.json();
    const posts = (data.feed || []).map(item => {
      const post = item.post;
      const record = post.record || {};

      // Extract text content
      let text = record.text || '';

      // Also extract embedded link URLs (external embeds like link cards)
      if (record.embed?.external?.uri) {
        text += ' ' + record.embed.external.uri;
      }
      // Handle resolved embed (may differ from record embed)
      if (post.embed?.external?.uri && !text.includes(post.embed.external.uri)) {
        text += ' ' + post.embed.external.uri;
      }

      // Extract URIs from facets (rich text links)
      if (record.facets) {
        for (const facet of record.facets) {
          for (const feature of (facet.features || [])) {
            if (feature.$type === 'app.bsky.richtext.facet#link' && feature.uri) {
              if (!text.includes(feature.uri)) {
                text += ' ' + feature.uri;
              }
            }
          }
        }
      }

      return {
        id: post.uri,
        text,
        author: post.author?.handle || post.author?.displayName || null,
        createdAt: record.createdAt || post.indexedAt,
        url: `https://bsky.app/profile/${post.author?.handle}/post/${post.uri.split('/').pop()}`
      };
    });

    // Filter out posts we've already seen (client-side since check)
    if (since) {
      const sinceIndex = posts.findIndex(p => p.id === since);
      if (sinceIndex !== -1) {
        return posts.slice(0, sinceIndex);
      }
    }

    return posts;
  }

  // ---- Internal helpers ----

  async _fetchProfile(token) {
    const res = await fetch(`${BLUESKY_API_BASE}/app.bsky.actor.getProfile?actor=self`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      throw new Error(`Bluesky profile fetch failed: ${res.status}`);
    }
    return res.json();
  }
}

module.exports = BlueskyProvider;
