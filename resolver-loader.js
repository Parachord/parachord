/**
 * Parachord Resolver Loader
 * 
 * Loads and instantiates .axe resolver plugins
 */

class ResolverLoader {
  constructor() {
    this.resolvers = new Map();
    this.urlPatterns = []; // Array of { pattern: string, resolverId: string }
    // TYPED patterns ("urlTypes" in a manifest): { pattern: string, type:
    // 'track'|'album'|'playlist'|'artist', resolverId: string }, flattened in
    // registration order (the manifest's own key order — most-specific first)
    // and matched by getUrlType first-match-wins over matchUrlPattern — scoped
    // by getUrlType to the resolver findResolverForUrl routes the URL to.
    this.urlTypedPatterns = [];
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

      // Register TYPED patterns ("urlTypes": { "track|album|playlist|artist":
      // [patterns...] }): what getUrlType classifies a matched URL as, as
      // manifest data instead of a per-host switch in this file. The object's
      // key order IS the priority — most-specific first (the Amazon manifest
      // lists "track" before "album" so `albums/*?trackAsin=*` beats
      // `albums/*`; SoundCloud lists "playlist" before "track" before
      // "artist" so the sets/segment patterns win over the one-segment
      // artist pattern). The pattern language is the same matchUrlPattern
      // glob urlPatterns uses (a pattern with `?` matches the query string,
      // the shape that expresses Apple's `?i=` / Amazon's `?trackAsin=` /
      // YouTube's `?list=`). A malformed declaration is no declaration (the
      // urlPatterns rule), never a load failure.
      if (axe.urlTypes && typeof axe.urlTypes === 'object' && !Array.isArray(axe.urlTypes)) {
        let typedCount = 0;
        for (const [type, patterns] of Object.entries(axe.urlTypes)) {
          if (!['track', 'album', 'playlist', 'artist'].includes(type)) {
            console.warn(`⚠️ Unknown urlTypes key "${type}" in resolver ${id} (expected track|album|playlist|artist) — skipped`);
            continue;
          }
          if (!Array.isArray(patterns)) continue;
          for (const pattern of patterns) {
            if (typeof pattern !== 'string' || !pattern) continue;
            this.urlTypedPatterns.push({ pattern, type, resolverId: id });
            typedCount += 1;
          }
        }
        if (typedCount) console.log(`  🎯 Registered ${typedCount} typed URL pattern(s) for ${id}`);
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
    const settled = await Promise.allSettled(
      axeContents.map(axeContent => this.loadResolver(axeContent))
    );
    return settled
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);
  }

  /**
   * Create a resolver instance from .axe data
   */
  createResolverInstance(axe) {
    const { manifest, capabilities, settings } = axe;

    // The plugin library (#1356): implementation._lib is not a method — it
    // is a FACTORY, materialized and invoked exactly once per resolver
    // instance, whose return value every implementation function sees as
    // `this.lib`. It is the one shared scope a plugin gets: a helper two
    // functions need is defined once in the factory instead of copy-pasted
    // into each (the confidence gate is duplicated across four shipped
    // plugins today).
    //
    // Purity contract (the later whole-module migration depends on it): the
    // factory returns HELPERS AND CONSTANTS ONLY — functions and immutable
    // values, no I/O, no timers, no window/globalThis access, no mutable
    // state. Per-instance state (a request-template cache, a breaker) lives
    // on `this` (the resolver instance — shared by every method since
    // _bindContext below, fresh per loaded instance). The factory runs for
    // EVERY instance — including disabled plugins and every hot reload — so
    // any side effect in it runs far more often than anyone expects.
    //
    // A malformed or failing library FAILS THE LOAD (like a malformed
    // manifest), never a null this.lib: a plugin whose every method sits on
    // the library would otherwise look enabled and throw on every call.
    const { _lib: libSource, ...methods } = axe.implementation || {};
    let pluginLib = null;
    if (libSource !== undefined) {
      if (typeof libSource !== 'string') {
        throw new Error(`implementation._lib for ${manifest.id} must be serialized function source (a String(fn) of the factory)`);
      }
      const libFactory = new Function('return ' + libSource)();
      if (typeof libFactory !== 'function') {
        throw new Error(`implementation._lib for ${manifest.id} must be a function`);
      }
      pluginLib = libFactory();
      if (!pluginLib || typeof pluginLib !== 'object') {
        throw new Error(`implementation._lib for ${manifest.id} must return the library (an object)`);
      }
    }

    // Create implementation functions (methods is always at least {} here —
    // the destructured rest of a defaulted object).
    const implFunctions = {};

    // Convert string implementations to actual functions
    for (const [key, fnString] of Object.entries(methods)) {
      try {
        // Create function from string
        const fn = new Function('return ' + fnString)();
        implFunctions[key] = fn;
      } catch (error) {
        console.error(`Failed to create function ${key} for ${manifest.id}:`, error);
        implFunctions[key] = async () => {
          throw new Error(`Function ${key} not implemented`);
        };
      }
    }

    // Filter implementation functions to prevent prototype pollution
    const RESERVED_KEYS = new Set([
      '__proto__', 'constructor', 'prototype',
      'id', 'name', 'version', 'author', 'description', 'icon', 'color',
      'homepage', 'email', 'capabilities', 'urlPatterns', 'embedPlayer',
      // The typed URL patterns (#1356 M11): the resolver field urlTypes, like
      // urlPatterns — an implementation method of this name would clobber it.
      'urlTypes',
      'requiresAuth', 'authType', 'configurable', 'enabled', 'weight', 'config',
      '_bindContext',
      // The plugin library and its reserved name (#1356): `lib` is the
      // once-evaluated factory result the loader injects; a method named
      // `lib` (or `_lib`) would clobber it, so neither may be a method.
      'lib', '_lib'
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
      // What the plug-in needs to work ("Spotify Premium, …", "Works right
      // away"), one sentence from manifest.requirement; shown in the
      // plug-in's panel. null when the manifest has none.
      requirement: typeof manifest.requirement === 'string' && manifest.requirement.trim() ? manifest.requirement.trim() : null,
      homepage: manifest.homepage,
      email: manifest.email,

      // Capabilities
      capabilities: capabilities || {},
      // URL patterns for URL lookup
      urlPatterns: axe.urlPatterns || [],
      // Typed URL patterns for getUrlType (manifest "urlTypes") — null when
      // the plugin declares none (its matched URLs classify as 'unknown').
      urlTypes: (axe.urlTypes && typeof axe.urlTypes === 'object' && !Array.isArray(axe.urlTypes)) ? axe.urlTypes : null,
      // Embedded player (capabilities.embedPlayer): which host adapter plays
      // it. Kept outside `capabilities`, whose values every client (Android
      // and iOS decode a Map<String, Boolean>) reads as booleans.
      embedPlayer: axe.embedPlayer && typeof axe.embedPlayer === 'object' ? { ...axe.embedPlayer } : null,

      // Settings
      requiresAuth: settings?.requiresAuth || false,
      authType: settings?.authType || 'none',
      configurable: settings?.configurable || {},

      // State
      enabled: false,
      weight: 0,
      config: {},

      // The plugin library (#1356): implementation._lib's factory result,
      // evaluated once above. Methods reach it as this.lib; null when the
      // plugin ships no _lib (a factory that fails fails the load above).
      // FROZEN, which enforces the purity contract: the library is helpers
      // and constants, and state belongs on `this` — an assignment to
      // this.lib.x does not stick (silently, in sloppy mode — a plugin that
      // tries will find its state missing, which the tests document).
      lib: pluginLib ? Object.freeze(pluginLib) : null,

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
    this.urlTypedPatterns = this.urlTypedPatterns.filter(p => p.resolverId !== id);
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
   * A trailing * matches one or more path segments (greedy)
   */
  matchUrlPattern(url, pattern) {
    try {
      // Normalize URL - remove protocol and trailing slash
      // Only strip query string if the pattern doesn't use query params (e.g. YouTube watch?v=*)
      let normalizedUrl = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      let normalizedPattern = pattern.replace(/^https?:\/\//, '').replace(/\/$/, '');
      if (!normalizedPattern.includes('?')) {
        normalizedUrl = normalizedUrl.replace(/\?.*$/, '');
      }

      // Handle spotify: URI scheme
      if (url.startsWith('spotify:') && pattern.startsWith('spotify:')) {
        normalizedUrl = url;
        normalizedPattern = pattern;
      }

      // Check if pattern ends with a wildcard (trailing * should match rest of path)
      const endsWithWildcard = normalizedPattern.endsWith('*') && !normalizedPattern.endsWith('\\*');

      // Convert glob pattern to regex
      // *.domain.com -> [^/]+\.domain\.com
      // path/*/more -> path/[^/]+/more (middle * = single segment)
      // path/* -> path/.+ (trailing * = rest of path, greedy)
      let regexPattern = normalizedPattern
        .replace(/^\*\./g, '__SUBDOMAIN_WILDCARD__') // Temporarily replace *. at start
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // Escape regex special chars (except *)
        .replace(/__SUBDOMAIN_WILDCARD__/g, '[^/]+\\.'); // Restore subdomain wildcard

      if (endsWithWildcard) {
        // Replace all * except the last one with single-segment match
        // Then replace the last * with greedy match (any chars including /)
        const lastStarIdx = regexPattern.lastIndexOf('*');
        const before = regexPattern.substring(0, lastStarIdx).replace(/\*/g, '[^/]+');
        regexPattern = before + '.+';
      } else {
        regexPattern = regexPattern.replace(/\*/g, '[^/]+'); // * = any single segment
      }

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
   * Resolvers that can find an album by artist and title: they declare
   * capabilities.albumSearch and implement searchAlbums and lookupAlbum
   * (docs/architecture/plugins.md, "searchAlbums"). The album pages use them
   * when MusicBrainz cannot supply a track list.
   * @returns {object[]}
   */
  getAlbumSearchResolvers() {
    return this.getAllResolvers().filter(r =>
      r.capabilities?.albumSearch &&
      typeof r.searchAlbums === 'function' &&
      typeof r.lookupAlbum === 'function'
    );
  }

  /**
   * Search one resolver's albums.
   * @param {string} resolverId
   * @param {{artist?: string, title?: string}|string} query
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<object[]>} albums ({ id, name, artist, albumArt, releaseDate, trackCount, url });
   *          [] on a miss. REJECTS when the plugin's search throws — a
   *          caller that distinguishes a miss from a failure (the album
   *          page's edition picker retries the failed services) needs that;
   *          every caller today catches and continues.
   */
  async searchAlbums(resolverId, query, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.albumSearch || typeof resolver.searchAlbums !== 'function') {
      return [];
    }
    try {
      const albums = await resolver.searchAlbums(query, configOverride || resolver.config || {});
      return Array.isArray(albums) ? albums.filter(a => a && a.name && a.url) : [];
    } catch (error) {
      console.error(`Album search error for ${resolverId}:`, error);
      throw error;
    }
  }

  /**
   * Resolvers and meta-services that provide recommendations for the
   * Recommendations page: they declare capabilities.recommendations and
   * implement getRecommendations (docs/architecture/plugins.md,
   * "Recommendations"). A meta-service is only materialized into the loader
   * when it passes this capability's gate (app.js initResolvers), so the
   * filter is complete for both kinds.
   * @returns {object[]}
   */
  getRecommendationResolvers() {
    return this.getAllResolvers().filter(r =>
      r.capabilities?.recommendations &&
      typeof r.getRecommendations === 'function'
    );
  }

  /**
   * Ask one provider for its recommendation sections.
   * @param {string} resolverId
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<object[]>} sections ({ id: string|null, title: string|null,
   *          description, items: [{ type, id, name, artist?, imageUrl?, url?,
   *          reason?, duration? }] }); [] when the provider has nothing.
   *          REJECTS when the plugin's call throws — the Recommendations page
   *          catches per provider and keeps the rest.
   */
  async getRecommendations(resolverId, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.recommendations || typeof resolver.getRecommendations !== 'function') {
      return [];
    }
    try {
      const result = await resolver.getRecommendations(configOverride || resolver.config || {});
      const sections = result && Array.isArray(result.sections) ? result.sections : [];
      return sections.filter(s => s && Array.isArray(s.items));
    } catch (error) {
      console.error(`Recommendations error for ${resolverId}:`, error);
      throw error;
    }
  }

  /**
   * Resolvers and meta-services that make mixes from the user's own
   * listening (Heavy Rotation, Daily Jams, ...), for Home's "Made from your
   * listening" row: they declare capabilities.historyMixes and implement
   * getHistoryMixes (docs/architecture/plugins.md, "History mixes"). A
   * marketplace install can be older than the app, so the method is checked,
   * not just the flag. Meta-services pass the same app.js initResolvers gate
   * as recommendations.
   * @returns {object[]}
   */
  getHistoryMixResolvers() {
    return this.getAllResolvers().filter(r =>
      r.capabilities?.historyMixes &&
      typeof r.getHistoryMixes === 'function'
    );
  }

  /**
   * Ask one provider for its history mixes.
   * @param {string} resolverId
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<object[]>} [{ type: 'playlist', id, name, description?,
   *          imageUrl?, url }]; [] when the provider lacks the capability or
   *          answers without a `mixes` array (entries that aren't objects are
   *          dropped). REJECTS when the plugin throws, so the app keeps its
   *          cached mixes instead of caching an outage as "no mixes".
   */
  async getHistoryMixes(resolverId, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.historyMixes || typeof resolver.getHistoryMixes !== 'function') {
      return [];
    }
    try {
      const result = await resolver.getHistoryMixes(configOverride || resolver.config || {});
      const mixes = result && Array.isArray(result.mixes) ? result.mixes : [];
      return mixes.filter(m => m && typeof m === 'object');
    } catch (error) {
      // The message only: a config can carry a token.
      console.error(`History mixes error for ${resolverId}:`, error?.message || error);
      throw error;
    }
  }

  /**
   * Resolvers and meta-services that know listeners with similar taste, for
   * the Recommendations page's Friends row: they declare
   * capabilities.similarUsers and implement getSimilarUsers. A marketplace
   * install can be older than the app, so the method is checked, not just the
   * flag. Meta-services pass the same app.js initResolvers gate as
   * recommendations.
   * @returns {object[]}
   */
  getSimilarUsersResolvers() {
    return this.getAllResolvers().filter(r =>
      r.capabilities?.similarUsers &&
      typeof r.getSimilarUsers === 'function'
    );
  }

  /**
   * Ask one provider for its similar users.
   * @param {string} resolverId
   * @param {object} configOverride - the provider's config, plus
   *        excludeUsernames (people the user follows or removed there)
   * @returns {Promise<object[]>} [{ username, similarity, avatarUrl? }]; []
   *          when the provider lacks the capability or answers a non-array.
   *          REJECTS when the plugin throws, so the page keeps what it has
   *          instead of caching an outage as "nobody".
   */
  async getSimilarUsers(resolverId, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.similarUsers || typeof resolver.getSimilarUsers !== 'function') {
      return [];
    }
    try {
      const users = await resolver.getSimilarUsers(configOverride || resolver.config || {});
      return Array.isArray(users) ? users : [];
    } catch (error) {
      // The message only: a config can carry an API key.
      console.error(`Similar users error for ${resolverId}:`, error?.message || error);
      throw error;
    }
  }

  /**
   * Ask one provider for the next page of an expandable recommendation
   * section (the provider's expandRecommendationSection). Providers that do
   * not paginate do not implement it and answer null.
   * @param {string} resolverId
   * @param {string} sectionId - the provider's own section id (section.id)
   * @param {string|null} afterCursor - the cursor the last page returned
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<{items: object[], nextCursor: string|null}|null>}
   */
  async expandRecommendationSection(resolverId, sectionId, afterCursor = null, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.recommendations || typeof resolver.expandRecommendationSection !== 'function' || !sectionId) {
      return null;
    }
    try {
      const result = await resolver.expandRecommendationSection(sectionId, afterCursor, configOverride || resolver.config || {});
      if (!result || !Array.isArray(result.items)) return null;
      return { items: result.items, nextCursor: result.nextCursor || null };
    } catch (error) {
      console.error(`Recommendation section expansion error for ${resolverId}:`, error);
      throw error;
    }
  }

  /**
   * Resolvers that can find a photo of an artist by name: they declare
   * capabilities.artistImage and implement searchArtistImage
   * (docs/architecture/plugins.md, "searchArtistImage"). getArtistImage asks
   * the user's active ones after Spotify and Apple Music.
   * @returns {object[]}
   */
  getArtistImageResolvers() {
    return this.getAllResolvers().filter(r =>
      r.capabilities?.artistImage &&
      typeof r.searchArtistImage === 'function'
    );
  }

  /**
   * Ask one resolver for an artist photo.
   * @param {string} resolverId
   * @param {string} artistName
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<string|null>} an image URL; null on a miss or error
   */
  async searchArtistImage(resolverId, artistName, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.artistImage || typeof resolver.searchArtistImage !== 'function' || !artistName) {
      return null;
    }
    try {
      const url = await resolver.searchArtistImage(artistName, configOverride || resolver.config || {});
      return typeof url === 'string' && url ? url : null;
    } catch (error) {
      console.error(`Artist image error for ${resolverId}:`, error);
      return null;
    }
  }

  /**
   * Resolvers that can report their own sign-in and playback-limit state to
   * the app: they declare capabilities.status and implement getStatus
   * (docs/architecture/plugins.md, "Status and playback limits"). A
   * marketplace install can be older than the app, so the method is checked,
   * not just the flag.
   * @returns {object[]}
   */
  getStatusResolvers() {
    return this.getAllResolvers().filter(r =>
      r.capabilities?.status &&
      typeof r.getStatus === 'function'
    );
  }

  /**
   * A status read gets this long, in the spirit of RESOLVE_BUDGET_MS
   * (resolver-limiter.js): a getStatus can be a network call, and the app
   * reads every status-capable plugin in one batch (refreshPluginStatuses),
   * so one read that never settles would stall the whole sweep — the batch
   * never lands, and every id in it stays "in flight", skipped by every
   * later read. Past the budget the read answers the failed marker below,
   * the same "no verdict" every other status failure maps to.
   */
  static STATUS_BUDGET_MS = 8000;

  // What a failed status read answers: the plugin threw, answered nothing
  // object-shaped, or ran past STATUS_BUDGET_MS. The limit map reads it as
  // no verdict (lib/playback-limits.js pluginStatusLimit — the marker carries
  // no playbackLimit), and the Settings row reads it as "couldn't check"
  // (pluginStatusRow) instead of "Checking…" forever. Frozen: one shared
  // object, never mistaken for a plugin's own reply.
  static STATUS_READ_FAILED = Object.freeze({ failed: true });

  /**
   * Ask one resolver for its status.
   * @param {string} resolverId
   * @param {object} configOverride - Optional config to override resolver's stored config
   * @returns {Promise<object|null>} the plugin's reply — { signedIn: boolean|null,
   *          playbackLimit: { blocked, planKey, label, message, searchesHeldBack }|null,
   *          statusLabel: string|null, statusMessage: string|null } (docs/
   *          architecture/plugins.md, "Status and playback limits") — or
   *          STATUS_READ_FAILED when the read happened but yielded no reply:
   *          the plugin threw (logged here — this is the one accessor that
   *          swallows a plugin error on purpose), answered nothing
   *          object-shaped, or ran past STATUS_BUDGET_MS. A status outage
   *          must not read as a blocked resolver and unplug playback, and
   *          "unknown" is the safe reading for every consumer (lib/
   *          playback-limits.js maps the reply and drops a missing one), so
   *          no caller ever needs to tell a miss from a failure — which is
   *          what every other accessor rejects for. Null is only for a
   *          resolver that was never asked (no such resolver, or it lacks
   *          the capability).
   */
  async getStatus(resolverId, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || !resolver.capabilities?.status || typeof resolver.getStatus !== 'function') {
      return null;
    }
    // The budget races the call: a hung getStatus settles the race (the
    // call itself keeps running — a promise can't be cancelled — but its
    // answer, whenever it lands, is dropped).
    let timer = null;
    const budget = new Promise((resolve) => {
      timer = setTimeout(() => resolve(ResolverLoader.STATUS_READ_FAILED), ResolverLoader.STATUS_BUDGET_MS);
      if (timer && typeof timer.unref === 'function') timer.unref();
    });
    try {
      const status = await Promise.race([
        Promise.resolve().then(() => resolver.getStatus(configOverride || resolver.config || {})),
        budget
      ]);
      return status && typeof status === 'object' ? status : ResolverLoader.STATUS_READ_FAILED;
    } catch (error) {
      // The message only: a config can carry a token.
      console.error(`Status error for ${resolverId}:`, error?.message || error);
      return ResolverLoader.STATUS_READ_FAILED;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Load an album that searchAlbums returned, from the resolver that returned
   * it. Not routed by URL pattern: an album url can be private to its plugin
   * (subsonic:album:<id>, localfiles:album:...) and match no urlPatterns.
   * @returns {Promise<{album: object, resolverId: string}|null>}
   */
  async lookupAlbumFrom(resolverId, url, configOverride = null) {
    const resolver = this.resolvers.get(resolverId);
    if (!resolver || typeof resolver.lookupAlbum !== 'function' || !url) return null;
    try {
      const album = await resolver.lookupAlbum(url, configOverride || resolver.config || {});
      if (album && Array.isArray(album.tracks) && album.tracks.length > 0) {
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
      throw error;
    }

    return null;
  }

  /**
   * Detect URL type (track, album, playlist, or artist) — MANIFEST DATA
   * (#1356 M11): a plugin's "urlTypes" declaration (see loadResolver), the
   * per-service arms this method used to hardcode. SCOPED TO THE ROUTED
   * RESOLVER (#1441 review, note 2): findResolverForUrl(url) picks the
   * resolver first, then only THAT resolver's typed patterns classify — the
   * type can never disagree with the routing (a broad typed pattern in a
   * plugin loaded earlier classifies only its own resolver's URLs). Within
   * the routed resolver, first-match-wins over its registered patterns in
   * registration order — a manifest lists its most-specific patterns first
   * (Amazon's `albums/*?trackAsin=*` before `albums/*`; YouTube's
   * `watch?v=*&list=*` before `watch?v=*`; SoundCloud's sets pattern before
   * its two-segment track pattern before its one-segment artist pattern).
   * The pattern language is matchUrlPattern's glob: a pattern containing `?`
   * matches the query string, which is how the query-param cases are
   * expressed — Apple's `?i=` and Amazon's `?trackAsin=` (one track of the
   * album, never the album) and YouTube's `&list=` (a video in a playlist).
   * A URL no resolver routes, or one whose resolver declares no typed
   * patterns (or matches none of them), is 'unknown'. Note the glob's
   * exactness bounds, inherited from urlPatterns: a query-param pattern
   * matches the param in the position the pattern spells — a service whose
   * share links put the param after other params declares each position its
   * own pattern (Amazon carries both `albums/*?trackAsin=*` and
   * `albums/*?*trackAsin=`, the `?ref=dm_sh&trackAsin=` song-share shape,
   * both listed before its album pattern) — and the host must be spelled as
   * the pattern spells it (no implicit www./m. aliases — urlPatterns routing
   * never accepted those either, so a host-shape typed miss is a URL no
   * resolver was found for in the first place).
   * @param {string} url - The URL to analyze
   * @returns {string} - 'track', 'album', 'playlist', 'artist', or 'unknown'
   */
  getUrlType(url) {
    const routedTo = this.findResolverForUrl(url);
    if (!routedTo) return 'unknown';
    for (const { pattern, type, resolverId } of this.urlTypedPatterns) {
      if (resolverId !== routedTo) continue;
      if (this.matchUrlPattern(url, pattern)) return type;
    }
    // Plex (app.plex.tv share links). Album and track links share the same
    // /library/metadata/<key> shape and can't be told apart from the URL, so
    // only playlists are classified here; everything else goes through the
    // single-track lookup, and the Plex resolver's lookupUrl answers an album
    // key with the album (its result carries `tracks`).
    if (url.includes('plex.tv')) {
      if (url.includes('/playlists/') || url.includes('%2Fplaylists%2F') || url.includes('/playlist?')) {
        return 'playlist';
      }
      return 'track';
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
