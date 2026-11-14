// src/renderer/components/reason-badge.js: the round badge in a cover's
// lower right corner that says why an item is there (Shuffleupagus's reason,
// a Critical Darlings review summary). Home's album cards had it; the
// Recommendations page's album and artist cards use the same one.
//
// Props: label (the button's name, "Why Shuffleupagus picked this"), text
// (the reason: the tooltip, and a visually hidden copy the button points
// aria-describedby at, so a screen reader always has it), icon (defaults to
// Shuffleupagus's). The caller's art box must be position: relative.
// Props-driven; hooks are qualified; loads under plain Node.

const { FixedTooltip, SERVICE_LOGOS } = require('./ui-atoms');

// Drawn over album art: the same in both themes.
const BADGE_BG = 'rgba(255,255,255,.94)'; // on-art
const BADGE_FG = '#111827'; // on-art

// Read by screen readers, not drawn.
const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

// Shuffleupagus's icon from the shared logo set, sized to 18px.
const shuffleupagusIcon = () => (SERVICE_LOGOS && SERVICE_LOGOS.shuffleupagus
  ? React.cloneElement(SERVICE_LOGOS.shuffleupagus, { className: undefined, width: 18, height: 18, 'aria-hidden': 'true' })
  : null);

// The badge's disc on its own, for a heading or label that should read as
// the same thing as the badges (Home's "Ask Shuffleupagus" box). Not a
// control: decorative, hidden from screen readers, with an outline so the
// white disc shows on a light surface.
function ReasonMark({ icon, size = 26 }) {
  return React.createElement('span', {
    'aria-hidden': 'true',
    style: {
      width: `${size}px`, height: `${size}px`, borderRadius: '50%', flexShrink: 0,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      backgroundColor: BADGE_BG, color: BADGE_FG, border: '1px solid var(--border-default)',
      boxSizing: 'border-box',
    },
  }, icon === undefined ? shuffleupagusIcon() : icon);
}

function ReasonBadge({ label, text, icon }) {
  const e = React.createElement;
  const id = React.useId();
  if (!text) return null;
  return e('div', {
    style: { position: 'absolute', bottom: '8px', right: '8px', zIndex: 2 },
  },
  e('span', { id: `${id}-why`, style: VISUALLY_HIDDEN }, text),
  e(FixedTooltip, { content: text, id: `${id}-tip` },
    e('button', {
      type: 'button', 'aria-label': label, 'aria-describedby': `${id}-why`,
      // The badge is on a clickable card: clicking it explains, it doesn't
      // open the card.
      onClick: (ev) => ev.stopPropagation(),
      style: {
        width: '26px', height: '26px', borderRadius: '50%', border: 'none', padding: 0, cursor: 'help',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: BADGE_BG, color: BADGE_FG,
      },
    }, icon === undefined ? shuffleupagusIcon() : icon)));
}

// The badge for a Shuffleupagus pick, or null: an item Shuffleupagus sent
// (its own section, or a merged item whose sources include it).
function shuffleupagusBadgeProps(item) {
  if (!item) return null;
  const fromShuffleupagus = item.resolverId === 'shuffleupagus'
    || (Array.isArray(item.sourceIds) && item.sourceIds.includes('shuffleupagus'));
  if (!fromShuffleupagus) return null;
  return { label: 'Why Shuffleupagus picked this', text: item.reason || 'Picked by Shuffleupagus' };
}

module.exports = { ReasonBadge, ReasonMark, shuffleupagusBadgeProps, shuffleupagusIcon, VISUALLY_HIDDEN };
