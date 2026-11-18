// src/renderer/components/plugin-settings-dialog.js: a plug-in's settings
// dialog, opened from its tile in Settings › Plug-Ins: its sign-in or keys,
// its options (quality, models, scrobbling, sync), enable and remove
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters, refs, memos, callbacks and playback-hook values by value, plain
// functions through useStableHandlers (PLUGIN_SETTINGS_DIALOG_HANDLERS,
// pinned by tests/renderer/page-memo.test.js). authPort is derived here
// from authServerStatus. The markup moved as it was; window is read only
// inside handlers.

const Icons = require('./icons');
const PlaybackLimits = require('../lib/playback-limits');
const { countOf } = require('../lib/plural');
const { timeAgo } = require('../lib/time-ago');
const { SERVICE_LOGOS } = require('./brand-logos');
const { ScrobblerSettingsCard, PluginSettingsPanel } = require('./settings-cards');
const { capabilityLabel, visibleCapabilities } = require('../lib/capability-labels');
const { Modal } = require('./modal');
const { Badge } = require('./badge');
const { Button } = require('./button');
const { NestedSettings, SecretField, Select, SettingRow, Switch, TextField } = require('./fields');
const { pluginSwitchState, metadataSwitchState, playbackSwitchState, recommendationsSwitchState, keyLabel } = require('../lib/plugin-switch');
const { librarySyncState } = require('../lib/library-sync-state');
const { ProgressBar } = require('./progress-bar');
const { AccountRow } = require('./account-row');
const { Disclosure } = require('./disclosure');
const { EmptyState, ErrorState } = require('./states');

const PLUGIN_SETTINGS_DIALOG_HANDLERS = [
  'connectAppleMusic',
  'connectLastfm',
  'connectListenbrainz',
  'connectSoundcloud',
  'connectSpotify',
  'disconnectAppleMusic',
  'disconnectLastfm',
  'disconnectListenbrainz',
  'disconnectSoundcloud',
  'disconnectSpotify',
  'fetchDynamicModels',
  'getServiceColor',
  'handleAddWatchFolder',
  'handleInstallFromMarketplace',
  'handleRemoveMissingFiles',
  'handleRemoveWatchFolder',
  'handleRescanAll',
  'handleRescanFolder',
  'handleUninstallResolver',
  'manageAmazonMusic',
  'openSyncSetupModal',
  'refreshPluginStatus',
  'saveAppleMusicDeveloperToken',
  'clearMetaServiceConfig',
  'saveMetaServiceConfig',
  'saveSoundcloudCredentials',
  'saveSpotifyCredentials',
  'setProviderSyncEnabled',
  'setResolverMetadataOn',
  'setResolverPlaybackOn',
  'setResolverRecommendationsOn',
  'showConfirmDialog',
  'toggleResolver',
];

const SYNC_BLOCK = { marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-subtle)' };

const PluginSettingsDialog = React.memo(function PluginSettingsDialog(props) {
  const {
    activeResolvers,
    allResolvers,
    appleMusicAdvancedOpen,
    appleMusicConnected,
    appleMusicDeveloperToken,
    appleMusicNativeAvailable,
    appleMusicTokenSaved,
    audioRef,
    authServerStatus,
    autoLaunchSpotify,
    collectionData,
    collectionDataRef,
    connectAppleMusic,
    connectLastfm,
    connectListenbrainz,
    connectSoundcloud,
    connectSpotify,
    currentTrackRef,
    disconnectAppleMusic,
    disconnectLastfm,
    disconnectListenbrainz,
    disconnectSoundcloud,
    disconnectSpotify,
    dynamicModelOptions,
    fetchDynamicModels,
    getServiceColor,
    handleAddWatchFolder,
    handleInstallFromMarketplace,
    handleRemoveMissingFiles,
    handleRemoveWatchFolder,
    handleRescanAll,
    handleRescanFolder,
    handleUninstallResolver,
    installingResolvers,
    isScanning,
    lastfmAdvancedOpen,
    lastfmApiKeyInput,
    lastfmApiSecretInput,
    lastfmConnecting,
    lastfmUsernameInput,
    listenbrainzAdvancedOpen,
    listenbrainzConnecting,
    listenbrainzTokenInput,
    listenbrainzUsernameInput,
    localFilesStats,
    loveBackfillProgress,
    loveBackfillRunning,
    loveImportCursorRef,
    loveImportProgress,
    loveImportRunning,
    lovePushedKeysRef,
    manageAmazonMusic,
    marketplaceManifest,
    metaServiceConfigs,
    metaServices,
    openSyncSetupModal,
    pluginStatuses,
    refreshPluginStatus,
    setProviderSyncEnabled,
    setResolverMetadataOn,
    setResolverPlaybackOn,
    setResolverRecommendationsOn,
    playbackLimits,
    playbackOffResolvers,
    recommendationsOffResolvers,
    metadataOffResolvers,
    resolverConfigCache,
    resolverLoaderRef,
    resolverSyncSettings,
    syncSignedOut,
    runLoveBackfill,
    runLoveImport,
    saveAppleMusicDeveloperToken,
    clearMetaServiceConfig,
    saveMetaServiceConfig,
    saveSoundcloudCredentials,
    saveSpotifyCredentials,
    scanProgress,
    scrobblerConfigs,
    scrobblerLovePushEnabled,
    selectedResolver,
    setAppleMusicAdvancedOpen,
    setAppleMusicDeveloperToken,
    setAutoLaunchSpotify,
    setIsPlaying,
    setLastfmAdvancedOpen,
    setLastfmApiKeyInput,
    setLastfmApiSecretInput,
    setLastfmUsernameInput,
    setListenbrainzAdvancedOpen,
    setListenbrainzTokenInput,
    setListenbrainzUsernameInput,
    setLovePushEnabled,
    setScrobblerConfigs,
    setSelectedResolver,
    setSoundcloudAdvancedOpen,
    setSoundcloudClientIdInput,
    setSoundcloudClientSecretInput,
    setSoundcloudCredentialsSource,
    setSpotifyAdvancedOpen,
    setSpotifyClientIdInput,
    setStopSyncDialog,
    showToast,
    soundcloudAdvancedOpen,
    soundcloudClientIdInput,
    soundcloudClientSecretInput,
    soundcloudConnected,
    soundcloudCredentialsSource,
    spotifyAdvancedOpen,
    spotifyClientIdInput,
    spotifyConnected,
    spotifyCredentialsSource,
    showConfirmDialog,
    toggleResolver,
    watchFolders,
  } = props;
  // The bound local server port (main-process/auth-port.js), 8888 until known.
  const authPort = authServerStatus?.port || 8888;
  // Library sync: one piece, placed under the account it needs in each
  // service's section (a sync can't run signed out), above that section's
  // Advanced settings. lib/library-sync-state.js says what it's doing: a
  // paused sync used to offer "Set up", and a lapsed sign-in read "Active".
  // Scrobbling, nested under "Enable X" for a plug-in that does more than
  // scrobble (Last.fm, ListenBrainz): the one part that needs a sign-in, so
  // its sign-in, its switch and the loved-tracks controls sit together, and
  // "Enable X" can be on (recommendations, history) while it's signed out.
  // A scrobbling-only plug-in (Libre.fm) draws the card as its account.
  const renderScrobbling = (id) => {
    const scrobbler = window.scrobblers && window.scrobblers.find(s => s.id === id);
    if (!scrobbler) return null;
    return React.createElement(ScrobblerSettingsCard, {
      scrobbler, color: getServiceColor(id) || selectedResolver.color, accountLabel: 'Scrobbling',
      lovedTracks: !!selectedResolver.capabilities?.lovedTracks,
      config: scrobblerConfigs[id],
      onConfigChange: (sid, newConfig) => { setScrobblerConfigs(prev => ({ ...prev, [sid]: newConfig })); },
      lovePushEnabled: !!scrobblerLovePushEnabled[id],
      onSetLovePushEnabled: (v) => setLovePushEnabled(id, v),
      onRunBackfill: () => runLoveBackfill(id),
      backfillRunning: !!loveBackfillRunning[id],
      backfillProgress: loveBackfillProgress[id],
      unpushedCount: (collectionDataRef.current?.tracks || collectionData.tracks).filter(t => !lovePushedKeysRef.current[t.id]?.[id]).length,
      onRunLoveImport: () => runLoveImport(id),
      loveImportRunning: !!loveImportRunning[id],
      loveImportProgress: loveImportProgress[id],
      hasImportedLoves: !!loveImportCursorRef.current?.[id],
    });
  };

  const renderLibrarySync = () => {
              const id = selectedResolver.id;
              const settings = resolverSyncSettings[id];
              const state = librarySyncState(settings, syncSignedOut && syncSignedOut[id]);
              if (state === 'setup') {
                return React.createElement('div', { style: SYNC_BLOCK }, React.createElement(SettingRow, { label: 'Sync your library', hint: 'Bring your saved music and playlists into your Collection', style: { padding: 0 } },
                  React.createElement(Button, { variant: 'secondary', onClick: () => openSyncSetupModal(id), 'aria-label': 'Set up library sync' }, 'Set up')));
              }
              const last = settings?.lastSyncAt ? `Last synced ${new Date(settings.lastSyncAt).toLocaleString()}` : 'Not synced yet';
              const hint = state === 'paused' ? `Paused. Your synced music stays. ${last}`
                : state === 'signed-out' ? 'Signed out. Sign in above to sync again.'
                : last;
              return React.createElement('div', { style: { ...SYNC_BLOCK, display: 'flex', flexDirection: 'column', gap: '12px' } },
                React.createElement(SettingRow, { label: 'Sync your library', hint, style: { padding: 0 } },
                  React.createElement(Switch, {
                    // On only while it syncs, as the Collection's Sync menu
                    // shows it; turning a signed-out one on asks for the sign-in.
                    checked: state === 'active',
                    onToggle: () => setProviderSyncEnabled(id, state !== 'active'),
                    'aria-label': 'Sync your library',
                  })),
                React.createElement('div', { style: { display: 'flex', gap: '8px' } },
                  React.createElement(Button, { variant: 'secondary', onClick: () => openSyncSetupModal(id) }, 'Manage sync'),
                  // Ends sync for good (the switch above pauses it); works signed out,
                  // so a service can be dropped without signing in again.
                  React.createElement(Button, { variant: 'quietDestructive', onClick: () => setStopSyncDialog({ open: true, providerId: id }) }, 'Remove sync…')));
  };

  return React.createElement(Modal, { bare: true, label: "Plugin settings", scrimClassName: 'z-50', onClose: () => { setSelectedResolver(null); }, panelProps: { style: {
          backgroundColor: 'var(--card-bg)',
          borderRadius: '16px',
          boxShadow: 'var(--shadow-panel)',
          maxWidth: '440px',
          width: '100%',
          margin: '0 16px',
          overflow: 'hidden'
        } } },
React.createElement('div', {
          className: 'flex items-center gap-4',
          style: {
            padding: '24px',
            backgroundColor: selectedResolver.color || 'var(--fill-neutral)'
          }
        },
          // Logo
          React.createElement('div', {
            className: 'flex items-center justify-center',
            style: { width: '56px', height: '56px' }
          }, SERVICE_LOGOS[selectedResolver.id] || React.createElement('span', { style: { fontSize: '28px' } }, selectedResolver.icon)),
          // Name and version
          React.createElement('div', { className: 'flex-1' },
            React.createElement('div', { className: 'flex items-center gap-2' },
              React.createElement('h2', {
                style: {
                  fontSize: '20px',
                  fontWeight: '600',
                  color: 'var(--on-accent)'
                }
              }, selectedResolver.name),
              selectedResolver.version && React.createElement('span', {
                style: {
                  padding: '2px 8px',
                  backgroundColor: 'var(--on-color-fill)',
                  borderRadius: '4px',
                  fontSize: '11px',
                  color: 'var(--on-accent)'
                }
              }, 'v', selectedResolver.version)
            ),
            React.createElement('p', {
              style: {
                fontSize: '13px',
                color: 'var(--on-color-secondary)',
                marginTop: '4px'
              }
            }, selectedResolver.author || 'Parachord Team')
          ),
          // Close button
          React.createElement('button', {
            type: 'button',
            'aria-label': 'Close',
            onClick: () => setSelectedResolver(null),
            className: 'flex items-center justify-center transition-colors',
            style: {
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              backgroundColor: 'var(--on-color-fill)',
              border: 'none',
              color: 'var(--on-accent)',
              cursor: 'pointer',
              fontSize: '14px'
            }
          }, React.createElement(Icons.X, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } }))
        ),
React.createElement('div', {
          className: 'scrollable-content',
          style: {
            padding: '24px',
            maxHeight: '60vh',
            overflowY: 'auto'
          }
        },
          // Description
          React.createElement('p', {
            style: {
              fontSize: '13px',
              color: 'var(--text-secondary)',
              lineHeight: '1.6',
              marginBottom: selectedResolver.requirement ? '8px' : '24px'
            }
          }, selectedResolver.description),
          // What it needs (manifest.requirement, #1387): a sign-in, a
          // subscription, a developer key, or nothing.
          selectedResolver.requirement && React.createElement('p', {
            className: 'text-ink-primary',
            style: { fontSize: '13px', lineHeight: '1.6', marginBottom: '24px' }
          }, selectedResolver.requirement),

          // Capabilities: the ones a listener chooses a plug-in for
          // (visibleCapabilities hides the internal ones), and none at all
          // when nothing's left to show.
          visibleCapabilities(selectedResolver.capabilities).length > 0 && React.createElement('div', { style: { marginBottom: '24px' } },
            React.createElement('h3', {
              style: {
                fontSize: '11px',
                fontWeight: '600',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
                marginBottom: '12px'
              }
            }, 'Capabilities'),
            React.createElement('div', { className: 'flex flex-wrap gap-2' },
              visibleCapabilities(selectedResolver.capabilities).map((cap) =>
                // The shared pill and the one label helper (lib/capability-labels.js).
                React.createElement(Badge, { key: cap, tone: 'accent' }, capabilityLabel(cap)))
            )
          ),

          // On/off: the ONE control that turns a plug-in on (#1498 step 2;
          // lib/plugin-switch.js says what it shows for each kind of
          // plug-in). It replaced the music plug-ins' "Use X" switch, the
          // footer's Enable/Done button and the body "Enable X" switches. A
          // plug-in that can't run without a key shows it disabled, saying
          // what to add first.
          (() => {
            const id = selectedResolver.id;
            const state = pluginSwitchState({ plugin: selectedResolver, config: metaServiceConfigs[id], activeResolvers });
            const caps = selectedResolver.capabilities || {};
            const scrobblingNested = state.checked && !!caps.scrobbling && !!caps.recommendations;
            const meta = metadataSwitchState({ plugin: selectedResolver, active: state.checked, metadataOff: (metadataOffResolvers || []).includes(id) });
            const recs = recommendationsSwitchState({ plugin: selectedResolver, active: state.checked, recommendationsOff: (recommendationsOffResolvers || []).includes(id) });
            const play = playbackSwitchState({ plugin: selectedResolver, active: state.checked, playbackOff: (playbackOffResolvers || []).includes(id), limit: playbackLimits && playbackLimits[id] });
            const setOn = async (next) => {
              if (next) {
                const isLoaded = allResolvers.some(r => r.id === id) || metaServices.some(s => s.id === id);
                if (!isLoaded) {
                  // Not downloaded (a marketplace plug-in), or removed before:
                  // take it off the removed list and install it now.
                  const uninstalled = await window.electron.store.get('uninstalled_resolvers') || [];
                  if (uninstalled.includes(id)) await window.electron.store.set('uninstalled_resolvers', uninstalled.filter(x => x !== id));
                  const marketplaceItem = (marketplaceManifest?.plugins || []).find(r => r.id === id);
                  if (marketplaceItem) await handleInstallFromMarketplace(marketplaceItem);
                  // Installing a music plug-in also turns it on (it joins the
                  // active list). Toggling it here as well would read the
                  // active list from before the install and switch it straight
                  // back off.
                  if (selectedResolver.type !== 'meta-service') return;
                }
              }
              if (selectedResolver.type === 'meta-service') {
                saveMetaServiceConfig(id, { ...metaServiceConfigs[id], enabled: next });
              } else if (next !== activeResolvers.includes(id)) {
                toggleResolver(id);
              }
            };
            return React.createElement('div', { style: { padding: '16px 0', borderTop: '1px solid var(--border-subtle)' } },
              React.createElement(SettingRow, {
                label: `Enable ${selectedResolver.name}`,
                hint: state.hint || undefined,
                style: { padding: 0 },
              }, React.createElement(Switch, { checked: state.checked, disabled: state.disabled, onToggle: () => setOn(!state.checked) })),
              // "Play from X" under it, while it's on (#1505): off keeps it for
              // search, covers and links and takes it out of the priority
              // order; a plan that can't play locks it off, saying why.
              play.shown && React.createElement(SettingRow, {
                label: `Play from ${selectedResolver.name}`,
                hint: play.hint,
                nested: true,
                style: { padding: '6px 0', marginTop: '12px' },
              }, React.createElement(Switch, { size: 'sm', checked: play.checked, disabled: play.disabled, onToggle: () => setResolverPlaybackOn(id, !play.checked) })),
              // "Use metadata from X": covers and artist photos (#1505).
              meta.shown && React.createElement(SettingRow, {
                label: `Use metadata from ${selectedResolver.name}`,
                hint: meta.hint,
                nested: true,
                style: { padding: '6px 0' },
              }, React.createElement(Switch, { size: 'sm', checked: meta.checked, onToggle: () => setResolverMetadataOn(id, !meta.checked) })),
              // "Use recommendations from X", for a plug-in that offers them (#1505).
              recs.shown && React.createElement(SettingRow, {
                label: `Use recommendations from ${selectedResolver.name}`,
                hint: recs.hint,
                nested: true,
                style: { padding: '6px 0', marginTop: (play.shown || meta.shown) ? '0' : '12px' },
              }, React.createElement(Switch, { size: 'sm', checked: recs.checked, onToggle: () => setResolverRecommendationsOn(id, !recs.checked) })),
              // Scrobbling, for a plug-in that does more than scrobble.
              scrobblingNested && React.createElement(NestedSettings, { style: { marginTop: '12px' } }, renderScrobbling(id)));
          })(),

          // A status-capable plugin's sign-in row (capabilities.status, the
          // generic surface of #1356): the plugin's own getStatus reply —
          // label plus message — and, when the plugin implements the session
          // methods (signIn/signOut — the web-session surface), the buttons
          // that trigger them. Amazon rides this row since M10: its reply
          // says 'Setup required' when signed out, and its signIn opens the
          // window through the plugin's own prompt flow.
          selectedResolver?.capabilities?.status && typeof selectedResolver.getStatus === 'function' && (() => {
            const row = PlaybackLimits.pluginStatusRow(pluginStatuses[selectedResolver.id]);
            const status = pluginStatuses[selectedResolver.id];
            const signedIn = !!(status && status.signedIn === true);
            const canSignOut = signedIn && typeof selectedResolver.signOut === 'function';
            const canSignIn = !signedIn && typeof selectedResolver.signIn === 'function';
            // The account row (components/account-row.js, #1498 step 3): the
            // plugin's own getStatus label and message as its status line.
            return React.createElement('div', {
              style: {
                padding: '16px 0',
                borderTop: '1px solid var(--border-subtle)'
              }
            },
              React.createElement(AccountRow, {
                name: selectedResolver.name,
                color: getServiceColor(selectedResolver.id) || selectedResolver.color,
                signedIn,
                status: row.message ? `${row.label} · ${row.message}` : row.label,
                onSignOut: canSignOut ? async () => {
                    // Stop the shared engine BEFORE the session dies — the
                    // shaka session (license + buffered signed URLs) must not
                    // keep playing a signed-out account's content, and the
                    // plugin's final telemetry accounting needs a live session
                    // for the last trackStreamed pair.
                    if (window.__parachordWidevine && typeof window.__parachordWidevine.stop === 'function') {
                      await window.__parachordWidevine.stop().catch(() => {});
                      if (audioRef.current && currentTrackRef.current?._activeResolver === selectedResolver.id) {
                        setIsPlaying(false);
                      }
                    }
                    // Plan blocks are account-scoped (the FLAC/HD and
                    // spatial/ec-3 KID-group latches). The next sign-in may
                    // be an account that clears either; don't keep the
                    // refused families off.
                    if (window.__parachordWidevine && typeof window.__parachordWidevine.clearPlanBlocks === 'function') {
                      window.__parachordWidevine.clearPlanBlocks();
                    }
                    const r = await selectedResolver.signOut();
                    if (r && r.success) {
                      showToast(`Signed out of ${selectedResolver.name}`, 'success');
                      refreshPluginStatus(selectedResolver.id);
                    } else {
                      showToast((r && r.error) || `Could not sign out of ${selectedResolver.name}`, 'error');
                    }
                  } : undefined,
                onSignIn: canSignIn ? async () => {
                    // Amazon's sign-in carries its own prompt flow (the
                    // consent dialog, single-flight, the 10-minute quiet
                    // after a decline, the hiccup retry); every other plugin's
                    // signIn is the window itself.
                    //
                    // TODO(#1440 review, note 3 — before a second web-session
                    // plugin): this branch on the service name, the tile
                    // badge's `resolver.id === 'amazonmusic'` needsConfiguration
                    // arm and manageAmazonMusic's getResolver('amazonmusic')
                    // are the generic surfaces that still branch on
                    // 'amazonmusic' — the prompt flow is Amazon's UX today, but
                    // a second web-session plugin must not copy the pattern;
                    // the follow-up is a generic prompt-flow seam (the
                    // plugin's own prompt decision, like signInPromptDecision)
                    // so the row, the tile and the prompt read the plugin's
                    // capabilities, never the id.
                    if (selectedResolver.id === 'amazonmusic') {
                      await manageAmazonMusic({ explicit: true, reason: 'not-signed-in', forcePrompt: true });
                      return; // the flow refreshes the status itself
                    }
                    await selectedResolver.signIn().catch(() => null);
                    refreshPluginStatus(selectedResolver.id);
                  } : undefined,
              }));
          })(),

          // Authentication section (for services that require it)
          selectedResolver.id === 'spotify' && React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            // The account (components/account-row.js, #1498 step 3).
            React.createElement(AccountRow, {
              name: 'Spotify', color: getServiceColor('spotify'), signedIn: spotifyConnected,
              status: spotifyConnected ? 'Signed in' : 'Sign in to play from Spotify',
              onSignIn: connectSpotify, onSignOut: disconnectSpotify,
            }),
            // Spotify API credentials — BYOK required
            !spotifyConnected && React.createElement('div', {
              style: {
                marginTop: '16px',
                padding: '12px',
                backgroundColor: 'var(--hover-bg-default)',
                borderRadius: '8px'
              }
            },
              spotifyCredentialsSource === 'env'
                ? React.createElement('p', {
                    style: { fontSize: '11px', color: 'var(--text-success)', marginBottom: '8px', lineHeight: '1.5' }
                  }, 'Using Client ID from environment variable.')
                : React.createElement('p', {
                    style: { fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px', lineHeight: '1.5' }
                  },
                    'Spotify requires your own API credentials. Create a free app at ',
                    React.createElement('a', {
                      href: '#',
                      onClick: (e) => { e.preventDefault(); window.electron?.openExternal?.('https://developer.spotify.com/dashboard') || window.open('https://developer.spotify.com/dashboard', '_blank'); },
                      style: { color: getServiceColor('spotify') || 'var(--accent-primary)', textDecoration: 'underline' }
                    }, 'developer.spotify.com/dashboard'),
                    // Since February 2026 a Development Mode app works only
                    // while its owner has Premium, and every Parachord sign-in
                    // is one (docs/architecture/playback.md).
                    ' to get your Client ID. The Spotify account that creates the app needs Spotify Premium, and the app stops working if that Premium lapses.'
                  ),
              // Setup steps (only shown when no key configured)
              spotifyCredentialsSource === 'none' && React.createElement('div', {
                style: {
                  fontSize: '11px',
                  color: 'var(--text-secondary)',
                  marginBottom: '12px',
                  lineHeight: '1.6',
                  paddingLeft: '4px'
                }
              },
                React.createElement('div', null, '1. Create a new app (name it anything)'),
                React.createElement('div', null, '2. Add both Redirect URIs:'),
                React.createElement('div', { style: { paddingLeft: '12px', marginTop: '2px', marginBottom: '2px' } },
                  React.createElement('code', {
                    onClick: () => { navigator.clipboard.writeText(`http://127.0.0.1:${authPort}/callback`); showToast('Copied to clipboard', 'success'); },
                    title: 'Click to copy',
                    style: { cursor: 'pointer', backgroundColor: 'var(--hover-bg-default)', padding: '1px 4px', borderRadius: '4px', display: 'inline-block', marginBottom: '2px', userSelect: 'all' }
                  }, `http://127.0.0.1:${authPort}/callback`),
                  React.createElement('br'),
                  React.createElement('code', {
                    onClick: () => { navigator.clipboard.writeText(`http://[::1]:${authPort}/callback`); showToast('Copied to clipboard', 'success'); },
                    title: 'Click to copy',
                    style: { cursor: 'pointer', backgroundColor: 'var(--hover-bg-default)', padding: '1px 4px', borderRadius: '4px', display: 'inline-block', userSelect: 'all' }
                  }, `http://[::1]:${authPort}/callback`)
                ),
                // Without Web Playback SDK ticked, play commands can fail with
                // 403 "Restriction violated" (parachord#985).
                React.createElement('div', null, '3. Under "APIs used", tick both Web API and Web Playback SDK'),
                React.createElement('div', null, '4. Copy your Client ID and paste it below')
              ),
              // Client ID input
              React.createElement('div', { style: { marginBottom: '10px' } },
                React.createElement('label', {
                  style: { fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }
                }, 'Client ID'),
                React.createElement(SecretField, { value: spotifyClientIdInput, onChange: (_v, e) => setSpotifyClientIdInput(e.target.value), placeholder: 'Paste your Spotify Client ID here', 'aria-label': 'Paste your Spotify Client ID here', className: 'w-full' })
              ),
              // Redirect URIs (always visible for reference)
              React.createElement('div', { style: { marginBottom: '12px' } },
                React.createElement('label', {
                  style: { fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }
                }, 'Redirect URIs'),
                React.createElement('div', { style: { display: 'flex', gap: '6px', marginBottom: '6px' } },
                  React.createElement(TextField, { 'aria-label': 'Redirect URI (IPv4)', value: `http://127.0.0.1:${authPort}/callback`, readOnly: true, className: 'flex-1' }),
                  React.createElement(Button, { variant: 'secondary', 'aria-label': 'Copy redirect URI', title: 'Copy', onClick: () => {
                      navigator.clipboard.writeText(`http://127.0.0.1:${authPort}/callback`);
                      showToast('Copied to clipboard', 'success');
                    } },
  React.createElement(Icons.Copy, { className: 'w-4 h-4' }))
                ),
                React.createElement('div', { style: { display: 'flex', gap: '6px' } },
                  React.createElement(TextField, { 'aria-label': 'Redirect URI (IPv6)', value: `http://[::1]:${authPort}/callback`, readOnly: true, className: 'flex-1' }),
                  React.createElement(Button, { variant: 'secondary', 'aria-label': 'Copy redirect URI', title: 'Copy', onClick: () => {
                      navigator.clipboard.writeText(`http://[::1]:${authPort}/callback`);
                      showToast('Copied to clipboard', 'success');
                    } },
  React.createElement(Icons.Copy, { className: 'w-4 h-4' }))
                ),
                React.createElement('p', {
                  style: { fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }
                }, 'Add both URLs to your Spotify app\'s Redirect URIs (IPv4 + IPv6)')
              ),
              // Save / Clear buttons
              React.createElement('div', { className: 'flex gap-2' },
                React.createElement(Button, { variant: 'primary', size: 'sm', onClick: saveSpotifyCredentials, disabled: !spotifyClientIdInput.trim() }, 'Save'),
                spotifyClientIdInput && React.createElement(Button, { variant: 'text', size: 'sm', onClick: () => {
                    setSpotifyClientIdInput('');
                    // Pass the cleared value: the input state hasn't updated
                    // yet, and reading it re-saved the old Client ID.
                    saveSpotifyCredentials('');
                  } }, 'Clear')
              )
            ),
            // Your own client ID, once signed in with one (components/disclosure.js).
            spotifyConnected && spotifyCredentialsSource === 'user' && React.createElement(Disclosure, { label: 'Change client ID', open: spotifyAdvancedOpen, onToggle: () => setSpotifyAdvancedOpen(!spotifyAdvancedOpen) },
              React.createElement('div', { style: { marginBottom: '10px' } },
                React.createElement('label', {
                  style: { fontSize: '11px', color: 'var(--text-secondary)', display: 'block', marginBottom: '4px' }
                }, 'Client ID'),
                React.createElement(SecretField, { value: spotifyClientIdInput, onChange: (_v, e) => setSpotifyClientIdInput(e.target.value), placeholder: 'Your Spotify Client ID', 'aria-label': 'Your Spotify Client ID', className: 'w-full' })
              ),
              React.createElement(Button, { variant: 'primary', size: 'sm', onClick: saveSpotifyCredentials, disabled: !spotifyClientIdInput.trim() }, 'Save')
            ),
            renderLibrarySync(),
            // Start Spotify at launch, so a device is there to play on.
            React.createElement('div', { style: SYNC_BLOCK },
              React.createElement(SettingRow, { label: 'Open Spotify at startup', hint: 'Start it in the background so there’s always a device to play on', style: { padding: 0 } },
                React.createElement(Switch, { checked: autoLaunchSpotify, onToggle: async () => {
                  const newValue = !autoLaunchSpotify;
                  setAutoLaunchSpotify(newValue);
                  if (window.electron?.store) {
                    await window.electron.store.set('auto_launch_spotify', newValue);
                  }
                  // If enabling, launch Spotify now
                  if (newValue && window.electron?.spotify?.launchInBackground) {
                    window.electron.spotify.launchInBackground();
                    showToast('Spotify launched in background', 'success');
                  }
                }, 'aria-label': 'Open Spotify in the background at startup', }))),
          ),

          // SoundCloud authentication section
          selectedResolver.id === 'soundcloud' && (() => {
            const hasCredentials = soundcloudCredentialsSource !== 'none' && soundcloudCredentialsSource !== undefined;
            return React.createElement('div', {
              style: {
                padding: '16px 0',
                borderTop: '1px solid var(--border-subtle)'
              }
            },
              React.createElement(AccountRow, {
                name: 'SoundCloud', color: getServiceColor('soundcloud'), signedIn: soundcloudConnected,
                status: soundcloudConnected ? 'Signed in' : hasCredentials ? 'Sign in to search and stream SoundCloud' : 'Add your client ID and secret below first',
                onSignIn: connectSoundcloud, onSignOut: disconnectSoundcloud, signInDisabled: !hasCredentials,
              }),

              // The client ID and secret it signs in with, right under the
              // sign-in: open until they're saved (it can't sign in without
              // them), then folded under their own name, not "Advanced".
              React.createElement(Disclosure, { label: 'Client ID and secret', alwaysOpen: !hasCredentials, open: soundcloudAdvancedOpen, onToggle: () => setSoundcloudAdvancedOpen(!soundcloudAdvancedOpen) },
React.createElement('p', {
                    style: {
                      fontSize: '11px',
                      color: soundcloudCredentialsSource === 'user' || soundcloudCredentialsSource === 'env' ? 'var(--text-success)' : 'var(--text-secondary)',
                      marginBottom: '12px',
                      lineHeight: '1.5'
                    }
                  },
                    soundcloudCredentialsSource === 'user'
                      ? '✓ Using your custom SoundCloud API credentials.'
                      : soundcloudCredentialsSource === 'env'
                        ? '✓ Using credentials from environment variables.'
                        : 'SoundCloud needs your own client ID and secret before you can sign in.'
                  ),
React.createElement('div', { style: { marginBottom: '10px' } },
                    React.createElement('label', {
                      style: {
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        marginBottom: '4px'
                      }
                    }, 'Client ID'),
                    React.createElement(SecretField, { value: soundcloudClientIdInput, onChange: (_v, e) => setSoundcloudClientIdInput(e.target.value), placeholder: 'Your SoundCloud Client ID', 'aria-label': 'Your SoundCloud Client ID', className: 'w-full' })
                  ),
React.createElement('div', { style: { marginBottom: '10px' } },
                    React.createElement('label', {
                      style: {
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        marginBottom: '4px'
                      }
                    }, 'Client Secret'),
                    React.createElement(SecretField, { value: soundcloudClientSecretInput, onChange: (_v, e) => setSoundcloudClientSecretInput(e.target.value), placeholder: 'Your SoundCloud Client Secret', 'aria-label': 'Your SoundCloud Client Secret', className: 'w-full' })
                  ),
React.createElement('div', { style: { marginBottom: '12px' } },
                    React.createElement('label', {
                      style: {
                        fontSize: '11px',
                        color: 'var(--text-secondary)',
                        display: 'block',
                        marginBottom: '4px'
                      }
                    }, 'Redirect URI'),
                    React.createElement('div', {
                      style: {
                        display: 'flex',
                        gap: '6px'
                      }
                    },
                      React.createElement(TextField, { 'aria-label': 'SoundCloud redirect URI', value: `http://127.0.0.1:${authPort}/callback/soundcloud`, readOnly: true, className: 'flex-1' }),
                      React.createElement(Button, { variant: 'secondary', 'aria-label': 'Copy redirect URI', title: 'Copy', onClick: () => {
                          navigator.clipboard.writeText(`http://127.0.0.1:${authPort}/callback/soundcloud`);
                          showToast('Redirect URI copied', 'success');
                        } },
  React.createElement(Icons.Copy, { className: 'w-4 h-4' }))
                    ),
                    React.createElement('p', {
                      style: {
                        fontSize: '11px',
                        color: 'var(--text-tertiary)',
                        marginTop: '4px'
                      }
                    }, authPort === 8888
                      ? 'Add this to your SoundCloud app\'s Redirect URI. The same app also works with Parachord on Android and iOS.'
                      : `Add this to your SoundCloud app's Redirect URI. Parachord's local server is on port ${authPort}, so signing in to SoundCloud needs your own app credentials here: the built-in sign-in only works on port 8888. Parachord on Android and iOS always signs in on port 8888, so an app registered for port ${authPort} won't sign in on your phone.`)
                  ),
React.createElement('div', { className: 'flex gap-2' },
                    React.createElement(Button, { variant: 'primary', size: 'sm', onClick: async () => {
                        await saveSoundcloudCredentials();
                      }, disabled: !soundcloudClientIdInput.trim() || !soundcloudClientSecretInput.trim() }, 'Save credentials'),
                    soundcloudCredentialsSource === 'user' && React.createElement(Button, { variant: 'secondary', onClick: async () => {
                        if (window.electron?.soundcloud?.setCredentials) {
                          const result = await window.electron.soundcloud.setCredentials({ clientId: '', clientSecret: '' });
                          if (result.success) {
                            setSoundcloudClientIdInput('');
                            setSoundcloudClientSecretInput('');
                            setSoundcloudCredentialsSource(result.source);
                            showToast('Custom credentials cleared. Using default credentials.', 'info');
                          }
                        }
                      } }, 'Clear')
                  )),
              soundcloudConnected && React.createElement('p', {
                style: { fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '12px', lineHeight: '1.5' }
              }, 'Streaming depends on each track’s permissions, which its uploader sets.')
            );
          })(),

          // Apple Music / MusicKit authentication section
          selectedResolver.id === 'applemusic' && React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            // Apple Music auth-method notice. Three states:
            //   1. Native MusicKit available (macOS with helper built) — green.
            //   2. Auth-window flow available (any platform with the openAuthWindow
            //      IPC bridge; parachord#834) — neutral info banner explaining
            //      the browser-window sign-in flow.
            //   3. Neither — red "macOS Only" banner with build instructions
            //      (older builds without the auth-window plumbing).
            appleMusicNativeAvailable && React.createElement('div', {
              style: {
                marginBottom: '12px',
                padding: '10px 12px',
                backgroundColor: 'var(--tint-success)',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--text-success)'
              }
            },
              '✓ Apple Music can play directly on this Mac'
            ),
            !appleMusicNativeAvailable && !!window.electron?.musicKit?.openAuthWindow && React.createElement('div', {
              style: {
                marginBottom: '12px',
                padding: '10px 12px',
                backgroundColor: 'var(--tint-info)',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--text-info)'
              }
            },
              'Sign-in opens an Apple Music window for direct Apple ID authentication. Your subscription playback works the same as on macOS.'
            ),
            !appleMusicNativeAvailable && !window.electron?.musicKit?.openAuthWindow && React.createElement('div', {
              style: {
                marginBottom: '12px',
                padding: '10px 12px',
                backgroundColor: 'var(--tint-danger)',
                borderRadius: '8px',
                fontSize: '12px',
                color: 'var(--text-danger)'
              }
            },
              React.createElement('strong', null, 'macOS Only: '),
              'Native MusicKit playback requires macOS and building the helper binary. ',
              React.createElement('span', { style: { fontFamily: 'monospace', fontSize: '11px' } },
                'cd native/musickit-helper && ./build.sh'
              )
            ),
            React.createElement(AccountRow, {
              name: 'Apple Music', color: getServiceColor('applemusic'), signedIn: appleMusicConnected,
              status: appleMusicConnected ? 'Signed in'
                : (appleMusicNativeAvailable || !!window.electron?.musicKit?.openAuthWindow)
                  ? 'Sign in with your Apple Account to play from Apple Music'
                  : 'Search and links work; playback opens in your browser',
              // Either sign-in path: native MusicKit (macOS) or the auth
              // window (parachord#834); without one there's no button.
              onSignIn: (appleMusicNativeAvailable || !!window.electron?.musicKit?.openAuthWindow) ? connectAppleMusic : undefined,
              onSignOut: disconnectAppleMusic,
            }),

            renderLibrarySync(),

            // Advanced accordion for MusicKit developer token
            React.createElement(Disclosure, { open: appleMusicAdvancedOpen, onToggle: () => setAppleMusicAdvancedOpen(!appleMusicAdvancedOpen) },
React.createElement('p', {
                  style: {
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    marginBottom: '12px',
                    lineHeight: '1.5'
                  }
                },
                  appleMusicDeveloperToken
                    ? 'Using your developer token for faster search.'
                    : 'Add a developer token for faster, more reliable search.'
                ),
React.createElement('div', { style: { marginBottom: '10px' } },
                  React.createElement('label', {
                    style: {
                      fontSize: '11px',
                      color: 'var(--text-secondary)',
                      display: 'block',
                      marginBottom: '4px'
                    }
                  }, 'MusicKit Developer Token (JWT)'),
                  React.createElement(SecretField, { value: appleMusicDeveloperToken, onChange: (_v, e) => setAppleMusicDeveloperToken(e.target.value), placeholder: 'eyJ…', 'aria-label': 'Apple Music developer token', className: 'w-full' })
                ),
React.createElement('p', {
                  style: {
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    marginBottom: '12px',
                    lineHeight: '1.4'
                  }
                }, 'Get a token from the Apple Developer Portal (requires Apple Developer account). The token is a JWT that authenticates your app with Apple Music API.'),
React.createElement(Button, { variant: 'primary', size: 'sm', onClick: saveAppleMusicDeveloperToken }, appleMusicTokenSaved ? '✓ Saved' : 'Save token'))
          ),

          // Last.fm authentication section
          selectedResolver.id === 'lastfm' && React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            // Connected state
            metaServiceConfigs.lastfm?.username
              ? React.createElement('div', null,
                  // The account (components/account-row.js, #1498 step 3).
                  React.createElement('div', null,
                  // A username reads your history; it isn't a sign-in (that's
                  // Scrobbling, under Enable), so the row doesn't say "Signed in".
                  React.createElement(AccountRow, {
                    // The account Parachord reads from: "Listening history · Using
                    // X's history" didn't say for what (2026-11-17).
                    name: 'Last.fm', label: 'Last.fm username', color: getServiceColor('lastfm'), signedIn: true,
                    status: `${metaServiceConfigs.lastfm.username} · your recommendations, similar listeners and history come from this account`, onSignOut: disconnectLastfm, signOutLabel: 'Remove',
                  })),
                  // Advanced accordion for API credentials (also shown when connected)
                  React.createElement(Disclosure, { open: lastfmAdvancedOpen, onToggle: () => setLastfmAdvancedOpen(!lastfmAdvancedOpen) },
React.createElement('p', {
                        style: {
                          fontSize: '11px',
                          color: metaServiceConfigs.lastfm.apiKey ? 'var(--text-success)' : 'var(--text-secondary)',
                          marginBottom: '12px',
                          lineHeight: '1.5'
                        }
                      },
                        metaServiceConfigs.lastfm.apiKey
                          ? '✓ Using your custom Last.fm API credentials.'
                          : 'Optional: Use your own Last.fm API credentials to avoid rate limiting.'
                      ),
React.createElement('div', { style: { marginBottom: '10px' } },
                        React.createElement('label', {
                          style: {
                            display: 'block',
                            fontSize: '11px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                            marginBottom: '4px'
                          }
                        }, 'API Key'),
                        React.createElement(SecretField, { value: lastfmApiKeyInput || metaServiceConfigs.lastfm.apiKey || '', onChange: (_v, e) => setLastfmApiKeyInput(e.target.value), placeholder: 'Your Last.fm API key', 'aria-label': 'Your Last.fm API key', className: 'w-full' })
                      ),
React.createElement('div', { style: { marginBottom: '12px' } },
                        React.createElement('label', {
                          style: {
                            display: 'block',
                            fontSize: '11px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                            marginBottom: '4px'
                          }
                        }, 'API Secret'),
                        React.createElement(SecretField, { value: lastfmApiSecretInput || metaServiceConfigs.lastfm.apiSecret || '', onChange: (_v, e) => setLastfmApiSecretInput(e.target.value), placeholder: 'Your Last.fm API secret', 'aria-label': 'Your Last.fm API secret', className: 'w-full' })
                      ),
React.createElement('div', { className: 'flex gap-2' },
                        React.createElement(Button, { variant: 'primary', size: 'sm', onClick: async () => {
                            const apiKey = lastfmApiKeyInput?.trim() || null;
                            const apiSecret = lastfmApiSecretInput?.trim() || null;
                            await saveMetaServiceConfig('lastfm', {
                              ...metaServiceConfigs.lastfm,
                              apiKey,
                              apiSecret
                            });
                            if (apiKey && apiSecret && window.lastfmScrobbler) {
                              window.lastfmScrobbler.setApiCredentials(apiKey, apiSecret);
                            }
                            showToast(apiKey ? 'API credentials saved' : 'API credentials cleared', 'success');
                          } }, 'Save'),
                        metaServiceConfigs.lastfm.apiKey && React.createElement(Button, { variant: 'secondary', onClick: async () => {
                            setLastfmApiKeyInput('');
                            setLastfmApiSecretInput('');
                            await saveMetaServiceConfig('lastfm', {
                              ...metaServiceConfigs.lastfm,
                              apiKey: null,
                              apiSecret: null
                            });
                            showToast('Custom credentials cleared. Using default credentials.', 'info');
                          } }, 'Clear')
                      ))
                )
              // Not connected state
              : React.createElement('div', null,
                  // The account (components/account-row.js, #1498 step 3):
                  // Sign in once there's a username; the fields are below.
                  React.createElement('div', { style: { marginBottom: '16px' } },
                    React.createElement(AccountRow, {
                      name: 'Last.fm', label: 'Last.fm username', color: getServiceColor('lastfm'), signedIn: false,
                      status: 'Enter your Last.fm username below', signInLabel: 'Save',
                      onSignIn: () => connectLastfm(lastfmUsernameInput, lastfmApiKeyInput, lastfmApiSecretInput),
                      signInDisabled: !lastfmUsernameInput.trim(), busy: lastfmConnecting,
                    })),
                  // Username input
                  React.createElement('div', { style: { marginBottom: '16px' } },
                    React.createElement('label', {
                      style: {
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        marginBottom: '6px'
                      }
                    }, 'Username'),
                    React.createElement(TextField, { value: lastfmUsernameInput, onChange: (_v, e) => setLastfmUsernameInput(e.target.value), placeholder: 'Your Last.fm username', 'aria-label': 'Your Last.fm username', className: 'w-full' })
                  ),
                  // Advanced accordion
                  React.createElement(Disclosure, { open: lastfmAdvancedOpen, onToggle: () => setLastfmAdvancedOpen(!lastfmAdvancedOpen) },
React.createElement('p', {
                        style: {
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginBottom: '12px',
                          lineHeight: '1.5'
                        }
                      },
                        'Optional: Use your own Last.fm API credentials to avoid rate limiting.'
                      ),
React.createElement('div', { style: { marginBottom: '10px' } },
                        React.createElement('label', {
                          style: {
                            display: 'block',
                            fontSize: '11px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                            marginBottom: '4px'
                          }
                        }, 'API Key'),
                        React.createElement(SecretField, { value: lastfmApiKeyInput, onChange: (_v, e) => setLastfmApiKeyInput(e.target.value), placeholder: 'Your Last.fm API key', 'aria-label': 'Your Last.fm API key', className: 'w-full' })
                      ),
React.createElement('div', null,
                        React.createElement('label', {
                          style: {
                            display: 'block',
                            fontSize: '11px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                            marginBottom: '4px'
                          }
                        }, 'API Secret'),
                        React.createElement(SecretField, { value: lastfmApiSecretInput, onChange: (_v, e) => setLastfmApiSecretInput(e.target.value), placeholder: 'Your Last.fm API secret', 'aria-label': 'Your Last.fm API secret', className: 'w-full' })
                      ))
                )
          ),

          // ListenBrainz authentication section
          selectedResolver.id === 'listenbrainz' && React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            // Connected state
            metaServiceConfigs.listenbrainz?.username
              ? React.createElement('div', null,
                  // The account (components/account-row.js, #1498 step 3).
                  React.createElement('div', null,
                  // A username reads your history; it isn't a sign-in (that's
                  // Scrobbling, under Enable), so the row doesn't say "Signed in".
                  React.createElement(AccountRow, {
                    // The account Parachord reads from: "Listening history · Using
                    // X's history" didn't say for what (2026-11-17).
                    name: 'ListenBrainz', label: 'ListenBrainz username', color: getServiceColor('listenbrainz'), signedIn: true,
                    status: `${metaServiceConfigs.listenbrainz.username} · your recommendations, similar listeners and history come from this account`, onSignOut: disconnectListenbrainz, signOutLabel: 'Remove',
                  }),
                  // Show token status if configured - masked like AI service API keys
                  metaServiceConfigs.listenbrainz.userToken && React.createElement('div', {
                    style: {
                      marginTop: '12px'
                    }
                  },
                    React.createElement('label', {
                      style: {
                        display: 'block',
                        fontSize: '11px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        marginBottom: '4px'
                      }
                    }, 'User Token'),
                    React.createElement(SecretField, { 'aria-label': 'ListenBrainz user token', defaultValue: metaServiceConfigs.listenbrainz.userToken, readOnly: true, className: 'w-full' })
                  ))
                )
              // Not connected state
              : React.createElement('div', null,
                  // The account (components/account-row.js, #1498 step 3):
                  // Sign in once there's a username; the fields are below.
                  React.createElement('div', { style: { marginBottom: '16px' } },
                    React.createElement(AccountRow, {
                      name: 'ListenBrainz', label: 'ListenBrainz username', color: getServiceColor('listenbrainz'), signedIn: false,
                      status: 'Enter your ListenBrainz username below', signInLabel: 'Save',
                      onSignIn: () => connectListenbrainz(listenbrainzUsernameInput, listenbrainzTokenInput),
                      signInDisabled: !listenbrainzUsernameInput.trim(), busy: listenbrainzConnecting,
                    })),
                  React.createElement('div', { style: { marginBottom: '16px' } },
                    React.createElement('label', {
                      style: {
                        display: 'block',
                        fontSize: '12px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        marginBottom: '6px'
                      }
                    }, 'Username'),
                    React.createElement(TextField, { value: listenbrainzUsernameInput, onChange: (_v, e) => setListenbrainzUsernameInput(e.target.value), placeholder: 'Your ListenBrainz username', 'aria-label': 'Your ListenBrainz username', className: 'w-full' })
                  ),
                  // Advanced accordion
                  React.createElement(Disclosure, { open: listenbrainzAdvancedOpen, onToggle: () => setListenbrainzAdvancedOpen(!listenbrainzAdvancedOpen) },
React.createElement('p', {
                        style: {
                          fontSize: '11px',
                          color: 'var(--text-secondary)',
                          marginBottom: '12px',
                          lineHeight: '1.5'
                        }
                      },
                        'Optional: Add your user token to enable listen submissions and access private data. Find it at listenbrainz.org/settings/'
                      ),
React.createElement('div', null,
                        React.createElement('label', {
                          style: {
                            display: 'block',
                            fontSize: '11px',
                            fontWeight: '500',
                            color: 'var(--text-primary)',
                            marginBottom: '4px'
                          }
                        }, 'User Token'),
                        React.createElement(SecretField, { value: listenbrainzTokenInput, onChange: (_v, e) => setListenbrainzTokenInput(e.target.value), placeholder: 'Your ListenBrainz user token', 'aria-label': 'Your ListenBrainz user token', className: 'w-full' })
                      ))
                )
          ),

          // Plug-in-drawn settings (settings.authType 'custom' + renderSettings
          // in the .axe; Plex is the first). The host supplies React and config
          // read/write through ctx; the plug-in owns the UI (PluginSettingsPanel).
          ((selectedResolver.settings?.authType === 'custom') || selectedResolver.authType === 'custom') && (() => {
            const pluginId = selectedResolver.id;
            const loaded = resolverLoaderRef && resolverLoaderRef.current && resolverLoaderRef.current.getResolver(pluginId);
            if (!loaded || typeof loaded.renderSettings !== 'function') return null;
            const ctx = {
              React,
              // The shared parts a plug-in-drawn panel builds with, so it looks
              // and behaves like every other plug-in's settings (CLAUDE.md,
              // "every plug-in's settings are one layout"). A panel draws with
              // these only, never its own buttons, inputs or colours.
              components: { AccountRow, SettingRow, NestedSettings, Switch, Button, ProgressBar, EmptyState, ErrorState, Disclosure },
              resolver: loaded,
              config: metaServiceConfigs[pluginId] || {},
              saveConfig: async (next) => {
                await saveMetaServiceConfig(pluginId, next);
                delete resolverConfigCache.current[pluginId];
              },
              clearConfig: async () => {
                await clearMetaServiceConfig(pluginId);
                delete resolverConfigCache.current[pluginId];
              },
              isActive: activeResolvers.includes(pluginId),
              setActive: (on) => { if (!!on !== activeResolvers.includes(pluginId)) toggleResolver(pluginId); },
              showToast,
              showConfirmDialog
            };
            return React.createElement(PluginSettingsPanel, { key: pluginId, resolver: loaded, ctx });
          })(),

          // Username + password credentials (Subsonic). Not an API key: no
          // "get a key" link, and the pair is rendered together rather than
          // split across an API-key slot and the extra-field list. The loader
          // flattens authType/configurable onto the resolver (no .settings
          // wrapper), so check both.
          ((selectedResolver.settings?.authType === 'userpass') || selectedResolver.authType === 'userpass') && (() => {
            const configurable = selectedResolver.settings?.configurable || selectedResolver.configurable || {};
            const saved = metaServiceConfigs[selectedResolver.id] || {};
            const inputStyle = {
              width: '100%',
              padding: '10px 12px',
              fontSize: '13px',
              color: 'var(--text-primary)',
              backgroundColor: 'var(--card-bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px'
            };
            const labelStyle = {
              display: 'block',
              fontSize: '12px',
              fontWeight: '500',
              color: 'var(--text-primary)',
              marginBottom: '6px'
            };
            const saveField = (fieldKey, value) => {
              saveMetaServiceConfig(selectedResolver.id, {
                ...metaServiceConfigs[selectedResolver.id],
                [fieldKey]: value
              });
              delete resolverConfigCache.current[selectedResolver.id];
            };
            const otherFields = Object.entries(configurable).filter(([key, setting]) =>
              setting && key !== 'username' && key !== 'password' && key !== 'model'
            );
            const usernameSetting = configurable.username;
            const passwordSetting = configurable.password;
            const credentialNote = passwordSetting?.description || usernameSetting?.description;
            const configured = !!(saved.username && saved.password && (!configurable.serverUrl || saved.serverUrl));
            return React.createElement('div', {
              style: {
                padding: '16px 0',
                borderTop: '1px solid var(--border-subtle)'
              }
            },
              ...otherFields.map(([fieldKey, fieldSetting]) =>
                React.createElement('div', { key: fieldKey, style: { marginBottom: '16px' } },
                  React.createElement('label', { style: labelStyle }, fieldSetting.label || fieldKey),
                  fieldSetting.description && React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginTop: '-2px',
                      marginBottom: '8px',
                      lineHeight: '1.5'
                    }
                  }, fieldSetting.description),
                  React.createElement(TextField, { defaultValue: saved[fieldKey] || fieldSetting.default || '', placeholder: fieldSetting.placeholder || '', spellCheck: false, onBlur: (e) => saveField(fieldKey, fieldSetting.type === 'password' ? e.target.value : e.target.value.trim()), 'aria-label': fieldSetting.label || fieldKey, className: 'w-full' })
                )
              ),
              (usernameSetting || passwordSetting) && React.createElement('div', {
                style: {
                  display: 'flex',
                  gap: '12px',
                  flexWrap: 'wrap',
                  padding: '12px',
                  backgroundColor: 'var(--hover-bg-default)',
                  borderRadius: '10px'
                }
              },
                usernameSetting && React.createElement('div', { style: { flex: '1 1 140px', minWidth: 0 } },
                  React.createElement('label', { style: labelStyle }, usernameSetting.label || 'Username'),
                  React.createElement(TextField, { defaultValue: saved.username || '', placeholder: usernameSetting.placeholder || '', autoComplete: 'username', spellCheck: false, onBlur: (e) => saveField('username', e.target.value.trim()), 'aria-label': usernameSetting.label || 'Username', className: 'w-full' })
                ),
                passwordSetting && React.createElement('div', { style: { flex: '1 1 140px', minWidth: 0 } },
                  React.createElement('label', { style: labelStyle }, passwordSetting.label || 'Password'),
                  React.createElement(SecretField, { defaultValue: saved.password || '', placeholder: passwordSetting.placeholder || '', autoComplete: 'current-password', spellCheck: false, onBlur: (e) => saveField('password', e.target.value), 'aria-label': passwordSetting.label || 'Password', className: 'w-full' })
                ),
                credentialNote && React.createElement('p', {
                  style: {
                    flex: '1 1 100%',
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    margin: 0,
                    lineHeight: '1.5'
                  }
                }, credentialNote)
              ),
              configured && React.createElement('div', {
                className: 'flex items-center gap-2',
                style: { marginTop: '12px', fontSize: '12px', color: 'var(--text-success)' }
              },
                React.createElement('span', null, '\u2713'),
                React.createElement('span', null, 'Credentials saved')
              )
            );
          })(),

          // AI Service / credential configuration - generic based on plugin settings
          // Check both .axe settings and top-level marketplace manifest properties.
          // The resolver loader flattens requiresAuth/authType/configurable onto
          // the resolver object (no .settings wrapper), so fall back to the
          // top-level fields. userpass resolvers (Subsonic) are handled above
          // and must not land here — this block assumes an API key.
          ((selectedResolver.settings?.requiresAuth && selectedResolver.settings?.authType === 'apikey') ||
           (selectedResolver.requiresAuth && selectedResolver.authType === 'apikey') ||
           (selectedResolver.type === 'meta-service' && (selectedResolver.capabilities?.generate || selectedResolver.capabilities?.chat) && selectedResolver.id !== 'ollama')) && (() => {
            // Determine the actual config field name from plugin settings (e.g. apiKey, clientId, appId)
            const configurable = selectedResolver.settings?.configurable || selectedResolver.configurable || {};
            const authFieldKey = Object.keys(configurable).find(k => k !== 'model') || 'apiKey';
            const authFieldSettings = configurable[authFieldKey] || {};
            return React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            React.createElement('span', {
              style: {
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--text-primary)'
              }
            }, 'API Configuration'),
            React.createElement('p', {
              style: {
                fontSize: '12px',
                color: 'var(--text-secondary)',
                marginTop: '4px',
                marginBottom: '16px',
                lineHeight: '1.5'
              }
            }, authFieldSettings.description || `Enter your API key to enable ${selectedResolver.name}.`),
            // API Key input
            React.createElement('div', { style: { marginBottom: '16px' } },
              React.createElement('label', {
                style: {
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: '500',
                  color: 'var(--text-primary)',
                  marginBottom: '6px'
                }
              }, authFieldSettings.label || 'API Key'),
              React.createElement(SecretField, { defaultValue: metaServiceConfigs[selectedResolver.id]?.[authFieldKey] || '', onBlur: (e) => {
                  // Services whose key is optional (requiresAuth: false, e.g. local
                  // custom-LLM endpoints) keep their explicit enabled toggle — blurring
                  // an empty key field must not silently disable them. Note `=== true ||`,
                  // NOT `??`: nullish coalescing doesn't fall through on `false`, so an
                  // early empty-field blur would poison `enabled: false` forever — a
                  // later key entry has to be able to re-enable the service.
                  const svcRequiresAuth = selectedResolver.settings?.requiresAuth ?? selectedResolver.requiresAuth;
                  const keyRequired = svcRequiresAuth !== false;
                  saveMetaServiceConfig(selectedResolver.id, {
                    ...metaServiceConfigs[selectedResolver.id],
                    [authFieldKey]: e.target.value,
                    enabled: keyRequired
                      ? !!e.target.value
                      : (metaServiceConfigs[selectedResolver.id]?.enabled === true || !!e.target.value)
                  });
                  // Re-fetch dynamic models after API key change
                  setTimeout(() => {
                    const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                    const modelSetting = resolver.settings?.configurable?.model || resolver.configurable?.model;
                    if (modelSetting?.type === 'dynamic-select') {
                      fetchDynamicModels(resolver, { ...metaServiceConfigs[selectedResolver.id], [authFieldKey]: e.target.value });
                    }
                  }, 100);
                }, placeholder: authFieldSettings.placeholder || (selectedResolver.id === 'chatgpt' ? 'sk-…' : selectedResolver.id === 'gemini' ? 'AIza…' : selectedResolver.id === 'claude' ? 'sk-ant-…' : ''), 'aria-label': `${selectedResolver.name} API key`, className: 'w-full' }),
              // Under the key: whether it's saved (left), where to get one (right).
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginTop: '6px', fontSize: '12px' } },
              metaServiceConfigs[selectedResolver.id]?.[authFieldKey]
                ? React.createElement('span', { className: 'flex items-center gap-1 text-ink-success' },
                    React.createElement(Icons.Check, { className: 'w-4 h-4', 'aria-hidden': 'true' }),
                    `${keyLabel(selectedResolver)} saved`)
                : React.createElement('span', null),
              selectedResolver.homepage && React.createElement('a', {
                href: '#',
                onClick: (e) => {
                  e.preventDefault();
                  const urls = {
                    chatgpt: 'https://platform.openai.com/api-keys',
                    gemini: 'https://aistudio.google.com/app/apikey',
                    claude: 'https://console.anthropic.com/settings/keys'
                  };
                  window.electron?.shell?.openExternal?.(urls[selectedResolver.id] || selectedResolver.homepage);
                },
                style: {
                  color: 'var(--accent-primary)',
                  fontWeight: '500',
                  textDecoration: 'none'
                }
              }, 'Get your API key →'))
            ),
            // Model selector - supports both static and dynamic-select
            selectedResolver.settings?.configurable?.model && React.createElement('div', { style: { marginBottom: '16px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
                React.createElement('label', {
                  style: {
                    fontSize: '12px',
                    fontWeight: '500',
                    color: 'var(--text-primary)'
                  }
                }, selectedResolver.settings?.configurable?.model?.label || 'Model'),
                // Refresh button for dynamic-select
                selectedResolver.settings?.configurable?.model?.type === 'dynamic-select' && React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': "Refresh models", onClick: () => {
                    const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                    fetchDynamicModels(resolver, metaServiceConfigs[selectedResolver.id]);
                  }, 'data-tooltip': 'Refresh models' }, React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' }))
              ),
              (() => {
                const modelSetting = selectedResolver.settings?.configurable?.model;
                const isDynamic = modelSetting?.type === 'dynamic-select';
                const dynamicState = isDynamic ? dynamicModelOptions[selectedResolver.id] : null;
                const isLoading = dynamicState?.loading;

                const modelInputStyle = {
                  width: '100%',
                  padding: '10px 12px',
                  fontSize: '13px',
                  color: 'var(--text-primary)',
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '8px'
                };

                // Free-form model id — for endpoints whose model names aren't a fixed list
                if (modelSetting?.type === 'text') {
                  return React.createElement(TextField, { defaultValue: metaServiceConfigs[selectedResolver.id]?.model || modelSetting?.default || '', placeholder: modelSetting?.placeholder || '', onBlur: (e) => {
                      saveMetaServiceConfig(selectedResolver.id, {
                        ...metaServiceConfigs[selectedResolver.id],
                        model: e.target.value.trim()
                      });
                    }, 'aria-label': 'Model', className: 'w-full' });
                }

                // Free-form model id with fetched suggestions (allowCustom) — lets users
                // type any model id while still offering the endpoint's model list as
                // datalist suggestions (the list endpoint isn't universal, so typing must
                // always work)
                if (isDynamic && modelSetting?.allowCustom) {
                  const suggestions = dynamicState?.options?.length > 0
                    ? dynamicState.options
                    : (modelSetting?.fallbackOptions || []);
                  const listId = `model-suggestions-${selectedResolver.id}`;
                  return React.createElement('div', null,
                    React.createElement(TextField, { list: listId, defaultValue: metaServiceConfigs[selectedResolver.id]?.model || modelSetting?.default || '', placeholder: modelSetting?.placeholder || 'model id', onBlur: (e) => {
                        saveMetaServiceConfig(selectedResolver.id, {
                          ...metaServiceConfigs[selectedResolver.id],
                          model: e.target.value.trim()
                        });
                      }, 'aria-label': 'Model', className: 'w-full' }),
                    React.createElement('datalist', { id: listId },
                      suggestions.map(opt =>
                        React.createElement('option', { key: opt.value, value: opt.value }, opt.label)
                      )
                    )
                  );
                }

                // Determine which options to show
                let options;
                if (isDynamic && dynamicState?.options?.length > 0) {
                  options = dynamicState.options;
                } else if (isDynamic && modelSetting?.fallbackOptions) {
                  options = modelSetting.fallbackOptions;
                } else if (modelSetting?.options) {
                  options = modelSetting.options;
                } else {
                  options = [];
                }

                // The shared select (components/fields.js).
                return React.createElement(Select, {
                  'aria-label': 'Model',
                  value: metaServiceConfigs[selectedResolver.id]?.model || modelSetting?.default || '',
                  onChange: (model) => {
                    saveMetaServiceConfig(selectedResolver.id, {
                      ...metaServiceConfigs[selectedResolver.id],
                      model
                    });
                  },
                  disabled: isLoading,
                  className: 'w-full',
                  options: isLoading ? [{ value: '', label: 'Loading models…' }] : options
                });
              })()
            ),
            // Additional configurable fields (API dialect, base URL, token limits, ...)
            // beyond the standard key + model pair. Rendered generically from the
            // plugin's settings.configurable so any meta-service plugin can declare
            // them (e.g. the customllm endpoint config). Existing AI plugins only
            // declare apiKey + model, so they render nothing here.
            ...Object.entries(configurable)
              .filter(([fieldKey, fieldSetting]) => fieldSetting && fieldKey !== 'model' && fieldKey !== authFieldKey)
              .map(([fieldKey, fieldSetting]) => {
                const savedValue = metaServiceConfigs[selectedResolver.id]?.[fieldKey];
                // Changing the endpoint or dialect can change the model list — refresh it
                const refetchModels = (fieldKey === 'baseUrl' || fieldKey === 'endpoint' || fieldKey === 'api')
                  ? (newValue) => {
                      setTimeout(() => {
                        const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                        const modelSetting = resolver.settings?.configurable?.model || resolver.configurable?.model;
                        if (modelSetting?.type === 'dynamic-select') {
                          fetchDynamicModels(resolver, { ...metaServiceConfigs[selectedResolver.id], [fieldKey]: newValue });
                        }
                      }, 100);
                    }
                  : null;
                return React.createElement('div', { key: fieldKey, style: { marginBottom: '16px' } },
                  React.createElement('label', {
                    style: {
                      display: 'block',
                      fontSize: '12px',
                      fontWeight: '500',
                      color: 'var(--text-primary)',
                      marginBottom: '6px'
                    }
                  }, fieldSetting.label || fieldKey),
                  fieldSetting.description && React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginTop: '-2px',
                      marginBottom: '8px',
                      lineHeight: '1.5'
                    }
                  }, fieldSetting.description),
                  fieldSetting.type === 'select'
                    ? React.createElement(Select, {
                        'aria-label': fieldSetting.label || fieldKey,
                        value: savedValue || fieldSetting.default || (fieldSetting.options?.[0]?.value ?? ''),
                        onChange: (v) => {
                          saveMetaServiceConfig(selectedResolver.id, {
                            ...metaServiceConfigs[selectedResolver.id],
                            [fieldKey]: v
                          });
                          if (refetchModels) refetchModels(v);
                        },
                        className: 'w-full',
                        options: fieldSetting.options || []
                      })
                    : React.createElement(TextField, { defaultValue: savedValue || fieldSetting.default || '', placeholder: fieldSetting.placeholder || '', onBlur: (e) => {
                          saveMetaServiceConfig(selectedResolver.id, {
                            ...metaServiceConfigs[selectedResolver.id],
                            [fieldKey]: e.target.value.trim()
                          });
                          if (refetchModels) refetchModels(e.target.value.trim());
                        }, 'aria-label': fieldSetting.label || fieldKey, className: 'w-full' })
                );
              }),
          );
          })(),

          // Ollama configuration (no API key, but has endpoint and model)
          selectedResolver.id === 'ollama' && React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            React.createElement('span', {
              style: {
                fontSize: '13px',
                fontWeight: '500',
                color: 'var(--text-primary)'
              }
            }, 'Ollama Configuration'),
            // (Its intro sentence repeated the plug-in's description; #1498.)
            // Download/install callout
            React.createElement('div', {
              style: {
                padding: '12px 14px',
                backgroundColor: 'var(--accent-primary-alpha-06)',
                borderRadius: '10px',
                marginBottom: '16px',
                border: '1px solid var(--accent-primary-alpha-10)'
              }
            },
              React.createElement('p', {
                style: { fontSize: '12px', fontWeight: '500', color: 'var(--text-primary)', marginBottom: '6px' }
              }, 'Ollama must be installed separately'),
              React.createElement('p', {
                style: { fontSize: '11px', color: 'var(--text-secondary)', lineHeight: '1.5', marginBottom: '8px' }
              }, 'Download and install Ollama, then pull a model (e.g. ollama pull llama3.1) before enabling.'),
              React.createElement('button', {
                onClick: (e) => {
                  e.preventDefault();
                  window.electron?.shell?.openExternal?.('https://ollama.ai');
                },
                style: {
                  fontSize: '12px',
                  fontWeight: '500',
                  color: 'var(--accent-primary)',
                  backgroundColor: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  padding: '0'
                }
              }, 'Download Ollama →')
            ),
            // Endpoint URL input
            React.createElement('div', { style: { marginBottom: '16px' } },
              React.createElement('label', {
                style: {
                  display: 'block',
                  fontSize: '12px',
                  fontWeight: '500',
                  color: 'var(--text-primary)',
                  marginBottom: '6px'
                }
              }, 'Ollama URL'),
              React.createElement(TextField, { defaultValue: metaServiceConfigs[selectedResolver.id]?.endpoint || 'http://localhost:11434', onBlur: (e) => {
                  // Saving an empty URL doesn't switch the plugin on.
                  saveMetaServiceConfig(selectedResolver.id, {
                    ...metaServiceConfigs[selectedResolver.id],
                    endpoint: e.target.value,
                    enabled: !!e.target.value.trim()
                  });
                  // Re-fetch dynamic models after endpoint change
                  setTimeout(() => {
                    const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                    const modelSetting = resolver.settings?.configurable?.model || resolver.configurable?.model;
                    if (modelSetting?.type === 'dynamic-select') {
                      fetchDynamicModels(resolver, { ...metaServiceConfigs[selectedResolver.id], endpoint: e.target.value });
                    }
                  }, 100);
                }, placeholder: 'http://localhost:11434', 'aria-label': 'Ollama server URL', className: 'w-full' }),
            ),
            // Model selector for Ollama - supports dynamic-select
            React.createElement('div', { style: { marginBottom: '16px' } },
              React.createElement('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' } },
                React.createElement('label', {
                  style: {
                    fontSize: '12px',
                    fontWeight: '500',
                    color: 'var(--text-primary)'
                  }
                }, 'Model'),
                // Refresh button for dynamic model fetching
                (() => {
                  const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                  const modelSetting = resolver.settings?.configurable?.model || resolver.configurable?.model;
                  return (modelSetting?.type === 'dynamic-select') && React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': "Refresh models", onClick: () => {
                      fetchDynamicModels(resolver, metaServiceConfigs[selectedResolver.id]);
                    }, 'data-tooltip': 'Refresh models' }, React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' }));
                })()
              ),
              (() => {
                const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                const modelSetting = resolver.settings?.configurable?.model || resolver.configurable?.model;
                const isDynamic = modelSetting?.type === 'dynamic-select';
                const dynamicState = isDynamic ? dynamicModelOptions[selectedResolver.id] : null;
                const isLoading = dynamicState?.loading;

                let options;
                if (isDynamic && dynamicState?.options?.length > 0) {
                  options = dynamicState.options;
                } else if (isDynamic && modelSetting?.fallbackOptions) {
                  options = modelSetting.fallbackOptions;
                } else if (modelSetting?.options) {
                  options = modelSetting.options;
                } else {
                  // Legacy hardcoded fallback for Ollama
                  options = [
                    { value: 'llama3.1', label: 'Llama 3.1 (8B)' },
                    { value: 'llama3.1:70b', label: 'Llama 3.1 (70B)' },
                    { value: 'llama3.2', label: 'Llama 3.2 (3B)' },
                    { value: 'mistral', label: 'Mistral (7B)' },
                    { value: 'mixtral', label: 'Mixtral (8x7B)' },
                    { value: 'qwen2.5', label: 'Qwen 2.5 (7B)' },
                    { value: 'gemma2', label: 'Gemma 2 (9B)' }
                  ];
                }

                // The shared select (components/fields.js).
                return React.createElement(Select, {
                  'aria-label': 'Model',
                  value: metaServiceConfigs[selectedResolver.id]?.model || modelSetting?.default || 'llama3.1',
                  onChange: (model) => {
                    saveMetaServiceConfig(selectedResolver.id, {
                      ...metaServiceConfigs[selectedResolver.id],
                      model
                    });
                  },
                  disabled: isLoading,
                  className: 'w-full',
                  options: isLoading ? [{ value: '', label: 'Loading models…' }] : options
                });
              })()
            )
          ),

          // Libre.fm scrobbling section
          selectedResolver.id === 'librefm' && React.createElement('div', {
            className: 'py-3 border-t border-line-light'
          },
            // Scrobbler card for Libre.fm
            window.scrobblers && window.scrobblers.find(s => s.id === 'librefm') &&
              React.createElement(ScrobblerSettingsCard, {
                scrobbler: window.scrobblers.find(s => s.id === 'librefm'), color: getServiceColor('librefm') || selectedResolver.color, lovedTracks: !!selectedResolver.capabilities?.lovedTracks,
                config: scrobblerConfigs['librefm'],
                onConfigChange: (id, newConfig) => {
                  setScrobblerConfigs(prev => ({ ...prev, [id]: newConfig }));
                  // Sync scrobbler config to metaServiceConfigs so the tile reflects connected state
                  if (newConfig?.username) {
                    saveMetaServiceConfig('librefm', {
                      ...metaServiceConfigs['librefm'],
                      enabled: !!newConfig.enabled,
                      username: newConfig.username
                    });
                  } else {
                    // Disconnected - clear meta service config
                    saveMetaServiceConfig('librefm', {
                      ...metaServiceConfigs['librefm'],
                      enabled: false,
                      username: undefined
                    });
                  }
                }
              })
          ),

          // (Amazon Music's settings section died with #1356 M10: its rows are
          // the generic status-capable plugin row above — the plugin's
          // getStatus reply, its Sign in prompt flow and its Sign out.)

          // Local Files settings section: flat rows like the rest of the
          // dialog (SettingRow, Button, ProgressBar); no headings, cards or
          // stats grid of its own.
          selectedResolver.id === 'localfiles' && React.createElement('div', {
            style: { padding: '16px 0', borderTop: '1px solid var(--border-subtle)' }
          },
            React.createElement(SettingRow, { label: 'Watch folders', hint: 'Parachord adds the music in these folders and keeps watching them for changes', style: { padding: 0 } },
              React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: handleAddWatchFolder, disabled: isScanning, 'aria-label': 'Add a watch folder' }, React.createElement(Icons.Plus, { className: 'w-4 h-4' }), 'Add folder')),

            // One row per folder: its path and track count, rescan and remove.
            React.createElement('div', { style: { marginTop: '8px' } },
              watchFolders.length === 0
                ? React.createElement(EmptyState, { compact: true, align: 'start', title: 'No watch folders yet' })
                : watchFolders.map(folder =>
                    React.createElement(SettingRow, {
                      key: folder.path,
                      label: React.createElement('span', { className: 'block truncate', 'data-tooltip': folder.path }, folder.path),
                      hint: countOf(folder.track_count || 0, 'track'),
                      className: 'border-b border-line-light last:border-b-0',
                    },
                      React.createElement('div', { className: 'flex items-center gap-1' },
                        React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Rescan folder', onClick: () => handleRescanFolder(folder.path), disabled: isScanning, 'data-tooltip': 'Rescan folder' }, React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' })),
                        React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': 'Remove folder', onClick: () => handleRemoveWatchFolder(folder.path), 'data-tooltip': 'Remove folder' }, React.createElement(Icons.X, { className: 'w-4 h-4' }))))
                  )
            ),

            // Scan progress (components/progress-bar.js).
            isScanning && React.createElement('div', { style: { marginTop: '12px' } },
              React.createElement('div', { className: 'flex items-center gap-2 text-ink-secondary', style: { fontSize: '13px', marginBottom: '8px' } },
                React.createElement(Icons.Spinner, { className: 'w-4 h-4 text-accent' }), 'Scanning…'),
              React.createElement(ProgressBar, { value: scanProgress.current, max: scanProgress.total, label: 'Scanning folders' }),
              React.createElement('p', { className: 'truncate text-ink-tertiary', style: { fontSize: '11px', marginTop: '6px' } }, scanProgress.file || 'Preparing…')
            ),

            // The library: what's in it and when it was last scanned, then
            // its two actions, each a row of its own.
            React.createElement('div', { style: SYNC_BLOCK },
              React.createElement(SettingRow, {
                label: 'Library',
                hint: React.createElement('span', null,
                  countOf(localFilesStats.totalTracks, 'track'), ' · ',
                  React.createElement('span', { 'data-tooltip': localFilesStats.lastScan ? new Date(localFilesStats.lastScan).toLocaleString() : undefined },
                    localFilesStats.lastScan ? `scanned ${timeAgo(localFilesStats.lastScan)}` : 'not scanned yet')),
                style: { padding: '0 0 10px' },
              },
                React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: handleRescanAll, disabled: isScanning || watchFolders.length === 0 }, 'Rescan all')),
              React.createElement(SettingRow, { label: 'Missing files', hint: 'Remove tracks whose files are no longer on disk', style: { padding: '10px 0 0' } },
                React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: handleRemoveMissingFiles, disabled: isScanning || watchFolders.length === 0, 'aria-label': 'Remove missing files' }, 'Remove')))
          )
        ),
React.createElement('div', {
          className: 'flex items-center justify-between',
          style: {
            padding: '16px 24px',
            backgroundColor: 'var(--hover-bg-default)',
            borderTop: '1px solid var(--border-subtle)'
          }
        },
          // Left side: Remove button (only for user-installed resolvers)
          React.createElement('div', null,
            // Check if this is a user-installed resolver (not built-in core plugins)
            !['spotify', 'localfiles'].includes(selectedResolver.id) &&
              React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: async () => {
                  await handleUninstallResolver(selectedResolver.id);
                  setSelectedResolver(null);
                } }, 'Remove')
          ),
          // Right side: Update button (if available) and Done
          React.createElement('div', { className: 'flex items-center gap-2' },
            // Update button - show if marketplace has newer version
            (() => {
              const marketplaceResolver = marketplaceManifest?.plugins?.find(r => r.id === selectedResolver.id);
              const hasUpdate = marketplaceResolver &&
                marketplaceResolver.version !== selectedResolver.version &&
                marketplaceResolver.version > selectedResolver.version;
              if (hasUpdate) {
                return React.createElement(Button, { variant: 'primary', onClick: async () => {
                    await handleInstallFromMarketplace(marketplaceResolver);
                    setSelectedResolver(null);
                  }, disabled: installingResolvers.has(selectedResolver.id) }, installingResolvers.has(selectedResolver.id) ? 'Updating…' : `Update to v${marketplaceResolver.version}`);
              }
              return null;
            })(),
            // Done only closes: turning a plug-in on is the switch's job
            // (#1498 step 2). The old button said "Enable" or "Done" by a
            // rule nobody could see, and also installed and enabled.
            React.createElement(Button, { variant: 'primary', onClick: () => setSelectedResolver(null) }, 'Done')
          )
        ));
});

module.exports = { PluginSettingsDialog, PLUGIN_SETTINGS_DIALOG_HANDLERS };
