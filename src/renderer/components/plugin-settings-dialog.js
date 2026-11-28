// src/renderer/components/plugin-settings-dialog.js: a plug-in's settings
// dialog, opened from its tile in Settings › Plug-Ins: its sign-in or keys,
// its options (quality, models, scrobbling, sync), enable and remove
// (#1451, moved out of app.js).
//
// A React.memo'd dialog on the shared Modal, fed stable props: state,
// setters, refs, memos, callbacks and playback-hook values by value, plain
// functions through useStableHandlers (PLUGIN_SETTINGS_DIALOG_HANDLERS,
// pinned by tests/renderer/page-memo.test.js). authPort is derived here
// from authServerStatus; window is read only inside handlers.
//
// One layout for every plug-in (CLAUDE.md invariant; #1498): its sections
// are chosen by capability or manifest field, never by the plug-in's id
// (components/plugin-extras.js). What the app itself knows about an account
// it signs in to (Spotify's OAuth, MusicKit, a username) arrives as
// hostAccounts[id], built in app.js; the dialog draws it the same way for
// every plug-in that declares that kind of account.

const Icons = require('./icons');
const PlaybackLimits = require('../lib/playback-limits');
const { SERVICE_LOGOS } = require('./brand-logos');
const { ScrobblerSettingsCard, PluginSettingsPanel } = require('./settings-cards');
const { capabilityLabel, visibleCapabilities } = require('../lib/capability-labels');
const { Modal } = require('./modal');
const { Badge } = require('./badge');
const { Button } = require('./button');
const { NestedSettings, SecretField, Select, SettingRow, StackedField, Switch, TextField } = require('./fields');
const { pluginSwitchState, metadataSwitchState, playbackSwitchState, recommendationsSwitchState, keyLabel } = require('../lib/plugin-switch');
const { ProgressBar } = require('./progress-bar');
const { AccountRow } = require('./account-row');
const { Disclosure } = require('./disclosure');
const { EmptyState, ErrorState } = require('./states');
const { ServiceAccount, ClientKeys, AdvancedKeys, UsernameAccount, LibrarySync, StartupRow, InstallCallout, WatchFolders, PluginSwitches, PlaybackQualityRow, LovedTracks, settingsOf, configurableOf, authTypeOf } = require('./plugin-extras');
const { lovesOf, loveWords, loveRowState } = require('../lib/love-providers');
const { playbackQualityLine } = require('../lib/playback-quality-line');
const { canPromptPlugin } = require('../lib/plugin-sign-in-flow');

const PLUGIN_SETTINGS_DIALOG_HANDLERS = [
  'fetchDynamicModels',
  'getServiceColor',
  'handleAddWatchFolder',
  'handleInstallFromMarketplace',
  'handleRemoveMissingFiles',
  'handleRemoveWatchFolder',
  'handleRescanAll',
  'handleRescanFolder',
  'handleUninstallResolver',
  'promptPluginSignIn',
  'openPlaybackQualitySettings',
  'openSyncSetupModal',
  'refreshPluginStatus',
  'clearMetaServiceConfig',
  'saveMetaServiceConfig',
  'setProviderSyncEnabled',
  'setResolverMetadataOn',
  'setResolverPlaybackOn',
  'setResolverRecommendationsOn',
  'showConfirmDialog',
  'toggleResolver',
];

const PluginSettingsDialog = React.memo(function PluginSettingsDialog(props) {
  const {
    activeResolvers,
    allResolvers,
    audioRef,
    authServerStatus,
    collectionData,
    collectionDataRef,
    currentTrackRef,
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
    hostAccounts,
    hostPlayback,
    pluginAccounts,
    playbackAbr,
    playbackQuality,
    playbackSpatial,
    installingResolvers,
    isScanning,
    localFilesStats,
    loveBackfillProgress,
    loveBackfillRunning,
    loveImportCursorRef,
    loveImportProgress,
    loveImportRunning,
    lovePushedKeysRef,
    promptPluginSignIn,
    openPlaybackQualitySettings,
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
    clearMetaServiceConfig,
    saveMetaServiceConfig,
    scanProgress,
    scrobblerConfigs,
    scrobblerLovePushEnabled,
    selectedResolver,
    setIsPlaying,
    setLovePushEnabled,
    setScrobblerConfigs,
    setSelectedResolver,
    setStopSyncDialog,
    showToast,
    showConfirmDialog,
    toggleResolver,
    watchFolders,
  } = props;
  // The bound local server port (main-process/auth-port.js), 8888 until known.
  const authPort = authServerStatus?.port || 8888;
  // The host's account for this plug-in (app.js hostAccounts), and which
  // account section its manifest asks for (settings.account.type).
  const hostAccount = hostAccounts && hostAccounts[selectedResolver.id];
  const accountType = settingsOf(selectedResolver).account?.type;
  const clientKeys = settingsOf(selectedResolver).clientKeys;
  const caps = selectedResolver.capabilities || {};
  // A plug-in that only scrobbles (Libre.fm): its scrobbler is its account.
  const scrobblingOnly = !!caps.scrobbling && !caps.recommendations;
  // The one on/off switch (lib/plugin-switch.js).
  // What the app knows about its sign-in (#1614, app.js pluginAccounts: the
  // host's own sign-ins with each status plug-in's reply over them). Signed
  // out, Enable and the switches under it read off and locked.
  const signedIn = pluginAccounts ? pluginAccounts[selectedResolver.id] : undefined;
  const switchState = pluginSwitchState({ plugin: selectedResolver, config: metaServiceConfigs[selectedResolver.id], activeResolvers, signedIn });
  // Scrobbling, for a plug-in that does more than scrobble (Last.fm,
  // ListenBrainz): nested under its account (the account comes first, then
  // what needs the sign-in). Whether Enable is on or not: scrobbling is its
  // own sign-in and its own switch, and the loved-tracks import under it
  // needs only a username, so hiding it behind Enable hid the import
  // (Last.fm with recommendations off, 2026-11-23).
  const scrobblingNested = !!caps.scrobbling && !!caps.recommendations;

  // Scrobbling (capabilities.scrobbling). Nested under "Enable X" for a
  // plug-in that does more than scrobble (Last.fm, ListenBrainz): the one
  // part that needs a sign-in, so its sign-in, its switch and the
  // loved-tracks controls sit together, and "Enable X" can be on
  // (recommendations, history) while it's signed out. A scrobbling-only
  // plug-in (Libre.fm) draws the card as its account (standalone), and its
  // sign-in also marks the plug-in set up, so its tile shows it.
  const renderScrobbling = (id, { standalone = false } = {}) => {
    const scrobbler = window.scrobblers && window.scrobblers.find(s => s.id === id);
    if (!scrobbler) return null;
    const configurable = settingsOf(selectedResolver).configurable || selectedResolver.configurable || {};
    return React.createElement(ScrobblerSettingsCard, {
      scrobbler, color: getServiceColor(id) || selectedResolver.color, accountLabel: standalone ? undefined : 'Scrobbling',
      lovedTracks: !!caps.lovedTracks,
      // Where to get a user token, and where to make an account (a
      // password sign-in), from the manifest.
      tokenUrl: configurable.userToken?.helpUrl,
      signUpUrl: selectedResolver.homepage,
      config: scrobblerConfigs[id],
      onConfigChange: (sid, newConfig) => {
        setScrobblerConfigs(prev => ({ ...prev, [sid]: newConfig }));
        if (!standalone) return;
        saveMetaServiceConfig(id, newConfig?.username
          ? { ...metaServiceConfigs[id], enabled: !!newConfig.enabled, username: newConfig.username }
          // Signed out: clear the plug-in's account too.
          : { ...metaServiceConfigs[id], enabled: false, username: undefined });
      },
    });
  };

  // Loves (the manifest's `loves`, lib/love-providers.js, #1559): Import,
  // Push and Send, the same rows for Last.fm, ListenBrainz and a server's
  // stars. What they need (the scrobbling sign-in, a username, the server set
  // up) comes from loveRowState. A username account (Last.fm, ListenBrainz)
  // draws them inside, after Scrobbling and before its Advanced; any other
  // plug-in, after its account, keys and switches.
  const lovedTracksSection = lovesOf(selectedResolver) && (() => {
    const id = selectedResolver.id;
    const loves = lovesOf(selectedResolver);
    const name = selectedResolver.name || id;
    return React.createElement(LovedTracks, {
      key: `${id}-loves`,
      name,
      words: loveWords(loves.verb),
      canImport: loves.canImport,
      state: loveRowState(selectedResolver, { name, scrobblerConfig: scrobblerConfigs[id], pluginConfig: metaServiceConfigs[id], signedIn }),
      pushEnabled: !!scrobblerLovePushEnabled[id],
      onSetPush: (v) => setLovePushEnabled(id, v),
      onImport: () => runLoveImport(id),
      importRunning: !!loveImportRunning[id],
      importProgress: loveImportProgress[id],
      hasImported: !!loveImportCursorRef.current?.[id],
      onSend: () => runLoveBackfill(id),
      sendRunning: !!loveBackfillRunning[id],
      sendProgress: loveBackfillProgress[id],
      unpushedCount: (collectionDataRef.current?.tracks || collectionData.tracks).filter(t => !lovePushedKeysRef.current[t.id]?.[id]).length,
      inAccount: accountType === 'username',
    });
  })();

  // A plug-in that needs a sign-in (a sign-in the app runs, settings.account
  // type 'sign-in'; or one that signs in itself, capabilities.status) can't
  // be turned on until it's signed in (#1614), so its account and keys come
  // first and Enable after them: the dialog reads in the order you do it.
  // Always, signed in or not, so nothing moves after signing in. A plug-in
  // that works without one keeps Enable first (Last.fm's Scrobbling sign-in
  // stays nested under it).
  const accountFirst = (accountType === 'sign-in' && !!hostAccount)
    || (!!selectedResolver?.capabilities?.status && typeof selectedResolver.getStatus === 'function');
  // On/off: the ONE control that turns a plug-in on (#1498 step 2;
  // lib/plugin-switch.js says what it shows for each kind of
  // plug-in). It replaced the music plug-ins' "Use X" switch, the
  // footer's Enable/Done button and the body "Enable X" switches. A
  // plug-in that can't run without a key shows it disabled, saying
  // what to add first.
  const enableSection = (() => {
            const id = selectedResolver.id;
            const state = switchState;
            const meta = metadataSwitchState({ plugin: selectedResolver, active: state.checked, metadataOff: (metadataOffResolvers || []).includes(id), signedIn });
            const recs = recommendationsSwitchState({ plugin: selectedResolver, active: state.checked, recommendationsOff: (recommendationsOffResolvers || []).includes(id), signedIn });
            const play = playbackSwitchState({ plugin: selectedResolver, active: state.checked, playbackOff: (playbackOffResolvers || []).includes(id), limit: playbackLimits && playbackLimits[id], signedIn });
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
              }, React.createElement(Switch, { size: 'sm', checked: meta.checked, disabled: meta.disabled, onToggle: () => setResolverMetadataOn(id, !meta.checked) })),
              // "Use recommendations from X", for a plug-in that offers them (#1505).
              recs.shown && React.createElement(SettingRow, {
                label: `Use recommendations from ${selectedResolver.name}`,
                hint: recs.hint,
                nested: true,
                style: { padding: '6px 0', marginTop: (play.shown || meta.shown) ? '0' : '12px' },
              }, React.createElement(Switch, { size: 'sm', checked: recs.checked, disabled: recs.disabled, onToggle: () => setResolverRecommendationsOn(id, !recs.checked) })));
          })();

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
          // Close button: the shared icon Button, in its tone for a coloured
          // or dark surface (the header is the plug-in's colour).
          React.createElement(Button, { variant: 'icon', tone: 'dark', size: 'sm', 'aria-label': 'Close', onClick: () => setSelectedResolver(null) },
            React.createElement(Icons.X, { className: 'w-4 h-4' }))
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

          !accountFirst && enableSection,

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
                    // A plug-in on the status surface signs in through the
                    // one prompt flow (#1624, lib/plugin-sign-in-flow.js:
                    // "Sign in to X?" with its own tip, single-flight, the
                    // quiet after a Not now); it reads the status again
                    // itself. Any other plug-in's signIn is the window itself.
                    if (canPromptPlugin(selectedResolver)) {
                      await promptPluginSignIn(selectedResolver.id, { explicit: true, reason: 'not-signed-in', forcePrompt: true });
                      return;
                    }
                    await selectedResolver.signIn().catch(() => null);
                    refreshPluginStatus(selectedResolver.id);
                  } : undefined,
              }));
          })(),

          // The account, for a plug-in the app signs in to itself
          // (settings.account.type 'sign-in': Spotify, SoundCloud, Apple
          // Music), with the client keys it signs in with right under it
          // (settings.clientKeys).
          accountType === 'sign-in' && hostAccount && React.createElement(ServiceAccount, {
            key: `${selectedResolver.id}-account`,
            plugin: selectedResolver,
            account: hostAccount,
            color: getServiceColor(selectedResolver.id) || selectedResolver.color,
            keysMissing: !!(clientKeys && hostAccount.keys && (hostAccount.keys.source || 'none') === 'none'),
            keysLabel: clientKeys && clientKeys.label,
          },
            clientKeys && hostAccount.keys && React.createElement(ClientKeys, { plugin: selectedResolver, keys: hostAccount.keys, authPort, showToast })),

          // A plug-in that needs a sign-in: Enable after its account (#1614).
          accountFirst && enableSection,

          // An account read from a username (settings.account.type
          // 'username': Last.fm, ListenBrainz), with its optional keys.
          accountType === 'username' && hostAccount && React.createElement(UsernameAccount, {
            key: `${selectedResolver.id}-username`,
            plugin: selectedResolver,
            config: metaServiceConfigs[selectedResolver.id],
            account: hostAccount,
            color: getServiceColor(selectedResolver.id) || selectedResolver.color,
          },
            // Scrobbling: its own sign-in, its switch and loved tracks,
            // nested under the account it adds to, before Advanced.
            scrobblingNested && React.createElement('div', { 'data-section': 'scrobbling', style: { marginTop: '16px' } },
              React.createElement(NestedSettings, null, renderScrobbling(selectedResolver.id))),
            // Its loves, after Scrobbling (pushing needs that sign-in) and
            // before Advanced.
            lovedTracksSection),

          // What needs the sign-in: library sync (capabilities.librarySync),
          // then opening the service's app at startup (settings.startup).
          selectedResolver.capabilities?.librarySync && React.createElement(LibrarySync, {
            plugin: selectedResolver,
            settings: resolverSyncSettings[selectedResolver.id],
            signedOut: !!(syncSignedOut && syncSignedOut[selectedResolver.id]),
            openSyncSetupModal, setProviderSyncEnabled, setStopSyncDialog,
          }),
          settingsOf(selectedResolver).startup && hostAccount && hostAccount.startup && React.createElement(StartupRow, { plugin: selectedResolver, startup: hostAccount.startup }),

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

          // Username and password (settings.authType 'userpass': Subsonic):
          // its fields in the manifest's order, saved as you leave each one,
          // as flat stacked fields like every plug-in's keys.
          authTypeOf(selectedResolver) === 'userpass' && (() => {
            const configurable = configurableOf(selectedResolver);
            const saved = metaServiceConfigs[selectedResolver.id] || {};
            const saveField = (fieldKey, value) => {
              saveMetaServiceConfig(selectedResolver.id, {
                ...metaServiceConfigs[selectedResolver.id],
                [fieldKey]: value
              });
              delete resolverConfigCache.current[selectedResolver.id];
            };
            // The server first, then the account.
            const fields = Object.entries(configurable).filter(([key, setting]) => setting && key !== 'model')
              .sort(([a], [b]) => (a === 'username' || a === 'password' ? 1 : 0) - (b === 'username' || b === 'password' ? 1 : 0));
            const configured = !!(saved.username && saved.password && (!configurable.serverUrl || saved.serverUrl));
            return React.createElement('div', { style: { padding: '16px 0', borderTop: '1px solid var(--border-subtle)' } },
              ...fields.map(([fieldKey, fieldSetting]) => {
                const secret = fieldSetting.type === 'password' || fieldKey === 'password';
                return React.createElement(StackedField, { key: fieldKey, label: fieldSetting.label || fieldKey, description: fieldSetting.description },
                  React.createElement(secret ? SecretField : TextField, {
                    defaultValue: saved[fieldKey] || fieldSetting.default || '',
                    placeholder: fieldSetting.placeholder || '',
                    autoComplete: fieldKey === 'username' ? 'username' : secret ? 'current-password' : undefined,
                    spellCheck: false,
                    onBlur: (e) => saveField(fieldKey, secret ? e.target.value : e.target.value.trim()),
                    'aria-label': fieldSetting.label || fieldKey,
                    className: 'w-full',
                  }));
              }),
              configured && React.createElement('div', { className: 'flex items-center gap-1 text-ink-success', style: { fontSize: '12px' } },
                React.createElement(Icons.Check, { className: 'w-4 h-4', 'aria-hidden': 'true' }), 'Credentials saved')
            );
          })(),

          // The plug-in's own on/off options (settings.switches: Subsonic's
          // "Report plays to your server", #1546), while it's on: what needs
          // the sign-in, so after the account and its keys (the server and
          // credentials above), nested under them. Saved in its config.
          switchState.checked && React.createElement(PluginSwitches, {
            plugin: selectedResolver,
            config: metaServiceConfigs[selectedResolver.id],
            onSet: (key, on) => {
              saveMetaServiceConfig(selectedResolver.id, { ...metaServiceConfigs[selectedResolver.id], [key]: on });
              delete resolverConfigCache.current[selectedResolver.id];
            },
          }),

          // Loves, for every other plug-in (a server's stars): after its
          // account, its keys and its switches.
          accountType !== 'username' && lovedTracksSection,


          // How its playback quality is set (#1608), while it's on: it follows
          // Settings › General › Playback Quality, or where it's set instead
          // (lib/playback-quality-line.js, by capability and manifest).
          switchState.checked && (() => {
            const line = playbackQualityLine(selectedResolver,
              { quality: playbackQuality, abr: playbackAbr, spatial: playbackSpatial },
              hostPlayback && hostPlayback[selectedResolver.id]);
            return line && React.createElement(PlaybackQualityRow, { line, onOpenSettings: openPlaybackQualitySettings });
          })(),

          // Software the plug-in needs installed first (settings.installCallout: Ollama).
          settingsOf(selectedResolver).installCallout && React.createElement(InstallCallout, { plugin: selectedResolver }),

          // Keys and options from settings.configurable (the AI plug-ins, the
          // concert services, Ollama): one flat section of stacked fields,
          // each with its help under it; no heading of its own.
          // Check both .axe settings and top-level marketplace manifest properties.
          // The resolver loader flattens requiresAuth/authType/configurable onto
          // the resolver object (no .settings wrapper), so fall back to the
          // top-level fields. userpass resolvers (Subsonic) are handled above
          // and must not land here: this block's key is an API key.
          ((selectedResolver.settings?.requiresAuth && selectedResolver.settings?.authType === 'apikey') ||
           (selectedResolver.requiresAuth && selectedResolver.authType === 'apikey') ||
           (selectedResolver.type === 'meta-service' && (selectedResolver.capabilities?.generate || selectedResolver.capabilities?.chat))) && (() => {
            const configurable = selectedResolver.settings?.configurable || selectedResolver.configurable || {};
            // The key's field: the plug-in's secret field (type 'password':
            // the AI plug-ins' apiKey), else for an API-key plug-in its first
            // field that isn't the model (appId, clientId). A plug-in with
            // neither (Ollama) has no key: only its other fields show.
            const authFieldKey = Object.keys(configurable).find(k => configurable[k]?.type === 'password')
              || (((selectedResolver.settings?.authType || selectedResolver.authType) === 'apikey') ? (Object.keys(configurable).find(k => k !== 'model') || 'apiKey') : null);
            const authFieldSettings = (authFieldKey && configurable[authFieldKey]) || {};
            // Where to get a key: the field's helpUrl, else the plug-in's homepage.
            const keyUrl = authFieldSettings.helpUrl || selectedResolver.homepage;
            return React.createElement('div', {
            style: {
              padding: '16px 0',
              borderTop: '1px solid var(--border-subtle)'
            }
          },
            // The key, with its help under it and where to get one.
            authFieldKey && React.createElement(StackedField, {
              label: keyLabel(selectedResolver, authFieldKey),
              // Its help (the manifest's description: never a raw URL), then
              // whether it's saved and where to get one (the HelpLink).
              description: authFieldSettings.description,
              status: metaServiceConfigs[selectedResolver.id]?.[authFieldKey]
                ? React.createElement('span', { className: 'flex items-center gap-1 text-ink-success' },
                    React.createElement(Icons.Check, { className: 'w-4 h-4', 'aria-hidden': 'true' }),
                    `${keyLabel(selectedResolver, authFieldKey)} saved`)
                : null,
              link: { url: keyUrl, label: `Get your ${keyLabel(selectedResolver, authFieldKey)}` },
              style: { marginBottom: '16px' },
            },
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
                }, placeholder: authFieldSettings.placeholder || '', 'aria-label': `${selectedResolver.name} API key`, className: 'w-full' }),
            ),
            // Model selector - supports both static and dynamic-select
            selectedResolver.settings?.configurable?.model && React.createElement(StackedField, {
              label: selectedResolver.settings?.configurable?.model?.label || 'Model',
              style: { marginBottom: '16px' },
              action: selectedResolver.settings?.configurable?.model?.type === 'dynamic-select' && React.createElement(Button, { variant: 'icon', size: 'sm', 'aria-label': "Refresh models", onClick: () => {
                  const resolver = metaServices.find(s => s.id === selectedResolver.id) || selectedResolver;
                  fetchDynamicModels(resolver, metaServiceConfigs[selectedResolver.id]);
                }, 'data-tooltip': 'Refresh models' }, React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' })),
            },
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
                return React.createElement(StackedField, { key: fieldKey, label: fieldSetting.label || fieldKey, description: fieldSetting.description, style: { marginBottom: '16px' } },
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

          // A plug-in that only scrobbles (capabilities.scrobbling without
          // recommendations: Libre.fm): its scrobbler's sign-in is its account.
          scrobblingOnly && React.createElement('div', { style: { padding: '16px 0', borderTop: '1px solid var(--border-subtle)' } },
            renderScrobbling(selectedResolver.id, { standalone: true })),

          // (Amazon Music's settings section died with #1356 M10: its rows are
          // the generic status-capable plugin row above — the plugin's
          // getStatus reply, its Sign in prompt flow and its Sign out.)

          // Watch folders and the library (settings.watchFolders: Local Files).
          settingsOf(selectedResolver).watchFolders && React.createElement(WatchFolders, {
            watchFolders, isScanning, scanProgress, localFilesStats,
            onAddFolder: handleAddWatchFolder, onRescanFolder: handleRescanFolder, onRemoveFolder: handleRemoveWatchFolder,
            onRescanAll: handleRescanAll, onRemoveMissing: handleRemoveMissingFiles,
          }),

          // Advanced, last: the optional keys of a plug-in the app signs in
          // to (configurable fields marked `advanced`: Apple Music's developer
          // token). A username account draws its own, under its fields.
          accountType === 'sign-in' && hostAccount && hostAccount.advanced && React.createElement(AdvancedKeys, {
            key: `${selectedResolver.id}-advanced`,
            plugin: selectedResolver,
            values: hostAccount.advanced.values || {},
            setValue: hostAccount.advanced.setValue,
            saved: !!hostAccount.advanced.saved,
            onSave: hostAccount.advanced.save,
            onClear: hostAccount.advanced.clear,
            justSaved: !!hostAccount.advanced.justSaved,
          })
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
            // A plug-in Parachord can't run without (settings.removable: false
            // in its manifest: Spotify, Local Files) has no Remove.
            settingsOf(selectedResolver).removable !== false &&
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
