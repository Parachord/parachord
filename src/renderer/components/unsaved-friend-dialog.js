// src/renderer/components/unsaved-friend-dialog.js: the warning before unpinning a friend who isn't saved to Collection
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (UNSAVED_FRIEND_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const Icons = require('./icons');
const { Modal, DontShowAgain } = require('./modal');
const { Button } = require('./button');

const UNSAVED_FRIEND_DIALOG_HANDLERS = [
  'confirmUnpinFriend',
  'saveFriendToCollection',
];

const UnsavedFriendDialog = React.memo(function UnsavedFriendDialog(props) {
  const {
    confirmUnpinFriend,
    pendingUnpinFriend,
    saveFriendToCollection,
    setAutoPinnedFriendIds,
    setPendingUnpinFriend,
    setPinnedFriendIds,
    setSkipUnsavedFriendWarning,
    setUnsavedFriendWarningOpen,
    showToast,
  } = props;
  return React.createElement(Modal, {
      size: 'sm',
      title: 'Friend not saved',
      description: `${pendingUnpinFriend.displayName} isn’t saved to your collection. If you unpin them, you’ll need to add them again to pin them later.`,
      icon: React.createElement(Icons.AlertTriangle, { className: 'w-5 h-5', style: { color: 'var(--warning)' } }),
      onClose: () => {
        setUnsavedFriendWarningOpen(false);
        setPendingUnpinFriend(null);
      },
      footer: [
        React.createElement(Button, { key: 'unpin', variant: 'secondary', onClick: confirmUnpinFriend }, 'Just unpin'),
        React.createElement(Button, {
          key: 'save',
          variant: 'primary',
          onClick: () => {
            // Save to collection, then unpin
            saveFriendToCollection(pendingUnpinFriend.id);
            setPinnedFriendIds(prev => prev.filter(id => id !== pendingUnpinFriend.id));
            setAutoPinnedFriendIds(prev => prev.filter(id => id !== pendingUnpinFriend.id));
            showToast(`${pendingUnpinFriend.displayName} saved and unpinned`);
            setUnsavedFriendWarningOpen(false);
            setPendingUnpinFriend(null);
          }
        }, 'Save and unpin')
      ]
    },
      React.createElement(DontShowAgain, {
        onChange: async (checked) => {
          setSkipUnsavedFriendWarning(checked);
          if (window.electron?.store) {
            await window.electron.store.set('skip_unsaved_friend_warning', checked);
          }
        }
      })
    );
});

module.exports = { UnsavedFriendDialog, UNSAVED_FRIEND_DIALOG_HANDLERS };
