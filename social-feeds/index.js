// social-feeds/index.js
// Entry point for the social feeds module.
// Creates and registers all social feed providers with the manager.

const FeedPlaylistManager = require('./feed-playlist-manager');
const BlueskyProvider = require('./bluesky-provider');
const XProvider = require('./x-provider');
const MastodonProvider = require('./mastodon-provider');

function createFeedPlaylistManager(store) {
  const manager = new FeedPlaylistManager(store);

  manager.registerProvider(new BlueskyProvider());
  manager.registerProvider(new XProvider());
  manager.registerProvider(new MastodonProvider());

  return manager;
}

module.exports = { createFeedPlaylistManager };
