// src/renderer/components/recommendations-page.js: the Recommendations
// page (activeView 'recommendations'): one row per kind (Songs, Albums,
// Artists, Playlists, Friends) blending every connected service's picks,
// filtered by source, each row a preview until opened (#1451, moved out of
// app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters, refs and memos by value, plain functions through
// useStableHandlers (RECOMMENDATIONS_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The markup moved as it was.
// Loads under plain Node: window is read only inside handlers, at run time.

const { filterRowBySource, pageSources } = require('../lib/recommendation-model');
const { releaseDateKey, upcomingLabel } = require('../lib/release-date');
const { TrackRow } = require('./track-lists');
const { playlistRef } = require('../lib/playlist-context');
const { ReasonBadge, shuffleupagusBadgeProps } = require('./reason-badge');
const { SectionHeader, SECTION_HEADER_GAP } = require('./section-header');
const { FilterChips } = require('./filter-chips');
const { PageHero } = require('./page-hero');
const { RecommendationCardSkeleton, RecommendationSongRowSkeleton, RecommendationSectionSkeleton, RecommendationsPageSkeleton } = require('./recommendation-skeletons');
const { PAGE_COLORS } = require('../lib/page-colors');
const { NO_PLUGIN_COLOR } = require('./brand-logos');
const { ArtistCard } = require('./artist-card');
const { AlbumCard } = require('./album-card');
const { PlaylistCard } = require('./playlist-card');
const { ListenerCard } = require('./listener-card');
const { EmptyState, ErrorState } = require('./states');
const { releaseMenu, artistMenu, playlistMenu } = require('../lib/item-menus');

const RECOMMENDATIONS_PAGE_HANDLERS = [
  'addServicePlaylistToPlaylist',
  'albumCardActions',
  'cancelRecommendationPlaylistPrefetch',
  'copyParachordLink',
  'fetchAlbumTracksFromMusicBrainz',
  'fetchArtistData',
  'handleCollectionAlbumClick',
  'loadPlaylist',
  'loadRecommendations',
  'loadWeeklyJamTracks',
  'navigateToFriend',
  'observedRowRef',
  'openServicePlaylist',
  'playArtistTopTracks',
  'playListenerTopTracks',
  'playServicePlaylist',
  'playTrackRow',
  'prefetchRecommendationPlaylist',
  'prefetchTopAlbumTracks',
  'queueServicePlaylist',
  'toggleRecommendationSection',
  'trackRowDrag',
];

const RecommendationsPage = React.memo(function RecommendationsPage(props) {
  const {
    addServicePlaylistToPlaylist,
    albumCardActions,
    allResolvers,
    cancelRecommendationPlaylistPrefetch,
    collectionData,
    copyParachordLink,
    currentTrack,
    expandedSections,
    fetchAlbumTracksFromMusicBrainz,
    fetchArtistData,
    friends,
    handleCollectionAlbumClick,
    homeData,
    homeSourceColors,
    isPlaying,
    loadPlaylist,
    loadRecommendations,
    loadWeeklyJamTracks,
    metaServiceConfigs,
    metaServices,
    navigateToFriend,
    observedRowRef,
    openServicePlaylist,
    pinnedFriendIds,
    playArtistTopTracks,
    playListenerTopTracks,
    playServicePlaylist,
    playTrackCollection,
    playTrackRow,
    playbackContext,
    playbackResolvers,
    prefetchRecommendationPlaylist,
    prefetchTopAlbumTracks,
    queueServicePlaylist,
    recommendationBrokenArtRef,
    recommendationImages,
    recommendationImagesWriterRef,
    recommendationReleaseDates,
    recommendationSourceFilter,
    recommendations,
    recommendationsExpandedSections,
    recommendationsGridColumns,
    recommendationsHeaderCollapsed,
    recommendationsLoadingMore,
    recommendationsObserverRef,
    recommendationsPending,
    recommendationsScrollContainerReady,
    recommendationsScrollContainerRef,
    recommendationsTrackRowRefs,
    resolverLoaderRef,
    resolverOrder,
    setActiveView,
    setHomeData,
    setRecommendationSourceFilter,
    setRecommendationsHeaderCollapsed,
    setRecommendationsScrollContainerReady,
    setSelectedResolver,
    setSettingsTab,
    showToast,
    toggleRecommendationSection,
    topAlbumTracksCache,
    trackRowDrag,
    trackSources,
    weeklyJamCovers,
  } = props;
  return React.createElement('div', {
          className: 'flex-1 flex flex-col h-full',
          style: { overflow: 'hidden', minHeight: 0 }
        },
          // Header section (outside scrollable area)
          React.createElement(PageHero, {
collapsed: recommendationsHeaderCollapsed,
page: 'recommendations',
title: 'Recommendations',
onTitleContextMenu: copyParachordLink,
expanded: React.createElement(React.Fragment, null,
React.createElement('div', {
                className: 'flex items-center gap-1 mt-6',
                style: { textShadow: 'var(--hero-text-shadow-line)' }
              },
                React.createElement('span', {
                  className: 'px-2 py-1 text-sm font-medium uppercase tracking-wider text-white'
                }, metaServiceConfigs.listenbrainz?.username
                  ? `Personalized picks for ${metaServiceConfigs.listenbrainz.username}`
                  : metaServiceConfigs.lastfm?.username
                    ? `Personalized picks for ${metaServiceConfigs.lastfm.username}`
                    : 'Personalized picks from your services')
              ),
React.createElement('p', {
                className: 'mt-2 text-white/80 text-sm'
              }, 'From your connected services and Shuffleupagus')),
collapsedContent: React.createElement(React.Fragment, null,
React.createElement('p', {
                className: 'text-white/70 text-sm truncate',
                style: { textShadow: 'var(--hero-text-shadow-line)' }
              }, 'Personalized picks from your services and Shuffleupagus'))
}),
          // Filter bar (outside scrollable area), as on the other tabs (Fresh
          // Drops, the artist page): the app's filter chips (FilterChips), All
          // then one per source on the page, no counts. All is neutral; a
          // source shows its plugin's brand colour (manifest `color`) as a
          // dot, and fills with it when picked. One pick filters every section
          // (filterRowBySource).
          recommendations.error !== 'not_configured' && (() => {
            const sources = pageSources(recommendations.sections);
            const active = sources.some(src => src.id === recommendationSourceFilter) ? recommendationSourceFilter : 'all';
            // A source's colour is the one Home's chips use (homeSourceColors,
            // the plugins' manifest colours); Shuffleupagus is not a plugin
            // and takes the fixed accent its badge uses, a source with no
            // colour the grey.
            const colorFor = (id) => (id === 'shuffleupagus' ? 'var(--accent-fill)' : (homeSourceColors && homeSourceColors[id]) || 'var(--text-secondary)');
            const chips = [{ id: 'all', label: 'All' }, ...sources.map(src => ({ id: src.id, label: src.name, color: colorFor(src.id) }))];
            return React.createElement('div', {
              className: 'flex items-center px-6 py-3',
              style: { flexShrink: 0, backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
            },
              React.createElement(FilterChips, { chips, value: active, onChange: setRecommendationSourceFilter, pageColor: PAGE_COLORS.recommendations.color, label: 'Filter recommendations by source' })
            );
          })(),
          // Scrollable content area: the grouped page
          (() => {
            const allSections = recommendations.sections;
            // The filter bar's pick, or All when that source left the page.
            const activeSourceFilter = pageSources(allSections).some(src => src.id === recommendationSourceFilter) ? recommendationSourceFilter : 'all';
            const filteringOne = activeSourceFilter !== 'all';
            // A section the pick leaves empty is left out.
            const sections = filteringOne
              ? allSections.filter(sec => sec.subsections.some(sub => filterRowBySource(sub, activeSourceFilter).length > 0))
              : allSections;
            const allSubsections = allSections.flatMap(s => s.subsections || []);
            // Shuffleupagus has no section of its own: its picks blend into the
            // Albums and Artists For you rows, so a batch still loading shows
            // as a card tail on those rows. Its albums are personal, so with
            // Albums in category rows the tail goes on Based on your listening
            // (albums:personal), and without that row yet a placeholder
            // subsection stands where it will land (renderTypeSection). With
            // no album section at all and no Artists row, one section skeleton
            // stands in the Albums slot. Only while it has
            // no picks to show: a refresh keeps the cached batch on screen as
            // real cards until the new one lands, and a skeleton only covers
            // what has nothing to show (#1328).
            const ai = homeData.aiRecommendations;
            const llmHasPicks = !!(ai && ((ai.albums || []).length > 0 || (ai.artists || []).length > 0));
            const llmLoading = !!ai?.loading && !llmHasPicks;
            const LLM_TAIL_ROWS = new Set(['type:album', 'type:artist', 'albums:personal']);
            const LLM_TAIL = 3;
            const llmPlaceholder = llmLoading && !filteringOne && !allSections.some(s => s.type === 'album') && !allSubsections.some(s => LLM_TAIL_ROWS.has(s.key));
            // A collapsed card section (Albums, Artists, Playlists) shows two
            // full rows (as many as fit across, measured; 6 a row until
            // measured), Friends one row, Songs 5 rows.
            const CARD_ROWS = 2;
            const SECTION_PREVIEW = (recommendationsGridColumns.cards || 6) * CARD_ROWS;
            const FRIEND_PREVIEW = recommendationsGridColumns.friends || 6;
            const SONG_PREVIEW = 5;

            // The image for a card: the provider's own URL first, then the
            // fetched recommendationImages entry ({ url, loaded }).
            const brokenArt = recommendationBrokenArtRef.current;
            const imageFor = (item) => {
              // A provider imageUrl that failed to load is dead for the session:
              // the fetched image (the art pipeline's retry result) wins over it.
              if (item.imageUrl && !brokenArt.has(item.imageUrl)) return item.imageUrl;
              return (recommendationImages[item.id] || {}).url || null;
            };
            const imageLoadedFor = (item) =>
              (!!item.imageUrl && !brokenArt.has(item.imageUrl)) || !!(recommendationImages[item.id] || {}).loaded;

            const playRecommendationPlaylist = async (item) => playServicePlaylist(item);

            // The playlist card's other two standard hover actions (the same
            // set as the Playlists page's cards: Add to Playlist, Play, Add to
            // Queue).
            const addRecommendationPlaylistToPlaylist = async (item) => addServicePlaylistToPlaylist(item);
            const queueRecommendationPlaylist = async (item) => queueServicePlaylist(item);

            // Open a recommended playlist in the playlist view (the same
            // ephemeral external-playlist flow the Home page's Weekly Jams
            // use), through the shared openServicePlaylist: the card's image
            // rides on the playlist record as coverArt there, so the view
            // shows the exact cover the Recommendations page showed — not a
            // mosaic built from the tracks.
            // The service an item came from, by name: its row's source entry
            // (rows are blended, so the row itself names no single provider).
            const itemSourceName = (item, row) => {
              const src = ((row && row.sources) || []).find(x => x.id === item.resolverId);
              return (src && src.name) || (row && row.resolverName) || item.resolverId || null;
            };
            // The click opens the playlist view at once (its skeleton rows
            // stand in), and the tracks fill in when the lookup lands
            // (loadPlaylist's fetchTracks branch): a click changes the view
            // before its lookup.
            const openRecommendationPlaylist = (item, section) => openServicePlaylist(item, itemSourceName(item, section));

            // ── Cards ─────────────────────────────────────────────────────
            const artistCard = (item, index) => {
              const img = imageFor(item);
              return React.createElement(ArtistCard, {
                key: item.id,
                artist: { id: item.id, name: item.name },
                image: img,
                imageLoaded: imageLoadedFor(item),
                tooltip: item.reason && !shuffleupagusBadgeProps(item) ? item.reason : undefined,
                // Shuffleupagus's pick says why, as on Home (components/reason-badge.js).
                badge: shuffleupagusBadgeProps(item) && React.createElement(ReasonBadge, shuffleupagusBadgeProps(item)),
                animationDelay: Math.min(index * 30, 300),
                onOpen: () => fetchArtistData(item.name),
                onPlay: playArtistTopTracks,
                onContextMenu: () => window.showItemMenu(artistMenu({ id: item.id, name: item.name, image: img }))
              });
            };

            // The shared album card (components/album-card.js). It was a
            // full-bleed copy of its own; now it is every grid's card.
            const albumCard = (item, index) => {
              const art = imageFor(item);
              const artLoaded = imageLoadedFor(item);
              const albumTracksFor = async () => {
                let albumTracks = (collectionData?.tracks || [])
                  .filter(t => t.artist === item.artist && t.album === item.name)
                  .sort((a, b) => (a.trackNumber || 0) - (b.trackNumber || 0));
                if (albumTracks.length === 0) {
                  showToast(`Loading ${item.name}…`);
                  albumTracks = await fetchAlbumTracksFromMusicBrainz(item.artist, item.name, art);
                }
                return albumTracks;
              };
              // Not out yet: "Coming <date>" over the cover (the provider's
              // own date first, else the MusicBrainz lookup's).
              const entry = item.releaseDate
                ? { date: item.releaseDate }
                : recommendationReleaseDates[releaseDateKey(item.artist || '', item.name)];
              const upcoming = entry && upcomingLabel(entry.date);
              // The release year, under the artist (the same date). The line
              // is always there, so the card doesn't grow when the lookup lands.
              const year = entry && entry.date ? String(entry.date).slice(0, 4) : '';
              return React.createElement(AlbumCard, Object.assign({
                key: item.id,
                album: { id: item.id, title: item.name, artist: item.artist, imageUrl: art || null },
                subtitle: year || '\u00a0',
                imageLoading: !artLoaded,
                tooltip: item.reason && !shuffleupagusBadgeProps(item) ? item.reason : undefined,
                // Shuffleupagus's pick says why, as on Home (components/reason-badge.js).
                reason: shuffleupagusBadgeProps(item) || null,
                cornerBadge: upcoming && React.createElement('div', {
                  className: 'pointer-events-none',
                  style: { position: 'absolute', top: '8px', right: '8px', zIndex: 1 }
                },
                  React.createElement('span', {
                    className: 'release-badge',
                    'data-upcoming-badge': 'true',
                    style: { backgroundColor: 'color-mix(in srgb, var(--accent-fill) 90%, transparent)', color: 'var(--on-accent)', whiteSpace: 'nowrap' }
                  }, upcoming)),
                animationDelay: Math.min(index * 30, 300),
                dragData: { type: 'album', album: { title: item.name, artist: item.artist, art } },
                onOpen: () => handleCollectionAlbumClick({ title: item.name, artist: item.artist }),
                // Fetch the tracks after a short hover (the card's dwell), so the
                // menu can queue them (design audit bug 18).
                onHoverPrefetch: () => prefetchTopAlbumTracks(item.artist, item.name, art),
                onContextMenu: () => {
                  const cacheKey = `${item.artist}-${item.name}`.toLowerCase();
                  const cached = topAlbumTracksCache.current[cacheKey];
                  // A right-click is intent: fetch now if the hover didn't.
                  if (!cached) prefetchTopAlbumTracks(item.artist, item.name, art);
                  window.showItemMenu(releaseMenu({ title: item.name, artist: item.artist, art }, { tracks: cached, loading: !cached }));
                },
                // A dead cover URL (album-art.md): the placeholder shows now, and
                // the pipeline's retry swaps in whatever it finds through the
                // same coalesced writer the image effect uses.
                onArtError: () => {
                  if (art) brokenArt.add(art);
                  recommendationImagesWriterRef.current.queue(item.id, { url: null, loaded: true }, { merge: true });
                  const report = window.reportBrokenAlbumArt;
                  if (report) {
                    report(art, { artist: item.artist, album: item.name }).then((url) => {
                      if (url) recommendationImagesWriterRef.current.queue(item.id, { url, loaded: true }, { merge: true });
                    }).catch(() => {});
                  }
                }
              }, albumCardActions({ title: item.name, artist: item.artist, getTracks: albumTracksFor })));
            };

            const playlistCard = (item, index, section) => {
              const art = imageFor(item);
              const artLoaded = imageLoadedFor(item);
              return React.createElement(PlaylistCard, {
                key: item.id,
                // The shared playlist card (components/playlist-card.js): the
                // provider's image, shimmering until it loads; the source under
                // the name (the row is blended).
                playlist: { id: item.id, title: item.name || item.title, imageUrl: art },
                imageLoading: !artLoaded,
                subtitle: itemSourceName(item, section) || '',
                animationDelay: Math.min(index * 30, 300),
                onOpen: () => openRecommendationPlaylist(item, section),
                // prefetchRecommendationPlaylist waits its own 250ms dwell.
                onHoverStart: () => prefetchRecommendationPlaylist(item),
                onHoverEnd: () => cancelRecommendationPlaylistPrefetch(item),
                // The standard playlist hover set: Add to playlist, Play, Add to
                // queue. Import is the opened playlist's Save.
                onAddToPlaylist: () => addRecommendationPlaylistToPlaylist(item),
                onPlay: () => playRecommendationPlaylist(item),
                onQueue: () => queueRecommendationPlaylist(item)
                // No right-click action. It used to open the playlist's service
                // page in the web browser with no menu and no label. Nothing
                // opens a browser unless the control says it will.
              });
            };

            // ── Weekly playlists (moved from Home) ─────────────────────────
            // A playlist item carrying `weekly` opens and plays through the
            // weekly path Home used: loadWeeklyJamTracks and the weekly-jam /
            // weekly-exploration contexts. Its entry in homeData (filled from
            // these rows at merge) carries tracks a card already loaded, and
            // the playlist view's pendingPlaylistLoad restore reads it.
            const weeklyEntryFor = (item) => {
              const field = item.weekly.contextType === 'weekly-jam' ? 'weeklyJams' : 'weeklyExploration';
              const entry = (homeData[field] || []).find(j => j.id === item.weekly.id) || null;
              return { field, entry };
            };
            const playWeeklyPlaylist = async (item, playlist) => {
              const { field, entry } = weeklyEntryFor(item);
              let tracks = (entry && entry.tracks) || [];
              if (!entry || !entry.tracksLoaded || tracks.length === 0) {
                tracks = await loadWeeklyJamTracks(item.weekly.id);
                setHomeData(prev => ({
                  ...prev,
                  [field]: prev[field]
                    ? prev[field].map(j => (j.id === item.weekly.id ? { ...j, tracks, tracksLoaded: true } : j))
                    : prev[field]
                }));
              }
              if (tracks.length > 0) {
                const name = `${item.weekly.weekLabel}'s ${item.weekly.label}`;
                // The playlist rides along so the queue's context bar can
                // reopen it (lib/playlist-context).
                playTrackCollection(tracks, { type: item.weekly.contextType, name, playlist: playlistRef(playlist) });
                showToast(`Playing ${name}`, 'success');
              }
            };
            const weeklyCard = (item, index, sub) => {
              const { entry } = weeklyEntryFor(item);
              const covers = weeklyJamCovers[item.weekly.id];
              const creator = itemSourceName(item, sub);
              const record = {
                id: `${item.resolverId}-${item.weekly.id}`,
                listenbrainzId: item.weekly.id,
                title: item.weekly.label,
                weekLabel: item.weekly.weekLabel,
                date: item.weekly.date || null,
                description: entry ? entry.description : null,
                tracks: (entry && entry.tracks) || [],
                tracksLoaded: !!(entry && entry.tracksLoaded),
                isExternal: true,
                isEphemeral: true,
                source: item.resolverId,
                creator
              };
              return React.createElement(PlaylistCard, {
                key: item.id,
                // Home's 2x2 mosaic from the weekly covers effect, shimmering
                // until its covers land. The playlist's full name ("Weekly
                // Exploration"), then its source (only the newest week is on
                // the page, so the week needs no label).
                playlist: { id: record.id, title: item.weekly.label },
                mosaic: covers || null,
                imageLoading: !covers,
                subtitle: creator || '',
                animationDelay: Math.min(index * 30, 300),
                onOpen: () => loadPlaylist({
                  id: record.id,
                  listenbrainzId: item.weekly.id,
                  title: record.title,
                  weekLabel: record.weekLabel,
                  date: record.date,
                  description: record.description,
                  tracks: record.tracks,
                  tracksLoaded: record.tracksLoaded,
                  isExternal: true,
                  isEphemeral: true,
                  source: record.source,
                  creator: record.creator
                }),
                onPlay: () => playWeeklyPlaylist(item, record),
                onContextMenu: () => window.showItemMenu(playlistMenu(record, record.tracks, { isEphemeral: true }))
              });
            };

            const cardFor = (item, index, sub) => (
              item.type === 'artist' ? artistCard(item, index)
                : item.type === 'album' ? albumCard(item, index)
                : item.weekly ? weeklyCard(item, index, sub)
                : playlistCard(item, index, sub)
            );

            // ── Song rows (resolve through the shared scheduler) ─────────
            // allSongs is the section's FULL song list (the collapsed view
            // shows a slice of it): the queue context after a clicked row is
            // the whole remainder, like the flat page, not just the visible tail.
            const songRow = (item, index, allSongs, section) => {
              const track = item.track;
              // The row playing now: this track, played from THIS row (the
              // context a row click sets), the playlist view's rule with the
              // row's key standing in for the playlist id. The key, not the
              // title: "For you" heads every section and a split Amazon
              // section keeps its title in each, so the same song in two rows
              // lights only the one it was played from. The name stays the
              // title, which the queue drawer shows.
              const contextName = section.title || 'Recommendations';
              const isNowPlaying = isPlaying && currentTrack?.id === track.id
                && playbackContext?.type === 'recommendations' && playbackContext?.rowKey === section.key;
              return React.createElement(TrackRow, Object.assign({
                key: track.id,
                track,
                number: String(index + 1).padStart(2, '0'),
                isNowPlaying,
                sources: { trackSources, playbackResolvers, resolverOrder },
                allResolvers,
                duration: true,
                rowRef: observedRowRef(recommendationsTrackRowRefs, recommendationsObserverRef, track.id),
                onPlay: (resolverId) => playTrackRow(track, allSongs.slice(index + 1).map(i => i.track), { type: 'recommendations', name: contextName, rowKey: section.key }, resolverId),
                onOpenArtist: fetchArtistData,
                onContextMenu: () => window.showItemMenu({
                  type: 'track',
                  track,
                  sourceType: 'recommendations',
                  sourceName: section.title || 'Recommendations'
                })
              }, trackRowDrag(track, { id: track.id, title: track.title, artist: track.artist, duration: track.duration, sources: track.sources || {} })));
            };

            // ── Friends ───────────────────────────────────────────────────
            // A person who listens like you: Collection -> Friends' hexagon
            // avatar, the username, and the provider's similarity as a whole
            // percent. A user with no picture (ListenBrainz's lookup sends
            // none) gets the initial placeholder Collection uses. Opening one
            // goes to their profile through a friend-shaped object that isn't
            // in `friends` (the friend loaders work from service and username
            // alone); nobody is followed or saved from here.
            const friendCard = (item, index, row) => {
              // The badge takes the service's brand colour (its plugin
              // manifest's `color`), the accent when it has none.
              const serviceResolver = (resolverLoaderRef.current?.getAllResolvers?.() || []).find(r => r.id === item.service);
              const badgeColor = serviceResolver && serviceResolver.color && serviceResolver.color !== NO_PLUGIN_COLOR
                ? serviceResolver.color
                : 'var(--accent-primary)';
              const pct = Number.isFinite(item.similarity)
                ? Math.round(Math.min(1, Math.max(0, item.similarity)) * 100)
                : null;
              // The shared listener card (components/listener-card.js), with
              // Play for their recent top 10.
              return React.createElement(ListenerCard, {
                key: item.id,
                name: item.name,
                avatarUrl: item.avatarUrl || null,
                animationDelay: Math.min(index * 30, 300),
                onOpen: () => navigateToFriend({
                  id: `similar:${item.service}:${item.name}`,
                  username: item.name,
                  service: item.service,
                  displayName: item.name,
                  avatarUrl: item.avatarUrl || null
                }),
                onPlay: () => playListenerTopTracks(item),
                // A friend already gets the friend menu; anyone else the
                // Listener menu (View History, Follow, and View on Achordion
                // for a ListenBrainz user).
                onContextMenu: () => {
                  const friend = friends.find(f => f.service === item.service && (f.username || '').toLowerCase() === (item.name || '').toLowerCase());
                  if (friend) {
                    window.showItemMenu({ type: 'friend', friend, isPinned: pinnedFriendIds.includes(friend.id), isSavedToCollection: friend.savedToCollection });
                  } else {
                    window.showItemMenu({ type: 'listener', listener: { service: item.service, username: item.name, avatarUrl: item.avatarUrl || null } });
                  }
                },
                // The similarity score, a badge over the hexagon's foot.
                badge: pct != null && React.createElement('span', {
                  'data-similarity-badge': 'true',
                  title: `${pct}% similar`,
                  style: {
                    position: 'absolute', bottom: '0px', left: '50%', transform: 'translateX(-50%)',
                    padding: '1px 7px', borderRadius: '9999px', fontSize: '11px', fontWeight: '600',
                    lineHeight: '16px', whiteSpace: 'nowrap', backgroundColor: badgeColor, color: 'var(--on-accent)',
                    boxShadow: 'var(--card-shadow)'
                  }
                }, `${pct}%`),
                details: [
                  // Where they were found (the row blends services).
                  React.createElement('div', {
                    key: 'source',
                    className: 'text-xs truncate',
                    style: { marginTop: '2px', height: '16px', color: 'var(--text-secondary)' }
                  }, itemSourceName(item, row) || ''),
                  // Their top few recent artists, up to two lines. The block is
                  // always there (empty when the service had none), so every card
                  // is the same height.
                  React.createElement('div', {
                    key: 'artists',
                    className: 'text-xs text-center',
                    style: {
                      marginTop: '2px', height: '32px', lineHeight: '16px', width: '100%', color: 'var(--text-tertiary)',
                      display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                    },
                    title: (item.topArtists || []).length ? `Recently: ${item.topArtists.join(', ')}` : undefined
                  }, (item.topArtists || []).join(', '))
                ]
              });
            };

            // ── The section header ───────────────────────────────────────
            // The app's section title (SectionHeader, Home's style) and See
            // all / Show less in its link style on the right. The link opens
            // the row in place rather than going to another page, so it says
            // "See all" (not "See all in <page>") and takes the accent (no
            // destination page's colour). Sources are filtered for the whole
            // page in the filter bar under the hero.
            const subsectionHeader = (sub, { expanded, showToggle }) => React.createElement(SectionHeader, {
              title: sub.title,
              // A category row is a subsection under the section's "Playlists"
              // heading, a step down from a section title.
              size: sub.category ? 'sub' : 'section',
              style: SECTION_HEADER_GAP,
              // Opening a row that can load more also starts its background
              // page fetches (the auto-paging effect), so there is no separate
              // load-more control.
              action: showToggle ? {
                label: expanded ? 'Show less' : 'See all',
                expanded,
                onClick: () => toggleRecommendationSection(sub.key)
              } : null
            });

            // ── One section's row ─────────────────────────────────────────
            // The header, then the items the page's source filter keeps
            // (filterRowBySource). Open state is per row (sub.key); the page
            // fetches are per provider section (sub.pageable[].pagingKey).
            // `cardRows` is how many rows of cards this row's preview shows: the
            // Playlists section passes 1 when it has several category rows.
            const renderSubsection = (sub, { cardRows = CARD_ROWS } = {}) => {
              const expanded = recommendationsExpandedSections.has(sub.key);
              const items = filterRowBySource(sub, activeSourceFilter);
              const isSongs = sub.type === 'song';
              const preview = isSongs ? SONG_PREVIEW : sub.type === 'friend' ? FRIEND_PREVIEW : (recommendationsGridColumns.cards || 6) * cardRows;
              const llmTail = llmLoading && LLM_TAIL_ROWS.has(sub.key) && (!filteringOne || activeSourceFilter === 'shuffleupagus') ? LLM_TAIL : 0;
              // The row's real preview always shows in full; the Shuffleupagus
              // tail (a fixed LLM_TAIL placeholders) trails after it, so a
              // skeleton never covers picks that are already here (#1328) and
              // canExpand stays measured against what the row really shows.
              const visible = expanded ? items : items.slice(0, preview);
              const canExpand = items.length > preview;
              const showToggle = expanded || canExpand || sub.canLoadMore;
              // A page in flight for this row's provider section shows a tail
              // only on an open split that its pages are still filling: a page
              // that brought this split nothing of its type (the section paging
              // on for its other splits) ends this split's tail.
              const showLoadingTail = expanded && (sub.pageable || []).some(p => {
                if (!recommendationsLoadingMore[p.pagingKey]) return false;
                const expansion = expandedSections[p.pagingKey];
                if (sub.category) {
                  return !expansion || !Array.isArray(expansion.lastPageCategories) || expansion.lastPageCategories.includes(`${sub.type}:${sub.category}`);
                }
                return !expansion || !Array.isArray(expansion.lastPageTypes) || expansion.lastPageTypes.includes(sub.type);
              });
              // Albums (title, artist) and playlists (name, source) have two
              // text lines.
              // Skeleton lines: an album card has title, artist and year; a
              // playlist card title and source; an artist card its name.
              const cardLines = sub.type === 'album' ? 3 : sub.type === 'playlist' ? 2 : 1;
              const header = subsectionHeader(sub, { expanded, showToggle });

              let body;
              if (isSongs) {
                // `items` is the row's FULL filtered list (the collapsed view
                // shows a slice): the queue after a clicked row is the rest.
                body = React.createElement('div', { className: 'space-y-0' },
                  ...visible.map((item, index) => songRow(item, index, items, sub)),
                  ...(showLoadingTail
                    ? Array.from({ length: SONG_PREVIEW }, (_, i) => React.createElement(RecommendationSongRowSkeleton, { key: `rec-more-${i}`, index: i }))
                    : [])
                );
              } else if (sub.type === 'friend') {
                body = React.createElement('div', {
                  className: 'grid gap-x-4 gap-y-5',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }
                }, ...visible.map((item, index) => friendCard(item, index, sub)));
              } else {
                body = React.createElement('div', {
                  className: 'grid gap-4',
                  style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
                },
                  ...visible.map((item, index) => cardFor(item, index, sub)),
                  // An open row fetching its next page: placeholders where the
                  // new cards will land.
                  ...(showLoadingTail
                    ? Array.from({ length: preview }, (_, i) => React.createElement(RecommendationCardSkeleton, { key: `rec-more-${i}`, index: i, lines: cardLines }))
                    : []),
                  // Shuffleupagus still thinking: where its picks will land.
                  ...Array.from({ length: llmTail }, (_, i) => React.createElement(RecommendationCardSkeleton, {
                    key: `rec-llm-${i}`, index: visible.length + i, lines: cardLines
                  }))
                );
              }
              return React.createElement('div', { key: sub.key }, header, body);
            };

            // ── Types ─────────────────────────────────────────────────────
            // A type section is its one row: the heading with its source tags,
            // then the items. With Shuffleupagus thinking, no album section on
            // the page and no Artists row for it to tail, one section skeleton
            // under an Albums heading stands in the Albums slot (after Songs).
            const llmSlot = llmPlaceholder && React.createElement(RecommendationSectionSkeleton, { key: 'type:album-pending', kind: 'cards', lines: 3, title: 'Albums', count: SECTION_PREVIEW });
            // Shuffleupagus's placeholder subsection in a categorized Albums
            // section (renderTypeSection places it): the Based on your
            // listening title with no link, then one row of album card
            // skeletons in the real cards' grid.
            const llmPersonalPendingRow = llmLoading && React.createElement('div', { key: 'albums:personal-pending' },
              React.createElement(SectionHeader, { title: 'Based on your listening', size: 'sub', style: SECTION_HEADER_GAP }),
              React.createElement('div', {
                className: 'grid gap-4',
                style: { gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }
              },
                ...Array.from({ length: (recommendationsGridColumns.cards || 6) * 1 }, (_, i) => React.createElement(RecommendationCardSkeleton, { key: `rec-llm-${i}`, index: i, lines: 3 }))
              )
            );
            const renderTypeSection = (section) => {
              // A row with nothing to show under the source filter (and no page
              // in flight) isn't rendered. Several rows left: one row of cards
              // each, so the section stays compact; a lone row keeps two.
              const visibleRows = section.subsections.filter(sub =>
                filterRowBySource(sub, activeSourceFilter).length > 0
                || (sub.pageable || []).some(p => recommendationsLoadingMore[p.pagingKey] && (!filteringOne || p.resolverId === activeSourceFilter)));
              // Shuffleupagus thinking, Albums in category rows and no Based on
              // your listening row yet: its placeholder subsection, after New
              // for you or else first, under All or the Shuffleupagus chip like
              // its card tail. It counts as a row.
              const llmPersonalPending = section.type === 'album' && llmLoading
                && (!filteringOne || activeSourceFilter === 'shuffleupagus')
                && visibleRows.some(sub => sub.category)
                && !visibleRows.some(sub => sub.key === 'albums:personal');
              const rowCount = visibleRows.length + (llmPersonalPending ? 1 : 0);
              const cardRows = rowCount > 1 ? 1 : CARD_ROWS;
              // Rows that carry a category are subsections of one section: the
              // section's title first (16px under it, like any section), then
              // the rows 32px apart in their own column.
              if (visibleRows.some(sub => sub.category)) {
                const rows = visibleRows.map(sub => renderSubsection(sub, { cardRows }));
                const newAt = visibleRows.findIndex(sub => sub.key === 'albums:new');
                if (llmPersonalPending) rows.splice(newAt + 1, 0, llmPersonalPendingRow);
                return React.createElement('div', { key: `type:${section.type}`, className: 'mb-10' },
                  React.createElement(SectionHeader, { title: section.title, style: SECTION_HEADER_GAP }),
                  React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '32px' } },
                    ...rows
                  )
                );
              }
              return React.createElement('div', { key: `type:${section.type}`, className: 'mb-10', style: { display: 'flex', flexDirection: 'column', gap: '32px' } },
                ...visibleRows.map(sub => renderSubsection(sub, { cardRows }))
              );
            };

            // ── The page ──────────────────────────────────────────────────
            const contentSections = sections.filter(s => s.type !== 'friend');
            const friendsSection = sections.find(s => s.type === 'friend') || null;
            const friendsPending = !filteringOne && recommendationsPending.some(p => p.friends);
            const contentBlocks = [];
            let llmSlotPlaced = !llmSlot || contentSections.some(s => s.type === 'album');
            for (const section of contentSections) {
              if (!llmSlotPlaced && section.type !== 'song') { contentBlocks.push(llmSlot); llmSlotPlaced = true; }
              contentBlocks.push(renderTypeSection(section));
            }
            if (!llmSlotPlaced) contentBlocks.push(llmSlot);

            return React.createElement('div', {
              ref: (el) => {
                recommendationsScrollContainerRef.current = el;
                if (el && !recommendationsScrollContainerReady) {
                  setRecommendationsScrollContainerReady(true);
                }
              },
              className: 'flex-1 overflow-y-auto scrollable-content scroll-edge',
              onScroll: (e) => {
                // Hysteresis + content guard (same as Fresh Drops): the old
                // single 50px threshold flip-flopped when collapsing the
                // 240px header clamped scrollTop back under it.
                const { scrollTop, scrollHeight, clientHeight } = e.target;
                const decision = window.headerCollapseDecision({ scrollTop, scrollHeight, clientHeight, collapsed: recommendationsHeaderCollapsed });
                if (decision !== null) setRecommendationsHeaderCollapsed(decision);
              }
            },
              React.createElement('div', { className: 'p-6' },
                // Loading state - section-shaped skeletons while nothing is loaded
                recommendations.loading && allSections.length === 0 ?
                  React.createElement(RecommendationsPageSkeleton, { cardCount: SECTION_PREVIEW })
                // Not configured state
                : recommendations.error === 'not_configured' ?
                  React.createElement(EmptyState, {
                    title: 'Connect a music service',
                    body: 'Get personalized recommendations based on your listening history. Connect Last.fm or ListenBrainz, sign in to Amazon Music, or enable an AI plug-in for Shuffleupagus suggestions.',
                    actions: ['listenbrainz', 'lastfm'].map(id => ({
                      label: id === 'lastfm' ? 'Connect Last.fm' : 'Connect ListenBrainz',
                      onClick: () => {
                        setActiveView('settings');
                        setSettingsTab('plugins');
                        const service = metaServices.find(s => s.id === id);
                        if (service) setSelectedResolver(service);
                      },
                    })),
                  })
                // Other error state
                : recommendations.error ?
                  React.createElement(ErrorState, { title: 'Couldn’t load recommendations', body: recommendations.error, onRetry: () => loadRecommendations({ forceRefresh: true }) })
                // Loaded, no error, and nothing to show: say so instead of a
                // blank page (audit bug 2).
                : (!recommendations.loading && recommendationsPending.length === 0 && !friendsSection && !friendsPending
                    && contentBlocks.filter(Boolean).length === 0) ?
                  React.createElement(EmptyState, {
                    title: filteringOne ? 'Nothing from this source yet' : 'No recommendations yet',
                    body: filteringOne
                      ? 'This source has no recommendations right now. Pick All to see the others.'
                      : 'Your connected services had nothing to suggest. Listen a little more, or try again later.',
                    actions: [{ label: 'Try again', onClick: () => loadRecommendations({ forceRefresh: true }) }]
                  })
                // The sections (Friends last)
                : React.createElement('div', null,
                    ...contentBlocks,
                    // Providers still being asked that have nothing on screen
                    // yet: one unlabeled skeleton after the last section and
                    // before Friends, so it never pushes content down from
                    // above. Unlabeled because a provider can answer "not
                    // ready" (an active resolver the account can't use):
                    // naming it would promise rows that never come.
                    !filteringOne && recommendationsPending.some(p => !p.friends) && React.createElement(RecommendationSectionSkeleton, {
                      key: 'rec-pending', count: SECTION_PREVIEW
                    }),
                    friendsSection && renderTypeSection(friendsSection),
                    // The similar-users lookups still out with nothing cached:
                    // hexagon placeholders where the Friends row will land.
                    !friendsSection && friendsPending && React.createElement(RecommendationSectionSkeleton, { key: 'type:friend-pending', kind: 'friends', title: 'Listeners', count: FRIEND_PREVIEW })
                  )
              )
            );
          })()
        );
});

module.exports = { RecommendationsPage, RECOMMENDATIONS_PAGE_HANDLERS };
