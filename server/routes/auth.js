const { Router } = require('express');

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function successPage(provider) {
  const colors = { spotify: '#1e1b4b', soundcloud: '#1e1b4b' };
  return `<html><body style="background:${colors[provider] || '#1e1b4b'};color:white;font-family:system-ui;text-align:center;padding:50px;">
    <h1>Success!</h1><p>${provider} authentication successful. You can close this window.</p>
    <script>setTimeout(()=>window.close(),2000)</script></body></html>`;
}

function errorPage(message) {
  return `<html><body style="background:#1e1b4b;color:white;font-family:system-ui;text-align:center;padding:50px;">
    <h1>Authentication Failed</h1><p>${escapeHtml(message)}</p><p>You can close this window.</p></body></html>`;
}

function createAuthRoutes(authService) {
  const router = Router();

  // --- Spotify ---

  // GET /auth/spotify — initiate OAuth, redirect user to Spotify
  router.get('/spotify', (req, res) => {
    const result = authService.startSpotifyAuth();
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.redirect(result.authUrl);
  });

  // GET /auth/spotify/callback — handle OAuth callback
  router.get('/spotify/callback', async (req, res) => {
    const { code, error } = req.query;
    if (error) return res.send(errorPage(error));
    if (!code) return res.send(errorPage('No authorization code received'));

    try {
      await authService.exchangeSpotifyCode(code);
      res.send(successPage('Spotify'));
    } catch (err) {
      res.send(errorPage(err.message));
    }
  });

  // GET /api/auth/spotify/status
  router.get('/spotify/status', (req, res) => {
    res.json(authService.getStatus('spotify'));
  });

  // DELETE /api/auth/spotify — disconnect
  router.delete('/spotify', (req, res) => {
    authService.disconnect('spotify');
    res.json({ success: true });
  });

  // PUT /api/auth/spotify/credentials
  router.put('/spotify/credentials', (req, res) => {
    const { clientId } = req.body;
    res.json(authService.setSpotifyCredentials(clientId));
  });

  // GET /api/auth/spotify/credentials
  router.get('/spotify/credentials', (req, res) => {
    const { clientId, source } = authService.getSpotifyCredentials();
    res.json({ clientId: clientId || '', source });
  });

  // --- SoundCloud ---

  // GET /auth/soundcloud — initiate OAuth
  router.get('/soundcloud', (req, res) => {
    const result = authService.startSoundCloudAuth();
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.redirect(result.authUrl);
  });

  // GET /auth/soundcloud/callback
  router.get('/soundcloud/callback', async (req, res) => {
    const { code, error, state } = req.query;
    if (error) return res.send(errorPage(error));
    if (!code) return res.send(errorPage('No authorization code received'));

    try {
      await authService.exchangeSoundCloudCode(code, state);
      res.send(successPage('SoundCloud'));
    } catch (err) {
      res.send(errorPage(err.message));
    }
  });

  // GET /api/auth/soundcloud/status
  router.get('/soundcloud/status', (req, res) => {
    res.json(authService.getStatus('soundcloud'));
  });

  // DELETE /api/auth/soundcloud
  router.delete('/soundcloud', (req, res) => {
    authService.disconnect('soundcloud');
    res.json({ success: true });
  });

  // PUT /api/auth/soundcloud/credentials
  router.put('/soundcloud/credentials', (req, res) => {
    const { clientId, clientSecret } = req.body;
    res.json(authService.setSoundCloudCredentials(clientId, clientSecret));
  });

  // GET /api/auth/soundcloud/credentials
  router.get('/soundcloud/credentials', (req, res) => {
    const { clientId, clientSecret, source } = authService.getSoundCloudCredentials();
    res.json({ clientId: clientId || '', clientSecret: clientSecret ? '****' : '', source });
  });

  return router;
}

module.exports = createAuthRoutes;
