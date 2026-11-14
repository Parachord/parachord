// src/renderer/lib/activate-on-key.js: keyboard activation for an element
// that acts as a button but isn't one (#1385 step 3, #1386).
//
// About 130 cards, rows and tiles were divs with onClick: a keyboard could
// never reach or open them. Each now carries role="button", tabIndex 0 and
// this handler, which turns Enter or Space on the element itself into the
// same click a mouse makes (so its onClick, drag and context-menu wiring
// stay as they were). Keys from a control inside it (an input, a nested
// button) pass through. index.html gives [role="button"] a focus ring.
//
// New code uses a <button> (components/button.js) or CardButton instead.
// Loads under plain Node.

function activateOnKey(e) {
  if (e.target !== e.currentTarget) return;
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
    e.preventDefault();
    e.currentTarget.click();
  }
}

module.exports = { activateOnKey };
