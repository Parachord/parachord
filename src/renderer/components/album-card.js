// src/renderer/components/album-card.js: the album card. Every grid of
// albums uses it: Home, Collection, Search, Fresh Drops, Pop of the Tops,
// Critical Darlings, Recommendations, History's and a friend's top albums.
//
// There was a copy per grid (Home's AlbumCard, CollectionAlbumCard and one
// inline in each page), so they had drifted: two looks (an inset card and a
// full-bleed one), Add to playlist on some and not others, JS hover with hex
// colours, a title only some made clickable. This is Home's card, the inset
// look most grids used: the app's card box (HOME_CARD_BOX), rounded art, the
// title and artist under it; on hover or keyboard focus the art dims and Add
// to playlist, Play and Add to queue show (each only when its handler is
// passed). The whole card opens the album (CardButton).
//
// Props:
//   album         { title, artist, imageUrl } (and anything the handlers need)
//   onOpen, onPlay, onQueue, onAddToPlaylist  (album) => void
//   onContextMenu (event, album) => void
//   onHoverPrefetch (album): after a 250ms dwell (a scroll past doesn't fetch)
//   onArtError    (album): a cover that failed to load (reportBrokenAlbumArt)
//   imageLoading  true: a shimmer stands in while the cover is looked up
//   releaseType   'album' | 'ep' | 'single' | ...: the type badge, top right
//   reason        ReasonBadge props: why it's here (bottom right)
//   cornerBadge   a node at the art's top left (History's "#1")
//   subtitle      a third line ("12 plays", a year)
//   tooltip       a note for the whole card
//   dragData      an object dragged as text/plain JSON ({ type: 'album', ... })
//   role, animationDelay (ms, the fade-up), className
// Props-driven; hooks are qualified; loads under plain Node.

const { CardButton } = require('./card-button');
const { ReasonBadge } = require('./reason-badge');
const { useReveal, ArtOverlay, ArtBox, releaseBadge } = require('./card-art');
const { HOME_CARD_BOX, HOME_CARD_ART_RADIUS, HOME_CARD_TEXT_GAP } = require('./home-skeletons');

const e = React.createElement;
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function AlbumCard({
  album, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onHoverPrefetch, onArtError,
  imageLoading = false, releaseType, reason, cornerBadge, subtitle, tooltip, dragData, role, animationDelay, className,
}) {
  const reveal = useReveal();
  const timer = React.useRef(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!album) return null;
  const title = album.title || '';
  const open = () => onOpen && onOpen(album);
  const enter = reveal.props.onMouseEnter;
  const leave = reveal.props.onMouseLeave;
  const dwell = {
    onMouseEnter: () => {
      enter();
      if (onHoverPrefetch) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; onHoverPrefetch(album); }, 250);
      }
    },
    onMouseLeave: () => { leave(); if (timer.current) { clearTimeout(timer.current); timer.current = null; } },
  };
  return e(CardButton, Object.assign({
    label: `Open ${title}`,
    role,
    tooltip,
    onActivate: open,
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, album); } },
    // The app's card box, with its release-card hover lift.
    className: ['release-card', animationDelay != null ? 'card-fade-up' : '', className].filter(Boolean).join(' '),
    style: Object.assign({}, HOME_CARD_BOX, {
      display: 'flex', flexDirection: 'column', gap: `${HOME_CARD_TEXT_GAP}px`, minWidth: 0, cursor: 'pointer',
    }, animationDelay != null ? { animationDelay: `${animationDelay}ms` } : null),
    draggable: dragData ? true : undefined,
    onDragStart: dragData ? (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', JSON.stringify(dragData));
    } : undefined,
  }, reveal.props, dwell),
    e(ArtBox, { imageUrl: album.imageUrl, item: album, onArtError, zoom: reveal.shown, style: { borderRadius: `${HOME_CARD_ART_RADIUS}px` } },
      imageLoading && !album.imageUrl && e('div', { className: 'absolute inset-0 shimmer-strong animate-shimmer', style: { backgroundSize: '200% 100%' } }),
      cornerBadge,
      releaseType && releaseBadge(releaseType),
      e(ArtOverlay, {
        shown: reveal.shown, title, onClick: open,
        onAddToPlaylist: onAddToPlaylist && (() => onAddToPlaylist(album)),
        onPlay: onPlay && (() => onPlay(album)),
        onQueue: onQueue && (() => onQueue(album)),
      }),
      reason && e(ReasonBadge, reason)),
    e('div', { style: Object.assign({ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }, ELLIPSIS) }, title),
    album.artist && e('div', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-6px' }, ELLIPSIS) }, album.artist),
    subtitle && e('div', { style: Object.assign({ fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '-6px' }, ELLIPSIS) }, subtitle));
}

// History's and a friend's rank on the cover.
function AlbumRankBadge({ rank }) {
  return e('div', {
    className: 'absolute top-2 left-2 px-2 py-0.5 bg-black/60 rounded text-xs text-white font-medium',
    style: { zIndex: 3 },
  }, `#${rank}`);
}

module.exports = { AlbumCard, AlbumRankBadge };
