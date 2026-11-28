// src/renderer/components/sync-setup-dialog.js: Set up sync, a service's
// sync dialog: what to sync (tracks, albums, artists, playlists), which
// playlists, and the progress of the first sync (#1451, moved out of
// app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state, a
// setter and a memo by value, plain functions through useStableHandlers
// (SYNC_SETUP_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was; window is read only inside handlers.

const Icons = require('./icons');
const { countOf } = require('../lib/plural');
const { FilterChips } = require('./filter-chips');
const { Modal } = require('./modal');
const { ProgressBar } = require('./progress-bar');
const { Button } = require('./button');
const { Checkbox, SettingRow, Switch } = require('./fields');
const { lovesPausedBySync } = require('../lib/love-providers');

const SYNC_SETUP_DIALOG_HANDLERS = [
  'setLovePushEnabled',
  'setProviderSyncEnabled',
  'startSync',
];

// syncDialogLoves: loves for a service that also syncs a library (#1445,
// app.js): { [id]: { name, words, signedIn, pushOn, signedOutHint } }, from
// lib/love-providers.js loveSyncRows.
const SyncSetupDialog = React.memo(function SyncSetupDialog(props) {
  const {
    resolverSyncSettings,
    syncDialogLoves,
    setLovePushEnabled,
    setProviderSyncEnabled,
    setSyncSetupModal,
    startSync,
    syncProviderConfig,
    syncSetupModal,
  } = props;
  return React.createElement(Modal, { bare: true, label: "Set up sync", scrimClassName: 'z-50', onClose: () => !syncSetupModal.progress && setSyncSetupModal(prev => ({ ...prev, open: false })), panelProps: { className: 'relative w-full max-w-lg mx-4 overflow-hidden', style: {
          backgroundColor: 'var(--card-bg)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-dialog)'
        } } },
React.createElement('div', {
          style: {
            height: '4px',
            background: `linear-gradient(90deg, ${syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)'} 0%, ${syncProviderConfig[syncSetupModal.providerId]?.colorHover || 'var(--accent-fill-hover)'} 100%)`
          }
        }),
React.createElement('div', {
          className: 'flex items-center justify-between',
          style: { padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)' }
        },
          React.createElement('div', { className: 'flex items-center gap-3' },
            React.createElement('div', {
              className: 'w-10 h-10 rounded-xl flex items-center justify-center',
              style: { backgroundColor: syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)' }
            },
              // Provider icon
              syncProviderConfig[syncSetupModal.providerId]?.icon || null
            ),
            React.createElement('div', null,
              React.createElement('h2', {
                style: { fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)' }
              }, syncSetupModal.step === 'complete' ? 'Sync complete' : `Sync your ${syncProviderConfig[syncSetupModal.providerId]?.name || 'music'} library`),
              React.createElement('p', {
                style: { fontSize: '13px', color: 'var(--text-secondary)', marginTop: '2px' }
              },
                syncSetupModal.step === 'options' && 'Choose what to sync',
                syncSetupModal.step === 'playlists' && 'Select playlists to sync',
                syncSetupModal.step === 'syncing' && 'Syncing your library…',
                syncSetupModal.step === 'complete' && 'Your library has been synced'
              )
            )
          ),
          // Close button
          !syncSetupModal.progress && React.createElement(Button, {
            variant: 'icon', 'aria-label': 'Close', 'data-tooltip': 'Close',
            onClick: () => setSyncSetupModal(prev => ({ ...prev, open: false })),
          },
            React.createElement(Icons.X, { className: 'w-5 h-5' })
          )
        ),
React.createElement('div', {
          className: 'scrollable-content',
          style: { padding: '20px 24px', maxHeight: '400px', overflowY: 'auto' }
        },
          // Error message
          syncSetupModal.error && React.createElement('div', {
            style: {
              marginBottom: '16px',
              padding: '12px 16px',
              backgroundColor: 'var(--tint-danger)',
              border: '1px solid var(--border-danger)',
              borderRadius: '10px',
              fontSize: '13px',
              color: 'var(--text-danger)'
            }
          }, syncSetupModal.error),

          // Options step
          syncSetupModal.step === 'options' && React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '10px' }
          },
            (() => {
              const providerCaps = syncProviderConfig[syncSetupModal.providerId]?.capabilities || {};
              const providerColor = syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)';
              return [
                { key: 'syncPlaylists', cap: 'playlists', label: 'Playlists', desc: 'Select which playlists to sync' },
                { key: 'syncTracks', cap: 'tracks', label: 'Liked Songs', desc: 'Your saved tracks' },
                { key: 'syncAlbums', cap: 'albums', label: 'Saved Albums', desc: 'Albums in your library' },
                { key: 'syncArtists', cap: 'artists', label: 'Followed Artists', desc: 'Artists you follow' }
              ].filter(option => providerCaps[option.cap] !== false)
              .map(option =>
                React.createElement('label', {
                  key: option.key,
                  className: 'flex items-center gap-3 cursor-pointer transition-colors',
                  style: {
                    padding: '14px 16px',
                    backgroundColor: syncSetupModal.settings[option.key] ? `color-mix(in srgb, ${providerColor} 6%, transparent)` : 'var(--hover-bg-default)',
                    borderRadius: '12px',
                    border: syncSetupModal.settings[option.key] ? `1px solid color-mix(in srgb, ${providerColor} 30%, transparent)` : '1px solid var(--border-subtle)'
                  }
                },
                  React.createElement(Checkbox, {
                    size: 'md',
                    color: providerColor,
                    checked: syncSetupModal.settings[option.key],
                    onChange: (checked) => setSyncSetupModal(prev => ({
                      ...prev,
                      settings: { ...prev.settings, [option.key]: checked }
                    }))
                  }),
                  React.createElement('div', null,
                    React.createElement('div', { style: { fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' } }, option.label),
                    React.createElement('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' } }, option.desc)
                  )
                )
              );
            })()
          ),

          // Loved tracks (#1445): the service's "Push loves to X", the same
          // setting as in its plug-in settings. It applies at once (it isn't
          // part of what Start sync saves), and a paused sync pauses it too.
          syncSetupModal.step === 'options' && syncDialogLoves && syncDialogLoves[syncSetupModal.providerId] && (() => {
            const loves = syncDialogLoves[syncSetupModal.providerId];
            const pausedSync = lovesPausedBySync(resolverSyncSettings[syncSetupModal.providerId]);
            const noun = loves.words.tracksNoun;
            const hint = !loves.signedIn ? loves.signedOutHint
              : pausedSync ? `Paused with ${loves.name} sync`
              : `${loves.words.verb} it on ${loves.name} when you love it here`;
            return React.createElement('div', {
              'data-section': 'sync-loves',
              style: { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' }
            },
              React.createElement(SettingRow, { label: noun.charAt(0).toUpperCase() + noun.slice(1), hint, style: { padding: 0 } },
                React.createElement(Switch, {
                  checked: loves.signedIn && loves.pushOn,
                  disabled: !loves.signedIn,
                  onToggle: (v) => setLovePushEnabled(syncSetupModal.providerId, v),
                  'aria-label': `Push ${loves.words.plural} to ${loves.name}`,
                })));
          })(),

          // Playlists step
          syncSetupModal.step === 'playlists' && React.createElement('div', {
            style: { display: 'flex', flexDirection: 'column', gap: '12px' }
          },
            syncSetupModal.playlists.length === 0
              ? React.createElement('div', {
                  style: { display: 'flex', flexDirection: 'column', gap: '4px', padding: '4px 0' }
                },
                  Array.from({ length: 6 }, (_, i) =>
                    React.createElement('div', {
                      key: `pl-skel-${i}`,
                      style: { display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px' }
                    },
                      // Checkbox placeholder
                      React.createElement('div', {
                        className: 'rounded shimmer-strong animate-shimmer',
                        style: { width: '16px', height: '16px', flexShrink: 0, backgroundSize: '200% 100%' }
                      }),
                      // Image placeholder
                      React.createElement('div', {
                        className: 'rounded-md shimmer-strong animate-shimmer',
                        style: { width: '40px', height: '40px', flexShrink: 0, backgroundSize: '200% 100%' }
                      }),
                      // Text lines
                      React.createElement('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' } },
                        React.createElement('div', {
                          className: 'rounded shimmer-strong animate-shimmer',
                          style: { height: '14px', width: `${55 + (i * 17) % 35}%`, backgroundSize: '200% 100%' }
                        }),
                        React.createElement('div', {
                          className: 'rounded shimmer-strong animate-shimmer',
                          style: { height: '12px', width: '80px', backgroundSize: '200% 100%' }
                        })
                      )
                    )
                  )
                )
              : React.createElement(React.Fragment, null,
                  // Which playlists: the shared pick-one chips (components/filter-chips.js)
                  React.createElement('div', { style: { marginBottom: '4px' } },
                    React.createElement(FilterChips, {
                      label: 'Show playlists',
                      chips: [
                        { id: 'all', label: 'All' },
                        { id: 'owned', label: 'Created by me' },
                        { id: 'following', label: 'Following' }
                      ],
                      value: syncSetupModal.playlistFilter,
                      onChange: (id) => setSyncSetupModal(prev => ({ ...prev, playlistFilter: id }))
                    })
                  ),
                  // Select all / deselect all for current filter
                  React.createElement('div', {
                    style: { display: 'flex', justifyContent: 'flex-end', gap: '12px', marginBottom: '4px', padding: '0 12px' }
                  },
                    React.createElement(Button, { variant: 'text', size: 'sm', onClick: () => {
                        const filteredIds = syncSetupModal.playlists
                          .filter(p => syncSetupModal.playlistFilter === 'all' ? true :
                            syncSetupModal.playlistFilter === 'owned' ? p.isOwnedByUser : !p.isOwnedByUser)
                          .map(p => p.externalId);
                        setSyncSetupModal(prev => ({
                          ...prev,
                          selectedPlaylists: [...new Set([...prev.selectedPlaylists, ...filteredIds])]
                        }));
                      } }, 'Select all'),
                    React.createElement(Button, { variant: 'text', size: 'sm', onClick: () => {
                        const filteredIds = new Set(syncSetupModal.playlists
                          .filter(p => syncSetupModal.playlistFilter === 'all' ? true :
                            syncSetupModal.playlistFilter === 'owned' ? p.isOwnedByUser : !p.isOwnedByUser)
                          .map(p => p.externalId));
                        setSyncSetupModal(prev => ({
                          ...prev,
                          selectedPlaylists: prev.selectedPlaylists.filter(id => !filteredIds.has(id))
                        }));
                      } }, 'Deselect all')
                  ),
                  // Playlist list
                  React.createElement('div', {
                    style: { display: 'flex', flexDirection: 'column', gap: '4px', maxHeight: '280px', overflowY: 'auto' }
                  },
                    syncSetupModal.playlists
                      .filter(playlist => {
                        if (syncSetupModal.playlistFilter === 'all') return true;
                        if (syncSetupModal.playlistFilter === 'owned') return playlist.isOwnedByUser;
                        return !playlist.isOwnedByUser;
                      })
                      .map(playlist =>
                        React.createElement('label', {
                          key: playlist.externalId,
                          className: `flex items-center gap-3 cursor-pointer transition-colors ${syncSetupModal.selectedPlaylists.includes(playlist.externalId) ? '' : 'hover:!bg-[var(--hover-bg-default)]'}`,
                          style: {
                            padding: '10px 12px',
                            borderRadius: '10px',
                            backgroundColor: syncSetupModal.selectedPlaylists.includes(playlist.externalId) ? `color-mix(in srgb, ${syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)'} 6%, transparent)` : 'transparent'
                          },
                        },
                          React.createElement(Checkbox, {
                            color: syncProviderConfig[syncSetupModal.providerId]?.color,
                            checked: syncSetupModal.selectedPlaylists.includes(playlist.externalId),
                            onChange: (checked) => {
                              setSyncSetupModal(prev => ({
                                ...prev,
                                selectedPlaylists: checked
                                  ? [...prev.selectedPlaylists, playlist.externalId]
                                  : prev.selectedPlaylists.filter(id => id !== playlist.externalId)
                              }));
                            }
                          }),
                          playlist.image && React.createElement('img', {
                            src: playlist.image,
                            style: { width: '40px', height: '40px', borderRadius: '6px', objectFit: 'cover' },
                            alt: ''
                          }),
                          React.createElement('div', { style: { flex: 1, minWidth: 0 } },
                            React.createElement('div', { style: { fontSize: '14px', color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, playlist.name),
                            React.createElement('div', { style: { fontSize: '12px', color: 'var(--text-tertiary)' } },
                              `${countOf(playlist.trackCount, 'track')}`,
                              !playlist.isOwnedByUser && ' · Following'
                            )
                          )
                        )
                      )
                  ),
                  // Empty state for filter
                  syncSetupModal.playlists.filter(p =>
                    syncSetupModal.playlistFilter === 'all' ? true :
                    syncSetupModal.playlistFilter === 'owned' ? p.isOwnedByUser : !p.isOwnedByUser
                  ).length === 0 && React.createElement('div', {
                    style: { textAlign: 'center', padding: '24px 0', color: 'var(--text-tertiary)', fontSize: '13px' }
                  }, syncSetupModal.playlistFilter === 'owned' ? 'No playlists created by you' : 'No playlists you\'re following')
                ),
            // LB-only opt-in to also auto-create new LB playlists for every
            // local Parachord playlist that doesn't yet have an LB mirror.
            // Default OFF so a fresh LB connection doesn't dump 100+ private
            // playlists onto the user's LB account. Already-linked playlists
            // (with syncedTo.listenbrainz) keep getting update pushes
            // regardless. Spotify/AM don't render this — their behavior is
            // unchanged.
            syncSetupModal.providerId === 'listenbrainz' && React.createElement('label', {
              className: 'flex items-start gap-3 cursor-pointer transition-colors',
              style: {
                marginTop: '8px',
                padding: '14px 16px',
                backgroundColor: syncSetupModal.settings.pushLocalPlaylists ? `color-mix(in srgb, ${syncProviderConfig.listenbrainz?.color || 'var(--accent-fill)'} 6%, transparent)` : 'var(--hover-bg-default)',
                borderRadius: '12px',
                border: syncSetupModal.settings.pushLocalPlaylists ? `1px solid color-mix(in srgb, ${syncProviderConfig.listenbrainz?.color || 'var(--accent-fill)'} 30%, transparent)` : '1px solid var(--border-subtle)'
              }
            },
              React.createElement(Checkbox, {
                size: 'md',
                color: syncProviderConfig.listenbrainz?.color,
                checked: !!syncSetupModal.settings.pushLocalPlaylists,
                onChange: (checked) => setSyncSetupModal(prev => ({
                  ...prev,
                  settings: { ...prev.settings, pushLocalPlaylists: checked }
                })),
                style: { marginTop: '2px' }
              }),
              React.createElement('div', null,
                React.createElement('div', { style: { fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' } }, 'Push my Parachord playlists to ListenBrainz'),
                React.createElement('div', { style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px', lineHeight: '1.4' } },
                  'Creates new LB playlists for any Parachord playlist not already synced. ',
                  'Default off — your existing LB playlists are unaffected, and already-linked playlists still receive updates.'
                )
              )
            )
          ),

          // Syncing step
          syncSetupModal.step === 'syncing' && syncSetupModal.progress && React.createElement('div', {
            style: { padding: '32px 0', textAlign: 'center' }
          },
            // Animated sync icon
            React.createElement('div', {
              style: {
                width: '48px',
                height: '48px',
                margin: '0 auto 16px',
                borderRadius: '50%',
                backgroundColor: `color-mix(in srgb, ${syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)'} 10%, transparent)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            },
              React.createElement(Icons.Spinner, { style: { width: '24px', height: '24px', color: syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)' } })
            ),
            React.createElement('div', {
              style: { fontSize: '16px', fontWeight: '500', color: 'var(--text-primary)' }
            }, syncSetupModal.progress.message),
            syncSetupModal.progress.total > 0 && React.createElement('div', {
              style: { fontSize: '13px', color: 'var(--text-secondary)', marginTop: '4px' }
            }, `${syncSetupModal.progress.current} of ${syncSetupModal.progress.total}`),
            syncSetupModal.progress.total > 0 && React.createElement(ProgressBar, {
              value: syncSetupModal.progress.current, max: syncSetupModal.progress.total,
              color: syncProviderConfig[syncSetupModal.providerId]?.color, label: 'Syncing', style: { marginTop: '16px' },
            })
          ),

          // Complete step
          syncSetupModal.step === 'complete' && syncSetupModal.results && React.createElement('div', {
            style: { padding: '16px 0' }
          },
            // Success icon
            React.createElement('div', {
              style: {
                width: '48px',
                height: '48px',
                margin: '0 auto 20px',
                borderRadius: '50%',
                backgroundColor: `color-mix(in srgb, ${syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)'} 10%, transparent)`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            },
              React.createElement(Icons.Check, { style: { width: '24px', height: '24px', color: syncProviderConfig[syncSetupModal.providerId]?.color || 'var(--accent-fill)' }, strokeWidth: 2.5 })
            ),
            // Results
            React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
              syncSetupModal.results.tracks && React.createElement('div', {
                style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '10px 14px', backgroundColor: 'var(--hover-bg-default)', borderRadius: '8px' }
              },
                React.createElement('span', { style: { color: 'var(--text-secondary)' } }, 'Tracks'),
                React.createElement('span', { style: { color: 'var(--text-primary)', fontWeight: '500' } },
                  `+${syncSetupModal.results.tracks.added} added, -${syncSetupModal.results.tracks.removed} removed`
                )
              ),
              syncSetupModal.results.albums && React.createElement('div', {
                style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '10px 14px', backgroundColor: 'var(--hover-bg-default)', borderRadius: '8px' }
              },
                React.createElement('span', { style: { color: 'var(--text-secondary)' } }, 'Albums'),
                React.createElement('span', { style: { color: 'var(--text-primary)', fontWeight: '500' } },
                  `+${syncSetupModal.results.albums.added} added, -${syncSetupModal.results.albums.removed} removed`
                )
              ),
              syncSetupModal.results.artists && React.createElement('div', {
                style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '10px 14px', backgroundColor: 'var(--hover-bg-default)', borderRadius: '8px' }
              },
                React.createElement('span', { style: { color: 'var(--text-secondary)' } }, 'Artists'),
                React.createElement('span', { style: { color: 'var(--text-primary)', fontWeight: '500' } },
                  `+${syncSetupModal.results.artists.added} added, -${syncSetupModal.results.artists.removed} removed`
                )
              ),
              syncSetupModal.results.playlists && React.createElement('div', {
                style: { display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '10px 14px', backgroundColor: 'var(--hover-bg-default)', borderRadius: '8px' }
              },
                React.createElement('span', { style: { color: 'var(--text-secondary)' } }, 'Playlists'),
                React.createElement('span', { style: { color: 'var(--text-primary)', fontWeight: '500' } },
                  `+${syncSetupModal.results.playlists.added} added` +
                  (syncSetupModal.results.playlists.updated > 0 ? `, ${syncSetupModal.results.playlists.updated} updated` : '')
                )
              )
            )
          )
        ),
React.createElement('div', {
          className: 'flex justify-end gap-3',
          style: { padding: '16px 24px 20px', borderTop: '1px solid var(--border-subtle)' }
        },
          // The footer (the shared Button, in the service's colour). A
          // service that already syncs says Save; with nothing ticked, a new
          // one can't start, and a syncing one offers to turn sync off (the
          // Sync menu's pause: nothing synced is removed).
          ...(() => {
            const pid = syncSetupModal.providerId;
            const syncingNow = !!resolverSyncSettings[pid]?.enabled;
            const st = syncSetupModal.settings || {};
            // Only the options this service offers count: ListenBrainz shows
            // Playlists alone, while its saved tracks/albums/artists flags stay on.
            const caps = syncProviderConfig[pid]?.capabilities || {};
            const chosen = (cap, key) => !!caps[cap] && !!st[key];
            const nothingChosen = !chosen('tracks', 'syncTracks') && !chosen('albums', 'syncAlbums') && !chosen('artists', 'syncArtists') && !chosen('playlists', 'syncPlaylists');
            const fill = syncProviderConfig[pid]?.color || 'var(--accent-fill)';
            const close = () => setSyncSetupModal(prev => ({ ...prev, open: false }));
            if (syncSetupModal.step === 'options') {
              return [
                React.createElement(Button, { key: 'cancel', variant: 'secondary', onClick: close }, 'Cancel'),
                nothingChosen && syncingNow
                  ? React.createElement(Button, { key: 'off', variant: 'primary', pageColor: fill, onClick: () => { setProviderSyncEnabled(pid, false); close(); } }, 'Turn off sync')
                  : React.createElement(Button, {
                      key: 'go', variant: 'primary', pageColor: fill, disabled: nothingChosen,
                      'data-tooltip': nothingChosen ? 'Choose something to sync' : undefined,
                      onClick: async () => {
                if (syncSetupModal.settings.syncPlaylists) {
                  // Load playlists first
                  setSyncSetupModal(prev => ({ ...prev, step: 'playlists', error: null }));
                  const result = await window.electron.sync.fetchPlaylists(syncSetupModal.providerId);
                  if (result.success) {
                    // ListenBrainz imports ALL playlists by default (#911), so
                    // pre-check every fetched playlist EXCEPT already-suppressed
                    // ones — unticking is what EXCLUDES (suppresses) a playlist,
                    // ticking re-includes it. Spotify/AM keep their seeded
                    // (relationship-based) selection.
                    let lbPreselect = null;
                    if (syncSetupModal.providerId === 'listenbrainz') {
                      const suppMap = await window.electron.store.get('suppressed_sync_playlists').catch(() => null);
                      const supp = (suppMap && suppMap.listenbrainz) || [];
                      lbPreselect = (result.playlists || [])
                        .map(p => p.externalId)
                        .filter(id => !supp.includes(id));
                    }
                    setSyncSetupModal(prev => ({
                      ...prev,
                      playlists: result.playlists,
                      folders: result.folders,
                      ...(lbPreselect ? { selectedPlaylists: lbPreselect } : {})
                    }));
                  } else {
                    // Handle failed playlist fetch - show error and go back to options
                    setSyncSetupModal(prev => ({
                      ...prev,
                      step: 'options',
                      error: result.error || 'Failed to load playlists. Please try again.'
                    }));
                  }
                } else {
                  startSync();
                }
              }
                    }, chosen('playlists', 'syncPlaylists') ? 'Next' : (syncingNow ? 'Save' : 'Start sync')),
              ];
            }
            if (syncSetupModal.step === 'playlists') {
              return [
                React.createElement(Button, { key: 'back', variant: 'secondary', onClick: () => setSyncSetupModal(prev => ({ ...prev, step: 'options' })) }, 'Back'),
                React.createElement(Button, { key: 'go', variant: 'primary', pageColor: fill, onClick: startSync }, syncingNow ? 'Save' : 'Start sync'),
              ];
            }
            if (syncSetupModal.step === 'complete') {
              return [React.createElement(Button, { key: 'done', variant: 'primary', pageColor: fill, onClick: close }, 'Done')];
            }
            return [];
          })()
        ));
});

module.exports = { SyncSetupDialog, SYNC_SETUP_DIALOG_HANDLERS };
