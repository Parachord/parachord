// src/renderer/components/settings-cards.js — the settings/scrobbler card kit,
// extracted from app.js's module scope (maintainability plan Track 2b,
// presentational slice 4 — the final presentational slice).
//
// ResolverCard is the resolver/plugin settings card; McpSettingsSection and
// ScrobblerSettingsCard the MCP + scrobbler settings surfaces; FriendMiniPlaybar
// the friends' now-playing mini bar. All props-driven (config, callbacks and
// the app's config-mutation functions arrive via props); no app state.
const Icons = require('./icons');
const { activateOnKey } = require('../lib/activate-on-key');
const { Tooltip, SERVICE_LOGOS } = require('./ui-atoms');

// ResolverCard component - Tomahawk-style colored card with centered logo
// Four user-facing states:
//   1. Enabled (full color, checkmark, priority number)
//   2. Enabled + needs setup (full color, checkmark, orange "!", "Setup required")
//   3. Not enabled (grayed, "Available")
//   4. Installing (spinner overlay)
// statusLabel (with statusTitle as its tooltip) replaces "Setup required" for
// a resolver that is set up but limited, e.g. Amazon without Music Unlimited.
// unplayable: enabled but left out of playback (a playback limit: Amazon
// without Music Unlimited, Apple Music not signed in). Grayed like an
// available card, keeping its checkmark and label.
const ResolverCard = React.memo(({
  resolver,
  isActive,
  hasUpdate,
  isInstalling,
  needsConfiguration,
  statusLabel = null,
  statusTitle = null,
  unplayable = false,
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
  const isGrayed = isAvailable || (isEnabled && unplayable);

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
      className: `relative flex items-center justify-center cursor-pointer transition-all ${isGrayed ? 'grayscale' : ''}`,
      style: {
        width: '120px',
        height: '120px',
        borderRadius: '16px',
        backgroundColor: resolver.color || '#6B7280',
        opacity: isGrayed ? 0.5 : 1,
        boxShadow: isDragOver
          ? '0 0 0 3px var(--accent-primary), 0 4px 12px rgba(0, 0, 0, 0.15)'
          : '0 2px 8px rgba(0, 0, 0, 0.1), 0 4px 16px rgba(0, 0, 0, 0.05)'
      },
      onClick: onClick, role: 'button', tabIndex: 0, onKeyDown: activateOnKey
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
          color: hasUpdate ? '#ffffff' : 'var(--text-success)'
        },
        title: hasUpdate ? 'Update available' : 'Enabled'
      }, hasUpdate ? '↑' : React.createElement(Icons.Check, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } })),
      // Installing spinner
      isInstalling && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: {
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: '16px'
        }
      },
        React.createElement(Icons.Spinner, { className: 'text-white w-6 h-6' })
      ),
      // Needs configuration warning badge (bottom-right) - only for enabled resolvers
      needsConfiguration && isEnabled && !isInstalling && React.createElement('div', {
        className: 'absolute flex items-center justify-center',
        style: {
          bottom: '8px',
          right: '8px',
          width: '22px',
          height: '22px',
          backgroundColor: 'var(--warning)',
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
        color: isGrayed ? 'var(--text-tertiary)' : 'var(--text-primary)',
        textAlign: 'center',
        width: '120px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap'
      }
    }, resolver.name),
    // "Setup required" label - enabled but needs configuration
    needsConfiguration && isEnabled && React.createElement('span', {
      style: { fontSize: '10px', fontWeight: '500', color: 'var(--text-warning)', marginTop: '2px' }
    }, 'Setup required'),
    // A limit the resolver is set up under (statusTitle explains it)
    !needsConfiguration && isEnabled && statusLabel && React.createElement('span', {
      style: { fontSize: '10px', fontWeight: '500', color: 'var(--text-warning)', marginTop: '2px' },
      title: statusTitle || undefined
    }, statusLabel),
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
    className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-all'
  },
    React.createElement('div', { className: 'mb-5' },
      React.createElement('h3', {
        className: 'text-sm font-semibold text-ink-secondary uppercase tracking-wider'
      }, 'Claude Desktop'),
      React.createElement('p', {
        className: 'text-xs text-ink-tertiary mt-1'
      }, 'Control Parachord from Claude Desktop using MCP')
    ),
    React.createElement('p', {
      className: 'text-sm text-ink-secondary mb-4 leading-relaxed'
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
          color: copied ? 'var(--text-success)' : 'var(--text-secondary)',
          backgroundColor: copied ? '#ecfdf5' : 'var(--placeholder-bg-light)',
          border: '1px solid ' + (copied ? '#a7f3d0' : 'var(--border-default)'),
          borderRadius: '6px',
          cursor: 'pointer',
          transition: 'background-color 0.15s, color 0.15s, border-color 0.15s'
        }
      }, copied ? 'Copied!' : 'Copy')
    ),
    React.createElement('p', {
      className: 'text-xs text-ink-tertiary mt-3',
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
    className: 'bg-surface-card rounded-xl p-4 shadow-sm border border-line hover:shadow-md hover:border-line-strong transition-all'
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
          React.createElement('h3', { className: 'font-medium text-ink-primary' }, scrobbler.name),
          isConnected && config?.username && React.createElement('p', {
            className: 'text-sm text-ink-tertiary'
          }, `Connected as ${config.username}`)
        )
      ),
      // Enabled toggle (only when connected)
      isConnected && React.createElement('button', {
        role: 'switch',
        'aria-checked': config?.enabled ? 'true' : 'false',
        'aria-label': `Scrobble to ${scrobbler.name}`,
        onClick: handleToggleEnabled,
        className: `relative w-11 h-6 rounded-full transition-colors ${config?.enabled ? 'bg-accent-fill' : 'bg-control-off'}`
      },
        React.createElement('span', {
          className: `absolute top-0.5 left-0.5 w-5 h-5 bg-control-knob rounded-full shadow transition-transform ${config?.enabled ? 'translate-x-5' : 'translate-x-0'}`
        })
      )
    ),

    // Error message
    error && React.createElement('div', {
      className: 'mb-3 p-2 bg-tint-danger text-ink-danger text-sm rounded-lg'
    }, error),

    // Connection UI
    !isConnected ? React.createElement('div', { className: 'space-y-3' },
      // ListenBrainz token input
      scrobbler.id === 'listenbrainz' && React.createElement('div', null,
        React.createElement('label', { className: 'block text-sm text-ink-secondary mb-1' },
          'User Token',
          React.createElement('a', {
            href: '#',
            onClick: (e) => {
              e.preventDefault();
              window.electron.shell.openExternal('https://listenbrainz.org/settings/');
            },
            className: 'ml-2 text-accent hover:underline'
          }, 'Get token')
        ),
        React.createElement('input', {
          type: 'text',
          value: tokenInput,
          onChange: (e) => setTokenInput(e.target.value),
          placeholder: 'Enter your ListenBrainz token',
          className: 'w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent'
        })
      ),

      // Libre.fm username/password inputs
      scrobbler.id === 'librefm' && React.createElement('div', { className: 'space-y-2' },
        React.createElement('label', { className: 'block text-sm text-ink-secondary mb-1' },
          'Username',
          React.createElement('a', {
            href: '#',
            onClick: (e) => {
              e.preventDefault();
              window.electron.shell.openExternal('https://libre.fm/');
            },
            className: 'ml-2 text-accent hover:underline'
          }, 'Create account')
        ),
        React.createElement('input', {
          type: 'text',
          value: usernameInput,
          onChange: (e) => setUsernameInput(e.target.value),
          placeholder: 'Your Libre.fm username',
          className: 'w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent'
        }),
        React.createElement('label', { className: 'block text-sm text-ink-secondary mb-1' }, 'Password'),
        React.createElement('input', {
          type: 'password',
          value: passwordInput,
          onChange: (e) => setPasswordInput(e.target.value),
          placeholder: 'Your Libre.fm password',
          className: 'w-full px-3 py-2 border border-line-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent'
        })
      ),

      // Connect button
      React.createElement('button', {
        onClick: handleConnect,
        disabled: connecting || isPolling || (scrobbler.id === 'listenbrainz' && !tokenInput) || (scrobbler.id === 'librefm' && (!usernameInput || !passwordInput)),
        className: 'w-full py-2 px-4 bg-accent-fill text-white rounded-lg font-medium hover:bg-accent-fill-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
      }, connecting ? 'Authenticating...' : scrobbler.id === 'lastfm' ? 'Authenticate Scrobbling' : 'Connect'),

      // Waiting for authorization (auto-polling active)
      isPolling && React.createElement('div', {
        className: 'text-center py-3'
      },
        React.createElement('div', { className: 'flex items-center justify-center gap-2 text-ink-secondary mb-2' },
          // Spinning indicator
          React.createElement(Icons.Spinner, { className: 'h-4 w-4' }),
          React.createElement('span', { className: 'text-sm' }, 'Waiting for authorization...')
        ),
        React.createElement('p', { className: 'text-xs text-ink-tertiary mb-2' },
          'Complete authorization in your browser. This will auto-detect when done.'
        ),
        React.createElement('button', {
          onClick: handleCompleteAuth,
          disabled: connecting,
          className: 'text-xs text-accent hover:underline'
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
          React.createElement('div', { className: 'border-t border-line pt-3 space-y-2' },
            React.createElement('label', { className: 'flex items-center gap-2 text-sm cursor-pointer' },
              React.createElement('input', {
                type: 'checkbox',
                checked: lovePushEnabled,
                onChange: (e) => onSetLovePushEnabled(e.target.checked),
                className: 'rounded text-accent focus:ring-accent'
              }),
              React.createElement('span', { className: 'text-ink-secondary' },
                `Push newly loved tracks to ${scrobbler.id === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`
              )
            ),
            React.createElement('button', {
              onClick: onRunBackfill,
              disabled: backfillRunning || unpushedCount === 0,
              className: 'w-full py-1.5 px-3 text-sm bg-accent-tint text-accent rounded-lg font-medium hover:bg-accent-tint-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
            },
              backfillRunning && backfillProgress
                ? `Pushing… ${backfillProgress.done}/${backfillProgress.total}`
                : unpushedCount > 0
                  ? `Backfill ${unpushedCount} loved track${unpushedCount === 1 ? '' : 's'} → ${scrobbler.id === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`
                  : 'All loves already pushed'
            ),
            React.createElement('p', { className: 'text-xs text-ink-tertiary' },
              'Backfilled loves are stamped at the time of push (the remote service has no backdate API).'
            )
          ),
        // Disconnect
        React.createElement('button', {
          onClick: handleDisconnect,
          className: 'w-full py-2 px-4 bg-surface-inset text-ink-secondary rounded-lg font-medium hover:bg-surface-hover transition-colors'
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
    onClick: onPlay, role: 'button', tabIndex: 0, onKeyDown: activateOnKey,
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
            React.createElement('span', { className: 'text-ink-tertiary', style: { fontSize: '8px' } }, '\u266A')
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
        React.createElement('span', { className: 'text-ink-tertiary' }, ` - ${track.artist}`)
      )
    )
  );
};

module.exports = {
  ResolverCard,
  McpSettingsSection,
  ScrobblerSettingsCard,
  FriendMiniPlaybar,
};
