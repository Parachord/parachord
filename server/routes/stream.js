const { Router } = require('express');
const fs = require('fs');
const path = require('path');

const MIME_TYPES = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
  '.wma': 'audio/x-ms-wma',
  '.aiff': 'audio/aiff',
  '.alac': 'audio/mp4'
};

function createStreamRoutes(localFilesService) {
  const router = Router();

  // GET /api/stream/local?path=... — stream a local audio file with range support
  router.get('/local', async (req, res) => {
    const filePath = req.query.path;
    if (!filePath) {
      return res.status(400).json({ error: 'Missing path parameter' });
    }

    try {
      const resolvedPath = path.resolve(filePath);

      // Validate file is in a watched folder
      if (localFilesService?.initialized) {
        const watchFolders = localFilesService.getWatchFolders();
        const isInWatchedFolder = watchFolders.some(folder =>
          resolvedPath.startsWith(folder.path + path.sep) || resolvedPath === folder.path
        );
        if (!isInWatchedFolder) {
          return res.status(403).json({ error: 'Access denied — file not in a watched folder' });
        }
      }

      const stats = fs.statSync(resolvedPath);
      if (!stats.isFile()) {
        return res.status(404).json({ error: 'Not a file' });
      }

      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeType = MIME_TYPES[ext] || 'audio/mpeg';

      // Handle range requests for seeking
      const range = req.headers.range;
      if (range) {
        const match = range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : stats.size - 1;
          const chunkSize = end - start + 1;

          res.writeHead(206, {
            'Content-Type': mimeType,
            'Content-Length': chunkSize,
            'Content-Range': `bytes ${start}-${end}/${stats.size}`,
            'Accept-Ranges': 'bytes'
          });

          fs.createReadStream(resolvedPath, { start, end }).pipe(res);
          return;
        }
      }

      // Full file
      res.writeHead(200, {
        'Content-Type': mimeType,
        'Content-Length': stats.size,
        'Accept-Ranges': 'bytes'
      });

      fs.createReadStream(resolvedPath).pipe(res);
    } catch (err) {
      if (err.code === 'ENOENT') {
        return res.status(404).json({ error: 'File not found' });
      }
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = createStreamRoutes;
