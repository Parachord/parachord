// src/renderer/components/listener-card.js: the card for a person whose
// listening you follow: Collection's Friends tab and Recommendations'
// Listeners row. They were two copies of the same hexagon card, drawn
// differently (one avatar fallback dark, the other the placeholder; an
// on-air ring in hex).
//
// The hexagon avatar (their photo or their initial), an optional badge over
// its foot, an on-air ring and pulse, the name (with a pin mark), and the
// lines the page adds under it. On hover or keyboard focus one Play button:
// their recent top 10. The right-click menu is the page's (onContextMenu):
// a saved friend's has Pin and Remove, a Listener's doesn't, on the same
// card.
//
// Props:
//   name, avatarUrl
//   onOpen, onPlay, onContextMenu (event) => void
//   onAir      green ring and pulse
//   pinned     the pin mark after the name
//   badge      a node over the hexagon's foot (the similarity score)
//   details    nodes under the name (service, now playing, top artists)
//   tooltip, animationDelay, and anything else for the root (draggable,
//   onDragStart)
// Props-driven; hooks are qualified; loads under plain Node.

const Icons = require('./icons');
const { CardButton } = require('./card-button');
const { PlayTop10Icon } = require('./cards');

const HEXAGON = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';

function ListenerCard({ name, avatarUrl, onOpen, onPlay, onContextMenu, onAir = false, pinned = false, badge, details, tooltip, animationDelay = 0, ...rest }) {
  const e = React.createElement;
  const label = `Open ${name}’s profile`;
  return e(CardButton, Object.assign({}, rest, {
    label,
    tooltip: tooltip === undefined ? label : tooltip,
    onActivate: onOpen,
    onContextMenu: onContextMenu ? (ev) => { ev.preventDefault(); onContextMenu(ev); } : undefined,
    className: 'w-full flex flex-col items-center cursor-pointer group release-card card-fade-up',
    style: {
      padding: '14px 12px',
      borderRadius: '10px',
      backgroundColor: 'var(--card-bg)',
      boxShadow: 'var(--card-shadow)',
      animationDelay: `${animationDelay}ms`,
    },
  }),
    e('div', { className: 'relative', style: { width: '100px', height: '100px' } },
      // Outer hexagon: the ring, green while they're on air.
      e('div', {
        className: 'group-hover:scale-105',
        style: {
          position: 'absolute', inset: 0, clipPath: HEXAGON,
          background: onAir ? 'var(--success)' : 'linear-gradient(135deg, var(--hover-bg-subtle) 0%, var(--hover-bg-default) 100%)',
          transition: 'transform 300ms ease',
        },
      }),
      // Inner hexagon: the photo, or the initial.
      e('div', { style: { position: 'absolute', inset: '3px', clipPath: HEXAGON, overflow: 'hidden' } },
        e('div', {
          className: 'group-hover:scale-110 transition-transform duration-300',
          style: Object.assign(
            { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' },
            avatarUrl
              ? { backgroundImage: `url(${JSON.stringify(avatarUrl)})`, backgroundSize: 'cover', backgroundPosition: 'center' }
              : { backgroundColor: 'var(--placeholder-bg)' }
          ),
        },
          !avatarUrl && e('span', { style: { fontSize: '28px', fontWeight: 500, color: 'var(--text-tertiary)' } }, (name || '?').charAt(0).toUpperCase()))),
      onAir && e('div', {
        className: 'on-air-indicator',
        style: {
          position: 'absolute', bottom: '4px', right: '8px', width: '14px', height: '14px',
          backgroundColor: 'var(--success)', borderRadius: '9999px', border: '2px solid var(--card-bg)',
        },
      }),
      badge,
      // Play their recent top 10: CardButton's actions, on hover or focus.
      onPlay && e('div', { className: 'card-actions absolute inset-0 flex items-center justify-center', style: { zIndex: 2 } },
        e('button', {
          type: 'button',
          onClick: (ev) => { ev.stopPropagation(); onPlay(); },
          className: 'w-12 h-12 bg-surface-card rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-110',
          style: { border: 'none', cursor: 'pointer', padding: 0 },
          'aria-label': `Play ${name}’s recent top 10 tracks`, 'data-tooltip': 'Play their recent top 10 tracks',
        }, e(PlayTop10Icon, { size: 26, className: 'text-ink-primary' })))),
    e('div', { style: { marginTop: '10px', height: '20px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px' } },
      e('span', { className: 'truncate', style: { fontSize: '13px', fontWeight: 500, color: 'var(--text-primary)' } }, name),
      pinned && e(Icons.Bookmark, { title: 'Pinned', style: { width: '12px', height: '12px', color: 'var(--accent-soft)', flexShrink: 0 } })),
    details
  );
}

module.exports = { ListenerCard, LISTENER_HEXAGON: HEXAGON };
