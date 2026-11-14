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
// Props: label (the card's name, read by screen readers), onActivate,
// onContextMenu, className, style, children, and anything else for the root
// (draggable, onDragStart, onMouseEnter, ...). Props-driven; no hooks;
// loads under plain Node.

function CardButton({ label, onActivate, onContextMenu, className, style, children, ...rest }) {
  const e = React.createElement;
  const openMenu = (ev) => {
    if (!onContextMenu) return;
    if (ev.key === 'ContextMenu' || (ev.shiftKey && ev.key === 'F10')) {
      ev.preventDefault();
      onContextMenu(ev);
    }
  };
  return e('div', Object.assign({}, rest, {
    className: ['card-button', className].filter(Boolean).join(' '),
    style: Object.assign({ position: 'relative' }, style),
    onContextMenu,
  }),
  children,
  e('button', {
    type: 'button',
    className: 'card-button-hit no-drag',
    'aria-label': label,
    onClick: onActivate,
    onKeyDown: openMenu,
  }));
}

module.exports = { CardButton };
