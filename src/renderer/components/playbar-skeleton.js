// src/renderer/components/playbar-skeleton.js: a placeholder line in the
// playbar's now-playing block.
//
// The block is three lines: the title (text-sm, a 20px line), the artist
// (text-xs, 16px) and the source picker (20px). Each placeholder takes its
// line's real height with a shorter bar centred in it, so when the track (or
// its source picker) arrives it replaces the placeholder without the block
// changing height. The block is centred beside the cover, so a line that
// appears later used to push the title and artist up.
//
// Props: line ('title' | 'artist' | 'source'), shimmer (true while the track
// loads; otherwise the bar is a still placeholder), blank (keep the line's
// height, draw nothing: a playing track with no source picker to show).
// Props-driven; loads under plain Node.

const PLAYBAR_LINES = {
  title: { height: 20, bar: 14, width: 200 },
  artist: { height: 16, bar: 12, width: 140 },
  source: { height: 20, bar: 12, width: 80 },
};

function PlaybarLineSkeleton({ line = 'title', shimmer = false, blank = false }) {
  const e = React.createElement;
  const spec = PLAYBAR_LINES[line] || PLAYBAR_LINES.title;
  return e('div', {
    'aria-hidden': 'true',
    'data-playbar-line': line,
    style: { height: `${spec.height}px`, display: 'flex', alignItems: 'center' },
  },
    !blank && e('div', {
      className: `rounded ${shimmer ? 'shimmer-dark animate-shimmer' : 'bg-surface-dark-placeholder'}`,
      style: Object.assign({ height: `${spec.bar}px`, width: `${spec.width}px`, maxWidth: '100%' }, shimmer ? { backgroundSize: '200% 100%' } : null),
    }));
}

module.exports = { PlaybarLineSkeleton, PLAYBAR_LINES };
