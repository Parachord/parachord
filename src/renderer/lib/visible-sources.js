// src/renderer/lib/visible-sources.js — which source icons a track row shows,
// in what order, and which are dimmed. One rule for every track list (the
// queue drawer, Collection, the playlist view, Search, album rows), which used
// to carry their own copies and drifted: the queue showed an icon for every
// key of track.sources, `noMatch` sentinels and plan-blocked services included.
//
// The rule (docs/architecture/playback.md "Playback limits" and "Match
// Confidence + Selection Floor"):
//   1. merge track.sources with trackSources[track.id] (the live resolutions
//      win per resolver);
//   2. drop entries that aren't sources: missing values, `{ noMatch: true }`
//      sentinels, and the UI's `__noMatchAll: true` marker;
//   3. keep only the resolvers that can play on this account
//      (`playbackResolvers`, never `activeResolvers`), and only sources that
//      play: a purchase-only one (`streamable: false`, a buy-only Bandcamp
//      track; lib/playable-source.js) shows no icon, so a row whose only
//      source is purchase-only is 'unplayable' below;
//   4. sort by the user's resolver order, leftmost plays first; a resolver
//      not in the order goes last;
//   5. dim a low-confidence match: a confidence below getBestSourceConfidence,
//      or none at all (an unscored source is not a validated match). Collection
//      used to read a missing confidence as 1 and not dim it; every other list
//      dimmed it.
//
// sourceRowState adds the row's state (resolving / unplayable / playable),
// so every list dims a track that came back with nothing it can play.
//
// Pure, no React, loads under plain Node.

const { isPlayableSource } = require('./playable-source');

// The absolute confidence below which a source's icon renders dimmed. The
// historical implementation returned the per-track best (relative-dim model: a
// 0.95 fuzzy-validated match rendered dimmed when a sibling resolver had a 1.0
// direct-ID match), which misled users into reading "dimmed" as "wrong" — the
// dimmed match was nearly always correct, just lower-confidence than a
// sibling. Flipped to the absolute model on 2026-05-08: dim only when strictly
// below 0.95. Since the upstream MIN_CONFIDENCE_THRESHOLD = 0.6 floor drops
// sub-floor results before they reach `track.sources`, in normal operation the
// only values present are 0.95 (fuzzy validated) and 1.0 (direct-ID), so
// nothing dims unless a resolver explicitly returned a non-standard sub-0.95
// confidence. The signature (takes `sources`, returns a number) is kept so the
// badge call sites compare against `bestConf` unchanged; the argument is
// ignored.
const getBestSourceConfidence = (_sources) => 0.95;

const isSource = (value) => !!value && typeof value === 'object' && !value.noMatch;

// Steps 1 and 2: the track's real sources, merged with the live resolutions.
function mergedSources(track, trackSources) {
  const live = (track && track.id != null && trackSources && trackSources[track.id]) || {};
  const merged = { ...((track && track.sources) || {}), ...live };
  return Object.fromEntries(Object.entries(merged).filter(([, v]) => isSource(v)));
}

// Whether the row has heard anything back yet: false while nothing at all has
// been written for it (show the "resolving" shimmer), true once any entry,
// real or a no-match sentinel, has arrived (show icons, or nothing).
function hasResolutionResult(track, trackSources) {
  const live = (track && track.id != null && trackSources && trackSources[track.id]) || {};
  return Object.keys((track && track.sources) || {}).length > 0 || Object.keys(live).length > 0;
}

// Steps 1 to 5. Returns [{ resolverId, source, dim }], leftmost first.
// `playbackResolvers` not given (not an array) means no plan filter.
function visibleSources(track, { trackSources, playbackResolvers, resolverOrder } = {}) {
  const sources = mergedSources(track, trackSources);
  const order = Array.isArray(resolverOrder) ? resolverOrder : [];
  const rank = (id) => {
    const i = order.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const bestConf = getBestSourceConfidence(sources);
  return Object.keys(sources)
    .filter((id) => !Array.isArray(playbackResolvers) || playbackResolvers.includes(id))
    .filter((id) => isPlayableSource(sources[id]))
    .sort((a, b) => rank(a) - rank(b))
    .map((resolverId) => {
      const source = sources[resolverId];
      return { resolverId, source, dim: (source.confidence || 0) < bestConf };
    });
}

// A row's source state, one rule for every list:
//   'resolving'  — nothing has come back yet: the shimmer;
//   'unplayable' — resolution came back and nothing is shown (no match
//                  anywhere, or only services the plan can't play): the row is
//                  dimmed, with no icons and no shimmer;
//   'playable'   — at least one icon.
// Returns { shown, state }, shown being visibleSources' list.
function sourceRowState(track, opts = {}) {
  const shown = visibleSources(track, opts);
  const state = shown.length > 0
    ? 'playable'
    : (hasResolutionResult(track, opts.trackSources) ? 'unplayable' : 'resolving');
  return { shown, state };
}

module.exports = {
  sourceRowState,
  getBestSourceConfidence,
  mergedSources,
  hasResolutionResult,
  visibleSources
};
