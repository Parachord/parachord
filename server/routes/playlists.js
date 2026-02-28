const { Router } = require('express');

function createPlaylistRoutes(playlistService) {
  const router = Router();

  // GET /api/playlists
  router.get('/', (req, res) => {
    res.json(playlistService.getAll());
  });

  // GET /api/playlists/:id
  router.get('/:id', (req, res) => {
    const playlist = playlistService.getById(req.params.id);
    if (!playlist) return res.status(404).json({ error: 'Playlist not found' });
    res.json(playlist);
  });

  // POST /api/playlists — create or update
  router.post('/', (req, res) => {
    try {
      res.json(playlistService.save(req.body));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // PUT /api/playlists/:id — update
  router.put('/:id', (req, res) => {
    try {
      const data = { ...req.body, id: req.params.id };
      res.json(playlistService.save(data));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // DELETE /api/playlists/:id
  router.delete('/:id', (req, res) => {
    try {
      res.json(playlistService.delete(req.params.id));
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  // POST /api/playlists/import — import XSPF
  router.post('/import', (req, res) => {
    try {
      const { content, filename } = req.body;
      if (!content) return res.status(400).json({ error: 'Missing content' });
      res.json(playlistService.parseXspf(content, filename));
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // GET /api/playlists/:id/export — export as XSPF
  router.get('/:id/export', (req, res) => {
    try {
      const xspf = playlistService.exportXspf(req.params.id);
      res.set('Content-Type', 'application/xspf+xml');
      res.set('Content-Disposition', `attachment; filename="playlist.xspf"`);
      res.send(xspf);
    } catch (err) {
      res.status(404).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createPlaylistRoutes;
