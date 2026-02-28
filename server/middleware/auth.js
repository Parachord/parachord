/**
 * API authentication middleware.
 *
 * When the PARACHORD_API_KEY environment variable is set, all /api/* requests
 * must include a matching Bearer token in the Authorization header.
 *
 * Routes outside /api/* (health, OAuth callbacks) are not protected.
 */

function createAuthMiddleware() {
  const apiKey = process.env.PARACHORD_API_KEY;

  // No key configured — everything is open
  if (!apiKey) {
    return (req, res, next) => next();
  }

  return (req, res, next) => {
    // Only protect /api/* routes
    if (!req.path.startsWith('/api/')) {
      return next();
    }

    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7);
    if (token !== apiKey) {
      return res.status(403).json({ error: 'Invalid API key' });
    }

    next();
  };
}

module.exports = createAuthMiddleware;
