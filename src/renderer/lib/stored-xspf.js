// A playlist's saved XSPF text (`playlist.xspf`), only while it still lists
// the playlist's own tracks.
//
// A renderer save writes the text from `tracks`, so the two agree then. A sync
// pull doesn't: the main process applies the service's tracks to `tracks`
// (sync-engine/auto-pull.js applyPulledTracks) and has no XSPF writer, so the
// text keeps the list from the last renderer save. Opening the playlist parsed
// that text first and showed the old list (Daily Brew showed Nov 19's tracks
// on Nov 22, after that morning's pull had landed), and Export wrote it.
//
// So `tracks` is the playlist, and the text is used only when it agrees with
// them (an export then keeps the file's own fields) or is all there is (a
// playlist saved before `tracks` was stored). Compared by
// sync-engine/auto-pull.js tracksFingerprint: artist and title in order, so a
// resolved source or a cover added to a track doesn't make the text stale.

const { tracksFingerprint } = require('../../../sync-engine/auto-pull');

/**
 * @param {object} playlist  a stored playlist record
 * @param {(xml: string) => ({ tracks: object[] } | null)} parse  app.js's parseXSPF
 * @returns {string|null} the saved text to use, or null to use `playlist.tracks`
 */
function storedXspfFor(playlist, parse) {
  const xspf = playlist && playlist.xspf;
  if (typeof xspf !== 'string' || !xspf) return null;
  const stored = Array.isArray(playlist.tracks) ? playlist.tracks : [];
  if (stored.length === 0) return xspf;
  let parsed = null;
  try { parsed = parse(xspf); } catch { parsed = null; }
  if (!parsed || !Array.isArray(parsed.tracks)) return null;
  return tracksFingerprint(parsed.tracks) === tracksFingerprint(stored) ? xspf : null;
}

module.exports = { storedXspfFor };
