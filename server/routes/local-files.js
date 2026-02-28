const { Router } = require('express');

function createLocalFilesRoutes(localFilesService) {
  const router = Router();

  // GET /api/local-files/folders
  router.get('/folders', (req, res) => {
    const folders = localFilesService.getWatchFolders();
    res.json(folders);
  });

  // POST /api/local-files/folders — add a watch folder
  router.post('/folders', async (req, res, next) => {
    const { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Missing path' });
    }
    try {
      await localFilesService.addWatchFolder(folderPath);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // DELETE /api/local-files/folders — remove a watch folder
  router.delete('/folders', async (req, res, next) => {
    const { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Missing path' });
    }
    try {
      await localFilesService.removeWatchFolder(folderPath);
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/local-files/rescan — trigger a full rescan
  router.post('/rescan', async (req, res, next) => {
    try {
      await localFilesService.rescan();
      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/local-files/tracks — search/list local tracks
  router.get('/tracks', (req, res) => {
    const { search, limit = 50, offset = 0 } = req.query;
    const tracks = search
      ? localFilesService.searchTracks(search, parseInt(limit, 10))
      : localFilesService.getAllTracks(parseInt(limit, 10), parseInt(offset, 10));
    res.json(tracks);
  });

  // GET /api/local-files/stats
  router.get('/stats', (req, res) => {
    res.json(localFilesService.getStats());
  });

  return router;
}

module.exports = createLocalFilesRoutes;
