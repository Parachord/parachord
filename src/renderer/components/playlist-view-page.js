// src/renderer/components/playlist-view-page.js — a single playlist (its
// header, sync banner, edit mode and track list), moved out of the Parachord
// component (maintainability plan Track 2b, third state-domain slice; the
// others are collection-page.js and home-page.js). People start a playlist
// and leave this view open while it plays, so it was re-rendered by every
// setState in Parachord: track changes, queue updates, background
// resolution of the rest of the list, art loads, sync status, toasts.
//
// React.memo, fed only stable props: state values, useState setters, refs,
// useCallback results, and Parachord's plain functions as stable wrappers
// (useStableHandlers in app.js; the list is PLAYLIST_VIEW_PAGE_HANDLERS).
// The hosted / imported playlist check (linkUpdateMode, a stable wrapper)
// reads resolverLoaderRef during render; it changes only when resolvers load,
// which also changes the allResolvers prop. tests/renderer/page-memo.test.js
// checks the call site.
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const Icons = require('./icons');
const { weeklySavedName } = require('../lib/weekly-saved-name');
const { StickyBar } = require('./filter-box');
const { useReveal, ArtOverlay } = require('./card-art');
const { Badge } = require('./badge');
const { lbMbidOf } = require('../lib/playlist-share');
const { HeaderControl } = require('./header-control');
const { Button } = require('./button');
const { TextField } = require('./fields');
const { ShareButton } = require('./ui-atoms');
const { Menu } = require('./menu');
const { playlistMenu } = require('../lib/item-menus');
const { PlaylistCoverImage } = require('./playlist-cover');
const { VirtualizedTrackList, TrackRow, TrackRowSkeleton } = require('./track-lists');
const { playlistPlaybackContext } = require('../lib/playlist-context');
const { trackSlug } = require('../lib/track-slug');
const { countOf } = require('../lib/plural');
const { pluginName, importSourcePluginId } = require('../lib/plugin-names');
const { syncBannerState } = require('../lib/playlist-sync-banner');
const { NoticeBanner } = require('./notice-banner');
const { duplicateCount, withoutDuplicates, offersRemoval, duplicateCopy } = require('../lib/playlist-duplicates');
const { tracksFingerprint, refreshFromSource } = require('../../../sync-engine/auto-pull');
const { pushHold } = require('../../../sync-engine/push-hold');

// Column widths that follow the content area (#1389). At the 1000px minimum
// window the content is 744px: a fixed 240px art column and 140px of source
// icons left track titles about 190px. The icon column's skeleton uses it too.
const PLAYLIST_ART_COLUMN = 'clamp(184px, 26%, 240px)';
// The icon column: the app's --source-col (one icon per playable service),
// narrowing with the content area like the art column.
const PLAYLIST_ICON_COLUMN = 'min(var(--source-col, 140px), clamp(72px, 14%, 140px))';

const { Play, Music } = Icons;

// Plain functions from Parachord, passed as stable wrappers.
const PLAYLIST_VIEW_PAGE_HANDLERS = [
  'addToQueue',
  'copyParachordLink',
  'deletePlaylistLocally',
  'fetchArtistData',
  'getPlaylistMirrorTargets',
  'handleExportPlaylist',
  'handleImportPlaylistFromUrl',
  'handlePlay',
  'handlePlaylistDragEnd',
  'linkUpdateMode',
  'markPlaylistAsLocallyModified',
  'moveInEditedPlaylist',
  'navigateTo',
  'refreshHostedPlaylist',
  'savePlaylistToStore',
  'setPlaylistUpdateMode',
  'setQueueWithContext',
  'showConfirmDialog',
];

const PlaylistViewPage = React.memo(function PlaylistViewPage(props) {
  const {
    activeResolvers,
    addToQueue,
    allPlaylistCovers,
    allResolvers,
    copyParachordLink,
    currentTrack,
    deletePlaylistLocally,
    draggedPlaylistTrack,
    editedPlaylistData,
    emptyPlaylistId,
    fetchArtistData,
    getPlaylistMirrorTargets,
    handleExportPlaylist,
    handlePlay,
    handlePlaylistDragEnd,
    handlePlaylistTracksScrollRef,
    isPlaying,
    linkUpdateMode,
    markPlaylistAsLocallyModified,
    moveInEditedPlaylist,
    navigateTo,
    playbackContext,
    playlistCoverArt,
    playlistDropTarget,
    playlistEditMode,
    playlistObserverRef,
    playlistScrollContainerReady,
    playlistScrollContainerRef,
    playlistTrackRowRefs,
    playlistTracks,
    playlistTracksScrollRef,
    publishCollectionSmartLink,
    refreshHostedPlaylist,
    refreshingPlaylist,
    resolverOrder,
    savePlaylistToStore,
    handleImportPlaylistFromUrl,
    selectedPlaylist,
    setAddToPlaylistPanel,
    setDraggedPlaylistTrack,
    setDraggingTrackForPlaylist,
    setEditedPlaylistData,
    setPlaylistCoverArt,
    setPlaylistDropTarget,
    setPlaylistEditMode,
    setPlaylistScrollContainerReady,
    setPlaylistTracks,
    setPlaylistUpdateMode,
    setPlaylists,
    setQueueWithContext,
    setRefreshingPlaylist,
    setSelectedPlaylist,
    setSelectedPlaylistsForAdd,
    setSyncDeleteDialog,
    setTrackLoading,
    showConfirmDialog,
    showToast,
    trackSources,
  } = props;
  // How many later copies of a song the playlist holds (#1635). Once per
  // track list: a long playlist's identity pass is not free on every render.
  const duplicateTotal = React.useMemo(() => duplicateCount(playlistTracks), [playlistTracks]);
  // The playlist's own cover, when its provider gave it one (a recommended
  // playlist's image — the same one the Recommendations page's card showed —
  // or a provider import's coverArt on a saved record). Shown instead of the
  // 2x2 mosaic everywhere this view renders a cover: the blurred hero
  // background, the 192px card and the share link.
  const playlistCover = (typeof selectedPlaylist?.coverArt === 'string' && selectedPlaylist.coverArt.trim()) || null;
  // The cover's actions show on hover or keyboard focus (card-art useReveal).
  const coverReveal = useReveal();
  return React.createElement('div', {
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Playlist hero header (similar to Playlists main page)
        React.createElement('div', {
          className: 'relative',
          style: {
            height: '140px',
            flexShrink: 0,
            overflow: 'hidden'
          }
        },
          // Background with the first mosaic tile or the gradient, and the
          // playlist's own cover layered over it — the img reports its own
          // death (a CSS background cannot), so a dead cover degrades to the
          // tile/gradient, never to a flat header.
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              backgroundImage: playlistCoverArt[0]
                ? `url(${playlistCoverArt[0]})`
                : 'var(--playlists-gradient)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(20px) brightness(0.7)',
              transform: 'scale(1.2)'
            }
          },
            playlistCover && React.createElement(PlaylistCoverImage, { url: playlistCover })
          ),
          // Gradient overlay
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: 'var(--cover-shade)'
            }
          }),
          // Header content
          React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-8 z-10'
          },
            // Playlist icon
            React.createElement('div', {
              className: 'w-6 h-6 rounded-full bg-white/20 flex items-center justify-center mr-3'
            },
              React.createElement('svg', { className: 'w-3 h-3 text-white', fill: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('circle', { cx: '12', cy: '12', r: '10' })
              )
            ),
            // Playlist name
            React.createElement('h1', {
              className: 'text-2xl font-bold text-white',
              style: {
                textShadow: 'var(--hero-text-shadow-bar)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              },
              onContextMenu: copyParachordLink
            }, selectedPlaylist.title),
            // SHARED badge — appears when the user is a collaborator on a
            // synced playlist (currently only LB exposes this).
            selectedPlaylist.syncedFrom?.isCollaborator === true && React.createElement('span', {
              className: 'shared-playlist-badge',
              'data-tooltip': "You're a collaborator on this playlist — your edits sync to other collaborators",
              style: {
                fontSize: '11px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--accent-secondary)',
                color: 'var(--accent-secondary-fg)',
                fontWeight: 600,
                marginLeft: '6px',
                display: 'inline-block',
                verticalAlign: 'middle',
                letterSpacing: '0.05em',
                textTransform: 'uppercase'
              }
            }, 'Shared')
          )
        ),

        // Playlist content - white background with new layout
        React.createElement('div', {
          ref: (el) => {
            playlistScrollContainerRef.current = el;
            if (el && !playlistScrollContainerReady) {
              setPlaylistScrollContainerReady(true);
            }
          },
          className: 'page-bg',
          style: {
            flex: 1,
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            pointerEvents: 'auto'
          }
        },
          // PLAYLIST DETAILS section header with breadcrumb and Edit buttons (sticky)
          React.createElement(StickyBar, { variant: 'header' },
            // Breadcrumb navigation: Playlists > Playlist Name (or Recommendations for ephemeral)
            React.createElement('div', {
              className: 'flex items-center gap-2 text-xs font-medium tracking-widest uppercase'
            },
              React.createElement('button', {
                onClick: () => {
                  if (playlistEditMode) {
                    setPlaylistEditMode(false);
                    setEditedPlaylistData(null);
                  }
                  setSelectedPlaylist(null);
                  setPlaylistTracks([]);
                  setPlaylistCoverArt([]);
                  // Ephemeral playlists (weekly cards, provider playlists, the
                  // restore path) all open from Recommendations, so they go back
                  // there; saved ones go to Playlists.
                  if (selectedPlaylist?.isEphemeral && selectedPlaylist.origin !== 'chat') {
                    // (A temporary playlist from the chat goes to Playlists.)
                    navigateTo('recommendations');
                  } else {
                    navigateTo('playlists');
                  }
                },
                className: 'transition-colors uppercase text-ink-tertiary hover:text-ink-secondary'
              }, selectedPlaylist?.isEphemeral && selectedPlaylist.origin !== 'chat' ? 'Recommendations' : 'Playlists'),
              React.createElement('span', { style: { color: 'var(--text-tertiary)' } }, '/'),
              React.createElement('span', { className: 'uppercase', style: { color: 'var(--text-secondary)' } },
                playlistEditMode ? 'Editing' : (selectedPlaylist?.weekLabel || selectedPlaylist.title || 'Playlist Details')
              )
            ),
            React.createElement('div', { className: 'flex items-center gap-2' },
              // SAVE button for ephemeral playlists
              selectedPlaylist?.isEphemeral && !playlistEditMode && React.createElement(HeaderControl, { tone: 'primary', onClick: async () => {
                  // A provider playlist (a recommended playlist opened from the
                  // Recommendations page): SAVE is the Import path — the same
                  // canonical record the card's Import hover button produces
                  // (hosted-<url-hash> id, the provider snapshot shape), so the
                  // two buttons can never disagree.
                  if (selectedPlaylist.sourceUrl) {
                    // coverArt rides along as a metadata override so the saved
                    // record keeps the exact cover this view is showing (the
                    // lookup's own cover can be a different crop of the same
                    // playlist's image; the override wins).
                    await handleImportPlaylistFromUrl(
                      selectedPlaylist.sourceUrl,
                      false,
                      null,
                      selectedPlaylist.coverArt ? { coverArt: selectedPlaylist.coverArt } : null
                    );
                    return;
                  }
                  // Weekly Jams from Home: save to library. Built by spreading
                  // the whole playlist (buildPlaylistSavePayload's rule — a
                  // field left out of a hand-picked list is deleted when the
                  // store replaces the record), with only the library-record
                  // specifics overridden.
                  const newPlaylist = {
                    ...selectedPlaylist,
                    id: `playlist-${Date.now()}`,
                    // Its kind and its week's date, never the relative week
                    // label, so each week's copy has its own name (#1599).
                    title: selectedPlaylist.weekLabel ? weeklySavedName(selectedPlaylist) : selectedPlaylist.title,
                    creator: selectedPlaylist.creator || 'ListenBrainz',
                    tracks: playlistTracks,
                    addedAt: Date.now(),
                    lastModified: Date.now(),
                    source: selectedPlaylist.source || 'listenbrainz'
                  };
                  delete newPlaylist.isEphemeral;
                  delete newPlaylist.weekLabel;
                  setPlaylists(prev => [...prev, newPlaylist]);
                  await savePlaylistToStore(newPlaylist);
                  showToast('Playlist saved to library', 'success');
                  // Switch to viewing the saved playlist
                  setSelectedPlaylist({ ...newPlaylist, isEphemeral: false });
                } }, 'Save'),
              // A playlist imported from a link is kept updated from it or a
              // snapshot (lib/playlist-update-mode.js). One control for both:
              // the button says which ("Auto-update · On/Off"), and its menu
              // has the on/off switch and, while it's on, "Refresh now". A
              // snapshot never changes, so it has no refresh; switching
              // auto-update on brings it up to date at once. It replaced two
              // buttons (Check now + Stop updating, or Keep updated) whose
              // pairing read as two unrelated actions.
              (() => {
                if (selectedPlaylist?.isEphemeral || playlistEditMode) return null;
                const mode = linkUpdateMode(selectedPlaylist);
                if (!mode) return null;
                const id = selectedPlaylist.id;
                const on = mode === 'auto';
                const refreshing = refreshingPlaylist === id;
                const setOn = (next) => setPlaylistUpdateMode(id, next ? 'auto' : 'snapshot');
                const refreshNow = async () => {
                  if (refreshingPlaylist === id) return;
                  setRefreshingPlaylist(id);
                  try { await refreshHostedPlaylist(id); }
                  finally { setRefreshingPlaylist(null); }
                };
                return React.createElement(Menu, {
                  label: 'Auto-update',
                  align: 'right',
                  minWidth: 240,
                  items: [
                    { key: 'auto', label: 'Keep updated from its link', onSelect: () => setOn(!on),
                      toggle: { checked: on, onChange: setOn, label: 'Keep updated from its link' } },
                    ...(on ? [{ key: 'refresh', label: refreshing ? 'Refreshing…' : 'Refresh now', disabled: refreshing, onSelect: refreshNow }] : []),
                  ],
                  renderTrigger: (t) => React.createElement(HeaderControl, Object.assign({}, t, {
                    'data-tooltip': on ? 'Updates on its own from its link' : 'A snapshot: it stays as it is'
                  }),
                    refreshing ? 'Updating…' : (on ? 'Auto-update · On' : 'Auto-update · Off'),
                    React.createElement(Icons.ChevronDown, { className: 'w-4 h-4', style: { marginLeft: '4px' } })),
                });
              })(),
              // Refresh a playlist imported from a service now, without
              // waiting for the next full sync (a playlist another app
              // rebuilds, such as a SmarterPlaylists Daily Brew, or a followed one). The background sync's own rules
              // (sync-engine/auto-pull.js refreshFromSource): the service's
              // tracks come in unless you edited it here and it changed there
              // too, which is a conflict the banner below asks about. A
              // playlist imported from a link has its own Refresh now under
              // Auto-update; a hosted XSPF's link is its upstream.
              (() => {
                const playlist = selectedPlaylist;
                if (!playlist || playlist.isEphemeral || playlistEditMode || playlist.sourceUrl) return null;
                const from = playlist.syncedFrom;
                if (!from || !from.resolver || !from.externalId) return null;
                const id = playlist.id;
                const refreshing = refreshingPlaylist === id;
                const serviceName = pluginName(from.resolver);
                const refresh = async () => {
                  if (refreshingPlaylist === id) return;
                  setRefreshingPlaylist(id);
                  try {
                    const fetched = await window.electron.sync.fetchPlaylistTracks(from.resolver, from.externalId);
                    if (!fetched || !fetched.success || !Array.isArray(fetched.tracks)) {
                      console.error('Refresh: fetching the playlist failed:', fetched && fetched.error);
                      showToast(fetched && fetched.errorCode === 'missing_scopes'
                        ? `Parachord needs more access to ${serviceName}. Sign out and in again in Settings › Plug-Ins.`
                        : `Couldn’t refresh from ${serviceName}. Try again.`, 'error');
                      return;
                    }
                    const result = refreshFromSource(playlist, fetched, { now: Date.now() });
                    // What came back, for the diagnostic log: a "nothing new"
                    // that isn't is either the service's own answer or ours.
                    console.log(`🔄 Refresh "${playlist.title}" from ${from.resolver}: ${fetched.tracks.length} fetched, ${(playlist.tracks || []).length} here, same tracks: ${tracksFingerprint(fetched.tracks) === tracksFingerprint(playlist.tracks || [])}, unchanged since last sync: ${tracksFingerprint(fetched.tracks) === from.tracksFingerprint}, snapshot ${fetched.snapshotId && fetched.snapshotId === from.snapshotId ? 'same' : 'new'} → ${result.outcome}`);
                    if (result.playlist) {
                      const next = result.playlist;
                      setPlaylists(prev => prev.map(p => p.id === id ? next : p));
                      setSelectedPlaylist(prev => (prev && prev.id === id ? next : prev));
                      if (result.outcome === 'pulled') setPlaylistTracks(next.tracks);
                      await savePlaylistToStore(next);
                    }
                    showToast(result.outcome === 'pulled'
                      ? `Updated from ${serviceName}: ${countOf(result.playlist.tracks.length, 'track')}`
                      : result.outcome === 'conflict'
                      ? `This playlist changed on ${serviceName} and here. Choose which to keep above.`
                      : result.outcome === 'empty'
                      ? `${serviceName} sent no tracks for this playlist, so it’s left as it is.`
                      : `Already up to date with ${serviceName}`);
                  } catch (err) {
                    console.error('Refresh from service failed:', err);
                    showToast(`Couldn’t refresh from ${serviceName}. Try again.`, 'error');
                  } finally {
                    setRefreshingPlaylist(null);
                  }
                };
                return React.createElement(HeaderControl, {
                  onClick: refresh,
                  busy: refreshing,
                  'data-tooltip': `Get the latest from ${serviceName} now`,
                }, 'Refresh');
              })(),
              // Edit / Cancel+Done buttons (only for non-ephemeral playlists)
              !selectedPlaylist?.isEphemeral && (playlistEditMode ? React.createElement(React.Fragment, null,
                // Cancel button
                React.createElement(HeaderControl, { onClick: () => {
                    setPlaylistEditMode(false);
                    setEditedPlaylistData(null);
                  } }, 'Cancel'),
                // Done button
                React.createElement(HeaderControl, { tone: 'primary', onClick: async () => {
                    if (editedPlaylistData) {
                      const updated = {
                        ...selectedPlaylist,
                        // An emptied title keeps the old one (audit bug 26).
                        title: (editedPlaylistData.title || '').trim() || selectedPlaylist.title,
                        creator: editedPlaylistData.creator,
                        tracks: editedPlaylistData.tracks,
                        lastModified: Date.now(),
                        // Saved with the tracks, so the push loops send the
                        // edit to the mirrors (sync.md "Local-content mutators
                        // must persist locallyModified in the same save").
                        ...((selectedPlaylist.syncedFrom || selectedPlaylist.syncedTo) ? { locallyModified: true } : {})
                      };
                      setSelectedPlaylist(updated);
                      setPlaylistTracks(editedPlaylistData.tracks);
                      setPlaylists(prev => prev.map(p => p.id === updated.id ? updated : p));
                      await savePlaylistToStore(updated);
                      // Mark synced playlist as locally modified
                      markPlaylistAsLocallyModified(updated.id);
                    }
                    setPlaylistEditMode(false);
                    setEditedPlaylistData(null);
                  } }, 'Done')
              ) : React.createElement(HeaderControl, { onClick: () => {
                  setPlaylistEditMode(true);
                  setEditedPlaylistData({
                    title: selectedPlaylist.title,
                    creator: selectedPlaylist.creator || '',
                    tracks: [...playlistTracks]
                  });
                } }, 'Edit')),
              // Close button (hidden in edit mode since Cancel serves that purpose)
              !playlistEditMode && React.createElement(HeaderControl, { close: true, onClick: () => {
                  setSelectedPlaylist(null);
                  setPlaylistTracks([]);
                  setPlaylistCoverArt([]);
                  // Ephemeral playlists (weekly cards, provider playlists, the
                  // restore path) all open from Recommendations, so they go back
                  // there; saved ones go to Playlists.
                  if (selectedPlaylist?.isEphemeral && selectedPlaylist.origin !== 'chat') {
                    // (A temporary playlist from the chat goes to Playlists.)
                    navigateTo('recommendations');
                  } else {
                    navigateTo('playlists');
                  }
                } }, 'Close')
            )
          ),

          // Remote deletion banner for syncedTo playlists
          (() => {
            const playlist = selectedPlaylist;
            if (!playlist?.syncedTo) return null;
            const pendingProviders = Object.entries(playlist.syncedTo)
              .filter(([, info]) => info.pendingAction === 'remote-deleted');
            if (pendingProviders.length === 0) return null;

            return pendingProviders.map(([providerId, _info]) => {
              const providerName = pluginName(providerId);
              return React.createElement('div', {
                key: `remote-deleted-${providerId}`,
                className: `mx-4 mt-3 p-3 rounded-lg border`,
                style: { background: 'var(--tint-warning)', borderColor: 'var(--border-warning)' }
              },
                React.createElement('div', { className: 'text-sm font-medium text-ink-warning mb-2' },
                  `"${playlist.title}" was deleted on ${providerName}`
                ),
                React.createElement('div', { className: 'flex gap-2' },
                  React.createElement(Button, { variant: 'destructive', size: 'sm', onClick: async () => {
                      // Delete locally too (remote already gone) — via the helper
                      // so a hosted XSPF is cleared from BOTH stores.
                      await deletePlaylistLocally(playlist);
                      setSelectedPlaylist(null);
                    } }, 'Delete locally too'),
                  React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: async () => {
                      // Keep local, stop syncing to this provider. Through the
                      // Sync menu's path, not by editing syncedTo here: with no
                      // channel override, a playlist with another mirror looks
                      // "not yet created" to the push loop, which would recreate
                      // what was just deleted. Reload so a stale copy can't undo it.
                      const result = await window.electron.sync.setChannel(playlist.id, providerId, false);
                      if (!result?.success) {
                        console.error('Stop syncing failed:', result?.error); showToast(`Couldn’t stop syncing to ${providerName}. Try again.`, 'error');
                        return;
                      }
                      const fresh = await window.electron.playlists.load();
                      setPlaylists(fresh);
                      setSelectedPlaylist(fresh.find(p => p.id === playlist.id) || null);
                    } }, 'Stop syncing'),
                  React.createElement(Button, { variant: 'text', size: 'sm', onClick: async () => {
                      // Re-create on service — clear syncedTo for this provider
                      const updatedSyncedTo = { ...playlist.syncedTo };
                      delete updatedSyncedTo[providerId];
                      const updatedPlaylist = {
                        ...playlist,
                        syncedTo: Object.keys(updatedSyncedTo).length > 0 ? updatedSyncedTo : undefined
                      };
                      setSelectedPlaylist(updatedPlaylist);
                      setPlaylists(prev => prev.map(p => p.id === playlist.id ? updatedPlaylist : p));
                      await window.electron.playlists.save(updatedPlaylist);
                      showToast(`Will re-create "${playlist.title}" on ${providerName} during next sync`);
                    } }, 'Re-create')
                )
              );
            });
          })(),

          // Playlist sync banner: local edits to push, or a conflict. A
          // remote change alone shows nothing, because the next sync pulls it
          // (sync-engine/auto-pull.js; states in lib/playlist-sync-banner.js).
          // Hosted XSPF playlists only ever show push: the XSPF poller is
          // their upstream, so a pull from the service would be reverted.
          (() => {
            const playlist = selectedPlaylist;
            const banner = syncBannerState(playlist);
            if (!banner) return null;

            const provider = playlist.syncedFrom.resolver;
            // The service's name from its plugin (anything not Spotify showed
            // its raw id: "applemusic", "listenbrainz").
            const providerName = pluginName(provider);
            const syncState = banner.state; // 'push' | 'conflict'
            const localIsNewer = banner.localIsNewer;

            // Push handler
            const handlePush = async () => {
              const externalId = playlist.syncedFrom?.externalId;
              if (!provider || !externalId) return;

              try {
                // Push both tracks and metadata (name, description)
                const metadata = {
                  name: playlist.title,
                  description: playlist.description
                };
                // Matched on the service first, like the sync's own push: the
                // push replaces the playlist there with what matched, so it
                // waits while any lookup went unanswered (#1637,
                // sync-engine/push-hold.js). Sending the raw list dropped every
                // track without a Spotify id.
                let resolveResult;
                try {
                  resolveResult = await window.electron.sync.resolveTracks(provider, playlist.tracks || []);
                } catch (resolveErr) {
                  console.warn('Send: track lookup failed:', resolveErr);
                }
                if (pushHold(resolveResult)) {
                  showToast(`Couldn’t check every track on ${providerName} just now, so nothing was sent. Try again in a minute.`, 'error');
                  return;
                }
                const result = await window.electron.sync.pushPlaylist(provider, externalId, resolveResult.resolved, metadata);
                if (result?.success) {
                  const applyPush = prev => ({
                    ...prev,
                    locallyModified: false,
                    hasUpdates: false,
                    syncedFrom: {
                      ...prev.syncedFrom,
                      snapshotId: result.snapshotId,
                      // The source now has these tracks (sync-engine/auto-pull.js).
                      tracksFingerprint: tracksFingerprint(playlist.tracks)
                    },
                    syncSources: {
                      ...prev.syncSources,
                      [provider]: { ...prev.syncSources?.[provider], syncedAt: Date.now() }
                    }
                  });
                  setSelectedPlaylist(applyPush);
                  setPlaylists(prev => prev.map(p => p.id === playlist.id ? applyPush(p) : p));
                  await savePlaylistToStore(applyPush(playlist));
                } else {
                  console.error('Failed to push playlist:', result?.error);
                  showToast(`Couldn’t send your changes to ${providerName}. Try again.`, 'error');
                }
              } catch (err) {
                console.error('Failed to push playlist:', err);
                showToast(`Couldn’t send your changes to ${providerName}. Try again.`, 'error');
              }
            };

            // Pull handler
            const handlePull = async () => {
              const externalId = playlist.syncedFrom?.externalId;
              if (!provider || !externalId) return;

              try {
                const result = await window.electron.sync.fetchPlaylistTracks(provider, externalId);
                if (result?.success && result.tracks) {
                  // If this playlist is mirrored to providers other than the one
                  // we just pulled from, those mirrors now have stale content.
                  // Flag locallyModified so the next push loop propagates the
                  // new tracks outward (e.g. Spotify pull → push to Apple Music).
                  // Pure single-provider pulls leave locallyModified=false so we
                  // don't pointlessly re-push to the source.
                  const hasOtherMirrors = !!(playlist.syncedTo && Object.keys(playlist.syncedTo).some(
                    pid => pid !== provider && playlist.syncedTo[pid]?.externalId
                  ));
                  const applyPull = prev => ({
                    ...prev,
                    tracks: result.tracks,
                    hasUpdates: false,
                    locallyModified: hasOtherMirrors,
                    syncedFrom: {
                      ...prev.syncedFrom,
                      snapshotId: result.snapshotId,
                      tracksFingerprint: tracksFingerprint(result.tracks)
                    },
                    syncSources: {
                      ...prev.syncSources,
                      [provider]: { ...prev.syncSources?.[provider], syncedAt: Date.now() }
                    },
                    lastModified: Date.now()
                  });
                  setSelectedPlaylist(applyPull);
                  setPlaylistTracks(result.tracks);
                  setPlaylists(prev => prev.map(p => p.id === playlist.id ? applyPull(p) : p));
                  // Save to disk using the updated playlist from the latest state
                  const playlistToSave = applyPull(playlist);
                  await savePlaylistToStore(playlistToSave);
                  showToast(`Pulled ${countOf(result.tracks.length, 'track')} from ${providerName}`);
                } else {
                  console.error('Failed to pull playlist:', result?.error);
                  if (result?.errorCode === 'missing_scopes') {
                    showToast('Missing permissions. Please disconnect and reconnect Spotify in Settings.', 'error');
                  } else {
                    showToast(`Couldn’t get the latest changes from ${providerName}. Try again.`, 'error');
                  }
                }
              } catch (err) {
                console.error('Failed to pull playlist updates:', err);
                showToast(`Couldn’t get the latest changes from ${providerName}. Try again.`, 'error');
              }
            };

            // Dismiss handler (clears sync flags without syncing)
            const handleDismiss = async () => {
              const updatedPlaylist = { ...playlist, hasUpdates: false, locallyModified: false };
              setPlaylists(prev => prev.map(p => p.id === playlist.id ? { ...p, hasUpdates: false, locallyModified: false } : p));
              setSelectedPlaylist(prev => ({ ...prev, hasUpdates: false, locallyModified: false }));
              await savePlaylistToStore(updatedPlaylist);
            };

            // The shared notice (components/notice-banner.js). Plain words,
            // not git's ("Push Local", "Pull Remote", an uppercase SYNC
            // CONFLICT label); the newer version is the primary choice (a
            // conflict offered "Use X" twice when X was newer).
            return React.createElement(NoticeBanner, {
              tone: syncState === 'push' ? 'success' : 'warning',
              icon: syncState === 'push' ? Icons.Upload : Icons.AlertTriangle,
              title: syncState === 'push' ? 'You changed this playlist' : `This playlist changed here and on ${providerName}`,
              text: syncState === 'push'
                ? `Send your changes to ${providerName}?`
                : localIsNewer
                ? 'Your version is newer.'
                : `${providerName}’s version is newer.`,
              actions: [
                React.createElement(Button, { key: 'dismiss', variant: 'text', size: 'sm', onClick: handleDismiss }, 'Dismiss'),
                syncState === 'push'
                  ? React.createElement(Button, { key: 'send', variant: 'primary', size: 'sm', onClick: handlePush },
                      React.createElement(Icons.Upload, { size: 14 }), `Send to ${providerName}`)
                  : [
                      React.createElement(Button, { key: 'mine', variant: localIsNewer ? 'primary' : 'secondary', size: 'sm', onClick: handlePush },
                        React.createElement(Icons.Upload, { size: 14 }), 'Keep my version'),
                      React.createElement(Button, { key: 'theirs', variant: localIsNewer ? 'secondary' : 'primary', size: 'sm', onClick: handlePull },
                        React.createElement(Icons.Download, { size: 14 }), `Use ${providerName}’s version`)
                    ]
              ]
            });
          })(),

          // Duplicate tracks (#1635, mobile parity): later copies of a song
          // already in the playlist (lib/playlist-duplicates.js, sync's own
          // track identity). Removing keeps the first copy of each in place
          // and saves like an edit, so the next sync sends the cleaned list
          // to the mirrors and the source.
          !playlistEditMode && offersRemoval(selectedPlaylist, duplicateTotal) && React.createElement(NoticeBanner, {
            tone: 'info',
            icon: Icons.Copy,
            title: duplicateCopy.banner(duplicateTotal),
            actions: React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => {
                const playlist = selectedPlaylist;
                const count = duplicateTotal;
                showConfirmDialog({
                  type: 'warning',
                  title: duplicateCopy.confirmTitle(count),
                  message: duplicateCopy.confirmBody(playlist.title),
                  confirmLabel: duplicateCopy.remove,
                  destructive: true,
                  onConfirm: async () => {
                    const tracks = withoutDuplicates(playlistTracks);
                    const removed = playlistTracks.length - tracks.length;
                    if (removed <= 0) return;
                    const updated = {
                      ...playlist,
                      tracks,
                      lastModified: Date.now(),
                      // Saved with the tracks, so the push loops send it on
                      // (sync.md "Local-content mutators must persist
                      // locallyModified in the same save").
                      ...((playlist.syncedFrom || playlist.syncedTo) ? { locallyModified: true } : {})
                    };
                    setSelectedPlaylist(updated);
                    setPlaylistTracks(tracks);
                    setPlaylists(prev => prev.map(p => p.id === updated.id ? updated : p));
                    await savePlaylistToStore(updated);
                    markPlaylistAsLocallyModified(updated.id);
                    showToast(duplicateCopy.done(removed));
                  }
                });
              } }, duplicateCopy.remove)
          }),

          // Two-column layout: playlist cover + metadata on left, tracklist on right
          // Left padding only: the tracklist's own scroll area carries the
          // right and bottom padding, so its scrollbar sits at the window edge
          // (the wrapper's px-6 inset it 24px since #1089).
          React.createElement('div', { className: 'flex gap-0 pl-6', style: { flex: 1, minHeight: 0 } },
            // LEFT COLUMN: 2x2 album art grid and metadata (fixed, scrolls independently)
            React.createElement('div', {
              className: 'flex-shrink-0 pr-8 pt-8 pb-6 scrollable-content',
              // Scales with the content area (#1389): 240px on a normal
              // window, down to 184px at the minimum, so the tracklist keeps
              // room for titles. The card and cover fill it.
              style: { width: PLAYLIST_ART_COLUMN, overflowY: 'auto', overflowX: 'hidden' }
            },
              // Playlist card - matches playlist card style from grid view
              (() => {
                const covers = allPlaylistCovers[selectedPlaylist?.id] || playlistCoverArt || [];
                const hasCachedCovers = covers.length > 0;

                return React.createElement('div', {
                  style: {
                    padding: '10px',
                    borderRadius: '10px',
                    backgroundColor: 'var(--card-bg)',
                    boxShadow: 'var(--card-shadow)',
                    width: '100%',
                    boxSizing: 'border-box'
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      window.showItemMenu(playlistMenu(selectedPlaylist, playlistTracks || []));
                    }
                  }
                },
                  // Album art mosaic with hover overlay. The playlist's own
                  // cover (playlistCover) renders AFTER the mosaic/placeholder
                  // in DOM order: the cover img and the mosaic tiles are both
                  // positioned, and positioned siblings paint in DOM order —
                  // placed before the mosaic, the tiles painted OVER the cover
                  // the moment the tracks landed (the static placeholder was
                  // the only thing the cover could sit above while loading).
                  // After it, the exact image the provider gave — what the
                  // Recommendations page's card showed — sits above the tiles,
                  // and a dead URL removes itself so the mosaic shows again.
                  // The hover overlay after it stays on top.
                  React.createElement('div', Object.assign({
                    className: 'rounded-lg overflow-hidden album-art-container relative',
                    style: {
                      width: '100%',
                      aspectRatio: '1 / 1'
                    }
                  }, coverReveal.props),
                    hasCachedCovers ?
                      React.createElement('div', { className: 'grid grid-cols-2 grid-rows-2 w-full h-full' },
                        [0, 1, 2, 3].map(idx => {
                          return React.createElement('div', {
                            key: idx,
                            className: 'relative w-full h-full flex items-center justify-center',
                            style: { background: 'var(--placeholder-bg)' }
                          },
                            !covers[idx] && React.createElement(Music, { size: 20, className: 'text-ink-secondary' }),
                            covers[idx] && React.createElement('img', {
                              src: covers[idx],
                              alt: '',
                              className: 'absolute inset-0 w-full h-full object-cover transition-opacity duration-slow',
                              style: { opacity: 0 },
                              ref: (el) => { if (el && el.complete && el.naturalWidth > 0) el.style.opacity = '1'; },
                              onLoad: (e) => { e.target.style.opacity = '1'; }
                            })
                          );
                        })
                      )
                    :
                      React.createElement('div', {
                        className: 'w-full h-full flex items-center justify-center',
                        style: { background: 'var(--placeholder-bg)' }
                      },
                        // The Playlists page's glyph (icons.js)
                        React.createElement(Icons.Playlist, { className: 'w-12 h-12 text-ink-tertiary' })
                      ),
                    // The playlist's own cover, over the mosaic/placeholder
                    // (DOM order = paint order here; see the comment above).
                    playlistCover && React.createElement(PlaylistCoverImage, { url: playlistCover }),
                    // Hover overlay with action buttons
                    React.createElement(ArtOverlay, {
shown: coverReveal.shown,
title: selectedPlaylist.title,
onAddToPlaylist: () => {
const tracksWithIds = (playlistTracks || []).map(track => ({
                            ...track,
                            id: track.id || trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                            sources: trackSources[track.id] || {}
                          }));
                          if (tracksWithIds.length > 0) {
                            setAddToPlaylistPanel({
                              open: true,
                              tracks: tracksWithIds,
                              sourceName: selectedPlaylist.title,
                              sourceType: 'playlist'
                            });
                            setSelectedPlaylistsForAdd([]);
                          }
                        },
onPlay: () => {
setTrackLoading(true);
                          const tracksWithIds = (playlistTracks || []).map(track => ({
                            ...track,
                            id: track.id || trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                            sources: trackSources[track.id] || {}
                          }));
                          if (tracksWithIds.length > 0) {
                            const context = playlistPlaybackContext(selectedPlaylist);
                            const [firstTrack, ...remainingTracks] = tracksWithIds;
                            const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                            setQueueWithContext(remainingTracks, context, true);
                            handlePlay(taggedFirstTrack);
                          } else {
                            setTrackLoading(false);
                          }
                        },
onQueue: () => {
const tracksWithIds = (playlistTracks || []).map(track => ({
                            ...track,
                            id: track.id || trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                            sources: trackSources[track.id] || {}
                          }));
                          if (tracksWithIds.length > 0) {
                            const context = playlistPlaybackContext(selectedPlaylist);
                            addToQueue(tracksWithIds, context);
                          }
                        }
})
                  ),
                  // Playlist title inside card - matching grid typography (13px/500)
                  React.createElement('div', {
                    className: 'truncate',
                    style: {
                      fontSize: '13px',
                      fontWeight: '500',
                      color: 'var(--text-primary)',
                      marginTop: '10px',
                      letterSpacing: '0.005em'
                    },
                    title: selectedPlaylist.title
                  }, selectedPlaylist.title),
                  // Track count - matching grid typography (11px)
                  playlistTracks.length === 0 && selectedPlaylist?.isEphemeral ?
                    React.createElement('div', {
                      className: 'h-4 w-20 rounded shimmer-light animate-shimmer',
                      style: { marginTop: '2px' }
                    }) :
                    React.createElement('div', {
                      className: 'truncate',
                      style: {
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        marginTop: '2px'
                      }
                    }, countOf(playlistTracks.length, 'track'))
                );
              })(),

              // Additional metadata below the card (author, edit mode inputs, dates, delete)
              React.createElement('div', { className: 'mt-3 space-y-1', style: { maxWidth: '212px' } },
                // Creator - editable for imported and hosted playlists in edit mode
                playlistEditMode && editedPlaylistData && (selectedPlaylist.id?.startsWith('imported-') || selectedPlaylist.sourceUrl)
                  ? React.createElement(TextField, {
                      value: editedPlaylistData.creator,
                      onChange: (v) => setEditedPlaylistData(prev => ({ ...prev, creator: v })),
                      size: 'sm', className: 'w-full',
                      onKeyDown: (e) => e.stopPropagation(),
                      placeholder: 'Creator name', 'aria-label': 'Creator name'
                    })
                  : React.createElement('p', {
                      className: 'text-sm',
                      style: { color: 'var(--text-tertiary)' }
                    }, `Created by ${selectedPlaylist.creator || 'Unknown'}`),
                // Source info display
                (() => {
                  const source = selectedPlaylist.source || selectedPlaylist.syncedFrom?.resolver;
                  const sourceUrl = selectedPlaylist.sourceUrl;

                  // Determine display text based on source type. A service's
                  // name comes from its plug-in: '<id>-sync' / '<id>-import',
                  // or a bare id (older records, syncedFrom.resolver) when it
                  // is a playback plug-in. A recommendation playlist a meta
                  // service made (source 'listenbrainz') shows no source line.
                  const sourcePlugin = importSourcePluginId(source)
                    || ((allResolvers || []).some(r => r.id === source) ? source : null);
                  let sourceLabel = null;
                  if (sourcePlugin) {
                    sourceLabel = pluginName(sourcePlugin);
                  } else if (source === 'hosted-xspf' || (sourceUrl && !source)) {
                    sourceLabel = 'A playlist link';
                  } else if (source === 'imported-xspf') {
                    sourceLabel = 'An imported file';
                  } else if (source === 'web') {
                    sourceLabel = 'Web';
                  }

                  if (!sourceLabel) return null;

                  // For sources with URLs, make them clickable
                  if (sourceUrl) {
                    return React.createElement('p', {
                      className: 'text-xs',
                      style: { color: 'var(--text-tertiary)' }
                    },
                      'Source: ',
                      React.createElement('a', {
                        href: sourceUrl,
                        onClick: (e) => {
                          e.preventDefault();
                          window.electron?.shell?.openExternal(sourceUrl);
                        },
                        className: 'hover:underline cursor-pointer',
                        style: { color: 'var(--accent-primary)' },
                        'data-tooltip': sourceUrl
                      }, sourceLabel)
                    );
                  }

                  return React.createElement('p', {
                    className: 'text-xs',
                    style: { color: 'var(--text-tertiary)' }
                  }, `Source: ${sourceLabel}`);
                })(),
                // Where it syncs: one Badge per service, named and coloured from
                // its plugin (an id other than Spotify read "Apple Music"), then
                // the local-only switch as a real button that says what it does.
                selectedPlaylist?.syncedTo && !selectedPlaylist.syncedFrom && React.createElement('div', {
                  className: 'flex items-center flex-wrap mt-1',
                  style: { gap: '6px' }
                },
                  ...Object.keys(selectedPlaylist.syncedTo).map(pid => {
                    const service = (allResolvers || []).find(r => r.id === pid);
                    const name = service?.name || pid;
                    return React.createElement(Badge, {
                      key: pid,
                      color: selectedPlaylist.localOnly ? undefined : (service?.color || undefined),
                      tooltip: selectedPlaylist.localOnly ? `Linked to ${name}, but kept local only` : `Syncs to ${name}`
                    }, name);
                  }),
                  React.createElement(Button, {
                    variant: 'secondary',
                    size: 'sm',
                    'data-tooltip': selectedPlaylist.localOnly ? 'Send this playlist\'s changes to its services again' : 'Stop sending this playlist\'s changes to its services',
                    onClick: async () => {
                      const updatedPlaylist = { ...selectedPlaylist, localOnly: !selectedPlaylist.localOnly };
                      setSelectedPlaylist(updatedPlaylist);
                      setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? updatedPlaylist : p));
                      await window.electron.playlists.save(updatedPlaylist);
                      showToast(updatedPlaylist.localOnly ? 'Playlist set to local only' : 'Playlist will sync to services');
                    }
                  }, selectedPlaylist.localOnly ? 'Resume syncing' : 'Keep local only')
                ),
                // Edit mode: Title input
                // The shared TextField (its focus ring and dark-mode colours).
                playlistEditMode && editedPlaylistData && React.createElement(TextField, {
                  value: editedPlaylistData.title,
                  onChange: (v) => setEditedPlaylistData(prev => ({ ...prev, title: v })),
                  size: 'sm', className: 'w-full',
                  onKeyDown: (e) => e.stopPropagation(),
                  placeholder: 'Playlist name', 'aria-label': 'Playlist name'
                }),
                // Created date
                selectedPlaylist.createdAt && React.createElement('p', {
                  className: 'text-xs',
                  style: { color: 'var(--text-tertiary)' }
                }, `Created: ${new Date(selectedPlaylist.createdAt).toLocaleDateString()}`),
                // Last modified date
                selectedPlaylist.lastModified && React.createElement('p', {
                  className: 'text-xs',
                  style: { color: 'var(--text-tertiary)' }
                }, `Modified: ${new Date(selectedPlaylist.lastModified).toLocaleDateString()}`),
                // Delete (edit mode only): the shared destructive Button; it asks
                // first, so the label ends in an ellipsis.
                playlistEditMode && React.createElement(Button, {
                  variant: 'destructive', size: 'sm', className: 'mt-2 w-full',
                  onClick: async () => {
                    // Ask about mirrors when the playlist syncs to/from ANY remote
                    // (source OR push targets, incl. a hosted XSPF mirrored to
                    // Spotify/AM) — not just syncedFrom. Otherwise confirm + delete
                    // locally via the helper that clears BOTH hosted_playlists AND
                    // local_playlists so it can't be re-imported.
                    if (getPlaylistMirrorTargets(selectedPlaylist).length > 0) {
                      setSyncDeleteDialog({ show: true, playlist: selectedPlaylist });
                    } else {
                      if (await window.confirmAsync({ title: `Delete “${selectedPlaylist.title}”?`, message: 'This playlist will be deleted. This can’t be undone.', confirmLabel: 'Delete', destructive: true })) {
                        await deletePlaylistLocally(selectedPlaylist);
                        setPlaylistEditMode(false);
                        setEditedPlaylistData(null);
                        setSelectedPlaylist(null);
                        setPlaylistTracks([]);
                        setPlaylistCoverArt([]);
                        navigateTo('playlists');
                      }
                    }
                  },
                }, 'Delete playlist…')
              ),
              // Share button (outside space-y-1 metadata div for independent spacing)
              React.createElement('div', { className: 'relative mt-5 flex justify-start', style: { width: '100%' } },
                // Share menu (components/menu.js).
                (() => {
                  // What Copy link and View on Achordion both send.
                  const playlistLink = () => ({
                    playlistId: selectedPlaylist.id,
                    listenbrainzMbid: lbMbidOf(selectedPlaylist),
                    title: selectedPlaylist.title,
                    artist: null,
                    creator: selectedPlaylist.creator || null,
                    albumArt: playlistCover || playlistCoverArt?.[0] || null,
                    type: 'playlist',
                    tracks: (playlistTracks || []).map((t, i) => ({
                      title: t.title || 'Unknown',
                      artist: t.artist || null,
                      duration: t.duration || null,
                      trackNumber: t.trackNumber || (i + 1)
                    }))
                  });
                  return React.createElement(Menu, {
                  label: 'Share',
                  renderTrigger: (t) => React.createElement(ShareButton, t),
                  items: [
                    {
                      key: 'copy-link',
                      label: 'Copy link',
                      icon: React.createElement(Icons.Link, { size: 16 }),
                      onSelect: () => publishCollectionSmartLink(playlistLink()),
                    },
                    // On Achordion when it's on ListenBrainz.
                    ...(lbMbidOf(selectedPlaylist) ? [{
                      key: 'view-on-achordion',
                      label: 'View on Achordion',
                      icon: React.createElement(Icons.ExternalLink, { size: 16 }),
                      onSelect: () => publishCollectionSmartLink(playlistLink(), { openInBrowser: true }),
                    }] : []),
                    {
                      key: 'export-xspf',
                      label: 'Export as XSPF…',
                      icon: React.createElement(Icons.Download, { size: 16 }),
                      // Prefer the loaded tracklist (it may be richer than the
                      // stored one); fall back to the stored tracks.
                      onSelect: () => handleExportPlaylist({
                        ...selectedPlaylist,
                        tracks: (playlistTracks && playlistTracks.length) ? playlistTracks : (selectedPlaylist.tracks || [])
                      }),
                    },
                  ],
                  });
                })()
              )
            ),

            // RIGHT COLUMN: Tracklist (scrolls independently)
            React.createElement('div', {
              ref: handlePlaylistTracksScrollRef,
              className: 'flex-1 min-w-0 pt-8 pr-6 pb-6 scrollable-content scroll-edge',
              style: { overflowY: 'auto' }
            },
              // Use edited tracks when in edit mode, otherwise use playlistTracks
              (() => {
                const displayTracks = playlistEditMode && editedPlaylistData ? editedPlaylistData.tracks : playlistTracks;
                // Loaded and empty: say so, rather than loading rows forever.
                if (displayTracks.length === 0 && !playlistEditMode && emptyPlaylistId === selectedPlaylist.id) {
                  return React.createElement('div', {
                    style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '6px', padding: '64px 24px' }
                  },
                    React.createElement('p', { style: { fontSize: '16px', fontWeight: 500, color: 'var(--text-primary)' } }, 'This playlist is empty'),
                    React.createElement('p', { style: { fontSize: '14px', color: 'var(--text-secondary)' } }, 'Add tracks with "Add to Playlist" in any track\'s right-click menu.')
                  );
                }
                return displayTracks.length > 0 ?
                React.createElement(VirtualizedTrackList, {
                  tracks: displayTracks,
                  parentRef: playlistTracksScrollRef,
                  renderRow: (track, index) => {
                    const isDraggedOver = playlistEditMode && playlistDropTarget === index;
                    const isDragging = playlistEditMode && draggedPlaylistTrack === index;
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isNowPlaying = isCurrentTrack && playbackContext?.type === 'playlist' && playbackContext?.id === selectedPlaylist?.id;

                    return React.createElement(TrackRow, {
                      key: track.id || index,
                      track,
                      number: String(index + 1).padStart(2, '0'),
                      isNowPlaying: isNowPlaying && isPlaying,
                      // In edit mode the number is the drag handle with Move up /
                      // Move down, for the keyboard and anyone who can't drag (#1386).
                      lead: playlistEditMode ? React.createElement('span', {
                        className: 'text-ink-tertiary flex-shrink-0 flex items-center',
                        style: { gap: '2px' }
                      },
                        React.createElement(Button, {
                          variant: 'icon', size: 'sm', 'aria-label': `Move ${track.title} up`, 'data-tooltip': 'Move up',
                          disabled: index === 0,
                          onClick: (e) => { e.stopPropagation(); moveInEditedPlaylist(index, index - 1); }
                        }, React.createElement(Icons.ChevronUp, { className: 'w-4 h-4' })),
                        React.createElement(Button, {
                          variant: 'icon', size: 'sm', 'aria-label': `Move ${track.title} down`, 'data-tooltip': 'Move down',
                          disabled: index >= displayTracks.length - 1,
                          onClick: (e) => { e.stopPropagation(); moveInEditedPlaylist(index, index + 1); }
                        }, React.createElement(Icons.ChevronDown, { className: 'w-4 h-4' }))
                      ) : null,
                      sources: { trackSources, playbackResolvers: activeResolvers, resolverOrder },
                      allResolvers,
                      duration: true,
                      sourcesWidth: PLAYLIST_ICON_COLUMN,
                      rowRef: (el) => {
                        if (el && track.id) {
                          playlistTrackRowRefs.current.set(track.id, el);
                          if (playlistObserverRef.current) playlistObserverRef.current.observe(el);
                        } else if (track.id) {
                          playlistTrackRowRefs.current.delete(track.id);
                        }
                      },
                      // The row being dragged, and the one it would drop above.
                      className: `${isDragging ? 'opacity-50 bg-surface-inset' : ''} ${isDraggedOver ? 'border-t-2 border-accent' : ''}`,
                      draggable: true,
                      onDragStart: (e) => {
                        // Always allow dragging to other playlists
                        setDraggingTrackForPlaylist(track);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track }));
                        // Only track index for reordering in edit mode
                        if (playlistEditMode) setDraggedPlaylistTrack(index);
                      },
                      onDragEnd: () => {
                        if (playlistEditMode) {
                          setDraggedPlaylistTrack(null);
                          setPlaylistDropTarget(null);
                        }
                        handlePlaylistDragEnd();
                      },
                      onDragOver: playlistEditMode ? (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        if (draggedPlaylistTrack !== null && draggedPlaylistTrack !== index) setPlaylistDropTarget(index);
                      } : undefined,
                      onDragLeave: playlistEditMode ? () => setPlaylistDropTarget(null) : undefined,
                      onDrop: playlistEditMode ? (e) => {
                        e.preventDefault();
                        if (draggedPlaylistTrack !== null && draggedPlaylistTrack !== index) moveInEditedPlaylist(draggedPlaylistTrack, index);
                        setDraggedPlaylistTrack(null);
                        setPlaylistDropTarget(null);
                      } : undefined,
                      onPlay: (resolverId) => {
                        if (draggedPlaylistTrack !== null) return; // Don't play if dragging
                        setQueueWithContext(playlistTracks.slice(index + 1), playlistPlaybackContext(selectedPlaylist));
                        handlePlay(resolverId ? { ...track, preferredResolver: resolverId } : track);
                      },
                      onOpenArtist: fetchArtistData,
                      // The playlist context, for "Remove from playlist".
                      onContextMenu: () => window.showItemMenu({
                        type: 'track',
                        track: track,
                        inPlaylist: true,
                        playlistId: selectedPlaylist.id,
                        trackIndex: index
                      })
                    });
                  }
                })
              :
                // The shared track row's placeholder, in the rows' columns.
                React.createElement('div', { className: 'space-y-0' },
                  Array.from({ length: 8 }).map((_, index) =>
                    React.createElement(TrackRowSkeleton, { key: `skeleton-${index}`, index, duration: true, sourcesWidth: PLAYLIST_ICON_COLUMN }))
                );
              })()
            )
          )
        )
      );
});

// PlaylistViewLoading: what the playlist page shows between a click and the
// playlist arriving (a link or sync import still loading): the hero with the
// pending title, a sticky header and track-row skeletons in the page's
// columns, so the page doesn't jump when it loads. Moved out of app.js with
// the page (#1451); props are state and setters, no plain functions.
const PlaylistViewLoading = React.memo(function PlaylistViewLoading(props) {
  const {
    pendingPlaylistLoad,
    setActiveView,
    setPendingPlaylistLoad,
    setViewHistory,
  } = props;
  return React.createElement('div', {
        className: 'flex-1 flex flex-col',
        style: { overflow: 'hidden' }
      },
        // Hero header with pending playlist title (real header, not skeleton)
        React.createElement('div', {
          className: 'relative',
          style: {
            height: '140px',
            flexShrink: 0,
            overflow: 'hidden'
          }
        },
          // Gradient background (same as loaded state)
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              // The Playlists hero's gradient (lib/page-colors.js).
              backgroundImage: 'var(--playlists-gradient)',
              backgroundSize: 'cover',
              backgroundPosition: 'center',
              filter: 'blur(20px) brightness(0.7)',
              transform: 'scale(1.2)'
            }
          }),
          // Gradient overlay
          React.createElement('div', {
            className: 'absolute inset-0',
            style: {
              background: 'var(--cover-shade)'
            }
          }),
          // Header content with title
          React.createElement('div', {
            className: 'absolute inset-0 flex items-center px-8 z-10'
          },
            // Playlist icon
            React.createElement('div', {
              className: 'w-6 h-6 rounded-full bg-white/20 flex items-center justify-center mr-3'
            },
              React.createElement('svg', { className: 'w-3 h-3 text-white', fill: 'currentColor', viewBox: '0 0 24 24' },
                React.createElement('circle', { cx: '12', cy: '12', r: '10' })
              )
            ),
            // Playlist name from pending load
            React.createElement('h1', {
              className: 'text-2xl font-bold text-white',
              style: {
                textShadow: 'var(--hero-text-shadow-bar)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase'
              }
            }, pendingPlaylistLoad?.title || 'Loading…')
          )
        ),
        // Content area with sticky bar and loading skeletons
        React.createElement('div', {
          className: 'scrollable-content scroll-edge page-bg',
          style: {
            flex: 1,
            overflowY: 'scroll',
            pointerEvents: 'auto'
          }
        },
          // PLAYLIST DETAILS sticky bar with breadcrumb (same as loaded state)
          React.createElement(StickyBar, { variant: 'header' },
            // Breadcrumb navigation: Playlists > Playlist Name
            React.createElement('div', {
              className: 'flex items-center gap-2 text-xs font-medium tracking-widest uppercase'
            },
              React.createElement('button', {
                onClick: () => {
                  setPendingPlaylistLoad(null);
                  setActiveView('playlists');
                  setViewHistory(['library', 'playlists']);
                },
                className: 'text-ink-tertiary hover:text-ink-secondary transition-colors uppercase'
              }, 'Playlists'),
              React.createElement('span', { className: 'text-ink-faint' }, '/'),
              React.createElement('span', { className: 'text-ink-secondary uppercase' },
                pendingPlaylistLoad?.title || 'Loading'
              )
            ),
            // Close button
            React.createElement(HeaderControl, { close: true, onClick: () => {
                setPendingPlaylistLoad(null);
                setActiveView('playlists');
                setViewHistory(['library', 'playlists']);
              } }, 'Close')
          ),
          // Loading content placeholder
          React.createElement('div', { className: 'flex gap-0 pl-6' },
            // LEFT COLUMN: Skeleton album art and metadata
            React.createElement('div', {
              className: 'flex-shrink-0 pr-8 pt-8',
              // The playlist view's own art column (#1389), so nothing moves
              // when the playlist lands.
              style: { width: PLAYLIST_ART_COLUMN }
            },
              // Skeleton 2x2 album art grid (the card's art: the column less
              // the card's 10px padding each side)
              React.createElement('div', {
                className: 'grid grid-cols-2 gap-0.5 rounded-lg overflow-hidden mb-4',
                style: { width: 'calc(100% - 20px)', aspectRatio: '1 / 1' }
              },
                Array.from({ length: 4 }).map((_, i) =>
                  React.createElement('div', {
                    key: `cover-skeleton-${i}`,
                    className: 'aspect-square shimmer-light animate-shimmer',
                    style: { backgroundSize: '200% 100%', animationDelay: `${i * 50}ms` }
                  })
                )
              ),
              // Skeleton metadata
              React.createElement('div', { className: 'mt-4 space-y-2' },
                React.createElement('div', {
                  className: 'h-5 shimmer-light rounded w-40 animate-shimmer',
                  style: { backgroundSize: '200% 100%' }
                }),
                React.createElement('div', {
                  className: 'h-4 shimmer-light rounded w-32 animate-shimmer',
                  style: { backgroundSize: '200% 100%', animationDelay: '100ms' }
                }),
                React.createElement('div', {
                  className: 'h-4 shimmer-light rounded w-24 animate-shimmer',
                  style: { backgroundSize: '200% 100%', animationDelay: '200ms' }
                })
              )
            ),
            // RIGHT COLUMN: the shared track row's placeholder
            React.createElement('div', { className: 'flex-1 min-w-0 pt-8 pr-6' },
              Array.from({ length: 8 }).map((_, i) =>
                React.createElement(TrackRowSkeleton, { key: `track-skeleton-${i}`, index: i, duration: true })
              )
            )
          )
        )
      );
});

module.exports = { PlaylistViewPage, PlaylistViewLoading, PLAYLIST_VIEW_PAGE_HANDLERS, PLAYLIST_ART_COLUMN, PLAYLIST_ICON_COLUMN };
