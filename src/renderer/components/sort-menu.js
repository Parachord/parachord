// src/renderer/components/sort-menu.js: a pick-one dropdown (#1385 step 5).
//
// The sort and filter dropdowns (Playlists, Collection, History, Critical
// Darlings, the artist page, Search, Add to Playlist, ...) were each built
// by hand with their own open state and a document click listener, and
// none worked from the keyboard. SortMenu keeps its own open state and:
//   - is a button with aria-haspopup="listbox" and aria-expanded
//   - opens a role="listbox" of role="option" items, aria-selected on the
//     picked one, with a check
//   - ArrowUp/ArrowDown move, Home/End jump, Enter/Space pick, Escape
//     closes and returns focus to the button, Tab closes
//   - closes on an outside click
//
// Props: value, options [{ value, label }], onChange(value), label (the
// aria-label, e.g. "Sort playlists"), prefix (a quiet label before the
// value, e.g. "Source:"), placeholder (shown when nothing
// matches; default "Sort"), align 'left' | 'right', className (the
// trigger's extra classes). Props-driven; hooks are qualified; loads under
// plain Node.

const Icons = require('./icons');

function SortMenu({ value, options, onChange, label, placeholder = 'Sort', align = 'left', className, prefix }) {
  const e = React.createElement;
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const rootRef = React.useRef(null);
  const buttonRef = React.useRef(null);
  const listRef = React.useRef(null);
  const id = React.useId();
  const list = options || [];
  const current = list.find((o) => o.value === value);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev) => { if (rootRef.current && !rootRef.current.contains(ev.target)) setOpen(false); };
    globalThis.document.addEventListener('mousedown', onDown);
    const i = Math.max(0, list.findIndex((o) => o.value === value));
    setActive(i);
    if (listRef.current) listRef.current.focus();
    return () => globalThis.document.removeEventListener('mousedown', onDown);
  }, [open]);

  const pick = (opt) => {
    setOpen(false);
    if (buttonRef.current) buttonRef.current.focus();
    if (opt && opt.value !== value && onChange) onChange(opt.value);
  };

  const onListKey = (ev) => {
    const n = list.length;
    if (ev.key === 'ArrowDown') { ev.preventDefault(); setActive((a) => (a + 1) % n); }
    else if (ev.key === 'ArrowUp') { ev.preventDefault(); setActive((a) => (a - 1 + n) % n); }
    else if (ev.key === 'Home') { ev.preventDefault(); setActive(0); }
    else if (ev.key === 'End') { ev.preventDefault(); setActive(n - 1); }
    else if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); pick(list[active]); }
    else if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); setOpen(false); if (buttonRef.current) buttonRef.current.focus(); }
    else if (ev.key === 'Tab') setOpen(false);
  };

  return e('div', { ref: rootRef, className: 'relative inline-block' },
    e('button', {
      ref: buttonRef,
      type: 'button',
      'aria-haspopup': 'listbox',
      'aria-expanded': open ? 'true' : 'false',
      'aria-label': label ? `${label}: ${current ? current.label : placeholder}` : undefined,
      onClick: (ev) => { ev.stopPropagation(); setOpen((o) => !o); },
      onKeyDown: (ev) => { if (ev.key === 'ArrowDown' && !open) { ev.preventDefault(); setOpen(true); } },
      className: ['no-drag flex items-center gap-1 px-3 py-1.5 text-sm rounded-lg text-ink-tertiary hover:text-ink-secondary transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', className].filter(Boolean).join(' '),
    },
    prefix && e('span', { className: 'text-ink-tertiary mr-1' }, prefix),
    e('span', null, current ? current.label : placeholder),
    e(Icons.ChevronDown, { className: 'w-4 h-4' })),
    open && e('ul', {
      ref: listRef,
      id: `${id}-list`,
      role: 'listbox',
      tabIndex: -1,
      'aria-label': label,
      'aria-activedescendant': `${id}-opt-${active}`,
      onKeyDown: onListKey,
      className: `absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 py-1 min-w-[180px] rounded-lg shadow-lg border border-line bg-surface-card focus:outline-none`,
      style: { zIndex: 'var(--z-dropdown)', listStyle: 'none', margin: '4px 0 0', padding: '4px 0', maxHeight: '60vh', overflowY: 'auto' },
    },
    list.map((opt, i) => e('li', {
      key: opt.value,
      id: `${id}-opt-${i}`,
      role: 'option',
      'aria-selected': opt.value === value ? 'true' : 'false',
      onMouseDown: (ev) => ev.preventDefault(),
      onMouseEnter: () => setActive(i),
      onClick: (ev) => { ev.stopPropagation(); pick(opt); },
      className: `px-4 py-2 text-sm flex items-center justify-between gap-3 cursor-pointer ${i === active ? 'bg-surface-hover' : ''} ${
        opt.value === value ? 'text-ink-primary font-medium' : 'text-ink-secondary'}`,
    },
    opt.label,
    opt.value === value && e(Icons.Check, { className: 'w-4 h-4 text-accent' })))));
}

module.exports = { SortMenu };
