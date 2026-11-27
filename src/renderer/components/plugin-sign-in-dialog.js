// src/renderer/components/plugin-sign-in-dialog.js: the sign-in question for
// any plug-in that needs a sign-in (#1624; it was Amazon's alone,
// amazon-manage-dialog.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props. app.js owns
// the state, { show, pluginId, name, hint, refused, signingIn, onResolve },
// and lib/plugin-sign-in-flow.js decides when it shows: onResolve(true) is
// Sign in, onResolve(false) Not now. While the plug-in's sign-in window is
// open (signingIn) it stays up with a busy Sign in and can't be dismissed.
//
// The words are the plug-in's: its name, "Sign in to X?" as on mobile
// (SignInPromptCopy), and its own tip from its manifest (settings.signInPromptHint,
// Amazon's profile picker).

const { Modal } = require('./modal');
const { Button } = require('./button');
const { signInDialogCopy } = require('../lib/plugin-sign-in-flow');

const PluginSignInDialog = React.memo(function PluginSignInDialog(props) {
  const {
    pluginSignInDialog,
    setPluginSignInDialog,
  } = props;
  const dialog = pluginSignInDialog;
  const answer = (yes) => {
    if (dialog.onResolve) dialog.onResolve(yes);
    if (!yes) setPluginSignInDialog({ show: false });
  };
  const { title, description } = signInDialogCopy(dialog);
  return React.createElement(Modal, {
    size: 'sm',
    title,
    description,
    dismissible: !dialog.signingIn,
    hideClose: dialog.signingIn,
    onClose: () => { if (!dialog.signingIn) answer(false); },
    footer: [
      !dialog.signingIn && React.createElement(Button, { key: 'later', variant: 'secondary', onClick: () => answer(false) }, 'Not now'),
      React.createElement(Button, {
        key: 'signin', variant: 'primary', busy: !!dialog.signingIn,
        onClick: () => { if (!dialog.signingIn) answer(true); }
      }, dialog.signingIn ? 'Waiting for sign-in…' : 'Sign in')
    ].filter(Boolean)
  },
    dialog.hint && React.createElement('p', { className: 'text-ink-tertiary', style: { fontSize: '12px', lineHeight: 1.5, marginTop: '8px' } }, dialog.hint)
  );
});

module.exports = { PluginSignInDialog };
