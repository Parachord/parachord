// src/renderer/components/external-track-prompt.js: the "open this track in its app?" prompt, with its countdown, for a source
// that plays outside Parachord
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and refs by value, plain functions through useStableHandlers
// (EXTERNAL_TRACK_PROMPT_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was.

const Icons = require('./icons');
const { Modal, DontShowAgain } = require('./modal');
const { Button } = require('./button');

const EXTERNAL_TRACK_PROMPT_HANDLERS = [
  'handleOpenExternalTrack',
  'handleSkipExternalTrack',
];

const ExternalTrackPrompt = React.memo(function ExternalTrackPrompt(props) {
  const {
    allResolvers,
    externalTrackCountdown,
    externalTrackIntervalRef,
    externalTrackTimeoutRef,
    handleOpenExternalTrack,
    handleSkipExternalTrack,
    pendingExternalTrack,
    setIsPlaying,
    setPendingExternalResolverId,
    setPendingExternalTrack,
    setShowExternalPrompt,
    setSkipExternalPrompt,
  } = props;
  return (() => {
      const dismiss = () => {
        // Clear the auto-skip timeout and interval
        if (externalTrackTimeoutRef.current) {
          clearTimeout(externalTrackTimeoutRef.current);
          externalTrackTimeoutRef.current = null;
        }
        if (externalTrackIntervalRef.current) {
          clearInterval(externalTrackIntervalRef.current);
          externalTrackIntervalRef.current = null;
        }
        // Pause playback and dismiss the prompt
        setIsPlaying(false);
        setShowExternalPrompt(false);
        setPendingExternalTrack(null);
        setPendingExternalResolverId(null);
        console.log('⏸️ User dismissed external track prompt, pausing playback');
      };
      const sourceId = pendingExternalTrack.bandcampUrl ? 'bandcamp'
        : (pendingExternalTrack.youtubeUrl || pendingExternalTrack.youtubeId ? 'youtube' : null);
      const source = sourceId ? allResolvers.find(r => r.id === sourceId) : null;
      return React.createElement(Modal, {
        size: 'sm',
        title: 'Open in browser',
        icon: React.createElement(Icons.ExternalLink, { className: 'w-5 h-5', style: { color: 'var(--accent-primary)' } }),
        onClose: dismiss,
        footer: [
          React.createElement(Button, { key: 'skip', variant: 'secondary', onClick: handleSkipExternalTrack }, 'Skip'),
          React.createElement(Button, { key: 'open', variant: 'primary', onClick: () => handleOpenExternalTrack(pendingExternalTrack) }, 'Open in browser')
        ]
      },
        // The track, and where it plays (the plug-in's own colour).
        React.createElement('div', { style: { marginTop: '4px' } },
          React.createElement('div', { className: 'text-ink-primary', style: { fontSize: '14px', fontWeight: 500 } }, pendingExternalTrack.title),
          React.createElement('div', { className: 'text-ink-secondary', style: { fontSize: '13px', marginTop: '4px' } }, pendingExternalTrack.artist),
          React.createElement('div', { className: 'inline-flex items-center gap-1.5 text-ink-secondary', style: { fontSize: '12px', fontWeight: 500, marginTop: '12px' } },
            React.createElement('span', { 'aria-hidden': 'true', style: { width: '8px', height: '8px', borderRadius: '50%', backgroundColor: source?.color || 'var(--accent-primary)' } }),
            source?.name || 'External')
        ),
        React.createElement('p', { className: 'text-ink-tertiary', role: 'status', style: { fontSize: '12px', marginTop: '12px' } },
          `Auto-skipping in ${externalTrackCountdown} second${externalTrackCountdown !== 1 ? 's' : ''}…`),
        React.createElement(DontShowAgain, {
          onChange: async (checked) => {
            setSkipExternalPrompt(checked);
            if (window.electron?.store) {
              await window.electron.store.set('skip_external_prompt', checked);
            }
          }
        })
      );
    })();
});

module.exports = { ExternalTrackPrompt, EXTERNAL_TRACK_PROMPT_HANDLERS };
