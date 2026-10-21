// src/renderer/lib/local-sources.js — spotting `localfiles` sources whose
// file has left the local library (parachord#1002).
//
// A track that resolved to a local file keeps `sources.localfiles` in three
// places: the persisted resolution cache (`cache_track_sources`, 30 days),
// the session's `trackSources`, and the `sources` stored on collection,
// playlist and queue tracks. Nothing used to clear them when the file was
// deleted or its watch folder removed, so the local badge survived and play
// tried a file that was no longer there. The library (the local-files DB,
// whose scanner refuses to treat an unreadable folder as empty) is the
// source of truth: a source whose filePath is not in it is stale.
//
// Pure, so jest drives it directly (tests/renderer/local-sources.test.js).

'use strict';

// The set of file paths in a successfully loaded library. Callers must only
// build it from a load that succeeded: an empty set means "the library is
// empty", which strips every local source.
function libraryFilePaths(tracks) {
  const paths = new Set();
  for (const track of tracks || []) {
    const p = track && (track.filePath || track.sources?.localfiles?.filePath);
    if (typeof p === 'string' && p) paths.add(p);
  }
  return paths;
}

// True only when we know the library (`paths` is a Set) and the source names
// a file that is not in it. A noMatch sentinel, or a source without a
// filePath, is never stale.
function isStaleLocalSource(source, paths) {
  if (!(paths instanceof Set)) return false;
  if (!source || typeof source !== 'object' || source.noMatch) return false;
  const p = source.filePath;
  return typeof p === 'string' && p.length > 0 && !paths.has(p);
}

// `sources` without a stale `localfiles` entry. Returns the SAME object when
// nothing changes, so callers can detect a no-op by identity and skip a
// state update.
function withoutStaleLocalSource(sources, paths) {
  if (!sources || typeof sources !== 'object') return sources;
  if (!isStaleLocalSource(sources.localfiles, paths)) return sources;
  const { localfiles: _stale, ...rest } = sources;
  return rest;
}

// A track (collection, playlist or queue entry) without a stale local
// source on its own `sources`. Same identity rule as above.
function trackWithoutStaleLocalSource(track, paths) {
  if (!track || !track.sources) return track;
  const sources = withoutStaleLocalSource(track.sources, paths);
  return sources === track.sources ? track : { ...track, sources };
}

// Maps a track list, returning the SAME array when no track changed.
function tracksWithoutStaleLocalSources(tracks, paths) {
  if (!Array.isArray(tracks)) return tracks;
  let changed = false;
  const next = tracks.map((track) => {
    const cleaned = trackWithoutStaleLocalSource(track, paths);
    if (cleaned !== track) changed = true;
    return cleaned;
  });
  return changed ? next : tracks;
}

module.exports = {
  libraryFilePaths,
  isStaleLocalSource,
  withoutStaleLocalSource,
  trackWithoutStaleLocalSource,
  tracksWithoutStaleLocalSources,
};
