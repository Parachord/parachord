# AI Playlist Generation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add natural language playlist generation via OpenAI/Gemini APIs with BYOK (bring your own key).

**Architecture:** New `.axe` plugins with `generate` capability, playbar AI button, floating prompt input, and reusable results sidebar.

**Tech Stack:** Existing resolver plugin system, React (createElement), electron-store for API keys.

---

## Task 1: Create OpenAI Plugin

**Files:**
- Create: `resolvers/openai.axe`

**Step 1: Create the OpenAI plugin file**

```json
{
  "manifest": {
    "id": "openai",
    "name": "OpenAI",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Generate playlists using ChatGPT. Requires your own API key.",
    "icon": "🤖",
    "color": "#10a37f",
    "homepage": "https://platform.openai.com"
  },

  "capabilities": {
    "generate": true
  },

  "settings": {
    "requiresAuth": true,
    "authType": "apiKey",
    "configurable": {
      "apiKey": {
        "type": "password",
        "label": "API Key",
        "placeholder": "sk-...",
        "helpUrl": "https://platform.openai.com/api-keys"
      },
      "model": {
        "type": "select",
        "label": "Model",
        "default": "gpt-4o-mini",
        "options": [
          { "value": "gpt-4o-mini", "label": "GPT-4o Mini (Recommended)" },
          { "value": "gpt-4o", "label": "GPT-4o" },
          { "value": "gpt-3.5-turbo", "label": "GPT-3.5 Turbo" }
        ]
      }
    }
  },

  "implementation": {
    "generate": "async function(prompt, config) { if (!config.apiKey) { throw new Error('API key required. Add your OpenAI API key in Settings → General → AI Integration.'); } try { const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model || 'gpt-4o-mini', messages: [{ role: 'system', content: 'You are a music recommendation assistant. Given a prompt, return a JSON object with a \"tracks\" array containing 10-15 track recommendations. Each track must have \"artist\" and \"title\" fields. Only return valid JSON, no explanation or markdown.' }, { role: 'user', content: prompt }], response_format: { type: 'json_object' } }) }); if (!response.ok) { const error = await response.json().catch(() => ({})); if (response.status === 401) { throw new Error('Invalid API key. Check your OpenAI API key in Settings.'); } if (response.status === 429) { throw new Error('Rate limit exceeded. Please wait a moment and try again.'); } throw new Error(error.error?.message || 'OpenAI API request failed'); } const data = await response.json(); const content = data.choices[0]?.message?.content; if (!content) { throw new Error('No response from OpenAI'); } const parsed = JSON.parse(content); const tracks = parsed.tracks || parsed.playlist || parsed.songs || []; if (!Array.isArray(tracks) || tracks.length === 0) { throw new Error('AI returned no tracks. Try a different prompt.'); } return tracks.map(t => ({ artist: t.artist || t.Artist || '', title: t.title || t.track || t.song || t.Title || '' })).filter(t => t.artist && t.title); } catch (error) { if (error.message.includes('API key') || error.message.includes('Rate limit') || error.message.includes('No response') || error.message.includes('no tracks')) { throw error; } console.error('OpenAI generate error:', error); throw new Error('Failed to generate playlist: ' + error.message); } }",

    "init": "async function(config) { console.log('OpenAI plugin initialized'); }",

    "cleanup": "async function() { console.log('OpenAI plugin cleanup'); }"
  }
}
```

**Step 2: Verify file is valid JSON**

Run: `cat resolvers/openai.axe | python3 -m json.tool > /dev/null && echo "Valid JSON"`
Expected: "Valid JSON"

**Step 3: Commit**

```bash
git add resolvers/openai.axe
git commit -m "feat: add OpenAI plugin for AI playlist generation"
```

---

## Task 2: Create Gemini Plugin

**Files:**
- Create: `resolvers/gemini.axe`

**Step 1: Create the Gemini plugin file**

```json
{
  "manifest": {
    "id": "gemini",
    "name": "Google Gemini",
    "version": "1.0.0",
    "author": "Parachord Team",
    "description": "Generate playlists using Google Gemini. Requires your own API key.",
    "icon": "✦",
    "color": "#4285f4",
    "homepage": "https://ai.google.dev"
  },

  "capabilities": {
    "generate": true
  },

  "settings": {
    "requiresAuth": true,
    "authType": "apiKey",
    "configurable": {
      "apiKey": {
        "type": "password",
        "label": "API Key",
        "placeholder": "AIza...",
        "helpUrl": "https://aistudio.google.com/app/apikey"
      },
      "model": {
        "type": "select",
        "label": "Model",
        "default": "gemini-1.5-flash",
        "options": [
          { "value": "gemini-1.5-flash", "label": "Gemini 1.5 Flash (Recommended)" },
          { "value": "gemini-1.5-pro", "label": "Gemini 1.5 Pro" }
        ]
      }
    }
  },

  "implementation": {
    "generate": "async function(prompt, config) { if (!config.apiKey) { throw new Error('API key required. Add your Google API key in Settings → General → AI Integration.'); } try { const model = config.model || 'gemini-1.5-flash'; const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: 'You are a music recommendation assistant. Given a prompt, return a JSON object with a \"tracks\" array containing 10-15 track recommendations. Each track must have \"artist\" and \"title\" fields. Only return valid JSON, no explanation or markdown.\\n\\nPrompt: ' + prompt }] }], generationConfig: { responseMimeType: 'application/json' } }) }); if (!response.ok) { const error = await response.json().catch(() => ({})); if (response.status === 400 && error.error?.message?.includes('API key')) { throw new Error('Invalid API key. Check your Google API key in Settings.'); } if (response.status === 429) { throw new Error('Rate limit exceeded. Please wait a moment and try again.'); } throw new Error(error.error?.message || 'Gemini API request failed'); } const data = await response.json(); const content = data.candidates?.[0]?.content?.parts?.[0]?.text; if (!content) { throw new Error('No response from Gemini'); } const parsed = JSON.parse(content); const tracks = parsed.tracks || parsed.playlist || parsed.songs || []; if (!Array.isArray(tracks) || tracks.length === 0) { throw new Error('AI returned no tracks. Try a different prompt.'); } return tracks.map(t => ({ artist: t.artist || t.Artist || '', title: t.title || t.track || t.song || t.Title || '' })).filter(t => t.artist && t.title); } catch (error) { if (error.message.includes('API key') || error.message.includes('Rate limit') || error.message.includes('No response') || error.message.includes('no tracks')) { throw error; } console.error('Gemini generate error:', error); throw new Error('Failed to generate playlist: ' + error.message); } }",

    "init": "async function(config) { console.log('Gemini plugin initialized'); }",

    "cleanup": "async function() { console.log('Gemini plugin cleanup'); }"
  }
}
```

**Step 2: Verify file is valid JSON**

Run: `cat resolvers/gemini.axe | python3 -m json.tool > /dev/null && echo "Valid JSON"`
Expected: "Valid JSON"

**Step 3: Commit**

```bash
git add resolvers/gemini.axe
git commit -m "feat: add Gemini plugin for AI playlist generation"
```

---

## Task 3: Add AI State Variables

**Files:**
- Modify: `app.js` (around line 1450, after volume state)

**Step 1: Add new state variables after the volume-related state**

Find this line (around 1449):
```javascript
  // Per-track volume adjustments (trackId -> dB offset from resolver default)
```

Add after the `trackVolumeAdjustments` state (around line 1452):

```javascript
  // AI Playlist Generation state
  const [aiPromptOpen, setAiPromptOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  const [selectedAiResolver, setSelectedAiResolver] = useState(null);

  // Results sidebar state (generic/reusable)
  const [resultsSidebar, setResultsSidebar] = useState(null);
  // Shape: { title, subtitle, tracks: [], source: 'ai' | 'search' | etc }
```

**Step 2: Verify the app still loads**

Run: `npm start`
Expected: App launches without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add AI playlist generation state variables"
```

---

## Task 4: Add Helper to Get AI-Capable Resolvers

**Files:**
- Modify: `app.js` (around line 2850, near other resolver helper functions)

**Step 1: Find the `getResolverSettingsHash` function and add a new helper nearby**

Find this line (around 2857):
```javascript
  const getResolverSettingsHash = () => {
```

Add before it:

```javascript
  // Get resolvers with AI generation capability
  const getAiResolvers = () => {
    return allResolvers.filter(r => r.capabilities?.generate && r.enabled);
  };

```

**Step 2: Verify the app still loads**

Run: `npm start`
Expected: App launches without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add helper function for AI-capable resolvers"
```

---

## Task 5: Add AI Generate Function

**Files:**
- Modify: `app.js` (around line 5630, before `addToQueue`)

**Step 1: Add the AI generation handler function**

Find this line (around 5633):
```javascript
  const addToQueue = (tracks) => {
```

Add before it:

```javascript
  // AI Playlist Generation
  const handleAiGenerate = async (prompt) => {
    const aiResolvers = getAiResolvers();
    if (aiResolvers.length === 0) {
      setAiError('No AI plugins configured. Enable OpenAI or Gemini in Settings → General.');
      return;
    }

    // Use selected resolver or first available
    const resolver = selectedAiResolver
      ? aiResolvers.find(r => r.id === selectedAiResolver) || aiResolvers[0]
      : aiResolvers[0];

    setAiLoading(true);
    setAiError(null);

    try {
      // Get resolver config from stored configs
      const config = resolverConfigs[resolver.id] || {};

      // Call the resolver's generate function
      const tracks = await resolver.generate(prompt, config);

      if (!tracks || tracks.length === 0) {
        throw new Error('No tracks returned. Try a different prompt.');
      }

      // Open results sidebar with the generated tracks
      setResultsSidebar({
        title: '✨ AI Playlist',
        subtitle: `"${prompt.length > 50 ? prompt.substring(0, 50) + '...' : prompt}"`,
        tracks: tracks.map((t, i) => ({
          id: `ai-${Date.now()}-${i}`,
          title: t.title,
          artist: t.artist,
          album: t.album || '',
          sources: {} // Will be resolved when added to queue
        })),
        source: 'ai',
        prompt: prompt
      });

      // Close prompt input
      setAiPromptOpen(false);
      setAiPrompt('');
    } catch (error) {
      console.error('AI generation error:', error);
      setAiError(error.message || 'Failed to generate playlist');
    } finally {
      setAiLoading(false);
    }
  };

  // Handle adding AI results to queue
  const handleAiAddToQueue = () => {
    if (!resultsSidebar?.tracks) return;
    addToQueue(resultsSidebar.tracks);
    setResultsSidebar(null);
    showToast(`Added ${resultsSidebar.tracks.length} tracks to queue`);
  };

  // Handle saving AI results as playlist
  const handleAiSavePlaylist = async () => {
    if (!resultsSidebar?.tracks) return;

    const playlistName = resultsSidebar.prompt
      ? `AI: ${resultsSidebar.prompt.substring(0, 40)}${resultsSidebar.prompt.length > 40 ? '...' : ''}`
      : 'AI Generated Playlist';

    const playlistId = `ai-${Date.now()}`;
    const newPlaylist = {
      id: playlistId,
      title: playlistName,
      creator: 'AI',
      tracks: resultsSidebar.tracks,
      createdAt: new Date().toISOString()
    };

    // Add to playlists state
    setPlaylists(prev => [...prev, newPlaylist]);

    // Save to disk
    const filename = `${playlistId}.xspf`;
    const xspfContent = buildXSPF(newPlaylist);
    await window.electron.playlists.save(filename, xspfContent);

    setResultsSidebar(null);
    showToast(`Saved playlist: ${playlistName}`);
  };

```

**Step 2: Verify the app still loads**

Run: `npm start`
Expected: App launches without errors

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add AI generate and result handling functions"
```

---

## Task 6: Add AI Button to Playbar

**Files:**
- Modify: `app.js` (around line 20718, after the shuffle button)

**Step 1: Find the shuffle button and add the AI button after it**

Find this section (around line 20709-20718):
```javascript
          // Shuffle button (placeholder)
          React.createElement('button', {
            disabled: true,
            className: 'p-2 rounded text-gray-600 cursor-not-allowed',
            title: 'Shuffle (coming soon)'
          },
            React.createElement('svg', { className: 'w-4 h-4', viewBox: '0 0 18 18', fill: 'currentColor' },
              React.createElement('path', { d: 'M17.5,1.5l-8.6,7l-8.4-7v14.9l8.3-6.9l8.8,7.1V1.5z M1.5,14.2V3.6l6.4,5.3L1.5,14.2z M16.5,14.4L9.8,9l6.7-5.4V14.4z' })
            )
          ),
```

Add after the shuffle button (before the volume section):

```javascript
          // AI Playlist Generation button
          (() => {
            const aiResolvers = getAiResolvers();
            const hasAiResolvers = aiResolvers.length > 0;
            return React.createElement('button', {
              onClick: () => setAiPromptOpen(!aiPromptOpen),
              disabled: !hasAiResolvers,
              className: `p-2 rounded transition-colors ${
                aiPromptOpen
                  ? 'bg-purple-500/30 text-purple-300'
                  : hasAiResolvers
                    ? 'text-gray-400 hover:bg-white/10 hover:text-white'
                    : 'text-gray-600 cursor-not-allowed'
              }`,
              title: hasAiResolvers
                ? 'Generate playlist with AI'
                : 'Enable an AI plugin in Settings → General'
            },
              React.createElement('svg', {
                className: 'w-4 h-4',
                viewBox: '0 0 24 24',
                fill: 'currentColor'
              },
                // Sparkle/magic wand icon
                React.createElement('path', {
                  d: 'M12 2L9.19 8.63L2 9.24L7.46 13.97L5.82 21L12 17.27L18.18 21L16.54 13.97L22 9.24L14.81 8.63L12 2Z'
                })
              )
            );
          })(),
```

**Step 2: Verify the AI button appears in the playbar**

Run: `npm start`
Expected: Sparkle button visible in playbar (disabled if no AI plugins enabled)

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add AI button to playbar"
```

---

## Task 7: Add AI Prompt Input Panel

**Files:**
- Modify: `app.js` (around line 20775, after the playbar closing tag, before modals)

**Step 1: Find where modals begin and add the AI prompt panel**

Find this line (around line 20775):
```javascript
    // Import Playlist Dialog Modal
    showUrlImportDialog && React.createElement('div', {
```

Add before it:

```javascript
    // AI Prompt Input Panel (floating above playbar)
    aiPromptOpen && React.createElement('div', {
      className: 'fixed bottom-24 right-8 z-50 bg-gray-800/95 backdrop-blur-xl border border-gray-700 rounded-xl shadow-2xl p-4',
      style: { width: '380px' }
    },
      // Header
      React.createElement('div', { className: 'flex items-center justify-between mb-3' },
        React.createElement('div', { className: 'flex items-center gap-2' },
          React.createElement('span', { className: 'text-purple-400' }, '✨'),
          React.createElement('span', { className: 'text-sm font-medium text-white' }, 'Generate Playlist')
        ),
        React.createElement('button', {
          onClick: () => {
            setAiPromptOpen(false);
            setAiPrompt('');
            setAiError(null);
          },
          className: 'p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors'
        },
          React.createElement('svg', { className: 'w-4 h-4', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
            React.createElement('path', { d: 'M6 18L18 6M6 6l12 12' })
          )
        )
      ),

      // Input
      React.createElement('div', { className: 'relative' },
        React.createElement('input', {
          type: 'text',
          value: aiPrompt,
          onChange: (e) => setAiPrompt(e.target.value),
          onKeyDown: (e) => {
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
          className: 'w-full bg-gray-700/50 border border-gray-600 rounded-lg px-4 py-3 pr-12 text-white placeholder-gray-400 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 disabled:opacity-50'
        }),
        React.createElement('button', {
          onClick: () => aiPrompt.trim() && !aiLoading && handleAiGenerate(aiPrompt.trim()),
          disabled: !aiPrompt.trim() || aiLoading,
          className: 'absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-500 text-white'
        },
          aiLoading
            ? React.createElement('svg', { className: 'w-4 h-4 animate-spin', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
                React.createElement('circle', { cx: 12, cy: 12, r: 10, strokeOpacity: 0.25 }),
                React.createElement('path', { d: 'M12 2a10 10 0 0 1 10 10', strokeLinecap: 'round' })
              )
            : React.createElement('svg', { className: 'w-4 h-4', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
                React.createElement('path', { strokeLinecap: 'round', strokeLinejoin: 'round', d: 'M14 5l7 7m0 0l-7 7m7-7H3' })
              )
        )
      ),

      // Provider selector (only if multiple AI resolvers)
      (() => {
        const aiResolvers = getAiResolvers();
        if (aiResolvers.length <= 1) return null;
        return React.createElement('div', { className: 'mt-3 flex items-center justify-end gap-2' },
          React.createElement('span', { className: 'text-xs text-gray-500' }, 'Provider:'),
          React.createElement('select', {
            value: selectedAiResolver || aiResolvers[0]?.id || '',
            onChange: (e) => setSelectedAiResolver(e.target.value),
            className: 'bg-gray-700 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:outline-none focus:border-purple-500'
          },
            aiResolvers.map(r =>
              React.createElement('option', { key: r.id, value: r.id }, r.name)
            )
          )
        );
      })(),

      // Error message
      aiError && React.createElement('div', { className: 'mt-3 p-2 bg-red-500/20 border border-red-500/30 rounded-lg' },
        React.createElement('p', { className: 'text-xs text-red-300' }, aiError)
      ),

      // Hint
      !aiError && React.createElement('p', { className: 'mt-3 text-xs text-gray-500' },
        'Try: "upbeat 90s hip hop" or "relaxing jazz for studying"'
      )
    ),

```

**Step 2: Verify the prompt panel appears when clicking the AI button**

Run: `npm start`
Expected: Clicking the sparkle button opens a floating prompt input panel

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add AI prompt input panel"
```

---

## Task 8: Add Results Sidebar

**Files:**
- Modify: `app.js` (around line 20775, right after the AI prompt panel)

**Step 1: Add the results sidebar after the AI prompt panel**

Add right after the AI prompt panel closing parenthesis:

```javascript
    // Results Sidebar (slides in from right)
    resultsSidebar && React.createElement('div', {
      className: 'fixed top-0 right-0 bottom-0 z-40 flex'
    },
      // Backdrop (click to close)
      React.createElement('div', {
        className: 'flex-1 bg-black/30 backdrop-blur-sm',
        onClick: () => setResultsSidebar(null)
      }),

      // Sidebar panel
      React.createElement('div', {
        className: 'w-80 bg-gray-900 border-l border-gray-700 flex flex-col shadow-2xl',
        style: { animation: 'slideInRight 0.2s ease-out' }
      },
        // Header
        React.createElement('div', { className: 'p-4 border-b border-gray-700' },
          React.createElement('div', { className: 'flex items-center justify-between' },
            React.createElement('h3', { className: 'text-lg font-semibold text-white' }, resultsSidebar.title),
            React.createElement('button', {
              onClick: () => setResultsSidebar(null),
              className: 'p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors'
            },
              React.createElement('svg', { className: 'w-5 h-5', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
                React.createElement('path', { d: 'M6 18L18 6M6 6l12 12' })
              )
            )
          ),
          resultsSidebar.subtitle && React.createElement('p', {
            className: 'text-sm text-gray-400 mt-1 truncate'
          }, resultsSidebar.subtitle)
        ),

        // Track list
        React.createElement('div', { className: 'flex-1 overflow-y-auto p-2' },
          resultsSidebar.tracks.map((track, index) =>
            React.createElement('div', {
              key: track.id || index,
              className: 'group flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-colors'
            },
              // Track number
              React.createElement('span', { className: 'w-6 text-center text-xs text-gray-500' }, index + 1),

              // Track info
              React.createElement('div', { className: 'flex-1 min-w-0' },
                React.createElement('div', { className: 'text-sm text-white truncate' }, track.title),
                React.createElement('div', { className: 'text-xs text-gray-400 truncate' }, track.artist)
              ),

              // Remove button
              React.createElement('button', {
                onClick: () => {
                  setResultsSidebar(prev => ({
                    ...prev,
                    tracks: prev.tracks.filter((_, i) => i !== index)
                  }));
                },
                className: 'opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/20 text-gray-500 hover:text-red-400 transition-all'
              },
                React.createElement('svg', { className: 'w-4 h-4', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
                  React.createElement('path', { d: 'M6 18L18 6M6 6l12 12' })
                )
              )
            )
          )
        ),

        // Empty state
        resultsSidebar.tracks.length === 0 && React.createElement('div', {
          className: 'flex-1 flex items-center justify-center p-4'
        },
          React.createElement('p', { className: 'text-sm text-gray-500' }, 'No tracks remaining')
        ),

        // Actions
        React.createElement('div', { className: 'p-4 border-t border-gray-700 space-y-2' },
          React.createElement('button', {
            onClick: handleAiAddToQueue,
            disabled: resultsSidebar.tracks.length === 0,
            className: 'w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed'
          }, `Add ${resultsSidebar.tracks.length} to Queue`),
          React.createElement('button', {
            onClick: handleAiSavePlaylist,
            disabled: resultsSidebar.tracks.length === 0,
            className: 'w-full py-2.5 px-4 bg-gray-700 hover:bg-gray-600 disabled:bg-gray-800 disabled:text-gray-500 text-white font-medium rounded-lg transition-colors disabled:cursor-not-allowed'
          }, 'Save as Playlist')
        )
      )
    ),

```

**Step 2: Add CSS animation for sidebar**

Find the `<style>` tag in the app (search for `@keyframes`) and add:

```css
@keyframes slideInRight {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}
```

**Step 3: Verify the sidebar appears with mock data**

Run: `npm start`
Expected: After AI generation, sidebar slides in from the right with track list

**Step 4: Commit**

```bash
git add app.js
git commit -m "feat: add results sidebar for AI-generated playlists"
```

---

## Task 9: Add AI Settings Section

**Files:**
- Modify: `app.js` (around line 19728, in the General settings tab)

**Step 1: Find the General tab content and add AI Integration section**

Find this section (around line 19727-19735):
```javascript
            // General Tab
            settingsTab === 'general' && React.createElement('div', null,
              // Page Header
              React.createElement('div', { className: 'mb-8' },
                React.createElement('h2', { className: 'text-xl font-semibold text-gray-900' }, 'General'),
                React.createElement('p', { className: 'text-sm text-gray-500 mt-1' },
                  'Configure application settings and preferences.'
                )
              ),

              // Settings sections
              React.createElement('div', { className: 'space-y-8' },
```

After the `space-y-8` div opening, add the AI Integration section (before Cache Management):

```javascript
                // AI Integration Section
                React.createElement('div', {
                  className: 'bg-white border border-gray-200 rounded-xl p-6 hover:shadow-sm hover:border-gray-300 transition-all'
                },
                  React.createElement('div', { className: 'mb-5' },
                    React.createElement('h3', {
                      className: 'text-sm font-semibold text-gray-700 uppercase tracking-wider'
                    }, 'AI Integration'),
                    React.createElement('p', {
                      className: 'text-xs text-gray-500 mt-1'
                    }, 'Connect AI services to generate playlists from natural language prompts')
                  ),

                  // AI Resolver cards
                  React.createElement('div', { className: 'space-y-4' },
                    allResolvers.filter(r => r.capabilities?.generate).map(resolver => {
                      const config = resolverConfigs[resolver.id] || {};
                      const isEnabled = resolver.enabled;
                      const [showApiKey, setShowApiKey] = React.useState ? React.useState(false) : [false, () => {}];

                      return React.createElement('div', {
                        key: resolver.id,
                        className: `border rounded-lg transition-all ${isEnabled ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200 bg-gray-50'}`
                      },
                        // Header row
                        React.createElement('div', {
                          className: 'flex items-center justify-between p-4'
                        },
                          React.createElement('div', { className: 'flex items-center gap-3' },
                            React.createElement('span', {
                              className: 'text-xl',
                              style: { color: resolver.color }
                            }, resolver.icon),
                            React.createElement('div', null,
                              React.createElement('span', { className: 'font-medium text-gray-900' }, resolver.name),
                              React.createElement('p', { className: 'text-xs text-gray-500' }, resolver.description)
                            )
                          ),
                          React.createElement('button', {
                            onClick: () => {
                              const newEnabled = !isEnabled;
                              // Update resolver enabled state
                              const updatedResolvers = allResolvers.map(r =>
                                r.id === resolver.id ? { ...r, enabled: newEnabled } : r
                              );
                              setAllResolvers(updatedResolvers);
                              // Persist config
                              setResolverConfigs(prev => ({
                                ...prev,
                                [resolver.id]: { ...prev[resolver.id], enabled: newEnabled }
                              }));
                            },
                            className: `px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                              isEnabled
                                ? 'bg-purple-100 text-purple-700 hover:bg-purple-200'
                                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                            }`
                          }, isEnabled ? 'Enabled' : 'Disabled')
                        ),

                        // Config section (only when enabled)
                        isEnabled && React.createElement('div', { className: 'px-4 pb-4 space-y-4 border-t border-gray-100 pt-4' },
                          // API Key
                          React.createElement('div', null,
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' }, 'API Key'),
                            React.createElement('div', { className: 'relative' },
                              React.createElement('input', {
                                type: showApiKey ? 'text' : 'password',
                                value: config.apiKey || '',
                                onChange: (e) => {
                                  setResolverConfigs(prev => ({
                                    ...prev,
                                    [resolver.id]: { ...prev[resolver.id], apiKey: e.target.value }
                                  }));
                                },
                                placeholder: resolver.id === 'openai' ? 'sk-...' : 'AIza...',
                                className: 'w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent'
                              }),
                              React.createElement('button', {
                                type: 'button',
                                onClick: () => setShowApiKey(!showApiKey),
                                className: 'absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600'
                              },
                                React.createElement('svg', { className: 'w-5 h-5', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2 },
                                  showApiKey
                                    ? React.createElement('path', { d: 'M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21' })
                                    : React.createElement('path', { d: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z' })
                                )
                              )
                            ),
                            React.createElement('a', {
                              href: '#',
                              onClick: (e) => {
                                e.preventDefault();
                                const url = resolver.id === 'openai'
                                  ? 'https://platform.openai.com/api-keys'
                                  : 'https://aistudio.google.com/app/apikey';
                                window.electron?.shell?.openExternal?.(url);
                              },
                              className: 'text-xs text-purple-600 hover:text-purple-700 mt-1 inline-block'
                            }, 'Get your API key →')
                          ),

                          // Model selector
                          React.createElement('div', null,
                            React.createElement('label', { className: 'block text-sm font-medium text-gray-700 mb-1' }, 'Model'),
                            React.createElement('select', {
                              value: config.model || (resolver.id === 'openai' ? 'gpt-4o-mini' : 'gemini-1.5-flash'),
                              onChange: (e) => {
                                setResolverConfigs(prev => ({
                                  ...prev,
                                  [resolver.id]: { ...prev[resolver.id], model: e.target.value }
                                }));
                              },
                              className: 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white'
                            },
                              resolver.id === 'openai' ? [
                                React.createElement('option', { key: 'gpt-4o-mini', value: 'gpt-4o-mini' }, 'GPT-4o Mini (Recommended)'),
                                React.createElement('option', { key: 'gpt-4o', value: 'gpt-4o' }, 'GPT-4o'),
                                React.createElement('option', { key: 'gpt-3.5-turbo', value: 'gpt-3.5-turbo' }, 'GPT-3.5 Turbo')
                              ] : [
                                React.createElement('option', { key: 'gemini-1.5-flash', value: 'gemini-1.5-flash' }, 'Gemini 1.5 Flash (Recommended)'),
                                React.createElement('option', { key: 'gemini-1.5-pro', value: 'gemini-1.5-pro' }, 'Gemini 1.5 Pro')
                              ]
                            )
                          )
                        )
                      );
                    })
                  ),

                  // No AI resolvers message
                  allResolvers.filter(r => r.capabilities?.generate).length === 0 &&
                    React.createElement('p', { className: 'text-sm text-gray-500 italic' },
                      'No AI plugins installed. AI plugins will appear here when available.'
                    )
                ),

```

**Step 2: Verify the AI settings section appears**

Run: `npm start`
Expected: Settings → General shows "AI Integration" section with OpenAI and Gemini cards

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat: add AI Integration settings section"
```

---

## Task 10: Wire Up Resolver Config Persistence

**Files:**
- Modify: `app.js` (around line 5806, in the settings loading useEffect)

**Step 1: Find where resolver settings are loaded and add AI resolver config loading**

Find the section that loads resolver settings (around line 5806):
```javascript
      // Load resolver settings
```

Verify that `resolverConfigs` state already persists AI plugin configs. The existing code should handle this since we're using the same `resolverConfigs` pattern.

If needed, ensure the save effect also captures AI resolver configs. Find the save effect (around line 6027):
```javascript
      // Save resolver settings (use refs to ensure we have current values, not stale closure)
```

The existing persistence should work since we're using the standard `resolverConfigs` state.

**Step 2: Test persistence**

Run: `npm start`
1. Go to Settings → General
2. Enable OpenAI, add an API key
3. Quit the app
4. Restart the app
Expected: API key should persist

**Step 3: Commit (if changes were needed)**

```bash
git add app.js
git commit -m "fix: ensure AI resolver configs persist correctly"
```

---

## Task 11: Test End-to-End Flow

**Files:** None (testing only)

**Step 1: Test with OpenAI**

1. Get an OpenAI API key from https://platform.openai.com/api-keys
2. Go to Settings → General → AI Integration
3. Enable OpenAI and paste your API key
4. Click the sparkle button in the playbar
5. Type "10 classic rock songs from the 70s"
6. Press Enter

Expected:
- Loading spinner appears
- After a few seconds, results sidebar slides in with track list
- Tracks show artist and title

**Step 2: Test adding to queue**

1. Click "Add 10 to Queue" (or however many tracks)
2. Check the queue drawer

Expected:
- Sidebar closes
- Toast notification appears
- Tracks appear in queue
- Tracks begin resolving in background

**Step 3: Test saving as playlist**

1. Generate another playlist
2. Click "Save as Playlist"
3. Check the Playlists section

Expected:
- Sidebar closes
- Toast notification appears
- New playlist appears in sidebar with "AI:" prefix

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: end-to-end testing fixes for AI playlist generation"
```

---

## Task 12: Final Cleanup and Commit

**Step 1: Run the app and check for console errors**

Run: `npm start`
Expected: No errors in console related to AI features

**Step 2: Test error states**

1. Test with invalid API key → Should show error message
2. Test with empty prompt → Button should be disabled
3. Test removing all tracks from sidebar → Buttons should be disabled

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat: complete AI playlist generation feature

- Add OpenAI and Gemini plugins with generate capability
- Add AI button in playbar with floating prompt input
- Add results sidebar for reviewing/editing AI suggestions
- Add AI Integration settings section for API key configuration
- Support adding AI results to queue or saving as playlist"
```
