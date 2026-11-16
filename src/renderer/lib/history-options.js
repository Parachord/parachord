// src/renderer/lib/history-options.js: the History page's and a friend's
// history page's sort menu and top-charts period menu. Constants: built in
// the app component they were new arrays on every render, which as props
// would defeat the pages' React.memo (#1451).

const historySortOptions = [
  { value: 'recent', label: 'Recent' },
  { value: 'artist', label: 'Artist A–Z' },
  { value: 'title', label: 'Title A–Z' },
];

// Period options for the top charts (Last.fm / ListenBrainz ranges).
const historyPeriodOptions = [
  { value: '7day', label: 'Last 7 days' },
  { value: '1month', label: 'Last month' },
  { value: '3month', label: 'Last 3 months' },
  { value: '6month', label: 'Last 6 months' },
  { value: '12month', label: 'Last year' },
  { value: 'overall', label: 'All time' },
];

module.exports = { historySortOptions, historyPeriodOptions };
