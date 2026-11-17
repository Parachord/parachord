// src/renderer/lib/home-setup.js: the "Finish setting up" checklist model.
// Pure: Home passes in what it already knows and gets back the items.
//
// Loads under plain Node (no window at module scope).

// Connecting a service and a scrobbling service used to be items here; they
// are the getting-started layout's steps now (#1493, lib/getting-started.js),
// so the pill carries only the extras and What's New.
function homeSetupItems({
  extensionConnected = null,
  isMac = false,
  dismissed = [],
  appVersion = null,
  whatsNewUnread = false,
} = {}) {
  const gone = new Set(Array.isArray(dismissed) ? dismissed : []);
  const all = [
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
