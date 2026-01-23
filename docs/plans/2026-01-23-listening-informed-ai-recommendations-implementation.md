# Listening-Informed AI Recommendations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add opt-in listening history context to AI playlist generation using existing Last.fm/ListenBrainz data.

**Architecture:** When user enables "Include my listening history" toggle, fetch top 10 artists and 25 tracks from their connected scrobbler (3-month window), format as JSON context, and prepend to AI prompt. No new storage required.

**Tech Stack:** React (vanilla, no JSX), Last.fm API, ListenBrainz API, OpenAI/Gemini APIs

---

## Task 1: Add State for Listening History Toggle

**Files:**
- Modify: `app.js:1466-1470` (near existing AI state)

**Step 1: Add state variable**

Find the existing AI state declarations around line 1466:
```javascript
const [aiPromptOpen, setAiPromptOpen] = useState(false);
const [aiPrompt, setAiPrompt] = useState('');
const [aiLoading, setAiLoading] = useState(false);
```

Add after `aiLoading`:
```javascript
const [aiIncludeHistory, setAiIncludeHistory] = useState(false);
```

**Step 2: Persist toggle preference**

Find where other preferences are loaded from electron-store on app init. Add loading of saved preference:
```javascript
// In useEffect that loads initial state, add:
window.electron.store.get('aiIncludeHistory').then(val => {
  if (val !== undefined) setAiIncludeHistory(val);
});
```

Add saving when toggle changes (create new useEffect):
```javascript
useEffect(() => {
  window.electron.store.set('aiIncludeHistory', aiIncludeHistory);
}, [aiIncludeHistory]);
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(ai): add state for listening history toggle"
```

---

## Task 2: Add fetchListeningContext Helper Function

**Files:**
- Modify: `app.js` (add near `handleAiGenerate` function around line 5679)

**Step 1: Add the helper function**

Add before `handleAiGenerate`:

```javascript
// Fetch listening context from Last.fm or ListenBrainz for AI prompt enrichment
const fetchListeningContext = async () => {
  const lastfmConfig = metaServiceConfigs.lastfm;
  const listenbrainzConfig = metaServiceConfigs.listenbrainz;

  // Try Last.fm first
  if (lastfmConfig?.username) {
    const apiKey = lastfmApiKey.current;
    if (apiKey) {
      try {
        console.log('🎵 Fetching listening context from Last.fm...');

        // Fetch top artists (10) and top tracks (25) in parallel
        const [artistsRes, tracksRes] = await Promise.all([
          fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettopartists&user=${encodeURIComponent(lastfmConfig.username)}&api_key=${apiKey}&format=json&period=3month&limit=10`),
          fetch(`https://ws.audioscrobbler.com/2.0/?method=user.gettoptracks&user=${encodeURIComponent(lastfmConfig.username)}&api_key=${apiKey}&format=json&period=3month&limit=25`)
        ]);

        if (artistsRes.ok && tracksRes.ok) {
          const [artistsData, tracksData] = await Promise.all([artistsRes.json(), tracksRes.json()]);

          const topArtists = (artistsData.topartists?.artist || []).map(a => a.name);
          const topTracks = (tracksData.toptracks?.track || []).map(t => ({
            artist: t.artist?.name || 'Unknown',
            title: t.name
          }));

          console.log(`🎵 Got ${topArtists.length} artists and ${topTracks.length} tracks from Last.fm`);

          return {
            source: 'Last.fm',
            window: 'last_3_months',
            top_artists: topArtists,
            top_tracks: topTracks
          };
        }
      } catch (err) {
        console.error('Failed to fetch Last.fm context:', err);
      }
    }
  }

  // Fall back to ListenBrainz
  if (listenbrainzConfig?.username) {
    try {
      console.log('🎵 Fetching listening context from ListenBrainz...');

      // Fetch top artists (10) and top tracks (25) in parallel
      const [artistsRes, tracksRes] = await Promise.all([
        fetch(`https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(listenbrainzConfig.username)}/artists?range=quarter&count=10`),
        fetch(`https://api.listenbrainz.org/1/stats/user/${encodeURIComponent(listenbrainzConfig.username)}/recordings?range=quarter&count=25`)
      ]);

      // Handle 204 No Content
      if (artistsRes.status === 204 || tracksRes.status === 204) {
        console.log('🎵 No ListenBrainz stats available for this period');
        return null;
      }

      if (artistsRes.ok && tracksRes.ok) {
        const [artistsData, tracksData] = await Promise.all([artistsRes.json(), tracksRes.json()]);

        const topArtists = (artistsData.payload?.artists || []).map(a => a.artist_name);
        const topTracks = (tracksData.payload?.recordings || []).map(t => ({
          artist: t.artist_name || 'Unknown',
          title: t.track_name
        }));

        console.log(`🎵 Got ${topArtists.length} artists and ${topTracks.length} tracks from ListenBrainz`);

        return {
          source: 'ListenBrainz',
          window: 'last_3_months',
          top_artists: topArtists,
          top_tracks: topTracks
        };
      }
    } catch (err) {
      console.error('Failed to fetch ListenBrainz context:', err);
    }
  }

  return null;
};
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(ai): add fetchListeningContext helper for scrobbler data"
```

---

## Task 3: Update handleAiGenerate to Use Listening Context

**Files:**
- Modify: `app.js:5679-5735` (handleAiGenerate function)

**Step 1: Modify handleAiGenerate**

Update the function to fetch and pass listening context:

```javascript
const handleAiGenerate = async (prompt) => {
  const aiServices = getAiServices();
  // Filter to only enabled services with API keys
  const enabledServices = aiServices.filter(s => {
    const config = metaServiceConfigs[s.id] || {};
    return config.enabled && config.apiKey;
  });

  if (enabledServices.length === 0) {
    setAiError('No AI plugins configured. Enable OpenAI or Gemini and add your API key in Settings → General.');
    return;
  }

  // Use selected service or first available
  const service = selectedAiResolver
    ? enabledServices.find(s => s.id === selectedAiResolver) || enabledServices[0]
    : enabledServices[0];

  setAiLoading(true);
  setAiError(null);

  try {
    // Get service config from metaServiceConfigs
    const config = metaServiceConfigs[service.id] || {};

    // Fetch listening context if toggle is enabled
    let listeningContext = null;
    if (aiIncludeHistory) {
      listeningContext = await fetchListeningContext();
      if (!listeningContext) {
        console.log('🎵 No listening context available, proceeding without');
      }
    }

    // Call the service's generate function with listening context
    const tracks = await service.generate(prompt, config, listeningContext);

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
```

**Step 2: Commit**

```bash
git add app.js
git commit -m "feat(ai): pass listening context to generate function"
```

---

## Task 4: Add Toggle Checkbox to AI Prompt UI

**Files:**
- Modify: `app.js:21196-21222` (AI prompt input panel)

**Step 1: Add helper to check if scrobbler is connected**

Add near other helper functions:
```javascript
const hasScrobblerConnected = () => {
  const lastfmConfig = metaServiceConfigs.lastfm;
  const listenbrainzConfig = metaServiceConfigs.listenbrainz;
  return !!(lastfmConfig?.username || listenbrainzConfig?.username);
};

const getScrobblerName = () => {
  const lastfmConfig = metaServiceConfigs.lastfm;
  if (lastfmConfig?.username) return 'Last.fm';
  const listenbrainzConfig = metaServiceConfigs.listenbrainz;
  if (listenbrainzConfig?.username) return 'ListenBrainz';
  return null;
};
```

**Step 2: Add checkbox between provider selector and error message**

Find the provider selector section (around line 21196-21212) and add after it:

```javascript
// Listening history toggle (only if scrobbler connected)
hasScrobblerConnected() && React.createElement('div', {
  className: 'mt-3 flex items-center gap-2'
},
  React.createElement('input', {
    type: 'checkbox',
    id: 'ai-include-history',
    checked: aiIncludeHistory,
    onChange: (e) => setAiIncludeHistory(e.target.checked),
    className: 'w-4 h-4 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0 cursor-pointer'
  }),
  React.createElement('label', {
    htmlFor: 'ai-include-history',
    className: 'text-xs text-gray-400 cursor-pointer select-none'
  }, `Include my ${getScrobblerName()} history`)
),
```

**Step 3: Commit**

```bash
git add app.js
git commit -m "feat(ai): add listening history toggle to prompt UI"
```

---

## Task 5: Update ChatGPT Plugin System Prompt and Generate Function

**Files:**
- Modify: `resolvers/chatgpt.axe`

**Step 1: Update the generate function**

Replace the entire implementation.generate string with:

```javascript
"generate": "async function(prompt, config, listeningContext) { if (!config.apiKey) { throw new Error('API key required. Add your OpenAI API key in Settings → General → AI Integration.'); } try { let systemPrompt = 'You are a music recommendation assistant. Given a prompt and optionally the user\\'s listening history, return a JSON object with a \"tracks\" array containing 10-15 track recommendations. Each track must have \"artist\" and \"title\" fields. When listening history is provided, use it to understand the user\\'s taste but don\\'t just recommend what they already listen to. Find tracks that complement their taste while honoring the prompt. Prioritize discovery over familiarity. Only return valid JSON, no explanation or markdown.'; let userPrompt = prompt; if (listeningContext) { userPrompt = `My listening history (${listeningContext.window}):\\n\\nTop Artists: ${listeningContext.top_artists.join(', ')}\\n\\nTop Tracks:\\n${listeningContext.top_tracks.map(t => `- ${t.artist} - ${t.title}`).join('\\n')}\\n\\n---\\n\\nRequest: ${prompt}`; } const response = await fetch('https://api.openai.com/v1/chat/completions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + config.apiKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: config.model || 'gpt-4o-mini', messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }], response_format: { type: 'json_object' } }) }); if (!response.ok) { const error = await response.json().catch(() => ({})); if (response.status === 401) { throw new Error('Invalid API key. Check your OpenAI API key in Settings.'); } if (response.status === 403) { throw new Error('API access denied. You may need to enable billing at platform.openai.com.'); } if (response.status === 429) { throw new Error('Rate limit exceeded. OpenAI\\'s API is pay-as-you-go after trial credits expire. Please wait and try again, or check your billing at platform.openai.com.'); } if (response.status >= 500) { throw new Error('AI service temporarily unavailable. Try again later.'); } throw new Error(error.error?.message || 'OpenAI API request failed'); } const data = await response.json(); const content = data.choices[0]?.message?.content; if (!content) { throw new Error('No response from OpenAI'); } const parsed = JSON.parse(content); const tracks = parsed.tracks || parsed.playlist || parsed.songs || []; if (!Array.isArray(tracks) || tracks.length === 0) { throw new Error('AI returned no tracks. Try a different prompt.'); } return tracks.map(t => ({ artist: t.artist || t.Artist || '', title: t.title || t.track || t.song || t.Title || '' })).filter(t => t.artist && t.title); } catch (error) { if (error.message.includes('API key') || error.message.includes('Rate limit') || error.message.includes('No response') || error.message.includes('no tracks') || error.message.includes('access denied') || error.message.includes('billing') || error.message.includes('unavailable')) { throw error; } console.error('OpenAI generate error:', error); throw new Error('Failed to generate playlist: ' + error.message); } }"
```

**Step 2: Commit**

```bash
git add resolvers/chatgpt.axe
git commit -m "feat(ai): update ChatGPT plugin for listening context and better errors"
```

---

## Task 6: Update Gemini Plugin System Prompt and Generate Function

**Files:**
- Modify: `resolvers/gemini.axe`

**Step 1: Update the generate function**

Replace the entire implementation.generate string with:

```javascript
"generate": "async function(prompt, config, listeningContext) { if (!config.apiKey) { throw new Error('API key required. Add your Google API key in Settings → General → AI Integration.'); } try { const model = config.model || 'gemini-2.5-flash'; let fullPrompt = 'You are a music recommendation assistant. Given a prompt and optionally the user\\'s listening history, return ONLY a valid JSON object (no markdown, no code blocks, no explanation) with a \"tracks\" array containing 10-15 track recommendations. Each track must have \"artist\" and \"title\" fields. When listening history is provided, use it to understand the user\\'s taste but don\\'t just recommend what they already listen to. Find tracks that complement their taste while honoring the prompt. Prioritize discovery over familiarity.\\n\\nExample response format:\\n{\"tracks\": [{\"artist\": \"Artist Name\", \"title\": \"Song Title\"}]}\\n\\n'; if (listeningContext) { fullPrompt += `User\\'s listening history (${listeningContext.window}):\\n\\nTop Artists: ${listeningContext.top_artists.join(', ')}\\n\\nTop Tracks:\\n${listeningContext.top_tracks.map(t => `- ${t.artist} - ${t.title}`).join('\\n')}\\n\\n---\\n\\n`; } fullPrompt += 'Prompt: ' + prompt; const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.apiKey}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ text: fullPrompt }] }], generationConfig: { responseMimeType: 'application/json' } }) }); if (!response.ok) { const error = await response.json().catch(() => ({})); if (response.status === 400 && error.error?.message?.includes('API key')) { throw new Error('Invalid API key. Check your Google API key in Settings.'); } if (response.status === 403) { throw new Error('API access denied. Check your API key permissions at ai.google.dev.'); } if (response.status === 429) { throw new Error('Daily quota exceeded. Gemini\\'s free tier allows ~25-50 requests/day. Try again tomorrow or upgrade at ai.google.dev.'); } if (response.status >= 500) { throw new Error('AI service temporarily unavailable. Try again later.'); } throw new Error(error.error?.message || 'Gemini API request failed'); } const data = await response.json(); let content = data.candidates?.[0]?.content?.parts?.[0]?.text; if (!content) { throw new Error('No response from Gemini'); } content = content.trim(); if (content.startsWith('```json')) { content = content.slice(7); } else if (content.startsWith('```')) { content = content.slice(3); } if (content.endsWith('```')) { content = content.slice(0, -3); } content = content.trim(); const jsonMatch = content.match(/\\{[\\s\\S]*\\}/); if (jsonMatch) { content = jsonMatch[0]; } const parsed = JSON.parse(content); const tracks = parsed.tracks || parsed.playlist || parsed.songs || []; if (!Array.isArray(tracks) || tracks.length === 0) { throw new Error('AI returned no tracks. Try a different prompt.'); } return tracks.map(t => ({ artist: t.artist || t.Artist || '', title: t.title || t.track || t.song || t.Title || '' })).filter(t => t.artist && t.title); } catch (error) { if (error.message.includes('API key') || error.message.includes('Rate limit') || error.message.includes('quota') || error.message.includes('No response') || error.message.includes('no tracks') || error.message.includes('access denied') || error.message.includes('unavailable')) { throw error; } console.error('Gemini generate error:', error); throw new Error('Failed to generate playlist: ' + error.message); } }"
```

**Step 2: Commit**

```bash
git add resolvers/gemini.axe
git commit -m "feat(ai): update Gemini plugin for listening context and better errors"
```

---

## Task 7: Manual Testing

**Step 1: Test without scrobbler connected**

1. Ensure no Last.fm or ListenBrainz username is configured
2. Open AI prompt (click ✨)
3. Verify the listening history toggle is NOT visible
4. Generate a playlist - should work normally

**Step 2: Test with scrobbler connected, toggle OFF**

1. Configure Last.fm username in Settings
2. Open AI prompt
3. Verify toggle appears: "Include my Last.fm history"
4. Leave toggle OFF
5. Generate a playlist - should work normally without context

**Step 3: Test with scrobbler connected, toggle ON**

1. Enable the toggle
2. Generate a playlist
3. Check console for "🎵 Fetching listening context..." logs
4. Verify recommendations reflect your taste

**Step 4: Test toggle persistence**

1. Enable toggle, close prompt
2. Reopen prompt - toggle should still be enabled
3. Reload app - toggle should still be enabled

**Step 5: Test error handling**

1. Test with invalid OpenAI API key - verify error message
2. Test with valid key but no billing - verify 403 error message (if possible)
3. Test rate limiting message appears appropriately

**Step 6: Commit any fixes**

```bash
git add -A
git commit -m "fix(ai): address issues found in manual testing"
```

---

## Task 8: Final Review and Cleanup

**Step 1: Review all changes**

```bash
git log --oneline -10
git diff main...HEAD --stat
```

**Step 2: Test the complete flow end-to-end**

1. Fresh app start
2. Configure AI plugin (ChatGPT or Gemini)
3. Configure Last.fm or ListenBrainz
4. Generate playlist with history enabled
5. Verify results make sense for your taste

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "chore(ai): final cleanup for listening-informed recommendations"
```
