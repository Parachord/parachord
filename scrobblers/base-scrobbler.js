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
