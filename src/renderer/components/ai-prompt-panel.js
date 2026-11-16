// src/renderer/components/ai-prompt-panel.js: the Generate Playlist panel
// that rises above the playbar: a prompt, Surprise me (with listening
// history), the provider picker and the setup hints (#1451, moved out of
// app.js).
//
// A React.memo'd panel fed stable props: state, setters and refs by value,
// handleAiGenerate and navigateTo through useStableHandlers
// (AI_PROMPT_PANEL_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The provider list reads resolverLoaderRef during render, so the call site
// passes _allResolvers (it changes when plug-ins load) to re-render it then.
// The markup moved as it was.

const Icons = require('./icons');
const { Button } = require('./button');
const { ProviderMenu } = require('./provider-menu');
const { TextField } = require('./fields');
const { servicesWithCapability, hasScrobblerConnected } = require('../lib/ai-services');

const AI_PROMPT_PANEL_HANDLERS = [
  'handleAiGenerate',
  'navigateTo',
];

const AiPromptPanel = React.memo(function AiPromptPanel(props) {
  const {
    aiError,
    aiIncludeHistory,
    aiLoading,
    aiPrompt,
    handleAiGenerate,
    metaServiceConfigs,
    metaServices,
    navigateTo,
    resolverLoaderRef,
    selectedAiResolver,
    setAiError,
    setAiPrompt,
    setAiPromptOpen,
    setMarketplaceCategory,
    setSelectedAiResolver,
    setSettingsTab,
  } = props;
  return React.createElement('div', {
      // Rises in above the playbar like a toast (.motion-rise-in).
      className: 'on-dark motion-rise-in fixed bottom-24 left-4 z-50',
      style: {
        width: '380px',
        backgroundColor: 'var(--surface-dark-solid)',
        backdropFilter: 'blur(20px)',
        border: '1px solid var(--surface-dark-border)',
        borderRadius: '16px',
        boxShadow: 'var(--shadow-dialog-dark)',
        padding: '16px'
      }
    },
      // Header
      React.createElement('div', { className: 'flex items-center justify-between mb-3' },
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('span', { style: { color: 'var(--playbar-accent-hover)' } }, '✨'),
          React.createElement('span', { style: { fontSize: '14px', fontWeight: '500', color: 'var(--on-dark-primary)' } }, 'Generate Playlist')
        ),
        React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', 'aria-label': "Close", onClick: () => {
            setAiPromptOpen(false);
            setAiPrompt('');
            setAiError(null);
          } }, React.createElement(Icons.X, { className: 'w-4 h-4' }))
      ),

      // Input
      // The shared text field (components/fields.js), dark tone, with
      // Generate inside it: the field's own focus ring, no JS styling.
      React.createElement(TextField, {
        tone: 'dark',
        size: 'lg',
        wrapClassName: 'w-full',
        value: aiPrompt,
        onChange: setAiPrompt,
        onKeyDown: (e) => {
          // Prevent global shortcuts from interfering while typing
          e.stopPropagation();
          if (e.key === 'Enter' && aiPrompt.trim() && !aiLoading) {
            handleAiGenerate(aiPrompt.trim());
          }
          if (e.key === 'Escape') {
            setAiPromptOpen(false);
            setAiPrompt('');
            setAiError(null);
          }
        },
        placeholder: 'What do you want to listen to?',
        disabled: aiLoading,
        autoFocus: true,
        'aria-label': 'What do you want to listen to?',
        trailing: React.createElement(Button, { variant: 'primary', size: 'sm', className: '!px-2', 'aria-label': "Generate", onClick: () => aiPrompt.trim() && !aiLoading && handleAiGenerate(aiPrompt.trim()), disabled: !aiPrompt.trim() || aiLoading }, aiLoading
            ? React.createElement(Icons.Spinner, { size: 16 })
            : React.createElement(Icons.ArrowRight, { className: 'w-4 h-4', strokeWidth: 2 }))
      }),

      // Provider selector row (right-aligned)
      (() => {
        const aiResolvers = servicesWithCapability('generate', resolverLoaderRef.current, metaServices);
        if (aiResolvers.length <= 1) return null;
        return React.createElement('div', { className: 'mt-3 flex items-center justify-end gap-2' },
          React.createElement('span', { style: { fontSize: '12px', color: 'var(--on-dark-secondary)' } }, 'Provider'),
          // The same picker as the chat panel's (components/provider-menu.js).
          React.createElement(ProviderMenu, {
            label: 'AI provider',
            services: aiResolvers,
            value: selectedAiResolver || aiResolvers[0]?.id || '',
            onChange: (id) => setSelectedAiResolver(id)
          })
        );
      })(),

      // Surprise Me button (own row, only when data sharing is enabled) - Muted gradient
      aiIncludeHistory && React.createElement('div', {
        className: 'mt-3'
      },
        React.createElement(Button, { variant: 'primary', className: 'w-full', style: { background: aiLoading ? 'var(--on-dark-faint)' : 'var(--ai-gradient)' }, onClick: () => !aiLoading && handleAiGenerate('Surprise me! Based on my listening history, create a playlist of songs I might love but haven\'t discovered yet. Mix familiar vibes with fresh discoveries.'), disabled: aiLoading }, React.createElement('span', { className: 'flex items-center justify-center gap-2' },
            React.createElement(Icons.Dices, { className: 'w-4 h-4' }),
            'Surprise Me'
          ))
      ),

      // Scrobbler not connected - show link to plug-ins settings
      !hasScrobblerConnected(metaServiceConfigs) && React.createElement('div', {
        className: 'mt-3 flex items-center justify-between'
      },
        React.createElement('span', { style: { fontSize: '12px', color: 'var(--on-dark-secondary)' } },
          'Connect a scrobbler for personalized recommendations'
        ),
        React.createElement('button', {
          onClick: () => {
            setAiPromptOpen(false);
            setSettingsTab('plugins');
            setMarketplaceCategory('social');
            navigateTo('settings');
          },
          className: 'transition-colors hover:!text-[var(--playbar-accent-hover)]',
          style: { fontSize: '12px', color: 'var(--accent-soft)' },
        }, 'Browse →')
      ),

      // Error message
      aiError && React.createElement('div', {
        style: {
          marginTop: '12px',
          padding: '10px 12px',
          backgroundColor: 'var(--tint-danger)',
          border: '1px solid var(--border-danger)',
          borderRadius: '8px'
        }
      },
        React.createElement('p', { style: { fontSize: '12px', color: 'var(--on-dark-danger)' } }, aiError)
      ),

      // Hint
      !aiError && React.createElement('p', { style: { marginTop: '12px', fontSize: '12px', color: 'var(--on-dark-secondary)' } },
        'Try: "upbeat 90s hip hop" or "relaxing jazz for studying"'
      )
    );
});

module.exports = { AiPromptPanel, AI_PROMPT_PANEL_HANDLERS };
