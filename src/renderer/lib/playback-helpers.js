/**
 * Small error-path helper trio, module-scope everywhere (extracted during the
 * slice-3 review per maintainer feedback: the extraction had copied them into
 * the hook and left the app.js originals in place, and two copies of a pure
 * helper are two chances to drift). Both the hook and app.js now require()
 * this single source.
 */

const unsupportedAudioMessage = (ext) => {
  const e = (ext || '').toLowerCase();
  if (e === 'flac' || e === 'wav') {
    return `This ${e.toUpperCase()} file could not be decoded. It may be damaged, incompletely downloaded, or an unusual variant of the format. Hi-res files (24-bit, up to 192 kHz) are supported, so there is no need to downsample; try re-ripping or re-downloading it.`;
  }
  if (e === 'mp3') {
    return 'This MP3 file appears corrupted or uses an unsupported variant. Try re-encoding it with a standard MP3 encoder.';
  }
  if (e === 'ogg' || e === 'oga' || e === 'opus' || e === 'aac' || e === 'm4a') {
    return `This ${e.toUpperCase()} file is corrupted or uses an unsupported variant. Try converting it to FLAC or MP3.`;
  }
  if (e === 'wma' || e === 'aiff' || e === 'aif' || e === 'alac' || e === 'ape' || e === 'dsf' || e === 'dff') {
    return `${e.toUpperCase()} is not supported by the built-in player. Convert it to FLAC (lossless) or MP3.`;
  }
  return `This ${e ? e.toUpperCase() : 'audio'} file uses an unsupported format. Try converting it to FLAC or MP3.`;
};

function dropSubsonicSecrets(record) {
  if (!record || typeof record !== 'object') return;
  delete record.subsonicStreamUrl;
  if (typeof record.albumArt === 'string' && record.albumArt.includes('/rest/getCoverArt')) {
    delete record.albumArt;
  }
};

function playbackDurationSeconds(source, track) {
  const direct = Number(source && source.duration) || Number(track && track.duration) || 0;
  if (direct > 0) return direct;
  const length = Number(track && track.length) || Number(source && source.length) || 0;
  return length > 0 ? Math.max(1, Math.round(length / 1000)) : 0;
}

// Candidate order for handlePlay's source selection (candidates are
// { resolverId, source, priority, confidence }): the preferred resolver (an
// explicit pick) first, then sources the plugin did NOT flag
// `limitedPlayback`, then resolver priority (lower index first), then
// confidence. `limitedPlayback` is a plugin's own forecast that its player
// will probably refuse the source or play only a preview of it (SoundCloud:
// the API's `access` is 'preview' or 'blocked', which the widget plays in full
// 0 of 7 and 1 of 14 times). It never removes a source: with nothing else, it
// still plays, and a refusal takes the usual failure path.
function compareCandidateSources(a, b, preferredResolver) {
  if (preferredResolver) {
    if (a.resolverId === preferredResolver && b.resolverId !== preferredResolver) return -1;
    if (b.resolverId === preferredResolver && a.resolverId !== preferredResolver) return 1;
  }
  const aLimited = !!(a.source && a.source.limitedPlayback);
  const bLimited = !!(b.source && b.source.limitedPlayback);
  if (aLimited !== bLimited) return aLimited ? 1 : -1;
  if (a.priority !== b.priority) return a.priority - b.priority;
  return b.confidence - a.confidence;
}

// A plugin's config from what its settings panel saved. `inMemory` is its entry
// in the app's copy of meta_service_configs, which is empty until the startup
// bulk load has run; a deep link at launch can ask before that, so an empty copy
// falls back to the store rather than answer "not configured".
async function savedPluginConfig(resolverId, inMemory, readStored) {
  if (inMemory) return inMemory;
  try {
    const stored = await readStored();
    return (stored && stored[resolverId]) || {};
  } catch (e) {
    return {};
  }
}

// The resolvers a sources object can actually play. It also holds two things
// that are not sources: `{ noMatch: true }` sentinels (asked, found nothing) and
// the UI's `__noMatchAll: true` marker (every resolver said so, gray the row),
// which reaches handlePlay because rows pass trackSources[id] as track.sources.
// Counting the marker as a source skipped the on-demand resolve and ended at
// "No Enabled Source".
function playableSourceIds(sources) {
  return Object.keys(sources || {}).filter((id) => {
    const source = sources[id];
    return !!source && typeof source === 'object' && !source.noMatch;
  });
}

// Whether the background re-check of a cached entry found something new. Only
// real sources count on either side: a sentinel holds the resolver's id, so
// comparing raw keys read `{ a: noMatch }` against a fresh `{ a: real }` as
// unchanged, kept the sentinel and refreshed its timestamp, and a track rejected
// under older scoring rules stayed that way for as long as it kept being viewed.
function sourcesChangedOnRecheck(cachedSources, freshSources) {
  const ids = (sources) => JSON.stringify(playableSourceIds(sources).sort());
  return ids(cachedSources) !== ids(freshSources);
}

// The track a failed play leaves in the playbar for Play to load again
// (#1295), without the markers of the attempt that failed: the engine it was
// on, the element's owner tag, the fallback flags that strip a source for the
// rest of one attempt, and the placeholder's status. The retry then picks its
// source afresh. A single-source pick has none of these and stays as it was,
// so a manual pick plays the same source again.
function trackToHoldAfterFailure(track) {
  if (!track || typeof track !== 'object') return null;
  const {
    _activeResolver, _streamOwner, _spotifyFallback, _appleMusicFallback, status,
    ...held
  } = track;
  return held;
}

// Offline, a failed play stops on its track instead of skipping (#1297): the
// next track fails the same way, so skipping only runs the queue to its end.
// The signal is the OS's "no network" (navigator.onLine === false). A failed
// request is not: a single service being down rejects with the same "Failed to
// fetch" (see musicbrainz-fetch.js), and the queue should still move past it.
// navigator.onLine can say true behind a dead network, so this catches the
// common case (Wi-Fi off, cable out, Airplane Mode), not every one.
const OFFLINE_PLAY_MESSAGE = "Couldn't start playing. Check your connection and try again.";
function isDeviceOffline(nav) {
  return !!nav && nav.onLine === false;
}

// What Previous does (parachord#1319, the mobile apps' shared rule):
//   'restart'  — start the current track over: more than
//                PREVIOUS_RESTART_AFTER_SECONDS in, or nothing played before it;
//   'previous' — go back to the last track in the play history (also when no
//                track is current: the end of the queue cleared it, and it
//                went to history first, so Previous brings it back);
//   'none'     — nothing to go back to or restart.
const PREVIOUS_RESTART_AFTER_SECONDS = 3;
function previousAction({ hasCurrentTrack, positionSeconds, historyLength }) {
  const hasHistory = historyLength > 0;
  if (!hasCurrentTrack) return hasHistory ? 'previous' : 'none';
  if (!hasHistory) return 'restart';
  return (Number(positionSeconds) || 0) > PREVIOUS_RESTART_AFTER_SECONDS ? 'restart' : 'previous';
}

// Shuffle during a spinoff or Listen Along (parachord#1319, the mobile apps'
// shared rule): refused everywhere, not only on the playbar button. A spinoff
// plays its own pool in order and a Listen Along session plays the friend's
// tracks, so there is no queue of ours to shuffle. The wording is mobile's
// (PlaybackMessages.SHUFFLE_UNAVAILABLE).
const SHUFFLE_UNAVAILABLE_MESSAGE = "Shuffle isn't available during a spinoff or Listen Along";
function shuffleAllowed({ spinoff, listenAlong }) {
  return !spinoff && !listenAlong;
}

// A radio link must have something that plays before it replaces what's
// playing (parachord#1319, the mobile apps' shared rule): the artist-seed path
// probes the first RADIO_SEED_PROBE_COUNT tracks of the similar pool, and with
// none playable it refuses with mobile's wording
// (PlaybackMessages.noPlayableSimilarTracks) and leaves the queue alone.
const RADIO_SEED_PROBE_COUNT = 5;
const noPlayableSimilarTracksMessage = (title) => `Couldn't find a playable track similar to "${title}"`;
// A track the resolver pipeline found somewhere to play (a noMatch entry is a
// lookup that came back empty, not a source).
function hasPlayableSource(track) {
  const sources = (track && track.sources) || {};
  return Object.keys(sources).some(id => sources[id] && !sources[id].noMatch);
}

// Listen Along (parachord#1319), the mobile apps' shared rules
// (parachord-mobile ListenAlongSession):
//   - a poll that fails (offline, rate limit, bad response) is not "the
//     friend stopped": LISTEN_ALONG_FAILED_POLLS_LIMIT failed polls in a row
//     (about a minute at 15 s) count as stopped;
//   - when our song ends and nothing is held, the session waits for the next
//     poll, which decides (listenAlongWaitDecision).
const LISTEN_ALONG_FAILED_POLLS_LIMIT = 4;
const friendTrackKey = (t) => (t ? `${String(t.name || t.title || '').toLowerCase()}|${String(t.artist || '').toLowerCase()}` : null);
// What a poll that finds the friend listening does while the session waits.
// waiting: 'song-ended' (our song finished and the friend's position wasn't
// known) or 'unplayable' (the friend's track couldn't play here).
//   'play'          — the friend is on another track: play it;
//   'not-moved-on'  — our song ended and they're still on it: end the session
//                     ("X hasn't moved on - resuming your queue");
//   'keep-waiting'  — still the track that couldn't play: wait for a change.
function listenAlongWaitDecision({ waiting, playedTrack, polledTrack }) {
  const same = friendTrackKey(playedTrack) === friendTrackKey(polledTrack);
  if (!same) return 'play';
  return waiting === 'song-ended' ? 'not-moved-on' : 'keep-waiting';
}

// Where a restored queue's first track starts (parachord#1319, the mobile
// apps' rule): the position saved beside the queue, unless it's in the first
// RESUME_MIN_SECONDS (barely started) or the last RESUME_END_MARGIN_SECONDS
// (as good as finished), when it starts over. duration is in seconds, and an
// unknown duration only applies the first rule.
const RESUME_MIN_SECONDS = 5;
const RESUME_END_MARGIN_SECONDS = 10;
// The key a saved position belongs to: the track's id, or for a track
// without one (a friend's track from Listen Along, some link plays) its
// artist, title and album. null when there's nothing to key on, so an id-less
// position never matches some other id-less track.
function trackPositionKey(track) {
  if (!track) return null;
  if (track.id) return String(track.id);
  if (!track.artist || !track.title) return null;
  return `${String(track.artist).toLowerCase()}|${String(track.title).toLowerCase()}|${String(track.album || '').toLowerCase()}`;
}
function resumeStartPosition({ position, duration }) {
  const at = Number(position);
  if (!Number.isFinite(at) || at < RESUME_MIN_SECONDS) return 0;
  const length = Number(duration);
  if (Number.isFinite(length) && length > 0 && at > length - RESUME_END_MARGIN_SECONDS) return 0;
  return at;
}

// Repeat off / all / one (parachord#1319 item 1), the mobile apps' shared
// rule (parachord-mobile QueueAdvancePolicy and QueueManager.wrapToStart).
// The button cycles off, all, one, off.
const REPEAT_MODES = ['off', 'all', 'one'];
const REPEAT_UNAVAILABLE_MESSAGE = "Repeat isn't available during a spinoff or Listen Along";
const normalizeRepeatMode = (mode) => (REPEAT_MODES.includes(mode) ? mode : 'off');
function nextRepeatMode(mode) {
  const current = normalizeRepeatMode(mode);
  return REPEAT_MODES[(REPEAT_MODES.indexOf(current) + 1) % REPEAT_MODES.length];
}
// MPRIS LoopStatus, as mpris-player.js passes it: 'none' | 'track' | 'playlist'.
const repeatModeFromLoop = (loop) => (loop === 'track' ? 'one' : loop === 'playlist' ? 'all' : 'off');
const loopFromRepeatMode = (mode) => (mode === 'one' ? 'track' : mode === 'all' ? 'playlist' : 'none');

// What the queue does when it moves. trigger: 'ended' (the track finished),
// 'next' (Next, from anywhere) or 'unplayable' (a track that couldn't play
// was skipped). Returns:
//   'replay' — repeat one and the track ended (Next still moves on, and a
//              track that fails is never replayed);
//   'next'   — play the queue's next playable track;
//   'wrap'   — repeat all at the end of the queue: start the lap again. An
//              unplayable skip wraps only when something played since the
//              queue was set or last wrapped (playedSinceWrap), so a queue
//              where nothing plays can't loop forever;
//   'stop'   — the end of the queue: stop and clear the track.
// The spinoff pool and Listen Along are handled before this is asked.
function advanceAction({ trigger, repeatMode, hasNext, hasCurrent, playedSinceWrap }) {
  if (trigger === 'ended' && repeatMode === 'one' && hasCurrent) return 'replay';
  if (hasNext) return 'next';
  if (repeatMode === 'all' && (trigger !== 'unplayable' || playedSinceWrap)) return 'wrap';
  return 'stop';
}
// Leaving a spinoff or Listen Along goes back to the queue: the track that
// ended was the spinoff's or the friend's, so repeat one doesn't replay it.
const leaveSessionTrigger = (trigger) => (trigger === 'ended' ? 'next' : trigger);

// The lap repeat all wraps is this queue's tracks. A track out of it carries
// _offLap: history from before the queue was replaced, spinoff pool tracks
// and Listen Along tracks. The mark rides with the track between the history,
// the playbar and the queue (Previous moves it there), and comes off when the
// track joins a new queue.
const markOffLap = (track) => (track && !track._offLap ? { ...track, _offLap: true } : track);
function withoutLapMark(track) {
  if (!track || !track._offLap) return track;
  const { _offLap, ...rest } = track;
  return rest;
}
// The wrap: history, the current track and the queue, in that order, minus
// the tracks out of the lap; a track that failed before gets another try.
// With shuffle on the set is shuffled and originalOrder is the rest in played
// order (what turning shuffle off restores). null when there's nothing to wrap.
function repeatLap({ history, current, queue, shuffle, random = Math.random }) {
  const inLap = (t) => t && !t._offLap;
  const fresh = (t) => {
    if (t.status !== 'error') return t;
    const { status, ...rest } = t;
    return rest;
  };
  const all = [
    ...(history || []).filter(inLap),
    ...(inLap(current) ? [current] : []),
    ...(queue || []).filter(inLap),
  ].map(fresh);
  if (all.length === 0) return null;
  const ordered = [...all];
  if (shuffle) {
    for (let i = ordered.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [ordered[i], ordered[j]] = [ordered[j], ordered[i]];
    }
  }
  const [first, ...rest] = ordered;
  return {
    first,
    rest,
    originalOrder: shuffle && rest.length > 1 ? all.filter(t => t !== first) : null,
  };
}

// Play history (#1329, mobile's QueueManager after parachord-mobile#630).
// History is capped at this many entries: it now outlives each queue, so the
// oldest entries from earlier queues are dropped first, and the current lap
// (what repeat all wraps) is never trimmed.
const PLAY_HISTORY_MAX = 200;

// Two tracks are the same play when their ids match; tracks without ids
// compare by title and artist.
function isSameTrack(a, b) {
  if (!a || !b) return false;
  if (a.id || b.id) return a.id === b.id;
  return String(a.title || '').toLowerCase() === String(b.title || '').toLowerCase()
    && String(a.artist || '').toLowerCase() === String(b.artist || '').toLowerCase();
}

// Drop the oldest out-of-lap entries until the history fits; lap entries stay.
function trimPlayHistory(history, max = PLAY_HISTORY_MAX) {
  let excess = (history || []).length - max;
  if (excess <= 0) return history;
  return history.filter((t) => {
    if (excess > 0 && t && t._offLap) { excess--; return false; }
    return true;
  });
}

// The queue moves on: the outgoing track goes on top of history as it is
// (it keeps its lap mark), within the cap.
function pushPlayHistory(history, track, max = PLAY_HISTORY_MAX) {
  if (!track) return history;
  return trimPlayHistory([...(history || []), track], max);
}

// A play from outside the queue's order replaces outgoing with next (a track
// row, a link, the DJ, a new queue): outgoing goes on top of history, out of
// the lap, so Previous reaches it but repeat all doesn't wrap it. Nothing when
// it is the same track played again (a restart, repeat one, a source fallback).
function historyForReplacedTrack(history, outgoing, next, max = PLAY_HISTORY_MAX) {
  if (!outgoing || isSameTrack(outgoing, next)) return history;
  return pushPlayHistory(history, markOffLap(outgoing), max);
}

// The saved queue is restored at launch only when nothing is playing and no
// play has started in this run (#1287, mobile's QueueRestorePolicy.shouldApply
// from parachord-mobile#557). The restore runs after the store read; a play
// that started before that used to be replaced by last session's track,
// paused. Desktop passes playRequested only for a play that started (see the
// restore in app.js for why not a mere request).
function shouldRestoreQueue({ hasCurrentTrack, playRequested }) {
  return !hasCurrentTrack && !playRequested;
}

module.exports = {
  shouldRestoreQueue,
  PLAY_HISTORY_MAX,
  isSameTrack,
  trimPlayHistory,
  pushPlayHistory,
  historyForReplacedTrack,
  REPEAT_MODES,
  REPEAT_UNAVAILABLE_MESSAGE,
  normalizeRepeatMode,
  nextRepeatMode,
  repeatModeFromLoop,
  loopFromRepeatMode,
  advanceAction,
  leaveSessionTrigger,
  markOffLap,
  withoutLapMark,
  repeatLap,
  LISTEN_ALONG_FAILED_POLLS_LIMIT,
  friendTrackKey,
  listenAlongWaitDecision,
  RESUME_MIN_SECONDS,
  RESUME_END_MARGIN_SECONDS,
  resumeStartPosition,
  trackPositionKey,
  RADIO_SEED_PROBE_COUNT,
  noPlayableSimilarTracksMessage,
  hasPlayableSource,
  shuffleAllowed,
  SHUFFLE_UNAVAILABLE_MESSAGE,
  previousAction,
  PREVIOUS_RESTART_AFTER_SECONDS,
  trackToHoldAfterFailure,
  OFFLINE_PLAY_MESSAGE,
  isDeviceOffline,
  unsupportedAudioMessage,
  dropSubsonicSecrets,
  playbackDurationSeconds,
  compareCandidateSources,
  playableSourceIds,
  sourcesChangedOnRecheck,
  savedPluginConfig,
};
