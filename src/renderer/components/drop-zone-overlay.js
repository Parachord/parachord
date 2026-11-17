// src/renderer/components/drop-zone-overlay.js: the overlay over the
// queue and the now-playing area while a track or link is dragged over
// them: "Drop to play now" / "Drop to play next". A link from any service
// a plug-in recognises (and an Achordion link, #1493) drops here; the app
// finds the track on your own services.
//
// It was declared inside the app component, so every render made a new
// component type and React remounted it; as a module it's one type.
// Props: zone ('now-playing' | anything else: the queue), isActive.
// Props-driven; loads under plain Node.

const Icons = require('./icons');

function DropZoneOverlay({ zone, isActive }) {
  if (!isActive) return null;

  const isNowPlaying = zone === 'now-playing';
  // The shared icon set, not an emoji; sentence case.
  const Icon = isNowPlaying ? Icons.Play : Icons.ListPlus;
  const text = isNowPlaying ? 'Drop to play now' : 'Drop to play next';

  return React.createElement('div', {
    style: {
      position: 'absolute',
      inset: 0,
      backgroundColor: 'var(--scrim-strong)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
      borderRadius: '8px',
      border: '2px dashed var(--accent-primary-alpha-50)',
      pointerEvents: 'none'
    }
  },
    React.createElement('div', {
      'aria-hidden': 'true',
      style: { marginBottom: '16px', color: 'var(--accent-tertiary)', display: 'flex' }
    }, React.createElement(Icon, { size: 48 })),
    React.createElement('div', {
      style: {
        fontSize: '20px',
        fontWeight: '600',
        color: 'var(--accent-tertiary)'
      }
    }, text)
  );
}

module.exports = { DropZoneOverlay };
