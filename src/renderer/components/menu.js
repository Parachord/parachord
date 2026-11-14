// src/renderer/components/menu.js: an action menu (#1385, the Menu
// component). SortMenu (sort-menu.js) picks one value; Menu runs actions or
// opens links: Share, the ticket menus, Sync.
//
// Each of those was built by hand: its own open state in the app component,
// a document click listener, its own look (Share's was the dark tooltip
// colour), and none worked from the keyboard. Menu keeps its own state and:
//   - the trigger gets aria-haspopup="menu", aria-expanded, aria-controls
//   - opens a role="menu" of role="menuitem" buttons or links, with focus on
//     the first one (or the last, from ArrowUp)
//   - ArrowUp/ArrowDown move, Home/End jump, a letter jumps to the next item
//     starting with it, Escape closes and returns focus to the trigger, Tab
//     closes
//   - closes on an outside click and after an item runs
//   - draws in a layer over the page (a portal on document.body, fixed
//     position, like the tooltips), so no scrolling column or card clips it
//     and no row's stacking context hides it; it opens upward when there is
//     no room below, stays inside the window, and closes on a page scroll
//
// Props:
//   label         names the menu for screen readers ("Share", "Tickets for X")
//   items         [{ key, label, icon?, dot?, trailing?, href?, onSelect?, disabled? }]
//                 An item with `href` is a link that opens in the browser
//                 (target _blank) and shows the external-link mark; `dot` is
//                 a colour for a small swatch (a ticket seller's brand);
//                 `trailing` is an element at the item's end (a status mark).
//                 `{ separator: true }` draws a rule between groups.
//   renderTrigger (props) => element. Spread `props` onto the trigger
//                 button; `props.open` says whether the menu is showing (for
//                 a chevron or a pressed look). Clicks on it don't reach a
//                 clickable card behind it.
//   align         'left' | 'right': which trigger edge the menu lines up with
//   minWidth      px, default 160
// Props-driven; hooks are qualified; loads under plain Node.

const Icons = require('./icons');

// One look for every menu: Share's dark panel (the tooltip colours, in both
// themes), 12px medium text. Items are styled by .menu-item in index.html
// (hover and keyboard focus use --tooltip-hover).
const MENU_STYLE = {
  position: 'fixed', zIndex: 'var(--z-popover)', maxHeight: '60vh', overflowY: 'auto',
  minWidth: '160px', margin: 0, padding: '4px', listStyle: 'none', borderRadius: '8px',
  border: '1px solid var(--tooltip-border)', backgroundColor: 'var(--tooltip-bg)', color: 'var(--tooltip-text)',
  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
};
const ITEM_CLASS = 'menu-item no-drag w-full flex items-center gap-2 px-3 py-2 text-left rounded-md';
const ITEM_STYLE = { border: 'none', cursor: 'pointer', textDecoration: 'none', font: 'inherit', fontSize: '12px', fontWeight: 500 };

function Menu({ label, items, renderTrigger, align = 'left', minWidth = 160 }) {
  const e = React.createElement;
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null); // { left, top } once measured
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const startAt = React.useRef('first');
  const id = React.useId();
  const list = (items || []).filter(Boolean);

  const itemEls = () => (menuRef.current ? Array.from(menuRef.current.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])')) : []);
  const triggerEl = () => (rootRef.current ? rootRef.current.querySelector('[aria-haspopup="menu"]') : null);
  const close = (refocus) => {
    setOpen(false);
    if (refocus) { const t = triggerEl(); if (t) t.focus(); }
  };

  React.useEffect(() => {
    if (!open) return undefined;
    const inside = (n) => (rootRef.current && rootRef.current.contains(n)) || (menuRef.current && menuRef.current.contains(n));
    const onDown = (ev) => { if (!inside(ev.target)) setOpen(false); };
    // A page scroll moves the trigger away from a fixed menu: close it. A
    // scroll inside the menu (a long list) doesn't.
    const onScroll = (ev) => { if (!inside(ev.target)) setOpen(false); };
    const onResize = () => setOpen(false);
    const doc = globalThis.document;
    const view = globalThis.window;
    doc.addEventListener('mousedown', onDown);
    doc.addEventListener('scroll', onScroll, true);
    if (view && view.addEventListener) view.addEventListener('resize', onResize);
    return () => {
      doc.removeEventListener('mousedown', onDown);
      doc.removeEventListener('scroll', onScroll, true);
      if (view && view.removeEventListener) view.removeEventListener('resize', onResize);
    };
  }, [open]);

  // Placement under (or over) the trigger, inside the window, then focus on
  // the first item, before paint.
  React.useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const m = menuRef.current;
    const t = triggerEl();
    const view = globalThis.window;
    if (m && t && t.getBoundingClientRect && m.getBoundingClientRect && view) {
      const tr = t.getBoundingClientRect();
      const mr = m.getBoundingClientRect();
      const gap = 4; const edge = 8;
      let left = align === 'right' ? tr.right - mr.width : tr.left;
      left = Math.max(edge, Math.min(left, view.innerWidth - mr.width - edge));
      const below = view.innerHeight - tr.bottom - gap - edge;
      const above = tr.top - gap - edge;
      const top = (mr.height > below && above > below)
        ? Math.max(edge, tr.top - gap - mr.height)
        : tr.bottom + gap;
      setPos({ left, top });
    }
    const els = itemEls();
    const target = startAt.current === 'last' ? els[els.length - 1] : els[0];
    if (target) target.focus({ preventScroll: true });
  }, [open]);

  const openAt = (where) => { startAt.current = where; setOpen(true); };

  const onMenuKey = (ev) => {
    const els = itemEls();
    const i = els.indexOf(globalThis.document.activeElement);
    const go = (n) => { ev.preventDefault(); if (els.length) els[(n + els.length) % els.length].focus(); };
    if (ev.key === 'ArrowDown') go(i + 1);
    else if (ev.key === 'ArrowUp') go(i - 1);
    else if (ev.key === 'Home') go(0);
    else if (ev.key === 'End') go(els.length - 1);
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); }
    else if (ev.key === 'Tab') setOpen(false);
    else if (ev.key.length === 1 && /\S/.test(ev.key)) {
      const k = ev.key.toLowerCase();
      for (let step = 1; step <= els.length; step++) {
        const el = els[(i + step) % els.length];
        if ((el.textContent || '').trim().toLowerCase().startsWith(k)) { ev.preventDefault(); el.focus(); break; }
      }
    }
  };

  const run = (item, ev) => {
    if (item.disabled) { ev.preventDefault(); return; }
    // A link navigates on its own (the browser opens it); an action runs.
    close(!item.href);
    if (!item.href && item.onSelect) item.onSelect();
  };

  const trigger = renderTrigger({
    open,
    'aria-haspopup': 'menu',
    'aria-expanded': open ? 'true' : 'false',
    'aria-controls': open ? `${id}-menu` : undefined,
    onClick: (ev) => { ev.stopPropagation(); if (open) setOpen(false); else openAt('first'); },
    onKeyDown: (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); openAt('first'); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); openAt('last'); }
    },
  });

  const menu = open && e('div', {
      ref: menuRef,
      id: `${id}-menu`,
      role: 'menu',
      'aria-label': label,
      onKeyDown: onMenuKey,
      onClick: (ev) => ev.stopPropagation(),
      style: Object.assign({}, MENU_STYLE, { minWidth: `${minWidth}px` },
        // Measured before paint (useLayoutEffect); hidden until then.
        pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: 0, top: 0, visibility: 'hidden' }),
    },
    list.map((item, i) => {
      if (item.separator) {
        return e('div', { key: item.key || `sep-${i}`, role: 'separator', style: { height: '1px', margin: '4px 0', backgroundColor: 'rgba(255, 255, 255, 0.12)' } });
      }
      const body = [
        item.dot && e('span', { key: 'dot', 'aria-hidden': 'true', style: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, backgroundColor: item.dot } }),
        item.icon && e('span', { key: 'icon', 'aria-hidden': 'true', className: 'flex-shrink-0 flex items-center' }, item.icon),
        e('span', { key: 'label', className: 'flex-1 min-w-0 truncate' }, item.label),
        item.trailing && e('span', { key: 'trailing', className: 'flex-shrink-0 flex items-center' }, item.trailing),
        item.href && e(Icons.ExternalLink, { key: 'ext', size: 12, className: 'flex-shrink-0', style: { opacity: 0.6 } }),
      ];
      const common = {
        key: item.key || i, role: 'menuitem', tabIndex: -1, className: ITEM_CLASS, style: ITEM_STYLE,
        'aria-disabled': item.disabled ? 'true' : undefined,
        onClick: (ev) => run(item, ev),
      };
      return item.href
        ? e('a', Object.assign(common, { href: item.href, target: '_blank', rel: 'noopener noreferrer' }), body)
        : e('button', Object.assign(common, { type: 'button' }), body);
    }));

  // In the app, a portal on document.body; under plain Node (server render,
  // tests), in place.
  const RD = globalThis.ReactDOM;
  const body = globalThis.document && globalThis.document.body;
  return e('div', { ref: rootRef, style: { display: 'inline-block' } },
    trigger,
    menu && (RD && RD.createPortal && body ? RD.createPortal(menu, body) : menu));
}

module.exports = { Menu };
