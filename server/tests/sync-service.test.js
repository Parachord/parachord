const SyncService = require('../services/sync-service');

function createMockStore() {
  const data = new Map();
  return {
    get: (key, def) => data.has(key) ? data.get(key) : def,
    set: (key, val) => data.set(key, val),
    delete: (key) => data.delete(key)
  };
}

function createMockWSManager() {
  return { broadcast: jest.fn(), send: jest.fn(), on: jest.fn(), off: jest.fn() };
}

function createMockAuthService() {
  return {
    getToken: jest.fn().mockResolvedValue({ token: 'test-token', expiresAt: Date.now() + 3600000 })
  };
}

describe('SyncService', () => {
  let service;
  let store;
  let wsManager;
  let authService;

  beforeEach(() => {
    store = createMockStore();
    wsManager = createMockWSManager();
    authService = createMockAuthService();
    service = new SyncService(store, authService, wsManager);
  });

  test('getProviders returns available providers', () => {
    const providers = service.getProviders();
    expect(providers.length).toBeGreaterThan(0);
    expect(providers[0]).toHaveProperty('id');
    expect(providers[0]).toHaveProperty('name');
    expect(providers[0]).toHaveProperty('connected');
  });

  test('getProviders shows connected status based on token', () => {
    store.set('spotify_token', 'test');
    const providers = service.getProviders();
    const spotify = providers.find(p => p.id === 'spotify');
    expect(spotify.connected).toBe(true);
  });

  test('startSync throws for unknown provider', async () => {
    await expect(service.startSync('invalid')).rejects.toThrow('Unknown provider');
  });

  test('startSync throws when not authenticated', async () => {
    authService.getToken.mockResolvedValue(null);
    await expect(service.startSync('spotify')).rejects.toThrow('Not authenticated');
  });

  test('cancelSync sets cancelled flag', () => {
    // Simulate an active sync
    service._activeSync = { providerId: 'spotify', cancelled: false };
    service.cancelSync();
    expect(service._activeSync.cancelled).toBe(true);
    expect(wsManager.broadcast).toHaveBeenCalledWith('sync:cancelled', { providerId: 'spotify' });
  });

  test('startSync throws when sync already in progress', async () => {
    service._activeSync = { providerId: 'spotify', cancelled: false };
    await expect(service.startSync('spotify')).rejects.toThrow('already in progress');
  });
});
