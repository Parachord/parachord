// src/renderer/components/sync-channel-disable-dialog.js: turning off one service's sync for a playlist
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value.
// The markup moved as it was.

const { Modal } = require('./modal');
const { Button } = require('./button');

const SyncChannelDisableDialog = React.memo(function SyncChannelDisableDialog(props) {
  const {
    selectedPlaylist,
    setPlaylists,
    setSelectedPlaylist,
    setSyncChannelDisableDialog,
    showToast,
    syncChannelDisableDialog,
  } = props;
  return (() => {
      const d = syncChannelDisableDialog;
      const close = () => setSyncChannelDisableDialog({ show: false });
      const applyDisable = async (deleteRemote) => {
        setSyncChannelDisableDialog({ show: false });
        let res = null;
        try { res = await window.electron.sync.setChannel(d.playlistId, d.providerId, false, { deleteRemote }); } catch {}
        try {
          const fresh = await window.electron.playlists.load();
          setPlaylists(fresh);
          if (selectedPlaylist?.id === d.playlistId) { const u = fresh.find(p => p.id === d.playlistId); if (u) setSelectedPlaylist(u); }
        } catch {}
        const rd = res && res.remoteDelete;
        if (deleteRemote && rd && rd.deleted === false && rd.reason === 'unsupported') {
          showToast(`Stopped syncing — remove it from ${d.providerLabel} manually (the app can't delete library playlists there).`, 'info');
        } else if (deleteRemote && rd && rd.deleted) {
          showToast(`Stopped syncing and deleted from ${d.providerLabel}`);
        } else {
          showToast(`Stopped syncing this playlist to ${d.providerLabel}`);
        }
      };
      return React.createElement(Modal, {
        size: 'sm',
        title: `Stop syncing to ${d.providerLabel}?`,
        description: `Keep “${d.playlistName}” on ${d.providerLabel} and just stop syncing it, or delete it from ${d.providerLabel} too?`,
        onClose: close,
        footer: [
          React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: close }, 'Cancel'),
          React.createElement(Button, { key: 'delete', variant: 'destructive', onClick: () => applyDisable(true) }, `Delete from ${d.providerLabel} too`),
          React.createElement(Button, { key: 'stop', variant: 'primary', onClick: () => applyDisable(false) }, 'Stop syncing')
        ]
      });
    })();
});

module.exports = { SyncChannelDisableDialog };
