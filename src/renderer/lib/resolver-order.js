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

// The user's whole ranking, disabled plug-ins included. resolverOrder holds
// only active plug-ins, so turning one off forgot its place, and turning it
// back on put it at its canonical slot: every enable or disable reset the
// user's order (2026-11-17). The memory keeps each disabled plug-in right
// after the one it followed, and the active ones in resolverOrder's order.
function rememberOrder(memory, order) {
  const mem = Array.isArray(memory) ? memory : [];
  const out = [...order];
  let prevId = null;
  for (const id of mem) {
    if (out.includes(id)) { prevId = id; continue; }
    const at = prevId === null ? 0 : out.indexOf(prevId) + 1;
    out.splice(at, 0, id);
    prevId = id;
  }
  return out;
}

// Put a plug-in back into the order where the memory ranks it: before the
// first active plug-in the user ranked below it. One never ranked goes to
// its canonical place.
function insertRemembered(order, id, memory) {
  if (order.includes(id)) return order;
  const mem = Array.isArray(memory) ? memory : [];
  const at = mem.indexOf(id);
  if (at === -1) return insertInCanonicalOrder(order, id);
  let insertAt = order.length;
  for (let i = 0; i < order.length; i++) {
    const p = mem.indexOf(order[i]);
    if (p !== -1 && p > at) { insertAt = i; break; }
  }
  return [...order.slice(0, insertAt), id, ...order.slice(insertAt)];
}

module.exports = { CANONICAL_RESOLVER_ORDER, appendUniqueId, insertInCanonicalOrder, rememberOrder, insertRemembered };
