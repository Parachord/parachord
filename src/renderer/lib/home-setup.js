// src/renderer/lib/home-setup.js: the "Finish setting up" checklist model.
// Pure: Home passes in what it already knows and gets back the items.
//
// Loads under plain Node (no window at module scope).

// Connecting a service and a scrobbling service used to be items here; they
// are the getting-started layout's steps now (#1493, lib/getting-started.js).
// The pill carries what's left: the getting-started steps when they were
// skipped before they were done (its action brings the layout back), the
// browser extension, and What's New. Raycast's item is gone: Parachord can't
// tell whether that extension is installed, so it could never be done.
function homeSetupItems({
  gettingStartedLeft = false,
  extensionConnected = null,
  dismissed = [],
  appVersion = null,
  whatsNewUnread = false,
} = {}) {
  const gone = new Set(Array.isArray(dismissed) ? dismissed : []);
  const all = [];
  // Only listed while it's open: finishing the steps (or bringing the layout
  // back) takes it off.
  if (gettingStartedLeft) all.push({ id: 'getting-started', label: 'Finish getting started', done: false });
  // Only open when explicitly false; null (unknown) counts as done.
  all.push({ id: 'browser-extension', label: 'Install the browser extension', done: extensionConnected !== false });

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
