// src/renderer/components/queue-context-bar.js: the bar at the foot of the
// queue drawer saying where playback came from ("Playing from <playlist>").
// A click goes there (app.js decides where); a Spinoff has nowhere to go, so
// its bar isn't interactive. On the always-dark drawer: the accent fill as a
// tint, a hairline above, a deeper tint on hover.
//
// Props: interactive, onClick, tooltip, children (the "Playing from" line
// and the arrow). Props-driven; loads under plain Node.

function QueueContextBar({ interactive = true, onClick, tooltip, children }) {
  return React.createElement('button', {
    type: 'button',
    onClick,
    'data-tooltip': tooltip,
    'aria-disabled': interactive ? undefined : 'true',
    className: [
      'w-full text-left flex items-center justify-between px-4 py-1.5 transition-colors',
      'bg-[color-mix(in_srgb,var(--accent-fill)_25%,transparent)] border-t border-[color-mix(in_srgb,var(--accent-fill)_30%,transparent)]',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent',
      interactive ? 'cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent-fill)_35%,transparent)]' : 'cursor-default',
    ].join(' '),
  }, children);
}

module.exports = { QueueContextBar };
