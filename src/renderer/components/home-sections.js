// src/renderer/components/home-sections.js: the Home page's rows and cards.
// Props-driven; hooks are qualified and the module loads under plain Node.
//
// Art comes in as props (imageUrl, or a mosaic array for playlists); this
// module never resolves art itself. An album cover that fails to load calls
// onArtError(item), which the page wires to window.reportBrokenAlbumArt; a
// playlist's own cover (its record's coverArt) drops out instead and the
// mosaic/placeholder shows — it never reaches the album-art pipeline.
//
// Card actions show on hover and on focus-within (tracked in state, so a
// keyboard user reaches them without a Tailwind variant). The sizes of the
// rows (HOME_* constants, grid strings, tile height) are shared with
// home-skeletons.js; change one, change the other.

const { Button } = require('./button');
const { ErrorState } = require('./states');
const { filterBySource } = require('../lib/home-model');
const { ReasonBadge, ReasonMark, shuffleupagusIcon } = require('./reason-badge');
const Icons = require('./icons');
const { TextField } = require('./fields');
const { Play } = Icons;
const { useReveal, ArtOverlay, ArtBox, releaseBadge } = require('./card-art');
const { AlbumCard } = require('./album-card');
const { TicketsButton } = require('./tickets-button');
const { PlaylistCard } = require('./playlist-card');
const { FilterChips } = require('./filter-chips');
const { PAGE_COLORS } = require('../lib/page-colors');
const { SectionHeader, PAGE_COLOR, SECTION_TITLE_STYLE: H2_STYLE, SECTION_SUB_STYLE: SUB_STYLE } = require('./section-header');
const {
  HOME_TILE_HEIGHT, HOME_ROW_CARDS, HOME_HALF_ROW_CARDS, HOME_CONCERT_CARDS, HOME_ROW_GAP,
  HOME_JUMP_GRID, HOME_JUMP_GAP, HOME_HALF_FLEX, HOME_HALF_GAP, CardRowSkeleton,
} = require('./home-skeletons');

const e = React.createElement;

// Drawn over album art or on a filled accent: the same in both themes.
const PLAY_FILL = 'var(--accent-fill)'; // fill-accent
const ON_FILL = 'var(--on-accent)'; // on-color
const SHUFFLE_COLOR = 'var(--accent-fill)'; // fill-accent: the accent var turns light purple in dark mode

// The Fresh Drops and Critical Darlings pages' hero gradients (app.js) and
// the collapsed hero title's shadow, which the halves' bands copy.
const FRESH_HERO = PAGE_COLORS['new-releases'].hero;
const CRITICAL_HERO = PAGE_COLORS['critics-picks'].hero;
const CHARTS_HERO = PAGE_COLORS.discover.hero;
const HERO_TEXT_SHADOW = 'var(--hero-text-shadow-bar)';
// Inner padding of the Fresh Drops / Critical Darlings panels.
const HOME_HALF_PANEL_PAD = 20;
const SECTION_STYLE = { display: 'flex', flexDirection: 'column', gap: '14px' };
const ELLIPSIS = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' };

// Only http(s) ticket links reach an href.
const isHttpUrl = (u) => typeof u === 'string' && /^https?:\/\//i.test(u.trim());

// ---------------------------------------------------------------- Jump back in

// The tile opens its item (the open control on the left, an <a>-like button);
// a separate Play button on the right plays it. Two sibling buttons in a
// container, never a button inside a button.
function JumpTile({ tile, onOpenTile, onPlayTile, onContextMenu, onArtError }) {
  const reveal = useReveal();
  const item = tile.item;
  const title = tile.kind === 'loves' ? 'Recent Loves'
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
          e('div', { style: { fontWeight: 600, fontSize: '16px', color: 'var(--text-primary)' } }, 'Build your collection'),
          e('div', { style: SUB_STYLE }, 'Import your playlists and loved tracks from the services you use.')),
        React.createElement(Button, { variant: 'primary', onClick: () => onImport && onImport() }, 'Import')));
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
const DropletGlyph = () => e(Icons.Droplet, { size: 16 });
const TrophyGlyph = () => e(Icons.Trophy, { size: 16 });
const ChartsGlyph = () => e(Icons.ListOrdered, { size: 16 });

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

// Home's album card: the shared one (./album-card) with Home's reason badge
// (Shuffleupagus, Critical Darlings) and Fresh Drops' release type.
function HomeAlbumCard(props) {
  const album = props.album;
  return e(AlbumCard, Object.assign({}, props, {
    reason: album ? artBadge(album) : null,
    releaseType: album && album.homeRow === 'fresh' ? album.releaseType : null,
    // A recommended album's release year (as on Recommendations), its line
    // kept while the date is looked up so the row doesn't jump.
    subtitle: album && !album.homeRow ? (album.year || '\u00a0') : undefined,
  }));
}

// --------------------------------------------------------------------- Filters

// `sources` are ids or { id, label }. The first chip is normally 'All'.
// The app's filter chips (./filter-chips): "All" stays neutral; a source
// takes its service's colour, grey when it has none.
function SourceFilter({ sources, value, onChange, label }) {
  const chips = (sources || []).map((s) => (typeof s === 'string' ? { id: s, label: s } : s))
    .map((s) => (s.id === 'All' ? { id: s.id, label: s.label } : { id: s.id, label: s.label, color: s.color || 'var(--text-secondary)' }));
  return e(FilterChips, { chips, value, onChange, label: label || 'Filter by source' });
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

// SectionHeader (./section-header) is the app's section title; `pageColor`
// colours its See all link in the page's sidebar colour.

const grid = (cols, gap) => ({ display: 'grid', gridTemplateColumns: cols, gap });

// ------------------------------------------------------------------------ Rows

// Mixes are playlist cards; the source filter names their services. Recent
// Loves (`loves`, a card with its own `lovesActions`) leads the row under All.
// It is no service's, so it adds no chip, and a service's chip shows only
// that service's mixes.
function MixesRow({ mixes, loves, lovesActions, sourceColors, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onArtError, cards = HOME_ROW_CARDS }) {
  const [picked, setSource] = React.useState('All');
  const all = Array.isArray(mixes) ? mixes : [];
  if (all.length === 0 && !loves) return null;
  const chips = sourceChips(all, (m, id) => m.resolverName || id, sourceColors);
  // A chip whose source has gone leaves the row on All.
  const source = picked === 'All' || chips.some((c) => c.id === picked) ? picked : 'All';
  const lovesCard = source === 'All' ? loves : null;
  const shown = filterBySource(all, source).slice(0, cards - (lovesCard ? 1 : 0));
  return e('section', { 'aria-labelledby': 'home-mixes', style: SECTION_STYLE },
    e(SectionHeader, { id: 'home-mixes', title: 'Made from your listening', sub: "From the services you've connected" }),
    chips.length > 1 && e(SourceFilter, { sources: chips, value: source, onChange: setSource, label: 'Filter mixes by source' }),
    e('div', { style: grid(`repeat(${cards}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      lovesCard && e(PlaylistCard, Object.assign({ key: 'recent-loves', playlist: lovesCard, subtitle: lovesCard.subtitle, onArtError }, lovesActions)),
      shown.map((m, i) => e(PlaylistCard, {
        key: m.id || i, playlist: m, subtitle: m.description || m.subtitle,
        onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onArtError,
      }))));
}

function PlaylistsRow({ playlists, navigateTo, onOpen, onPlay, onQueue, onAddToPlaylist, onContextMenu, onArtError, cards = HOME_ROW_CARDS }) {
  const list = Array.isArray(playlists) ? playlists.slice(0, cards) : [];
  if (list.length === 0) return null;
  return e('section', { 'aria-labelledby': 'home-playlists', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-playlists', title: 'Your playlists, freshest first',
      sub: 'By last change, so a playlist that refreshes itself stays up front however old it is',
      page: 'Playlists', view: 'playlists', navigateTo, pageColor: PAGE_COLOR.playlists,
    }),
    e('div', { style: grid(`repeat(${cards}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
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
  const { albums, navigateTo, cards = HOME_ROW_CARDS } = props;
  const [picked, setSource] = React.useState('All');
  const all = Array.isArray(albums) ? albums : [];
  if (all.length === 0) return null;
  const chips = sourceChips(all, (a, id) => a.sourceLabel || id, props.sourceColors);
  // A chip whose source has gone leaves the row on All.
  const source = picked === 'All' || chips.some((c) => c.id === picked) ? picked : 'All';
  const shown = filterBySource(all, source).slice(0, cards);
  return e('section', { 'aria-labelledby': 'home-albums', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-albums', title: 'Albums you might love', page: 'Recommendations', view: 'recommendations', navigateTo,
      pageColor: PAGE_COLOR.recommendations,
    }),
    chips.length > 1 && e(SourceFilter, { sources: chips, value: source, onChange: setSource }),
    e('div', { style: grid(`repeat(${cards}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      shown.map((a, i) => e(HomeAlbumCard, Object.assign({ key: a.id || `${a.artist}-${a.title}-${i}`, album: a }, albumHandlers(props))))));
}

// Two halves side by side. Each is its own column at a fixed basis (half the
// row less half the gap), so a half that is alone stays half width, and a
// half still loading draws its skeleton in its own place while the other
// shows its cards. A half that is neither loading nor has cards is left out.
// A half of a two-panel row: a card that opens with a slim hero band copied
// from its page's hero (the same gradient classes, and the collapsed hero's
// uppercase light title and shadow), the sidebar's icon beside the title,
// and up to three album cards below on the page background. Fresh Drops +
// Critical Darlings on Home, Critical Darlings + Pop of the Tops in the
// getting-started layout's Explore row.
function homeHalf(props, { id, title, view, items, loading, hero, icon, error, onRetry }) {
  const { navigateTo, stacked = false } = props;
  return e('section', {
    key: id, 'aria-labelledby': id, 'aria-busy': loading ? 'true' : undefined,
    style: {
      flex: stacked ? '0 0 auto' : HOME_HALF_FLEX, minWidth: 0, display: 'flex', flexDirection: 'column',
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
          fontSize: '20px', fontWeight: 300, letterSpacing: '0.2em', textTransform: 'uppercase',
          color: ON_FILL, textShadow: HERO_TEXT_SHADOW, // on-color
        },
      }, icon, title),
      e('button', {
        type: 'button', 'aria-label': `See all in ${title}`, onClick: () => navigateTo && navigateTo(view),
        style: { font: 'inherit', fontSize: '13px', fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap', padding: 0, color: ON_FILL }, // on-color
      }, 'See all')),
    e('div', { style: Object.assign({ padding: `${HOME_HALF_PANEL_PAD}px` }, SECTION_STYLE) },
      error
        ? e(ErrorState, { compact: true, title: `Couldn’t load ${title}`, body: 'Check your connection, then try again.', onRetry })
        : loading
        ? e(CardRowSkeleton, { count: HOME_HALF_ROW_CARDS, lines: 1 })
        : e('div', { style: grid(`repeat(${HOME_HALF_ROW_CARDS}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
          items.slice(0, HOME_HALF_ROW_CARDS).map((a, i) => e(HomeAlbumCard, Object.assign({ key: a.id || `${a.artist}-${a.title}-${i}`, album: a }, albumHandlers(props)))))));
}

function FreshCriticalRow(props) {
  const { fresh, critical, freshLoading, criticalLoading, charts, chartsLoading, chartsError, onRetryCharts, stacked = false } = props;
  const f = Array.isArray(fresh) ? fresh : [];
  const c = Array.isArray(critical) ? critical : [];
  const p = Array.isArray(charts) ? charts : [];
  const showF = f.length > 0 || !!freshLoading;
  const showC = c.length > 0 || !!criticalLoading;
  // With no Fresh Drops (a new profile follows no artists yet), Pop of the
  // Tops takes its half, so Critical Darlings isn't left alone (#1493).
  const showP = !showF && (p.length > 0 || !!chartsLoading || !!chartsError);
  if (!showF && !showC && !showP) return null;
  return e('div', { style: { display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: `${HOME_HALF_GAP}px` } },
    showF && homeHalf(props, { id: 'home-fresh', title: 'Fresh Drops', view: 'new-releases', items: f, loading: f.length === 0, hero: FRESH_HERO, icon: DropletGlyph() }),
    showC && homeHalf(props, { id: 'home-critical', title: 'Critical Darlings', view: 'critics-picks', items: c, loading: c.length === 0, hero: CRITICAL_HERO, icon: TrophyGlyph() }),
    showP && homeHalf(props, { id: 'home-charts', title: 'Pop of the Tops', view: 'discover', items: p, loading: p.length === 0, error: p.length === 0 && !chartsLoading && !!chartsError, onRetry: onRetryCharts, hero: CHARTS_HERO, icon: ChartsGlyph() }));
}

// The getting-started layout's "Explore while you set up" (#1493): the two
// discovery pages that load with no setup, Critical Darlings and Pop of the
// Tops, in the same halves. A half whose page failed to load leaves the row.
function ExploreRow(props) {
  const { critical, charts, criticalLoading, chartsLoading, chartsError, onRetryCharts, stacked = false } = props;
  const c = Array.isArray(critical) ? critical : [];
  const p = Array.isArray(charts) ? charts : [];
  const showC = c.length > 0 || !!criticalLoading;
  // A failed load keeps its half, with Try again, rather than vanishing.
  const showP = p.length > 0 || !!chartsLoading || !!chartsError;
  return e('section', { 'aria-labelledby': 'home-explore', style: SECTION_STYLE },
    e(SectionHeader, { id: 'home-explore', title: 'Explore while you set up', sub: 'Albums critics love, and the most played right now. Playing needs a connected service; Bandcamp plays some of these already.' }),
    (showC || showP) && e('div', { style: { display: 'flex', flexDirection: stacked ? 'column' : 'row', gap: `${HOME_HALF_GAP}px` } },
      showC && homeHalf(props, { id: 'home-explore-critical', title: 'Critical Darlings', view: 'critics-picks', items: c, loading: c.length === 0, hero: CRITICAL_HERO, icon: TrophyGlyph() }),
      showP && homeHalf(props, { id: 'home-explore-charts', title: 'Pop of the Tops', view: 'discover', items: p, loading: p.length === 0, error: p.length === 0 && !chartsLoading && !!chartsError, onRetry: onRetryCharts, hero: CHARTS_HERO, icon: ChartsGlyph() })));
}

// A concert card is not clickable as a whole: Tickets is its only action
// (the shared teal button, components/tickets-button.js).

// The concert card's photo and its date badge. The photo is the artist's
// (the Concerts page's images, face-centred); with none yet, the page's
// grey with a note. The date sits on it as a badge in the Concerts hero's
// teal, as Tickets is.
const CONCERT_ART = 72;
const CONCERT_BADGE_STYLE = {
  position: 'absolute', left: '4px', bottom: '4px', padding: '2px 6px', borderRadius: '4px',
  fontSize: '11px', fontWeight: 700, lineHeight: '16px', letterSpacing: '.04em', textTransform: 'uppercase',
  backgroundColor: PAGE_COLORS.concerts.color, color: ON_FILL,
  whiteSpace: 'nowrap',
};

function ConcertCard({ concert, image }) {
  const d = concert.date ? new Date(`${concert.date}T00:00:00`) : null;
  const valid = d && !Number.isNaN(d.getTime());
  const mon = valid ? d.toLocaleDateString('en-US', { month: 'short' }) : '';
  const day = valid ? d.getDate() : '';
  const venue = concert.venue || {};
  // The venue, then its city and state on a line of their own.
  const city = [venue.city, venue.region, venue.country].filter(Boolean).join(', ');
  const sellers = (concert.ticketSources || []).filter((s) => s && isHttpUrl(s.ticketUrl));
  const photo = image && isHttpUrl(image.url) ? image : null;
  return e('div', {
    style: {
      display: 'flex', alignItems: 'center', gap: '12px', padding: '10px', borderRadius: '16px', minWidth: 0,
      border: '1px solid var(--border-default)',
    },
  },
    e('div', {
      style: {
        position: 'relative', flex: `0 0 ${CONCERT_ART}px`, height: `${CONCERT_ART}px`, borderRadius: '10px',
        overflow: 'hidden', backgroundColor: 'var(--bg-secondary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      },
    },
      photo
        ? e('img', {
          src: photo.url, alt: '', loading: 'lazy',
          style: { width: '100%', height: '100%', objectFit: 'cover', objectPosition: photo.facePosition || 'center 25%' },
        })
        : e('span', { 'aria-hidden': 'true', style: { fontSize: '24px', color: 'var(--text-tertiary)' } }, '\u266A'),
      valid && e('span', { style: CONCERT_BADGE_STYLE }, `${mon} ${day}`)),
    e('div', { style: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
      e('span', { style: Object.assign({ fontSize: '14px', fontWeight: 600, color: 'var(--text-primary)' }, ELLIPSIS) }, concert.artist),
      e('span', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)' }, ELLIPSIS) }, venue.name || 'Venue TBA'),
      city && e('span', { style: Object.assign({ fontSize: '12px', color: 'var(--text-secondary)' }, ELLIPSIS) }, city),
      // In a box of its own, so the card's column doesn't stretch it: one
      // seller and several are the same width, on the card's right edge.
      sellers.length > 0 && e('div', { style: { display: 'flex', justifyContent: 'flex-end', marginTop: '4px' } },
        e(TicketsButton, { sources: sellers, artist: concert.artist, size: 'sm' }))));
}

// artistImages: the Concerts page's photos, keyed by lower-cased artist name
// ({ url, facePosition }).
function ConcertsRow({ concerts, navigateTo, artistImages, cards = HOME_CONCERT_CARDS }) {
  const list = Array.isArray(concerts) ? concerts.slice(0, cards) : [];
  if (list.length === 0) return null;
  return e('section', { 'aria-labelledby': 'home-concerts', style: SECTION_STYLE },
    e(SectionHeader, {
      id: 'home-concerts', title: 'Concerts near you', sub: 'Artists from your collection playing soon',
      page: 'Concerts', view: 'concerts', navigateTo, pageColor: PAGE_COLOR.concerts,
    }),
    e('div', { style: grid(`repeat(${cards}, minmax(0, 1fr))`, `${HOME_ROW_GAP}px`) },
      list.map((c, i) => e(ConcertCard, {
        key: c.id || i, concert: c,
        image: artistImages && c.artist ? artistImages[c.artist.trim().toLowerCase()] : null,
      }))));
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
  // Shuffleupagus's mark, the same disc as the badges on its picks, so the
  // box and the badges read as one thing.
  const heading = e('h2', {
    id: 'home-ask',
    style: Object.assign({}, H2_STYLE, { fontSize: '16px', display: 'flex', alignItems: 'center', gap: '8px' }),
  }, e(ReasonMark, null), 'Ask Shuffleupagus');
  // What Shuffleupagus is (#1387): the box never said.
  const explain = e('p', { id: 'home-ask-what', style: { margin: 0, fontSize: '13px', lineHeight: 1.5, color: 'var(--text-secondary)' } },
    'Shuffleupagus is Parachord’s AI DJ. Ask for a playlist, a mood or a question about music, and it answers with songs you can play, using the AI plug-in you choose.');
  if (chatAvailable === false) {
    return e('section', { 'aria-labelledby': 'home-ask', 'aria-describedby': 'home-ask-what', style: box },
      heading,
      explain,
      e('div', null,
        React.createElement(Button, { variant: 'primary', onClick: () => onSetup && onSetup() }, 'Set up Shuffleupagus')));
  }
  // The example reads as a suggestion (tertiary text) until it's edited.
  const isExample = !touched.current && !!value && value === (initialPrompt || '');
  const submit = (ev) => {
    ev.preventDefault();
    const text = value.trim().slice(0, PROMPT_CAP);
    if (text && onAsk) onAsk(text);
  };
  return e('section', { 'aria-labelledby': 'home-ask', 'aria-describedby': 'home-ask-what', style: box },
    heading,
    explain,
    e('form', { onSubmit: submit, style: { display: 'flex', flexWrap: 'wrap', gap: '10px', alignItems: 'center', margin: 0 } },
      e('label', {
        htmlFor: 'home-ask-prompt',
        style: { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' },
      }, 'Prompt for Shuffleupagus'),
      // The shared text field (components/fields.js), large; an example
      // prompt reads as a placeholder until it's edited.
      e(TextField, {
        id: 'home-ask-prompt', size: 'lg', muted: isExample, maxLength: PROMPT_CAP, value,
        onChange: (v) => { touched.current = true; setValue(v); },
        style: { flex: '1 1 360px', minWidth: 0 },
      }),
      React.createElement(Button, { variant: 'primary', type: 'submit', className: '!rounded-full min-h-[48px] !px-5' }, 'Ask')),
    e('div', { style: { fontSize: '12px', color: 'var(--text-secondary)' } },
      'An example built from what you’ve been playing. Edit it, or ask for anything.'));
}

module.exports = {
  JumpBackIn, AlbumCard: HomeAlbumCard, PlaylistCard, SourceFilter, MixesRow, PlaylistsRow, AlbumsRow,
  FreshCriticalRow, ExploreRow, ConcertsRow, AskShuffleupagus, ArtBox,
};
