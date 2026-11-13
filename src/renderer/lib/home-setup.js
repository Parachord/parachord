// src/renderer/lib/home-setup.js: the "Finish setting up" checklist model.
// Pure: Home passes in what it already knows and gets back the items.
//
// Loads under plain Node (no window at module scope).

function homeSetupItems({
  servicesConnected = false,
  scrobblingConnected = false,
  extensionConnected = null,
  isMac = false,
  dismissed = [],
  appVersion = null,
  whatsNewUnread = false,
} = {}) {
  const gone = new Set(Array.isArray(dismissed) ? dismissed : []);
  // Scrobbling used to be one item per service ('lastfm', 'listenbrainz');
  // someone who dismissed both has dismissed scrobbling.
  if (gone.has('lastfm') && gone.has('listenbrainz')) gone.add('scrobbling');
  // The items name no service, so a new plugin needs no change here.
  const all = [
    // Done once a service beyond the ones that ship switched on is in use.
    { id: 'resolvers', label: 'Connect your music services', done: !!servicesConnected },
    { id: 'scrobbling', label: 'Connect a scrobbling service', done: !!scrobblingConnected },
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

module.exports = { homeSetupItems };
