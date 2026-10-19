// src/renderer/components/icons.js — the lucide-react vendor wrapper with
// inline SVG/emoji fallbacks, extracted from app.js's module scope
// (maintainability plan Track 2b, presentational slice 2). lucideReact is the
// vendor global (index.html script tag). Consumers destructure what they need:
// app.js's own `const { Play, Pause, ... } = Icons;` stays in app.js;
// component modules destructure their own subset.
// Use lucide-react icons if available, otherwise fallback to emoji
const Icons = typeof lucideReact !== 'undefined' ? lucideReact : {
  Play: () => React.createElement('span', null, '▶'),
  Pause: () => React.createElement('span', null, '⏸'),
  SkipForward: () => React.createElement('span', null, '⏭'),
  SkipBack: () => React.createElement('span', null, '⏮'),
  Volume2: () => React.createElement('span', null, '🔊'),
  Music: () => React.createElement('span', null, '♫'),
  List: ({ size = 24 }) => React.createElement('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' },
    React.createElement('line', { x1: 4, y1: 6, x2: 20, y2: 6 }),
    React.createElement('line', { x1: 4, y1: 12, x2: 20, y2: 12 }),
    React.createElement('line', { x1: 4, y1: 18, x2: 20, y2: 18 })
  ),
  Users: () => React.createElement('span', null, '👥'),
  Radio: () => React.createElement('span', null, '📻'),
  Heart: () => React.createElement('span', null, '♥'),
  Search: () => React.createElement('span', null, '🔍'),
  Settings: () => React.createElement('span', null, '⚙'),
  Plus: () => React.createElement('span', null, '+'),
  X: () => React.createElement('span', null, '✕'),
};

module.exports = Icons;
