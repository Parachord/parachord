// src/renderer/components/results-panel.js: the Shuffleupagus panel that
// slides in from the right above the playbar: the chat with Shuffleupagus
// (its messages, the provider menu, the input and Share my data) (#1451,
// moved out of app.js). It also had a track-list mode for the one-shot AI
// Playlist, removed with that panel (#1020).
//
// A React.memo'd panel fed stable props: state, setters, refs and
// showToast by value, plain functions through useStableHandlers
// (RESULTS_PANEL_HANDLERS, pinned by tests/renderer/page-memo.test.js).
// The markup moved as it was; window is read only inside handlers.

const Icons = require('./icons');
const { BrandMark } = require('./brand-logos');
const { Button } = require('./button');
const { ProviderMenu } = require('./provider-menu');
const { Switch, TextField } = require('./fields');
const { transition } = require('../lib/motion');

const RESULTS_PANEL_HANDLERS = [
  'clearAiChatHistory',
  'closeAiChat',
  'closeSidebarAnimated',
  'getChatServices',
  'handleAiChatSend',
  'isServiceEnabled',
  'renderChatContent',
  'showCopyFallback',
];

const ResultsPanel = React.memo(function ResultsPanel(props) {
  const {
    aiChatHistoriesRef,
    aiChatInput,
    aiChatLoading,
    aiChatMessages,
    aiChatServiceRef,
    aiIncludeHistory,
    chatMessagesRef,
    clearAiChatHistory,
    closeAiChat,
    closeSidebarAnimated,
    getChatServices,
    handleAiChatSend,
    isServiceEnabled,
    lastAssistantMessageRef,
    lastUserMessageRef,
    renderChatContent,
    resultsSidebar,
    selectedChatProvider,
    setAiChatInput,
    setAiChatMessages,
    setAiIncludeHistory,
    setResultsSidebar,
    setSelectedChatProvider,
    showCopyFallback,
    showToast,
    sidebarClosing,
  } = props;
  return React.createElement('div', {
      className: 'fixed top-0 right-0 z-40 flex',
      style: { bottom: '80px' } // Leave room for playbar
    },
      // Backdrop (click to close)
      React.createElement('div', { role: 'presentation', 'aria-hidden': 'true',
        className: 'flex-1',
        style: { backgroundColor: 'var(--scrim-soft)', backdropFilter: 'blur(4px)' },
        onClick: closeSidebarAnimated
      }),

      // Sidebar panel
      React.createElement('div', {
        className: 'on-dark w-80 flex flex-col',
        style: {
          backgroundColor: 'var(--surface-dark-solid)',
          borderLeft: '1px solid var(--surface-dark-border)',
          boxShadow: 'var(--shadow-drawer)',
          // The motion tokens (index.html); closeSidebarAnimated waits --motion-base (200ms).
          animation: sidebarClosing ? 'slideOutRight var(--motion-base) var(--ease-in) forwards' : 'slideInRight var(--motion-base) var(--ease-out)'
        }
      },
        // Header
        React.createElement('div', {
          style: { padding: '16px', borderBottom: '1px solid var(--on-dark-line)' }
        },
          React.createElement('div', { className: 'flex items-center justify-between' },
            React.createElement('div', { className: 'flex items-center gap-2' },
              React.createElement('span', { style: { color: 'var(--playbar-accent-hover)', width: '20px', height: '20px', display: 'inline-flex' } },
                React.createElement(BrandMark, { id: 'shuffleupagus', size: 20 })
              ),
              React.createElement('h3', { style: { fontSize: '16px', fontWeight: '600', color: 'var(--on-dark-primary)' } }, resultsSidebar.title)
            ),
            React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', onClick: closeAiChat, 'aria-label': 'Close', 'data-tooltip': 'Close' }, React.createElement(Icons.X, { className: 'w-5 h-5' }))
          ),
          // The chat provider selector
          React.createElement('div', { style: { marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '8px' } },
                // "powered by:" label
                React.createElement('span', { style: { fontSize: '12px', color: 'var(--on-dark-secondary)' } }, 'Powered by'),
                // Custom dropdown button
                (() => {
                  const enabledServices = getChatServices().filter(isServiceEnabled);

                  // The AI provider picker (components/provider-menu.js).
                  return React.createElement(ProviderMenu, {
                    label: 'Chat provider',
                    services: enabledServices,
                    value: selectedChatProvider,
                    onChange: (newProvider, service) => {
                      // Save current provider's history before switching
                      if (selectedChatProvider && selectedChatProvider !== newProvider && aiChatMessages.length > 0) {
                        aiChatHistoriesRef.current[selectedChatProvider] = aiChatMessages;
                      }
                      setSelectedChatProvider(newProvider);
                      // Clear current chat service so it recreates with new provider
                      aiChatServiceRef.current = null;
                      // Load saved chat history for this provider (or empty if none)
                      const savedHistory = aiChatHistoriesRef.current[newProvider] || [];
                      setAiChatMessages(savedHistory);
                      // Update sidebar with new provider and loaded messages
                      setResultsSidebar(prev => ({
                        ...prev,
                        subtitle: service.name || service.manifest?.name,
                        provider: { id: service.id, name: service.name || service.manifest?.name, icon: service.icon || service.manifest?.icon },
                        messages: savedHistory
                      }));
                    },
                  });
                })()
              )
        ),

        // The chat
        React.createElement(React.Fragment, null,
              // Chat messages area
              React.createElement('div', {
                ref: chatMessagesRef,
                className: 'flex-1 overflow-y-auto chat-messages-scroll',
                style: { padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }
              },
                // Welcome message if no messages
                (!resultsSidebar.messages || resultsSidebar.messages.length === 0) && React.createElement('div', {
                  style: { textAlign: 'center', padding: '24px 16px', color: 'var(--on-dark-secondary)' }
                },
                  React.createElement('div', { style: { marginBottom: '12px', display: 'flex', justifyContent: 'center' } },
                    React.createElement(BrandMark, { id: 'shuffleupagus', size: 48, fill: 'var(--on-dark-secondary)' })
                  ),
                  React.createElement('p', { style: { fontSize: '14px', marginBottom: '8px' } }, 'Hi! I\'m Shuffleupagus, your AI DJ.'),
                  React.createElement('p', { style: { fontSize: '12px' } }, 'Ask me to play music, manage your queue, or discover new tracks.')
                ),

                // Chat messages
                resultsSidebar.messages && (() => {
                  // Find the index of the last assistant and user messages for scroll targeting
                  const lastAssistantIndex = resultsSidebar.messages.reduce((lastIdx, msg, idx) =>
                    msg.role === 'assistant' ? idx : lastIdx, -1);
                  const lastUserIndex = resultsSidebar.messages.reduce((lastIdx, msg, idx) =>
                    msg.role === 'user' ? idx : lastIdx, -1);

                  return resultsSidebar.messages.map((msg, index) => {
                    // Determine which ref to use for this message
                    let messageRef = null;
                    if (index === lastAssistantIndex) {
                      messageRef = lastAssistantMessageRef;
                    } else if (index === lastUserIndex && lastUserIndex > lastAssistantIndex) {
                      // Only ref the user message if it's after the last assistant message (awaiting response)
                      messageRef = lastUserMessageRef;
                    }

                    return React.createElement('div', {
                      key: index,
                      ref: messageRef,
                      className: 'chat-message-row',
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start'
                      }
                    },
                      // Copy as Parachord link button (user messages only, before the bubble)
                      msg.role === 'user' && React.createElement(Button, { variant: 'icon', size: 'sm', tone: 'dark', className: 'chat-copy-link-btn', style: { opacity: 0, transition: transition('opacity', 'fast'), marginRight: '2px' }, 'aria-label': 'Share prompt', 'data-tooltip': 'Share prompt', onClick: () => {
                          const text = typeof msg.content === 'string' ? msg.content : '';
                          const truncated = text.slice(0, 500);
                          const uri = `parachord://chat?prompt=${encodeURIComponent(truncated)}`;
                          const link = `https://achordion.xyz/go?uri=${encodeURIComponent(uri)}`;
                          navigator.clipboard?.writeText(link).then(() => {
                            showToast('Copied shareable prompt link!', 'success');
                          }).catch(() => {
                            showCopyFallback('Copy this link', link);
                          });
                        } }, React.createElement(Icons.Share, { size: 14 })),
                      React.createElement('div', {
                        style: {
                          maxWidth: '85%',
                          padding: '10px 14px',
                          borderRadius: msg.role === 'user' ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                          // White text sits on the fill accent, never --accent-primary.
                          backgroundColor: msg.role === 'user' ? 'var(--accent-fill)' : 'var(--on-dark-line)',
                          color: msg.role === 'user' ? 'var(--on-accent)' : 'var(--on-dark-primary)',
                          fontSize: '14px',
                          lineHeight: '1.5',
                          whiteSpace: 'pre-wrap',
                          // overflowWrap: 'anywhere' forces breaks even mid-token
                          // so long URLs (Google error messages, etc.) wrap
                          // cleanly without horizontal clipping. The legacy
                          // word-break: 'break-word' alias used to be here but
                          // isn't reliably honored by all renderers (parachord#875).
                          overflowWrap: 'anywhere',
                          // Explicitly opt into text selection (parachord#875).
                          // Default behavior is usually fine but selection in
                          // Electron + overflow:hidden containers can be flaky;
                          // setting it explicitly is defense-in-depth.
                          userSelect: 'text',
                          WebkitUserSelect: 'text'
                        }
                      }, renderChatContent(msg.content, msg.role === 'user'))
                    );
                  });
                })(),

                // Loading indicator with progress status
                resultsSidebar.loading && React.createElement('div', {
                  style: { display: 'flex', justifyContent: 'flex-start' }
                },
                  React.createElement('div', {
                    style: {
                      padding: '12px 16px',
                      borderRadius: '16px 16px 16px 4px',
                      backgroundColor: 'var(--on-dark-line)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }
                  },
                    // Show progress status text if available, otherwise show bouncing dots
                    resultsSidebar.progressStatus
                      ? React.createElement('span', {
                          style: { fontSize: '13px', color: 'var(--on-dark-tertiary)' }
                        }, resultsSidebar.progressStatus)
                      : React.createElement(React.Fragment, null,
                          React.createElement('span', { className: 'animate-bounce', style: { animationDelay: '0ms', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--on-dark-secondary)' } }),
                          React.createElement('span', { className: 'animate-bounce', style: { animationDelay: '150ms', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--on-dark-secondary)' } }),
                          React.createElement('span', { className: 'animate-bounce', style: { animationDelay: '300ms', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: 'var(--on-dark-secondary)' } })
                        )
                  )
                )
              ),

              // Chat input area
              React.createElement('div', {
                style: { padding: '12px', borderTop: '1px solid var(--on-dark-line)' }
              },
                React.createElement('div', { className: 'flex gap-2' },
                  // The shared text field (components/fields.js), dark tone.
                  React.createElement(TextField, {
                    tone: 'dark',
                    pill: true,
                    wrapClassName: 'flex-1 min-w-0',
                    className: 'w-full',
                    value: aiChatInput,
                    onChange: setAiChatInput,
                    onKeyDown: (e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter' && aiChatInput.trim() && !aiChatLoading) {
                        handleAiChatSend(aiChatInput);
                      } else if (e.key === 'Escape') {
                        if (!aiChatInput.trim()) {
                          closeAiChat();
                        } else {
                          setAiChatInput('');
                        }
                      }
                    },
                    placeholder: 'Ask Shuffleupagus…',
                    disabled: aiChatLoading,
                    'aria-label': 'Ask Shuffleupagus'
                  }),
                  React.createElement(Button, { variant: 'primary', size: 'sm', className: 'w-9 h-9 !p-0 !rounded-full transition-transform hover:scale-105', onClick: () => aiChatInput.trim() && !aiChatLoading && handleAiChatSend(aiChatInput), disabled: !aiChatInput.trim() || aiChatLoading, 'aria-label': 'Send', 'data-tooltip': 'Send' }, aiChatLoading
                      ? React.createElement(Icons.Spinner, { size: 16 })
                      : React.createElement(Icons.ArrowRight, { className: 'w-4 h-4', strokeWidth: 2 }))
                ),
                // Bottom row: Clear chat + Share my data toggle
                React.createElement('div', {
                  style: { marginTop: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }
                },
                  // Clear chat button (left)
                  resultsSidebar.messages && resultsSidebar.messages.length > 0
                    ? React.createElement(Button, { variant: 'text', size: 'sm', tone: 'dark', onClick: clearAiChatHistory }, 'Clear conversation')
                    : React.createElement('div'),
                  // Share my data toggle (right): the shared switch, dark tone.
                  React.createElement('div', { className: 'flex items-center', style: { gap: '8px', padding: '4px 8px' } },
                    React.createElement('label', {
                      htmlFor: 'ai-chat-share-data',
                      className: 'cursor-pointer select-none',
                      style: { fontSize: '12px', color: 'var(--on-dark-secondary)', whiteSpace: 'nowrap' }
                    }, 'Share my data'),
                    React.createElement(Switch, {
                      id: 'ai-chat-share-data',
                      size: 'sm',
                      tone: 'dark',
                      checked: aiIncludeHistory,
                      onToggle: () => setAiIncludeHistory(!aiIncludeHistory),
                      'data-tooltip': aiIncludeHistory ? 'Sharing your listening with Shuffleupagus' : 'Not sharing your listening with Shuffleupagus'
                    })
                  )
                )
              )
            )

      )
    );
});

module.exports = { ResultsPanel, RESULTS_PANEL_HANDLERS };
