// src/renderer/components/drop-zone-overlay.js: the overlay over the
// queue and the now-playing area while a track or link is dragged over
// them: "Drop to Play Now" / "Drop to Play Next".
//
// It was declared inside the app component, so every render made a new
// component type and React remounted it; as a module it's one type.
// Props: zone ('now-playing' | anything else: the queue), isActive.
// Props-driven; loads under plain Node.

function DropZoneOverlay({ zone, isActive }) {
  if (!isActive) return null;

  const isNowPlaying = zone === 'now-playing';
  const icon = isNowPlaying ? '▶' : '📋';
  const text = isNowPlaying ? 'Drop to Play Now' : 'Drop to Play Next';

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
      style: {
        fontSize: '48px',
        marginBottom: '16px'
      }
    }, icon),
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
