const { Router } = require('express');

function createResolverRoutes(resolverService) {
  const router = Router();

  // GET /api/resolvers — list all resolvers
  router.get('/', (req, res) => {
    res.json(resolverService.getAllResolvers());
  });

  // PUT /api/resolvers/:id/enable
  router.put('/:id/enable', (req, res) => {
    try {
      resolverService.setEnabled(req.params.id, true);
      res.json({ success: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // PUT /api/resolvers/:id/disable
  router.put('/:id/disable', (req, res) => {
    try {
      resolverService.setEnabled(req.params.id, false);
      res.json({ success: true });
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // GET /api/search?q=
  router.get('/search', async (req, res, next) => {
    const query = req.query.q;
    if (!query) {
      return res.status(400).json({ error: 'Missing query parameter: q' });
    }
    try {
      const results = await resolverService.search(query);
      res.json({ query, results, count: results.length });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/resolve — resolve a track to a playable URL
  router.post('/resolve', async (req, res, next) => {
    const track = req.body;
    if (!track || (!track.title && !track.artist)) {
      return res.status(400).json({ error: 'Request body must include track with title or artist' });
    }
    try {
      const result = await resolverService.resolve(track);
      if (result) {
        res.json(result);
      } else {
        res.status(404).json({ error: 'No resolver could handle this track' });
      }
    } catch (err) {
      next(err);
    }
  });

  // POST /api/lookup-url — look up track/album/playlist from URL
  router.post('/lookup-url', async (req, res, next) => {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Missing url in request body' });
    }
    try {
      const urlType = resolverService.getUrlType(url);
      let result;

      if (urlType === 'album') {
        result = await resolverService.lookupAlbum(url);
      } else if (urlType === 'playlist') {
        result = await resolverService.lookupPlaylist(url);
      } else {
        result = await resolverService.lookupUrl(url);
      }

      if (result) {
        res.json({ type: urlType, ...result });
      } else {
        res.status(404).json({ error: 'No resolver could handle this URL' });
      }
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = createResolverRoutes;
