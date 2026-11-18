// src/renderer/components/filter-chips.js: the app's filter buttons, a row
// of chips where one is picked (a source, a release type, a category). Home's
// source filter style (#1361), shared so every page's filters look alike;
// change it here, never in a copy. Tabs, sort dropdowns and search boxes are
// other elements.
//
// Props-driven; no hooks, and React is read at render, so the module loads
// under plain Node.

const { readableTextOn } = require('../lib/readable-text');
const Icons = require('./icons');

// The selected fill of a chip with no colour of its own (All, a category):
// the sidebar's accent. Fixed, because the accent variable turns light purple
// in dark mode. Its text is white.
const CHIP_NEUTRAL_FILL = 'var(--accent-fill)'; // fill-accent
const CHIP_NEUTRAL_TEXT = 'var(--on-accent)'; // on-color

const FILTER_CHIPS_ROW_STYLE = { display: 'flex', flexWrap: 'wrap', gap: '8px' };
const FILTER_CHIP_STYLE = {
  font: 'inherit', fontSize: '12px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
  padding: '8px 12px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px',
};
const FILTER_CHIP_DOT_STYLE = { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0 };

/**
 * `chips` are `{ id, label, color?, gradient? }`. A chip with a `color` (a
 * service's brand, a release type's colour) shows a dot in it when idle and
 * fills with it when picked, its text whichever of white or near-black reads
 * better on it; `gradient` (a CSS gradient) paints over that fill and the dot.
 * A chip without one (All, a category) stays neutral: the page's grey when
 * idle, and when picked the accent, or `pageColor` (the page's colour from
 * lib/page-colors.js, the same as its hero) on a page with its own colour.
 *
 * `value` is the picked chip's id; `onChange(id)` picks one. `label` names
 * the group for screen readers.
 */
function FilterChips({ chips, value, onChange, label, style, pageColor }) {
  const e = React.createElement;
  return e('div', { role: 'group', 'aria-label': label || 'Filter', style: Object.assign({}, FILTER_CHIPS_ROW_STYLE, style) },
    (chips || []).map((c) => {
      const on = c.id === value;
      const brand = c.color || null;
      return e('button', {
        key: c.id, type: 'button', 'aria-pressed': on, className: 'no-drag', onClick: () => onChange && onChange(c.id),
        style: Object.assign({}, FILTER_CHIP_STYLE, {
          backgroundColor: on ? (brand || pageColor || CHIP_NEUTRAL_FILL) : 'var(--bg-secondary)',
          backgroundImage: on && c.gradient ? c.gradient : undefined,
          color: on ? (brand ? readableTextOn(brand) : CHIP_NEUTRAL_TEXT) : 'var(--text-primary)',
        }),
      },
      brand && !on && e('span', {
        'aria-hidden': 'true', 'data-chip-dot': '',
        style: Object.assign({}, FILTER_CHIP_DOT_STYLE, { backgroundColor: brand, backgroundImage: c.gradient || undefined }),
      }),
      c.label);
    }));
}

/**
 * One action chip in the filter chips' style: a search suggestion, an active
 * location. Not a pick-one filter (that is FilterChips). `icon` is a node
 * before the label (an Icons component or a small image); `fill` and `color`
 * tint it (a page's colour), else it is the idle chip's grey. `onRemove`
 * adds a ✕ that clears it, as its own button BESIDE the chip's (a button
 * can't hold a button), named by `removeLabel`.
 */
function Chip({ label, icon, onClick, onRemove, removeLabel, fill, color, tooltip, children }) {
  const e = React.createElement;
  const tone = { backgroundColor: fill || 'var(--bg-secondary)', color: color || 'var(--text-primary)' };
  const main = e('button', {
    type: 'button', className: 'no-drag', onClick, 'data-tooltip': tooltip,
    style: Object.assign({}, FILTER_CHIP_STYLE, tone, onRemove ? { paddingRight: '4px', background: 'none', color: 'inherit' } : null),
  }, icon, e('span', { className: 'truncate', style: { maxWidth: '200px' } }, label), children);
  if (!onRemove) return main;
  return e('span', { className: 'inline-flex items-center', style: Object.assign({ borderRadius: '999px' }, tone) },
    main,
    e('button', {
      type: 'button', className: 'no-drag', 'aria-label': removeLabel || `Clear ${label}`, 'data-tooltip': removeLabel || 'Clear',
      onClick: (ev) => { ev.stopPropagation(); onRemove(); },
      style: { border: 'none', background: 'none', color: 'inherit', cursor: 'pointer', padding: '8px 10px 8px 4px', display: 'inline-flex', borderRadius: '999px' },
    }, e(Icons.X, { className: 'w-4 h-4' })));
}

module.exports = {
  FilterChips, Chip, CHIP_NEUTRAL_FILL, CHIP_NEUTRAL_TEXT, FILTER_CHIPS_ROW_STYLE, FILTER_CHIP_STYLE, FILTER_CHIP_DOT_STYLE,
};
