// src/renderer/components/card-button.js: a clickable card (#1385, the
// CardButton component).
//
// About 80 cards and rows were divs with onClick (made reachable later with
// role="button" and lib/activate-on-key.js), and Collection's album card was
// a <button> holding three more buttons, which HTML doesn't allow. A card
// can't simply be a <button>: it holds its own actions (Play, Add to queue).
// So CardButton is the accessible-card pattern:
//   - the root is a plain container: drag, hover prefetch and right-click
//     wiring go on it as before;
//   - its main action is a real <button> (aria-label = the card's name),
//     stretched over the whole card, so a click anywhere opens it and Tab
//     reaches it, with a focus ring;
//   - the card's own actions sit above that button: give their container
//     the class "card-actions" (index.html). They show on hover AND when
//     anything in the card has keyboard focus, and pass clicks through when
//     they are hidden;
//   - "card-zoom" on the cover scales it on hover, the app's art zoom;
//   - Shift+F10 or the Menu key on the card opens the same menu as a
//     right-click (onContextMenu gets the keyboard event).
//
// Props: label (the card's name, read by screen readers), current (the
// playing row: aria-current on its button, so a screen reader says so),
// tooltip (a note for the whole card, on the stretched button), onActivate,
// onContextMenu, more ("More actions for X": adds the visible More button
// that opens onContextMenu; rows opt in), moreTone ('dark' on the queue),
// className, style, children, and anything else for the root
// (draggable, onDragStart, onMouseEnter, ...), and a ref, which lands on the
// root. Props-driven; no hooks. React must be global when it loads (as for
// ui-atoms' React.memo).

const { Button } = require('./button');
const Icons = require('./icons');

// A keydown handler that opens onContextMenu on Shift+F10 or the Menu key
// (Chromium on macOS fires no contextmenu event for them). Shared with any
// control that has a right-click menu but isn't a CardButton (the plug-in
// tiles).
function menuKeyHandler(onContextMenu) {
  return (ev) => {
    if (!onContextMenu) return;
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      onContextMenu(ev);
    }
  };
}

function renderCardButton({ label, current, tooltip, onActivate, onContextMenu, more, moreTone, className, style, children, ...rest }, ref) {
  const e = React.createElement;
  const openMenu = menuKeyHandler(onContextMenu);
  // The visible "More" button (#1386): a row's right-click menu, for anyone
  // who doesn't right-click. Opt-in (`more` is its accessible name, "More
  // actions for X"); the last item in the row's own flex layout, so it holds
  // a slot instead of covering the duration; shown on hover or keyboard focus.
  const moreButton = more && onContextMenu
    ? e('div', { className: 'card-actions card-more flex-shrink-0', style: { position: 'relative' } },
      e(Button, {
        variant: 'icon', size: 'sm', tone: moreTone, 'aria-label': more, 'data-tooltip': 'More',
        onClick: (ev) => { ev.stopPropagation(); onContextMenu(ev); },
      }, e(Icons.MoreHorizontal, { className: 'w-4 h-4' })))
    : null;
  return e('div', Object.assign({}, rest, {
    ref,
    className: ['card-button', className].filter(Boolean).join(' '),
    style: Object.assign({ position: 'relative' }, style),
    onContextMenu,
  }),
  children,
  e('button', {
    type: 'button',
    // A draggable card (a track, an album) drags from its button too: the
    // drag starts on the button and bubbles to the card's onDragStart, so it
    // never depends on the engine starting a drag from a button child.
    draggable: rest.draggable ? true : undefined,
    className: 'card-button-hit no-drag',
    'aria-label': label,
    'aria-current': current ? 'true' : undefined,
    // A note about the whole card (why it was recommended), shown by the
    // shared tooltip on hover or keyboard focus.
    'data-tooltip': tooltip || undefined,
    'data-tooltip-position': tooltip ? 'bottom' : undefined,
    onClick: onActivate,
    onKeyDown: openMenu,
  }),
  // After the stretched button: Tab reaches the row, then its More.
  moreButton);
}

// forwardRef: rows hand CardButton a ref (the resolution scheduler's
// visibility observer, the queue's virtualizer measuring rows). A plain
// function component drops a ref, which left every track row unobserved, so
// playlists, Collection, Search, albums and History stopped resolving.
const CardButton = React.forwardRef(renderCardButton);
CardButton.displayName = 'CardButton';

module.exports = { CardButton, menuKeyHandler };
