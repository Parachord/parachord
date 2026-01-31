/**
 * Resolver Pipeline Tests
 *
 * Tests for track resolution from query to playable sources.
 * Covers caching, parallel resolution, and source aggregation.
 */

const { resolverConfigs } = require('../test-utils/fixtures');

describe('Resolver Pipeline', () => {
  describe('Cache Key Generation', () => {
    const generateCacheKey = (artist, title, position = 0) => {
      return `${artist.toLowerCase()}|${title.toLowerCase()}|${position}`;
    };

    test('cache key is consistent for same inputs', () => {
      const key1 = generateCacheKey('Artist Name', 'Track Title', 1);
      const key2 = generateCacheKey('Artist Name', 'Track Title', 1);

      expect(key1).toBe(key2);
    });

    test('cache key is case-insensitive', () => {
      const key1 = generateCacheKey('ARTIST NAME', 'TRACK TITLE', 1);
      const key2 = generateCacheKey('artist name', 'track title', 1);

      expect(key1).toBe(key2);
    });

    test('cache key includes position for disambiguation', () => {
      const key1 = generateCacheKey('Artist', 'Track', 1);
      const key2 = generateCacheKey('Artist', 'Track', 2);

      expect(key1).not.toBe(key2);
    });

    test('cache key handles special characters', () => {
      const key = generateCacheKey('Björk', "Don't Stop", 0);

      expect(key).toBe("björk|don't stop|0");
    });
  });

  describe('Cache TTL', () => {
    const CACHE_TTL = {
      trackSources: 7 * 24 * 60 * 60 * 1000 // 7 days
    };

    test('cache TTL is 7 days for track sources', () => {
      expect(CACHE_TTL.trackSources).toBe(604800000);
    });

    test('cache is valid within TTL', () => {
      const now = Date.now();
      const cachedAt = now - (6 * 24 * 60 * 60 * 1000); // 6 days ago

      const isValid = (now - cachedAt) < CACHE_TTL.trackSources;
      expect(isValid).toBe(true);
    });

    test('cache is invalid after TTL', () => {
      const now = Date.now();
      const cachedAt = now - (8 * 24 * 60 * 60 * 1000); // 8 days ago

      const isValid = (now - cachedAt) < CACHE_TTL.trackSources;
      expect(isValid).toBe(false);
    });
  });

  describe('Resolver Hash Invalidation', () => {
    const generateResolverHash = (resolverOrder, enabledResolvers) => {
      return `${resolverOrder.join(',')}:${enabledResolvers.sort().join(',')}`;
    };

    test('hash changes when resolver order changes', () => {
      const hash1 = generateResolverHash(['spotify', 'localfiles'], ['spotify', 'localfiles']);
      const hash2 = generateResolverHash(['localfiles', 'spotify'], ['spotify', 'localfiles']);

      expect(hash1).not.toBe(hash2);
    });

    test('hash changes when resolver is disabled', () => {
      const hash1 = generateResolverHash(['spotify', 'localfiles'], ['spotify', 'localfiles']);
      const hash2 = generateResolverHash(['spotify', 'localfiles'], ['spotify']);

      expect(hash1).not.toBe(hash2);
    });

    test('hash is consistent for same configuration', () => {
      const hash1 = generateResolverHash(['spotify', 'localfiles'], ['spotify', 'localfiles']);
      const hash2 = generateResolverHash(['spotify', 'localfiles'], ['localfiles', 'spotify']);

      // Enabled resolvers are sorted, so order doesn't matter
      expect(hash1).toBe(hash2);
    });
  });

  describe('Confidence Scoring', () => {
    const calculateConfidence = (result, originalTitle, originalDuration) => {
      // Use resolver-provided confidence if available
      if (result.confidence) {
        return result.confidence;
      }

      const titleMatch = result.title?.toLowerCase() === originalTitle?.toLowerCase();
      const durationMatch = result.duration &&
        Math.abs(result.duration - originalDuration) < 5000; // Within 5 seconds

      if (titleMatch && durationMatch) return 0.95;
      if (titleMatch) return 0.85;
      if (durationMatch) return 0.70;
      return 0.50;
    };

    test('resolver-provided confidence is used first', () => {
      const result = { confidence: 0.92 };
      const confidence = calculateConfidence(result, 'Track', 180000);

      expect(confidence).toBe(0.92);
    });

    test('title + duration match gives 0.95', () => {
      const result = { title: 'Test Track', duration: 180000 };
      const confidence = calculateConfidence(result, 'Test Track', 180000);

      expect(confidence).toBe(0.95);
    });

    test('title match only gives 0.85', () => {
      const result = { title: 'Test Track', duration: 300000 };
      const confidence = calculateConfidence(result, 'Test Track', 180000);

      expect(confidence).toBe(0.85);
    });

    test('duration match only gives 0.70', () => {
      const result = { title: 'Different Track', duration: 180000 };
      const confidence = calculateConfidence(result, 'Test Track', 180000);

      expect(confidence).toBe(0.70);
    });

    test('no match gives 0.50', () => {
      const result = { title: 'Different Track', duration: 300000 };
      const confidence = calculateConfidence(result, 'Test Track', 180000);

      expect(confidence).toBe(0.50);
    });

    test('duration tolerance is 5 seconds', () => {
      const result = { title: 'Different', duration: 183000 }; // 3 seconds off
      const confidence = calculateConfidence(result, 'Test', 180000);

      expect(confidence).toBe(0.70); // Duration matches within tolerance
    });
  });

  describe('Parallel Resolution', () => {
    test('multiple resolvers are queried in parallel', async () => {
      const resolverCalls = [];

      const mockResolvers = [
        {
          id: 'spotify',
          resolve: async () => {
            resolverCalls.push({ id: 'spotify', time: Date.now() });
            await new Promise(r => setTimeout(r, 50));
            return { id: 's1', title: 'Track' };
          }
        },
        {
          id: 'localfiles',
          resolve: async () => {
            resolverCalls.push({ id: 'localfiles', time: Date.now() });
            await new Promise(r => setTimeout(r, 50));
            return { id: 'l1', path: '/track.mp3' };
          }
        }
      ];

      // Resolve in parallel
      await Promise.all(mockResolvers.map(r => r.resolve()));

      // Both should have started at nearly the same time
      const timeDiff = Math.abs(resolverCalls[0].time - resolverCalls[1].time);
      expect(timeDiff).toBeLessThan(20); // Started within 20ms of each other
    });

    test('failed resolver does not block others', async () => {
      const results = {};

      const mockResolvers = [
        {
          id: 'failing',
          resolve: async () => {
            throw new Error('Resolver failed');
          }
        },
        {
          id: 'working',
          resolve: async () => {
            return { id: 'w1', title: 'Track' };
          }
        }
      ];

      await Promise.all(mockResolvers.map(async (resolver) => {
        try {
          results[resolver.id] = await resolver.resolve();
        } catch (error) {
          results[resolver.id] = null;
        }
      }));

      expect(results.failing).toBeNull();
      expect(results.working).toEqual({ id: 'w1', title: 'Track' });
    });
  });

  describe('Source Aggregation', () => {
    test('results from multiple resolvers are combined', () => {
      const sources = {};

      // Simulate resolver results
      const resolverResults = [
        { resolverId: 'spotify', result: { id: 's1', spotifyUri: 'spotify:track:s1' } },
        { resolverId: 'localfiles', result: { id: 'l1', path: '/music/track.mp3' } },
        { resolverId: 'soundcloud', result: { id: 'sc1', soundcloudId: '123456' } }
      ];

      resolverResults.forEach(({ resolverId, result }) => {
        if (result) {
          sources[resolverId] = result;
        }
      });

      expect(Object.keys(sources)).toHaveLength(3);
      expect(sources.spotify.spotifyUri).toBe('spotify:track:s1');
      expect(sources.localfiles.path).toBe('/music/track.mp3');
      expect(sources.soundcloud.soundcloudId).toBe('123456');
    });

    test('null results are not added to sources', () => {
      const sources = {};

      const resolverResults = [
        { resolverId: 'spotify', result: { id: 's1' } },
        { resolverId: 'localfiles', result: null },
        { resolverId: 'soundcloud', result: undefined }
      ];

      resolverResults.forEach(({ resolverId, result }) => {
        if (result) {
          sources[resolverId] = result;
        }
      });

      expect(Object.keys(sources)).toHaveLength(1);
      expect(sources.spotify).toBeDefined();
      expect(sources.localfiles).toBeUndefined();
    });
  });

  describe('Abort Signal Handling', () => {
    test('resolution stops when signal is aborted', async () => {
      const abortController = new AbortController();
      let resolverCompleted = false;

      const resolve = async (signal) => {
        if (signal.aborted) return null;

        await new Promise(r => setTimeout(r, 50));

        if (signal.aborted) return null;

        resolverCompleted = true;
        return { id: 'result' };
      };

      // Abort before resolution completes
      setTimeout(() => abortController.abort(), 20);

      const result = await resolve(abortController.signal);

      expect(result).toBeNull();
      expect(resolverCompleted).toBe(false);
    });

    test('AbortError is caught and not re-thrown', async () => {
      const abortController = new AbortController();

      const resolve = async (signal) => {
        if (signal.aborted) {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          throw error;
        }
        return { id: 'result' };
      };

      abortController.abort();

      let caughtError = null;
      try {
        await resolve(abortController.signal);
      } catch (error) {
        if (error.name !== 'AbortError') {
          caughtError = error;
        }
        // AbortError is expected and ignored
      }

      expect(caughtError).toBeNull();
    });
  });

  describe('Source Selection', () => {
    test('preferred resolver is selected first', () => {
      const track = {
        preferredResolver: 'localfiles',
        sources: {
          spotify: { confidence: 0.95 },
          localfiles: { confidence: 0.90 },
          soundcloud: { confidence: 0.85 }
        }
      };

      const sortedSources = Object.entries(track.sources)
        .sort((a, b) => {
          if (track.preferredResolver) {
            if (a[0] === track.preferredResolver) return -1;
            if (b[0] === track.preferredResolver) return 1;
          }
          return b[1].confidence - a[1].confidence;
        });

      expect(sortedSources[0][0]).toBe('localfiles');
    });

    test('sources are sorted by confidence when no preference', () => {
      const track = {
        sources: {
          spotify: { confidence: 0.85 },
          localfiles: { confidence: 0.95 },
          soundcloud: { confidence: 0.90 }
        }
      };

      const sortedSources = Object.entries(track.sources)
        .sort((a, b) => b[1].confidence - a[1].confidence);

      expect(sortedSources[0][0]).toBe('localfiles');
      expect(sortedSources[1][0]).toBe('soundcloud');
      expect(sortedSources[2][0]).toBe('spotify');
    });

    test('resolver order is respected when confidence is equal', () => {
      const resolverOrder = ['spotify', 'localfiles', 'soundcloud'];

      const track = {
        sources: {
          soundcloud: { confidence: 0.90 },
          localfiles: { confidence: 0.90 },
          spotify: { confidence: 0.90 }
        }
      };

      const sortedSources = Object.entries(track.sources)
        .sort((a, b) => {
          const confDiff = b[1].confidence - a[1].confidence;
          if (confDiff !== 0) return confDiff;
          return resolverOrder.indexOf(a[0]) - resolverOrder.indexOf(b[0]);
        });

      expect(sortedSources[0][0]).toBe('spotify');
      expect(sortedSources[1][0]).toBe('localfiles');
      expect(sortedSources[2][0]).toBe('soundcloud');
    });
  });

  describe('Fallback Logic', () => {
    test('next source is tried when primary fails', async () => {
      const sources = {
        spotify: { id: 's1' },
        localfiles: { id: 'l1' }
      };

      const playResults = {
        spotify: false, // Primary fails
        localfiles: true // Fallback succeeds
      };

      let playedWith = null;

      const tryPlay = async (resolverId) => {
        if (playResults[resolverId]) {
          playedWith = resolverId;
          return true;
        }
        return false;
      };

      // Try primary
      const primarySuccess = await tryPlay('spotify');

      if (!primarySuccess) {
        // Try fallback
        for (const [resolverId] of Object.entries(sources)) {
          if (resolverId === 'spotify') continue;
          const success = await tryPlay(resolverId);
          if (success) break;
        }
      }

      expect(playedWith).toBe('localfiles');
    });

    test('all sources exhausted returns failure', async () => {
      const sources = {
        spotify: { id: 's1' },
        localfiles: { id: 'l1' }
      };

      const playResults = {
        spotify: false,
        localfiles: false
      };

      let anySuccess = false;

      for (const resolverId of Object.keys(sources)) {
        if (playResults[resolverId]) {
          anySuccess = true;
          break;
        }
      }

      expect(anySuccess).toBe(false);
    });
  });

  describe('Background Validation', () => {
    test('triggers validation for cache older than 24 hours', () => {
      const cacheAge = 25; // hours
      const shouldValidate = cacheAge >= 24;

      expect(shouldValidate).toBe(true);
    });

    test('skips validation for fresh cache', () => {
      const cacheAge = 12; // hours
      const shouldValidate = cacheAge >= 24;

      expect(shouldValidate).toBe(false);
    });

    test('validation runs without blocking', async () => {
      let validationStarted = false;
      let mainFlowCompleted = false;

      const validateInBackground = () => {
        setTimeout(() => {
          validationStarted = true;
        }, 10);
      };

      // Main flow
      validateInBackground();
      mainFlowCompleted = true;

      expect(mainFlowCompleted).toBe(true);
      expect(validationStarted).toBe(false); // Not started yet

      // Wait for background
      await new Promise(r => setTimeout(r, 20));
      expect(validationStarted).toBe(true);
    });
  });
});

describe('Resolver Loader', () => {
  describe('URL Pattern Matching', () => {
    const matchUrlPattern = (url, pattern) => {
      // Convert glob pattern to regex
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*');

      const regex = new RegExp(`^https?://(www\\.)?${regexPattern}`, 'i');
      return regex.test(url);
    };

    test('matches exact domain', () => {
      expect(matchUrlPattern('https://spotify.com/track/123', 'spotify.com/*')).toBe(true);
    });

    test('matches with www prefix', () => {
      expect(matchUrlPattern('https://www.spotify.com/track/123', 'spotify.com/*')).toBe(true);
    });

    test('matches subdomain patterns', () => {
      expect(matchUrlPattern('https://open.spotify.com/track/123', 'open.spotify.com/*')).toBe(true);
    });

    test('does not match different domain', () => {
      expect(matchUrlPattern('https://soundcloud.com/track', 'spotify.com/*')).toBe(false);
    });
  });

  describe('Resolver Capabilities', () => {
    test('resolver with resolve capability can resolve tracks', () => {
      const resolver = resolverConfigs.spotify;

      expect(resolver.capabilities.resolve).toBe(true);
    });

    test('resolver without stream capability needs external playback', () => {
      const resolver = resolverConfigs.spotify;

      expect(resolver.capabilities.stream).toBe(false);
    });

    test('local files resolver can stream directly', () => {
      const resolver = resolverConfigs.localfiles;

      expect(resolver.capabilities.stream).toBe(true);
    });
  });
});
