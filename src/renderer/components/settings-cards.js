// src/renderer/components/settings-cards.js — the settings/scrobbler card kit,
// extracted from app.js's module scope (maintainability plan Track 2b,
// presentational slice 4 — the final presentational slice).
//
// ResolverCard is the resolver/plugin settings card; McpSettingsSection and
// ScrobblerSettingsCard the MCP + scrobbler settings surfaces; FriendMiniPlaybar
// the friends' now-playing mini bar. All props-driven (config, callbacks and
// the app's config-mutation functions arrive via props); no app state.
const { FriendMiniPlaybar } = require('./friend-mini-playbar');
const Icons = require('./icons');
const { Button } = require('./button');
const { TextField, SecretField, Switch } = require('./fields');
const { Tooltip, SERVICE_LOGOS } = require('./ui-atoms');
const { menuKeyHandler } = require('./card-button');

// ResolverCard component - Tomahawk-style colored card with centered logo
// Four user-facing states:
//   1. Enabled (full color, checkmark, priority number)
//   2. Enabled + needs setup (checkmark, "Setup required" under the name)
//   3. Not enabled (grayed, "Available")
//   4. Installing (spinner overlay)
// statusLabel (with statusTitle as its tooltip) replaces "Setup required" for
// a resolver that is set up but limited, e.g. Amazon without Music Unlimited.
// unplayable: enabled but left out of playback (a playback limit: Amazon
// without Music Unlimited, Apple Music not signed in). Grayed like an
// available card, keeping its checkmark and label.
// An enabled card's problem shows one way, as the warning line under its
// name ("Setup required" or the statusLabel); there was also an orange "!" on
// the tile for setup alone, so Apple Music and Amazon read differently.
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
        boxShadow: '0 0 8px var(--accent-primary-alpha-60)',
        zIndex: 10
      }
    }),
    // Card
    React.createElement('button', { type: 'button', 'aria-label': resolver.name,
      className: `relative flex items-center justify-center cursor-pointer transition-[opacity,filter] ${isGrayed ? 'grayscale' : ''}`,
      style: {
        width: '120px',
        height: '120px',
        borderRadius: '16px',
        backgroundColor: resolver.color || 'var(--fill-neutral)',
        opacity: isGrayed ? 0.5 : 1,
        boxShadow: isDragOver
          ? '0 0 0 3px var(--accent-primary), var(--shadow-popover)'
          : 'var(--shadow-tile)'
      },
      onClick: onClick,
      // Shift+F10 / the Menu key: the tile's menu (Raise / Lower Priority,
      // Remove), as a right-click (#1386).
      onKeyDown: onContextMenu ? menuKeyHandler(onContextMenu) : undefined
    },
      // Priority number badge (top-left) - only for enabled resolvers
      priorityNumber && React.createElement('div', {
        className: 'absolute flex items-center justify-center',
        style: {
          top: '8px',
          left: '8px',
          width: '22px',
          height: '22px',
          backgroundColor: 'var(--on-color-chip)',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '600',
          color: 'var(--on-art-ink)',
          boxShadow: 'var(--shadow-sm)'
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
          backgroundColor: hasUpdate ? 'var(--fill-warning)' : 'var(--on-color-chip)',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '600',
          color: hasUpdate ? 'var(--on-accent)' : 'var(--text-success)'
        },
        'data-tooltip': hasUpdate ? 'Update available' : 'Enabled'
      }, hasUpdate ? '↑' : React.createElement(Icons.Check, { style: { width: '1em', height: '1em', verticalAlign: '-0.125em' } })),
      // Installing spinner
      isInstalling && React.createElement('div', {
        className: 'absolute inset-0 flex items-center justify-center',
        style: {
          backgroundColor: 'var(--scrim-soft)',
          borderRadius: '16px'
        }
      },
        React.createElement(Icons.Spinner, { className: 'text-white w-6 h-6' })
      )
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
      style: { fontSize: '11px', fontWeight: '500', color: 'var(--text-warning)', marginTop: '2px' }
    }, 'Setup required'),
    // A limit the resolver is set up under (statusTitle explains it)
    !needsConfiguration && isEnabled && statusLabel && React.createElement('span', {
      style: { fontSize: '11px', fontWeight: '500', color: 'var(--text-warning)', marginTop: '2px' },
      'data-tooltip': statusTitle || undefined
    }, statusLabel),
    // "Available" label - not enabled
    isAvailable && React.createElement('span', {
      style: { fontSize: '11px', fontWeight: '500', color: 'var(--text-tertiary)', marginTop: '2px' }
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
    className: 'bg-surface-card border border-line rounded-xl p-6 hover:shadow-sm hover:border-line-strong transition-[box-shadow,border-color]'
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
      React.createElement(Button, { variant: 'secondary', size: 'sm', className: 'absolute top-2 right-2', onClick: handleCopy }, copied ? 'Copied!' : 'Copy')
    ),
    React.createElement('p', {
      className: 'text-xs text-ink-tertiary mt-3',
      style: { lineHeight: '1.5' }
    }, 'Parachord must be running for Claude Desktop to connect. The config file is typically located at ~/Library/Application Support/Claude/claude_desktop_config.json on macOS.')
  );
};

// ScrobblerSettingsCard component - Settings card for individual scrobbler services
const ScrobblerSettingsCard = React.memo(({
  scrobbler, config, onConfigChange, color,
  lovePushEnabled = false,
  onSetLovePushEnabled = null,
  onRunBackfill = null,
  backfillRunning = false,
  backfillProgress = null,
  unpushedCount = 0,
  onRunLoveImport = null,
  loveImportRunning = false,
  loveImportProgress = null,
  hasImportedLoves = false,
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

  return React.createElement('div', {
    className: 'bg-surface-card rounded-xl p-4 shadow-sm border border-line hover:shadow-md hover:border-line-strong transition-[box-shadow,border-color]'
  },
    // Header row with icon, name, and toggle
    React.createElement('div', { className: 'flex items-center justify-between mb-3' },
      React.createElement('div', { className: 'flex items-center gap-3' },
        // Service icon
        React.createElement('div', {
          // The plugin's own colour (its manifest's color), never a per-id copy.
          className: 'w-10 h-10 rounded-lg flex items-center justify-center',
          style: { backgroundColor: color || 'var(--fill-neutral)' }
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
      isConnected && React.createElement(Switch, { checked: config?.enabled, onToggle: handleToggleEnabled, 'aria-label': `Scrobble to ${scrobbler.name}` })
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
        React.createElement(TextField, { value: tokenInput, onChange: (_v, e) => setTokenInput(e.target.value), placeholder: 'Enter your ListenBrainz token', 'aria-label': 'Enter your ListenBrainz token', className: 'w-full' })
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
        React.createElement(TextField, { value: usernameInput, onChange: (_v, e) => setUsernameInput(e.target.value), placeholder: 'Your Libre.fm username', 'aria-label': 'Your Libre.fm username', className: 'w-full' }),
        React.createElement('label', { className: 'block text-sm text-ink-secondary mb-1' }, 'Password'),
        React.createElement(SecretField, { value: passwordInput, onChange: (_v, e) => setPasswordInput(e.target.value), placeholder: 'Your Libre.fm password', 'aria-label': 'Your Libre.fm password', className: 'w-full' })
      ),

      // Connect button
      React.createElement(Button, { variant: 'primary', busy: connecting, onClick: handleConnect, disabled: connecting || isPolling || (scrobbler.id === 'listenbrainz' && !tokenInput) || (scrobbler.id === 'librefm' && (!usernameInput || !passwordInput)), className: 'w-full' }, connecting ? 'Authenticating…' : scrobbler.id === 'lastfm' ? 'Authenticate Scrobbling' : 'Connect'),

      // Waiting for authorization (auto-polling active)
      isPolling && React.createElement('div', {
        className: 'text-center py-3'
      },
        React.createElement('div', { className: 'flex items-center justify-center gap-2 text-ink-secondary mb-2' },
          // Spinning indicator
          React.createElement(Icons.Spinner, { className: 'h-4 w-4' }),
          React.createElement('span', { className: 'text-sm' }, 'Waiting for authorization…')
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
      config?.pendingToken && !isPolling && React.createElement(Button, { variant: 'primary', pageColor: 'var(--fill-success)', className: 'w-full', onClick: handleCompleteAuth, disabled: connecting }, connecting ? 'Completing…' : 'Complete authorization')
    ) : (
      // Connected state: the import action, love-push controls + Disconnect
      React.createElement('div', { className: 'space-y-3' },
        // Loved-tracks import (issue #1071): pull the user's loves on this
        // service into the collection. Opt-in per service; Libre.fm stays
        // out (same scope as push — the card simply never passes
        // onRunLoveImport).
        onRunLoveImport && (scrobbler.id === 'lastfm' || scrobbler.id === 'listenbrainz') &&
          React.createElement('div', { className: 'space-y-2' },
            React.createElement(Button, { variant: 'secondary', size: 'sm', className: 'w-full', onClick: onRunLoveImport, disabled: loveImportRunning }, loveImportRunning && loveImportProgress
                ? (loveImportProgress.phase === 'confirm' ? 'Waiting for confirmation…'
                  : loveImportProgress.phase === 'lookup'
                    ? `Looking up names… ${loveImportProgress.done}/${loveImportProgress.total}`
                    : `Importing… ${loveImportProgress.done}/${loveImportProgress.total}`)
                : hasImportedLoves ? 'Import new loves' : 'Import loved tracks')
          ),
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
            React.createElement(Button, { variant: 'text', size: 'sm', onClick: onRunBackfill, disabled: backfillRunning || unpushedCount === 0, className: 'w-full' }, backfillRunning && backfillProgress
                ? `Pushing… ${backfillProgress.done}/${backfillProgress.total}`
                : unpushedCount > 0
                  ? `Backfill ${unpushedCount} loved track${unpushedCount === 1 ? '' : 's'} → ${scrobbler.id === 'lastfm' ? 'Last.fm' : 'ListenBrainz'}`
                  : 'All loves already pushed'),
            React.createElement('p', { className: 'text-xs text-ink-tertiary' },
              'Backfilled loves are stamped at the time of push (the remote service has no backdate API).'
            )
          ),
        // Disconnect
        React.createElement(Button, { variant: 'secondary', className: 'w-full', onClick: handleDisconnect }, 'Disconnect')
      )
    )
  );
});

// FriendMiniPlaybar lives in components/friend-mini-playbar.js (re-exported).

// A Settings section: the card (the card colour, a subtle border, the card
// shadow) with its heading (small capitals; the words are written in Title
// Case, as Settings headings are) and an optional line under it. Every
// section of Settings › General is one (there was a copy per section, and
// Playback Quality had drifted to a grey card with a large heading).
function SettingsSection({ title, description, children, ...rest }) {
  const e = React.createElement;
  return e('div', Object.assign({
    style: { backgroundColor: 'var(--card-bg)', border: '1px solid var(--border-subtle)', borderRadius: '12px', padding: '24px', boxShadow: 'var(--card-shadow)' },
  }, rest),
    e('div', { style: { marginBottom: '16px' } },
      e('h3', { style: { fontSize: '11px', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 } }, title),
      description && e('p', { style: { fontSize: '12px', color: 'var(--text-tertiary)', marginTop: '4px', marginBottom: 0 } }, description)),
    children);
}

module.exports = {
  SettingsSection,
  ResolverCard,
  McpSettingsSection,
  ScrobblerSettingsCard,
  FriendMiniPlaybar,
};
