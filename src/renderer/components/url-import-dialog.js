// src/renderer/components/url-import-dialog.js: importing a playlist from a link or a file
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (URL_IMPORT_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// isPlaylistLinkImported reads playlistsRef and playlistLinkService the
// plug-in loader during render, so the call site passes _playlists and
// _allResolvers as memo invalidators.
// The markup moved as it was.

const Icons = require('./icons');
const { Modal } = require('./modal');
const { errorText } = require('../lib/error-copy');
const { UpdateModeChoice } = require('./playlist-update-dialog');
const { Button } = require('./button');
const { TextField } = require('./fields');

const URL_IMPORT_DIALOG_HANDLERS = [
  'handleImportPlaylist',
  'handleImportPlaylistFromUrl',
  'isPlaylistLinkImported',
  'playlistLinkService',
  'showConfirmDialog',
];

const UrlImportDialog = React.memo(function UrlImportDialog(props) {
  const {
    handleImportPlaylist,
    handleImportPlaylistFromUrl,
    isPlaylistLinkImported,
    playlistLinkService,
    setShowUrlImportDialog,
    setUrlImportLoading,
    setUrlImportMode,
    setUrlImportValue,
    showConfirmDialog,
    showToast,
    urlImportLoading,
    urlImportMode,
    urlImportValue,
  } = props;
  return (() => {
      const close = () => { setShowUrlImportDialog(false); setUrlImportValue(''); setUrlImportMode('auto'); };
      const linkService = playlistLinkService(urlImportValue.trim());
      const importUrl = async () => {
        if (!urlImportValue.trim() || urlImportLoading) return;
        setUrlImportLoading(true);
        try {
          // The choice below; a link already imported just refreshes.
          const url = urlImportValue.trim();
          const autoUpdate = isPlaylistLinkImported(url) ? undefined : urlImportMode === 'auto';
          const result = await handleImportPlaylistFromUrl(url, false, null, null, { autoUpdate });
          close();
          showToast(`${result.updated ? 'Updated' : 'Imported'} “${result.playlist.title}”`, 'success');
        } catch (error) {
          console.error('Import from URL failed:', error);
          showConfirmDialog({ type: 'error', title: 'Couldn’t import the playlist', message: errorText(error, 'Check the link and try again.') });
        } finally {
          setUrlImportLoading(false);
        }
      };
      return React.createElement(Modal, { size: 'md', title: 'Import playlist', onClose: close },
        // From a URL
        React.createElement('form', {
          className: 'rounded-xl border border-line bg-surface-inset',
          style: { padding: '16px', marginTop: '12px', marginBottom: '16px' },
          onSubmit: (e) => { e.preventDefault(); importUrl(); }
        },
          React.createElement('div', { className: 'flex items-start gap-3', style: { marginBottom: '12px' } },
            React.createElement('div', { className: 'flex items-center justify-center flex-shrink-0 bg-accent-fill text-ink-on-accent', style: { width: '36px', height: '36px', borderRadius: '10px' } },
              React.createElement(Icons.Link, { size: 20 })),
            React.createElement('div', { className: 'flex-1' },
              React.createElement('label', { htmlFor: 'import-playlist-url', className: 'block text-ink-primary', style: { fontSize: '14px', fontWeight: 600, marginBottom: '4px' } }, 'Import from URL'),
              React.createElement('p', { className: 'text-ink-secondary', style: { fontSize: '13px', lineHeight: 1.4 } }, 'Spotify, Apple Music, Amazon Music, or hosted .xspf'))
          ),
          React.createElement('div', { className: 'flex gap-2' },
            React.createElement(TextField, {
              id: 'import-playlist-url', type: 'url', value: urlImportValue, onChange: (v) => setUrlImportValue(v),
              // Global shortcuts stay out of the way while typing.
              onKeyDown: (e) => e.stopPropagation(),
              placeholder: 'Paste playlist URL…', disabled: urlImportLoading, autoFocus: true, className: 'flex-1'
            }),
            React.createElement(Button, { type: 'submit', variant: 'primary', busy: urlImportLoading, disabled: !urlImportValue.trim() }, 'Import')),
          // Keep it updated, or a snapshot (the same choice a dropped link asks).
          React.createElement('div', { style: { marginTop: '12px' } },
            React.createElement(UpdateModeChoice, {
              name: 'import-url-update-mode',
              value: urlImportMode,
              onChange: setUrlImportMode,
              isService: linkService.isService,
              sourceLabel: linkService.sourceLabel
            }))
        ),
        // Divider
        React.createElement('div', { className: 'flex items-center gap-3', style: { marginBottom: '16px' }, 'aria-hidden': 'true' },
          React.createElement('div', { className: 'flex-1 bg-line', style: { height: '1px' } }),
          React.createElement('span', { className: 'text-ink-tertiary', style: { fontSize: '12px', fontWeight: 500 } }, 'or'),
          React.createElement('div', { className: 'flex-1 bg-line', style: { height: '1px' } })
        ),
        // From a file
        React.createElement('button', {
          type: 'button',
          onClick: async () => { setShowUrlImportDialog(false); await handleImportPlaylist(); },
          disabled: urlImportLoading,
          className: 'w-full rounded-xl border-2 border-dashed border-line bg-surface-inset hover:bg-surface-hover hover:border-line-strong transition-colors text-center',
          style: { padding: '20px' }
        },
          React.createElement('div', { className: 'flex flex-col items-center gap-2' },
            React.createElement('div', { className: 'flex items-center justify-center bg-surface-placeholder text-ink-secondary', style: { width: '40px', height: '40px', borderRadius: '10px' } },
              React.createElement(Icons.Folder, { size: 20 })),
            React.createElement('div', null,
              React.createElement('p', { className: 'text-ink-primary', style: { fontSize: '14px', fontWeight: 500, marginBottom: '2px' } }, 'Load from file'),
              React.createElement('p', { className: 'text-ink-tertiary', style: { fontSize: '12px' } }, 'Choose an .xspf file from your computer'))
          )
        )
      );
    })();
});

module.exports = { UrlImportDialog, URL_IMPORT_DIALOG_HANDLERS };
