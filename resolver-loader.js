/**
 * Parachord Resolver Loader
 * 
 * Loads and instantiates .axe resolver plugins
 */

class ResolverLoader {
  constructor() {
    this.resolvers = new Map();
    this.urlPatterns = []; // Array of { pattern: string, resolverId: string }
  }

  /**
   * Load a resolver from .axe file content (JSON string or object)
   */
  async loadResolver(axeContent) {
    try {
      // Parse if string
      const axe = typeof axeContent === 'string' 
        ? JSON.parse(axeContent) 
        : axeContent;

      // Validate manifest
      if (!axe.manifest || !axe.manifest.id) {
        throw new Error('Invalid .axe file: missing manifest.id');
      }

      const id = axe.manifest.id;

      // Create resolver instance
      const resolver = this.createResolverInstance(axe);

      // Store resolver
      this.resolvers.set(id, resolver);

      // Register URL patterns
      if (axe.urlPatterns && Array.isArray(axe.urlPatterns)) {
        for (const pattern of axe.urlPatterns) {
          this.urlPatterns.push({ pattern, resolverId: id });
        }
        console.log(`  📎 Registered ${axe.urlPatterns.length} URL pattern(s) for ${id}`);
      }

      console.log(`✅ Loaded resolver: ${axe.manifest.name} v${axe.manifest.version}`);

      return resolver;
    } catch (error) {
      console.error('Failed to load resolver:', error);
      throw error;
    }
  }

  /**
   * Load multiple resolvers from an array of .axe contents
   */
  async loadResolvers(axeContents) {
    const results = [];
    for (const axeContent of axeContents) {
      try {
        const resolver = await this.loadResolver(axeContent);
        results.push(resolver);
      } catch (error) {
        console.error('Failed to load resolver:', error);
        // Continue loading other resolvers
      }
    }
    return results;
  }

  /**
   * Create a resolver instance from .axe data
   */
  createResolverInstance(axe) {
    const { manifest, capabilities, settings, implementation } = axe;

    // Create implementation functions
    const implFunctions = {};
    
    if (implementation) {
      // Convert string implementations to actual functions
      for (const [key, fnString] of Object.entries(implementation)) {
        try {
          // Create function from string
          // eslint-disable-next-line no-new-func
          const fn = new Function('return ' + fnString)();
          implFunctions[key] = fn;
        } catch (error) {
          console.error(`Failed to create function ${key} for ${manifest.id}:`, error);
          implFunctions[key] = async () => {
            throw new Error(`Function ${key} not implemented`);
          };
        }
      }
    }

    // Filter implementation functions to prevent prototype pollution
    const RESERVED_KEYS = new Set([
      '__proto__', 'constructor', 'prototype',
      'id', 'name', 'version', 'author', 'description', 'icon', 'color',
      'homepage', 'email', 'capabilities', 'urlPatterns',
      'requiresAuth', 'authType', 'configurable', 'enabled', 'weight', 'config',
      '_bindContext'
    ]);
    const safeImplFunctions = {};
    for (const [key, fn] of Object.entries(implFunctions)) {
      if (!RESERVED_KEYS.has(key)) {
        safeImplFunctions[key] = fn;
      } else {
        console.warn(`⚠️ Skipping reserved implementation key "${key}" in resolver ${manifest.id}`);
      }
    }

    // Create resolver object
    const resolver = {
      // Metadata
      id: manifest.id,
      name: manifest.name,
      version: manifest.version,
      author: manifest.author,
      description: manifest.description,
      icon: manifest.icon || '🎵',
      color: manifest.color || '#888888',
      homepage: manifest.homepage,
      email: manifest.email,

      // Capabilities
      capabilities: capabilities || {},
      // URL patterns for URL lookup
      urlPatterns: axe.urlPatterns || [],

      // Settings
      requiresAuth: settings?.requiresAuth || false,
      authType: settings?.authType || 'none',
      configurable: settings?.configurable || {},

      // State
      enabled: false,
      weight: 0,
      config: {},

      // Implementation (filtered for safety)
      ...safeImplFunctions,

      // Bind this context to implementation functions
      _bindContext() {
        const self = this;
        for (const key of Object.keys(safeImplFunctions)) {
          const original = this[key];
          this[key] = function(...args) {
            return original.call(self, ...args);
          };
        }
      }
    };

    // Bind context so `this` works in implementation functions
    resolver._bindContext();

    return resolver;
  }

  /**
   * Get a resolver by ID
   */
  getResolver(id) {
    return this.resolvers.get(id);
  }

  /**
   * Get all loaded resolvers
   */
  getAllResolvers() {
    return Array.from(this.resolvers.values());
  }

  /**
   * Unload a resolver
   */
  async unloadResolver(id) {
    const resolver = this.resolvers.get(id);
    if (resolver && resolver.cleanup) {
      try {
        await resolver.cleanup();
      } catch (error) {
        console.error(`Error during cleanup of ${id}:`, error);
      }
    }
    this.resolvers.delete(id);
    // Remove URL patterns for this resolver
    this.urlPatterns = this.urlPatterns.filter(p => p.resolverId !== id);
    console.log(`🗑️ Unloaded resolver: ${id}`);
  }

  /**
   * Initialize a resolver
   */
  async initResolver(id, config = {}) {
    const resolver = this.resolvers.get(id);
    if (!resolver) {
      throw new Error(`Resolver ${id} not found`);
    }

    resolver.config = config;

    if (resolver.init) {
      try {
        await resolver.init(config);
      } catch (error) {
        console.error(`Error initializing ${id}:`, error);
        throw error;
      }
    }

    console.log(`🚀 Initialized resolver: ${resolver.name}`);
  }

  /**
   * Find which resolver can handle a given URL
   * @param {string} url - The URL to match
   * @returns {string|null} - Resolver ID or null if no match
   */
  findResolverForUrl(url) {
    for (const { pattern, resolverId } of this.urlPatterns) {
      if (this.matchUrlPattern(url, pattern)) {
        return resolverId;
      }
    }
    return null;
  }

  /**
   * Match a URL against a glob-like pattern
   * Supports: * (any chars except /), *.domain.com (subdomain wildcard)
   */
  matchUrlPattern(url, pattern) {
    try {
      // Normalize URL - remove protocol, trailing slash, and query string
      let normalizedUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\?.*$/, '');
      let normalizedPattern = pattern.replace(/^https?:\/\//, '').replace(/\/$/, '');

      // Handle spotify: URI scheme
      if (url.startsWith('spotify:') && pattern.startsWith('spotify:')) {
        normalizedUrl = url;
        normalizedPattern = pattern;
      }

      // Convert glob pattern to regex
      // *.domain.com -> [^/]+\.domain\.com
      // path/* -> path/[^/]+
      // path/*/more -> path/[^/]+/more
      const regexPattern = normalizedPattern
        .replace(/^\*\./g, '__SUBDOMAIN_WILDCARD__') // Temporarily replace *. at start
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars (except *)
        .replace(/__SUBDOMAIN_WILDCARD__/g, '[^/]+\\.') // Restore subdomain wildcard
        .replace(/\*/g, '[^/]+'); // * = any segment

      const regex = new RegExp(`^${regexPattern}$`, 'i');
      return regex.test(normalizedUrl);
    } catch (error) {
      console.error('URL pattern match error:', error);
      return false;
    }
  }

  /**
   * Look up track metadata from a URL
   * @param {string} url - The URL to look up
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<{track: object, resolverId: string}|null>}
   */
  async lookupUrl(url, configOverride = null) {
    const resolverId = this.findResolverForUrl(url);
    if (!resolverId) {
      return null;
    }

    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.lookupUrl) {
      console.error(`Resolver ${resolverId} does not support URL lookup`);
      return null;
    }

    try {
      // Use configOverride if provided, otherwise fall back to resolver.config
      const config = configOverride || resolver.config || {};
      const track = await resolver.lookupUrl(url, config);
      if (track) {
        return { track, resolverId };
      }
    } catch (error) {
      console.error(`URL lookup error for ${resolverId}:`, error);
    }

    return null;
  }

  /**
   * Look up album tracks from a URL
   * @param {string} url - The album URL to look up
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<{album: object, resolverId: string}|null>}
   */
  async lookupAlbum(url, configOverride = null) {
    const resolverId = this.findResolverForUrl(url);
    if (!resolverId) {
      return null;
    }

    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.lookupAlbum) {
      console.error(`Resolver ${resolverId} does not support album lookup`);
      return null;
    }

    try {
      const config = configOverride || resolver.config || {};
      const album = await resolver.lookupAlbum(url, config);
      if (album) {
        return { album, resolverId };
      }
    } catch (error) {
      console.error(`Album lookup error for ${resolverId}:`, error);
    }

    return null;
  }

  /**
   * Look up playlist tracks from a URL
   * @param {string} url - The playlist URL to look up
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<{playlist: object, resolverId: string}|null>}
   */
  async lookupPlaylist(url, configOverride = null) {
    const resolverId = this.findResolverForUrl(url);
    if (!resolverId) {
      return null;
    }

    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.lookupPlaylist) {
      console.error(`Resolver ${resolverId} does not support playlist lookup`);
      return null;
    }

    try {
      const config = configOverride || resolver.config || {};
      const playlist = await resolver.lookupPlaylist(url, config);
      if (playlist) {
        return { playlist, resolverId };
      }
    } catch (error) {
      console.error(`Playlist lookup error for ${resolverId}:`, error);
    }

    return null;
  }

  /**
   * Detect URL type (track, album, or playlist)
   * @param {string} url - The URL to analyze
   * @returns {string} - 'track', 'album', 'playlist', or 'unknown'
   */
  getUrlType(url) {
    // Spotify
    if (url.includes('spotify')) {
      if (url.includes('/album/') || url.includes('spotify:album:')) return 'album';
      if (url.includes('/playlist/') || url.includes('spotify:playlist:')) return 'playlist';
      if (url.includes('/track/') || url.includes('spotify:track:')) return 'track';
    }
    // Apple Music
    if (url.includes('music.apple.com') || url.includes('itunes.apple.com')) {
      if (url.includes('/playlist/')) return 'playlist';
      // Album URLs have ?i= param for specific track, without it's an album
      if (url.includes('/album/')) {
        return url.includes('?i=') ? 'track' : 'album';
      }
      if (url.includes('/song/')) return 'track';
    }
    // YouTube
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      if (url.includes('/playlist?list=') || url.includes('&list=')) return 'playlist';
      return 'track';
    }
    // Bandcamp
    if (url.includes('bandcamp.com')) {
      if (url.includes('/album/')) return 'album';
      if (url.includes('/track/')) return 'track';
    }
    // SoundCloud
    if (url.includes('soundcloud.com')) {
      if (url.includes('/sets/')) return 'playlist';
      // Artist page: soundcloud.com/username (no additional path segments for tracks)
      // Track page: soundcloud.com/username/trackname
      const path = url.replace(/^https?:\/\/(www\.)?soundcloud\.com\/?/, '');
      const segments = path.split('/').filter(s => s && !s.startsWith('?'));
      if (segments.length >= 2) return 'track';
      if (segments.length === 1) return 'artist';
    }
    return 'unknown';
  }
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResolverLoader;
} else if (typeof window !== 'undefined') {
  window.ResolverLoader = ResolverLoader;
}
