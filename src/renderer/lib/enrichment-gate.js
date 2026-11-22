// src/renderer/lib/enrichment-gate.js: when resolveTrack skips the
// cross-resolver fill for a track with a local file (#1532).
//
// The gate (`hasLocalSource` in resolveTrack, docs/architecture/playback.md
// "Cross-Resolver Enrichment") exists because resolving a whole local library
// at once fired one search per file on every enabled service, nearly all
// returning nothing: a minute of pinwheel for 376 FLACs. It still applies to
// every resolution that isn't for something on screen: the scheduler's
// background pass over the collection, queue and pool look-ahead, the
// re-resolve after a library change. A track the user is looking at
// resolves like any other, so it shows every source it has up front:
//   - a row a page's scheduler context reports visible ('page'), or the
//     hovered row ('hover'): the Songs tab, a playlist, an artist's tracks,
//     search, history;
//   - a track of the album page that is open (resolveAlbumTrack).
// The idle trickle bypasses the gate too (`forceEnrichment`), one track per
// 10 seconds while the window is in the background.
//
// And a track that starts playing with a local file as its only playable
// source fills once (`needsPlayFill`): played from the queue, Collection
// Radio, a link or listen-along it was never on screen, so nothing else asks
// its other services, and the playbar's "Play from" picker, which lists only
// the playing track's own sources, had nothing to offer. What the fill finds
// joins the playing track through `mergeFoundSources`.
//
// Pure; loads under plain Node.

'use strict';

const ON_SCREEN_CONTEXT_TYPES = new Set(['page', 'hover']);

// Whether a scheduler resolution (its third callback argument) is for a row
// on screen.
const isOnScreenResolution = (info) => !!info && ON_SCREEN_CONTEXT_TYPES.has(info.contextType);

// Whether resolveTrack skips the missing-resolver fill for this track.
const skipsLocalFill = ({ hasLocalSource, forceEnrichment, onScreen }) =>
  !!hasLocalSource && !forceEnrichment && !onScreen;

// Whether a track that just started playing should fill its other sources:
// every playable source it has is a local file. `isLocal(id)` and
// `isPlayable(source)` are the app's own tests (isLocalResolver,
// lib/playable-source.js).
const needsPlayFill = (track, { isLocal, isPlayable }) => {
  const sources = track && track.sources;
  if (!sources || typeof sources !== 'object' || Array.isArray(sources)) return false;
  const playable = Object.keys(sources).filter((id) => isPlayable(sources[id]));
  return playable.length > 0 && playable.every((id) => isLocal(id));
};

// The playing track's sources with what the fill found added: real sources
// only (no misses), and never replacing one the track already has.
const mergeFoundSources = (current, found) => {
  const out = { ...(current || {}) };
  for (const [id, source] of Object.entries(found || {})) {
    // A source is an object; resolveTrack's `__noMatchAll: true` marker isn't.
    if (!source || typeof source !== 'object' || source.noMatch || out[id]) continue;
    out[id] = source;
  }
  return out;
};

module.exports = { isOnScreenResolution, skipsLocalFill, needsPlayFill, mergeFoundSources, ON_SCREEN_CONTEXT_TYPES };
