const express = require('express');
const request = require('supertest');
const createHealthRoutes = require('../routes/health');
const createAuthMiddleware = require('../middleware/auth');

function createApp(options = {}) {
  const app = express();
  app.use(express.json());

  if (options.authMiddleware) {
    app.use(options.authMiddleware);
  }

  const mockResolverService = {
    getAllResolvers: () => [{ id: 'test-resolver' }, { id: 'another' }]
  };

  const healthRoutes = createHealthRoutes(mockResolverService);
  app.use('/api', healthRoutes);

  // A protected API route for testing auth
  app.get('/api/test', (req, res) => res.json({ ok: true }));

  // An unprotected route
  app.get('/health-check', (req, res) => res.json({ ok: true }));

  return app;
}

describe('Health Routes', () => {
  test('GET /api/health returns status', async () => {
    const app = createApp();
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.resolvers).toBe(2);
    expect(typeof res.body.uptime).toBe('number');
  });

  test('GET /api/version returns version info', async () => {
    const app = createApp();
    const res = await request(app).get('/api/version');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('parachord-server');
    expect(res.body.version).toBe('0.1.0');
    expect(res.body.node).toBeDefined();
  });
});

describe('Auth Middleware', () => {
  const originalEnv = process.env.PARACHORD_API_KEY;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.PARACHORD_API_KEY = originalEnv;
    } else {
      delete process.env.PARACHORD_API_KEY;
    }
  });

  test('passes through when no API key configured', async () => {
    delete process.env.PARACHORD_API_KEY;
    const middleware = createAuthMiddleware();
    const app = createApp({ authMiddleware: middleware });
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(200);
  });

  test('rejects /api/* requests without Authorization header', async () => {
    process.env.PARACHORD_API_KEY = 'test-secret-key';
    const middleware = createAuthMiddleware();
    const app = createApp({ authMiddleware: middleware });
    const res = await request(app).get('/api/test');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Authorization');
  });

  test('rejects /api/* requests with wrong key', async () => {
    process.env.PARACHORD_API_KEY = 'test-secret-key';
    const middleware = createAuthMiddleware();
    const app = createApp({ authMiddleware: middleware });
    const res = await request(app)
      .get('/api/test')
      .set('Authorization', 'Bearer wrong-key');
    expect(res.status).toBe(403);
  });

  test('allows /api/* requests with correct key', async () => {
    process.env.PARACHORD_API_KEY = 'test-secret-key';
    const middleware = createAuthMiddleware();
    const app = createApp({ authMiddleware: middleware });
    const res = await request(app)
      .get('/api/test')
      .set('Authorization', 'Bearer test-secret-key');
    expect(res.status).toBe(200);
  });

  test('does not protect non-/api/ routes', async () => {
    process.env.PARACHORD_API_KEY = 'test-secret-key';
    const middleware = createAuthMiddleware();
    const app = createApp({ authMiddleware: middleware });
    const res = await request(app).get('/health-check');
    expect(res.status).toBe(200);
  });
});
