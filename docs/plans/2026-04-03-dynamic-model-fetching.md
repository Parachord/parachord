# Dynamic Model Fetching for AI Plugins

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace hardcoded model dropdowns in AI plugins with dynamic model lists fetched from each provider's API at configuration time.

**Architecture:** Each plugin gets a `listModels` implementation function. The app detects `type: "dynamic-select"` in plugin settings and calls `listModels` to populate the dropdown, with `fallbackOptions` shown if the fetch fails or no API key is configured yet. Claude stays curated (no list endpoint).

**Tech Stack:** Existing plugin `.axe` format, React.createElement UI, fetch API for model endpoints.

---

### Task 1: Add `listModels` to Ollama plugin

**Files:**
- Modify: `plugins/ollama.axe`

**Step 1: Update model setting type and add fallbackOptions**

Change `settings.configurable.model` from:
```json
{
  "type": "select",
  "label": "Model",
  "description": "The Ollama model to use for chat",
  "options": [...],
  "default": "llama3.1"
}
```
to:
```json
{
  "type": "dynamic-select",
  "label": "Model",
  "description": "The Ollama model to use for chat",
  "default": "llama3.1",
  "fallbackOptions": [
    { "value": "llama3.1", "label": "Llama 3.1 (8B)" },
    { "value": "qwen3", "label": "Qwen 3" },
    { "value": "gemma3", "label": "Gemma 3" }
  ]
}
```

**Step 2: Add `listModels` implementation**

Add to `implementation`:
```javascript
async function(config) {
  const endpoint = config.endpoint || 'http://localhost:11434';
  const response = await fetch(`${endpoint}/api/tags`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const models = data.models || [];
  return models.map(m => ({
    value: m.name,
    label: `${m.name} (${Math.round((m.size || 0) / 1e9)}B)`
  }));
}
```

**Step 3: Bump version to 1.1.0 in both `plugins/ollama.axe` and `marketplace-manifest.json`**

**Step 4: Commit**
```bash
git add plugins/ollama.axe marketplace-manifest.json
git commit -m "feat(ollama): add dynamic model fetching via /api/tags"
```

---

### Task 2: Add `listModels` to ChatGPT plugin

**Files:**
- Modify: `plugins/chatgpt.axe`

**Step 1: Update model setting to dynamic-select with fallbackOptions**

```json
{
  "type": "dynamic-select",
  "label": "Model",
  "default": "gpt-4o-mini",
  "fallbackOptions": [
    { "value": "gpt-4o-mini", "label": "GPT-4o Mini" },
    { "value": "gpt-4o", "label": "GPT-4o" }
  ]
}
```

**Step 2: Add `listModels` implementation**

Blocklist non-chat models, sort with newest/recommended first:
```javascript
async function(config) {
  const apiKey = config.apiKey;
  if (!apiKey) return [];
  const response = await fetch('https://api.openai.com/v1/models', {
    headers: { 'Authorization': `Bearer ${apiKey}` }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const BLOCKLIST = ['dall-e', 'whisper', 'tts', 'text-embedding', 'babbage', 'davinci', 'canary', 'moderation', 'embedding'];
  const models = (data.data || [])
    .filter(m => !BLOCKLIST.some(prefix => m.id.startsWith(prefix)))
    .filter(m => !m.id.includes('realtime') && !m.id.includes('audio') && !m.id.includes('transcri'))
    .sort((a, b) => a.id.localeCompare(b.id));
  return models.map(m => ({ value: m.id, label: m.id }));
}
```

**Step 3: Bump version in both `plugins/chatgpt.axe` and `marketplace-manifest.json`**

**Step 4: Commit**
```bash
git add plugins/chatgpt.axe marketplace-manifest.json
git commit -m "feat(chatgpt): add dynamic model fetching with blocklist filter"
```

---

### Task 3: Add `listModels` to Gemini plugin

**Files:**
- Modify: `plugins/gemini.axe`

**Step 1: Update model setting to dynamic-select with fallbackOptions**

```json
{
  "type": "dynamic-select",
  "label": "Model",
  "default": "gemini-2.5-flash",
  "fallbackOptions": [
    { "value": "gemini-2.5-flash", "label": "Gemini 2.5 Flash" },
    { "value": "gemini-2.5-pro", "label": "Gemini 2.5 Pro" }
  ]
}
```

**Step 2: Add `listModels` implementation**

Filter to models that support `generateContent`:
```javascript
async function(config) {
  const apiKey = config.apiKey;
  if (!apiKey) return [];
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const models = (data.models || [])
    .filter(m => m.supportedGenerationMethods && m.supportedGenerationMethods.includes('generateContent'))
    .filter(m => !m.name.includes('embedding') && !m.name.includes('aqa'))
    .map(m => ({
      value: m.name.replace('models/', ''),
      label: m.displayName || m.name.replace('models/', '')
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return models;
}
```

**Step 3: Bump version in both `plugins/gemini.axe` and `marketplace-manifest.json`**

**Step 4: Commit**
```bash
git add plugins/gemini.axe marketplace-manifest.json
git commit -m "feat(gemini): add dynamic model fetching filtered by generateContent"
```

---

### Task 4: Update app.js model selector to support `dynamic-select`

**Files:**
- Modify: `app.js`

**Step 1: Add state for dynamic model options**

Near the other meta-service state declarations (~L5300s), add:
```javascript
const [dynamicModelOptions, setDynamicModelOptions] = useState({});
// Shape: { [resolverId]: { loading: boolean, options: [{value, label}], error: string|null } }
```

**Step 2: Add effect to fetch models when a resolver with `dynamic-select` is selected**

When `selectedResolver` changes in the marketplace/settings panel and it has a `dynamic-select` model setting, call the resolver's `listModels(config)`. Store results in `dynamicModelOptions[resolverId]`.

```javascript
// Inside the settings rendering section, add a fetch trigger:
// When the panel opens for a resolver with dynamic-select model setting:
const fetchDynamicModels = async (resolver) => {
  const modelSetting = resolver.settings?.configurable?.model;
  if (modelSetting?.type !== 'dynamic-select') return;
  if (!resolver.listModels) return;

  const resolverId = resolver.id;
  setDynamicModelOptions(prev => ({
    ...prev,
    [resolverId]: { loading: true, options: [], error: null }
  }));

  try {
    const config = metaServiceConfigs[resolverId] || {};
    const options = await resolver.listModels(config);
    setDynamicModelOptions(prev => ({
      ...prev,
      [resolverId]: { loading: false, options: options || [], error: null }
    }));
  } catch (error) {
    console.error(`Failed to fetch models for ${resolverId}:`, error);
    setDynamicModelOptions(prev => ({
      ...prev,
      [resolverId]: { loading: false, options: [], error: error.message }
    }));
  }
};
```

**Step 3: Update the model `<select>` rendering (L54829-54873)**

Replace the existing model selector block with logic that:
1. If `type === 'dynamic-select'` and `dynamicModelOptions[id]?.loading`: show "Loading models..." disabled option
2. If `type === 'dynamic-select'` and `dynamicModelOptions[id]?.options.length > 0`: render those options
3. If `type === 'dynamic-select'` and fetch failed/empty: fall back to `fallbackOptions`
4. If `type === 'select'` (Claude, backward compat): render static `options` as before

Add a refresh button (🔄) next to the label that re-triggers `fetchDynamicModels`.

**Step 4: Update the Ollama model selector (L54974-55012)**

The Ollama section has its own hardcoded model dropdown. Replace it with the same dynamic-select logic, or better yet, remove the Ollama-specific model selector entirely now that the generic one handles `dynamic-select`.

**Step 5: Remove hardcoded fallback options (L54865-54872)**

The `chatgpt` and `gemini` hardcoded option blocks are no longer needed since the plugins define their own `fallbackOptions`.

**Step 6: Commit**
```bash
git add app.js
git commit -m "feat: support dynamic-select model setting type in plugin settings UI"
```

---

### Task 5: Wire up model fetch trigger

**Files:**
- Modify: `app.js`

**Step 1: Call `fetchDynamicModels` when resolver settings panel opens**

Find where `selectedResolver` is set in the marketplace/settings panel and add a call to `fetchDynamicModels(selectedResolver)` there. Also re-fetch when the API key or endpoint config changes (so saving an API key immediately loads available models).

**Step 2: Also trigger on config save for relevant fields**

In the `saveMetaServiceConfig` handler or the API key `onBlur`, if the resolver has `dynamic-select`, re-fetch models after saving the key.

**Step 3: Commit**
```bash
git add app.js
git commit -m "feat: trigger dynamic model fetch on settings panel open and config change"
```

---

### Task 6: Bump all plugin versions and marketplace manifest

**Files:**
- Modify: `marketplace-manifest.json`

**Step 1: Ensure all modified plugins have bumped versions in the marketplace manifest**

- `ollama`: bump to match `.axe`
- `chatgpt`: bump to match `.axe`
- `gemini`: bump to match `.axe`
- `claude`: no change (stays curated)

**Step 2: Commit and push**
```bash
git add marketplace-manifest.json plugins/*.axe
git commit -m "chore: bump plugin versions for dynamic model fetching"
```

---

### Summary of changes

| File | Change |
|------|--------|
| `plugins/ollama.axe` | `listModels` via `/api/tags`, `dynamic-select`, bump version |
| `plugins/chatgpt.axe` | `listModels` via `/v1/models` + blocklist, `dynamic-select`, bump version |
| `plugins/gemini.axe` | `listModels` via `/v1beta/models` + `generateContent` filter, `dynamic-select`, bump version |
| `plugins/claude.axe` | No change (curated, no list endpoint) |
| `marketplace-manifest.json` | Bump versions for ollama, chatgpt, gemini |
| `app.js` | `dynamicModelOptions` state, `fetchDynamicModels()`, updated select rendering, refresh button |
| `resolver-loader.js` | No change (`listModels` is already exposed via `...safeImplFunctions`) |
