// src/renderer/components/header-control.js: the small uppercase controls
// in a page's header bar and the queue drawer's (#1385): Close, Edit,
// Cancel, Done, Save, Refresh, Unshuffle, Clear.
//
// Each was built by hand: four border colours, two radii, JS hover, and
// labels typed in capitals. One look now, in index.html (.header-control):
// 12px, CSS uppercase (the label stays sentence case in the source), a thin
// outline, hover in CSS.
//
// Props: children (the label and any icon), tone 'default' | 'primary' (the
// fill accent: Done, Save) | 'dark' (the always-dark queue drawer), close
// (adds the X after the label), and anything else for the <button>
// (onClick, disabled, data-tooltip, aria-*). Props-driven; no hooks; loads
// under plain Node.

const Icons = require('./icons');

function HeaderControl({ tone = 'default', close = false, className, children, ...rest }) {
  const e = React.createElement;
  return e('button', Object.assign({ type: 'button' }, rest, {
    className: ['header-control no-drag', tone !== 'default' ? `header-control-${tone}` : '', className].filter(Boolean).join(' '),
  }),
  children,
  close && e(Icons.X, { size: 12, className: 'header-control-x' }));
}

module.exports = { HeaderControl };
