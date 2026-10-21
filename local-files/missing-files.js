// local-files/missing-files.js — find and remove library rows whose file is
// gone, on the user's request (parachord#1002, part 3).
//
// scanner.scanFolder refuses to delete anything when a scan of a folder that
// has tracks comes back empty: an unmounted drive or an offline share looks
// exactly like that, and wiping the library on every disconnect is worse
// than keeping a few dead rows. That guard stays. It also means a folder the
// user emptied on purpose keeps its rows forever, so this is the explicit
// path: the user asks, we check each file, show the count, and only then
// delete.
//
// The same reasoning applies here, so a watch folder whose ROOT cannot be
// read is skipped entirely (reported as unreachable, nothing in it is
// called missing), and only a definite ENOENT/ENOTDIR counts as missing: a
// permission error or a timeout on a network mount is "unknown" and kept.
// Removal re-checks every path, because files can come back between the
// count and the confirm.
//
// Filesystem access is injected so jest drives it without a disk
// (tests/local-files/missing-files.test.js).

const path = require('path');

// The watch folder a file belongs to: the longest folder path that contains
// it. Null for a row outside every watch folder (left alone).
function folderFor(filePath, folders) {
  let best = null;
  for (const folder of folders) {
    const prefix = folder.endsWith(path.sep) ? folder : folder + path.sep;
    if (filePath.startsWith(prefix) && (!best || folder.length > best.length)) best = folder;
  }
  return best;
}

// Runs `fn` over `items` with at most `limit` in flight; results in order.
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// { missing: string[], unreachableFolders: string[], checked: number }
//   folders     watch folder paths
//   filePaths   every file path in the library
//   folderReadable(folder) → Promise<boolean>
//   fileStatus(filePath)   → Promise<'present' | 'missing' | 'unknown'>
async function findMissingFiles({ folders, filePaths, folderReadable, fileStatus, concurrency = 32 }) {
  const readable = new Map();
  for (const folder of folders) {
    readable.set(folder, await folderReadable(folder).catch(() => false));
  }
  const unreachableFolders = folders.filter((f) => !readable.get(f));
  const toCheck = filePaths.filter((p) => {
    const folder = folderFor(p, folders);
    return folder !== null && readable.get(folder);
  });
  const statuses = await mapLimit(toCheck, concurrency, (p) => fileStatus(p).catch(() => 'unknown'));
  const missing = toCheck.filter((_, i) => statuses[i] === 'missing');
  return { missing, unreachableFolders, checked: toCheck.length };
}

// Deletes the rows for `filePaths` that are, right now, still missing:
// known to the library, inside a watch folder whose root is readable, and
// definitely gone. Everything else is kept. { removed: string[], kept: string[] }
async function removeMissingFiles({ filePaths, folders, isKnown, folderReadable, fileStatus, removeTrack }) {
  const removed = [];
  const kept = [];
  const readable = new Map();
  for (const filePath of filePaths) {
    const folder = typeof filePath === 'string' && isKnown(filePath) ? folderFor(filePath, folders) : null;
    if (!folder) { kept.push(filePath); continue; }
    if (!readable.has(folder)) readable.set(folder, await folderReadable(folder).catch(() => false));
    if (!readable.get(folder)) { kept.push(filePath); continue; }
    const status = await fileStatus(filePath).catch(() => 'unknown');
    if (status !== 'missing') { kept.push(filePath); continue; }
    removeTrack(filePath);
    removed.push(filePath);
  }
  return { removed, kept };
}

module.exports = { folderFor, mapLimit, findMissingFiles, removeMissingFiles };
