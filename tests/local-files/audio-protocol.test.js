/**
 * local-audio:// URL round-trip and range streaming.
 *
 * The media-element seek failure (MEDIA_ERR_NETWORK on a network mount) is
 * an Electron scheme-privilege bug plus this handler buffering the whole
 * range. The privilege is covered in main.js; these tests lock the handler
 * contract Chromium's media pipeline needs: 206 + Content-Range, a body that
 * is only the requested bytes, and a read that can be cancelled.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  localAudioUrlFromPath,
  filePathFromLocalAudioUrl,
  parseByteRange,
  createLocalAudioHandler,
  isTransientFsError
} = require('../../local-files/audio-protocol');

function requestFor(url, headers, signal) {
  const h = new Headers(headers || {});
  return { url, headers: h, signal: signal || null };
}

async function readBody(response) {
  const buf = Buffer.from(await response.arrayBuffer());
  return buf;
}

describe('local-audio URL round-trip', () => {
  test('encodes spaces, hash, and percent, and parses the collapsed standard-scheme form', () => {
    const filePath = '/Volumes/NAS/My Song #1 100%.flac';
    const url = localAudioUrlFromPath(filePath);
    expect(url).toBe('local-audio:///Volumes/NAS/My%20Song%20%231%20100%25.flac');
    expect(filePathFromLocalAudioUrl(url, 'darwin')).toBe(filePath);
    // Chromium, once the scheme is standard, drops the empty host and the
    // first segment becomes the host: local-audio://Volumes/NAS/...
    const collapsed = 'local-audio://Volumes/NAS/My%20Song%20%231%20100%25.flac';
    expect(filePathFromLocalAudioUrl(collapsed, 'darwin')).toBe(filePath);
  });

  test('strips a retry query without eating the filename', () => {
    const url = localAudioUrlFromPath('/music/track.mp3') + '?r=2';
    expect(filePathFromLocalAudioUrl(url, 'darwin')).toBe('/music/track.mp3');
  });

  test('windows drive letters and UNC paths', () => {
    expect(localAudioUrlFromPath('C:\\Music\\My Song.mp3'))
      .toBe('local-audio:///C:/Music/My%20Song.mp3');
    expect(filePathFromLocalAudioUrl('local-audio:///C:/Music/My%20Song.mp3', 'win32'))
      .toBe('C:\\Music\\My Song.mp3');
    expect(filePathFromLocalAudioUrl('local-audio://C:/Music/My%20Song.mp3', 'win32'))
      .toBe('C:\\Music\\My Song.mp3');
    // Colon may arrive percent-encoded; still a drive letter after decode.
    expect(filePathFromLocalAudioUrl('local-audio:///C%3A/Music/My%20Song.mp3', 'win32'))
      .toBe('C:\\Music\\My Song.mp3');

    expect(localAudioUrlFromPath('\\\\server\\share\\My Song.mp3'))
      .toBe('local-audio://server/share/My%20Song.mp3');
    expect(filePathFromLocalAudioUrl('local-audio://server/share/My%20Song.mp3', 'win32'))
      .toBe('\\\\server\\share\\My Song.mp3');
  });

  test('rejects an empty path', () => {
    expect(() => filePathFromLocalAudioUrl('local-audio://', 'darwin')).toThrow(/empty/);
  });
});

describe('parseByteRange', () => {
  test('open-ended, closed, and suffix ranges', () => {
    expect(parseByteRange('bytes=0-', 100)).toEqual({ start: 0, end: 99 });
    expect(parseByteRange('bytes=10-19', 100)).toEqual({ start: 10, end: 19 });
    expect(parseByteRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseByteRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    // end past EOF is clamped, not rejected
    expect(parseByteRange('bytes=10-500', 100)).toEqual({ start: 10, end: 99 });
  });

  test('unsatisfiable and invalid', () => {
    expect(parseByteRange('bytes=100-', 100).error).toBe('unsatisfiable');
    expect(parseByteRange('bytes=50-40', 100).error).toBe('unsatisfiable');
    expect(parseByteRange('bytes=-0', 100).error).toBe('invalid');
    expect(parseByteRange('not-a-range', 100).error).toBe('invalid');
    expect(parseByteRange('bytes=0-', 0).error).toBe('unsatisfiable');
  });

  test('uses only the first of a multipart range', () => {
    expect(parseByteRange('bytes=0-1,5-6', 100)).toEqual({ start: 0, end: 1 });
  });
});

describe('local-audio handler', () => {
  let dir;
  let filePath;
  let bytes;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-audio-'));
    filePath = path.join(dir, 'My Song #1.mp3');
    bytes = Buffer.alloc(1000);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251;
    fs.writeFileSync(filePath, bytes);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function handler(extra) {
    return createLocalAudioHandler({
      isPathAllowed: (p) => p.startsWith(dir + path.sep) || p === dir,
      log: () => {},
      warn: () => {},
      chunkSize: 64,
      ...extra
    });
  }

  test('serves a full file and a seek range without reading past the range', async () => {
    const handle = handler();
    const full = await handle(requestFor(localAudioUrlFromPath(filePath)));
    expect(full.status).toBe(200);
    expect(full.headers.get('accept-ranges')).toBe('bytes');
    expect(full.headers.get('content-length')).toBe('1000');
    expect(full.headers.get('content-type')).toBe('audio/mpeg');
    expect(await readBody(full)).toEqual(bytes);

    // Collapsed standard-scheme URL, as Chromium sends it on seek.
    const collapsed = 'local-audio://' + localAudioUrlFromPath(filePath).replace(/^local-audio:\/\//, '').replace(/^\//, '');
    const ranged = await handle(requestFor(collapsed + '?r=1', { Range: 'bytes=100-149' }));
    expect(ranged.status).toBe(206);
    expect(ranged.headers.get('content-range')).toBe('bytes 100-149/1000');
    expect(ranged.headers.get('content-length')).toBe('50');
    expect(await readBody(ranged)).toEqual(bytes.subarray(100, 150));
  });

  test('open-ended seek range is the remainder, not an over-read', async () => {
    const handle = handler();
    const res = await handle(requestFor(localAudioUrlFromPath(filePath), { Range: 'bytes=990-' }));
    expect(res.status).toBe(206);
    expect(res.headers.get('content-range')).toBe('bytes 990-999/1000');
    expect(await readBody(res)).toEqual(bytes.subarray(990));
  });

  test('suffix range (mp4 moov probe) and 416', async () => {
    const handle = handler();
    const suffix = await handle(requestFor(localAudioUrlFromPath(filePath), { Range: 'bytes=-8' }));
    expect(suffix.status).toBe(206);
    expect(await readBody(suffix)).toEqual(bytes.subarray(992));

    const denied = await handle(requestFor(localAudioUrlFromPath(filePath), { Range: 'bytes=5000-' }));
    expect(denied.status).toBe(416);
    expect(denied.headers.get('content-range')).toBe('bytes */1000');
  });

  test('refuses paths outside the watched folder and missing files', async () => {
    const handle = handler();
    const outside = await handle(requestFor(localAudioUrlFromPath(path.join(os.tmpdir(), 'not-watched.mp3'))));
    expect(outside.status).toBe(403);

    const missing = path.join(dir, 'gone.mp3');
    const res = await handle(requestFor(localAudioUrlFromPath(missing)));
    expect(res.status).toBe(404);
  });

  test('retries a transient read error instead of failing the seek', async () => {
    const real = fs.promises.open;
    let failuresLeft = 2;
    const spy = jest.spyOn(fs.promises, 'open').mockImplementation(async (p, flags) => {
      const handle = await real.call(fs.promises, p, flags);
      const origRead = handle.read.bind(handle);
      handle.read = async (buf, off, len, pos) => {
        if (failuresLeft > 0) {
          failuresLeft -= 1;
          const err = new Error('Input/output error');
          err.code = 'EIO';
          throw err;
        }
        return origRead(buf, off, len, pos);
      };
      return handle;
    });

    try {
      const handle = handler({ chunkSize: 1000 });
      const res = await handle(requestFor(localAudioUrlFromPath(filePath), { Range: 'bytes=0-99' }));
      expect(res.status).toBe(206);
      expect(await readBody(res)).toEqual(bytes.subarray(0, 100));
      expect(failuresLeft).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  test('cancel stops the read instead of buffering the rest of the file', async () => {
    let reads = 0;
    const real = fs.promises.open;
    const spy = jest.spyOn(fs.promises, 'open').mockImplementation(async (p, flags) => {
      const handle = await real.call(fs.promises, p, flags);
      const origRead = handle.read.bind(handle);
      handle.read = async (...args) => {
        reads += 1;
        return origRead(...args);
      };
      return handle;
    });

    try {
      const handle = handler({ chunkSize: 64 });
      const res = await handle(requestFor(localAudioUrlFromPath(filePath)));
      const reader = res.body.getReader();
      const first = await reader.read();
      expect(first.done).toBe(false);
      expect(first.value.byteLength).toBe(64);
      await reader.cancel();
      // Give the cancel path a tick to close the fd. A seek on a network
      // mount must not keep pulling the previous range.
      await new Promise(r => setTimeout(r, 20));
      const readsAtCancel = reads;
      await new Promise(r => setTimeout(r, 30));
      expect(reads).toBe(readsAtCancel);
      expect(reads).toBeLessThan(10);
    } finally {
      spy.mockRestore();
    }
  });

  test('a stalled open is a 503, not a 404', async () => {
    const spy = jest.spyOn(fs.promises, 'open').mockImplementation(async () => {
      const err = new Error('stale NFS file handle');
      err.code = 'ESTALE';
      throw err;
    });
    try {
      const handle = handler();
      const res = await handle(requestFor(localAudioUrlFromPath(filePath)));
      expect(res.status).toBe(503);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('isTransientFsError', () => {
  test('network-mount stalls are transient; a missing file is not', () => {
    expect(isTransientFsError(Object.assign(new Error('x'), { code: 'ESTALE' }))).toBe(true);
    expect(isTransientFsError(Object.assign(new Error('x'), { code: 'EIO' }))).toBe(true);
    expect(isTransientFsError(Object.assign(new Error('x'), { code: 'ENOENT' }))).toBe(false);
  });
});
