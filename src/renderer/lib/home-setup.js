// src/renderer/lib/home-setup.js: the "Finish setting up" checklist model.
// Pure: Home passes in what it already knows and gets back the items. The
// checks are the ones the old "Enhance Your Experience" cards used.
//
// Loads under plain Node (no window at module scope).

// Popular resolvers the old cards nudged the user to install.
const POPULAR_RESOLVER_IDS = ['youtube', 'soundcloud', 'bandcamp'];

function missingPopularResolverCount(allResolvers) {
  const installed = (Array.isArray(allResolvers) ? allResolvers : []).map((r) => r && r.id);
  return POPULAR_RESOLVER_IDS.filter((id) => !installed.includes(id)).length;
}

function homeSetupItems({
  missingPopularResolvers = 0,
  lastfmConnected = false,
  listenbrainzConnected = false,
  spotifyConnected = false,
  extensionConnected = null,
  isMac = false,
  dismissed = [],
  appVersion = null,
  whatsNewUnread = false,
} = {}) {
  const gone = new Set(Array.isArray(dismissed) ? dismissed : []);
  const all = [
    { id: 'resolvers', label: 'Add more music sources', done: missingPopularResolvers === 0 },
    { id: 'lastfm', label: 'Connect Last.fm', done: !!lastfmConnected },
    { id: 'listenbrainz', label: 'Connect ListenBrainz', done: !!listenbrainzConnected },
    { id: 'spotify', label: 'Connect Spotify', done: !!spotifyConnected },
    // Only open when explicitly false; null (unknown) counts as done.
    { id: 'browser-extension', label: 'Install the browser extension', done: extensionConnected !== false },
  ];
  if (isMac) all.push({ id: 'raycast', label: 'Add the Raycast extension', done: false });

  const items = all.filter((i) => !gone.has(i.id)).map((i) => ({ ...i, action: i.id }));
  const done = items.filter((i) => i.done).length;
  // What's New is never an item and never counts toward done or total. The
  // element always renders: 'setup' while anything is open, else 'whats-new'.
  return {
    items, done, total: items.length,
    mode: items.some((i) => !i.done) ? 'setup' : 'whats-new',
    whatsNew: { version: appVersion, unread: !!whatsNewUnread },
  };
}

module.exports = { homeSetupItems, missingPopularResolverCount, POPULAR_RESOLVER_IDS };
