// src/renderer/components/nav-item.js: a sidebar link to a page (Home,
// Playlists, Collection, History and the Discover pages).
//
// Each was a hand-built button with the same classes and a three-state
// style object copied nine times. One item: the page's colour and tint when
// it's the current page (aria-current), a hover tint otherwise, an optional
// unread dot (new content on that page) and count badge (new items), and a
// drop target's highlight (Playlists and Collection take dropped tracks).
//
// Props:
//   page          the PAGE_COLORS key (its colour and tint)
//   label         the page's name
//   icon          an Icons component
//   active        the current page
//   onClick       go there
//   prominent     Home's larger item
//   unread        a pulsing dot in the page's colour after the label
//   count         a "+N" badge at the end (new items), in the page's fill
//   dropHighlight true while something droppable is over it
//   dropProps     onDragOver / onDragEnter / onDragLeave / onDrop
// Props-driven; loads under plain Node.

const { PAGE_COLORS, pageTint } = require('../lib/page-colors');
const Icons = require('./icons');
const { PAGE_ICONS } = require('../lib/page-icons');

function NavItem({ page, label, icon: Icon, active = false, onClick, prominent = false, unread = false, count = 0, dropHighlight = false, dropProps }) {
  const e = React.createElement;
  const colors = PAGE_COLORS[page] || PAGE_COLORS.home;
  const style = dropHighlight
    ? { backgroundColor: pageTint(page), outline: `2px solid ${colors.color}`, outlineOffset: '-2px', color: colors.color }
    : {
        backgroundColor: active ? pageTint(page) : undefined,
        color: active ? colors.color : 'var(--nav-inactive)',
        fontWeight: active ? (prominent ? 600 : 500) : (prominent ? 500 : 400),
      };
  return e('button', Object.assign({
    type: 'button',
    onClick,
    'aria-current': active ? 'page' : undefined,
    className: [
      'w-full flex items-center gap-3 px-3 text-sm transition-colors no-drag',
      prominent ? 'py-2 rounded-lg mb-3' : 'py-1.5 rounded',
      active || dropHighlight ? '' : 'hover:bg-surface-hover',
    ].filter(Boolean).join(' '),
    style,
  }, dropProps),
    Icon && e(Icon, { className: `${prominent ? 'w-5 h-5' : 'w-4 h-4'} flex-shrink-0`, strokeWidth: prominent && active ? 2.5 : 2 }),
    e('span', { className: 'flex items-center gap-1.5 min-w-0' },
      label,
      unread && e('span', { 'aria-label': 'New', role: 'img', className: 'w-2 h-2 rounded-full animate-pulse flex-shrink-0', style: { backgroundColor: colors.color } })),
    count > 0 && e('span', {
      // Keyed on the count, so the badge animates when it changes.
      key: `count-${count}`,
      className: 'ml-auto sidebar-badge',
      // A 16px line: with the 2px + 2px padding the badge is 20px, the row's
      // own line (text-sm), so the row doesn't grow while it shows. Inheriting
      // the 20px line made it 24px and shifted the label and the items below.
      style: { fontSize: '11px', lineHeight: '16px', backgroundColor: colors.fill || 'var(--accent-fill)', color: 'var(--on-accent)', padding: '2px 6px', borderRadius: '10px' },
    }, `+${count}`));
}

// NavSearch: the sidebar's Search item, drawn as a search box (it opens the
// Search page; typing happens there). An inset ring when Search is open.
function NavSearch({ active = false, onClick }) {
  const e = React.createElement;
  return e('button', {
    type: 'button',
    onClick,
    'aria-current': active ? 'page' : undefined,
    className: 'w-full flex items-center gap-3 px-3 py-2 transition-colors rounded-lg text-sm no-drag',
    style: {
      backgroundColor: 'var(--hover-bg-default)',
      color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
      fontWeight: active ? 500 : 400,
      boxShadow: active ? 'inset 0 0 0 1.5px var(--accent-primary-alpha-30)' : undefined,
    },
  },
    e(Icons[PAGE_ICONS.search], { className: 'w-5 h-5 flex-shrink-0' }),
    'Search');
}

module.exports = { NavItem, NavSearch };
