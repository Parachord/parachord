// src/renderer/components/raycast-info-dialog.js: the Raycast extension's
// info dialog (Settings › General): what it does and how to install it
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal; its one prop is the setter
// that closes it. The markup moved as it was.

const Icons = require('./icons');
const { BrandMark, BRAND_COLORS } = require('./brand-logos');
const { Modal } = require('./modal');
const { Button } = require('./button');

// Raycast's brand colour and gradient.
const RAYCAST_COLOR = BRAND_COLORS.raycast;
const RAYCAST_GRADIENT = BRAND_COLORS.raycastGradient;

const RAYCAST_INFO_DIALOG_HANDLERS = [
];

const RaycastInfoDialog = React.memo(function RaycastInfoDialog(props) {
  const {
    setRaycastInfoOpen,
  } = props;
  return React.createElement(Modal, { bare: true, label: "Raycast", scrimClassName: 'z-50', onClose: () => { setRaycastInfoOpen(false); }, panelProps: { className: 'bg-surface-card rounded-2xl shadow-2xl overflow-hidden', style: { width: '440px', maxHeight: '80vh' } } },
React.createElement('div', {
          style: {
            padding: '24px',
            background: RAYCAST_GRADIENT,
            display: 'flex',
            alignItems: 'center',
            gap: '16px'
          }
        },
          // Icon
          React.createElement('div', {
            style: {
              width: '56px',
              height: '56px',
              borderRadius: '12px',
              backgroundColor: 'var(--on-color-fill)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }
          },
            React.createElement(Icons.Zap, { className: 'w-8 h-8', style: { color: 'white' }, fill: 'currentColor' })
          ),
          // Title
          React.createElement('div', null,
            React.createElement('h3', {
              style: { fontSize: '20px', fontWeight: '600', color: 'var(--on-accent)', marginBottom: '2px' }
            }, 'Raycast Extension'),
            React.createElement('p', {
              style: { fontSize: '13px', color: 'var(--on-color-secondary)' }
            }, 'Control Parachord with keyboard shortcuts')
          ),
          // Close button
          React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: 'ml-auto', 'aria-label': "Close", onClick: () => setRaycastInfoOpen(false) }, React.createElement(Icons.X, { className: 'w-5 h-5 text-white' }))
        ),
React.createElement('div', {
          style: { padding: '24px', maxHeight: '50vh', overflowY: 'auto' }
        },
          React.createElement('p', {
            style: { fontSize: '14px', color: 'var(--nav-inactive)', lineHeight: '1.6', marginBottom: '20px' }
          },
            'The Parachord ',
            React.createElement('a', {
              href: '#',
              onClick: (e) => {
                e.preventDefault();
                if (window.electron?.shell?.openExternal) {
                  window.electron.shell.openExternal('https://raycast.com');
                } else {
                  window.open('https://raycast.com', '_blank');
                }
              },
              style: { color: RAYCAST_COLOR, textDecoration: 'none', fontWeight: '500' }
            }, 'Raycast'),
            ' extension lets you control playback, search for music, and chat with Shuffleupagus — all from your keyboard.'
          ),

          // Features
          React.createElement('div', { style: { marginBottom: '24px' } },
            React.createElement('h4', {
              style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }
            }, 'Commands'),
            [
              { icon: Icons.Play, text: 'Play/Pause, Next, Previous track' },
              { icon: Icons.Shuffle, text: 'Toggle shuffle, set volume' },
              { icon: Icons.Search, text: 'Search & play or add to queue' },
              { icon: (p) => React.createElement(BrandMark, Object.assign({ id: 'shuffleupagus' }, p)), text: 'Shuffleupagus, your AI companion' },
              { icon: Icons.Radio, text: 'Start Collection Radio' }
            ].map((item, i) =>
              React.createElement('div', {
                key: i,
                style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }
              },
                React.createElement(item.icon, { size: 18, style: { color: 'var(--text-secondary)', flexShrink: 0 } }),
                React.createElement('span', { style: { fontSize: '13px', color: 'var(--text-primary)' } }, item.text)
              )
            )
          ),

          // Installation instructions
          React.createElement('div', null,
            React.createElement('h4', {
              style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }
            }, 'Installation'),
            React.createElement('div', {
              style: {
                backgroundColor: 'var(--bg-secondary)',
                borderRadius: '12px',
                padding: '16px'
              }
            },
              [
                { step: '1', text: 'Install the extension from the Raycast Store' },
                { step: '2', text: 'Make sure Parachord is running' },
                { step: '3', text: 'The commands will appear in Raycast' }
              ].map((item, i) =>
                React.createElement('div', {
                  key: i,
                  style: { display: 'flex', alignItems: 'flex-start', gap: '12px', marginBottom: i < 2 ? '10px' : '0' }
                },
                  React.createElement('div', {
                    style: {
                      width: '22px',
                      height: '22px',
                      borderRadius: '50%',
                      backgroundColor: RAYCAST_COLOR,
                      color: 'var(--on-accent)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: '11px',
                      fontWeight: '600',
                      flexShrink: 0
                    }
                  }, item.step),
                  React.createElement('span', { style: { fontSize: '13px', color: 'var(--text-primary)', lineHeight: '22px' } }, item.text)
                )
              )
            ),
            // Note
            React.createElement('p', {
              style: { fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '12px', lineHeight: '1.5' }
            }, 'Requires Raycast to be installed on your Mac.')
          )
        ),
React.createElement('div', {
          style: {
            padding: '16px 24px',
            backgroundColor: 'var(--hover-bg-default)',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: '12px'
          }
        },
          React.createElement(Button, { variant: 'primary', pageColor: RAYCAST_COLOR, onClick: () => {
              if (window.electron?.shell?.openExternal) {
                window.electron.shell.openExternal('https://www.raycast.com/parachord/parachord');
              } else {
                window.open('https://www.raycast.com/parachord/parachord', '_blank');
              }
            } }, 'Install from Raycast Store'),
          React.createElement(Button, { variant: 'secondary', onClick: () => setRaycastInfoOpen(false) }, 'Done')
        ));
});

module.exports = { RaycastInfoDialog, RAYCAST_INFO_DIALOG_HANDLERS };
