const { Router } = require('express');

function createScrobblerRoutes(scrobbleService) {
  const router = Router();

  // GET /api/scrobblers — list all scrobblers with status
  router.get('/', (req, res) => {
    res.json(scrobbleService.getPlugins());
  });

  // GET /api/scrobblers/:id/status
  router.get('/:id/status', (req, res) => {
    const plugin = scrobbleService.getPlugin(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Scrobbler not found' });
    res.json(plugin.getConnectionStatus());
  });

  // POST /api/scrobblers/:id/connect — connect a scrobbler
  router.post('/:id/connect', async (req, res, next) => {
    const plugin = scrobbleService.getPlugin(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Scrobbler not found' });

    try {
      if (req.params.id === 'listenbrainz') {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Missing token' });
        const result = await plugin.connect(token);
        return res.json(result);
      }

      if (req.params.id === 'lastfm') {
        // Two-step: startAuth returns URL, completeAuth finalizes
        if (req.body.complete) {
          const result = await plugin.completeAuth();
          return res.json(result);
        }
        const result = await plugin.startAuth();
        return res.json(result);
      }

      if (req.params.id === 'librefm') {
        const { username, password } = req.body;
        if (username && password) {
          const result = await plugin.connectWithPassword(username, password);
          return res.json(result);
        }
        // Fallback to token auth flow
        if (req.body.complete) {
          const result = await plugin.completeAuth();
          return res.json(result);
        }
        const result = await plugin.startAuth();
        return res.json(result);
      }

      res.status(400).json({ error: 'Unknown scrobbler type' });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/scrobblers/:id — disconnect
  router.delete('/:id', (req, res) => {
    const plugin = scrobbleService.getPlugin(req.params.id);
    if (!plugin) return res.status(404).json({ error: 'Scrobbler not found' });
    plugin.disconnect();
    res.json({ success: true });
  });

  // POST /api/scrobblers/retry — retry failed scrobbles
  router.post('/retry', async (req, res, next) => {
    try {
      const result = await scrobbleService.retryFailed();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createScrobblerRoutes;
