/**
 * Parachord Resolver Loader
 * 
 * Loads and instantiates .axe resolver plugins
 */

class ResolverLoader {
  constructor() {
    this.resolvers = new Map();
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

      // Settings
      requiresAuth: settings?.requiresAuth || false,
      authType: settings?.authType || 'none',
      configurable: settings?.configurable || {},

      // State
      enabled: false,
      weight: 0,
      config: {},

      // Implementation
      ...implFunctions,

      // Bind this context to implementation functions
      _bindContext() {
        const self = this;
        for (const key of Object.keys(implFunctions)) {
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
}

// Export for use in main app
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ResolverLoader;
} else if (typeof window !== 'undefined') {
  window.ResolverLoader = ResolverLoader;
}
