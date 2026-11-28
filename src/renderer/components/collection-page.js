// src/renderer/components/collection-page.js — the Collection page
// (Library view: Songs, Albums, Artists, Friends tabs), moved out of the
// Parachord component (maintainability plan Track 2b, first state-domain
// slice; performance item: every setState in Parachord re-rendered the whole
// tree, including this ~1,200-line page while it was on screen).
//
// React.memo: it re-renders only when one of its props changes. That only
// works because every prop is stable unless its data changed: state values,
// useState setters, refs, useCallback/useMemo results, and the plain
// functions Parachord recreates on every render, which come in as stable
// wrappers (useStableHandlers in app.js; the list is COLLECTION_PAGE_HANDLERS).
// A new prop must be one of those, or the memo silently stops helping
// (tests/renderer/page-memo.test.js checks the call site).
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const Icons = require('./icons');
const { FilterBox } = require('./filter-box');
const { PageHero } = require('./page-hero');
const { EmptyState, ErrorState } = require('./states');
const { SortMenu } = require('./sort-menu');
const { Menu } = require('./menu');
const { ResolverIcon } = require('./ui-atoms');
const { Badge } = require('./badge');
const { HeroTabs } = require('./hero-tabs');
const { VirtualizedTrackList, TrackRow, TrackRowSkeleton } = require('./track-lists');
const { slug } = require('../lib/track-slug');
const { artistMenu } = require('../lib/item-menus');
const { PlayTop10Icon } = require('./cards');
const { AlbumCard } = require('./album-card');
const { ArtistCard } = require('./artist-card');
const { ListenerCard } = require('./listener-card');
const { countOf } = require('../lib/plural');
const { PAGE_COLORS } = require('../lib/page-colors');
const { untilLabel } = require('../lib/until-label');
const { CollectionRadioButton } = require('./collection-radio-button');
const { Button, buttonClassName } = require('./button');

// Plain functions from Parachord, passed as stable wrappers.
const COLLECTION_PAGE_HANDLERS = [
  'addToQueue',
  'albumCardActions',
  'copyParachordLink',
  'fetchArtistData',
  'getAlbumArt',
  'getArtistImage',
  'getArtistTopTracks',
  'getCollectionSortOptions',
  'handleCollectionAlbumClick',
  'handlePlay',
  'handlePlaylistDragEnd',
  'handleStartCollectionStation',
  'isOnAir',
  'navigateToFriend',
  'openChartsAlbum',
  'openPluginSettings',
  'openSyncSetupModal',
  'playArtistTopTracks',
  'playListenerTopTracks',
  'setLovePushEnabled',
  'setProviderSyncEnabled',
  'setQueueWithContext',
  'syncFriendsFromServices',
];

// collectionAlbums: the saved albums plus the local library's, one card per
// album (#1532; app.js builds it with lib/local-albums.js). The Albums tab
// and its count read it, never collectionData.albums. collectionSongs is
// the Songs tab's rows before filter and sort (its count): local and saved
// songs, one per song. collectionArtists
// is the Artists tab's: followed and local artists, one per artist.
const CollectionPage = React.memo(function CollectionPage(props) {
  const {
    activeResolvers,
    addToQueue,
    albumCardActions,
    allResolvers,
    autoPinnedFriendIds,
    collectionAlbums,
    collectionArtists,
    collectionData,
    collectionHeaderCollapsed,
    collectionLoading,
    collectionObserverRef,
    collectionScrollContainerRef,
    collectionSearch,
    collectionSearchOpen,
    collectionSongs,
    collectionSongsSorted,
    collectionSort,
    collectionTab,
    collectionTrackRowRefs,
    copyParachordLink,
    currentTrack,
    fetchArtistData,
    filterCollectionItems,
    friendSyncInProgress,
    friends,
    getAlbumArt,
    getArtistImage,
    getArtistTopTracks,
    getCollectionSortOptions,
    handleCollectionAlbumClick,
    handleCollectionScrollContainerRef,
    handlePlay,
    handlePlaylistDragEnd,
    handleStartCollectionStation,
    isOnAir,
    isPlaying,
    libraryLoading,
    metaServiceConfigs,
    navigateToFriend,
    playArtistTopTracks,
    playListenerTopTracks,
    openChartsAlbum,
    openSyncSetupModal,
    pinnedFriendIds,
    playbackContext,
    resolverOrder,
    resolverSyncSettings,
    syncPausedUntil,
    syncSignedOut,
    syncMenuLoveRows,
    openPluginSettings,
    setLovePushEnabled,
    setProviderSyncEnabled,
    setAddFriendModalOpen,
    setAddToPlaylistPanel,
    setCollectionHeaderCollapsed,
    setCollectionSearch,
    setCollectionSearchOpen,
    setCollectionSort,
    setCollectionTab,
    setDraggingTrackForPlaylist,
    setQueueWithContext,
    setSyncStatusModal,
    setTrackLoading,
    showToast,
    sortCollectionItems,
    syncFriendsFromServices,
    syncProviderConfig,
    syncStatus,
    trackSources,
  } = props;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement(PageHero, {
collapsed: collectionHeaderCollapsed,
page: 'library',
title: 'Collection',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1 mt-6',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement(HeroTabs, { items: [
                    { key: 'artists', label: collectionLoading ? null : countOf(collectionArtists.length, 'Artist'), staticLabel: 'Artists' },
                    { key: 'albums', label: collectionLoading ? null : countOf(collectionAlbums.length, 'Album'), staticLabel: 'Albums' },
                    { key: 'tracks', label: collectionLoading ? null : countOf(collectionSongs.length, 'Track'), staticLabel: 'Tracks' },
                    { key: 'friends', label: countOf(friends.length, 'Friend'), staticLabel: 'Friends' }
                  ], isSelected: (tab) => collectionTab === tab.key, onSelect: (tab) => { setCollectionTab(tab.key); }, renderLabel: (tab) => tab.label !== null ? tab.label : React.createElement('span', { className: 'flex items-center gap-1' },
                      React.createElement('span', { className: 'inline-block w-6 h-4 bg-white/30 rounded animate-pulse' }),
                      tab.staticLabel
                    ), label: 'Collection' })
                ),
React.createElement('div', {
                  className: 'mt-6 flex items-center gap-3'
                },
                  // Home's button (components/collection-radio-button.js).
                  React.createElement(CollectionRadioButton, { onClick: handleStartCollectionStation })
                )),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('div', {
                  className: 'flex items-center gap-1',
                  style: { textShadow: 'var(--hero-text-shadow-line)' }
                },
                  React.createElement(HeroTabs, { items: [
                    { key: 'artists', label: collectionLoading ? null : countOf(collectionArtists.length, 'Artist'), staticLabel: 'Artists' },
                    { key: 'albums', label: collectionLoading ? null : countOf(collectionAlbums.length, 'Album'), staticLabel: 'Albums' },
                    { key: 'tracks', label: collectionLoading ? null : countOf(collectionSongs.length, 'Track'), staticLabel: 'Tracks' },
                    { key: 'friends', label: countOf(friends.length, 'Friend'), staticLabel: 'Friends' }
                  ], isSelected: (tab) => collectionTab === tab.key, onSelect: (tab) => { setCollectionTab(tab.key); }, renderLabel: (tab) => tab.label !== null ? tab.label : React.createElement('span', { className: 'flex items-center gap-1' },
                      React.createElement('span', { className: 'inline-block w-6 h-4 bg-white/30 rounded animate-pulse' }),
                      tab.staticLabel
                    ), label: 'Collection' })
                ),
React.createElement('div', { className: 'ml-auto' },
                  React.createElement(CollectionRadioButton, { onClick: handleStartCollectionStation, compact: true })))
}),
          // Filter bar — promoted out of scroll container so the virtualized
          // collection-tracks list inside can be a direct child of the
          // scroll element at scrollTop=0, eliminating the scrollMargin
          // offset class of bug. See issue #781.
          React.createElement('div', {
            className: 'flex items-center px-6 py-3',
            style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
            // Sort (components/sort-menu.js)
            React.createElement(SortMenu, {
              value: collectionSort[collectionTab],
              options: getCollectionSortOptions(collectionTab),
              onChange: (v) => setCollectionSort(prev => ({ ...prev, [collectionTab]: v })),
              label: 'Sort',
            }),
            // Spacer
            React.createElement('div', { className: 'flex-1' }),
            // Search toggle/field
            React.createElement(FilterBox, { value: collectionSearch, onChange: setCollectionSearch, open: collectionSearchOpen, onOpenChange: setCollectionSearchOpen }),
            // Sync Collection button and its menu (components/menu.js): the
            // sync status and Sync Now (parachord#1009: the Library Sync modal
            // existed since 2026-01 but nothing opened it), then one item per
            // provider, with a dot on the ones syncing.
            collectionTab !== 'friends' && React.createElement('div', { style: { marginLeft: '12px' } },
              (() => {
                const syncOn = Object.values(resolverSyncSettings).some(s => s?.enabled);
                const tile = (color, svg) => React.createElement('span', {
                  style: {
                    width: '28px', height: '28px', borderRadius: '8px', backgroundColor: color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                  }
                }, svg);
                const items = [];
                if (syncOn) {
                  items.push({
                    key: 'sync-status',
                    label: Object.values(syncStatus).some(s => s?.inProgress) ? 'Syncing…' : 'Library sync…',
                    icon: tile(PAGE_COLORS.library.fill, React.createElement(Icons.RefreshCw, { size: 16, style: { color: 'var(--on-accent)' } })),
                    onSelect: () => setSyncStatusModal({ open: true }),
                  });
                  items.push({ separator: true, key: 'sep' });
                }
                for (const [pid, config] of Object.entries(syncProviderConfig)) {
                  items.push({
                    key: pid,
                    label: config.name,
                    // The plug-in's colour and the shared logo kit.
                    icon: tile(config.color || 'var(--accent-fill)', React.createElement(ResolverIcon, { resolverId: pid, size: 16, fill: 'var(--on-accent)' })),
                    // The row opens Manage sync; the switch beside it turns
                    // this service's sync on or off (off pauses it: nothing
                    // synced is removed).
                    onSelect: () => openSyncSetupModal(pid),
                    // Signed out: nothing syncs, so the switch shows off
                    // (its saved setting stays, and it resumes once signed in).
                    // A rate-limit cooldown (#909) shows when it ends: sync
                    // waits it out on its own, so the switch stays as set.
                    trailing: syncSignedOut?.[pid]
                      ? React.createElement('span', { style: { fontSize: '11px', opacity: 0.7 } }, 'Signed out')
                      : (syncPausedUntil?.[pid] > Date.now() && React.createElement('span', {
                          style: { fontSize: '11px', opacity: 0.7 },
                          'data-tooltip': `${config.name} asked Parachord to slow down. Sync and ${config.name} searches pick up again then.`
                        }, `Paused until ${untilLabel(syncPausedUntil[pid])}`)),
                    toggle: {
                      checked: !!resolverSyncSettings[pid]?.enabled && !syncSignedOut?.[pid],
                      label: `Sync ${config.name}`,
                      onChange: (next) => setProviderSyncEnabled(pid, next),
                    },
                  });
                }
                // Loves-only rows (#1445): a service that syncs your loves but
                // has no library sync (Last.fm, a server's stars). The switch is
                // its "Push loves to X", the same setting as in its plug-in
                // settings; the row opens those settings. Signed out (or not set
                // up) it reads off and opens them instead, the saved choice kept.
                const loveRows = Array.isArray(syncMenuLoveRows) ? syncMenuLoveRows : [];
                if (loveRows.length > 0) items.push({ separator: true, key: 'sep-loves' });
                for (const row of loveRows) {
                  items.push({
                    key: `loves-${row.id}`,
                    label: `${row.name} ${row.words.plural}`,
                    icon: tile(row.color || 'var(--accent-fill)', React.createElement(ResolverIcon, { resolverId: row.id, size: 16, fill: 'var(--on-accent)' })),
                    onSelect: () => openPluginSettings(row.id),
                    trailing: !row.signedIn && React.createElement('span', { style: { fontSize: '11px', opacity: 0.7 } }, row.offLabel),
                    toggle: {
                      checked: row.signedIn && row.pushOn,
                      label: `Push ${row.words.plural} to ${row.name}`,
                      onChange: (next) => (row.signedIn ? setLovePushEnabled(row.id, next) : openPluginSettings(row.id)),
                    },
                  });
                }
                return React.createElement(Menu, {
                  label: 'Sync',
                  align: 'right',
                  minWidth: 280,
                  items,
                  // The shared small secondary button (components/button.js), as
                  // Playlists' Import is.
                  renderTrigger: (t) => React.createElement('button', Object.assign({}, t, {
                    type: 'button',
                    className: buttonClassName({ variant: 'secondary', size: 'sm' }),
                    'data-tooltip': 'Sync your music library'
                  }),
                    React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' }),
                    syncOn ? 'Synced' : 'Sync',
                    React.createElement(Icons.ChevronDown, { className: 'w-3 h-3', style: { marginLeft: '2px', opacity: 0.8 }, strokeWidth: 2.5 })
                  ),
                });
              })()
            ),
            // Sync friends button in header (only on friends tab).
            // Manually triggers inbound pull from Last.fm + ListenBrainz.
            // Disabled when no credentials exist; shows spinner during fetch.
            collectionTab === 'friends' && (() => {
              const lastfmConfig = metaServiceConfigs.lastfm;
              const listenbrainzConfig = metaServiceConfigs.listenbrainz;
              const hasCreds = !!(lastfmConfig?.username || listenbrainzConfig?.username);
              // The shared icon button (components/button.js).
              return React.createElement(Button, {
                variant: 'icon', size: 'sm', className: 'ml-3',
                onClick: () => syncFriendsFromServices({ silent: false }),
                disabled: friendSyncInProgress || !hasCreds,
                'aria-label': hasCreds
                  ? 'Sync friends from Last.fm and ListenBrainz'
                  : 'Connect Last.fm or ListenBrainz in Settings to sync friends', 'data-tooltip': hasCreds
                  ? 'Sync friends from Last.fm and ListenBrainz'
                  : 'Connect Last.fm or ListenBrainz in Settings to sync friends',
              },
                friendSyncInProgress
                  ? React.createElement(Icons.Spinner, { className: 'w-4 h-4' })
                  : React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' })
              );
            })(),
            // Add Friend button in header (only on friends tab)
            // The shared small primary button, in Collection's colour.
            collectionTab === 'friends' && React.createElement(Button, {
              variant: 'primary', size: 'sm', pageColor: PAGE_COLORS.library.fill, className: 'ml-3',
              onClick: () => setAddFriendModalOpen(true)
            },
              React.createElement(Icons.Plus, { className: 'w-4 h-4' }),
              'Add friend'
            )
          ),

          // Scrollable content area.
          //
          // `contain: strict` is layout-/paint-isolation for the other three
          // tabs (artists/albums/friends) — small perf win for those routes.
          // The tracks tab uses `@tanstack/react-virtual` (see
          // VirtualizedTrackList, parachord#783); `contain: size`
          // interacts poorly with the virtualizer's measurement of
          // `getScrollElement().clientHeight` when the scroll container is
          // `flex-1`-sized inside a flex column. Two prior virtualization
          // attempts (per #783) came up blank for this reason. Conditionally
          // relax to `layout` only when on tracks tab — keeps the isolation
          // benefit for the other tabs without breaking the virtualizer.
          React.createElement('div', {
            ref: handleCollectionScrollContainerRef,
            className: 'flex-1 overflow-y-auto scrollable-content scroll-edge',
            style: collectionTab === 'tracks'
              ? { minHeight: 0 }
              : { minHeight: 0, contain: 'strict' },
            onScroll: (e) => {
              const scrollTop = e.target.scrollTop;
              if (scrollTop > 50 && !collectionHeaderCollapsed) {
                setCollectionHeaderCollapsed(true);
              } else if (scrollTop <= 50 && collectionHeaderCollapsed) {
                setCollectionHeaderCollapsed(false);
              }
            }
          },
            // Tracks tab — direct child of the scroll container (no
            // padding wrapper above) so the eventual virtualized list
            // sees scrollTop=0 cleanly. Other tabs stay inside the p-6
            // wrapper below for their padding.
            collectionTab === 'tracks' && (() => {
              if (libraryLoading || collectionLoading) {
                // The shared track row's placeholder, in the rows' columns
                // (the album cell and the duration).
                return React.createElement('div', { className: 'space-y-0' },
                  Array.from({ length: 8 }).map((_, index) =>
                    React.createElement(TrackRowSkeleton, { key: `skeleton-${index}`, index, duration: true, cells: [{ key: 'album' }] }))
                );
              }

              // Merged, filtered and sorted once per input change (see
              // collectionSongsSorted), not on every render of the app.
              const sorted = collectionSongsSorted;

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement(EmptyState, { compact: true, icon: Icons.Search, title: "No tracks match your search" });
              }

              if (sorted.length === 0) {
                return React.createElement(EmptyState, { icon: Icons.Music, title: "No tracks yet", body: "Drag tracks here, or add a music folder in the Local Files plug-in." });
              }

              // Windowed render (parachord#783). Below the virtualization
              // threshold (~100 tracks) the helper falls back to a plain
              // map, so small libraries see no change in DOM shape.
              return React.createElement(VirtualizedTrackList, {
                tracks: sorted,
                parentRef: collectionScrollContainerRef,
                renderRow: (track, index) => {
                  // Merge track.sources (e.g., localfiles) with resolved sources from trackSources state
                  const effectiveSources = Object.fromEntries(
                    Object.entries({ ...(track.sources || {}), ...(trackSources[track.id] || {}) }).filter(([, v]) => v && !v.noMatch)
                  );
                  const isCurrentTrack = currentTrack?.id === track.id || (currentTrack?.filePath && track.filePath && currentTrack.filePath === track.filePath);
                  const isNowPlaying = isCurrentTrack && playbackContext?.type === 'library';

                  return React.createElement(TrackRow, {
                    key: track.id || track.filePath || index,
                    track,
                    number: String(index + 1).padStart(2, '0'),
                    isNowPlaying: isNowPlaying && isPlaying,
                    // A local file's Local Files is one more source, shown and
                    // ordered by the user's source order like the rest.
                    sources: { trackSources, playbackResolvers: activeResolvers, resolverOrder },
                    allResolvers,
                    duration: true,
                    rowRef: (el) => {
                      if (el) {
                        collectionTrackRowRefs.current.set(track.id, el);
                        if (collectionObserverRef.current) collectionObserverRef.current.observe(el);
                      } else {
                        collectionTrackRowRefs.current.delete(track.id);
                      }
                    },
                    draggable: true,
                    onDragStart: (e) => {
                      setDraggingTrackForPlaylist(track);
                      e.dataTransfer.effectAllowed = 'copy';
                      e.dataTransfer.setData('text/plain', JSON.stringify({
                        type: 'track',
                        track: { id: track.id, title: track.title, artist: track.artist, album: track.album, duration: track.duration, albumArt: track.albumArt, sources: track.sources || {} }
                      }));
                    },
                    onDragEnd: () => handlePlaylistDragEnd(),
                    onPlay: (resolverId) => {
                      setQueueWithContext(sorted.slice(index + 1), { type: 'library', name: 'Collection' });
                      // The merged sources (original + resolved), so handlePlay can use every resolver.
                      handlePlay(resolverId ? { ...track, preferredResolver: resolverId } : { ...track, sources: effectiveSources });
                    },
                    onOpenArtist: fetchArtistData,
                    onContextMenu: () => {
                      // This tab lists local-library tracks too, and those are
                      // not in the collection: claiming they were offered
                      // "Remove from Collection", which could only fail with
                      // "not in your collection" (#1002). A row with a file
                      // (local only, or a saved song merged with its file,
                      // #1532) also gets the file's items (Show in Finder,
                      // or Remove Missing File); Remove from Collection
                      // still means the saved record.
                      const inCollection = collectionData.tracks.some(t => t.id === track.id);
                      window.showItemMenu({
                        type: 'track',
                        track: track,
                        isInCollection: inCollection,
                        isLibraryTrack: !!(track.filePath || track.sources?.localfiles?.filePath)
                      });
                    },
                    cells: [{ key: 'album', content: track.album || '', onClick: track.album ? () => openChartsAlbum({ artist: track.artist, title: track.album, albumArt: track.albumArt }) : undefined }]
                  });
                }
              });
            })(),

            collectionTab !== 'tracks' && React.createElement('div', { className: 'p-6' },
              // Artists tab
            collectionTab === 'artists' && (() => {
              // Cards will appear with their own shimmer animations when data is ready
              if (collectionLoading) {
                return null;
              }

              // Saved and local artists, one card each (#1532): a local-only
              // artist is not followed (the menu offers Add to Collection).
              const filtered = filterCollectionItems(collectionArtists, 'artists');
              const sorted = sortCollectionItems(filtered, 'artists');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement(EmptyState, { compact: true, icon: Icons.Search, title: "No artists match your search" });
              }

              if (sorted.length === 0) {
                return React.createElement(EmptyState, { icon: Icons.Users, title: "No artists yet", body: "Drag artists here to add them to your collection." });
              }

              return React.createElement('div', {
                className: 'card-grid gap-x-4 gap-y-5',
                style: { minHeight: 'calc(100vh - 160px)', alignContent: 'start' }  // Ensure enough scroll area to prevent header bounce
              },
                sorted.map((artist, index) =>
                  React.createElement(ArtistCard, {
                    key: artist.id || artist.name,
                    artist: { id: slug(artist.name || 'unknown'), name: artist.name },
                    getArtistImage: getArtistImage,
                    onOpen: () => fetchArtistData(artist.name),
                    onPlay: playArtistTopTracks,
                    // The artist menu (Remove from Collection, Add Top 10 to
                    // Queue, Copy Link, View on Achordion).
                    onContextMenu: () => window.showItemMenu(artistMenu({ id: slug(artist.name || 'unknown'), name: artist.name, image: artist.image || null })),
                    animationDelay: Math.min(index * 30, 300)
                  })
                )
              );
            })(),

            // Albums tab
            collectionTab === 'albums' && (() => {
              // Cards will appear with their own shimmer animations when data is ready
              if (collectionLoading) {
                return null;
              }

              const filtered = filterCollectionItems(collectionAlbums, 'albums');
              const sorted = sortCollectionItems(filtered, 'albums');

              if (sorted.length === 0 && collectionSearch) {
                return React.createElement(EmptyState, { compact: true, icon: Icons.Search, title: "No albums match your search" });
              }

              if (sorted.length === 0) {
                return React.createElement(EmptyState, { icon: Icons.Music, title: "No albums yet", body: "Drag albums here to add them to your collection." });
              }

              // Each card is keyed by its album id, so after a search or sort a
              // card stays with its album (an index key handed a card, and its
              // cover, to whichever album moved into its place). Ids are
              // unique by construction (add and sync both refuse a repeat);
              // a repeat from older data still gets its own key.
              const albumKeyCounts = new Map();
              const albumKey = (album) => {
                const base = album.id || `${album.artist}|${album.title}`;
                const n = (albumKeyCounts.get(base) || 0) + 1;
                albumKeyCounts.set(base, n);
                return n === 1 ? base : `${base}#${n}`;
              };

              return React.createElement('div', { role: 'list',
                className: 'card-grid gap-x-4 gap-y-5',
                style: { minHeight: 'calc(100vh - 160px)', alignContent: 'start' }  // Ensure enough scroll area to prevent header bounce
              },
                sorted.map((album, index) =>
                  // The shared album card (components/album-card.js); it looks up
                  // its own cover (getAlbumArt).
                  (() => {
                    // An album with local files carries `tracks` (#1532): its
                    // saved songs and its files, one row per song with every
                    // source, in disc and track order. Otherwise its saved
                    // songs, as before.
                    const tracksOf = () => album.tracks || collectionData.tracks
                      .filter(t => t.artist === album.artist && t.album === album.title)
                      .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                    // The menu sends the album over IPC and back for Remove
                    // from Collection; its tracks travel separately.
                    const { localTracks: _localTracks, tracks: _tracks, ...menuAlbum } = album;
                    return React.createElement(AlbumCard, Object.assign({
                      key: albumKey(album),
                      role: 'listitem',
                      album: { ...album, imageUrl: album.art || null },
                      getAlbumArt: getAlbumArt,
                      // The year and track count, as the old Collection card showed.
                      subtitle: [album.year, (() => {
                        const n = album.trackCount ?? (album.tracks ? album.tracks.length : collectionData.tracks.filter(t => t.artist === album.artist && t.album === album.title).length);
                        return n ? countOf(n, 'track') : null;
                      })()].filter(Boolean).join(' · ') || null,
                      animationDelay: Math.min(index * 30, 300),
                      onOpen: () => handleCollectionAlbumClick(album),
                      onContextMenu: () => window.showItemMenu({ type: 'collection-album', album: menuAlbum, tracks: tracksOf() })
                    }, albumCardActions({ title: album.title, artist: album.artist, getTracks: async () => tracksOf() })));
                  })()
                )
              );
            })(),
            // Friends tab
            collectionTab === 'friends' && (() => {
              // Only show friends saved to collection (savedToCollection !== false for backwards compatibility)
              const savedFriends = friends.filter(f => f.savedToCollection !== false);

              // Sort friends
              const sortedFriends = [...savedFriends].sort((a, b) => {
                const sort = collectionSort.friends;
                if (sort === 'alpha-asc') return a.displayName.localeCompare(b.displayName);
                if (sort === 'alpha-desc') return b.displayName.localeCompare(a.displayName);
                if (sort === 'recent') return b.addedAt - a.addedAt;
                if (sort === 'active') {
                  // Recently Active — sort by last-track timestamp desc.
                  // The 14-day inactivity filter is applied BELOW alongside
                  // the on-air filter so it affects `displayFriends`, not
                  // the intermediate `sortedFriends` used by `hasMatches`.
                  const aTime = a.cachedRecentTrack?.timestamp || 0;
                  const bTime = b.cachedRecentTrack?.timestamp || 0;
                  return bTime - aTime;
                }
                if (sort === 'on-air') {
                  const aOnAir = isOnAir(a);
                  const bOnAir = isOnAir(b);
                  if (aOnAir && !bOnAir) return -1;
                  if (!aOnAir && bOnAir) return 1;
                  // Secondary sort by most recent activity
                  const aTime = a.cachedRecentTrack?.timestamp || 0;
                  const bTime = b.cachedRecentTrack?.timestamp || 0;
                  return bTime - aTime;
                }
                return 0;
              });

              // Filter by search
              const filtered = collectionSearch
                ? sortedFriends.filter(f =>
                    f.displayName.toLowerCase().includes(collectionSearch.toLowerCase()) ||
                    f.username.toLowerCase().includes(collectionSearch.toLowerCase())
                  )
                : sortedFriends;

              // Sort-driven filters:
              //   on-air  → show only friends whose last track is < 10 min old
              //   active  → show only friends with activity in the last 14 days
              //             (mirrors Android's FriendSort.ACTIVE)
              const ACTIVE_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
              const activeCutoff = Date.now() - ACTIVE_WINDOW_MS;
              const displayFriends =
                collectionSort.friends === 'on-air'
                  ? filtered.filter(f => isOnAir(f))
                  : collectionSort.friends === 'active'
                    ? filtered.filter(f => (f.cachedRecentTrack?.timestamp || 0) > activeCutoff)
                    : filtered;

              if (displayFriends.length === 0 && collectionSearch) {
                return React.createElement(EmptyState, { compact: true, icon: Icons.Search, title: "No friends match your search" });
              }

              if (displayFriends.length === 0 && collectionSort.friends === 'on-air') {
                return React.createElement(EmptyState, { icon: Icons.Radio, title: "No friends on air right now", body: "Check back later to see who’s listening." });
              }

              if (displayFriends.length === 0 && collectionSort.friends === 'active') {
                return React.createElement(EmptyState, { icon: Icons.Users, title: "No friends active in the last 14 days", body: "Try a different sort to see all your friends." });
              }

              if (savedFriends.length === 0) {
                return React.createElement(EmptyState, { icon: Icons.Users, title: "No friends in your collection yet", body: "Add friends to see what they’re listening to.", actions: [{ label: 'Add friend', onClick: () => setAddFriendModalOpen(true) }] });
              }

              return React.createElement('div', {
                style: { minHeight: 'calc(100vh - 160px)', alignContent: 'start' }  // Ensure enough scroll area to prevent header bounce
              },
                // Grid of friend cards - Cinematic Light design
                React.createElement('div', {
                  className: 'grid gap-x-4 gap-y-5',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }
                },
                  displayFriends.map((friend, index) => {
                    const onAir = isOnAir(friend);
                    const isPinned = pinnedFriendIds.includes(friend.id);

                    // The shared listener card (components/listener-card.js):
                    // the same card as Recommendations' Listeners, with this
                    // tab's friend menu (Pin, Remove) and lines.
                    return React.createElement(ListenerCard, {
                      key: friend.id,
                      name: friend.displayName,
                      avatarUrl: friend.avatarUrl || null,
                      onAir,
                      // Pin mark for manually pinned friends (not auto-pinned).
                      pinned: isPinned && !autoPinnedFriendIds.includes(friend.id),
                      animationDelay: Math.min(index * 30, 300),
                      draggable: true,
                      onDragStart: (e) => {
                        e.dataTransfer.setData('friendId', friend.id);
                        e.dataTransfer.effectAllowed = 'copy';
                      },
                      onOpen: () => navigateToFriend(friend),
                      onPlay: () => playListenerTopTracks(friend),
                      onContextMenu: () => {
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.showItemMenu({
                            type: 'friend',
                            friend: friend,
                            isPinned: isPinned,
                            isSavedToCollection: friend.savedToCollection
                          });
                        }
                      },
                      details: [
                      // Service badge - refined
                      // The service the friend listens on: a neutral Badge (its
                      // name says which; the danger / warning colours it wore
                      // said nothing about Last.fm or ListenBrainz).
                      React.createElement('span', { key: 'service', style: { display: 'inline-flex', marginTop: '4px' } },
                        React.createElement(Badge, null, friend.service === 'lastfm' ? 'Last.fm' : 'ListenBrainz')),
                      // Current track if on-air
                      onAir && friend.cachedRecentTrack && React.createElement('div', {
                        key: 'now',
                        style: {
                          marginTop: '6px',
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          textAlign: 'center',
                          maxWidth: '100%'
                        }
                      },
                        React.createElement('span', { style: { color: 'var(--text-success)' } }, '\u266A '),
                        `${friend.cachedRecentTrack.name}`
                      ),
                      // A Last.fm profile that hides its recent listening is never
                      // on-air; say why instead of leaving the card blank.
                      !onAir && friend.hidesListening && React.createElement('div', {
                        key: 'hidden',
                        title: 'This Last.fm profile hides its recent listening',
                        style: {
                          marginTop: '6px',
                          fontSize: '11px',
                          color: 'var(--text-tertiary)',
                          textAlign: 'center'
                        }
                      }, 'Listening hidden')
                      ]
                    });
                  })
                )
              );
            })()
            )
          )
        );
});

module.exports = { CollectionPage, COLLECTION_PAGE_HANDLERS };
