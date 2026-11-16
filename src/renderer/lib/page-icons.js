// src/renderer/lib/page-icons.js: each page's icon, in one place, keyed like
// PAGE_COLORS (lib/page-colors.js).
//
// A page's icon is part of its identity, like its colour: the sidebar item,
// and anything that points at the page (What's New's notes about it). Each
// used to name its own, and they drifted (What's New drew playlists as List
// while the sidebar drew ListMusic).
//
// Values are names in components/icons.js (Icons[PAGE_ICONS.history]), so
// this stays plain data and loads under plain Node.

const PAGE_ICONS = {
  home: 'Home',
  search: 'Search',
  playlists: 'ListMusic',
  library: 'Library',
  history: 'RotateCcw',
  'new-releases': 'Droplet',
  recommendations: 'Radar', // not Star: a star follows an artist
  discover: 'ListOrdered',
  'critics-picks': 'Trophy',
  concerts: 'Ticket',
  settings: 'Settings',
};

module.exports = { PAGE_ICONS };
