const ResolverService = require('../services/resolver-service');

// Mock store
function createMockStore() {
  const data = new Map();
  return {
    get: (key, def) => data.has(key) ? data.get(key) : def,
    set: (key, val) => data.set(key, val),
    delete: (key) => data.delete(key),
    has: (key) => data.has(key)
  };
}

// Mock WS manager
function createMockWSManager() {
  return {
    broadcast: jest.fn(),
    send: jest.fn(),
    on: jest.fn(),
    off: jest.fn()
  };
}

describe('ResolverService', () => {
  let service;
  let store;
  let wsManager;

  beforeEach(() => {
    store = createMockStore();
    wsManager = createMockWSManager();
    // Use the real bundled plugins directory
    service = new ResolverService(store, wsManager, [
      require('path').resolve(__dirname, '../../plugins')
    ]);
  });

  test('loadPlugins loads .axe files from plugin directory', async () => {
    await service.loadPlugins();
    const resolvers = service.getAllResolvers();
    expect(resolvers.length).toBeGreaterThan(0);
    expect(resolvers[0]).toHaveProperty('id');
    expect(resolvers[0]).toHaveProperty('name');
  });

  test('getAllResolvers returns serializable resolver list', async () => {
    await service.loadPlugins();
    const resolvers = service.getAllResolvers();

    for (const r of resolvers) {
      expect(r).toHaveProperty('id');
      expect(r).toHaveProperty('name');
      expect(r).toHaveProperty('enabled');
      // Should NOT include implementation functions
      expect(r.search).toBeUndefined();
      expect(r.resolve).toBeUndefined();
    }
  });

  test('setEnabled updates resolver state and persists', async () => {
    await service.loadPlugins();
    const resolvers = service.getAllResolvers();
    const id = resolvers[0].id;

    service.setEnabled(id, true);
    expect(service.getResolver(id).enabled).toBe(true);

    const saved = store.get('resolver_configs');
    expect(saved[id].enabled).toBe(true);
  });

  test('setEnabled broadcasts update', async () => {
    await service.loadPlugins();
    const id = service.getAllResolvers()[0].id;

    service.setEnabled(id, true);
    expect(wsManager.broadcast).toHaveBeenCalledWith(
      'resolvers:updated',
      expect.any(Array)
    );
  });

  test('setEnabled throws for unknown resolver', async () => {
    await service.loadPlugins();
    expect(() => service.setEnabled('nonexistent', true)).toThrow('not found');
  });

  test('getResolverConfig returns config for resolver', async () => {
    await service.loadPlugins();
    const id = service.getAllResolvers()[0].id;

    service.setResolverConfig(id, { apiKey: 'test123' });
    const config = service.getResolverConfig(id);
    expect(config.apiKey).toBe('test123');
  });

  test('getResolverConfig returns empty object for unknown resolver', () => {
    expect(service.getResolverConfig('nonexistent')).toEqual({});
  });

  test('search returns empty array when no resolvers enabled', async () => {
    await service.loadPlugins();
    const results = await service.search('test query');
    expect(results).toEqual([]);
  });

  test('loadPlugins applies saved state from store', async () => {
    // Pre-set saved config
    store.set('resolver_configs', {
      spotify: { enabled: true, weight: 10, config: { token: 'abc' } }
    });

    await service.loadPlugins();
    const spotify = service.getResolver('spotify');

    if (spotify) {
      expect(spotify.enabled).toBe(true);
      expect(spotify.weight).toBe(10);
      expect(spotify.config.token).toBe('abc');
    }
  });
});
