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
