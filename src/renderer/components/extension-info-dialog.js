// src/renderer/components/extension-info-dialog.js: the browser extension's
// info dialog (Settings › General): what it does and where to get it for
// Chrome and Firefox (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal; its one prop is the setter
// that closes it. The markup moved as it was.

const Icons = require('./icons');
const { BrandMark } = require('./brand-logos');
const { Modal } = require('./modal');
const { Button } = require('./button');
const { OptionTile } = require('./option-tile');

const EXTENSION_INFO_DIALOG_HANDLERS = [
];

const ExtensionInfoDialog = React.memo(function ExtensionInfoDialog(props) {
  const {
    setExtensionInfoOpen,
  } = props;
  return React.createElement(Modal, { bare: true, label: "Browser extension", scrimClassName: 'z-50', onClose: () => { setExtensionInfoOpen(false); }, panelProps: { className: 'bg-surface-card rounded-2xl shadow-2xl overflow-hidden', style: { width: '440px', maxHeight: '80vh' } } },
React.createElement('div', {
          style: {
            padding: '24px',
            background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-soft) 100%)',
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
            React.createElement(Icons.Globe, { className: 'w-8 h-8 text-white' })
          ),
          // Title
          React.createElement('div', null,
            React.createElement('h3', {
              style: { fontSize: '20px', fontWeight: '600', color: 'var(--on-accent)', marginBottom: '2px' }
            }, 'Browser Extension'),
            React.createElement('p', {
              style: { fontSize: '13px', color: 'var(--on-color-secondary)' }
            }, 'Add music to Parachord from anywhere')
          ),
          // Close button
          React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: 'ml-auto', 'aria-label': "Close", onClick: () => setExtensionInfoOpen(false) }, React.createElement(Icons.X, { className: 'w-5 h-5 text-white' }))
        ),
React.createElement('div', {
          style: { padding: '24px', maxHeight: '50vh', overflowY: 'auto' }
        },
          React.createElement('p', {
            style: { fontSize: '14px', color: 'var(--nav-inactive)', lineHeight: '1.6', marginBottom: '20px' }
          }, 'The Parachord browser extension lets you add tracks and albums to your library directly from music websites like Spotify, Bandcamp, SoundCloud, and more.'),

          // Features
          React.createElement('div', { style: { marginBottom: '24px' } },
            React.createElement('h4', {
              style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }
            }, 'Features'),
            [
              { icon: '🎵', text: 'Add tracks to your queue with one click' },
              { icon: '📋', text: 'Save albums and playlists to your library' },
              { icon: '🔗', text: 'Works with Spotify, Bandcamp, SoundCloud, YouTube, and more' }
            ].map((item, i) =>
              React.createElement('div', {
                key: i,
                style: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }
              },
                React.createElement('span', { style: { fontSize: '16px' } }, item.icon),
                React.createElement('span', { style: { fontSize: '13px', color: 'var(--text-primary)' } }, item.text)
              )
            )
          ),

          // Install from store
          React.createElement('div', null,
            React.createElement('h4', {
              style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }
            }, 'Install'),
            React.createElement('div', {
              style: { display: 'flex', flexDirection: 'column', gap: '10px' }
            },
              // Chrome Web Store button
              React.createElement(OptionTile, {
                onClick: () => {
                  const url = 'https://chromewebstore.google.com/detail/parachord/gibkgapadebfoillbakpgmgpnppjlnie';
                  if (window.electron?.shell?.openExternal) {
                    window.electron.shell.openExternal(url);
                  } else {
                    window.open(url, '_blank');
                  }
                },
                icon: React.createElement(BrandMark, { id: 'chrome', size: 32 }),
                title: 'Chrome Web Store',
                description: 'For Chrome, Edge, and Chromium browsers'
              }),
              // Firefox Add-ons button
              React.createElement(OptionTile, {
                onClick: () => {
                  const url = 'https://addons.mozilla.org/en-US/firefox/addon/parachord/';
                  if (window.electron?.shell?.openExternal) {
                    window.electron.shell.openExternal(url);
                  } else {
                    window.open(url, '_blank');
                  }
                },
                icon: React.createElement('img', {
                    width: '32',
                    height: '32',
                    src: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='512' height='512' viewBox='0 0 512 512'%3E%3Cdefs%3E%3ClinearGradient id='a' x1='446.9' y1='76.85' x2='47.94' y2='461.77' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.05' stop-color='%23fff44f'/%3E%3Cstop offset='.11' stop-color='%23ffe847'/%3E%3Cstop offset='.22' stop-color='%23ffc830'/%3E%3Cstop offset='.37' stop-color='%23ff980e'/%3E%3Cstop offset='.4' stop-color='%23ff8b16'/%3E%3Cstop offset='.46' stop-color='%23ff672a'/%3E%3Cstop offset='.53' stop-color='%23ff3647'/%3E%3Cstop offset='.7' stop-color='%23e31587'/%3E%3C/linearGradient%3E%3CradialGradient id='b' cx='428.46' cy='55.06' r='501.01' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.13' stop-color='%23ffbd4f'/%3E%3Cstop offset='.19' stop-color='%23ffac31'/%3E%3Cstop offset='.25' stop-color='%23ff9d17'/%3E%3Cstop offset='.28' stop-color='%23ff980e'/%3E%3Cstop offset='.4' stop-color='%23ff563b'/%3E%3Cstop offset='.47' stop-color='%23ff3750'/%3E%3Cstop offset='.71' stop-color='%23f5156c'/%3E%3Cstop offset='.78' stop-color='%23eb0878'/%3E%3Cstop offset='.86' stop-color='%23e50080'/%3E%3C/radialGradient%3E%3CradialGradient id='c' cx='245.39' cy='259.88' r='501.01' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.3' stop-color='%23960e18'/%3E%3Cstop offset='.35' stop-color='%23b11927' stop-opacity='.74'/%3E%3Cstop offset='.43' stop-color='%23db293d' stop-opacity='.34'/%3E%3Cstop offset='.5' stop-color='%23f5334b' stop-opacity='.09'/%3E%3Cstop offset='.53' stop-color='%23ff3750' stop-opacity='0'/%3E%3C/radialGradient%3E%3CradialGradient id='d' cx='305.8' cy='-58.64' r='362.96' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.13' stop-color='%23fff44f'/%3E%3Cstop offset='.25' stop-color='%23ffdc3e'/%3E%3Cstop offset='.51' stop-color='%23ff9d12'/%3E%3Cstop offset='.53' stop-color='%23ff980e'/%3E%3C/radialGradient%3E%3CradialGradient id='e' cx='189.98' cy='390.75' r='238.55' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.35' stop-color='%233a8ee6'/%3E%3Cstop offset='.47' stop-color='%235c79f0'/%3E%3Cstop offset='.67' stop-color='%239059ff'/%3E%3Cstop offset='1' stop-color='%23c139e6'/%3E%3C/radialGradient%3E%3CradialGradient id='f' cx='252.16' cy='201.25' r='126.48' gradientTransform='matrix(.97 -.24 .28 1.14 -48.36 31.43)' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.21' stop-color='%239059ff' stop-opacity='0'/%3E%3Cstop offset='.28' stop-color='%238c4ff3' stop-opacity='.06'/%3E%3Cstop offset='.75' stop-color='%237716a8' stop-opacity='.45'/%3E%3Cstop offset='.97' stop-color='%236e008b' stop-opacity='.6'/%3E%3C/radialGradient%3E%3CradialGradient id='g' cx='239.06' cy='34.56' r='171.62' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0' stop-color='%23ffe226'/%3E%3Cstop offset='.12' stop-color='%23ffdb27'/%3E%3Cstop offset='.3' stop-color='%23ffc82a'/%3E%3Cstop offset='.5' stop-color='%23ffa930'/%3E%3Cstop offset='.73' stop-color='%23ff7e37'/%3E%3Cstop offset='.79' stop-color='%23ff7139'/%3E%3C/radialGradient%3E%3CradialGradient id='h' cx='373.96' cy='-74.29' r='732.21' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.11' stop-color='%23fff44f'/%3E%3Cstop offset='.46' stop-color='%23ff980e'/%3E%3Cstop offset='.62' stop-color='%23ff5634'/%3E%3Cstop offset='.72' stop-color='%23ff3647'/%3E%3Cstop offset='.9' stop-color='%23e31587'/%3E%3C/radialGradient%3E%3CradialGradient id='i' cx='304.59' cy='7.07' r='536.37' gradientTransform='matrix(.1 .99 -.65 .07 277.32 -296.33)' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='0' stop-color='%23fff44f'/%3E%3Cstop offset='.06' stop-color='%23ffe847'/%3E%3Cstop offset='.17' stop-color='%23ffc830'/%3E%3Cstop offset='.3' stop-color='%23ff980e'/%3E%3Cstop offset='.36' stop-color='%23ff8b16'/%3E%3Cstop offset='.45' stop-color='%23ff672a'/%3E%3Cstop offset='.57' stop-color='%23ff3647'/%3E%3Cstop offset='.74' stop-color='%23e31587'/%3E%3C/radialGradient%3E%3CradialGradient id='j' cx='235.02' cy='98.12' r='457.12' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.14' stop-color='%23fff44f'/%3E%3Cstop offset='.48' stop-color='%23ff980e'/%3E%3Cstop offset='.59' stop-color='%23ff5634'/%3E%3Cstop offset='.66' stop-color='%23ff3647'/%3E%3Cstop offset='.9' stop-color='%23e31587'/%3E%3C/radialGradient%3E%3CradialGradient id='k' cx='355.69' cy='124.88' r='500.32' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.09' stop-color='%23fff44f'/%3E%3Cstop offset='.23' stop-color='%23ffe141'/%3E%3Cstop offset='.51' stop-color='%23ffaf1e'/%3E%3Cstop offset='.63' stop-color='%23ff980e'/%3E%3C/radialGradient%3E%3ClinearGradient id='l' x1='442.1' y1='74.79' x2='102.64' y2='414.26' gradientUnits='userSpaceOnUse'%3E%3Cstop offset='.17' stop-color='%23fff44f' stop-opacity='.8'/%3E%3Cstop offset='.27' stop-color='%23fff44f' stop-opacity='.63'/%3E%3Cstop offset='.49' stop-color='%23fff44f' stop-opacity='.22'/%3E%3Cstop offset='.6' stop-color='%23fff44f' stop-opacity='0'/%3E%3C/linearGradient%3E%3C/defs%3E%3Cpath d='M478.71 166.38c-10.44-25.13-31.6-52.26-48.21-60.83 13.52 26.51 21.34 53.1 24.33 72.94 0 0 0 .14.05.4C427.71 111.15 381.63 83.83 344 24.36c-1.91-3-3.81-6-5.67-9.21-1.05-1.81-1.9-3.45-2.64-5A43.73 43.73 0 0 1 332.1.68a.63.63 0 0 0-.54-.65.86.86 0 0 0-.45 0 .47.47 0 0 0-.11.07c-.06 0-.12.07-.18.09l.1-.13c-60.37 35.36-80.85 100.77-82.73 133.5A120.27 120.27 0 0 0 182 159.05a71.11 71.11 0 0 0-6.22-4.7 111.39 111.39 0 0 1-.67-58.74c-24.69 11.25-43.89 29-57.85 44.71h-.11c-9.53-12.07-8.86-51.88-8.32-60.19-.11-.52-7.1 3.63-8 4.26a174.74 174.74 0 0 0-23.49 20.12 210.18 210.18 0 0 0-22.44 26.91 202.86 202.86 0 0 0-32.25 72.82c-.11.52-.21 1.06-.32 1.59-.45 2.11-2.08 12.7-2.37 15v.53A229.1 229.1 0 0 0 16 254.52v1.23c0 132.72 107.6 240.32 240.32 240.32 118.87 0 217.56-86.3 236.89-199.66.4-3.07.73-6.17 1.09-9.27 4.78-41.22-.53-84.54-15.59-120.76zm-277 188.12c1.12.53 2.18 1.12 3.33 1.64l.16.1c-1.15-.56-2.32-1.14-3.48-1.74zm55-144.95zM454.9 179v-.23.26z' fill='url(%23a)'/%3E%3Cpath d='M478.71 166.38c-10.44-25.13-31.6-52.26-48.21-60.83 13.52 26.51 21.34 53.1 24.33 72.94v.49c22.68 61.48 10.32 124-7.48 162.2-27.54 59.1-94.21 119.68-198.58 116.73-112.67-3.2-212-86.91-230.55-196.46-3.38-17.29 0-26.06 1.7-40.09-2.07 10.81-2.86 13.94-3.89 33.16v1.23c0 132.72 107.6 240.32 240.32 240.32 118.87 0 217.56-86.3 236.89-199.66.4-3.07.73-6.17 1.09-9.27 4.75-41.22-.56-84.54-15.62-120.76z' fill='url(%23b)'/%3E%3Cpath d='M478.71 166.38c-10.44-25.13-31.6-52.26-48.21-60.83 13.52 26.51 21.34 53.1 24.33 72.94v.49c22.68 61.48 10.32 124-7.48 162.2-27.54 59.1-94.21 119.68-198.58 116.73-112.67-3.2-212-86.91-230.55-196.46-3.38-17.29 0-26.06 1.7-40.09-2.07 10.81-2.86 13.94-3.89 33.16v1.23c0 132.72 107.6 240.32 240.32 240.32 118.87 0 217.56-86.3 236.89-199.66.4-3.07.73-6.17 1.09-9.27 4.75-41.22-.56-84.54-15.62-120.76z' fill='url(%23c)'/%3E%3Cpath d='M361.92 194.62c.53.37 1 .74 1.5 1.11a130.49 130.49 0 0 0-22.32-29.12C266.4 91.91 321.52 4.63 330.81.19l.1-.13c-60.37 35.36-80.85 100.77-82.73 133.5 2.8-.19 5.59-.43 8.44-.43 45.05 0 84.29 24.78 105.3 61.49z' fill='url(%23d)'/%3E%3Cpath d='M256.77 209.54c-.39 6-21.51 26.6-28.9 26.6-68.34 0-79.43 41.34-79.43 41.34 3 34.82 27.26 63.49 56.61 78.66 1.34.69 2.69 1.31 4 1.93 2.35 1 4.71 2 7.06 2.89a106.88 106.88 0 0 0 31.27 6c119.78 5.62 143-143.22 56.55-186.44 22.13-3.85 45.11 5.06 57.94 14.07-21-36.71-60.25-61.49-105.3-61.49-2.85 0-5.64.24-8.44.43A120.27 120.27 0 0 0 182 159.05c3.67 3.11 7.81 7.25 16.52 15.83 16.34 16.12 58.16 32.71 58.25 34.66z' fill='url(%23e)'/%3E%3Cpath d='M256.77 209.54c-.39 6-21.51 26.6-28.9 26.6-68.34 0-79.43 41.34-79.43 41.34 3 34.82 27.26 63.49 56.61 78.66 1.34.69 2.69 1.31 4 1.93 2.35 1 4.71 2 7.06 2.89a106.88 106.88 0 0 0 31.27 6c119.78 5.62 143-143.22 56.55-186.44 22.13-3.85 45.11 5.06 57.94 14.07-21-36.71-60.25-61.49-105.3-61.49-2.85 0-5.64.24-8.44.43A120.27 120.27 0 0 0 182 159.05c3.67 3.11 7.81 7.25 16.52 15.83 16.34 16.12 58.16 32.71 58.25 34.66z' fill='url(%23f)'/%3E%3Cpath d='M170.83 151.06c1.95 1.26 3.55 2.32 5 3.29a111.39 111.39 0 0 1-.67-58.74c-24.69 11.25-43.89 29-57.85 44.71 1.13-.03 35.99-.66 53.52 10.74z' fill='url(%23g)'/%3E%3Cpath d='M18.22 261.45C36.77 371 136.1 454.71 248.85 457.91c104.37 2.95 171-57.63 198.58-116.73 17.8-38.21 30.16-100.72 7.48-162.2v-.46c0 .06 0 .14.05.4 8.52 55.67-19.79 109.6-64.05 146.07a7.3 7.3 0 0 0-.13.31c-86.25 70.23-168.78 42.37-185.49 31-1.16-.56-2.33-1.14-3.49-1.74 50.29-24-71.06-69.85-66.61-109.14-42.45 0-56.93-35.82-56.93-35.82s38.12-27.18 88.36-3.54c46.53 21.9 90.23 3.55 90.23 3.54-.09-1.95-41.91-18.59-58.22-34.66-8.71-8.58-12.85-12.72-16.52-15.83a71.11 71.11 0 0 0-6.22-4.7c-1.43-1-3-2-5-3.29-17.53-11.4-52.39-10.77-53.54-10.74h-.11c-9.53-12.07-8.86-51.88-8.32-60.19-.11-.52-7.1 3.63-8 4.26a174.74 174.74 0 0 0-23.49 20.12 210.18 210.18 0 0 0-22.44 26.91 202.86 202.86 0 0 0-32.25 72.82c-.19.46-8.74 37.79-4.52 57.15z' fill='url(%23h)'/%3E%3Cpath d='M341.1 166.61a130.49 130.49 0 0 1 22.32 29.12 46.36 46.36 0 0 1 3.6 3C421.5 248.89 393 319.9 390.83 325c44.26-36.47 72.57-90.4 64.05-146.07-27.17-67.78-73.25-95.1-110.88-154.57-1.91-3-3.81-6-5.67-9.21-1.05-1.81-1.9-3.45-2.64-5A43.73 43.73 0 0 1 332.1.68a.63.63 0 0 0-.54-.65.86.86 0 0 0-.45 0 .47.47 0 0 0-.11.07c-.06 0-.12.07-.18.09-9.3 4.44-64.42 91.72 10.28 166.42z' fill='url(%23i)'/%3E%3Cpath d='M367 198.68a46.36 46.36 0 0 0-3.6-3c-.49-.37-1-.74-1.5-1.11-12.83-9-35.81-17.92-57.94-14.07 86.44 43.22 63.23 192.06-56.55 186.44a106.88 106.88 0 0 1-31.27-6c-2.35-.88-4.71-1.85-7.06-2.89-1.36-.62-2.71-1.24-4-1.93l.16.1c16.71 11.4 99.24 39.26 185.49-31 0 0 .05-.13.13-.31C393 319.9 421.5 248.89 367 198.68z' fill='url(%23j)'/%3E%3Cpath d='M148.44 277.48s11.09-41.34 79.43-41.34c7.39 0 28.51-20.62 28.9-26.6s-43.7 18.36-90.23-3.54c-50.24-23.64-88.36 3.54-88.36 3.54s14.48 35.82 56.93 35.82c-4.45 39.29 16.32 85.1 66.61 109.14 1.12.53 2.18 1.12 3.33 1.64-29.35-15.14-53.58-43.84-56.61-78.66z' fill='url(%23k)'/%3E%3Cpath d='M478.71 166.38c-10.44-25.13-31.6-52.26-48.21-60.83 13.52 26.51 21.34 53.1 24.33 72.94 0 0 0 .14.05.4C427.71 111.15 381.63 83.83 344 24.36c-1.91-3-3.81-6-5.67-9.21-1.05-1.81-1.9-3.45-2.64-5A43.73 43.73 0 0 1 332.1.68a.63.63 0 0 0-.54-.65.86.86 0 0 0-.45 0 .47.47 0 0 0-.11.07c-.06 0-.12.07-.18.09l.1-.13c-60.37 35.36-80.85 100.77-82.73 133.5 2.8-.19 5.59-.43 8.44-.43 45.05 0 84.29 24.78 105.3 61.49-12.83-9-35.81-17.92-57.94-14.07 86.44 43.22 63.23 192.06-56.55 186.44a106.88 106.88 0 0 1-31.27-6c-2.35-.88-4.71-1.85-7.06-2.89-1.36-.62-2.71-1.24-4-1.93l.16.1c-1.16-.56-2.33-1.14-3.49-1.74 1.12.53 2.18 1.12 3.33 1.64-29.41-15.17-53.64-43.87-56.67-78.69 0 0 11.09-41.34 79.43-41.34 7.39 0 28.51-20.62 28.9-26.6-.09-1.95-41.91-18.59-58.22-34.66-8.71-8.58-12.85-12.72-16.52-15.83a71.11 71.11 0 0 0-6.22-4.7 111.39 111.39 0 0 1-.67-58.74c-24.69 11.25-43.89 29-57.85 44.71h-.11c-9.53-12.07-8.86-51.88-8.32-60.19-.11-.52-7.1 3.63-8 4.26a174.74 174.74 0 0 0-23.49 20.12 210.18 210.18 0 0 0-22.44 26.91 202.86 202.86 0 0 0-32.25 72.82c-.11.52-.21 1.06-.32 1.59-.45 2.11-2.49 12.85-2.77 15.15 0 .18 0-.17 0 0A278.84 278.84 0 0 0 16 254.52v1.23c0 132.72 107.6 240.32 240.32 240.32 118.87 0 217.56-86.3 236.89-199.66.4-3.07.73-6.17 1.09-9.27 4.78-41.22-.53-84.54-15.59-120.76zm-23.84 12.34v.26z' fill='url(%23l)'/%3E%3C/svg%3E"
                  }),
                title: 'Firefox Add-ons',
                description: 'For Mozilla Firefox'
              })
            )
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
          React.createElement(Button, { variant: 'secondary', onClick: () => setExtensionInfoOpen(false) }, 'Done')
        ));
});

module.exports = { ExtensionInfoDialog, EXTENSION_INFO_DIALOG_HANDLERS };
