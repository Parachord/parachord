// src/renderer/components/playlist-card.js: the playlist card. Every grid of
// playlists uses it: Home, the Playlists page, Search and Recommendations.
//
// There was a copy per page, and they had drifted. Search's showed only a
// music note, never the playlist's cover or its tracks' covers. The
// Playlists page drew its own 2×2 mosaic and pasted SVG, and used JS hover.
// Recommendations used a full-bleed card. This is Home's card, the inset look
// the album cards share (album-card.js): the app's card box
// (HOME_CARD_BOX) and rounded art (ArtBox). The art is the playlist's own
// cover (a provider's image) over a mosaic of its tracks' covers, or the
// playlist glyph when there's neither; a dead cover drops back to the mosaic.
// Under the art are the title and a subtitle. On hover or keyboard focus Add
// to playlist, Play and Add to queue show (each only when its handler is
// passed). The whole card opens the playlist (CardButton).
//
// Props:
//   playlist      { title, coverArt | imageUrl, mosaic, … }
//   mosaic        the tracks' covers (allPlaylistCovers[id]), if not on playlist
//   subtitle      text ("35 tracks", a creator; "a · b" shows as two lines)
//   titleBadge    a node after the title (the Shared badge)
//   badge         a short label at the art's top left ("Δ 12")
//   cornerBadges  a node at the art's top right (Hosted, AI, check now)
//   imageLoading  true: a shimmer while the cover is looked up
//   onOpen, onPlay, onQueue, onAddToPlaylist  (playlist) => void
//   onContextMenu (event, playlist) => void
//   onHoverPrefetch (playlist): after a 250ms dwell; onHoverEnd on leave
//   dragData      an object (or a function returning one, read at drag time)
//   role, animationDelay (ms), className, width (a row's fixed width), tooltip
// Props-driven; hooks are qualified; loads under plain Node.

const { CardButton } = require('./card-button');
const { useReveal, ArtOverlay, ArtBox } = require('./card-art');
const { HOME_CARD_BOX, HOME_CARD_ART_RADIUS, HOME_CARD_TEXT_GAP } = require('./home-skeletons');

const e = React.createElement;
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
const CLAMP2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };

// "Refreshed 18m ago · since 2023" shows as two lines: the age, then "Since 2023".
function subtitleLines(subtitle) {
  return String(subtitle).split(' · ').filter(Boolean)
    .map((l, i) => (i === 0 ? l : l.charAt(0).toUpperCase() + l.slice(1)));
}

function PlaylistCard({
  playlist, mosaic, subtitle, titleBadge, badge, cornerBadges, imageLoading = false,
  onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onHoverPrefetch, onHoverEnd,
  dragData, role, animationDelay, className, width, tooltip,
}) {
  const reveal = useReveal();
  const timer = React.useRef(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!playlist) return null;
  const title = playlist.title || playlist.name || '';
  const imageUrl = playlist.imageUrl || playlist.coverArt || null;
  const tiles = mosaic || playlist.mosaic || null;
  const open = () => onOpen && onOpen(playlist);
  const enter = reveal.props.onMouseEnter;
  const leave = reveal.props.onMouseLeave;
  const dwell = {
    onMouseEnter: () => {
      enter();
      if (onHoverPrefetch) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { timer.current = null; onHoverPrefetch(playlist); }, 250);
      }
    },
    onMouseLeave: () => {
      leave();
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (onHoverEnd) onHoverEnd(playlist);
    },
  };
  return e(CardButton, Object.assign({
    label: `Open ${title}`, role, tooltip, onActivate: open,
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, playlist); } },
    // The app's card box, with its release-card hover lift.
    className: ['release-card', animationDelay != null ? 'card-fade-up' : '', className].filter(Boolean).join(' '),
    style: Object.assign({}, HOME_CARD_BOX, { display: 'flex', flexDirection: 'column', gap: `${HOME_CARD_TEXT_GAP}px`, minWidth: 0, cursor: 'pointer' },
      animationDelay != null ? { animationDelay: `${animationDelay}ms` } : null,
      width ? { width, flexShrink: 0 } : null),
    draggable: dragData ? true : undefined,
    onDragStart: dragData ? (ev) => {
      ev.dataTransfer.effectAllowed = 'copy';
      ev.dataTransfer.setData('text/plain', JSON.stringify(typeof dragData === 'function' ? dragData() : dragData));
    } : undefined,
  }, reveal.props, dwell),
    e('div', null,
      e(ArtBox, { imageUrl, mosaic: tiles, item: playlist, placeholder: 'playlist', zoom: reveal.shown, style: { borderRadius: `${HOME_CARD_ART_RADIUS}px` } },
        imageLoading && !imageUrl && e('div', { className: 'absolute inset-0 shimmer-strong animate-shimmer', style: { backgroundSize: '200% 100%' } }),
        badge && e('span', {
          style: {
            position: 'absolute', top: '8px', left: '8px', fontSize: '11px', fontWeight: 700, borderRadius: '999px',
            padding: '3px 8px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)',
          },
        }, badge),
        cornerBadges && e('div', { className: 'absolute top-2 right-2 flex items-center gap-1', style: { zIndex: 3 } }, cornerBadges),
        // The app's overlay: Add to playlist, Play, Add to queue.
        e(ArtOverlay, {
          shown: reveal.shown, title, onClick: open,
          onAddToPlaylist: onAddToPlaylist && (() => onAddToPlaylist(playlist)),
          onPlay: onPlay && (() => onPlay(playlist)),
          onQueue: onQueue && (() => onQueue(playlist)),
        }))),
    e('div', { style: Object.assign({ fontWeight: 500, fontSize: '13px', color: 'var(--text-primary)' }, ELLIPSIS) },
      title,
      titleBadge && e('span', { style: { marginLeft: '6px', verticalAlign: 'middle', display: 'inline-flex' } }, titleBadge)),
    subtitle && e('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-6px' } },
      subtitleLines(subtitle).map((line, i) => e('div', { key: i, style: i === 0 ? CLAMP2 : ELLIPSIS }, line))));
}

module.exports = { PlaylistCard };
