/**
 * MPRIS Linux media-key + DE-widget integration (parachord#848).
 *
 * Exposes a small wrapper around @jellybrick/mpris-service that
 *   - Initializes the org.mpris.MediaPlayer2.parachord bus name on Linux
 *   - Forwards desktop-environment control events (play/pause/skip/seek
 *     from playerctl, KDE Plasma media widget, GNOME, etc.) to the
 *     renderer via the `onControl` callback
 *   - Pushes renderer-side state updates (track metadata, playback state,
 *     shuffle/loop, position) out via D-Bus
 *
 * No-op on non-Linux platforms. If the underlying dep can't load for any
 * reason (missing D-Bus on the system, dep not installed, etc.) the
 * factory returns null rather than throwing — main.js gates on the
 * return value.
 *
 * Position handling is event-driven, not polled: MPRIS clients read the
 * current position via property getter (handled by mpris-service
 * internally from the value passed to updatePosition), so we only need
 * to push on state-change events (play / pause / track change / explicit
 * seek). Continuous position polling would just generate D-Bus traffic
 * for no benefit.
 */

'use strict';

let MprisPlayer = null;
try {
  MprisPlayer = require('@jellybrick/mpris-service');
} catch (err) {
  // Fall through — factory will return null. Loading can fail on
  // platforms without dbus development headers or systems without a
  // running session bus. Logged once at init time.
  MprisPlayer = null;
  module.exports._loadError = err.message;
}

/**
 * Build an mpris:trackid D-Bus object path from an arbitrary track id.
 * The spec requires a valid D-Bus object path; anything non-alphanumeric
 * gets normalized to `_`.
 */
const buildTrackId = (rawId) => {
  const safe = String(rawId || 'unknown')
    .replace(/[^A-Za-z0-9]/g, '_')
    .slice(0, 100);
  return `/com/parachord/track/${safe || 'unknown'}`;
};

/**
 * Convert a length in seconds (renderer-side native unit) to MPRIS
 * microseconds (spec's native unit).
 */
const secondsToMicros = (seconds) => {
  if (typeof seconds !== 'number' || !isFinite(seconds) || seconds < 0) return 0;
  return Math.round(seconds * 1_000_000);
};

const microsToSeconds = (micros) => {
  if (typeof micros !== 'number' || !isFinite(micros)) return 0;
  return micros / 1_000_000;
};

/**
 * Map renderer-side loop mode strings to MPRIS LoopStatus values.
 * Renderer uses: 'none' | 'track' | 'playlist'
 * MPRIS spec uses: 'None' | 'Track' | 'Playlist' (capitalized)
 */
const mapLoopToMpris = (value) => {
  switch (value) {
    case 'track': return 'Track';
    case 'playlist': return 'Playlist';
    default: return 'None';
  }
};

const mapLoopFromMpris = (value) => {
  switch (value) {
    case 'Track': return 'track';
    case 'Playlist': return 'playlist';
    default: return 'none';
  }
};

/**
 * Create the MPRIS player wrapper. Returns null on non-Linux or if the
 * dep failed to load.
 *
 * @param {Object} opts
 * @param {function({action, position?, value?}): void} opts.onControl
 *   Called when a DE control event arrives. Renderer dispatches to its
 *   own handlers via the existing handle{Play,Pause,Next,Previous,Seek}
 *   refs.
 * @returns {Object|null}
 */
function createMprisPlayer({ onControl } = {}) {
  if (process.platform !== 'linux') return null;
  if (!MprisPlayer) {
    console.warn('[MPRIS] @jellybrick/mpris-service not loaded; skipping init');
    return null;
  }
  if (typeof onControl !== 'function') {
    throw new Error('createMprisPlayer: onControl callback is required');
  }

  let player;
  try {
    // @jellybrick/mpris-service exports a Player class (not a factory).
    // Forgetting `new` here used to throw `TypeError: Class constructor
    // Player cannot be invoked without 'new'`, which the catch below
    // silently swallowed — the service registered nothing on DBus and
    // moop250's KDE Plasma widget was reading metadata from a different
    // player entirely (e.g. Spotify desktop). Initial v0.9.4 ship had
    // this bug; #848 follow-up.
    player = new MprisPlayer({
      name: 'parachord',
      identity: 'Parachord',
      supportedUriSchemes: ['parachord', 'spotify', 'file', 'https'],
      supportedMimeTypes: ['audio/mpeg', 'audio/flac', 'audio/ogg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav'],
      supportedInterfaces: ['player']
    });
  } catch (err) {
    console.warn('[MPRIS] Failed to initialize player:', err.message);
    return null;
  }

  // Capability flags — what the DE widget should offer.
  // canSeek is intentionally false for v1: the renderer's `handleSeek`
  // isn't ref-exposed today (lives inside the dj-tools context), so
  // wiring SetPosition / Seek would require refactoring the seek path.
  // Without canSeek, DE widgets render the progress bar as a read-only
  // indicator instead of an interactive slider that would silently
  // fail. Follow-up to wire seek via a new handleSeekRef.
  player.canPlay = true;
  player.canPause = true;
  player.canSeek = false;
  player.canGoNext = true;
  player.canGoPrevious = true;
  player.canControl = true;

  // Initialize shuffle + loop properties explicitly so DE widgets see
  // them as supported. The MPRIS spec has no canShuffle / canLoop
  // capability flag, so widgets infer support from whether the
  // properties have been written. Without these writes, KDE Plasma
  // greys out the shuffle and repeat controls (parachord#848 follow-
  // up). Parachord has no app-level loop mode today, so loopStatus
  // stays 'None'; updateLoop() is a no-op until that ships.
  player.shuffle = false;
  player.loopStatus = 'None';

  // ── Inbound: forward DE control events to renderer ───────────────
  // Each event is forwarded as a structured object so the renderer-side
  // switch can route by action name. Logs every received event for
  // remote-debug-friendliness — Linux-only feature with limited local
  // verification, so external testers' terminal output is the main
  // diagnostic surface.
  const safeControl = (event) => {
    console.log(`[MPRIS] received control: ${event?.action || JSON.stringify(event)}`);
    try { onControl(event); }
    catch (err) { console.warn('[MPRIS] onControl threw:', err.message); }
  };

  player.on('play', () => safeControl({ action: 'play' }));
  player.on('pause', () => safeControl({ action: 'pause' }));
  player.on('playpause', () => safeControl({ action: 'playpause' }));
  player.on('next', () => safeControl({ action: 'next' }));
  player.on('previous', () => safeControl({ action: 'previous' }));
  player.on('stop', () => safeControl({ action: 'stop' }));

  // Absolute SetPosition (the e.position is microseconds per MPRIS spec)
  player.on('position', (e) => {
    safeControl({ action: 'seek', position: microsToSeconds(e?.position || 0) });
  });

  // Relative Seek (delta in microseconds; positive = forward)
  player.on('seek', (deltaMicros) => {
    safeControl({ action: 'seek-relative', delta: microsToSeconds(deltaMicros || 0) });
  });

  player.on('shuffle', (shuffle) => safeControl({ action: 'set-shuffle', value: !!shuffle }));
  player.on('loopStatus', (status) => safeControl({ action: 'set-loop', value: mapLoopFromMpris(status) }));

  console.log('[MPRIS] Registered as org.mpris.MediaPlayer2.parachord');

  // ── Outbound: state update helpers ───────────────────────────────

  /**
   * Update the track metadata. Pass null to clear (no track playing).
   *
   * @param {Object|null} track - { id, title, artist, album, albumArt, duration }
   */
  const updateTrack = (track) => {
    if (!track) {
      player.metadata = {};
      return;
    }
    const metadata = {
      'mpris:trackid': buildTrackId(track.id),
      'mpris:length': secondsToMicros(track.duration),
    };
    if (track.albumArt && typeof track.albumArt === 'string') {
      metadata['mpris:artUrl'] = track.albumArt;
    }
    if (track.title) metadata['xesam:title'] = String(track.title);
    if (track.album) metadata['xesam:album'] = String(track.album);
    if (track.artist) metadata['xesam:artist'] = [String(track.artist)];
    player.metadata = metadata;
  };

  /**
   * Update playback state. Accepts renderer-side strings:
   *   'playing' / 'paused' / 'stopped'
   */
  const updatePlaybackState = (state) => {
    switch (state) {
      case 'playing': player.playbackStatus = 'Playing'; break;
      case 'paused': player.playbackStatus = 'Paused'; break;
      case 'stopped': player.playbackStatus = 'Stopped'; break;
      default: /* leave unchanged */ break;
    }
  };

  /**
   * Push current position (seconds). Emits the MPRIS Seeked signal so
   * DE widgets re-read the progress bar.
   */
  const updatePosition = (positionSeconds) => {
    player.position = secondsToMicros(positionSeconds);
    try { player.seeked(player.position); } catch { /* ignore */ }
  };

  const updateShuffle = (shuffle) => {
    player.shuffle = !!shuffle;
  };

  const updateLoop = (loop) => {
    player.loopStatus = mapLoopToMpris(loop);
  };

  const destroy = () => {
    try {
      // mpris-service doesn't expose a clean destroy; the D-Bus
      // connection tears down with the process. No-op for now.
    } catch { /* ignore */ }
  };

  return {
    updateTrack,
    updatePlaybackState,
    updatePosition,
    updateShuffle,
    updateLoop,
    destroy,
  };
}

module.exports = createMprisPlayer;
module.exports.createMprisPlayer = createMprisPlayer;
