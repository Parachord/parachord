// src/renderer/components/stop-sync-dialog.js: stop syncing a playlist: keep it, or remove it
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (STOP_SYNC_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const { Modal } = require('./modal');
const { Button } = require('./button');
const { OptionTile } = require('./option-tile');

const STOP_SYNC_DIALOG_HANDLERS = [
  'stopSyncing',
];

const StopSyncDialog = React.memo(function StopSyncDialog(props) {
  const {
    setStopSyncDialog,
    stopSyncDialog,
    stopSyncing,
  } = props;
  return (() => {
      const close = () => setStopSyncDialog({ open: false, providerId: null });
      const option = (key, onClick, title, sub, danger) => React.createElement(OptionTile, {
        key, onClick, title, description: sub, tone: danger ? 'danger' : undefined
      });
      return React.createElement(Modal, {
        size: 'sm',
        title: 'Stop syncing?',
        description: 'What would you like to do with your synced items?',
        onClose: close,
        footer: React.createElement(Button, { variant: 'secondary', onClick: close }, 'Cancel')
      },
        React.createElement('div', { className: 'flex flex-col gap-2.5', style: { marginTop: '16px' } },
          option('keep', () => stopSyncing(stopSyncDialog.providerId, false), 'Keep imported items', 'Items stay in your Collection as local items'),
          option('remove', () => stopSyncing(stopSyncDialog.providerId, true), 'Remove synced items', 'Remove everything synced from this provider', true)
        )
      );
    })();
});

module.exports = { StopSyncDialog, STOP_SYNC_DIALOG_HANDLERS };
