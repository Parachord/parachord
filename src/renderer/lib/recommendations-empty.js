// src/renderer/lib/recommendations-empty.js — what the Recommendations page
// says when no connected service has anything to recommend.
//
// ListenBrainz builds its recommendation playlist from a few weeks of listens,
// so a new account has none. The page used to fill that gap with the user's
// own most-played tracks (parachord#1021); now it says so instead.

function emptyRecommendationsMessage(hasListenbrainz, hasLastfm) {
  if (hasListenbrainz && !hasLastfm) {
    return "ListenBrainz hasn't made recommendations for you yet. It builds them from a few weeks of listens, so check back later, or connect Last.fm in Settings for recommendations now.";
  }
  if (hasListenbrainz && hasLastfm) {
    return "Neither ListenBrainz nor Last.fm has recommendations for you yet. ListenBrainz builds them from a few weeks of listens, so check back later.";
  }
  return "Last.fm doesn't have recommendations for you yet. Check back once it has more of your listening history.";
}

module.exports = { emptyRecommendationsMessage };
