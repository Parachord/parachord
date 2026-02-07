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
    // Libre.fm uses authToken = md5(lowercased_username + md5(password))
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

export default LibreFmScrobbler;
