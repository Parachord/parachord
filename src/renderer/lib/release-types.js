// src/renderer/lib/release-types.js: each release type's colour, in one place.
//
// The album page's type badge, the cards' on-art badge and the release-type
// filter chips (the artist page, Fresh Drops) each carried their own copy,
// and the on-art badge knew only album and EP, so a Live or Compilation card
// wore Single's pink. Loads under plain Node.

const RELEASE_TYPE_COLORS = {
  album: 'rgb(99, 102, 241)',
  ep: '#a855f7',
  single: '#db2777',
  live: '#d97706',
  compilation: '#0eb3a0',
};

// A type's colour; anything else (broadcast, other) is Single's.
function releaseTypeColor(type) {
  const t = typeof type === 'string' ? type.toLowerCase() : '';
  return RELEASE_TYPE_COLORS[t] || RELEASE_TYPE_COLORS.single;
}

module.exports = { RELEASE_TYPE_COLORS, releaseTypeColor };
