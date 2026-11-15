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
//   pattern, patternOpacity  the hero's background pattern (a CSS
//          background-image) and how strongly it shows (components/page-hero.js)
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
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' stroke=\'%23ffffff\' stroke-width=\'2\'%3E%3Cpath d=\'M5 15h50M5 30h35M5 45h45\'/%3E%3Ccircle cx=\'50\' cy=\'30\' r=\'5\' fill=\'%23ffffff\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  library: {
    color: '#06b6d4', rgb: '6, 182, 212', fill: '#0e7490',
    hero: 'bg-gradient-to-br from-cyan-500 via-cyan-600 to-blue-700',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'20\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'4\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.08,
  },
  history: {
    color: '#3b82f6', rgb: '59, 130, 246', fill: '#1d4ed8',
    hero: 'bg-gradient-to-br from-sky-500 via-blue-500 to-indigo-600',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' stroke=\'%23ffffff\' stroke-width=\'1.5\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\'/%3E%3Cpath d=\'M30 22v8l5 5\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  'new-releases': {
    color: '#22c55e', rgb: '34, 197, 94', fill: '#15803d',
    hero: 'bg-gradient-to-br from-lime-500 via-green-500 to-emerald-600',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'2\'/%3E%3Ccircle cx=\'75\' cy=\'25\' r=\'1.5\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'2.5\'/%3E%3Ccircle cx=\'25\' cy=\'75\' r=\'1.5\'/%3E%3Ccircle cx=\'75\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'10\' cy=\'50\' r=\'1\'/%3E%3Ccircle cx=\'90\' cy=\'50\' r=\'1\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.2,
  },
  recommendations: {
    color: '#f59e0b', rgb: '245, 158, 11', fill: '#b45309',
    hero: 'bg-gradient-to-br from-amber-400 via-amber-500 to-orange-500',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Cpath d=\'M40 5l4.5 13.8h14.5l-11.7 8.5 4.5 13.8L40 32.6l-11.8 8.5 4.5-13.8-11.7-8.5h14.5z\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  discover: {
    color: '#f97316', rgb: '249, 115, 22', fill: '#c2410c',
    hero: 'bg-gradient-to-br from-orange-500 via-pink-500 to-purple-600',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  'critics-picks': {
    color: '#ef4444', rgb: '239, 68, 68', fill: '#b91c1c',
    hero: 'bg-gradient-to-br from-red-500 via-red-600 to-rose-700',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Cpath d=\'M40 5l4.5 13.8h14.5l-11.7 8.5 4.5 13.8L40 32.6l-11.8 8.5 4.5-13.8-11.7-8.5h14.5z\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  concerts: {
    color: '#10c9b4', rgb: '16, 201, 180', fill: '#0f766e',
    hero: 'bg-gradient-to-br from-teal-500 via-teal-500 to-cyan-600',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'3\'/%3E%3Ccircle cx=\'60\' cy=\'20\' r=\'2\'/%3E%3Ccircle cx=\'40\' cy=\'40\' r=\'2.5\'/%3E%3Ccircle cx=\'20\' cy=\'60\' r=\'2\'/%3E%3Ccircle cx=\'60\' cy=\'60\' r=\'3\'/%3E%3Cpath d=\'M10 45l4-15v12\' stroke=\'%23ffffff\' stroke-width=\'1\' fill=\'none\'/%3E%3Cpath d=\'M65 35l4-15v12\' stroke=\'%23ffffff\' stroke-width=\'1\' fill=\'none\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
};

// The sidebar item's active background: the page colour at 10%.
function pageTint(view) {
  const p = PAGE_COLORS[view];
  if (!p) return 'transparent';
  return p.rgb ? `rgba(${p.rgb}, 0.1)` : 'var(--accent-primary-alpha-10)';
}

module.exports = { PAGE_COLORS, pageTint };
