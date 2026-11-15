// src/renderer/components/card-art.js: the parts every album and playlist
// card shares (moved out of home-sections.js when the album cards became
// one): the square art (ArtBox: a cover, a 2x2 mosaic or a placeholder,
// reporting a dead album cover through onArtError), the hover / focus
// overlay (ArtOverlay: Add to playlist, Play, Add to queue), useReveal
// (hover or keyboard focus shows the overlay) and the release-type badge.
// Props-driven; hooks are qualified; loads under plain Node.

const { Play } = require('./icons');

const e = React.createElement;

// Hover or keyboard focus anywhere inside the card reveals its actions.
function useReveal() {
  const [hover, setHover] = React.useState(false);
  const [focus, setFocus] = React.useState(false);
  return {
    shown: hover || focus,
    props: {
      onMouseEnter: () => setHover(true),
      onMouseLeave: () => setHover(false),
      onFocus: () => setFocus(true),
      onBlur: (ev) => {
        if (!ev.currentTarget.contains(ev.relatedTarget)) setFocus(false);
      },
    },
  };
}


// A round action over art. `primary` is the filled play button.
// The app's art hover, copied from CollectionAlbumCard (cards.js) and the
// Playlists grid so Home looks like every other page: the art dims, Add to
// Playlist and Add to Queue flank a larger white Play, and the cover scales up
// a little. The class strings are the app's own; only the reveal is ours (state,
// so keyboard focus shows the buttons too). A card passes only the actions its
// type has, as the app's cards do.
const APP_OVERLAY = 'absolute inset-0 bg-black/50 transition-opacity duration-200 flex items-center justify-center gap-3';
const APP_SIDE_BTN = 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110';
const APP_PLAY_BTN = 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110';
const APP_ART_ZOOM = 'scale(1.05)';
// The app's sizes (40/48/40px) need 152px of art. Home's half-row cards can be
// narrower, so the buttons may shrink in proportion and stay round instead
// of clipping; at the app's usual widths they are its exact sizes.
const SHRINK = { flexShrink: 1, minWidth: 0, height: 'auto', aspectRatio: '1' };
// The icons shrink with their buttons, in the app's proportions (a 20px icon
// in a 40px side button, 22px in the 48px play button, nudged right 2px to
// look centred), so a smaller circle never holds a full-size triangle.
const SIDE_ICON = { width: '50%', height: '50%' };
const PLAY_ICON = { width: '46%', height: '46%', marginLeft: '4%' };

function SideButton({ label, onClick, path }) {
  return e('button', {
    type: 'button', 'aria-label': label, 'data-tooltip': label,
    onClick: (ev) => { ev.stopPropagation(); if (onClick) onClick(ev); },
    className: `${APP_SIDE_BTN} bg-white/15 hover:bg-white/25 text-white`,
    style: Object.assign({ border: 'none', cursor: 'pointer', padding: 0 }, SHRINK),
  }, e('svg', { style: SIDE_ICON, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true' },
    e('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: path })));
}

// `shown` undefined: CSS shows it (.card-actions, index.html: the CardButton
// it sits in is hovered or holds keyboard focus), for a card drawn in a list
// that can't call useReveal per card (Critical Darlings).
function ArtOverlay({ shown, title, onClick, onPlay, onQueue, onAddToPlaylist }) {
  const css = shown === undefined;
  return e('div', {
    // The click opens the card once: stop it at the overlay, or a card whose
    // art is also wrapped in an opener (PlaylistCard) opened twice.
    'data-art-actions': '', onClick: onClick && ((ev) => { ev.stopPropagation(); onClick(ev); }),
    className: css ? `${APP_OVERLAY} card-actions` : APP_OVERLAY,
    // Above CardButton's stretched button (1) while shown, so its buttons and
    // its own open-on-click work; under the reason badge (3).
    style: Object.assign({ zIndex: 2, padding: '8px', boxSizing: 'border-box' },
      css ? null : { opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none' }),
  },
    onAddToPlaylist && e(SideButton, { label: `Add ${title} to a playlist`, onClick: onAddToPlaylist, path: 'M12 4v16m8-8H4' }),
    onPlay && e('button', {
      type: 'button', 'aria-label': `Play ${title}`, 'data-tooltip': 'Play',
      onClick: (ev) => { ev.stopPropagation(); onPlay(ev); },
      className: APP_PLAY_BTN,
      style: Object.assign({ border: 'none', cursor: 'pointer', padding: 0 }, SHRINK),
    }, e(Play, { size: 22, className: 'text-gray-800', style: PLAY_ICON })),
    onQueue && e(SideButton, { label: `Add ${title} to the queue`, onClick: onQueue, path: 'M4 6h16M4 12h16M4 18h7' }));
}

// The Playlists page's placeholder glyph: three lines and a play triangle.
const PlaylistGlyph = () => e('svg', {
  'aria-hidden': 'true', 'data-playlist-glyph': '', viewBox: '0 0 24 24', fill: 'currentColor',
  style: { width: '40%', height: '40%', maxWidth: '48px', maxHeight: '48px', color: 'var(--text-secondary)' },
},
  e('rect', { x: 3, y: 5, width: 18, height: 2, rx: 1 }),
  e('rect', { x: 3, y: 11, width: 10, height: 2, rx: 1 }),
  e('rect', { x: 3, y: 17, width: 7, height: 2, rx: 1 }),
  e('path', { d: 'M15 13.5v6l5.5-3-5.5-3z' }));

// Square art: a mosaic (2x2), one cover, or a placeholder block. A playlist
// with no covers yet (`placeholder: 'playlist'`) shows the Playlists page's
// glyph rather than an empty box.
function ArtBox({ imageUrl, mosaic, item, onArtError, children, style, placeholder, zoom }) {
  const tiles = Array.isArray(mosaic) ? mosaic.filter(Boolean).slice(0, 4) : [];
  // A cover that failed to load drops out and the mosaic (or the placeholder)
  // below shows — a dead cover degrades, never blanks; a fresh URL (a refresh
  // swapped the image) retries. Same contract as PlaylistCoverImage on the
  // layered surfaces ("Playlist covers" in docs/architecture/album-art.md).
  const [deadCoverUrl, setDeadCoverUrl] = React.useState(null);
  React.useEffect(() => { setDeadCoverUrl(null); }, [imageUrl]);
  const cover = imageUrl && deadCoverUrl !== imageUrl ? imageUrl : null;
  // A playlist's cover never reports into the album-art pipeline: it is not
  // any album's art (reportBroken needs the artist and album the playlist
  // does not carry, so the report would be a no-op — but it must not reach
  // the pipeline at all). Album art keeps reporting: that retry is how a
  // dead album cover heals.
  const fail = () => { if (placeholder !== 'playlist' && onArtError) onArtError(item); };
  let art;
  if (cover) {
    art = e('img', {
      src: cover, alt: '', loading: 'lazy',
      onError: () => { setDeadCoverUrl(imageUrl); fail(); },
      style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    });
  } else if (tiles.length >= 4) {
    art = e('div', { style: { width: '100%', height: '100%', display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
      tiles.map((u, i) => e('img', {
        key: i, src: u, alt: '', loading: 'lazy', onError: fail,
        style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
      })));
  } else if (tiles.length > 0) {
    art = e('img', {
      src: tiles[0], alt: '', loading: 'lazy', onError: fail,
      style: { width: '100%', height: '100%', objectFit: 'cover', display: 'block' },
    });
  } else if (placeholder === 'playlist') {
    art = e('div', { style: { width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' } },
      PlaylistGlyph());
  }
  // `zoom` scales the art the way the app's cards do on hover.
  const zoomed = art && e('div', {
    style: { width: '100%', height: '100%', transition: 'transform 0.3s ease', transform: zoom ? APP_ART_ZOOM : 'none' },
  }, art);
  return e('div', {
    style: Object.assign({
      position: 'relative', aspectRatio: '1', borderRadius: '10px', overflow: 'hidden',
      backgroundColor: 'var(--accent-surface)',
    }, style),
  }, zoomed, children);
}


// The Fresh Drops page's release-type badge (app.js; the .release-badge class
// in index.html): top right, Album indigo, EP purple, anything else pink.
// The type's colour (lib/release-types.js, the album page's palette) at 90%.
const { RELEASE_TYPE_COLORS, releaseTypeColor } = require('../lib/release-types');
const RELEASE_BADGE_BG = Object.fromEntries(Object.entries(RELEASE_TYPE_COLORS)
  .map(([type, color]) => [type, `color-mix(in srgb, ${color} 90%, transparent)`]));
function releaseBadge(type) {
  if (typeof type !== 'string' || !type) return null;
  const t = type.toLowerCase();
  return e('div', { style: { position: 'absolute', top: '8px', right: '8px' } },
    e('span', {
      className: 'release-badge',
      style: { backgroundColor: `color-mix(in srgb, ${releaseTypeColor(t)} 90%, transparent)`, color: 'white' }, // on-art
    }, t === 'ep' ? 'EP' : t.charAt(0).toUpperCase() + t.slice(1)));
}


module.exports = { useReveal, ArtOverlay, ArtBox, releaseBadge, RELEASE_BADGE_BG, APP_ART_ZOOM };
