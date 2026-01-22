# Scrobbling Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable scrobbling (playback reporting) to Last.fm, ListenBrainz, and Libre.fm via a plugin architecture.

**Architecture:** A ScrobbleManager in the renderer tracks playback progress and dispatches scrobble events to enabled scrobbler plugins. Each plugin handles its own authentication and API submission. Failed scrobbles are queued locally and retried. Main process handles API calls to bypass CORS.

**Tech Stack:** Electron IPC, electron-store, MD5 (for Last.fm signatures), existing resolver/plugin patterns.

---

## Task 1: Create Scrobble Manager Core

**Files:**
- Create: `scrobble-manager.js`

**Step 1: Create the ScrobbleManager class skeleton**

```javascript
// scrobble-manager.js
// Manages scrobbling state and dispatches to enabled scrobbler plugins

class ScrobbleManager {
  constructor() {
    this.plugins = new Map(); // pluginId -> plugin instance
    this.currentTrack = null;
    this.trackStartTime = null;
    this.scrobbleSubmitted = false;
    this.nowPlayingSent = false;
    this.progressCheckInterval = null;
  }

  // Register a scrobbler plugin
  registerPlugin(plugin) {
    if (!plugin.id || !plugin.scrobble || !plugin.updateNowPlaying) {
      console.error('[ScrobbleManager] Invalid plugin:', plugin);
      return;
    }
    this.plugins.set(plugin.id, plugin);
    console.log(`[ScrobbleManager] Registered plugin: ${plugin.id}`);
  }

  // Unregister a plugin
  unregisterPlugin(pluginId) {
    this.plugins.delete(pluginId);
    console.log(`[ScrobbleManager] Unregistered plugin: ${pluginId}`);
  }

  // Get all registered plugins
  getPlugins() {
    return Array.from(this.plugins.values());
  }

  // Get enabled plugins only
  async getEnabledPlugins() {
    const enabled = [];
    for (const plugin of this.plugins.values()) {
      if (await plugin.isEnabled()) {
        enabled.push(plugin);
      }
    }
    return enabled;
  }

  // Called when a new track starts playing
  async onTrackStart(track) {
    // Reset state for new track
    this.currentTrack = track;
    this.trackStartTime = Date.now();
    this.scrobbleSubmitted = false;
    this.nowPlayingSent = false;

    // Validate track has required fields
    if (!track.title || !track.artist) {
      console.log('[ScrobbleManager] Track missing required fields, skipping');
      return;
    }

    // Skip tracks under 30 seconds
    if (track.duration && track.duration < 30) {
      console.log('[ScrobbleManager] Track under 30s, skipping');
      return;
    }

    // Send "Now Playing" to all enabled plugins
    const enabledPlugins = await this.getEnabledPlugins();
    for (const plugin of enabledPlugins) {
      try {
        await plugin.updateNowPlaying(track);
        console.log(`[ScrobbleManager] Now Playing sent to ${plugin.id}`);
      } catch (error) {
        console.error(`[ScrobbleManager] Now Playing failed for ${plugin.id}:`, error);
      }
    }
    this.nowPlayingSent = true;
  }

  // Called periodically with current playback progress (in seconds)
  async onProgressUpdate(progressSeconds) {
    if (!this.currentTrack || this.scrobbleSubmitted) {
      return;
    }

    const track = this.currentTrack;
    const duration = track.duration;

    if (!duration || duration < 30) {
      return;
    }

    // Scrobble threshold: 50% of track OR 4 minutes, whichever is earlier
    const halfDuration = duration / 2;
    const fourMinutes = 240;
    const threshold = Math.min(halfDuration, fourMinutes);

    if (progressSeconds >= threshold) {
      await this.submitScrobble();
    }
  }

  // Submit scrobble to all enabled plugins
  async submitScrobble() {
    if (this.scrobbleSubmitted || !this.currentTrack) {
      return;
    }

    this.scrobbleSubmitted = true;
    const track = this.currentTrack;
    const timestamp = Math.floor(this.trackStartTime / 1000); // Unix timestamp

    console.log(`[ScrobbleManager] Submitting scrobble: ${track.artist} - ${track.title}`);

    const enabledPlugins = await this.getEnabledPlugins();
    for (const plugin of enabledPlugins) {
      try {
        await plugin.scrobble(track, timestamp);
        console.log(`[ScrobbleManager] Scrobble submitted to ${plugin.id}`);
      } catch (error) {
        console.error(`[ScrobbleManager] Scrobble failed for ${plugin.id}:`, error);
        // Queue for retry
        await this.queueFailedScrobble(plugin.id, track, timestamp, error.message);
      }
    }
  }

  // Called when track ends or is skipped
  onTrackEnd() {
    this.currentTrack = null;
    this.trackStartTime = null;
  }

  // Queue failed scrobble for retry
  async queueFailedScrobble(pluginId, track, timestamp, error) {
    try {
      const queue = await window.electron.store.get('scrobble-failed-queue') || [];
      queue.push({
        pluginId,
        track: {
          title: track.title,
          artist: track.artist,
          album: track.album,
          duration: track.duration
        },
        timestamp,
        error,
        attempts: 1,
        queuedAt: Date.now()
      });
      // Keep only last 500 failed scrobbles
      if (queue.length > 500) {
        queue.splice(0, queue.length - 500);
      }
      await window.electron.store.set('scrobble-failed-queue', queue);
      console.log(`[ScrobbleManager] Queued failed scrobble for retry`);
    } catch (err) {
      console.error('[ScrobbleManager] Failed to queue scrobble:', err);
    }
  }

  // Retry failed scrobbles (call periodically or on app start)
  async retryFailedScrobbles() {
    const queue = await window.electron.store.get('scrobble-failed-queue') || [];
    if (queue.length === 0) return;

    console.log(`[ScrobbleManager] Retrying ${queue.length} failed scrobbles`);
    const remaining = [];

    for (const item of queue) {
      const plugin = this.plugins.get(item.pluginId);
      if (!plugin || !(await plugin.isEnabled())) {
        // Keep in queue if plugin not available
        remaining.push(item);
        continue;
      }

      try {
        await plugin.scrobble(item.track, item.timestamp);
        console.log(`[ScrobbleManager] Retry successful for ${item.pluginId}`);
      } catch (error) {
        item.attempts++;
        item.error = error.message;
        // Keep if under 10 attempts and less than 14 days old
        if (item.attempts < 10 && (Date.now() - item.queuedAt) < 14 * 24 * 60 * 60 * 1000) {
          remaining.push(item);
        } else {
          console.log(`[ScrobbleManager] Dropping scrobble after ${item.attempts} attempts`);
        }
      }
    }

    await window.electron.store.set('scrobble-failed-queue', remaining);
  }
}

// Export singleton instance
const scrobbleManager = new ScrobbleManager();
export default scrobbleManager;
```

**Step 2: Verify file created**

Run: `ls -la scrobble-manager.js`
Expected: File exists with ~180 lines

**Step 3: Commit**

```bash
git add scrobble-manager.js
git commit -m "feat(scrobble): add ScrobbleManager core class"
```

---

## Task 2: Create Scrobbler Plugin Interface

**Files:**
- Create: `scrobblers/base-scrobbler.js`

**Step 1: Create the base scrobbler plugin class**

```javascript
// scrobblers/base-scrobbler.js
// Base class for scrobbler plugins - defines the interface all scrobblers must implement

class BaseScrobbler {
  constructor(id, name) {
    this.id = id;
    this.name = name;
  }

  // Check if this scrobbler is enabled and configured
  async isEnabled() {
    throw new Error('Subclass must implement isEnabled()');
  }

  // Get current configuration
  async getConfig() {
    const config = await window.electron.store.get(`scrobbler-config-${this.id}`);
    return config || {};
  }

  // Save configuration
  async setConfig(config) {
    await window.electron.store.set(`scrobbler-config-${this.id}`, config);
  }

  // Update "Now Playing" status
  // track: { title, artist, album, duration, albumArt }
  async updateNowPlaying(track) {
    throw new Error('Subclass must implement updateNowPlaying()');
  }

  // Submit a scrobble
  // track: { title, artist, album, duration }
  // timestamp: Unix timestamp (seconds) when track started playing
  async scrobble(track, timestamp) {
    throw new Error('Subclass must implement scrobble()');
  }

  // Get authentication URL (for OAuth-based services)
  getAuthUrl() {
    return null;
  }

  // Handle OAuth callback (for OAuth-based services)
  async handleAuthCallback(params) {
    throw new Error('Subclass must implement handleAuthCallback() if using OAuth');
  }

  // Disconnect/logout
  async disconnect() {
    await window.electron.store.delete(`scrobbler-config-${this.id}`);
  }

  // Get connection status for UI
  async getConnectionStatus() {
    const config = await this.getConfig();
    return {
      connected: await this.isEnabled(),
      username: config.username || null,
      error: config.lastError || null
    };
  }
}

export default BaseScrobbler;
```

**Step 2: Create scrobblers directory**

Run: `mkdir -p scrobblers`

**Step 3: Verify file created**

Run: `ls -la scrobblers/base-scrobbler.js`
Expected: File exists

**Step 4: Commit**

```bash
git add scrobblers/base-scrobbler.js
git commit -m "feat(scrobble): add BaseScrobbler plugin interface"
```

---

## Task 3: Implement ListenBrainz Scrobbler

**Files:**
- Create: `scrobblers/listenbrainz-scrobbler.js`

**Step 1: Create the ListenBrainz scrobbler plugin**

```javascript
// scrobblers/listenbrainz-scrobbler.js
// ListenBrainz scrobbler plugin - uses simple token authentication

import BaseScrobbler from './base-scrobbler.js';

class ListenBrainzScrobbler extends BaseScrobbler {
  constructor() {
    super('listenbrainz', 'ListenBrainz');
    this.apiBase = 'https://api.listenbrainz.org/1';
  }

  async isEnabled() {
    const config = await this.getConfig();
    return !!(config.enabled && config.userToken);
  }

  async updateNowPlaying(track) {
    const config = await this.getConfig();
    if (!config.userToken) {
      throw new Error('ListenBrainz token not configured');
    }

    const payload = {
      listen_type: 'playing_now',
      payload: [{
        track_metadata: {
          artist_name: track.artist,
          track_name: track.title,
          release_name: track.album || undefined,
          additional_info: {
            media_player: 'Parachord',
            submission_client: 'Parachord',
            submission_client_version: '1.0.0',
            duration_ms: track.duration ? track.duration * 1000 : undefined
          }
        }
      }]
    };

    const response = await window.electron.proxyFetch(`${this.apiBase}/submit-listens`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenBrainz API error: ${response.status} - ${error}`);
    }

    return true;
  }

  async scrobble(track, timestamp) {
    const config = await this.getConfig();
    if (!config.userToken) {
      throw new Error('ListenBrainz token not configured');
    }

    const payload = {
      listen_type: 'single',
      payload: [{
        listened_at: timestamp,
        track_metadata: {
          artist_name: track.artist,
          track_name: track.title,
          release_name: track.album || undefined,
          additional_info: {
            media_player: 'Parachord',
            submission_client: 'Parachord',
            submission_client_version: '1.0.0',
            duration_ms: track.duration ? track.duration * 1000 : undefined
          }
        }
      }]
    };

    const response = await window.electron.proxyFetch(`${this.apiBase}/submit-listens`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${config.userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`ListenBrainz API error: ${response.status} - ${error}`);
    }

    return true;
  }

  // Validate token by fetching user info
  async validateToken(token) {
    const response = await window.electron.proxyFetch(`${this.apiBase}/validate-token`, {
      headers: {
        'Authorization': `Token ${token}`
      }
    });

    if (!response.ok) {
      return { valid: false, error: 'Invalid token' };
    }

    const data = await response.json();
    return {
      valid: data.valid,
      username: data.user_name,
      error: data.valid ? null : 'Token validation failed'
    };
  }

  // Connect with token
  async connect(token) {
    const validation = await this.validateToken(token);
    if (!validation.valid) {
      throw new Error(validation.error || 'Invalid token');
    }

    await this.setConfig({
      enabled: true,
      userToken: token,
      username: validation.username,
      connectedAt: Date.now()
    });

    return { username: validation.username };
  }
}

export default ListenBrainzScrobbler;
```

**Step 2: Verify file created**

Run: `ls -la scrobblers/listenbrainz-scrobbler.js`
Expected: File exists with ~120 lines

**Step 3: Commit**

```bash
git add scrobblers/listenbrainz-scrobbler.js
git commit -m "feat(scrobble): add ListenBrainz scrobbler plugin"
```

---

## Task 4: Implement Last.fm Scrobbler

**Files:**
- Create: `scrobblers/lastfm-scrobbler.js`

**Step 1: Create the Last.fm scrobbler plugin**

```javascript
// scrobblers/lastfm-scrobbler.js
// Last.fm scrobbler plugin - uses API key + session key + MD5 signatures

import BaseScrobbler from './base-scrobbler.js';

class LastFmScrobbler extends BaseScrobbler {
  constructor() {
    super('lastfm', 'Last.fm');
    this.apiBase = 'https://ws.audioscrobbler.com/2.0/';
    // These would be set from environment or config
    this.apiKey = null;
    this.apiSecret = null;
  }

  // Set API credentials (called during app init)
  setApiCredentials(apiKey, apiSecret) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  async isEnabled() {
    const config = await this.getConfig();
    return !!(config.enabled && config.sessionKey && this.apiKey);
  }

  // Generate MD5 signature for Last.fm API
  generateSignature(params) {
    // Sort parameters alphabetically and concatenate
    const sortedKeys = Object.keys(params).sort();
    let sigString = '';
    for (const key of sortedKeys) {
      if (key !== 'format' && params[key] !== undefined) {
        sigString += key + params[key];
      }
    }
    sigString += this.apiSecret;

    // MD5 hash - use IPC to main process for crypto
    return window.electron.crypto.md5(sigString);
  }

  // Make signed API request
  async apiRequest(method, params, httpMethod = 'POST') {
    const config = await this.getConfig();

    const requestParams = {
      method,
      api_key: this.apiKey,
      sk: config.sessionKey,
      format: 'json',
      ...params
    };

    // Generate signature (excluding 'format' parameter)
    const sig = await this.generateSignature(requestParams);
    requestParams.api_sig = sig;

    // Build form body
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(requestParams)) {
      if (value !== undefined) {
        body.append(key, value);
      }
    }

    const response = await window.electron.proxyFetch(this.apiBase, {
      method: httpMethod,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
    }

    return data;
  }

  async updateNowPlaying(track) {
    await this.apiRequest('track.updateNowPlaying', {
      artist: track.artist,
      track: track.title,
      album: track.album || undefined,
      duration: track.duration || undefined
    });
    return true;
  }

  async scrobble(track, timestamp) {
    await this.apiRequest('track.scrobble', {
      'artist[0]': track.artist,
      'track[0]': track.title,
      'timestamp[0]': timestamp,
      'album[0]': track.album || undefined,
      'duration[0]': track.duration || undefined
    });
    return true;
  }

  // Get auth token for desktop auth flow
  async getAuthToken() {
    const response = await window.electron.proxyFetch(
      `${this.apiBase}?method=auth.getToken&api_key=${this.apiKey}&format=json`
    );
    const data = await response.json();
    if (data.error) {
      throw new Error(`Failed to get auth token: ${data.message}`);
    }
    return data.token;
  }

  // Get auth URL for user to authorize
  getAuthUrl(token) {
    return `https://www.last.fm/api/auth/?api_key=${this.apiKey}&token=${token}`;
  }

  // Exchange token for session key after user authorizes
  async getSession(token) {
    const params = {
      method: 'auth.getSession',
      api_key: this.apiKey,
      token: token
    };
    const sig = await this.generateSignature(params);

    const response = await window.electron.proxyFetch(
      `${this.apiBase}?method=auth.getSession&api_key=${this.apiKey}&token=${token}&api_sig=${sig}&format=json`
    );
    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get session: ${data.message}`);
    }

    return {
      sessionKey: data.session.key,
      username: data.session.name
    };
  }

  // Full auth flow - returns URL, then call completeAuth after user approves
  async startAuth() {
    const token = await this.getAuthToken();
    const authUrl = this.getAuthUrl(token);

    // Store token temporarily
    await this.setConfig({
      ...await this.getConfig(),
      pendingToken: token
    });

    return { authUrl, token };
  }

  // Complete auth after user approves
  async completeAuth() {
    const config = await this.getConfig();
    if (!config.pendingToken) {
      throw new Error('No pending auth token');
    }

    const session = await this.getSession(config.pendingToken);

    await this.setConfig({
      enabled: true,
      sessionKey: session.sessionKey,
      username: session.username,
      connectedAt: Date.now(),
      pendingToken: null
    });

    return { username: session.username };
  }
}

export default LastFmScrobbler;
```

**Step 2: Verify file created**

Run: `ls -la scrobblers/lastfm-scrobbler.js`
Expected: File exists with ~170 lines

**Step 3: Commit**

```bash
git add scrobblers/lastfm-scrobbler.js
git commit -m "feat(scrobble): add Last.fm scrobbler plugin"
```

---

## Task 5: Implement Libre.fm Scrobbler

**Files:**
- Create: `scrobblers/librefm-scrobbler.js`

**Step 1: Create the Libre.fm scrobbler plugin (extends Last.fm)**

```javascript
// scrobblers/librefm-scrobbler.js
// Libre.fm scrobbler plugin - uses Last.fm-compatible API

import LastFmScrobbler from './lastfm-scrobbler.js';

class LibreFmScrobbler extends LastFmScrobbler {
  constructor() {
    super();
    this.id = 'librefm';
    this.name = 'Libre.fm';
    this.apiBase = 'https://libre.fm/2.0/';
    // Libre.fm accepts placeholder API key/secret
    this.apiKey = '00000000000000000000000000000000';
    this.apiSecret = '00000000000000000000000000000000';
  }

  // Override to use username/password auth instead of OAuth
  async connectWithPassword(username, password) {
    // MD5 hash the password
    const passwordHash = await window.electron.crypto.md5(password);

    const params = {
      method: 'auth.getMobileSession',
      username: username,
      password: passwordHash,
      api_key: this.apiKey
    };
    const sig = await this.generateSignature(params);

    const body = new URLSearchParams();
    body.append('method', 'auth.getMobileSession');
    body.append('username', username);
    body.append('password', passwordHash);
    body.append('api_key', this.apiKey);
    body.append('api_sig', sig);
    body.append('format', 'json');

    const response = await window.electron.proxyFetch(this.apiBase, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: body.toString()
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(`Libre.fm auth failed: ${data.message}`);
    }

    await this.setConfig({
      enabled: true,
      sessionKey: data.session.key,
      username: data.session.name,
      connectedAt: Date.now()
    });

    return { username: data.session.name };
  }

  // Override auth URL for Libre.fm
  getAuthUrl(token) {
    return `https://libre.fm/api/auth/?api_key=${this.apiKey}&token=${token}`;
  }

  // Libre.fm also supports the desktop auth flow
  async startAuth() {
    // Use same flow as Last.fm but with Libre.fm endpoints
    const response = await window.electron.proxyFetch(
      `${this.apiBase}?method=auth.getToken&api_key=${this.apiKey}&format=json`
    );
    const data = await response.json();

    if (data.error) {
      throw new Error(`Failed to get auth token: ${data.message}`);
    }

    const authUrl = this.getAuthUrl(data.token);

    await this.setConfig({
      ...await this.getConfig(),
      pendingToken: data.token
    });

    return { authUrl, token: data.token };
  }
}

export default LibreFmScrobbler;
```

**Step 2: Verify file created**

Run: `ls -la scrobblers/librefm-scrobbler.js`
Expected: File exists with ~90 lines

**Step 3: Commit**

```bash
git add scrobblers/librefm-scrobbler.js
git commit -m "feat(scrobble): add Libre.fm scrobbler plugin"
```

---

## Task 6: Add IPC Handlers for Scrobbling

**Files:**
- Modify: `main.js` (add IPC handlers)
- Modify: `preload.js` (expose to renderer)

**Step 1: Add MD5 crypto handler to main.js**

Find the IPC handlers section (around line 439) and add:

```javascript
// Crypto utilities for scrobbling (Last.fm requires MD5 signatures)
const crypto = require('crypto');

ipcMain.handle('crypto-md5', (event, input) => {
  return crypto.createHash('md5').update(input).digest('hex');
});
```

**Step 2: Add proxy fetch handler if not exists**

Verify `proxy-fetch` handler exists (should be around line 806). If not, add:

```javascript
ipcMain.handle('proxy-fetch', async (event, url, options = {}) => {
  try {
    const response = await fetch(url, options);
    const text = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      headers: Object.fromEntries(response.headers.entries()),
      text: () => Promise.resolve(text),
      json: () => Promise.resolve(JSON.parse(text))
    };
  } catch (error) {
    throw new Error(`Fetch failed: ${error.message}`);
  }
});
```

**Step 3: Expose crypto in preload.js**

Find the contextBridge.exposeInMainWorld section and add under the electron object:

```javascript
crypto: {
  md5: (input) => ipcRenderer.invoke('crypto-md5', input)
},
```

**Step 4: Verify proxyFetch is exposed in preload.js**

Ensure this exists:

```javascript
proxyFetch: async (url, options) => {
  const result = await ipcRenderer.invoke('proxy-fetch', url, options);
  return {
    ok: result.ok,
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
    text: async () => result.text,
    json: async () => JSON.parse(result.text)
  };
},
```

**Step 5: Commit**

```bash
git add main.js preload.js
git commit -m "feat(scrobble): add IPC handlers for crypto and proxy fetch"
```

---

## Task 7: Create Scrobbler Index and Initialization

**Files:**
- Create: `scrobblers/index.js`

**Step 1: Create the scrobblers index file**

```javascript
// scrobblers/index.js
// Exports all scrobbler plugins and initialization helper

import scrobbleManager from '../scrobble-manager.js';
import ListenBrainzScrobbler from './listenbrainz-scrobbler.js';
import LastFmScrobbler from './lastfm-scrobbler.js';
import LibreFmScrobbler from './librefm-scrobbler.js';

// Create singleton instances
export const listenbrainzScrobbler = new ListenBrainzScrobbler();
export const lastfmScrobbler = new LastFmScrobbler();
export const librefmScrobbler = new LibreFmScrobbler();

// All available scrobblers
export const scrobblers = [
  listenbrainzScrobbler,
  lastfmScrobbler,
  librefmScrobbler
];

// Initialize all scrobblers and register with manager
export async function initializeScrobblers(config = {}) {
  // Set Last.fm API credentials if provided
  if (config.lastfmApiKey && config.lastfmApiSecret) {
    lastfmScrobbler.setApiCredentials(config.lastfmApiKey, config.lastfmApiSecret);
  }

  // Register all scrobblers with the manager
  for (const scrobbler of scrobblers) {
    scrobbleManager.registerPlugin(scrobbler);
  }

  // Retry any failed scrobbles from previous session
  await scrobbleManager.retryFailedScrobbles();

  console.log('[Scrobblers] Initialized', scrobblers.length, 'scrobbler plugins');
  return scrobblers;
}

// Get scrobbler by ID
export function getScrobbler(id) {
  return scrobblers.find(s => s.id === id);
}

export { scrobbleManager };
export default scrobbleManager;
```

**Step 2: Verify file created**

Run: `ls -la scrobblers/index.js`
Expected: File exists

**Step 3: Commit**

```bash
git add scrobblers/index.js
git commit -m "feat(scrobble): add scrobbler index and initialization"
```

---

## Task 8: Integrate Scrobble Manager with Playback

**Files:**
- Modify: `app.js` (hook into playback events)

**Step 1: Import scrobble manager at top of app.js**

Add near other imports (around line 1-50):

```javascript
import scrobbleManager, { initializeScrobblers, scrobblers } from './scrobblers/index.js';
```

**Step 2: Initialize scrobblers in useEffect**

Find the initialization useEffect (around line 2716) and add:

```javascript
// Initialize scrobblers
useEffect(() => {
  const init = async () => {
    try {
      await initializeScrobblers({
        lastfmApiKey: process.env.LASTFM_API_KEY,
        lastfmApiSecret: process.env.LASTFM_API_SECRET
      });
    } catch (error) {
      console.error('[App] Failed to initialize scrobblers:', error);
    }
  };
  init();
}, []);
```

**Step 3: Hook scrobble manager into handlePlay**

Find the `handlePlay` function (around line 4042) and add after setting current track:

```javascript
// Notify scrobble manager of track start
if (resolvedTrack && resolvedTrack.title && resolvedTrack.artist) {
  scrobbleManager.onTrackStart({
    title: resolvedTrack.title,
    artist: resolvedTrack.artist,
    album: resolvedTrack.album,
    duration: resolvedTrack.duration,
    albumArt: resolvedTrack.albumArt
  });
}
```

**Step 4: Hook scrobble manager into progress updates**

Find the progress interpolation section (around line 3456-3485) and add:

```javascript
// Update scrobble manager with progress
if (currentTrack && progressSeconds > 0) {
  scrobbleManager.onProgressUpdate(progressSeconds);
}
```

**Step 5: Hook scrobble manager into track end**

Find where tracks end/skip (audio ended event around line 4219 and skip logic) and add:

```javascript
scrobbleManager.onTrackEnd();
```

**Step 6: Commit**

```bash
git add app.js
git commit -m "feat(scrobble): integrate scrobble manager with playback"
```

---

## Task 9: Add Scrobbler Settings UI

**Files:**
- Modify: `app.js` (add scrobbler settings section)

**Step 1: Add scrobbler settings state**

Near other state declarations (around line 1266):

```javascript
const [scrobblerConfigs, setScrobblerConfigs] = useState({});
const [scrobblingEnabled, setScrobblingEnabled] = useState(true);
```

**Step 2: Load scrobbler configs on mount**

Add useEffect to load configs:

```javascript
// Load scrobbler configurations
useEffect(() => {
  const loadScrobblerConfigs = async () => {
    const configs = {};
    for (const scrobbler of scrobblers) {
      configs[scrobbler.id] = await scrobbler.getConfig();
    }
    setScrobblerConfigs(configs);

    // Load global scrobbling enabled state
    const enabled = await window.electron.store.get('scrobbling-enabled');
    setScrobblingEnabled(enabled !== false);
  };
  loadScrobblerConfigs();
}, []);
```

**Step 3: Create ScrobblerSettingsCard component**

Add this component (can be placed near other settings components):

```javascript
const ScrobblerSettingsCard = ({ scrobbler, config, onConfigChange }) => {
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [tokenInput, setTokenInput] = useState('');

  const isConnected = config?.enabled && (config?.sessionKey || config?.userToken);

  const handleConnect = async () => {
    setConnecting(true);
    setError(null);

    try {
      if (scrobbler.id === 'listenbrainz') {
        // Token-based auth
        const result = await scrobbler.connect(tokenInput);
        onConfigChange(scrobbler.id, await scrobbler.getConfig());
      } else if (scrobbler.id === 'lastfm') {
        // OAuth flow
        const { authUrl } = await scrobbler.startAuth();
        window.electron.shell.openExternal(authUrl);
        // Show "Complete Auth" button
      } else if (scrobbler.id === 'librefm') {
        // Can use either OAuth or password
        const { authUrl } = await scrobbler.startAuth();
        window.electron.shell.openExternal(authUrl);
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
    await scrobbler.disconnect();
    onConfigChange(scrobbler.id, {});
  };

  const handleToggleEnabled = async () => {
    const newConfig = { ...config, enabled: !config?.enabled };
    await scrobbler.setConfig(newConfig);
    onConfigChange(scrobbler.id, newConfig);
  };

  return (
    <div className="bg-white rounded-xl p-4 shadow-sm border border-gray-200">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
            scrobbler.id === 'lastfm' ? 'bg-red-500' :
            scrobbler.id === 'listenbrainz' ? 'bg-orange-500' :
            'bg-green-500'
          }`}>
            <span className="text-white text-lg font-bold">
              {scrobbler.name[0]}
            </span>
          </div>
          <div>
            <h3 className="font-medium text-gray-900">{scrobbler.name}</h3>
            {isConnected && config?.username && (
              <p className="text-sm text-gray-500">Connected as {config.username}</p>
            )}
          </div>
        </div>
        {isConnected && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={config?.enabled || false}
              onChange={handleToggleEnabled}
              className="w-4 h-4 text-purple-600 rounded"
            />
            <span className="text-sm text-gray-600">Enabled</span>
          </label>
        )}
      </div>

      {error && (
        <div className="mb-3 p-2 bg-red-50 text-red-600 text-sm rounded">
          {error}
        </div>
      )}

      {!isConnected ? (
        <div className="space-y-3">
          {scrobbler.id === 'listenbrainz' && (
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                User Token
                <a
                  href="https://listenbrainz.org/settings/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-2 text-purple-600 hover:underline"
                >
                  Get token
                </a>
              </label>
              <input
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="Enter your ListenBrainz token"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
              />
            </div>
          )}
          <button
            onClick={handleConnect}
            disabled={connecting || (scrobbler.id === 'listenbrainz' && !tokenInput)}
            className="w-full py-2 px-4 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {connecting ? 'Connecting...' : 'Connect'}
          </button>
          {config?.pendingToken && (
            <button
              onClick={handleCompleteAuth}
              disabled={connecting}
              className="w-full py-2 px-4 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
            >
              {connecting ? 'Completing...' : 'Complete Authorization'}
            </button>
          )}
        </div>
      ) : (
        <button
          onClick={handleDisconnect}
          className="w-full py-2 px-4 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200"
        >
          Disconnect
        </button>
      )}
    </div>
  );
};
```

**Step 4: Add scrobbler settings section to Settings view**

Find the Settings view rendering (around line 19200+) and add a new section:

```javascript
{/* Scrobbling Settings */}
<div className="mb-6">
  <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
    Scrobbling
  </h2>

  <div className="mb-4 flex items-center justify-between p-3 bg-gray-50 rounded-lg">
    <span className="text-sm font-medium text-gray-700">Enable Scrobbling</span>
    <label className="relative inline-flex items-center cursor-pointer">
      <input
        type="checkbox"
        checked={scrobblingEnabled}
        onChange={async (e) => {
          setScrobblingEnabled(e.target.checked);
          await window.electron.store.set('scrobbling-enabled', e.target.checked);
        }}
        className="sr-only peer"
      />
      <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-purple-600"></div>
    </label>
  </div>

  <div className="space-y-4">
    {scrobblers.map(scrobbler => (
      <ScrobblerSettingsCard
        key={scrobbler.id}
        scrobbler={scrobbler}
        config={scrobblerConfigs[scrobbler.id]}
        onConfigChange={(id, newConfig) => {
          setScrobblerConfigs(prev => ({ ...prev, [id]: newConfig }));
        }}
      />
    ))}
  </div>
</div>
```

**Step 5: Commit**

```bash
git add app.js
git commit -m "feat(scrobble): add scrobbler settings UI"
```

---

## Task 10: Add Environment Variables for API Keys

**Files:**
- Modify: `.env.example`
- Modify: `main.js` (load env vars)

**Step 1: Add to .env.example**

```
# Scrobbling API Keys
LASTFM_API_KEY=your_lastfm_api_key_here
LASTFM_API_SECRET=your_lastfm_api_secret_here
```

**Step 2: Expose env vars to renderer via IPC**

In main.js, add handler:

```javascript
ipcMain.handle('get-scrobbler-config', () => {
  return {
    lastfmApiKey: process.env.LASTFM_API_KEY,
    lastfmApiSecret: process.env.LASTFM_API_SECRET
  };
});
```

**Step 3: Add to preload.js**

```javascript
getScrobblerConfig: () => ipcRenderer.invoke('get-scrobbler-config'),
```

**Step 4: Update app.js initialization to use IPC**

```javascript
useEffect(() => {
  const init = async () => {
    try {
      const config = await window.electron.getScrobblerConfig();
      await initializeScrobblers({
        lastfmApiKey: config.lastfmApiKey,
        lastfmApiSecret: config.lastfmApiSecret
      });
    } catch (error) {
      console.error('[App] Failed to initialize scrobblers:', error);
    }
  };
  init();
}, []);
```

**Step 5: Commit**

```bash
git add .env.example main.js preload.js app.js
git commit -m "feat(scrobble): add environment variables for Last.fm API keys"
```

---

## Task 11: Test Scrobbling End-to-End

**Step 1: Create test checklist**

Manual testing checklist:
- [ ] ListenBrainz token can be entered and validated
- [ ] ListenBrainz "Now Playing" appears on profile when track starts
- [ ] ListenBrainz scrobble appears after 50% of track (or 4 min)
- [ ] Last.fm OAuth flow opens browser and redirects
- [ ] Last.fm "Complete Auth" works after user approves
- [ ] Last.fm "Now Playing" and scrobbles work
- [ ] Libre.fm auth flow works
- [ ] Disabling a scrobbler stops submissions
- [ ] Global "Enable Scrobbling" toggle works
- [ ] Failed scrobbles are queued and retried on app restart
- [ ] Tracks under 30 seconds are not scrobbled
- [ ] Skipping before 50% does not scrobble

**Step 2: Run app and test**

Run: `npm start`

Test each item in the checklist.

**Step 3: Final commit**

```bash
git add -A
git commit -m "feat(scrobble): complete scrobbling implementation

- Add ScrobbleManager for coordinating scrobble events
- Add ListenBrainz, Last.fm, and Libre.fm scrobbler plugins
- Add scrobbler settings UI in Settings view
- Queue failed scrobbles for retry
- Respect 50%/4-minute scrobble threshold
- Add global scrobbling enable/disable toggle"
```

---

## Summary

This plan implements a complete scrobbling system with:

1. **ScrobbleManager** - Core orchestration class that tracks playback and dispatches to plugins
2. **Plugin Architecture** - BaseScrobbler class with concrete implementations for each service
3. **ListenBrainz** - Simple token-based auth, JSON API
4. **Last.fm** - OAuth desktop flow with MD5 signatures
5. **Libre.fm** - Last.fm-compatible API (reuses most code)
6. **Settings UI** - Per-service configuration cards with connect/disconnect
7. **Failure Handling** - Queue failed scrobbles for retry
8. **IPC Integration** - Main process handlers for crypto and CORS bypass

Files to create:
- `scrobble-manager.js`
- `scrobblers/base-scrobbler.js`
- `scrobblers/listenbrainz-scrobbler.js`
- `scrobblers/lastfm-scrobbler.js`
- `scrobblers/librefm-scrobbler.js`
- `scrobblers/index.js`

Files to modify:
- `main.js` - IPC handlers
- `preload.js` - Expose IPC to renderer
- `app.js` - Integration and UI
- `.env.example` - API key documentation
