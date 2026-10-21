// main-process/ipc/local-files.js — the Local Files IPC surface: thin
// delegations to the LocalFilesService. Extracted from main.js
// (maintainability plan Track 3, third slice) so the whole surface — including
// the documented renderer-shape translations — is reviewable in one file.
//
// Everything is dependency-injected ({ ipcMain, dialog, getMainWindow,
// waitForLocalFilesService, safeSendToRenderer }) — no electron require, so
// jest drives the handlers directly with fakes
// (tests/main-process/local-files-ipc.test.js).
//
// Notable contracts preserved verbatim:
//  - resolveArt translates the renderer's camelCase track payload to the
//    snake_case the resolver expects, and strips the "local-" id prefix.
//  - stream-info degrades to null on error (a HUD miss, not a failure).
//  - rescanAll/rescanFolder stream progress via safeSendToRenderer on the
//    "localFiles:scanProgress" channel.

function registerLocalFilesIpc({ ipcMain, dialog, getMainWindow, waitForLocalFilesService, safeSendToRenderer }) {
  // Local Files IPC handlers
  ipcMain.handle('localFiles:addWatchFolder', async () => {
    console.log('=== Add Watch Folder ===');
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Select Watch Folder',
      properties: ['openDirectory']
    });

    if (result.canceled || result.filePaths.length === 0) {
      console.log('  User cancelled');
      return null;
    }

    const folderPath = result.filePaths[0];
    console.log('  Selected:', folderPath);

    try {
      const service = await waitForLocalFilesService();
      const scanResult = await service.addWatchFolder(folderPath);
      return { success: true, folderPath, scanResult };
    } catch (error) {
      console.error('  Error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('localFiles:removeWatchFolder', async (event, folderPath) => {
    console.log('=== Remove Watch Folder ===');
    console.log('  Path:', folderPath);

    try {
      const service = await waitForLocalFilesService();
      await service.removeWatchFolder(folderPath);
      return { success: true };
    } catch (error) {
      console.error('  Error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('localFiles:getWatchFolders', async () => {
    const service = await waitForLocalFilesService();
    return service.getWatchFolders();
  });

  // On-demand album-art resolution for a single track. Used by the renderer's
  // lazy background extraction loop to warm the cache for tracks that have
  // embedded/folder art but haven't been extracted yet. The track payload is
  // the renderer-shaped track (camelCase fields like `hasEmbeddedArt`,
  // `folderArtPath`, `filePath`); resolveArt accepts both shapes.
  ipcMain.handle('localFiles:resolveArt', async (_event, track) => {
    const service = await waitForLocalFilesService();
    if (!service || !track) return null;
    // Translate renderer's camelCase fields back to the snake_case the
    // resolver expects, in case the renderer-side fields are the only ones set.
    const dbShaped = {
      file_path: track.filePath || track.file_path,
      has_embedded_art: track.hasEmbeddedArt ? 1 : (track.has_embedded_art || 0),
      folder_art_path: track.folderArtPath || track.folder_art_path,
      musicbrainz_release_id: track.musicbrainzReleaseId || track.musicbrainz_release_id,
      musicbrainz_art_url: track.musicbrainzArtUrl || track.musicbrainz_art_url,
      id: typeof track.id === 'string' && track.id.startsWith('local-')
        ? track.id.slice('local-'.length)
        : track.id
    };
    return service.resolveArtForTrack(dbShaped);
  });

  // Stream info for the playing file (stream-quality.js contract) — parsed at
  // play time so the now-playing HUD has exact codec/bitrate/sample-rate data
  // without persisting it in the scan DB. Renderer passes the file path from
  // the playing track's localfiles source (or top-level filePath).
  ipcMain.handle('localFiles:stream-info', async (_event, filePath) => {
    const service = await waitForLocalFilesService();
    if (!service || !filePath) return null;
    try {
      return await service.getStreamInfo(filePath);
    } catch (err) {
      console.warn('[LocalFiles] stream-info IPC failed:', err && err.message ? err.message : err);
      return null;
    }
  });

  // 'present' | 'missing' | 'unknown' for a library file (#1002): lets a
  // failed local play say the file is gone instead of "could not be decoded".
  ipcMain.handle('localFiles:file-status', async (_event, filePath) => {
    const service = await waitForLocalFilesService();
    if (!service || !filePath) return 'unknown';
    try {
      return await service.fileStatus(filePath);
    } catch (err) {
      console.warn('[LocalFiles] file-status IPC failed:', err && err.message ? err.message : err);
      return 'unknown';
    }
  });

  ipcMain.handle('localFiles:rescanAll', async () => {
    console.log('=== Rescan All Folders ===');

    try {
      const service = await waitForLocalFilesService();
      const results = await service.rescanAll((current, total, file) => {
        safeSendToRenderer('localFiles:scanProgress', { current, total, file });
      });
      return { success: true, results };
    } catch (error) {
      console.error('  Error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('localFiles:rescanFolder', async (event, folderPath) => {
    console.log('=== Rescan Folder ===');
    console.log('  Path:', folderPath);

    try {
      const service = await waitForLocalFilesService();
      const result = await service.scanFolder(folderPath, (current, total, file) => {
        safeSendToRenderer('localFiles:scanProgress', { current, total, file });
      });
      return { success: true, result };
    } catch (error) {
      console.error('  Error:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('localFiles:getAllTracks', async () => {
    const service = await waitForLocalFilesService();
    return service.getAllTracks();
  });

  ipcMain.handle('localFiles:search', async (event, query) => {
    const service = await waitForLocalFilesService();
    return service.search(query);
  });

  ipcMain.handle('localFiles:resolve', async (event, params) => {
    const service = await waitForLocalFilesService();
    return service.resolve(params);
  });

  ipcMain.handle('localFiles:getStats', async () => {
    const service = await waitForLocalFilesService();
    return service.getStats();
  });

  ipcMain.handle('localFiles:saveId3Tags', async (event, filePath, tags) => {
    console.log('=== Save ID3 Tags ===');
    console.log('  File:', filePath);
    console.log('  Tags:', tags);

    try {
      const service = await waitForLocalFilesService();
      const result = await service.saveId3Tags(filePath, tags);
      return result;
    } catch (error) {
      console.error('  Error:', error);
      return { success: false, error: error.message };
    }
  });

}
module.exports = { registerLocalFilesIpc };
