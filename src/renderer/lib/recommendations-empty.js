// src/renderer/lib/recommendations-empty.js — what the Recommendations page
// says when every configured provider came back with nothing.
//
// ListenBrainz builds its recommendation playlist from a few weeks of listens,
// so a new account has none. The page used to fill that gap with the user's
// own most-played tracks (parachord#1021); now it says so instead. Provider
// sections beyond Last.fm/ListenBrainz (Shuffleupagus, and any other provider)
// simply
// do not appear when they have nothing — this message only names the
// scrobblers because they are the ones whose absence is a waiting game.

function emptyRecommendationsMessage({ hasListenbrainz, hasLastfm } = {}) {
  if (hasListenbrainz && !hasLastfm) {
    return "ListenBrainz hasn't made recommendations for you yet. It builds them from a few weeks of listens, so check back later, or connect Last.fm in Settings for recommendations now.";
  }
  if (hasListenbrainz && hasLastfm) {
    return "Neither ListenBrainz nor Last.fm has recommendations for you yet. ListenBrainz builds them from a few weeks of listens, so check back later.";
  }
  if (hasLastfm) {
    return "Last.fm doesn't have recommendations for you yet. Check back once it has more of your listening history.";
  }
  return "No recommendations right now. Check back once your services have more of your listening history.";
}

module.exports = { emptyRecommendationsMessage };
