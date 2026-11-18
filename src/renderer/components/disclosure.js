// src/renderer/components/disclosure.js: a section that opens and closes,
// such as a plug-in's "Advanced" settings (#1498 step 3).
//
// Five copies were hand-built in the plug-in settings dialog, each a raw
// <button> with its own chevron and padding, outside Button. This is the one:
// a text Button with a chevron that turns, aria-expanded and aria-controls,
// over a grey panel that holds what it reveals.
//
// Controlled: the caller owns `open` (the dialog keeps it in app state, so a
// section stays open across re-renders) and flips it in `onToggle`.
//
// Props: label ("Advanced"), open, onToggle(), children.
//   alwaysOpen  show the panel with no toggle: what's inside is required
//               before anything else works (SoundCloud's client ID and
//               secret, before its sign-in), so it isn't hidden behind a
//               click. Once set, the caller drops it and the section folds.
// Props-driven; hooks are qualified; loads under plain Node.

const Icons = require('./icons');
const { Button } = require('./button');
const { transition } = require('../lib/motion');

function Disclosure({ label = 'Advanced', open = false, onToggle, alwaysOpen = false, children }) {
  const e = React.createElement;
  const panelId = `${React.useId()}-panel`;
  if (alwaysOpen) {
    return e('div', {
      id: panelId,
      style: { marginTop: '16px', padding: '12px', backgroundColor: 'var(--hover-bg-default)', borderRadius: '8px' },
    }, children);
  }
  return e('div', { style: { marginTop: '16px' } },
    e(Button, {
      variant: 'text',
      size: 'sm',
      onClick: onToggle,
      'aria-expanded': open ? 'true' : 'false',
      'aria-controls': panelId,
    },
    e(Icons.ChevronRight, {
      className: 'w-4 h-4',
      style: { transform: open ? 'rotate(90deg)' : 'none', transition: transition('transform', 'fast') },
    }),
    label),
    open && e('div', {
      id: panelId,
      style: { marginTop: '12px', padding: '12px', backgroundColor: 'var(--hover-bg-default)', borderRadius: '8px' },
    }, children));
}

module.exports = { Disclosure };
