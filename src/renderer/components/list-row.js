// src/renderer/components/list-row.js: one choice in a list you pick from:
// a location suggestion, a playlist in "Add to playlist", the first line of
// Home's "Finish setting up" list.
//
// Each list built its own row button (padding, hover, divider, a selected
// tint), so the same kind of row hovered and focused differently in each.
// One row: full width, left-aligned, a hover tint, an inset focus ring, and
// the row's states.
//
// Props:
//   size      'sm' (8px 12px, a compact suggestion list) | 'md' (10px 20px,
//             default: a panel's list)
//   divider   a line under the row (none under the last)
//   state     'added' (a success tint), 'drop' (something droppable is over
//             it: the accent tint and a left bar), 'current' (the accent
//             surface: the row this list starts on)
//   className, children, and anything else for the <button> (onClick,
//             aria-pressed, drag handlers, ...)
// Props-driven; loads under plain Node.

const SIZES = {
  sm: 'gap-2 px-3 py-2 text-[13px]',
  md: 'gap-3 px-5 py-2.5 text-sm',
};

const STATES = {
  added: 'bg-tint-success',
  drop: 'bg-accent-tint border-l-4 border-l-accent !pl-4',
  current: 'bg-[var(--accent-surface)]',
};

function listRowClassName({ size = 'md', divider = false, state, className } = {}) {
  return [
    'w-full text-left flex items-center transition-colors no-drag',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
    SIZES[size] || SIZES.md,
    divider ? 'border-b border-line-light last:border-b-0' : '',
    STATES[state] || 'hover:bg-surface-hover',
    className,
  ].filter(Boolean).join(' ');
}

function ListRow({ size, divider, state, className, children, type = 'button', ...rest }) {
  return React.createElement('button', Object.assign({}, rest, {
    type,
    className: listRowClassName({ size, divider, state, className }),
  }), children);
}

module.exports = { ListRow, listRowClassName };
