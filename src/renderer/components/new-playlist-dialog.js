// src/renderer/components/new-playlist-dialog.js: naming a new, empty playlist
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (NEW_PLAYLIST_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const { Modal } = require('./modal');
const { slug } = require('../lib/track-slug');
const { Button } = require('./button');
const { TextField } = require('./fields');

const NEW_PLAYLIST_DIALOG_HANDLERS = [
  'savePlaylistToStore',
];

const NewPlaylistDialog = React.memo(function NewPlaylistDialog(props) {
  const {
    newPlaylistDialogName,
    playlists,
    savePlaylistToStore,
    setActiveView,
    setNewPlaylistDialogName,
    setPlaylists,
    setSelectedPlaylist,
  } = props;
  return (() => {
      const close = () => setNewPlaylistDialogName(null);
      const existing = new Set(playlists.map(p => p.title));
      let fallback = 'New Playlist';
      for (let n = 2; existing.has(fallback); n++) fallback = `New Playlist ${n}`;
      const create = () => {
        const name = newPlaylistDialogName.trim() || fallback;
        const playlistId = slug(name) + '-' + Date.now();
        const newPlaylist = {
          id: playlistId,
          filename: `${playlistId}.xspf`,
          title: name,
          creator: 'Me',
          tracks: [],
          createdAt: Date.now(),
          addedAt: Date.now(),
          lastModified: Date.now()
        };
        setPlaylists(prev => [newPlaylist, ...prev]);
        savePlaylistToStore(newPlaylist);
        close();
        setActiveView('playlists');
        setSelectedPlaylist(newPlaylist);
      };
      return React.createElement(Modal, {
        size: 'sm',
        title: 'New playlist',
        onClose: close,
        footer: [
          React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: close }, 'Cancel'),
          React.createElement(Button, { key: 'create', variant: 'primary', type: 'submit', form: 'new-playlist-form' }, 'Create')
        ]
      },
        React.createElement('form', {
          id: 'new-playlist-form',
          style: { marginTop: '12px' },
          onSubmit: (e) => { e.preventDefault(); create(); }
        },
          React.createElement('label', { htmlFor: 'new-playlist-name', className: 'block text-ink-secondary', style: { fontSize: '13px', marginBottom: '8px' } }, 'Playlist name'),
          React.createElement(TextField, {
            id: 'new-playlist-name',
            value: newPlaylistDialogName,
            placeholder: fallback,
            onChange: (v) => setNewPlaylistDialogName(v),
            // Global shortcuts stay out of the way while typing.
            onKeyDown: (e) => e.stopPropagation(),
            autoFocus: true
          })
        )
      );
    })();
});

module.exports = { NewPlaylistDialog, NEW_PLAYLIST_DIALOG_HANDLERS };
