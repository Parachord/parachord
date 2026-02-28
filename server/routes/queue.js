const { Router } = require('express');

function createQueueRoutes(queueService) {
  const router = Router();

  // GET /api/queue
  router.get('/', (req, res) => {
    res.json(queueService.getState());
  });

  // POST /api/queue/add
  router.post('/add', (req, res) => {
    const tracks = req.body.tracks || req.body;
    const position = req.body.position || 'end'; // 'end' or 'next'
    if (!tracks || (Array.isArray(tracks) && tracks.length === 0)) {
      return res.status(400).json({ error: 'Missing tracks' });
    }
    const result = queueService.addTracks(
      Array.isArray(tracks) ? tracks : [tracks],
      { position }
    );
    res.json(result);
  });

  // DELETE /api/queue — clear
  router.delete('/', (req, res) => {
    queueService.clear();
    res.json({ success: true });
  });

  // DELETE /api/queue/:index — remove one track
  router.delete('/:index', (req, res) => {
    try {
      queueService.removeTrack(parseInt(req.params.index, 10));
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/queue/reorder
  router.post('/reorder', (req, res) => {
    const { fromIndex, toIndex } = req.body;
    if (fromIndex === undefined || toIndex === undefined) {
      return res.status(400).json({ error: 'Missing fromIndex and/or toIndex' });
    }
    try {
      queueService.reorder(fromIndex, toIndex);
      res.json({ success: true });
    } catch (err) {
      res.status(400).json({ error: err.message });
    }
  });

  // POST /api/queue/shuffle
  router.post('/shuffle', (req, res) => {
    queueService.shuffle();
    res.json({ success: true, shuffled: true });
  });

  // POST /api/queue/unshuffle
  router.post('/unshuffle', (req, res) => {
    queueService.unshuffle();
    res.json({ success: true, shuffled: false });
  });

  return router;
}

module.exports = createQueueRoutes;
