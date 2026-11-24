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
//   getAlbumArt   (artist, title) => Promise<url>: the card looks up its own
//                 cover (Collection), and a dead one is reported to the art
//                 pipeline, whose retry it shows
//   imageLoading  true: a shimmer stands in while the cover is looked up
//   releaseType   'album' | 'ep' | 'single' | ...: the type badge, top right
//   reason        ReasonBadge props: why it's here (bottom right)
//   cornerBadge   a node at the art's top left (History's "#1")
//   subtitle      a third line ("12 plays", a date): text or a node
//   onOpenArtist  (album): the artist line is a link to the artist (plain
//                 text for "Various Artists", which has no page)
//   tooltip       a note for the whole card
//   dragData      an object (or a function returning one, read at drag time)
//                 dragged as text/plain JSON ({ type: 'album', ... })
//   role, animationDelay (ms, the fade-up), className, width (a row's fixed width)
//   label         the card's name, when a click doesn't open ("Play X by Y")
//   hidden        true: kept mounted but not shown (a filtered-out card; the
//                 card's inline display wins over a class, so it's a prop)
//   cardRef       the card element (a page's visibility observer)
//   cardProps     data-* attributes for the card (data-release-id)
// Props-driven; hooks are qualified; loads under plain Node.

const { CardButton } = require('./card-button');
const { ReasonBadge } = require('./reason-badge');
const { useReveal, ArtOverlay, ArtBox, releaseBadge } = require('./card-art');
const { HOME_CARD_BOX, HOME_CARD_ART_RADIUS, HOME_CARD_TEXT_GAP } = require('./home-skeletons');
const { hasArtistPage } = require('../lib/artist-page-name');

const e = React.createElement;
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

function AlbumCard({
  album, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onHoverPrefetch, onArtError, onOpenArtist, getAlbumArt,
  imageLoading = false, releaseType, reason, cornerBadge, subtitle, tooltip, dragData, role, animationDelay, className, width,
  cardRef, cardProps, label, hidden = false,
}) {
  const reveal = useReveal();
  const timer = React.useRef(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  // A card that looks up its own cover (getAlbumArt): undefined while
  // loading, null when there's none, else the URL.
  const [fetchedArt, setFetchedArt] = React.useState(album && album.imageUrl ? album.imageUrl : undefined);
  const shownRef = React.useRef('');
  const mounted = React.useRef(true);
  React.useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const artKey = album ? `${album.artist}|${album.title}` : '';
  shownRef.current = artKey;
  React.useEffect(() => {
    if (!getAlbumArt || !album) return undefined;
    if (album.imageUrl) { setFetchedArt(album.imageUrl); return undefined; }
    let cancelled = false;
    setFetchedArt(undefined);
    Promise.resolve(getAlbumArt(album.artist, album.title))
      .then((url) => { if (!cancelled) setFetchedArt(url || null); })
      .catch(() => { if (!cancelled) setFetchedArt(null); });
    return () => { cancelled = true; };
  }, [artKey, album && album.imageUrl, !!getAlbumArt]);
  if (!album) return null;
  const coverUrl = getAlbumArt ? (fetchedArt || null) : album.imageUrl;
  const coverLoading = getAlbumArt ? fetchedArt === undefined : imageLoading;
  const reportArt = getAlbumArt
    ? () => {
        const broken = fetchedArt;
        const forAlbum = artKey;
        setFetchedArt(null);
        const report = globalThis.reportBrokenAlbumArt;
        if (report) {
          report(broken, { artist: album.artist, album: album.title }).then((url) => {
            if (url && mounted.current && shownRef.current === forAlbum) setFetchedArt(url);
          }).catch(() => {});
        }
      }
    : onArtError;
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
    label: label || `Open ${title}`,
    ref: cardRef,
    role,
    tooltip,
    onActivate: open,
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, album); } },
    // The app's card box, with its release-card hover lift.
    className: ['release-card', animationDelay != null ? 'card-fade-up' : '', className].filter(Boolean).join(' '),
    style: Object.assign({}, HOME_CARD_BOX, {
      display: 'flex', flexDirection: 'column', gap: `${HOME_CARD_TEXT_GAP}px`, minWidth: 0, cursor: 'pointer',
    }, animationDelay != null ? { animationDelay: `${animationDelay}ms` } : null,
      // A fixed width, for a horizontal row (Search's overview).
      width ? { width, flexShrink: 0 } : null,
      hidden ? { display: 'none' } : null),
    draggable: dragData ? true : undefined,
    onDragStart: dragData ? (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', JSON.stringify(typeof dragData === 'function' ? dragData() : dragData));
    } : undefined,
  }, cardProps, reveal.props, dwell),
    e(ArtBox, { imageUrl: coverUrl, item: album, onArtError: reportArt, zoom: reveal.shown, style: { borderRadius: `${HOME_CARD_ART_RADIUS}px` } },
      coverLoading && !coverUrl && e('div', { className: 'absolute inset-0 shimmer-strong animate-shimmer', style: { backgroundSize: '200% 100%' } }),
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
    album.artist && (onOpenArtist && hasArtistPage(album.artist)
      // A link above the card's stretched button (.card-link).
      ? e('button', {
          type: 'button', className: 'card-link block max-w-full text-left hover:text-accent',
          style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-6px', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, ELLIPSIS),
          onClick: (ev) => { ev.stopPropagation(); onOpenArtist(album); },
        }, album.artist)
      : e('div', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-6px' }, ELLIPSIS) }, album.artist)),
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
