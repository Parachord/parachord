// src/renderer/components/account-row.js: a plug-in's account, in its
// settings dialog (#1498 step 3).
//
// Signing in was drawn six ways: "Connect" in the service's colour (Spotify,
// Apple Music, SoundCloud), "Sign in" in the app's purple in a grey card
// (Amazon Music), a full-width Connect under a username field (Last.fm,
// ListenBrainz), and a nested card with an avatar (Libre.fm). One row now:
// the account's name and status on the left, one button on the right.
//
//   "Sign in"  filled with the service's colour (its plug-in's color; the
//              maintainer keeps brand-coloured sign-in buttons), its text
//              white or near-black by contrast (lib/readable-text.js)
//   "Sign out" the secondary button
//
// Props:
//   name           the service ("Spotify"); the row reads "Spotify account"
//   color          the service's colour (a hex from the plug-in)
//   signedIn       which button to show
//   status         the line under the name ("Signed in as …", what's
//                  missing); defaults to "Signed in" / "Not signed in"
//   onSignIn()     omit when signing in isn't possible here (no button)
//   onSignOut()
//   signInDisabled the button shows but can't be pressed (what's missing is
//                  in `status`)
//   busy           a sign-in or sign-out in progress
// Props-driven; loads under plain Node.

const { Button } = require('./button');
const { SettingRow } = require('./fields');
const { readableTextOn } = require('../lib/readable-text');

function AccountRow({ name, color, signedIn, status, onSignIn, onSignOut, signInDisabled = false, busy = false }) {
  const e = React.createElement;
  const button = signedIn
    ? (onSignOut ? e(Button, { variant: 'secondary', busy, onClick: onSignOut, 'aria-label': `Sign out of ${name}` }, 'Sign out') : null)
    : (onSignIn ? e(Button, {
      variant: 'primary',
      pageColor: color || undefined,
      style: color && /^#/.test(color) ? { color: readableTextOn(color) } : undefined,
      disabled: signInDisabled,
      busy,
      onClick: onSignIn,
      // SettingRow names a control after the row ("Spotify account") unless
      // it has its own name; the button's name is what it does.
      'aria-label': `Sign in to ${name}`,
    }, 'Sign in') : null);
  return e(SettingRow, {
    label: `${name} account`,
    hint: status || (signedIn ? 'Signed in' : 'Not signed in'),
    style: { padding: 0 },
  }, button || e('span', null));
}

module.exports = { AccountRow };
