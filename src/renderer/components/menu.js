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
//   items         [{ key, label, icon?, dot?, trailing?, href?, onSelect?, disabled?,
//                    checked?, onContextMenu?, toggle? }]
//                 An item with `href` is a link that opens in the browser
//                 (target _blank) and shows the external-link mark; `dot` is
//                 a colour for a small swatch (a ticket seller's brand);
//                 `trailing` is an element at the item's end (a status mark).
//                 `{ separator: true }` draws a rule between groups. An item
//                 with `checked` (true or false) is a menuitemradio: a choice
//                 among the others (the playbar's "Play from"), with a check
//                 on the current one. `onContextMenu` is passed through (a
//                 right-click menu for that item). `toggle: { checked,
//                 onChange(next), label }` adds an on/off switch at the row's
//                 end: a menuitemcheckbox of its own beside the item (never a
//                 control inside it), so a click on the row still runs
//                 onSelect and the switch flips without closing the menu.
//                 Arrow keys reach both; Space or Enter flips the switch.
//   heading       a small label over the items ("Play from")
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
  boxShadow: 'var(--shadow-popover)',
};
const ITEM_CLASS = 'menu-item no-drag w-full flex items-center gap-2 px-3 py-2 text-left rounded-md';
const ITEM_STYLE = { border: 'none', cursor: 'pointer', textDecoration: 'none', font: 'inherit', fontSize: '12px', fontWeight: 500 };

function menuItemEls(menuEl) {
  return menuEl ? Array.from(menuEl.querySelectorAll('[role^="menuitem"]:not([aria-disabled="true"])')) : [];
}

// The menu's keys: arrows, Home/End, a letter jumps, Escape closes (and
// returns focus), Tab closes.
function menuKeyHandler(getMenuEl, close) {
  return (ev) => {
    const els = menuItemEls(getMenuEl());
    const i = els.indexOf(globalThis.document.activeElement);
    const go = (n) => { ev.preventDefault(); if (els.length) els[(n + els.length) % els.length].focus(); };
    if (ev.key === 'ArrowDown') go(i + 1);
    else if (ev.key === 'ArrowUp') go(i - 1);
    else if (ev.key === 'Home') go(0);
    else if (ev.key === 'End') go(els.length - 1);
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); }
    else if (ev.key === 'Tab') close(false);
    else if (ev.key.length === 1 && /\S/.test(ev.key)) {
      const k = ev.key.toLowerCase();
      for (let step = 1; step <= els.length; step++) {
        const el = els[(i + step) % els.length];
        if ((el.textContent || '').trim().toLowerCase().startsWith(k)) { ev.preventDefault(); el.focus(); break; }
      }
    }
  };
}

// The panel: the one look, its heading and items. run(item, ev) runs one.
function menuPanel({ id, label, heading, minWidth, pos, menuRef, onKeyDown, list, run }) {
  const e = React.createElement;
  return e('div', {
      ref: menuRef,
      id,
      role: 'menu',
      'aria-label': label,
      onKeyDown,
      onClick: (ev) => ev.stopPropagation(),
      onContextMenu: (ev) => ev.preventDefault(),
      style: Object.assign({}, MENU_STYLE, { minWidth: `${minWidth}px` },
        // Measured before paint (useLayoutEffect); hidden until then.
        pos ? { left: `${pos.left}px`, top: `${pos.top}px` } : { left: 0, top: 0, visibility: 'hidden' }),
    },
    heading && e('div', {
      key: 'heading', 'aria-hidden': 'true', className: 'uppercase',
      style: { padding: '6px 12px 4px', fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', opacity: 0.6 },
    }, heading),
    list.map((item, i) => {
      if (item.separator) {
        return e('div', { key: item.key || `sep-${i}`, role: 'separator', style: { height: '1px', margin: '4px 0', backgroundColor: 'var(--on-dark-hover)' } });
      }
      const body = [
        item.dot && e('span', { key: 'dot', 'aria-hidden': 'true', style: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, backgroundColor: item.dot } }),
        item.icon && e('span', { key: 'icon', 'aria-hidden': 'true', className: 'flex-shrink-0 flex items-center' }, item.icon),
        e('span', { key: 'label', className: 'flex-1 min-w-0 truncate' }, item.label),
        item.trailing && e('span', { key: 'trailing', className: 'flex-shrink-0 flex items-center' }, item.trailing),
        item.checked && e(Icons.Check, { key: 'check', size: 14, className: 'flex-shrink-0' }),
        item.href && e(Icons.ExternalLink, { key: 'ext', size: 12, className: 'flex-shrink-0', style: { opacity: 0.6 } }),
      ];
      const common = {
        key: item.key || i,
        role: item.checked === undefined ? 'menuitem' : 'menuitemradio',
        'aria-checked': item.checked === undefined ? undefined : (item.checked ? 'true' : 'false'),
        tabIndex: -1, className: ITEM_CLASS,
        style: item.checked ? Object.assign({}, ITEM_STYLE, { fontWeight: 600 }) : ITEM_STYLE,
        'aria-disabled': item.disabled ? 'true' : undefined,
        onClick: (ev) => run(item, ev),
        onContextMenu: item.onContextMenu,
      };
      if (item.toggle) {
        const on = !!item.toggle.checked;
        return e('div', { key: item.key || i, role: 'none', className: 'flex items-center' },
          e('button', Object.assign(common, { key: 'item', type: 'button', className: `${ITEM_CLASS} flex-1 min-w-0` }), body),
          e('button', {
            key: 'switch', type: 'button', role: 'menuitemcheckbox', 'aria-checked': on ? 'true' : 'false',
            'aria-label': item.toggle.label || item.label, tabIndex: -1,
            className: 'menu-item no-drag flex-shrink-0 flex items-center rounded-md px-2 py-2',
            style: { border: 'none', cursor: 'pointer', background: 'transparent' },
            // Flips in place: the menu stays open on the switch.
            onClick: (ev) => { ev.stopPropagation(); item.toggle.onChange(!on); },
          }, e('span', {
            'aria-hidden': 'true', 'data-menu-switch': on ? 'on' : 'off',
            style: { position: 'relative', width: '28px', height: '16px', borderRadius: '9999px', transition: 'background-color 150ms ease',
              backgroundColor: on ? 'var(--accent-fill)' : 'var(--on-dark-track)' },
          }, e('span', {
            style: { position: 'absolute', top: '2px', left: on ? '14px' : '2px', width: '12px', height: '12px', borderRadius: '9999px',
              backgroundColor: 'var(--on-dark-primary)', transition: 'left 150ms ease' },
          }))));
      }
      return item.href
        ? e('a', Object.assign(common, { href: item.href, target: '_blank', rel: 'noopener noreferrer' }), body)
        : e('button', Object.assign(common, { type: 'button' }), body);
    }));
}

// In the app, a portal on document.body; under plain Node (server render,
// tests), in place.
function portal(node) {
  const RD = globalThis.ReactDOM;
  const body = globalThis.document && globalThis.document.body;
  return RD && RD.createPortal && body ? RD.createPortal(node, body) : node;
}

// Close on a mousedown or scroll outside the menu (and the trigger), or a
// window resize.
function useOutsideClose(open, isInside, close) {
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev) => { if (!isInside(ev.target)) close(); };
    // A page scroll moves the trigger away from a fixed menu: close it. A
    // scroll inside the menu (a long list) doesn't.
    const onScroll = (ev) => { if (!isInside(ev.target)) close(); };
    const onResize = () => close();
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
}

// Focus the first item (the last from ArrowUp, the current choice in a
// pick-one menu). Its ring shows only after keyboard use (lib/input-modality.js).
function focusStart(menuEl, where) {
  const els = menuItemEls(menuEl);
  // The current choice in a pick-one menu (a menuitemradio), not an on/off
  // switch beside an item.
  const checked = els.find((el) => el.getAttribute && el.getAttribute('role') === 'menuitemradio' && el.getAttribute('aria-checked') === 'true');
  const target = where === 'last' ? els[els.length - 1] : (checked || els[0]);
  if (target) target.focus({ preventScroll: true });
}

function Menu({ label, items, renderTrigger, align = 'left', minWidth = 160, heading }) {
  const e = React.createElement;
  const [open, setOpen] = React.useState(false);
  const [pos, setPos] = React.useState(null); // { left, top } once measured
  const rootRef = React.useRef(null);
  const menuRef = React.useRef(null);
  const startAt = React.useRef('first');
  const id = React.useId();
  const list = (items || []).filter(Boolean);

  const triggerEl = () => (rootRef.current ? rootRef.current.querySelector('[aria-haspopup="menu"]') : null);
  const close = (refocus) => {
    setOpen(false);
    if (refocus) { const t = triggerEl(); if (t) t.focus(); }
  };

  useOutsideClose(open,
    (n) => (rootRef.current && rootRef.current.contains(n)) || (menuRef.current && menuRef.current.contains(n)),
    () => setOpen(false));

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
  }, [open]);
  // Focus the first (or checked, or last) item once the menu is placed: it
  // is visibility: hidden until then, and a hidden item can't take focus
  // (focusing it in the effect above left focus on the trigger, so the
  // arrow keys and Escape never reached the menu).
  React.useLayoutEffect(() => {
    if (open && pos) focusStart(menuRef.current, startAt.current);
  }, [open, !!pos]);

  const openAt = (where) => { startAt.current = where; setOpen(true); };

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

  const menu = open && menuPanel({
    id: `${id}-menu`, label, heading, minWidth, pos, menuRef, list, run,
    onKeyDown: menuKeyHandler(() => menuRef.current, close),
  });

  return e('div', { ref: rootRef, style: { display: 'inline-block' } },
    trigger,
    menu && portal(menu));
}

// ContextMenu: the same menu opened at a point, for a right-click (the page
// header's "Copy link" menu). Its items are actions that run here, which the
// native item menus (lib/item-menus.js + showItemMenu) can't carry. Shown
// while mounted; onClose() when an item runs, on Escape (focus goes back to
// where it was), Tab, or a click, scroll or right-click outside.
//   at     { x, y } in window coordinates (the event's clientX / clientY)
//   label, items, heading, minWidth as for Menu
function ContextMenu({ label, items, at, onClose, minWidth = 160, heading }) {
  const [pos, setPos] = React.useState(null);
  const menuRef = React.useRef(null);
  const opener = React.useRef(null);
  const id = React.useId();
  const list = (items || []).filter(Boolean);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const close = (refocus) => {
    const back = opener.current;
    if (closeRef.current) closeRef.current();
    if (refocus && back && back.focus && globalThis.document.contains(back)) back.focus();
  };

  useOutsideClose(true, (n) => menuRef.current && menuRef.current.contains(n), () => close(false));
  React.useEffect(() => {
    // A right-click elsewhere closes it too (the next menu opens there).
    const onCtx = (ev) => { if (!(menuRef.current && menuRef.current.contains(ev.target))) close(false); };
    // Escape closes it wherever focus is (it opens from a mouse click).
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.stopPropagation(); close(true); } };
    globalThis.document.addEventListener('contextmenu', onCtx, true);
    globalThis.document.addEventListener('keydown', onKey, true);
    return () => {
      globalThis.document.removeEventListener('contextmenu', onCtx, true);
      globalThis.document.removeEventListener('keydown', onKey, true);
    };
  }, []);

  // At the point, kept inside the window (it opens left of or above the
  // point when there's no room), then focus on the first item.
  React.useLayoutEffect(() => {
    const doc = globalThis.document;
    if (!opener.current && doc) opener.current = doc.activeElement;
    const m = menuRef.current;
    const view = globalThis.window;
    if (m && m.getBoundingClientRect && view && at) {
      const mr = m.getBoundingClientRect();
      const edge = 8;
      let left = at.x + mr.width + edge > view.innerWidth ? at.x - mr.width : at.x;
      let top = at.y + mr.height + edge > view.innerHeight ? at.y - mr.height : at.y;
      left = Math.max(edge, Math.min(left, view.innerWidth - mr.width - edge));
      top = Math.max(edge, Math.min(top, view.innerHeight - mr.height - edge));
      setPos({ left, top });
    }
  }, [at && at.x, at && at.y]);
  // Focus the first item once it's placed and visible (see Menu).
  React.useLayoutEffect(() => {
    if (pos) focusStart(menuRef.current, 'first');
  }, [!!pos]);

  const run = (item, ev) => {
    if (item.disabled) { ev.preventDefault(); return; }
    close(!item.href);
    if (!item.href && item.onSelect) item.onSelect();
  };

  return portal(menuPanel({
    id: `${id}-menu`, label, heading, minWidth, pos, menuRef, list, run,
    onKeyDown: menuKeyHandler(() => menuRef.current, close),
  }));
}

module.exports = { Menu, ContextMenu };
