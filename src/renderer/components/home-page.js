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

const { HomeBanner } = require('./home-banner');
const { HomeSetupButton } = require('./home-setup');
// (Single-line destructures above the props one: page-memo.test.js reads
// the first multi-line `const {` block as the props list.)
const { JumpBackIn, MixesRow, PlaylistsRow, AlbumsRow, FreshCriticalRow, ConcertsRow, AskShuffleupagus } = require('./home-sections');
const { JumpBackInSkeleton, CardRowSkeleton, ConcertRowSkeleton, HOME_HALF_ROW_CARDS } = require('./home-skeletons');
const { homeSetupItems, missingPopularResolverCount } = require('../lib/home-setup');
const { freshestPlaylists, recentLoves, changeBadge, freshChangeLine, jumpBackInTiles } = require('../lib/home-model');
const { playlistSubtitle, homeSections, exampleShufflePrompt, releaseTag, homeTopArtists } = require('../lib/home-model');
const { trackSlug } = require('../lib/track-slug');

// Plain functions from Parachord, passed as stable wrappers.
const HOME_PAGE_HANDLERS = [
  'addToQueue',
  'askShuffleupagus',
  'copyParachordLink',
  'dismissHomeBanner',
  'dismissHomeSetupItem',
  'fetchAlbumTracksByName',
  'getAlbumArt',
  'handleCollectionAlbumClick',
  'handleStartCollectionStation',
  'loadAiRecommendations',
  'loadConcerts',
  'loadCriticsPicks',
  'loadHomeRecommendations',
  'loadNewReleases',
  'loadPlaylist',
  'navigateTo',
  'openCriticsPicksAlbum',
  'openHomeBannerCta',
  'openServicePlaylist',
  'openSyncSetupModal',
  'openTopAlbum',
  'openWhatsNew',
  'playTrackCollection',
  'prefetchTopAlbumTracks',
  'showHomeContextMenu',
];

// Playing recent loves from Home: the context isActiveContext matches.
const LOVES_CONTEXT = { type: 'loves', name: 'Recent loves' };

const PLAY_FILL = '#7c3aed'; // fill-accent
const ON_FILL = '#fff'; // on-color

const H2_STYLE = { margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--text-primary)' };

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
  key, 'aria-busy': 'true', style: { display: 'flex', flexDirection: 'column', gap: '14px', flex: '1 1 480px', minWidth: 0 },
}, React.createElement('h2', { style: H2_STYLE }, title), body);

const HomePage = React.memo(function HomePage(props) {
  const {
    addToQueue,
    allPlaylistCovers,
    allResolvers,
    appVersion,
    askShuffleupagus,
    bannerItems,
    cacheLoaded,
    chatAvailable,
    collectionData,
    collectionLoading,
    concerts,
    concertsError,
    concertsLoaded,
    concertsLoading,
    concertsLocation,
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
    handleCollectionAlbumClick,
    handleStartCollectionStation,
    homeActive,
    homeData,
    homeSetupDismissed,
    library,
    loadAiRecommendations,
    loadConcerts,
    loadCriticsPicks,
    loadHomeRecommendations,
    loadNewReleases,
    loadPlaylist,
    metaServiceConfigs,
    mixes,
    navigateTo,
    newReleases,
    newReleasesError,
    newReleasesLoaded,
    newReleasesLoading,
    openCriticsPicksAlbum,
    openHomeBannerCta,
    openServicePlaylist,
    openSyncSetupModal,
    openTopAlbum,
    openWhatsNew,
    playTrackCollection,
    playlists,
    playlistsLoading,
    prefetchTopAlbumTracks,
    recommendationAlbums,
    recommendations,
    setAddToPlaylistPanel,
    setConcertsTicketFlyout,
    setExtensionInfoOpen,
    setHomeData,
    setRaycastInfoOpen,
    setSettingsTab,
    showHomeContextMenu,
    showToast,
    spotifyConnected,
    whatsNewUnread,
  } = props;

  // ---------------------------------------------------------------- setup

  // The setup checklist: same checks the old cards used.
  const homeSetup = React.useMemo(() => homeSetupItems({
    missingPopularResolvers: missingPopularResolverCount(allResolvers),
    lastfmConnected: !!metaServiceConfigs?.lastfm?.username,
    listenbrainzConnected: !!metaServiceConfigs?.listenbrainz?.username,
    spotifyConnected: !!spotifyConnected,
    extensionConnected,
    isMac: typeof navigator !== 'undefined' && !!navigator.platform && navigator.platform.includes('Mac'),
    dismissed: homeSetupDismissed,
    appVersion,
    whatsNewUnread,
  }), [allResolvers, metaServiceConfigs, spotifyConnected, extensionConnected, homeSetupDismissed, appVersion, whatsNewUnread]);

  // Each item's click does what its old card did.
  const onSetupAction = (id) => {
    if (id === 'resolvers') { navigateTo('settings'); setSettingsTab('plugins'); }
    else if (id === 'lastfm' || id === 'listenbrainz') { navigateTo('settings'); setSettingsTab('general'); }
    else if (id === 'spotify') openSyncSetupModal('spotify');
    else if (id === 'browser-extension') setExtensionInfoOpen(true);
    else if (id === 'raycast') setRaycastInfoOpen(true);
  };

  // ------------------------------------------------------- background loads

  // One effect, after first paint. Recommendations load on every visit
  // unless a load is running (loadHomeRecommendations in app.js): each
  // provider that answered within the hour is served from its cache and only
  // the stale ones are asked, as the Recommendations page does on each visit. The other loaders run only
  // while their data isn't loaded (or failed), so a return visit refetches
  // nothing. Concerts load only with a location set, since the row hides
  // without one.
  React.useEffect(() => {
    if (!cacheLoaded) return undefined;
    const run = () => {
      loadHomeRecommendations();
      if (!newReleasesLoaded && !newReleasesLoading) loadNewReleases();
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
    if (tile.kind === 'playlist') return { ...tile, mosaic: allPlaylistCovers[tile.item.id] || null };
    if (tile.kind === 'loves') return { ...tile, imageUrl: lovesCover && lovesCover.imageUrl };
    if (tile.kind === 'album') {
      const { album, artist } = tile.item;
      const own = (loves.find((t) => t.album === album && t.artist === artist && t.albumArt) || {}).albumArt;
      const imageUrl = coverFor(artist, album, own);
      return { ...tile, imageUrl, item: { ...tile.item, imageUrl, title: album } };
    }
    return tile;
  }), [tilesRaw, allPlaylistCovers, lovesCover, loves, art]);

  const homePlaylists = React.useMemo(() => {
    const now = Date.now();
    return freshestPlaylists(playlists, 6).map((p) => ({
      ...p,
      badge: changeBadge(p, now),
      subtitle: playlistSubtitle(p, now),
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
  // "Out Friday" and the like are relative to now, fixed when the list changes.
  const freshNow = React.useMemo(() => Date.now(), [newReleases]);
  const fresh = React.useMemo(() => (newReleases || []).slice(0, HOME_HALF_ROW_CARDS).map((r) => ({
    ...r, imageUrl: coverFor(r.artist, r.title, r.albumArt), tag: releaseTag(r.date, freshNow), homeRow: 'fresh',
  })), [newReleases, freshNow, art]);
  const critical = React.useMemo(() => (criticsPicks || []).slice(0, HOME_HALF_ROW_CARDS)
    .map((c) => ({ ...c, imageUrl: coverFor(c.artist, c.title, c.albumArt), homeRow: 'critical' })), [criticsPicks, art]);

  // Covers Home resolves itself: the album tile and recommended albums that
  // came without one. Fresh Drops and Critical Darlings resolve their own;
  // a cover of theirs that fails is retried into this map (reportBroken).
  React.useEffect(() => {
    for (const tile of tilesRaw) {
      if (tile.kind !== 'album') continue;
      const { album, artist } = tile.item;
      if (!loves.some((t) => t.album === album && t.artist === artist && t.albumArt)) requestArt(artist, album);
    }
    if (loves.length > 0 && !loves[0].albumArt) requestArt(loves[0].artist, loves[0].album);
    for (const a of (recommendationAlbums || []).slice(0, 24)) {
      if (!a.imageUrl) requestArt(a.artist, a.title);
    }
  }, [tilesRaw, loves, recommendationAlbums]);

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
      showToast(`Added ${tracks.length} tracks from ${album.title}`, 'success');
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
    showToast(`Added ${tracks.length} tracks from ${p.title}`, 'success');
  };
  const playlistActions = {
    onOpen: (p) => loadPlaylist(p),
    onPlay: playPlaylist,
    onQueue: queuePlaylist,
    onContextMenu: (ev, p) => showHomeContextMenu('playlist', p),
    onArtError,
  };
  // A service mix opens the remote-playlist view the Recommendations cards
  // open. Play and Add to Queue land with the mixes (Phase C).
  const openMix = (m) => openServicePlaylist(m, m.serviceLabel);
  const mixActions = {
    onOpen: openMix, onPlay: openMix, onQueue: openMix,
    onContextMenu: (ev, m) => showHomeContextMenu('playlist', m),
    onArtError,
  };

  // Jump back in: the whole tile is the play button.
  const onPlayTile = (tile) => {
    if (tile.kind === 'playlist') playPlaylist(tile.item);
    else if (tile.kind === 'loves') playTrackCollection(loves, LOVES_CONTEXT);
    else if (tile.kind === 'album') albumActions.onPlay(tile.item);
    else if (tile.kind === 'mix') openMix(tile.item);
  };
  const onTileMenu = (ev, tile) => {
    if (tile.kind === 'loves') showHomeContextMenu('loves', loves);
    else if (tile.kind === 'album') showHomeContextMenu('album', tile.item);
    else showHomeContextMenu('playlist', tile.item);
  };

  // A concert opens the Concerts page with its ticket flyout open. The
  // flyout is set after this click finishes, so the page's click-outside
  // listener doesn't close it on the same click.
  const openConcertTickets = (concert) => {
    navigateTo('concerts');
    if (concert && concert.id) setTimeout(() => setConcertsTicketFlyout(concert.id), 0);
  };

  // Shuffleupagus's batch keeps its Refresh: the cached batch stays on
  // screen until the new one lands, and a failure says so.
  const aiLoading = !!homeData.aiRecommendations?.loading;
  const refreshSuggestions = async () => {
    setHomeData((prev) => ({
      ...prev,
      aiRecommendations: { albums: [], artists: [], ...(prev.aiRecommendations || {}), loading: true },
    }));
    const freshAlbums = [];
    const onUpdate = ({ artists, newAlbum }) => {
      if (artists) setHomeData((prev) => ({ ...prev, aiRecommendations: { ...prev.aiRecommendations, artists } }));
      if (newAlbum) freshAlbums.push(newAlbum);
    };
    const result = await loadAiRecommendations(onUpdate);
    if (result) {
      setHomeData((prev) => ({
        ...prev,
        aiRecommendations: {
          ...prev.aiRecommendations,
          albums: freshAlbums.length > 0 ? freshAlbums : (prev.aiRecommendations?.albums || []),
          loading: false,
        },
      }));
      return;
    }
    // Keep cached data visible on failure, and say so: a silent failure
    // looks exactly like "nothing new to suggest".
    showToast("Couldn't refresh suggestions. Check your AI provider in Settings.", 'error');
    setHomeData((prev) => {
      const existing = prev.aiRecommendations;
      if (existing?.albums?.length > 0 || existing?.artists?.length > 0) {
        return { ...prev, aiRecommendations: { ...existing, loading: false } };
      }
      return { ...prev, aiRecommendations: null };
    });
  };

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

  const show = homeSections({
    bannerItems, tiles, mixes, playlists: homePlaylists, albums, fresh, critical, concerts, concertsLocation,
  });
  const jumpLoading = !show.jump && (collectionLoading || playlistsLoading);
  const albumsLoading = !show.albums && (!!recommendations.loading || aiLoading);
  const freshLoading = !show.fresh && !newReleasesError && (newReleasesLoading || !newReleasesLoaded);
  const criticalLoading = !show.critical && !criticsPicksError && (criticsPicksLoading || !criticsPicksLoaded);
  const concertsSkeleton = !show.concerts && !!concertsLocation && !concertsError && (concertsLoading || !concertsLoaded);
  const hasCollection = (collectionData.tracks || []).length > 0 || (library || []).length > 0;

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
      React.createElement('h1', {
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
      hasCollection && React.createElement('button', {
        type: 'button',
        className: 'no-drag',
        onClick: handleStartCollectionStation,
        style: {
          font: 'inherit', fontSize: '14px', fontWeight: 600, border: 'none', borderRadius: '999px', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 16px 6px 6px', minHeight: '40px',
          backgroundColor: PLAY_FILL, color: ON_FILL,
        },
      },
        React.createElement('span', {
          'aria-hidden': 'true',
          style: {
            width: '28px', height: '28px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            backgroundColor: ON_FILL, color: PLAY_FILL,
          },
        },
          React.createElement('svg', { width: 12, height: 12, viewBox: '0 0 24 24', fill: 'currentColor' },
            React.createElement('path', { d: 'M7 4v16l13-8z' }))),
        'Play Collection Radio')));

  return React.createElement('div', {
    className: 'flex-1 flex flex-col h-full',
    style: { overflow: 'hidden', minHeight: 0, backgroundColor: 'var(--bg-primary)' },
  },
    React.createElement('div', { className: 'flex-1 overflow-y-auto scrollable-content', style: { minHeight: 0 } },
      banner,
      React.createElement('div', {
        style: { display: 'flex', flexDirection: 'column', gap: '40px', padding: '28px 24px 40px', maxWidth: '1400px' },
      },
        header,

        jumpLoading
          ? skeletonSection('jump', 'Jump back in', React.createElement(JumpBackInSkeleton))
          : React.createElement(JumpBackIn, {
            tiles, onPlayTile, onContextMenu: onTileMenu, onArtError,
            // Library Sync lives in Settings › General.
            onImport: () => { navigateTo('settings'); setSettingsTab('general'); },
          }),

        show.mixes && React.createElement(MixesRow, { mixes, ...mixActions }),

        show.playlists
          ? React.createElement(PlaylistsRow, { playlists: homePlaylists, navigateTo, ...playlistActions })
          : playlistsLoading && skeletonSection('playlists', 'Your playlists, freshest first', React.createElement(CardRowSkeleton)),

        show.albums
          ? React.createElement(AlbumsRow, {
            albums, navigateTo, ...albumActions, onOpen: openAlbum,
            onRefresh: chatAvailable ? refreshSuggestions : undefined, refreshing: aiLoading,
          })
          : albumsLoading && skeletonSection('albums', 'Albums you might love', React.createElement(CardRowSkeleton)),

        (show.fresh || show.critical)
          ? React.createElement(FreshCriticalRow, {
            fresh,
            critical,
            navigateTo,
            ...albumActions,
            // Each half opens its album the way its own page does; a Fresh
            // Drops card passes its release-group id, so no string search.
            onOpen: (album) => (album.homeRow === 'fresh'
              ? openTopAlbum({ ...album, name: album.title, image: album.imageUrl, releaseGroupId: album.id })
              : openCriticsPicksAlbum(album)),
          })
          : (freshLoading || criticalLoading) && React.createElement('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '32px' } },
            freshLoading && skeletonSection('fresh', 'Fresh Drops', React.createElement(CardRowSkeleton, { count: HOME_HALF_ROW_CARDS })),
            criticalLoading && skeletonSection('critical', 'Critical Darlings', React.createElement(CardRowSkeleton, { count: HOME_HALF_ROW_CARDS }))),

        show.concerts
          ? React.createElement(ConcertsRow, { concerts, navigateTo, onOpenTickets: openConcertTickets })
          : concertsSkeleton && skeletonSection('concerts', 'Concerts near you', React.createElement(ConcertRowSkeleton)),

        React.createElement(AskShuffleupagus, {
          initialPrompt: examplePrompt,
          chatAvailable,
          onAsk: askShuffleupagus,
          onSetup: () => { navigateTo('settings'); setSettingsTab('plugins'); },
        }))));
});

module.exports = { HomePage, HOME_PAGE_HANDLERS, LOVES_CONTEXT };
