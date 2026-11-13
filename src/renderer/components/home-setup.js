// src/renderer/components/home-setup.js: the "Finish setting up · N of M"
// pill on Home and its popover checklist. Props-driven; hooks are qualified
// and the module loads under plain Node.
//
// Done items are checked and struck through. Open items have an action
// button and a × that dismisses them for good. The popover closes on an
// outside click or Escape.

function whatsNewLabel(notes) {
  return notes && notes.version ? `What's new in v${notes.version}` : "What's new";
}

// Accent dot marking unread release notes.
function UnreadDot() {
  return React.createElement('span', {
    role: 'img',
    'aria-label': 'New release notes',
    style: {
      display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0,
      backgroundColor: 'var(--accent-primary)',
    }
  });
}

function HomeSetupButton({ setup, onAction, onDismiss, onOpenWhatsNew }) {
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

  if (!setup) return null;

  const notes = setup.whatsNew || {};
  const pillClass = 'inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors';
  const pillStyle = {
    backgroundColor: 'var(--card-bg)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-default)',
    boxShadow: 'var(--card-shadow)'
  };

  // Nothing left to set up: the pill is the release notes link, no popover.
  if (setup.mode === 'whats-new') {
    return React.createElement('button', {
      type: 'button',
      onClick: () => onOpenWhatsNew && onOpenWhatsNew(),
      className: pillClass,
      style: pillStyle
    }, whatsNewLabel(notes), notes.unread && React.createElement(UnreadDot));
  }

  return React.createElement('div', { ref: rootRef, style: { position: 'relative', display: 'inline-block' } },
    React.createElement('button', {
      type: 'button',
      'aria-expanded': open,
      'aria-haspopup': 'true',
      onClick: () => setOpen((v) => !v),
      className: pillClass,
      style: pillStyle
    }, `Finish setting up · ${setup.done} of ${setup.total}`, notes.unread && React.createElement(UnreadDot)),
    open && React.createElement('div', {
      role: 'dialog',
      'aria-label': 'Finish setting up',
      style: {
        // Anchored right: the pill sits at the right of Home's header.
        position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 30, minWidth: '280px',
        padding: '8px', borderRadius: '10px',
        backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-default)',
        boxShadow: 'var(--card-shadow)'
      }
    },
      React.createElement('button', {
        type: 'button',
        onClick: () => { setOpen(false); onOpenWhatsNew && onOpenWhatsNew(); },
        className: 'flex items-center gap-2 px-2 py-1.5 w-full text-left rounded-md',
        style: { fontSize: '13px', color: 'var(--text-primary)', backgroundColor: 'var(--accent-surface)', border: 'none' }
      },
        React.createElement('span', { className: 'flex-1 min-w-0' }, whatsNewLabel(notes)),
        notes.unread && React.createElement(UnreadDot)
      ),
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
          'aria-label': `Set up ${item.label}`,
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
