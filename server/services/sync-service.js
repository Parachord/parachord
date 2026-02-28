const syncEngine = require('../../sync-engine');

class SyncService {
  constructor(store, authService, wsManager) {
    this.store = store;
    this.auth = authService;
    this.ws = wsManager;
    this._activeSync = null; // { providerId, cancelled }
  }

  /**
   * Get all available sync providers with connection status
   */
  getProviders() {
    const providers = syncEngine.getAllProviders();
    return providers.map(p => ({
      id: p.id,
      name: p.name,
      icon: p.icon,
      connected: !!this.store.get(`${p.id}_token`)
    }));
  }

  /**
   * Start syncing from a provider
   */
  async startSync(providerId) {
    if (this._activeSync) {
      throw new Error(`Sync already in progress for ${this._activeSync.providerId}`);
    }

    const Provider = syncEngine.getProvider(providerId);
    if (!Provider) throw new Error(`Unknown provider: ${providerId}`);

    const tokenResult = await this.auth.getToken(providerId);
    if (!tokenResult) throw new Error(`Not authenticated with ${providerId}`);

    this._activeSync = { providerId, cancelled: false };

    try {
      this.ws.broadcast('sync:started', { providerId });

      // Fetch remote library
      this.ws.broadcast('sync:progress', { providerId, stage: 'fetching', percent: 0 });
      const remoteTracks = await Provider.fetchLibrary(tokenResult.token, (progress) => {
        if (this._activeSync?.cancelled) throw new Error('Sync cancelled');
        this.ws.broadcast('sync:progress', { providerId, stage: 'fetching', ...progress });
      });

      if (this._activeSync?.cancelled) throw new Error('Sync cancelled');

      // Calculate diff
      this.ws.broadcast('sync:progress', { providerId, stage: 'diffing', percent: 50 });
      const localTracks = this.store.get(`sync_${providerId}_tracks`, []);
      const diff = syncEngine.calculateDiff(remoteTracks, localTracks, providerId);

      // Apply diff
      this.ws.broadcast('sync:progress', { providerId, stage: 'applying', percent: 75 });
      const merged = [...localTracks.filter(t => !diff.toRemove.find(r => r.id === t.id)), ...diff.toAdd];
      for (const update of diff.toUpdate) {
        const idx = merged.findIndex(t => t.id === update.id);
        if (idx >= 0) merged[idx] = { ...merged[idx], ...update };
      }
      this.store.set(`sync_${providerId}_tracks`, merged);
      this.store.set(`sync_${providerId}_lastSync`, Date.now());

      const result = {
        providerId,
        added: diff.toAdd.length,
        removed: diff.toRemove.length,
        updated: diff.toUpdate.length,
        unchanged: diff.unchanged.length,
        total: merged.length
      };

      this.ws.broadcast('sync:completed', result);
      return result;
    } catch (err) {
      this.ws.broadcast('sync:error', { providerId, error: err.message });
      throw err;
    } finally {
      this._activeSync = null;
    }
  }

  /**
   * Cancel active sync
   */
  cancelSync() {
    if (this._activeSync) {
      this._activeSync.cancelled = true;
      this.ws.broadcast('sync:cancelled', { providerId: this._activeSync.providerId });
    }
  }

  /**
   * Fetch playlists from a provider
   */
  async fetchPlaylists(providerId) {
    const Provider = syncEngine.getProvider(providerId);
    if (!Provider) throw new Error(`Unknown provider: ${providerId}`);
    if (!Provider.fetchPlaylists) throw new Error(`${providerId} does not support playlist fetching`);

    const tokenResult = await this.auth.getToken(providerId);
    if (!tokenResult) throw new Error(`Not authenticated with ${providerId}`);

    return Provider.fetchPlaylists(tokenResult.token);
  }
}

module.exports = SyncService;
