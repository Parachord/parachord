const { Router } = require('express');

function createChatRoutes(chatService, mcpService) {
  const router = Router();

  // POST /api/chat — send a message
  router.post('/', async (req, res, next) => {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: 'Missing message' });
    }
    try {
      const response = await chatService.chat(message);
      res.json(response);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/chat/history
  router.get('/history', (req, res) => {
    res.json(chatService.getHistory());
  });

  // DELETE /api/chat/history
  router.delete('/history', (req, res) => {
    chatService.clearHistory();
    res.json({ success: true });
  });

  // --- MCP endpoints ---

  // POST /mcp — JSON-RPC
  router.post('/mcp', async (req, res) => {
    const result = await mcpService.handleRequest(req.body);
    res.json(result);
  });

  // GET /mcp — server info
  router.get('/mcp', (req, res) => {
    res.json({
      name: 'parachord-server',
      version: '0.1.0',
      protocol: '2025-03-26'
    });
  });

  return router;
}

module.exports = createChatRoutes;
