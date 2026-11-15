// src/renderer/components/badge.js: the small status pill (a playlist's
// "Hosted", "AI", "Shared", the services it syncs to).
//
// Pages each drew their own: emoji icons, Tailwind palette fills that had no
// dark-mode remap (bg-green-100, bg-pink-100), a service's name guessed from
// two hard-coded ids (anything not Spotify read "Apple Music"), and labels
// that wrapped onto two lines. One pill: 12px semibold, never wraps, an
// optional icon from the shared set.
//
// Props:
//   children   the label
//   tone       'neutral' (default) | 'info' | 'accent' | 'surface' (on a cover)
//   color      a service's colour (its plugin's resolver.color): tints the
//              pill with it instead of a tone
//   icon       an Icons component
//   tooltip    a note (the shared tooltip)
// Props-driven; loads under plain Node.

const TONES = {
  neutral: { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-secondary)' },
  info: { backgroundColor: 'color-mix(in srgb, var(--text-info) 12%, transparent)', color: 'var(--text-info)' },
  accent: { backgroundColor: 'var(--accent-surface)', color: 'var(--accent-primary)' },
  // On a cover: the card's own surface, so it reads over any image.
  surface: { backgroundColor: 'var(--card-bg)', color: 'var(--text-primary)', boxShadow: 'var(--card-shadow)' },
};

function Badge({ children, tone = 'neutral', color, icon: Icon, tooltip }) {
  const e = React.createElement;
  const look = color
    ? { backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)`, color: 'var(--text-primary)' }
    : (TONES[tone] || TONES.neutral);
  return e('span', {
    'data-badge': tone,
    'data-tooltip': tooltip || undefined,
    className: 'inline-flex items-center flex-shrink-0',
    style: Object.assign({
      gap: '4px', padding: '2px 8px', borderRadius: '9999px',
      fontSize: '12px', fontWeight: 600, lineHeight: '16px', whiteSpace: 'nowrap',
    }, look),
  },
    color && e('span', { 'aria-hidden': 'true', style: { width: '8px', height: '8px', borderRadius: '9999px', backgroundColor: color, flexShrink: 0 } }),
    Icon && e(Icon, { size: 12 }),
    children);
}

module.exports = { Badge };
