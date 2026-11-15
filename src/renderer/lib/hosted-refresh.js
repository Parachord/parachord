// src/renderer/lib/hosted-refresh.js: what a re-import of a playlist link does
// to the tracks it already has.
//
// Parachord can only read a hosted XSPF from its server; it can't push changes
// back to the source. The person can still edit the playlist here, and if it's
// synced to other services those edits go to the mirrors and stay until the
// next update at the link replaces them. Android and iOS do the same
// (HostedXspfService: the poll replaces tracks only on a content change).
//
// So a re-import (the launch reload, the 5-minute poll, a manual check) keeps
// the local tracks unless the link's tracklist changed since the last import.
// "Changed" compares tracklists, not the document text: a service link's copy
// is regenerated with a new date on every lookup, so its text never matches.
// Tracks are compared by artist and title, folded like trackSlug
// (playlist-freshness.js `trackKeysOf`); ids, sources and albums don't count.
//
// Pure, no React, loads under plain Node.

const { trackKeysOf } = require('../../../playlist-freshness');

// Whether the link's tracklist differs from the one imported last time.
// Nothing imported before (no stored copy) counts as a change.
function linkTracksChanged(previousLinkTracks, linkTracks) {
  if (!Array.isArray(previousLinkTracks)) return true;
  const before = trackKeysOf({ tracks: previousLinkTracks });
  const after = trackKeysOf({ tracks: Array.isArray(linkTracks) ? linkTracks : [] });
  if (before.length !== after.length) return true;
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return true;
  }
  return false;
}

// The tracks a re-import leaves on the record, and whether the link changed.
// existing: the stored playlist (or null); previousLinkTracks: the tracks of
// the copy imported last time (parsed from its stored `xspf`), or null;
// linkTracks: what the link holds now.
function refreshedTracks(existing, { previousLinkTracks, linkTracks }) {
  const incoming = Array.isArray(linkTracks) ? linkTracks : [];
  if (!existing || !Array.isArray(existing.tracks)) return { tracks: incoming, changed: true };
  const changed = linkTracksChanged(previousLinkTracks, incoming);
  return { tracks: changed ? incoming : existing.tracks, changed };
}

module.exports = { linkTracksChanged, refreshedTracks };
