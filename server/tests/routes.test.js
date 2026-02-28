const express = require('express');
const request = require('supertest');
const createResolverRoutes = require('../routes/resolvers');
const createConfigRoutes = require('../routes/config');
const errorHandler = require('../middleware/error-handler');
const Store = require('../lib/store');
const path = require('path');
const os = require('os');
const fs = require('fs');

// Create a mock resolver service
function createMockResolverService() {
  return {
    getAllResolvers: jest.fn().mockReturnValue([
      { id: 'spotify', name: 'Spotify', enabled: true, icon: '🟢', color: '#1DB954' },
      { id: 'youtube', name: 'YouTube', enabled: false, icon: '🔴', color: '#FF0000' }
    ]),
    setEnabled: jest.fn(),
    search: jest.fn().mockResolvedValue([
      { title: 'Creep', artist: 'Radiohead', resolverId: 'spotify' }
    ]),
    resolve: jest.fn().mockResolvedValue({ streamUrl: 'https://example.com/stream' }),
    lookupUrl: jest.fn().mockResolvedValue({ track: { title: 'Test' }, resolverId: 'spotify' }),
    lookupAlbum: jest.fn().mockResolvedValue(null),
    lookupPlaylist: jest.fn().mockResolvedValue(null),
    getUrlType: jest.fn().mockReturnValue('track')
  };
}

function createApp(resolverService, store) {
  const app = express();
  app.use(express.json());
  app.use('/api/resolvers', createResolverRoutes(resolverService));
  app.use('/api/config', createConfigRoutes(store));
  app.use(errorHandler);
  return app;
}

describe('Resolver Routes', () => {
  let app;
  let resolverService;
  let storePath;
  let store;

  beforeEach(() => {
    storePath = path.join(os.tmpdir(), `parachord-route-test-${Date.now()}.json`);
    store = new Store(storePath);
    resolverService = createMockResolverService();
    app = createApp(resolverService, store);
  });

  afterEach(() => {
    if (store._writeTimer) clearTimeout(store._writeTimer);
    try { fs.unlinkSync(storePath); } catch {}
  });

  test('GET /api/resolvers returns resolver list', async () => {
    const res = await request(app).get('/api/resolvers');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('spotify');
  });

  test('PUT /api/resolvers/:id/enable enables resolver', async () => {
    const res = await request(app).put('/api/resolvers/spotify/enable');
    expect(res.status).toBe(200);
    expect(resolverService.setEnabled).toHaveBeenCalledWith('spotify', true);
  });

  test('PUT /api/resolvers/:id/disable disables resolver', async () => {
    const res = await request(app).put('/api/resolvers/youtube/disable');
    expect(res.status).toBe(200);
    expect(resolverService.setEnabled).toHaveBeenCalledWith('youtube', false);
  });

  test('GET /api/resolvers/search?q= returns search results', async () => {
    const res = await request(app).get('/api/resolvers/search?q=radiohead');
    expect(res.status).toBe(200);
    expect(res.body.query).toBe('radiohead');
    expect(res.body.results).toHaveLength(1);
    expect(res.body.results[0].artist).toBe('Radiohead');
  });

  test('GET /api/resolvers/search without q returns 400', async () => {
    const res = await request(app).get('/api/resolvers/search');
    expect(res.status).toBe(400);
  });

  test('POST /api/resolvers/resolve resolves track', async () => {
    const res = await request(app)
      .post('/api/resolvers/resolve')
      .send({ title: 'Creep', artist: 'Radiohead' });
    expect(res.status).toBe(200);
    expect(res.body.streamUrl).toBeDefined();
  });

  test('POST /api/resolvers/resolve without track returns 400', async () => {
    const res = await request(app).post('/api/resolvers/resolve').send({});
    expect(res.status).toBe(400);
  });

  test('POST /api/resolvers/lookup-url looks up URL', async () => {
    const res = await request(app)
      .post('/api/resolvers/lookup-url')
      .send({ url: 'https://open.spotify.com/track/123' });
    expect(res.status).toBe(200);
    expect(res.body.type).toBe('track');
  });

  test('POST /api/resolvers/lookup-url without url returns 400', async () => {
    const res = await request(app).post('/api/resolvers/lookup-url').send({});
    expect(res.status).toBe(400);
  });
});

describe('Config Routes', () => {
  let app;
  let storePath;
  let store;

  beforeEach(() => {
    storePath = path.join(os.tmpdir(), `parachord-config-test-${Date.now()}.json`);
    store = new Store(storePath);
    const resolverService = createMockResolverService();
    app = createApp(resolverService, store);
  });

  afterEach(() => {
    if (store._writeTimer) clearTimeout(store._writeTimer);
    try { fs.unlinkSync(storePath); } catch {}
  });

  test('PUT /api/config/:key sets value', async () => {
    const res = await request(app)
      .put('/api/config/theme')
      .send({ value: 'dark' });
    expect(res.status).toBe(200);
    expect(store.get('theme')).toBe('dark');
  });

  test('GET /api/config/:key retrieves value', async () => {
    store.set('volume', 80);
    const res = await request(app).get('/api/config/volume');
    expect(res.status).toBe(200);
    expect(res.body.value).toBe(80);
  });

  test('GET /api/config/:key returns 404 for missing', async () => {
    const res = await request(app).get('/api/config/nonexistent');
    expect(res.status).toBe(404);
  });

  test('DELETE /api/config/:key removes value', async () => {
    store.set('temp', 'value');
    const res = await request(app).delete('/api/config/temp');
    expect(res.status).toBe(200);
    expect(store.has('temp')).toBe(false);
  });
});
