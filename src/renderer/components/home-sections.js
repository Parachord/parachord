// src/renderer/components/home-sections.js: the Home page's rows and cards.
// Props-driven; hooks are qualified and the module loads under plain Node.
//
// Art comes in as props (imageUrl, or a mosaic array for playlists); this
// module never resolves art itself. A cover that fails to load calls
// onArtError(item), which the page wires to window.reportBrokenAlbumArt.
//
// Card actions show on hover and on focus-within (tracked in state, so a
// keyboard user reaches them without a Tailwind variant). The sizes of the
// rows (HOME_* constants, grid strings, tile height) are shared with
// home-skeletons.js; change one, change the other.

const { filterBySource } = require('../lib/home-model');
const { readableTextOn } = require('../lib/readable-text');
const { FixedTooltip, SERVICE_LOGOS } = require('./ui-atoms');
const { Play } = require('./icons');
const {
  HOME_TILE_HEIGHT, HOME_ROW_CARDS, HOME_HALF_ROW_CARDS, HOME_CONCERT_CARDS, HOME_ROW_GAP, HOME_CARD_TEXT_GAP,
  HOME_JUMP_GRID, HOME_JUMP_GAP, HOME_HALF_FLEX, HOME_HALF_GAP, CardRowSkeleton,
} = require('./home-skeletons');

const e = React.createElement;

// Drawn over album art or on a filled accent: the same in both themes.
const CHIP_BG = 'rgba(255,255,255,.94)'; // on-art
const CHIP_FG = '#111827'; // on-art
const PLAY_FILL = '#7c3aed'; // fill-accent
const ON_FILL = '#fff'; // on-color
const SHUFFLE_COLOR = '#7c3aed'; // fill-accent: the accent var turns light purple in dark mode

// Each page's sidebar colour (app.js), which its section's See all link takes.
const PAGE_COLOR = { playlists: '#ec4899', recommendations: '#f59e0b', concerts: '#10c9b4' };
// The Fresh Drops and Critical Darlings pages' hero gradients (app.js) and
// the collapsed hero title's shadow, which the halves' bands copy.
const FRESH_HERO = 'bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-600';
const CRITICAL_HERO = 'bg-gradient-to-br from-amber-500 via-orange-500 to-red-500';
const HERO_TEXT_SHADOW = '0 2px 10px rgba(0,0,0,0.5)';
// Inner padding of the Fresh Drops / Critical Darlings panels.
const HOME_HALF_PANEL_PAD = 20;
const SECTION_STYLE = { display: 'flex', flexDirection: 'column', gap: '14px' };
const H2_STYLE = { margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' };
const SUB_STYLE = { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' };
const CLAMP2 = { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' };
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };
// Read by screen readers, not drawn.
const VISUALLY_HIDDEN = {
  position: 'absolute', width: '1px', height: '1px', padding: 0, margin: '-1px',
  overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap', border: 0,
};

// Only http(s) ticket links reach an href.
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

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

const svg = (size, children, extra) => e('svg', Object.assign({
  'aria-hidden': 'true', width: size, height: size, viewBox: '0 0 24 24',
  fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round',
}, extra), children);


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
const APP_SIDE_BG = 'rgba(255, 255, 255, 0.15)'; // on-art
const APP_SIDE_BG_HOVER = 'rgba(255, 255, 255, 0.25)'; // on-art
const APP_SIDE_FG = '#ffffff'; // on-art
const APP_ART_ZOOM = 'scale(1.05)';
// The app's sizes (40/48/40px) need 152px of art. Home's half-row cards can be
// narrower, so the buttons may shrink in proportion and stay round instead
// of clipping; at the app's usual widths they are its exact sizes.
const SHRINK = { flexShrink: 1, minWidth: 0, height: 'auto', aspectRatio: '1' };

function SideButton({ label, onClick, path }) {
  return e('button', {
    type: 'button', 'aria-label': label, title: label,
    onClick: (ev) => { ev.stopPropagation(); if (onClick) onClick(ev); },
    className: APP_SIDE_BTN,
    style: Object.assign({ backgroundColor: APP_SIDE_BG, color: APP_SIDE_FG, border: 'none', cursor: 'pointer', padding: 0 }, SHRINK),
    onMouseEnter: (ev) => { ev.currentTarget.style.backgroundColor = APP_SIDE_BG_HOVER; },
    onMouseLeave: (ev) => { ev.currentTarget.style.backgroundColor = APP_SIDE_BG; },
  }, e('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': 'true' },
    e('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: path })));
}

function ArtOverlay({ shown, title, onClick, onPlay, onQueue, onAddToPlaylist }) {
  return e('div', {
    'data-art-actions': '', onClick, className: APP_OVERLAY,
    style: { opacity: shown ? 1 : 0, pointerEvents: shown ? 'auto' : 'none', zIndex: 1, padding: '8px', boxSizing: 'border-box' },
  },
    onAddToPlaylist && e(SideButton, { label: `Add ${title} to a playlist`, onClick: onAddToPlaylist, path: 'M12 4v16m8-8H4' }),
    onPlay && e('button', {
      type: 'button', 'aria-label': `Play ${title}`, title: `Play ${title}`,
      onClick: (ev) => { ev.stopPropagation(); onPlay(ev); },
      className: APP_PLAY_BTN,
      style: Object.assign({ border: 'none', cursor: 'pointer', padding: 0 }, SHRINK),
    }, e(Play, { size: 22, className: 'text-gray-800 ml-0.5' })),
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
  const fail = () => { if (onArtError) onArtError(item); };
  let art;
  if (imageUrl) {
    art = e('img', {
      src: imageUrl, alt: '', loading: 'lazy', onError: fail,
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

// ---------------------------------------------------------------- Jump back in

// The tile opens its item (the open control on the left, an <a>-like button);
// a separate Play button on the right plays it. Two sibling buttons in a
// container, never a button inside a button.
function JumpTile({ tile, onOpenTile, onPlayTile, onContextMenu, onArtError }) {
  const reveal = useReveal();
  const item = tile.item;
  const title = tile.kind === 'loves' ? 'Recent loves'
    : tile.kind === 'album' ? (item && item.album) : (item && item.title);
  const imageUrl = tile.imageUrl || (item && !Array.isArray(item) && item.imageUrl) || null;
  const mosaic = tile.mosaic || (item && !Array.isArray(item) && item.mosaic) || null;
  const placeholder = tile.kind === 'playlist' || tile.kind === 'mix' ? 'playlist' : null;
  return e('div', Object.assign({
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, tile); } },
    style: {
      display: 'flex', alignItems: 'center', gap: '12px',
      padding: '0 12px 0 0', borderRadius: '10px', overflow: 'hidden',
      height: `${HOME_TILE_HEIGHT}px`, minWidth: 0,
      backgroundColor: reveal.shown ? 'var(--accent-surface)' : 'var(--bg-secondary)',
      color: 'var(--text-primary)',
    },
  }, reveal.props),
    // The art takes the app's card hover with Play alone (as the
    // Recommendations page's single-action playlist cards do); the rest of
    // the tile opens the page.
    e('span', { style: { flex: `0 0 ${HOME_TILE_HEIGHT}px`, height: `${HOME_TILE_HEIGHT}px`, display: 'block', cursor: 'pointer' } },
      e(ArtBox, {
        imageUrl, mosaic, item, onArtError, placeholder, zoom: reveal.shown,
        style: { width: `${HOME_TILE_HEIGHT}px`, height: `${HOME_TILE_HEIGHT}px`, borderRadius: 0, aspectRatio: 'auto' },
      },
        e(ArtOverlay, {
          shown: reveal.shown, title,
          onClick: () => onOpenTile && onOpenTile(tile),
          onPlay: () => onPlayTile && onPlayTile(tile),
        }))),
    e('button', {
      type: 'button', 'aria-label': `Open ${title}`,
      onClick: () => onOpenTile && onOpenTile(tile),
      style: {
        font: 'inherit', textAlign: 'left', color: 'inherit', background: 'none', border: 'none', padding: 0,
        cursor: 'pointer', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '2px', flex: 1, minWidth: 0,
        height: `${HOME_TILE_HEIGHT}px`,
      },
    },
      e('span', { style: Object.assign({ fontWeight: 600, fontSize: '14px' }, ELLIPSIS) }, title),
      // On the hover fill (--accent-surface) the secondary grey falls under
      // 4.5:1 in light mode, so the subtitle takes the primary text colour.
      e('span', {
        'data-jump-subtitle': '',
        style: Object.assign({ fontSize: '12px', color: reveal.shown ? 'var(--text-primary)' : 'var(--text-secondary)' }, ELLIPSIS),
      }, tile.subtitle)));
}

// The import card shows only for a new user (no collection, no playlists:
// `showImport`); with neither tiles nor the card the row hides.
function JumpBackIn({ tiles, onOpenTile, onPlayTile, onContextMenu, onImport, onArtError, showImport }) {
  const list = Array.isArray(tiles) ? tiles.slice(0, 4) : [];
  if (list.length === 0) {
    if (!showImport) return null;
    return e('section', { 'aria-labelledby': 'home-jump', style: SECTION_STYLE },
      e('h2', { id: 'home-jump', style: H2_STYLE }, 'Jump back in'),
      e('div', {
        style: {
          display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '12px',
          padding: '16px 20px', borderRadius: '12px', border: '1px solid var(--border-default)',
          backgroundColor: 'var(--bg-secondary)',
        },
      },
        e('div', null,
          e('div', { style: { fontWeight: 600, fontSize: '15px', color: 'var(--text-primary)' } }, 'Build your collection'),
          e('div', { style: SUB_STYLE }, 'Import your playlists and loved songs from the services you use.')),
        e('button', {
          type: 'button', onClick: () => onImport && onImport(),
          className: 'px-4 py-2 rounded-lg text-sm font-semibold',
          style: { border: 'none', cursor: 'pointer', backgroundColor: PLAY_FILL, color: ON_FILL },
        }, 'Import')));
  }
  return e('section', { 'aria-labelledby': 'home-jump', style: SECTION_STYLE },
    e('h2', { id: 'home-jump', style: H2_STYLE }, 'Jump back in'),
    e('div', { style: { display: 'grid', gridTemplateColumns: HOME_JUMP_GRID, gap: `${HOME_JUMP_GAP}px` } },
      list.map((tile, i) => e(JumpTile, {
        key: `${tile.kind}-${(tile.item && tile.item.id) || i}`, tile, onOpenTile, onPlayTile, onContextMenu, onArtError,
      }))));
}

// ----------------------------------------------------------------------- Cards


// The sidebar's Critical Darlings icon.
const DropletGlyph = () => svg(16, e('path', { d: 'M12 22a7 7 0 0 0 7-7c0-5-7-13-7-13S5 10 5 15a7 7 0 0 0 7 7z' }));
const TrophyGlyph = () => svg(16, e('path', { d: 'M6 2h12v6a6 6 0 01-12 0V2zM9 21h6M12 14v7M6 4H3v2a3 3 0 003 3M18 4h3v2a3 3 0 01-3 3' }));

// Shuffleupagus's icon from the shared icon set, sized to 18px.
const shuffleupagusIcon = () => (SERVICE_LOGOS && SERVICE_LOGOS.shuffleupagus
  ? React.cloneElement(SERVICE_LOGOS.shuffleupagus, { className: undefined, width: 18, height: 18, 'aria-hidden': 'true' })
  : null);

// The round badge in the art's lower right corner: Shuffleupagus's reason, or a
// Critical Darlings pick's review summary. A critics pick with no summary
// (the feed item had no description) gets no badge.
function artBadge(album) {
  if (album.resolverId === 'shuffleupagus') {
    return { label: 'Why Shuffleupagus picked this', text: album.reason || 'Picked by Shuffleupagus', icon: shuffleupagusIcon() };
  }
  // Critical Darlings' summary takes the same Shuffleupagus badge.
  if (album.homeRow === 'critical' && album.description) {
    return { label: 'What the critics said', text: album.description, icon: shuffleupagusIcon() };
  }
  return null;
}

// The Fresh Drops page's release-type badge (app.js; the .release-badge class
// in index.html): top right, Album indigo, EP purple, anything else pink.
const RELEASE_BADGE_BG = { album: 'rgba(99, 102, 241, 0.9)', ep: 'rgba(168, 85, 247, 0.9)', other: 'rgba(236, 72, 153, 0.9)' }; // on-art
function releaseBadge(type) {
  if (typeof type !== 'string' || !type) return null;
  const t = type.toLowerCase();
  return e('div', { style: { position: 'absolute', top: '8px', right: '8px' } },
    e('span', {
      className: 'release-badge',
      style: { backgroundColor: RELEASE_BADGE_BG[t] || RELEASE_BADGE_BG.other, color: 'white' }, // on-art
    }, t === 'ep' ? 'EP' : t.charAt(0).toUpperCase() + t.slice(1)));
}

function AlbumCard({ album, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onHoverPrefetch, onArtError }) {
  const reveal = useReveal();
  const timer = React.useRef(null);
  const badgeId = React.useId();
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!album) return null;
  const title = album.title;
  const open = () => onOpen && onOpen(album);
  const badge = artBadge(album);
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
  return e('div', Object.assign({
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, album); } },
    style: { display: 'flex', flexDirection: 'column', gap: `${HOME_CARD_TEXT_GAP}px`, minWidth: 0 },
  }, reveal.props, dwell),
    e(ArtBox, { imageUrl: album.imageUrl, item: album, onArtError, zoom: reveal.shown, style: { cursor: 'pointer' } },
      album.homeRow === 'fresh' && releaseBadge(album.releaseType),
      e(ArtOverlay, {
        shown: reveal.shown, title, onClick: open,
        onAddToPlaylist: () => onAddToPlaylist && onAddToPlaylist(album),
        onPlay: () => onPlay && onPlay(album),
        onQueue: () => onQueue && onQueue(album),
      }),
      // The reason is the button's description: a hidden copy is always in
      // the tree for screen readers, and the tooltip draws it on hover/focus.
      badge && e('div', { style: { position: 'absolute', bottom: '8px', right: '8px', zIndex: 2 } },
        e('span', { id: `${badgeId}-why`, style: VISUALLY_HIDDEN }, badge.text),
        e(FixedTooltip, { content: badge.text, id: `${badgeId}-tip` },
          e('button', {
            type: 'button', 'aria-label': badge.label, 'aria-describedby': `${badgeId}-why`,
            style: {
              width: '26px', height: '26px', borderRadius: '50%', border: 'none', padding: 0, cursor: 'help',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              backgroundColor: CHIP_BG, color: CHIP_FG,
            },
          }, badge.icon)))),
    e('button', {
      type: 'button', onClick: open, 'aria-label': `Open ${title}`,
      style: Object.assign({ font: 'inherit', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }, ELLIPSIS),
    }, title),
    album.artist && e('div', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-6px' }, ELLIPSIS) }, album.artist),
    // Shuffleupagus and Critical Darlings say why in the badge; the other
    // sources keep their one-line source text.
    !badge && album.why && e('div', { style: Object.assign({ fontSize: '11px', color: 'var(--text-secondary)' }, CLAMP2), title: album.why }, album.why));
}

// "Refreshed 18m ago · since 2023" shows as two lines: the age, then "Since 2023".
function subtitleLines(subtitle) {
  return String(subtitle).split(' · ').filter(Boolean)
    .map((l, i) => (i === 0 ? l : l.charAt(0).toUpperCase() + l.slice(1)));
}

function PlaylistCard({ playlist, badge, subtitle, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onArtError }) {
  const reveal = useReveal();
  if (!playlist) return null;
  const title = playlist.title;
  const open = () => onOpen && onOpen(playlist);
  return e('div', Object.assign({
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, playlist); } },
    style: { display: 'flex', flexDirection: 'column', gap: `${HOME_CARD_TEXT_GAP}px`, minWidth: 0 },
  }, reveal.props),
    e('div', { onClick: open, style: { cursor: 'pointer' } },
      e(ArtBox, { imageUrl: playlist.imageUrl, mosaic: playlist.mosaic, item: playlist, onArtError, placeholder: 'playlist', zoom: reveal.shown },
        badge && e('span', {
          style: {
            position: 'absolute', top: '8px', left: '8px', fontSize: '11px', fontWeight: 700, borderRadius: '999px',
            padding: '3px 8px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)',
          },
        }, badge),
        // The app's overlay. A mix (a service playlist, tracks not loaded)
        // has no Add to Playlist, so it shows Play and Add to Queue, as the
        // app's cards do when an action is missing.
        e(ArtOverlay, {
          shown: reveal.shown, title, onClick: open,
          onAddToPlaylist: onAddToPlaylist && (() => onAddToPlaylist(playlist)),
          onPlay: () => onPlay && onPlay(playlist),
          onQueue: () => onQueue && onQueue(playlist),
        }))),
    e('button', {
      type: 'button', onClick: open, 'aria-label': `Open ${title}`,
      style: Object.assign({ font: 'inherit', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }, ELLIPSIS),
    }, title),
    subtitle && e('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-6px' } },
      subtitleLines(subtitle).map((line, i) => e('div', { key: i, style: i === 0 ? CLAMP2 : ELLIPSIS }, line))));
}

// --------------------------------------------------------------------- Filters

// `sources` are ids or { id, label }. The first chip is normally 'All'.
function SourceFilter({ sources, value, onChange, label }) {
  const list = (sources || []).map((s) => (typeof s === 'string' ? { id: s, label: s } : s));
  return e('div', { role: 'group', 'aria-label': label || 'Filter by source', style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
    list.map((s) => {
      const on = s.id === value;
      // "All" stays neutral. A source takes its service's colour: a dot when
      // idle, the fill when selected (text picked for contrast on that fill).
      const brand = s.id === 'All' ? null : (s.color || 'var(--text-secondary)');
      return e('button', {
        key: s.id, type: 'button', 'aria-pressed': on, onClick: () => onChange && onChange(s.id),
        style: {
          font: 'inherit', fontSize: '12px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
          padding: '8px 12px', minHeight: '36px', display: 'inline-flex', alignItems: 'center', gap: '8px',
          backgroundColor: on ? (brand || PLAY_FILL) : 'var(--bg-secondary)',
          color: on ? (brand ? readableTextOn(brand) : ON_FILL) : 'var(--text-primary)',
        },
      },
      brand && !on && e('span', { 'aria-hidden': 'true', 'data-chip-dot': '', style: { width: '8px', height: '8px', borderRadius: '50%', flexShrink: 0, backgroundColor: brand } }),
      s.label);
    }));
}

// Chips: All, then one per source that has at least one item.
// `colors` maps a source id to its plugin colour (see HomePage); Shuffleupagus
// is not a plugin and uses the fixed accent.
function sourceChips(items, labelOf, colors) {
  const seen = new Map();
  for (const it of items || []) {
    const ids = [it.resolverId].concat(Array.isArray(it.sourceIds) ? it.sourceIds : []).filter(Boolean);
    for (const id of ids) if (!seen.has(id)) seen.set(id, labelOf(it, id));
  }
  const colorOf = (id) => (id === 'shuffleupagus' ? SHUFFLE_COLOR : (colors && colors[id]) || null);
  return [{ id: 'All', label: 'All' }].concat(Array.from(seen, ([id, label]) => ({ id, label, color: colorOf(id) })));
}

// `pageColor` colours the See all link in its page's sidebar colour.
function SectionHeader({ id, title, sub, page, view, navigateTo, extra, pageColor }) {
  return e('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
    e('div', null,
      e('h2', { id, style: H2_STYLE }, title),
      sub && e('div', { style: SUB_STYLE }, sub)),
    e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      extra,
      page && e('button', {
        type: 'button', 'aria-label': `See all in ${page}`, onClick: () => navigateTo && navigateTo(view),
        style: { font: 'inherit', fontSize: '13px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', color: pageColor || 'var(--accent-primary)' },
      }, `See all in ${page}`)));
}

const grid = (cols, gap) => ({ display: 'grid', gridTemplateColumns: cols, gap });

// ------------------------------------------------------------------------ Rows

// Mixes are playlist cards; the source filter names their services.
function MixesRow({ mixes, sourceColors, onOpen, onPlay, onQueue, onContextMenu, onArtError }) {
  const [source, setSource] = React.useState('All');
  const all = Array.isArray(mixes) ? mixes : [];
  if (all.length === 0) return null;
  const chips = sourceChips(all, (m, id) => m.serviceLabel || id, sourceColors);
  const shown = filterBySource(all, source).slice(0, HOME_ROW_CARDS);
  return e('section', { 'aria-labelledby': 'home-mixes', style: SECTION_STYLE },
    e(SectionHeader, { id: 'home-mixes', title: 'Made from your listening', sub: "From the services you've connected" }),
    chips.length > 1 && e(SourceFilter, { sources: chips, value: source, onChange: setSource, label: 'Filter mixes by source' }),
    e('div', { style: grid(`repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      shown.map((m, i) => e(PlaylistCard, {
        key: m.id || i, playlist: m, subtitle: m.description || m.subtitle,
        onOpen, onPlay, onQueue, onContextMenu, onArtError,
      }))));
}

function PlaylistsRow({ playlists, navigateTo, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onArtError }) {
  const list = Array.isArray(playlists) ? playlists.slice(0, HOME_ROW_CARDS) : [];
  if (list.length === 0) return null;
  return e('section', { 'aria-labelledby': 'home-playlists', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-playlists', title: 'Your playlists, freshest first',
      sub: 'By last change, so a playlist that refreshes itself stays up front however old it is',
      page: 'Playlists', view: 'playlists', navigateTo, pageColor: PAGE_COLOR.playlists,
    }),
    e('div', { style: grid(`repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      list.map((p, i) => e(PlaylistCard, {
        key: p.id || i, playlist: p, badge: p.badge, subtitle: p.subtitle,
        onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onArtError,
      }))));
}

function albumHandlers(p) {
  return {
    onOpen: p.onOpen, onPlay: p.onPlay, onQueue: p.onQueue, onAddToPlaylist: p.onAddToPlaylist,
    onContextMenu: p.onContextMenu, onHoverPrefetch: p.onHoverPrefetch, onArtError: p.onArtError,
  };
}

function AlbumsRow(props) {
  const { albums, navigateTo, onRefresh, refreshing } = props;
  const [source, setSource] = React.useState('All');
  const all = Array.isArray(albums) ? albums : [];
  if (all.length === 0) return null;
  const chips = sourceChips(all, (a, id) => a.sourceLabel || id, props.sourceColors);
  const shown = filterBySource(all, source).slice(0, HOME_ROW_CARDS);
  // While a refresh runs the icon spins, is disabled and says it's busy.
  const refresh = onRefresh && e('button', {
    type: 'button', 'aria-label': refreshing ? 'Refreshing suggestions' : 'Refresh suggestions',
    'aria-busy': refreshing ? 'true' : 'false', disabled: !!refreshing,
    onClick: () => { if (!refreshing) onRefresh(); },
    style: {
      background: 'none', border: 'none', cursor: refreshing ? 'default' : 'pointer',
      color: 'var(--text-secondary)', padding: '4px', display: 'flex',
    },
  }, svg(16, e('path', { d: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6' }), refreshing ? { className: 'animate-spin' } : undefined));
  return e('section', { 'aria-labelledby': 'home-albums', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-albums', title: 'Albums you might love', page: 'Recommendations', view: 'recommendations', navigateTo, extra: refresh,
      pageColor: PAGE_COLOR.recommendations,
    }),
    chips.length > 1 && e(SourceFilter, { sources: chips, value: source, onChange: setSource }),
    e('div', { style: grid(`repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      shown.map((a, i) => e(AlbumCard, Object.assign({ key: a.id || `${a.artist}-${a.title}-${i}`, album: a }, albumHandlers(props))))));
}

// Two halves side by side. Each is its own column at a fixed basis (half the
// row less half the gap), so a half that is alone stays half width, and a
// half still loading draws its skeleton in its own place while the other
// shows its cards. A half that is neither loading nor has cards is left out.
function FreshCriticalRow(props) {
  const { fresh, critical, freshLoading, criticalLoading, navigateTo } = props;
  // Each half is a card that opens with a slim hero band copied from its
  // page's hero (the same gradient classes, and the collapsed hero's
  // uppercase light title and shadow), the sidebar's icon beside the title.
  // The cards sit below on the page background.
  const half = (id, title, page, view, items, loading, hero, icon) => e('section', {
    key: id, 'aria-labelledby': id, 'aria-busy': loading ? 'true' : undefined,
    style: {
      flex: HOME_HALF_FLEX, minWidth: 0, display: 'flex', flexDirection: 'column',
      borderRadius: '16px', overflow: 'hidden', border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-primary)',
    },
  },
    e('div', {
      'data-home-hero': '', className: hero,
      style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '14px 20px' },
    },
      e('h2', {
        id,
        style: {
          margin: 0, display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0,
          fontSize: '18px', fontWeight: 300, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: ON_FILL, textShadow: HERO_TEXT_SHADOW, // on-color
        },
      }, icon, title),
      e('button', {
        type: 'button', 'aria-label': `See all in ${page}`, onClick: () => navigateTo && navigateTo(view),
        style: { font: 'inherit', fontSize: '13px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: 0, color: ON_FILL }, // on-color
      }, 'See all')),
    e('div', { style: Object.assign({ padding: `${HOME_HALF_PANEL_PAD}px` }, SECTION_STYLE) },
      loading
        ? e(CardRowSkeleton, { count: HOME_HALF_ROW_CARDS })
        : e('div', { style: grid(`repeat(${HOME_HALF_ROW_CARDS}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
          items.slice(0, HOME_HALF_ROW_CARDS).map((a, i) => e(AlbumCard, Object.assign({ key: a.id || `${a.artist}-${a.title}-${i}`, album: a }, albumHandlers(props)))))));
  const f = Array.isArray(fresh) ? fresh : [];
  const c = Array.isArray(critical) ? critical : [];
  const showF = f.length > 0 || !!freshLoading;
  const showC = c.length > 0 || !!criticalLoading;
  if (!showF && !showC) return null;
  return e('div', { style: { display: 'flex', gap: `${HOME_HALF_GAP}px` } },
    showF && half('home-fresh', 'Fresh Drops', 'Fresh Drops', 'new-releases', f, f.length === 0, FRESH_HERO, DropletGlyph()),
    showC && half('home-critical', 'Critical Darlings', 'Critical Darlings', 'critics-picks', c, c.length === 0, CRITICAL_HERO, TrophyGlyph()));
}

// A concert card is not clickable as a whole: "Tickets" is its only action.
// One seller is a direct link; several make a disclosure: the Tickets button
// (aria-expanded, aria-controls) shows a list of plain links. It closes on an
// outside click, on Escape (focus goes back to Tickets when it was inside),
// and when focus leaves it.
function TicketsLink({ sellers, artist }) {
  const [open, setOpen] = React.useState(false);
  const wrap = React.useRef(null);
  const trigger = React.useRef(null);
  const listId = `${React.useId()}-tickets`;
  React.useEffect(() => {
    if (!open) return undefined;
    const onDown = (ev) => { if (wrap.current && !wrap.current.contains(ev.target)) setOpen(false); };
    const onKey = (ev) => {
      if (ev.key !== 'Escape') return;
      const inside = !!(wrap.current && document.activeElement && wrap.current.contains(document.activeElement));
      setOpen(false);
      if (inside && trigger.current) trigger.current.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const tix = { font: 'inherit', fontSize: '12px', fontWeight: 600, marginTop: '2px', color: 'var(--accent-primary)', textDecoration: 'underline', textAlign: 'left' };
  const safe = (sellers || []).filter((s) => s && isHttpUrl(s.ticketUrl));
  if (safe.length === 0) return null;
  if (safe.length === 1) {
    return e('a', { href: safe[0].ticketUrl, target: '_blank', rel: 'noopener noreferrer', 'aria-label': `Tickets for ${artist}`, style: tix }, 'Tickets');
  }
  return e('div', {
    ref: wrap,
    // Focus moving out of the trigger and its list closes the list.
    onBlur: (ev) => { if (!ev.currentTarget.contains(ev.relatedTarget)) setOpen(false); },
    style: { position: 'relative', alignSelf: 'flex-start' },
  },
    e('button', {
      ref: trigger, type: 'button', 'aria-expanded': open, 'aria-controls': listId, 'aria-label': `Tickets for ${artist}`,
      onClick: () => setOpen((v) => !v),
      style: Object.assign({ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }, tix),
    }, 'Tickets'),
    open && e('div', {
      id: listId,
      style: {
        position: 'absolute', left: 0, top: '100%', marginTop: '4px', zIndex: 20, minWidth: '160px',
        display: 'flex', flexDirection: 'column', padding: '4px', borderRadius: '10px',
        border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-secondary)',
        boxShadow: '0 4px 12px rgba(0,0,0,.18)',
      },
    }, safe.map((s, i) => e('a', {
      key: i, href: s.ticketUrl, target: '_blank', rel: 'noopener noreferrer',
      onClick: () => setOpen(false),
      style: { fontSize: '13px', padding: '8px 10px', borderRadius: '6px', color: 'var(--text-primary)', textDecoration: 'none' },
    }, s.label || s.source || 'Tickets'))));
}

function ConcertCard({ concert }) {
  const d = concert.date ? new Date(`${concert.date}T00:00:00`) : null;
  const valid = d && !Number.isNaN(d.getTime());
  const mon = valid ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
  const day = valid ? d.getDate() : '?';
  const venue = concert.venue || {};
  const city = [venue.city, venue.region, venue.country].filter(Boolean).join(', ');
  const place = [venue.name || 'Venue TBA', city].filter(Boolean).join(' · ');
  const sellers = (concert.ticketSources || []).filter((s) => s && isHttpUrl(s.ticketUrl));
  return e('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '14px', padding: '12px', borderRadius: '14px', minWidth: 0,
      border: '1px solid var(--border-default)',
    },
  },
    e('div', {
      'aria-hidden': 'true',
      style: {
        flex: '0 0 56px', height: '64px', borderRadius: '10px', backgroundColor: 'var(--bg-secondary)',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      },
    },
      e('span', { style: { fontSize: '11px', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--accent-primary)' } }, mon),
      e('span', { style: { fontSize: '22px', fontWeight: 700, lineHeight: 1, color: 'var(--text-primary)' } }, day)),
    e('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
      e('span', { style: Object.assign({ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }, ELLIPSIS) }, concert.artist),
      e('span', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)' }, ELLIPSIS) }, place),
      e(TicketsLink, { sellers, artist: concert.artist })));
}

function ConcertsRow({ concerts, navigateTo }) {
  const list = Array.isArray(concerts) ? concerts.slice(0, HOME_CONCERT_CARDS) : [];
  if (list.length === 0) return null;
  return e('section', { 'aria-labelledby': 'home-concerts', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-concerts', title: 'Concerts near you', sub: 'Artists from your collection playing soon',
      page: 'Concerts', view: 'concerts', navigateTo, pageColor: PAGE_COLOR.concerts,
    }),
    e('div', { style: grid(`repeat(${HOME_CONCERT_CARDS}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      list.map((c, i) => e(ConcertCard, { key: c.id || i, concert: c }))));
}

// ------------------------------------------------------------------------- Ask

const PROMPT_CAP = 500;

function AskShuffleupagus({ initialPrompt, chatAvailable, onAsk, onSetup }) {
  const [value, setValue] = React.useState(initialPrompt || '');
  // A new example (the collection arriving late) replaces the prompt only
  // while the user hasn't touched the field; their own words always stay.
  // Adopted during render, React's pattern for state derived from a prop.
  const [shownExample, setShownExample] = React.useState(initialPrompt || '');
  const touched = React.useRef(false);
  if ((initialPrompt || '') !== shownExample) {
    setShownExample(initialPrompt || '');
    if (!touched.current) setValue(initialPrompt || '');
  }
  const box = {
    display: 'flex', flexDirection: 'column', gap: '12px', padding: '20px', borderRadius: '16px',
    border: '1px solid var(--border-default)', backgroundColor: 'var(--bg-secondary)',
  };
  const heading = e('h2', { id: 'home-ask', style: Object.assign({}, H2_STYLE, { fontSize: '16px' }) }, 'Ask Shuffleupagus');
  if (chatAvailable === false) {
    return e('section', { 'aria-labelledby': 'home-ask', style: box },
      heading,
      e('div', null,
        e('button', {
          type: 'button', onClick: () => onSetup && onSetup(),
          className: 'px-4 py-2 rounded-lg text-sm font-semibold',
          style: { border: 'none', cursor: 'pointer', backgroundColor: PLAY_FILL, color: ON_FILL },
        }, 'Set up Shuffleupagus')));
  }
  const submit = (ev) => {
    ev.preventDefault();
    const text = value.trim().slice(0, PROMPT_CAP);
    if (text && onAsk) onAsk(text);
  };
  return e('section', { 'aria-labelledby': 'home-ask', style: box },
    heading,
    e('form', { onSubmit: submit, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', margin: 0 } },
      e('label', {
        htmlFor: 'home-ask-prompt',
        style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' },
      }, 'Prompt for Shuffleupagus'),
      e('input', {
        id: 'home-ask-prompt', type: 'text', maxLength: PROMPT_CAP, value,
        onChange: (ev) => { touched.current = true; setValue(ev.target.value); },
        style: {
          flex: '1 1 360px', minWidth: 0, font: 'inherit', fontSize: '15px', color: 'var(--text-primary)',
          backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-default)', borderRadius: '12px',
          padding: '12px 14px', minHeight: '48px', boxSizing: 'border-box',
        },
      }),
      e('button', {
        type: 'submit',
        style: {
          font: 'inherit', fontSize: '14px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
          padding: '12px 20px', minHeight: '48px', backgroundColor: PLAY_FILL, color: ON_FILL,
        },
      }, 'Ask')),
    e('div', { style: { fontSize: '12px', color: 'var(--text-secondary)' } },
      "An example built from what you've been playing. Edit it, or ask for anything."));
}

module.exports = {
  JumpBackIn, AlbumCard, PlaylistCard, SourceFilter, MixesRow, PlaylistsRow, AlbumsRow,
  FreshCriticalRow, ConcertsRow, AskShuffleupagus, __TicketsLink: TicketsLink,
};
