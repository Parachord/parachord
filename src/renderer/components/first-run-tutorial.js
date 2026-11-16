// src/renderer/components/first-run-tutorial.js: the welcome tour shown on
// first launch: what Parachord is, the plug-ins that play music, the
// accounts (Last.fm, ListenBrainz), local files and where to go next
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters, refs and memos by value, plain functions through
// useStableHandlers (FIRST_RUN_TUTORIAL_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). The refs are read only inside click
// handlers; window is read only inside handlers. The markup moved as it was.

const Icons = require('./icons');
const { countOf } = require('../lib/plural');
const { appendUniqueId, insertInCanonicalOrder } = require('../lib/resolver-order');
const { ParachordWordmark, SERVICE_LOGOS } = require('./brand-logos');
const { Modal } = require('./modal');
const { Badge } = require('./badge');
const { Button } = require('./button');
const { TextField } = require('./fields');

const FIRST_RUN_TUTORIAL_HANDLERS = [
  'connectLastfm',
  'connectListenbrainz',
  'handleAddWatchFolder',
  'navigateTo',
];

const FirstRunTutorial = React.memo(function FirstRunTutorial(props) {
  const {
    activeResolvers,
    activeResolversRef,
    connectLastfm,
    connectListenbrainz,
    firstRunTutorial,
    handleAddWatchFolder,
    loadedResolvers,
    metaServiceConfigs,
    navigateTo,
    playbackResolvers,
    resolverOrderRef,
    savedActiveResolversRef,
    setActiveResolvers,
    setFirstRunTutorial,
    setResolverOrder,
    setSettingsTab,
    watchFolders,
  } = props;
  return React.createElement(Modal, { bare: true, label: "Welcome to Parachord", scrimClassName: 'z-50', dismissible: false, panelProps: { className: 'relative w-full max-w-xl mx-4 overflow-hidden', style: {
          // Never taller than the window: the body scrolls instead.
          maxHeight: 'calc(100vh - 48px)',
          overflowY: 'auto',
          backgroundColor: 'var(--card-bg)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-dialog)'
        } } },
firstRunTutorial.step === 'welcome' && React.createElement(React.Fragment, null,
          // Accent bar
          React.createElement('div', {
            style: {
              height: '4px',
              backgroundColor: 'var(--accent-primary)'
            }
          }),
          // Header
          React.createElement('div', {
            style: {
              padding: '32px 32px 24px',
              textAlign: 'center',
              borderBottom: '1px solid var(--border-subtle)'
            }
          },
            // Parachord wordmark logo - centered
            React.createElement('div', {
              style: { marginBottom: '12px', display: 'flex', justifyContent: 'center' }
            },
              React.createElement(ParachordWordmark, { fill: 'var(--text-primary)', height: 44 })
            ),
            React.createElement('p', {
              style: { fontSize: '14px', color: 'var(--text-secondary)', lineHeight: '1.5' }
            }, 'Your music is everywhere, but you shouldn\'t have to be.')
          ),
          // Content
          React.createElement('div', {
            style: { padding: '24px 32px' }
          },
            React.createElement('p', {
              style: { fontSize: '14px', color: 'var(--nav-inactive)', lineHeight: '1.6', marginBottom: '20px' }
            }, 'Parachord brings all your music together in one place. Search across multiple services, build unified playlists, and enjoy your music from wherever it lives.'),
            // Feature highlights with SVG icons
            React.createElement('div', {
              style: { display: 'flex', flexDirection: 'column', gap: '12px' }
            },
              [
                { icon: React.createElement(Icons.Music, { size: 18 , color: 'var(--accent-primary)' }), text: 'Play from the streaming services you use, your own files, and more' },
                { icon: React.createElement(Icons.Search, { size: 18 , color: 'var(--accent-primary)' }), text: 'Search all your sources at once' },
                { icon: React.createElement(Icons.FileText, { size: 18 , color: 'var(--accent-primary)' }), text: 'Create playlists that span services' },
                { icon: React.createElement(Icons.Users, { size: 18 , color: 'var(--accent-primary)' }), text: 'Connect with friends on Last.fm & ListenBrainz' }
              ].map((item, i) =>
                React.createElement('div', {
                  key: i,
                  style: { display: 'flex', alignItems: 'center', gap: '12px' }
                },
                  React.createElement('div', {
                    style: { width: '32px', height: '32px', borderRadius: '8px', backgroundColor: 'var(--accent-primary-alpha-08)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }
                  }, item.icon),
                  React.createElement('span', {
                    style: { fontSize: '13px', color: 'var(--text-primary)' }
                  }, item.text)
                )
              )
            )
          ),
          // Footer
          React.createElement('div', {
            style: {
              padding: '16px 32px 24px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }
          },
            React.createElement(Button, { variant: 'text', size: 'sm', onClick: async () => {
                await window.electron.store.set('tutorial_completed', true);
                setFirstRunTutorial(prev => ({ ...prev, open: false }));
              } }, 'Skip tutorial'),
            React.createElement(Button, { variant: 'primary', onClick: () => setFirstRunTutorial(prev => ({ ...prev, step: 'sources' })) }, 'Get started')
          )
        ),
firstRunTutorial.step === 'sources' && React.createElement(React.Fragment, null,
          // Accent bar
          React.createElement('div', {
            style: { height: '4px', backgroundColor: 'var(--accent-primary)' }
          }),
          // Header
          React.createElement('div', {
            style: {
              padding: '24px 32px 20px',
              borderBottom: '1px solid var(--border-subtle)'
            }
          },
            React.createElement('h2', {
              style: { fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '4px' }
            }, 'Enable your music sources'),
            React.createElement('p', {
              style: { fontSize: '14px', color: 'var(--text-secondary)' }
            }, 'Turn on the ones you use. You can change them any time in Plug-Ins.')
          ),
          // Content - Resolver cards grid (same design as Settings › Plug-Ins)
          React.createElement('div', {
            style: { padding: '24px 32px' }
          },
            React.createElement('div', {
              style: { display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'center' }
            },
              loadedResolvers.filter(r => r.capabilities?.resolve).map(resolver => {
                const isActive = activeResolvers.includes(resolver.id);
                const logo = SERVICE_LOGOS[resolver.id];
                // Each tile says what the service needs (manifest.requirement,
                // #1387); Local Files can choose its folder right here.
                const needsFolder = resolver.id === 'localfiles' && isActive;
                return React.createElement('div', {
                  key: resolver.id,
                  className: 'flex flex-col items-center',
                  // Four across in the tour's 576px panel.
                  style: { width: '110px' }
                },
                React.createElement('button', { type: 'button', 'aria-pressed': isActive,
                  'aria-describedby': resolver.requirement ? `tour-req-${resolver.id}` : undefined,
                  className: `flex flex-col items-center cursor-pointer transition-[opacity,filter] ${!isActive ? 'opacity-50 grayscale' : ''}`,
                  style: { width: '100%' },
                  onClick: () => {
                    if (isActive) {
                      setActiveResolvers(prev => prev.filter(id => id !== resolver.id));
                      setResolverOrder(prev => prev.filter(id => id !== resolver.id));
                      // Mark as explicitly disabled so reEnableResolver won't restore it
                      if (savedActiveResolversRef.current) {
                        savedActiveResolversRef.current = savedActiveResolversRef.current.filter(id => id !== resolver.id);
                      }
                    } else {
                      setActiveResolvers(prev => appendUniqueId(prev, resolver.id));
                      setResolverOrder(prev => insertInCanonicalOrder(prev, resolver.id));
                      // Mark as explicitly enabled so reEnableResolver can restore it after auth failures
                      if (savedActiveResolversRef.current && !savedActiveResolversRef.current.includes(resolver.id)) {
                        savedActiveResolversRef.current = [...savedActiveResolversRef.current, resolver.id];
                      }
                    }
                  }
                },
                  // Card with colored background
                  React.createElement('div', {
                    style: {
                      width: '64px',
                      height: '64px',
                      borderRadius: '12px',
                      backgroundColor: resolver.color || 'var(--fill-neutral)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: isActive ? 'var(--shadow-popover)' : 'var(--shadow-sm)',
                      marginBottom: '8px'
                    }
                  },
                    // The shared logos are drawn at 64px (w-16); the 64px tile
                    // needs them smaller, or they fill it edge to edge.
                    logo ? React.cloneElement(logo, { className: undefined, style: { ...(logo.props.style || {}), width: '44px', height: '44px' } }) : React.createElement('span', { className: 'text-3xl text-white' }, resolver.icon)
                  ),
                  // Name
                  React.createElement('span', {
                    style: { fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)', textAlign: 'center' }
                  }, resolver.name)
                ),
                resolver.requirement && React.createElement('p', {
                  id: `tour-req-${resolver.id}`,
                  className: 'text-ink-tertiary',
                  style: { fontSize: '11px', lineHeight: 1.4, textAlign: 'center', marginTop: '4px' }
                }, resolver.requirement),
                needsFolder && (watchFolders.length > 0
                  ? React.createElement('span', { className: 'text-ink-secondary', style: { fontSize: '11px', marginTop: '4px' } }, countOf(watchFolders.length, 'folder'))
                  : React.createElement(Button, { variant: 'text', size: 'sm', className: 'mt-1', onClick: () => handleAddWatchFolder() }, 'Choose folder…'))
                );
              })
            )

          ),
          // Footer
          React.createElement('div', {
            style: {
              padding: '16px 32px 20px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center'
            }
          },
            React.createElement(Button, { variant: 'secondary', onClick: () => setFirstRunTutorial(prev => ({ ...prev, step: 'welcome' })) }, React.createElement(Icons.ArrowLeft, { size: 16 }), 'Back'),
            React.createElement(Button, { variant: 'primary', onClick: () => setFirstRunTutorial(prev => ({
              ...prev, step: 'accounts',
              lastfmUsername: prev.lastfmUsername || metaServiceConfigs.lastfm?.username || '',
              listenbrainzUsername: prev.listenbrainzUsername || metaServiceConfigs.listenbrainz?.username || ''
            })) }, 'Continue')
          )
        ),
// Accounts (#1387): the welcome screen promises Last.fm and ListenBrainz;
// this is where you connect them. Optional: Skip goes on. Continue checks
// each name the way the plug-in panels do (connectLastfm /
// connectListenbrainz keep any saved keys or token) and stays on a failure.
firstRunTutorial.step === 'accounts' && (() => {
          const t = firstRunTutorial;
          const setField = (k) => (v) => setFirstRunTutorial(prev => ({ ...prev, [k]: v }));
          const lastfm = metaServiceConfigs.lastfm || {};
          const lb = metaServiceConfigs.listenbrainz || {};
          const next = async () => {
            setFirstRunTutorial(prev => ({ ...prev, connecting: true }));
            let ok = true;
            const lf = t.lastfmUsername.trim();
            if (lf && lf !== (lastfm.username || '')) ok = (await connectLastfm(lf, lastfm.apiKey, lastfm.apiSecret)) !== false && ok;
            const lbn = t.listenbrainzUsername.trim();
            if (ok && lbn && lbn !== (lb.username || '')) ok = (await connectListenbrainz(lbn, lb.userToken)) !== false && ok;
            setFirstRunTutorial(prev => ({ ...prev, connecting: false, step: ok ? 'complete' : prev.step }));
          };
          const field = (id, label, hint, key) => React.createElement('div', { style: { marginBottom: '16px' } },
            React.createElement('label', { htmlFor: id, className: 'text-ink-primary', style: { display: 'block', fontSize: '13px', fontWeight: 500, marginBottom: '6px' } }, label),
            React.createElement(TextField, { id, className: 'w-full', value: t[key], onChange: setField(key), placeholder: 'Username', autoComplete: 'off', spellCheck: false, 'aria-describedby': `${id}-hint` }),
            React.createElement('p', { id: `${id}-hint`, className: 'text-ink-tertiary', style: { fontSize: '12px', marginTop: '4px' } }, hint)
          );
          return React.createElement(React.Fragment, null,
            React.createElement('div', { style: { height: '4px', backgroundColor: 'var(--accent-primary)' } }),
            React.createElement('div', { style: { padding: '24px 32px 20px', borderBottom: '1px solid var(--border-subtle)' } },
              React.createElement('h2', { style: { fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' } }, 'Connect your listening history'),
              React.createElement('p', { style: { fontSize: '14px', color: 'var(--text-secondary)' } }, 'Optional. With your Last.fm or ListenBrainz username, Parachord can recommend music and you can follow friends.')
            ),
            React.createElement('form', {
              style: { padding: '24px 32px 8px' },
              onSubmit: (e) => { e.preventDefault(); if (!t.connecting) next(); }
            },
              field('tour-lastfm', 'Last.fm username', 'Your profile name on last.fm.', 'lastfmUsername'),
              field('tour-listenbrainz', 'ListenBrainz username', 'Your name on listenbrainz.org. Add your user token later in Plug-Ins to save listens there.', 'listenbrainzUsername'),
              React.createElement('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' })
            ),
            React.createElement('div', { style: { padding: '16px 32px 20px', borderTop: '1px solid var(--border-subtle)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
              React.createElement(Button, { variant: 'secondary', onClick: () => setFirstRunTutorial(prev => ({ ...prev, step: 'sources' })) }, 'Back'),
              React.createElement('div', { className: 'flex items-center', style: { gap: '8px' } },
                React.createElement(Button, { variant: 'text', onClick: () => setFirstRunTutorial(prev => ({ ...prev, step: 'complete' })) }, 'Skip'),
                React.createElement(Button, { variant: 'primary', busy: t.connecting, onClick: next }, 'Continue')
              )
            )
          );
        })(),
firstRunTutorial.step === 'complete' && (() => {
          // Anything enabled that plays music (#1387): otherwise "Almost there".
          const tutorialPlayable = loadedResolvers.some(r => r.capabilities?.resolve && playbackResolvers.includes(r.id));
          const finishTutorial = async (where) => {
            // Save tutorial completion and the plug-in choices (refs: no stale closure)
            await window.electron.store.set('tutorial_completed', true);
            await window.electron.store.set('active_resolvers', activeResolversRef.current);
            await window.electron.store.set('resolver_order', resolverOrderRef.current);
            setFirstRunTutorial(prev => ({ ...prev, open: false }));
            if (where === 'plugins') { setSettingsTab('plugins'); navigateTo('settings'); }
            else navigateTo('home');
          };
          return React.createElement(React.Fragment, null,
          // Accent bar
          React.createElement('div', {
            style: { height: '4px', backgroundColor: 'var(--success)' }
          }),
          // Header: done, or almost (nothing that plays is enabled yet)
          React.createElement('div', {
            style: {
              padding: '32px 32px 24px',
              textAlign: 'center',
              borderBottom: '1px solid var(--border-subtle)'
            }
          },
            React.createElement('div', {
              style: {
                width: '56px',
                height: '56px',
                margin: '0 auto 16px',
                borderRadius: '50%',
                backgroundColor: tutorialPlayable ? 'color-mix(in srgb, var(--success) 12%, transparent)' : 'color-mix(in srgb, var(--warning) 12%, transparent)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            },
              React.createElement(tutorialPlayable ? Icons.Check : Icons.AlertTriangle, { size: 28, style: { color: tutorialPlayable ? 'var(--success)' : 'var(--warning)' } })
            ),
            React.createElement('h1', {
              style: { fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }
            }, tutorialPlayable ? 'You’re all set' : 'Almost there'),
            React.createElement('p', {
              style: { fontSize: '14px', color: 'var(--text-secondary)' }
            }, tutorialPlayable
              ? 'Start listening, or open Plug-Ins to sign in, add music folders and more.'
              : 'Nothing that plays music is enabled yet. Open Plug-Ins to enable one.')
          ),
          // Content - Show active sources
          React.createElement('div', {
            style: { padding: '24px 32px' }
          },
            // Active sources summary
            loadedResolvers.filter(r => r.capabilities?.resolve && activeResolvers.includes(r.id)).length > 0 && React.createElement('div', {
              style: { marginBottom: '16px' }
            },
              React.createElement('div', {
                style: { fontSize: '12px', fontWeight: '600', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }
              }, 'Active sources'),
              React.createElement('div', {
                style: { display: 'flex', flexWrap: 'wrap', gap: '8px', justifyContent: 'center' }
              },
                loadedResolvers.filter(r => r.capabilities?.resolve && activeResolvers.includes(r.id)).map(resolver =>
                  // The shared pill (components/badge.js), in the plugin's colour.
                  React.createElement(Badge, { key: resolver.id, color: resolver.color || undefined }, resolver.name)
                )
              )
            ),
            // Info text
            React.createElement('p', {
              style: { fontSize: '13px', color: 'var(--text-secondary)', textAlign: 'center', lineHeight: '1.6' }
            }, 'Plug-Ins is where you sign in to services, add music folders and change what plays first.')
          ),
          // Footer
          React.createElement('div', {
            style: {
              padding: '16px 32px 24px',
              borderTop: '1px solid var(--border-subtle)',
              display: 'flex',
              justifyContent: 'center',
              gap: '12px'
            }
          },
            React.createElement(Button, { variant: 'text', onClick: () => setFirstRunTutorial(prev => ({ ...prev, step: 'accounts' })) }, 'Back'),
            React.createElement(Button, { variant: tutorialPlayable ? 'secondary' : 'primary', onClick: () => finishTutorial('plugins') }, 'Open Plug-Ins'),
            tutorialPlayable && React.createElement(Button, { variant: 'primary', onClick: () => finishTutorial('home') }, 'Start listening')
          )
        );
        })());
});

module.exports = { FirstRunTutorial, FIRST_RUN_TUTORIAL_HANDLERS };
