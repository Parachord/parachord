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
// Pure; loads under plain Node.

'use strict';

const ON_SCREEN_CONTEXT_TYPES = new Set(['page', 'hover']);

// Whether a scheduler resolution (its third callback argument) is for a row
// on screen.
const isOnScreenResolution = (info) => !!info && ON_SCREEN_CONTEXT_TYPES.has(info.contextType);

// Whether resolveTrack skips the missing-resolver fill for this track.
const skipsLocalFill = ({ hasLocalSource, forceEnrichment, onScreen }) =>
  !!hasLocalSource && !forceEnrichment && !onScreen;

module.exports = { isOnScreenResolution, skipsLocalFill, ON_SCREEN_CONTEXT_TYPES };
