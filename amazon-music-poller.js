// Amazon Music playback poller (main-process side).
//
// Extracted from main.js so the state machine is unit-testable. The two races
// this poller used to lose are exactly the kind of integration bug the pure
// decidePollAdvance tests cannot see:
//
//   - Overlapping polls. schedule() uses setInterval, and the advance path
//     awaits haltPlayback (pause + a loadURL of about:blank) — easily longer
//     than the 400ms fast interval. A second poll() firing inside that await
//     read the half-blanked player, decided advance again, and the renderer got
//     two handleNext calls for one track end.
//   - stop() during the halt. A user skip while the poller is inside
//     haltPlayback left the halt running: its about:blank load landed after the
//     new play's track URL and blanked it. The advance signal must die with the
//     poller generation that produced it.
//
// Plus the pause-death latch: a page torn down while paused polls EMPTY with
// lastState PAUSED, then EMPTY with lastState EMPTY (the 'track' action updates
// lastState). Counting only while lastState === 'PAUSED' reset the counter
// every tick after the first, so the grace window never elapsed and the poller
// ran forever. The latch survives the lastState churn.
//
// Also note: a page that dies under a PAUSE the renderer initiated never sees
// this poller at all — the renderer's pause handler stops polling, and resume
// over a blank view replays the track. The latch is for pauses that do not go
// through the renderer (hardware media keys hitting the page, Amazon pausing
// itself, then the page idling the element away).

const {
  playerDurationMs,
  decidePollAdvance,
  shouldPollFaster,
  createStreamBitrateMeter,
  amazonStreamQualityRecord
} = require('./amazon-music-logic');

const POLL_INTERVAL = 2000;
const FAST_POLL_INTERVAL = 400;
const MAX_ERRORS = 5;

function createAmazonMusicPoller({ player, send }) {
  if (!player || typeof player.getPlaybackState !== 'function' || typeof player.haltPlayback !== 'function') {
    throw new Error('createAmazonMusicPoller requires a player with getPlaybackState and haltPlayback');
  }
  const emit = (channel, data = {}) => send(channel, data);

  return {
    // `interval`/`expectedAsin` are read by the amazonmusic-polling-status IPC.
    interval: null,
    expectedAsin: null,
    trackDurationMs: 0,
    lastPositionMs: 0,
    lastState: null,
    pollCount: 0,
    errorCount: 0,
    generation: 0,
    pollInFlight: false,
    pollIntervalMs: POLL_INTERVAL,
    startTimer: null,
    startResolve: null,
    seekSuppressUntil: 0,
    emptyWhilePausedPolls: 0,
    diedWhilePaused: false,
    // Consecutive PLAYING reads of the media element's audio decode counter,
    // paired into the track's median bitrate (createStreamBitrateMeter). A
    // new meter per track in start(); a stale pair across a track boundary
    // would be a garbage measurement.
    qualityMeter: createStreamBitrateMeter(),

    async start({ asin, trackTitle, trackArtist, duration }) {
      console.log('🎵 [Main] Starting Amazon Music polling...');
      this.stop();
      const generation = ++this.generation;
      this.expectedAsin = asin;
      // Resolver duration is seconds (search `t.duration`). Player duration is
      // milliseconds. A zero resolver duration must not wipe the player's.
      this.trackDurationMs = (duration || 0) * 1000;
      this.lastPositionMs = 0;
      this.lastState = null;
      this.pollCount = 0;
      this.errorCount = 0;
      this.seekSuppressUntil = 0;
      this.emptyWhilePausedPolls = 0;
      this.diedWhilePaused = false;
      this.qualityMeter = createStreamBitrateMeter();
      void trackTitle; void trackArtist; // accepted for IPC symmetry; the advance signal carries the reason only

      // Cancellable delay so a quick skip doesn't start a second interval
      // after this sleep returns.
      await new Promise((resolve) => {
        this.startResolve = resolve;
        this.startTimer = setTimeout(() => {
          this.startTimer = null;
          this.startResolve = null;
          resolve();
        }, 1200);
      });
      if (generation !== this.generation || !this.expectedAsin) return;
      await this.poll();
      if (generation !== this.generation || !this.expectedAsin) return;
      this.schedule(POLL_INTERVAL);
    },

    stop() {
      this.generation++;
      if (this.startTimer) {
        clearTimeout(this.startTimer);
        this.startTimer = null;
      }
      if (this.startResolve) {
        const resolve = this.startResolve;
        this.startResolve = null;
        resolve();
      }
      if (this.interval) {
        clearInterval(this.interval);
        this.interval = null;
      }
      this.expectedAsin = null;
      console.log('⏹️ [Main] Amazon Music polling stopped');
    },

    schedule(ms) {
      if (this.interval) clearInterval(this.interval);
      this.pollIntervalMs = ms;
      // setInterval, not setTimeout chaining: poll() drops re-entrant ticks
      // itself (single flight), so a slow poll cannot stack.
      this.interval = setInterval(() => { this.poll(); }, ms);
    },

    noteUserSeek(positionMs) {
      this.seekSuppressUntil = Date.now() + 4000;
      if (typeof positionMs === 'number' && Number.isFinite(positionMs)) {
        this.lastPositionMs = positionMs;
      }
    },

    async poll() {
      if (!this.expectedAsin || this.pollInFlight) return;
      this.pollInFlight = true;
      try {
        this.pollCount++;
        let s;
        try {
          s = await player.getPlaybackState();
          this.errorCount = 0;
        } catch (err) {
          this.errorCount++;
          if (this.errorCount >= MAX_ERRORS) {
            console.error('[Main] Amazon Music polling errors:', err.message);
            emit('amazonmusic-polling-advance', { reason: 'connection-lost' });
            this.stop();
          }
          return;
        }

        const positionMs = s.positionMs || 0;
        const durationMs = playerDurationMs(s.durationMs) || this.trackDurationMs;
        const state = s.state;

        // Measured stream quality (stream-quality.js contract): record the
        // decode counter on every PLAYING read; the meter pairs consecutive
        // samples (steady playhead-vs-wallclock deltas only, so seeks and
        // pauses never form a pair) and reports the track's median once
        // enough steady pairs exist. The player's captured manifest/init params
        // (codec / sample rate / bit depth / channels, from which the SD/HD/
        // Ultra HD tier derives) upgrade the record when available — never
        // fabricated, only what the captured manifest and init segment prove.
        if (state === 'PLAYING' && typeof s.audioDecodedBytes === 'number' && s.audioDecodedBytes > 0) {
          this.qualityMeter.addSample({ wallMs: Date.now(), positionMs, bytes: s.audioDecodedBytes });
        }
        const progress = {
          state,
          positionMs,
          durationMs,
          percentComplete: durationMs > 0 ? (positionMs / durationMs) * 100 : 0,
          asin: s.asin || null
        };
        const kbps = this.qualityMeter.kbps();
        if (kbps) {
          let params = null;
          try {
            params = (typeof player.streamInfo === 'function') ? player.streamInfo(kbps) : null;
          } catch { params = null; }
          progress.streamQuality = amazonStreamQualityRecord(kbps, params) || { bitrate: kbps, origin: 'measured' };
        }
        emit('amazonmusic-polling-progress', progress);

        if (state === 'PLAYING') {
          const wantFast = shouldPollFaster(durationMs, positionMs);
          if (wantFast && this.pollIntervalMs !== FAST_POLL_INTERVAL) {
            this.schedule(FAST_POLL_INTERVAL);
          } else if (!wantFast && this.pollIntervalMs !== POLL_INTERVAL) {
            this.schedule(POLL_INTERVAL);
          }
        }

        // Pause-death latch. Once a paused player reads dead (EMPTY/STOPPED/
        // FINISHED), keep counting every dead poll until a live state returns.
        // Gating the increment on lastState === 'PAUSED' alone used to reset
        // the counter on the second tick — the 'track' action updates lastState
        // to the dead value — so the grace window could never elapse.
        const deadState = state === 'EMPTY' || state === 'STOPPED' || state === 'FINISHED';
        if (deadState && (this.diedWhilePaused || this.lastState === 'PAUSED')) {
          this.diedWhilePaused = true;
          this.emptyWhilePausedPolls++;
        } else {
          this.diedWhilePaused = false;
          this.emptyWhilePausedPolls = 0;
        }

        const decision = decidePollAdvance({
          state,
          positionMs,
          durationMs,
          lastPositionMs: this.lastPositionMs,
          lastState: this.lastState,
          expectedAsin: this.expectedAsin,
          actualAsin: s.asin,
          pollCount: this.pollCount,
          seekSuppress: Date.now() < this.seekSuppressUntil,
          emptyWhilePausedPolls: this.emptyWhilePausedPolls
        });
        if (decision.action === 'advance') {
          console.log(`🎵 [Main] Amazon Music advance (${decision.reason})`);
          const generation = this.generation;
          // Name the play we decided to stop. Capturing it here, not inside
          // haltPlayback, is the guard: a skip that already claimed the view
          // has a newer playGeneration, and an unscoped halt would null that
          // play's ASIN and blank its page. The check below still drops the
          // advance signal if this poller was stopped mid-halt.
          const playGeneration = player.playGeneration;
          await player.haltPlayback(playGeneration).catch(() => {});
          if (generation !== this.generation || !this.expectedAsin) return;
          emit('amazonmusic-polling-advance', { reason: decision.reason });
          this.stop();
          return;
        }
        if (decision.action === 'continue' || decision.updateLast) {
          this.lastPositionMs = positionMs;
          this.lastState = state;
          return;
        }
        if (decision.action === 'wait') return;

        // PAUSED mid-track: user pause (renderer handles it) — just track it
        this.lastState = state;
      } finally {
        this.pollInFlight = false;
      }
    }
  };
}

module.exports = { createAmazonMusicPoller, AMAZON_POLL_INTERVAL: POLL_INTERVAL, AMAZON_FAST_POLL_INTERVAL: FAST_POLL_INTERVAL };
