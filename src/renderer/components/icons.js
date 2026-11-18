// src/renderer/components/icons.js: the app's icon set (#1384).
//
// Each icon is a component, ({ size = 24, className, style, strokeWidth = 2,
// fill, title }) => <svg>, drawn with Lucide's paths (ISC licence,
// lucide.dev) inlined here. This file used to wrap the lucide-react vendor
// global, but nothing ever loaded it, so every icon rendered a text glyph
// (▶ ⏸ ✕ ♫ ...) and dropped its size and className.
//
// Conventions (docs/DESIGN_SYSTEM.md "Icons"): stroke 2; 16px (w-4) in rows,
// chips and small buttons, 20px (w-5) in buttons and dialog titles, 12px
// (w-3) only inside a badge. Transport icons (Play, Pause,
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
  Smartphone: [['rect', { x: 5, y: 2, width: 14, height: 20, rx: 2, ry: 2 }], ['path', { d: 'M12 18h.01' }]],
  Headphones: [['path', { d: 'M3 14h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a9 9 0 0 1 18 0v7a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3' }]],
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
  ListPlus: [['path', { d: 'M11 12H3' }], ['path', { d: 'M16 6H3' }], ['path', { d: 'M16 18H3' }], ['path', { d: 'M18 9v6' }], ['path', { d: 'M21 12h-6' }]],
  X: [['path', { d: 'M18 6 6 18' }], ['path', { d: 'm6 6 12 12' }]],
  Check: [['path', { d: 'M20 6 9 17l-5-5' }]],
  ChevronDown: [['path', { d: 'm6 9 6 6 6-6' }]],
  ChevronUp: [['path', { d: 'm18 15-6-6-6 6' }]],
  ChevronLeft: [['path', { d: 'm15 18-6-6 6-6' }]],
  ChevronRight: [['path', { d: 'm9 18 6-6-6-6' }]],
  Info: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 16v-4' }], ['path', { d: 'M12 8h.01' }]],
  MoreHorizontal: [['circle', { cx: 12, cy: 12, r: 1 }], ['circle', { cx: 19, cy: 12, r: 1 }], ['circle', { cx: 5, cy: 12, r: 1 }]],
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
  QueueAdd: [['path', { d: 'M4 6h16' }], ['path', { d: 'M4 12h16' }], ['path', { d: 'M4 18h7' }]],
  ArrowRight: [['path', { d: 'M5 12h14' }], ['path', { d: 'm12 5 7 7-7 7' }]],
  MapPin: [['path', { d: 'M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0' }], ['circle', { cx: 12, cy: 10, r: 3 }]],
  Bookmark: [['path', { d: 'm19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z' }]],
  Zap: [['path', { d: 'M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z' }]],
  Star: [['path', { d: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z' }]],
  Ticket: [
    ['path', { d: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z' }],
    ['path', { d: 'M13 5v2' }], ['path', { d: 'M13 17v2' }], ['path', { d: 'M13 11v2' }],
  ],
  Shuffle: [
    ['path', { d: 'm18 14 4 4-4 4' }], ['path', { d: 'm18 2 4 4-4 4' }],
    ['path', { d: 'M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22' }],
    ['path', { d: 'M2 6h1.972a4 4 0 0 1 3.6 2.2' }], ['path', { d: 'M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45' }],
  ],
  Home: [
    ['path', { d: 'M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8' }],
    ['path', { d: 'M3 10a2 2 0 0 1 .709-1.528l7-5.999a2 2 0 0 1 2.582 0l7 5.999A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z' }],
  ],
  Clock: [['circle', { cx: 12, cy: 12, r: 10 }], ['polyline', { points: '12 6 12 12 16 14' }]],
  RotateCcw: [['path', { d: 'M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8' }], ['path', { d: 'M3 3v5h5' }]],
  Radar: [
    ['path', { d: 'M19.07 4.93A10 10 0 0 0 6.99 3.34' }],
    ['path', { d: 'M4 6h.01' }],
    ['path', { d: 'M2.29 9.62A10 10 0 1 0 21.31 8.35' }],
    ['path', { d: 'M16.24 7.76A6 6 0 1 0 8.23 16.67' }],
    ['path', { d: 'M12 18h.01' }],
    ['path', { d: 'M17.99 11.66A6 6 0 0 1 15.77 16.67' }],
    ['circle', { cx: 12, cy: 12, r: 2 }],
    ['path', { d: 'm13.41 10.59 5.66-5.66' }],
  ],
  User: [['path', { d: 'M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2' }], ['circle', { cx: 12, cy: 7, r: 4 }]],
  Droplet: [['path', { d: 'M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z' }]],
  Trophy: [
    ['path', { d: 'M6 9H4.5a2.5 2.5 0 0 1 0-5H6' }], ['path', { d: 'M18 9h1.5a2.5 2.5 0 0 0 0-5H18' }], ['path', { d: 'M4 22h16' }],
    ['path', { d: 'M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22' }],
    ['path', { d: 'M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22' }],
    ['path', { d: 'M18 2H6v7a6 6 0 0 0 12 0V2Z' }],
  ],
  Upload: [['path', { d: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4' }], ['polyline', { points: '17 8 12 3 7 8' }], ['line', { x1: 12, x2: 12, y1: 3, y2: 15 }]],
  FilePlus: [
    ['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }],
    ['path', { d: 'M9 15h6' }], ['path', { d: 'M12 18v-6' }],
  ],
  Globe: [['circle', { cx: 12, cy: 12, r: 10 }], ['path', { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' }], ['path', { d: 'M2 12h20' }]],
  // The card overlay's add-to-queue: three lines, the last short (the queue).
  AddToQueue: [['path', { d: 'M4 6h16M4 12h16M4 18h7' }]],
  ShoppingCart: [['circle', { cx: 8, cy: 21, r: 1 }], ['circle', { cx: 19, cy: 21, r: 1 }], ['path', { d: 'M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12' }]],
  AppWindow: [['rect', { x: 2, y: 4, width: 20, height: 16, rx: 2 }], ['path', { d: 'M10 4v4' }], ['path', { d: 'M2 8h20' }], ['path', { d: 'M6 4v4' }]],
  Dices: [['rect', { width: 12, height: 12, x: 2, y: 10, rx: 2, ry: 2 }], ['path', { d: 'm17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6' }], ['path', { d: 'M6 18h.01' }], ['path', { d: 'M10 14h.01' }], ['path', { d: 'M15 6h.01' }], ['path', { d: 'M18 9h.01' }]],
  Sparkles: [
    ['path', { d: 'M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z' }],
    ['path', { d: 'M20 3v4' }], ['path', { d: 'M22 5h-4' }],
  ],
  Trash2: [
    ['path', { d: 'M3 6h18' }],
    ['path', { d: 'M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6' }],
    ['path', { d: 'M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2' }],
    ['line', { x1: 10, x2: 10, y1: 11, y2: 17 }],
    ['line', { x1: 14, x2: 14, y1: 11, y2: 17 }],
  ],
  // Added 2026-11-15 for the icons pasted into app.js (the sidebar, the
  // playbar's volume, Share, the welcome screen).
  ListMusic: [['path', { d: 'M21 15V6' }], ['path', { d: 'M18.5 18a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z' }], ['path', { d: 'M12 12H3' }], ['path', { d: 'M16 6H3' }], ['path', { d: 'M12 18H3' }]],
  Library: [['path', { d: 'm16 6 4 14' }], ['path', { d: 'M12 6v14' }], ['path', { d: 'M8 8v12' }], ['path', { d: 'M4 4v16' }]],
  // A ranked list (Pop of the Tops): 1, 2, 3.
  ListOrdered: [['line', { x1: 10, x2: 21, y1: 6, y2: 6 }], ['line', { x1: 10, x2: 21, y1: 12, y2: 12 }], ['line', { x1: 10, x2: 21, y1: 18, y2: 18 }], ['path', { d: 'M4 6h1v4' }], ['path', { d: 'M4 10h2' }], ['path', { d: 'M6 18H4c0-1 2-2 2-3s-1-1.5-2-1' }]],
  LocateFixed: [['line', { x1: 2, x2: 5, y1: 12, y2: 12 }], ['line', { x1: 19, x2: 22, y1: 12, y2: 12 }], ['line', { x1: 12, x2: 12, y1: 2, y2: 5 }], ['line', { x1: 12, x2: 12, y1: 19, y2: 22 }], ['circle', { cx: 12, cy: 12, r: 7 }], ['circle', { cx: 12, cy: 12, r: 3 }]],
  Share: [['path', { d: 'M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8' }], ['polyline', { points: '16 6 12 2 8 6' }], ['line', { x1: 12, x2: 12, y1: 2, y2: 15 }]],
  FileText: [['path', { d: 'M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' }], ['path', { d: 'M14 2v4a2 2 0 0 0 2 2h4' }], ['path', { d: 'M10 9H8' }], ['path', { d: 'M16 13H8' }], ['path', { d: 'M16 17H8' }]],
  ArrowLeft: [['path', { d: 'm12 19-7-7 7-7' }], ['path', { d: 'M19 12H5' }]],
  Repeat: [['path', { d: 'm17 2 4 4-4 4' }], ['path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14' }], ['path', { d: 'm7 22-4-4 4-4' }], ['path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }]],
  Repeat1: [['path', { d: 'm17 2 4 4-4 4' }], ['path', { d: 'M3 11v-1a4 4 0 0 1 4-4h14' }], ['path', { d: 'm7 22-4-4 4-4' }], ['path', { d: 'M21 13v1a4 4 0 0 1-4 4H3' }], ['path', { d: 'M11 10h1v4' }]],
  VolumeX: [['polygon', { points: '11 5 6 9 2 9 2 15 6 15 11 19 11 5' }], ['line', { x1: 22, x2: 16, y1: 9, y2: 15 }], ['line', { x1: 16, x2: 22, y1: 9, y2: 15 }]],
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

// Spinoff: the playbar's Spinoff fork (IBM Carbon's branch glyph, solid, in
// its own 32x32 box): kept over Lucide's GitFork, which reads differently.
Icons.Spinoff = ({ size = 20, className, style }) => React.createElement('svg', {
  xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 32 32', fill: 'currentColor',
  className, style, 'aria-hidden': 'true', 'data-icon': 'Spinoff',
}, React.createElement('path', { d: 'M26,18a3.9955,3.9955,0,0,0-3.858,3H18a3.0033,3.0033,0,0,1-3-3V14a4.9514,4.9514,0,0,0-1.0256-3H22.142a4,4,0,1,0,0-2H9.858a4,4,0,1,0,0,2H10a3.0033,3.0033,0,0,1,3,3v4a5.0059,5.0059,0,0,0,5,5h4.142A3.9935,3.9935,0,1,0,26,18ZM26,8a2,2,0,1,1-2,2A2.0023,2.0023,0,0,1,26,8ZM6,12a2,2,0,1,1,2-2A2.002,2.002,0,0,1,6,12ZM26,24a2,2,0,1,1,2-2A2.0027,2.0027,0,0,1,26,24Z' }));
Icons.Spinoff.displayName = 'Icon(Spinoff)';

// Playlist: the Playlists page's placeholder glyph (three bars and a play
// triangle), solid and stroke-free, for a playlist with no covers yet.
Icons.Playlist = ({ size = 24, className, style, ...rest }) => {
  const e = React.createElement;
  return e('svg', Object.assign({ xmlns: 'http://www.w3.org/2000/svg', width: size, height: size, viewBox: '0 0 24 24', fill: 'currentColor', className, style, 'aria-hidden': 'true', 'data-icon': 'Playlist' }, rest),
    e('rect', { x: 3, y: 5, width: 18, height: 2, rx: 1 }),
    e('rect', { x: 3, y: 11, width: 10, height: 2, rx: 1 }),
    e('rect', { x: 3, y: 17, width: 7, height: 2, rx: 1 }),
    e('path', { d: 'M15 13.5v6l5.5-3-5.5-3z' }));
};
Icons.Playlist.displayName = 'Icon(Playlist)';

// PlayTop10: Play an artist's top 10 (artist and listener cards): a play
// triangle with a green "10" badge over its lower right.
Icons.PlayTop10 = ({ size = 24, className = '' }) => {
  const e = React.createElement;
  return e('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', className, 'aria-hidden': 'true', 'data-icon': 'PlayTop10' },
    // Play triangle, centred by its centroid (x 12) like the other play
    // buttons' nudged triangle; the badge sits over its lower-right corner.
    e('path', { d: 'M8.17 4.75L19.67 12L8.17 19.25V4.75Z', fill: 'currentColor', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    e('circle', { cx: 18.5, cy: 18.5, r: 5.5, fill: 'var(--success)' }),
    e('text', { x: 18.5, y: 18.5, textAnchor: 'middle', dominantBaseline: 'central', fill: 'white', fontSize: 7, fontWeight: 'bold', fontFamily: 'var(--font-sans)' }, '10'));
};
Icons.PlayTop10.displayName = 'Icon(PlayTop10)';

Icons.ICON_NAMES = Object.keys(SHAPES).concat('Spinner', 'Spinoff', 'Playlist', 'PlayTop10');

module.exports = Icons;
