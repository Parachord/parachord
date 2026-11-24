// src/renderer/components/add-to-playlist-panel.js: the Add to playlist
// panel that slides out beside the sidebar: the tracks being added, a new
// playlist form, and the playlists to pick (sort, filter, drop a dragged
// track on one) (#1451, moved out of app.js).
//
// A React.memo'd panel on the shared SidePanel, fed stable props: state,
// setters and a callback by value, plain functions through
// useStableHandlers (ADD_TO_PLAYLIST_PANEL_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The markup moved as it was; window is
// read only inside handlers.

const Icons = require('./icons');
const { trackSlug } = require('../lib/track-slug');
const { countOf } = require('../lib/plural');
const { PlaylistCoverImage } = require('./playlist-cover');
const { FilterBox } = require('./filter-box');
const { PAGE_COLORS } = require('../lib/page-colors');
const { SidePanel } = require('./modal');
const { Button } = require('./button');
const { ListRow } = require('./list-row');
const { SortMenu } = require('./sort-menu');
const { TextField } = require('./fields');
const { CardButton } = require('./card-button');
const { playlistsSortOptions, sortPlaylists } = require('../lib/playlists-sort');

const { Music } = Icons;

const ADD_TO_PLAYLIST_PANEL_HANDLERS = [
  'closeAddToPlaylistPanel',
  'fetchPlaylistCovers',
  'markPlaylistAsLocallyModified',
  'savePlaylistToStore',
];

const AddToPlaylistPanel = React.memo(function AddToPlaylistPanel(props) {
  const {
    addToPlaylistPanel,
    addToPlaylistSearch,
    addToPlaylistSearchOpen,
    addToPlaylistSort,
    allPlaylistCovers,
    closeAddToPlaylistPanel,
    draggingTrackForPlaylist,
    dropTargetNewPlaylist,
    dropTargetPlaylistId,
    droppedTrackForNewPlaylist,
    fetchPlaylistCovers,
    markPlaylistAsLocallyModified,
    newPlaylistFormOpen,
    newPlaylistName,
    playlists,
    savePlaylistToStore,
    selectedPlaylistsForAdd,
    setAddToPlaylistPanel,
    setAddToPlaylistSearch,
    setAddToPlaylistSearchOpen,
    setAddToPlaylistSort,
    setDraggingTrackForPlaylist,
    setDropTargetNewPlaylist,
    setDropTargetPlaylistId,
    setDroppedTrackForNewPlaylist,
    setNewPlaylistFormOpen,
    setNewPlaylistName,
    setPlaylists,
    setSelectedPlaylistsForAdd,
    showSidebarBadge,
  } = props;
  return React.createElement(SidePanel, {
      onClose: closeAddToPlaylistPanel,
      label: 'Add to playlist',
      // The scrim leaves the sidebar uncovered (drag a track onto it).
      scrimStyle: { left: '256px' },
      scrimProps: {
        onDragOver: (e) => { e.preventDefault(); },
        onDrop: (e) => { e.preventDefault(); }
      },
      // Positioned at the right edge of the sidebar, full height above the playbar.
      panelStyle: {
        left: '256px',
        top: '0',
        bottom: '85px',
        width: '384px',
        backgroundColor: 'var(--card-bg)',
        borderRadius: '0 16px 16px 0',
        boxShadow: 'var(--shadow-dialog)',
        overflow: 'hidden'
      },
      panelProps: {
        // Allow drag events to pass through to children
        onDragOver: (e) => { e.preventDefault(); },
        onDrop: (e) => { e.preventDefault(); }
      }
    },
        // Header with title - matches Playlists view header gradient
        React.createElement('div', {
          style: {
            padding: '20px 24px',
            borderBottom: '1px solid var(--border-subtle)'
          },
          // The Playlists page's gradient (lib/page-colors.js).
          className: PAGE_COLORS.playlists.hero
        },
          React.createElement('div', {
            className: 'flex items-center gap-3'
          },
            React.createElement('div', {
              style: {
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'var(--on-color-fill)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            },
              React.createElement(Icons.ListPlus, { size: 18, style: { color: 'var(--on-dark-primary)' } })
            ),
            React.createElement('span', {
              style: {
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--on-dark-primary)'
              }
            }, 'Add to playlist')
          )
        ),

        // Track info section with DONE button - refined
        React.createElement('div', {
          style: {
            padding: '16px 20px',
            backgroundColor: 'var(--hover-bg-default)',
            borderBottom: '1px solid var(--border-subtle)'
          }
        },
          React.createElement('div', {
            className: 'flex items-center gap-3'
          },
            // Album art thumbnail - refined with dark placeholder
            React.createElement('div', {
              className: 'flex-shrink-0 flex items-center justify-center overflow-hidden relative',
              style: {
                width: '48px',
                height: '48px',
                borderRadius: '8px',
                background: 'var(--placeholder-bg)'
              }
            },
              // Placeholder always rendered behind
              React.createElement(Music, { size: 20, style: { color: 'var(--text-tertiary)' } }),
              addToPlaylistPanel.tracks[0]?.albumArt && React.createElement('img', {
                src: addToPlaylistPanel.tracks[0].albumArt,
                alt: '',
                className: 'absolute inset-0 w-full h-full object-cover',
                style: { borderRadius: '8px' },
                // A dead cover is reported to the art pipeline, not only hidden.
                onError: (e) => {
                  e.target.style.display = 'none';
                  const t = addToPlaylistPanel.tracks[0];
                  if (window.reportBrokenAlbumArt) window.reportBrokenAlbumArt(t.albumArt, { artist: t.artist, album: t.album }).catch(() => {});
                }
              })
            ),
            // Track/source info
            React.createElement('div', {
              className: 'flex-1 min-w-0'
            },
              React.createElement('p', {
                className: 'truncate',
                style: {
                  fontSize: '13px',
                  fontWeight: '500',
                  color: 'var(--text-primary)'
                }
              }, addToPlaylistPanel.sourceName),
              React.createElement('p', {
                style: {
                  fontSize: '12px',
                  color: 'var(--text-secondary)',
                  marginTop: '2px'
                }
              }, addToPlaylistPanel.tracks[0]?.artist || `${countOf(addToPlaylistPanel.tracks.length, 'track')}`)
            ),
            // DONE button - executes additions for all selected playlists
            React.createElement(Button, { variant: selectedPlaylistsForAdd.length > 0 ? 'primary' : 'secondary', onClick: () => {
                // Add tracks to all selected playlists
                if (selectedPlaylistsForAdd.length > 0) {
                  const tracksToAdd = addToPlaylistPanel.tracks.map(t => ({
                    title: t.title,
                    artist: t.artist,
                    album: t.album,
                    duration: t.duration,
                    id: t.id || trackSlug(t.artist, t.title)
                  }));

                  setPlaylists(prev => prev.map(p => {
                    if (selectedPlaylistsForAdd.includes(p.id)) {
                      const updatedPlaylist = {
                        ...p,
                        tracks: [...(p.tracks || []), ...tracksToAdd],
                        lastModified: Date.now()
                      };
                      // Save each updated playlist to disk
                      savePlaylistToStore(updatedPlaylist);
                      return updatedPlaylist;
                    }
                    return p;
                  }));

                  // Mark synced playlists as locally modified
                  selectedPlaylistsForAdd.forEach(id => markPlaylistAsLocallyModified(id));

                  // Show sidebar badge with total tracks added
                  showSidebarBadge('playlists', tracksToAdd.length * selectedPlaylistsForAdd.length);
                }

                // Close panel and reset state
                setAddToPlaylistPanel(prev => ({ ...prev, open: false }));
                setSelectedPlaylistsForAdd([]);
                setNewPlaylistFormOpen(false);
                setNewPlaylistName('');
                setAddToPlaylistSearch('');
                setAddToPlaylistSearchOpen(false);
              } }, selectedPlaylistsForAdd.length > 0
              ? `Add to ${selectedPlaylistsForAdd.length} Playlist${selectedPlaylistsForAdd.length > 1 ? 's' : ''}`
              : 'Done')
          )
        ),

        // Filter bar (sticky) - sort dropdown and search
        React.createElement('div', {
          className: 'flex items-center px-5 py-2 bg-surface-card',
          style: { flexShrink: 0, borderBottom: '1px solid var(--border-subtle)' }
        },
          // Sort dropdown
          React.createElement(SortMenu, { value: addToPlaylistSort, options: playlistsSortOptions, onChange: setAddToPlaylistSort, label: "Sort playlists" }),
          React.createElement('div', { className: 'flex-1' }),
          // Search
          React.createElement(FilterBox, { value: addToPlaylistSearch, onChange: setAddToPlaylistSearch, open: addToPlaylistSearchOpen, onOpenChange: setAddToPlaylistSearchOpen, size: 'sm' })
        ),

        // Playlist list (scrollable) - includes New Playlist row at top
        React.createElement('div', {
          className: 'flex-1 overflow-y-auto min-h-0'
        },
          // New Playlist row (always shown at top)
          // Note: onDrop doesn't fire in Electron for dynamically-shown elements.
          // The drop is handled via handlePlaylistDragEnd() in each track's onDragEnd handler,
          // which checks dropTargetNewPlaylist state and opens the form with the dragged track.
          React.createElement(CardButton, { label: 'New playlist',
            key: 'new-playlist-row',
            onActivate: () => {
              if (!newPlaylistFormOpen) {
                setNewPlaylistFormOpen(true);
                setNewPlaylistName('');
                setDroppedTrackForNewPlaylist(null);
              }
            },
            onMouseUp: () => {
              // Fallback for drop - if we're hovering while a track is being dragged
              if (dropTargetNewPlaylist && draggingTrackForPlaylist) {
                console.log('🖱️ MouseUp on New Playlist row while dragging:', draggingTrackForPlaylist.title);
                setDroppedTrackForNewPlaylist(draggingTrackForPlaylist);
                setNewPlaylistFormOpen(true);
                setNewPlaylistName('');
                setDropTargetNewPlaylist(false);
              }
            },
            onDragEnter: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (draggingTrackForPlaylist) {
                setDropTargetNewPlaylist(true);
              }
            },
            onDragOver: (e) => {
              e.preventDefault();
              e.stopPropagation();
              e.dataTransfer.dropEffect = 'copy';
            },
            onDragLeave: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!e.currentTarget.contains(e.relatedTarget)) {
                setDropTargetNewPlaylist(false);
              }
            },
            onDrop: (e) => {
              e.preventDefault();
              e.stopPropagation();
              console.log('🎯 Drop on New Playlist row');

              // Try to get track from state or dataTransfer
              let trackToUse = draggingTrackForPlaylist;
              if (!trackToUse) {
                try {
                  const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                  if (data.type === 'track' && data.track) {
                    trackToUse = data.track;
                  }
                } catch (err) {
                  // ignore
                }
              }

              if (trackToUse) {
                setDroppedTrackForNewPlaylist(trackToUse);
                setNewPlaylistFormOpen(true);
                setNewPlaylistName('');
                setDropTargetNewPlaylist(false);
              }
            },
            className: `flex items-center gap-3 px-5 py-2.5 cursor-pointer transition-colors border-b border-line-light ${
              dropTargetNewPlaylist
                ? 'bg-accent-tint border-l-4 border-l-accent pl-4'
                : newPlaylistFormOpen
                  ? 'bg-surface-inset'
                  : 'hover:bg-surface-hover'
            }`
          },
            // Plus icon in square (like playlist thumbnail)
            React.createElement('div', {
              className: 'w-10 h-10 rounded bg-surface-placeholder flex-shrink-0 flex items-center justify-center',
              style: { pointerEvents: 'none' } // Let parent handle all events
            },
              React.createElement('span', { className: 'text-ink-tertiary text-xl font-light' }, '+')
            ),
            // "New Playlist" text or input form
            newPlaylistFormOpen ?
              React.createElement('div', {
                // Not a control: it only keeps the form's clicks from the row.
                role: 'presentation',
                className: 'flex-1 flex gap-2',
                onClick: (e) => e.stopPropagation(), // Prevent row click when interacting with form
                style: { pointerEvents: 'auto' } // Allow form interaction
              },
                React.createElement(TextField, { value: newPlaylistName, onChange: (_v, e) => setNewPlaylistName(e.target.value), onKeyDown: (e) => {
                    // Prevent global shortcuts from interfering while typing
                    e.stopPropagation();
                    if (e.key === 'Enter' && newPlaylistName.trim()) {
                      // Create new playlist with the tracks
                      const playlistId = newPlaylistName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
                      // Use dropped track if available, otherwise use panel tracks
                      const sourceTracks = droppedTrackForNewPlaylist ? [droppedTrackForNewPlaylist] : addToPlaylistPanel.tracks;
                      const tracksToAdd = sourceTracks.map(t => ({
                        title: t.title,
                        artist: t.artist,
                        album: t.album,
                        duration: t.duration,
                        id: t.id || trackSlug(t.artist, t.title)
                      }));
                      const newPlaylist = {
                        id: playlistId,
                        filename: `${playlistId}.xspf`,
                        title: newPlaylistName.trim(),
                        creator: 'Me',
                        tracks: tracksToAdd,
                        createdAt: Date.now(),
                        addedAt: Date.now(),
                        lastModified: Date.now()
                      };
                      setPlaylists(prev => [newPlaylist, ...prev]);
                      fetchPlaylistCovers(playlistId, newPlaylist.tracks);
                      setSelectedPlaylistsForAdd(prev => [...prev, playlistId]);
                      savePlaylistToStore(newPlaylist); // Save to disk
                      showSidebarBadge('playlists', tracksToAdd.length);
                      setNewPlaylistFormOpen(false);
                      setNewPlaylistName('');
                      setDroppedTrackForNewPlaylist(null); // Clear dropped track
                    } else if (e.key === 'Escape') {
                      // Closes the form only, not the panel around it.
                      e.preventDefault();
                      setNewPlaylistFormOpen(false);
                      setNewPlaylistName('');
                      setDroppedTrackForNewPlaylist(null); // Clear dropped track
                    }
                  }, placeholder: 'Playlist name…', autoFocus: true, 'aria-label': 'Playlist name', className: 'flex-1' }),
                React.createElement(Button, {
                  onClick: () => {
                    if (!newPlaylistName.trim()) return;
                    // Create new playlist with the tracks
                    const playlistId = newPlaylistName.trim().toLowerCase().replace(/[^a-z0-9]/g, '-') + '-' + Date.now();
                    // Use dropped track if available, otherwise use panel tracks
                    const sourceTracks = droppedTrackForNewPlaylist ? [droppedTrackForNewPlaylist] : addToPlaylistPanel.tracks;
                    const tracksToAdd = sourceTracks.map(t => ({
                      title: t.title,
                      artist: t.artist,
                      album: t.album,
                      duration: t.duration,
                      id: t.id || trackSlug(t.artist, t.title)
                    }));
                    const newPlaylist = {
                      id: playlistId,
                      filename: `${playlistId}.xspf`,
                      title: newPlaylistName.trim(),
                      creator: 'Me',
                      tracks: tracksToAdd,
                      createdAt: Date.now(),
                      addedAt: Date.now(),
                      lastModified: Date.now()
                    };
                    setPlaylists(prev => [newPlaylist, ...prev]);
                    fetchPlaylistCovers(playlistId, newPlaylist.tracks);
                    setSelectedPlaylistsForAdd(prev => [...prev, playlistId]);
                    savePlaylistToStore(newPlaylist); // Save to disk
                    showSidebarBadge('playlists', tracksToAdd.length);
                    setNewPlaylistFormOpen(false);
                    setNewPlaylistName('');
                    setDroppedTrackForNewPlaylist(null); // Clear dropped track
                  },
                  disabled: !newPlaylistName.trim(),
                  variant: 'primary', size: 'sm'
                }, 'Create')
              )
            :
              React.createElement('span', {
                className: 'flex-1 text-sm text-ink-secondary',
                style: { pointerEvents: 'none' } // Let parent handle all events
              }, 'New Playlist')
          ),

          // Existing playlists (filtered and sorted)
          (() => {
            // Filter playlists by search
            let filteredPlaylists = playlists;
            if (addToPlaylistSearch.trim()) {
              const query = addToPlaylistSearch.toLowerCase();
              filteredPlaylists = playlists.filter(p => p.title.toLowerCase().includes(query));
            }
            // Sort playlists (lib/playlists-sort.js, shared with the Playlists page)
            const sortedPlaylists = sortPlaylists(filteredPlaylists, addToPlaylistSort);

            if (sortedPlaylists.length === 0) {
              return React.createElement('div', {
                className: 'px-5 py-8 text-center text-ink-tertiary text-sm'
              }, addToPlaylistSearch ? 'No matching playlists' : 'No playlists yet');
            }

            return sortedPlaylists.map(playlist => {
              const isAdded = selectedPlaylistsForAdd.includes(playlist.id);
              const isDropTarget = dropTargetPlaylistId === playlist.id;

              // Helper to add tracks to this playlist
              const addTracksToPlaylistHelper = (tracks) => {
                if (isAdded || !tracks || tracks.length === 0) return;

                // Add tracks to this playlist immediately
                const tracksToAdd = tracks.map(t => ({
                  title: t.title,
                  artist: t.artist,
                  album: t.album,
                  duration: t.duration,
                  id: t.id || trackSlug(t.artist, t.title)
                }));

                // Build updated playlist for saving
                const updatedPlaylist = {
                  ...playlist,
                  tracks: [...(playlist.tracks || []), ...tracksToAdd],
                  lastModified: Date.now()
                };

                setPlaylists(prev => prev.map(p => {
                  if (p.id === playlist.id) {
                    return updatedPlaylist;
                  }
                  return p;
                }));

                // Save to disk
                savePlaylistToStore(updatedPlaylist);

                // Mark synced playlist as locally modified
                markPlaylistAsLocallyModified(playlist.id);

                // Mark as added
                setSelectedPlaylistsForAdd(prev => [...prev, playlist.id]);

                // Show sidebar badge
                showSidebarBadge('playlists', tracks.length);
              };

              return React.createElement(ListRow, { 'aria-pressed': selectedPlaylistsForAdd.includes(playlist.id),
                divider: true,
                state: isAdded ? 'added' : isDropTarget ? 'drop' : undefined,
                key: playlist.id,
                onClick: () => {
                  // Toggle selection instead of immediately adding
                  setSelectedPlaylistsForAdd(prev =>
                    prev.includes(playlist.id)
                      ? prev.filter(id => id !== playlist.id)
                      : [...prev, playlist.id]
                  );
                },
                onDragEnter: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (!isAdded) {
                    setDropTargetPlaylistId(playlist.id);
                  }
                },
                onDragOver: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  e.dataTransfer.dropEffect = 'copy';
                  if (!isAdded && dropTargetPlaylistId !== playlist.id) {
                    setDropTargetPlaylistId(playlist.id);
                  }
                },
                onDragLeave: (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  // Only clear if we're actually leaving this element
                  if (!e.currentTarget.contains(e.relatedTarget)) {
                    setDropTargetPlaylistId(null);
                  }
                },
                onDrop: (e) => {
                  e.preventDefault();
                  e.stopPropagation();

                  // Try to get track from state first, then dataTransfer as fallback
                  let trackFromDrag = draggingTrackForPlaylist;
                  if (!trackFromDrag) {
                    try {
                      const data = JSON.parse(e.dataTransfer.getData('text/plain'));
                      if (data.type === 'track' && data.track) {
                        trackFromDrag = data.track;
                      }
                    } catch (err) {
                      // ignore parse errors
                    }
                  }

                  const tracksToUse = trackFromDrag
                    ? [trackFromDrag]
                    : addToPlaylistPanel.tracks;
                  addTracksToPlaylistHelper(tracksToUse);
                  // Clear the dragging state
                  setDraggingTrackForPlaylist(null);
                  setDropTargetPlaylistId(null);
                },
              },
                // Playlist thumbnail (gray square)
                React.createElement('div', {
                  className: 'relative w-10 h-10 rounded bg-surface-placeholder flex-shrink-0 flex items-center justify-center overflow-hidden'
                },
                  allPlaylistCovers[playlist.id]?.[0] ?
                    React.createElement('img', {
                      src: allPlaylistCovers[playlist.id][0],
                      className: 'w-full h-full object-cover'
                    })
                  :
                    React.createElement(Music, { size: 16, className: 'text-ink-tertiary' }),
                  // The playlist's own cover, over the first mosaic tile
                  playlist.coverArt && React.createElement(PlaylistCoverImage, { url: playlist.coverArt })
                ),
                // Playlist name
                React.createElement('span', {
                  className: 'flex-1 text-sm text-ink-primary truncate'
                }, playlist.title),
                // Song count - shows updated count from playlists state
                React.createElement('span', {
                  className: `text-sm flex-shrink-0 ${isAdded ? 'text-ink-success font-medium' : 'text-ink-tertiary'}`
                }, `${countOf(playlist.tracks?.length || 0, 'track')}`),
                // Checkmark if added
                isAdded && React.createElement(Icons.Check, { className: 'w-5 h-5 text-ink-success flex-shrink-0' })
              );
            });
          })()
        )
    );
});

module.exports = { AddToPlaylistPanel, ADD_TO_PLAYLIST_PANEL_HANDLERS };
