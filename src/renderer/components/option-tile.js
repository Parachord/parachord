// src/renderer/components/option-tile.js: a choice drawn as a tile, a
// bordered card you click: a title, a line under it, and an optional icon on
// the left.
//
// Stop syncing's "Keep imported items" / "Remove synced items" were option
// tiles in Tailwind, the browser extension's Chrome and Firefox store links
// were inline-styled cards, and the album page's edition card was a third
// copy. One tile: the inset surface with a border, a hover tint, the focus
// ring, and a danger tone for the choice that removes things.
//
// Props:
//   title        the choice
//   description  the line under it
//   icon         a node on the left (a logo, an Icons component element)
//   tone         'danger' for the destructive choice
//   compact      the smaller card (the album page's edition card): card
//                surface, 8px radius, tighter padding
//   children     replaces the title and description, for a card with its own
//                lines (the edition card)
// Anything else (onClick, aria-*, data-tooltip, ...) goes to the <button>.
// Props-driven; loads under plain Node.

function optionTileClassName({ tone, compact, className } = {}) {
  return [
    'w-full text-left border transition-colors no-drag',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
    compact ? 'block rounded-lg px-2.5 py-2' : 'flex items-center gap-3 rounded-xl px-4 py-3.5',
    tone === 'danger'
      ? 'bg-tint-danger border-line-danger hover:bg-tint-danger-hover'
      : compact
        ? 'bg-surface-card border-line hover:border-line-strong'
        : 'bg-surface-inset border-line hover:bg-surface-hover',
    className,
  ].filter(Boolean).join(' ');
}

function OptionTile({ title, description, icon, tone, compact = false, className, children, type = 'button', ...rest }) {
  const e = React.createElement;
  return e('button', Object.assign({}, rest, {
    type,
    className: optionTileClassName({ tone, compact, className }),
  }),
    children || [
      icon && e('span', { key: 'icon', className: 'flex-shrink-0 flex items-center', 'aria-hidden': 'true' }, icon),
      e('span', { key: 'text', className: 'block min-w-0 flex-1' },
        e('span', { className: `block ${tone === 'danger' ? 'text-ink-danger' : 'text-ink-primary'}`, style: { fontSize: '14px', fontWeight: 500 } }, title),
        description && e('span', { className: 'block text-ink-secondary', style: { fontSize: '12px', marginTop: '4px' } }, description)),
    ]);
}

module.exports = { OptionTile, optionTileClassName };
