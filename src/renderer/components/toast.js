// src/renderer/components/toast.js: the app's toast (#1385 step 4).
//
// ToastRegion is always mounted, so screen readers hear each toast: it's a
// polite live region, and an error toast inside it is role="alert" (read at
// once). The toast shows its severity with an icon as well as its colour
// (lib/toast-style.js), offers its action as a button, and a persistent
// toast gets a close button since it never times out. It sits on
// --z-toast, above dialogs.
//
// NowPlayingAnnouncer is a visually hidden live region that says the
// track that started ("Now playing: Title by Artist").
//
// Props-driven; loads under plain Node.

const Icons = require('./icons');
const { toastBackground } = require('../lib/toast-style');

const SEVERITY_ICON = { error: 'AlertTriangle', warning: 'AlertTriangle', warn: 'AlertTriangle', info: 'Info', success: 'Check' };

function ToastRegion({ toast, onAction, onDismiss }) {
  const e = React.createElement;
  const iconName = toast && SEVERITY_ICON[toast.type];
  return e('div', {
    role: 'status',
    'aria-live': 'polite',
    'aria-atomic': 'true',
    className: 'fixed bottom-24 left-1/2 -translate-x-1/2 transform pointer-events-none',
    style: { zIndex: 'var(--z-toast)' },
  },
  toast && e('div', {
    key: `${toast.message}-${toast.type}`,
    role: toast.type === 'error' ? 'alert' : undefined,
    className: 'toast-enter pointer-events-auto flex items-center gap-3',
    style: {
      padding: '12px 16px 12px 20px',
      backgroundColor: toastBackground(toast.type),
      color: 'var(--on-accent)',
      fontSize: '13px',
      fontWeight: 500,
      borderRadius: '10px',
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.2), 0 8px 32px rgba(0, 0, 0, 0.15)',
      maxWidth: 'min(560px, calc(100vw - 32px))',
    },
  },
  iconName && e(Icons[iconName], { className: 'w-4 h-4 flex-shrink-0' }),
  e('span', { style: { minWidth: 0 } }, toast.message),
  toast.action && e('button', {
    type: 'button',
    onClick: onAction,
    className: 'no-drag flex-shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
    style: {
      marginLeft: '4px', padding: '4px 12px', backgroundColor: 'rgba(255, 255, 255, 0.2)',
      border: '1px solid rgba(255, 255, 255, 0.3)', borderRadius: '6px', color: 'inherit',
      fontSize: '12px', fontWeight: 600, cursor: 'pointer',
    },
  }, toast.action.label),
  toast.persistent && e('button', {
    type: 'button',
    'aria-label': 'Dismiss',
    onClick: onDismiss,
    className: 'no-drag flex-shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white',
    style: { padding: '2px', background: 'none', border: 'none', color: 'inherit', opacity: 0.8, cursor: 'pointer' },
  }, e(Icons.X, { className: 'w-4 h-4' }))));
}

function NowPlayingAnnouncer({ track }) {
  const e = React.createElement;
  const text = track && track.title
    ? `Now playing: ${track.title}${track.artist ? ` by ${track.artist}` : ''}`
    : '';
  return e('div', { className: 'sr-only', 'aria-live': 'polite', 'aria-atomic': 'true' }, text);
}

module.exports = { ToastRegion, NowPlayingAnnouncer };
