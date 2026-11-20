// src/renderer/components/collection-radio-button.js: "Play Collection
// Radio", the button that starts a station from the Collection. Home's
// greeting and the Collection page (its hero and its collapsed header) use it.
//
// Collection had its own two (a pink, then cyan, "Start Collection Radio"
// pill and a smaller "Start Radio"); this is Home's: the accent fill with a
// round Play mark and the label.
//
// Props:
//   onClick   starts the station
//   compact   true: the smaller one for a collapsed header ("Play Radio")
// Props-driven; loads under plain Node.

const Icons = require('./icons');

const FILL = 'var(--accent-fill)';
const ON_FILL = 'var(--on-accent)';

function CollectionRadioButton({ onClick, compact = false }) {
  const e = React.createElement;
  const mark = compact ? 22 : 28;
  return e('button', {
    type: 'button',
    className: 'no-drag transition-[filter] hover:brightness-110',
    onClick,
    style: {
      font: 'inherit', fontSize: compact ? '13px' : '14px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
      display: 'flex', alignItems: 'center', gap: '8px',
      padding: compact ? '4px 12px 4px 4px' : '6px 16px 6px 6px', minHeight: compact ? '30px' : '40px',
      backgroundColor: FILL, color: ON_FILL, whiteSpace: 'nowrap',
    },
  },
    e('span', {
      'aria-hidden': 'true',
      style: {
        width: `${mark}px`, height: `${mark}px`, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: ON_FILL, color: FILL, flexShrink: 0,
      },
    },
      e(Icons.Play, { size: compact ? 10 : 12, strokeWidth: 0 })),
    compact ? 'Play Radio' : 'Play Collection Radio');
}

module.exports = { CollectionRadioButton };
