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
// Gap between cards in every card row (columns and wrapped rows), and the
// art-to-title gap inside a card. Rows and skeletons both read these.
// The card grids' gap: the Playlists page's (gap-x-4).
const HOME_ROW_GAP = 16;
// The app's album and playlist card (the Playlists grid in app.js,
// CollectionAlbumCard in cards.js): Home's cards and their skeletons share it.
const HOME_CARD_BOX = { padding: '10px', borderRadius: '10px', backgroundColor: 'var(--card-bg)', boxShadow: 'var(--card-shadow)' };
const HOME_CARD_ART_RADIUS = 8;
const HOME_CARD_TEXT_GAP = 10;
// Jump back in: four tiles across on a wide page, two by two below about
// 920px of row width (four tiles under ~220px each can't show their text).
// The min track width is a clamp: a quarter of the row (less its share of the
// gaps) when the row is wide, half of it when narrow, since the middle term is
// hugely negative or positive on either side of the 920px break.
const HOME_JUMP_GAP = 12;
const HOME_JUMP_GRID = 'repeat(auto-fit, minmax(clamp(calc(25% - 10px), calc((920px - 100%) * 999), calc(50% - 7px)), 1fr))';
// Fresh Drops and Critical Darlings: each half sits at a fixed basis of half
// the row, so a half alone stays half width and nothing reflows as the other
// half's data lands.
const HOME_HALF_GAP = 32;
// Each half keeps half the row, alone or not. Below HOME_HALF_MIN per half
// (a narrow window, #1389) the halves stack, each the full row.
const HOME_HALF_MIN = 360;
const HOME_HALF_FLEX = `0 0 calc(50% - ${HOME_HALF_GAP / 2}px)`;

// Card counts from the content width (#1389). The rows show up to their
// spec count (6 cards, 4 concerts) but never squeeze a card below its
// minimum: at the 1000px minimum window (744px of content, less the 24px
// gutters) a row shows 4 cards and the concerts 3. A width of 0 (not
// measured yet) gives the spec count.
const HOME_GUTTER = 24;
const HOME_MIN_CARD = 140;
const HOME_MIN_CONCERT = 200;
const fitCount = (contentWidth, min, lo, hi) => {
  const w = (Number(contentWidth) || 0) - 2 * HOME_GUTTER;
  if (w <= 0) return hi;
  return Math.max(lo, Math.min(hi, Math.floor((w + HOME_ROW_GAP) / (min + HOME_ROW_GAP))));
};
const homeRowCards = (contentWidth) => fitCount(contentWidth, HOME_MIN_CARD, 3, HOME_ROW_CARDS);
const homeConcertCards = (contentWidth) => fitCount(contentWidth, HOME_MIN_CONCERT, 2, HOME_CONCERT_CARDS);
const homeHalvesStacked = (contentWidth) => {
  const w = (Number(contentWidth) || 0) - 2 * HOME_GUTTER;
  return w > 0 && w < 2 * HOME_HALF_MIN + HOME_HALF_GAP;
};

const bar = (className, style) => React.createElement('div', {
  className: `rounded shimmer-light animate-shimmer ${className}`,
  style: { backgroundSize: '200% 100%', ...style }
});

const stagger = (index) => `${Math.min(index * 30, 300)}ms`;

/** Jump back in: four 72px tiles, a 72px art square then two text lines. */
function JumpBackInSkeleton() {
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: { display: 'grid', gridTemplateColumns: HOME_JUMP_GRID, gap: `${HOME_JUMP_GAP}px` }
  }, [0, 1, 2, 3].map((i) => React.createElement('div', {
    key: i,
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', height: `${HOME_TILE_HEIGHT}px`,
      borderRadius: '10px', overflow: 'hidden', backgroundColor: 'var(--bg-secondary)'
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

/**
 * One card's placeholder, the shared cards' box (AlbumCard, PlaylistCard):
 * the card box, rounded square art, a title line, then `lines` subtitle
 * lines (an album card has one, its artist, or two with a year; a playlist
 * card's subtitle can wrap to two). For any page's card grid.
 */
function CardSkeleton({ index = 0, lines = 2 } = {}) {
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: Object.assign({}, HOME_CARD_BOX, { display: 'flex', flexDirection: 'column', gap: `${HOME_CARD_TEXT_GAP}px` })
  },
    React.createElement('div', {
      className: 'aspect-square shimmer-strong animate-shimmer',
      style: { borderRadius: `${HOME_CARD_ART_RADIUS}px`, backgroundSize: '200% 100%', animationDelay: stagger(index) }
    }),
    bar('h-3.5', { width: '70%', animationDelay: stagger(index) }),
    bar('h-3', { width: '50%', animationDelay: stagger(index) }),
    lines > 1 && bar('h-3', { width: '35%', animationDelay: stagger(index) }));
}

/** A row of square-art cards: CardSkeleton in Home's row grid. */
function CardRowSkeleton({ count = HOME_ROW_CARDS, columns, lines = 2 } = {}) {
  const cols = columns || count;
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: { display: 'grid', gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap: `${HOME_ROW_GAP}px` }
  }, Array.from({ length: count }, (_, i) => React.createElement(CardSkeleton, { key: i, index: i, lines })));
}

/** Concerts: four cards, a 72px photo (with its date badge) beside four text lines (artist, venue, city, tickets). */
function ConcertRowSkeleton({ count = HOME_CONCERT_CARDS } = {}) {
  return React.createElement('div', {
    'aria-hidden': 'true',
    style: { display: 'grid', gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap: `${HOME_ROW_GAP}px` }
  }, Array.from({ length: count }, (_, i) => React.createElement('div', {
    key: i,
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '16px',
      border: '1px solid var(--border-default)'
    }
  },
    React.createElement('div', {
      className: 'shimmer-strong animate-shimmer',
      style: { flex: '0 0 72px', height: '72px', borderRadius: '10px', backgroundSize: '200% 100%', animationDelay: stagger(i) }
    }),
    React.createElement('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '6px' } },
      bar('h-3.5', { width: '70%', animationDelay: stagger(i) }),
      bar('h-3', { width: '55%', animationDelay: stagger(i) }),
      bar('h-3', { width: '45%', animationDelay: stagger(i) }),
      bar('h-3', { width: '35%', animationDelay: stagger(i) })))));
}

module.exports = {
  JumpBackInSkeleton, CardSkeleton, CardRowSkeleton, ConcertRowSkeleton,
  HOME_TILE_HEIGHT, HOME_ROW_CARDS, HOME_HALF_ROW_CARDS, HOME_CONCERT_CARDS,
  HOME_ROW_GAP, HOME_CARD_TEXT_GAP, HOME_CARD_BOX, HOME_CARD_ART_RADIUS, HOME_JUMP_GRID, HOME_JUMP_GAP, HOME_HALF_GAP, HOME_HALF_FLEX, HOME_HALF_MIN, homeRowCards, homeConcertCards, homeHalvesStacked,
};
