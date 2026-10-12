/**
 * local-audio:// — file playback for the local-files resolver.
 *
 * Shared by the renderer (URL builder, loaded via index.html) and the main
 * process (protocol.handle). Two things in here are load-bearing for seeks,
 * especially on network mounts:
 *
 * 1. The scheme must be registered as `standard` (see main.js). Without that,
 *    Chromium aborts the Range request a seek issues (net::ERR_ABORTED) and
 *    the media element reports MEDIA_ERR_NETWORK — the "file may have been
 *    moved or deleted" dialog — even when the file is fine.
 * 2. The handler must answer that Range request by streaming, not by reading
 *    the whole remainder into one Buffer before returning. An open-ended
 *    `bytes=<offset>-` on a large FLAC is the rest of the file. On SMB/NFS
 *    that single read often fails (EIO, ESTALE, ETIMEDOUT) or doesn't return
 *    a first byte before the media loader gives up. A seek also cancels the
 *    previous request; the stream's cancel() drops the fd so those reads
 *    don't pile up on the mount.
 */
(function () {
  'use strict';

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
    '.aif': 'audio/aiff',
    '.alac': 'audio/mp4'
  };

  // Network filesystems surface these while the mount is briefly stalled.
  // ENOENT is not transient — the file really isn't there.
  const TRANSIENT_FS_CODES = new Set([
    'EIO', 'ETIMEDOUT', 'ESTALE', 'EAGAIN', 'EWOULDBLOCK', 'EBUSY',
    'ENETDOWN', 'ENETUNREACH', 'ENETRESET', 'ECONNRESET', 'ECONNABORTED',
    'EHOSTDOWN', 'EHOSTUNREACH', 'ENOTCONN', 'EPIPE', 'ENODEV', 'ENXIO',
    'EINTR', 'ETXTBSY'
  ]);

  const DEFAULT_CHUNK_SIZE = 256 * 1024;
  const READ_ATTEMPTS = 4;
  const OPEN_ATTEMPTS = 4;

  function isTransientFsError(err) {
    return !!(err && TRANSIENT_FS_CODES.has(err.code));
  }

  function abortError() {
    const err = new Error('The operation was aborted');
    err.name = 'AbortError';
    return err;
  }

  function isAbortError(err, signal) {
    return !!(signal && signal.aborted) || !!(err && (err.name === 'AbortError' || err.code === 'ABORT_ERR'));
  }

  function delay(ms, signal) {
    if (!ms) return Promise.resolve();
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError());
        return;
      }
      const timer = setTimeout(() => {
        if (signal) signal.removeEventListener('abort', onAbort);
        resolve();
      }, ms);
      function onAbort() {
        clearTimeout(timer);
        reject(abortError());
      }
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
  }

  // Fixed host. A standard scheme puts the first path segment in the host,
  // and Chromium lowercases hosts. `local-audio:///Volumes/...` arrives as
  // host `volumes`, the allowlist compares `/volumes/...` to the watch folder
  // `/Volumes/...`, and every local file 403s. The media element reports that
  // as MEDIA_ERR_SRC_NOT_SUPPORTED ("this MP3 appears corrupted").
  const LOCAL_AUDIO_HOST = 'local';

  function encodePathSegments(absPathWithLeadingSlash) {
    return absPathWithLeadingSlash.split('/').map((seg, i) => {
      if (i === 0) return '';
      // Keep "C:" intact. encodeURIComponent would turn it into "C%3A".
      if (/^[A-Za-z]:$/.test(seg)) return seg;
      return encodeURIComponent(seg);
    }).join('/');
  }

  /**
   * Filesystem path → local-audio URL. Percent-encode each segment so
   * spaces, '#', '?', and '%' survive the media element's URL parser.
   * The host is the fixed token `local` so the real path stays in the
   * pathname, which Chromium does not lowercase.
   */
  function localAudioUrlFromPath(filePath) {
    if (!filePath || typeof filePath !== 'string') return '';
    const isUnc = filePath.startsWith('\\\\') || filePath.startsWith('//');
    if (isUnc) {
      const normalized = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
      return 'local-audio://' + LOCAL_AUDIO_HOST + '/unc/' +
        normalized.split('/').map(encodeURIComponent).join('/');
    }
    let normalized = filePath.replace(/\\/g, '/');
    if (/^[A-Za-z]:\//.test(normalized)) normalized = '/' + normalized;
    if (!normalized.startsWith('/')) normalized = '/' + normalized;
    return 'local-audio://' + LOCAL_AUDIO_HOST + encodePathSegments(normalized);
  }

  /**
   * Request URL → filesystem path.
   *
   * Preferred form is `local-audio://local/Volumes/NAS/a.flac` (fixed host,
   * path case preserved). Also accepts the collapsed form Chromium produces
   * from an older `local-audio:///Volumes/...` URL (`local-audio://Volumes/...`),
   * whose first segment has already been lowercased — restoreWatchedPath
   * puts the watch-folder case back before the file is opened.
   */
  function filePathFromLocalAudioUrl(url, platform) {
    const plat = platform || (typeof process !== 'undefined' && process.platform) || 'darwin';
    const raw = String(url || '');
    const withoutScheme = raw.replace(/^local-audio:\/\//i, '');
    const noQuery = withoutScheme.split('?')[0];
    let decoded;
    try {
      decoded = decodeURIComponent(noQuery);
    } catch (_e) {
      decoded = noQuery;
    }
    if (!decoded) {
      throw new Error('empty local-audio path');
    }

    if (decoded === LOCAL_AUDIO_HOST || decoded.startsWith(LOCAL_AUDIO_HOST + '/')) {
      decoded = decoded.slice(LOCAL_AUDIO_HOST.length);
      if (!decoded) throw new Error('empty local-audio path');
    }

    if (plat === 'win32') {
      if (decoded.startsWith('/unc/') || decoded.startsWith('unc/')) {
        return ('\\\\' + decoded.replace(/^\/?unc\//, '')).replace(/\//g, '\\');
      }
      if (/^[A-Za-z]:[\\/]/.test(decoded)) return decoded.replace(/\//g, '\\');
      if (decoded.startsWith('/')) {
        const drive = decoded.match(/^\/([A-Za-z]:[\\/].*)$/);
        if (drive) return drive[1].replace(/\//g, '\\');
        return decoded.replace(/\//g, '\\');
      }
      return ('\\\\' + decoded).replace(/\//g, '\\');
    }

    if (decoded.startsWith('/unc/')) return '/' + decoded.slice('/unc/'.length);
    if (/^[A-Za-z]:[\\/]/.test(decoded)) return decoded;
    if (!decoded.startsWith('/')) decoded = '/' + decoded;
    return decoded;
  }

  /**
   * If `resolvedPath` sits in a watch folder, return the path to open.
   * A lowercased host (`/volumes/...` vs watch folder `/Volumes/...`) is
   * rewritten to the folder's stored case. Returns null when the path is
   * outside every folder.
   */
  function restoreWatchedPath(resolvedPath, folders, sep) {
    const separator = sep || '/';
    const roots = (folders || [])
      .map(folder => (typeof folder === 'string' ? folder : folder && folder.path))
      .filter(Boolean);
    for (const root of roots) {
      if (resolvedPath === root || resolvedPath.startsWith(root + separator)) return resolvedPath;
    }
    const lower = resolvedPath.toLowerCase();
    for (const root of roots) {
      const rootLower = root.toLowerCase();
      const prefixLower = rootLower + separator;
      if (lower === rootLower) return root;
      if (lower.startsWith(prefixLower)) {
        return root + separator + resolvedPath.slice(prefixLower.length);
      }
    }
    return null;
  }

  /**
   * Parse a single Range header against a file size.
   * Returns { start, end } (inclusive) or { error: 'invalid'|'unsatisfiable' }.
   * Multiple ranges: first only (Chromium media never sends multipart ranges).
   */
  function parseByteRange(header, size) {
    if (!header || typeof header !== 'string') return { error: 'invalid' };
    const spec = header.replace(/\s/g, '').replace(/^bytes=/i, '').split(',')[0];
    const match = spec.match(/^(\d*)-(\d*)$/);
    if (!match) return { error: 'invalid' };
    const startStr = match[1];
    const endStr = match[2];
    if (startStr === '' && endStr === '') return { error: 'invalid' };

    let start;
    let end;
    if (startStr === '') {
      const suffix = parseInt(endStr, 10);
      if (!Number.isFinite(suffix) || suffix <= 0) return { error: 'invalid' };
      if (!size) return { error: 'unsatisfiable' };
      start = Math.max(0, size - suffix);
      end = size - 1;
    } else {
      start = parseInt(startStr, 10);
      end = endStr === '' ? size - 1 : parseInt(endStr, 10);
    }
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) return { error: 'invalid' };
    if (!size || start >= size || end < start) return { error: 'unsatisfiable' };
    if (end >= size) end = size - 1;
    return { start, end };
  }

  function mimeFor(filePath, pathImpl) {
    const ext = pathImpl.extname(filePath).toLowerCase();
    return MIME_TYPES[ext] || 'audio/mpeg';
  }

  function createLocalAudioHandler(options) {
    const opts = options || {};
    const fsImpl = opts.fs || (typeof require === 'function' ? require('fs') : null);
    const pathImpl = opts.path || (typeof require === 'function' ? require('path') : null);
    const isPathAllowed = opts.isPathAllowed || (() => true);
    const log = opts.log || function () {};
    const warn = opts.warn || function () {};
    const chunkSize = opts.chunkSize || DEFAULT_CHUNK_SIZE;
    const platform = opts.platform;

    if (!fsImpl || !pathImpl) {
      throw new Error('createLocalAudioHandler requires fs and path');
    }

    async function openWithRetry(filePath, signal) {
      let lastErr;
      for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
        if (signal && signal.aborted) throw abortError();
        try {
          return await fsImpl.promises.open(filePath, 'r');
        } catch (err) {
          lastErr = err;
          if (!isTransientFsError(err) || attempt === OPEN_ATTEMPTS - 1) throw err;
          warn(`[LocalAudio] open retry ${attempt + 1} (${err.code}) ${filePath}`);
          await delay(150 * (attempt + 1), signal);
        }
      }
      throw lastErr;
    }

    return async function handleLocalAudioRequest(request) {
      const signal = request && request.signal;
      let filePath;
      try {
        filePath = filePathFromLocalAudioUrl(request && request.url, platform);
      } catch (_e) {
        return new Response('Bad path', { status: 400 });
      }

      let resolvedPath = pathImpl.resolve(filePath);
      try {
        if (typeof opts.watchFolders === 'function') {
          const folders = opts.watchFolders();
          // null = library service not ready yet; keep the previous behavior
          // of serving the path. An array is the allowlist.
          if (folders != null) {
            const restored = restoreWatchedPath(resolvedPath, folders, pathImpl.sep);
            if (!restored) {
              warn('[LocalAudio] Access denied — file not in a watched folder:', resolvedPath);
              return new Response('Access denied', { status: 403 });
            }
            resolvedPath = restored;
          }
        } else if (isPathAllowed(resolvedPath) === false) {
          warn('[LocalAudio] Access denied — file not in a watched folder:', resolvedPath);
          return new Response('Access denied', { status: 403 });
        }
      } catch (err) {
        warn('[LocalAudio] allowlist check failed:', err && err.message ? err.message : err);
        return new Response('Access denied', { status: 403 });
      }

      let opened = null;
      try {
        opened = await openWithRetry(resolvedPath, signal);
        const stats = await opened.stat();
        if (!stats.isFile()) {
          await opened.close();
          opened = null;
          warn('[LocalAudio] Not a file:', resolvedPath);
          return new Response('Not a file', { status: 404 });
        }

        const size = stats.size;
        const rangeHeader = request.headers && request.headers.get ? request.headers.get('range') : null;
        let start = 0;
        let end = size > 0 ? size - 1 : 0;
        let status = 200;

        if (rangeHeader) {
          const parsed = parseByteRange(rangeHeader, size);
          if (parsed.error) {
            await opened.close();
            opened = null;
            return new Response(null, {
              status: 416,
              headers: { 'Content-Range': `bytes */${size}` }
            });
          }
          start = parsed.start;
          end = parsed.end;
          status = 206;
        }

        const length = size === 0 ? 0 : (end - start + 1);
        const headers = {
          'Content-Type': mimeFor(resolvedPath, pathImpl),
          'Content-Length': String(length),
          'Accept-Ranges': 'bytes',
          // Don't let a failed partial response stick in the HTTP cache and
          // fail the next seek after the mount recovers.
          'Cache-Control': 'no-store'
        };
        if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;

        log(`[LocalAudio] ${status === 206 ? 'Range' : 'Full'} ${start}-${end}/${size} ${resolvedPath}`);

        if (length === 0) {
          await opened.close();
          opened = null;
          return new Response(new Uint8Array(0), { status, headers });
        }

        if (signal && signal.aborted) {
          await opened.close();
          opened = null;
          return new Response(null, { status: 499 });
        }

        const state = {
          handle: opened,
          position: start,
          closed: false,
          emptyReads: 0
        };
        opened = null; // ownership moved to the stream

        const closeState = async () => {
          if (state.closed) return;
          state.closed = true;
          const h = state.handle;
          state.handle = null;
          if (h) {
            try { await h.close(); } catch (_e) { /* already closed */ }
          }
        };

        if (signal) {
          signal.addEventListener('abort', () => { closeState(); }, { once: true });
        }

        const body = new ReadableStream({
          async pull(controller) {
            if (state.closed || (signal && signal.aborted)) {
              await closeState();
              try { controller.close(); } catch (_e) { /* already closed */ }
              return;
            }
            if (state.position > end) {
              await closeState();
              controller.close();
              return;
            }

            const want = Math.min(chunkSize, end - state.position + 1);
            let lastErr = null;
            for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
              if (state.closed || (signal && signal.aborted)) {
                await closeState();
                try { controller.close(); } catch (_e) { /* already closed */ }
                return;
              }
              try {
                const buf = Buffer.allocUnsafe(want);
                const result = await state.handle.read(buf, 0, want, state.position);
                const bytesRead = result.bytesRead || 0;
                if (bytesRead <= 0) {
                  // SMB sometimes returns a short/empty read instead of EIO
                  // while the connection stalls. Retry before treating it as EOF.
                  state.emptyReads += 1;
                  if (state.emptyReads < 3 && state.position <= end) {
                    warn(`[LocalAudio] empty read at ${state.position}, retrying ${resolvedPath}`);
                    await delay(120 * state.emptyReads, signal);
                    continue;
                  }
                  await closeState();
                  controller.close();
                  return;
                }
                state.emptyReads = 0;
                state.position += bytesRead;
                controller.enqueue(Buffer.from(buf.subarray(0, bytesRead)));
                return;
              } catch (err) {
                lastErr = err;
                if (state.closed || isAbortError(err, signal)) {
                  await closeState();
                  try { controller.close(); } catch (_e) { /* already closed */ }
                  return;
                }
                if (!isTransientFsError(err) || attempt === READ_ATTEMPTS - 1) {
                  await closeState();
                  try { controller.error(err); } catch (_e) { /* consumer gone */ }
                  return;
                }
                warn(`[LocalAudio] read retry ${attempt + 1} (${err.code}) at ${state.position} ${resolvedPath}`);
                try {
                  const old = state.handle;
                  state.handle = null;
                  if (old) await old.close();
                } catch (_e) { /* stale fd */ }
                try {
                  await delay(150 * (attempt + 1), signal);
                  state.handle = await openWithRetry(resolvedPath, signal);
                } catch (reopenErr) {
                  if (isAbortError(reopenErr, signal) || state.closed) {
                    await closeState();
                    try { controller.close(); } catch (_e) { /* already closed */ }
                    return;
                  }
                  await closeState();
                  try { controller.error(reopenErr); } catch (_e) { /* consumer gone */ }
                  return;
                }
              }
            }
            await closeState();
            try { controller.error(lastErr || new Error('read failed')); } catch (_e) { /* consumer gone */ }
          },
          cancel() {
            return closeState();
          }
        });

        return new Response(body, { status, headers });
      } catch (err) {
        if (opened) {
          try { await opened.close(); } catch (_e) { /* ignore */ }
        }
        if (isAbortError(err, signal)) {
          return new Response(null, { status: 499 });
        }
        const code = err && err.code;
        if (code === 'ENOENT' || code === 'ENOTDIR') {
          warn('[LocalAudio] File not found:', resolvedPath);
          return new Response('File not found', { status: 404 });
        }
        if (code === 'EACCES' || code === 'EPERM') {
          warn('[LocalAudio] Permission denied:', resolvedPath);
          return new Response('Access denied', { status: 403 });
        }
        warn('[LocalAudio] Error serving file:', resolvedPath, code || (err && err.message) || err);
        // 503 (not 404) so a stalled mount isn't reported as "deleted".
        return new Response('Temporarily unavailable', { status: isTransientFsError(err) ? 503 : 500 });
      }
    };
  }

  const api = {
    MIME_TYPES,
    TRANSIENT_FS_CODES,
    DEFAULT_CHUNK_SIZE,
    isTransientFsError,
    localAudioUrlFromPath,
    filePathFromLocalAudioUrl,
    restoreWatchedPath,
    parseByteRange,
    createLocalAudioHandler
  };

  if (typeof window !== 'undefined') {
    window.localAudioUrlFromPath = localAudioUrlFromPath;
    window.localAudioProtocol = api;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
