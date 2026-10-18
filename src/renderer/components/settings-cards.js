// src/renderer/components/settings-cards.js — the settings/scrobbler card kit,
// extracted from app.js's module scope (maintainability plan Track 2b,
// presentational slice 4 — the final presentational slice).
//
// ResolverCard is the resolver/plugin settings card; McpSettingsSection and
// ScrobblerSettingsCard the MCP + scrobbler settings surfaces; FriendMiniPlaybar
// the friends' now-playing mini bar. All props-driven (config, callbacks and
// the app's config-mutation functions arrive via props); no app state.
const { Tooltip, SERVICE_LOGOS } = require('./ui-atoms');

// ResolverCard component - Tomahawk-style colored card with centered logo
// Four user-facing states:
//   1. Enabled (full color, checkmark, priority number)
//   2. Enabled + needs setup (full color, checkmark, orange "!", "Setup required")
//   3. Not enabled (grayed, "Available")
//   4. Installing (spinner overlay)
// Settings panel for a plugin that renders its own UI: settings.authType
// 'custom' in the manifest and renderSettings(ctx) in the .axe (Plex is the
// first). This wrapper is a real component, so the plugin may call hooks
// through ctx.React as long as it calls them unconditionally. A render error
// shows in place instead of taking the settings modal down.
const PluginSettingsPanel = ({ resolver, ctx }) => {
  try {
    return resolver.renderSettings(ctx) || null;
  } catch (e) {
    console.error(`⚠️ ${resolver.id} renderSettings failed:`, e);
    return React.createElement('p', { style: { padding: '16px 0', fontSize: '12px', color: '#dc2626' } },
      `${resolver.name || resolver.id} settings failed to render: ${e.message}`);
  }
};

const ResolverCard = React.memo(({
  resolver,
  isActive,
  hasUpdate,
  isInstalling,
  needsConfiguration,
  priorityNumber,
  onClick,
  onDragStart,
  onDragOver,
  onDragEnter,
  onDragLeave,
  onDrop,
  onDragEnd,
  onContextMenu,
  draggable = false,
  isDragOver = false,
  isDragging = false
}) => {
  const logo = SERVICE_LOGOS[resolver.id];
  const isEnabled = isActive === true;
  const isAvailable = !isEnabled && !isInstalling;

  return React.createElement('div', {
    className: `flex flex-col items-center relative ${isDragging ? 'opacity-50' : ''}`,
    draggable: draggable,
    onDragStart: draggable ? onDragStart : undefined,
    onDragOver: draggable ? onDragOver : undefined,
    onDragEnter: draggable ? onDragEnter : undefined,
    onDragLeave: draggable ? onDragLeave : undefined,
    onDrop: draggable ? onDrop : undefined,
    onDragEnd: draggable ? onDragEnd : undefined,
    onContextMenu: onContextMenu
  },
    // Drop indicator
    isDragOver && React.createElement('div', {
      className: 'absolute -left-3 top-0 bottom-6 w-1 rounded-full',
      style: {
        backgroundColor: 'var(--accent-primary)',
        boxShadow: '0 0 8px rgba(124, 58, 237, 0.6)',
        zIndex: 10
      }
    }),
    // Card
    React.createElement('div', {
      className: `relative flex items-center justify-center cursor-pointer transition-all ${isAvailable ? 'grayscale' : ''}`,
      style: {
        width: '120px',
        height: '120px',
        borderRadius: '16px',
        backgroundColor: resolver.color || '#6B7280',
        opacity: isAvailable ? 0.5 : 1,
        boxShadow: isDragOver
          ? '0 0 0 3px var(--accent-primary), 0 4px 12px rgba(0, 0, 0, 0.15)'
          : '0 2px 8px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.05)'
      },
      onClick: onClick
    },
      // Priority number badge (top-left) - only for enabled resolvers
      priorityNumber && React.createElement('div', {
        className: 'absolute flex items-center justify-center',
        style: {
          top: '8px',
          left: '8px',
          width: '22px',
          height: '22px',
          backgroundColor: 'rgba(255, 255, 255, 0.95)',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '600',
          color: '#111827',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)'
        }
      }, priorityNumber),
      // Centered logo or emoji fallback
      logo ? logo : React.createElement('span', {
        className: 'text-5xl text-white drop-shadow-md'
      }, resolver.icon),
      // Status badge (top-right) - only for enabled resolvers
      isEnabled && !isInstalling && React.createElement('div', {
        className: 'absolute flex items-center justify-center',
        style: {
          top: '8px',
          right: '8px',
          width: '22px',
          height: '22px',
          backgroundColor: hasUpdate ? '#f97316' : 'rgba(255, 255, 255, 0.95)',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '600',
          color: hasUpdate ? '#ffffff' : '#22c55e'
        },
        title: hasUpdate ? 'Update available' : 'Enabled'
      }, hasUpdate ? '↑' : '✓'),
      // Installing spinner
      isInstalling && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: {
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: '16px'
        }
      },
        React.createElement('span', { className: 'text-white text-2xl animate-spin' }, '⏳')
      ),
      // Needs configuration warning badge (bottom-right) - only for enabled resolvers
      needsConfiguration && isEnabled && !isInstalling && React.createElement('div', {
        className: 'absolute flex items-center justify-center',
        style: {
          bottom: '8px',
          right: '8px',
          width: '22px',
          height: '22px',
          backgroundColor: '#fbbf24',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: '600',
          color: '#78350f',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.2)'
        },
        title: 'Needs configuration'
      }, '!')
    ),
    // Name below card
    React.createElement('span', {
      style: {
        marginTop: '10px',
        fontSize: '13px',
        fontWeight: '500',
        color: isAvailable ? 'var(--text-tertiary)' : 'var(--text-primary)',
        textAlign: 'center',
        width: '120px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, resolver.name),
    // "Setup required" label - enabled but needs configuration
    needsConfiguration && isEnabled && React.createElement('span', {
      style: { fontSize: '10px', fontWeight: '500', color: '#d97706', marginTop: '2px' }
    }, 'Setup required'),
    // "Available" label - not enabled
    isAvailable && React.createElement('span', {
      style: { fontSize: '10px', fontWeight: '500', color: 'var(--text-tertiary)', marginTop: '2px' }
    }, 'Available')
  );
});

// MCP Settings Section - Claude Desktop integration setup
const McpSettingsSection = () => {
  const [mcpInfo, setMcpInfo] = React.useState(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (window.electron?.mcp?.getInfo) {
      window.electron.mcp.getInfo().then(setMcpInfo);
    }
  }, []);

  const configSnippet = mcpInfo ? JSON.stringify({
    mcpServers: {
      parachord: {
        command: 'node',
        args: [mcpInfo.stdioPath]
      }
    }
  }, null, 2) : '';

  const handleCopy = () => {
    navigator.clipboard?.writeText(configSnippet).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return React.createElement('div', {
    className: 'bg-white border border-gray-200 rounded-xl p-6 hover:shadow-sm hover:border-gray-300 transition-all'
  },
    React.createElement('div', { className: 'mb-5' },
      React.createElement('h3', {
        className: 'text-sm font-semibold text-gray-700 uppercase tracking-wider'
      }, 'Claude Desktop'),
      React.createElement('p', {
        className: 'text-xs text-gray-500 mt-1'
      }, 'Control Parachord from Claude Desktop using MCP')
    ),
    React.createElement('p', {
      className: 'text-sm text-gray-600 mb-4 leading-relaxed'
    }, 'Parachord runs an MCP server that lets Claude Desktop play music, search tracks, manage your queue, and control playback. Add the following to your Claude Desktop config:'),
    mcpInfo && React.createElement('div', { className: 'relative' },
      React.createElement('pre', {
        style: {
          backgroundColor: 'var(--bg-inset)',
          border: '1px solid var(--border-default)',
          borderRadius: '8px',
          padding: '12px 16px',
          fontSize: '12px',
          lineHeight: '1.6',
          color: 'var(--text-primary)',
          overflow: 'auto',
          fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all'
        }
      }, configSnippet),
      React.createElement('button', {
        onClick: handleCopy,
        style: {
          position: 'absolute',
          top: '8px',
          right: '8px',
          padding: '4px 10px',
          fontSize: '11px',
          fontWeight: '500',
          color: copied ? '#059669' : 'var(--text-secondary)',
          backgroundColor: copied ? '#ecfdf5' : 'var(--placeholder-bg-light)',
          border: '1px solid ' + (copied ? '#a7f3d0' : 'var(--border-default)'),
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'background-color 0.15s, color 0.15s, border-color 0.15s'
        }
      }, copied ? 'Copied!' : 'Copy')
    ),
    React.createElement('p', {
      className: 'text-xs text-gray-500 mt-3',
      style: { lineHeight: '1.5' }
    }, 'Parachord must be running for Claude Desktop to connect. The config file is typically located at ~/Library/Application Support/Claude/claude_desktop_config.json on macOS.')
  );
};

// ScrobblerSettingsCard component - Settings card for individual scrobbler services
const ScrobblerSettingsCard = React.memo(({
  scrobbler, config, onConfigChange,
  lovePushEnabled = false,
  onSetLovePushEnabled = null,
  onRunBackfill = null,
  backfillRunning = false,
  backfillProgress = null,
  unpushedCount = 0,
}) => {
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState(null);
  const [tokenInput, setTokenInput] = React.useState('');
  const [usernameInput, setUsernameInput] = React.useState('');
  const [passwordInput, setPasswordInput] = React.useState('');

  const isConnected = config?.enabled && (config?.sessionKey || config?.userToken);
  const isPolling = config?.authPolling && config?.pendingToken;

  // Listen for auth completion events from polling
  React.useEffect(() => {
    const handleAuthComplete = async (event) => {
      if (event.detail.scrobblerId === scrobbler.id) {
        console.log(`[ScrobblerSettingsCard] Auth completed for ${scrobbler.id}`);
        onConfigChange(scrobbler.id, await scrobbler.getConfig());
      }
    };

    // Listen for auth errors (invalid session key, bad API key, etc.)
    const handleAuthError = async (event) => {
      if (event.detail.scrobblerId === scrobbler.id) {
        console.warn(`[ScrobblerSettingsCard] Auth error for ${scrobbler.id}:`, event.detail.errorMessage);
        setError(`Session expired — please re-authenticate`);
        onConfigChange(scrobbler.id, await scrobbler.getConfig());
      }
    };

    window.addEventListener('scrobbler-auth-complete', handleAuthComplete);
    window.addEventListener('scrobbler-auth-error', handleAuthError);
    return () => {
      window.removeEventListener('scrobbler-auth-complete', handleAuthComplete);
      window.removeEventListener('scrobbler-auth-error', handleAuthError);
    };
  }, [scrobbler, onConfigChange]);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      if (scrobbler.id === 'listenbrainz') {
        // Token-based auth
        await scrobbler.connect(tokenInput);
        onConfigChange(scrobbler.id, await scrobbler.getConfig());
        setTokenInput('');
      } else if (scrobbler.id === 'librefm') {
        // Username/password auth for Libre.fm
        await scrobbler.connectWithPassword(usernameInput, passwordInput);
        onConfigChange(scrobbler.id, await scrobbler.getConfig());
        setUsernameInput('');
        setPasswordInput('');
      } else {
        // OAuth flow (Last.fm)
        const { authUrl } = await scrobbler.startAuth();
        window.electron.shell.openExternal(authUrl);
        // Update config to show pending state
        onConfigChange(scrobbler.id, await scrobbler.getConfig());
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleCompleteAuth = async () => {
    setConnecting(true);
    setError(null);

    try {
      await scrobbler.completeAuth();
      onConfigChange(scrobbler.id, await scrobbler.getConfig());
    } catch (err) {
      setError(err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setError(null);
    try {
      await scrobbler.disconnect();
      onConfigChange(scrobbler.id, {});
    } catch (err) {
      setError(err.message);
    }
  };

  const handleToggleEnabled = async () => {
    setError(null);
    try {
      const newConfig = { ...config, enabled: !config?.enabled };
      await scrobbler.setConfig(newConfig);
      onConfigChange(scrobbler.id, newConfig);
    } catch (err) {
      setError(err.message);
    }
  };

  // Get scrobbler-specific styling
  const getScrobblerColor = () => {
    switch (scrobbler.id) {
      case 'lastfm': return 'bg-red-500';
      case 'listenbrainz': return 'bg-orange-500';
      case 'librefm': return 'bg-green-500';
      default: return 'bg-gray-500';
    }
  };

  return React.createElement('div', {
    className: 'bg-white rounded-xl p-4 shadow-sm border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all'
  },
    // Header row with icon, name, and toggle
    React.createElement('div', { className: 'flex items-center justify-between mb-3' },
      React.createElement('div', { className: 'flex items-center gap-3' },
        // Service icon
        React.createElement('div', {
          className: `w-10 h-10 rounded-lg flex items-center justify-center ${getScrobblerColor()}`
        },
          React.createElement('span', { className: 'text-white text-lg font-bold' },
            scrobbler.name[0]
          )
        ),
        // Service name and connection status
        React.createElement('div', null,
          React.createElement('h3', { className: 'font-medium text-gray-900' }, scrobbler.name),
          isConnected && config?.username && React.createElement('p', {
            className: 'text-sm text-gray-500'
          }, `Connected as ${config.username}`)
        )
      ),
      // Enabled toggle (only when connected)
      isConnected && React.createElement('button', {
        onClick: handleToggleEnabled,
        className: `relative w-11 h-6 rounded-full transition-colors ${config?.enabled ? 'bg-purple-600' : 'bg-gray-300'}`
      },
        React.createElement('span', {
          className: `absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${config?.enabled ? 'translate-x-5' : 'translate-x-0'}`
        })
      )
    ),

    // Error message
    error && React.createElement('div', {
      className: 'mb-3 p-2 bg-red-50 text-red-600 text-sm rounded-lg'
    }, error),

    // Connection UI
    !isConnected ? React.createElement('div', { className: 'space-y-3' },
      // ListenBrainz token input
      scrobbler.id === 'listenbrainz' && React.createElement('div', null,
        React.createElement('label', { className: 'block text-sm text-gray-600 mb-1' },
          'User Token',
          React.createElement('a', {
            href: '#',
            onClick: (e) => {
              e.preventDefault();
              window.electron.shell.openExternal('https://listenbrainz.org/settings/');
            },
            className: 'ml-2 text-purple-600 hover:underline'
          }, 'Get token')
        ),
        React.createElement('input', {
          type: 'text',
          value: tokenInput,
          onChange: (e) => setTokenInput(e.target.value),
          placeholder: 'Enter your ListenBrainz token',
          className: 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
        })
      ),

      // Libre.fm username/password inputs
      scrobbler.id === 'librefm' && React.createElement('div', { className: 'space-y-2' },
        React.createElement('label', { className: 'block text-sm text-gray-600 mb-1' },
          'Username',
          React.createElement('a', {
            href: '#',
            onClick: (e) => {
              e.preventDefault();
              window.electron.shell.openExternal('https://libre.fm/');
            },
            className: 'ml-2 text-purple-600 hover:underline'
          }, 'Create account')
        ),
        React.createElement('input', {
          type: 'text',
          value: usernameInput,
          onChange: (e) => setUsernameInput(e.target.value),
          placeholder: 'Your Libre.fm username',
          className: 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
        }),
        React.createElement('label', { className: 'block text-sm text-gray-600 mb-1' }, 'Password'),
        React.createElement('input', {
          type: 'password',
          value: passwordInput,
          onChange: (e) => setPasswordInput(e.target.value),
          placeholder: 'Your Libre.fm password',
          className: 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
        })
      ),

      // Connect button
      React.createElement('button', {
        onClick: handleConnect,
        disabled: connecting || isPolling || (scrobbler.id === 'listenbrainz' && !tokenInput) || (scrobbler.id === 'librefm' && (!usernameInput || !passwordInput)),
        className: 'w-full py-2 px-4 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
      }, connecting ? 'Authenticating...' : scrobbler.id === 'lastfm' ? 'Authenticate Scrobbling' : 'Connect'),

      // Waiting for authorization (auto-polling active)
      isPolling && React.createElement('div', {
        className: 'text-center py-3'
      },
        React.createElement('div', { className: 'flex items-center justify-center gap-2 text-gray-600 mb-2' },
          // Spinning indicator
          React.createElement('svg', {
            className: 'animate-spin h-4 w-4',
            viewBox: '0 0 24 24',
            fill: 'none'
          },
            React.createElement('circle', {
              className: 'opacity-25',
              cx: '12', cy: '12', r: '10',
              stroke: 'currentColor',
              strokeWidth: '4'
            }),
            React.createElement('path', {
              className: 'opacity-75',
              fill: 'currentColor',
              d: 'M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z'
            })
          ),
          React.createElement('span', { className: 'text-sm' }, 'Waiting for authorization...')
        ),
        React.createElement('p', { className: 'text-xs text-gray-500 mb-2' },
          'Complete authorization in your browser. This will auto-detect when done.'
        ),
        React.createElement('button', {
          onClick: handleCompleteAuth,
          disabled: connecting,
          className: 'text-xs text-purple-600 hover:underline'
        }, 'Complete manually')
      ),

      // Complete Authorization button (fallback for pending token without polling)
      config?.pendingToken && !isPolling && React.createElement('button', {
        onClick: handleCompleteAuth,
        disabled: connecting,
        className: 'w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 disabled:opacity-50 transition-colors'
      }, connecting ? 'Completing...' : 'Complete Authorization')
    ) : (
      // Connected state: love-push controls (LB/LFM only) + Disconnect
      React.createElement('div', { className: 'space-y-3' },
        // Love-push toggle + backfill button (only for services that support it)
        (scrobbler.id === 'lastfm' || scrobbler.id === 'listenbrainz') && onSetLovePushEnabled &&
          React.createElement('div', { className: 'border-t border-gray-200 pt-3 space-y-2' },
            React.createElement('label', { className: 'flex items-center gap-2 text-sm cursor-pointer' },
              React.createElement('input', {
                type: 'checkbox',
                checked: lovePushEnabled,
                onChange: (e) => onSetLovePushEnabled(e.target.checked),
                className: 'rounded text-purple-600 focus:ring-purple-500'
              }),
              React.createElement('span', { className: 'text-gray-700' },
                `Push newly loved tracks to ${scrobbler.id === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`
              )
            ),
            React.createElement('button', {
              onClick: onRunBackfill,
              disabled: backfillRunning || unpushedCount === 0,
              className: 'w-full py-1.5 px-3 text-sm bg-purple-50 text-purple-700 rounded-lg font-medium hover:bg-purple-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            },
              backfillRunning && backfillProgress
                ? `Pushing… ${backfillProgress.done}/${backfillProgress.total}`
                : unpushedCount > 0
                  ? `Backfill ${unpushedCount} loved track${unpushedCount === 1 ? '' : 's'} → ${scrobbler.id === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`
                  : 'All loves already pushed'
            ),
            React.createElement('p', { className: 'text-xs text-gray-500' },
              'Backfilled loves are stamped at the time of push (the remote service has no backdate API).'
            )
          ),
        // Disconnect
        React.createElement('button', {
          onClick: handleDisconnect,
          className: 'w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors'
        }, 'Disconnect')
      )
    )
  );
});

// FriendMiniPlaybar component - shows friend's current track with album art lookup
const FriendMiniPlaybar = ({ track, getAlbumArt, onPlay, onContextMenu }) => {
  // States: undefined (fetching), null (no art found), string (URL)
  // Don't use Last.fm placeholder art as initial state - only use our cache
  const [artUrl, setArtUrl] = React.useState(undefined);
  const [isOverflowing, setIsOverflowing] = React.useState(false);
  const textRef = React.useRef(null);
  const containerRef = React.useRef(null);

  React.useEffect(() => {
    // Always try our cache system - never use Last.fm placeholder art
    if (!track.album || !track.artist) {
      // No album/artist info - show generic placeholder
      setArtUrl(null);
      return;
    }

    let cancelled = false;
    const loadArt = async () => {
      const fetchedArt = await getAlbumArt(track.artist, track.album);
      if (!cancelled) {
        // Only use our cached art, show generic placeholder if not found
        setArtUrl(fetchedArt || null);
      }
    };
    loadArt();
    return () => { cancelled = true; };
  }, [track.name, track.artist, track.album]);

  // Check if text overflows container (after render completes)
  React.useEffect(() => {
    // Use requestAnimationFrame to ensure DOM is fully rendered and measured
    const checkOverflow = () => {
      if (textRef.current && containerRef.current) {
        const textWidth = textRef.current.scrollWidth;
        const containerWidth = containerRef.current.clientWidth;
        setIsOverflowing(textWidth > containerWidth);
      }
    };

    // Run after paint to get accurate measurements
    const rafId = requestAnimationFrame(() => {
      requestAnimationFrame(checkOverflow);
    });

    return () => cancelAnimationFrame(rafId);
  }, [track.name, track.artist]);

  return React.createElement('div', {
    className: 'mt-1 flex items-center rounded cursor-pointer transition-colors pr-2',
    style: { maxWidth: '180px', height: '20px', backgroundColor: 'var(--surface-dark)', color: '#d1d5db' },
    onClick: onPlay,
    onContextMenu: onContextMenu
  },
    // Mini album art
    React.createElement('div', {
      className: 'flex-shrink-0',
      style: { width: '20px', height: '20px' }
    },
      artUrl
        ? React.createElement('img', {
            src: artUrl,
            alt: '',
            className: 'w-full h-full object-cover rounded-l'
          })
        : React.createElement('div', {
            className: 'w-full h-full bg-gray-600 rounded-l flex items-center justify-center'
          },
            React.createElement('span', { className: 'text-gray-400', style: { fontSize: '8px' } }, '\u266A')
          )
    ),
    // Track info - only scrolls if overflowing
    React.createElement('div', {
      ref: containerRef,
      className: `flex-1 min-w-0 pl-2 flex items-center ${isOverflowing ? 'marquee-container' : ''}`,
      style: { overflow: 'hidden', height: '100%' }
    },
      React.createElement('span', {
        ref: textRef,
        className: `whitespace-nowrap inline-block ${isOverflowing ? 'animate-marquee' : ''}`,
        style: { fontSize: '10px', lineHeight: '20px' }
      },
        React.createElement('span', { className: 'text-white font-medium' }, track.name),
        React.createElement('span', { className: 'text-gray-400' }, ` - ${track.artist}`)
      )
    )
  );
};

module.exports = {
  PluginSettingsPanel,
  ResolverCard,
  McpSettingsSection,
  ScrobblerSettingsCard,
  FriendMiniPlaybar,
};
