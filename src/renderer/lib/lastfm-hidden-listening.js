// src/renderer/lib/lastfm-hidden-listening.js — recognise a Last.fm profile
// that hides its recent listening.
//
// With "Hide recent listening information" turned on, user.getRecentTracks
// answers 403 with Last.fm error 17 ("Login: User required to be logged in")
// to everyone except the account's owner. Signing the request with the
// viewer's own session doesn't get past it (checked 2026-10-27 against a
// friend's hidden profile: signed and unsigned both answer error 17), while
// the same profile's top tracks, top artists, weekly charts and loved tracks
// still answer. So the friend poll treats it as "hides recent listening" and
// says so, instead of as a broken account that quietly goes stale.
//
// Pure, so jest drives it directly
// (tests/renderer/lastfm-hidden-listening.test.js).

const LASTFM_LOGIN_REQUIRED = 17;

// True when a user.getRecentTracks response (HTTP status + parsed JSON body)
// means the profile hides its recent listening.
function isLastfmHiddenListening(status, body) {
  return status === 403 && Number(body && body.error) === LASTFM_LOGIN_REQUIRED;
}

module.exports = {
  isLastfmHiddenListening,
  LASTFM_LOGIN_REQUIRED,
};
