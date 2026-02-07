/**
 * Parachord Scrobbler Loader
 *
 * Loads and manages scrobbler plugins for Last.fm, ListenBrainz, and Libre.fm
 * Makes scrobble manager available globally as window.scrobbleManager
 */

// ============================================================================
// ScrobbleManager - Manages scrobbling state and dispatches to enabled plugins
// ============================================================================

class ScrobbleManager {
  constructor() {
    this.plugins = new Map(); // pluginId -> plugin instance
    this.currentTrack = null;
    this.trackStartTime = null;
    this.scrobbleSubmitted = false;
    this.nowPlayingSent = false;
    this.progressCheckInterval = null;
    this.onScrobbleCallback = null; // Callback for when scrobble is submitted
  }

  // Set callback to be notified when a scrobble is submitted
  setOnScrobbleCallback(callback) {
    this.onScrobbleCallback = callback;
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

    // Scrobble threshold per Last.fm/ListenBrainz spec:
    // - At least 30 seconds of listening
    // - At least 50% of track OR 4 minutes, whichever is earlier
    const halfDuration = duration / 2;
    const fourMinutes = 240;
    const minListenTime = 30;
    const threshold = Math.max(minListenTime, Math.min(halfDuration, fourMinutes));

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
    let anySuccess = false;
    for (const plugin of enabledPlugins) {
      try {
        await plugin.scrobble(track, timestamp);
        console.log(`[ScrobbleManager] Scrobble submitted to ${plugin.id}`);
        anySuccess = true;
      } catch (error) {
        console.error(`[ScrobbleManager] Scrobble failed for ${plugin.id}:`, error);
        // Queue for retry
        await this.queueFailedScrobble(plugin.id, track, timestamp, error.message);
      }
    }

    // Notify callback if any scrobble succeeded
    if (anySuccess && this.onScrobbleCallback) {
      try {
        this.onScrobbleCallback(track, timestamp);
      } catch (error) {
        console.error('[ScrobbleManager] onScrobbleCallback error:', error);
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


// ============================================================================
// BaseScrobbler - Base class for scrobbler plugins
// ============================================================================

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


// ============================================================================
// ListenBrainzScrobbler - ListenBrainz scrobbler with token auth
// ============================================================================

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

    if (!response.success) {
      throw new Error(`ListenBrainz API error: ${response.status || 'unknown'} - ${response.error || response.text}`);
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

    if (!response.success) {
      throw new Error(`ListenBrainz API error: ${response.status || 'unknown'} - ${response.error || response.text}`);
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

    if (!response.success) {
      return { valid: false, error: 'Invalid token' };
    }

    let data;
    try {
      data = JSON.parse(response.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse API response as JSON: ${(response.text || '').substring(0, 200)}`);
    }
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


// ============================================================================
// LastFmScrobbler - Last.fm scrobbler with API key + session key + MD5 sigs
// ============================================================================

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
  async generateSignature(params) {
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

    if (!response.success) {
      throw new Error(`Last.fm API request failed: ${response.error || response.status}`);
    }

    let data;
    try {
      data = JSON.parse(response.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse API response as JSON: ${(response.text || '').substring(0, 200)}`);
    }

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
    if (!response.success) {
      throw new Error(`Failed to get auth token: ${response.error || response.status}`);
    }
    let data;
    try {
      data = JSON.parse(response.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse API response as JSON: ${(response.text || '').substring(0, 200)}`);
    }
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
    if (!response.success) {
      throw new Error(`Failed to get session: ${response.error || response.status}`);
    }
    let data;
    try {
      data = JSON.parse(response.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse API response as JSON: ${(response.text || '').substring(0, 200)}`);
    }

    if (data.error) {
      throw new Error(`Failed to get session: ${data.message}`);
    }

    return {
      sessionKey: data.session.key,
      username: data.session.name
    };
  }

  // Full auth flow - returns URL, then auto-polls for completion
  async startAuth() {
    const token = await this.getAuthToken();
    const authUrl = this.getAuthUrl(token);

    // Store token temporarily
    await this.setConfig({
      ...await this.getConfig(),
      pendingToken: token,
      authPolling: true
    });

    // Start polling for auth completion in background
    this.startAuthPolling(token);

    return { authUrl, token };
  }

  // Poll for auth completion (called automatically after startAuth)
  startAuthPolling(token) {
    // Clear any existing polling
    if (this.authPollInterval) {
      clearInterval(this.authPollInterval);
    }

    let attempts = 0;
    const maxAttempts = 60; // 5 minutes at 5-second intervals

    console.log(`[${this.name}] Starting auth polling...`);

    this.authPollInterval = setInterval(async () => {
      attempts++;

      try {
        const session = await this.getSession(token);

        // Success! User has authorized
        console.log(`[${this.name}] Auth polling: authorization detected!`);
        clearInterval(this.authPollInterval);
        this.authPollInterval = null;

        await this.setConfig({
          enabled: true,
          sessionKey: session.sessionKey,
          username: session.username,
          connectedAt: Date.now(),
          pendingToken: null,
          authPolling: false
        });

        // Emit event for UI to update
        window.dispatchEvent(new CustomEvent('scrobbler-auth-complete', {
          detail: { scrobblerId: this.id, username: session.username }
        }));
      } catch (error) {
        // Token not yet authorized, keep polling
        if (attempts >= maxAttempts) {
          console.log(`[${this.name}] Auth polling timed out after ${maxAttempts} attempts`);
          clearInterval(this.authPollInterval);
          this.authPollInterval = null;

          // Clear pending state
          const config = await this.getConfig();
          await this.setConfig({
            ...config,
            pendingToken: null,
            authPolling: false
          });
        }
      }
    }, 5000); // Poll every 5 seconds
  }

  // Stop polling (if user cancels)
  stopAuthPolling() {
    if (this.authPollInterval) {
      clearInterval(this.authPollInterval);
      this.authPollInterval = null;
      console.log(`[${this.name}] Auth polling stopped`);
    }
  }

  // Complete auth after user approves (manual fallback)
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


// ============================================================================
// LibreFmScrobbler - Libre.fm scrobbler (Last.fm-compatible API)
// ============================================================================

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
    // Libre.fm (GNU FM) uses authToken = md5(username + md5(password))
    const passwordHash = await window.electron.crypto.md5(password);
    const authToken = await window.electron.crypto.md5(username.toLowerCase() + passwordHash);

    const params = {
      method: 'auth.getMobileSession',
      username: username,
      authToken: authToken,
      api_key: this.apiKey
    };
    const sig = await this.generateSignature(params);

    const body = new URLSearchParams();
    body.append('method', 'auth.getMobileSession');
    body.append('username', username);
    body.append('authToken', authToken);
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

    if (!response.success) {
      throw new Error(`Libre.fm auth request failed: ${response.error || response.status}`);
    }

    let data;
    try {
      data = JSON.parse(response.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse API response as JSON: ${(response.text || '').substring(0, 200)}`);
    }

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
    if (!response.success) {
      throw new Error(`Failed to get auth token: ${response.error || response.status}`);
    }
    let data;
    try {
      data = JSON.parse(response.text);
    } catch (parseErr) {
      throw new Error(`Failed to parse API response as JSON: ${(response.text || '').substring(0, 200)}`);
    }

    if (data.error) {
      throw new Error(`Failed to get auth token: ${data.message}`);
    }

    const authUrl = this.getAuthUrl(data.token);

    await this.setConfig({
      ...await this.getConfig(),
      pendingToken: data.token,
      authPolling: true
    });

    // Start polling for auth completion (inherited from parent)
    this.startAuthPolling(data.token);

    return { authUrl, token: data.token };
  }
}


// ============================================================================
// Create singleton instances and export globally
// ============================================================================

// Create singleton scrobble manager
const scrobbleManager = new ScrobbleManager();

// Create singleton scrobbler instances
const listenbrainzScrobbler = new ListenBrainzScrobbler();
const lastfmScrobbler = new LastFmScrobbler();
const librefmScrobbler = new LibreFmScrobbler();

// All available scrobblers
const scrobblers = [
  listenbrainzScrobbler,
  lastfmScrobbler,
  librefmScrobbler
];

// Initialize all scrobblers and register with manager
async function initializeScrobblers(config = {}) {
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
function getScrobbler(id) {
  return scrobblers.find(s => s.id === id);
}

// Export for use in main app via window object
if (typeof window !== 'undefined') {
  window.scrobbleManager = scrobbleManager;
  window.scrobblers = scrobblers;
  window.initializeScrobblers = initializeScrobblers;
  window.getScrobbler = getScrobbler;
  window.listenbrainzScrobbler = listenbrainzScrobbler;
  window.lastfmScrobbler = lastfmScrobbler;
  window.librefmScrobbler = librefmScrobbler;

  // Also export the classes for advanced usage
  window.ScrobbleManager = ScrobbleManager;
  window.BaseScrobbler = BaseScrobbler;
  window.ListenBrainzScrobbler = ListenBrainzScrobbler;
  window.LastFmScrobbler = LastFmScrobbler;
  window.LibreFmScrobbler = LibreFmScrobbler;
}

// CommonJS export for Node.js/testing
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    scrobbleManager,
    scrobblers,
    initializeScrobblers,
    getScrobbler,
    listenbrainzScrobbler,
    lastfmScrobbler,
    librefmScrobbler,
    ScrobbleManager,
    BaseScrobbler,
    ListenBrainzScrobbler,
    LastFmScrobbler,
    LibreFmScrobbler
  };
}
