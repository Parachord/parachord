const fs = require('fs');
const path = require('path');
const ResolverLoader = require('../../resolver-loader');

class ResolverService {
  constructor(store, wsManager, pluginDirs) {
    this.store = store;
    this.wsManager = wsManager;
    this.pluginDirs = pluginDirs;
    this.loader = new ResolverLoader();
  }

  /**
   * Load all .axe plugins from configured plugin directories
   */
  async loadPlugins() {
    const axeContents = [];

    for (const dir of this.pluginDirs) {
      if (!fs.existsSync(dir)) continue;

      const files = fs.readdirSync(dir).filter(f => f.endsWith('.axe'));
      for (const file of files) {
        try {
          const content = fs.readFileSync(path.join(dir, file), 'utf-8');
          axeContents.push(JSON.parse(content));
        } catch (err) {
          console.error(`[ResolverService] Failed to read ${file}:`, err.message);
        }
      }
    }

    await this.loader.loadResolvers(axeContents);

    // Apply saved enabled/weight state
    const savedConfigs = this.store.get('resolver_configs', {});
    for (const resolver of this.loader.getAllResolvers()) {
      const saved = savedConfigs[resolver.id];
      if (saved) {
        resolver.enabled = saved.enabled ?? false;
        resolver.weight = saved.weight ?? 0;
        resolver.config = saved.config ?? {};
      }
    }

    console.log(`[ResolverService] Loaded ${this.loader.getAllResolvers().length} resolvers`);
  }

  /**
   * Get all resolvers with their current state
   */
  getAllResolvers() {
    return this.loader.getAllResolvers().map(r => ({
      id: r.id,
      name: r.name,
      version: r.version,
      author: r.author,
      description: r.description,
      icon: r.icon,
      color: r.color,
      capabilities: r.capabilities,
      requiresAuth: r.requiresAuth,
      authType: r.authType,
      configurable: r.configurable,
      enabled: r.enabled,
      weight: r.weight
    }));
  }

  /**
   * Get a single resolver by ID
   */
  getResolver(id) {
    return this.loader.getResolver(id);
  }

  /**
   * Get resolver config (API keys, tokens, etc.)
   */
  getResolverConfig(id) {
    const resolver = this.loader.getResolver(id);
    return resolver ? resolver.config || {} : {};
  }

  /**
   * Enable or disable a resolver
   */
  setEnabled(id, enabled) {
    const resolver = this.loader.getResolver(id);
    if (!resolver) throw new Error(`Resolver ${id} not found`);

    resolver.enabled = enabled;
    this._saveResolverState(id);
    this.wsManager.broadcast('resolvers:updated', this.getAllResolvers());
  }

  /**
   * Update resolver config
   */
  setResolverConfig(id, config) {
    const resolver = this.loader.getResolver(id);
    if (!resolver) throw new Error(`Resolver ${id} not found`);

    resolver.config = { ...resolver.config, ...config };
    this._saveResolverState(id);
  }

  /**
   * Search across all enabled resolvers
   */
  async search(query) {
    const resolvers = this.loader.getAllResolvers().filter(r => r.enabled && r.search);
    const results = [];

    const searches = resolvers.map(async (resolver) => {
      try {
        const config = resolver.config || {};
        const tracks = await resolver.search(query, config);
        if (Array.isArray(tracks)) {
          return tracks.map(t => ({
            ...t,
            resolverId: resolver.id,
            resolverName: resolver.name,
            resolverIcon: resolver.icon,
            resolverColor: resolver.color
          }));
        }
      } catch (err) {
        console.error(`[ResolverService] Search error (${resolver.id}):`, err.message);
      }
      return [];
    });

    const settled = await Promise.allSettled(searches);
    for (const result of settled) {
      if (result.status === 'fulfilled') {
        results.push(...result.value);
      }
    }

    return results;
  }

  /**
   * Resolve a track — find a playable URL/stream for it
   */
  async resolve(track) {
    // If track has a resolverId, try that one first
    if (track.resolverId) {
      const resolver = this.loader.getResolver(track.resolverId);
      if (resolver && resolver.resolve) {
        try {
          const config = resolver.config || {};
          return await resolver.resolve(track, config);
        } catch (err) {
          console.error(`[ResolverService] Resolve error (${resolver.id}):`, err.message);
        }
      }
    }

    // Fallback: try all enabled resolvers
    for (const resolver of this.loader.getAllResolvers()) {
      if (!resolver.enabled || !resolver.resolve) continue;
      try {
        const config = resolver.config || {};
        const result = await resolver.resolve(track, config);
        if (result) return result;
      } catch (err) {
        console.error(`[ResolverService] Resolve fallback error (${resolver.id}):`, err.message);
      }
    }

    return null;
  }

  /**
   * Look up a URL to get track/album/playlist metadata
   */
  async lookupUrl(url) {
    return this.loader.lookupUrl(url);
  }

  /**
   * Look up album tracks from URL
   */
  async lookupAlbum(url) {
    return this.loader.lookupAlbum(url);
  }

  /**
   * Look up playlist tracks from URL
   */
  async lookupPlaylist(url) {
    return this.loader.lookupPlaylist(url);
  }

  /**
   * Detect URL type
   */
  getUrlType(url) {
    return this.loader.getUrlType(url);
  }

  _saveResolverState(id) {
    const resolver = this.loader.getResolver(id);
    if (!resolver) return;

    const configs = this.store.get('resolver_configs', {});
    configs[id] = {
      enabled: resolver.enabled,
      weight: resolver.weight,
      config: resolver.config
    };
    this.store.set('resolver_configs', configs);
  }
}

module.exports = ResolverService;
