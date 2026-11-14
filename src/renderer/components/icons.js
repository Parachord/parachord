// src/renderer/components/icons.js: the app's icon set (#1384).
//
// Each icon is a component, ({ size = 24, className, style, strokeWidth = 2,
// fill, title }) => <svg>, drawn with Lucide's paths (ISC licence,
// lucide.dev) inlined here. This file used to wrap the lucide-react vendor
// global, but nothing ever loaded it, so every icon rendered a text glyph
// (▶ ⏸ ✕ ♫ ...) and dropped its size and className.
//
// Conventions (docs/DESIGN_SYSTEM.md "Icons"): stroke 2; 16px (w-4) in rows
// and chips, 20px (w-5) in buttons and dialogs. Transport icons (Play, Pause,
// SkipBack, SkipForward) are solid, like the glyphs they replace; pass
// fill="none" for an outline. An icon is decorative (aria-hidden) unless it
// gets a `title`; the button around an icon-only control carries the
// aria-label.
//
// Loads under plain Node: React is read at render, never at module scope.

const SOLID = new Set(['Play', 'Pause', 'SkipBack', 'SkipForward']);

// [tag, attrs] pairs per icon, in a 24x24 box.
const SHAPES = {
  Play: [['polygon', { points: '6 3 20 12 6 21 6 3' }]],
  Pause: [['rect', { x: 14, y: 4, width: 4, height: 16, rx: 1 }], ['rect', { x: 6, y: 4, width: 4, height: 16, rx: 1 }]],
  SkipForward: [['polygon', { points: '5 4 15 12 5 20 5 4' }], ['line', { x1: 19, x2: 19, y1: 5, y2: 19 }]],
  SkipBack: [['polygon', { points: '19 20 9 12 19 4 19 20' }], ['line', { x1: 5, x2: 5, y1: 19, y2: 5 }]],
  Volume2: [
    ['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }],
    ['path', { d: 'M15.54 8.46a5 5 0 0 1 0 7.07' }],
    ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }],
  ],
  Music: [['path', { d: 'M9 18V5l12-2v13' }], ['circle', { cx: 6, cy: 18, r: 3 }], ['circle', { cx: 18, cy: 16, r: 3 }]],
  List: [['line', { x1: 4, y1: 6, x2: 20, y2: 6 }], ['line', { x1: 4, y1: 12, x2: 20, y2: 12 }], ['line', { x1: 4, y1: 18, x2: 20, y2: 18 }]],
  Users: [
    ['path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }],
    ['circle', { cx: 9, cy: 7, r: 4 }],
    ['path', { d: 'M22 21v-2a4 4 0 0 0-3-3.87' }],
    ['path', { d: 'M16 3.13a4 4 0 0 1 0 7.75' }],
  ],
  Radio: [
    ['circle', { cx: 12, cy: 12, r: 2 }],
    ['path', { d: 'M4.93 19.07a10 10 0 0 1 0-14.14' }],
    ['path', { d: 'M7.76 16.24a6 6 0 0 1 0-8.49' }],
    ['path', { d: 'M16.24 7.76a6 6 0 0 1 0 8.49' }],
    ['path', { d: 'M19.07 4.93a10 10 0 0 1 0 14.14' }],
  ],
  Heart: [['path', { d: 'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z' }]],
  Search: [['circle', { cx: 11, cy: 11, r: 8 }], ['path', { d: 'm21 21-4.3-4.3' }]],
  Settings: [
    ['path', { d: 'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z' }],
    ['circle', { cx: 12, cy: 12, r: 3 }],
  ],
  Plus: [['path', { d: 'M5 12h14' }], ['path', { d: 'M12 5v14' }]],
  X: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
  Check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  ChevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  ChevronUp: [['path', { d: 'm18 15-6-6-6 6' }]],
  ChevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
  ChevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  Info: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
  AlertTriangle: [
    ['path', { d: 'm21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3' }],
    ['path', { d: 'M12 9v4' }],
    ['path', { d: 'M12 17h.01' }],
  ],
  RefreshCw: [
    ['path', { d: 'M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8' }],
    ['path', { d: 'M21 3v5h-5' }],
    ['path', { d: 'M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16' }],
    ['path', { d: 'M8 16H3v5' }],
  ],
  ExternalLink: [
    ['path', { d: 'M15 3h6v6' }],
    ['path', { d: 'M10 14 21 3' }],
    ['path', { d: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6' }],
  ],
  Link: [
    ['path', { d: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71' }],
    ['path', { d: 'M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71' }],
  ],
  Download: [
    ['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }],
    ['polyline', { points: '7 10 12 15 17 10' }],
    ['line', { x1: 12, x2: 12, y1: 15, y2: 3 }],
  ],
  Folder: [['path', { d: 'M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z' }]],
  Copy: [['rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }], ['path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }]],
  Trash2: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }],
    ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }],
    ['line', { x1: 10, x2: 10, y1: 11, y2: 17 }],
    ['line', { x1: 14, x2: 14, y1: 11, y2: 17 }],
  ],
};

function makeIcon(name, shapes) {
  const Icon = ({ size = 24, className, style, strokeWidth = 2, fill, title, ...rest }) => {
    const e = React.createElement;
    const solid = SOLID.has(name);
    return e('svg', Object.assign({
      xmlns: 'http://www.w3.org/2000/svg',
      width: size, height: size, viewBox: '0 0 24 24',
      fill: fill !== undefined ? fill : (solid ? 'currentColor' : 'none'),
      stroke: 'currentColor', strokeWidth, strokeLinecap: 'round', strokeLinejoin: 'round',
      className, style,
      'aria-hidden': title ? undefined : 'true',
      role: title ? 'img' : undefined,
      focusable: 'false',
      'data-icon': name,
    }, rest),
    title ? e('title', null, title) : null,
    ...shapes.map(([tag, attrs], i) => e(tag, Object.assign({ key: i }, attrs))));
  };
  Icon.displayName = `Icon(${name})`;
  return Icon;
}

const Icons = {};
for (const [name, shapes] of Object.entries(SHAPES)) Icons[name] = makeIcon(name, shapes);

// A loading spinner: a faint ring with a turning arc in currentColor.
// One spinner for the app (the audit counted seven styles).
Icons.Spinner = ({ size = 20, className, style, label }) => {
  const e = React.createElement;
  return e('svg', {
    xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
    className: ['animate-spin', className].filter(Boolean).join(' '), style,
    role: label ? 'status' : undefined, 'aria-label': label || undefined, 'aria-hidden': label ? undefined : 'true',
    'data-icon': 'Spinner',
  },
  e('circle', { cx: 12, cy: 12, r: 10, stroke: 'currentColor', strokeWidth: 3, opacity: 0.25 }),
  e('path', { d: 'M22 12a10 10 0 0 0-10-10', stroke: 'currentColor', strokeWidth: 3, strokeLinecap: 'round' }));
};
Icons.Spinner.displayName = 'Icon(Spinner)';

Icons.ICON_NAMES = Object.keys(SHAPES).concat('Spinner');

module.exports = Icons;
