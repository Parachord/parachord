// src/renderer/components/hero-tabs.js: the tab row in a page hero
// (#1385 step 6).
//
// Collection, History, Charts, a friend's history and the artist page each
// built their hero tabs by hand, twice (expanded and collapsed hero): plain
// buttons with "|" separators, no tab roles, and inactive tabs in white at
// 60%, about 1.7:1 on the brighter gradients. HeroTabs is one row:
//   - role="tablist" (aria-label), each tab role="tab" with aria-selected;
//     only the selected tab is in the Tab order (roving tabindex)
//   - ArrowLeft/Right move and select, Home/End jump
//   - separators are aria-hidden
//   - inactive tabs are white at 80%, with the hero's text shadow
//
// Props: items (any array), isSelected(item), onSelect(item), renderLabel(item),
// label (aria-label), compact (the collapsed hero's smaller row).
// Props-driven; hooks are qualified; loads under plain Node.

function HeroTabs({ items, isSelected, onSelect, renderLabel, label, compact = false }) {
  const e = React.createElement;
  const refs = React.useRef([]);
  const list = (items || []).filter(Boolean);
  const selectedIndex = Math.max(0, list.findIndex((it) => isSelected(it)));

  const go = (i) => {
    const n = list.length;
    const next = ((i % n) + n) % n;
    const el = refs.current[next];
    if (el) el.focus();
    onSelect(list[next]);
  };
  const onKeyDown = (ev, i) => {
    if (ev.key === 'ArrowRight') { ev.preventDefault(); go(i + 1); }
    else if (ev.key === 'ArrowLeft') { ev.preventDefault(); go(i - 1); }
    else if (ev.key === 'Home') { ev.preventDefault(); go(0); }
    else if (ev.key === 'End') { ev.preventDefault(); go(list.length - 1); }
  };

  return e('div', { role: 'tablist', 'aria-label': label, className: 'contents' },
    list.map((item, i) => [
      i > 0 && e('span', { key: `sep-${i}`, 'aria-hidden': 'true', className: compact ? 'text-white/50 mx-1.5' : 'text-white/50 mx-2' }, '|'),
      e('button', {
        key: `tab-${i}`,
        ref: (el) => { refs.current[i] = el; },
        type: 'button',
        role: 'tab',
        'aria-selected': i === selectedIndex ? 'true' : 'false',
        tabIndex: i === selectedIndex ? 0 : -1,
        onClick: () => onSelect(item),
        onKeyDown: (ev) => onKeyDown(ev, i),
        className: [
          compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm',
          'font-medium uppercase tracking-wider transition-colors no-drag rounded',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
          i === selectedIndex ? 'text-white' : 'text-white/80 hover:text-white',
        ].join(' '),
      }, renderLabel(item)),
    ]).flat().filter(Boolean));
}

module.exports = { HeroTabs };
