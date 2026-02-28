/**
 * Server-side scrobbling service.
 *
 * Adapts the ScrobbleManager from scrobbler-loader.js for server use by
 * replacing window.electron.store → Store, window.electron.proxyFetch → fetch,
 * window.electron.crypto.md5 → crypto md5.
 *
 * Hooks into PlaybackService for automatic scrobbling.
 */
const { md5 } = require('../lib/crypto');

class ScrobbleService {
  constructor(store, wsManager) {
    this.store = store;
    this.ws = wsManager;
    this.plugins = new Map();
    this.currentTrack = null;
    this.trackStartTime = null;
    this.scrobbleSubmitted = false;

    // Register built-in scrobblers
    this._registerBuiltins();
  }

  _registerBuiltins() {
    this.registerPlugin(new ServerListenBrainzScrobbler(this.store));
    this.registerPlugin(new ServerLastFmScrobbler(this.store));
    this.registerPlugin(new ServerLibreFmScrobbler(this.store));
  }

  registerPlugin(plugin) {
    this.plugins.set(plugin.id, plugin);
  }

  getPlugins() {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.id,
      name: p.name,
      connected: p.isEnabled()
    }));
  }

  getPlugin(id) {
    return this.plugins.get(id);
  }

  _getEnabledPlugins() {
    return Array.from(this.plugins.values()).filter(p => p.isEnabled());
  }

  // --- Playback integration ---

  async onTrackStart(track) {
    this.currentTrack = track;
    this.trackStartTime = Date.now();
    this.scrobbleSubmitted = false;

    if (!track.title || !track.artist) return;
    if (track.duration && track.duration < 30) return;

    for (const plugin of this._getEnabledPlugins()) {
      try {
        await plugin.updateNowPlaying(track);
      } catch (err) {
        console.error(`[ScrobbleService] Now Playing failed for ${plugin.id}:`, err.message);
      }
    }
  }

  async onProgressUpdate(progressSeconds) {
    if (!this.currentTrack || this.scrobbleSubmitted) return;

    const duration = this.currentTrack.duration;
    if (!duration || duration < 30) return;

    const threshold = Math.max(30, Math.min(duration / 2, 240));
    if (progressSeconds >= threshold) {
      await this._submitScrobble();
    }
  }

  onTrackEnd() {
    this.currentTrack = null;
    this.trackStartTime = null;
  }

  async _submitScrobble() {
    if (this.scrobbleSubmitted || !this.currentTrack) return;
    this.scrobbleSubmitted = true;

    const track = this.currentTrack;
    const timestamp = Math.floor(this.trackStartTime / 1000);

    for (const plugin of this._getEnabledPlugins()) {
      try {
        await plugin.scrobble(track, timestamp);
        this.ws.broadcast('scrobble:submitted', {
          pluginId: plugin.id, track: { title: track.title, artist: track.artist }
        });
      } catch (err) {
        console.error(`[ScrobbleService] Scrobble failed for ${plugin.id}:`, err.message);
        this._queueFailed(plugin.id, track, timestamp, err.message);
      }
    }
  }

  _queueFailed(pluginId, track, timestamp, error) {
    const queue = this.store.get('scrobble-failed-queue', []);
    queue.push({
      pluginId,
      track: { title: track.title, artist: track.artist, album: track.album, duration: track.duration },
      timestamp, error, attempts: 1, queuedAt: Date.now()
    });
    if (queue.length > 500) queue.splice(0, queue.length - 500);
    this.store.set('scrobble-failed-queue', queue);
  }

  async retryFailed() {
    const queue = this.store.get('scrobble-failed-queue', []);
    if (!queue.length) return { retried: 0, remaining: 0 };

    const remaining = [];
    let retried = 0;

    for (const item of queue) {
      const plugin = this.plugins.get(item.pluginId);
      if (!plugin || !plugin.isEnabled()) { remaining.push(item); continue; }

      try {
        await plugin.scrobble(item.track, item.timestamp);
        retried++;
      } catch {
        item.attempts++;
        if (item.attempts < 10 && (Date.now() - item.queuedAt) < 14 * 24 * 60 * 60 * 1000) {
          remaining.push(item);
        }
      }
    }

    this.store.set('scrobble-failed-queue', remaining);
    return { retried, remaining: remaining.length };
  }
}

// --- Server-adapted scrobbler classes ---

class ServerBaseScrobbler {
  constructor(id, name, store) {
    this.id = id;
    this.name = name;
    this.store = store;
  }

  getConfig() {
    return this.store.get(`scrobbler-config-${this.id}`, {});
  }

  setConfig(config) {
    this.store.set(`scrobbler-config-${this.id}`, config);
  }

  isEnabled() { return false; }
  async updateNowPlaying() { throw new Error('Not implemented'); }
  async scrobble() { throw new Error('Not implemented'); }

  disconnect() {
    this.store.delete(`scrobbler-config-${this.id}`);
  }

  getConnectionStatus() {
    const config = this.getConfig();
    return {
      connected: this.isEnabled(),
      username: config.username || null
    };
  }
}

class ServerListenBrainzScrobbler extends ServerBaseScrobbler {
  constructor(store) {
    super('listenbrainz', 'ListenBrainz', store);
    this.apiBase = 'https://api.listenbrainz.org/1';
  }

  isEnabled() {
    const config = this.getConfig();
    return !!(config.enabled && config.userToken);
  }

  async updateNowPlaying(track) {
    const config = this.getConfig();
    const res = await fetch(`${this.apiBase}/submit-listens`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${config.userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listen_type: 'playing_now',
        payload: [{ track_metadata: {
          artist_name: track.artist, track_name: track.title,
          release_name: track.album || undefined,
          additional_info: { media_player: 'Parachord', submission_client: 'Parachord' }
        }}]
      })
    });
    if (!res.ok) throw new Error(`ListenBrainz API error: ${res.status}`);
  }

  async scrobble(track, timestamp) {
    const config = this.getConfig();
    const res = await fetch(`${this.apiBase}/submit-listens`, {
      method: 'POST',
      headers: { 'Authorization': `Token ${config.userToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        listen_type: 'single',
        payload: [{ listened_at: timestamp, track_metadata: {
          artist_name: track.artist, track_name: track.title,
          release_name: track.album || undefined,
          additional_info: { media_player: 'Parachord', submission_client: 'Parachord' }
        }}]
      })
    });
    if (!res.ok) throw new Error(`ListenBrainz API error: ${res.status}`);
  }

  async connect(token) {
    const res = await fetch(`${this.apiBase}/validate-token`, {
      headers: { 'Authorization': `Token ${token}` }
    });
    if (!res.ok) throw new Error('Invalid token');
    const data = await res.json();
    if (!data.valid) throw new Error('Token validation failed');

    this.setConfig({ enabled: true, userToken: token, username: data.user_name, connectedAt: Date.now() });
    return { username: data.user_name };
  }
}

class ServerLastFmScrobbler extends ServerBaseScrobbler {
  constructor(store) {
    super('lastfm', 'Last.fm', store);
    this.apiBase = 'https://ws.audioscrobbler.com/2.0/';
    this.apiKey = process.env.LASTFM_API_KEY || null;
    this.apiSecret = process.env.LASTFM_API_SECRET || process.env.LASTFM_SHARED_SECRET || null;
  }

  isEnabled() {
    const config = this.getConfig();
    return !!(config.enabled && config.sessionKey && this.apiKey);
  }

  _generateSignature(params) {
    const sortedKeys = Object.keys(params).sort();
    let sig = '';
    for (const key of sortedKeys) {
      if (key !== 'format' && params[key] !== undefined) sig += key + params[key];
    }
    sig += this.apiSecret;
    return md5(sig);
  }

  async _apiRequest(method, params) {
    const config = this.getConfig();
    const requestParams = { method, api_key: this.apiKey, sk: config.sessionKey, format: 'json', ...params };
    requestParams.api_sig = this._generateSignature(requestParams);

    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(requestParams)) { if (v !== undefined) body.append(k, v); }

    const res = await fetch(this.apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error(`Last.fm API error: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(`Last.fm API error ${data.error}: ${data.message}`);
    return data;
  }

  async updateNowPlaying(track) {
    await this._apiRequest('track.updateNowPlaying', {
      artist: track.artist, track: track.title,
      album: track.album || undefined, duration: track.duration || undefined
    });
  }

  async scrobble(track, timestamp) {
    await this._apiRequest('track.scrobble', {
      'artist[0]': track.artist, 'track[0]': track.title, 'timestamp[0]': timestamp,
      'album[0]': track.album || undefined, 'duration[0]': track.duration || undefined
    });
  }

  async startAuth() {
    const res = await fetch(`${this.apiBase}?method=auth.getToken&api_key=${this.apiKey}&format=json`);
    if (!res.ok) throw new Error('Failed to get auth token');
    const data = await res.json();
    if (data.error) throw new Error(data.message);

    const authUrl = `https://www.last.fm/api/auth/?api_key=${this.apiKey}&token=${data.token}`;
    this.setConfig({ ...this.getConfig(), pendingToken: data.token });
    return { authUrl, token: data.token };
  }

  async completeAuth() {
    const config = this.getConfig();
    if (!config.pendingToken) throw new Error('No pending auth token');

    const params = { method: 'auth.getSession', api_key: this.apiKey, token: config.pendingToken };
    params.api_sig = this._generateSignature(params);

    const res = await fetch(
      `${this.apiBase}?method=auth.getSession&api_key=${this.apiKey}&token=${config.pendingToken}&api_sig=${params.api_sig}&format=json`
    );
    if (!res.ok) throw new Error('Failed to get session');
    const data = await res.json();
    if (data.error) throw new Error(data.message);

    this.setConfig({
      enabled: true, sessionKey: data.session.key,
      username: data.session.name, connectedAt: Date.now(), pendingToken: null
    });
    return { username: data.session.name };
  }
}

class ServerLibreFmScrobbler extends ServerLastFmScrobbler {
  constructor(store) {
    super(store);
    this.id = 'librefm';
    this.name = 'Libre.fm';
    this.apiBase = 'https://libre.fm/2.0/';
    this.apiKey = '00000000000000000000000000000000';
    this.apiSecret = '00000000000000000000000000000000';
  }

  async connectWithPassword(username, password) {
    const passwordHash = md5(password);
    const authToken = md5(username.toLowerCase() + passwordHash);

    const params = { method: 'auth.getMobileSession', username, authToken, api_key: this.apiKey };
    params.api_sig = this._generateSignature(params);

    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.append(k, v);
    body.append('format', 'json');

    const res = await fetch(this.apiBase, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString()
    });
    if (!res.ok) throw new Error(`Libre.fm auth failed: ${res.status}`);
    const data = await res.json();
    if (data.error) throw new Error(data.message);

    this.setConfig({
      enabled: true, sessionKey: data.session.key,
      username: data.session.name, connectedAt: Date.now()
    });
    return { username: data.session.name };
  }
}

module.exports = ScrobbleService;
