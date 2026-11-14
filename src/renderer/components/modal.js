// src/renderer/components/modal.js: the app's dialog shell (#1385 step 2).
//
// One shell for every dialog, so each gets the same behaviour and look
// (the audit counted 23 hand-built shells, six title sizes and five close
// buttons, and none had a role, Escape or focus handling):
//   - role="dialog" (or "alertdialog"), aria-modal, labelled by its title
//     and described by its description
//   - focus moves in on open, is trapped while open, and returns to whatever
//     had it on close
//   - Escape and a click on the scrim close it, unless dismissible={false}
//   - one scrim, one close X, one title size, one radius, three widths
//
// Props:
//   open, onClose, title, description (string or node), children (body),
//   footer (buttons, laid out right-aligned), icon (node shown before the
//   title), size 'sm' | 'md' | 'lg', dismissible (default true),
//   role 'dialog' | 'alertdialog', initialFocus (a ref to focus first),
//   hideClose (no X; a footer button must close it), className.
//
// Bare mode (bare: true) is for a dialog that keeps its own layout while it
// moves over: Modal supplies the scrim, role, labelling (label: an
// aria-label), focus handling and Escape, and renders children straight
// into a panel built from panelProps (its own className and style). The
// title, close button and footer stay the dialog's own until it's redone.
// scrimClassName replaces the scrim's z-index class (default z-[60]).
//
// ConfirmModal is the confirm dialog on top of it. Props-driven; hooks are
// qualified; loads under plain Node.

const Icons = require('./icons');
const { Button } = require('./button');

const WIDTHS = { sm: '380px', md: '480px', lg: '640px' };
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusables(root) {
  if (!root) return [];
  return Array.from(root.querySelectorAll(FOCUSABLE)).filter((el) => !el.hasAttribute('inert') && el.offsetParent !== null);
}

// Focus in, trap, Escape, return. Exported for the dialogs that can't use
// the shell yet.
function useDialogFocus(open, panelRef, { onClose, dismissible = true, initialFocus } = {}) {
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  React.useEffect(() => {
    if (!open) return undefined;
    const doc = globalThis.document;
    if (!doc) return undefined;
    const opener = doc.activeElement;
    const panel = panelRef.current;
    const first = (initialFocus && initialFocus.current) || focusables(panel)[0] || panel;
    if (first && first.focus) first.focus();
    const onKey = (ev) => {
      if (ev.key === 'Escape' && dismissible) {
        ev.stopPropagation();
        if (closeRef.current) closeRef.current();
        return;
      }
      if (ev.key !== 'Tab' || !panel) return;
      const items = focusables(panel);
      if (items.length === 0) { ev.preventDefault(); return; }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (ev.shiftKey && (doc.activeElement === firstEl || !panel.contains(doc.activeElement))) {
        ev.preventDefault(); lastEl.focus();
      } else if (!ev.shiftKey && doc.activeElement === lastEl) {
        ev.preventDefault(); firstEl.focus();
      }
    };
    doc.addEventListener('keydown', onKey, true);
    return () => {
      doc.removeEventListener('keydown', onKey, true);
      if (opener && opener.focus && doc.contains(opener)) opener.focus();
    };
  }, [open, dismissible]);
}

function Modal(props) {
  const {
    open = true, onClose, title, description, children, footer, icon, size = 'md',
    dismissible = true, role = 'dialog', initialFocus, hideClose = false, className,
    bare = false, label, panelProps, scrimClassName,
  } = props;
  const panelRef = React.useRef(null);
  const id = React.useId();
  useDialogFocus(open, panelRef, { onClose, dismissible, initialFocus });
  if (!open) return null;
  const e = React.createElement;
  const scrim = (panel) => e('div', {
    className: `modal-scrim fixed inset-0 ${scrimClassName || 'z-[60]'} flex items-center justify-center p-4`,
    onMouseDown: (ev) => { if (dismissible && ev.target === ev.currentTarget && onClose) onClose(); },
  }, panel);
  if (bare) {
    const pp = panelProps || {};
    return scrim(e('div', Object.assign({}, pp, {
      ref: panelRef, role, 'aria-modal': 'true', 'aria-label': label, tabIndex: -1,
      className: ['modal-panel', pp.className].filter(Boolean).join(' '),
      style: Object.assign({ outline: 'none' }, pp.style),
    }), children));
  }
  const titleId = `${id}-title`;
  const descId = description ? `${id}-desc` : undefined;
  return scrim(
  e('div', {
    ref: panelRef,
    role,
    'aria-modal': 'true',
    'aria-labelledby': title ? titleId : undefined,
    'aria-describedby': descId,
    tabIndex: -1,
    className: ['modal-panel bg-surface-card text-ink-primary w-full flex flex-col', className].filter(Boolean).join(' '),
    style: { maxWidth: WIDTHS[size] || WIDTHS.md, maxHeight: 'calc(100vh - 32px)', borderRadius: '16px', boxShadow: 'var(--shadow-lg)', outline: 'none' },
  },
  (title || !hideClose) && e('div', { className: 'flex items-start gap-3', style: { padding: '20px 20px 0 24px' } },
    icon && e('div', { className: 'flex-shrink-0', style: { marginTop: '2px' } }, icon),
    e('h2', { id: titleId, className: 'flex-1 min-w-0', style: { margin: 0, fontSize: '20px', fontWeight: 600, lineHeight: 1.3 } }, title),
    !hideClose && e(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Close', onClick: onClose, className: '-mt-1 -mr-1' },
      e(Icons.X, { className: 'w-5 h-5' }))),
  e('div', { className: 'flex-1 overflow-y-auto', style: { padding: '12px 24px 20px' } },
    description && e('div', { id: descId, className: 'text-ink-secondary', style: { fontSize: '14px', lineHeight: 1.5, whiteSpace: 'pre-line', overflowWrap: 'anywhere', userSelect: 'text' } }, description),
    children),
  footer && e('div', { className: 'flex items-center justify-end gap-2 flex-wrap', style: { padding: '0 24px 24px' } }, footer)));
}

const TYPE_ICON = {
  success: ['Check', 'var(--text-success)'],
  error: ['AlertTriangle', 'var(--text-danger)'],
  info: ['Info', 'var(--accent-primary)'],
};

/**
 * The confirm dialog: the app's showConfirmDialog(options) state, on Modal.
 *
 *   type          'info' | 'error' | 'success' (sets the icon)
 *   title, message
 *   onConfirm     runs on the confirm button, then the dialog closes
 *   confirmLabel  names the action; 'OK' when nothing else is offered
 *   cancelLabel   shows a Cancel button (also shown for destructive)
 *   destructive   the confirm button is the destructive fill
 *   actionButton  { label, onClick }: a fix for the problem. It becomes the
 *                 primary button and the confirm button turns secondary.
 *
 * An error that isn't destructive gets a neutral button: a red OK read as
 * "something will be deleted".
 */
function ConfirmModal({ dialog, onClose }) {
  const e = React.createElement;
  if (!dialog || !dialog.show) return null;
  const { type = 'info', title, message, onConfirm, onCancel, confirmLabel, cancelLabel, destructive, actionButton } = dialog;
  const [iconName, color] = TYPE_ICON[type] || TYPE_ICON.info;
  // Any way out that isn't the confirm button is a cancel (onCancel lets
  // confirmAsync resolve false).
  const cancel = () => { if (onCancel) onCancel(); onClose(); };
  const confirm = () => { if (onConfirm) onConfirm(); onClose(); };
  const fix = actionButton && (() => { const fn = actionButton.onClick; cancel(); if (fn) fn(); });
  const showCancel = !!(cancelLabel || destructive);
  const footer = [
    showCancel && e(Button, { key: 'cancel', variant: 'secondary', onClick: cancel }, cancelLabel || 'Cancel'),
    e(Button, {
      key: 'confirm',
      variant: destructive ? 'destructive' : (actionButton ? 'secondary' : 'primary'),
      onClick: confirm,
    }, confirmLabel || 'OK'),
    fix && e(Button, { key: 'fix', variant: 'primary', onClick: fix }, actionButton.label || 'Fix'),
  ].filter(Boolean);
  return e(Modal, {
    open: true,
    onClose: cancel,
    title,
    description: message,
    size: 'sm',
    role: destructive || type === 'error' ? 'alertdialog' : 'dialog',
    icon: e(Icons[iconName], { className: 'w-6 h-6', style: { color } }),
    footer,
  });
}

module.exports = { Modal, ConfirmModal, useDialogFocus, MODAL_WIDTHS: WIDTHS };
