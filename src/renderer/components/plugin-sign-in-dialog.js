// src/renderer/components/amazon-manage-dialog.js: the Amazon Music sign-in dialog (promise-based: onResolve)
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value.
// The markup moved as it was.

const { Modal } = require('./modal');
const { Button } = require('./button');

const AmazonManageDialog = React.memo(function AmazonManageDialog(props) {
  const {
    amazonManageDialog,
    setAmazonManageDialog,
  } = props;
  return (() => {
      const notNow = () => {
        if (amazonManageDialog.onResolve) amazonManageDialog.onResolve(false);
        setAmazonManageDialog({ show: false, onResolve: null, relaunching: false });
      };
      return React.createElement(Modal, {
        size: 'sm',
        title: 'Play Amazon Music in Parachord?',
        description: 'Sign in, and if Amazon asks, choose a profile. The Amazon Music desktop app is not used.',
        dismissible: !amazonManageDialog.relaunching,
        hideClose: amazonManageDialog.relaunching,
        onClose: () => { if (!amazonManageDialog.relaunching) notNow(); },
        footer: [
          !amazonManageDialog.relaunching && React.createElement(Button, { key: 'later', variant: 'secondary', onClick: notNow }, 'Not now'),
          React.createElement(Button, {
            key: 'signin', variant: 'primary', busy: amazonManageDialog.relaunching,
            onClick: () => {
              if (amazonManageDialog.relaunching) return;
              if (amazonManageDialog.onResolve) amazonManageDialog.onResolve(true);
              else setAmazonManageDialog({ show: true, onResolve: null, relaunching: true });
            }
          }, amazonManageDialog.relaunching ? 'Opening Amazon Music…' : 'Sign in')
        ].filter(Boolean)
      },
        React.createElement('p', { className: 'text-ink-tertiary', style: { fontSize: '12px', lineHeight: 1.5, marginTop: '8px' } },
          'You can close the sign-in window to cancel. If the account has more than one profile, pick one before closing — search and play wait for that selection.')
      );
    })();
});

module.exports = { AmazonManageDialog };
