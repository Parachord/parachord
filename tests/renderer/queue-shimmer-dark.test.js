// The queue drawer is dark in both themes, so its source placeholders use the
// dark shimmer (the playbar's), never the page's light one, which showed as
// near-white squares on the drawer (2026-11-23).
const fs = require('fs');
const path = require('path');

test('the queue list draws no light shimmer', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/track-lists.js'), 'utf8');
  const queue = src.slice(src.indexOf('const VirtualizedQueueList'), src.indexOf('const VirtualizedTrackList'));
  expect(queue).not.toContain('shimmer-light');
  expect((queue.match(/shimmer-dark animate-shimmer/g) || []).length).toBe(4);
});
