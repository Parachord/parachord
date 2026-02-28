const { generateCodeVerifier, generateCodeChallenge, generateState } = require('../lib/crypto');

class AuthService {
  constructor(store, wsManager) {
    this.store = store;
    this.wsManager = wsManager;
    // Pending PKCE verifiers (per-provider, single-use)
    this._verifiers = {};
    this._states = {};
  }

  // --- Credential helpers ---

  getSpotifyCredentials() {
    const userClientId = this.store.get('spotify_client_id');
    if (userClientId) return { clientId: userClientId, source: 'user' };
    if (process.env.SPOTIFY_CLIENT_ID) return { clientId: process.env.SPOTIFY_CLIENT_ID, source: 'env' };
    return { clientId: null, source: 'none' };
  }

  getSoundCloudCredentials() {
    const userClientId = this.store.get('soundcloud_client_id');
    const userClientSecret = this.store.get('soundcloud_client_secret');
    if (userClientId && userClientSecret) {
      return { clientId: userClientId, clientSecret: userClientSecret, source: 'user' };
    }
    if (process.env.SOUNDCLOUD_CLIENT_ID && process.env.SOUNDCLOUD_CLIENT_SECRET) {
      return {
        clientId: process.env.SOUNDCLOUD_CLIENT_ID,
        clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET,
        source: 'env'
      };
    }
    return { clientId: null, clientSecret: null, source: 'none' };
  }

  // --- OAuth initiation ---

  startSpotifyAuth() {
    const { clientId } = this.getSpotifyCredentials();
    if (!clientId) {
      return { success: false, error: 'no_client_id', message: 'Please configure your Spotify Client ID.' };
    }

    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
    const scopes = [
      'streaming', 'user-read-playback-state', 'user-modify-playback-state',
      'user-library-read', 'user-follow-read',
      'playlist-read-private', 'playlist-read-collaborative'
    ].join(' ');

    this._verifiers.spotify = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(this._verifiers.spotify);

    const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&show_dialog=true&code_challenge_method=S256&code_challenge=${codeChallenge}`;

    return { success: true, authUrl };
  }

  startSoundCloudAuth() {
    const { clientId } = this.getSoundCloudCredentials();
    if (!clientId) {
      return { success: false, error: 'no_client_id', message: 'Please configure your SoundCloud credentials.' };
    }

    const redirectUri = 'http://127.0.0.1:8888/callback/soundcloud';
    this._verifiers.soundcloud = generateCodeVerifier();
    this._states.soundcloud = generateState();
    const codeChallenge = generateCodeChallenge(this._verifiers.soundcloud);

    const authUrl = `https://secure.soundcloud.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${this._states.soundcloud}`;

    return { success: true, authUrl };
  }

  // --- Token exchange ---

  async exchangeSpotifyCode(code) {
    const { clientId } = this.getSpotifyCredentials();
    const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
    const verifier = this._verifiers.spotify;
    this._verifiers.spotify = null;

    if (!verifier) throw new Error('PKCE verifier missing — auth flow not started');

    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: verifier
      })
    });

    const data = await response.json();
    if (!data.access_token) throw new Error(data.error || 'No access token received');

    const expiryTime = Date.now() + ((data.expires_in || 3600) * 1000);
    this.store.set('spotify_token', data.access_token);
    this.store.set('spotify_refresh_token', data.refresh_token);
    this.store.set('spotify_token_expiry', expiryTime);

    this.wsManager.broadcast('auth:status-changed', { provider: 'spotify', connected: true });
    return { token: data.access_token, expiresAt: expiryTime };
  }

  async exchangeSoundCloudCode(code, state) {
    // Verify state
    if (this._states.soundcloud && state !== this._states.soundcloud) {
      this._states.soundcloud = null;
      throw new Error('OAuth state mismatch');
    }
    this._states.soundcloud = null;

    const { clientId, clientSecret } = this.getSoundCloudCredentials();
    const redirectUri = 'http://127.0.0.1:8888/callback/soundcloud';
    const verifier = this._verifiers.soundcloud;
    this._verifiers.soundcloud = null;

    if (!verifier) throw new Error('PKCE verifier missing — auth flow not started');
    if (!clientId || !clientSecret) throw new Error('SoundCloud credentials not configured');

    const response = await fetch('https://secure.soundcloud.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: verifier
      })
    });

    const data = await response.json();
    if (!data.access_token) throw new Error(data.error || 'No access token received');

    const expiryTime = Date.now() + ((data.expires_in || 3600) * 1000);
    this.store.set('soundcloud_token', data.access_token);
    this.store.set('soundcloud_refresh_token', data.refresh_token);
    this.store.set('soundcloud_token_expiry', expiryTime);
    this.store.set('soundcloud_last_refresh', Date.now());

    this.wsManager.broadcast('auth:status-changed', { provider: 'soundcloud', connected: true });
    return { token: data.access_token, expiresAt: expiryTime };
  }

  // --- Token retrieval with auto-refresh ---

  async getToken(provider) {
    if (provider === 'spotify') return this._getSpotifyToken();
    if (provider === 'soundcloud') return this._getSoundCloudToken();
    return null;
  }

  async _getSpotifyToken(force = false) {
    const token = this.store.get('spotify_token');
    const expiry = this.store.get('spotify_token_expiry');
    const refreshToken = this.store.get('spotify_refresh_token');

    if (!force && token && expiry && Date.now() < expiry) {
      return { token, expiresAt: expiry };
    }

    if (!refreshToken) return null;

    const { clientId } = this.getSpotifyCredentials();
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId
      })
    });

    if (!response.ok) throw new Error(`Spotify token refresh failed: ${response.status}`);

    const data = await response.json();
    const newExpiry = Date.now() + ((data.expires_in || 3600) * 1000);

    this.store.set('spotify_token', data.access_token);
    this.store.set('spotify_token_expiry', newExpiry);
    if (data.refresh_token) this.store.set('spotify_refresh_token', data.refresh_token);

    return { token: data.access_token, expiresAt: newExpiry };
  }

  async _getSoundCloudToken() {
    const token = this.store.get('soundcloud_token');
    const expiry = this.store.get('soundcloud_token_expiry');
    const refreshToken = this.store.get('soundcloud_refresh_token');
    const lastRefresh = this.store.get('soundcloud_last_refresh');

    const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
    const shouldProactiveRefresh = lastRefresh && (Date.now() - lastRefresh) > SEVEN_DAYS_MS;

    if (token && expiry && Date.now() < expiry && !shouldProactiveRefresh) {
      return { token, expiresAt: expiry };
    }

    if (!refreshToken) return null;

    const { clientId, clientSecret } = this.getSoundCloudCredentials();
    if (!clientId || !clientSecret) return null;

    const response = await fetch('https://secure.soundcloud.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: clientId,
        client_secret: clientSecret
      })
    });

    if (!response.ok) {
      if (response.status === 401) {
        this.store.delete('soundcloud_token');
        this.store.delete('soundcloud_refresh_token');
        this.store.delete('soundcloud_token_expiry');
        this.store.delete('soundcloud_last_refresh');
      }
      throw new Error(`SoundCloud token refresh failed: ${response.status}`);
    }

    const data = await response.json();
    const newExpiry = Date.now() + ((data.expires_in || 3600) * 1000);

    this.store.set('soundcloud_token', data.access_token);
    this.store.set('soundcloud_token_expiry', newExpiry);
    this.store.set('soundcloud_last_refresh', Date.now());
    if (data.refresh_token) this.store.set('soundcloud_refresh_token', data.refresh_token);

    return { token: data.access_token, expiresAt: newExpiry };
  }

  // --- Status and disconnect ---

  getStatus(provider) {
    const token = this.store.get(`${provider}_token`);
    const expiry = this.store.get(`${provider}_token_expiry`);
    return {
      connected: !!(token && expiry && Date.now() < expiry),
      expiresAt: expiry || null
    };
  }

  disconnect(provider) {
    const keys = [`${provider}_token`, `${provider}_refresh_token`, `${provider}_token_expiry`];
    if (provider === 'soundcloud') keys.push('soundcloud_last_refresh');
    for (const key of keys) this.store.delete(key);
    this.wsManager.broadcast('auth:status-changed', { provider, connected: false });
  }

  // --- Credential management ---

  setSpotifyCredentials(clientId) {
    if (clientId) {
      this.store.set('spotify_client_id', clientId);
      this.store.delete('spotify_client_secret');
      return { success: true, source: 'user' };
    }
    this.store.delete('spotify_client_id');
    this.store.delete('spotify_client_secret');
    return { success: true, source: 'none' };
  }

  setSoundCloudCredentials(clientId, clientSecret) {
    if (clientId && clientSecret) {
      this.store.set('soundcloud_client_id', clientId);
      this.store.set('soundcloud_client_secret', clientSecret);
      return { success: true, source: 'user' };
    }
    if (!clientId && !clientSecret) {
      this.store.delete('soundcloud_client_id');
      this.store.delete('soundcloud_client_secret');
      return { success: true, source: 'none' };
    }
    return { success: false, error: 'Both Client ID and Client Secret are required' };
  }
}

module.exports = AuthService;
