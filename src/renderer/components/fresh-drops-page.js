// src/renderer/components/fresh-drops-page.js: the Fresh Drops page
// (activeView 'new-releases'): new releases from artists in the Collection
// and listening history (#1451, moved out of app.js).
//
// A React.memo'd page fed stable props, like Home, Collection, the playlist
// view, the artist page and Search: state, setters and refs by value, plain
// functions through useStableHandlers (FRESH_DROPS_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). Its hero, filter chips, filter box,
// album cards, skeleton and empty/error states are the shared components.
// Loads under plain Node: globalThis, not window, at module scope.

const Icons = require('./icons');
const { PageHero } = require('./page-hero');
const { FilterChips } = require('./filter-chips');
const { FilterBox } = require('./filter-box');
const { EmptyState, ErrorState } = require('./states');
const { CardSkeleton } = require('./home-skeletons');
const { AlbumCard } = require('./album-card');
const { PAGE_COLORS } = require('../lib/page-colors');
const { RELEASE_TYPE_COLORS } = require('../lib/release-types');
const { releaseMenu } = require('../lib/item-menus');

const FRESH_DROPS_PAGE_HANDLERS = [
  'albumCardActions',
  'copyParachordLink',
  'fetchAlbumTracksFromMusicBrainz',
  'fetchArtistData',
  'handleNewReleasesScroll',
  'loadNewReleases',
  'openChartsAlbum',
  'prefetchChartsTracks',
  'retryBrokenListArt',
  'showToast',
];

const TYPE_CHIPS = [
  { value: 'all', label: 'All' },
  { value: 'album', label: 'Albums', color: RELEASE_TYPE_COLORS.album },
  { value: 'ep', label: 'EPs', color: RELEASE_TYPE_COLORS.ep },
  { value: 'single', label: 'Singles', color: RELEASE_TYPE_COLORS.single },
];

// "Coming Dec 5, 2026" for a release still ahead, else its date.
function releaseDateLine(date) {
  if (!date) return null;
  const d = new Date(date + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const isFuture = d > today;
  const formatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  return React.createElement('span', { style: { color: isFuture ? 'var(--accent-secondary)' : 'var(--text-tertiary)' } }, isFuture ? `Coming ${formatted}` : formatted);
}

// Why a release is in Fresh Drops.
function releaseReason(release) {
  if (release.artistSource === 'collection') return `${release.artist} is in your Collection`;
  if (release.artistSource === 'history') return `Based on your listening history of ${release.artist}`;
  return `${release.artist} is in your library`;
}

const FreshDropsPage = React.memo(function FreshDropsPage(props) {
  const {
    albumCardActions,
    cacheLoaded,
    collectionData,
    copyParachordLink,
    fetchAlbumTracksFromMusicBrainz,
    fetchArtistData,
    handleNewReleasesScroll,
    loadNewReleases,
    newReleases,
    newReleasesArtWriterRef,
    newReleasesError,
    newReleasesFilter,
    newReleasesHeaderCollapsed,
    newReleasesLoaded,
    newReleasesLoading,
    newReleasesSearch,
    newReleasesSearchOpen,
    openChartsAlbum,
    prefetchChartsTracks,
    prefetchedReleases,
    retryBrokenListArt,
    setNewReleasesError,
    setNewReleasesFilter,
    setNewReleasesLoaded,
    setNewReleasesSearch,
    setNewReleasesSearchOpen,
    showToast,
  } = props;
  const e = React.createElement;
  const countLabel = newReleases.length > 0 ? `${newReleases.length} Releases` : '';

  // The grid's releases after the type filter and the filter box.
  const filtered = React.useMemo(() => {
    let list = newReleases;
    if (newReleasesFilter !== 'all') list = list.filter((r) => r.releaseType === newReleasesFilter);
    const q = newReleasesSearch.trim().toLowerCase();
    if (q) list = list.filter((r) => r.title.toLowerCase().includes(q) || r.artist.toLowerCase().includes(q));
    return list;
  }, [newReleases, newReleasesFilter, newReleasesSearch]);

  const chips = TYPE_CHIPS.map(({ value, label, color }) => {
    const count = value === 'all' ? newReleases.length : newReleases.filter((r) => r.releaseType === value).length;
    if (count === 0 && value !== 'all') return null;
    return { id: value, label: `${label} (${count})`, color };
  }).filter(Boolean);

  const card = (release, index) => e(AlbumCard, Object.assign({
    key: release.id,
    role: 'listitem',
    album: { id: release.id, title: release.title, artist: release.artist, imageUrl: release.albumArt },
    // undefined: its cover isn't looked up yet (a shimmer); null: it has
    // none (the placeholder).
    imageLoading: release.albumArt === undefined,
    releaseType: release.releaseType,
    subtitle: releaseDateLine(release.date),
    tooltip: releaseReason(release),
    animationDelay: Math.min(index, 20) * 30,
    // The card waits 250ms before this (its own dwell).
    onHoverPrefetch: () => prefetchChartsTracks(release),
    onOpen: () => openChartsAlbum({ artist: release.artist, title: release.title, albumArt: release.albumArt, releaseGroupId: release.id, date: release.date, releaseType: release.releaseType }),
    onOpenArtist: () => fetchArtistData(release.artist),
    onContextMenu: () => {
      const prefetched = prefetchedReleases[release.id];
      globalThis.showItemMenu(releaseMenu({ ...release, releaseGroupMbid: release.id }, { tracks: prefetched?.tracks }));
    },
    // A dead cached cover: retry once and patch the release, the persisted
    // copy (cache_new_releases) included.
    onArtError: () => retryBrokenListArt(release.albumArt, { artist: release.artist, album: release.title, id: release.id, cacheId: release.id }, (id, fresh) => {
      newReleasesArtWriterRef.current.queue(id, fresh);
      newReleasesArtWriterRef.current.flush();
    }),
  }, albumCardActions({
    title: release.title,
    artist: release.artist,
    getTracks: async () => {
      const have = prefetchedReleases[release.id]?.tracks;
      if (have?.length) return have;
      showToast(`Loading ${release.title}…`);
      return fetchAlbumTracksFromMusicBrainz(release.artist, release.title, release.albumArt);
    },
  })));

  const showGrid = !newReleasesError && newReleases.length > 0;
  const filtering = newReleasesFilter !== 'all' || newReleasesSearch.trim();

  return e('div', { className: 'flex-1 flex flex-col h-full', style: { overflow: 'hidden', minHeight: 0 } },
    // Header (outside the scrolling area).
    e(PageHero, {
      collapsed: newReleasesHeaderCollapsed,
      page: 'new-releases',
      title: 'Fresh Drops',
      onTitleContextMenu: copyParachordLink,
      expanded: e(React.Fragment, null,
        e('div', { className: 'flex items-center gap-1 mt-6', style: { textShadow: 'var(--hero-text-shadow-line)' } },
          e('span', { className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white' }, countLabel)),
        e('p', { className: 'mt-2 text-white/80 text-sm' }, 'New music from artists in your collection and listening history')),
      collapsedContent: e(React.Fragment, null,
        e('div', { className: 'flex-1' }),
        e('span', { className: 'text-sm font-medium uppercase tracking-wider text-white/80' }, countLabel)),
    }),
    // Filter bar (outside the scrolling area): the type chips, All neutral
    // and each type in its colour, and the filter box.
    e('div', {
      className: 'flex items-center px-6 py-3',
      style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' },
    },
      e(FilterChips, { pageColor: PAGE_COLORS['new-releases'].color, chips, value: newReleasesFilter, onChange: setNewReleasesFilter, label: 'Filter releases by type' }),
      e('div', { className: 'flex-1' }),
      e(FilterBox, { value: newReleasesSearch, onChange: setNewReleasesSearch, open: newReleasesSearchOpen, onOpenChange: setNewReleasesSearchOpen })),
    // Content (scrolls).
    e('div', {
      className: 'scrollable-content scroll-edge',
      style: { flex: 1, overflowY: 'scroll', pointerEvents: 'auto', padding: '24px' },
      onScroll: handleNewReleasesScroll,
    },
      newReleasesError && !newReleasesLoading && e(ErrorState, {
        title: 'Couldn’t load Fresh Drops',
        body: newReleasesError,
        onRetry: () => { setNewReleasesError(null); setNewReleasesLoaded(false); loadNewReleases(true); },
      }),
      // The skeleton: the grid's own card box.
      !newReleasesError && (newReleasesLoading || !cacheLoaded) && newReleases.length === 0 && e('div', { className: 'card-grid gap-4' },
        Array.from({ length: 12 }).map((_, i) => e(CardSkeleton, { key: `skeleton-${i}`, index: i, lines: 2 }))),
      !newReleasesError && !newReleasesLoading && newReleasesLoaded && newReleases.length === 0 && e(EmptyState, {
        title: 'Nothing in Fresh Drops yet',
        body: collectionData.artists?.length === 0 && collectionData.tracks?.length === 0
          ? 'Add artists to your Collection or listen to some music to see new releases from artists you like.'
          : 'None of your artists have released new music in the last 3 months. Check back later.',
      }),
      showGrid && filtered.length === 0 && filtering && e(EmptyState, { compact: true, icon: Icons.Search, title: 'No releases match your filters' }),
      showGrid && filtered.length > 0 && e('div', null,
        // The shared album card (components/album-card.js).
        e('div', { role: 'list', className: 'card-grid gap-4' }, filtered.map(card)))));
});

module.exports = { FreshDropsPage, FRESH_DROPS_PAGE_HANDLERS, releaseDateLine, releaseReason };
