const { Router } = require('express');

function createSyncRoutes(syncService) {
  const router = Router();

  // GET /api/sync/providers
  router.get('/providers', (req, res) => {
    res.json(syncService.getProviders());
  });

  // POST /api/sync/:provider/start
  router.post('/:provider/start', async (req, res, next) => {
    try {
      const result = await syncService.startSync(req.params.provider);
      res.json(result);
    } catch (err) {
      if (err.message.includes('already in progress')) {
        return res.status(409).json({ error: err.message });
      }
      next(err);
    }
  });

  // POST /api/sync/cancel
  router.post('/cancel', (req, res) => {
    syncService.cancelSync();
    res.json({ success: true });
  });

  // GET /api/sync/:provider/playlists
  router.get('/:provider/playlists', async (req, res, next) => {
    try {
      const playlists = await syncService.fetchPlaylists(req.params.provider);
      res.json(playlists);
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createSyncRoutes;
