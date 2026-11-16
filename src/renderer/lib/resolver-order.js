// src/renderer/lib/resolver-order.js: the canonical priority order for
// content plug-ins, and the helpers that keep an order list unique and
// insert a newly enabled plug-in at its canonical place. Moved out of
// app.js so the plug-in settings dialog (components/plugin-settings-dialog.js)
// can share them (#1451).

// Canonical priority order for content resolvers (determines insertion position when enabling)

const CANONICAL_RESOLVER_ORDER = ['spotify', 'applemusic', 'amazonmusic', 'bandcamp', 'soundcloud', 'localfiles', 'subsonic', 'youtube'];

// Append an id to a resolver list unless it is already there. The plugin
// order and the active list are rendered keyed by id, and a reinstall used to
// append an id the order still held, listing the plugin twice until restart.
function appendUniqueId(list, id) {
  const prev = Array.isArray(list) ? list : [];
  return prev.includes(id) ? prev : [...prev, id];
}

// Insert a resolver ID into an order array at its canonical position
function insertInCanonicalOrder(order, newId) {
  if (order.includes(newId)) return order;
  const canonicalIndex = CANONICAL_RESOLVER_ORDER.indexOf(newId);
  if (canonicalIndex === -1) {
    // Not in canonical list, append to end
    return [...order, newId];
  }
  // Find the right position: after any resolver with a lower canonical index
  let insertAt = order.length;
  for (let i = 0; i < order.length; i++) {
    const existingIndex = CANONICAL_RESOLVER_ORDER.indexOf(order[i]);
    if (existingIndex !== -1 && existingIndex > canonicalIndex) {
      insertAt = i;
      break;
    }
  }
  const newOrder = [...order];
  newOrder.splice(insertAt, 0, newId);
  return newOrder;
}

module.exports = { CANONICAL_RESOLVER_ORDER, appendUniqueId, insertInCanonicalOrder };
