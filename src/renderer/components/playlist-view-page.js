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
// The one ref read during render, resolverLoaderRef (the hosted / imported
// playlist check), changes only when resolvers load, which also changes the
// allResolvers prop. tests/renderer/page-memo.test.js checks the call site.
//
// The body is the original render expression, unchanged: it reads its inputs
// from props under their old names.

const Icons = require('./icons');
const { ResolverIcon } = require('./ui-atoms');
const { VirtualizedTrackList, getBestSourceConfidence } = require('./track-lists');
const { trackSlug } = require('../lib/track-slug');

const { Play, Music } = Icons;

// Plain functions from Parachord, passed as stable wrappers.
const PLAYLIST_VIEW_PAGE_HANDLERS = [
  'addToQueue',
  'copyParachordLink',
  'deletePlaylistLocally',
  'fetchArtistData',
  'getPlaylistMirrorTargets',
  'handleExportPlaylist',
  'handlePlay',
  'handlePlaylistDragEnd',
  'markPlaylistAsLocallyModified',
  'moveInEditedPlaylist',
  'navigateTo',
  'refreshHostedPlaylist',
  'savePlaylistToStore',
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
    fetchArtistData,
    formatTime,
    getPlaylistMirrorTargets,
    handleExportPlaylist,
    handlePlay,
    handlePlaylistDragEnd,
    handlePlaylistTracksScrollRef,
    isPlaying,
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
    resolverLoaderRef,
    resolverOrder,
    savePlaylistToStore,
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
    setPlaylists,
    setQueueWithContext,
    setRefreshingPlaylist,
    setSelectedPlaylist,
    setSelectedPlaylistsForAdd,
    setShareDropdownOpen,
    setSyncDeleteDialog,
    setTrackLoading,
    shareDropdownOpen,
    showToast,
    trackSources,
  } = props;
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
          // Background with first album art or gradient
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
          }),
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
              title: "You're a collaborator on this playlist — your edits sync to other collaborators",
              style: {
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'var(--accent-secondary, #6366f1)',
                color: 'var(--accent-secondary-fg, #fff)',
                fontWeight: 600,
                marginLeft: '6px',
                display: 'inline-block',
                verticalAlign: 'middle',
                letterSpacing: '0.05em'
              }
            }, 'SHARED')
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
          className: 'bg-white',
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
            // Breadcrumb navigation: Playlists > Playlist Name (or HOME for ephemeral)
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
                  // Navigate to HOME for ephemeral playlists, otherwise to playlists
                  if (selectedPlaylist?.isEphemeral) {
                    navigateTo('home');
                  } else {
                    navigateTo('playlists');
                  }
                },
                className: 'transition-colors uppercase',
                style: { color: 'var(--text-tertiary)' },
                onMouseEnter: (e) => { e.currentTarget.style.color = 'var(--text-secondary)'; },
                onMouseLeave: (e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; }
              }, selectedPlaylist?.isEphemeral ? 'HOME' : 'Playlists'),
              React.createElement('span', { style: { color: 'var(--text-tertiary)' } }, '/'),
              React.createElement('span', { className: 'uppercase', style: { color: 'var(--text-secondary)' } },
                playlistEditMode ? 'Editing' : (selectedPlaylist?.weekLabel || selectedPlaylist.title || 'Playlist Details')
              )
            ),
            React.createElement('div', { className: 'flex items-center gap-2' },
              // SAVE button for ephemeral playlists
              selectedPlaylist?.isEphemeral && !playlistEditMode && React.createElement('button', {
                onClick: async () => {
                  // Save ephemeral playlist to library
                  const newPlaylist = {
                    id: `playlist-${Date.now()}`,
                    title: selectedPlaylist.weekLabel ? `Weekly Jam - ${selectedPlaylist.weekLabel}` : selectedPlaylist.title,
                    creator: 'ListenBrainz',
                    description: selectedPlaylist.description,
                    tracks: playlistTracks,
                    addedAt: Date.now(),
                    lastModified: Date.now(),
                    source: 'listenbrainz'
                  };
                  setPlaylists(prev => [...prev, newPlaylist]);
                  await savePlaylistToStore(newPlaylist);
                  showToast('Playlist saved to library', 'success');
                  // Switch to viewing the saved playlist
                  setSelectedPlaylist({ ...newPlaylist, isEphemeral: false });
                },
                className: 'flex items-center gap-1 px-3 py-1 text-xs text-white bg-orange-500 hover:bg-orange-600 rounded transition-colors no-drag'
              },
                React.createElement('svg', { className: 'w-3.5 h-3.5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                  React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M5 13l4 4L19 7' })
                ),
                'SAVE'
              ),
              // Manual refresh. Provider URL imports are snapshots — they are not
              // re-fetched at launch (that path parsed the provider page as XSPF
              // and dialoged). Hosted XSPF still auto-updates; this is the
              // on-demand path for both.
              !selectedPlaylist?.isEphemeral && !playlistEditMode && selectedPlaylist?.sourceUrl
                && (selectedPlaylist.source === 'hosted-xspf' || window.isProviderImportedPlaylist(selectedPlaylist, resolverLoaderRef.current))
                && React.createElement('button', {
                  onClick: async () => {
                    if (refreshingPlaylist === selectedPlaylist.id) return;
                    setRefreshingPlaylist(selectedPlaylist.id);
                    try { await refreshHostedPlaylist(selectedPlaylist.id); }
                    finally { setRefreshingPlaylist(null); }
                  },
                  className: 'flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors no-drag',
                  style: { color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' },
                  title: 'Re-import from the source URL. This does not run at launch.',
                  onMouseEnter: (e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)'; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }
                }, refreshingPlaylist === selectedPlaylist.id ? 'REFRESHING' : 'REFRESH'),
              // Edit / Cancel+Done buttons (only for non-ephemeral playlists)
              !selectedPlaylist?.isEphemeral && (playlistEditMode ? React.createElement(React.Fragment, null,
                // Cancel button
                React.createElement('button', {
                  onClick: () => {
                    setPlaylistEditMode(false);
                    setEditedPlaylistData(null);
                  },
                  className: 'flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors no-drag',
                  style: { color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' },
                  onMouseEnter: (e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)'; },
                  onMouseLeave: (e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }
                }, 'CANCEL'),
                // Done button
                React.createElement('button', {
                  onClick: async () => {
                    if (editedPlaylistData) {
                      const updated = {
                        ...selectedPlaylist,
                        title: editedPlaylistData.title,
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
                  },
                  className: 'flex items-center gap-1 px-3 py-1 text-xs text-white rounded transition-colors no-drag',
                  style: { backgroundColor: '#7c3aed' },
                  onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = '#6d28d9'; },
                  onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = '#7c3aed'; }
                }, 'DONE')
              ) : React.createElement('button', {
                onClick: () => {
                  setPlaylistEditMode(true);
                  setEditedPlaylistData({
                    title: selectedPlaylist.title,
                    creator: selectedPlaylist.creator || '',
                    tracks: [...playlistTracks]
                  });
                },
                className: 'flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors no-drag',
                style: { color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' },
                onMouseEnter: (e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)'; },
                onMouseLeave: (e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }
              }, 'EDIT')),
              // Close button (hidden in edit mode since Cancel serves that purpose)
              !playlistEditMode && React.createElement('button', {
                onClick: () => {
                  setSelectedPlaylist(null);
                  setPlaylistTracks([]);
                  setPlaylistCoverArt([]);
                  // Navigate to HOME for ephemeral playlists, otherwise to playlists
                  if (selectedPlaylist?.isEphemeral) {
                    navigateTo('home');
                  } else {
                    navigateTo('playlists');
                  }
                },
                className: 'flex items-center gap-1 px-3 py-1 text-xs rounded transition-colors no-drag',
                style: { color: 'var(--text-tertiary)', border: '1px solid var(--border-default)' },
                onMouseEnter: (e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'var(--hover-bg-default)'; },
                onMouseLeave: (e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.backgroundColor = 'transparent'; }
              },
                'CLOSE',
                React.createElement('span', { style: { color: 'var(--text-tertiary)' } }, '×')
              )
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
                React.createElement('div', { className: 'text-sm font-medium text-yellow-700 mb-2' },
                  `"${playlist.title}" was deleted on ${providerName}`
                ),
                React.createElement('div', { className: 'flex gap-2' },
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-red-100 text-red-700 hover:bg-red-200 transition-colors',
                    onClick: async () => {
                      // Delete locally too (remote already gone) — via the helper
                      // so a hosted XSPF is cleared from BOTH stores.
                      await deletePlaylistLocally(playlist);
                      setSelectedPlaylist(null);
                    }
                  }, 'Delete locally too'),
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors',
                    onClick: async () => {
                      // Keep local, stop syncing to this provider
                      const updatedSyncedTo = { ...playlist.syncedTo };
                      delete updatedSyncedTo[providerId];
                      const hasAnySyncedTo = Object.keys(updatedSyncedTo).length > 0;
                      const updatedPlaylist = {
                        ...playlist,
                        syncedTo: hasAnySyncedTo ? updatedSyncedTo : undefined,
                        localOnly: !hasAnySyncedTo ? true : playlist.localOnly
                      };
                      setSelectedPlaylist(updatedPlaylist);
                      setPlaylists(prev => prev.map(p => p.id === playlist.id ? updatedPlaylist : p));
                      await window.electron.playlists.save(updatedPlaylist);
                    }
                  }, 'Stop syncing'),
                  React.createElement('button', {
                    className: 'text-xs px-3 py-1.5 rounded-md bg-purple-100 text-purple-700 hover:bg-purple-200 transition-colors',
                    onClick: async () => {
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
                    }
                  }, 'Re-create')
                )
              );
            });
          })(),

          // Playlist sync banner (shown when playlist needs sync - push, pull, or conflict)
          (() => {
            const playlist = selectedPlaylist;
            if (!playlist?.syncedFrom) return null;

            const hasRemoteUpdates = playlist.hasUpdates;
            const provider = playlist.syncedFrom.resolver;
            const providerName = provider === 'spotify' ? 'Spotify' : provider;

            // `locallyModified: true` has two triggers: (a) the user edited
            // local content, and (b) handlePull on a multi-mirror playlist
            // sets it so the next push loop propagates the pull to OTHER
            // mirrors. The push banner here targets the source provider
            // (syncedFrom.resolver), so showing it for case (b) is a lie —
            // pushing back to the source we just pulled from is a no-op
            // (the push loop's provider-scoped syncedFrom guard correctly
            // skips it). Gate on actual divergence from the source: local
            // content is newer than the last time we agreed with it.
            const sourceSyncedAt = playlist.syncSources?.[provider]?.syncedAt || 0;
            const localLastModified = playlist.lastModified || 0;
            const hasLocalChanges = !!playlist.locallyModified && localLastModified > sourceSyncedAt;

            // No sync needed
            if (!hasRemoteUpdates && !hasLocalChanges) return null;

            // Hosted XSPF playlists have a stronger upstream than the remote
            // provider: the hosted URL poller runs every 5 minutes and will
            // revert any pulled tracks by re-applying the XSPF. Pull on a
            // hosted playlist is therefore a no-op (or worse — the
            // subsequent push would overwrite the remote changes anyway).
            // Suppress the pull UI entirely and treat conflict as push-only.
            // Provider URL imports also carry sourceUrl, but nothing polls them.
            // Treating them as hosted hides a real pull. Hosted means the XSPF
            // poller is still the upstream.
            const isProviderSnapshot = typeof playlist.source === 'string' && playlist.source.endsWith('-import');
            const isHosted = !!playlist.sourceUrl && !isProviderSnapshot;
            if (isHosted && !hasLocalChanges) {
              // Pure pull state would be meaningless — the XSPF poller wins.
              return null;
            }

            // Determine sync state and which version is newer
            const localModTime = playlist.lastModified || 0;
            const lastSyncTime = playlist.syncSources?.[provider]?.syncedAt || 0;

            // For conflicts, local wins if modified after last sync
            const localIsNewer = localModTime > lastSyncTime;

            // Sync state: 'push' | 'pull' | 'conflict'
            let syncState;
            if (isHosted) {
              // Hosted playlists always express state as push: the XSPF is
              // canonical, so remote changes (even concurrent with local)
              // will be overwritten by the next push from the XSPF.
              syncState = 'push';
            } else if (hasLocalChanges && hasRemoteUpdates) {
              syncState = 'conflict';
            } else if (hasLocalChanges) {
              syncState = 'push';
            } else {
              syncState = 'pull';
            }

            // Colors based on state
            const colors = {
              push: { bg: 'rgba(34, 197, 94, 0.12)', border: 'rgba(34, 197, 94, 0.25)', text: 'text-green-600', iconBg: 'rgba(34, 197, 94, 0.2)' },
              pull: { bg: 'rgba(147, 51, 234, 0.12)', border: 'rgba(147, 51, 234, 0.25)', text: 'text-purple-600', iconBg: 'rgba(147, 51, 234, 0.2)' },
              conflict: { bg: 'rgba(234, 179, 8, 0.12)', border: 'rgba(234, 179, 8, 0.25)', text: 'text-yellow-600', iconBg: 'rgba(234, 179, 8, 0.2)' }
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
                      snapshotId: result.snapshotId
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
                  window.alert(`Failed to push changes: ${result?.error || 'Unknown error'}`);
                }
              } catch (err) {
                console.error('Failed to push playlist:', err);
                window.alert(`Failed to push changes: ${err.message}`);
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
                      snapshotId: result.snapshotId
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
                  showToast(`Pulled ${result.tracks.length} tracks from ${providerName}`);
                } else {
                  console.error('Failed to pull playlist:', result?.error);
                  if (result?.errorCode === 'missing_scopes') {
                    showToast('Missing permissions. Please disconnect and reconnect Spotify in Settings.', 'error');
                  } else {
                    showToast(`Failed to pull changes: ${result?.error || 'Unknown error'}`, 'error');
                  }
                }
              } catch (err) {
                console.error('Failed to pull playlist updates:', err);
                showToast(`Failed to pull changes: ${err.message}`, 'error');
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
                        : syncState === 'pull'
                        ? React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                        : React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z' })
                    )
                  ),
                  React.createElement('div', { className: 'flex flex-col' },
                    React.createElement('span', {
                      className: `text-xs font-medium tracking-widest uppercase ${c.text}`
                    }, syncState === 'push' ? 'Local Changes' : syncState === 'pull' ? 'Remote Changes' : 'Sync Conflict'),
                    React.createElement('span', {
                      className: 'text-sm text-gray-600'
                    }, syncState === 'push'
                      ? `Push your changes to ${providerName}`
                      : syncState === 'pull'
                      ? `Updated on ${providerName}`
                      : localIsNewer
                      ? `Your local changes are newer`
                      : `${providerName} version is newer`)
                  )
                ),
                // Right side: action buttons
                React.createElement('div', { className: 'flex items-center gap-2' },
                  React.createElement('button', {
                    onClick: handleDismiss,
                    className: 'px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors'
                  }, 'Dismiss'),

                  // For conflict state, show both options
                  syncState === 'conflict' && React.createElement('button', {
                    onClick: handlePull,
                    className: 'flex items-center gap-1.5 px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-medium rounded-full hover:bg-gray-300 transition-colors'
                  },
                    React.createElement('svg', { className: 'w-3.5 h-3.5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                    ),
                    `Use ${providerName}`
                  ),

                  // Primary action button
                  React.createElement('button', {
                    onClick: syncState === 'push' || (syncState === 'conflict' && localIsNewer) ? handlePush : handlePull,
                    className: `flex items-center gap-1.5 px-4 py-1.5 text-white text-xs font-medium rounded-full transition-colors ${
                      syncState === 'push' ? 'bg-green-600 hover:bg-green-700' :
                      syncState === 'pull' ? 'bg-purple-600 hover:bg-purple-700' :
                      localIsNewer ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'
                    }`,
                    style: { boxShadow: `0 2px 8px ${syncState === 'push' || (syncState === 'conflict' && localIsNewer) ? 'rgba(34, 197, 94, 0.3)' : 'rgba(147, 51, 234, 0.3)'}` }
                  },
                    React.createElement('svg', { className: 'w-3.5 h-3.5', fill: 'none', stroke: 'currentColor', viewBox: '0 0 24 24' },
                      syncState === 'push' || (syncState === 'conflict' && localIsNewer)
                        ? React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12' })
                        : React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', strokeWidth: 2, d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                    ),
                    syncState === 'push' ? `Push to ${providerName}` :
                    syncState === 'pull' ? 'Pull Changes' :
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
              style: { width: '240px', overflowY: 'auto', overflowX: 'hidden' }
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
                    width: '212px'
                  },
                  onContextMenu: (e) => {
                    e.preventDefault();
                    if (window.electron?.contextMenu?.showTrackMenu) {
                      window.electron.contextMenu.showTrackMenu({
                        type: 'playlist',
                        playlistId: selectedPlaylist.id,
                        name: selectedPlaylist.title,
                        creator: selectedPlaylist.creator || null,
                        tracks: playlistTracks || []
                      });
                    }
                  }
                },
                  // Album art mosaic with hover overlay
                  React.createElement('div', {
                    className: 'rounded-lg overflow-hidden album-art-container group/art relative',
                    style: {
                      width: '192px',
                      height: '192px'
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
                            !covers[idx] && React.createElement(Music, { size: 20, className: 'text-gray-600' }),
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
                        React.createElement('svg', { className: 'w-12 h-12 text-gray-500', viewBox: '0 0 24 24', fill: 'currentColor' },
                          React.createElement('rect', { x: 3, y: 5, width: 18, height: 2, rx: 1 }),
                          React.createElement('rect', { x: 3, y: 11, width: 10, height: 2, rx: 1 }),
                          React.createElement('rect', { x: 3, y: 17, width: 7, height: 2, rx: 1 }),
                          React.createElement('path', { d: 'M15 13.5v6l5.5-3-5.5-3z' })
                        )
                      ),
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
                        title: 'Add to Playlist'
                      },
                        React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M12 4v16m8-8H4' })
                        )
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
                            const context = { type: 'playlist', id: selectedPlaylist.id, name: selectedPlaylist.title };
                            const [firstTrack, ...remainingTracks] = tracksWithIds;
                            const taggedFirstTrack = { ...firstTrack, _playbackContext: context };
                            setQueueWithContext(remainingTracks, context, true);
                            handlePlay(taggedFirstTrack);
                          } else {
                            setTrackLoading(false);
                          }
                        },
                        className: 'w-12 h-12 bg-white rounded-full flex items-center justify-center shadow-lg transition-all hover:scale-110',
                        style: { border: 'none', cursor: 'pointer' },
                        title: 'Play'
                      },
                        React.createElement(Play, { size: 22, className: 'text-gray-800 ml-0.5' })
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
                            const context = { type: 'playlist', id: selectedPlaylist.id, name: selectedPlaylist.title };
                            addToQueue(tracksWithIds, context);
                          }
                        },
                        className: 'w-10 h-10 rounded-full flex items-center justify-center transition-all hover:scale-110',
                        style: { backgroundColor: 'rgba(255, 255, 255, 0.15)', color: '#ffffff', border: 'none', cursor: 'pointer' },
                        onMouseEnter: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.25)',
                        onMouseLeave: (e) => e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.15)',
                        title: 'Add to Queue'
                      },
                        React.createElement('svg', { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                          React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 6h16M4 12h16M4 18h7' })
                        )
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
                    }, `${playlistTracks.length} Songs`)
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
                      onFocus: (e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 58, 237, 0.15)'; },
                      onBlur: (e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.boxShadow = 'none'; },
                      placeholder: 'Creator name'
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
                        title: sourceUrl
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
                        pid === 'spotify' ? 'bg-green-100 text-green-700' : 'bg-pink-100 text-pink-700'
                      }`,
                      title: `Synced to ${pid === 'spotify' ? 'Spotify' : 'Apple Music'}`
                    }, pid === 'spotify' ? 'Spotify' : 'Apple Music')
                  ),
                  // Local only toggle
                  React.createElement('button', {
                    className: `text-xs px-2 py-0.5 rounded-full transition-colors ${
                      selectedPlaylist.localOnly
                        ? 'bg-gray-200 text-gray-600'
                        : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
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
                  onFocus: (e) => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(124, 58, 237, 0.15)'; },
                  onBlur: (e) => { e.currentTarget.style.borderColor = 'var(--border-default)'; e.currentTarget.style.boxShadow = 'none'; },
                  placeholder: 'Playlist name'
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
                      if (window.confirm(`Are you sure you want to delete "${selectedPlaylist.title}"? This cannot be undone.`)) {
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
                  style: { color: '#ef4444', border: '1px solid rgba(239, 68, 68, 0.3)' },
                  onMouseEnter: (e) => { e.currentTarget.style.backgroundColor = 'rgba(239, 68, 68, 0.1)'; e.currentTarget.style.color = '#f87171'; },
                  onMouseLeave: (e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = '#ef4444'; }
                }, 'Delete Playlist')
              ),
              // Share button (outside space-y-1 metadata div for independent spacing)
              React.createElement('div', { className: 'relative mt-5 flex justify-start', style: { width: '212px' } },
                React.createElement('button', {
                  onClick: (e) => { e.stopPropagation(); setShareDropdownOpen(shareDropdownOpen === 'playlist' ? false : 'playlist'); },
                  className: 'px-2 py-1 bg-pink-600 hover:bg-pink-700 text-white rounded-md text-xs font-medium transition-colors flex items-center gap-1 no-drag'
                },
                  React.createElement('svg', { className: 'w-3 h-3', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                    React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z' })
                  ),
                  'Share'
                ),
                shareDropdownOpen === 'playlist' && React.createElement('div', {
                  className: 'absolute left-0 top-full mt-1 rounded-lg py-1 min-w-[160px] z-30',
                  style: { backgroundColor: 'var(--tooltip-bg)', boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)' },
                  onClick: (e) => e.stopPropagation()
                },
                  React.createElement('button', {
                    onClick: () => {
                      setShareDropdownOpen(false);
                      const collectionData = {
                        playlistId: selectedPlaylist.id,
                        title: selectedPlaylist.title,
                        artist: null,
                        creator: selectedPlaylist.creator || null,
                        albumArt: playlistCoverArt?.[0] || null,
                        type: 'playlist',
                        tracks: (playlistTracks || []).map((t, i) => ({
                          title: t.title || 'Unknown',
                          artist: t.artist || null,
                          duration: t.duration || null,
                          trackNumber: t.trackNumber || (i + 1)
                        }))
                      };
                      publishCollectionSmartLink(collectionData);
                    },
                    className: 'w-full px-3 py-2 text-left text-white hover:bg-white/10 flex items-center gap-2 no-drag',
                    style: { fontSize: '12px', fontWeight: 500 }
                  },
                    React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' })
                    ),
                    'Copy Link'
                  ),
                  React.createElement('button', {
                    onClick: () => {
                      setShareDropdownOpen(false);
                      // Prefer the loaded tracklist (it may be richer than the
                      // stored one); fall back to the stored tracks.
                      handleExportPlaylist({
                        ...selectedPlaylist,
                        tracks: (playlistTracks && playlistTracks.length) ? playlistTracks : (selectedPlaylist.tracks || [])
                      });
                    },
                    className: 'w-full px-3 py-2 text-left text-white hover:bg-white/10 flex items-center gap-2 no-drag',
                    style: { fontSize: '12px', fontWeight: 500 }
                  },
                    React.createElement('svg', { className: 'w-4 h-4', fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2 },
                      React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4' })
                    ),
                    'Export as XSPF…'
                  )
                )
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
                return displayTracks.length > 0 ?
                React.createElement(VirtualizedTrackList, {
                  tracks: displayTracks,
                  parentRef: playlistTracksScrollRef,
                  renderRow: (track, index) => {
                    // Use track.id to look up resolved sources from trackSources state
                    const resolvedSources = trackSources[track.id] || track.sources || {};
                    const hasResolved = Object.keys(resolvedSources).length > 0;
                    const isResolving = Object.keys(resolvedSources).length === 0;
                    const isDraggedOver = playlistEditMode && playlistDropTarget === index;
                    const isDragging = playlistEditMode && draggedPlaylistTrack === index;
                    const isCurrentTrack = currentTrack?.id === track.id;
                    const isNowPlaying = isCurrentTrack && playbackContext?.type === 'playlist' && playbackContext?.id === selectedPlaylist?.id;

                    return React.createElement('div', {
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
                      } ${isResolving ? 'opacity-60' : ''} ${isDragging ? 'opacity-50 bg-gray-100' : ''} ${isDraggedOver ? 'border-t-2 border-t-purple-500' : ''} ${isNowPlaying && isPlaying ? 'bg-purple-50' : 'hover:bg-gray-50/80'}`,
                      style: {
                        borderRadius: '8px',
                        marginBottom: '2px'
                      },
                      onClick: () => {
                        if (draggedPlaylistTrack !== null) return; // Don't play if dragging
                        const tracksAfter = playlistTracks.slice(index + 1);
                        const context = { type: 'playlist', id: selectedPlaylist?.id, name: selectedPlaylist?.title };
                        setQueueWithContext(tracksAfter, context);
                        handlePlay(track);
                      },
                      onContextMenu: (e) => {
                        e.preventDefault();
                        if (window.electron?.contextMenu?.showTrackMenu) {
                          window.electron.contextMenu.showTrackMenu({
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
                      // Track number or drag handle in edit mode
                      playlistEditMode
                        ? React.createElement('span', {
                            className: 'text-gray-400 flex-shrink-0 flex items-center justify-center',
                            style: { pointerEvents: 'none', width: '32px' },
                            title: 'Drag to reorder'
                          },
                          // Drag handle icon (hamburger/grip lines)
                          React.createElement('svg', {
                            className: 'w-4 h-4',
                            fill: 'none',
                            stroke: 'currentColor',
                            viewBox: '0 0 24 24'
                          },
                            React.createElement('path', {
                              strokeLinecap: 'round',
                              strokeLinejoin: 'round',
                              strokeWidth: 2,
                              d: 'M4 8h16M4 16h16'
                            })
                          )
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
                      React.createElement('span', {
                        className: 'truncate hover:text-purple-600 hover:underline cursor-pointer transition-colors',
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
                      }, formatTime(track.duration)),

                      // Resolver icons - fixed width column (last column)
                      React.createElement('div', {
                        className: 'flex items-center gap-1 justify-end',
                        style: { width: '140px', flexShrink: 0, minHeight: '24px' }
                      },
                        isResolving ?
                          React.createElement('div', {
                            className: 'flex items-center gap-1'
                          },
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              title: 'Resolving track...'
                            }),
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          )
                        : hasResolved ? (() => {
                            const bestConf = getBestSourceConfidence(resolvedSources);
                            return Object.entries(resolvedSources)
                              .filter(([resolverId]) => activeResolvers.includes(resolverId))
                              .sort(([aId], [bId]) => {
                                const aIndex = resolverOrder.indexOf(aId);
                                const bIndex = resolverOrder.indexOf(bId);
                                return aIndex - bIndex;
                              })
                              .map(([resolverId, source]) => {
                                const resolver = allResolvers.find(r => r.id === resolverId);
                                if (!resolver || !resolver.play) return null;
                                return React.createElement('button', {
                                  key: resolverId,
                                  className: 'no-drag',
                                  onClick: (e) => {
                                    e.stopPropagation();
                                    const tracksAfter = playlistTracks.slice(index + 1);
                                    const context = { type: 'playlist', id: selectedPlaylist?.id, name: selectedPlaylist?.title };
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
                                    opacity: (source.confidence || 0) < bestConf ? 0.6 : 1,
                                    transition: 'transform 0.1s'
                                  },
                                  onMouseEnter: (e) => e.currentTarget.style.transform = 'scale(1.1)',
                                  onMouseLeave: (e) => e.currentTarget.style.transform = 'scale(1)',
                                  title: `Play from ${resolver.name}${source.confidence ? ` (${Math.round(source.confidence * 100)}% match)` : ''}`
                                }, React.createElement(ResolverIcon, { resolverId, size: 12 }));
                              });
                          })()
                        :
                          // Show shimmer skeletons while resolving (match resolver icon size)
                          React.createElement('div', {
                            className: 'flex items-center gap-1'
                          },
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              title: 'Resolving track...'
                            }),
                            React.createElement('div', {
                              className: 'w-5 h-5 rounded shimmer-light animate-shimmer',
                              style: { animationDelay: '0.1s' }
                            })
                          )
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
                      React.createElement('div', { className: 'flex items-center gap-1', style: { width: '140px', flexShrink: 0 } },
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

module.exports = { PlaylistViewPage, PLAYLIST_VIEW_PAGE_HANDLERS };
