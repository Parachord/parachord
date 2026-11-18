// src/renderer/components/home-page.js: the Home page (spec:
// docs/superpowers/specs/2026-11-12-home-redesign-design.md). Top to bottom:
// the announcement banner, the header (greeting, what changed, the setup
// checklist, Play Collection Radio), Jump back in, Made from your listening,
// Your playlists, Albums you might love, Fresh Drops + Critical Darlings,
// Concerts near you, Ask Shuffleupagus. The rows and cards are props-driven
// components in home-sections.js; this module prepares their data and
// wires their actions.
//
// React.memo, fed only stable props: state values, useState setters, refs,
// useMemo results, and Parachord's plain functions as stable wrappers
// (useStableHandlers in app.js; the list is HOME_PAGE_HANDLERS).
// tests/renderer/page-memo.test.js checks the call site.
//
// Nothing here runs on the first-paint path: the network loads wait for
// requestIdleCallback, and covers resolve after paint through getAlbumArt
// (background lane) into one coalesced map.

const { CollectionRadioButton } = require('./collection-radio-button');
const { HomeBanner } = require('./home-banner');
const { HomeSetupButton } = require('./home-setup');
// (Single-line destructures above the props one: page-memo.test.js reads
// the first multi-line `const {` block as the props list.)
const { JumpBackIn, MixesRow, PlaylistsRow, AlbumsRow, FreshCriticalRow, ExploreRow, ConcertsRow, AskShuffleupagus } = require('./home-sections');
const { GettingStarted, GettingStartedSkeleton } = require('./home-getting-started');
const { JumpBackInSkeleton, CardRowSkeleton, ConcertRowSkeleton, HOME_HALF_ROW_CARDS, HOME_ROW_CARDS, homeRowCards, homeConcertCards, homeHalvesStacked } = require('./home-skeletons');
// The app's section title, which a loading row's heading uses.
const { SECTION_TITLE_STYLE: H2_STYLE } = require('./section-header');
const { homeSetupItems } = require('../lib/home-setup');
const { freshestPlaylists, recentLoves, changeBadge, freshChangeLine, jumpBackInTiles } = require('../lib/home-model');
const { playlistSubtitle, homeSections, exampleShufflePrompt, homeTopArtists, albumsNeedingArt, lovesMosaicAlbums } = require('../lib/home-model');
const { trackSlug } = require('../lib/track-slug');
const { countOf } = require('../lib/plural');

// Plain functions from Parachord, passed as stable wrappers.
const HOME_PAGE_HANDLERS = [
  'addServicePlaylistToPlaylist',
  'addToQueue',
  'askShuffleupagus',
  'connectPlugin',
  'copyParachordLink',
  'dismissHomeBanner',
  'dismissHomeSetupItem',
  'fetchAlbumTracksByName',
  'getAlbumArt',
  'handleAddWatchFolder',
  'handleCollectionAlbumClick',
  'handleStartCollectionStation',
  'loadCharts',
  'loadConcerts',
  'loadCriticsPicks',
  'loadHomeHistoryMixes',
  'loadHomeRecommendations',
  'loadNewReleases',
  'loadPlaylist',
  'navigateTo',
  'openChartsAlbum',
  'openCriticsPicksAlbum',
  'openHomeBannerCta',
  'openPluginPanel',
  'openServicePlaylist',
  'openTopAlbum',
  'openWhatsNew',
  'playServicePlaylist',
  'playTrackCollection',
  'prefetchTopAlbumTracks',
  'queueServicePlaylist',
  'showHomeContextMenu',
  'skipGettingStarted',
  'startGettingStarted',
];

// Playing recent loves from Home: the context isActiveContext matches.
const LOVES_CONTEXT = { type: 'loves', name: 'Recent Loves' };


const artKey = (artist, album) => `${artist || ''}\u0000${album || ''}`.toLowerCase();

const greetingFor = (hour) => {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
};

// A playlist's tracks with the ids every no-album context keys on.
const playlistTracks = (p) => (p.tracks || []).map((t) => ({
  ...t,
  id: trackSlug(t.artist || 'unknown', t.title || 'untitled'),
  sources: {},
}));

// A loading row: its heading, then the skeleton in the row's grid.
const skeletonSection = (key, title, body) => React.createElement('section', {
  key, 'aria-busy': 'true', style: { display: 'flex', flexDirection: 'column', gap: '14px', minWidth: 0 },
}, React.createElement('h2', { style: H2_STYLE }, title), body);

// The collapsed page hero's height (the other pages' collapsed heroes), Home's
// gradient (centred on violet-600, the sidebar's accent #7c3aed) and the
// circle pattern Home's hero always had.
const HOME_HERO_HEIGHT = 80;
const HOME_HERO_GRADIENT = require('../lib/page-colors').PAGE_COLORS.home.hero;
const HOME_HERO_PATTERN = 'url("data:image/svg+xml,%3Csvg width=\'100\' height=\'100\' viewBox=\'0 0 100 100\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'%23ffffff\'%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'40\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'2\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'25\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1.5\'/%3E%3Ccircle cx=\'50\' cy=\'50\' r=\'10\' fill=\'none\' stroke=\'%23fff\' stroke-width=\'1\'/%3E%3C/g%3E%3C/svg%3E")';

const HomePage = React.memo(function HomePage(props) {
  const {
    addServicePlaylistToPlaylist,
    addToQueue,
    allPlaylistCovers,
    appVersion,
    askShuffleupagus,
    bannerItems,
    cacheLoaded,
    charts,
    chartsError,
    chartsLoaded,
    chartsLoading,
    chatAvailable,
    collectionData,
    collectionLoading,
    concerts,
    contentWidth,
    concertsArtistImages,
    concertsError,
    concertsLoaded,
    concertsLoading,
    concertsLocation,
    connectPlugin,
    copyParachordLink,
    criticsPicks,
    criticsPicksError,
    criticsPicksLoaded,
    criticsPicksLoading,
    dismissHomeBanner,
    dismissHomeSetupItem,
    extensionConnected,
    fetchAlbumTracksByName,
    getAlbumArt,
    gettingStarted,
    handleAddWatchFolder,
    handleCollectionAlbumClick,
    handleStartCollectionStation,
    homeActive,
    homeData,
    homeSetupDismissed,
    library,
    loadCharts,
    loadConcerts,
    loadCriticsPicks,
    loadHomeHistoryMixes,
    loadHomeRecommendations,
    loadNewReleases,
    loadPlaylist,
    mixes,
    navigateTo,
    newReleases,
    newReleasesError,
    newReleasesLoaded,
    newReleasesLoading,
    openChartsAlbum,
    openCriticsPicksAlbum,
    openHomeBannerCta,
    openPluginPanel,
    openServicePlaylist,
    openTopAlbum,
    openWhatsNew,
    playServicePlaylist,
    playTrackCollection,
    playlists,
    playlistsLoading,
    prefetchTopAlbumTracks,
    queueServicePlaylist,
    recommendationAlbums,
    recommendations,
    setAddToPlaylistPanel,
    setCollectionSort,
    setCollectionTab,
    setExtensionInfoOpen,
    setSettingsTab,
    setShowUrlImportDialog,
    showHomeContextMenu,
    showToast,
    skipGettingStarted,
    startGettingStarted,
    sourceColors,
    watchFolders,
    whatsNewUnread,
  } = props;
  // Card counts that fit the content width (#1389); the skeletons use the same.
  const rowCards = homeRowCards(contentWidth);
  const concertCards = homeConcertCards(contentWidth);

  // ---------------------------------------------------------------- setup

  // The pill: the getting-started steps when they were skipped before they
  // were done, the browser extension, and What's New. Connecting a service
  // and a scrobbler are the getting-started layout's steps (#1493).
  const gettingStartedLeft = !!(gettingStarted && gettingStarted.left);
  const homeSetup = React.useMemo(() => homeSetupItems({
    gettingStartedLeft,
    extensionConnected,
    dismissed: homeSetupDismissed,
    appVersion,
    whatsNewUnread,
  }), [gettingStartedLeft, extensionConnected, homeSetupDismissed, appVersion, whatsNewUnread]);

  const onSetupAction = (id) => {
    // Brings the getting-started layout back, steps as they were.
    if (id === 'getting-started') startGettingStarted();
    else if (id === 'browser-extension') setExtensionInfoOpen(true);
  };

  // ------------------------------------------------------- background loads

  // One effect, after first paint. Recommendations and the history mixes
  // load on every visit unless a load is running or one answered within 10
  // minutes (loadHomeRecommendations and loadHomeHistoryMixes in app.js):
  // each provider that answered within the hour is served from its cache and
  // only the stale ones are asked, as the Recommendations page does on each
  // visit. The other loaders run only
  // while their data isn't loaded (or failed), so a return visit refetches
  // nothing. Concerts load only with a location set, since the row hides
  // without one.
  React.useEffect(() => {
    if (!cacheLoaded) return undefined;
    const run = () => {
      loadHomeRecommendations();
      loadHomeHistoryMixes();
      // Not before the collection loads: the scan would find no artists.
      // app.js's background effect starts it once the collection is in.
      if (!collectionLoading && !newReleasesLoaded && !newReleasesLoading) loadNewReleases();
      if (!criticsPicksLoaded && !criticsPicksLoading) loadCriticsPicks();
      if (concertsLocation && !concertsLoaded && !concertsLoading && !concertsError) loadConcerts();
    };
    const idle = globalThis.requestIdleCallback;
    if (typeof idle === 'function') {
      const id = idle(run);
      return () => { if (globalThis.cancelIdleCallback) globalThis.cancelIdleCallback(id); };
    }
    const timer = setTimeout(run, 0);
    return () => clearTimeout(timer);
    // Keyed on mount and the cache restore: the guards above read this
    // render's values, and the loaders guard against re-entry themselves.
  }, [cacheLoaded]);

  // Pop of the Tops: in the getting-started layout, and in Fresh Drops' half
  // while Fresh Drops has nothing (#1493). One request; a return visit
  // refetches nothing.
  const setupShown = !!(gettingStarted && gettingStarted.show);
  React.useEffect(() => {
    if (!cacheLoaded) return;
    if (!chartsLoaded && !chartsLoading && !chartsError) loadCharts();
  }, [cacheLoaded]);

  // ------------------------------------------------------------------- art

  // Covers Home asks getAlbumArt for, in one coalesced map (one render per
  // batch, never one per cover). Only answers to requests land here.
  const [art, setArt] = React.useState({});
  const artWriter = React.useRef(null);
  if (!artWriter.current) {
    const apply = (batch) => setArt((prev) => {
      const next = { ...prev };
      for (const [key, ops] of batch) next[key] = ops[ops.length - 1].value;
      return next;
    });
    const make = globalThis.createCoalescedUpdater;
    artWriter.current = typeof make === 'function'
      ? make(apply, 100)
      : { queue: (key, value) => apply(new Map([[key, [{ value }]]])) };
  }
  const artRequested = React.useRef(new Set());
  const brokenArt = React.useRef(new Set());
  const usable = (url) => (url && !brokenArt.current.has(url) ? url : null);
  const coverFor = (artist, album, own) => usable(own) || usable(art[artKey(artist, album)]) || null;
  const requestArt = (artist, album) => {
    if (!artist || !album) return;
    const key = artKey(artist, album);
    if (artRequested.current.has(key)) return;
    artRequested.current.add(key);
    Promise.resolve(getAlbumArt(artist, album))
      .then((url) => artWriter.current.queue(key, url || null))
      .catch(() => artWriter.current.queue(key, null));
  };
  // A cover that failed: drop it, and report it so the art pipeline retries
  // (the album-art rule). A fresh cover lands in the same map.
  const reportBroken = (url, artist, album) => {
    if (!url) return;
    brokenArt.current.add(url);
    const key = artKey(artist, album);
    artWriter.current.queue(key, art[key] && art[key] !== url ? art[key] : null);
    const report = globalThis.reportBrokenAlbumArt;
    if (report && artist && album) {
      report(url, { artist, album }).then((fresh) => {
        if (fresh) artWriter.current.queue(key, fresh);
      }).catch(() => {});
    }
  };

  // ------------------------------------------------------------ local data

  const loves = React.useMemo(() => recentLoves(collectionData.tracks, 50), [collectionData.tracks]);

  const tilesRaw = React.useMemo(
    () => jumpBackInTiles({ playlists, loves, mixes, active: homeActive }),
    [playlists, loves, mixes, homeActive],
  );
  const lovesCover = React.useMemo(() => (loves.length > 0
    ? { imageUrl: coverFor(loves[0].artist, loves[0].album, loves[0].albumArt), artist: loves[0].artist, title: loves[0].album }
    : null), [loves, art]);
  const tiles = React.useMemo(() => tilesRaw.map((tile) => {
    if (tile.kind === 'playlist') {
      // The playlist's own cover (a provider import's coverArt) wins over the
      // track mosaic (ArtBox prefers imageUrl); the mosaic stays the fallback.
      return { ...tile, imageUrl: tile.item.coverArt || null, mosaic: allPlaylistCovers[tile.item.id] || null };
    }
    if (tile.kind === 'loves') return { ...tile, imageUrl: lovesCover && lovesCover.imageUrl };
    if (tile.kind === 'album') {
      const { album, artist } = tile.item;
      const own = (loves.find((t) => t.album === album && t.artist === artist && t.albumArt) || {}).albumArt;
      const imageUrl = coverFor(artist, album, own);
      return { ...tile, imageUrl, item: { ...tile.item, imageUrl, title: album } };
    }
    return tile;
  }), [tilesRaw, allPlaylistCovers, lovesCover, loves, art]);

  // Recent Loves as Made from your listening's lead card: a mosaic of the
  // newest loved albums (a single cover until four have art).
  const lovesAlbums = React.useMemo(() => lovesMosaicAlbums(loves), [loves]);
  const lovesCard = React.useMemo(() => {
    if (loves.length === 0) return null;
    const covers = lovesAlbums.map((a) => coverFor(a.artist, a.album, a.albumArt)).filter(Boolean);
    return {
      id: 'recent-loves', title: 'Recent Loves',
      subtitle: loves.length === 1 ? 'Your latest love' : `Your ${loves.length} latest loves`,
      mosaic: covers.length >= 4 ? covers : null,
      imageUrl: covers.length >= 4 ? null : (covers[0] || null),
    };
  }, [loves, lovesAlbums, art]);

  const homePlaylists = React.useMemo(() => {
    const now = Date.now();
    return freshestPlaylists(playlists, 6).map((p) => ({
      ...p,
      badge: changeBadge(p, now),
      subtitle: playlistSubtitle(p, now),
      // The playlist's own cover (a provider import's coverArt) wins over the
      // track mosaic (ArtBox prefers imageUrl); the mosaic stays the fallback.
      imageUrl: p.coverArt || null,
      mosaic: allPlaylistCovers[p.id] || null,
    }));
  }, [playlists, allPlaylistCovers]);

  const changeLine = React.useMemo(
    () => freshChangeLine(freshestPlaylists(playlists, 1)[0], Date.now()),
    [playlists],
  );

  // ----------------------------------------------------------- album rows

  // The cover map (`art`) is a dependency: coverFor reads it, and a broken
  // URL is dropped by a write to it.
  const albums = React.useMemo(
    () => (recommendationAlbums || []).map((a) => ({ ...a, imageUrl: coverFor(a.artist, a.title, a.imageUrl) })),
    [recommendationAlbums, art],
  );
  // A Fresh Drops card carries its releaseType, which AlbumCard badges the
  // way the Fresh Drops page does.
  const fresh = React.useMemo(() => (newReleases || []).slice(0, HOME_HALF_ROW_CARDS).map((r) => ({
    ...r, imageUrl: coverFor(r.artist, r.title, r.albumArt), homeRow: 'fresh',
  })), [newReleases, art]);
  const critical = React.useMemo(() => (criticsPicks || []).slice(0, HOME_HALF_ROW_CARDS)
    .map((c) => ({ ...c, imageUrl: coverFor(c.artist, c.title, c.albumArt), homeRow: 'critical' })), [criticsPicks, art]);

  const chartCards = React.useMemo(() => (charts || []).slice(0, HOME_HALF_ROW_CARDS)
    .map((c) => ({ ...c, imageUrl: coverFor(c.artist, c.title, c.albumArt), homeRow: 'charts' })), [charts, art]);

  // Covers Home resolves itself: the album tile and recommended albums that
  // came without one (the first six of the whole list and of each source's,
  // so a source chip never shows uncovered cards). Fresh Drops and Critical
  // Darlings resolve their own; a cover of theirs that fails is retried into
  // this map (reportBroken).
  React.useEffect(() => {
    for (const tile of tilesRaw) {
      if (tile.kind !== 'album') continue;
      const { album, artist } = tile.item;
      if (!loves.some((t) => t.album === album && t.artist === artist && t.albumArt)) requestArt(artist, album);
    }
    if (loves.length > 0 && !loves[0].albumArt) requestArt(loves[0].artist, loves[0].album);
    for (const a of lovesAlbums) if (!a.albumArt) requestArt(a.artist, a.album);
    for (const a of albumsNeedingArt(recommendationAlbums, HOME_ROW_CARDS)) {
      if (!a.imageUrl) requestArt(a.artist, a.title);
    }
  }, [tilesRaw, loves, lovesAlbums, recommendationAlbums]);

  const onArtError = (item) => {
    const target = Array.isArray(item) ? lovesCover : item;
    if (!target || !target.imageUrl) return;
    reportBroken(target.imageUrl, target.artist, target.title || target.album);
  };

  // ---------------------------------------------------------------- actions

  const albumTracks = async (album) => {
    const own = (collectionData.tracks || [])
      .filter((t) => t.artist === album.artist && t.album === album.title)
      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
    if (own.length > 0) return own;
    return (await fetchAlbumTracksByName(album.artist, album.title, album.imageUrl || null)) || [];
  };
  const withAlbumTracks = (album, use) => albumTracks(album).then((tracks) => {
    if (tracks.length > 0) use(tracks);
    else showToast(`Couldn't load the tracks on ${album.title}`, 'error');
  }).catch(() => showToast(`Couldn't load the tracks on ${album.title}`, 'error'));
  const albumContext = (album) => ({ type: 'album', name: album.title, artist: album.artist });
  const albumActions = {
    onPlay: (album) => withAlbumTracks(album, (tracks) => playTrackCollection(tracks, albumContext(album))),
    onQueue: (album) => withAlbumTracks(album, (tracks) => {
      addToQueue(tracks, albumContext(album));
    }),
    onAddToPlaylist: (album) => withAlbumTracks(album, (tracks) => setAddToPlaylistPanel({
      open: true, tracks, sourceName: `${album.title} by ${album.artist}`, sourceType: 'album',
    })),
    onContextMenu: (ev, album) => showHomeContextMenu('album', album),
    onHoverPrefetch: (album) => prefetchTopAlbumTracks(album.artist, album.title, album.imageUrl || null),
    onArtError,
  };
  const openAlbum = (album) => handleCollectionAlbumClick({ title: album.title, artist: album.artist, albumArt: album.imageUrl || null });

  const playPlaylist = (p) => {
    const tracks = playlistTracks(p);
    if (tracks.length === 0) { loadPlaylist(p); return; }
    playTrackCollection(tracks, { type: 'playlist', id: p.id, name: p.title });
  };
  const queuePlaylist = (p) => {
    const tracks = playlistTracks(p);
    if (tracks.length === 0) return;
    addToQueue(tracks, { type: 'playlist', id: p.id, name: p.title });
  };
  const playlistActions = {
    onOpen: (p) => loadPlaylist(p),
    onPlay: playPlaylist,
    onQueue: queuePlaylist,
    // As the Playlists page's card: the playlist's tracks into the panel.
    onAddToPlaylist: (p) => { const tracks = playlistTracks(p); if (tracks.length > 0) setAddToPlaylistPanel({ open: true, tracks, sourceName: p.title, sourceType: 'playlist' }); },
    onContextMenu: (ev, p) => showHomeContextMenu('playlist', p),
    onArtError,
  };
  // A service mix: the card opens the remote-playlist view the
  // Recommendations cards open, and Add to Playlist, Play and Add to Queue
  // (the hover every playlist card has) load its tracks through the same
  // lookup. The 'mix' context lets Jump back in leave the
  // mix out while it plays or waits in the queue.
  const mixContext = (m) => ({ type: 'mix', id: m.id, name: m.title });
  const openMix = (m) => openServicePlaylist(m, m.resolverName);
  const mixActions = {
    onOpen: openMix,
    onPlay: (m) => playServicePlaylist(m, mixContext(m)),
    onQueue: (m) => queueServicePlaylist(m, mixContext(m)),
    onAddToPlaylist: addServicePlaylistToPlaylist,
    // No context menu: a service mix has no library copy to act on.
    onArtError,
  };

  // Jump back in: the tile opens its page, its Play button plays it.
  // Recent Loves opens Collection's songs, newest loved first.
  const onOpenTile = (tile) => {
    if (tile.kind === 'playlist') loadPlaylist(tile.item);
    else if (tile.kind === 'mix') openMix(tile.item);
    else if (tile.kind === 'album') openAlbum({ title: tile.item.album, artist: tile.item.artist, imageUrl: tile.imageUrl || tile.item.imageUrl || null });
    else if (tile.kind === 'loves') {
      navigateTo('library');
      setCollectionTab('tracks');
      setCollectionSort((prev) => ({ ...prev, tracks: 'recent' }));
    }
  };
  const onPlayTile = (tile) => {
    if (tile.kind === 'playlist') playPlaylist(tile.item);
    else if (tile.kind === 'loves') playTrackCollection(loves, LOVES_CONTEXT);
    else if (tile.kind === 'album') albumActions.onPlay(tile.item);
    else if (tile.kind === 'mix') playServicePlaylist(tile.item, mixContext(tile.item));
  };
  // The Recent Loves card does what the tile does, plus Queue and Add to
  // Playlist like every playlist card.
  const lovesActions = {
    onOpen: () => onOpenTile({ kind: 'loves' }),
    onPlay: () => playTrackCollection(loves, LOVES_CONTEXT),
    onQueue: () => addToQueue(loves, LOVES_CONTEXT),
    onAddToPlaylist: () => setAddToPlaylistPanel({ open: true, tracks: loves, sourceName: 'Recent Loves', sourceType: 'playlist' }),
    onContextMenu: () => showHomeContextMenu('loves', loves),
  };
  const onTileMenu = (ev, tile) => {
    if (tile.kind === 'loves') showHomeContextMenu('loves', loves);
    else if (tile.kind === 'album') showHomeContextMenu('album', tile.item);
    else if (tile.kind !== 'mix') showHomeContextMenu('playlist', tile.item);
  };

  const aiLoading = !!homeData.aiRecommendations?.loading;

  // The Ask box's example: built from local collection names only (Home's
  // Ask skips the chat confirmation), with a phrasing picked once per visit.
  // The box adopts a new example only while its field is untouched; and once
  // the example is built from artists it stays put for the visit, so a
  // background collection update doesn't keep changing it.
  const askSeed = React.useRef(Date.now());
  const askPrompt = React.useRef(null);
  const topArtists = React.useMemo(() => homeTopArtists(loves), [loves]);
  const examplePrompt = React.useMemo(() => {
    if (!askPrompt.current || askPrompt.current.generic) {
      askPrompt.current = { text: exampleShufflePrompt(topArtists, askSeed.current), generic: topArtists.length === 0 };
    }
    return askPrompt.current.text;
  }, [topArtists]);

  // -------------------------------------------------------------- sections

  const hasCollection = (collectionData.tracks || []).length > 0 || (library || []).length > 0;
  const show = homeSections({
    bannerItems, tiles, mixes, loves, playlists: homePlaylists, albums, fresh, critical, concerts, concertsLocation, hasCollection,
  });
  const jumpLoading = !show.jump && (collectionLoading || playlistsLoading);
  const albumsLoading = !show.albums && (!!recommendations.loading || aiLoading);
  const freshLoading = !show.fresh && !newReleasesError && (newReleasesLoading || !newReleasesLoaded);
  const criticalLoading = !show.critical && !criticsPicksError && (criticsPicksLoading || !criticsPicksLoaded);
  const concertsSkeleton = !show.concerts && !!concertsLocation && !concertsError && (concertsLoading || !concertsLoaded);

  // Backend announcements: one banner, Home only.
  const banner = React.createElement(HomeBanner, {
    items: bannerItems,
    onDismiss: dismissHomeBanner,
    onCta: openHomeBannerCta,
  });

  const header = React.createElement('header', {
    style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: '16px' },
  },
    React.createElement('div', { style: { minWidth: 0 } },
      React.createElement('h2', {
        onContextMenu: copyParachordLink,
        style: { margin: 0, fontSize: '28px', fontWeight: 700, color: 'var(--text-primary)' },
      }, greetingFor(new Date().getHours())),
      changeLine && React.createElement('p', {
        style: { margin: '4px 0 0', fontSize: '14px', color: 'var(--text-secondary)' },
      }, changeLine)),
    React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px' } },
      React.createElement(HomeSetupButton, {
        setup: homeSetup,
        onAction: onSetupAction,
        onDismiss: dismissHomeSetupItem,
        onOpenWhatsNew: openWhatsNew,
      }),
      // The shared button (components/collection-radio-button.js).
      hasCollection && React.createElement(CollectionRadioButton, { onClick: handleStartCollectionStation })));

  // While setup isn't done (or skipped), a getting-started layout replaces
  // the sections (#1493): the three steps, then Critical Darlings and Pop of
  // the Tops. The setup pill isn't shown; it carries only the extras later.
  const gettingStartedLayout = setupShown && React.createElement('div', {
    style: { display: 'flex', flexDirection: 'column', gap: '40px', padding: '28px 24px 40px', maxWidth: '1400px' },
  },
    gettingStarted.ready
      ? React.createElement(GettingStarted, {
        status: gettingStarted.status,
        plugins: gettingStarted.plugins,
        serviceStates: gettingStarted.serviceStates,
        scrobblers: gettingStarted.scrobblers,
        scrobblerStates: gettingStarted.scrobblerStates,
        watchFolders,
        hasCollection,
        playlists: homePlaylists,
        onSkip: skipGettingStarted,
        onConnect: connectPlugin,
        onOpenPlugin: openPluginPanel,
        onAddFolder: () => handleAddWatchFolder(),
        onBrowsePlugins: () => { navigateTo('settings'); setSettingsTab('plugins'); },
        // Playback Quality lives in Settings › General.
        onOpenQuality: () => { navigateTo('settings'); setSettingsTab('general'); },
        // apple.com links would open inside the app (main.js lets them
        // through for Apple sign-in), so the beta links go to the browser.
        onOpenLink: (url) => { const shell = globalThis.electron && globalThis.electron.shell; if (shell && shell.openExternal) shell.openExternal(url); },
        onImportLink: () => setShowUrlImportDialog(true),
        // Library Sync lives in Settings › General.
        onSyncLibrary: () => { navigateTo('settings'); setSettingsTab('general'); },
        onCollectionRadio: handleStartCollectionStation,
        onOpenPlaylist: (p) => loadPlaylist(p),
        onSearch: () => navigateTo('search'),
      })
      : React.createElement(GettingStartedSkeleton),
    React.createElement(ExploreRow, {
      stacked: homeHalvesStacked(contentWidth),
      critical,
      charts: chartCards,
      criticalLoading: criticalLoading,
      chartsLoading: !chartsError && (chartsLoading || !chartsLoaded),
      chartsError: !!chartsError,
      onRetryCharts: () => loadCharts(true),
      navigateTo,
      ...albumActions,
      onOpen: (album) => (album.homeRow === 'charts' ? openChartsAlbum(album) : openCriticsPicksAlbum(album)),
    }));

  return React.createElement('div', {
    className: 'flex-1 flex flex-col h-full',
    style: { overflow: 'hidden', minHeight: 0, backgroundColor: 'var(--bg-primary)' },
  },
    // The collapsed page hero every page has (80px, the uppercase light title),
    // in Home's sidebar colour: a gradient through violet-600, the accent
    // #7c3aed, with Home's circle pattern. It sits above the scroller, so on
    // macOS the title-bar drag strip lies over it as on other pages and
    // scrolled content stops at its edge.
    React.createElement('div', {
      'data-home-hero-banner': '', className: 'relative',
      style: { height: `${HOME_HERO_HEIGHT}px`, flexShrink: 0, overflow: 'hidden' },
    },
      React.createElement('div', { className: `absolute inset-0 ${HOME_HERO_GRADIENT}` }),
      React.createElement('div', { className: 'absolute inset-0', style: { opacity: 0.1, backgroundImage: HOME_HERO_PATTERN } }),
      React.createElement('div', { className: 'absolute inset-0 flex items-center px-6 z-10' },
        React.createElement('h1', {
          className: 'text-2xl font-light text-white',
          style: { textShadow: 'var(--hero-text-shadow-bar)', letterSpacing: '0.2em', textTransform: 'uppercase' },
          onContextMenu: copyParachordLink,
        }, 'Home'))),
    React.createElement('div', { className: 'flex-1 overflow-y-auto scrollable-content scroll-edge', style: { minHeight: 0 } },
      banner,
      setupShown ? gettingStartedLayout : React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '40px', padding: '28px 24px 40px', maxWidth: '1400px' },
      },
        header,

        jumpLoading
          ? skeletonSection('jump', 'Jump back in', React.createElement(JumpBackInSkeleton))
          : React.createElement(JumpBackIn, {
            tiles, onOpenTile, onPlayTile, onContextMenu: onTileMenu, onArtError, showImport: show.importCard,
            // Library Sync lives in Settings › General; with nothing synced
            // yet, its card offers each service's sync setup.
            onImport: () => { navigateTo('settings'); setSettingsTab('general'); },
          }),

        show.mixes && React.createElement(MixesRow, { mixes, loves: lovesCard, lovesActions, sourceColors, cards: rowCards, ...mixActions }),

        show.playlists
          ? React.createElement(PlaylistsRow, { playlists: homePlaylists, navigateTo, cards: rowCards, ...playlistActions })
          : playlistsLoading && skeletonSection('playlists', 'Your playlists, freshest first', React.createElement(CardRowSkeleton, { count: rowCards })),

        show.albums
          ? React.createElement(AlbumsRow, {
            albums, sourceColors, navigateTo, cards: rowCards, ...albumActions, onOpen: openAlbum,
          })
          : albumsLoading && skeletonSection('albums', 'Albums you might love', React.createElement(CardRowSkeleton, { count: rowCards, lines: 2 })),

        // One row for both halves, loaded or not: a half still loading draws
        // its skeleton in its own place, so nothing moves when it lands.
        (show.fresh || show.critical || freshLoading || criticalLoading || chartCards.length > 0 || chartsLoading)
          && React.createElement(FreshCriticalRow, {
            stacked: homeHalvesStacked(contentWidth),
            fresh,
            critical,
            freshLoading,
            criticalLoading,
            // Pop of the Tops stands in for an empty Fresh Drops.
            charts: chartCards,
            chartsLoading: !chartsError && (chartsLoading || !chartsLoaded),
            chartsError: !!chartsError,
            onRetryCharts: () => loadCharts(true),
            navigateTo,
            ...albumActions,
            // Each half opens its album the way its own page does; a Fresh
            // Drops card passes its release-group id, so no string search.
            onOpen: (album) => (album.homeRow === 'fresh'
              ? openTopAlbum({ ...album, name: album.title, image: album.imageUrl, releaseGroupId: album.id })
              : album.homeRow === 'charts' ? openChartsAlbum(album) : openCriticsPicksAlbum(album)),
          }),

        show.concerts
          ? React.createElement(ConcertsRow, { concerts, navigateTo, artistImages: concertsArtistImages, cards: concertCards })
          : concertsSkeleton && skeletonSection('concerts', 'Concerts near you', React.createElement(ConcertRowSkeleton, { count: concertCards })),

        React.createElement(AskShuffleupagus, {
          initialPrompt: examplePrompt,
          chatAvailable,
          onAsk: askShuffleupagus,
          onSetup: () => { navigateTo('settings'); setSettingsTab('plugins'); },
        }))));
});

module.exports = { HomePage, HOME_PAGE_HANDLERS, LOVES_CONTEXT };
