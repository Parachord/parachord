// src/renderer/lib/status-badge.js: the colours of a small on/off status
// badge (Settings > Dialogs' "Showing" / "Hidden").
//
// Both read theme tokens, so they work in light and dark mode. "On" is the
// success text colour on a faint tint of itself; "off" is quiet, secondary
// text in an outline, since a hidden prompt is a choice, not a warning. The
// old pastel fills (green-100 / amber-100) glared on dark surfaces.
//
// Loads under plain Node.

function statusBadgeStyle(on) {
  if (on) {
    return {
      color: 'var(--text-success)',
      backgroundColor: 'color-mix(in srgb, var(--text-success) 14%, transparent)',
      border: '1px solid transparent',
    };
  }
  return {
    color: 'var(--text-secondary)',
    backgroundColor: 'transparent',
    border: '1px solid var(--border-default)',
  };
}

module.exports = { statusBadgeStyle };
