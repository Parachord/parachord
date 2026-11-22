// src/renderer/lib/hosted-import-target.js: the stored record a playlist-link
// re-import updates, decided before anything touches React state.
//
// handleImportPlaylistFromUrl used to decide inside a setPlaylists updater
// (`didUpdate = true`) and read the answer as soon as setPlaylists returned.
// React runs an updater at that point only when nothing else is waiting to
// render; at launch something always is, so the answer was "new", and the
// launch reload rebuilt every hosted playlist from its link: local edits
// lost, "modified" set to now, every track counted as added (2026-11-22).
//
// The copy in state comes first (playlistsRef.current: the latest committed
// list), then the one on disk (state can lag a write, or not be loaded yet
// at launch). Matched by link or by id, as the import always matched.
// Pure, loads under plain Node.

function existingHostedRecord({ stateList, diskList, url, id }) {
  const match = (p) => p && (p.sourceUrl === url || p.id === id);
  const inState = Array.isArray(stateList) ? stateList.find(match) : null;
  if (inState) return inState;
  const onDisk = Array.isArray(diskList) ? diskList.find(match) : null;
  return onDisk || null;
}

module.exports = { existingHostedRecord };
