// src/renderer/components/progress-bar.js: how far along something is (a
// folder scan, a library sync).
//
// Two were hand-built (Local Files' scan in the plug-in settings dialog and
// the sync setup dialog's), each a pair of styled divs with its own height,
// radius and track colour, and neither told a screen reader anything. One
// bar: a 6px rounded track, a fill that eases to its width, and
// role="progressbar" with its value.
//
// Props:
//   value, max   how far along (max 0 draws an empty bar)
//   color        the fill (a service's colour, a CSS variable); defaults to
//                the accent fill
//   label        what's in progress, for screen readers ("Scanning folders")
//   className, style
// Props-driven; loads under plain Node.

const { transition } = require('../lib/motion');

function ProgressBar({ value = 0, max = 100, color, label, className, style }) {
  const e = React.createElement;
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return e('div', {
    role: 'progressbar',
    'aria-label': label,
    'aria-valuemin': 0,
    'aria-valuemax': max,
    'aria-valuenow': value,
    className,
    style: Object.assign({ height: '6px', backgroundColor: 'var(--border-subtle)', borderRadius: '9999px', overflow: 'hidden' }, style),
  },
  e('div', {
    style: {
      height: '100%',
      width: `${pct}%`,
      backgroundColor: color || 'var(--accent-fill)',
      borderRadius: '9999px',
      transition: transition('width', 'slow', 'out'),
    },
  }));
}

module.exports = { ProgressBar };
