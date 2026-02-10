// social-feeds/feed-playlist-manager.js
// Orchestrates social feed monitoring across providers.
// Registers providers, manages polling, collects discovered music links,
// and exposes them as a dynamic playlist the renderer can consume.

const { extractLinksFromPosts } = require('./link-extractor');

// Default poll interval: 5 minutes
const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000;

class FeedPlaylistManager {
  constructor(store) {
    this.store = store;
    this.providers = new Map();       // id -> provider instance
    this.activePollers = new Map();    // id -> intervalId
    this.onUpdate = null;             // callback when new links are found
  }

  // ---- Provider registry ----

  registerProvider(provider) {
    this.providers.set(provider.id, provider);
  }

  getProvider(id) {
    return this.providers.get(id) || null;
  }

  getAllProviders() {
    return Array.from(this.providers.values());
  }

  // Get connection status for all providers (for the UI)
  getStatus() {
    const statuses = {};
    for (const provider of this.providers.values()) {
      statuses[provider.id] = provider.getConnectionStatus(this.store);
    }
    return statuses;
  }

  // ---- Polling ----

  startPolling(providerId, intervalMs = DEFAULT_POLL_INTERVAL_MS) {
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown social feed provider: ${providerId}`);

    this.stopPolling(providerId);

    const token = provider.getStoredToken(this.store);
    if (!token) {
      throw new Error(`${provider.name} is not authenticated. Connect your account first.`);
    }

    const lastPostId = this.store.get(`social-feed-${providerId}-last-post-id`) || null;
    provider.lastSeenPostId = lastPostId;

    const fetchFn = async (since) => {
      let currentToken = provider.getStoredToken(this.store);

      // Auto-refresh expired tokens
      if (provider.isTokenExpired(this.store)) {
        try {
          currentToken = await provider.refreshToken(this.store);
        } catch (err) {
          console.error(`[FeedPlaylistManager] Token refresh failed for ${provider.name}:`, err.message);
          throw err;
        }
      }

      return provider.fetchFeed(currentToken, since);
    };

    const onNewPosts = (posts) => {
      // Persist cursor
      if (posts.length > 0) {
        this.store.set(`social-feed-${providerId}-last-post-id`, posts[0].id);
      }

      const links = extractLinksFromPosts(posts);
      if (links.length === 0) return;

      // Append to stored playlist
      const playlist = this.getPlaylist(providerId);
      const existingUrls = new Set(playlist.map(item => item.url));
      const newItems = links.filter(l => !existingUrls.has(l.url));

      if (newItems.length === 0) return;

      const updatedPlaylist = [...newItems, ...playlist];
      this.store.set(`social-feed-playlist-${providerId}`, updatedPlaylist);

      console.log(`[FeedPlaylistManager] ${provider.name}: found ${newItems.length} new music link(s)`);

      if (this.onUpdate) {
        this.onUpdate(providerId, newItems, updatedPlaylist);
      }
    };

    provider.startPolling(intervalMs, fetchFn, onNewPosts);
    this.activePollers.set(providerId, true);

    console.log(`[FeedPlaylistManager] Started polling ${provider.name} every ${intervalMs / 1000}s`);
  }

  stopPolling(providerId) {
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.stopPolling();
    }
    this.activePollers.delete(providerId);
  }

  stopAllPolling() {
    for (const providerId of this.activePollers.keys()) {
      this.stopPolling(providerId);
    }
  }

  isPolling(providerId) {
    return this.activePollers.has(providerId);
  }

  // ---- Playlist data ----

  // Get the accumulated playlist for a provider
  getPlaylist(providerId) {
    return this.store.get(`social-feed-playlist-${providerId}`) || [];
  }

  // Get a merged playlist across all connected providers
  getMergedPlaylist() {
    const all = [];
    for (const provider of this.providers.values()) {
      const items = this.getPlaylist(provider.id);
      all.push(...items.map(item => ({ ...item, provider: provider.id })));
    }
    // Sort newest first (by post date)
    all.sort((a, b) => {
      const dateA = a.post?.createdAt ? new Date(a.post.createdAt).getTime() : 0;
      const dateB = b.post?.createdAt ? new Date(b.post.createdAt).getTime() : 0;
      return dateB - dateA;
    });
    return all;
  }

  // Clear stored playlist for a provider
  clearPlaylist(providerId) {
    this.store.delete(`social-feed-playlist-${providerId}`);
    this.store.delete(`social-feed-${providerId}-last-post-id`);
    const provider = this.providers.get(providerId);
    if (provider) {
      provider.lastSeenPostId = null;
    }
  }

  // Remove a single item from a provider's playlist by URL
  removePlaylistItem(providerId, url) {
    const playlist = this.getPlaylist(providerId);
    const filtered = playlist.filter(item => item.url !== url);
    this.store.set(`social-feed-playlist-${providerId}`, filtered);
    return filtered;
  }
}

module.exports = FeedPlaylistManager;
