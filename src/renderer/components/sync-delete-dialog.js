// src/renderer/components/sync-delete-dialog.js: deleting a synced playlist: here only, or its remote copies too
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (SYNC_DELETE_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const Icons = require('./icons');
const { Modal } = require('./modal');
const { PROVIDER_LABEL, getPlaylistMirrorTargets } = require('../lib/playlist-mirrors');
const { Button } = require('./button');

const SYNC_DELETE_DIALOG_HANDLERS = [
  'handleDeleteSyncedPlaylist',
];

const SyncDeleteDialog = React.memo(function SyncDeleteDialog(props) {
  const {
    handleDeleteSyncedPlaylist,
    setSyncDeleteDialog,
    syncDeleteDialog,
  } = props;
  return (() => {
      const svcs = [...new Set(getPlaylistMirrorTargets(syncDeleteDialog.playlist).map(t => PROVIDER_LABEL[t.providerId] || t.providerId))];
      const close = () => setSyncDeleteDialog({ show: false, playlist: null });
      return React.createElement(Modal, {
        size: 'sm',
        role: 'alertdialog',
        title: `Delete “${syncDeleteDialog.playlist?.title}”?`,
        description: `This playlist is synced with ${svcs.length ? svcs.join(', ') : 'a sync service'}. What would you like to do?`,
        icon: React.createElement(Icons.Trash2, { className: 'w-5 h-5', style: { color: 'var(--text-danger)' } }),
        onClose: close,
        footer: [
          React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: close }, 'Cancel'),
          React.createElement(Button, { key: 'source', variant: 'destructive', onClick: () => handleDeleteSyncedPlaylist('delete-from-source') },
            `Delete from ${svcs.length ? svcs.join(', ') : 'the service'} too`),
          React.createElement(Button, { key: 'stop', variant: 'primary', onClick: () => handleDeleteSyncedPlaylist('stop-syncing') }, 'Stop syncing')
        ]
      });
    })();
});

module.exports = { SyncDeleteDialog, SYNC_DELETE_DIALOG_HANDLERS };
