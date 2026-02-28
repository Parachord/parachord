const { Router } = require('express');

function createPlaybackRoutes(playbackService) {
  const router = Router();

  // GET /api/playback — current state
  router.get('/', (req, res) => {
    res.json(playbackService.getState());
  });

  // POST /api/playback/play — play a track or from queue
  router.post('/play', async (req, res, next) => {
    try {
      if (req.body.index !== undefined) {
        // Play from queue by index
        const result = await playbackService.playFromQueue(req.body.index);
        return res.json(result);
      }
      if (req.body.title || req.body.artist) {
        // Play a specific track
        const result = await playbackService.play(req.body);
        return res.json(result);
      }
      // Resume from queue current
      const result = await playbackService.playFromQueue();
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/playback/pause
  router.post('/pause', (req, res) => {
    playbackService.pause();
    res.json({ success: true });
  });

  // POST /api/playback/resume
  router.post('/resume', (req, res) => {
    playbackService.resume();
    res.json({ success: true });
  });

  // POST /api/playback/stop
  router.post('/stop', (req, res) => {
    playbackService.stop();
    res.json({ success: true });
  });

  // POST /api/playback/next
  router.post('/next', async (req, res, next) => {
    try {
      const result = await playbackService.next();
      res.json(result || { success: true, ended: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/playback/previous
  router.post('/previous', async (req, res, next) => {
    try {
      const result = await playbackService.previous();
      res.json(result || { success: true, atStart: true });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/playback/seek
  router.post('/seek', (req, res) => {
    const { position } = req.body;
    if (position === undefined) {
      return res.status(400).json({ error: 'Missing position' });
    }
    playbackService.seek(position);
    res.json({ success: true });
  });

  return router;
}

module.exports = createPlaybackRoutes;
