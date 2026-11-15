// src/renderer/components/keyboard-shortcuts.js: the keyboard shortcuts
// dialog (#1386). Opens with "?" anywhere you aren't typing, and from
// Help › Keyboard Shortcuts (Cmd/Ctrl+/).
//
// SHORTCUT_GROUPS is the list the dialog shows; every entry is a shortcut
// the app really has (main.js menu accelerators, the global keydown handler
// in app.js, Menu and CardButton). tests/renderer/keyboard-shortcuts.test.js
// checks each one against its source, so a shortcut can't be listed here
// after it's gone.
// Props-driven; hooks are qualified; loads under plain Node.

const { Modal } = require('./modal');

// "Mod" is Cmd on a Mac and Ctrl elsewhere.
const SHORTCUT_GROUPS = [
  { title: 'Playback', items: [
    { keys: ['Space'], label: 'Play or pause' },
    { keys: ['Mod', '←'], label: 'Previous track' },
    { keys: ['Mod', '→'], label: 'Next track' },
    { keys: ['Mod', 'S'], label: 'Shuffle on or off' },
  ] },
  { title: 'Go to', items: [
    { keys: ['Mod', 'F'], label: 'Search' },
    { keys: ['Mod', ','], label: 'Settings' },
    { keys: ['Mod', 'N'], label: 'New playlist' },
    { keys: ['Esc'], label: 'Leave Search, or close a dialog or menu' },
  ] },
  { title: 'Lists and menus', items: [
    { keys: ['Shift', 'F10'], label: 'Open the menu for the focused item' },
    { keys: ['↑', '↓'], label: 'Move through a menu' },
    { keys: ['←', '→'], label: 'Move between tabs' },
  ] },
  { title: 'Help', items: [
    { keys: ['?'], label: 'Show this list' },
    { keys: ['Mod', 'Shift', 'L'], label: 'Copy the diagnostic log' },
  ] },
];

const keyLabel = (key, isMac) => (key === 'Mod' ? (isMac ? '⌘' : 'Ctrl') : (key === 'Shift' && isMac ? '⇧' : key));

function KeyboardShortcutsDialog({ open, onClose, isMac = false }) {
  const e = React.createElement;
  if (!open) return null;
  return e(Modal, { open, onClose, title: 'Keyboard shortcuts', size: 'md' },
    e('div', { className: 'grid grid-cols-2', style: { gap: '20px 32px' } },
      SHORTCUT_GROUPS.map((group) => e('section', { key: group.title },
        e('h3', { className: 'text-ink-tertiary uppercase', style: { fontSize: '11px', fontWeight: 600, letterSpacing: '0.05em', marginBottom: '8px' } }, group.title),
        e('dl', { style: { margin: 0 } },
          group.items.map((item) => e('div', { key: item.label, className: 'flex items-center justify-between', style: { gap: '12px', padding: '4px 0' } },
            e('dt', { className: 'text-ink-primary', style: { fontSize: '13px' } }, item.label),
            e('dd', { className: 'flex items-center flex-shrink-0', style: { gap: '4px', margin: 0 } },
              item.keys.map((k) => e('kbd', {
                key: k,
                className: 'text-ink-secondary border border-line bg-surface-inset',
                style: { fontFamily: 'var(--font-sans)', fontSize: '12px', minWidth: '24px', padding: '2px 6px', borderRadius: '6px', textAlign: 'center' },
              }, keyLabel(k, isMac))))
          ))
        )
      ))
    )
  );
}

module.exports = { KeyboardShortcutsDialog, SHORTCUT_GROUPS, keyLabel };
