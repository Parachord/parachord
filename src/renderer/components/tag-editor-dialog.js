// src/renderer/components/tag-editor-dialog.js: the local file tag
// editor (Edit info on a local track): title, artist, album and the rest,
// and its cover from suggestions, saved to the file (#1451, moved out of
// app.js).
//
// A React.memo'd dialog on the shared Modal, fed only state, setters and
// showToast (all stable), so it re-renders only when the editor's own
// state changes. It was an IIFE; its body is the component's, moved as it
// was; window is read only inside handlers.

const Icons = require('./icons');
const { Modal } = require('./modal');
const { Button } = require('./button');
const { TextField } = require('./fields');

const TAG_EDITOR_DIALOG_HANDLERS = [
];

const TagEditorDialog = React.memo(function TagEditorDialog(props) {
  const {
    id3ArtLoading,
    id3ArtSuggestions,
    id3EditorSaving,
    id3EditorTrack,
    id3EditorValues,
    id3SelectedArt,
    setId3ArtSuggestions,
    setId3EditorOpen,
    setId3EditorSaving,
    setId3EditorTrack,
    setId3EditorValues,
    setId3SelectedArt,
    setLibrary,
    showToast,
  } = props;

      const close = () => { if (!id3EditorSaving) { setId3EditorOpen(false); setId3EditorTrack(null); } };
      const save = async () => {
              if (!id3EditorTrack?.filePath) return;

              setId3EditorSaving(true);
              try {
                const tagsToSave = {
                  title: id3EditorValues.title,
                  artist: id3EditorValues.artist,
                  album: id3EditorValues.album,
                  trackNumber: id3EditorValues.trackNumber ? parseInt(id3EditorValues.trackNumber, 10) : null,
                  year: id3EditorValues.year ? parseInt(id3EditorValues.year, 10) : null
                };

                // If album art was selected, include it
                if (id3SelectedArt?.fullUrl) {
                  tagsToSave.albumArtUrl = id3SelectedArt.fullUrl;
                }

                const result = await window.electron.localFiles.saveId3Tags(
                  id3EditorTrack.filePath,
                  tagsToSave
                );

                if (result.success) {
                  console.log('🏷️ ID3 tags saved successfully');
                  // Update track in library
                  setLibrary(prev => prev.map(t =>
                    t.filePath === id3EditorTrack.filePath
                      ? {
                          ...t,
                          ...id3EditorValues,
                          trackNumber: id3EditorValues.trackNumber ? parseInt(id3EditorValues.trackNumber, 10) : t.trackNumber,
                          year: id3EditorValues.year ? parseInt(id3EditorValues.year, 10) : t.year,
                          albumArt: id3SelectedArt?.fullUrl || t.albumArt
                        }
                      : t
                  ));
                  setId3EditorOpen(false);
                  setId3EditorTrack(null);
                  setId3SelectedArt(null);
                  setId3ArtSuggestions([]);
                } else {
                  console.error('Saving ID3 tags failed:', result.error);
                  showToast('Couldn’t save the tags. Check that the file isn’t read-only, then try again.', 'error');
                }
              } catch (error) {
                console.error('Error saving ID3 tags:', error);
                showToast('Couldn’t save the tags. Check that the file isn’t read-only, then try again.', 'error');
              } finally {
                setId3EditorSaving(false);
              }
            };
      return React.createElement(Modal, {
        size: 'md',
        title: 'Edit tags',
        description: id3EditorTrack?.filePath?.split('/').pop() || 'Unknown file',
        dismissible: !id3EditorSaving,
        onClose: close,
        footer: [
          React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: close, disabled: id3EditorSaving }, 'Cancel'),
          React.createElement(Button, { key: 'save', variant: 'primary', onClick: save, busy: id3EditorSaving }, 'Save')
        ]
      },
React.createElement('div', { style: { marginTop: '12px' } },
          // Title field
          React.createElement('div', { style: { marginBottom: '16px' } },
            React.createElement('label', {
              style: {
                display: 'block',
                fontSize: '12px',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '6px'
              }
            }, 'Title'),
            React.createElement(TextField, { value: id3EditorValues.title, onChange: (_v, e) => setId3EditorValues(v => ({ ...v, title: e.target.value })), placeholder: 'Track title', 'aria-label': 'Track title', className: 'w-full' })
          ),
          // Artist field
          React.createElement('div', { style: { marginBottom: '16px' } },
            React.createElement('label', {
              style: {
                display: 'block',
                fontSize: '12px',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '6px'
              }
            }, 'Artist'),
            React.createElement(TextField, { value: id3EditorValues.artist, onChange: (_v, e) => setId3EditorValues(v => ({ ...v, artist: e.target.value })), placeholder: 'Artist name', 'aria-label': 'Artist name', className: 'w-full' })
          ),
          // Album field
          React.createElement('div', { style: { marginBottom: '16px' } },
            React.createElement('label', {
              style: {
                display: 'block',
                fontSize: '12px',
                fontWeight: '500',
                color: 'var(--text-primary)',
                marginBottom: '6px'
              }
            }, 'Album'),
            React.createElement(TextField, { value: id3EditorValues.album, onChange: (_v, e) => setId3EditorValues(v => ({ ...v, album: e.target.value })), placeholder: 'Album name', 'aria-label': 'Album name', className: 'w-full' })
          ),
          // Track Number and Year row
          React.createElement('div', { className: 'flex gap-4', style: { marginBottom: '20px' } },
            // Track Number field
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                style: {
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: '500',
                  color: 'var(--text-primary)',
                  marginBottom: '6px'
                }
              }, 'Track #'),
              React.createElement(TextField, { value: id3EditorValues.trackNumber, onChange: (_v, e) => setId3EditorValues(v => ({ ...v, trackNumber: e.target.value })), placeholder: '1', 'aria-label': '1', className: 'w-full' })
            ),
            // Year field
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', {
                style: {
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: '500',
                  color: 'var(--text-primary)',
                  marginBottom: '6px'
                }
              }, 'Year'),
              React.createElement(TextField, { value: id3EditorValues.year, onChange: (_v, e) => setId3EditorValues(v => ({ ...v, year: e.target.value })), placeholder: '2024', 'aria-label': '2024', className: 'w-full' })
            )
          ),

          // Album Art section
          React.createElement('div', {
            style: {
              paddingTop: '20px',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            React.createElement('div', { className: 'flex items-center justify-between', style: { marginBottom: '12px' } },
              React.createElement('label', {
                style: {
                  fontSize: '12px',
                  fontWeight: '500',
                  color: 'var(--text-primary)'
                }
              }, 'Album Art'),
              id3ArtLoading && React.createElement('span', {
                className: 'flex items-center gap-1',
                style: {
                  fontSize: '12px',
                  color: 'var(--accent-primary)'
                }
              },
                React.createElement(Icons.Spinner, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }),
                'Searching…'
              )
            ),

            // Current selection - refined
            id3SelectedArt && React.createElement('div', {
              className: 'flex items-center gap-3',
              style: {
                marginBottom: '12px',
                padding: '12px',
                backgroundColor: 'var(--tint-success)',
                border: '1px solid var(--border-success)',
                borderRadius: '10px'
              }
            },
              React.createElement('img', {
                src: id3SelectedArt.thumbnailUrl,
                alt: 'Selected album art',
                style: {
                  width: '56px',
                  height: '56px',
                  borderRadius: '8px',
                  objectFit: 'cover'
                }
              }),
              React.createElement('div', { className: 'flex-1 min-w-0' },
                React.createElement('div', {
                  className: 'truncate',
                  style: {
                    fontSize: '13px',
                    fontWeight: '500',
                    color: 'var(--success)'
                  }
                }, id3SelectedArt.releaseName),
                React.createElement('div', {
                  className: 'truncate',
                  style: {
                    fontSize: '12px',
                    color: 'var(--text-success)',
                    marginTop: '2px'
                  }
                }, id3SelectedArt.artistName),
                id3SelectedArt.year && React.createElement('div', {
                  style: {
                    fontSize: '12px',
                    color: 'var(--text-success)'
                  }
                }, id3SelectedArt.year)
              ),
              React.createElement(Button, {
                variant: 'icon', size: 'sm', 'aria-label': 'Clear the chosen art',
                className: '!text-ink-success',
                onClick: () => setId3SelectedArt(null)
              }, React.createElement(Icons.X, { className: 'w-4 h-4' }))
            ),

            // Art suggestions grid - refined
            id3ArtSuggestions.length > 0 && !id3SelectedArt && React.createElement('div', {
              className: 'grid grid-cols-4 gap-2'
            },
              id3ArtSuggestions.map((art, idx) =>
                React.createElement('button', {
                  key: art.releaseId || idx,
                  type: 'button',
                  onClick: () => setId3SelectedArt(art),
                  className: 'relative group block rounded-lg overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                  'data-tooltip': `${art.releaseName} by ${art.artistName}${art.year ? ` (${art.year})` : ''}`
                },
                  React.createElement('img', {
                    src: art.thumbnailUrl,
                    alt: art.releaseName,
                    className: 'w-full aspect-square object-cover'
                  }),
                  React.createElement('div', {
                    className: 'absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center'
                  },
                    React.createElement('span', {
                      style: {
                        fontSize: '11px',
                        fontWeight: '500',
                        color: 'var(--on-accent)'
                      }
                    }, 'Select')
                  )
                )
              )
            ),

            // Empty state messages - refined
            !id3ArtLoading && id3ArtSuggestions.length === 0 && !id3SelectedArt && React.createElement('div', {
              style: {
                textAlign: 'center',
                padding: '16px 0',
                fontSize: '13px',
                color: 'var(--text-tertiary)'
              }
            },
              (!id3EditorValues.artist || !id3EditorValues.album)
                ? 'Enter artist and album to see artwork suggestions'
                : 'No artwork found for this album'
            )
          )
        )
      );
});

module.exports = { TagEditorDialog, TAG_EDITOR_DIALOG_HANDLERS };
