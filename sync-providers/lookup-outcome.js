// sync-providers/lookup-outcome.js: was a failed track lookup an answer?
//
// resolveTracks sorts a track it couldn't match into `unresolved` (the service
// answered: it doesn't have this) or `unreachable` (the lookup went
// unanswered), and a push holds on the second (sync-engine/push-hold.js,
// #1637). Only a 400 or a 404 is an answer: the query itself was refused, and
// asking again would be refused again, so counting it as unanswered would hold
// the playlist forever. Everything else is unanswered: a rate limit or
// cooldown (no status), 401 and 403 (the sign-in, not the track), 429, 5xx,
// the network.

function failureIsAnswer(status) {
  return status === 400 || status === 404;
}

module.exports = { failureIsAnswer };
