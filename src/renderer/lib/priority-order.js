// src/renderer/lib/priority-order.js: Raise Priority / Lower Priority for
// a plug-in tile (#1386), the keyboard path for dragging the tiles.
//
// resolverOrder holds every resolver id, including ones that aren't
// numbered (disabled, or blocked by the account's plan). Moving a tile one
// place swaps it with the nearest NUMBERED neighbour in that direction, so
// the numbers change by exactly one, and the unnumbered ids keep their
// slots. Plain module; loads under plain Node.

// The order with `id` moved one numbered place earlier (direction -1) or
// later (+1). Returns the same array when it can't move.
function movePriority(order, id, direction, isNumbered) {
  const from = order.indexOf(id);
  if (from === -1 || !isNumbered(id)) return order;
  let to = from + direction;
  while (to >= 0 && to < order.length && !isNumbered(order[to])) to += direction;
  if (to < 0 || to >= order.length) return order;
  const next = order.slice();
  next[from] = order[to];
  next[to] = id;
  return next;
}

// Whether `id` can move earlier / later.
function priorityMoves(order, id, isNumbered) {
  const numbered = order.filter(isNumbered);
  const i = numbered.indexOf(id);
  return { canRaise: i > 0, canLower: i !== -1 && i < numbered.length - 1 };
}

module.exports = { movePriority, priorityMoves };
