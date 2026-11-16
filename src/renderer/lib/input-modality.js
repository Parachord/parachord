// src/renderer/lib/input-modality.js: was the last input the pointer or the
// keyboard? Sets <html data-input="pointer" | "keyboard">, and index.html
// hides every focus ring while it's "pointer".
//
// :focus-visible is the browser's guess, and Chromium guesses "keyboard"
// whenever code moves focus after a click on something that can't hold
// focus: a dialog opened from a card, a menu opened by right-clicking the
// page title, the Add to playlist panel. Each then lit its first control's
// purple ring for a mouse user. Rings are for keyboard use, so the page
// says which input came last, and the ring rules follow it (one rule, every
// component). A modifier key alone (Shift, Cmd...) doesn't count: it's the
// start of a shortcut or a modified click.
// Loads under plain Node (install is a no-op without a document).

const MODIFIERS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'Fn']);

function modalityFor(ev) {
  if (!ev) return null;
  if (ev.type === 'keydown') return MODIFIERS.has(ev.key) ? null : 'keyboard';
  if (ev.type === 'pointerdown' || ev.type === 'mousedown') return 'pointer';
  return null;
}

function installInputModality(doc = globalThis.document) {
  if (!doc || !doc.documentElement || !doc.addEventListener) return () => {};
  const root = doc.documentElement;
  const set = (ev) => {
    const m = modalityFor(ev);
    if (m && root.getAttribute('data-input') !== m) root.setAttribute('data-input', m);
  };
  root.setAttribute('data-input', 'pointer');
  doc.addEventListener('keydown', set, true);
  doc.addEventListener('pointerdown', set, true);
  return () => {
    doc.removeEventListener('keydown', set, true);
    doc.removeEventListener('pointerdown', set, true);
  };
}

module.exports = { installInputModality, modalityFor };
