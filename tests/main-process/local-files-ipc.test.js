/**
 * main-process/ipc/local-files.js — the Local Files IPC surface, driven
 * directly with injected fakes (no electron require in the module, by design).
 *
 * Pins the thin delegations plus the two documented contracts that live in this
 * layer: the resolveArt renderer→DB field translation (camelCase → snake_case,
 * "local-" id prefix strip) and the scan-progress broadcast channel.
 */

const { registerLocalFilesIpc } = require('../../main-process/ipc/local-files');

const CHANNELS = [
  'localFiles:addWatchFolder', 'localFiles:removeWatchFolder', 'localFiles:getWatchFolders',
  'localFiles:resolveArt', 'localFiles:stream-info', 'localFiles:rescanAll',
  'localFiles:rescanFolder', 'localFiles:getAllTracks', 'localFiles:search',
  'localFiles:resolve', 'localFiles:getStats', 'localFiles:saveId3Tags',
  'localFiles:file-status', 'localFiles:find-missing', 'localFiles:remove-missing',
  'localFiles:getTracksByPaths',
];

function makeHarness({ dialogResult, serviceImpl } = {}) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, fn) => handlers.set(channel, fn) };

  const sent = [];
  const safeSendToRenderer = (channel, payload) => sent.push({ channel, payload });

  const win = { id: 'main-window' };
  const dialogCalls = [];
  const dialog = {
    showOpenDialog: async (window, opts) => {
      dialogCalls.push({ window, opts });
      return dialogResult !== undefined ? dialogResult : { canceled: false, filePaths: ['/music/flac'] };
    },
  };

  const serviceCalls = [];
  const service = {};
  for (const method of [
    'addWatchFolder', 'removeWatchFolder', 'getWatchFolders', 'resolveArtForTrack', 'getStreamInfo',
    'rescanAll', 'scanFolder', 'getAllTracks', 'search', 'resolve', 'getStats', 'saveId3Tags',
    'fileStatus', 'findMissingFiles', 'removeMissingFiles', 'getTracksByPaths',
  ]) {
    service[method] = async (...args) => {
      serviceCalls.push({ method, args });
      if (serviceImpl) return serviceImpl(method, args);
      return { marker: `${method}-result` };
    };
  }

  registerLocalFilesIpc({
    ipcMain,
    dialog,
    getMainWindow: () => win,
    waitForLocalFilesService: async () => service,
    safeSendToRenderer,
  });
  return { handlers, service, serviceCalls, dialog, dialogCalls, sent, win };
}

describe('localFiles:file-status (#1002)', () => {
  test('delegates to the service', async () => {
    const { handlers, serviceCalls } = makeHarness({ serviceImpl: () => 'missing' });
    await expect(handlers.get('localFiles:file-status')(null, '/music/gone.flac')).resolves.toBe('missing');
    expect(serviceCalls).toEqual([{ method: 'fileStatus', args: ['/music/gone.flac'] }]);
  });

  test('answers unknown for no path or a failing service, never throws', async () => {
    const { handlers } = makeHarness({ serviceImpl: () => { throw new Error('db closed'); } });
    await expect(handlers.get('localFiles:file-status')(null, '')).resolves.toBe('unknown');
    await expect(handlers.get('localFiles:file-status')(null, '/music/a.flac')).resolves.toBe('unknown');
  });
});

describe('localFiles missing-files channels (#1002)', () => {
  test('find-missing wraps the service result', async () => {
    const { handlers } = makeHarness({ serviceImpl: () => ({ missing: ['/m/a.flac'], unreachableFolders: [], checked: 3 }) });
    await expect(handlers.get('localFiles:find-missing')()).resolves.toEqual({
      success: true, missing: ['/m/a.flac'], unreachableFolders: [], checked: 3,
    });
  });

  test('remove-missing passes only string paths, and does nothing for none', async () => {
    const { handlers, serviceCalls } = makeHarness({ serviceImpl: () => ({ removed: 1, kept: 0 }) });
    await expect(handlers.get('localFiles:remove-missing')(null, ['/m/a.flac', 7, '', null])).resolves.toEqual({ success: true, removed: 1, kept: 0 });
    expect(serviceCalls).toEqual([{ method: 'removeMissingFiles', args: [['/m/a.flac']] }]);
    await expect(handlers.get('localFiles:remove-missing')(null, 'not-an-array')).resolves.toEqual({ success: true, removed: 0, kept: 0 });
  });

  test('a service failure comes back as an error, not a throw', async () => {
    const { handlers } = makeHarness({ serviceImpl: () => { throw new Error('db closed'); } });
    await expect(handlers.get('localFiles:find-missing')()).resolves.toEqual({ success: false, error: 'db closed' });
    await expect(handlers.get('localFiles:remove-missing')(null, ['/m/a.flac'])).resolves.toEqual({ success: false, error: 'db closed' });
  });
});

describe('localFiles IPC surface', () => {
  test('registers exactly the full channel surface', () => {
    const { handlers } = makeHarness();
    expect([...handlers.keys()].sort()).toEqual([...CHANNELS].sort());
  });

  test('addWatchFolder: cancel returns null without touching the service', async () => {
    const { handlers, serviceCalls } = makeHarness({ dialogResult: { canceled: true, filePaths: [] } });
    expect(await handlers.get('localFiles:addWatchFolder')()).toBeNull();
    expect(serviceCalls).toEqual([]);
  });

  test('addWatchFolder: selection is added and scanned, dialog gets the main window', async () => {
    const { handlers, serviceCalls, dialogCalls, win } = makeHarness();
    const result = await handlers.get('localFiles:addWatchFolder')();
    expect(result).toEqual({ success: true, folderPath: '/music/flac', scanResult: { marker: 'addWatchFolder-result' } });
    expect(serviceCalls).toEqual([{ method: 'addWatchFolder', args: ['/music/flac'] }]);
    expect(dialogCalls).toEqual([{ window: win, opts: { title: 'Select Watch Folder', properties: ['openDirectory'] } }]);
  });

  test('addWatchFolder: a service error becomes { success: false, error }', async () => {
    const { handlers } = makeHarness({ serviceImpl: async () => { throw new Error('scan failed'); } });
    await expect(handlers.get('localFiles:addWatchFolder')()).resolves.toEqual({ success: false, error: 'scan failed' });
  });

  test('removeWatchFolder delegates and wraps', async () => {
    const { handlers, serviceCalls } = makeHarness();
    await expect(handlers.get('localFiles:removeWatchFolder')(null, '/music/flac')).resolves.toEqual({ success: true });
    expect(serviceCalls).toEqual([{ method: 'removeWatchFolder', args: ['/music/flac'] }]);
  });

  test('resolveArt translates the renderer payload to the DB shape (camelCase → snake_case, local- prefix strip)', async () => {
    const { handlers, serviceCalls } = makeHarness();
    await handlers.get('localFiles:resolveArt')(null, {
      id: 'local-42',
      filePath: '/music/a.flac',
      hasEmbeddedArt: true,
      folderArtPath: '/music/cover.jpg',
      musicbrainzReleaseId: 'rel-1',
      musicbrainzArtUrl: 'https://caa/img',
    });
    expect(serviceCalls).toEqual([{
      method: 'resolveArtForTrack',
      args: [{
        file_path: '/music/a.flac',
        has_embedded_art: 1,
        folder_art_path: '/music/cover.jpg',
        musicbrainz_release_id: 'rel-1',
        musicbrainz_art_url: 'https://caa/img',
        id: '42',
      }],
    }]);
  });

  test('resolveArt tolerates the DB shape and a null track', async () => {
    const { handlers, serviceCalls } = makeHarness();
    await handlers.get('localFiles:resolveArt')(null, { id: '7', file_path: '/music/b.flac' });
    expect(serviceCalls[0].args[0]).toEqual({ file_path: '/music/b.flac', has_embedded_art: 0, folder_art_path: undefined, musicbrainz_release_id: undefined, musicbrainz_art_url: undefined, id: '7' });
    await expect(handlers.get('localFiles:resolveArt')(null, null)).resolves.toBeNull();
  });

  test('stream-info passes the path through and degrades to null on error or missing path', async () => {
    const { handlers, serviceCalls } = makeHarness();
    await expect(handlers.get('localFiles:stream-info')(null, '/music/a.flac')).resolves.toEqual({ marker: 'getStreamInfo-result' });
    expect(serviceCalls[0].args).toEqual(['/music/a.flac']);
    await expect(handlers.get('localFiles:stream-info')(null, null)).resolves.toBeNull();
    const { handlers: h2 } = makeHarness({ serviceImpl: async (m) => { if (m === 'getStreamInfo') throw new Error('io'); return {}; } });
    await expect(h2.get('localFiles:stream-info')(null, '/music/a.flac')).resolves.toBeNull();
  });

  test('rescanAll / rescanFolder broadcast scan progress to the renderer', async () => {
    const { handlers, sent, serviceCalls } = makeHarness({
      serviceImpl: async (method, args) => {
        if (method === 'rescanAll' || method === 'scanFolder') {
          const onProgress = args[args.length - 1];
          onProgress(1, 10, 'a.flac');
          onProgress(2, 10, 'b.flac');
          return { scanned: 2 };
        }
        return {};
      },
    });
    await expect(handlers.get('localFiles:rescanAll')()).resolves.toEqual({ success: true, results: { scanned: 2 } });
    await expect(handlers.get('localFiles:rescanFolder')(null, '/music/flac')).resolves.toEqual({ success: true, result: { scanned: 2 } });
    expect(serviceCalls.map((c) => c.method)).toEqual(['rescanAll', 'scanFolder']);
    expect(sent).toEqual([
      { channel: 'localFiles:scanProgress', payload: { current: 1, total: 10, file: 'a.flac' } },
      { channel: 'localFiles:scanProgress', payload: { current: 2, total: 10, file: 'b.flac' } },
      { channel: 'localFiles:scanProgress', payload: { current: 1, total: 10, file: 'a.flac' } },
      { channel: 'localFiles:scanProgress', payload: { current: 2, total: 10, file: 'b.flac' } },
    ]);
  });

  test('the pass-through channels forward args and results unchanged', async () => {
    const { handlers, serviceCalls } = makeHarness();
    await expect(handlers.get('localFiles:getWatchFolders')()).resolves.toEqual({ marker: 'getWatchFolders-result' });
    await expect(handlers.get('localFiles:getAllTracks')()).resolves.toEqual({ marker: 'getAllTracks-result' });
    await expect(handlers.get('localFiles:search')(null, 'queries')).resolves.toEqual({ marker: 'search-result' });
    await expect(handlers.get('localFiles:resolve')(null, { a: 1 })).resolves.toEqual({ marker: 'resolve-result' });
    await expect(handlers.get('localFiles:getStats')()).resolves.toEqual({ marker: 'getStats-result' });
    expect(serviceCalls).toEqual([
      { method: 'getWatchFolders', args: [] },
      { method: 'getAllTracks', args: [] },
      { method: 'search', args: ['queries'] },
      { method: 'resolve', args: [{ a: 1 }] },
      { method: 'getStats', args: [] },
    ]);
  });

  test('saveId3Tags returns the service result verbatim; errors become { success: false, error }', async () => {
    const { handlers } = makeHarness();
    await expect(handlers.get('localFiles:saveId3Tags')(null, '/a.mp3', { title: 'New' })).resolves.toEqual({ marker: 'saveId3Tags-result' });
    const { handlers: h2 } = makeHarness({ serviceImpl: async () => { throw new Error('readonly'); } });
    await expect(h2.get('localFiles:saveId3Tags')(null, '/a.mp3', {})).resolves.toEqual({ success: false, error: 'readonly' });
  });
});
