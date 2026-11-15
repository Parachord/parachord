// src/renderer/components/filter-box.js: a page's filter box and the bar it
// usually sits in.
//
//   FilterBox  the search icon that opens into a "Filter…" box on the right
//              of a page's toolbar. Twelve pages had their own copy (the
//              Playlists page, Charts, Fresh Drops, Critical Darlings,
//              Concerts, History, Collection, the artist page, Search's three
//              detail views and the Add to playlist panel); every one behaved
//              the same, so the behaviour is here: it opens focused, an empty
//              box closes when it loses focus, and ✕ empties and closes it.
//   StickyBar  the strip that stays at the top of a page's scroll area while
//              the content scrolls under it: the page background and a
//              bottom border. `variant` 'filter' (sort, chips and the filter
//              box) or 'header' (the playlist page's breadcrumb and actions).
//
// FilterBox props: value, onChange(text), open, onOpenChange(open),
// placeholder ("Filter…"), label ("Filter"), width (150px), size ('md' |
// 'sm', the Add to playlist panel's).
// Props-driven; loads under plain Node.

const Icons = require('./icons');

function FilterBox({ value, onChange, open, onOpenChange, placeholder = 'Filter…', label = 'Filter', width, size = 'md' }) {
  const e = React.createElement;
  const sm = size === 'sm';
  if (!open) {
    return e('div', { className: 'flex items-center' },
      e('button', {
        type: 'button', 'aria-label': label, 'data-tooltip': label,
        onClick: () => onOpenChange(true),
        className: 'p-1.5 text-ink-tertiary hover:text-ink-secondary transition-colors no-drag',
      }, e(Icons.Search, { className: sm ? 'w-4 h-4' : 'w-5 h-5' })));
  }
  return e('div', { className: 'flex items-center' },
    e('div', {
      className: `flex items-center border border-line-strong filter-pill ${sm ? 'rounded-lg px-2 py-1' : 'rounded-full px-3 py-[5px]'}`,
    },
      e('input', {
        type: 'text', value, autoFocus: true, placeholder, 'aria-label': label,
        onChange: (ev) => onChange(ev.target.value),
        onBlur: () => { if (!String(value || '').trim()) onOpenChange(false); },
        onKeyDown: (ev) => { if (ev.key === 'Escape') { onChange(''); onOpenChange(false); } },
        className: `bg-transparent text-ink-secondary ${sm ? 'text-xs' : 'text-sm'} placeholder-ink-tertiary outline-none no-drag`,
        style: { width: width || (sm ? '120px' : '150px') },
      }),
      value && e('button', {
        type: 'button', 'aria-label': 'Clear filter', 'data-tooltip': 'Clear filter',
        onClick: () => { onChange(''); onOpenChange(false); },
        className: `${sm ? 'ml-1' : 'ml-2'} text-ink-tertiary hover:text-ink-secondary no-drag`,
      }, e(Icons.X, { className: sm ? 'w-3 h-3' : 'w-4 h-4' }))));
}

function StickyBar({ variant = 'filter', className, style, children }) {
  return React.createElement('div', {
    className: ['sticky top-0 z-10 flex items-center px-6', variant === 'header' ? 'justify-between py-4' : 'py-3', className].filter(Boolean).join(' '),
    style: Object.assign({ backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }, style),
  }, children);
}

module.exports = { FilterBox, StickyBar };
