// src/renderer/components/playlist-update-dialog.js: the question asked when a
// playlist is imported from a link (dropped on the playlists list, or opened
// from a parachord://import link): keep it updated from the link, or import
// a snapshot of it as it is today. The import dialog shows the same choice
// inline (UpdateModeChoice), since a second dialog on top of it would fight
// it for Escape.
//
// The answer is the record's `autoUpdate` (lib/playlist-update-mode.js says
// what each mode does). Built on the shared Modal (focus moves in, is
// trapped and returns on close; Escape and the scrim cancel), RadioGroup and
// Button. Props-driven; hooks are qualified; loads under plain Node.

const { Modal } = require('./modal');
const { Button } = require('./button');
const { RadioGroup } = require('./fields');

// The two choices. A service link is looked up again hourly; a hosted XSPF is
// checked every 5 minutes (the hosted poller). Either way the link wins: a
// change there replaces the copy here, edits included.
function updateModeOptions({ isService = false, sourceLabel } = {}) {
  const where = isService && sourceLabel ? sourceLabel : 'the link';
  const often = isService ? 'every hour' : 'every 5 minutes';
  return [
    {
      value: 'auto',
      label: 'Keep it updated',
      hint: `Checks ${where} ${often}. Changes there replace this copy, including edits you make here.`,
    },
    {
      value: 'snapshot',
      label: 'Snapshot',
      hint: 'Imports the playlist as it is today. It never changes.',
    },
  ];
}

function UpdateModeChoice({ value, onChange, isService, sourceLabel, name = 'playlist-update-mode' }) {
  return React.createElement(RadioGroup, {
    name,
    value,
    onChange,
    label: 'How this playlist updates',
    options: updateModeOptions({ isService, sourceLabel }),
  });
}

// onChoose(mode) with 'auto' | 'snapshot'; onCancel on Cancel, the close X,
// Escape or the scrim.
function PlaylistUpdateDialog({
  open = true, sourceLabel, isService = false, defaultMode = 'auto', description, onChoose, onCancel,
}) {
  const e = React.createElement;
  const [mode, setMode] = React.useState(defaultMode === 'snapshot' ? 'snapshot' : 'auto');
  return e(Modal, {
    open,
    onClose: onCancel,
    title: 'Import playlist',
    description: description || 'Keep it updated from its link, or import it as it is today?',
    size: 'sm',
    footer: [
      e(Button, { key: 'cancel', variant: 'secondary', onClick: onCancel }, 'Cancel'),
      e(Button, { key: 'import', variant: 'primary', onClick: () => onChoose && onChoose(mode) }, 'Import'),
    ],
  },
  e('div', { style: { marginTop: '16px' } },
    e(UpdateModeChoice, { value: mode, onChange: setMode, isService, sourceLabel })));
}

module.exports = { PlaylistUpdateDialog, UpdateModeChoice, updateModeOptions };
