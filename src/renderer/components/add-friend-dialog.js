// src/renderer/components/add-friend-dialog.js: Add a friend.
//
// You follow someone on the service they scrobble to, so the dialog asks
// that first: two tiles, Last.fm and ListenBrainz, with their logos. Then
// one field, their username. Pasting their profile link fills both: the
// service from the link, the name from its path (and says so under the
// field). A name that isn't found, or a friend you already have, is said
// under the field, not in a toast behind the dialog.
//
// It replaced a dialog with one field and a bullet list of example URLs,
// where a bare username was looked up on Last.fm and then ListenBrainz:
// a same-named Last.fm user won whether you meant them or not.
//
// Props:
//   onClose()                 close it (Cancel, Escape, the scrim, success)
//   onAdd(service, username)  add them; resolves when added, throws (a
//                             userError) to show its message under the field
//   defaultService            'lastfm' | 'listenbrainz'
// Props-driven; hooks are qualified; loads under plain Node.

const { Modal } = require('./modal');
const { Button } = require('./button');
const { TextField, SegmentedChoice } = require('./fields');
const { SERVICE_LOGOS } = require('./brand-logos');
const { errorText } = require('../lib/error-copy');

const SERVICES = {
  lastfm: { name: 'Last.fm', profile: /last\.fm\/user\/([^/?#\s]+)/i },
  listenbrainz: { name: 'ListenBrainz', profile: /listenbrainz\.org\/user\/([^/?#\s]+)/i },
};

// A profile link's service and username, or null for anything else.
function parseFriendLink(text) {
  const t = String(text || '').trim();
  for (const [service, { profile }] of Object.entries(SERVICES)) {
    const m = profile.exec(t);
    if (m) return { service, username: decodeURIComponent(m[1]) };
  }
  return null;
}

// The service's logo in the text colour, 16px.
function serviceLogo(id) {
  const logo = SERVICE_LOGOS[id];
  return logo ? React.cloneElement(logo, { className: '', fill: 'currentColor', style: { width: '16px', height: '16px' } }) : null;
}

const LABEL_STYLE = { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '8px' };

function AddFriendDialog({ onClose, onAdd, defaultService = 'lastfm' }) {
  const e = React.createElement;
  const [service, setService] = React.useState(SERVICES[defaultService] ? defaultService : 'lastfm');
  const [username, setUsername] = React.useState('');
  const [fromLink, setFromLink] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  const serviceName = SERVICES[service].name;

  const onChange = (value) => {
    setError(null);
    const link = parseFriendLink(value);
    if (link) {
      setService(link.service);
      setUsername(link.username);
      setFromLink(true);
    } else {
      setUsername(value);
      setFromLink(false);
    }
  };

  const submit = async (ev) => {
    ev.preventDefault();
    const name = username.trim();
    if (!name || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onAdd(service, name);
      onClose();
    } catch (err) {
      console.error('Failed to add friend:', err);
      setError(errorText(err, `Couldn’t add ${name}. Check the name and try again.`));
      setBusy(false);
    }
  };

  return e(Modal, {
    size: 'md',
    title: 'Add a friend',
    description: 'See what they’re playing, and listen along. Choose where they scrobble, then enter their username.',
    onClose,
    footer: [
      e(Button, { key: 'cancel', variant: 'secondary', onClick: onClose }, 'Cancel'),
      e(Button, { key: 'add', variant: 'primary', type: 'submit', form: `${id}-form`, busy, disabled: !username.trim() }, 'Add friend'),
    ],
  },
  e('form', { id: `${id}-form`, onSubmit: submit, style: { marginTop: '20px' } },
    e('div', { id: `${id}-service`, className: 'text-ink-primary', style: LABEL_STYLE }, 'Service'),
    e(SegmentedChoice, {
      label: 'Service',
      value: service,
      onChange: (v) => { setService(v); setFromLink(false); setError(null); },
      options: Object.entries(SERVICES).map(([value, s]) => ({ value, label: s.name, icon: serviceLogo(value) })),
    }),
    e('label', { htmlFor: `${id}-username`, className: 'text-ink-primary', style: Object.assign({}, LABEL_STYLE, { marginTop: '20px' }) }, 'Username'),
    e(TextField, {
      id: `${id}-username`,
      value: username,
      onChange,
      // Global shortcuts stay out of the way while typing.
      onKeyDown: (ev) => ev.stopPropagation(),
      placeholder: `Their ${serviceName} username`,
      autoFocus: true,
      autoComplete: 'off',
      spellCheck: false,
      className: 'w-full',
      error,
    }),
    !error && e('p', { className: 'text-ink-tertiary', style: { fontSize: '12px', marginTop: '8px' } },
      fromLink ? `Taken from their ${serviceName} profile link.` : 'Or paste their profile link.')));
}

module.exports = { AddFriendDialog, parseFriendLink };
