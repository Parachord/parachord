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

module.exports = {
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
