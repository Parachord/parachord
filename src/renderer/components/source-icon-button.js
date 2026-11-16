// src/renderer/components/source-icon-button.js: a service's play button
// in a track row (TrackSources in track-lists.js): its plug-in's colour and
// logo. Moved out of track-lists.js, which re-exports it. Props-driven;
// loads under plain Node.

const { ResolverIcon } = require('./ui-atoms');

// The button: its colour and logo (the plugin's `color`). Hover
// grows it in CSS (no JS hover); the tooltip names the service and the match.
// `quiet` (the queue drawer): desaturated and faded at rest, full on hover or
// focus (.source-quiet in index.html).
function SourceIconButton({ resolver, confidence, dim, onClick, size = 20, quiet = false }) {
  const label = `Play from ${resolver.name}${confidence ? ` (${Math.round(confidence * 100)}% match)` : ''}`;
  return React.createElement('button', {
    type: 'button',
    className: `no-drag flex items-center justify-center transition-transform hover:scale-110${quiet ? ' source-quiet' : ''}`,
    'aria-label': label,
    'data-tooltip': label,
    onClick: (e) => { e.stopPropagation(); onClick(); },
    style: Object.assign({
      width: `${size}px`, height: `${size}px`, borderRadius: '4px', backgroundColor: resolver.color,
      border: 'none', cursor: 'pointer', padding: 0, pointerEvents: 'auto',
    }, quiet ? { '--rest': dim ? 0.5 : 0.7 } : { opacity: dim ? 0.6 : 1 }),
  }, React.createElement(ResolverIcon, { resolverId: resolver.id, size: Math.round(size * 0.6) }));
}

module.exports = { SourceIconButton };
