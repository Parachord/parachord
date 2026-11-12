// src/renderer/components/home-setup.js — the "Finish setting up · N of M"
// pill on Home and its popover checklist. Props-driven; hooks are qualified
// and the module loads under plain Node.
//
// Done items are checked and struck through. Open items have an action
// button and a × that dismisses them for good. The popover closes on an
// outside click or Escape.

function HomeSetupButton({ setup, onAction, onDismiss }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef(null);

  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!setup || !setup.visible) return null;

  return React.createElement('div', { ref: rootRef, style: { position: 'relative', display: 'inline-block' } },
    React.createElement('button', {
      type: 'button',
      'aria-expanded': open,
      'aria-haspopup': 'true',
      onClick: () => setOpen((v) => !v),
      className: 'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
      style: {
        backgroundColor: 'var(--card-bg)',
        color: 'var(--text-primary)',
        border: '1px solid var(--border-default)',
        boxShadow: 'var(--card-shadow)'
      }
    }, `Finish setting up · ${setup.done} of ${setup.total}`),
    open && React.createElement('div', {
      role: 'dialog',
      'aria-label': 'Finish setting up',
      style: {
        position: 'absolute', top: 'calc(100% + 6px)', left: 0, zIndex: 30, minWidth: '280px',
        padding: '8px', borderRadius: '10px',
        backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-default)',
        boxShadow: 'var(--card-shadow)'
      }
    },
      setup.items.map((item) => React.createElement('div', {
        key: item.id,
        className: 'flex items-center gap-2 px-2 py-1.5',
        style: { fontSize: '13px' }
      },
        React.createElement('span', {
          'aria-hidden': 'true',
          style: { width: '16px', flexShrink: 0, color: item.done ? 'var(--accent-primary)' : 'var(--text-secondary)' }
        }, item.done ? '✓' : '○'),
        React.createElement('span', {
          className: 'flex-1 min-w-0',
          style: {
            color: item.done ? 'var(--text-secondary)' : 'var(--text-primary)',
            textDecoration: item.done ? 'line-through' : 'none'
          }
        }, item.label),
        !item.done && React.createElement('button', {
          type: 'button',
          onClick: () => { setOpen(false); onAction && onAction(item.action); },
          className: 'px-2 py-0.5 rounded-md text-xs font-medium',
          style: { border: '1px solid var(--border-default)', color: 'var(--text-primary)', backgroundColor: 'transparent' }
        }, 'Set up'),
        !item.done && React.createElement('button', {
          type: 'button',
          'aria-label': `Dismiss ${item.label}`,
          onClick: () => onDismiss && onDismiss(item.id),
          className: 'px-1 text-base leading-none',
          style: { color: 'var(--text-secondary)', background: 'none', border: 'none' }
        }, '×')
      ))
    )
  );
}

module.exports = { HomeSetupButton };
