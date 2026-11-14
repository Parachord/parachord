// src/renderer/components/button.js: the app's button (#1385 step 1).
//
// One component for every text and icon button, so a primary action looks
// the same on every page (the audit counted about seven primary colours and
// eight Cancel looks).
//
//   variant  'primary' (the fill accent, white text) | 'secondary' (outline)
//            | 'destructive' (the error fill) | 'text' (accent text) |
//            'icon' (square, needs an aria-label)
//   size     'sm' | 'md' (default)
//   busy     shows a spinner, keeps the width, sets aria-busy and disables
//   pageColor  a page's white-text fill (PAGE_COLORS[view].fill) for a
//            primary button that takes its page's colour
//   tone     'dark' on the always-dark surfaces (playbar, queue, AI panels)
//
// Any other prop (onClick, title, aria-*, data-*, type, ...) goes to the
// <button>. Props-driven; loads under plain Node.

const Icons = require('./icons');

const BASE = 'inline-flex items-center justify-center gap-2 font-medium rounded-lg transition-colors no-drag select-none '
  + 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page '
  + 'active:translate-y-px disabled:opacity-50 disabled:cursor-not-allowed disabled:active:translate-y-0';

const VARIANTS = {
  primary: 'bg-accent-fill text-ink-on-accent hover:bg-accent-fill-hover',
  secondary: 'bg-surface-card text-ink-primary border border-line hover:bg-surface-hover hover:border-line-strong',
  destructive: 'bg-status-error text-ink-on-accent hover:bg-status-error-hover',
  text: 'text-accent hover:bg-accent-tint',
  icon: 'text-ink-secondary hover:text-ink-primary hover:bg-surface-hover',
};

const DARK = {
  primary: VARIANTS.primary,
  secondary: 'bg-white/5 text-white border border-white/15 hover:bg-white/10',
  destructive: VARIANTS.destructive,
  text: 'text-white/80 hover:text-white hover:bg-white/10',
  icon: 'text-white/70 hover:text-white hover:bg-white/10',
};

const SIZES = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
};
const ICON_SIZES = { sm: 'w-8 h-8', md: 'w-9 h-9' };

function buttonClassName({ variant = 'primary', size = 'md', tone, className } = {}) {
  const look = (tone === 'dark' ? DARK : VARIANTS)[variant] || VARIANTS.primary;
  const box = variant === 'icon' ? ICON_SIZES[size] || ICON_SIZES.md : SIZES[size] || SIZES.md;
  return [BASE, look, box, className].filter(Boolean).join(' ');
}

function Button(props) {
  const {
    variant = 'primary', size = 'md', busy = false, disabled = false, pageColor, tone,
    className, style, children, type = 'button', ...rest
  } = props;
  if (variant === 'icon' && !rest['aria-label']) {
    // An icon-only button with no name is invisible to a screen reader.
    console.error('[Button] variant="icon" needs an aria-label');
  }
  const e = React.createElement;
  const fill = pageColor && variant === 'primary' ? { backgroundColor: pageColor } : null;
  return e('button', Object.assign({}, rest, {
    type,
    disabled: disabled || busy,
    'aria-busy': busy ? 'true' : undefined,
    className: buttonClassName({ variant, size, tone, className }),
    style: fill || style ? Object.assign({}, fill, style) : undefined,
  }),
  busy && e(Icons.Spinner, { className: variant === 'icon' ? 'w-4 h-4' : 'w-4 h-4 -ml-0.5' }),
  busy && variant === 'icon' ? null : children);
}

module.exports = { Button, buttonClassName, BUTTON_VARIANTS: Object.keys(VARIANTS) };
