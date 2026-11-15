// src/renderer/lib/toast-style.js: a toast's fill for its type.
//
// Errors, warnings and info take the Home banner's severity fills
// (lib/home-banners.js), so a warning or an error is the same colour
// wherever it shows; each has at least 4.5:1 contrast with the toast's white
// text. Everything else is neutral, 'success' included: most toasts are
// routine feedback ("Added 12 tracks", "Copied to clipboard"), and a green
// flash for each would make the rare warning harder to notice.
//
// Loads under plain Node.

const { BANNER_SEVERITY_COLORS } = require('./home-banners');

const NEUTRAL = 'var(--tooltip-bg)';

function toastBackground(type) {
  if (type === 'error') return BANNER_SEVERITY_COLORS.error;
  if (type === 'warning' || type === 'warn') return BANNER_SEVERITY_COLORS.warn;
  if (type === 'info') return BANNER_SEVERITY_COLORS.info;
  return NEUTRAL;
}

module.exports = { toastBackground };
