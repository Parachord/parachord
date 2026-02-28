const { Router } = require('express');

function createCollectionRoutes(collectionService) {
  const router = Router();

  // GET /api/collection — with pagination and search
  router.get('/', (req, res) => {
    const page = parseInt(req.query.page, 10) || 1;
    const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
    const search = req.query.search || '';
    res.json(collectionService.getTracks({ page, limit, search }));
  });

  // POST /api/collection/tracks — add tracks
  router.post('/tracks', (req, res) => {
    const tracks = req.body.tracks || req.body;
    if (!tracks || (Array.isArray(tracks) && tracks.length === 0)) {
      return res.status(400).json({ error: 'Missing tracks' });
    }
    res.json(collectionService.addTracks(tracks));
  });

  // DELETE /api/collection/tracks — remove a track
  router.delete('/tracks', (req, res) => {
    const { title, artist } = req.body;
    if (!title || !artist) {
      return res.status(400).json({ error: 'Missing title and/or artist' });
    }
    try {
      res.json(collectionService.removeTrack(title, artist));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createCollectionRoutes;
