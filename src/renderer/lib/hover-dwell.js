// src/renderer/lib/hover-dwell.js: run a hover prefetch only after the
// pointer rests on the element (CLAUDE.md "Renderer patterns": hover
// prefetch waits for a 250ms dwell, so a scroll past doesn't fetch).
//
//   Object.assign(props, hoverDwell(() => prefetch(item)))
//
// The pending timer lives on the element, so a re-render between enter and
// leave (new handler closures) still cancels it. Pure; loads under Node.

const HOVER_DWELL_MS = 250;
const TIMER = Symbol('hoverDwellTimer');

function hoverDwell(fn, ms = HOVER_DWELL_MS) {
  return {
    onMouseEnter: (e) => {
      const el = e.currentTarget;
      if (el[TIMER]) clearTimeout(el[TIMER]);
      el[TIMER] = setTimeout(() => { el[TIMER] = null; fn(); }, ms);
    },
    onMouseLeave: (e) => {
      const el = e.currentTarget;
      if (el[TIMER]) { clearTimeout(el[TIMER]); el[TIMER] = null; }
    },
  };
}

module.exports = { hoverDwell, HOVER_DWELL_MS };
