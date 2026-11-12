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
const {
  HOME_TILE_HEIGHT, HOME_ROW_CARDS, HOME_HALF_ROW_CARDS, HOME_CONCERT_CARDS,
} = require('./home-skeletons');

const e = React.createElement;

// Drawn over album art or on a filled accent: the same in both themes.
const CHIP_BG = 'rgba(255,255,255,.94)'; // on-art
const CHIP_FG = '#111827'; // on-art
const ART_DIM = 'rgba(17,24,39,.38)'; // on-art
const PLAY_FILL = '#7c3aed'; // fill-accent
const ON_FILL = '#fff'; // on-color

const SECTION_STYLE = { display: 'flex', flexDirection: 'column', gap: '14px' };
const H2_STYLE = { margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' };
const SUB_STYLE = { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' };
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

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

const PlayGlyph = (size) => svg(size, e('path', { d: 'M7 4v16l13-8z' }), { fill: 'currentColor', stroke: 'none' });
const QueueGlyph = () => svg(16, [
  e('path', { key: 'a', d: 'M3 6h18M3 12h12M3 18h8' }),
  e('path', { key: 'b', d: 'M16 15l5 3-5 3z', fill: 'currentColor' }),
]);
const AddGlyph = () => svg(16, e('path', { d: 'M3 6h12M3 12h12M3 18h8M18 14v8M14 18h8' }));

// A round action over art. `primary` is the filled play button.
function ActionButton({ label, onClick, primary, size, children }) {
  const px = size || (primary ? 44 : 40);
  return e('button', {
    type: 'button',
    'aria-label': label,
    onClick: (ev) => { ev.stopPropagation(); if (onClick) onClick(ev); },
    style: {
      width: `${px}px`, height: `${px}px`, borderRadius: '50%', border: 'none', cursor: 'pointer',
      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      backgroundColor: primary ? PLAY_FILL : CHIP_BG,
      color: primary ? ON_FILL : CHIP_FG,
    },
  }, children);
}

const chipStyle = (extra) => Object.assign({
  position: 'absolute', top: '8px', left: '8px', maxWidth: 'calc(100% - 16px)',
  fontSize: '11px', fontWeight: 600, borderRadius: '999px', padding: '3px 8px',
  backgroundColor: CHIP_BG, color: CHIP_FG, ...ELLIPSIS,
}, extra);

// Square art: a mosaic (2x2), one cover, or a placeholder block.
function ArtBox({ imageUrl, mosaic, item, onArtError, children, style }) {
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
  }
  return e('div', {
    style: Object.assign({
      position: 'relative', aspectRatio: '1', borderRadius: '10px', overflow: 'hidden',
      backgroundColor: 'var(--accent-surface)',
    }, style),
  }, art, children);
}

// ---------------------------------------------------------------- Jump back in

function JumpTile({ tile, onPlayTile, onContextMenu, onArtError }) {
  const reveal = useReveal();
  const item = tile.item;
  const title = tile.kind === 'loves' ? 'Recent loves'
    : tile.kind === 'album' ? (item && item.album) : (item && item.title);
  const imageUrl = tile.imageUrl || (item && !Array.isArray(item) && item.imageUrl) || null;
  const mosaic = tile.mosaic || (item && !Array.isArray(item) && item.mosaic) || null;
  return e('button', Object.assign({
    type: 'button',
    onClick: () => onPlayTile && onPlayTile(tile),
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, tile); } },
    style: {
      font: 'inherit', textAlign: 'left', display: 'flex', alignItems: 'center', gap: '12px',
      padding: '0 12px 0 0', border: 'none', borderRadius: '10px', cursor: 'pointer', overflow: 'hidden',
      height: `${HOME_TILE_HEIGHT}px`, minWidth: 0,
      backgroundColor: reveal.shown ? 'var(--accent-surface)' : 'var(--bg-secondary)',
      color: 'var(--text-primary)',
    },
  }, reveal.props),
    e('span', { style: { flex: `0 0 ${HOME_TILE_HEIGHT}px`, height: `${HOME_TILE_HEIGHT}px`, display: 'block' } },
      e(ArtBox, {
        imageUrl, mosaic, item, onArtError,
        style: { width: `${HOME_TILE_HEIGHT}px`, height: `${HOME_TILE_HEIGHT}px`, borderRadius: 0, aspectRatio: 'auto' },
      })),
    e('span', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
      e('span', { style: Object.assign({ fontWeight: 600, fontSize: '14px' }, ELLIPSIS) }, title),
      e('span', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)' }, ELLIPSIS) }, tile.subtitle)),
    e('span', {
      'aria-hidden': 'true',
      style: {
        flex: '0 0 36px', height: '36px', borderRadius: '50%', display: 'flex', alignItems: 'center',
        justifyContent: 'center', backgroundColor: PLAY_FILL, color: ON_FILL,
        opacity: reveal.shown ? 1 : 0, transition: 'opacity .15s',
      },
    }, PlayGlyph(14)));
}

function JumpBackIn({ tiles, onPlayTile, onContextMenu, onImport, onArtError }) {
  const list = Array.isArray(tiles) ? tiles.slice(0, 4) : [];
  if (list.length === 0) {
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
    e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: '12px' } },
      list.map((tile, i) => e(JumpTile, {
        key: `${tile.kind}-${(tile.item && tile.item.id) || i}`, tile, onPlayTile, onContextMenu, onArtError,
      }))));
}

// ----------------------------------------------------------------------- Cards

function AlbumCard({ album, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onHoverPrefetch, onArtError }) {
  const reveal = useReveal();
  const timer = React.useRef(null);
  React.useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  if (!album) return null;
  const title = album.title;
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
  return e('div', Object.assign({
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, album); } },
    style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
  }, reveal.props, dwell),
    e(ArtBox, { imageUrl: album.imageUrl, item: album, onArtError, style: { cursor: 'pointer' } },
      album.tag && e('span', { style: chipStyle() }, album.tag),
      e('div', {
        onClick: open,
        style: {
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px',
          backgroundColor: ART_DIM, opacity: reveal.shown ? 1 : 0, transition: 'opacity .15s',
        },
      },
        e(ActionButton, { label: `Add ${title} to a playlist`, onClick: () => onAddToPlaylist && onAddToPlaylist(album) }, AddGlyph()),
        e(ActionButton, { label: `Play ${title}`, primary: true, size: 52, onClick: () => onPlay && onPlay(album) }, PlayGlyph(18)),
        e(ActionButton, { label: `Add ${title} to the queue`, onClick: () => onQueue && onQueue(album) }, QueueGlyph()))),
    e('button', {
      type: 'button', onClick: open, 'aria-label': `Open ${title}`,
      style: Object.assign({ font: 'inherit', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }, ELLIPSIS),
    }, title),
    album.artist && e('div', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-4px' }, ELLIPSIS) }, album.artist),
    album.why && e('div', { style: Object.assign({ fontSize: '11px', color: 'var(--text-secondary)' }, ELLIPSIS), title: album.why }, album.why));
}

function PlaylistCard({ playlist, badge, chip, subtitle, onOpen, onPlay, onQueue, onContextMenu, onArtError }) {
  const reveal = useReveal();
  if (!playlist) return null;
  const title = playlist.title;
  const open = () => onOpen && onOpen(playlist);
  return e('div', Object.assign({
    onContextMenu: (ev) => { if (onContextMenu) { ev.preventDefault(); onContextMenu(ev, playlist); } },
    style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 },
  }, reveal.props),
    e('div', { onClick: open, style: { cursor: 'pointer' } },
      e(ArtBox, { imageUrl: playlist.imageUrl, mosaic: playlist.mosaic, item: playlist, onArtError },
        chip && e('span', { style: chipStyle() }, chip),
        badge && e('span', {
          style: {
            position: 'absolute', top: '8px', left: '8px', fontSize: '11px', fontWeight: 700, borderRadius: '999px',
            padding: '3px 8px', backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)',
          },
        }, badge),
        e('div', {
          style: {
            position: 'absolute', right: '8px', bottom: '8px', display: 'flex', gap: '8px', alignItems: 'center',
            opacity: reveal.shown ? 1 : 0, transition: 'opacity .15s',
          },
        },
          e(ActionButton, { label: `Add ${title} to the queue`, onClick: () => onQueue && onQueue(playlist) }, QueueGlyph()),
          e(ActionButton, { label: `Play ${title}`, primary: true, onClick: () => onPlay && onPlay(playlist) }, PlayGlyph(16))))),
    e('button', {
      type: 'button', onClick: open, 'aria-label': `Open ${title}`,
      style: Object.assign({ font: 'inherit', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontWeight: 600, fontSize: '14px', color: 'var(--text-primary)' }, ELLIPSIS),
    }, title),
    subtitle && e('div', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)', marginTop: '-4px' }, ELLIPSIS) }, subtitle));
}

// --------------------------------------------------------------------- Filters

// `sources` are ids or { id, label }. The first chip is normally 'All'.
function SourceFilter({ sources, value, onChange, label }) {
  const list = (sources || []).map((s) => (typeof s === 'string' ? { id: s, label: s } : s));
  return e('div', { role: 'group', 'aria-label': label || 'Filter by source', style: { display: 'flex', flexWrap: 'wrap', gap: '8px' } },
    list.map((s) => {
      const on = s.id === value;
      return e('button', {
        key: s.id, type: 'button', 'aria-pressed': on, onClick: () => onChange && onChange(s.id),
        style: {
          font: 'inherit', fontSize: '12px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
          padding: '8px 12px', minHeight: '36px',
          backgroundColor: on ? PLAY_FILL : 'var(--bg-secondary)',
          color: on ? ON_FILL : 'var(--text-primary)',
        },
      }, s.label);
    }));
}

// Chips: All, then one per source that has at least one item.
function sourceChips(items, labelOf) {
  const seen = new Map();
  for (const it of items || []) {
    const ids = [it.resolverId].concat(Array.isArray(it.sourceIds) ? it.sourceIds : []).filter(Boolean);
    for (const id of ids) if (!seen.has(id)) seen.set(id, labelOf(it, id));
  }
  return [{ id: 'All', label: 'All' }].concat(Array.from(seen, ([id, label]) => ({ id, label })));
}

function SectionHeader({ id, title, sub, page, view, navigateTo, extra }) {
  return e('div', { style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
    e('div', null,
      e('h2', { id, style: H2_STYLE }, title),
      sub && e('div', { style: SUB_STYLE }, sub)),
    e('div', { style: { display: 'flex', alignItems: 'center', gap: '12px' } },
      extra,
      page && e('button', {
        type: 'button', 'aria-label': `See all in ${page}`, onClick: () => navigateTo && navigateTo(view),
        style: { font: 'inherit', fontSize: '13px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', color: 'var(--accent-primary)' },
      }, `See all in ${page}`)));
}

const grid = (cols, gap) => ({ display: 'grid', gridTemplateColumns: cols, gap });

// ------------------------------------------------------------------------ Rows

// Mixes are playlist cards with the service named on the art.
function MixesRow({ mixes, onOpen, onPlay, onQueue, onContextMenu, onArtError }) {
  const [source, setSource] = React.useState('All');
  const all = Array.isArray(mixes) ? mixes : [];
  if (all.length === 0) return null;
  const chips = sourceChips(all, (m, id) => m.serviceLabel || id);
  const shown = filterBySource(all, source).slice(0, HOME_ROW_CARDS);
  return e('section', { 'aria-labelledby': 'home-mixes', style: SECTION_STYLE },
    e(SectionHeader, { id: 'home-mixes', title: 'Made from your listening', sub: "From the services you've connected" }),
    chips.length > 1 && e(SourceFilter, { sources: chips, value: source, onChange: setSource, label: 'Filter mixes by source' }),
    e('div', { style: grid(`repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))`, '16px') },
      shown.map((m, i) => e(PlaylistCard, {
        key: m.id || i, playlist: m, chip: m.serviceLabel, subtitle: m.description || m.subtitle,
        onOpen, onPlay, onQueue, onContextMenu, onArtError,
      }))));
}

function PlaylistsRow({ playlists, navigateTo, onOpen, onPlay, onQueue, onContextMenu, onArtError }) {
  const list = Array.isArray(playlists) ? playlists.slice(0, HOME_ROW_CARDS) : [];
  if (list.length === 0) return null;
  return e('section', { 'aria-labelledby': 'home-playlists', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-playlists', title: 'Your playlists, freshest first',
      sub: 'By last change, so a playlist that refreshes itself stays up front however old it is',
      page: 'Playlists', view: 'playlists', navigateTo,
    }),
    e('div', { style: grid(`repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))`, '16px') },
      list.map((p, i) => e(PlaylistCard, {
        key: p.id || i, playlist: p, badge: p.badge, subtitle: p.subtitle,
        onOpen, onPlay, onQueue, onContextMenu, onArtError,
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
  const chips = sourceChips(all, (a, id) => a.sourceLabel || id);
  const shown = filterBySource(all, source).slice(0, HOME_ROW_CARDS);
  const refresh = onRefresh && e('button', {
    type: 'button', 'aria-label': 'Refresh suggestions', disabled: !!refreshing, onClick: () => onRefresh(),
    style: { background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)', padding: '4px', display: 'flex' },
  }, svg(16, e('path', { d: 'M21 12a9 9 0 1 1-3-6.7M21 3v6h-6' })));
  return e('section', { 'aria-labelledby': 'home-albums', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-albums', title: 'Albums you might love', page: 'Recommendations', view: 'recommendations', navigateTo, extra: refresh,
    }),
    chips.length > 1 && e(SourceFilter, { sources: chips, value: source, onChange: setSource }),
    e('div', { style: grid(`repeat(${HOME_ROW_CARDS}, minmax(0, 1fr))`, '16px') },
      shown.map((a, i) => e(AlbumCard, Object.assign({ key: a.id || `${a.artist}-${a.title}-${i}`, album: a }, albumHandlers(props))))));
}

function FreshCriticalRow(props) {
  const { fresh, critical, navigateTo } = props;
  const half = (id, title, sub, page, view, items) => e('section', {
    key: id, 'aria-labelledby': id, style: Object.assign({ flex: '1 1 480px', minWidth: 0 }, SECTION_STYLE),
  },
    e(SectionHeader, { id, title, sub, page, view, navigateTo }),
    e('div', { style: grid(`repeat(${HOME_HALF_ROW_CARDS}, minmax(0, 1fr))`, '16px') },
      items.slice(0, HOME_HALF_ROW_CARDS).map((a, i) => e(AlbumCard, Object.assign({ key: a.id || `${a.artist}-${a.title}-${i}`, album: a }, albumHandlers(props))))));
  const f = Array.isArray(fresh) ? fresh : [];
  const c = Array.isArray(critical) ? critical : [];
  if (f.length === 0 && c.length === 0) return null;
  return e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '32px' } },
    f.length > 0 && half('home-fresh', 'Fresh Drops', 'New releases from artists in your collection', 'Fresh Drops', 'new-releases', f),
    c.length > 0 && half('home-critical', 'Critical Darlings', 'Albums the critics are loving', 'Critical Darlings', 'critics-picks', c));
}

function ConcertCard({ concert, onOpenTickets }) {
  const reveal = useReveal();
  const d = concert.date ? new Date(`${concert.date}T00:00:00`) : null;
  const valid = d && !Number.isNaN(d.getTime());
  const mon = valid ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
  const day = valid ? d.getDate() : '?';
  const venue = concert.venue || {};
  const city = [venue.city, venue.region, venue.country].filter(Boolean).join(', ');
  const place = [venue.name || 'Venue TBA', city].filter(Boolean).join(' · ');
  const sellers = (concert.ticketSources || []).filter((s) => s && s.ticketUrl);
  const tix = { fontSize: '12px', fontWeight: 600, marginTop: '2px', color: 'var(--accent-primary)', textDecoration: reveal.shown ? 'underline' : 'none' };
  const open = () => onOpenTickets && onOpenTickets(concert);
  return e('div', Object.assign({
    onClick: open,
    style: {
      display: 'flex', alignItems: 'center', gap: '14px', padding: '12px', borderRadius: '14px', cursor: 'pointer', minWidth: 0,
      border: `1px solid ${reveal.shown ? 'var(--accent-primary)' : 'var(--border-default)'}`,
      backgroundColor: reveal.shown ? 'var(--accent-surface)' : 'transparent', transition: 'background .15s, border-color .15s',
    },
  }, reveal.props),
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
      e('button', {
        type: 'button', onClick: (ev) => { ev.stopPropagation(); open(); }, 'aria-label': `Tickets for ${concert.artist}`,
        style: Object.assign({ font: 'inherit', textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }, ELLIPSIS),
      }, concert.artist),
      e('span', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)' }, ELLIPSIS) }, place),
      sellers.length === 1
        ? e('a', { href: sellers[0].ticketUrl, target: '_blank', rel: 'noopener noreferrer', onClick: (ev) => ev.stopPropagation(), style: tix }, 'Tickets')
        : e('span', { style: tix }, 'Tickets')));
}

function ConcertsRow({ concerts, navigateTo, onOpenTickets }) {
  const list = Array.isArray(concerts) ? concerts.slice(0, HOME_CONCERT_CARDS) : [];
  if (list.length === 0) return null;
  return e('section', { 'aria-labelledby': 'home-concerts', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-concerts', title: 'Concerts near you', sub: 'Artists from your collection playing soon',
      page: 'Concerts', view: 'concerts', navigateTo,
    }),
    e('div', { style: grid(`repeat(${HOME_CONCERT_CARDS}, minmax(0, 1fr))`, '16px') },
      list.map((c, i) => e(ConcertCard, { key: c.id || i, concert: c, onOpenTickets }))));
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
  FreshCriticalRow, ConcertsRow, AskShuffleupagus,
};
