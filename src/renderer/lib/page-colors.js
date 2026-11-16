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
// The colours themselves are CSS variables in index.html (--page-<id>,
// --page-<id>-fill, --page-<id>-hero), so a theme or a user can recolour a
// page in one place; this map names them.
//
//   color  the page colour (sidebar text, links, icons, slider accents)
//   fill   a darker shade for filled buttons with white text (>= 4.5:1)
//   hero   the class that paints the hero's gradient (index.html)
//   pattern, patternOpacity  the hero's background pattern (a CSS
//          background-image) and how strongly it shows (components/page-hero.js)
//
// Home is the app's accent. Loads under plain Node.

const PAGE_COLORS = {
  home: {
    color: 'var(--page-home)', fill: 'var(--page-home-fill)',
    hero: 'page-hero-bg-home',
  },
  playlists: {
    color: 'var(--page-playlists)', fill: 'var(--page-playlists-fill)',
    hero: 'page-hero-bg-playlists',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' stroke=\'%23ffffff\' stroke-width=\'2\'%3E%3Cpath d=\'M5 15h50M5 30h35M5 45h45\'/%3E%3Ccircle cx=\'50\' cy=\'30\' r=\'5\' fill=\'%23ffffff\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  library: {
    color: 'var(--page-library)', fill: 'var(--page-library-fill)',
    hero: 'page-hero-bg-library',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'20\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'4\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.08,
  },
  history: {
    color: 'var(--page-history)', fill: 'var(--page-history-fill)',
    hero: 'page-hero-bg-history',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' stroke=\'%23ffffff\' stroke-width=\'1.5\'%3E%3Ccircle cx=\'30\' cy=\'30\' r=\'12\'/%3E%3Cpath d=\'M30 22v8l5 5\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  'new-releases': {
    color: 'var(--page-new-releases)', fill: 'var(--page-new-releases-fill)',
    hero: 'page-hero-bg-new-releases',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'25\' cy=\'25\' r=\'2\'/%3E%3Ccircle cx=\'75\' cy=\'25\' r=\'1.5\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'2.5\'/%3E%3Ccircle cx=\'25\' cy=\'75\' r=\'1.5\'/%3E%3Ccircle cx=\'75\' cy=\'75\' r=\'2\'/%3E%3Ccircle cx=\'10\' cy=\'50\' r=\'1\'/%3E%3Ccircle cx=\'90\' cy=\'50\' r=\'1\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.2,
  },
  recommendations: {
    color: 'var(--page-recommendations)', fill: 'var(--page-recommendations-fill)',
    hero: 'page-hero-bg-recommendations',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Cpath d=\'M40 5l4.5 13.8h14.5l-11.7 8.5 4.5 13.8L40 32.6l-11.8 8.5 4.5-13.8-11.7-8.5h14.5z\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  discover: {
    color: 'var(--page-discover)', fill: 'var(--page-discover-fill)',
    hero: 'page-hero-bg-discover',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  'critics-picks': {
    color: 'var(--page-critics-picks)', fill: 'var(--page-critics-picks-fill)',
    hero: 'page-hero-bg-critics-picks',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Cpath d=\'M40 5l4.5 13.8h14.5l-11.7 8.5 4.5 13.8L40 32.6l-11.8 8.5 4.5-13.8-11.7-8.5h14.5z\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
  concerts: {
    color: 'var(--page-concerts)', fill: 'var(--page-concerts-fill)',
    hero: 'page-hero-bg-concerts',
    pattern: 'url("data:image/svg+xml,%3Csvg width=\'80\' height=\'80\' viewBox=\'0 0 80 80\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Ccircle cx=\'20\' cy=\'20\' r=\'3\'/%3E%3Ccircle cx=\'60\' cy=\'20\' r=\'2\'/%3E%3Ccircle cx=\'40\' cy=\'40\' r=\'2.5\'/%3E%3Ccircle cx=\'20\' cy=\'60\' r=\'2\'/%3E%3Ccircle cx=\'60\' cy=\'60\' r=\'3\'/%3E%3Cpath d=\'M10 45l4-15v12\' stroke=\'%23ffffff\' stroke-width=\'1\' fill=\'none\'/%3E%3Cpath d=\'M65 35l4-15v12\' stroke=\'%23ffffff\' stroke-width=\'1\' fill=\'none\'/%3E%3C/g%3E%3C/svg%3E")',
    patternOpacity: 0.15,
  },
};

// The sidebar item's active background: the page colour at 10%.
function pageTint(view) {
  const p = PAGE_COLORS[view];
  if (!p) return 'transparent';
  return `color-mix(in srgb, ${p.color} 10%, transparent)`;
}

module.exports = { PAGE_COLORS, pageTint };
