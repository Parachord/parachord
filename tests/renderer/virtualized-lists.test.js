// #767: every long track list is virtualized (VirtualizedTrackList, which
// renders plainly under 100 rows). Collection, playlists, Search and the queue
// were done in #783; Charts, History (recent and top) and a friend's history
// (recent and top) here. A release's tracklist stays plain: it is almost never
// over 100 tracks, and its rows feed a per-row visibility observer.
const fs = require('fs');
const path = require('path');
const read = (f) => fs.readFileSync(path.join(__dirname, '../../src/renderer/components', f), 'utf8');

const uses = (src) => [...src.matchAll(/React\.createElement\(VirtualizedTrackList, \{\s*tracks: ([^,]+),\s*parentRef: (\w+)/g)].map((m) => [m[1].trim(), m[2]]);

test.each([
  ['charts-page.js', [['filtered', 'songsChartsScrollContainerRef']]],
  ['history-page.js', [['sorted', 'historyScrollContainerRef'], ['filtered', 'topTracksScrollContainerRef']]],
  ['friend-history-page.js', [['sorted', 'friendHistoryScrollContainerRef'], ['friendHistoryData.topTracks', 'friendHistoryScrollContainerRef']]],
  ['search-page.js', [['filteredTracks', 'searchScrollContainerRef']]],
])('%s renders its track lists through VirtualizedTrackList, in its scroll container', (file, expected) => {
  expect(uses(read(file))).toEqual(expected);
});

test('the recent-listens lists key rows by the listen: one song played twice is two rows', () => {
  for (const f of ['history-page.js', 'friend-history-page.js']) {
    expect([f, read(f)]).toEqual([f, expect.stringContaining('getKey: (track, index) => `${track.id}|${track.playedAt ?? index}`')]);
  }
  const lists = read('track-lists.js');
  expect(lists).toMatch(/getKey = null/);
  expect(lists).toMatch(/key: keyOf\(track, index\), role: 'listitem'/);
  expect(lists).toMatch(/key: keyOf\(track, virtualRow\.index\),/);
});

test('a virtualized row is not also a list item itself (the wrapper is)', () => {
  for (const f of ['charts-page.js', 'history-page.js', 'friend-history-page.js']) {
    expect([f, /createElement\(TrackRow, (?:Object\.assign\()?\{\s*role: 'listitem'/.test(read(f))]).toEqual([f, false]);
  }
});
