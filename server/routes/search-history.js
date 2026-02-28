const { Router } = require('express');

function createSearchHistoryRoutes(searchHistoryService) {
  const router = Router();

  // GET /api/search-history — load all entries
  router.get('/', (req, res) => {
    res.json(searchHistoryService.load());
  });

  // POST /api/search-history — save an entry
  router.post('/', (req, res) => {
    const result = searchHistoryService.save(req.body);
    if (!result.success) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // DELETE /api/search-history — clear one or all entries
  router.delete('/', (req, res) => {
    const { query } = req.query;
    const result = searchHistoryService.clear(query || undefined);
    res.json(result);
  });

  return router;
}

module.exports = createSearchHistoryRoutes;
