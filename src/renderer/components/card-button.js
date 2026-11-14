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
// onContextMenu, className, style, children, and anything else for the root
// (draggable, onDragStart, onMouseEnter, ...), and a ref, which lands on the
// root. Props-driven; no hooks. React must be global when it loads (as for
// ui-atoms' React.memo).

function renderCardButton({ label, current, tooltip, onActivate, onContextMenu, className, style, children, ...rest }, ref) {
  const e = React.createElement;
  const openMenu = (ev) => {
    if (!onContextMenu) return;
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      onContextMenu(ev);
    }
  };
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
  }));
}

// forwardRef: rows hand CardButton a ref (the resolution scheduler's
// visibility observer, the queue's virtualizer measuring rows). A plain
// function component drops a ref, which left every track row unobserved, so
// playlists, Collection, Search, albums and History stopped resolving.
const CardButton = React.forwardRef(renderCardButton);
CardButton.displayName = 'CardButton';

module.exports = { CardButton };
