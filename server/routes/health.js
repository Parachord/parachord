const { Router } = require('express');
const config = require('../lib/config');

function createHealthRoutes(resolverService) {
  const router = Router();
  const pkg = require('../package.json');

  // GET /api/health — server health check
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      resolvers: resolverService.getAllResolvers().length
    });
  });

  // GET /api/version — server version info
  router.get('/version', (req, res) => {
    res.json({
      name: pkg.name,
      version: pkg.version,
      node: process.version,
      port: config.port
    });
  });

  return router;
}

module.exports = createHealthRoutes;
