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
//   label          the row's name instead, when the account is one part of a
//                  service ("Scrobbling", under Last.fm's own account row)
//   color          the service's colour (a hex from the plug-in)
//   signedIn       which button to show
//   status         the line under the name ("Signed in as …", what's
//                  missing); defaults to "Signed in" / "Not signed in"
//   onSignIn()     omit when signing in isn't possible here (no button)
//   onSignOut()
//   signInDisabled the button shows but can't be pressed (what's missing is
//                  in `status`)
//   busy           a sign-in or sign-out in progress
//   signInLabel / signOutLabel
//                  the buttons' words when the row isn't a sign-in: Last.fm
//                  and ListenBrainz read your history from a username alone
//                  ("Save" / "Remove"); calling that "Signed in" sat above
//                  a Scrobbling row asking you to sign in (2026-11-17)
// Props-driven; loads under plain Node.

const { Button } = require('./button');
const { SettingRow } = require('./fields');
const { readableTextOn } = require('../lib/readable-text');

function AccountRow({ name, label, color, signedIn, status, onSignIn, onSignOut, signInDisabled = false, busy = false, signInLabel, signOutLabel }) {
  const e = React.createElement;
  const button = signedIn
    ? (onSignOut ? e(Button, { variant: 'secondary', busy, onClick: onSignOut, 'aria-label': signOutLabel ? `${signOutLabel} ${name} username` : `Sign out of ${name}` }, signOutLabel || 'Sign out') : null)
    : (onSignIn ? e(Button, {
      variant: 'primary',
      pageColor: color || undefined,
      style: color && /^#/.test(color) ? { color: readableTextOn(color) } : undefined,
      disabled: signInDisabled,
      busy,
      onClick: onSignIn,
      // SettingRow names a control after the row ("Spotify account") unless
      // it has its own name; the button's name is what it does.
      'aria-label': signInLabel ? `${signInLabel} ${name} username` : `Sign in to ${name}`,
    }, signInLabel || 'Sign in') : null);
  return e(SettingRow, {
    label: label || `${name} account`,
    hint: status || (signedIn ? 'Signed in' : 'Not signed in'),
    style: { padding: 0 },
  }, button || e('span', null));
}

module.exports = { AccountRow };
