// src/renderer/components/sync-status-dialog.js: Sync status, the quick
// view from Collection: each syncing service, what it syncs and when it
// last did, with Sync now and Settings (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters and a memo by value, plain functions through useStableHandlers
// (SYNC_STATUS_DIALOG_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was; window is read only inside handlers.

const Icons = require('./icons');
const { Modal } = require('./modal');
const { Button } = require('./button');
const { EmptyState } = require('./states');
const { transition } = require('../lib/motion');

const SYNC_STATUS_DIALOG_HANDLERS = [
  'navigateTo',
  'noteSyncAuth',
];

const SyncStatusDialog = React.memo(function SyncStatusDialog(props) {
  const {
    navigateTo,
    noteSyncAuth,
    resolverSyncSettings,
    setCollectionData,
    setPlaylists,
    setSettingsTab,
    setSyncStatusModal,
    syncProviderConfig,
    syncStatus,
  } = props;
  return React.createElement(Modal, { bare: true, label: "Sync status", scrimClassName: 'z-50', onClose: () => setSyncStatusModal({ open: false }), panelProps: { className: 'relative w-full max-w-md mx-4 overflow-hidden', style: {
          backgroundColor: 'var(--card-bg)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-dialog)'
        } } },
React.createElement('div', {
          className: 'flex items-center justify-between',
          style: { padding: '20px 24px 16px', borderBottom: '1px solid var(--border-subtle)' }
        },
          React.createElement('h2', {
            style: { fontSize: '20px', fontWeight: '600', color: 'var(--text-primary)' }
          }, 'Library Sync'),
          React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': "Close", onClick: () => setSyncStatusModal({ open: false }) }, React.createElement(Icons.X, { className: 'w-5 h-5' }))
        ),
React.createElement('div', {
          style: { padding: '20px 24px' }
        },
          // List enabled sync providers with progress
          React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '16px' } },
            Object.entries(resolverSyncSettings)
              .filter(([_, settings]) => settings.enabled)
              .map(([providerId, settings]) => {
                const status = syncStatus[providerId];
                const isInProgress = status?.inProgress;
                const progress = status?.progress;

                return React.createElement('div', {
                  key: providerId,
                  style: {
                    padding: '14px 16px',
                    backgroundColor: 'var(--hover-bg-default)',
                    borderRadius: '12px',
                    border: '1px solid var(--border-subtle)'
                  }
                },
                  React.createElement('div', {
                    style: { display: 'flex', alignItems: 'center', gap: '12px' }
                  },
                    // Status indicator - animated when syncing
                    React.createElement('div', {
                      className: isInProgress ? 'animate-pulse' : '',
                      style: {
                        width: '10px',
                        height: '10px',
                        borderRadius: '50%',
                        backgroundColor: isInProgress ? 'var(--info)' : 'var(--success)',
                        boxShadow: isInProgress ? '0 0 8px var(--border-info)' : 'none'
                      }
                    }),
                    React.createElement('div', { style: { flex: 1 } },
                      React.createElement('div', {
                        style: { fontSize: '14px', fontWeight: '500', color: 'var(--text-primary)' }
                      }, syncProviderConfig[providerId]?.name || providerId),
                      React.createElement('div', {
                        style: { fontSize: '12px', color: 'var(--text-secondary)', marginTop: '2px' }
                      }, isInProgress
                        ? (progress?.phase === 'tracks' ? `Syncing tracks… ${progress.current || 0}/${progress.total || '?'}` :
                           progress?.phase === 'albums' ? `Syncing albums… ${progress.current || 0}/${progress.total || '?'}` :
                           progress?.phase === 'artists' ? `Syncing artists… ${progress.current || 0}/${progress.total || '?'}` :
                           progress?.phase === 'playlists' ? `Syncing playlists… ${progress.current || 0}/${progress.total || '?'}` :
                           'Syncing…')
                        : 'Last sync: ' + (settings.lastSyncAt
                          ? new Date(settings.lastSyncAt).toLocaleString()
                          : 'Never'))
                    )
                  ),
                  // Progress bar when syncing
                  isInProgress && progress?.total > 0 && React.createElement('div', {
                    style: {
                      height: '4px',
                      backgroundColor: 'var(--border-subtle)',
                      borderRadius: '9999px',
                      overflow: 'hidden',
                      marginTop: '10px',
                      marginLeft: '22px'
                    }
                  },
                    React.createElement('div', {
                      style: {
                        height: '100%',
                        backgroundColor: 'var(--fill-info)',
                        borderRadius: '9999px',
                        transition: transition('width', 'slow', 'out'),
                        width: `${Math.round((progress.current / progress.total) * 100)}%`
                      }
                    })
                  )
                );
              })
          ),

          // No providers message
          Object.keys(resolverSyncSettings).filter(id => resolverSyncSettings[id]?.enabled).length === 0 &&
            React.createElement(EmptyState, { compact: true, title: 'No service syncs yet', body: 'Set up Library sync for a service and it shows here.' }),

          // Message about closing safely - only show when sync is in progress
          Object.values(syncStatus).some(s => s?.inProgress) &&
            React.createElement('div', {
              style: { fontSize: '12px', color: 'var(--text-tertiary)', textAlign: 'center', marginTop: '16px' }
            }, 'Sync continues in the background. Safe to close this window.')
        ),
React.createElement('div', {
          className: 'flex justify-between',
          style: { padding: '16px 24px 20px', borderTop: '1px solid var(--border-subtle)' }
        },
          React.createElement(Button, { variant: 'secondary', onClick: () => {
              setSyncStatusModal({ open: false });
              navigateTo('settings');
              setSettingsTab('plugins');
            } }, 'Manage settings'),
          React.createElement(Button, { variant: 'primary', onClick: async () => {
              let latestCollection = null;
              for (const [providerId, settings] of Object.entries(resolverSyncSettings)) {
                if (settings.enabled) {
                  try {
                    const authStatus = await window.electron.sync.checkAuth(providerId);
                    noteSyncAuth(providerId, authStatus);
                    if (authStatus.authenticated) {
                      // Explicit "Sync Now" button — bypass per-cycle stagger
                      // so the user gets a full sweep (parachord#800).
                      const result = await window.electron.sync.start(providerId, { settings, fullSync: true });
                      if (result.success && result.collection) {
                        latestCollection = result.collection;
                      }
                    }
                  } catch (error) {
                    console.error(`[Sync] Quick sync failed for ${providerId}:`, error);
                  }
                }
              }
              // Update UI with synced collection (guard against incomplete API responses)
              if (latestCollection) {
                const incoming = {
                  tracks: latestCollection.tracks || [],
                  albums: latestCollection.albums || [],
                  artists: latestCollection.artists || []
                };
                setCollectionData(prev => {
                  const netLoss = (prev.tracks?.length || 0) - incoming.tracks.length;
                  const lossRatio = prev.tracks?.length > 0 ? netLoss / prev.tracks.length : 0;
                  if (netLoss > 50 && lossRatio > 0.1) {
                    console.warn(`[Sync] Skipping UI update: sync result has ${incoming.tracks.length} tracks vs current ${prev.tracks?.length || 0} (net loss ${netLoss}, ${Math.round(lossRatio * 100)}%). Likely incomplete API response.`);
                    return prev;
                  }
                  return incoming;
                });
              } else {
                const newCollection = await window.electron.collection.load();
                setCollectionData(newCollection);
              }
              const loadedPlaylists = await window.electron.playlists.load();
              // Preserve in-memory hosted playlists not yet persisted to disk
              setPlaylists(prev => {
                const loadedUrls = new Set(loadedPlaylists.map(p => p.sourceUrl).filter(Boolean));
                const hostedOnly = prev.filter(p => p.sourceUrl && !loadedUrls.has(p.sourceUrl));
                return [...loadedPlaylists, ...hostedOnly];
              });
            }, disabled: Object.values(syncStatus).some(s => s?.inProgress) }, Object.values(syncStatus).some(s => s?.inProgress) ? 'Syncing…' : 'Sync Now')
        ));
});

module.exports = { SyncStatusDialog, SYNC_STATUS_DIALOG_HANDLERS };
