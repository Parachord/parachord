/**
 * Loading skeletons for the Home page rows. Each has the box of the row in
 * home-sections.js it stands in for (same grid strings, same tile height,
 * same card count), so content replaces it without the page jumping. A
 * layout change in home-sections.js changes the matching skeleton here in
 * the same PR.
 *
 * Presentational and props-driven: no app state, no hooks. Shimmer comes
 * from the shared classes, so it follows the theme.
 */

const HOME_TILE_HEIGHT = 72;
const HOME_ROW_CARDS = 6;
const HOME_HALF_ROW_CARDS = 3;
const HOME_CONCERT_CARDS = 4;

const bar = (className, style) => React.createElement('div', {
  className: `rounded shimmer-light animate-shimmer ${className}`,
  style: { backgroundSize: '200% 100%', ...style }
});

const stagger = (index) => `${Math.min(index * 30, 300)}ms`;

/** Jump back in: four 72px tiles, a 72px art square then two text lines. */
function JumpBackInSkeleton() {
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' }
  }, [0, 1, 2, 3].map((i) => React.createElement('div', {
    key: i,
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', height: `${HOME_TILE_HEIGHT}px`,
      borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--card-bg)'
    }
  },
    React.createElement('div', {
      className: 'shimmer-strong animate-shimmer',
      style: {
        flex: `0 0 ${HOME_TILE_HEIGHT}px`, height: `${HOME_TILE_HEIGHT}px`,
        backgroundSize: '200% 100%', animationDelay: stagger(i)
      }
    }),
    React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' } },
      bar('h-3.5', { width: '70%', animationDelay: stagger(i) }),
      bar('h-3', { width: '50%', animationDelay: stagger(i) }))
  )));
}

/** A row of square-art cards: art, a title line, a subtitle line. */
function CardRowSkeleton({ count = HOME_ROW_CARDS, columns } = {}) {
  const cols = columns || count;
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: '16px' }
  }, Array.from({ length: count }, (_, i) => React.createElement('div', {
    key: i,
    style: { display: 'flex', flexDirection: 'column', gap: '8px' }
  },
    React.createElement('div', {
      className: 'aspect-square shimmer-strong animate-shimmer',
      style: { borderRadius: '10px', backgroundSize: '200% 100%', animationDelay: stagger(i) }
    }),
    bar('h-3.5', { width: '70%', animationDelay: stagger(i) }),
    bar('h-3', { width: '50%', animationDelay: stagger(i) }))));
}

/** Concerts: four cards, a date block beside three text lines. */
function ConcertRowSkeleton() {
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: { display: 'grid', gridTemplateColumns: `repeat(${HOME_CONCERT_CARDS}, minmax(0, 1fr))`, gap: '16px' }
  }, Array.from({ length: HOME_CONCERT_CARDS }, (_, i) => React.createElement('div', {
    key: i,
    style: {
      display: 'flex', alignItems: 'center', gap: '14px', padding: '12px', borderRadius: '14px',
      border: '1px solid var(--border-default)'
    }
  },
    React.createElement('div', {
      className: 'shimmer-strong animate-shimmer',
      style: { flex: '0 0 56px', height: '64px', borderRadius: '10px', backgroundSize: '200% 100%', animationDelay: stagger(i) }
    }),
    React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' } },
      bar('h-3.5', { width: '70%', animationDelay: stagger(i) }),
      bar('h-3', { width: '55%', animationDelay: stagger(i) }),
      bar('h-3', { width: '35%', animationDelay: stagger(i) })))));
}

module.exports = {
  JumpBackInSkeleton, CardRowSkeleton, ConcertRowSkeleton,
  HOME_TILE_HEIGHT, HOME_ROW_CARDS, HOME_HALF_ROW_CARDS, HOME_CONCERT_CARDS,
};
