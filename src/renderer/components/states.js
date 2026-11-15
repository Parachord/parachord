// src/renderer/components/states.js: empty and error states (#1385 step 8).
//
// The audit counted five empty-state layouts and six "retry" layouts
// (Retry / Try Again / Try again, grey or accent buttons, 48px or 64px
// icons, text in three greys). These are the one of each:
//
//   EmptyState  nothing to show yet: an icon in a soft circle, a title, a
//               line saying why or what to do, and optional actions.
//               role="status".
//   ErrorState  a load that failed: a warning icon, a title, the reason,
//               and "Try again" (onRetry) and/or other actions.
//               role="alert".
//
// Props (both): title, body (string or node), icon (an Icons component),
// actions ([{ label, onClick, variant }]), align ('center' | 'start'),
// compact (less padding, for a section rather than a page).
// ErrorState also takes onRetry and retryLabel ("Try again").
// Props-driven; loads under plain Node.

const Icons = require('./icons');
const { Button } = require('./button');

function StateBlock({ role, icon, iconTone, title, body, actions, align = 'center', compact = false }) {
  const e = React.createElement;
  const center = align === 'center';
  const Icon = icon;
  return e('div', {
    role,
    className: `flex flex-col ${center ? 'items-center text-center' : 'items-start text-left'}`,
    style: { gap: '12px', padding: compact ? '24px 16px' : '48px 24px' },
  },
  Icon && e('div', {
    'aria-hidden': 'true',
    className: `flex items-center justify-center rounded-full bg-surface-inset ${iconTone}`,
    style: { width: compact ? '44px' : '56px', height: compact ? '44px' : '56px' },
  }, e(Icon, { className: compact ? 'w-5 h-5' : 'w-6 h-6', strokeWidth: 1.75 })),
  title && e('div', { className: 'text-ink-primary', style: { fontSize: compact ? '14px' : '16px', fontWeight: 600 } }, title),
  body && e('div', { className: 'text-ink-secondary', style: { fontSize: '14px', lineHeight: 1.5, maxWidth: '32rem' } }, body),
  actions && actions.length > 0 && e('div', { className: 'flex flex-wrap gap-2', style: { marginTop: '4px', justifyContent: center ? 'center' : 'flex-start' } },
    actions.map((a, i) => e(Button, { key: a.label || i, variant: a.variant || (i === 0 ? 'primary' : 'secondary'), size: 'sm', onClick: a.onClick }, a.label))));
}

function EmptyState(props) {
  return React.createElement(StateBlock, Object.assign({ role: 'status', icon: Icons.Music, iconTone: 'text-ink-tertiary' }, props));
}

function ErrorState({ onRetry, retryLabel = 'Try again', actions, title = 'Something went wrong', ...rest }) {
  const all = [].concat(actions || [], onRetry ? [{ label: retryLabel, onClick: onRetry, variant: actions && actions.length ? 'secondary' : 'primary' }] : []);
  return React.createElement(StateBlock, Object.assign({ role: 'alert', icon: Icons.AlertTriangle, iconTone: 'text-ink-danger', title, actions: all }, rest));
}

module.exports = { EmptyState, ErrorState };
