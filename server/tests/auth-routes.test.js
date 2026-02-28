const express = require('express');
const request = require('supertest');
const createAuthRoutes = require('../routes/auth');
const errorHandler = require('../middleware/error-handler');

function createMockAuthService() {
  return {
    startSpotifyAuth: jest.fn().mockReturnValue({ success: true, authUrl: 'https://accounts.spotify.com/authorize?test=1' }),
    startSoundCloudAuth: jest.fn().mockReturnValue({ success: true, authUrl: 'https://secure.soundcloud.com/authorize?test=1' }),
    exchangeSpotifyCode: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: Date.now() + 3600000 }),
    exchangeSoundCloudCode: jest.fn().mockResolvedValue({ token: 'tok', expiresAt: Date.now() + 3600000 }),
    getStatus: jest.fn().mockReturnValue({ connected: true, expiresAt: Date.now() + 3600000 }),
    disconnect: jest.fn(),
    setSpotifyCredentials: jest.fn().mockReturnValue({ success: true, source: 'user' }),
    setSoundCloudCredentials: jest.fn().mockReturnValue({ success: true, source: 'user' }),
    getSpotifyCredentials: jest.fn().mockReturnValue({ clientId: 'test-id', source: 'user' }),
    getSoundCloudCredentials: jest.fn().mockReturnValue({ clientId: 'sc-id', clientSecret: 'sc-secret', source: 'user' })
  };
}

function createApp(authService) {
  const app = express();
  app.use(express.json());
  const routes = createAuthRoutes(authService);
  app.use('/auth', routes);
  app.use('/api/auth', routes);
  app.use(errorHandler);
  return app;
}

describe('Auth Routes', () => {
  let app;
  let authService;

  beforeEach(() => {
    authService = createMockAuthService();
    app = createApp(authService);
  });

  test('GET /auth/spotify redirects to auth URL', async () => {
    const res = await request(app).get('/auth/spotify');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.spotify.com');
  });

  test('GET /auth/spotify returns 400 when no client ID', async () => {
    authService.startSpotifyAuth.mockReturnValue({ success: false, error: 'no_client_id' });
    const res = await request(app).get('/auth/spotify');
    expect(res.status).toBe(400);
  });

  test('GET /auth/spotify/callback handles success', async () => {
    const res = await request(app).get('/auth/spotify/callback?code=test-code');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Success');
    expect(authService.exchangeSpotifyCode).toHaveBeenCalledWith('test-code');
  });

  test('GET /auth/spotify/callback handles error', async () => {
    const res = await request(app).get('/auth/spotify/callback?error=access_denied');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Failed');
  });

  test('GET /api/auth/spotify/status returns status', async () => {
    const res = await request(app).get('/api/auth/spotify/status');
    expect(res.status).toBe(200);
    expect(res.body.connected).toBe(true);
  });

  test('DELETE /api/auth/spotify disconnects', async () => {
    const res = await request(app).delete('/api/auth/spotify');
    expect(res.status).toBe(200);
    expect(authService.disconnect).toHaveBeenCalledWith('spotify');
  });

  test('PUT /api/auth/spotify/credentials sets credentials', async () => {
    const res = await request(app)
      .put('/api/auth/spotify/credentials')
      .send({ clientId: 'new-id' });
    expect(res.status).toBe(200);
    expect(authService.setSpotifyCredentials).toHaveBeenCalledWith('new-id');
  });

  test('GET /auth/soundcloud redirects', async () => {
    const res = await request(app).get('/auth/soundcloud');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('soundcloud.com');
  });

  test('GET /auth/soundcloud/callback handles success', async () => {
    const res = await request(app).get('/auth/soundcloud/callback?code=sc-code&state=abc');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Success');
  });

  test('DELETE /api/auth/soundcloud disconnects', async () => {
    const res = await request(app).delete('/api/auth/soundcloud');
    expect(res.status).toBe(200);
    expect(authService.disconnect).toHaveBeenCalledWith('soundcloud');
  });
});
