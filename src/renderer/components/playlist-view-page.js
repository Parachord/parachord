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
const { HeaderControl } = require('./header-control');
const { Button } = require('./button');
const { CardButton } = require('./card-button');
const { ResolverIcon, ShareButton } = require('./ui-atoms');
const { Menu } = require('./menu');
const { playlistMenu } = require('../lib/item-menus');
const { PlaylistCoverImage } = require('./playlist-cover');
const { VirtualizedTrackList } = require('./track-lists');
const { sourceRowState } = require('../lib/visible-sources');
const { trackDurationLabel } = require('../lib/track-duration');
const { playlistPlaybackContext } = require('../lib/playlist-context');
const { trackSlug } = require('../lib/track-slug');
const { countOf } = require('../lib/plural');
const { syncBannerState } = require('../lib/playlist-sync-banner');
const { tracksFingerprint } = require('../../../sync-engine/auto-pull');

// Column widths that follow the content area (#1389). At the 1000px minimum
// window the content is 744px: a fixed 240px art column and 140px of source
// icons left track titles about 190px. The icon column's skeleton uses it too.
const PLAYLIST_ART_COLUMN = 'clamp(184px, 26%, 240px)';
const PLAYLIST_ICON_COLUMN = 'clamp(72px, 14%, 140px)';

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
    showToast,
    trackSources,
  } = props;
  // The playlist's own cover, when its provider gave it one (a recommended
  // playlist's image — the same one the Recommendations page's card showed —
  // or a provider import's coverArt on a saved record). Shown instead of the
  // 2x2 mosaic everywhere this view renders a cover: the blurred hero
  // background, the 192px card and the share link.
  const playlistCover = (typeof selectedPlaylist?.coverArt === 'string' && selectedPlaylist.coverArt.trim()) || null;
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
                : 'linear-gradient(to bottom right, #f43f5e, #ec4899, #c026d3)',
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
              background: 'linear-gradient(to bottom, rgba(0,0,0,0.3) 0%, rgba(17,17,17,0.95) 100%)'
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
                textShadow: '0 2px 10px rgba(0,0,0,0.5)',
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
                backgroundColor: 'var(--accent-secondary, #6366f1)',
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
          React.createElement('div', {
            className: 'sticky top-0 z-10 flex items-center justify-between px-6 py-4',
            style: { backgroundColor: 'var(--bg-primary)', borderBottom: '1px solid var(--border-default)' }
          },
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
                  if (selectedPlaylist?.isEphemeral) {
                    navigateTo('recommendations');
                  } else {
                    navigateTo('playlists');
                  }
                },
                className: 'transition-colors uppercase',
                style: { color: 'var(--text-tertiary)' },
                onMouseEnter: (e) => { e.currentTarget.style.color = 'var(--text-secondary)'; },
                onMouseLeave: (e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }
              }, selectedPlaylist?.isEphemeral ? 'Recommendations' : 'Playlists'),
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
                    title: selectedPlaylist.weekLabel ? `Weekly Jam - ${selectedPlaylist.weekLabel}` : selectedPlaylist.title,
                    creator: selectedPlaylist.creator || 'ListenBrainz',
                    tracks: playlistTracks,
                    addedAt: Date.now(),
                    lastModified: Date.now(),
                    source: selectedPlaylist.source || 'listenbrainz'
                  };
                  delete newPlaylist.isEphemeral;
                  setPlaylists(prev => [...prev, newPlaylist]);
                  await savePlaylistToStore(newPlaylist);
                  showToast('Playlist saved to library', 'success');
                  // Switch to viewing the saved playlist
                  setSelectedPlaylist({ ...newPlaylist, isEphemeral: false });
                } }, React.createElement(Icons.Check, { className: 'w-4 h-4' }), 'Save'),
              // A playlist imported from a link is kept updated from it or a
              // snapshot (lib/playlist-update-mode.js). Kept updated: check
              // now, or stop. A snapshot never changes, so it has no refresh;
              // "Keep updated" turns updating on (and updates it now).
              (() => {
                if (selectedPlaylist?.isEphemeral || playlistEditMode) return null;
                const mode = linkUpdateMode(selectedPlaylist);
                if (!mode) return null;
                const id = selectedPlaylist.id;
                if (mode === 'snapshot') {
                  return React.createElement(HeaderControl, {
                    onClick: () => setPlaylistUpdateMode(id, 'auto'),
                    'data-tooltip': 'A snapshot of its link. Keep it updated from the link instead'
                  }, 'Keep updated');
                }
                return React.createElement(React.Fragment, null,
                  React.createElement(HeaderControl, {
                    onClick: async () => {
                      if (refreshingPlaylist === id) return;
                      setRefreshingPlaylist(id);
                      try { await refreshHostedPlaylist(id); }
                      finally { setRefreshingPlaylist(null); }
                    },
                    'data-tooltip': 'Updates on its own from its link. This checks now'
                  }, refreshingPlaylist === id ? 'Checking…' : 'Check now'),
                  React.createElement(HeaderControl, {
                    onClick: () => setPlaylistUpdateMode(id, 'snapshot'),
                    'data-tooltip': 'Keep it as it is now and stop updating it'
                  }, 'Stop updating'));
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
                        lastModified: Date.now()
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
                  if (selectedPlaylist?.isEphemeral) {
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
              const providerName = providerId === 'spotify' ? 'Spotify' : providerId === 'applemusic' ? 'Apple Music' : providerId;
              return React.createElement('div', {
                key: `remote-deleted-${providerId}`,
                className: `mx-4 mt-3 p-3 rounded-lg border`,
                style: { background: 'rgba(234, 179, 8, 0.12)', borderColor: 'rgba(234, 179, 8, 0.25)' }
              },
                React.createElement('div', { className: 'text-sm font-medium text-ink-warning mb-2' },
                  `"${playlist.title}" was deleted on ${providerName}`
                ),
                React.createElement('div', { className: 'flex gap-2' },
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-tint-danger text-ink-danger hover:bg-tint-danger-hover transition-colors',
                    onClick: async () => {
                      // Delete locally too (remote already gone) — via the helper
                      // so a hosted XSPF is cleared from BOTH stores.
                      await deletePlaylistLocally(playlist);
                      setSelectedPlaylist(null);
                    }
                  }, 'Delete locally too'),
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-surface-inset text-ink-secondary hover:bg-surface-hover transition-colors',
                    onClick: async () => {
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
                    }
                  }, 'Stop syncing'),
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
            const providerName = provider === 'spotify' ? 'Spotify' : provider;
            const syncState = banner.state; // 'push' | 'conflict'
            const localIsNewer = banner.localIsNewer;

            // Colors based on state
            const colors = {
              push: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.25)', text: 'text-ink-success', iconBg: 'rgba(34, 197, 94, 0.2)' },
              conflict: { bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.25)', text: 'text-ink-warning', iconBg: 'rgba(234, 179, 8, 0.2)' }
            };
            const c = colors[syncState];

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
                const result = await window.electron.sync.pushPlaylist(provider, externalId, playlist.tracks, metadata);
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

            return React.createElement('div', {
              className: 'mx-4 mb-4 overflow-hidden rounded-lg',
              style: {
                background: `linear-gradient(135deg, ${c.bg} 0%, ${c.bg} 100%)`,
                border: `1px solid ${c.border}`,
                boxShadow: `0 2px 8px ${c.bg}`
              }
            },
              React.createElement('div', {
                className: 'flex items-center justify-between px-4 py-3'
              },
                // Left side: icon + message
                React.createElement('div', { className: 'flex items-center gap-3' },
                  React.createElement('div', {
                    className: 'flex items-center justify-center w-8 h-8 rounded-full',
                    style: { background: c.iconBg }
                  },
                    React.createElement('svg', {
                      className: `w-4 h-4 ${c.text}`,
                      fill: 'none',
                      stroke: 'currentColor',
                      viewBox: '0 0 24 24'
                    },
                      syncState === 'push'
                        ? React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' })
                        : React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' })
                    )
                  ),
                  React.createElement('div', { className: 'flex flex-col' },
                    React.createElement('span', {
                      className: `text-xs font-medium tracking-widest uppercase ${c.text}`
                    }, syncState === 'push' ? 'Local Changes' : 'Sync Conflict'),
                    React.createElement('span', {
                      className: 'text-sm text-ink-secondary'
                    }, syncState === 'push'
                      ? `Push your changes to ${providerName}`
                      : localIsNewer
                      ? `Your local changes are newer`
                      : `${providerName} version is newer`)
                  )
                ),
                // Right side: action buttons
                React.createElement('div', { className: 'flex items-center gap-2' },
                  React.createElement('button', {
                    onClick: handleDismiss,
                    className: 'px-3 py-1.5 text-xs font-medium text-ink-tertiary hover:text-ink-secondary transition-colors'
                  }, 'Dismiss'),

                  // For conflict state, show both options
                  syncState === 'conflict' && React.createElement('button', {
                    onClick: handlePull,
                    className: 'flex items-center gap-1.5 px-3 py-1.5 bg-surface-inset text-ink-secondary text-xs font-medium rounded-full hover:bg-surface-hover transition-colors'
                  },
                    React.createElement(Icons.Download, { className: 'w-4 h-4' }),
                    `Use ${providerName}`
                  ),

                  // Primary action button
                  React.createElement('button', {
                    onClick: syncState === 'push' || (syncState === 'conflict' && localIsNewer) ? handlePush : handlePull,
                    className: `flex items-center gap-1.5 px-4 py-1.5 text-white text-xs font-medium rounded-full transition-colors ${
                      syncState === 'push' ? 'bg-green-600 hover:bg-green-700' :
                      localIsNewer ? 'bg-green-600 hover:bg-green-700' : 'bg-accent-fill hover:bg-accent-fill-hover'
                    }`,
                    style: { boxShadow: `0 2px 8px ${syncState === 'push' || (syncState === 'conflict' && localIsNewer) ? 'rgba(34, 197, 94, 0.3)' : 'rgba(147, 51, 234, 0.3)'}` }
                  },
                    React.createElement('svg', { className: 'w-3.5 h-3.5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      syncState === 'push' || (syncState === 'conflict' && localIsNewer)
                        ? React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' })
                        : React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                    ),
                    syncState === 'push' ? `Push to ${providerName}` :
                    localIsNewer ? 'Push Local' : 'Pull Remote'
                  )
                )
              )
            );
          })(),

          // Two-column layout: playlist cover + metadata on left, tracklist on right
          React.createElement('div', { className: 'flex gap-0 px-6 pb-6', style: { flex: 1, minHeight: 0 } },
            // LEFT COLUMN: 2x2 album art grid and metadata (fixed, scrolls independently)
            React.createElement('div', {
              className: 'flex-shrink-0 pr-8 pt-8 scrollable-content',
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
                  React.createElement('div', {
                    className: 'rounded-lg overflow-hidden album-art-container group/art relative',
                    style: {
                      width: '100%',
                      aspectRatio: '1 / 1'
                    }
                  },
                    hasCachedCovers ?
                      React.createElement('div', { className: 'grid grid-cols-2 grid-rows-2 w-full h-full' },
                        [0, 1, 2, 3].map(idx => {
                          return React.createElement('div', {
                            key: idx,
                            className: 'relative w-full h-full flex items-center justify-center',
                            style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                          },
                            !covers[idx] && React.createElement(Music, { size: 20, className: 'text-ink-secondary' }),
                            covers[idx] && React.createElement('img', {
                              src: covers[idx],
                              alt: '',
                              className: 'absolute inset-0 w-full h-full object-cover transition-opacity duration-300',
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
                        style: { background: 'linear-gradient(145deg, #1f1f1f 0%, #2d2d2d 50%, #1a1a1a 100%)' }
                      },
                        // Playlist icon (three lines with play triangle)
                        React.createElement('svg', { className: 'w-12 h-12 text-ink-tertiary', viewBox: '0 0 24 24', fill: 'currentColor' },
                          React.createElement('rect', { x: 3, y: 5, width: 18, height: 2, rx: 1 }),
                          React.createElement('rect', { x: 3, y: 11, width: 10, height: 2, rx: 1 }),
                          React.createElement('rect', { x: 3, y: 17, width: 7, height: 2, rx: 1 }),
                          React.createElement('path', { d: 'M15 13.5v6l5.5-3-5.5-3z' })
                        )
                      ),
                    // The playlist's own cover, over the mosaic/placeholder
                    // (DOM order = paint order here; see the comment above).
                    playlistCover && React.createElement(PlaylistCoverImage, { url: playlistCover }),
                    // Hover overlay with action buttons
                    React.createElement('div', {
                      className: 'absolute inset-0 bg-black/50 opacity-0 group-hover/art:opacity-100 transition-opacity duration-200 flex items-center justify-center gap-3',
                      style: { pointerEvents: 'auto' }
                    },
                      // Add to Playlist button
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
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
                        className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        'aria-label': 'Add to playlist', 'data-tooltip': 'Add to playlist'
                      },
                        React.createElement(Icons.Plus, { className: 'w-5 h-5' })
                      ),
                      // Play button (center, larger)
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
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
                        className: 'w-12 h-12 bg-surface-card rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                        style: { border: 'none', cursor: 'pointer' },
                        'aria-label': 'Play', 'data-tooltip': 'Play'
                      },
                        React.createElement(Play, { size: 22, className: 'text-ink-primary ml-0.5' })
                      ),
                      // Add to Queue button
                      React.createElement('button', {
                        onClick: (e) => {
                          e.stopPropagation();
                          const tracksWithIds = (playlistTracks || []).map(track => ({
                            ...track,
                            id: track.id || trackSlug(track.artist || 'unknown', track.title || 'untitled'),
                            sources: trackSources[track.id] || {}
                          }));
                          if (tracksWithIds.length > 0) {
                            const context = playlistPlaybackContext(selectedPlaylist);
                            addToQueue(tracksWithIds, context);
                          }
                        },
                        className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        'aria-label': 'Add to queue', 'data-tooltip': 'Add to queue'
                      },
                        React.createElement(Icons.QueueAdd, { className: 'w-5 h-5', strokeWidth: 2 })
                      )
                    )
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
                  ? React.createElement('input', {
                      type: 'text',
                      value: editedPlaylistData.creator,
                      onChange: (e) => setEditedPlaylistData(prev => ({ ...prev, creator: e.target.value })),
                      className: 'text-sm rounded px-2 py-1 w-full focus:outline-none',
                      style: { backgroundColor: 'var(--bg-inset)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' },
                      onFocus: (e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 58, 237, 0.15)'; },
                      onBlur: (e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.boxShadow = 'none'; },
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

                  // Determine display text based on source type
                  let sourceLabel = null;
                  if (source === 'spotify-sync' || source === 'spotify-import' || source === 'spotify') {
                    sourceLabel = 'Spotify';
                  } else if (source === 'applemusic-sync' || source === 'applemusic-import' || source === 'applemusic') {
                    sourceLabel = 'Apple Music';
                  } else if (source === 'amazonmusic-import' || source === 'amazonmusic') {
                    sourceLabel = 'Amazon Music';
                  } else if (source === 'soundcloud-import' || source === 'soundcloud') {
                    sourceLabel = 'SoundCloud';
                  } else if (source === 'youtube-import' || source === 'youtube') {
                    sourceLabel = 'YouTube';
                  } else if (source === 'hosted-xspf' || (sourceUrl && !source)) {
                    sourceLabel = 'Hosted XSPF';
                  } else if (source === 'imported-xspf') {
                    sourceLabel = 'Imported XSPF';
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
                // Sync status for syncedTo playlists
                selectedPlaylist?.syncedTo && !selectedPlaylist.syncedFrom && React.createElement('div', {
                  className: 'flex items-center gap-2 mt-1'
                },
                  // Provider icons
                  ...Object.keys(selectedPlaylist.syncedTo).map(pid =>
                    React.createElement('span', {
                      key: pid,
                      className: `text-xs px-2 py-0.5 rounded-full ${
                        pid === 'spotify' ? 'bg-green-100 text-ink-success' : 'bg-pink-100 text-pink-700'
                      }`,
                      title: `Synced to ${pid === 'spotify' ? 'Spotify' : 'Apple Music'}`
                    }, pid === 'spotify' ? 'Spotify' : 'Apple Music')
                  ),
                  // Local only toggle
                  React.createElement('button', {
                    className: `text-xs px-2 py-0.5 rounded-full transition-colors ${
                      selectedPlaylist.localOnly
                        ? 'bg-surface-inset text-ink-secondary'
                        : 'bg-surface-inset text-ink-tertiary hover:bg-surface-hover'
                    }`,
                    onClick: async () => {
                      const updatedPlaylist = { ...selectedPlaylist, localOnly: !selectedPlaylist.localOnly };
                      setSelectedPlaylist(updatedPlaylist);
                      setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? updatedPlaylist : p));
                      await window.electron.playlists.save(updatedPlaylist);
                      showToast(updatedPlaylist.localOnly ? 'Playlist set to local only' : 'Playlist will sync to services');
                    }
                  }, selectedPlaylist.localOnly ? 'Local only' : 'Syncing')
                ),
                // Edit mode: Title input
                playlistEditMode && editedPlaylistData && React.createElement('input', {
                  type: 'text',
                  value: editedPlaylistData.title,
                  onChange: (e) => setEditedPlaylistData(prev => ({ ...prev, title: e.target.value })),
                  className: 'font-bold text-sm leading-tight rounded px-2 py-1 w-full focus:outline-none',
                  style: { backgroundColor: 'var(--bg-inset)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' },
                  onFocus: (e) => { e.currentTarget.style.borderColor = 'var(--accent-primary)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 58, 237, 0.15)'; },
                  onBlur: (e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.boxShadow = 'none'; },
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
                // Delete Playlist button (only in edit mode)
                playlistEditMode && React.createElement('button', {
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
                  className: 'mt-2 flex items-center gap-2 px-3 py-2 text-sm rounded transition-colors no-drag w-full justify-center',
                  style: { color: 'var(--text-danger)', border: '1px solid rgba(239, 68, 68, 0.3)' },
                  onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.color = 'var(--text-danger)'; },
                  onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-danger)'; }
                }, 'Delete Playlist')
              ),
              // Share button (outside space-y-1 metadata div for independent spacing)
              React.createElement('div', { className: 'relative mt-5 flex justify-start', style: { width: '100%' } },
                // Share menu (components/menu.js).
                React.createElement(Menu, {
                  label: 'Share',
                  renderTrigger: (t) => React.createElement(ShareButton, t),
                  items: [
                    {
                      key: 'copy-link',
                      label: 'Copy link',
                      icon: React.createElement(Icons.Link, { size: 16 }),
                      onSelect: () => publishCollectionSmartLink({
                        playlistId: selectedPlaylist.id,
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
                      }),
                    },
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
                })
              )
            ),

            // RIGHT COLUMN: Tracklist (scrolls independently)
            React.createElement('div', {
              ref: handlePlaylistTracksScrollRef,
              className: 'flex-1 min-w-0 pt-8 scrollable-content',
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
                    // Use track.id to look up resolved sources from trackSources state
                    // The row's sources, one rule for every list (lib/visible-sources):
                    // resolving (shimmer), unplayable (dimmed, no icons) or playable.
                    const { shown: shownSources, state: sourceState } = sourceRowState(track, { trackSources, playbackResolvers: activeResolvers, resolverOrder });
                    const hasResolved = sourceState === 'playable';
                    const isResolving = sourceState === 'resolving';
                    const isUnplayable = sourceState === 'unplayable';
                    const isDraggedOver = playlistEditMode && playlistDropTarget === index;
                    const isDragging = playlistEditMode && draggedPlaylistTrack === index;
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isNowPlaying = isCurrentTrack && playbackContext?.type === 'playlist' && playbackContext?.id === selectedPlaylist?.id;

                    return React.createElement(CardButton, { label: `${track.title} by ${track.artist}`, more: `More actions for ${track.title}`,
                    current: isNowPlaying,
                      key: track.id || index,
                      'data-track-id': track.id,
                      ref: (el) => {
                        if (el && track.id) {
                          playlistTrackRowRefs.current.set(track.id, el);
                          if (playlistObserverRef.current) {
                            playlistObserverRef.current.observe(el);
                          }
                        } else if (track.id) {
                          playlistTrackRowRefs.current.delete(track.id);
                        }
                      },
                      draggable: true,
                      onDragStart: (e) => {
                        // Always allow dragging to other playlists
                        setDraggingTrackForPlaylist(track);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', JSON.stringify({ type: 'track', track }));
                        // Only track index for reordering in edit mode
                        if (playlistEditMode) {
                          setDraggedPlaylistTrack(index);
                        }
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
                        if (draggedPlaylistTrack !== null && draggedPlaylistTrack !== index) {
                          setPlaylistDropTarget(index);
                        }
                      } : undefined,
                      onDragLeave: playlistEditMode ? () => {
                        setPlaylistDropTarget(null);
                      } : undefined,
                      onDrop: playlistEditMode ? (e) => {
                        e.preventDefault();
                        if (draggedPlaylistTrack !== null && draggedPlaylistTrack !== index) {
                          moveInEditedPlaylist(draggedPlaylistTrack, index);
                        }
                        setDraggedPlaylistTrack(null);
                        setPlaylistDropTarget(null);
                      } : undefined,
                      className: `flex items-center gap-4 py-3 px-4 transition-all no-drag group ${
                        playlistEditMode ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
                      } ${isResolving || isUnplayable ? 'opacity-60' : ''} ${isDragging ? 'opacity-50 bg-surface-inset' : ''} ${isDraggedOver ? 'border-t-2 border-t-purple-500' : ''} ${isNowPlaying && isPlaying ? 'bg-accent-tint' : 'hover:bg-surface-hover'}`,
                      style: {
                        borderRadius: '8px',
                        marginBottom: '2px'
                      },
                      onActivate: () => {
                        if (draggedPlaylistTrack !== null) return; // Don't play if dragging
                        const tracksAfter = playlistTracks.slice(index + 1);
                        const context = playlistPlaybackContext(selectedPlaylist);
                        setQueueWithContext(tracksAfter, context);
                        handlePlay(track);
                      },
                      onContextMenu: (e) => {
                        e.preventDefault();
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.showItemMenu({
                            type: 'track',
                            track: track,
                            // Pass playlist context for "Remove from Playlist" option
                            inPlaylist: true,
                            playlistId: selectedPlaylist.id,
                            trackIndex: index
                          });
                        }
                      }
                    },
                      // Track number, or in edit mode the drag handle with
                      // Move up / Move down for the keyboard and anyone who
                      // can't drag (#1386).
                      playlistEditMode
                        ? React.createElement('span', {
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
                          )
                        : React.createElement('span', {
                            className: 'flex-shrink-0 text-right',
                            style: {
                              pointerEvents: 'none',
                              width: '32px',
                              fontSize: '12px',
                              fontWeight: '500',
                              color: isNowPlaying && isPlaying ? 'var(--accent-secondary)' : 'var(--text-tertiary)'
                            }
                          }, isNowPlaying && isPlaying ? '▶' : String(index + 1).padStart(2, '0')),

                      // Track title - flexible column
                      React.createElement('span', {
                        className: 'truncate transition-colors',
                        style: {
                          pointerEvents: 'none',
                          flex: '1 1 0',
                          minWidth: 0,
                          fontSize: '13px',
                          fontWeight: isNowPlaying && isPlaying ? '500' : '400',
                          color: isNowPlaying && isPlaying ? 'var(--accent-primary)' : hasResolved ? 'var(--text-primary)' : 'var(--text-tertiary)'
                        }
                      }, track.title),

                      // Artist name - flexible column, clickable
                      React.createElement('button', { type: 'button',
                        className: 'text-left truncate hover:text-accent hover:underline cursor-pointer transition-colors',
                        style: {
                          flex: '0.7 1 0',
                          minWidth: 0,
                          fontSize: '12px',
                          color: 'var(--text-secondary)'
                        },
                        onClick: (e) => {
                          e.stopPropagation();
                          fetchArtistData(track.artist);
                        }
                      }, track.artist),

                      // Duration - fixed width column (before resolver icons)
                      React.createElement('span', {
                        className: 'text-right tabular-nums flex-shrink-0',
                        style: {
                          pointerEvents: 'none',
                          width: '50px',
                          fontSize: '12px',
                          color: 'var(--text-tertiary)'
                        }
                      }, trackDurationLabel(track, { trackSources, resolverOrder })),

                      // Resolver icons - fixed width column (last column)
                      React.createElement('div', {
                        className: 'flex items-center gap-1 justify-end',
                        style: { width: PLAYLIST_ICON_COLUMN, flexShrink: 0, minHeight: '24px', overflow: 'hidden' }
                      },
                        isResolving ?
                          React.createElement('div', {
                            className: 'flex items-center gap-1'
                          },
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              title: 'Resolving track…'
                            }),
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          )
                        : hasResolved ? (() => {
                            // The shared source-icon rule (lib/visible-sources), with
                            // activeResolvers = playbackResolvers from app.js.
                            return shownSources
                              .map(({ resolverId, source, dim }) => {
                                const resolver = allResolvers.find(r => r.id === resolverId);
                                if (!resolver || !resolver.play) return null;
                                return React.createElement('button', {
                                  key: resolverId,
                                  className: 'no-drag',
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    const tracksAfter = playlistTracks.slice(index + 1);
                                    const context = playlistPlaybackContext(selectedPlaylist);
                                    setQueueWithContext(tracksAfter, context);
                                    handlePlay({ ...track, preferredResolver: resolverId });
                                  },
                                  style: {
                                    width: '20px',
                                    height: '20px',
                                    borderRadius: '4px',
                                    backgroundColor: resolver.color,
                                    border: 'none',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    pointerEvents: 'auto',
                                    opacity: dim ? 0.6 : 1,
                                    transition: 'transform 0.1s'
                                  },
                                  onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                                  onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                                  'aria-label': `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`, 'data-tooltip': `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`
                                }, React.createElement(ResolverIcon, { resolverId, size: 12 }));
                              });
                          })()
                        :
                          // Unplayable: no icons; the row is dimmed.
                          null
                      )
                    );
                  }
                })
              :
                // Skeleton loaders while tracks are loading
                React.createElement('div', { className: 'space-y-0' },
                  Array.from({ length: 8 }).map((_, index) =>
                    React.createElement('div', {
                      key: `skeleton-${index}`,
                      className: 'flex items-center gap-4 py-3 px-4',
                      style: { borderRadius: '8px', marginBottom: '2px' }
                    },
                      // Track number skeleton
                      React.createElement('div', {
                        className: 'w-6 h-4 rounded shimmer-light animate-shimmer',
                        style: { width: '32px', animationDelay: `${index * 50}ms` }
                      }),
                      // Track title skeleton - flexible
                      React.createElement('div', {
                        className: 'h-4 rounded shimmer-light animate-shimmer',
                        style: { flex: '1 1 0', minWidth: 0, animationDelay: `${index * 50 + 25}ms` }
                      }),
                      // Artist name skeleton - flexible
                      React.createElement('div', {
                        className: 'h-4 rounded shimmer-light animate-shimmer',
                        style: { flex: '0.7 1 0', minWidth: 0, animationDelay: `${index * 50 + 50}ms` }
                      }),
                      // Duration skeleton
                      React.createElement('div', {
                        className: 'h-4 rounded shimmer-light animate-shimmer flex-shrink-0',
                        style: { width: '40px', animationDelay: `${index * 50 + 75}ms` }
                      }),
                      // Resolver icons skeleton
                      React.createElement('div', { className: 'flex items-center gap-1', style: { width: PLAYLIST_ICON_COLUMN, flexShrink: 0 } },
                        React.createElement('div', {
                          className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                          style: { animationDelay: `${index * 50 + 100}ms` }
                        }),
                        React.createElement('div', {
                          className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                          style: { animationDelay: `${index * 50 + 125}ms` }
                        })
                      )
                    )
                  )
                );
              })()
            )
          )
        )
      );
});

module.exports = { PlaylistViewPage, PLAYLIST_VIEW_PAGE_HANDLERS, PLAYLIST_ART_COLUMN, PLAYLIST_ICON_COLUMN };
