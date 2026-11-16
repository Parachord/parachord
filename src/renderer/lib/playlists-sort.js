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

module.exports = { playlistsSortOptions };
