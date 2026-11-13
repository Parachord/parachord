/**
 * Loading skeletons for the Recommendations page.
 *
 * Each one has the same box as the element it stands in for (the album / artist /
 * playlist card, the song row, a recommended person, a section with its
 * heading), so content
 * replaces it without the page jumping. A layout change to those elements in
 * src/renderer/app.js changes the matching skeleton here in the same PR
 * (renderer-patterns.md, "Loading skeletons match the layout").
 *
 * Presentational and props-driven: no app state, no hooks.
 */

const { SectionHeader, SECTION_HEADER_GAP } = require('./section-header');

// The row grid the real cards use (app.js renderSubsection).
const GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' };
// What a collapsed row shows (SECTION_PREVIEW / SONG_PREVIEW in app.js): the
// page passes its measured count (two rows of cards, one of people) as
// `count` / `cardCount`; 6 is the default when none is passed.
const CARD_PREVIEW = 6;
const SONG_PREVIEW = 5;
// Varied bar widths, so a skeleton list doesn't read as one repeated row.
const TITLE_WIDTHS = ['68%', '52%', '78%', '60%', '45%', '72%'];
const ARTIST_WIDTHS = ['55%', '70%', '40%', '62%', '48%', '66%'];

const stagger = (index, offset = 0) => `${Math.min(index * 30, 300) + offset}ms`;

const bar = (className, style) => React.createElement('div', {
  className: `rounded shimmer-light animate-shimmer ${className}`,
  style: { backgroundSize: '200% 100%', ...style }
});

/** A card: square art, then one text line (artist, playlist) or two (album: title and artist). */
function RecommendationCardSkeleton({ index = 0, lines = 1 } = {}) {
  return React.createElement('div', {
    className: 'rounded-lg overflow-hidden',
    style: { backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' },
    'aria-hidden': 'true'
  },
    React.createElement('div', {
      className: 'aspect-square shimmer-strong animate-shimmer',
      style: { backgroundSize: '200% 100%', animationDelay: stagger(index) }
    }),
    React.createElement('div', { className: 'p-3' },
      // The real name line is text-sm (20px tall); the artist line text-xs + mt-0.5.
      React.createElement('div', { style: { height: '20px', display: 'flex', alignItems: 'center' } },
        bar('h-3.5', { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length], animationDelay: stagger(index, 50) })),
      lines > 1 && React.createElement('div', { style: { height: '16px', marginTop: '2px', display: 'flex', alignItems: 'center' } },
        bar('h-3', { width: ARTIST_WIDTHS[index % ARTIST_WIDTHS.length], animationDelay: stagger(index, 100) }))
    )
  );
}

/** A song row: number, title, artist, duration and the source icons, in the real row's columns. */
function RecommendationSongRowSkeleton({ index = 0 } = {}) {
  const delay = stagger(index);
  return React.createElement('div', {
    className: 'flex items-center gap-4 py-3 px-4',
    style: { borderRadius: '8px', marginBottom: '2px' },
    'aria-hidden': 'true'
  },
    React.createElement('div', { className: 'flex-shrink-0 flex justify-end', style: { width: '32px' } },
      bar('h-3', { width: '16px', animationDelay: delay })),
    React.createElement('div', { style: { flex: '1 1 0', minWidth: 0 } },
      bar('h-3.5', { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length], animationDelay: delay })),
    React.createElement('div', { style: { flex: '0.7 1 0', minWidth: 0 } },
      bar('h-3', { width: ARTIST_WIDTHS[index % ARTIST_WIDTHS.length], animationDelay: delay })),
    React.createElement('div', { className: 'flex-shrink-0 flex justify-end', style: { width: '50px' } },
      bar('h-3', { width: '32px', animationDelay: delay })),
    React.createElement('div', {
      className: 'flex items-center gap-1 justify-end',
      style: { width: '140px', flexShrink: 0, minHeight: '24px' }
    },
      bar('w-5 h-5', { animationDelay: delay }),
      bar('w-5 h-5', { animationDelay: stagger(index, 100) })
    )
  );
}

// Collection -> Friends' hexagon and grid (collection-page.js), which the
// Friends row's cards reuse.
const HEXAGON = 'polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%)';
const FRIEND_GRID_STYLE = { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' };

/** A recommended person: hexagon avatar (its similarity badge arrives with the answer), then the name, the source and two top-artists lines. */
function RecommendationFriendSkeleton({ index = 0 } = {}) {
  return React.createElement('div', {
    className: 'flex flex-col items-center',
    style: { padding: '14px 12px', borderRadius: '10px', backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' },
    'aria-hidden': 'true',
    'data-skeleton': 'friend'
  },
    React.createElement('div', {
      className: 'shimmer-strong animate-shimmer',
      style: { width: '100px', height: '100px', clipPath: HEXAGON, backgroundSize: '200% 100%', animationDelay: stagger(index) }
    }),
    // The real name line (13px text in a 20px box) and similarity line (text-xs, 16px).
    React.createElement('div', { style: { marginTop: '10px', height: '20px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      bar('h-3', { width: TITLE_WIDTHS[index % TITLE_WIDTHS.length], animationDelay: stagger(index, 50) })),
    // The source line (text-xs, 16px).
    React.createElement('div', { style: { marginTop: '2px', height: '16px', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      bar('h-3', { width: '45%', animationDelay: stagger(index, 75) })),
    // The top-artists block: two text-xs lines (32px).
    React.createElement('div', { style: { marginTop: '2px', height: '32px', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'space-around' } },
      bar('h-3', { width: '80%', animationDelay: stagger(index, 100) }),
      bar('h-3', { width: '55%', animationDelay: stagger(index, 150) }))
  );
}

// A section's header: the app's section title (SectionHeader, as the real
// row's header draws it, with its 16px gap below), holding its real title
// when the section is known. Unknown, it is a bar in an element with the
// title's style but no heading (naming it would promise a section that may
// never come, #1328); the bar is inline, so that element keeps the title's
// 30px line and the two headers are the same height.
const sectionHeader = (title) => React.createElement('div', { 'data-skeleton': 'section-heading' },
  React.createElement(SectionHeader, {
    as: title ? 'h2' : 'div',
    title: title || React.createElement('span', {
      className: 'rounded shimmer-light animate-shimmer h-5',
      style: { backgroundSize: '200% 100%', width: '100px', display: 'inline-block', verticalAlign: 'middle' }
    }),
    style: SECTION_HEADER_GAP
  })
);

/**
 * One section: its heading, then a collapsed row's worth of song rows
 * ('songs'), cards ('cards'; `lines` 2 for albums) or people ('friends').
 * `title` names a section the page knows is coming (Albums for Shuffleupagus,
 * Friends); otherwise the heading is a bar, because a provider still loading
 * may answer "not ready" and naming it would promise a section that never
 * comes (#1328).
 */
function RecommendationSectionSkeleton({ kind = 'cards', lines = 1, count, title } = {}) {
  const n = count || (kind === 'songs' ? SONG_PREVIEW : CARD_PREVIEW);
  return React.createElement('div', { className: 'mb-10', 'aria-hidden': 'true' },
    sectionHeader(title),
    kind === 'songs'
      ? React.createElement('div', { className: 'space-y-0' },
          ...Array.from({ length: n }, (_, i) =>
            React.createElement(RecommendationSongRowSkeleton, { key: `song-${i}`, index: i })))
      : kind === 'friends'
        ? React.createElement('div', { className: 'grid gap-x-4 gap-y-5', style: FRIEND_GRID_STYLE },
            ...Array.from({ length: n }, (_, i) =>
              React.createElement(RecommendationFriendSkeleton, { key: `friend-${i}`, index: i })))
        : React.createElement('div', { className: 'grid gap-4', style: GRID_STYLE },
            ...Array.from({ length: n }, (_, i) =>
              React.createElement(RecommendationCardSkeleton, { key: `card-${i}`, index: i, lines })))
  );
}

/** The empty page while nothing has loaded: the Songs and Albums sections the page opens with (`cardCount`: cards per row). */
function RecommendationsPageSkeleton({ cardCount } = {}) {
  return React.createElement('div', { 'aria-hidden': 'true' },
    React.createElement(RecommendationSectionSkeleton, { kind: 'songs' }),
    React.createElement(RecommendationSectionSkeleton, { kind: 'cards', lines: 2, count: cardCount })
  );
}

module.exports = {
  RecommendationCardSkeleton,
  RecommendationSongRowSkeleton,
  RecommendationFriendSkeleton,
  RecommendationSectionSkeleton,
  RecommendationsPageSkeleton
};
