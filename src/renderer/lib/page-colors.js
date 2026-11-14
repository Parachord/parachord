// src/renderer/lib/page-colors.js: each page's colour, in one place (#1383
// step 5).
//
// A page's colour is its identity: the sidebar item's active text and tint,
// its hero gradient, links to it (SectionHeader's pageColor), and the Home
// panels that preview it. Before this map each of those carried its own copy,
// and they drifted: Critical Darlings' hero started in Recommendations'
// amber, Fresh Drops and Concerts were near-identical teals, and History's
// hero started in Collection's cyan.
//
//   color  the page colour (sidebar text, links, icons, slider accents)
//   rgb    the same as "r, g, b", for the sidebar's 10% tint
//   fill   a darker shade for filled buttons with white text (>= 4.5:1)
//   hero   the hero gradient's Tailwind classes (written out in full so
//          Tailwind's scan of this file generates them)
//
// Home is the app's accent. Loads under plain Node.

const PAGE_COLORS = {
  home: {
    color: 'var(--accent-primary)', rgb: null, fill: 'var(--accent-fill)',
    hero: 'bg-gradient-to-br from-purple-500 via-violet-600 to-indigo-600',
  },
  playlists: {
    color: '#ec4899', rgb: '236, 72, 153', fill: '#be185d',
    hero: 'bg-gradient-to-br from-rose-500 via-pink-500 to-fuchsia-600',
  },
  library: {
    color: '#06b6d4', rgb: '6, 182, 212', fill: '#0e7490',
    hero: 'bg-gradient-to-br from-cyan-500 via-cyan-600 to-blue-700',
  },
  history: {
    color: '#3b82f6', rgb: '59, 130, 246', fill: '#1d4ed8',
    hero: 'bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600',
  },
  'new-releases': {
    color: '#22c55e', rgb: '34, 197, 94', fill: '#15803d',
    hero: 'bg-gradient-to-br from-lime-500 via-green-500 to-emerald-600',
  },
  recommendations: {
    color: '#f59e0b', rgb: '245, 158, 11', fill: '#b45309',
    hero: 'bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500',
  },
  discover: {
    color: '#f97316', rgb: '249, 115, 22', fill: '#c2410c',
    hero: 'bg-gradient-to-br from-orange-500 via-pink-500 to-purple-600',
  },
  'critics-picks': {
    color: '#ef4444', rgb: '239, 68, 68', fill: '#b91c1c',
    hero: 'bg-gradient-to-br from-red-500 via-red-600 to-rose-700',
  },
  concerts: {
    color: '#10c9b4', rgb: '16, 201, 180', fill: '#0f766e',
    hero: 'bg-gradient-to-br from-teal-500 via-teal-500 to-cyan-600',
  },
};

// The sidebar item's active background: the page colour at 10%.
function pageTint(view) {
  const p = PAGE_COLORS[view];
  if (!p) return 'transparent';
  return p.rgb ? `rgba(${p.rgb}, 0.1)` : 'var(--accent-primary-alpha-10)';
}

module.exports = { PAGE_COLORS, pageTint };
