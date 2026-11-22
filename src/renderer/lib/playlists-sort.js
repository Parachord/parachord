// src/renderer/lib/playlists-sort.js: the sort menu's choices for the
// Playlists page and the Add to playlist panel. A constant: built in the
// app component it was a new array on every render, which as a prop would
// defeat a memo'd panel (#1451).

const playlistsSortOptions = [
  { value: 'added', label: 'Recently added' },
  { value: 'created', label: 'Date created' },
  { value: 'modified', label: 'Recently modified' },
  { value: 'alpha-asc', label: 'A–Z' },
  { value: 'alpha-desc', label: 'Z–A' },
];

// The time "Recently modified" orders by: when the playlist's tracks last
// changed (tracksChangedAt, playlist-freshness.js: an edit, a pull, a link's
// update), else lastModified, else addedAt. Not lastModified first: it also
// moves when a background save adds resolved sources to a playlist's tracks,
// which put playlists nobody had touched in months at the top (2026-11-22).
const modifiedTime = (p) => Number(p.tracksChangedAt) || Number(p.lastModified) || Number(p.addedAt) || 0;

// The Playlists page's and the Add to playlist panel's order for a sort
// choice. A new array; the input is never mutated. An unknown choice keeps
// the order.
function sortPlaylists(playlists, sort) {
  const sorted = Array.isArray(playlists) ? playlists.slice() : [];
  switch (sort) {
    case 'added':
      return sorted.sort((a, b) => (Number(b.addedAt) || Number(b.createdAt) || 0) - (Number(a.addedAt) || Number(a.createdAt) || 0));
    case 'created':
      return sorted.sort((a, b) => {
        const aTime = Number(a.createdAt) || Number(a.addedAt) || 0;
        const bTime = Number(b.createdAt) || Number(b.addedAt) || 0;
        if (aTime !== bTime) return bTime - aTime;
        return (a.title || '').localeCompare(b.title || '');
      });
    case 'modified':
      return sorted.sort((a, b) => modifiedTime(b) - modifiedTime(a));
    case 'alpha-asc':
      return sorted.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    case 'alpha-desc':
      return sorted.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    default:
      return sorted;
  }
}

module.exports = { playlistsSortOptions, sortPlaylists };
