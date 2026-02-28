const { Router } = require('express');

function createConfigRoutes(store) {
  const router = Router();

  // GET /api/config/:key
  router.get('/:key', (req, res) => {
    const value = store.get(req.params.key);
    if (value === undefined) {
      return res.status(404).json({ error: `Config key "${req.params.key}" not found` });
    }
    res.json({ key: req.params.key, value });
  });

  // PUT /api/config/:key
  router.put('/:key', (req, res) => {
    const { value } = req.body;
    if (value === undefined) {
      return res.status(400).json({ error: 'Missing "value" in request body' });
    }
    store.set(req.params.key, value);
    res.json({ key: req.params.key, value });
  });

  // DELETE /api/config/:key
  router.delete('/:key', (req, res) => {
    store.delete(req.params.key);
    res.json({ success: true });
  });

  return router;
}

module.exports = createConfigRoutes;
