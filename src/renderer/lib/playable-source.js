// src/renderer/lib/playable-source.js: whether a source is one to play from.
//
// A source a plug-in found can be purchase-only: the track is there to buy,
// but the service won't stream it. Bandcamp marks a buy-only track this way
// (`streamable: false`, plug-in 1.5.0; Radiohead's own "Nude"). Such a source
// is kept like any found source (the track-sources cache stores it, and the
// playbar's Buy comes from it, lib/purchase-source.js), but nothing that plays
// may use it: source selection and its fallbacks, the "Play from" menu, the
// source icons (lib/visible-sources.js), the row's playable or greyed state,
// and the checks that decide a track needs no more resolving. It is the
// per-source version of a plug-in the account's plan can't play
// (lib/playback-limits.js, `playbackResolvers`).
//
// One rule: `streamable === false` means not playable. Anything else a source
// carries (or a flag it lacks, as every source from before 1.5.0 does) leaves
// it playable. `{ noMatch: true }` sentinels are not sources at all.
//
// Pure; loads under plain Node.

'use strict';

// A real answer from a plug-in: an object that isn't a no-match sentinel.
function isFoundSource(source) {
  return !!source && typeof source === 'object' && !source.noMatch;
}

// A found source the app can play from.
function isPlayableSource(source) {
  return isFoundSource(source) && source.streamable !== false;
}

module.exports = { isFoundSource, isPlayableSource };
