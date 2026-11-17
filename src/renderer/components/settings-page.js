// src/renderer/components/settings-page.js: Settings (activeView
// 'settings'): its sidebar (Plug-Ins, General, About) and the three tabs:
// the plug-in marketplace and installed plug-ins with their priority order;
// General's appearance, cache, playback, volume, media keys, Discord, the
// local server port and library sync; About (#1451, the last page moved
// out of app.js).
//
// A React.memo'd page fed stable props, like the other pages: state,
// setters, refs, memos and the volume hook's values by value, plain
// functions through useStableHandlers (SETTINGS_PAGE_HANDLERS, pinned by
// tests/renderer/page-memo.test.js). authPort is derived here from
// authServerStatus. The markup moved as it was; window is read only inside
// handlers.

const Icons = require('./icons');
const PlaybackLimits = require('../lib/playback-limits');
const { BRAND_COLORS } = require('./brand-logos');
const { ResolverIcon, ParachordWordmark } = require('./ui-atoms');
const { ResolverCard, McpSettingsSection, SettingsSection } = require('./settings-cards');
const { FilterChips } = require('./filter-chips');
const { NavItem } = require('./nav-item');
const { Button } = require('./button');
const { HeaderControl } = require('./header-control');
const { RadioGroup, SegmentedChoice, Select, SettingRow, Slider, Switch, TextField } = require('./fields');
const { EmptyState, ErrorState } = require('./states');
const { priorityMoves } = require('../lib/priority-order');
const { pluginMatchesQuery } = require('../lib/plugin-search');
const { pluginSwitchState } = require('../lib/plugin-switch');
const { DISCORD_PRESENCE_STATUS_LABELS, discordPresenceStatusTone } = require('../lib/discord-presence-status');

// Raycast's brand colour and gradient (its extension's info card).
const RAYCAST_COLOR = BRAND_COLORS.raycast;
const RAYCAST_GRADIENT = BRAND_COLORS.raycastGradient;

const SETTINGS_PAGE_HANDLERS = [
  'confirmAsync',
  'copyParachordLink',
  'handleCleanupDuplicatePlaylists',
  'handleInstallResolver',
  'handleResolverDragEnd',
  'handleResolverDragEnter',
  'handleResolverDragLeave',
  'handleResolverDragOver',
  'handleResolverDragStart',
  'handleResolverDrop',
  'handleThemeChange',
  'loadMarketplaceManifest',
  'navigateBack',
  'openSyncSetupModal',
  'revertNwayMigration',
  'showConfirmDialog',
  'startNwayMigration',
];

const SettingsPage = React.memo(function SettingsPage(props) {
  const {
    activeResolvers,
    albumArtCache,
    albumToReleaseIdCache,
    allResolvers,
    appVersion,
    appleMusicConnected,
    artistDataCache,
    artistImageCache,
    authPortInput,
    authServerStatus,
    cleanupDuplicatesState,
    confirmAsync,
    copyParachordLink,
    currentTrack,
    discordPresenceEnabled,
    discordPresenceState,
    dragOverResolver,
    draggedResolver,
    handleCleanupDuplicatePlaylists,
    handleInstallResolver,
    handleResolverDragEnd,
    handleResolverDragEnter,
    handleResolverDragLeave,
    handleResolverDragOver,
    handleResolverDragStart,
    handleResolverDrop,
    handleThemeChange,
    homeSetupDismissed,
    homeSuggestionsAutoRefresh,
    homeSuggestionsAutoRefreshRef,
    installingResolvers,
    loadMarketplaceManifest,
    loadedResolvers,
    marketplaceCategory,
    marketplaceError,
    marketplaceLoading,
    marketplaceManifest,
    marketplaceSearchQuery,
    mediaKeyMode,
    metaServiceConfigs,
    metaServices,
    navigateBack,
    nwayEngineMode,
    openSyncSetupModal,
    planBlockedResolverIds,
    playbackAbr,
    playbackLimits,
    playbackQuality,
    playbackSpatial,
    pluginStatuses,
    pluginsFilter,
    releaseDetailsCache,
    rememberQueue,
    resolverOrder,
    resolverSyncSettings,
    resolverVolumeOffsets,
    revertNwayMigration,
    scrobblingEnabled,
    setAuthPortInput,
    setAuthServerStatus,
    setDiscordPresenceEnabled,
    setDiscordPresenceState,
    setExtensionInfoOpen,
    setFirstRunTutorial,
    setHomeSetupDismissed,
    setHomeSuggestionsAutoRefresh,
    setMarketplaceCategory,
    setMarketplaceSearchQuery,
    setMediaKeyMode,
    setPlaybackAbr,
    setPlaybackQuality,
    setPlaybackSpatial,
    setPluginsFilter,
    setRaycastInfoOpen,
    setRememberQueue,
    setResolverVolumeOffsets,
    setScrobblingEnabled,
    setSelectedResolver,
    setSettingsTab,
    setShowDiscoveryBadges,
    setSkipExternalPrompt,
    setSkipUnplayablePrompt,
    setSkipUnsavedFriendWarning,
    setUiZoom,
    settingsTab,
    showConfirmDialog,
    showDiscoveryBadges,
    showToast,
    skipExternalPrompt,
    skipUnplayablePrompt,
    skipUnsavedFriendWarning,
    soundcloudConnected,
    spotifyConnected,
    startNwayMigration,
    syncProviderConfig,
    themePref,
    uiZoom,
    watchFolders,
  } = props;
  // The bound local server port (main-process/auth-port.js), 8888 until known.
  const authPort = authServerStatus?.port || 8888;
  return React.createElement('div', {
          className: 'flex flex-col h-full'
        },
          // Header bar with SETTINGS title and CLOSE button - refined styling
          React.createElement('div', {
            className: 'flex items-center justify-between px-8 py-4 flex-shrink-0',
            style: {
              borderBottom: '1px solid var(--border-subtle)',
              backgroundColor: 'var(--bg-secondary)'
            }
          },
            React.createElement('h1', {
              // The page's heading (#1386), drawn as the small header label.
              style: {
                margin: 0,
                fontSize: '11px',
                fontWeight: '600',
                letterSpacing: '0.08em',
                color: 'var(--text-tertiary)',
                textTransform: 'uppercase'
              },
              onContextMenu: copyParachordLink
            }, 'Settings'),
            React.createElement(HeaderControl, { close: true, onClick: () => navigateBack() }, 'Close')
          ),
          // Wrapper for sidebar and content
          React.createElement('div', { className: 'flex flex-1 overflow-hidden' },
            // Settings vertical tabs (left side) - refined styling
            React.createElement('div', {
              className: 'flex-shrink-0',
              style: {
                width: '200px',
                borderRight: '1px solid var(--border-subtle)',
                padding: '24px 0',
                backgroundColor: 'var(--bg-secondary)'
              }
            },
              React.createElement('nav', { 'aria-label': 'Settings sections', style: { padding: '0 12px' } },
              // The sidebar's nav item (components/nav-item.js), in the accent:
              // Settings had its own look with a left bar.
              ...[['plugins', 'Plug-Ins'], ['general', 'General'], ['about', 'About']].map(([tab, label]) =>
                React.createElement(NavItem, { key: tab, page: 'home', label, active: settingsTab === tab, onClick: () => setSettingsTab(tab) }))
            )
          ),
          // Settings content area (right side) - refined styling
          React.createElement('div', {
            className: 'flex-1 overflow-y-auto scrollable-content scroll-edge',
            style: { padding: '32px 0 32px 40px' }
          },
            // Unified Plug-Ins Tab
            settingsTab === 'plugins' && React.createElement('div', { style: { paddingRight: '40px' } },
              // Page Header with Add button
              React.createElement('div', {
                className: 'flex items-center justify-between',
                style: { marginBottom: '24px' }
              },
                React.createElement('div', null,
                  React.createElement('h2', {
                    style: {
                      fontSize: '20px',
                      fontWeight: '600',
                      color: 'var(--text-primary)',
                      marginBottom: '6px'
                    }
                  }, 'Plug-Ins'),
                  React.createElement('p', {
                    style: {
                      fontSize: '13px',
                      color: 'var(--text-secondary)'
                    }
                  },
                    'Discover, install, and manage plug-ins for playback and services.'
                  )
                ),
                // Add from file button
                React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: handleInstallResolver }, React.createElement(Icons.FilePlus, { className: 'w-4 h-4' }), 'Add from file')
              ),

              // How Plug-Ins works (#1387: replaced a developer-facing
              // architecture card).
              React.createElement('div', {
                className: 'rounded-xl border border-line bg-surface-inset',
                style: { padding: '16px', marginBottom: '24px' }
              },
                // As many columns as fit (three in a wide window, one stacked at
                // the 1000px minimum), measured on the panel, not the window.
                React.createElement('ul', { className: 'grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', listStyle: 'none', margin: 0, padding: 0 } },
                  [
                    [Icons.Music, 'Turn on the services you use. The numbers are the order Parachord tries them in; drag a tile to change it.'],
                    [Icons.Settings, 'Open a tile to sign in or set it up. Some services also need a developer key.'],
                    [Icons.AlertTriangle, 'Install only plug-ins you trust: they run with the same access as Parachord.']
                  ].map(([Icon, text], i) => React.createElement('li', { key: i, className: 'flex items-start gap-2' },
                    React.createElement(Icon, { className: 'w-4 h-4 text-accent flex-shrink-0', style: { marginTop: '2px' } }),
                    React.createElement('span', { className: 'text-ink-secondary', style: { fontSize: '13px', lineHeight: 1.5 } }, text)
                  ))
                )
              ),

              // Search and filter bar
              React.createElement('div', { className: 'flex flex-col gap-3 mb-6' },
                // Top row: Search input
                // The shared text field (components/fields.js), a pill with the search glyph.
                React.createElement(TextField, {
                  pill: true,
                  icon: React.createElement(Icons.Search, { className: 'w-4 h-4' }),
                  wrapClassName: 'w-64',
                  placeholder: 'Search plug-ins…',
                  value: marketplaceSearchQuery,
                  onChange: setMarketplaceSearchQuery,
                  'aria-label': 'Search plug-ins'
                }),
                // Bottom row: Dropdown + Category pills together
                React.createElement('div', { className: 'flex items-center gap-3 flex-wrap' },
                  // Install status dropdown filter
                  React.createElement(Select, { 'aria-label': 'Filter plug-ins', value: pluginsFilter, onChange: (_v, e) => setPluginsFilter(e.target.value), options: [{ value: 'all', label: 'All plug-ins' }, { value: 'installed', label: 'Installed' }, { value: 'available', label: 'Available' }], style: { minWidth: '120px' } }),
                  // Category filters: the app's filter chips (FilterChips); a
                  // category has no colour, so every chip is neutral.
                  React.createElement(FilterChips, {
                    chips: [
                      { id: 'all', label: 'All' },
                      { id: 'streaming', label: 'Streaming' },
                      { id: 'social', label: 'Social' },
                      { id: 'metadata', label: 'Metadata' },
                      { id: 'concerts', label: 'Concerts' },
                      { id: 'ai', label: 'AI' },
                      { id: 'local', label: 'Local' }
                    ],
                    value: marketplaceCategory,
                    onChange: setMarketplaceCategory,
                    label: 'Filter plugins by category'
                  })
                )
              ),

              // Loading state — skeleton grid that mirrors the ResolverCard
              // layout (120×120 rounded-16 card + name bar below) in the same
              // grid columns, so the page doesn't reflow when real cards land.
              // Uses the shared shimmer-light + animate-shimmer classes with a
              // staggered delay (matches the search-page skeletons).
              marketplaceLoading && React.createElement('div', {
                className: 'tile-grid gap-6'
              },
                ...Array(10).fill(null).map((_, i) =>
                  React.createElement('div', {
                    key: `plugin-skeleton-${i}`,
                    className: 'flex flex-col items-center'
                  },
                    React.createElement('div', {
                      className: 'shimmer-light animate-shimmer',
                      style: {
                        width: '120px',
                        height: '120px',
                        borderRadius: '16px',
                        backgroundSize: '200% 100%',
                        animationDelay: `${i * 80}ms`
                      }
                    }),
                    React.createElement('div', {
                      className: 'shimmer-light animate-shimmer rounded',
                      style: {
                        width: '64px',
                        height: '13px',
                        marginTop: '10px',
                        backgroundSize: '200% 100%',
                        animationDelay: `${i * 80 + 50}ms`
                      }
                    })
                  )
                )
              ),

              !marketplaceLoading && marketplaceError && React.createElement('div', { style: { marginBottom: '24px' } },
                React.createElement(ErrorState, {
                  title: 'Couldn’t load the plug-in marketplace',
                  body: 'Your installed plug-ins still work. Check your connection, then try again.',
                  onRetry: () => loadMarketplaceManifest()
                })
              ),

              // Content Resolvers Section
              !marketplaceLoading && React.createElement('div', { style: { marginBottom: '40px' } },
                React.createElement('div', { style: { marginBottom: '16px' } },
                  React.createElement('h3', {
                    style: {
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em'
                    }
                  }, 'Music Plug-Ins'),
                  React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-tertiary)',
                      marginTop: '4px'
                    }
                  },
                    'Drag installed plug-ins to reorder playback priority'
                  )
                ),
                // Resolver grid - combines installed and marketplace
                React.createElement('div', {
                  className: 'tile-grid gap-6'
                },
                  (() => {
                    // Get all content resolvers from marketplace (non-meta-service)
                    const marketplaceContentResolvers = (marketplaceManifest?.plugins || [])
                      .filter(r => r.type !== 'meta-service');

                    // Build unified list: installed resolvers + marketplace-only resolvers
                    const unifiedResolvers = [];

                    // First, add installed resolvers in order. One that can't
                    // play on the account's plan (#1220) has no playback
                    // priority: it gets no number, doesn't take one, and is
                    // shown after the numbered ones, before the inactive ones.
                    // Display only — resolverOrder keeps its slot, so an
                    // upgrade puts it back where it was.
                    const installedInOrder = resolverOrder.filter(resolverId => allResolvers.some(r => r.id === resolverId));
                    const playingInOrder = installedInOrder.filter(resolverId => !planBlockedResolverIds.includes(resolverId));
                    const planBlockedInOrder = installedInOrder.filter(resolverId => planBlockedResolverIds.includes(resolverId));
                    [...playingInOrder, ...planBlockedInOrder].forEach((resolverId, index) => {
                        const resolver = allResolvers.find(r => r.id === resolverId);
                        const marketplaceResolver = marketplaceContentResolvers.find(r => r.id === resolver.id);
                        unifiedResolvers.push({
                          ...resolver,
                          isInstalled: true,
                          priorityNumber: index < playingInOrder.length ? index + 1 : null,
                          marketplaceData: marketplaceResolver,
                          hasUpdate: marketplaceResolver && marketplaceResolver.version > resolver.version
                        });
                      });

                    // Then, add all other resolvers (loaded but not enabled + marketplace-only)
                    // User sees no distinction - they're all just "Available"
                    // Only track IDs actually added above (not all of resolverOrder) so that
                    // resolvers in resolverOrder but not in allResolvers still appear from marketplace
                    const addedIds = new Set(unifiedResolvers.map(r => r.id));

                    // Loaded but not active (no priority number - only active resolvers have priority)
                    allResolvers.forEach(resolver => {
                      if (resolver.capabilities?.resolve && !addedIds.has(resolver.id)) {
                        const marketplaceResolver = marketplaceContentResolvers.find(r => r.id === resolver.id);
                        unifiedResolvers.push({
                          ...resolver,
                          priorityNumber: null,
                          marketplaceData: marketplaceResolver,
                          hasUpdate: marketplaceResolver && marketplaceResolver.version > resolver.version
                        });
                        addedIds.add(resolver.id);
                      }
                    });

                    // Marketplace-only (not yet downloaded)
                    marketplaceContentResolvers.forEach(resolver => {
                      if (!addedIds.has(resolver.id)) {
                        unifiedResolvers.push({
                          ...resolver,
                          priorityNumber: null,
                          marketplaceData: resolver,
                          hasUpdate: false
                        });
                        addedIds.add(resolver.id);
                      }
                    });

                    // Apply filters
                    return unifiedResolvers
                      .filter(resolver => {
                        // Search filter
                        if (marketplaceSearchQuery) {
                          if (!pluginMatchesQuery(resolver, marketplaceSearchQuery)) return false;
                        }
                        // Install status filter
                        const isEnabled = activeResolvers.includes(resolver.id);
                        if (pluginsFilter === 'installed' && !isEnabled) return false;
                        if (pluginsFilter === 'available' && isEnabled) return false;
                        // Category filter
                        if (marketplaceCategory !== 'all') {
                          const category = resolver.category || resolver.marketplaceData?.category;
                          const tags = resolver.tags || resolver.marketplaceData?.tags || [];
                          const matchesCategory = category === marketplaceCategory;
                          const matchesTag = tags.includes(marketplaceCategory);
                          if (!matchesCategory && !matchesTag) return false;
                        }
                        return true;
                      })
                      .map(resolver => {
                        const isActive = activeResolvers.includes(resolver.id);
                        const isInstalling = installingResolvers.has(resolver.id);
                        const isLoaded = allResolvers.some(r => r.id === resolver.id);

                        // Determine if enabled resolver needs configuration
                        let needsConfiguration = false;
                        if (isActive) {
                          if (resolver.id === 'spotify' && !spotifyConnected) {
                            needsConfiguration = true;
                          } else if (resolver.id === 'applemusic' && !appleMusicConnected) {
                            needsConfiguration = true;
                          } else if (resolver.id === 'soundcloud' && !soundcloudConnected) {
                            needsConfiguration = true;
                          } else if (resolver.id === 'amazonmusic' && pluginStatuses.amazonmusic && pluginStatuses.amazonmusic.signedIn === false) {
                            // The plugin's status reply (capabilities.status,
                            // #1356 M10). Unknown status (not fetched yet, or
                            // the plugin threw and answered null) is not
                            // flagged — no verdict is the safe reading.
                            needsConfiguration = true;
                          } else if (resolver.id === 'localfiles' && watchFolders.length === 0) {
                            needsConfiguration = true;
                          } else {
                            // A plugin that knows its own config shape (Subsonic,
                            // ...) answers isConfigured(config) from its .axe.
                            const loadedForConfig = allResolvers.find(r => r.id === resolver.id);
                            if (typeof loadedForConfig?.isConfigured === 'function') {
                              try { needsConfiguration = !loadedForConfig.isConfigured(metaServiceConfigs[resolver.id] || {}); } catch (e) { /* treat as configured */ }
                            }
                          }
                        }

                        // Amazon signed in but not on Music Unlimited: set up,
                        // but it plays nothing (#1220). The tooltip says why.
                        // Only resolvers with a playback priority can be dragged
                        // or dropped on: a plan-blocked one sits outside the
                        // numbered order (#1220), so its slot isn't a position.
                        const reorderable = isActive && !planBlockedResolverIds.includes(resolver.id);
                        // Enabled but limited by the account's plan: the label
                        // and its tooltip come from the resolver's limit.
                        const planStatus = isActive ? PlaybackLimits.tileStatus(playbackLimits, resolver.id) : { statusLabel: null, statusTitle: null };

                        return React.createElement(ResolverCard, {
                          key: resolver.id,
                          resolver: resolver,
                          isActive: isActive,
                          hasUpdate: resolver.hasUpdate,
                          needsConfiguration: needsConfiguration,
                          statusLabel: planStatus.statusLabel,
                          statusTitle: planStatus.statusTitle,
                          priorityNumber: resolver.priorityNumber,
                          isInstalling: isInstalling,
                          draggable: reorderable,
                          isDragging: draggedResolver === resolver.id,
                          isDragOver: dragOverResolver === resolver.id,
                          onClick: () => {
                            // Always open config modal - use loaded resolver data if available
                            const loadedResolver = allResolvers.find(r => r.id === resolver.id);
                            setSelectedResolver(loadedResolver || resolver);
                          },
                          onDragStart: reorderable ? (e) => handleResolverDragStart(e, resolver.id) : undefined,
                          onDragOver: reorderable ? handleResolverDragOver : undefined,
                          onDragEnter: reorderable ? (e) => handleResolverDragEnter(e, resolver.id) : undefined,
                          onDragLeave: reorderable ? handleResolverDragLeave : undefined,
                          onDrop: reorderable ? (e) => handleResolverDrop(e, resolver.id) : undefined,
                          onDragEnd: reorderable ? handleResolverDragEnd : undefined,
                          onContextMenu: isActive ? (e) => {
                            e.preventDefault();
                            if (window.electron?.resolvers?.showContextMenu) {
                              const isNumbered = (id) => activeResolvers.includes(id) && !planBlockedResolverIds.includes(id);
                              window.electron.resolvers.showContextMenu(resolver.id, priorityMoves(resolverOrder, resolver.id, isNumbered));
                            }
                          } : undefined
                        });
                      });
                  })()
                )
              ),

              // Meta Services Section
              !marketplaceLoading && React.createElement('div', null,
                React.createElement('div', { style: { marginBottom: '16px' } },
                  React.createElement('h3', {
                    style: {
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em'
                    }
                  }, 'Other Plug-Ins'),
                  React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-tertiary)',
                      marginTop: '4px'
                    }
                  },
                    'Services for recommendations, metadata, and AI features'
                  )
                ),
                // Meta services grid - combines installed and marketplace
                React.createElement('div', {
                  className: 'tile-grid gap-6'
                },
                  (() => {
                    // Get all meta services from marketplace
                    const marketplaceMetaServices = (marketplaceManifest?.plugins || [])
                      .filter(r => r.type === 'meta-service');

                    // Build unified list
                    const unifiedServices = [];

                    // First, add installed meta services
                    metaServices.forEach(service => {
                      const marketplaceService = marketplaceMetaServices.find(r => r.id === service.id);
                      unifiedServices.push({
                        ...service,
                        isInstalled: true,
                        marketplaceData: marketplaceService,
                        hasUpdate: marketplaceService && marketplaceService.version > service.version
                      });
                    });

                    // Then, add marketplace-only meta services (not yet downloaded)
                    const addedServiceIds = new Set(metaServices.map(s => s.id));
                    marketplaceMetaServices.forEach(service => {
                      if (!addedServiceIds.has(service.id)) {
                        unifiedServices.push({
                          ...service,
                          isInstalled: false,
                          marketplaceData: service,
                          hasUpdate: false
                        });
                        addedServiceIds.add(service.id);
                      }
                    });

                    // Apply filters
                    return unifiedServices
                      .filter(service => {
                        // Search filter
                        if (marketplaceSearchQuery) {
                          if (!pluginMatchesQuery(service, marketplaceSearchQuery)) return false;
                        }
                        // Install status filter - based on active state, not loaded state
                        const isServiceEnabled = pluginSwitchState({ plugin: service, config: metaServiceConfigs[service.id] }).checked;
                        if (pluginsFilter === 'installed' && !isServiceEnabled) return false;
                        if (pluginsFilter === 'available' && isServiceEnabled) return false;
                        // Category filter
                        if (marketplaceCategory !== 'all') {
                          const category = service.category || service.marketplaceData?.category;
                          const tags = service.tags || service.marketplaceData?.tags || [];
                          const matchesCategory = category === marketplaceCategory;
                          const matchesTag = tags.includes(marketplaceCategory);
                          if (!matchesCategory && !matchesTag) return false;
                        }
                        return true;
                      })
                      .map(service => {
                        const isInstalling = installingResolvers.has(service.id);
                        const config = metaServiceConfigs[service.id];

                        // On or off is the dialog switch's rule (lib/plugin-switch.js),
                        // so a tile and its dialog never disagree: Discogs and
                        // Wikipedia read on here and off in the dialog (2026-11-17).
                        // Only "needs setting up" is decided here.
                        let needsConfiguration = false;
                        const isServiceActive = pluginSwitchState({ plugin: service, config }).checked;
                        const isAiService = service.capabilities?.generate || service.capabilities?.chat;
                        if (isAiService) {
                          const hasApiKey = !!config?.apiKey;
                          const isExplicitlyEnabled = config?.enabled === true;
                          if ((hasApiKey || isExplicitlyEnabled) && !hasApiKey && service.settings?.requiresAuth) {
                            needsConfiguration = true;
                          }
                        } else if (service.id === 'lastfm') {
                          needsConfiguration = !config?.username;
                        } else if (service.id === 'listenbrainz' || service.id === 'librefm') {
                          const isEnabled = !!config?.enabled || !!config?.username;
                          needsConfiguration = isEnabled && !config?.username;
                        } else if (service.capabilities?.concerts) {
                          // Concert services (Bandsintown, Songkick, SeatGeek): require API key
                          const hasApiKey = !!(config?.apiKey || config?.appId || config?.clientId);
                          const isExplicitlyEnabled = config?.enabled === true;
                          if ((hasApiKey || isExplicitlyEnabled) && !hasApiKey && service.settings?.requiresAuth) {
                            needsConfiguration = true;
                          }
                        }

                        return React.createElement(ResolverCard, {
                          key: service.id,
                          resolver: service,
                          isActive: isServiceActive,
                          hasUpdate: service.hasUpdate,
                          needsConfiguration: needsConfiguration,
                          isInstalling: isInstalling,
                          onClick: () => {
                            // Always open config modal
                            const loadedService = metaServices.find(s => s.id === service.id);
                            setSelectedResolver(loadedService || service);
                          }
                        });
                      });
                  })()
                )
              ),

              // Extensions Section
              !marketplaceLoading && React.createElement('div', { style: { marginTop: '40px' } },
                React.createElement('div', { style: { marginBottom: '16px' } },
                  React.createElement('h3', {
                    style: {
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em'
                    }
                  }, 'Extensions'),
                  React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-tertiary)',
                      marginTop: '4px'
                    }
                  },
                    'Browser extensions and companion apps'
                  )
                ),
                // Extensions grid
                React.createElement('div', {
                  className: 'tile-grid gap-6'
                },
                  // Browser Extension tile
                  React.createElement('div', {
                    className: 'flex flex-col items-center'
                  },
                    React.createElement('button', { type: 'button', 'aria-label': 'About the browser extension',
                      className: 'relative flex items-center justify-center cursor-pointer transition-transform hover:scale-105',
                      style: {
                        width: '120px',
                        height: '120px',
                        borderRadius: '16px',
                        background: 'linear-gradient(135deg, var(--accent-primary) 0%, var(--accent-soft) 100%)',
                        boxShadow: 'var(--shadow-tile)'
                      },
                      onClick: () => setExtensionInfoOpen(true)
                    },
                      // Browser icon
                      React.createElement(Icons.AppWindow, { className: 'w-12 h-12', strokeWidth: 1.5, style: { color: 'var(--on-accent)' } }),
                      // Info badge
                      React.createElement('div', {
                        className: 'absolute flex items-center justify-center',
                        style: {
                          top: '8px',
                          right: '8px',
                          width: '22px',
                          height: '22px',
                          backgroundColor: 'var(--on-color-chip)',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: 'var(--accent-primary)'
                        }
                      }, 'i')
                    ),
                    // Name below card
                    React.createElement('span', {
                      style: {
                        marginTop: '10px',
                        fontSize: '13px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        textAlign: 'center',
                        width: '120px'
                      }
                    }, 'Browser Extension')
                  ),

                  // Raycast Extension tile
                  React.createElement('div', {
                    className: 'flex flex-col items-center'
                  },
                    React.createElement('button', { type: 'button', 'aria-label': 'About the Raycast extension',
                      className: 'relative flex items-center justify-center cursor-pointer transition-transform hover:scale-105',
                      style: {
                        width: '120px',
                        height: '120px',
                        borderRadius: '16px',
                        background: RAYCAST_GRADIENT,
                        boxShadow: 'var(--shadow-tile)'
                      },
                      onClick: () => setRaycastInfoOpen(true)
                    },
                      // Raycast icon (simplified lightning bolt)
                      React.createElement(Icons.Zap, { className: 'w-12 h-12', style: { color: 'white' }, fill: 'currentColor' }),
                      // Info badge
                      React.createElement('div', {
                        className: 'absolute flex items-center justify-center',
                        style: {
                          top: '8px',
                          right: '8px',
                          width: '22px',
                          height: '22px',
                          backgroundColor: 'var(--on-color-chip)',
                          borderRadius: '6px',
                          fontSize: '12px',
                          fontWeight: '600',
                          color: RAYCAST_COLOR
                        }
                      }, 'i')
                    ),
                    // Name below card
                    React.createElement('span', {
                      style: {
                        marginTop: '10px',
                        fontSize: '13px',
                        fontWeight: '500',
                        color: 'var(--text-primary)',
                        textAlign: 'center',
                        width: '120px'
                      }
                    }, 'Raycast Extension')
                  )
                )
              )
            ),

            // General Tab - refined styling
            settingsTab === 'general' && React.createElement('div', { style: { paddingRight: '40px' } },
              // Page Header - refined
              React.createElement('div', { style: { marginBottom: '32px' } },
                React.createElement('h2', {
                  style: {
                    fontSize: '20px',
                    fontWeight: '600',
                    color: 'var(--text-primary)',
                    marginBottom: '6px'
                  }
                }, 'General'),
                React.createElement('p', {
                  style: {
                    fontSize: '13px',
                    color: 'var(--text-secondary)'
                  }
                },
                  'Configure application settings and preferences.'
                )
              ),

              // Settings sections - refined
              React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '24px' } },
                // Appearance Section
                React.createElement(SettingsSection, { title: 'Appearance', description: 'Choose your color theme and how big things are' },
                  React.createElement(SegmentedChoice, {
                    label: 'Theme',
                    options: [
                      { value: 'light', label: 'Light', icon: '\u2600\uFE0F' },
                      { value: 'dark', label: 'Dark', icon: '\uD83C\uDF19' },
                      { value: 'system', label: 'System', icon: '\uD83D\uDCBB' }
                    ],
                    value: themePref,
                    onChange: (v) => handleThemeChange(v)
                  }),
                  // The window's size: text, art and controls together
                  // (main-process/ui-zoom.js). View › Zoom In / Out step it.
                  React.createElement(SettingRow, { label: 'Size', hint: 'Makes text, art and controls bigger or smaller together. View › Zoom In and Zoom Out change it too.', style: { marginTop: '12px' } },
                    React.createElement(Select, {
                      value: String(uiZoom),
                      onChange: (v) => { const z = Number(v); setUiZoom(z); window.electron?.ui?.setZoom(z); },
                      options: [
                        { value: '0.9', label: 'Small (90%)' },
                        { value: '1', label: 'Default (100%)' },
                        { value: '1.1', label: 'Large (110%)' },
                        { value: '1.25', label: 'Larger (125%)' },
                        { value: '1.5', label: 'Largest (150%)' }
                      ]
                    }))),
                // Cache Management Section - refined card
                React.createElement(SettingsSection, { title: 'Cache Management', description: 'Clear cached data to free up space or fix display issues' },
React.createElement(SettingRow, { label: 'Clear cache', hint: 'Removes cached artist images, album art and service responses. Pages load more slowly until they’re fetched again.' },
                  React.createElement(Button, { variant: 'destructive', size: 'sm', className: 'flex-shrink-0', onClick: () => showConfirmDialog({
                      // It can't be undone, so it asks first (it cleared on one click).
                      title: 'Clear cache?',
                      message: 'Cached artist images, album art and service responses are removed. Pages load more slowly until they’re fetched again.',
                      confirmLabel: 'Clear cache',
                      destructive: true,
                      onConfirm: async () => {
                      // Clear all caches
                      artistImageCache.current = {};
                      albumArtCache.current = {};
                      artistDataCache.current = {};
                      albumToReleaseIdCache.current = {};
                      releaseDetailsCache.current = {};

                      // Clear persisted caches
                      if (window.electron?.store) {
                        await window.electron.store.set('cache_artist_images', {});
                        await window.electron.store.set('cache_album_art', {});
                        await window.electron.store.set('cache_artist_data', {});
                        await window.electron.store.set('cache_album_release_ids', {});
                        await window.electron.store.set('cache_release_details', {});
                      }

                      showToast('Cache cleared');
                    } }) }, React.createElement(Icons.Trash2, { className: 'w-4 h-4' }), 'Clear cache'))),

                // Playback Quality Section (global for Widevine/stream resolvers)
                React.createElement(SettingsSection, {
                  key: 'playback-quality-section',
                  title: 'Playback Quality',
                  description: 'Amazon Music and Apple Music use these settings right now. Other services choose their own quality.'
                },
                  React.createElement(SettingRow, { label: 'Quality', hint: 'Apple Music has two levels: Data saver plays its lower bitrate, every other level its best. When Apple Music plays through macOS, the Music app’s quality setting applies instead.' },
React.createElement(Select, { value: playbackQuality, onChange: (v) => setPlaybackQuality(v), options: [{ value: 'max', label: 'Max (best available, lossless where playable)' }, { value: 'high', label: 'High (up to 500 kbps)' }, { value: 'standard', label: 'Standard (up to 200 kbps)' }, { value: 'saver', label: 'Data saver (up to 100 kbps)' }] })),
                  React.createElement(SettingRow, { label: 'Adjust to your connection', hint: 'Amazon Music only. Lowers quality when your connection is slow, never above the level you chose.' },
                    React.createElement(Switch, { checked: playbackAbr === true, onToggle: () => setPlaybackAbr(playbackAbr !== true) })
                  ),
                  React.createElement(SettingRow, { label: 'Prefer Dolby Atmos mixes', hint: 'Amazon Music only. Plays the 5.1 core of a track’s Atmos mix when there is one. This isn’t full Atmos: it’s mixed down on stereo output, and it plays instead of lossless FLAC when quality is Max.' },
                    React.createElement(Switch, { checked: playbackSpatial === true, onToggle: () => setPlaybackSpatial(playbackSpatial !== true) })
                  )
                ),

                // Volume Normalization Section - refined card
                React.createElement(SettingsSection, { title: 'Volume Normalization', description: 'Balance loudness between different sources' },
React.createElement('p', {
                    style: {
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '24px',
                      lineHeight: '1.6'
                    }
                  }, 'Adjust each plug-in’s volume to balance loudness. Negative values reduce volume for louder sources.'),
React.createElement('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                    // Filter to only show content resolvers (have resolve capability) that are enabled
                    loadedResolvers
                      .filter(r => r.capabilities?.resolve && activeResolvers.includes(r.id))
                      .map(resolver => {
                        // Resolvers where in-app volume control is not available
                        const isVolumeDisabled = (!resolver.capabilities?.stream && !resolver.capabilities?.embedPlayer) || resolver.id === 'applemusic';
                        const disabledReason = resolver.id === 'applemusic' ? 'System vol' : 'Browser';
                        const offset = resolverVolumeOffsets[resolver.id] || 0;

                        return React.createElement('div', {
                          key: resolver.id,
                          className: 'flex items-center gap-4 transition-colors',
                          style: {
                            padding: '10px 12px',
                            borderRadius: '8px',
                            backgroundColor: 'var(--hover-bg-default)',
                            opacity: isVolumeDisabled ? 0.5 : 1
                          }
                        },
                          React.createElement('span', {
                            style: {
                              width: '100px',
                              fontSize: '13px',
                              fontWeight: '500',
                              color: isVolumeDisabled ? 'var(--text-tertiary)' : 'var(--text-primary)'
                            }
                          }, resolver.name),
                          React.createElement(Slider, {
                            min: -12,
                            max: 6,
                            step: 1,
                            value: offset,
                            onChange: (v) => setResolverVolumeOffsets(prev => ({ ...prev, [resolver.id]: v })),
                            className: 'flex-1',
                            disabled: isVolumeDisabled,
                            'aria-valuetext': `${offset > 0 ? '+' : ''}${offset} dB`,
                            'aria-label': isVolumeDisabled ? (resolver.id === 'applemusic' ? 'Use system volume to control Apple Music' : 'Browser playback - volume control not available') : `${resolver.name} volume`, 'data-tooltip': isVolumeDisabled ? (resolver.id === 'applemusic' ? 'Use system volume to control Apple Music' : 'Browser playback - volume control not available') : undefined
                          }),
                          React.createElement('span', {
                            style: {
                              width: '56px',
                              fontSize: isVolumeDisabled ? '11px' : '12px',
                              color: isVolumeDisabled ? 'var(--text-tertiary)' : 'var(--text-secondary)',
                              textAlign: 'right',
                              fontFamily: isVolumeDisabled ? 'inherit' : 'monospace',
                              fontStyle: isVolumeDisabled ? 'italic' : 'normal'
                            }
                          }, isVolumeDisabled ? disabledReason : `${offset > 0 ? '+' : ''}${offset} dB`)
                        );
                      })
                  ),
loadedResolvers.filter(r => r.capabilities?.resolve && activeResolvers.includes(r.id)).length === 0 &&
                    React.createElement(EmptyState, {
                      compact: true, align: 'start', icon: null,
                      title: 'No music services are on',
                      body: 'Turn one on in Plug-Ins to set its volume here.',
                      actions: [{ label: 'Open Plug-Ins', variant: 'secondary', onClick: () => setSettingsTab('plugins') }]
                    }),
React.createElement('div', { style: { marginTop: '24px', paddingTop: '20px', borderTop: '1px solid var(--border-subtle)' } },
                    React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => setResolverVolumeOffsets({
                        spotify: 0,
                        applemusic: 0,
                        localfiles: 0,
                        soundcloud: 0,
                        bandcamp: -3,
                        youtube: -6
                      }) }, React.createElement(Icons.RefreshCw, { className: 'w-4 h-4' }), 'Reset to defaults')
                  )),

                // Playback Behavior Section - refined card
                React.createElement(SettingsSection, { title: 'Playback Behavior', description: 'Configure how external tracks are handled' },
React.createElement(SettingRow, { label: 'Auto-open external tracks', hint: 'Skip the confirmation prompt for Bandcamp, YouTube, etc.' },
React.createElement(Switch, { checked: skipExternalPrompt, onToggle: async () => {
                        const newValue = !skipExternalPrompt;
                        setSkipExternalPrompt(newValue);
                        if (window.electron?.store) {
                          await window.electron.store.set('skip_external_prompt', newValue);
                        }
                      } }))),

                // Media Keys Section
                React.createElement(SettingsSection, { title: 'Media Keys', description: 'Control how Parachord responds to media keys' },
React.createElement('p', {
                    style: {
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '20px',
                      lineHeight: '1.6'
                    }
                  }, 'When using the Spotify plugin, Spotify also runs in the background and may capture media keys. Choose how Parachord should handle potential conflicts.'),
React.createElement(RadioGroup, {
                    name: 'mediaKeyMode',
                    label: 'Media key handling',
                    value: mediaKeyMode,
                    options: [
                      { value: 'always', label: 'Always capture', hint: 'Parachord always handles media keys. May conflict with Spotify.' },
                      { value: 'non-spotify', label: 'Only when not using Spotify', hint: 'Let Spotify handle media keys when playing via Spotify Connect. Parachord handles them for other sources.' },
                      { value: 'never', label: 'Never capture', hint: 'Parachord never handles media keys. Use this if you prefer Spotify or other apps to control playback.' },
                    ],
                    onChange: async (mode) => {
                      setMediaKeyMode(mode);
                      if (window.electron?.mediaKeys) {
                        await window.electron.mediaKeys.setMode(mode);
                        // Spotify Connect: follow the current playback source
                        if (mode === 'non-spotify' && currentTrack?.resolver) {
                          await window.electron.mediaKeys.updatePlaybackSource(currentTrack.resolver);
                        }
                      }
                    },
                  })),

                // Discord Rich Presence Section
                React.createElement(SettingsSection, { title: 'Discord Presence', description: 'Show what you are playing on your Discord profile' },
React.createElement(SettingRow, { label: 'Share my now playing', hint: 'Needs the Discord desktop app open alongside Parachord.' },
                    React.createElement(Switch, {
                      checked: discordPresenceEnabled,
                      onToggle: async () => {
                        const next = !discordPresenceEnabled;
                        setDiscordPresenceEnabled(next);
                        const discordBridge = window.electron?.discordPresence;
                        if (!discordBridge?.setEnabled) return;
                        const status = await discordBridge.setEnabled(next).catch(() => null);
                        if (status) setDiscordPresenceState(status);
                        showToast(next ? 'Discord presence turned on' : 'Discord presence turned off');
                      }
                    })
                  ),
discordPresenceEnabled && (() => {
                    const statusKey = discordPresenceState?.statusOverride
                      || discordPresenceState?.status
                      || 'connecting';
                    const tone = discordPresenceStatusTone(statusKey);
                    return React.createElement('div', {
                      style: { display: 'flex', alignItems: 'center', gap: '10px', marginTop: '14px', flexWrap: 'wrap' }
                    },
                      React.createElement('span', {
                        style: {
                          padding: '2px 10px',
                          borderRadius: '999px',
                          fontSize: '11px',
                          fontWeight: '600',
                          backgroundColor: tone === 'good' ? 'var(--tint-success)' : tone === 'warn' ? 'var(--tint-warning)' : 'var(--hover-bg-default)',
                          color: tone === 'good' ? 'var(--text-success)' : tone === 'warn' ? 'var(--text-warning)' : 'var(--text-tertiary)'
                        }
                      }, DISCORD_PRESENCE_STATUS_LABELS[statusKey] || statusKey),
                      statusKey === 'not-configured' && React.createElement('span', {
                        style: { fontSize: '12px', color: 'var(--text-tertiary)' }
                      }, 'This build has no Discord Application id, so there is nothing to connect to yet.')
                    );
                  })(),
React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-tertiary)',
                      marginTop: '14px',
                      lineHeight: '1.6'
                    }
                  }, 'Discord shows the track under "Listening to Parachord". The cover travels when it is an https image; local-only art falls back to the Parachord artwork. The presence is only up while something is actually playing: pausing clears it, resuming puts it back, and it is gone when the queue is cleared or Parachord closes. Discord itself must allow it: Settings → Activity Privacy → "Share your detected activities with others".')),

                // Local Server Port Section (parachord#958)
                React.createElement(SettingsSection, { title: 'Local Server Port', description: 'Receives Spotify and SoundCloud sign-in, and parachord:// links from Raycast or curl. Change it if another app already uses this port.' },
React.createElement(SettingRow, {
                    label: 'Port',
                    hint: authServerStatus?.error?.code === 'EADDRINUSE'
                      ? `Port ${authPort} is in use by another app, so sign-in is not working.`
                      : authServerStatus?.listening
                        ? `Running on 127.0.0.1:${authPort}`
                        : `127.0.0.1:${authPort}`,
                  },
                    // A real form, so Enter in the field saves.
                    React.createElement('form', {
                      className: 'flex items-center gap-2',
                      onSubmit: async (e) => {
                        e.preventDefault();
                        const bridge = window.electron?.authServer;
                        if (!bridge?.setPort) return;
                        const result = await bridge.setPort(authPortInput).catch(() => null);
                        if (!result) return;
                        setAuthServerStatus(result);
                        if (!result.success) {
                          showToast(result.message, 'error');
                          return;
                        }
                        setAuthPortInput(String(result.configuredPort));
                        showToast(result.configuredPort === result.port
                          ? `Using port ${result.port}`
                          : `Saved. Restart Parachord to switch to port ${result.configuredPort}.`, 'success');
                      },
                    },
                      React.createElement(TextField, {
                        type: 'number', min: 1024, max: 65535, size: 'sm',
                        value: authPortInput,
                        'aria-label': 'Local server port',
                        onChange: (v) => setAuthPortInput(v),
                        style: { width: '96px' },
                      }),
                      // Secondary first, the primary last (the app's button order).
                      React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => setAuthPortInput('8888') }, 'Default'),
                      React.createElement(Button, { type: 'submit', size: 'sm' }, 'Save')
                    )
                  ),
authServerStatus && authServerStatus.configuredPort !== authServerStatus.port && React.createElement('p', {
                    style: { fontSize: '12px', color: 'var(--text-warning)', marginTop: '12px' }
                  }, `Restart Parachord to switch to port ${authServerStatus.configuredPort}.`),
React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-tertiary)',
                      marginTop: '14px',
                      lineHeight: '1.6'
                    }
                  }, 'After changing the port, add the new Redirect URI shown in the Spotify settings to your Spotify developer app, or Spotify sign-in will fail. SoundCloud\'s built-in sign-in only works on port 8888; on another port, use your own SoundCloud app credentials. Raycast and curl integrations need the new port too. Ports 1024 to 65535; 9876 is taken by the browser extension server.')),

                // Dialogs Section - Reset "Don't show again" preferences
                React.createElement('div', {
                  className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-[box-shadow,border-color]'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-ink-secondary uppercase tracking-wider'
                    }, 'Dialogs'),
                    React.createElement('p', {
                      className: 'text-xs text-ink-tertiary mt-1'
                    }, 'Manage confirmation dialogs and prompts')
                  ),
                  // Each prompt is a setting with a switch (fields.js), like
                  // every other row in Settings: on shows it, off is its
                  // "Don't show this again".
                  (() => {
                    const promptRow = (label, hint, skipped, setSkipped, storeKey) => React.createElement(SettingRow, { label, hint },
                      React.createElement(Switch, {
                        checked: !skipped,
                        onToggle: async () => {
                          const nextSkipped = !skipped;
                          setSkipped(nextSkipped);
                          if (window.electron?.store) await window.electron.store.set(storeKey, nextSkipped);
                        }
                      }));
                    return React.createElement(React.Fragment, null,
                      promptRow('Open in browser prompt', 'Ask before opening a track in the browser', skipExternalPrompt, setSkipExternalPrompt, 'skip_external_prompt'),
                      promptRow('Unsaved friend warning', 'Warn when unpinning a friend who isn’t saved to your collection', skipUnsavedFriendWarning, setSkipUnsavedFriendWarning, 'skip_unsaved_friend_warning'),
                      promptRow('No playable source', 'Say when a track has no source; off, those tracks are skipped', skipUnplayablePrompt, setSkipUnplayablePrompt, 'skip_unplayable_prompt'),
                      // Items dismissed from Home's setup checklist come back
                      // only through this reset.
                      homeSetupDismissed.length > 0 && React.createElement(SettingRow, {
                        label: 'Home setup checklist',
                        hint: `${homeSetupDismissed.length} dismissed ${homeSetupDismissed.length === 1 ? 'item' : 'items'}. Reset to bring ${homeSetupDismissed.length === 1 ? 'it' : 'them'} back.`
                      },
                        React.createElement(Button, {
                          variant: 'secondary', size: 'sm',
                          onClick: async () => {
                            setHomeSetupDismissed([]);
                            if (window.electron?.store) await window.electron.store.set('home_setup_dismissed', []);
                            showToast('Home setup checklist reset');
                          }
                        }, 'Reset'))
                    );
                  })()
                ),

                // Queue Settings Section
                React.createElement('div', {
                  className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-[box-shadow,border-color]'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-ink-secondary uppercase tracking-wider'
                    }, 'Queue Settings'),
                    React.createElement('p', {
                      className: 'text-xs text-ink-tertiary mt-1'
                    }, 'Configure queue persistence')
                  ),
                  // Remember queue toggle
                  React.createElement(SettingRow, { label: 'Remember queue', hint: 'Restore your queue when you reopen the app' },
React.createElement(Switch, { checked: rememberQueue, onToggle: async () => {
                        const newValue = !rememberQueue;
                        setRememberQueue(newValue);
                        if (window.electron?.store) {
                          await window.electron.store.set('remember_queue', newValue);
                          // If turning off, clear the saved queue and context
                          if (!newValue) {
                            await window.electron.store.set('saved_queue', []);
                            await window.electron.store.set('saved_playback_context', null);
                          }
                        }
                      } }))
                ),

                // Discover Settings Section
                React.createElement('div', {
                  className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-[box-shadow,border-color]'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-ink-secondary uppercase tracking-wider'
                    }, 'Discover'),
                    React.createElement('p', {
                      className: 'text-xs text-ink-tertiary mt-1'
                    }, 'Configure discovery feature settings')
                  ),
                  // Show unread badges toggle
                  React.createElement(SettingRow, { label: 'Show unread badges', hint: 'Display badges when Recommendations, Critical Darlings, Pop of the Tops, or Concerts have new content' },
React.createElement(Switch, { checked: showDiscoveryBadges, onToggle: async () => {
                        const newValue = !showDiscoveryBadges;
                        setShowDiscoveryBadges(newValue);
                        if (window.electron?.store) {
                          await window.electron.store.set('show_discovery_badges', newValue);
                        }
                      } })),
                  // Refresh Shuffleupagus suggestions on every visit toggle
                  React.createElement(SettingRow, { label: 'Refresh Shuffleupagus suggestions on every visit', hint: 'Ask Shuffleupagus for new album and artist suggestions each time you open Home or the Recommendations page. When off, they stay until you press Refresh' },
React.createElement(Switch, { checked: homeSuggestionsAutoRefresh, onToggle: async () => {
                        const newValue = !homeSuggestionsAutoRefresh;
                        homeSuggestionsAutoRefreshRef.current = newValue;
                        setHomeSuggestionsAutoRefresh(newValue);
                        if (window.electron?.store) {
                          await window.electron.store.set('home_suggestions_auto_refresh', newValue);
                        }
                      } }))
                ),

                // Scrobbling Section
                React.createElement('div', {
                  className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-[box-shadow,border-color]'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-ink-secondary uppercase tracking-wider flex items-center gap-2'
                    },
                      // Music note icon
                      React.createElement(Icons.Music, { className: 'w-4 h-4' }),
                      'Scrobbling'
                    ),
                    React.createElement('p', {
                      className: 'text-xs text-ink-tertiary mt-1'
                    }, 'Report your listening history to scrobbling services')
                  ),

                  // Global enable/disable toggle
                  React.createElement(SettingRow, { label: 'Enable Scrobbling', hint: 'Send your listening activity to connected services' },
React.createElement(Switch, { checked: scrobblingEnabled, onToggle: async () => {
                        const newValue = !scrobblingEnabled;
                        setScrobblingEnabled(newValue);
                        if (window.electron?.store) {
                          await window.electron.store.set('scrobbling-enabled', newValue);
                        }
                      } })),

                  // Note about configuring scrobblers
                  React.createElement('p', {
                    className: 'text-xs text-ink-tertiary mt-4'
                  }, 'Configure scrobbling services in their respective settings: Last.fm, ListenBrainz, and Libre.fm.')
                ),

                // Library Sync Section
                React.createElement(SettingsSection, { title: 'Library Sync', description: 'Manage synced library data across connected providers' },
React.createElement('p', {
                    style: {
                      fontSize: '13px',
                      color: 'var(--text-secondary)',
                      marginBottom: '16px',
                      lineHeight: '1.6'
                    }
                  }, 'Scan a connected service for duplicate playlists and orphaned local playlists. Unambiguous local playlists get re-linked to their matching remote copy first, then duplicates are removed — the copy your local is already linked to is kept (or the copy with the most tracks, if none are linked).'),
React.createElement('div', { style: { display: 'flex', flexDirection: 'column' } },
                    Object.entries(syncProviderConfig)
                      .filter(([pid]) => resolverSyncSettings[pid]?.enabled)
                      .map(([pid, config]) =>
                        React.createElement('div', {
                          key: pid,
                          className: 'flex items-center justify-between',
                          style: { gap: '12px', padding: '10px 0', borderTop: '1px solid var(--border-subtle)' }
                        },
                          React.createElement('div', { className: 'flex items-center', style: { gap: '10px', minWidth: 0 } },
                          React.createElement('div', {
                            style: {
                              width: '20px', height: '20px', borderRadius: '6px',
                              backgroundColor: config.color, color: 'var(--on-accent)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              flexShrink: 0
                            }
                          },
                            React.createElement(ResolverIcon, { resolverId: pid, size: 12, fill: 'currentColor' })
                          ),
                            React.createElement('span', { className: 'text-sm font-medium text-ink-primary' }, config.name)
                          ),
                          React.createElement(Button, {
                            variant: 'secondary', size: 'sm',
                            onClick: () => handleCleanupDuplicatePlaylists(pid),
                            disabled: cleanupDuplicatesState.loading,
                            'aria-label': `Clean up ${config.name} duplicates`
                          }, cleanupDuplicatesState.loading && cleanupDuplicatesState.providerId === pid ? 'Cleaning…' : 'Clean up duplicates')
                        )
                      ),
                    // Nothing synced yet: offer each service's sync setup here.
                    // Home's Import card lands on this card, and a sentence
                    // with no way forward was a dead end for a new user.
                    Object.entries(syncProviderConfig).filter(([pid]) => resolverSyncSettings[pid]?.enabled).length === 0 &&
                      React.createElement(EmptyState, {
                        compact: true, align: 'start', icon: null,
                        title: 'No service is synced yet',
                        body: 'Set one up to import its playlists and saved music.',
                        actions: Object.entries(syncProviderConfig).map(([pid, config]) =>
                          ({ label: `Set up ${config.name} sync`, variant: 'secondary', onClick: () => openSyncSetupModal(pid) }))
                      })
                  )),

                // Claude Desktop Integration Section
                React.createElement(McpSettingsSection),

                // Developer Settings Section
                React.createElement('div', {
                  className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-[box-shadow,border-color]'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-ink-secondary uppercase tracking-wider'
                    }, 'Developer Settings'),
                    React.createElement('p', {
                      className: 'text-xs text-ink-tertiary mt-1'
                    }, 'Options for testing and development')
                  ),
                  // Use new sync — N-way migration preview / armed state (parachord#911)
                  React.createElement('div', {
                    className: 'flex items-center justify-between py-3'
                  },
                    React.createElement('div', null,
                      React.createElement('div', {
                        className: 'text-sm font-medium text-ink-primary'
                      }, nwayEngineMode === 'new' ? 'New sync is on' : 'Use new sync'),
                      React.createElement('div', {
                        className: 'text-xs text-ink-tertiary mt-0.5'
                      }, nwayEngineMode === 'new'
                        ? 'This device is on the new sync engine. You can switch back anytime.'
                        : 'Preview the new sync engine and switch this device over')
                    ),
                    nwayEngineMode === 'new'
                      // Both are buttons (secondary): "Preview" was a text link
                      // and "Switch back" a hand-styled pill.
                      ? React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => revertNwayMigration() }, 'Switch back to classic')
                      : React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: () => startNwayMigration() }, 'Preview…')
                  )
                ),

                // Reset Application Section
                React.createElement('div', {
                  className: 'bg-surface-card border border-line-danger rounded-xl p-6 hover:shadow-sm hover:border-line-danger-hover transition-[box-shadow,border-color]'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-ink-danger uppercase tracking-wider'
                    }, 'Reset Application'),
                    React.createElement('p', {
                      className: 'text-xs text-ink-tertiary mt-1'
                    }, 'Clear all data and start fresh')
                  ),
                  React.createElement('p', {
                    className: 'text-sm text-ink-secondary mb-5 leading-relaxed'
                  }, 'This will permanently delete all your data including your collection, playlists, friends, listening history, connected accounts, and all settings. The app will restart as if it was freshly installed.'),
                  React.createElement(Button, { variant: 'destructive', onClick: async () => {
                      // Show confirmation dialog
                      const confirmed = await confirmAsync({
                        title: 'Reset Parachord?',
                        message: 'This permanently deletes your collection, playlists, friends, connected accounts, settings and cached data. It can’t be undone.',
                        confirmLabel: 'Reset everything',
                        destructive: true,
                      });

                      if (confirmed) {
                        try {
                          // Clear electron store, plugin cache, and all persisted data
                          const result = await window.electron.store.clear();
                          if (!result?.success) {
                            throw new Error('Store clear failed');
                          }

                          // Persist the disconnect flag so native MusicKit (macOS keychain)
                          // doesn't auto-reconnect after reset. store.clear() removes the
                          // flag that disconnectAppleMusic() sets, so we must re-set it.
                          if (window.electron?.store) {
                            await window.electron.store.set('applemusic_authorized', false);
                          }

                          // Clear localStorage tokens (MusicKit, etc.) that persist across resets
                          localStorage.removeItem('musickit_developer_token');
                          localStorage.removeItem('musickit_user_token');

                          // Unauthorize MusicKit JS to revoke Apple Music session
                          const musicKitWeb = window.getMusicKitWeb ? window.getMusicKitWeb() : null;
                          if (musicKitWeb) {
                            try { await musicKitWeb.unauthorize(); } catch (e) { /* ignore */ }
                          }
                          // Clear native MusicKit auth
                          if (window.electron?.musicKit) {
                            try { await window.electron.musicKit.unauthorize(); } catch (e) { /* ignore */ }
                          }

                          // Reload the app (all React state reinitializes from defaults)
                          window.location.reload();
                        } catch (error) {
                          console.error('Failed to reset application:', error);
                          showToast('Couldn\'t reset Parachord. Try again.', 'error');
                        }
                      }
                    } }, React.createElement(Icons.AlertTriangle, { className: 'w-4 h-4' }), 'Reset application')
                )
              ) // Close space-y-8 wrapper
            ),

            // About Tab
            settingsTab === 'about' && React.createElement('div', {
              className: 'flex flex-col items-center justify-center',
              style: { paddingTop: '48px', paddingBottom: '48px', paddingRight: '40px' }
            },
              // Centered card container
              React.createElement('div', {
                style: {
                  backgroundColor: 'var(--card-bg)',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: '16px',
                  padding: '48px 56px',
                  boxShadow: 'var(--card-shadow)',
                  textAlign: 'center',
                  maxWidth: '420px'
                }
              },
                // Parachord Logo
                React.createElement('div', { style: { marginBottom: '20px', display: 'flex', justifyContent: 'center' } },
                  React.createElement(ParachordWordmark, { fill: 'var(--text-primary)', height: 56 })
                ),

                // Version
                React.createElement('p', {
                  style: {
                    fontSize: '14px',
                    fontWeight: '500',
                    color: 'var(--text-primary)',
                    marginBottom: '8px'
                  }
                }, appVersion ? `Version ${appVersion}` : 'Version'),

                // Tagline
                React.createElement('p', {
                  style: {
                    fontSize: '13px',
                    color: 'var(--text-secondary)',
                    marginBottom: '32px',
                    lineHeight: '1.6',
                    maxWidth: '320px'
                  }
                },
                  'A modern multi-source music player inspired by ',
                  React.createElement('a', {
                    href: '#',
                    onClick: (e) => {
                      e.preventDefault();
                      if (window.electron?.shell?.openExternal) {
                        window.electron.shell.openExternal('https://github.com/tomahawk-player/tomahawk');
                      }
                    },
                    style: {
                      color: 'var(--accent-primary)',
                      textDecoration: 'none',
                      fontWeight: '500'
                    }
                  }, 'Tomahawk'),
                  '.'
                ),

                // The welcome tour, any time (#1387): it opens now. It was two
                // rows in Developer Settings (reset for next launch, show now).
                React.createElement('div', { style: { marginBottom: '32px' } },
                  React.createElement(Button, {
                    variant: 'secondary',
                    onClick: () => setFirstRunTutorial(prev => ({ ...prev, open: true, step: 'welcome' }))
                  }, 'Show welcome tour')
                ),

                // Divider
                React.createElement('div', {
                  style: {
                    width: '64px',
                    height: '1px',
                    backgroundColor: 'var(--border-subtle)',
                    margin: '0 auto 32px'
                  }
                }),

                // Open Source info
                React.createElement('div', { style: { marginBottom: '24px' } },
                  React.createElement('p', {
                    style: {
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: '8px'
                    }
                  }, 'Open Source Software'),
                  React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '12px'
                    }
                  },
                    'Built with Electron, React, and Tailwind CSS'
                  ),
                  React.createElement('a', {
                    href: '#',
                    onClick: (e) => {
                      e.preventDefault();
                      if (window.electron?.shell?.openExternal) {
                        window.electron.shell.openExternal('https://github.com/jherskowitz/parachord');
                      }
                    },
                    style: {
                      fontSize: '12px',
                      color: 'var(--accent-primary)',
                      fontWeight: '500',
                      textDecoration: 'none'
                    }
                  }, 'View on GitHub →')
                ),

                // Diagnostics — surfaces the in-memory log buffer for bug
                // reporting. Captures the last ~2000 console.log/info/warn
                // entries so users can paste a recent-history dump into a
                // GitHub issue. See issue #769.
                React.createElement('div', { style: { marginBottom: '24px' } },
                  React.createElement('p', {
                    style: {
                      fontSize: '11px',
                      fontWeight: '600',
                      color: 'var(--text-tertiary)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      marginBottom: '8px'
                    }
                  }, 'Diagnostics'),
                  React.createElement('p', {
                    style: {
                      fontSize: '12px',
                      color: 'var(--text-secondary)',
                      marginBottom: '12px'
                    }
                  },
                    'Capture the last ~2,000 console entries for bug reports.'
                  ),
                  React.createElement(Button, { variant: 'secondary', size: 'sm', onClick: async () => {
                      if (typeof window.copyDiagnosticLog !== 'function') {
                        showToast('Diagnostic log not available', 'error');
                        return;
                      }
                      try {
                        const { count } = await window.copyDiagnosticLog();
                        showToast(`Copied ${count} log ${count === 1 ? 'entry' : 'entries'} to clipboard`);
                      } catch (err) {
                        showToast('Couldn’t copy the log. Try again.', 'error');
                      }
                    } }, 'Copy diagnostic log')
                ),

                // Copyright
                React.createElement('p', {
                  style: {
                    fontSize: '11px',
                    color: 'var(--text-tertiary)'
                  }
                },
                  '© ', new Date().getFullYear(), ' Jason Herskowitz. All rights reserved.'
                ),

                // License
                React.createElement('p', {
                  style: {
                    fontSize: '11px',
                    color: 'var(--text-tertiary)',
                    marginTop: '4px'
                  }
                },
                  'Licensed under the MIT License'
                )
              )
            )
          )
        ) // Close content area
      );
});

module.exports = { SettingsPage, SETTINGS_PAGE_HANDLERS };
