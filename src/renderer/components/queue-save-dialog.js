// src/renderer/components/queue-save-dialog.js: saving the queue as a playlist or to a file
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (QUEUE_SAVE_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const { Modal } = require('./modal');
const { Button } = require('./button');
const { TextField } = require('./fields');

const QUEUE_SAVE_DIALOG_HANDLERS = [
  'handleSaveQueueConfirm',
  'handleSaveQueueToFile',
];

const QueueSaveDialog = React.memo(function QueueSaveDialog(props) {
  const {
    currentQueue,
    currentTrack,
    handleSaveQueueConfirm,
    handleSaveQueueToFile,
    queueSavePlaylistName,
    setQueueSaveDialogOpen,
    setQueueSavePlaylistName,
  } = props;
  return React.createElement(Modal, {
      size: 'sm',
      title: 'Save queue as playlist',
      description: `${(currentTrack ? 1 : 0) + currentQueue.length} track${((currentTrack ? 1 : 0) + currentQueue.length) !== 1 ? 's' : ''} will be saved`,
      onClose: () => setQueueSaveDialogOpen(false),
      footer: [
        React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: () => setQueueSaveDialogOpen(false) }, 'Cancel'),
        React.createElement(Button, {
          key: 'file', variant: 'secondary', onClick: handleSaveQueueToFile, disabled: !queueSavePlaylistName.trim(),
          'data-tooltip': 'Write an .xspf file instead of adding to your playlists'
        }, 'Save to file'),
        React.createElement(Button, { key: 'save', variant: 'primary', type: 'submit', form: 'queue-save-form', disabled: !queueSavePlaylistName.trim() }, 'Save')
      ]
    },
      React.createElement('form', {
        id: 'queue-save-form',
        style: { marginTop: '12px' },
        onSubmit: (e) => { e.preventDefault(); if (queueSavePlaylistName.trim()) handleSaveQueueConfirm(); }
      },
        React.createElement('label', { htmlFor: 'queue-playlist-name', className: 'block text-ink-secondary', style: { fontSize: '13px', marginBottom: '8px' } }, 'Playlist name'),
        React.createElement(TextField, {
          id: 'queue-playlist-name',
          value: queueSavePlaylistName,
          onChange: (v) => setQueueSavePlaylistName(v),
          // Global shortcuts stay out of the way while typing.
          onKeyDown: (e) => e.stopPropagation(),
          autoFocus: true
        })
      )
    );
});

module.exports = { QueueSaveDialog, QUEUE_SAVE_DIALOG_HANDLERS };
