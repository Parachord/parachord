// Load environment variables from .env file
require('dotenv').config();

// Handle EPIPE errors gracefully (occurs when console.log writes to closed pipe)
process.on('uncaughtException', (error) => {
  if (error.code === 'EPIPE') {
    // Ignore EPIPE errors - these happen when stdout pipe closes
    return;
  }
  // Re-throw other errors
  console.error('Uncaught exception:', error);
});

// Log .env credential status on startup
console.log('=== Parachord Startup ===');
console.log('SPOTIFY_CLIENT_ID:', process.env.SPOTIFY_CLIENT_ID ? '✅ .env' : '⚪ Not in .env (user can configure in Settings)');
console.log('MUSICKIT_DEVELOPER_TOKEN:', process.env.MUSICKIT_DEVELOPER_TOKEN ? '✅ .env' : '⚪ Will generate from .p8 key');
console.log('=========================');


const { app, BrowserWindow, ipcMain, globalShortcut, shell, protocol, Menu, nativeTheme, session } = require('electron');
const path = require('path');
const fs = require('fs');

// Preserve the userData path before changing app.name, since Electron
// derives the userData directory from app.name. Without this, changing
// the name would move the data directory and lose all user settings.
app.setPath('userData', path.join(app.getPath('appData'), 'parachord-desktop'));
app.name = 'Parachord';

// Widevine CDM: load Chrome's CDM on non-macOS platforms so MusicKit JS
// can play full DRM-protected streams (macOS uses native MusicKit instead).
// Note: Linux works out of the box; Windows requires VMP signing (Castlabs fork)
// so this is primarily useful on Linux for now.
if (process.platform !== 'darwin') {
  const localAppData = process.env.LOCALAPPDATA || '';
  const programFiles = process.env.PROGRAMFILES || '';
  const home = process.env.HOME || '';

  const cdmSearchPaths = process.platform === 'win32'
    ? [
        // Chrome
        path.join(localAppData, 'Google', 'Chrome', 'User Data', 'WidevineCdm'),
        path.join(programFiles, 'Google', 'Chrome', 'Application', 'WidevineCdm'),
        // Edge
        path.join(localAppData, 'Microsoft', 'Edge', 'User Data', 'WidevineCdm'),
        // Brave
        path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data', 'WidevineCdm'),
        // Vivaldi
        path.join(localAppData, 'Vivaldi', 'User Data', 'WidevineCdm'),
        // Opera
        path.join(localAppData, 'Opera Software', 'Opera Stable', 'WidevineCdm'),
        // Dia (The Browser Company)
        path.join(localAppData, 'Dia', 'User Data', 'WidevineCdm'),
        path.join(localAppData, 'TheBrowserCompany', 'Dia', 'User Data', 'WidevineCdm'),
      ]
    : [
        // Chrome
        '/opt/google/chrome/WidevineCdm',
        // Chromium
        '/usr/lib/chromium/WidevineCdm',
        // Edge
        '/opt/microsoft/msedge/WidevineCdm',
        // Brave
        '/opt/brave.com/brave/WidevineCdm',
        // Vivaldi
        '/opt/vivaldi/WidevineCdm',
        // Shared / user-local
        path.join(home, '.local', 'lib', 'WidevineCdm'),
      ];

  const cdmLib = process.platform === 'win32' ? 'widevinecdm.dll' : 'libwidevinecdm.so';
  let cdmFound = false;

  for (const searchPath of cdmSearchPaths) {
    try {
      if (!fs.existsSync(searchPath)) continue;

      // CDM structure: <searchPath>/<version>/_platform_specific/<arch>/<lib>
      const versions = fs.readdirSync(searchPath).filter(d => /^\d/.test(d)).sort().reverse();
      for (const version of versions) {
        const arch = process.platform === 'win32'
          ? (process.arch === 'x64' ? 'win_x64' : 'win_x86')
          : (process.arch === 'x64' ? 'linux_x64' : `linux_${process.arch}`);
        const cdmPath = path.join(searchPath, version, '_platform_specific', arch, cdmLib);

        if (fs.existsSync(cdmPath)) {
          console.log(`[Widevine] Found CDM v${version} at: ${cdmPath}`);
          app.commandLine.appendSwitch('widevine-cdm-path', cdmPath);
          app.commandLine.appendSwitch('widevine-cdm-version', version);
          cdmFound = true;
          break;
        }
      }
      if (cdmFound) break;
    } catch (e) {
      // Ignore permission errors etc.
    }
  }

  if (!cdmFound) {
    console.log('[Widevine] CDM not found — install a Chromium-based browser (Chrome, Edge, Brave, etc.) for full Apple Music playback via MusicKit JS');
  }
}

// electron-updater is optional - may not be available in development
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
  console.log('Auto-updater not available:', err.message);
}
const Store = require('electron-store');
const express = require('express');
const WebSocket = require('ws');

const LocalFilesService = require('./local-files');
const { getMusicKitBridge } = require('./musickit-bridge');
const { startMcpServer, stopMcpServer, handleRendererResponse } = require('./services/mcp-server');

// Auto-updater configuration
if (autoUpdater) {
  autoUpdater.autoDownload = false; // Don't download automatically, let user decide
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = true;
}

const store = new Store();
let mainWindow;
let authServer;
const net = require('net');
let wss; // WebSocket server for embed players
let nmIpcServer = null; // IPC socket server for native messaging host
let extensionSocket = null; // Current connected extension (native messaging IPC)
let embedSockets = new Set(); // Connected embed players
let pendingEmbedRequests = new Map(); // requestId -> { ws, resolve }
let localFilesService = null;
let userInitiatedUpdateCheck = false;
let localFilesServiceReady = null; // Promise that resolves when service is ready

// Spotify Playback Polling Service
// Runs in main process to avoid OS timer throttling when app is backgrounded
const spotifyPoller = {
  interval: null,
  recoveryInterval: null,
  token: null,
  expectedTrackUri: null,
  trackTitle: null,
  trackArtist: null,
  errorCount: 0,
  stuckAtZeroCount: 0,
  pollCount: 0,
  lastProgressMs: 0,
  lastKnownDurationMs: 0,
  pendingTrackChange: null,

  POLL_INTERVAL: 20000, // 20 seconds - more reliable for background execution
  RECOVERY_INTERVAL: 30000, // 30 seconds for recovery
  MAX_ERRORS: 3,
  MAX_STUCK_AT_ZERO: 3,

  async start(token, trackUri, trackTitle, trackArtist) {
    console.log('🔄 [Main] Starting Spotify polling...');
    console.log(`   Track: ${trackTitle} by ${trackArtist}`);
    console.log(`   Expected URI: ${trackUri}`);

    this.stop(); // Clear any existing polling

    this.token = token;
    this.expectedTrackUri = trackUri;
    this.trackTitle = trackTitle;
    this.trackArtist = trackArtist;
    this.errorCount = 0;
    this.stuckAtZeroCount = 0;
    this.pollCount = 0;
    this.lastProgressMs = 0;
    this.lastKnownDurationMs = 0;
    this.pendingTrackChange = null;

    // Do an immediate poll, then set up interval
    await this.poll();

    this.interval = setInterval(() => this.poll(), this.POLL_INTERVAL);
  },

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
      this.recoveryInterval = null;
    }
    this.token = null;
    this.expectedTrackUri = null;
    console.log('⏹️ [Main] Spotify polling stopped');
  },

  updateToken(newToken) {
    console.log('🔄 [Main] Updating Spotify token for polling');
    this.token = newToken;
  },

  updateTrack(trackUri, trackTitle, trackArtist) {
    console.log(`🔄 [Main] Updating expected track: ${trackTitle} by ${trackArtist}`);
    this.expectedTrackUri = trackUri;
    this.trackTitle = trackTitle;
    this.trackArtist = trackArtist;
    this.pollCount = 0;
    this.stuckAtZeroCount = 0;
    this.lastProgressMs = 0;
    this.lastKnownDurationMs = 0;
    this.pendingTrackChange = null;
  },

  async poll() {
    if (!this.token || !this.expectedTrackUri) {
      console.log('🔄 [Main] Poll skipped - no token or track URI');
      return;
    }

    this.pollCount++;

    try {
      const response = await fetch('https://api.spotify.com/v1/me/player', {
        headers: { 'Authorization': `Bearer ${this.token}` }
      });

      if (!response.ok) {
        if (response.status === 401) {
          console.log('🔄 [Main] Token expired, requesting refresh...');
          this.sendToRenderer('spotify-polling-token-expired');
          return;
        }
        throw new Error(`Spotify API error: ${response.status}`);
      }

      // Handle 204 No Content (no active playback)
      if (response.status === 204) {
        console.log('🔄 [Main] No active Spotify playback');
        this.sendToRenderer('spotify-polling-advance', { reason: 'no-playback' });
        this.stop();
        return;
      }

      const data = await response.json();
      this.errorCount = 0; // Reset on success

      if (!data.item) {
        console.log('🎵 [Main] Spotify playback ended (no item), signaling advance...');
        this.sendToRenderer('spotify-polling-advance', { reason: 'no-item' });
        this.stop();
        return;
      }

      const currentUri = data.item.uri;
      const progressMs = data.progress_ms;
      const durationMs = data.item.duration_ms;
      const isPlaying = data.is_playing;
      const percentComplete = durationMs > 0 ? (progressMs / durationMs) * 100 : 0;

      // Send progress update to renderer (for UI updates if needed)
      this.sendToRenderer('spotify-polling-progress', {
        progressMs,
        durationMs,
        percentComplete,
        isPlaying,
        currentUri
      });

      // Check if we're still playing the expected track
      if (currentUri === this.expectedTrackUri) {
        const isNearEnd = progressMs >= durationMs - 2000; // Within 2 seconds
        const isAtEnd = progressMs >= durationMs - 100;

        if (isNearEnd && isPlaying) {
          console.log('🎵 [Main] Track ending, signaling advance...');
          this.sendToRenderer('spotify-polling-advance', { reason: 'near-end' });
          this.stop();
        } else if (!isPlaying && (isAtEnd || percentComplete >= 98)) {
          console.log(`🎵 [Main] Track finished (${percentComplete.toFixed(1)}%), signaling advance...`);
          this.sendToRenderer('spotify-polling-advance', { reason: 'finished' });
          this.stop();
        } else if (!isPlaying && progressMs === 0) {
          // Check for track-finished-and-reset scenario
          const effectiveDuration = this.lastKnownDurationMs > 0 ? this.lastKnownDurationMs : durationMs;
          const lastPercentComplete = effectiveDuration > 0 ? (this.lastProgressMs / effectiveDuration) * 100 : 0;

          if (this.lastProgressMs > 0 && lastPercentComplete >= 90) {
            console.log(`🎵 [Main] Track finished (was at ${lastPercentComplete.toFixed(1)}%, now 0%), signaling advance...`);
            this.sendToRenderer('spotify-polling-advance', { reason: 'reset-after-end' });
            this.stop();
          } else {
            this.stuckAtZeroCount++;
            if (this.stuckAtZeroCount >= this.MAX_STUCK_AT_ZERO) {
              console.log(`❌ [Main] Stuck at 0% for too long, signaling advance...`);
              this.sendToRenderer('spotify-polling-advance', { reason: 'stuck-at-zero' });
              this.stop();
            } else {
              console.log(`⏸️ [Main] Paused at 0% (${this.stuckAtZeroCount}/${this.MAX_STUCK_AT_ZERO})`);
            }
          }
        } else {
          // Playing normally
          this.stuckAtZeroCount = 0;
          this.lastProgressMs = progressMs;
          this.lastKnownDurationMs = durationMs;
          this.pendingTrackChange = null;
          console.log(`▶️ [Main] Spotify: ${percentComplete.toFixed(1)}% (${Math.floor(progressMs / 1000)}s / ${Math.floor(durationMs / 1000)}s)`);
        }
      } else {
        // Track changed externally
        console.log(`🔄 [Main] Track URI mismatch (poll #${this.pollCount})`);
        console.log(`   Expected: ${this.expectedTrackUri}`);
        console.log(`   Current:  ${currentUri}`);

        if (this.pollCount <= 2) {
          // Grace period for first few polls
          if (this.pendingTrackChange === null) {
            this.pendingTrackChange = currentUri;
            console.log('   ⏳ First mismatch, waiting for confirmation...');
          } else if (this.pendingTrackChange === currentUri) {
            console.log('   ✅ Track change confirmed');
            this.sendToRenderer('spotify-polling-advance', { reason: 'track-changed' });
            this.stop();
          } else {
            this.pendingTrackChange = currentUri;
          }
        } else {
          console.log('   ✅ Track change detected after grace period');
          this.sendToRenderer('spotify-polling-advance', { reason: 'track-changed' });
          this.stop();
        }
      }

    } catch (error) {
      console.error('[Main] Spotify polling error:', error.message);
      this.errorCount++;

      if (this.errorCount >= this.MAX_ERRORS) {
        console.log('❌ [Main] Too many errors, starting recovery...');
        this.startRecovery();
      }
    }
  },

  startRecovery() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }

    if (this.recoveryInterval) {
      clearInterval(this.recoveryInterval);
    }

    console.log('🔄 [Main] Starting polling recovery...');

    this.recoveryInterval = setInterval(async () => {
      try {
        const response = await fetch('https://api.spotify.com/v1/me/player', {
          headers: { 'Authorization': `Bearer ${this.token}` }
        });

        if (response.ok && response.status !== 204) {
          const data = await response.json();
          if (data.is_playing) {
            console.log('🔄 [Main] Recovery: Spotify responding, restarting polling');
            clearInterval(this.recoveryInterval);
            this.recoveryInterval = null;
            this.errorCount = 0;
            this.interval = setInterval(() => this.poll(), this.POLL_INTERVAL);
          } else {
            console.log('🔄 [Main] Recovery: Spotify not playing, signaling advance');
            this.sendToRenderer('spotify-polling-advance', { reason: 'recovery-not-playing' });
            this.stop();
          }
        } else if (response.status === 401) {
          console.log('🔄 [Main] Recovery: Token expired');
          this.sendToRenderer('spotify-polling-token-expired');
        }
      } catch (error) {
        console.log('🔄 [Main] Recovery: Still unavailable...', error.message);
      }
    }, this.RECOVERY_INTERVAL);
  },

  sendToRenderer(channel, data = {}) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  }
};

// Apple Music Playback Polling Service
// Runs in main process to avoid OS timer throttling when app is backgrounded
const appleMusicPoller = {
  interval: null,
  expectedSongId: null,
  trackTitle: null,
  trackArtist: null,
  trackDuration: 0,
  lastStatus: null,
  lastPosition: 0,
  pollCount: 0,
  playbackConfirmed: false, // Set to true once we've confirmed the expected song started playing

  POLL_INTERVAL: 5000, // 5 seconds - more frequent for native playback

  async start(songId, trackTitle, trackArtist, duration) {
    console.log('🍎 [Main] Starting Apple Music polling...');
    console.log(`   Track: ${trackTitle} by ${trackArtist}`);
    console.log(`   Song ID: ${songId}`);

    this.stop(); // Clear any existing polling

    this.expectedSongId = songId;
    this.trackTitle = trackTitle;
    this.trackArtist = trackArtist;
    this.trackDuration = duration || 0;
    this.lastStatus = null;
    this.lastPosition = 0;
    this.pollCount = 0;
    this.zeroPositionCount = 0; // Track consecutive zero-position polls after playback started
    this.playbackConfirmed = false; // Will be set to true once expected song is detected playing

    // Delay first poll slightly to give MusicKit time to start the new track
    await new Promise(resolve => setTimeout(resolve, 1500));
    await this.poll();

    this.interval = setInterval(() => this.poll(), this.POLL_INTERVAL);
  },

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.expectedSongId = null;
    console.log('⏹️ [Main] Apple Music polling stopped');
  },

  updateTrack(songId, trackTitle, trackArtist, duration) {
    console.log(`🍎 [Main] Updating expected track: ${trackTitle} by ${trackArtist}`);
    this.expectedSongId = songId;
    this.trackTitle = trackTitle;
    this.trackArtist = trackArtist;
    this.trackDuration = duration || 0;
    this.pollCount = 0;
    this.lastPosition = 0;
    this.lastStatus = null;
    this.zeroPositionCount = 0;
    this.playbackConfirmed = false; // Reset confirmation for new track
  },

  async poll() {
    if (!this.expectedSongId) {
      console.log('🍎 [Main] Poll skipped - no expected song ID');
      return;
    }

    this.pollCount++;

    try {
      const bridge = getMusicKitBridge();
      if (!bridge.isReady) {
        console.log('🍎 [Main] MusicKit bridge not ready');
        return;
      }

      const state = await bridge.send('getPlaybackState');
      const status = state?.status;
      const position = state?.position || 0;

      // Use duration from MusicKit if we don't have it (or it's 0)
      // The Swift helper now includes duration from the Song object
      if ((!this.trackDuration || this.trackDuration === 0) && state?.duration) {
        console.log(`🍎 [Main] Using duration from MusicKit: ${state.duration}s`);
        this.trackDuration = state.duration;
      }

      // Send progress update to renderer
      this.sendToRenderer('applemusic-polling-progress', {
        status,
        position,
        duration: this.trackDuration,
        percentComplete: this.trackDuration > 0 ? (position / this.trackDuration) * 100 : 0
      });

      // Detect track ended - MusicKit may report 'stopped' or 'paused' when track finishes
      if (this.lastStatus === 'playing' && (status === 'stopped' || status === 'paused')) {
        // If paused, check if we're at/near the end of the track (genuine end vs user pause)
        if (status === 'paused') {
          const isNearEnd = this.trackDuration > 0 && (this.trackDuration - position) <= 3;
          const isAtEnd = this.trackDuration > 0 && position >= this.trackDuration - 1;
          if (isNearEnd || isAtEnd) {
            console.log(`🍎 [Main] Track paused at end (pos: ${position.toFixed(1)}s, duration: ${this.trackDuration}s), signaling advance...`);
            this.sendToRenderer('applemusic-polling-advance', { reason: 'paused-at-end' });
            this.stop();
            return;
          }
          // Otherwise it's a user pause, don't advance
          console.log(`🍎 [Main] Track paused mid-playback (pos: ${position.toFixed(1)}s), not advancing`);
        } else {
          // Status is 'stopped'
          console.log('🍎 [Main] Track stopped, signaling advance...');
          this.sendToRenderer('applemusic-polling-advance', { reason: 'stopped' });
          this.stop();
          return;
        }
      }

      // Detect near end of track (while still playing)
      if (status === 'playing' && this.trackDuration > 0) {
        const remaining = this.trackDuration - position;
        if (remaining <= 2) { // Within 2 seconds of end
          console.log('🍎 [Main] Track ending soon, signaling advance...');
          this.sendToRenderer('applemusic-polling-advance', { reason: 'near-end' });
          this.stop();
          return;
        }
      }

      // Fallback: If we have duration and position has reached/passed it
      if (this.trackDuration > 0 && position >= this.trackDuration) {
        console.log(`🍎 [Main] Position (${position.toFixed(1)}s) >= duration (${this.trackDuration}s), signaling advance...`);
        this.sendToRenderer('applemusic-polling-advance', { reason: 'position-past-end' });
        this.stop();
        return;
      }

      // Check if Apple Music moved to a different track (song ID or title changed)
      const currentSongId = state?.songId;
      const currentSongTitle = state?.songTitle;

      // First, check if we can confirm playback started for the expected track
      // We need to confirm before we can detect song changes (otherwise we might
      // trigger on a previous track that hasn't been replaced yet)
      if (!this.playbackConfirmed) {
        // Confirm if: song ID matches, OR (title matches AND position > 0 AND playing)
        const songIdMatches = currentSongId && currentSongId === this.expectedSongId;
        const titleMatches = currentSongTitle && this.trackTitle &&
          currentSongTitle.toLowerCase().trim() === this.trackTitle.toLowerCase().trim();
        const isPlaying = status === 'playing' && position > 0;

        if (songIdMatches || (titleMatches && isPlaying)) {
          this.playbackConfirmed = true;
          console.log(`🍎 [Main] Playback confirmed for expected track (songId: ${songIdMatches}, title: ${titleMatches})`);
        } else {
          // Not yet confirmed - skip song-changed detection for now
          // Log if we're still waiting
          if (this.pollCount <= 3) {
            console.log(`🍎 [Main] Waiting for playback to start... (poll ${this.pollCount}, currentSongId: ${currentSongId}, expected: ${this.expectedSongId})`);
          }
        }
      }

      // Only check for song changes AFTER playback has been confirmed
      // This prevents false positives when MusicKit is still switching tracks
      if (this.playbackConfirmed && currentSongId && this.expectedSongId) {
        // Compare catalog song IDs
        if (currentSongId !== this.expectedSongId) {
          console.log(`🍎 [Main] Song ID changed from ${this.expectedSongId} to ${currentSongId}, signaling advance...`);
          this.sendToRenderer('applemusic-polling-advance', { reason: 'song-changed' });
          this.stop();
          return;
        }
      } else if (this.playbackConfirmed && currentSongTitle && this.trackTitle) {
        // Fall back to title comparison if song ID not available
        // Normalize titles for comparison (lowercase, trim)
        const normalizedCurrent = currentSongTitle.toLowerCase().trim();
        const normalizedExpected = this.trackTitle.toLowerCase().trim();
        if (normalizedCurrent !== normalizedExpected) {
          console.log(`🍎 [Main] Song title changed from "${this.trackTitle}" to "${currentSongTitle}", signaling advance...`);
          this.sendToRenderer('applemusic-polling-advance', { reason: 'song-changed' });
          this.stop();
          return;
        }
      }

      // Detect if position wrapped back (track finished - large position drop)
      // This is the primary end-of-track detection when MusicKit doesn't report stopped/paused
      if (this.playbackConfirmed && this.lastPosition > 30 && position < 5) {
        console.log(`🍎 [Main] Position wraparound detected (${this.lastPosition.toFixed(1)}s → ${position.toFixed(1)}s), signaling advance...`);
        this.sendToRenderer('applemusic-polling-advance', { reason: 'position-wraparound' });
        this.stop();
        return;
      }

      // Track consecutive zero-position polls (after playback had been confirmed)
      // This catches cases where Apple Music stops without clear status change
      if (this.playbackConfirmed && position < 1) {
        this.zeroPositionCount++;
        console.log(`🍎 [Main] Position near zero (${position.toFixed(1)}s), consecutive count: ${this.zeroPositionCount}`);
        if (this.zeroPositionCount >= 2) {
          console.log('🍎 [Main] Position stuck at 0 for multiple polls, signaling advance...');
          this.sendToRenderer('applemusic-polling-advance', { reason: 'position-stuck' });
          this.stop();
          return;
        }
      } else if (position > 1) {
        // Reset zero count when position advances
        this.zeroPositionCount = 0;
      }

      this.lastStatus = status;
      this.lastPosition = position;

    } catch (error) {
      console.error('[Main] Apple Music polling error:', error.message);
    }
  },

  sendToRenderer(channel, data = {}) {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, data);
    }
  }
};

// macOS System Volume Monitor
// Polls system output volume and mute state, sends changes to renderer
const systemVolumeMonitor = {
  interval: null,
  lastVolume: null,
  lastMuted: null,
  POLL_INTERVAL: 1000, // 1 second

  start() {
    if (process.platform !== 'darwin') return;
    if (this.interval) return;

    console.log('[SystemVolume] Starting system volume monitoring');
    const { execFile } = require('child_process');

    this.interval = setInterval(() => {
      execFile('osascript', ['-e', 'get volume settings'], { timeout: 2000 }, (error, stdout) => {
        if (error) return;
        // Output: "output volume:70, output muted:false, alert volume:100, input volume:50"
        const volMatch = stdout.match(/output volume:(\d+)/);
        const muteMatch = stdout.match(/output muted:(true|false)/);
        if (!volMatch || !muteMatch) return;

        const volume = parseInt(volMatch[1], 10);
        const muted = muteMatch[1] === 'true';

        if (isNaN(volume)) return;

        if (volume !== this.lastVolume || muted !== this.lastMuted) {
          const wasNull = this.lastVolume === null;
          this.lastVolume = volume;
          this.lastMuted = muted;

          // Don't send the initial reading as a "change"
          if (wasNull) return;

          console.log(`[SystemVolume] Changed: volume=${volume}, muted=${muted}`);
          safeSendToRenderer('system-volume-changed', { volume, muted });
        }
      });
    }, this.POLL_INTERVAL);
  },

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      console.log('[SystemVolume] Stopped monitoring');
    }
  }
};

// Helper to wait for local files service to be ready
async function waitForLocalFilesService() {
  // If already initialized, return immediately
  if (localFilesService?.initialized) return localFilesService;

  // If init promise exists, wait for it
  if (localFilesServiceReady) {
    await localFilesServiceReady;
    return localFilesService;
  }

  // Service not created yet, poll until it's ready
  return new Promise((resolve, reject) => {
    let attempts = 0;
    const maxAttempts = 200; // 10 seconds max wait
    const checkInterval = setInterval(() => {
      attempts++;
      if (localFilesService?.initialized) {
        clearInterval(checkInterval);
        resolve(localFilesService);
      } else if (attempts >= maxAttempts) {
        clearInterval(checkInterval);
        reject(new Error('Timeout waiting for Local Files service'));
      }
    }, 50);
  });
}

// Read the persisted window bounds (parachord#878 splash-jump fix).
//
// Why this exists: the window used to be created at a hardcoded 1400x900
// and shown. On macOS the OS then restored the window to its actual
// last-session size *after* show() — so the splash painted at 1400x900,
// the window resized to the real size a beat later, and the
// viewport-centered splash wordmark visibly "jumped" as the viewport
// dimensions changed under it. (No CSS centering trick can fix that —
// center genuinely moves when the viewport resizes.) Persisting the
// bounds ourselves and applying them in the constructor means the window
// is BORN at its final size, there's no post-show resize, and the splash
// is stable from the first painted frame.
//
// Returns { width, height, x?, y? } or null. x/y are only included when
// the saved position still lands on a currently-connected display
// (guards against a window opening off-screen after a monitor is
// unplugged). Size is clamped to the min dimensions.
function getSavedWindowBounds() {
  try {
    const saved = store.get('window_bounds');
    if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') return null;
    const width = Math.max(1000, Math.round(saved.width));
    const height = Math.max(600, Math.round(saved.height));
    if (typeof saved.x === 'number' && typeof saved.y === 'number') {
      const { screen } = require('electron');
      const onScreen = screen.getAllDisplays().some(d => {
        const wa = d.workArea;
        // The saved rect must overlap this display's work area to count
        // as visible (a partial overlap is fine — the user can drag it
        // back; fully off-screen is the failure we're guarding against).
        return saved.x < wa.x + wa.width &&
               saved.x + width > wa.x &&
               saved.y < wa.y + wa.height &&
               saved.y + height > wa.y;
      });
      if (onScreen) return { x: Math.round(saved.x), y: Math.round(saved.y), width, height };
      return { width, height }; // off-screen position → keep size, let it center
    }
    return { width, height };
  } catch (e) {
    return null;
  }
}

function createWindow() {
  console.log('Creating main window...');
  console.log('Preload path:', path.join(__dirname, 'preload.js'));

  const savedBounds = getSavedWindowBounds();

  mainWindow = new BrowserWindow({
    width: savedBounds?.width || 1400,
    height: savedBounds?.height || 900,
    ...(savedBounds && typeof savedBounds.x === 'number'
      ? { x: savedBounds.x, y: savedBounds.y }
      : {}),
    minWidth: 1000,
    minHeight: 600,
    // Hidden title bar on macOS only — macOS menus live in the system menu bar,
    // so hiding the title bar is purely cosmetic. On Windows, the menu bar is part
    // of the window frame, so we use the default title bar to keep menus accessible.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' } : {}),
    frame: true,
    backgroundColor: '#f3f4f6',
    icon: path.join(__dirname, 'assets/icons/icon512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: false,  // Disabled for security — use BrowserView or iframes instead
      backgroundThrottling: false,  // Prevent renderer throttle/suspension when backgrounded (music player needs this)
      // V8 code cache (parachord#878). Persists compiled bytecode for the
      // 3MB app.js between launches. First cold launch is unchanged (cache
      // populates as a side effect); every subsequent launch skips the
      // parse + compile phase entirely. Real-world saving: ~200-300ms of
      // app.js parse/compile time on a 2020-era machine. Cache lives in
      // ~/Library/Application Support/Parachord/Cache (or platform
      // equivalent) and self-invalidates when app.js content changes.
      v8CacheOptions: 'code',
      // Pass dev/prod signal to the sandboxed preload via process.argv.
      // The preload reads this to decide whether the renderer's console
      // wrapper forwards log/info to the real console (dev) or only to the
      // diagnostic ring buffer (prod). __dirname is not available in
      // sandboxed preloads, hence this argv-based path.
      additionalArguments: [`--parachord-is-dev=${!app.isPackaged}`]
    },
    show: false
  });

  mainWindow.loadFile('index.html');

  let windowShown = false;
  const showWindow = () => {
    if (windowShown || !mainWindow || mainWindow.isDestroyed()) return;
    windowShown = true;
    mainWindow.show();

    // Send any pending protocol URL that was received before window was ready
    if (global.pendingProtocolUrl) {
      console.log('[Protocol] Sending pending URL:', global.pendingProtocolUrl);
      safeSendToRenderer('protocol-url', global.pendingProtocolUrl);
      global.pendingProtocolUrl = null;
    }
  };

  mainWindow.once('ready-to-show', async () => {
    console.log('Window ready to show');
    // Apply dark class before showing to prevent flash of light mode
    try {
      const themePref = store.get('theme_preference');
      const shouldBeDark = themePref === 'dark' ||
        (themePref !== 'light' && nativeTheme.shouldUseDarkColors);
      if (shouldBeDark) {
        await mainWindow.webContents.executeJavaScript(
          "document.documentElement.classList.add('dark')"
        );
      }
    } catch(e) { console.warn('Theme pre-apply failed:', e); }
    showWindow();
  });

  // Fallback: force-show the window after 5 seconds even if ready-to-show
  // never fires (e.g., renderer crash or page load failure).
  setTimeout(() => {
    if (!windowShown) {
      console.warn('⚠️ Window ready-to-show did not fire within 5s — forcing show');
      showWindow();
    }
  }, 5000);

  // Detect renderer crashes and page load failures — auto-recover
  mainWindow.webContents.on('render-process-gone', (event, details) => {
    console.error('💥 Renderer process gone:', details.reason, details.exitCode);
    // Auto-reload on crash (but not on intentional kill/OOM which may recur)
    if (details.reason === 'crashed' || details.reason === 'abnormal-exit') {
      console.log('🔄 Auto-reloading after renderer crash...');
      setTimeout(() => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadFile('index.html');
        }
      }, 1000);
    }
  });
  mainWindow.webContents.on('did-fail-load', (event, errorCode, errorDescription, validatedURL) => {
    console.error('❌ Page failed to load:', errorCode, errorDescription, validatedURL);
    showWindow(); // Show the window so the user sees something
  });
  mainWindow.on('unresponsive', () => {
    console.warn('⚠️ Window became unresponsive — reloading...');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.reload();
    }
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // Handle window.open() calls - needed for MusicKit JS Apple ID sign-in popup
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    // Allow Apple authentication popups to open in new browser windows
    if (url.includes('apple.com') || url.includes('icloud.com') || url.includes('apple.music')) {
      console.log('[MusicKit] Opening Apple auth popup:', url);
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 600,
          height: 700,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
          }
        }
      };
    }

    // For other URLs, open in system browser
    const { shell } = require('electron');
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Persist window bounds so the next launch is BORN at this size — no
  // post-show resize, no splash-wordmark jump (parachord#878). Only save
  // "normal" bounds: when maximized / fullscreen / minimized, getBounds()
  // returns the special-state rect, so we skip and keep the last normal
  // size to restore to. Debounced because resize/move fire continuously
  // during a drag.
  let boundsSaveTimer = null;
  const persistWindowBounds = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized() || mainWindow.isMaximized() || mainWindow.isFullScreen()) return;
    try {
      store.set('window_bounds', mainWindow.getBounds());
    } catch (e) {
      console.warn('Failed to persist window bounds:', e && e.message);
    }
  };
  const scheduleBoundsSave = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(persistWindowBounds, 400);
  };
  mainWindow.on('resize', scheduleBoundsSave);
  mainWindow.on('move', scheduleBoundsSave);
  mainWindow.on('close', () => {
    if (boundsSaveTimer) { clearTimeout(boundsSaveTimer); boundsSaveTimer = null; }
    persistWindowBounds();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('focus', () => {
    localFilesService?.onAppForeground();
    safeSendToRenderer('app-foreground');
  });

  mainWindow.on('blur', () => {
    localFilesService?.onAppBackground();
    safeSendToRenderer('app-background');
  });
}

// Spotify OAuth Server
function startAuthServer() {
  if (authServer) return;

  const expressApp = express();

  // Serve embedded player
  expressApp.get('/embed', (req, res) => {
    const embedPath = path.join(__dirname, 'embed.html');
    console.log('Serving embed from:', embedPath);
    res.sendFile(embedPath, (err) => {
      if (err) {
        console.error('Error serving embed.html:', err);
        res.status(404).send('Embed player not found');
      }
    });
  });

  expressApp.get('/callback', (req, res) => {
    const code = req.query.code;
    const error = req.query.error;

    if (error) {
      // HTML-escape error to prevent XSS via crafted callback URLs
      const safeError = String(error).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      res.send(`
        <html>
          <body style="background: #1e1b4b; color: white; font-family: system-ui; text-align: center; padding: 50px;">
            <h1>❌ Authentication Failed</h1>
            <p>${safeError}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      safeSendToRenderer('spotify-auth-error', error);
      return;
    }

    if (code) {
      res.send(`
        <html>
          <body style="background: #1e1b4b; color: white; font-family: system-ui; text-align: center; padding: 50px;">
            <h1>✅ Success!</h1>
            <p>Spotify authentication successful. You can close this window.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body>
        </html>
      `);

      // Exchange code for token
      exchangeCodeForToken(code);
    }
  });

  // SoundCloud OAuth callback
  expressApp.get('/callback/soundcloud', (req, res) => {
    const code = req.query.code;
    const error = req.query.error;
    const state = req.query.state;

    if (error) {
      // HTML-escape error to prevent XSS via crafted callback URLs
      const safeError = String(error).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      res.send(`
        <html>
          <body style="background: #1e1b4b; color: white; font-family: system-ui; text-align: center; padding: 50px;">
            <h1>❌ Authentication Failed</h1>
            <p>${safeError}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      safeSendToRenderer('soundcloud-auth-error', error);
      return;
    }

    // Verify state parameter to prevent CSRF attacks
    if (soundcloudOAuthState && state !== soundcloudOAuthState) {
      console.error('❌ SoundCloud OAuth state mismatch — possible CSRF attack');
      res.send(`
        <html>
          <body style="background: #1e1b4b; color: white; font-family: system-ui; text-align: center; padding: 50px;">
            <h1>❌ Authentication Failed</h1>
            <p>Security validation failed. Please try again.</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      safeSendToRenderer('soundcloud-auth-error', 'OAuth state mismatch — please try connecting again.');
      soundcloudOAuthState = null;
      return;
    }
    soundcloudOAuthState = null;

    if (code) {
      res.send(`
        <html>
          <body style="background: #1e1b4b; color: #FF5500; font-family: system-ui; text-align: center; padding: 50px;">
            <h1>✅ Success!</h1>
            <p>SoundCloud authentication successful. You can close this window.</p>
            <script>setTimeout(() => window.close(), 2000);</script>
          </body>
        </html>
      `);

      // Exchange code for token
      exchangeSoundCloudCodeForToken(code);
    }
  });

  // Protocol command endpoint for Raycast/external control
  expressApp.get('/protocol', (req, res) => {
    const url = req.query.url;
    if (!url || !url.startsWith('parachord://')) {
      return res.status(400).json({ error: 'Invalid protocol URL' });
    }

    console.log('[Protocol HTTP] Received:', url);

    // Focus the window and send to renderer
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      safeSendToRenderer('protocol-url', url);
      res.json({ success: true, url });
    } else {
      res.status(503).json({ error: 'Parachord not ready' });
    }
  });

  authServer = expressApp.listen(8888, '127.0.0.1', () => {
    console.log('Auth server running on http://127.0.0.1:8888');
  });
}

// Safely send IPC message to the renderer — no-ops if the frame is disposed or window is gone
function safeSendToRenderer(channel, ...args) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, ...args);
    }
  } catch (e) {
    // Renderer frame disposed between check and send — ignore
  }
}

// WebSocket server for embed players (port 9876)
function startExtensionServer() {
  if (wss) return;

  const EXTENSION_PORT = 9876;

  // Create an HTTP server that handles Private Network Access (PNA) preflight
  // requests.  HTTPS pages (like parachord.com/demos) connecting to ws://127.0.0.1
  // trigger a CORS preflight in modern browsers.  Without a proper response the
  // browser silently blocks the WebSocket upgrade.
  const http = require('http');
  const httpServer = http.createServer((req, res) => {
    const origin = req.headers.origin || '*';
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Private-Network': 'true',
      'Access-Control-Max-Age': '86400'
    };

    // Handle CORS / PNA preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    // HTTP POST endpoint for embed buttons (fallback when WebSocket is blocked)
    if (req.method === 'POST' && req.url === '/import') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const message = JSON.parse(body);
          // Reuse the embed message handler with a no-op sendResponse
          const fakeWs = { send: () => {} };
          handleEmbedMessage(fakeWs, {
            type: 'embed',
            action: 'importPlaylist',
            requestId: 'http-' + Date.now(),
            payload: message
          });
          res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } catch (e) {
          res.writeHead(400, { ...corsHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
        }
      });
      return;
    }

    // Health check — also lets embed buttons detect if Parachord is running
    res.writeHead(200, corsHeaders);
    res.end('Parachord WS');
  });

  httpServer.listen(EXTENSION_PORT, '127.0.0.1', () => {
    console.log(`Embed WebSocket server running on ws://127.0.0.1:${EXTENSION_PORT}`);
  });

  wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws) => {
    // Embed players connect here; browser extension now uses native messaging
    embedSockets.add(ws);
    console.log('Embed player connected');

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'embed') {
          handleEmbedMessage(ws, message);
        }
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      embedSockets.delete(ws);
      console.log('Embed player disconnected');
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  wss.on('error', (error) => {
    console.error('Embed server error:', error);
  });
}

// --- Native messaging IPC server ---
// The browser extension communicates via Chrome's native messaging API.
// Chrome spawns native-messaging/host.js which connects here over a local
// IPC socket (Unix socket on macOS/Linux, named pipe on Windows).

function getNativeMessagingSocketPath() {
  if (process.platform === 'win32') {
    return '\\\\.\\pipe\\parachord-native-messaging';
  }
  const os = require('os');
  return path.join(os.homedir(), '.parachord', 'native-messaging.sock');
}

function readLengthPrefixedMessages(stream, callback) {
  let buffer = Buffer.alloc(0);
  let expectedLen = null;

  stream.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);

    while (true) {
      if (expectedLen === null) {
        if (buffer.length < 4) break;
        expectedLen = buffer.readUInt32LE(0);
        buffer = buffer.subarray(4);
      }

      if (buffer.length < expectedLen) break;

      const json = buffer.subarray(0, expectedLen).toString('utf8');
      buffer = buffer.subarray(expectedLen);
      expectedLen = null;

      try {
        callback(JSON.parse(json));
      } catch (e) {
        // Skip malformed messages
      }
    }
  });
}

function sendToExtensionSocket(message) {
  if (!extensionSocket || extensionSocket.destroyed) return;
  const json = JSON.stringify(message);
  const payload = Buffer.from(json, 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  extensionSocket.write(header);
  extensionSocket.write(payload);
}

function startNativeMessagingServer() {
  if (nmIpcServer) return;

  const socketPath = getNativeMessagingSocketPath();

  // Ensure directory exists
  const socketDir = path.dirname(socketPath);
  fs.mkdirSync(socketDir, { recursive: true });

  // Clean up stale socket file (Unix only; named pipes clean themselves on Windows)
  if (process.platform !== 'win32') {
    try { fs.unlinkSync(socketPath); } catch (e) { /* not found — fine */ }
  }

  nmIpcServer = net.createServer((client) => {
    console.log('Native messaging host connected');

    readLengthPrefixedMessages(client, (message) => {
      // The host sends a hello message on connect — use it to register
      if (message.type === '_nm_hello') {
        extensionSocket = client;
        safeSendToRenderer('extension-connected');
        return;
      }

      // Forward all other messages to the renderer
      console.log('Extension message (NM):', message.type, message.event || message.action || message.url || '');
      safeSendToRenderer('extension-message', message);
    });

    client.on('close', () => {
      console.log('Native messaging host disconnected');
      if (extensionSocket === client) {
        extensionSocket = null;
        safeSendToRenderer('extension-disconnected');
      }
    });

    client.on('error', (error) => {
      console.error('Native messaging IPC error:', error.message);
    });
  });

  nmIpcServer.listen(socketPath, () => {
    console.log(`Native messaging IPC server listening on ${socketPath}`);
  });

  nmIpcServer.on('error', (error) => {
    console.error('Native messaging IPC server error:', error);
  });
}

// Register the native messaging host manifest so Chrome can find the host
function registerNativeMessagingHost() {
  try {
    const { install } = require('./native-messaging/install');
    // In packaged builds, native-messaging/ is asarUnpacked so Chrome can spawn it
    const hostAppPath = app.isPackaged ? app.getAppPath().replace('app.asar', 'app.asar.unpacked') : app.getAppPath();
    install(process.execPath, hostAppPath);
  } catch (error) {
    console.error('Failed to register native messaging host:', error.message);
  }
}

// Handle messages from embedded players
async function handleEmbedMessage(ws, message) {
  const { action, requestId, payload } = message;
  console.log('Embed message:', action, requestId || '');

  const sendResponse = (data) => {
    ws.send(JSON.stringify({
      type: 'embed-response',
      requestId,
      ...data
    }));
  };

  switch (action) {
    case 'ping':
      sendResponse({ success: true, parachordVersion: app.getVersion() });
      break;

    case 'getState':
      // Request state from renderer
      if (mainWindow) {
        const requestPromise = new Promise((resolve) => {
          pendingEmbedRequests.set(requestId, { ws, resolve });
          // Timeout after 5 seconds
          setTimeout(() => {
            if (pendingEmbedRequests.has(requestId)) {
              pendingEmbedRequests.delete(requestId);
              resolve({ success: false, error: 'Timeout' });
            }
          }, 5000);
        });
        safeSendToRenderer('embed-get-state', { requestId });
        const result = await requestPromise;
        sendResponse(result);
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'search':
      // Request search from renderer
      if (mainWindow) {
        const requestPromise = new Promise((resolve) => {
          pendingEmbedRequests.set(requestId, { ws, resolve });
          setTimeout(() => {
            if (pendingEmbedRequests.has(requestId)) {
              pendingEmbedRequests.delete(requestId);
              resolve({ success: false, error: 'Timeout' });
            }
          }, 30000); // Longer timeout for search
        });
        safeSendToRenderer('embed-search', { requestId, query: payload?.query });
        const result = await requestPromise;
        sendResponse(result);
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'play':
      if (mainWindow) {
        safeSendToRenderer('embed-play', { track: payload?.track, queue: payload?.queue });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'queue':
      if (mainWindow) {
        safeSendToRenderer('embed-queue', { track: payload?.track });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'pause':
      if (mainWindow) {
        safeSendToRenderer('embed-pause');
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'resume':
      if (mainWindow) {
        safeSendToRenderer('embed-resume');
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'next':
      if (mainWindow) {
        safeSendToRenderer('embed-next');
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'previous':
      if (mainWindow) {
        safeSendToRenderer('embed-previous');
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'setVolume':
      if (mainWindow) {
        safeSendToRenderer('embed-set-volume', { volume: payload?.volume });
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready' });
      }
      break;

    case 'importPlaylist':
      // Import a playlist from embed/button data
      if (mainWindow && payload) {
        // Bring window to front so the user sees the confirmation dialog
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();

        if (payload.xspfUrl) {
          // XSPF URL — let the renderer fetch and parse it
          safeSendToRenderer('protocol-url',
            `parachord://import?url=${encodeURIComponent(payload.xspfUrl)}`
          );
        } else {
          const tracksB64 = Buffer.from(JSON.stringify(payload.tracks || [])).toString('base64');
          safeSendToRenderer('protocol-url',
            `parachord://import?title=${encodeURIComponent(payload.title || 'Imported Playlist')}&creator=${encodeURIComponent(payload.creator || 'Unknown')}&tracks=${encodeURIComponent(tracksB64)}`
          );
        }
        sendResponse({ success: true });
      } else {
        sendResponse({ success: false, error: 'App not ready or missing payload' });
      }
      break;

    default:
      sendResponse({ success: false, error: `Unknown action: ${action}` });
  }
}

// Broadcast playback state updates to all connected embed players
function broadcastToEmbeds(event, data) {
  const message = JSON.stringify({
    type: 'embed-event',
    event,
    ...data
  });
  embedSockets.forEach(ws => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

async function exchangeCodeForToken(code) {
  console.log('=== Exchange Code for Token (PKCE) ===');
  console.log('Code received:', code ? 'Yes' : 'No');

  const { clientId, source } = getSpotifyCredentials();
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
  console.log('Using credentials from:', source);

  if (!spotifyCodeVerifier) {
    console.error('No PKCE code verifier found — did the auth flow start correctly?');
    safeSendToRenderer('spotify-auth-error', 'PKCE code verifier missing. Please try connecting again.');
    return;
  }

  try {
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: spotifyCodeVerifier,
      }),
    });

    // Clear verifier after use (single-use)
    spotifyCodeVerifier = null;

    const data = await response.json();
    console.log('Spotify API response:', data.access_token ? 'Token received' : 'No token', data.error || '');

    if (data.access_token) {
      const expiryTime = Date.now() + (data.expires_in * 1000);
      
      console.log('Saving token to store...');
      store.set('spotify_token', data.access_token);
      store.set('spotify_refresh_token', data.refresh_token);
      store.set('spotify_token_expiry', expiryTime);
      // Record the scopes granted during this auth flow so we can detect
      // stale tokens that lack newer scopes (e.g. library sync scopes).
      if (data.scope) {
        store.set('spotify_token_scopes', data.scope);
      }
      console.log('Token saved. Expiry:', new Date(expiryTime).toISOString());

      // Verify it was saved
      const savedToken = store.get('spotify_token');
      console.log('Verification - token saved:', !!savedToken);

      safeSendToRenderer('spotify-auth-success', {
        token: data.access_token,
        expiresIn: data.expires_in
      });
      console.log('Auth success event sent to renderer');
    } else {
      console.error('No access token in response:', data);
    }
  } catch (error) {
    console.error('Token exchange error:', error);
    safeSendToRenderer('spotify-auth-error', error.message);
  }
}

// SoundCloud token exchange (OAuth 2.1 with PKCE)
async function exchangeSoundCloudCodeForToken(code) {
  console.log('=== SoundCloud Exchange Code for Token ===');
  console.log('Code received:', code ? 'Yes' : 'No');

  // Get credentials with fallback chain: user-stored > env
  const { clientId, clientSecret, source } = getSoundCloudCredentials();
  const redirectUri = 'http://127.0.0.1:8888/callback/soundcloud';
  console.log('Using credentials from:', source);

  // Validate credentials exist
  if (!clientId || !clientSecret) {
    console.error('❌ No SoundCloud credentials configured!');
    safeSendToRenderer('soundcloud-auth-error', 'SoundCloud requires API credentials. Configure them in Settings.');
    return;
  }

  if (!soundcloudCodeVerifier) {
    console.error('No PKCE code verifier found — did the auth flow start correctly?');
    safeSendToRenderer('soundcloud-auth-error', 'PKCE code verifier missing. Please try connecting again.');
    return;
  }

  try {
    const response = await fetch('https://secure.soundcloud.com/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        code_verifier: soundcloudCodeVerifier,
      }),
    });

    // Clear verifier after use (single-use)
    soundcloudCodeVerifier = null;

    const data = await response.json();
    console.log('SoundCloud API response:', data.access_token ? 'Token received' : 'No token', data.error || '');

    if (data.access_token) {
      const expiryTime = Date.now() + (data.expires_in * 1000);

      console.log('Saving SoundCloud token to store...');
      store.set('soundcloud_token', data.access_token);
      store.set('soundcloud_refresh_token', data.refresh_token);
      store.set('soundcloud_token_expiry', expiryTime);
      store.set('soundcloud_last_refresh', Date.now());
      console.log('SoundCloud token saved. Expiry:', new Date(expiryTime).toISOString());

      // Verify it was saved
      const savedToken = store.get('soundcloud_token');
      console.log('Verification - SoundCloud token saved:', !!savedToken);

      safeSendToRenderer('soundcloud-auth-success', {
        token: data.access_token,
        expiresIn: data.expires_in
      });
      console.log('SoundCloud auth success event sent to renderer');
    } else {
      console.error('No access token in SoundCloud response:', data);
      safeSendToRenderer('soundcloud-auth-error', data.error_description || 'Failed to get access token');
    }
  } catch (error) {
    console.error('SoundCloud token exchange error:', error);
    safeSendToRenderer('soundcloud-auth-error', error.message);
  }
}

// Register custom protocol schemes
// Must be called before app is ready
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'local-audio',
    privileges: {
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true
    }
  },
  {
    scheme: 'parachord',
    privileges: {
      secure: true,
      supportFetchAPI: false,
      standard: true
    }
  }
]);

// Handle protocol URLs - forward to renderer
function handleProtocolUrl(url) {
  console.log('[Protocol] Received URL:', url);
  if (mainWindow) {
    // Focus the window
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    // Send to renderer
    safeSendToRenderer('protocol-url', url);
  } else {
    // Store for when window is ready
    global.pendingProtocolUrl = url;
  }
}

// Handle protocol URLs on macOS (before app ready)
app.on('open-url', (event, url) => {
  event.preventDefault();
  if (url.startsWith('parachord://')) {
    handleProtocolUrl(url);
  }
});

// Single instance lock - handle protocol URLs on Windows/Linux
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    // Find protocol URL in argv (Windows/Linux)
    const url = argv.find(arg => arg.startsWith('parachord://'));
    if (url) {
      handleProtocolUrl(url);
    }
    // Focus the window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  console.log('=== Electron App Starting ===');

  // Begin periodic in-app announcements fetch
  startAnnouncementsPolling();

  // Extract mcp-stdio.js to a stable user-data path (parachord#866).
  //
  // AppImage mounts itself at /tmp/.mount_<RANDOMSUFFIX>/ via FUSE on
  // every launch — the suffix is regenerated per run, so resolving the
  // stdio bridge via __dirname produces a path that goes stale the
  // next time Parachord restarts. The MCP client config the user
  // copies from Settings then breaks on next launch.
  //
  // Fix: extract to app.getPath('userData')/mcp-stdio.js — XDG-conformant
  // on Linux (~/.config/Parachord/mcp-stdio.js), stable per-user on
  // every platform, independent of how Parachord was installed
  // (AppImage / .deb / source / Mac / Windows). Cheap — the bridge is a
  // few-KB Node script with no dependencies.
  //
  // Re-copies on every launch so the on-disk file always matches the
  // bundled version (handles upgrades automatically without a version
  // check).
  try {
    const sourceBase = app.isPackaged ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
    const stdioSource = path.join(sourceBase, 'mcp-stdio.js');
    const stdioDest = path.join(app.getPath('userData'), 'mcp-stdio.js');
    fs.copyFileSync(stdioSource, stdioDest);
    console.log(`[MCP] Extracted stdio bridge to ${stdioDest}`);
  } catch (err) {
    // Non-fatal — Settings UI will fall back to __dirname-based path.
    // Logged so we know when this path silently degrades.
    console.warn('[MCP] Failed to extract stdio bridge to userData:', err.message);
  }

  // Register as default handler for parachord:// protocol
  if (process.defaultApp) {
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('parachord', process.execPath, [path.resolve(process.argv[1])]);
    }
  } else {
    app.setAsDefaultProtocolClient('parachord');
  }
  console.log('[Protocol] Registered parachord:// protocol handler');

  // Check if launched with protocol URL in argv (Windows/Linux first launch)
  const protocolUrlArg = process.argv.find(arg => arg.startsWith('parachord://'));
  if (protocolUrlArg) {
    console.log('[Protocol] Found URL in argv:', protocolUrlArg);
    global.pendingProtocolUrl = protocolUrlArg;
  }

  // Register protocol handler for local audio files
  protocol.handle('local-audio', async (request) => {
    try {
      // URL format: local-audio:///path/to/file.mp3
      const filePath = decodeURIComponent(request.url.replace('local-audio://', ''));
      console.log('[LocalAudio] Requested file:', filePath);

      // Security: resolve the real path to prevent directory traversal via symlinks/..
      const resolvedPath = path.resolve(filePath);

      // Validate the file is within a watched folder
      if (localFilesService?.initialized) {
        const watchFolders = localFilesService.getWatchFolders();
        const isInWatchedFolder = watchFolders.some(folder =>
          resolvedPath.startsWith(folder.path + path.sep) || resolvedPath === folder.path
        );
        if (!isInWatchedFolder) {
          console.error('[LocalAudio] Access denied — file not in a watched folder:', resolvedPath);
          return new Response('Access denied', { status: 403 });
        }
      }

      // Verify file exists and get stats
      const stats = await fs.promises.stat(resolvedPath);
      if (!stats.isFile()) {
        console.error('[LocalAudio] Not a file:', resolvedPath);
        return new Response('Not a file', { status: 404 });
      }

      // Get file extension for MIME type
      const ext = path.extname(resolvedPath).toLowerCase();
      const mimeTypes = {
        '.mp3': 'audio/mpeg',
        '.m4a': 'audio/mp4',
        '.aac': 'audio/aac',
        '.wav': 'audio/wav',
        '.flac': 'audio/flac',
        '.ogg': 'audio/ogg',
        '.opus': 'audio/opus',
        '.wma': 'audio/x-ms-wma',
        '.aiff': 'audio/aiff',
        '.alac': 'audio/mp4'
      };
      const mimeType = mimeTypes[ext] || 'audio/mpeg';

      // Handle range requests for seeking
      const rangeHeader = request.headers.get('range');
      if (rangeHeader) {
        const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : stats.size - 1;
          const chunkSize = end - start + 1;

          console.log(`[LocalAudio] Range request: ${start}-${end}/${stats.size}`);

          const fileHandle = await fs.promises.open(resolvedPath, 'r');
          const buffer = Buffer.alloc(chunkSize);
          await fileHandle.read(buffer, 0, chunkSize, start);
          await fileHandle.close();

          return new Response(buffer, {
            status: 206,
            headers: {
              'Content-Type': mimeType,
              'Content-Length': chunkSize.toString(),
              'Content-Range': `bytes ${start}-${end}/${stats.size}`,
              'Accept-Ranges': 'bytes'
            }
          });
        }
      }

      // Full file request
      const buffer = await fs.promises.readFile(resolvedPath);
      console.log(`[LocalAudio] Serving full file: ${buffer.length} bytes`);

      return new Response(buffer, {
        status: 200,
        headers: {
          'Content-Type': mimeType,
          'Content-Length': stats.size.toString(),
          'Accept-Ranges': 'bytes'
        }
      });
    } catch (error) {
      console.error('[LocalAudio] Error serving file:', error);
      return new Response('File not found', { status: 404 });
    }
  });

  // Generate MusicKit developer token from .p8 key.
  // Store the promise so config-get can await it (avoids race with renderer).
  musicKitTokenReady = generateMusicKitDeveloperToken().catch(err => {
    console.error('🍎 MusicKit: Token generation error:', err.message);
    return null;
  });

  createWindow();

  // Explicitly allow all permission requests. This is needed because some
  // Electron versions silently deny HID/USB by default, which blocks Apple's
  // sign-in popup (Touch ID / passkeys) in the auth window. Rather than
  // maintaining a fragile whitelist of permission names (which varies across
  // Electron versions and can inadvertently block page rendering), allow all.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);

  // Apple Music request-header rewrite (parachord#834). Apple's catalog +
  // library APIs accept requests with `Origin: https://beta.music.apple.com`
  // because that's the legitimate Apple Music web client. From a
  // parachord://app origin (or anything else that isn't beta.music.apple.com)
  // the requests fail with 403 even when authentication is otherwise fine,
  // because Apple's edge gates on the Origin / Referer pair. Rewriting these
  // headers — and the `:authority` pseudo-header that Electron's net stack
  // derives from the URL host — makes us look like the real web client.
  //
  // Filter is `apple.com`-broad rather than narrow to a specific path, because
  // the same gate trips on multiple sub-endpoints (catalog lookup, library
  // operations, user-token validation, playback license). Cider's prior art
  // shipping in production confirms this scope is correct. Headers below are
  // a byte-identical mirror of their setup.
  //
  // The auth window also runs on defaultSession (no partition) but its
  // requests are already FROM beta.music.apple.com — Origin would already be
  // beta.music.apple.com, so the rewrite is idempotent on that traffic.
  session.defaultSession.webRequest.onBeforeSendHeaders(async (details, callback) => {
    if (details.url.includes('apple.com')) {
      details.requestHeaders['Origin'] = 'https://beta.music.apple.com';
      details.requestHeaders['Referer'] = 'https://beta.music.apple.com';
      details.requestHeaders['DNT'] = '1';
      // `authority` is the HTTP/2 :authority pseudo-header. Electron exposes
      // it as a regular header here. Forcing it to amp-api.music.apple.com
      // makes Apple's edge route the request like it came from the web app
      // even when the URL host varies (e.g. api.music.apple.com).
      details.requestHeaders['authority'] = 'amp-api.music.apple.com';
      details.requestHeaders['sec-fetch-dest'] = 'empty';
      details.requestHeaders['sec-fetch-mode'] = 'cors';
      details.requestHeaders['sec-fetch-site'] = 'same-site';

      // One endpoint needs explicit Cookie injection: the account-info
      // probe at buy.itunes.apple.com/account/web/info. MusicKit JS reads
      // most cookies from its own localStorage state and includes them in
      // headers itself, but `itspod` for this endpoint specifically lives
      // outside that flow. Pull it from the main window's localStorage if
      // available (will be set after a successful auth-window cookie
      // harvest).
      if (details.url === 'https://buy.itunes.apple.com/account/web/info' && mainWindow && !mainWindow.isDestroyed()) {
        try {
          const itspod = await mainWindow.webContents.executeJavaScript(
            "window.localStorage.getItem('music.ampwebplay.itspod')"
          );
          if (itspod) {
            details.requestHeaders['Cookie'] = `itspod=${itspod}`;
          }
        } catch (e) {
          // Renderer not ready yet, or storage access failed. Proceed without
          // the cookie — the endpoint will 401 and the caller will handle it.
        }
      }
    }
    callback({ requestHeaders: details.requestHeaders });
  });

  // Start background services — wrap each in try/catch so a single
  // failure doesn't prevent the menu from being set up or the window
  // from showing.
  try { startAuthServer(); } catch (e) { console.error('Failed to start auth server:', e.message); }
  try { startExtensionServer(); } catch (e) { console.error('Failed to start extension server:', e.message); }
  try { startNativeMessagingServer(); } catch (e) { console.error('Failed to start native messaging server:', e.message); }
  try { registerNativeMessagingHost(); } catch (e) { console.error('Failed to register native messaging host:', e.message); }
  try { startMcpServer(mainWindow); } catch (e) { console.error('Failed to start MCP server:', e.message); }
  try { systemVolumeMonitor.start(); } catch (e) { console.error('Failed to start system volume monitor:', e.message); }

  // Set up application menu
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        {
          label: `About ${app.name}`,
          click: () => safeSendToRenderer('menu-action', 'open-about')
        },
        { type: 'separator' },
        {
          label: 'Settings...',
          accelerator: 'CmdOrCtrl+,',
          click: () => safeSendToRenderer('menu-action', 'open-settings')
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Playlist',
          accelerator: 'CmdOrCtrl+N',
          click: () => safeSendToRenderer('menu-action', 'new-playlist')
        },
        {
          label: 'Add Friend...',
          click: () => safeSendToRenderer('menu-action', 'add-friend')
        },
        { type: 'separator' },
        {
          label: 'Import Playlist...',
          click: () => safeSendToRenderer('menu-action', 'import-playlist')
        },
        {
          label: 'Export Queue as Playlist...',
          click: () => safeSendToRenderer('menu-action', 'export-playlist')
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },

    // Edit menu
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [
          { role: 'pasteAndMatchStyle' },
          { role: 'delete' },
          { role: 'selectAll' }
        ] : [
          { role: 'delete' },
          { type: 'separator' },
          { role: 'selectAll' }
        ]),
        { type: 'separator' },
        {
          label: 'Find...',
          accelerator: 'CmdOrCtrl+F',
          click: () => safeSendToRenderer('menu-action', 'focus-search')
        }
      ]
    },

    // Playback menu
    {
      label: 'Playback',
      submenu: [
        {
          label: 'Play/Pause',
          // Note: Space accelerator removed - conflicts with text input in chat
          // Use media keys or click the playbar button instead
          click: () => safeSendToRenderer('menu-action', 'play-pause')
        },
        {
          label: 'Previous Track',
          accelerator: 'CmdOrCtrl+Left',
          click: () => safeSendToRenderer('menu-action', 'previous-track')
        },
        {
          label: 'Next Track',
          accelerator: 'CmdOrCtrl+Right',
          click: () => safeSendToRenderer('menu-action', 'next-track')
        },
        { type: 'separator' },
        {
          label: 'Shuffle',
          accelerator: 'CmdOrCtrl+S',
          click: () => safeSendToRenderer('menu-action', 'toggle-shuffle')
        }
      ]
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' }
      ]
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    },

    // Help menu
    {
      label: 'Help',
      submenu: [
        {
          label: 'Check for Updates...',
          click: () => {
            safeSendToRenderer('menu-action', 'check-for-updates');
          }
        },
        { type: 'separator' },
        {
          label: 'Parachord Website',
          click: async () => {
            await shell.openExternal('https://parachord.com');
          }
        },
        {
          label: 'Report an Issue...',
          click: async () => {
            await shell.openExternal('https://github.com/Parachord/parachord/issues');
          }
        },
        {
          // Routes to window.copyDiagnosticLog() in the renderer; see
          // app.js's diagnostic-log buffer block. Lets bug reporters
          // attach a recent-history dump without opening DevTools.
          label: 'Copy Diagnostic Log',
          accelerator: process.platform === 'darwin' ? 'Cmd+Shift+L' : 'Ctrl+Shift+L',
          click: () => {
            safeSendToRenderer('menu-action', 'copy-diagnostic-log');
          }
        },
        { type: 'separator' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  // Auto-updater setup (only if available)
  if (autoUpdater) {
    autoUpdater.on('checking-for-update', () => {
      console.log('🔄 Checking for updates...');
      safeSendToRenderer('updater-status', { status: 'checking' });
    });

    autoUpdater.on('update-available', (info) => {
      console.log('✅ Update available:', info.version);
      userInitiatedUpdateCheck = false;
      safeSendToRenderer('updater-status', {
        status: 'available',
        version: info.version,
        releaseNotes: info.releaseNotes
      });
    });

    autoUpdater.on('update-not-available', () => {
      console.log('✅ App is up to date');
      userInitiatedUpdateCheck = false;
      safeSendToRenderer('updater-status', { status: 'up-to-date' });
    });

    autoUpdater.on('download-progress', (progress) => {
      console.log(`📥 Download progress: ${Math.round(progress.percent)}%`);
      safeSendToRenderer('updater-status', {
        status: 'downloading',
        percent: progress.percent
      });
    });

    autoUpdater.on('update-downloaded', (info) => {
      console.log('✅ Update downloaded:', info.version);
      safeSendToRenderer('updater-status', {
        status: 'downloaded',
        version: info.version
      });
    });

    autoUpdater.on('error', (err) => {
      console.error('❌ Auto-updater error:', err.message);
      // Always forward errors to the renderer so download/install failures
      // are visible. Only suppress the generic startup check errors.
      if (userInitiatedUpdateCheck) {
        userInitiatedUpdateCheck = false;
      }
      safeSendToRenderer('updater-status', {
        status: 'error',
        error: err.message || 'An update error occurred.'
      });
    });

    // Check for updates after a short delay (don't block startup)
    setTimeout(() => {
      autoUpdater.checkForUpdates().catch(err => {
        console.log('Update check skipped:', err.message);
      });
    }, 5000);
  }

  // Initialize Local Files service
  localFilesService = new LocalFilesService(app.getPath('userData'));
  localFilesServiceReady = localFilesService.init().then(() => {
    console.log('Local Files service ready');

    // Set up library change notifications
    localFilesService.setLibraryChangedCallback((changes) => {
      safeSendToRenderer('localFiles:libraryChanged', changes);
    });

    return localFilesService;
  }).catch(err => {
    console.error('Failed to initialize Local Files service:', err);
    throw err;
  });

  // Register media key shortcuts
  globalShortcut.register('MediaPlayPause', () => {
    safeSendToRenderer('media-key', 'playpause');
  });

  globalShortcut.register('MediaNextTrack', () => {
    safeSendToRenderer('media-key', 'next');
  });

  globalShortcut.register('MediaPreviousTrack', () => {
    safeSendToRenderer('media-key', 'previous');
  });

  // Apply saved media key setting on startup
  const savedMediaKeySetting = store.get('media-key-handling') || 'always';
  if (savedMediaKeySetting === 'never') {
    globalShortcut.unregister('MediaPlayPause');
    globalShortcut.unregister('MediaNextTrack');
    globalShortcut.unregister('MediaPreviousTrack');
    mediaKeysRegistered = false;
  }

  // MPRIS init (parachord#848) — Linux-only D-Bus integration so
  // playerctl + DE media widgets (KDE Plasma, GNOME, etc.) see
  // Parachord with full now-playing metadata and can route media keys
  // through the standard MPRIS dispatch. Gated on the same setting as
  // globalShortcut so opting out of media-key capture also silences
  // MPRIS controls (user opts out for a reason — usually Spotify
  // desktop's own MPRIS competing for the same dispatch).
  if (process.platform === 'linux' && savedMediaKeySetting !== 'never') {
    try {
      const createMprisPlayer = require('./mpris-player');
      mprisPlayer = createMprisPlayer({
        onControl: (event) => {
          // Forward DE control to renderer via the existing IPC channel
          safeSendToRenderer('mpris-control', event);
        },
      });
    } catch (err) {
      console.warn('[MPRIS] init failed (non-fatal):', err.message);
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Helper function to pause Spotify playback
const pauseSpotifyPlayback = async () => {
  const token = store.get('spotify_token');
  if (!token) return;

  try {
    const response = await fetch('https://api.spotify.com/v1/me/player/pause', {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (response.ok || response.status === 204) {
      console.log('✅ Spotify playback paused on quit');
    } else if (response.status === 403) {
      // 403 often means no active device or already paused - that's fine
      console.log('ℹ️ Spotify: no active playback to pause');
    } else {
      console.log('⚠️ Spotify pause response:', response.status);
    }
  } catch (err) {
    console.error('Failed to pause Spotify on quit:', err.message);
  }
};

let isQuitting = false;

app.on('before-quit', async (event) => {
  // Prevent multiple quit attempts and ensure we wait for cleanup
  if (isQuitting) return;

  // Prevent default quit to allow async cleanup
  event.preventDefault();
  isQuitting = true;

  // Pause Spotify before quitting
  await pauseSpotifyPlayback();

  // Now actually quit
  app.exit(0);
});

app.on('window-all-closed', async () => {
  globalShortcut.unregisterAll();
  if (authServer) {
    authServer.close();
  }
  if (wss) {
    wss.close();
  }
  if (nmIpcServer) {
    nmIpcServer.close();
    // Clean up socket file on shutdown
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(getNativeMessagingSocketPath()); } catch (e) { /* ignore */ }
    }
  }
  stopMcpServer();
  if (localFilesService) {
    localFilesService.shutdown();
  }
  // Also try to pause Spotify here as a backup
  await pauseSpotifyPlayback();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Media key handling IPC handlers
// Allows renderer to update media key capture settings dynamically
let mediaKeysRegistered = true; // Track current state

// MPRIS (Linux D-Bus media-key + DE widget integration, parachord#848).
// Null on non-Linux or when init failed; methods are gated at call sites.
let mprisPlayer = null;

const registerMediaKeys = () => {
  if (mediaKeysRegistered) return;
  globalShortcut.register('MediaPlayPause', () => {
    safeSendToRenderer('media-key', 'playpause');
  });
  globalShortcut.register('MediaNextTrack', () => {
    safeSendToRenderer('media-key', 'next');
  });
  globalShortcut.register('MediaPreviousTrack', () => {
    safeSendToRenderer('media-key', 'previous');
  });
  mediaKeysRegistered = true;
};

const unregisterMediaKeys = () => {
  if (!mediaKeysRegistered) return;
  globalShortcut.unregister('MediaPlayPause');
  globalShortcut.unregister('MediaNextTrack');
  globalShortcut.unregister('MediaPreviousTrack');
  mediaKeysRegistered = false;
};

ipcMain.handle('media-keys-set-mode', (event, mode) => {
  // mode: 'always' | 'non-spotify' | 'never'
  store.set('media-key-handling', mode);

  if (mode === 'never') {
    unregisterMediaKeys();
  } else if (mode === 'always') {
    registerMediaKeys();
  }
  // 'non-spotify' mode is handled dynamically based on playback source
  return { success: true };
});

ipcMain.handle('media-keys-get-mode', () => {
  return store.get('media-key-handling') || 'always';
});

// Called by renderer when playback source changes (for 'non-spotify' mode)
ipcMain.handle('media-keys-update-playback-source', (event, source) => {
  const mode = store.get('media-key-handling') || 'always';
  if (mode === 'non-spotify') {
    if (source === 'spotify') {
      unregisterMediaKeys();
    } else {
      registerMediaKeys();
    }
  }
  return { success: true };
});

// ── MPRIS state push (parachord#848) ─────────────────────────────
//
// Renderer fires these on track change, play/pause, seek, shuffle/loop
// toggles. Main forwards to the MPRIS wrapper which talks to D-Bus.
// All no-ops when mprisPlayer is null (non-Linux, init failed, or user
// has media-key-handling set to 'never').
ipcMain.handle('mpris:update-track', (event, track) => {
  if (mprisPlayer) mprisPlayer.updateTrack(track);
});

ipcMain.handle('mpris:update-playback-state', (event, state) => {
  if (mprisPlayer) mprisPlayer.updatePlaybackState(state);
});

ipcMain.handle('mpris:update-position', (event, positionSeconds) => {
  if (mprisPlayer) mprisPlayer.updatePosition(positionSeconds);
});

ipcMain.handle('mpris:update-shuffle', (event, shuffle) => {
  if (mprisPlayer) mprisPlayer.updateShuffle(shuffle);
});

ipcMain.handle('mpris:update-loop', (event, loop) => {
  if (mprisPlayer) mprisPlayer.updateLoop(loop);
});

// Crypto utilities for scrobbling (Last.fm requires MD5 signatures)
const crypto = require('crypto');

ipcMain.handle('crypto-md5', (event, input) => {
  return crypto.createHash('md5').update(input).digest('hex');
});

// Fallback API keys for services that support shared app credentials
const FALLBACK_LASTFM_API_KEY = '3b09ef20686c217dbd8e2e8e5da1ec7a';
const FALLBACK_LASTFM_API_SECRET = '37d8a3d50b2aa55124df13256b7ec929';
// Spotify requires BYOK (Bring Your Own Key) — each user must register their own app
// at developer.spotify.com/dashboard due to Spotify's 5-user dev mode limit
// SoundCloud fallback credentials - app's registered OAuth client
const FALLBACK_SOUNDCLOUD_CLIENT_ID = 'O2HcIaRQu87Kbf4CP34FpDi87nR2XTcr';
const FALLBACK_SOUNDCLOUD_CLIENT_SECRET = 'ylYKJ1OW7YKqd3iSPreTc1wTeHcZRAMD';

// PKCE (Proof Key for Code Exchange) helpers for OAuth 2.1 flows
// Used by Spotify and SoundCloud to securely exchange authorization codes.
let spotifyCodeVerifier = null;
let soundcloudCodeVerifier = null;
let soundcloudOAuthState = null;

function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

// MusicKit developer token - generated from .p8 private key at startup
const MUSICKIT_TEAM_ID = 'YR3XETE537';
const MUSICKIT_KEY_ID = '437JVHZMMK';
let generatedMusicKitToken = null;
let musicKitTokenReady = Promise.resolve(null); // resolved by generateMusicKitDeveloperToken()

/**
 * Generate a MusicKit developer token from the bundled .p8 private key.
 * Called at app startup. The token is cached for the process lifetime.
 * Users auth with their own Apple Music subscription via MusicKit JS.
 */
async function generateMusicKitDeveloperToken() {
  // If user set a token via env, skip generation
  if (process.env.MUSICKIT_DEVELOPER_TOKEN) {
    console.log('🍎 MusicKit: Using developer token from environment');
    generatedMusicKitToken = process.env.MUSICKIT_DEVELOPER_TOKEN;
    return generatedMusicKitToken;
  }

  const keyFileName = `AuthKey_${MUSICKIT_KEY_ID}.p8`;

  // Search for .p8 key in known locations
  const searchPaths = [
    path.join(__dirname, 'resources', 'keys', keyFileName),
    path.join(__dirname, 'resources', 'keys'),
    path.join(process.resourcesPath || __dirname, 'keys', keyFileName),
    path.join(process.resourcesPath || __dirname, 'keys'),
  ];

  let keyPath = null;
  for (const searchPath of searchPaths) {
    try {
      const stat = fs.statSync(searchPath);
      if (stat.isFile() && searchPath.endsWith('.p8')) {
        keyPath = searchPath;
        break;
      }
      if (stat.isDirectory()) {
        const files = fs.readdirSync(searchPath);
        const p8File = files.find(f => f.endsWith('.p8'));
        if (p8File) {
          keyPath = path.join(searchPath, p8File);
          break;
        }
      }
    } catch (e) {
      // Path doesn't exist, skip
    }
  }

  if (!keyPath) {
    console.log('🍎 MusicKit: No .p8 private key found — MusicKit JS will require manual token config');
    console.log('🍎 Place your AuthKey_*.p8 file in resources/keys/ for automatic token generation');
    return null;
  }

  try {
    const crypto = require('crypto');
    const privateKeyContent = fs.readFileSync(keyPath, 'utf8').trim();

    // Validate PEM format
    if (!privateKeyContent.startsWith('-----BEGIN PRIVATE KEY-----')) {
      console.error('🍎 MusicKit: Key file does not contain a valid PKCS#8 PEM private key');
      console.error('🍎 MusicKit: First 40 chars:', JSON.stringify(privateKeyContent.substring(0, 40)));
      return null;
    }

    // Base64url encode helper
    const base64url = (data) => {
      const buf = typeof data === 'string' ? Buffer.from(data) : data;
      return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };

    const now = Math.floor(Date.now() / 1000);
    const expiryDays = 180;

    // Build JWT using Node.js built-in crypto (avoids fragile ESM import of jose)
    const header = JSON.stringify({ alg: 'ES256', kid: MUSICKIT_KEY_ID });
    const payload = JSON.stringify({
      iss: MUSICKIT_TEAM_ID,
      iat: now,
      exp: now + (expiryDays * 24 * 60 * 60)
    });

    const signingInput = `${base64url(header)}.${base64url(payload)}`;
    const privateKey = crypto.createPrivateKey(privateKeyContent);
    const signature = crypto.sign('SHA256', Buffer.from(signingInput), {
      key: privateKey,
      dsaEncoding: 'ieee-p1363' // JWT requires raw R||S format, not DER
    });

    const token = `${signingInput}.${base64url(signature)}`;
    generatedMusicKitToken = token;
    console.log(`🍎 MusicKit: Developer token generated from ${path.basename(keyPath)} (expires in ${expiryDays} days)`);
    return token;
  } catch (error) {
    console.error('🍎 MusicKit: Failed to generate developer token:', error.message);
    console.error('🍎 MusicKit: Stack:', error.stack);
    return null;
  }
}

// Helper to get Spotify credentials with priority: user-stored > env
// No fallback — Spotify requires BYOK due to 5-user dev mode limit
function getSpotifyCredentials() {
  // First check user-configured Client ID (stored via UI)
  const userClientId = store.get('spotify_client_id');

  if (userClientId) {
    console.log('🔑 Using user-configured Spotify Client ID');
    return {
      clientId: userClientId,
      source: 'user'
    };
  }

  // Then check environment variable
  if (process.env.SPOTIFY_CLIENT_ID) {
    console.log('🔑 Using environment Spotify Client ID');
    return {
      clientId: process.env.SPOTIFY_CLIENT_ID,
      source: 'env'
    };
  }

  // No fallback — user must provide their own Client ID
  console.log('🔑 No Spotify Client ID configured');
  return {
    clientId: null,
    source: 'none'
  };
}

/**
 * Clear all persisted Spotify user-token state. Shared by the
 * spotify-disconnect IPC and the invalid_grant terminal-failure path so
 * both wipe exactly the same keys. Does NOT touch credentials
 * (spotify_client_id) — only the per-user token set.
 */
function clearSpotifyTokens() {
  store.delete('spotify_token');
  store.delete('spotify_refresh_token');
  store.delete('spotify_token_expiry');
  store.delete('spotify_token_scopes');
}

// Throttle so a burst of concurrent failed refreshes (e.g. 20 tracks
// resolving at once when the token just died) only prompts re-auth once.
let lastSpotifyReauthPromptAt = 0;

/**
 * Broadcast `spotify:reauth-required` to the renderer so it can flip to
 * the disconnected state and prompt the user to sign in again. Mirrors
 * the Apple Music `applemusic:reauth-required` pattern.
 */
function emitSpotifyReauthRequired(reason) {
  const now = Date.now();
  if (now - lastSpotifyReauthPromptAt < 30_000) return;
  lastSpotifyReauthPromptAt = now;
  try {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win && !win.isDestroyed()) {
        win.webContents.send('spotify:reauth-required', { reason });
      }
    }
    console.warn(`[Spotify] Emitted spotify:reauth-required (reason=${reason})`);
  } catch (err) {
    console.warn('[Spotify] Could not emit reauth prompt:', err && err.message);
  }
}

/**
 * Classify a Spotify token-refresh response.
 *   - 'ok'       — refresh succeeded (caller reads the body for the new token)
 *   - 'terminal' — invalid_grant / invalid_client: the refresh token is dead.
 *                  Discard stored tokens and prompt re-auth. Do NOT retry.
 *   - 'transient'— 429 / 5xx / network: keep the stored token, fail this
 *                  attempt only, retry on the next call.
 *
 * Per Spotify's June 2026 notice: refresh tokens expire after six months,
 * and an expired one returns HTTP 400 `{ "error": "invalid_grant" }`. The
 * required handling is: discard the token (don't retry) + re-auth. We treat
 * invalid_grant/invalid_client as terminal; everything else as transient so
 * a server blip or rate-limit never logs the user out.
 */
function classifySpotifyRefresh(status, body) {
  if (status >= 200 && status < 300) return 'ok';
  const err = body && typeof body.error === 'string' ? body.error : null;
  if (status === 400 && (err === 'invalid_grant' || err === 'invalid_client')) {
    return 'terminal';
  }
  // 401/403 with invalid_grant/invalid_client are also terminal (some
  // Spotify edges return 401 for a revoked grant).
  if ((status === 401 || status === 403) && (err === 'invalid_grant' || err === 'invalid_client')) {
    return 'terminal';
  }
  return 'transient';
}

// Single-flight Spotify token refresh (parachord stampede guard).
//
// `ensureValidSpotifyToken` is called from ~14 sites in main (sync track/
// album/artist/playlist passes, playback, library fetch — several run
// concurrently) and the `spotify-check-token` IPC is called from several
// renderer spots. Without coordination, an expired token makes every one
// of those callers fire its OWN `POST /api/token` at the same instant —
// a burst of identical refreshes against Spotify's token endpoint. Rapid
// app relaunches stack these bursts with no client-side throttle (the
// Spotify resolver is intentionally exempt from the global limiter).
//
// This collapses all concurrent refreshes — across BOTH main callers and
// the renderer IPC — into exactly one in-flight POST; everyone awaits the
// same promise. It also fixes a latent correctness bug: with Spotify's
// refresh-token rotation, two racing refreshes would each POST a token
// the other just rotated away, which can invalidate the whole grant.
//
// Resolves to one of:
//   { ok: true, token, expiresAt }
//   { ok: false, terminal: true }   // invalid_grant — tokens cleared + reauth emitted
//   { ok: false, terminal: false }  // transient / no-creds — stored token left intact
let spotifyRefreshInFlight = null;

function refreshSpotifyTokenOnce() {
  if (spotifyRefreshInFlight) return spotifyRefreshInFlight;
  spotifyRefreshInFlight = (async () => {
    const refreshToken = store.get('spotify_refresh_token');
    if (!refreshToken) return { ok: false, terminal: false };
    const { clientId } = getSpotifyCredentials();
    if (!clientId) return { ok: false, terminal: false };

    try {
      console.log('🔄 [Spotify] Refreshing access token (single-flight)...');
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId
        })
      });

      let data = null;
      try { data = await response.json(); } catch (_e) { /* non-JSON error body */ }
      const verdict = classifySpotifyRefresh(response.status, data);

      if (verdict === 'terminal') {
        console.error('❌ [Spotify] Refresh token invalid (invalid_grant) — discarding and prompting re-auth');
        clearSpotifyTokens();
        emitSpotifyReauthRequired('invalid_grant');
        return { ok: false, terminal: true };
      }
      if (verdict === 'transient' || !data || !data.access_token) {
        console.error('❌ [Spotify] Token refresh failed (transient):', response.status);
        return { ok: false, terminal: false };
      }

      const newExpiry = Date.now() + ((data.expires_in || 3600) * 1000);
      store.set('spotify_token', data.access_token);
      store.set('spotify_token_expiry', newExpiry);
      if (data.refresh_token) {
        store.set('spotify_refresh_token', data.refresh_token);
      }
      if (data.scope) {
        store.set('spotify_token_scopes', data.scope);
      }
      console.log('✅ [Spotify] Token refreshed, expires:', new Date(newExpiry).toISOString());
      return { ok: true, token: data.access_token, expiresAt: newExpiry };
    } catch (error) {
      console.error('❌ [Spotify] Token refresh error (transient):', error && error.message);
      return { ok: false, terminal: false };
    }
  })();

  // Clear the in-flight latch once settled so the NEXT genuine expiry can
  // refresh again. Concurrent callers that arrived during the window all
  // share the promise above; only callers after it settles start fresh.
  spotifyRefreshInFlight.finally(() => { spotifyRefreshInFlight = null; });
  return spotifyRefreshInFlight;
}

/**
 * Ensure we have a valid (non-expired) Spotify access token.
 * Refreshes automatically (single-flight) if the stored token is expired.
 * Returns the valid access token string, or null if unavailable.
 */
async function ensureValidSpotifyToken(force = false) {
  const token = store.get('spotify_token');
  const expiry = store.get('spotify_token_expiry');
  const refreshToken = store.get('spotify_refresh_token');

  // Token is still valid — return it (unless force-refresh requested)
  if (!force && token && expiry && Date.now() < expiry) {
    return token;
  }
  if (!refreshToken) return token || null;

  const result = await refreshSpotifyTokenOnce();
  return result.ok ? result.token : null;
}

// Build an Apple Music token refresh callback suitable for passing to a
// provider method (e.g. fetchPlaylists, deletePlaylist). On 401, the
// provider invokes this callback to request a fresh user token via the
// MusicKit native bridge.
//
// Notes on Apple's behavior:
//   - Apple's token provider typically returns the SAME long-lived user
//     token on successive refresh calls — even with `.ignoreCache`. That
//     is normal, not a failure. Most 401s on Apple Music writes aren't
//     session-expiry problems; they're endpoint-specific restrictions
//     (e.g. DELETE /me/library/playlists/{id} returns 401 even when the
//     same token happily handles POST /tracks on the same playlist).
//     The right handler per endpoint decides how to react — this
//     callback's only job is to hand back a fresh token value.
//   - If the MusicKit bridge actually fails (no dev token, threw, or
//     returned nothing), we emit a one-shot reauth prompt so the user
//     can reconnect. Debounced to once per 30s.
let lastAppleMusicReauthPromptAt = 0;
function buildAppleMusicRefreshCb(_initialToken, onTokenChanged) {
  const emitReauthPromptOnce = (reason) => {
    const now = Date.now();
    if (now - lastAppleMusicReauthPromptAt < 30_000) return;
    lastAppleMusicReauthPromptAt = now;
    try {
      const win = require('electron').BrowserWindow.getAllWindows()[0];
      if (win && !win.isDestroyed()) {
        win.webContents.send('applemusic:reauth-required', { reason });
        console.warn(`[AppleMusic] Emitted applemusic:reauth-required (reason=${reason})`);
      }
    } catch (err) {
      console.warn('[AppleMusic] Could not emit reauth prompt:', err.message);
    }
  };

  return async () => {
    try {
      const bridge = getMusicKitBridge();
      const freshDevToken = generatedMusicKitToken
        || process.env.MUSICKIT_DEVELOPER_TOKEN
        || store.get('applemusic_developer_token');
      if (!freshDevToken) {
        emitReauthPromptOnce('no-developer-token');
        return null;
      }

      // ignoreCache: true (parachord#773) — this callback fires in response
      // to an actual 401 from Apple, so we genuinely need to bust the local
      // MusicKit token cache and pull a fresh one. Every other fetchUserToken
      // call site (renderer-initiated startup / sync paths) intentionally uses
      // the cached default to avoid spurious native sign-in dialogs.
      const result = await bridge.fetchUserToken(freshDevToken, { ignoreCache: true });
      if (!result || !result.userToken) {
        emitReauthPromptOnce('bridge-returned-no-token');
        return null;
      }

      // Don't treat same-token-as-before as a failure — Apple routinely
      // returns long-lived tokens. Let callers handle endpoint-specific
      // 401s via their own fallback paths (e.g. deletePlaylist → rename).
      store.set('applemusic_user_token', result.userToken);
      const newToken = JSON.stringify({ developerToken: freshDevToken, userToken: result.userToken });
      if (typeof onTokenChanged === 'function') onTokenChanged(newToken);
      return newToken;
    } catch (err) {
      console.warn('[AppleMusic] Failed to refresh user token:', err.message);
      emitReauthPromptOnce('refresh-threw');
      return null;
    }
  };
}

// Helper to get SoundCloud credentials with priority: user-stored > env > fallback
function getSoundCloudCredentials() {
  // First check user-configured credentials (stored via UI)
  const userClientId = store.get('soundcloud_client_id');
  const userClientSecret = store.get('soundcloud_client_secret');

  if (userClientId && userClientSecret) {
    console.log('🔑 Using user-configured SoundCloud credentials');
    return {
      clientId: userClientId,
      clientSecret: userClientSecret,
      source: 'user'
    };
  }

  // Then check environment variables
  if (process.env.SOUNDCLOUD_CLIENT_ID && process.env.SOUNDCLOUD_CLIENT_SECRET) {
    console.log('🔑 Using environment SoundCloud credentials');
    return {
      clientId: process.env.SOUNDCLOUD_CLIENT_ID,
      clientSecret: process.env.SOUNDCLOUD_CLIENT_SECRET,
      source: 'env'
    };
  }

  // Fallback to hardcoded app credentials
  if (FALLBACK_SOUNDCLOUD_CLIENT_ID && FALLBACK_SOUNDCLOUD_CLIENT_SECRET) {
    console.log('🔑 Using fallback SoundCloud credentials');
    return {
      clientId: FALLBACK_SOUNDCLOUD_CLIENT_ID,
      clientSecret: FALLBACK_SOUNDCLOUD_CLIENT_SECRET,
      source: 'fallback'
    };
  }

  console.log('⚠️ No SoundCloud credentials available');
  return {
    clientId: null,
    clientSecret: null,
    source: 'none'
  };
}

// Scrobbler config - expose Last.fm API credentials from environment
// This provides a dedicated API for scrobbler initialization, returning both key and secret together.
// The secret supports a fallback to LASTFM_SHARED_SECRET for compatibility with different env var naming.
// Falls back to app's default API keys if user hasn't configured their own.
ipcMain.handle('get-scrobbler-config', () => {
  return {
    lastfmApiKey: process.env.LASTFM_API_KEY || FALLBACK_LASTFM_API_KEY,
    lastfmApiSecret: process.env.LASTFM_API_SECRET || process.env.LASTFM_SHARED_SECRET || FALLBACK_LASTFM_API_SECRET
  };
});

// Auto-updater IPC handlers
ipcMain.handle('updater-check', async () => {
  if (!autoUpdater) {
    return { success: false, error: 'Auto-updater not available' };
  }
  try {
    userInitiatedUpdateCheck = true;
    const result = await autoUpdater.checkForUpdates();
    return { success: true, updateInfo: result?.updateInfo };
  } catch (error) {
    userInitiatedUpdateCheck = false;
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updater-download', async () => {
  if (!autoUpdater) {
    return { success: false, error: 'Auto-updater not available' };
  }
  try {
    await autoUpdater.downloadUpdate();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('updater-install', () => {
  if (!autoUpdater) {
    return;
  }
  autoUpdater.quitAndInstall(false, true);
});

ipcMain.handle('updater-get-version', () => {
  return app.getVersion();
});

// Theme IPC handlers
ipcMain.handle('theme-get-system', () => {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

ipcMain.handle('theme-set-native', (event, mode) => {
  // mode: 'light', 'dark', or 'system'
  nativeTheme.themeSource = mode;
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
});

// Notify renderer when system theme changes
nativeTheme.on('updated', () => {
  const effectiveTheme = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
  BrowserWindow.getAllWindows().forEach(win => {
    win.webContents.send('theme-changed', effectiveTheme);
  });
});

// IPC handlers for storage — restricted to a whitelist of safe keys
const ALLOWED_STORE_KEYS = new Set([
  'active_resolvers', 'ai_chat_histories', 'ai_include_history',
  'applemusic_authorized', 'applemusic_developer_token', 'applemusic_user_token',
  'auto_launch_spotify', 'autoPinnedFriendIds',
  'cache_ai_suggestions', 'cache_album_art', 'cache_album_release_ids', 'cache_artist_data',
  'cache_artist_images', 'cache_charts', 'cache_concerts', 'cache_mbid_mapper', 'cache_new_releases', 'cache_playlist_covers', 'cache_track_sources',
  'concerts_location', 'concerts_location_coords', 'concerts_location_radius',
  'discovery_seen_charts', 'discovery_seen_criticsPicks', 'discovery_seen_recommendations',
  'friends', 'last_active_view', 'local_playlists', 'media-key-handling',
  'meta_service_configs', 'pinnedFriendIds', 'playlists_view_mode', 'preferred_spotify_device_id',
  'recommendation_blocklist', 'remember_queue', 'resolver_blocklist',
  'resolver_order', 'resolver_sync_settings', 'resolver_volume_offsets',
  'saved_playback_context', 'saved_queue', 'saved_shuffle_state', 'saved_volume',
  'scrobble-failed-queue', 'scrobbler-config-lastfm', 'scrobbler-config-librefm',
  'scrobbler-config-listenbrainz', 'scrobbler_love_push_enabled', 'scrobbling-enabled',
  'love_pushed_keys', 'search_history',
  'selected_chat_provider', 'show_discovery_badges',
  'skip_external_prompt', 'skip_unsaved_friend_warning',
  'suppressed_sync_playlists',
  'theme_preference',
  'tutorial_completed', 'uninstalled_resolvers', 'whats_new_dismissed_version',
  'cached_announcements', 'dismissed_announcement_ids',
  'playlists_sort',
  'hidden_friend_keys',
]);

// Sensitive keys that should only be accessed by dedicated IPC handlers
// (spotify_token, spotify_refresh_token, soundcloud_client_secret, etc.)

ipcMain.handle('store-get', (event, key) => {
  if (!ALLOWED_STORE_KEYS.has(key)) {
    console.warn(`⚠️ Blocked store-get for non-whitelisted key: ${key}`);
    return undefined;
  }
  return store.get(key);
});

// Batch get — fetch multiple keys in a single IPC roundtrip.
//
// Performance-critical: electron-store's .get(key) implementation is
// `_.get(this.store, key)`, and the `store` getter is
// `JSON.parse(JSON.stringify(this.#store))` — i.e., every single .get()
// call deep-clones the ENTIRE underlying config. On populated installs
// where config.json is ~45MB (ours: 16MB local_playlists + 13MB
// cache_track_sources + 3.5MB cache_album_art + …), one clone takes
// ~170ms. Doing 37 .get() calls in a loop = 37 × 170ms ≈ 6 seconds of
// pure CPU on the main thread, blocking every other IPC handler. That
// was the dominant component of the ~10s startup gap on populated
// installs (measured on user's machine: 6315ms for 37-key critical
// batch + 1707ms for 10-key big-cache batch ≈ 8s total).
//
// Fix: read `store.store` ONCE (one clone, ~170ms), then index into
// the resulting object by key. N+1 work instead of N×N. Drops the
// 6315ms case to ~200ms.
ipcMain.handle('store-get-batch', (event, keys) => {
  const t0 = Date.now();
  const data = store.store;
  const cloneMs = Date.now() - t0;
  const result = {};
  for (const key of keys) {
    if (ALLOWED_STORE_KEYS.has(key)) {
      result[key] = data[key];
    }
  }
  const ms = Date.now() - t0;
  if (ms > 50) {
    console.log(`📦 store-get-batch (${keys.length} keys) took ${ms}ms (clone=${cloneMs}ms)`);
  }
  return result;
});

ipcMain.handle('store-set', (event, key, value) => {
  if (!ALLOWED_STORE_KEYS.has(key)) {
    console.warn(`⚠️ Blocked store-set for non-whitelisted key: ${key}`);
    return false;
  }
  store.set(key, value);
  return true;
});

ipcMain.handle('store-delete', (event, key) => {
  if (!ALLOWED_STORE_KEYS.has(key)) {
    console.warn(`⚠️ Blocked store-delete for non-whitelisted key: ${key}`);
    return false;
  }
  store.delete(key);
  return true;
});

// ─── In-app announcements ────────────────────────────────────────────────────
// Polls a public JSON file on achordion.xyz for product announcements
// (banner notifications). The fetched payload is cached in electron-store
// (`cached_announcements`); user dismissals are tracked by id in
// `dismissed_announcement_ids`. The renderer reads both via existing
// store IPC. Refreshes are pushed via the `announcements:updated` event.
//
// Schema (announcements.json):
//   [
//     {
//       "id": "2026-05-08-launch-discord",   // required, stable; dismissals key off this
//       "severity": "info" | "success" | "warn" | "error",   // default 'info'
//       "title": "string",                    // required
//       "body":  "string",                    // optional
//       "icon":  "📡",                         // optional — emoji or short glyph (≤4 chars)
//       "iconUrl": "https://...png",          // optional — small image (https only); preferred over icon
//       "cta":   { "label": "string", "url": "https://..." }, // optional
//       "minVersion": "0.9.2",                // optional inclusive lower bound
//       "maxVersion": "1.0.0",                // optional inclusive upper bound
//       "expiresAt": "2026-06-01T00:00:00Z"   // optional ISO-8601
//     }
//   ]
const ANNOUNCEMENTS_URL = 'https://achordion.xyz/api/announcements';
const ANNOUNCEMENTS_INITIAL_DELAY_MS = 10 * 1000; // ~10s after launch
// Refetch on window focus only when this much time has passed since the last
// successful fetch — covers the "user kept the app open for days" case
// without burning per-hour requests for installs that already restart often.
const ANNOUNCEMENTS_FOCUS_STALE_MS = 6 * 60 * 60 * 1000; // 6h

const isPlainAnnouncement = (a) => {
  if (!a || typeof a !== 'object') return false;
  if (typeof a.id !== 'string' || !a.id.trim()) return false;
  if (typeof a.title !== 'string' || !a.title.trim()) return false;
  if (a.severity != null && typeof a.severity !== 'string') return false;
  if (a.body != null && typeof a.body !== 'string') return false;
  if (a.icon != null) {
    if (typeof a.icon !== 'string' || a.icon.length > 4) return false;
  }
  if (a.iconUrl != null) {
    if (typeof a.iconUrl !== 'string') return false;
    if (!/^https:\/\//i.test(a.iconUrl)) return false; // https only — banner is rendered, no mixed-content
  }
  if (a.cta != null) {
    if (typeof a.cta !== 'object') return false;
    if (typeof a.cta.label !== 'string' || typeof a.cta.url !== 'string') return false;
    if (!/^https?:\/\//i.test(a.cta.url)) return false;
  }
  return true;
};

const fetchAnnouncements = async (reason = 'scheduled') => {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(ANNOUNCEMENTS_URL, {
      signal: ctrl.signal,
      redirect: 'error',
      cache: 'no-store',
      headers: { 'Accept': 'application/json' }
    });
    if (!res.ok) {
      console.warn(`📢 [Announcements] Fetch (${reason}) returned HTTP ${res.status}`);
      return;
    }
    const ct = res.headers.get('content-type') || '';
    if (!/json/i.test(ct)) {
      console.warn(`📢 [Announcements] Fetch (${reason}) returned non-JSON content-type: ${ct}`);
      return;
    }
    const text = await res.text();
    if (text.length > 64 * 1024) {
      console.warn(`📢 [Announcements] Fetch (${reason}) payload too large: ${text.length} bytes — ignored`);
      return;
    }
    let data;
    try { data = JSON.parse(text); }
    catch (e) {
      console.warn(`📢 [Announcements] Fetch (${reason}) invalid JSON:`, e.message);
      return;
    }
    if (!Array.isArray(data)) {
      console.warn(`📢 [Announcements] Fetch (${reason}) not an array`);
      return;
    }
    const items = data.filter(isPlainAnnouncement).slice(0, 20);
    const payload = { fetchedAt: Date.now(), items };
    store.set('cached_announcements', payload);
    console.log(`📢 [Announcements] Fetched (${reason}): ${items.length} item(s)${data.length !== items.length ? ` (${data.length - items.length} dropped as malformed)` : ''}`);
    BrowserWindow.getAllWindows().forEach(win => {
      try { win.webContents.send('announcements:updated', payload); } catch (_) {}
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      console.warn(`📢 [Announcements] Fetch (${reason}) timed out`);
    } else {
      console.warn(`📢 [Announcements] Fetch (${reason}) failed:`, err && err.message ? err.message : err);
    }
  } finally {
    clearTimeout(timeout);
  }
};

let announcementsLastFetchAt = 0;
let announcementsStarted = false;
const fetchAnnouncementsTracked = async (reason) => {
  await fetchAnnouncements(reason);
  announcementsLastFetchAt = Date.now();
};
const startAnnouncementsPolling = () => {
  if (announcementsStarted) return;
  announcementsStarted = true;
  // Initial fetch ~10s after launch — gives the renderer time to register
  // the broadcast listener before main pushes the first payload.
  setTimeout(() => fetchAnnouncementsTracked('initial'), ANNOUNCEMENTS_INITIAL_DELAY_MS);
  // No setInterval polling. Refetch only when the window regains focus AND
  // enough time has passed since the last fetch to be worth the round-trip.
  app.on('browser-window-focus', () => {
    const stale = Date.now() - announcementsLastFetchAt > ANNOUNCEMENTS_FOCUS_STALE_MS;
    if (stale) fetchAnnouncementsTracked('focus');
  });
};

ipcMain.handle('announcements:refresh', () => fetchAnnouncementsTracked('manual'));

// Engagement telemetry posted from the renderer when a banner is viewed,
// dismissed, or its CTA is clicked. Best-effort: errors are logged and
// swallowed so a failed telemetry call never affects the UI.
const ANNOUNCEMENTS_EVENT_URL = 'https://achordion.xyz/api/announcements/event';
ipcMain.handle('announcements:record-event', async (_event, payload) => {
  if (!payload || typeof payload.id !== 'string' || typeof payload.event !== 'string') {
    return { ok: false, reason: 'invalid-payload' };
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(ANNOUNCEMENTS_EVENT_URL, {
      method: 'POST',
      signal: ctrl.signal,
      redirect: 'error',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ id: payload.id, event: payload.event })
    });
    if (!res.ok) {
      console.warn(`📢 [Announcements] Event POST returned HTTP ${res.status} for ${payload.event}/${payload.id}`);
      return { ok: false, reason: `status-${res.status}` };
    }
    return { ok: true };
  } catch (err) {
    if (err && err.name !== 'AbortError') {
      console.warn(`📢 [Announcements] Event POST failed for ${payload.event}/${payload.id}:`, err.message || err);
    }
    return { ok: false, reason: 'network' };
  } finally {
    clearTimeout(timeout);
  }
});

ipcMain.handle('store-clear', async () => {
  console.log('=== Reset Application Data ===');
  const fs = require('fs').promises;
  const path = require('path');

  // Clear all electron-store data
  store.clear();
  console.log('  ✅ Cleared electron-store');

  // Clear plugin cache directory
  try {
    const pluginsDir = getPluginsCacheDir();
    const files = await fs.readdir(pluginsDir);
    for (const file of files) {
      if (file.endsWith('.axe')) {
        await fs.unlink(path.join(pluginsDir, file));
      }
    }
    console.log('  ✅ Cleared plugin cache');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('  ⚠️ Failed to clear plugin cache:', error.message);
    }
  }

  // Clear collection data (synced tracks, albums, artists)
  try {
    const collectionPath = path.join(app.getPath('userData'), 'collection.json');
    await fs.unlink(collectionPath);
    console.log('  ✅ Cleared collection data');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('  ⚠️ Failed to clear collection data:', error.message);
    }
  }

  // Clear Local Files database (watch folders, scanned tracks)
  try {
    const localFilesDbPath = path.join(app.getPath('userData'), 'local-files.db');
    await fs.unlink(localFilesDbPath);
    console.log('  ✅ Cleared Local Files database');
    // Also clear WAL/SHM files if they exist
    await fs.unlink(localFilesDbPath + '-wal').catch(() => {});
    await fs.unlink(localFilesDbPath + '-shm').catch(() => {});
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.warn('  ⚠️ Failed to clear Local Files database:', error.message);
    }
  }

  return { success: true };
});

// Config handler - expose select environment variables to renderer
// Only expose whitelisted keys for security
// Uses fallback values for services that support shared app credentials
const ALLOWED_CONFIG_KEYS = ['LASTFM_API_KEY', 'LASTFM_API_SECRET', 'QOBUZ_APP_ID', 'MUSICKIT_DEVELOPER_TOKEN'];
const CONFIG_FALLBACKS = {
  'LASTFM_API_KEY': FALLBACK_LASTFM_API_KEY,
  'LASTFM_API_SECRET': FALLBACK_LASTFM_API_SECRET
};
ipcMain.handle('config-get', async (event, key) => {
  if (ALLOWED_CONFIG_KEYS.includes(key)) {
    // MusicKit token: env var > auto-generated from .p8 > user-configured in Settings
    // Await token generation so the renderer doesn't race ahead and get null.
    if (key === 'MUSICKIT_DEVELOPER_TOKEN') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      return process.env[key] || generatedMusicKitToken || store.get('applemusic_developer_token') || null;
    }
    return process.env[key] || CONFIG_FALLBACKS[key] || null;
  }
  console.warn(`⚠️ Attempted to access non-whitelisted config key: ${key}`);
  return null;
});

// Diagnostic endpoint for Apple Music token status (helps debug auth issues)
ipcMain.handle('musickit:token-status', async () => {
  const keyFileName = `AuthKey_${MUSICKIT_KEY_ID}.p8`;
  const searchPaths = [
    path.join(__dirname, 'resources', 'keys', keyFileName),
    path.join(__dirname, 'resources', 'keys'),
    path.join(process.resourcesPath || __dirname, 'keys', keyFileName),
    path.join(process.resourcesPath || __dirname, 'keys'),
  ];

  let keyFound = false;
  let keyPath = null;
  for (const sp of searchPaths) {
    try {
      const stat = fs.statSync(sp);
      if (stat.isFile() && sp.endsWith('.p8')) {
        keyFound = true;
        keyPath = sp;
        break;
      }
      if (stat.isDirectory()) {
        const files = fs.readdirSync(sp);
        const p8 = files.find(f => f.endsWith('.p8'));
        if (p8) {
          keyFound = true;
          keyPath = path.join(sp, p8);
          break;
        }
      }
    } catch (_) {}
  }

  return {
    hasGeneratedToken: !!generatedMusicKitToken,
    hasEnvToken: !!process.env.MUSICKIT_DEVELOPER_TOKEN,
    hasStoredToken: !!store.get('applemusic_developer_token'),
    hasUserToken: !!store.get('applemusic_user_token'),
    keyFileFound: keyFound,
    keyFilePath: keyPath,
    isAuthorized: !!store.get('applemusic_authorized'),
  };
});

// Spotify OAuth handler
ipcMain.handle('spotify-auth', async () => {
  const { clientId, source } = getSpotifyCredentials();
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
  console.log('🔑 Spotify auth using credentials from:', source);

  // Require user-provided Client ID — no fallback
  if (!clientId) {
    return {
      success: false,
      error: 'no_client_id',
      message: 'Please enter your Spotify Client ID in Settings before connecting. You can get one at developer.spotify.com/dashboard.'
    };
  }

  const scopes = [
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-read-currently-playing',
    'user-library-read',
    'user-library-modify',
    'user-follow-read',
    'user-follow-modify',
    'playlist-read-private',
    'playlist-read-collaborative',
    'playlist-modify-private',
    'playlist-modify-public'
  ].join(' ');

  // Generate PKCE code verifier and challenge
  spotifyCodeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(spotifyCodeVerifier);

  const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&show_dialog=true&code_challenge_method=S256&code_challenge=${codeChallenge}`;

  // Open in system browser
  shell.openExternal(authUrl);

  return { success: true };
});

// Check if token exists and auto-refresh if expired
// Pass { force: true } to skip expiry check and always refresh (e.g. after a 400/401 from Spotify API)
ipcMain.handle('spotify-check-token', async (event, { force = false } = {}) => {
  console.log('=== Spotify Check Token Handler Called ===', force ? '(forced)' : '');
  const token = store.get('spotify_token');
  const expiry = store.get('spotify_token_expiry');
  const refreshToken = store.get('spotify_refresh_token');

  // If token is valid and not a forced refresh, return it
  if (!force && token && expiry && Date.now() < expiry) {
    console.log('✓ Returning valid token');
    return { token, expiresAt: expiry };
  }

  if (!refreshToken) {
    console.log('✗ No refresh token available');
    return null;
  }

  // Funnel through the single-flight refresher so concurrent callers
  // (this IPC fired from several renderer spots + the ~14 main-side
  // ensureValidSpotifyToken callers) share ONE POST instead of each
  // hammering Spotify's token endpoint. See refreshSpotifyTokenOnce.
  const result = await refreshSpotifyTokenOnce();
  if (result.ok) {
    return { token: result.token, expiresAt: result.expiresAt };
  }
  if (result.terminal) {
    // invalid_grant — tokens already cleared + reauth broadcast emitted.
    // Signal the renderer so it can distinguish "sign in again" from a
    // transient failure (where it keeps using the stale token).
    return { reauthRequired: true };
  }
  console.log('✗ Token refresh failed (transient) — leaving stored token intact');
  return null;
});

// Get Spotify credentials (for UI to show which source is being used)
ipcMain.handle('spotify-get-credentials', () => {
  const userClientId = store.get('spotify_client_id');
  const { source } = getSpotifyCredentials();

  return {
    clientId: userClientId || '',
    source
  };
});

// Save user-configured Spotify Client ID
ipcMain.handle('spotify-set-credentials', (event, { clientId }) => {
  if (clientId) {
    store.set('spotify_client_id', clientId);
    // Clean up any legacy client secret from previous versions
    store.delete('spotify_client_secret');
    console.log('💾 Saved user Spotify Client ID');
    return { success: true, source: 'user' };
  } else {
    // Clear user credentials — Spotify will be unavailable until a new key is provided
    store.delete('spotify_client_id');
    store.delete('spotify_client_secret');
    console.log('🗑️ Cleared user Spotify Client ID');
    return { success: true, source: 'none' };
  }
});

// Get SoundCloud credentials (for UI to show which source is being used)
ipcMain.handle('soundcloud-get-credentials', () => {
  const userClientId = store.get('soundcloud_client_id');
  const userClientSecret = store.get('soundcloud_client_secret');
  const { source } = getSoundCloudCredentials();

  return {
    clientId: userClientId || '',
    clientSecret: userClientSecret || '',
    source
  };
});

// Save user-configured SoundCloud credentials
ipcMain.handle('soundcloud-set-credentials', (event, { clientId, clientSecret }) => {
  if (clientId && clientSecret) {
    store.set('soundcloud_client_id', clientId);
    store.set('soundcloud_client_secret', clientSecret);
    console.log('💾 Saved user SoundCloud credentials');
    return { success: true, source: 'user' };
  } else if (!clientId && !clientSecret) {
    // Clear user credentials
    store.delete('soundcloud_client_id');
    store.delete('soundcloud_client_secret');
    console.log('🗑️ Cleared user SoundCloud credentials');
    return { success: true, source: 'none' };
  } else {
    return { success: false, error: 'Both Client ID and Client Secret are required' };
  }
});

// SoundCloud OAuth handler (OAuth 2.1 with PKCE)
ipcMain.handle('soundcloud-auth', async () => {
  // Get credentials with fallback chain: user-stored > env
  const { clientId, source } = getSoundCloudCredentials();
  const redirectUri = 'http://127.0.0.1:8888/callback/soundcloud';
  console.log('🔑 SoundCloud auth using credentials from:', source);

  // Validate client ID exists
  if (!clientId) {
    console.error('❌ No SoundCloud credentials configured!');
    return { success: false, error: 'SoundCloud requires API credentials. Configure them in Settings → Installed → SoundCloud → Advanced.' };
  }

  // Generate PKCE code verifier and challenge (required by SoundCloud OAuth 2.1)
  soundcloudCodeVerifier = generateCodeVerifier();
  const codeChallenge = generateCodeChallenge(soundcloudCodeVerifier);

  // Generate state parameter for CSRF protection
  soundcloudOAuthState = crypto.randomBytes(16).toString('hex');

  // SoundCloud OAuth 2.1 — PKCE required, new authorization endpoint
  const authUrl = `https://secure.soundcloud.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${soundcloudOAuthState}`;

  console.log('Opening SoundCloud auth URL:', authUrl);

  // Open in system browser
  shell.openExternal(authUrl);

  return { success: true };
});

// Check if SoundCloud token exists and auto-refresh if expired
ipcMain.handle('soundcloud-check-token', async () => {
  console.log('=== SoundCloud Check Token Handler Called ===');
  const token = store.get('soundcloud_token');
  const expiry = store.get('soundcloud_token_expiry');
  const refreshToken = store.get('soundcloud_refresh_token');
  const lastRefresh = store.get('soundcloud_last_refresh');

  console.log('SoundCloud token exists:', !!token);
  console.log('Expiry:', expiry);
  console.log('Refresh token exists:', !!refreshToken);
  console.log('Last refresh:', lastRefresh ? new Date(lastRefresh).toISOString() : 'never');
  console.log('Current time:', Date.now());
  console.log('Is expired:', expiry && Date.now() >= expiry);

  // Check if we should proactively refresh (last refresh > 7 days ago)
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  const shouldProactiveRefresh = lastRefresh && (Date.now() - lastRefresh) > SEVEN_DAYS_MS;
  if (shouldProactiveRefresh) {
    console.log('⏰ Last refresh was over 7 days ago, will proactively refresh to keep refresh token alive');
  }

  // If token is valid and no proactive refresh needed, return it
  if (token && expiry && Date.now() < expiry && !shouldProactiveRefresh) {
    console.log('✓ Returning valid SoundCloud token');
    return { token, expiresAt: expiry };
  }

  // Get credentials with fallback chain: user-stored > env
  const { clientId, clientSecret, source } = getSoundCloudCredentials();

  // If token is expired (or proactive refresh needed) and we have a refresh token, try to refresh
  if (refreshToken && clientId && clientSecret) {
    const reason = shouldProactiveRefresh ? 'proactive refresh (keeping refresh token alive)' : 'token expired';
    console.log(`🔄 SoundCloud ${reason}, attempting automatic refresh using`, source, 'credentials...');

    try {
      const response = await fetch('https://secure.soundcloud.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId,
          client_secret: clientSecret
        })
      });

      if (!response.ok) {
        // Try to get error details from response body. Parsed twice-indirectly
        // so we have both the string (for logging / the thrown error) and the
        // structured body (for the clear-tokens decision below).
        let errorDetails = '';
        let errorBody = null;
        try {
          errorBody = await response.json();
          errorDetails = JSON.stringify(errorBody);
          console.error('❌ SoundCloud token refresh failed:', response.status, response.statusText);
          console.error('   Error details:', errorDetails);
        } catch {
          console.error('❌ SoundCloud token refresh failed:', response.status, response.statusText);
        }

        // Clear stored tokens when the refresh token itself is dead. Two
        // signals indicate this:
        //   - HTTP 401 (some providers return this for dead refresh tokens)
        //   - RFC 6749 §5.2 `error: "invalid_grant"` in the body (what
        //     SoundCloud actually returns, paired with HTTP 400)
        // Without clearing, the next proactive-refresh tick retries the same
        // dead refresh token forever, spamming 400s until the user manually
        // disconnects and reconnects in Settings.
        const bodyErrorCode = errorBody?.error || '';
        if (response.status === 401 || bodyErrorCode === 'invalid_grant') {
          console.log('🔒 Clearing invalid SoundCloud tokens (refresh token expired or revoked)');
          store.delete('soundcloud_token');
          store.delete('soundcloud_refresh_token');
          store.delete('soundcloud_token_expiry');
          store.delete('soundcloud_last_refresh');
        }

        throw new Error(`Token refresh failed: ${response.status}${errorDetails ? ' - ' + errorDetails : ''}`);
      }

      const data = await response.json();
      console.log('✅ SoundCloud token refreshed successfully');

      // Calculate expiry time (tokens typically last 1 hour)
      const expiresIn = data.expires_in || 3600; // Default to 1 hour
      const newExpiry = Date.now() + (expiresIn * 1000);

      // Save new token and track refresh time
      store.set('soundcloud_token', data.access_token);
      store.set('soundcloud_token_expiry', newExpiry);
      store.set('soundcloud_last_refresh', Date.now());

      // Update refresh token if a new one was provided
      if (data.refresh_token) {
        store.set('soundcloud_refresh_token', data.refresh_token);
      }

      console.log('New SoundCloud token expiry:', new Date(newExpiry).toISOString());
      console.log('Last refresh timestamp updated');

      return { token: data.access_token, expiresAt: newExpiry };
    } catch (error) {
      console.error('Failed to refresh SoundCloud token:', error);
      // Fall through to return null
    }
  }

  console.log('✗ No valid SoundCloud token found and refresh failed or not available');
  return null;
});

// Disconnect SoundCloud (clear tokens)
ipcMain.handle('spotify-disconnect', async () => {
  console.log('=== Spotify Disconnect ===');
  clearSpotifyTokens();
  console.log('Spotify tokens cleared');
  return { success: true };
});

// Scrape Spotify playlist data from the public embed page (no auth required)
// Used as fallback when the API returns 403 (Development Mode restrictions)
ipcMain.handle('spotify-scrape-playlist', async (event, playlistId) => {
  console.log(`=== Spotify Embed Scrape: ${playlistId} ===`);
  try {
    const https = require('https');
    const url = `https://open.spotify.com/embed/playlist/${playlistId}`;

    const html = await new Promise((resolve, reject) => {
      https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }, (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Embed page returned ${res.statusCode}`));
          return;
        }
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => resolve(body));
      }).on('error', reject);
    });

    // Extract __NEXT_DATA__ JSON from the page
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if (!match) {
      console.log('  ❌ Could not find __NEXT_DATA__ in embed page');
      return { success: false, error: 'Could not parse embed page' };
    }

    const nextData = JSON.parse(match[1]);
    const entity = nextData?.props?.pageProps?.state?.data?.entity;
    if (!entity) {
      console.log('  ❌ No entity data in __NEXT_DATA__');
      return { success: false, error: 'No playlist data found in embed page' };
    }

    const tracks = (entity.trackList || []).map((t, i) => {
      // Extract Spotify track ID from URI (spotify:track:XXXXX)
      const trackId = t.uri ? t.uri.split(':').pop() : null;
      return {
        id: trackId ? 'spotify-' + trackId : 'spotify-embed-' + i,
        title: t.title || 'Unknown Track',
        artist: t.subtitle || 'Unknown Artist',
        album: '', // Embed doesn't include album name
        duration: t.duration ? Math.floor(t.duration / 1000) : 0,
        sources: ['spotify'],
        spotifyUri: t.uri || null,
        spotifyId: trackId,
        previewUrl: t.audioPreview?.url || null
      };
    });

    console.log(`  ✅ Scraped ${tracks.length} tracks from embed: ${entity.name}`);
    return {
      success: true,
      playlist: {
        id: 'spotify-playlist-' + playlistId,
        name: entity.name || 'Unknown Playlist',
        owner: entity.subtitle || '',
        albumArt: entity.coverArt?.sources?.[0]?.url || entity.images?.[0]?.url || null,
        trackCount: tracks.length,
        tracks: tracks,
        url: `https://open.spotify.com/playlist/${playlistId}`,
        scraped: true
      }
    };
  } catch (error) {
    console.error(`  ❌ Embed scrape failed:`, error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('soundcloud-disconnect', async () => {
  console.log('=== SoundCloud Disconnect ===');
  store.delete('soundcloud_token');
  store.delete('soundcloud_refresh_token');
  store.delete('soundcloud_token_expiry');
  store.delete('soundcloud_last_refresh');
  console.log('SoundCloud tokens cleared');
  return { success: true };
});

// Debug handler removed for security — exposed all credentials to renderer

// Shell handler to open external URLs
ipcMain.handle('shell-open-external', async (event, url) => {
  console.log('=== Shell Open External ===');
  console.log('Requested URL:', url);
  
  // Validate URL format
  try {
    const urlObj = new URL(url);
    console.log('URL protocol:', urlObj.protocol);
    
    // Only allow http/https for security
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      console.error('❌ Invalid protocol:', urlObj.protocol);
      throw new Error('Only HTTP and HTTPS URLs are allowed');
    }
    
    console.log('Opening URL in external browser...');
    await shell.openExternal(url);
    console.log('✅ Successfully opened URL');
    return { success: true };
  } catch (error) {
    console.error('❌ Failed to open URL:', error);
    return { success: false, error: error.message };
  }
});

// Launch Spotify app in background (minimized/hidden)
ipcMain.handle('spotify-launch-background', async () => {
  console.log('=== Launch Spotify in Background ===');

  const { exec } = require('child_process');
  const platform = process.platform;

  try {
    if (platform === 'darwin') {
      // macOS: Open Spotify and immediately hide it
      // First check if Spotify is already running
      exec('pgrep -x "Spotify"', (error, stdout) => {
        if (stdout.trim()) {
          console.log('✅ Spotify is already running');
          return;
        }

        // Launch Spotify in background using AppleScript
        exec(`osascript -e 'tell application "Spotify" to activate' -e 'delay 1' -e 'tell application "System Events" to set visible of process "Spotify" to false'`, (err) => {
          if (err) {
            console.error('Failed to launch Spotify via AppleScript:', err);
            // Fallback: just open the app
            shell.openExternal('spotify:');
          } else {
            console.log('✅ Spotify launched and hidden');
          }
        });
      });
    } else if (platform === 'win32') {
      // Windows: Launch Spotify minimized
      exec('start /min spotify:', (err) => {
        if (err) {
          console.error('Failed to launch Spotify on Windows:', err);
          shell.openExternal('spotify:');
        } else {
          console.log('✅ Spotify launched minimized');
        }
      });
    } else {
      // Linux: Just open Spotify (minimized launch varies by DE)
      exec('spotify &', (err) => {
        if (err) {
          console.error('Failed to launch Spotify on Linux:', err);
        } else {
          console.log('✅ Spotify launched');
        }
      });
    }

    return { success: true };
  } catch (error) {
    console.error('❌ Failed to launch Spotify:', error);
    return { success: false, error: error.message };
  }
});

// Spotify Polling IPC Handlers
// These allow the renderer to control background polling from the main process
ipcMain.handle('spotify-polling-start', async (event, { token, trackUri, trackTitle, trackArtist }) => {
  console.log('=== Start Spotify Polling (IPC) ===');
  await spotifyPoller.start(token, trackUri, trackTitle, trackArtist);
  return { success: true };
});

ipcMain.handle('spotify-polling-stop', async () => {
  console.log('=== Stop Spotify Polling (IPC) ===');
  spotifyPoller.stop();
  return { success: true };
});

ipcMain.handle('spotify-polling-update-token', async (event, token) => {
  console.log('=== Update Spotify Polling Token (IPC) ===');
  spotifyPoller.updateToken(token);
  return { success: true };
});

ipcMain.handle('spotify-polling-update-track', async (event, { trackUri, trackTitle, trackArtist }) => {
  console.log('=== Update Spotify Polling Track (IPC) ===');
  spotifyPoller.updateTrack(trackUri, trackTitle, trackArtist);
  return { success: true };
});

ipcMain.handle('spotify-polling-status', async () => {
  return {
    active: spotifyPoller.interval !== null || spotifyPoller.recoveryInterval !== null,
    expectedTrackUri: spotifyPoller.expectedTrackUri
  };
});

// Apple Music Polling IPC Handlers
ipcMain.handle('applemusic-polling-start', async (event, { songId, trackTitle, trackArtist, duration }) => {
  console.log('=== Start Apple Music Polling (IPC) ===');
  await appleMusicPoller.start(songId, trackTitle, trackArtist, duration);
  return { success: true };
});

ipcMain.handle('applemusic-polling-stop', async () => {
  console.log('=== Stop Apple Music Polling (IPC) ===');
  appleMusicPoller.stop();
  return { success: true };
});

ipcMain.handle('applemusic-polling-update-track', async (event, { songId, trackTitle, trackArtist, duration }) => {
  console.log('=== Update Apple Music Polling Track (IPC) ===');
  appleMusicPoller.updateTrack(songId, trackTitle, trackArtist, duration);
  return { success: true };
});

ipcMain.handle('applemusic-polling-status', async () => {
  return {
    active: appleMusicPoller.interval !== null,
    expectedSongId: appleMusicPoller.expectedSongId
  };
});

// Playback window for external content (Bandcamp, etc.) with autoplay enabled
let playbackWindow = null;

// Build a Bandcamp EmbeddedPlayer URL from track/album IDs
function buildBandcampEmbedUrl(trackId, albumId) {
  if (albumId && trackId) {
    return `https://bandcamp.com/EmbeddedPlayer/album=${albumId}/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/track=${trackId}/transparent=true/`;
  } else if (albumId) {
    return `https://bandcamp.com/EmbeddedPlayer/album=${albumId}/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/`;
  } else if (trackId) {
    return `https://bandcamp.com/EmbeddedPlayer/track=${trackId}/size=large/bgcol=333333/linkcol=ffffff/tracklist=false/artwork=small/transparent=true/`;
  }
  return null;
}

// Resolve a Bandcamp page URL to an EmbeddedPlayer URL.
// Uses the lightweight autocomplete API first, falls back to full page fetch.
async function bandcampToEmbedUrl(pageUrl) {
  const { net } = require('electron');

  // Try the fast autocomplete API first — extract search terms from the URL slug
  try {
    const urlObj = new URL(pageUrl);
    const subdomain = urlObj.hostname.replace('.bandcamp.com', '');
    const pathParts = urlObj.pathname.split('/');
    const slug = pathParts[pathParts.length - 1] || '';
    // Convert slug to search query: "toxic-positivity-2" → "toxic positivity"
    const trackQuery = slug.replace(/-\d+$/, '').replace(/-/g, ' ');
    const query = `${subdomain.replace(/-/g, ' ')} ${trackQuery}`;

    console.log('[Bandcamp] Trying autocomplete API with query:', query);
    const apiResponse = await net.fetch(
      `https://bandcamp.com/api/fuzzysearch/1/app_autocomplete?q=${encodeURIComponent(query)}`,
      { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' } }
    );

    if (apiResponse.ok) {
      const data = await apiResponse.json();
      // Match by URL to ensure we get the right track
      const match = data.results?.find(r =>
        r.url && pageUrl.includes(slug) && r.url.includes(slug)
      );
      if (match) {
        const embedUrl = buildBandcampEmbedUrl(match.id, match.album_id);
        if (embedUrl) {
          console.log('[Bandcamp] Resolved via autocomplete API:', embedUrl);
          return embedUrl;
        }
      }
    }
  } catch (err) {
    console.log('[Bandcamp] Autocomplete API failed, trying page fetch:', err.message);
  }

  // Fallback: fetch the full page and extract IDs from data-tralbum
  try {
    console.log('[Bandcamp] Falling back to page fetch:', pageUrl);
    const response = await net.fetch(pageUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' }
    });
    if (!response.ok) return null;
    const html = await response.text();

    const tralbumMatch = html.match(/data-tralbum="([^"]*)"/);
    if (!tralbumMatch) return null;

    const decoded = tralbumMatch[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
    const tralbum = JSON.parse(decoded);

    const itemType = tralbum.current?.type;
    const itemId = tralbum.current?.id;
    const albumId = tralbum.current?.album_id;
    if (!itemId) return null;

    const embedUrl = buildBandcampEmbedUrl(
      itemType === 'album' ? null : itemId,
      itemType === 'album' ? itemId : albumId
    );
    if (embedUrl) {
      console.log('[Bandcamp] Resolved via page fetch:', embedUrl);
    }
    return embedUrl;
  } catch (err) {
    console.log('[Bandcamp] Page fetch failed:', err.message);
    return null;
  }
}

ipcMain.handle('open-playback-window', async (event, url, options = {}) => {
  console.log('=== Open Playback Window ===');
  console.log('URL:', url);

  // Close existing playback window if any
  if (playbackWindow && !playbackWindow.isDestroyed()) {
    playbackWindow.close();
  }

  // Convert Bandcamp page URLs to EmbeddedPlayer URLs
  let loadUrl = url;
  const isBandcamp = url.includes('bandcamp.com/track/') || url.includes('bandcamp.com/album/');
  if (isBandcamp) {
    // Fast path: if track/album IDs were passed directly, build embed URL instantly
    if (options.bandcampTrackId || options.bandcampAlbumId) {
      const embedUrl = buildBandcampEmbedUrl(options.bandcampTrackId, options.bandcampAlbumId);
      if (embedUrl) {
        console.log('[Bandcamp] Using pre-resolved IDs for embed URL');
        loadUrl = embedUrl;
      }
    } else {
      const embedUrl = await bandcampToEmbedUrl(url);
      if (embedUrl) {
        loadUrl = embedUrl;
      }
    }
  }

  // Calculate position for upper-right corner of screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const windowWidth = options.width || 400;
  // Use 120px height for Bandcamp embedded player, 200px default for others
  const windowHeight = options.height || (isBandcamp ? 120 : 200);
  const padding = 20; // Padding from screen edges

  playbackWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: screenWidth - windowWidth - padding,
    y: padding,
    minWidth: 300,
    minHeight: 100,
    frame: false,
    transparent: false,
    backgroundColor: '#333333',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required' // Enable autoplay!
    },
    parent: mainWindow,
    show: false
  });

  // Set up console-message listener BEFORE loading URL to catch all messages
  playbackWindow.webContents.on('console-message', (event, level, message) => {
    // Log all messages from playback window for debugging
    console.log('[PlaybackWindow]', message);

    if (message.startsWith('__PLAYBACK_EVENT__:')) {
      const eventType = message.replace('__PLAYBACK_EVENT__:', '');
      console.log('Playback window event:', eventType);
      // Forward to main renderer
      safeSendToRenderer('playback-window-event', eventType);
    }
  });

  playbackWindow.loadURL(loadUrl);

  // When page finishes loading, inject script to auto-click play button and set up event listeners
  playbackWindow.webContents.on('did-finish-load', () => {
    console.log('Playback window loaded, injecting auto-play script...');

    // Wait for the embed to load, then click play and set up audio event listeners
    setTimeout(async () => {
      try {
        const result = await playbackWindow.webContents.executeJavaScript(`
          (function() {
            console.log('=== Bandcamp embed injection starting ===');
            console.log('Document URL:', window.location.href);
            console.log('Document body:', document.body ? 'exists' : 'missing');

            // Click the play button first
            const playBtn = document.querySelector('.embeddedplaybutton') ||
                           document.querySelector('.playbutton') ||
                           document.querySelector('.inline_player') ||
                           document.querySelector('[class*="play"]');
            console.log('Play button search:', playBtn ? 'found: ' + playBtn.className : 'not found');

            if (playBtn) {
              playBtn.click();
              console.log('Clicked play button');
            }

            // Function to attach listeners and start playback
            function setupAudio() {
              const audio = document.querySelector('audio');
              console.log('Audio element check:', audio ? 'found' : 'not found');
              if (audio) {
                console.log('Audio state: paused=' + audio.paused + ', src=' + (audio.src ? 'yes' : 'no') + ', readyState=' + audio.readyState);
              }
              if (audio && !audio._parachordListenersAttached) {
                // Set up event listeners - use console.log with special prefix that main process will catch
                audio.addEventListener('play', () => {
                  console.log('__PLAYBACK_EVENT__:playing');
                });
                audio.addEventListener('pause', () => {
                  console.log('__PLAYBACK_EVENT__:paused');
                });
                audio.addEventListener('ended', () => {
                  console.log('__PLAYBACK_EVENT__:ended');
                });
                audio._parachordListenersAttached = true;
                console.log('Attached playback event listeners to audio element');

                // Force play
                audio.play().then(() => {
                  console.log('Audio started playing!');
                }).catch(err => {
                  console.log('Audio play failed:', err.message);
                });
                return true;
              }
              return false;
            }

            // Try immediately
            if (!setupAudio()) {
              // Try again after delays
              setTimeout(() => {
                if (!setupAudio()) {
                  setTimeout(() => {
                    if (!setupAudio()) {
                      console.log('Failed to find audio after multiple attempts');
                      // List all elements for debugging
                      console.log('All elements with audio:', document.querySelectorAll('audio').length);
                      console.log('All iframes:', document.querySelectorAll('iframe').length);
                    }
                  }, 1000);
                }
              }, 500);
            }

            return playBtn ? 'clicked: ' + playBtn.className : 'no button found';
          })();
        `);
        console.log('Auto-play injection result:', result);

        // Also try playing audio directly after another delay
        setTimeout(async () => {
          try {
            const audioResult = await playbackWindow.webContents.executeJavaScript(`
              (function() {
                const audio = document.querySelector('audio');
                if (audio) {
                  audio.play();
                  return 'audio play called, src: ' + (audio.src ? 'yes' : 'no');
                }
                return 'no audio element found';
              })();
            `);
            console.log('Direct audio play result:', audioResult);
          } catch (e) {
            console.log('Direct audio play error:', e);
          }
        }, 2000);
      } catch (err) {
        console.log('JS injection error:', err);
      }
    }, 1000);
  });

  playbackWindow.once('ready-to-show', () => {
    playbackWindow.show();
  });

  playbackWindow.on('closed', () => {
    playbackWindow = null;
    // Notify renderer that playback window was closed
    safeSendToRenderer('playback-window-closed');
  });

  return { success: true };
});

ipcMain.handle('close-playback-window', async () => {
  if (playbackWindow && !playbackWindow.isDestroyed()) {
    playbackWindow.close();
    playbackWindow = null;
  }
  return { success: true };
});

// Toggle play/pause in the playback window
ipcMain.handle('playback-window-toggle', async () => {
  if (playbackWindow && !playbackWindow.isDestroyed()) {
    try {
      const result = await playbackWindow.webContents.executeJavaScript(`
        (function() {
          const audio = document.querySelector('audio');
          if (audio) {
            // Ensure event listeners are attached (may have been missed on initial load)
            if (!audio._parachordListenersAttached) {
              audio.addEventListener('play', () => {
                console.log('__PLAYBACK_EVENT__:playing');
              });
              audio.addEventListener('pause', () => {
                console.log('__PLAYBACK_EVENT__:paused');
              });
              audio.addEventListener('ended', () => {
                console.log('__PLAYBACK_EVENT__:ended');
              });
              audio._parachordListenersAttached = true;
            }

            if (audio.paused) {
              audio.play();
              return 'playing';
            } else {
              audio.pause();
              return 'paused';
            }
          }
          // Try clicking the play button as fallback
          const playBtn = document.querySelector('.playbutton') || document.querySelector('.embeddedplaybutton');
          if (playBtn) {
            playBtn.click();
            return 'clicked';
          }
          return 'no-audio';
        })();
      `);
      console.log('Playback window toggle result:', result);

      // Also send the event directly to ensure sync
      if (result === 'playing' || result === 'paused') {
        safeSendToRenderer('playback-window-event', result);
      }

      return { success: true, state: result };
    } catch (err) {
      console.error('Failed to toggle playback:', err);
      return { success: false, error: err.message };
    }
  }
  return { success: false, error: 'No playback window' };
});

// Proxy fetch handler - bypasses CORS for resolvers that need to fetch external content
ipcMain.handle('proxy-fetch', async (event, url, options = {}) => {
  console.log('=== Proxy Fetch ===');
  console.log('URL:', url);
  console.log('Method:', options.method || 'GET');

  // Validate URL to prevent SSRF attacks
  try {
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      return { success: false, error: 'Only HTTP and HTTPS URLs are allowed' };
    }
    // Block requests to private/internal networks
    const hostname = urlObj.hostname;
    if (hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname.startsWith('10.') ||
        hostname.startsWith('192.168.') ||
        hostname.match(/^172\.(1[6-9]|2\d|3[01])\./) ||
        hostname === '169.254.169.254' ||
        hostname.endsWith('.local') ||
        hostname.endsWith('.internal')) {
      return { success: false, error: 'Requests to private/internal networks are not allowed' };
    }
  } catch (e) {
    return { success: false, error: `Invalid URL: ${e.message}` };
  }

  try {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        ...options.headers
      }
    };

    // Include body for POST/PUT requests
    if (options.body) {
      fetchOptions.body = options.body;
    }

    const response = await fetch(url, fetchOptions);

    console.log('Proxy fetch response status:', response.status);

    if (!response.ok) {
      console.log('Proxy fetch failed with status:', response.status);
      const errorText = await response.text();
      console.log('Error response body:', errorText.substring(0, 500));
      return { success: false, status: response.status, error: `HTTP ${response.status}`, text: errorText };
    }

    // Handle arraybuffer response type (for audio/binary data)
    if (options.responseType === 'arraybuffer') {
      const arrayBuffer = await response.arrayBuffer();
      console.log('Proxy fetch got arraybuffer, size:', arrayBuffer.byteLength);
      // Convert ArrayBuffer to base64 for IPC transfer
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      return { success: true, status: response.status, data: base64 };
    }

    const text = await response.text();
    console.log('Proxy fetch got text, length:', text.length);

    // Check if track_id is in the response (may be HTML-encoded as &quot;)
    const trackIdMatch = text.match(/track_id(?:"|&quot;):(\d+)/);
    if (trackIdMatch) {
      console.log('Found track_id in response:', trackIdMatch[1]);
    } else {
      console.log('No track_id found in response');
    }

    return { success: true, status: response.status, text };
  } catch (error) {
    console.error('Proxy fetch error:', error);
    return { success: false, error: error.message };
  }
});

// Plugin marketplace configuration
const PLUGIN_MARKETPLACE_URL = 'https://raw.githubusercontent.com/Parachord/parachord-plugins/main';
const PLUGIN_MANIFEST_URL = `${PLUGIN_MARKETPLACE_URL}/manifest.json`;

// Get the plugins cache directory
function getPluginsCacheDir() {
  const os = require('os');
  const path = require('path');
  return path.join(os.homedir(), '.parachord', 'plugins');
}

// Fetch plugin manifest from marketplace
async function fetchPluginManifest() {
  try {
    const response = await fetch(PLUGIN_MANIFEST_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.error('Failed to fetch plugin manifest:', error.message);
    return null;
  }
}

// Fetch a single plugin from marketplace
async function fetchPlugin(pluginId) {
  try {
    const url = `${PLUGIN_MARKETPLACE_URL}/${pluginId}.axe`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const content = await response.text();
    return JSON.parse(content);
  } catch (error) {
    console.error(`Failed to fetch plugin ${pluginId}:`, error.message);
    return null;
  }
}

// Plugin loading handler - loads from cache and syncs with marketplace
ipcMain.handle('resolvers-load-builtin', async () => {
  console.log('=== Load All Plugins ===');
  const fs = require('fs').promises;
  const path = require('path');

  const plugins = [];
  const pluginsDir = getPluginsCacheDir();
  console.log('Plugins cache directory:', pluginsDir);

  // Also check app's local plugins directory (for development)
  const appPluginsDir = path.join(__dirname, 'plugins');

  // Compare semver strings (e.g. "2.0.0" > "1.0.0"). Returns >0 if a>b, <0 if a<b, 0 if equal.
  const compareSemver = (a, b) => {
    const pa = (a || '0.0.0').split('.').map(Number);
    const pb = (b || '0.0.0').split('.').map(Number);
    for (let i = 0; i < 3; i++) {
      if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    }
    return 0;
  };

  // Helper to load plugins from a directory
  const loadPluginsFromDir = async (dir, source) => {
    try {
      // Only create the directory for writable locations (cache).
      // The app plugins dir may be inside an ASAR archive where mkdir
      // throws and aborts the entire function, silently skipping all
      // shipped plugins in packaged builds.
      if (source !== 'app') {
        await fs.mkdir(dir, { recursive: true });
      }
      const files = await fs.readdir(dir);
      const axeFiles = files.filter(f => f.endsWith('.axe'));

      for (const filename of axeFiles) {
        const filepath = path.join(dir, filename);
        try {
          const content = await fs.readFile(filepath, 'utf8');
          const axe = JSON.parse(content);

          // Check for duplicates - only override if the new version is actually newer
          const existingIdx = plugins.findIndex(p => p.manifest.id === axe.manifest.id);
          if (existingIdx !== -1) {
            const existing = plugins[existingIdx];
            const versionCmp = compareSemver(axe.manifest.version, existing.manifest.version);
            if (versionCmp > 0) {
              // Newer version found - override regardless of source
              plugins[existingIdx] = axe;
              axe._filename = filename;
              axe._source = source;
              console.log(`  🔄 Upgraded: ${axe.manifest.name} v${existing.manifest.version} → v${axe.manifest.version} (${source})`);
            } else if (versionCmp === 0 && existing._source === 'cache' && source === 'app') {
              // Same version but shipped app plugin is more authoritative than cache
              // (cache may have stale format from old marketplace downloads)
              plugins[existingIdx] = axe;
              axe._filename = filename;
              axe._source = source;
              console.log(`  🔄 Preferring shipped: ${axe.manifest.name} v${axe.manifest.version} over cached`);
            } else {
              console.log(`  ⚠️  Skipping ${axe.manifest.name} v${axe.manifest.version} from ${source} (already have v${existing.manifest.version} from ${existing._source})`);
            }
            continue;
          }

          axe._filename = filename;
          axe._source = source;
          plugins.push(axe);
          console.log(`  ✅ Loaded (${source}) ${axe.manifest.name} v${axe.manifest.version}`);
        } catch (error) {
          console.error(`  ❌ Failed to load ${filename}:`, error.message);
        }
      }
    } catch (error) {
      // Directory may not exist, that's ok
      if (error.code !== 'ENOENT') {
        console.error(`  ❌ Failed to read ${source} plugins:`, error.message);
      }
    }
  };

  // Load shipped plugins first (baseline)
  await loadPluginsFromDir(appPluginsDir, 'app');

  // Then load marketplace cache (overrides shipped versions with updates)
  await loadPluginsFromDir(pluginsDir, 'cache');

  console.log(`✅ Loaded ${plugins.length} plugin(s) total`);
  return plugins;
});

// Sync plugins with marketplace (fetch updates)
ipcMain.handle('plugins-sync-marketplace', async () => {
  console.log('=== Sync Plugins with Marketplace ===');
  const fs = require('fs').promises;
  const path = require('path');

  const pluginsDir = getPluginsCacheDir();
  await fs.mkdir(pluginsDir, { recursive: true });

  // Fetch manifest to get list of available plugins
  const manifest = await fetchPluginManifest();
  if (!manifest || !manifest.plugins) {
    console.log('  ❌ Could not fetch marketplace manifest');
    return { success: false, error: 'Could not reach marketplace' };
  }

  console.log(`  Found ${manifest.plugins.length} plugins in marketplace`);

  const updated = [];
  const added = [];
  const failed = [];

  for (const pluginInfo of manifest.plugins) {
    const pluginId = pluginInfo.id;
    const marketplaceVersion = pluginInfo.version;
    const cacheFile = path.join(pluginsDir, `${pluginId}.axe`);

    // Check if we have this plugin cached and what version
    let cachedVersion = null;
    try {
      const cached = await fs.readFile(cacheFile, 'utf8');
      const cachedPlugin = JSON.parse(cached);
      cachedVersion = cachedPlugin.manifest?.version;
    } catch (e) {
      // Not cached yet
    }

    // Download if not cached or outdated
    if (!cachedVersion || cachedVersion !== marketplaceVersion) {
      console.log(`  📥 Fetching ${pluginId} v${marketplaceVersion}...`);
      const plugin = await fetchPlugin(pluginId);

      if (plugin) {
        await fs.writeFile(cacheFile, JSON.stringify(plugin, null, 2), 'utf8');
        if (cachedVersion) {
          updated.push({ id: pluginId, from: cachedVersion, to: marketplaceVersion });
          console.log(`    ✅ Updated ${pluginId}: ${cachedVersion} → ${marketplaceVersion}`);
        } else {
          added.push({ id: pluginId, version: marketplaceVersion });
          console.log(`    ✅ Added ${pluginId} v${marketplaceVersion}`);
        }
      } else {
        failed.push(pluginId);
        console.log(`    ❌ Failed to fetch ${pluginId}`);
      }
    } else {
      console.log(`  ✓ ${pluginId} v${cachedVersion} (up to date)`);
    }
  }

  console.log(`✅ Sync complete: ${added.length} added, ${updated.length} updated, ${failed.length} failed`);
  return { success: true, added, updated, failed };
});

// File picker for resolvers
ipcMain.handle('resolvers-pick-file', async () => {
  console.log('=== Pick Resolver File ===');
  const { dialog } = require('electron');
  
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Resolver (.axe file)',
    buttonLabel: 'Install',
    filters: [
      { name: 'Parachord Resolver', extensions: ['axe'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  
  if (result.canceled || result.filePaths.length === 0) {
    console.log('  ❌ User cancelled');
    return null;
  }
  
  const filepath = result.filePaths[0];
  console.log('  Selected:', filepath);
  
  try {
    const fs = require('fs').promises;
    const path = require('path');
    const content = await fs.readFile(filepath, 'utf8');
    const filename = path.basename(filepath);
    
    // Validate it's valid JSON
    const axe = JSON.parse(content);
    
    // Validate it has required fields
    if (!axe.manifest || !axe.manifest.id || !axe.manifest.name) {
      throw new Error('Invalid .axe file: missing manifest.id or manifest.name');
    }
    
    console.log(`  ✅ Valid resolver: ${axe.manifest.name}`);
    return { content, filename };
  } catch (error) {
    console.error('  ❌ Failed to read file:', error.message);
    return { error: error.message };
  }
});

// Install plugin (from file picker or marketplace)
ipcMain.handle('resolvers-install', async (event, axeContent, filename) => {
  console.log('=== Install Plugin ===');
  console.log('  Installing:', filename);

  try {
    const fs = require('fs').promises;
    const path = require('path');

    // Validate content
    const axe = JSON.parse(axeContent);
    console.log(`  Plugin: ${axe.manifest.name} v${axe.manifest.version}`);

    // Sanitize filename — strip path separators and directory traversal
    const safeFilename = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
    if (!safeFilename.endsWith('.axe')) {
      throw new Error('Invalid filename: must end with .axe');
    }

    // Validate manifest.id format — alphanumeric, dots, dashes only
    if (axe.manifest.id && !/^[a-zA-Z0-9._-]+$/.test(axe.manifest.id)) {
      throw new Error('Invalid manifest.id: must contain only alphanumeric characters, dots, dashes, and underscores');
    }

    // Save to plugins cache directory
    const pluginsDir = getPluginsCacheDir();
    await fs.mkdir(pluginsDir, { recursive: true });

    const targetPath = path.join(pluginsDir, safeFilename);
    // Verify target is still within pluginsDir after path.join
    if (!targetPath.startsWith(pluginsDir)) {
      throw new Error('Invalid filename: path traversal detected');
    }
    await fs.writeFile(targetPath, axeContent, 'utf8');

    console.log(`  ✅ Installed to: ${targetPath}`);
    return { success: true, resolver: axe };
  } catch (error) {
    console.error('  ❌ Installation failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Uninstall plugin
ipcMain.handle('resolvers-uninstall', async (event, resolverId) => {
  console.log('=== Uninstall Plugin ===');
  console.log('  Plugin ID:', resolverId);

  try {
    const fs = require('fs').promises;
    const path = require('path');

    const pluginsDir = getPluginsCacheDir();

    // Find the .axe file for this plugin
    const files = await fs.readdir(pluginsDir);
    const axeFiles = files.filter(f => f.endsWith('.axe'));

    for (const filename of axeFiles) {
      const filepath = path.join(pluginsDir, filename);
      const content = await fs.readFile(filepath, 'utf8');
      const axe = JSON.parse(content);

      if (axe.manifest.id === resolverId) {
        await fs.unlink(filepath);
        console.log(`  ✅ Uninstalled: ${filename}`);
        return { success: true, name: axe.manifest.name };
      }
    }

    return { success: false, error: 'Plugin not found' };
  } catch (error) {
    console.error('  ❌ Uninstall failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Show context menu for resolver
ipcMain.handle('resolvers-show-context-menu', async (event, resolverId) => {
  console.log('=== Show Resolver Context Menu ===');
  console.log('  Resolver ID:', resolverId);

  const { Menu } = require('electron');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Uninstall Resolver',
      click: () => {
        // Send back to renderer
        safeSendToRenderer('resolver-context-menu-action', {
          action: 'uninstall',
          resolverId: resolverId
        });
      }
    }
  ]);

  menu.popup({ window: mainWindow });

  return { shown: true };
});

// Show context menu for playbar source (right-click on resolver name in playbar dropdown)
ipcMain.handle('show-playbar-source-context-menu', async (event, data) => {
  console.log('=== Show Playbar Source Context Menu ===');
  console.log('  Resolver ID:', data.resolverId);
  console.log('  Track:', data.track?.artist, '-', data.track?.title);

  const { Menu } = require('electron');

  const menuItems = [
    {
      label: 'Report Bad Match',
      click: () => {
        safeSendToRenderer('playbar-source-context-menu-action', {
          action: 'report-bad-match',
          resolverId: data.resolverId,
          track: data.track
        });
      }
    }
  ];

  const menu = Menu.buildFromTemplate(menuItems);
  menu.popup({ window: mainWindow });

  return { shown: true };
});

// Show context menu for tracks/playlists/releases
ipcMain.handle('show-track-context-menu', async (event, data) => {
  console.log('=== Show Track Context Menu ===');
  console.log('  Type:', data.type);

  const { Menu } = require('electron');

  let menuLabel;
  let enabled = true;

  switch (data.type) {
    case 'track':
      menuLabel = 'Add to Queue';
      break;
    case 'playlist':
      menuLabel = `Add All to Queue (${data.tracks?.length || 0} tracks)`;
      enabled = data.tracks?.length > 0;
      break;
    case 'release':
      if (data.tracks?.length > 0) {
        menuLabel = `Add All to Queue (${data.tracks.length} tracks)`;
      } else if (data.loading) {
        menuLabel = 'Add All to Queue (loading...)';
        enabled = false;
      } else {
        menuLabel = 'Add All to Queue (click album first)';
        enabled = false;
      }
      break;
    default:
      menuLabel = 'Add to Queue';
  }

  // Determine label for "Add to Playlist" option
  let addToPlaylistLabel;
  switch (data.type) {
    case 'track':
      addToPlaylistLabel = 'Add to Playlist...';
      break;
    case 'playlist':
      addToPlaylistLabel = `Add All to Playlist... (${data.tracks?.length || 0} tracks)`;
      break;
    case 'release':
      if (data.tracks?.length > 0) {
        addToPlaylistLabel = `Add All to Playlist... (${data.tracks.length} tracks)`;
      } else if (data.loading) {
        addToPlaylistLabel = 'Add All to Playlist... (loading...)';
      } else {
        addToPlaylistLabel = 'Add All to Playlist... (click album first)';
      }
      break;
    default:
      addToPlaylistLabel = 'Add to Playlist...';
  }

  const menuItems = [];

  // Only add queue/playlist options for types that have playable tracks
  // Exclude friend-track since it has its own specific menu items
  if (data.type !== 'artist' && data.type !== 'friend' && data.type !== 'friend-track' && data.type !== 'collection-album') {
    menuItems.push({
      label: menuLabel,
      enabled: enabled,
      click: () => {
        // Send tracks back to renderer
        const tracks = data.type === 'track' ? [data.track] : data.tracks;
        safeSendToRenderer('track-context-menu-action', {
          action: 'add-to-queue',
          tracks: tracks
        });
      }
    });
    menuItems.push({
      label: addToPlaylistLabel,
      enabled: enabled,
      click: () => {
        // Send tracks back to renderer to open Add to Playlist panel
        const tracks = data.type === 'track' ? [data.track] : data.tracks;
        console.log(`  📋 Add to Playlist clicked: type=${data.type}, tracks=${tracks?.length || 0}`);
        safeSendToRenderer('track-context-menu-action', {
          action: 'add-to-playlist',
          tracks: tracks,
          sourceName: data.type === 'track' ? data.track?.title : data.name,
          sourceType: data.type
        });
      }
    });
  }

  // Add "Remove from Playlist" option for tracks within a playlist
  if (data.type === 'track' && data.inPlaylist && data.playlistId !== undefined) {
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Remove from Playlist',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'remove-from-playlist',
          playlistId: data.playlistId,
          trackIndex: data.trackIndex,
          trackTitle: data.track?.title
        });
      }
    });
  }

  // Add delete option for playlists
  if (data.type === 'playlist' && data.playlistId) {
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Delete Playlist',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'delete-playlist',
          playlistId: data.playlistId,
          name: data.name
        });
      }
    });
  }

  // Add "Edit ID3 Tags" option for local files (tracks with filePath)
  const trackFilePath = data.track?.filePath || data.track?.sources?.localfiles?.filePath;
  if (data.type === 'track' && trackFilePath) {
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Edit ID3 Tags',
      click: () => {
        // Ensure filePath is at top level (may only be in sources.localfiles for multi-source tracks)
        const trackWithFilePath = data.track.filePath ? data.track : { ...data.track, filePath: trackFilePath };
        safeSendToRenderer('track-context-menu-action', {
          action: 'edit-id3-tags',
          track: trackWithFilePath
        });
      }
    });
  }

  // Add "Remove from Collection" option for collection albums
  if (data.type === 'collection-album') {
    menuItems.push({
      label: 'Remove from Collection',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'remove-from-collection',
          type: 'album',
          album: data.album
        });
      }
    });
  }

  // Add "Add to Collection" option for tracks, albums, and artists
  if (data.type === 'track' || data.type === 'release' || data.type === 'artist') {
    // Only add separator if there are items before (not for artist-only menus)
    if (menuItems.length > 0) {
      menuItems.push({ type: 'separator' });
    }

    if (data.type === 'track') {
      if (data.isInCollection) {
        menuItems.push({
          label: 'Remove from Collection',
          click: () => {
            safeSendToRenderer('track-context-menu-action', {
              action: 'remove-from-collection',
              type: 'track',
              track: data.track
            });
          }
        });
      } else {
        menuItems.push({
          label: 'Add to Collection',
          click: () => {
            safeSendToRenderer('track-context-menu-action', {
              action: 'add-to-collection',
              type: 'track',
              track: data.track
            });
          }
        });
      }
    } else if (data.type === 'release') {
      menuItems.push({
        label: 'Add Album to Collection',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'add-to-collection',
            type: 'album',
            album: data.album || {
              title: data.name,
              artist: data.artist,
              year: data.year,
              art: data.albumArt
            }
          });
        }
      });
    } else if (data.type === 'artist') {
      menuItems.push({
        label: 'Add Artist to Collection',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'add-to-collection',
            type: 'artist',
            artist: data.artist
          });
        }
      });
    }
  }

  // Add Copy-link options for tracks, releases, artists, and collection albums.
  // Playlists are deliberately excluded — Achordion has no playlist entity
  // surface yet, so we hide the menu item rather than show one that errors.
  if (data.type === 'track' || data.type === 'release' || data.type === 'artist' || data.type === 'collection-album') {
    menuItems.push({ type: 'separator' });

    if (data.type === 'track') {
      // Single track smart link
      menuItems.push({
        label: 'Copy link',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'publish-smart-link',
            track: data.track
          });
        }
      });
      menuItems.push({
        label: 'View on Achordion',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'view-on-achordion-track',
            track: data.track
          });
        }
      });

    } else if (data.type === 'artist') {
      menuItems.push({
        label: 'Copy link',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'publish-artist-smart-link',
            artist: data.artist
          });
        }
      });
      menuItems.push({
        label: 'View on Achordion',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'view-on-achordion-artist',
            artist: data.artist
          });
        }
      });

    } else {
      // Album/playlist smart link with tracklist
      const isPlaylist = data.type === 'playlist';
      const collectionArtist = data.album?.artist || data.artist || data.tracks?.[0]?.artist || null;
      const collectionArt = data.album?.art || data.albumArt || data.tracks?.[0]?.albumArt || null;
      // Harvest any available album MBID. Achordion's entity-link endpoint
      // accepts both release-group and release MBIDs for type=album (release
      // MBIDs are mapped server-side to the canonical release-group page),
      // so any of these wires us into a direct /release-group/<mbid> URL
      // instead of falling through to /release-group/lookup. Fields, in
      // priority order: explicit album MBID fields → the data.id at this
      // level (typically a release-group MBID for MB-derived album data) →
      // the first track's releaseMbid (mapper-enriched specific edition).
      const albumMbid = data.album?.mbid
        || data.album?.releaseGroupMbid
        || data.album?.id
        || data.mbid
        || data.releaseGroupMbid
        || (data.type === 'release' || data.type === 'collection-album' ? data.id : null)
        || data.tracks?.[0]?.releaseMbid
        || null;
      const collectionData = {
        title: data.name || data.title || data.album?.title,
        artist: collectionArtist,
        creator: data.creator || null,
        albumArt: collectionArt,
        type: isPlaylist ? 'playlist' : 'album',
        mbid: albumMbid,
        tracks: (data.tracks || []).map((t, i) => ({
          title: t.title || 'Unknown',
          artist: t.artist || collectionArtist || null,
          duration: t.duration || (t.length ? Math.round(t.length / 1000) : null),
          trackNumber: t.trackNumber || t.position || (i + 1)
        }))
      };

      menuItems.push({
        label: 'Copy link',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'publish-collection-smart-link',
            collection: collectionData
          });
        }
      });
      // Playlists: Achordion has no entity surface yet (issue #775), so the
      // View-on-Achordion item only makes sense for albums.
      if (!isPlaylist) {
        menuItems.push({
          label: 'View on Achordion',
          click: () => {
            safeSendToRenderer('track-context-menu-action', {
              action: 'view-on-achordion-collection',
              collection: collectionData
            });
          }
        });
      }

    }
  }

  // Add friend-specific menu items
  if (data.type === 'friend') {
    menuItems.push({
      label: 'View History',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'view-friend-history',
          friend: data.friend
        });
      }
    });

    // Listen Along option - only show when friend is on-air
    if (data.isOnAir) {
      menuItems.push({
        label: data.isListeningAlong ? 'Stop Listening Along' : 'Listen Along',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: data.isListeningAlong ? 'stop-listen-along' : 'start-listen-along',
            friend: data.friend
          });
        }
      });
    }

    if (data.isPinned) {
      menuItems.push({
        label: 'Unpin from Sidebar',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'unpin-friend',
            friendId: data.friend.id
          });
        }
      });
    } else {
      menuItems.push({
        label: 'Pin to Sidebar',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'pin-friend',
            friendId: data.friend.id
          });
        }
      });
    }

    // Show "Add to Collection" for unsaved friends, "Remove from Collection" for saved friends
    // Note: undefined/null treated as saved (backwards compatibility for friends added before this feature)
    const isSaved = data.isSavedToCollection !== false;
    if (!isSaved) {
      menuItems.push({
        label: 'Add to Collection',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'save-friend-to-collection',
            friendId: data.friend.id
          });
        }
      });
    } else {
      menuItems.push({
        label: 'Remove from Collection',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'remove-friend-from-collection',
            friendId: data.friend.id
          });
        }
      });
    }

    // Only show "Remove Friend" if saved to collection (for unsaved+pinned friends, Unpin handles removal)
    if (isSaved) {
      menuItems.push({ type: 'separator' });
      menuItems.push({
        label: 'Remove Friend',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'remove-friend',
            friendId: data.friend.id
          });
        }
      });
    }
  }

  // Friend's now-playing track context menu
  if (data.type === 'friend-track') {
    menuItems.push({
      label: 'Add to Queue',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'add-to-queue',
          track: data.track
        });
      }
    });
    menuItems.push({
      label: 'Add to Playlist',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'add-to-playlist',
          track: data.track
        });
      }
    });
    menuItems.push({
      label: 'Add to Collection',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'add-track-to-collection',
          track: data.track
        });
      }
    });
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Go to Artist',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'go-to-artist',
          artistName: data.track.artist
        });
      }
    });
  }

  const menu = Menu.buildFromTemplate(menuItems);

  menu.popup({ window: mainWindow });

  return { shown: true };
});

// Marketplace handlers
ipcMain.handle('release-notes-get', async () => {
  const fs = require('fs').promises;
  const notesPath = require('path').join(__dirname, 'RELEASE_NOTES.md');
  const currentVersion = app.getVersion();

  function parseHighlights(content) {
    // Extract section highlights: each "##" or "###" heading with its first bullet or paragraph
    const sections = content.split(/\n(?=#{2,3} )/);
    const highlights = [];
    for (const section of sections) {
      const titleMatch = section.match(/^#{2,3} (.+)/);
      if (!titleMatch) continue;
      const title = titleMatch[1].trim()
        .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1');

      const lines = section.split('\n').slice(1);
      let text = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === '---') continue;
        // Skip sub-headings within the section
        if (/^#{1,6} /.test(trimmed)) continue;
        text = trimmed
          .replace(/^[-*+] /, '')
          .replace(/\*\*\*(.+?)\*\*\*/g, '$1')
          .replace(/\*\*(.+?)\*\*/g, '$1')
          .replace(/\*(.+?)\*/g, '$1')
          .replace(/`([^`]+)`/g, '$1');
        break;
      }
      if (title && text) {
        highlights.push({ title, text });
      }
    }
    return highlights;
  }

  // Try GitHub Releases API — exact version first, then latest as fallback
  try {
    const { net } = require('electron');
    const headers = { 'Accept': 'application/vnd.github+json' };
    const fetchOpts = { signal: AbortSignal.timeout(5000), headers };

    // 1) Try the release matching this app's version
    let release = null;
    const tagResponse = await net.fetch(
      `https://api.github.com/repos/Parachord/parachord/releases/tags/v${currentVersion}`,
      fetchOpts
    );
    if (tagResponse.ok) {
      release = await tagResponse.json();
    } else {
      // 2) Tag not found — fall back to latest release
      console.log(`📋 No GitHub release for v${currentVersion}, trying latest`);
      const latestResponse = await net.fetch(
        'https://api.github.com/repos/Parachord/parachord/releases?per_page=1',
        fetchOpts
      );
      if (latestResponse.ok) {
        const releases = await latestResponse.json();
        release = releases[0];
      }
    }

    if (release?.body) {
      console.log(`📋 Loaded release notes from GitHub: ${release.tag_name}`);
      const highlights = parseHighlights(release.body);
      if (highlights.length > 0) {
        return { success: true, highlights };
      }
    }
  } catch (e) {
    console.log('📋 GitHub releases fetch failed, using bundled notes:', e.message);
  }

  // Fall back to bundled RELEASE_NOTES.md (first release section only)
  try {
    const content = await fs.readFile(notesPath, 'utf8');
    const firstRelease = content.split(/\n(?=# Parachord )/)[0] || '';
    return { success: true, highlights: parseHighlights(firstRelease) };
  } catch (error) {
    console.error('Failed to load release notes:', error.message);
    return { success: false, highlights: [] };
  }
});

ipcMain.handle('marketplace-get-manifest', async () => {
  console.log('=== Get Marketplace Manifest ===');
  const fs = require('fs').promises;
  const path = require('path');

  try {
    // Try to load embedded manifest
    const manifestPath = path.join(__dirname, 'marketplace-manifest.json');
    const content = await fs.readFile(manifestPath, 'utf8');
    const manifest = JSON.parse(content);

    console.log(`✅ Loaded ${manifest.plugins.length} marketplace plugins`);
    return { success: true, manifest };
  } catch (error) {
    console.error('Failed to load marketplace manifest:', error.message);
    return { success: false, error: error.message, manifest: { version: '1.0.0', plugins: [] } };
  }
});

ipcMain.handle('marketplace-download-resolver', async (event, url) => {
  console.log('=== Download Resolver from URL ===');
  console.log('  URL:', url);

  try {
    // Validate URL
    const urlObj = new URL(url);
    if (urlObj.protocol !== 'http:' && urlObj.protocol !== 'https:') {
      throw new Error('Only HTTP and HTTPS URLs are allowed');
    }

    // Fetch the .axe file
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const content = await response.text();

    // Validate it's valid JSON
    const axe = JSON.parse(content);

    // Validate required fields
    if (!axe.manifest || !axe.manifest.id || !axe.manifest.name) {
      throw new Error('Invalid .axe file: missing required manifest fields');
    }

    console.log(`✅ Downloaded resolver: ${axe.manifest.name}`);

    // Validate and sanitize manifest.id for use as filename
    if (!/^[a-zA-Z0-9._-]+$/.test(axe.manifest.id)) {
      throw new Error('Invalid manifest.id: must contain only alphanumeric characters, dots, dashes, and underscores');
    }
    const filename = `${axe.manifest.id}.axe`;

    return { success: true, content, filename, resolver: axe };
  } catch (error) {
    console.error('  ❌ Download failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Playlist handlers - all playlists stored in electron-store (local_playlists key)
ipcMain.handle('playlists-load', async () => {
  console.log('=== Load Playlists from electron-store ===');

  try {
    const playlists = store.get('local_playlists') || [];

    // Sort by addedAt descending (newest first) before returning
    playlists.sort((a, b) => {
      const aTime = Number(a.addedAt) || Number(a.lastModified) || Number(a.createdAt) || 0;
      const bTime = Number(b.addedAt) || Number(b.lastModified) || Number(b.createdAt) || 0;
      return bTime - aTime;
    });

    console.log(`✅ Loaded ${playlists.length} playlist(s) from electron-store`);
    return playlists;
  } catch (error) {
    console.error('Error loading playlists:', error.message);
    return [];
  }
});

ipcMain.handle('playlists-import', async () => {
  console.log('=== Import Playlist ===');
  const { dialog } = require('electron');
  const fs = require('fs').promises;
  
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Playlist',
      filters: [
        { name: 'XSPF Playlists', extensions: ['xspf'] }
      ],
      properties: ['openFile']
    });
    
    if (result.canceled || result.filePaths.length === 0) {
      console.log('  User cancelled');
      return null;
    }
    
    const filepath = result.filePaths[0];
    console.log('  Selected:', filepath);
    
    const content = await fs.readFile(filepath, 'utf8');
    const filename = require('path').basename(filepath);
    
    // Validate it's valid XML
    try {
      // Basic validation
      if (!content.includes('<playlist') || !content.includes('</playlist>')) {
        throw new Error('Not a valid XSPF playlist file');
      }
    } catch (error) {
      throw new Error('Invalid XSPF file: ' + error.message);
    }
    
    console.log('  ✅ Valid XSPF file');
    return { content, filename };
  } catch (error) {
    console.error('  ❌ Import failed:', error.message);
    return { error: error.message };
  }
});

ipcMain.handle('playlists-save', async (event, playlistData) => {
  console.log('=== Save Playlist to electron-store ===');
  console.log('  Playlist ID:', playlistData?.id);

  try {
    const playlists = store.get('local_playlists') || [];

    // Check if playlist already exists
    const existingIndex = playlists.findIndex(p => p.id === playlistData.id);

    if (existingIndex >= 0) {
      // Update existing playlist
      playlists[existingIndex] = playlistData;
      console.log('  ✅ Updated existing playlist');
    } else {
      // Add new playlist
      playlists.push(playlistData);
      console.log('  ✅ Added new playlist');
    }

    store.set('local_playlists', playlists);
    console.log(`  ✅ Saved ${playlists.length} playlist(s) to electron-store`);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Save failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('playlists-delete', async (event, playlistId) => {
  console.log('=== Delete Playlist from electron-store ===');
  console.log('  Playlist ID:', playlistId);

  try {
    const playlists = store.get('local_playlists') || [];
    const initialCount = playlists.length;

    // Filter out the playlist with matching ID
    const filteredPlaylists = playlists.filter(p => p.id !== playlistId);

    if (filteredPlaylists.length === initialCount) {
      console.log('  ❌ Playlist not found');
      return { success: false, error: 'Playlist not found' };
    }

    store.set('local_playlists', filteredPlaylists);
    console.log('  ✅ Deleted playlist');
    return { success: true };
  } catch (error) {
    console.error('  ❌ Delete failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('playlists-suppress-sync', async (event, providerId, externalId) => {
  console.log(`=== Suppress Sync: ${providerId}/${externalId} ===`);
  try {
    const suppressed = store.get('suppressed_sync_playlists') || {};
    if (!suppressed[providerId]) {
      suppressed[providerId] = [];
    }
    if (!suppressed[providerId].includes(externalId)) {
      suppressed[providerId].push(externalId);
    }
    store.set('suppressed_sync_playlists', suppressed);
    console.log('  ✅ Playlist suppressed from future syncs');
    return { success: true };
  } catch (error) {
    console.error('  ❌ Suppress failed:', error.message);
    return { success: false, error: error.message };
  }
});

// ---------------------------------------------------------------------------
// Sync playlist links — durable local→remote ID map
// ---------------------------------------------------------------------------
//
// Primary duplicate-prevention is `syncedTo[providerId].externalId` on each
// local playlist. That field is fragile: any playlist-save path that forgets
// to forward it drops the link, and the next sync creates a remote duplicate.
//
// `sync_playlist_links` is an independent, write-only-from-main store keyed
// by local playlist ID. It's never written by renderer playlist saves, so it
// can't be clobbered by a save that omits fields. Before creating a playlist
// on a remote, we consult this map; if we already have a link, we verify the
// remote still exists and reuse it instead of creating a duplicate.
//
// Shape: { [localPlaylistId]: { [providerId]: { externalId, syncedAt } } }
//
function getSyncLinks() {
  return store.get('sync_playlist_links') || {};
}

function setSyncLink(localPlaylistId, providerId, externalId) {
  if (!localPlaylistId || !providerId || !externalId) return;
  const links = getSyncLinks();
  if (!links[localPlaylistId]) links[localPlaylistId] = {};
  links[localPlaylistId][providerId] = { externalId, syncedAt: Date.now() };
  store.set('sync_playlist_links', links);
}

function removeSyncLink(localPlaylistId, providerId) {
  if (!localPlaylistId) return;
  const links = getSyncLinks();
  if (!links[localPlaylistId]) return;
  if (providerId) {
    delete links[localPlaylistId][providerId];
    if (Object.keys(links[localPlaylistId]).length === 0) {
      delete links[localPlaylistId];
    }
  } else {
    delete links[localPlaylistId];
  }
  store.set('sync_playlist_links', links);
}

ipcMain.handle('sync-links:get-all', async () => getSyncLinks());
ipcMain.handle('sync-links:set', async (event, localPlaylistId, providerId, externalId) => {
  setSyncLink(localPlaylistId, providerId, externalId);
  return { success: true };
});
ipcMain.handle('sync-links:remove', async (event, localPlaylistId, providerId) => {
  removeSyncLink(localPlaylistId, providerId);
  return { success: true };
});

// ── N-way state model (Phase 1, parachord#911) ──────────────────────
//
// `sync_playlist_state` is an independent, main-write-only electron-store
// map — same durability pattern as `sync_playlist_links` (renderer playlist
// saves can't clobber it). It holds the per-playlist 3-way-merge baseline +
// per-(playlist, provider) sync record, ALONGSIDE the existing canonical-
// source fields (which stay). NOTHING reads or writes this yet: Phase 2
// (bootstrap migration) populates it, Phase 3 (shadow mode) reads it, Phase
// 4 enables propagation. Adding the schema + accessors now, behavior-neutral.
//
// Shape:
//   { [localPlaylistId]: {
//       baseline: string[],            // ordered canonical keys (merge ancestor)
//       baselineSyncedAt: number,
//       providers: {
//         [providerId]: { changeToken: string|null, editedAt: number, lastSyncedAt: number }
//       }
//   } }
//
// Derivations for what goes IN here live in the pure module
// sync-engine/playlist-sync-state.js (buildBaseline / deriveChangeToken /
// deriveEditedAt) — kept separate + unit-tested.
function getSyncStates() {
  return store.get('sync_playlist_state') || {};
}

function getPlaylistSyncState(localPlaylistId) {
  if (!localPlaylistId) return null;
  return getSyncStates()[localPlaylistId] || null;
}

function setPlaylistBaseline(localPlaylistId, baseline, baselineSyncedAt) {
  if (!localPlaylistId || !Array.isArray(baseline)) return;
  const states = getSyncStates();
  const entry = states[localPlaylistId] || { baseline: [], baselineSyncedAt: 0, providers: {} };
  entry.baseline = baseline.slice();
  entry.baselineSyncedAt = typeof baselineSyncedAt === 'number' ? baselineSyncedAt : Date.now();
  if (!entry.providers) entry.providers = {};
  states[localPlaylistId] = entry;
  store.set('sync_playlist_state', states);
}

function setProviderSyncState(localPlaylistId, providerId, { changeToken, editedAt, lastSyncedAt } = {}) {
  if (!localPlaylistId || !providerId) return;
  const states = getSyncStates();
  const entry = states[localPlaylistId] || { baseline: [], baselineSyncedAt: 0, providers: {} };
  if (!entry.providers) entry.providers = {};
  const prev = entry.providers[providerId] || {};
  entry.providers[providerId] = {
    changeToken: changeToken !== undefined ? (changeToken || null) : (prev.changeToken || null),
    editedAt: typeof editedAt === 'number' ? editedAt : (prev.editedAt || 0),
    lastSyncedAt: typeof lastSyncedAt === 'number' ? lastSyncedAt : (prev.lastSyncedAt || Date.now()),
  };
  states[localPlaylistId] = entry;
  store.set('sync_playlist_state', states);
}

function removePlaylistSyncState(localPlaylistId, providerId) {
  if (!localPlaylistId) return;
  const states = getSyncStates();
  if (!states[localPlaylistId]) return;
  if (providerId) {
    if (states[localPlaylistId].providers) delete states[localPlaylistId].providers[providerId];
  } else {
    delete states[localPlaylistId];
  }
  store.set('sync_playlist_state', states);
}

ipcMain.handle('sync-state:get-all', async () => getSyncStates());
ipcMain.handle('sync-state:get', async (event, localPlaylistId) => getPlaylistSyncState(localPlaylistId));

// ---------------------------------------------------------------------------
// Achordion playlist-links submission (LB-anchored mirror map)
// ---------------------------------------------------------------------------
//
// After a successful LB-anchored playlist sync write (create or push), submit
// the playlist's mirror links to Achordion's /api/playlist-links/submit. The
// ListenBrainz MBID is the cross-platform anchor for Achordion's keyspace:
// either Parachord pushed local→LB (so syncedTo.listenbrainz.externalId is
// the MBID) or Parachord imported LB→local (so syncedFrom.externalId is the
// MBID). Either path lets Achordion stitch a Spotify/Apple Music/LB mirror
// together by the LB MBID. Submission is fire-and-forget — sync success
// must not depend on this network call.
//
// Bearer token is shared with track-links/submit (plugins/achordion.axe).
const ACHORDION_BEARER = 'parachord_rgOgj2trN2KeIovar9DYA-yOCRkxgO6KlSyAo_jHtgg';
const ACHORDION_PLAYLIST_LINKS_URL = 'https://achordion.xyz/api/playlist-links/submit';

// Slugify a playlist title for Apple Music share URLs. AM's share URL form is
// `https://music.apple.com/us/playlist/<slug>/<pl.u-id>`. The slug is for
// readability — AM redirects to the canonical slug regardless of what you
// pass, but matching their convention keeps things stable.
function slugifyForAppleMusic(title) {
  if (typeof title !== 'string') return 'playlist';
  return title
    .toLowerCase()
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')  // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100)
    || 'playlist';
}

// Fetch the public-share URL for an Apple Music library playlist by reading
// `attributes.playParams.globalId` (the `pl.u-XXXX` form) and combining with
// a title slug. Returns `null` when the globalId isn't yet available (newly-
// created playlists may take a few seconds before iCloud Music Library
// reflects them) or when AM auth is missing.
async function fetchAppleMusicPublicPlaylistUrl(libraryId) {
  if (!libraryId) return null;
  // Acquire AM credentials the same way every other AM IPC handler does.
  if (!generatedMusicKitToken) {
    await musicKitTokenReady;
  }
  const developerToken = generatedMusicKitToken
    || process.env.MUSICKIT_DEVELOPER_TOKEN
    || store.get('applemusic_developer_token');
  const userToken = store.get('applemusic_user_token');
  if (!developerToken || !userToken) return null;

  const res = await fetch(`https://api.music.apple.com/v1/me/library/playlists/${encodeURIComponent(libraryId)}`, {
    headers: {
      'Authorization': `Bearer ${developerToken}`,
      'Music-User-Token': userToken,
    },
  });
  if (!res.ok) {
    // 404 happens for playlists not yet reflected in iCloud Music Library, or
    // when the user has revoked AM access. Either way, return null and let
    // the caller omit the AM link rather than send a broken URL.
    return null;
  }
  const data = await res.json();
  const item = Array.isArray(data?.data) ? data.data[0] : null;
  const attrs = item?.attributes;
  const globalId = attrs?.playParams?.globalId;
  // For Parachord-created library playlists, Apple does NOT auto-generate a
  // catalog reflection — `hasCatalog: false` and `playParams.globalId` is
  // absent until the user manually taps "Share Playlist" in the Music app
  // (which is what creates the `pl.u-XXXX` ID). Without that step there's
  // no public URL to construct. See follow-up issue #826 for ideas on
  // closing this gap (private share endpoint, manual entry, etc.).
  if (!globalId || typeof globalId !== 'string' || !globalId.startsWith('pl.')) {
    if (attrs && attrs.hasCatalog === false) {
      // One-line breadcrumb for the common case so it's clear WHY we omit.
      console.log(`[achordion] AM playlist ${libraryId} not yet published (hasCatalog=false) — omitting AM link`);
    }
    return null;
  }
  const slug = slugifyForAppleMusic(attrs?.name);
  return `https://music.apple.com/us/playlist/${slug}/${globalId}`;
}

async function pushPlaylistLinksToAchordion(localPlaylist) {
  if (!localPlaylist) return;
  const links = [];
  const syncedTo = localPlaylist.syncedTo || {};
  if (syncedTo.spotify?.externalId) {
    links.push({
      host: 'open.spotify.com',
      url: `https://open.spotify.com/playlist/${syncedTo.spotify.externalId}`,
      label: 'Spotify',
    });
  }
  // Apple Music: the library playlist ID (`p.XXXX`) only resolves at
  // `https://music.apple.com/library/playlist/<id>`, which is the owner's
  // private library view — non-owners get "This playlist isn't available."
  // The shareable URL form is
  // `https://music.apple.com/us/playlist/<slug>/<pl.u-XXXX>` where the
  // `pl.u-` ID is Apple Music's catalog reflection of the library playlist
  // (auto-generated for every iCloud-synced playlist; no explicit "publish"
  // step). That ID is exposed via `attributes.playParams.globalId` on the
  // LibraryPlaylists resource. Fetch it on demand and construct the URL.
  if (syncedTo.applemusic?.externalId) {
    try {
      const amPublicUrl = await fetchAppleMusicPublicPlaylistUrl(syncedTo.applemusic.externalId);
      if (amPublicUrl) {
        links.push({ host: 'music.apple.com', url: amPublicUrl, label: 'Apple Music' });
      } else {
        console.log(`[achordion] AM publicUrl unavailable for ${syncedTo.applemusic.externalId} — omitting AM link`);
      }
    } catch (err) {
      console.warn(`[achordion] AM publicUrl fetch failed for ${syncedTo.applemusic.externalId}: ${err && err.message ? err.message : err}`);
      // Omit AM link rather than send the owner-only library URL.
    }
  }
  if (syncedTo.listenbrainz?.externalId) {
    links.push({
      host: 'listenbrainz.org',
      url: `https://listenbrainz.org/playlist/${syncedTo.listenbrainz.externalId}`,
      label: 'ListenBrainz',
    });
  }
  // The LB MBID is the cross-platform anchor for Achordion's keyspace.
  // It can come from either syncedTo (Parachord pushed local→LB) or
  // syncedFrom (Parachord imported LB→local). Either works as the key.
  const lbMbid = syncedTo.listenbrainz?.externalId
    || (localPlaylist.syncedFrom?.resolver === 'listenbrainz' && localPlaylist.syncedFrom.externalId);
  if (!lbMbid || links.length === 0) return;

  // Build the payload with `name`/`creatorName` ONLY when they're non-empty
  // strings. Achordion's zod schema declares these as `.optional()` — accepts
  // string OR omitted, but NOT `null`. Sending `creatorName: null` causes a
  // 400 "invalid body" with a `[pl-links] submit: invalid body —
  // creatorName: Expected string, received null` line in Achordion's logs
  // (no signal visible from the Parachord side). This was the root cause of
  // empty Upstash playlist-links storage despite the submit code firing —
  // every submission was silently rejected because `buildLocalPlaylistMirrorContext`
  // hardcodes `creator: null`, which then surfaced as `creatorName: null` here.
  const payload = { mbid: lbMbid, links };
  if (typeof localPlaylist.title === 'string' && localPlaylist.title.trim()) {
    payload.name = localPlaylist.title.trim().slice(0, 500);
  }
  if (typeof localPlaylist.creator === 'string' && localPlaylist.creator.trim()) {
    payload.creatorName = localPlaylist.creator.trim().slice(0, 200);
  }
  if (Array.isArray(localPlaylist.tracks)) {
    payload.trackCount = localPlaylist.tracks.length;
  }

  try {
    const res = await fetch(ACHORDION_PLAYLIST_LINKS_URL, {
      method: 'POST',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ACHORDION_BEARER}`,
      },
      body: JSON.stringify(payload),
    });
    if (res && res.status === 401) {
      // Token mismatch — log and move on; do NOT escalate to user UI.
      console.warn('[achordion] playlist-links submit returned 401 (auth) — skipping');
      return;
    }
    if (res && !res.ok) {
      console.warn(`[achordion] playlist-links submit returned HTTP ${res.status} for mbid=${lbMbid}`);
      return;
    }
    console.log(`[achordion] playlist-links submitted: mbid=${lbMbid} links=${links.length}`);
  } catch (err) {
    console.warn('[achordion] playlist-links submit failed:', err && err.message ? err.message : err);
  }
}

// Build a localPlaylist-shaped object for pushPlaylistLinksToAchordion from
// main-process state (sync_playlist_links + the just-completed write). Used
// at the sync:create-playlist / sync:push-playlist call sites where we don't
// have the full renderer-side playlist object.
//
// Pulls `title` and `creator` from `local_playlists` when available so the
// Achordion submission carries real metadata. The caller's `name` is used
// as a fallback for `title` (covers freshly-created playlists that may not
// have synced to disk yet) but `creator` falls back to undefined rather
// than null — pushPlaylistLinksToAchordion omits the field entirely when
// it isn't a non-empty string, which is what Achordion's zod schema
// expects (`.optional()` rejects explicit null).
function buildLocalPlaylistMirrorContext({ localPlaylistId, providerId, externalId, name, tracks, syncedFromOverride }) {
  // Start with all known mirrors from the durable link map.
  const allLinks = (localPlaylistId && getSyncLinks()[localPlaylistId]) || {};
  const syncedTo = {};
  for (const [pid, entry] of Object.entries(allLinks)) {
    if (entry?.externalId) {
      syncedTo[pid] = { externalId: entry.externalId };
    }
  }
  // Overlay the just-written link in case sync_playlist_links hasn't been
  // updated yet for this op (defense-in-depth).
  if (providerId && externalId) {
    syncedTo[providerId] = { externalId };
  }

  // Look up the on-disk local playlist to recover real `creator` and to
  // backfill `title` if the caller didn't pass `name`. Cheap — the
  // local_playlists array is already cached in electron-store's in-memory
  // parsed form.
  let storedTitle, storedCreator;
  if (localPlaylistId) {
    const playlists = store.get('local_playlists') || [];
    const stored = playlists.find(p => p.id === localPlaylistId);
    if (stored) {
      storedTitle = stored.title;
      storedCreator = stored.creator;
    }
  }

  return {
    title: name || storedTitle,
    tracks: Array.isArray(tracks) ? tracks : [],
    syncedTo,
    syncedFrom: syncedFromOverride || null,
    creator: storedCreator,
  };
}

// Relink orphaned local playlists to matching remotes by name.
//
// A local playlist is "orphaned" for a provider when:
//   - it has tracks and isn't localOnly
//   - syncedTo[provider] is missing
//   - syncedFrom for that provider is also missing
//   - the sync_playlist_links map has no entry either
//
// When an orphan has an unambiguous 1:1 name match against a user-owned
// remote, we set syncedTo and the link-map entry. When either side has
// multiple candidates, we refuse to pick automatically and surface the
// case in `ambiguous`.
//
// Does NOT mark playlists as locallyModified — relinking is pure
// bookkeeping, not a user intent to push track changes.
//
// Returns { linked: [...], ambiguous: [...], orphanCount }. Mutates store
// on-disk state (local_playlists, sync_playlist_links).
function relinkOrphansFor(providerId, ownedRemote) {
  const localPlaylists = store.get('local_playlists') || [];
  const links = getSyncLinks();
  const normalize = s => (s || '').trim().toLowerCase();

  const remoteByName = new Map();
  for (const r of ownedRemote || []) {
    const key = normalize(r.name);
    if (!remoteByName.has(key)) remoteByName.set(key, []);
    remoteByName.get(key).push(r);
  }

  const isLinked = (p) =>
    p.syncedTo?.[providerId]?.externalId ||
    (p.syncedFrom?.resolver === providerId && p.syncedFrom?.externalId) ||
    links[p.id]?.[providerId]?.externalId;

  const orphans = localPlaylists.filter(p =>
    !p.localOnly &&
    !isLinked(p) &&
    (p.tracks?.length || 0) > 0
  );

  const orphansByName = new Map();
  for (const o of orphans) {
    const key = normalize(o.title);
    if (!orphansByName.has(key)) orphansByName.set(key, []);
    orphansByName.get(key).push(o);
  }

  const linked = [];
  const ambiguous = [];

  for (const [key, orphanList] of orphansByName) {
    const remoteMatches = remoteByName.get(key) || [];
    if (remoteMatches.length === 0) continue; // no remote match — create path will handle

    if (orphanList.length > 1) {
      ambiguous.push({
        name: orphanList[0].title,
        localIds: orphanList.map(o => o.id),
        remoteExternalIds: remoteMatches.map(r => r.externalId),
        reason: 'multiple-locals'
      });
      continue;
    }
    if (remoteMatches.length > 1) {
      ambiguous.push({
        name: orphanList[0].title,
        localIds: [orphanList[0].id],
        remoteExternalIds: remoteMatches.map(r => r.externalId),
        reason: 'multiple-remotes'
      });
      continue;
    }

    const orphan = orphanList[0];
    const match = remoteMatches[0];
    linked.push({
      localId: orphan.id,
      localTitle: orphan.title,
      externalId: match.externalId,
      remoteName: match.name,
      trackCountLocal: orphan.tracks?.length || 0,
      trackCountRemote: match.trackCount || 0
    });
  }

  if (linked.length > 0) {
    const linkedByLocalId = new Map(linked.map(l => [l.localId, l]));
    const now = Date.now();
    const updatedLocal = localPlaylists.map(p => {
      const link = linkedByLocalId.get(p.id);
      if (!link) return p;
      const existingSyncedTo = p.syncedTo || {};
      // Flag the freshly-linked playlist as locallyModified so the next
      // sync push populates the remote. This covers three cases:
      //   - Remote is empty (common — we just linked to a placeholder that
      //     another buggy sync had created but never populated).
      //   - Remote has drifted from local content (mirror contract says
      //     local wins on next push).
      //   - Remote already matches local (push diff is empty, near-zero
      //     cost with the full-diff update semantics we use now).
      // Without this flag the push loop skips (!syncInfo branch doesn't
      // fire because syncedTo exists; the else-if branch needs
      // locallyModified) and the linked remote stays empty forever.
      return {
        ...p,
        locallyModified: true,
        lastModified: now,
        syncedTo: {
          ...existingSyncedTo,
          [providerId]: {
            externalId: link.externalId,
            snapshotId: null,
            syncedAt: now,
            unresolvedTracks: [],
            pendingAction: null
          }
        }
      };
    });
    store.set('local_playlists', updatedLocal);
    for (const l of linked) {
      setSyncLink(l.localId, providerId, l.externalId);
    }
    console.log(`[Sync Relink] Linked ${linked.length} orphan(s) to ${providerId}${ambiguous.length > 0 ? ` (${ambiguous.length} ambiguous)` : ''}`);
  }

  return {
    linked,
    ambiguous,
    orphanCount: orphans.length
  };
}

// Startup migration: populate sync_playlist_links from existing syncedTo data
// on local playlists. Idempotent and safe to run on every launch — if the map
// already has an entry, syncedTo is the newer source of truth anyway (sync
// writes the map AND syncedTo together post-fix), and re-populating from
// syncedTo just refreshes stale entries.
function migrateSyncLinksFromPlaylists() {
  try {
    const playlists = store.get('local_playlists') || [];
    const links = getSyncLinks();
    let added = 0;
    for (const p of playlists) {
      if (!p.id || !p.syncedTo) continue;
      for (const [providerId, info] of Object.entries(p.syncedTo)) {
        if (!info?.externalId) continue;
        const existing = links[p.id]?.[providerId];
        if (existing?.externalId === info.externalId) continue;
        if (!links[p.id]) links[p.id] = {};
        links[p.id][providerId] = {
          externalId: info.externalId,
          syncedAt: info.syncedAt || Date.now()
        };
        added++;
      }
    }
    if (added > 0) {
      store.set('sync_playlist_links', links);
      console.log(`[SyncLinks] Migrated ${added} playlist link(s) from syncedTo to sync_playlist_links`);
    }
  } catch (err) {
    console.warn('[SyncLinks] Migration failed (non-fatal):', err.message);
  }
}
// Run once at startup. Fire-and-forget because it only reads/writes the store
// and never touches the network.
migrateSyncLinksFromPlaylists();

// Startup heal: a regression in an earlier code path could rewrite
// `syncedFrom` on a Spotify-imported playlist to point at another provider
// (most often Apple Music, after a sync:start matched the local via
// syncedTo[applemusic].externalId at a moment when syncedFrom was missing).
// The current `isOwnPullSource` guard at sync:start prevents this going
// forward, but existing corrupted state needs healing. The heuristic is
// safe: imported playlist IDs are `${providerId}-${externalId}` by
// construction (CLAUDE.md "Imported playlist ID convention"), so any
// playlist whose ID starts with `spotify-` was, historically, imported
// from Spotify and `syncedFrom.resolver` MUST be `spotify`. If it isn't,
// we restore it and demote the wrong provider to a `syncedTo` mirror so
// outbound sync to that provider keeps working.
//
// Idempotent: if `syncedFrom.resolver === 'spotify'` already, the function
// is a no-op for that playlist. Same applies for the Apple Music inverse
// (`applemusic-` prefix → syncedFrom must be applemusic) — symmetric so
// either kind of regression heals.
function healImportedSyncedFromMismatch() {
  try {
    const playlists = store.get('local_playlists') || [];
    let healed = 0;
    let demoted = 0;
    const updated = playlists.map(p => {
      if (!p.id) return p;
      // Determine the implied source provider from the ID prefix.
      let impliedProvider = null;
      let externalId = null;
      for (const provider of ['spotify', 'applemusic']) {
        const prefix = `${provider}-`;
        if (p.id.startsWith(prefix)) {
          impliedProvider = provider;
          externalId = p.id.slice(prefix.length);
          break;
        }
      }
      if (!impliedProvider) return p;
      if (p.syncedFrom?.resolver === impliedProvider) return p;

      const oldSyncedFrom = p.syncedFrom;
      const newSyncedTo = { ...(p.syncedTo || {}) };

      // Demote the wrong syncedFrom into syncedTo so we don't lose the link.
      if (
        oldSyncedFrom?.resolver
        && oldSyncedFrom.resolver !== impliedProvider
        && oldSyncedFrom.externalId
      ) {
        const otherProvider = oldSyncedFrom.resolver;
        if (!newSyncedTo[otherProvider]?.externalId) {
          newSyncedTo[otherProvider] = {
            externalId: oldSyncedFrom.externalId,
            snapshotId: oldSyncedFrom.snapshotId || null,
            syncedAt: p.syncSources?.[otherProvider]?.syncedAt || Date.now(),
            unresolvedTracks: [],
            pendingAction: null,
          };
          demoted++;
        }
      }

      healed++;
      return {
        ...p,
        syncedFrom: {
          resolver: impliedProvider,
          externalId,
          snapshotId: null,                 // next sync from impliedProvider repopulates
          ownerId: oldSyncedFrom?.resolver === impliedProvider ? oldSyncedFrom.ownerId : null,
        },
        syncedTo: Object.keys(newSyncedTo).length > 0 ? newSyncedTo : undefined,
        hasUpdates: false,
        locallyModified: false,
      };
    });
    if (healed > 0) {
      store.set('local_playlists', updated);
      console.log(`[Sync Heal] Restored syncedFrom on ${healed} imported playlist(s); demoted ${demoted} cross-provider link(s) to syncedTo`);
    }
  } catch (err) {
    console.warn('[Sync Heal] Migration failed (non-fatal):', err.message);
  }
}
healImportedSyncedFromMismatch();

// Prune expired track tombstones at app start (parachord#864). One-shot
// per launch; entries older than TOMBSTONE_TTL_MS (365 days) are
// dropped. Tombstones get re-armed every time the sync filter sees the
// remote still has the track, so this only catches "user removed,
// never re-added, stopped syncing the provider OR remote also removed"
// — i.e. genuinely stale state.
try {
  const pruned = Tombstones.pruneExpired(store);
  if (pruned > 0) console.log(`[Tombstones] Pruned ${pruned} expired entries at startup`);
} catch (err) {
  console.warn('[Tombstones] Prune failed (non-fatal):', err.message);
}

ipcMain.handle('playlists-delete-from-source', async (event, providerId, externalId) => {
  console.log(`=== Delete Playlist from Source: ${providerId}/${externalId} ===`);
  try {
    const providers = {
      spotify: require('./sync-providers/spotify'),
      applemusic: require('./sync-providers/applemusic'),
      listenbrainz: require('./sync-providers/listenbrainz')
    };

    const provider = providers[providerId];
    if (!provider || !provider.deletePlaylist) {
      return { success: false, error: `Provider ${providerId} does not support playlist deletion` };
    }

    // Get auth token for the provider
    let token;
    if (providerId === 'spotify') {
      token = store.get('spotify_token');
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    } else if (providerId === 'listenbrainz') {
      // LB user token lives in the scrobbler-side config, not a separate
      // sync key. See CLAUDE.md "ListenBrainz auth token auto-attach".
      const cfg = store.get('scrobbler-config-listenbrainz') || {};
      token = cfg.userToken || null;
    }

    if (!token) {
      return { success: false, error: 'Not authenticated with provider' };
    }

    // Provide a token refresh callback for Apple Music 401 recovery
    let refreshTokenCb = null;
    if (providerId === 'applemusic') {
      refreshTokenCb = buildAppleMusicRefreshCb(token, (newToken) => { token = newToken; });
    }

    await provider.deletePlaylist(externalId, token, refreshTokenCb);
    console.log('  ✅ Deleted playlist from source');
    return { success: true };
  } catch (error) {
    console.error('  ❌ Delete from source failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('playlists-export', async (event, defaultFilename, xspfContent) => {
  console.log('=== Export Playlist ===');
  const { dialog } = require('electron');
  const fs = require('fs').promises;

  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Playlist',
      defaultPath: defaultFilename,
      filters: [
        { name: 'XSPF Playlists', extensions: ['xspf'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      console.log('  User cancelled');
      return null;
    }

    const filepath = result.filePath;
    console.log('  Saving to:', filepath);

    await fs.writeFile(filepath, xspfContent, 'utf8');

    console.log('  ✅ Exported to:', filepath);
    return { success: true, filepath };
  } catch (error) {
    console.error('  ❌ Export failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Search history handlers - stored in electron-store (search_history key)
ipcMain.handle('search-history-load', async () => {
  console.log('=== Load Search History from electron-store ===');
  try {
    const history = store.get('search_history') || [];
    console.log(`✅ Loaded ${history.length} search history entries`);
    return history;
  } catch (error) {
    console.error('Error loading search history:', error.message);
    return [];
  }
});

ipcMain.handle('search-history-save', async (event, entry) => {
  console.log('=== Save Search History Entry ===');
  console.log('  Query:', entry?.query);

  // Validate input
  if (!entry || typeof entry.query !== 'string' || !entry.query.trim()) {
    console.error('  ❌ Invalid entry: missing or empty query');
    return { success: false, error: 'Invalid entry: missing or empty query' };
  }

  try {
    const history = store.get('search_history') || [];
    const MAX_HISTORY = 50;

    // Check if this query already exists (case-insensitive)
    const existingIndex = history.findIndex(h =>
      h.query?.toLowerCase() === entry.query.toLowerCase()
    );

    if (existingIndex >= 0) {
      // Update existing entry with new timestamp and selected result
      history[existingIndex] = {
        ...history[existingIndex],
        ...entry,
        timestamp: Date.now()
      };
      console.log('  ✅ Updated existing entry');
    } else {
      // Add new entry at the beginning
      history.unshift({
        ...entry,
        timestamp: Date.now()
      });
      console.log('  ✅ Added new entry');
    }

    // Trim to max size
    const trimmedHistory = history.slice(0, MAX_HISTORY);

    // Sort by timestamp descending (most recent first)
    trimmedHistory.sort((a, b) => b.timestamp - a.timestamp);

    store.set('search_history', trimmedHistory);
    console.log(`  ✅ Saved ${trimmedHistory.length} history entries`);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Save failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('search-history-clear', async (event, entryQuery) => {
  console.log('=== Clear Search History ===');
  console.log('  Entry query:', entryQuery || 'ALL');

  try {
    if (entryQuery) {
      // Clear single entry
      const history = store.get('search_history') || [];
      const filtered = history.filter(h =>
        h.query?.toLowerCase() !== entryQuery.toLowerCase()
      );
      store.set('search_history', filtered);
      console.log(`  ✅ Removed entry, ${filtered.length} remaining`);
    } else {
      // Clear all
      store.set('search_history', []);
      console.log('  ✅ Cleared all history');
    }
    return { success: true };
  } catch (error) {
    console.error('  ❌ Clear failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Browser extension IPC handlers (native messaging via IPC socket)
ipcMain.handle('extension-send-command', (event, command) => {
  console.log('=== Send Extension Command ===');
  console.log('  Command:', command.type, command.action || '');

  if (extensionSocket && !extensionSocket.destroyed) {
    sendToExtensionSocket(command);
    return { success: true };
  }

  console.log('  ❌ No extension connected');
  return { success: false, error: 'No extension connected' };
});

ipcMain.handle('extension-get-status', () => {
  return {
    connected: extensionSocket !== null && !extensionSocket.destroyed
  };
});

// Embed player IPC handlers
ipcMain.handle('embed-response', (event, { requestId, data }) => {
  const pending = pendingEmbedRequests.get(requestId);
  if (pending) {
    pendingEmbedRequests.delete(requestId);
    pending.resolve(data);
  }
});

ipcMain.handle('embed-broadcast', (event, { eventType, data }) => {
  broadcastToEmbeds(eventType, data);
});

// MCP server IPC handler - receives tool call and state query results from renderer
ipcMain.handle('mcp-response', (event, { requestId, data }) => {
  handleRendererResponse(requestId, data);
});

// MCP server info — expose path for Claude Desktop config UI.
//
// Returns the user-data extracted copy (parachord#866). The asarUnpacked
// path inside `__dirname` would also work on Mac/Windows, but it's
// unstable on Linux AppImage (the /tmp/.mount_<RANDOM>/ FUSE mount
// regenerates per launch). Uniform userData path across platforms keeps
// the code simple and the on-disk location predictable for users.
//
// Falls back to the __dirname-derived path if the userData copy is
// missing for any reason (extraction errored at startup) so the IPC
// still returns something usable.
ipcMain.handle('mcp-get-info', () => {
  const stableStdioPath = path.join(app.getPath('userData'), 'mcp-stdio.js');
  let stdioPath = stableStdioPath;
  if (!fs.existsSync(stableStdioPath)) {
    const fallbackBase = app.isPackaged ? __dirname.replace('app.asar', 'app.asar.unpacked') : __dirname;
    stdioPath = path.join(fallbackBase, 'mcp-stdio.js');
    console.warn(`[MCP] Stable stdio path missing, falling back to ${stdioPath}`);
  }
  return {
    stdioPath,
    port: 9421
  };
});

// Local Files IPC handlers
ipcMain.handle('localFiles:addWatchFolder', async () => {
  console.log('=== Add Watch Folder ===');
  const { dialog } = require('electron');

  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Watch Folder',
    properties: ['openDirectory']
  });

  if (result.canceled || result.filePaths.length === 0) {
    console.log('  User cancelled');
    return null;
  }

  const folderPath = result.filePaths[0];
  console.log('  Selected:', folderPath);

  try {
    const service = await waitForLocalFilesService();
    const scanResult = await service.addWatchFolder(folderPath);
    return { success: true, folderPath, scanResult };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:removeWatchFolder', async (event, folderPath) => {
  console.log('=== Remove Watch Folder ===');
  console.log('  Path:', folderPath);

  try {
    const service = await waitForLocalFilesService();
    await service.removeWatchFolder(folderPath);
    return { success: true };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:getWatchFolders', async () => {
  const service = await waitForLocalFilesService();
  return service.getWatchFolders();
});

// On-demand album-art resolution for a single track. Used by the renderer's
// lazy background extraction loop to warm the cache for tracks that have
// embedded/folder art but haven't been extracted yet. The track payload is
// the renderer-shaped track (camelCase fields like `hasEmbeddedArt`,
// `folderArtPath`, `filePath`); resolveArt accepts both shapes.
ipcMain.handle('localFiles:resolveArt', async (_event, track) => {
  const service = await waitForLocalFilesService();
  if (!service || !track) return null;
  // Translate renderer's camelCase fields back to the snake_case the
  // resolver expects, in case the renderer-side fields are the only ones set.
  const dbShaped = {
    file_path: track.filePath || track.file_path,
    has_embedded_art: track.hasEmbeddedArt ? 1 : (track.has_embedded_art || 0),
    folder_art_path: track.folderArtPath || track.folder_art_path,
    musicbrainz_release_id: track.musicbrainzReleaseId || track.musicbrainz_release_id,
    musicbrainz_art_url: track.musicbrainzArtUrl || track.musicbrainz_art_url,
    id: typeof track.id === 'string' && track.id.startsWith('local-')
      ? track.id.slice('local-'.length)
      : track.id
  };
  return service.resolveArtForTrack(dbShaped);
});

ipcMain.handle('localFiles:rescanAll', async () => {
  console.log('=== Rescan All Folders ===');

  try {
    const service = await waitForLocalFilesService();
    const results = await service.rescanAll((current, total, file) => {
      safeSendToRenderer('localFiles:scanProgress', { current, total, file });
    });
    return { success: true, results };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:rescanFolder', async (event, folderPath) => {
  console.log('=== Rescan Folder ===');
  console.log('  Path:', folderPath);

  try {
    const service = await waitForLocalFilesService();
    const result = await service.scanFolder(folderPath, (current, total, file) => {
      safeSendToRenderer('localFiles:scanProgress', { current, total, file });
    });
    return { success: true, result };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('localFiles:getAllTracks', async () => {
  const service = await waitForLocalFilesService();
  return service.getAllTracks();
});

ipcMain.handle('localFiles:search', async (event, query) => {
  const service = await waitForLocalFilesService();
  return service.search(query);
});

ipcMain.handle('localFiles:resolve', async (event, params) => {
  const service = await waitForLocalFilesService();
  return service.resolve(params);
});

ipcMain.handle('localFiles:getStats', async () => {
  const service = await waitForLocalFilesService();
  return service.getStats();
});

ipcMain.handle('localFiles:saveId3Tags', async (event, filePath, tags) => {
  console.log('=== Save ID3 Tags ===');
  console.log('  File:', filePath);
  console.log('  Tags:', tags);

  try {
    const service = await waitForLocalFilesService();
    const result = await service.saveId3Tags(filePath, tags);
    return result;
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
});

// Atomic collection.json writer (parachord#795). Plain writeFile to an
// existing path will leave a truncated file if the process crashes / is
// force-quit / runs out of disk mid-write, and JSON.parse fails on the
// next launch with "Unterminated string in JSON at position N". The
// load path silently falls back to an empty collection, which means
// anything reading collection.json between corruption and the next
// save sees empty data — track scrobbling, background resolution, etc.
// all operate on the empty state until the next sync rewrites it.
//
// Standard tmp+rename pattern: write to a sibling `.tmp`, then rename
// it over the canonical path. rename(2) is atomic on POSIX when source
// and destination are on the same filesystem (always true here — both
// live in userData/). On Windows, Node's fs.rename uses MoveFileEx with
// MOVEFILE_REPLACE_EXISTING which provides equivalent "either old or
// new, never partial" semantics for the visible file. A leftover `.tmp`
// from a crashed mid-write is harmless — the next save overwrites it
// before the rename, so partial `.tmp` files self-heal.
//
// All three collection.json writes in main.js route through here:
//   - collection:save IPC handler (with .bak rotation upstream)
//   - finalizeCancelled inside sync:start
//   - the end-of-sync save inside sync:start
async function writeCollectionAtomic(collectionPath, collection) {
  const fsPromises = require('fs').promises;
  const tmpPath = `${collectionPath}.tmp`;
  await fsPromises.writeFile(tmpPath, JSON.stringify(collection), 'utf8');
  await fsPromises.rename(tmpPath, collectionPath);
}

// Collection handlers - store in userData directory for persistence across app updates
ipcMain.handle('collection:load', async () => {
  console.log('=== Load Collection ===');
  const fsPromises = require('fs').promises;

  const collectionPath = path.join(app.getPath('userData'), 'collection.json');
  console.log('  Collection path:', collectionPath);

  try {
    const content = await fsPromises.readFile(collectionPath, 'utf8');
    const data = JSON.parse(content);
    console.log(`✅ Loaded collection: ${data.tracks?.length || 0} tracks, ${data.albums?.length || 0} albums, ${data.artists?.length || 0} artists`);
    return data;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('  No collection file found, returning empty collection');
      return { tracks: [], albums: [], artists: [] };
    }
    console.error('  ❌ Load failed:', error.message);
    return { tracks: [], albums: [], artists: [] };
  }
});

ipcMain.handle('collection:save', async (event, collection) => {
  console.log('=== Save Collection ===');
  const fsPromises = require('fs').promises;

  try {
    const collectionPath = path.join(app.getPath('userData'), 'collection.json');

    // Backup-before-write so a wipe / corrupt save doesn't take the user's
    // data with no recovery path. Issue #758. Three-deep rotation:
    //   collection.json.bak    (last good)
    //   collection.json.bak.1  (one save ago)
    //   collection.json.bak.2  (two saves ago)
    // Cheap insurance — the file is small JSON.
    try {
      const stat = await fsPromises.stat(collectionPath).catch(() => null);
      if (stat && stat.size > 0) {
        // rotate .bak.1 → .bak.2, .bak → .bak.1, current → .bak
        await fsPromises.rename(`${collectionPath}.bak.1`, `${collectionPath}.bak.2`).catch(() => {});
        await fsPromises.rename(`${collectionPath}.bak`, `${collectionPath}.bak.1`).catch(() => {});
        await fsPromises.copyFile(collectionPath, `${collectionPath}.bak`);
      }
    } catch (backupErr) {
      // Don't fail the save just because the backup rotation hit a snag.
      console.warn('  ⚠️ Backup rotation failed (non-fatal):', backupErr.message);
    }

    await writeCollectionAtomic(collectionPath, collection);
    console.log(`✅ Saved collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Save failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Resolver sync settings
ipcMain.handle('sync-settings:load', async () => {
  try {
    return store.get('resolver_sync_settings') || {};
  } catch (error) {
    console.error('  ❌ Load sync settings failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync-settings:save', async (event, settings) => {
  try {
    store.set('resolver_sync_settings', settings);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Save sync settings failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync-settings:get-provider', async (event, providerId) => {
  try {
    const settings = store.get('resolver_sync_settings') || {};
    return settings[providerId] || null;
  } catch (error) {
    console.error('  ❌ Get provider sync settings failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync-settings:set-provider', async (event, providerId, providerSettings) => {
  try {
    const settings = store.get('resolver_sync_settings') || {};
    settings[providerId] = providerSettings;
    store.set('resolver_sync_settings', settings);
    return { success: true };
  } catch (error) {
    console.error('  ❌ Set provider sync settings failed:', error.message);
    return { success: false, error: error.message };
  }
});

// =============================================================================
// RESOLVER LIBRARY SYNC
// =============================================================================

const SyncEngine = require('./sync-engine');
const Tombstones = require('./sync-engine/tombstones');

// Track active sync operations
const activeSyncs = new Map();

ipcMain.handle('sync:get-providers', async () => {
  const providers = SyncEngine.getAllProviders();
  return providers.map(p => ({
    id: p.id,
    displayName: p.displayName,
    capabilities: p.capabilities
  }));
});

ipcMain.handle('sync:check-auth', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider) {
    return { authenticated: false, error: 'Provider not found' };
  }

  // Get token from store
  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  } else if (providerId === 'applemusic') {
    // Ensure developer token generation has completed before checking
    if (!generatedMusicKitToken) {
      await musicKitTokenReady;
    }
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (!developerToken) {
      console.warn('[Sync] No Apple Music developer token available — .p8 key may be missing from build');
    }
    if (!userToken) {
      console.warn('[Sync] No Apple Music user token stored');
    }
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    } else {
      const reason = !developerToken && !userToken
        ? 'Missing both developer token and user token'
        : !developerToken
          ? 'Missing developer token (MusicKit key may not be bundled in this build)'
          : 'Missing user token (please reconnect Apple Music)';
      return { authenticated: false, error: reason };
    }
  } else if (providerId === 'listenbrainz') {
    // LB user token lives in the scrobbler-side config, not a separate
    // sync key. See CLAUDE.md "ListenBrainz auth token auto-attach".
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
    if (!token) {
      return { authenticated: false, error: 'No ListenBrainz user token configured (set it in the ListenBrainz scrobbler settings)' };
    }
  }

  if (!token) {
    return { authenticated: false, error: 'No token found' };
  }

  const isValid = await provider.checkAuth(token);
  return { authenticated: isValid };
});

ipcMain.handle('sync:start', async (event, providerId, options = {}) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider) {
    return { success: false, error: 'Provider not found' };
  }

  // Check if sync already in progress
  if (activeSyncs.has(providerId)) {
    return { success: false, error: 'Sync already in progress' };
  }

  // Get token (refresh if expired)
  let token;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
  } else if (providerId === 'applemusic') {
    if (!generatedMusicKitToken) {
      await musicKitTokenReady;
    }
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  // For Spotify, check that the token was granted with the scopes needed for
  // library sync.  Tokens obtained before these scopes were added will still
  // work for playback but will 403 on library endpoints.
  // If no scopes are stored at all (legacy auth before scope tracking was
  // added), skip the check and let the actual API calls handle any 403.
  if (providerId === 'spotify') {
    const grantedScopes = store.get('spotify_token_scopes');
    if (grantedScopes) {
      const requiredSyncScopes = ['user-library-read', 'user-follow-read', 'playlist-read-private'];
      const missing = requiredSyncScopes.filter(s => !grantedScopes.includes(s));
      if (missing.length > 0) {
        console.log(`[Sync] Token missing required scopes: ${missing.join(', ')}. Prompting re-auth.`);
        return {
          success: false,
          error: 'Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions for library sync.',
          errorCode: 'missing_scopes'
        };
      }
    } else {
      // Legacy auth — token was obtained before we started storing scopes.
      // Refreshing preserves the original (possibly incomplete) scopes, so
      // the only reliable fix is a full re-auth.  Prompt the user instead of
      // silently hitting 403s mid-sync.
      console.log('[Sync] No stored scopes found (legacy auth). Prompting re-auth to ensure correct permissions.');
      return {
        success: false,
        error: 'Your Spotify connection needs to be refreshed to support library sync. Please disconnect and reconnect Spotify in Settings.',
        errorCode: 'missing_scopes'
      };
    }
  }

  // For Spotify, provide a token refresh callback that the sync provider can
  // call mid-sync when it encounters a 401 (token expired during long syncs).
  // Force-refreshes because a 401 means the current token was rejected.
  const refreshToken = providerId === 'spotify'
    ? async () => {
        const newToken = await ensureValidSpotifyToken(true);
        if (newToken) token = newToken;
        return newToken;
      }
    : null;

  // Mark sync as active
  activeSyncs.set(providerId, { startedAt: Date.now(), cancelled: false });

  const sendProgress = (progress) => {
    if (!activeSyncs.get(providerId)?.cancelled) {
      event.sender.send('sync:progress', { providerId, ...progress });
    }
  };

  // Cancellation check (parachord#799). The renderer's foreground handler
  // fires `sync.cancel(providerId)` on window focus to interrupt long-running
  // background syncs. This helper is checked at every phase boundary AND
  // between playlist iterations; when it flips true we short-circuit to the
  // save phase, preserve any progress already made (collection.json write +
  // partial local_playlists updates), and return a `cancelled: true` result.
  // The wizard's manual sync path is not affected — the renderer only sends
  // cancel for syncs it started via `runBackgroundSync`.
  const isCancelled = () => !!activeSyncs.get(providerId)?.cancelled;

  const fsPromises = require('fs').promises;

  try {
    const results = { tracks: null, albums: null, artists: null, playlists: null };
    const settings = options.settings || {};

    // Load current collection
    const collectionPath = path.join(app.getPath('userData'), 'collection.json');

    // Build a "save-partial-and-return" helper that runs collection.json
    // write + lastSyncAt bump + result construction. Called from every
    // cancellation point so partial progress is durable.
    const finalizeCancelled = async (collectionState, resultsState) => {
      try {
        sendProgress({ phase: 'cancelled', message: 'Sync cancelled' });
        await writeCollectionAtomic(collectionPath, collectionState);
      } catch (err) {
        console.warn(`[Sync] Cancellation save failed for ${providerId}:`, err.message);
      }
      // Bump lastSyncAt even for partial syncs so the staleness gate
      // doesn't immediately re-trigger another full run. The next cycle
      // picks up whatever still needs work.
      const partialSyncSettings = store.get('resolver_sync_settings') || {};
      partialSyncSettings[providerId] = {
        ...partialSyncSettings[providerId],
        lastSyncAt: Date.now()
      };
      store.set('resolver_sync_settings', partialSyncSettings);
      const hasChanges = Object.values(resultsState).some(r =>
        r && ((r.added || 0) > 0 || (r.removed || 0) > 0 || (r.updated || 0) > 0)
      );
      console.log(`[Sync] ${providerId} cancelled — partial progress saved`);
      return {
        success: true,
        cancelled: true,
        results: resultsState,
        collection: hasChanges ? collectionState : null
      };
    };
    let collection;
    try {
      const content = await fsPromises.readFile(collectionPath, 'utf8');
      collection = JSON.parse(content);
      console.log(`[Sync] Loaded collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    } catch {
      collection = { tracks: [], albums: [], artists: [] };
      console.log('[Sync] No existing collection, starting fresh');
    }

    // Tombstone filter (parachord#864) — drops remote tracks the user
    // previously removed from Collection, so the diff doesn't see them
    // as toAdd and silently undo the removal. Each filter hit also
    // re-arms the tombstone's TTL inside the helper. Only wired for
    // tracks today (album-level tombstones tracked separately).
    const filterTrackTombstones = (remoteItems) => {
      const { filtered, dropped } = Tombstones.filterRemoteByTombstones(store, remoteItems, providerId);
      if (dropped > 0) {
        console.log(`[Sync] Tombstone filter dropped ${dropped} re-import attempt(s) for ${providerId}`);
      }
      return filtered;
    };

    // Sync tracks
    if (settings.syncTracks !== false && provider.capabilities.tracks) {
      sendProgress({ phase: 'fetching', type: 'tracks', message: 'Fetching liked songs...' });
      console.log(`[Sync] Syncing tracks. Input: ${collection.tracks?.length || 0} tracks`);
      const trackResult = await SyncEngine.syncDataType(
        provider,
        token,
        'tracks',
        collection.tracks || [],
        (p) => sendProgress({ phase: 'fetching', type: 'tracks', ...p }),
        refreshToken,
        isCancelled,  // parachord#820: poll between paginated pages
        { filterRemote: filterTrackTombstones }  // parachord#864
      );
      console.log(`[Sync] Track sync complete. Output: ${trackResult.data.length} tracks. Stats:`, trackResult.stats);
      collection.tracks = trackResult.data;
      results.tracks = trackResult.stats;
    } else {
      console.log(`[Sync] Skipping tracks sync. syncTracks=${settings.syncTracks}, capabilities.tracks=${provider.capabilities.tracks}`);
    }

    if (isCancelled()) return await finalizeCancelled(collection, results);

    // Sync albums
    if (settings.syncAlbums !== false && provider.capabilities.albums) {
      sendProgress({ phase: 'fetching', type: 'albums', message: 'Fetching saved albums...' });
      console.log(`[Sync] Syncing albums. Input: ${collection.albums?.length || 0} albums`);
      const albumResult = await SyncEngine.syncDataType(
        provider,
        token,
        'albums',
        collection.albums || [],
        (p) => sendProgress({ phase: 'fetching', type: 'albums', ...p }),
        refreshToken,
        isCancelled
      );
      console.log(`[Sync] Album sync complete. Output: ${albumResult.data.length} albums. Stats:`, albumResult.stats);
      collection.albums = albumResult.data;
      results.albums = albumResult.stats;
    } else {
      console.log(`[Sync] Skipping albums sync. syncAlbums=${settings.syncAlbums}, capabilities.albums=${provider.capabilities.albums}`);
    }

    if (isCancelled()) return await finalizeCancelled(collection, results);

    // Sync artists
    if (settings.syncArtists !== false && provider.capabilities.artists) {
      sendProgress({ phase: 'fetching', type: 'artists', message: 'Fetching followed artists...' });
      console.log(`[Sync] Syncing artists. Input: ${collection.artists?.length || 0} artists`);
      const artistResult = await SyncEngine.syncDataType(
        provider,
        token,
        'artists',
        collection.artists || [],
        (p) => sendProgress({ phase: 'fetching', type: 'artists', ...p }),
        refreshToken,
        isCancelled
      );
      console.log(`[Sync] Artist sync complete. Output: ${artistResult.data.length} artists. Stats:`, artistResult.stats);
      collection.artists = artistResult.data;
      results.artists = artistResult.stats;
    } else {
      console.log(`[Sync] Skipping artists sync. syncArtists=${settings.syncArtists}, capabilities.artists=${provider.capabilities.artists}`);
    }

    if (isCancelled()) return await finalizeCancelled(collection, results);

    // Sync playlists
    if (settings.syncPlaylists && settings.selectedPlaylistIds?.length > 0 && provider.capabilities.playlists) {
      // Load current playlists
      const currentPlaylists = store.get('local_playlists') || [];

      // Fetch playlist metadata to check for updates
      sendProgress({ phase: 'playlists', current: 0, total: settings.selectedPlaylistIds.length, providerId });
      const { playlists: remotePlaylists } = await provider.fetchPlaylists(token, null, refreshToken);
      const suppressedPlaylists = store.get('suppressed_sync_playlists') || {};
      const suppressedForProvider = suppressedPlaylists[providerId] || [];
      const allSelectedRemote = remotePlaylists.filter(p =>
        settings.selectedPlaylistIds.includes(p.externalId) &&
        !suppressedForProvider.includes(p.externalId)
      );

      // Stagger across cycles (parachord#800). Background sync processes
      // the top N oldest-stale-first per cycle; over 4-5 cycles the whole
      // selection gets covered. Explicit full-sync paths (wizard "Sync
      // Now", cleanup-duplicates, etc.) bypass via `options.fullSync` so
      // they still see every selected playlist in one run.
      //
      // The sort is provider-scoped (`syncSources[providerId].syncedAt`),
      // so each provider's stagger queue is independent — a Spotify-stale
      // playlist gets priority on Spotify's next cycle without competing
      // with AM's separate queue.
      const selectedRemote = options.fullSync
        ? allSelectedRemote
        : SyncEngine.staggerPlaylistsForCycle({
            selectedRemote: allSelectedRemote,
            localPlaylists: currentPlaylists,
            providerId
          });
      if (!options.fullSync && selectedRemote.length < allSelectedRemote.length) {
        console.log(`[Sync] Staggered ${providerId}: processing ${selectedRemote.length}/${allSelectedRemote.length} oldest-stale this cycle (remainder defers to next cycle)`);
      }

      let playlistsAdded = 0;
      let playlistsUpdated = 0;
      let playlistsFailed = 0;

      for (let i = 0; i < selectedRemote.length; i++) {
        // Per-iteration cancellation check (parachord#799). Save partial
        // progress before bailing — currentPlaylists already holds the
        // in-memory mutations for playlists processed so far. Skip the
        // syncedFrom-clearing pass below since we may not have visited
        // every selected playlist; deferring it to the next non-cancelled
        // sync is safer than clearing based on a partial iteration.
        if (isCancelled()) {
          store.set('local_playlists', currentPlaylists);
          results.playlists = { added: playlistsAdded, updated: playlistsUpdated, failed: playlistsFailed, cancelled: true, processedCount: i };
          console.log(`[Sync] ${providerId} playlist sync cancelled at ${i}/${selectedRemote.length} — partial progress saved`);
          return await finalizeCancelled(collection, results);
        }

        const remotePlaylist = selectedRemote[i];
        sendProgress({ phase: 'playlists', current: i + 1, total: selectedRemote.length, providerId });

        try {
          // Check for existing playlist by syncedFrom.externalId, syncedTo externalId, or matching ID pattern
          // This handles: playlists imported FROM this provider, playlists pushed TO this provider,
          // and older playlists that may have been synced before the syncedFrom/syncedTo structure
          const localPlaylist = currentPlaylists.find(p =>
            p.syncedFrom?.externalId === remotePlaylist.externalId ||
            p.syncedTo?.[providerId]?.externalId === remotePlaylist.externalId ||
            p.id === remotePlaylist.id ||
            p.id === `${providerId}-${remotePlaylist.externalId}`
          );

          if (!localPlaylist) {
            // New playlist - fetch tracks and add
            console.log(`[Sync] Importing playlist: ${remotePlaylist.name}`);
            const tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token, null, refreshToken);

            // Use earliest track addedAt as playlist creation estimate (Spotify doesn't provide playlist follow date)
            const earliestTrackDate = tracks.length > 0
              ? Math.min(...tracks.map(t => t.addedAt || Date.now()).filter(Boolean))
              : Date.now();

            const newPlaylist = {
              id: remotePlaylist.id,
              title: remotePlaylist.name,
              description: remotePlaylist.description,
              tracks: tracks,
              creator: remotePlaylist.ownerName || null,
              source: remotePlaylist.isOwnedByUser ? `${providerId}-sync` : `${providerId}-import`,
              syncedFrom: {
                resolver: providerId,
                externalId: remotePlaylist.externalId,
                snapshotId: remotePlaylist.snapshotId,
                ownerId: remotePlaylist.ownerId,
                isCollaborator: !!remotePlaylist.isCollaborator
              },
              hasUpdates: false,
              locallyModified: false,
              syncSources: {
                [providerId]: { addedAt: earliestTrackDate, syncedAt: Date.now() }
              },
              createdAt: earliestTrackDate,
              addedAt: Date.now()  // When it was added to Parachord
            };

            currentPlaylists.push(newPlaylist);
            playlistsAdded++;
          } else {
            // Existing playlist - update metadata and check for track updates
            const idx = currentPlaylists.findIndex(p => p.id === localPlaylist.id);
            if (idx >= 0) {
              // Hoisted re-read: pick up any concurrent renderer writes for
              // this playlist BEFORE deciding short-circuit vs. full branch.
              // Without this, the short-circuit below would use the L6090
              // snapshot and clobber a concurrent renderer edit (e.g. user
              // removed a track) at end-of-loop store.set. electron-store
              // caches the parsed array, so this read is near-free.
              //
              // The full branch keeps its own inner re-read (post-
              // fetchPlaylistTracks) to cover the narrower window of a
              // concurrent edit during the track-fetch IPC. Both reads are
              // defensive; both are cheap.
              {
                const freshPlaylists = store.get('local_playlists') || [];
                const freshPlaylist = freshPlaylists.find(p => p.id === localPlaylist.id);
                if (freshPlaylist) {
                  currentPlaylists[idx] = freshPlaylist;
                }
              }

              // Short-circuit unchanged playlists (parachord#796). When the
              // playlist hasn't drifted on either side AND no metadata backfill
              // is pending AND owner/collaborator state is stable, skip the
              // spread-rewrite work and just bump syncedAt. This shrinks the
              // in-memory mutation footprint of a steady-state sync (where
              // most selected playlists haven't actually changed) and keeps
              // the staleness timestamp accurate for #800's oldest-stale-first
              // sort. Modest CPU win; the bigger sync-perf levers are in
              // #797 (resolver concurrency) and #798 (push-loop idle deferral).
              if (SyncEngine.canShortCircuitPlaylistUpdate({
                localPlaylist: currentPlaylists[idx],
                remotePlaylist,
                providerId
              })) {
                // parachord#822: log the short-circuit so it's distinguishable
                // from "playlist never reached" in [Sync] traces. The snapshot
                // preview makes "snap matched, no work" auditable when a user
                // reports "why didn't sync update X" — you can see both that
                // the playlist was visited AND what snapshot was matched.
                const localSnap = (currentPlaylists[idx].syncedFrom?.snapshotId || '').slice(0, 12);
                const remoteSnap = (remotePlaylist.snapshotId || '').slice(0, 12);
                const playlistName = remotePlaylist.name || currentPlaylists[idx].name || remotePlaylist.id;
                console.log(`[Sync] ${providerId} "${playlistName}": short-circuit (snap matched, no work) local=${localSnap} remote=${remoteSnap}`);
                const cur = currentPlaylists[idx];
                currentPlaylists[idx] = {
                  ...cur,
                  syncSources: {
                    ...cur.syncSources,
                    [providerId]: {
                      ...cur.syncSources?.[providerId],
                      syncedAt: Date.now()
                    }
                  }
                };
                continue;
              }

              const hasTrackUpdates = localPlaylist.syncedFrom?.snapshotId !== remotePlaylist.snapshotId;
              const existingTracks = currentPlaylists[idx].tracks || [];
              const isEmpty = existingTracks.length === 0;

              // Determine whether this provider is the canonical pull source.
              // Two categories of "not the pull source" silence the log:
              //   1. Cross-provider push mirrors (syncedFrom.resolver points to
              //      a different provider; matched via syncedTo[providerId]) —
              //      snapshotIds aren't comparable across services.
              //   2. Locally-created push mirrors (syncedFrom undefined; matched
              //      via syncedTo[providerId]) — there's no pull source at all.
              // Only when syncedFrom.resolver STRICTLY matches the provider does
              // this provider own the pull contract; that's the only case where
              // "has updates" carries meaning. (Note: the downstream isOwnPullSource
              // check still uses the permissive form to preserve first-time-link
              // semantics for state writes; the log just needs to be stricter.)
              const preRefreshIsOwnPullSource = localPlaylist.syncedFrom?.resolver === providerId;

              // Snapshot-divergence suppression covers two distinct cases
              // where "snapshotIds differ" does NOT mean "content drifted":
              //
              // 1. **AM snapshotId churn** (any provider's pull source). AM
              //    re-issues snapshotIds for editorial / system playlists
              //    ("My Shazam Tracks", curated picks, Rewind / Radio
              //    Paradise / NTS-style hosted feeds) even when the tracklist
              //    hasn't changed. Use track-count as a cheap content
              //    fingerprint: same count = treat as unchanged, adopt the
              //    new snapshotId silently. Tradeoff: miss the rare "AM
              //    swapped one track for another, same count" case. For
              //    user-owned playlists that's vanishingly rare; for
              //    editorial playlists the user can refresh manually if
              //    they suspect drift.
              //
              //    **Scoped to AM only.** Spotify's snapshotId is rock-solid;
              //    its algorithmic / 3rd-party-rotated playlists keep a FIXED
              //    track count with rotating content — applying count-match
              //    there would silently suppress legitimate daily updates.
              //    Spotify-curated playlists get their own arm below
              //    (`isSpotifyCuratedMatch`) via ownership signal instead.
              //    LB's snapshot anchor (extension.last_modified_at) is
              //    similarly reliable.
              //
              // 2. **Heal-induced null snapshot** (all providers). The
              //    startup heal `healImportedSyncedFromMismatch` (main.js,
              //    runs every launch) nulls syncedFrom.snapshotId when
              //    restoring a corrupted resolver field — the contract is
              //    "next sync from the canonical provider repopulates."
              //    Without this branch, every post-heal sync would flag
              //    these playlists "has updates" forever (stillHasUpdates
              //    stays true → snapshotId never advances → next sync sees
              //    same diff). Adopt silently to honor the heal contract.
              //    Tradeoff: lose the signal for any content drift that
              //    happened BETWEEN the corruption and the heal. Accepted
              //    because (a) heal runs on every launch — drift window is
              //    bounded, (b) the alternative is perpetual log spam and
              //    permanently-set hasUpdates flags on a fleet of playlists
              //    the user already isn't reviewing.
              //
              // 3. **Spotify-curated playlists** (`isSpotifyCuratedMatch`).
              //    Playlists owned by Spotify itself (owner.id === 'spotify')
              //    are algorithmic — Daily Brew, Discover Weekly, Release
              //    Radar, Daily Mix N, Daylist, New Music Friday. They
              //    update daily/weekly by design; the user isn't authoring
              //    them and shouldn't see a "pull updates" banner every
              //    morning for content rotation that's expected. Silent
              //    adopt mirrors the AM count-churn suppression but via
              //    a different signal (ownership instead of count).
              //
              //    **Edit-loss is empty.** Spotify's API rejects writes
              //    to non-owned playlists at the auth layer, so any local
              //    "edit" to Daily Brew couldn't have propagated anyway —
              //    no conflict-resolution case to worry about.
              //
              //    **Cross-platform parity.** Android already auto-pulls
              //    these (it has no banner mechanism at all — see
              //    SyncEngine.kt:1209+, "auto-pull on any snapshot
              //    differ"). Desktop's old behavior was the divergence;
              //    this arm closes it for the user-visible case while
              //    preserving the banner UX for user-created playlists
              //    where local-edit conflicts are real.
              const localSnapPresent = !!localPlaylist.syncedFrom?.snapshotId;
              const isHealInducedNull = !localSnapPresent;
              const isAmCountChurnMatch =
                providerId === 'applemusic'
                && remotePlaylist.trackCount != null
                && existingTracks.length === remotePlaylist.trackCount;
              const isSpotifyCuratedMatch =
                providerId === 'spotify'
                && remotePlaylist.ownerId === 'spotify';
              const silentlyAdopt = isHealInducedNull
                || isAmCountChurnMatch
                || isSpotifyCuratedMatch;

              if (preRefreshIsOwnPullSource && hasTrackUpdates && !silentlyAdopt) {
                // Surface both counts so we can tell whether AM is reporting a
                // changed count vs missing trackCount vs same-count-but-different-snapshot.
                console.log(`[Sync] Playlist has updates: ${remotePlaylist.name} (local=${existingTracks.length}, remote=${remotePlaylist.trackCount ?? 'NULL'}, localSnap=${(localPlaylist.syncedFrom?.snapshotId || '').slice(0,12) || 'NULL'}, remoteSnap=${(remotePlaylist.snapshotId || '').slice(0,12) || 'NULL'})`);
              } else if (preRefreshIsOwnPullSource && hasTrackUpdates && silentlyAdopt) {
                const reason = isHealInducedNull
                  ? 'heal-induced null snapshot'
                  : (isSpotifyCuratedMatch
                    ? 'Spotify-curated (owner.id=spotify)'
                    : `track count matches: ${existingTracks.length}`);
                console.log(`[Sync] Adopting remote snapshotId for "${remotePlaylist.name}" (${reason})`);
              }
              // Refetch conditions:
              //   - isEmpty: playlist has 0 tracks locally; need to backfill
              //   - Spotify-curated + snapshot changed: Daily Brew etc. rotate
              //     content daily; advancing the snapshotId without refetching
              //     would silently suppress the banner AND leave yesterday's
              //     tracks in place. Have to do both.
              const shouldRefetchTracks =
                preRefreshIsOwnPullSource
                && (isEmpty || (isSpotifyCuratedMatch && hasTrackUpdates));

              let tracks = existingTracks;
              if (shouldRefetchTracks) {
                const reason = isEmpty ? 'has 0 tracks' : 'Spotify-curated daily update';
                console.log(`[Sync] Playlist "${remotePlaylist.name}" ${reason}, refetching...`);
                tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token, null, refreshToken);
                console.log(`[Sync] Fetched ${tracks.length} tracks for "${remotePlaylist.name}"`);
              }

              // Recalculate createdAt from existing tracks if available
              let recalculatedCreatedAt = currentPlaylists[idx].createdAt;
              if (tracks.length > 0) {
                const trackDates = tracks.map(t => t.addedAt || t.syncSources?.spotify?.addedAt).filter(Boolean);
                if (trackDates.length > 0) {
                  recalculatedCreatedAt = Math.min(...trackDates);
                }
              }

              // Re-read the playlist from store in case the user pulled changes
              // while this sync was running (handlePull saves hasUpdates:false +
              // updated snapshotId to disk, but we loaded currentPlaylists earlier).
              const freshPlaylists = store.get('local_playlists') || [];
              const freshPlaylist = freshPlaylists.find(p => p.id === localPlaylist.id);
              if (freshPlaylist) {
                currentPlaylists[idx] = freshPlaylist;
              }
              const current = currentPlaylists[idx];

              // Determine whether this provider is the canonical pull source
              // for the local playlist. It IS the pull source when:
              //   - the local has no syncedFrom yet (first time linking), OR
              //   - the existing syncedFrom.resolver already points at us.
              // If syncedFrom points at a DIFFERENT provider (e.g. Spotify),
              // this local is being matched via syncedTo[providerId] — it's a
              // cross-provider push mirror. We must NOT overwrite its
              // syncedFrom or clobber its tracks, because the other provider
              // is the authoritative source.
              const isOwnPullSource = !current.syncedFrom?.resolver
                || current.syncedFrom.resolver === providerId;

              // Re-check after refresh — the user may have already pulled this update.
              // Only meaningful when we're the pull source; otherwise snapshotIds
              // come from different providers and aren't comparable.
              //
              // Same three-arm suppression as the earlier log-firing decision
              // (heal-induced null snapshot, AM track-count churn, Spotify-
              // curated ownership). Counting from current.tracks (not
              // existingTracks) picks up the case where a previously-empty
              // playlist just got refilled in the isEmpty branch above.
              const freshIsHealInducedNull = !current.syncedFrom?.snapshotId;
              const freshIsAmCountChurnMatch =
                providerId === 'applemusic'
                && remotePlaylist.trackCount != null
                && (current.tracks?.length || 0) === remotePlaylist.trackCount;
              const freshIsSpotifyCuratedMatch =
                providerId === 'spotify'
                && remotePlaylist.ownerId === 'spotify';
              const freshSilentlyAdopt = freshIsHealInducedNull
                || freshIsAmCountChurnMatch
                || freshIsSpotifyCuratedMatch;
              const stillHasUpdates = isOwnPullSource
                && current.syncedFrom?.snapshotId !== remotePlaylist.snapshotId
                && !freshSilentlyAdopt;

              // If we refetched tracks (either backfilled an empty playlist
              // OR pulled a Spotify-curated daily update) AND the playlist is
              // mirrored to providers other than this one, the mirrors now
              // have stale content. Flag locallyModified so the next push
              // loop propagates the new tracks outward. This is the main.js
              // parallel of handlePull's hasOtherMirrors logic.
              const tracksRefetched = shouldRefetchTracks && tracks.length > 0 && isOwnPullSource;
              const hasOtherMirrors = !!(current.syncedTo && Object.keys(current.syncedTo).some(
                pid => pid !== providerId && current.syncedTo[pid]?.externalId
              ));

              // Always update/backfill metadata fields (creator, source, createdAt)
              currentPlaylists[idx] = {
                ...current,
                // Replace tracks if we refetched (empty backfill OR curated
                // daily rotation) — but only if we're the pull source.
                // Cross-provider push mirrors preserve their existing tracks;
                // the authoritative provider will fill them on its own sync.
                tracks: tracksRefetched ? tracks : current.tracks,
                // Backfill creator if not set
                creator: current.creator || remotePlaylist.ownerName || null,
                // Backfill source if not set
                source: current.source || (remotePlaylist.isOwnedByUser ? `${providerId}-sync` : `${providerId}-import`),
                // Update createdAt from track data
                createdAt: recalculatedCreatedAt,
                // Update/backfill syncedFrom ONLY if we're the pull source.
                // Cross-provider push mirrors keep their original syncedFrom.
                syncedFrom: isOwnPullSource
                  ? {
                      ...current.syncedFrom,
                      resolver: providerId,
                      externalId: remotePlaylist.externalId,
                      snapshotId: stillHasUpdates ? current.syncedFrom?.snapshotId : remotePlaylist.snapshotId,
                      ownerId: remotePlaylist.ownerId,
                      isCollaborator: !!remotePlaylist.isCollaborator
                    }
                  : current.syncedFrom,
                hasUpdates: stillHasUpdates ? true : current.hasUpdates,
                locallyModified: (tracksRefetched && hasOtherMirrors) ? true : current.locallyModified,
                syncSources: {
                  ...current.syncSources,
                  [providerId]: { ...current.syncSources?.[providerId], syncedAt: Date.now() }
                }
              };

              if (stillHasUpdates || tracksRefetched) {
                playlistsUpdated++;
              }
            }
          }
        } catch (playlistError) {
          playlistsFailed++;
          console.error(`[Sync] Failed to sync playlist "${remotePlaylist.name}": ${playlistError.message}`);
          // Continue with remaining playlists instead of aborting the entire sync
        }
      }

      // Clear syncedFrom on local playlists whose remote counterpart no longer
      // exists (e.g. deleted on the provider). This turns them into local-only
      // playlists so the post-sync push logic will re-create them on the provider.
      //
      // Safety: only clear syncedFrom when the remote fetch looks complete.
      // If the API returned far fewer playlists than we have locally synced from
      // this provider, the response was likely truncated (rate limit, pagination
      // failure) and clearing syncedFrom would cause mass duplicate creation.
      const remoteExternalIds = new Set(remotePlaylists.map(p => p.externalId));
      const localSyncedFromProvider = currentPlaylists.filter(p => p.syncedFrom?.resolver === providerId);
      const missingCount = localSyncedFromProvider.filter(p => !remoteExternalIds.has(p.syncedFrom.externalId)).length;
      const tooManyMissing = localSyncedFromProvider.length > 0 && missingCount > 3 && (missingCount / localSyncedFromProvider.length) > 0.3;

      if (tooManyMissing) {
        console.warn(`[Sync] Skipping syncedFrom clearing: ${missingCount}/${localSyncedFromProvider.length} playlists missing from ${providerId} remote response (likely incomplete API response)`);
      } else {
        for (let j = 0; j < currentPlaylists.length; j++) {
          const p = currentPlaylists[j];
          if (p.syncedFrom?.resolver === providerId && !remoteExternalIds.has(p.syncedFrom.externalId)) {
            console.log(`[Sync] Playlist "${p.title}" no longer on ${providerId}, clearing syncedFrom so it can be re-pushed`);
            currentPlaylists[j] = { ...p, syncedFrom: null };
          }
        }
      }

      // Save playlists (including any that succeeded before a failure)
      store.set('local_playlists', currentPlaylists);
      results.playlists = { added: playlistsAdded, updated: playlistsUpdated, failed: playlistsFailed };
      console.log(`[Sync] Playlists synced: ${playlistsAdded} added, ${playlistsUpdated} with updates${playlistsFailed > 0 ? `, ${playlistsFailed} failed` : ''}`);
    }

    // Save collection
    sendProgress({ phase: 'saving', message: 'Saving collection...' });
    console.log(`[Sync] Saving collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    await writeCollectionAtomic(collectionPath, collection);

    // Update sync settings with last sync time
    const syncSettings = store.get('resolver_sync_settings') || {};
    syncSettings[providerId] = {
      ...syncSettings[providerId],
      lastSyncAt: Date.now()
    };
    store.set('resolver_sync_settings', syncSettings);

    sendProgress({ phase: 'complete', message: 'Sync complete!' });

    // Only send the full collection back to the renderer if there were
    // meaningful changes (adds, removes, updates). For no-op syncs where
    // everything is unchanged, skip the expensive IPC serialisation of
    // the entire collection — the data is already saved to disk above.
    const hasChanges = Object.values(results).some(r =>
      r && ((r.added || 0) > 0 || (r.removed || 0) > 0 || (r.updated || 0) > 0)
    );

    return { success: true, results, collection: hasChanges ? collection : null };
  } catch (error) {
    console.error(`❌ Sync error for ${providerId}:`, error);
    sendProgress({ phase: 'error', message: error.message });
    return { success: false, error: error.message };
  } finally {
    activeSyncs.delete(providerId);
  }
});

ipcMain.handle('sync:cancel', async (event, providerId) => {
  const sync = activeSyncs.get(providerId);
  if (sync) {
    sync.cancelled = true;
    return { success: true };
  }
  return { success: false, error: 'No active sync' };
});

ipcMain.handle('sync:fetch-playlists', async (event, providerId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  let token;
  let refreshTokenCb = null;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
    refreshTokenCb = async () => {
      const newToken = await ensureValidSpotifyToken(true);
      if (newToken) token = newToken;
      return newToken;
    };
  } else if (providerId === 'applemusic') {
    if (!generatedMusicKitToken) {
      await musicKitTokenReady;
    }
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { playlists, folders } = await provider.fetchPlaylists(token, null, refreshTokenCb);
    return { success: true, playlists, folders };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('sync:fetch-playlist-tracks', async (event, providerId, playlistExternalId) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  let token;
  let refreshTokenCb = null;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
    refreshTokenCb = async () => {
      const newToken = await ensureValidSpotifyToken(true);
      if (newToken) token = newToken;
      return newToken;
    };
  } else if (providerId === 'applemusic') {
    if (!generatedMusicKitToken) {
      await musicKitTokenReady;
    }
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  // For Spotify, check that the token has the scopes needed for playlist access.
  if (providerId === 'spotify') {
    const grantedScopes = store.get('spotify_token_scopes');
    if (grantedScopes) {
      const requiredScopes = ['playlist-read-private'];
      const missing = requiredScopes.filter(s => !grantedScopes.includes(s));
      if (missing.length > 0) {
        console.log(`[Sync] Token missing required scopes for playlist pull: ${missing.join(', ')}. Prompting re-auth.`);
        return {
          success: false,
          error: 'Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions.',
          errorCode: 'missing_scopes'
        };
      }
    } else {
      console.log('[Sync] No stored scopes found (legacy auth). Prompting re-auth.');
      return {
        success: false,
        error: 'Your Spotify connection needs to be refreshed. Please disconnect and reconnect Spotify in Settings.',
        errorCode: 'missing_scopes'
      };
    }
  }

  try {
    const tracks = await provider.fetchPlaylistTracks(playlistExternalId, token, null, refreshTokenCb);
    // Also fetch the current snapshot ID
    const snapshotId = await provider.getPlaylistSnapshot?.(playlistExternalId, token, refreshTokenCb);
    return { success: true, tracks, snapshotId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Push local playlist changes to the sync provider
ipcMain.handle('sync:push-playlist', async (event, providerId, playlistExternalId, tracks, metadata) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.playlists) {
    return { success: false, error: 'Provider does not support playlists' };
  }

  if (!provider.updatePlaylistTracks) {
    return { success: false, error: 'Provider does not support pushing playlist changes' };
  }

  let token;
  if (providerId === 'spotify') {
    token = await ensureValidSpotifyToken();
  } else if (providerId === 'applemusic') {
    if (!generatedMusicKitToken) {
      await musicKitTokenReady;
    }
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      token = JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    token = cfg.userToken || null;
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  // For Spotify, check that the token has the scopes needed for playlist modification.
  if (providerId === 'spotify') {
    const grantedScopes = store.get('spotify_token_scopes');
    if (grantedScopes) {
      const requiredScopes = ['playlist-modify-public', 'playlist-modify-private'];
      const hasAny = requiredScopes.some(s => grantedScopes.includes(s));
      if (!hasAny) {
        console.log(`[Sync] Token missing required scopes for playlist push. Prompting re-auth.`);
        return {
          success: false,
          error: 'Missing permissions. Please disconnect and reconnect Spotify to grant the required permissions.',
          errorCode: 'missing_scopes'
        };
      }
    } else {
      console.log('[Sync] No stored scopes found (legacy auth). Prompting re-auth.');
      return {
        success: false,
        error: 'Your Spotify connection needs to be refreshed. Please disconnect and reconnect Spotify in Settings.',
        errorCode: 'missing_scopes'
      };
    }
  }

  try {
    // Check if user owns the playlist (can only push to owned playlists)
    if (provider.checkPlaylistOwnership) {
      const isOwner = await provider.checkPlaylistOwnership(playlistExternalId, token);
      if (!isOwner) {
        return { success: false, error: 'You can only push changes to playlists you own' };
      }
    }

    // Push metadata changes (name, description) if provided.
    // A failure here (e.g. Apple Music's PATCH-is-unsupported 401) must NOT
    // abort the track push — the rename is best-effort, the tracks are the
    // point. Swallow any throw and continue.
    if (metadata && provider.updatePlaylistDetails) {
      try {
        await provider.updatePlaylistDetails(playlistExternalId, metadata, token);
      } catch (detailsErr) {
        console.warn(`[Sync] updatePlaylistDetails failed for ${providerId} playlist ${playlistExternalId}; continuing with track push: ${detailsErr.message}`);
      }
    }

    // Push track changes
    const result = await provider.updatePlaylistTracks(playlistExternalId, tracks, token);

    // Fire-and-forget: if this push touched an LB-anchored playlist (either
    // we just pushed to LB, OR the local has an LB mirror via sync_playlist_links),
    // tell Achordion about the playlist's mirror set. Look up the local
    // playlist id by reverse-scanning sync_playlist_links.
    try {
      let localPlaylistId = null;
      const allLinks = getSyncLinks();
      for (const [lpId, byProvider] of Object.entries(allLinks)) {
        if (byProvider?.[providerId]?.externalId === playlistExternalId) {
          localPlaylistId = lpId;
          break;
        }
      }
      const lbInvolved = providerId === 'listenbrainz'
        || (localPlaylistId && allLinks[localPlaylistId]?.listenbrainz?.externalId);
      if (lbInvolved) {
        const ctx = buildLocalPlaylistMirrorContext({
          localPlaylistId,
          providerId,
          externalId: playlistExternalId,
          name: metadata?.name,
          tracks,
        });
        pushPlaylistLinksToAchordion(ctx);
      }
    } catch (e) {
      console.warn('[achordion] post-push submit prep failed:', e && e.message ? e.message : e);
    }

    return { success: true, snapshotId: result.snapshotId };
  } catch (error) {
    // Detect remote playlist deletion (404)
    if (error.message?.includes('404') || error.message?.includes('Not Found') || error.status === 404) {
      return { success: false, error: 'PLAYLIST_NOT_FOUND', message: 'The remote playlist no longer exists' };
    }
    return { success: false, error: error.message };
  }
});

  // Create a new playlist on a remote service from a local playlist
  ipcMain.handle('sync:create-playlist', async (event, providerId, name, description, tracks, localPlaylistId = null) => {
    const provider = SyncEngine.getProvider(providerId);
    if (!provider || !provider.capabilities.playlists) {
      return { success: false, error: 'Provider does not support playlists' };
    }

    if (!provider.createPlaylist) {
      return { success: false, error: 'Provider does not support creating playlists' };
    }

    let token;
    let refreshTokenCb = null;
    if (providerId === 'spotify') {
      token = await ensureValidSpotifyToken();
      refreshTokenCb = async () => {
        const newToken = await ensureValidSpotifyToken(true);
        if (newToken) token = newToken;
        return newToken;
      };
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    } else if (providerId === 'listenbrainz') {
      const cfg = store.get('scrobbler-config-listenbrainz') || {};
      token = cfg.userToken || null;
    }

    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    // Helper: push tracks to an existing remote playlist and return the
    // shape sync:create-playlist would normally return. Used when we link
    // to an existing remote instead of creating.
    const linkToExisting = async (existing, source) => {
      let resolved = tracks;
      let unresolved = [];
      if (provider.resolveTracks) {
        const resolveResult = await provider.resolveTracks(tracks, token);
        resolved = resolveResult.resolved;
        unresolved = resolveResult.unresolved;
      }
      let snapshotId = existing.snapshotId;
      if (resolved.length > 0 && provider.updatePlaylistTracks) {
        try {
          const updateResult = await provider.updatePlaylistTracks(existing.externalId, resolved, token);
          snapshotId = updateResult.snapshotId || snapshotId;
        } catch (trackError) {
          console.warn(`[Sync] Linked "${name}" to existing ${providerId} playlist but failed to push tracks: ${trackError.message}`);
          unresolved = tracks.map(t => ({ artist: t.artist, title: t.title }));
        }
      }
      // Persist the link on the main-process side too so renderer save bugs
      // can't clobber it.
      if (localPlaylistId) {
        setSyncLink(localPlaylistId, providerId, existing.externalId);
      }
      console.log(`[Sync] Linked "${name}" to existing ${providerId} playlist ${existing.externalId} (via ${source})`);

      // Fire-and-forget Achordion playlist-links submit when LB is involved.
      const lbInvolved = providerId === 'listenbrainz'
        || (localPlaylistId && getSyncLinks()[localPlaylistId]?.listenbrainz?.externalId);
      if (lbInvolved) {
        const ctx = buildLocalPlaylistMirrorContext({
          localPlaylistId,
          providerId,
          externalId: existing.externalId,
          name,
          tracks,
        });
        pushPlaylistLinksToAchordion(ctx);
      }

      return {
        success: true,
        externalId: existing.externalId,
        snapshotId,
        unresolvedTracks: unresolved,
        linkedToExisting: true,
        linkSource: source
      };
    };

    try {
      // We fetch the remote playlist list at most once and reuse it for both
      // the ID-based link check and the name-based fallback check.
      let remotePlaylists = null;
      // parachord#846: track whether the fetch actually succeeded. A throwing
      // fetchPlaylists (transient 5xx / 429 / 401, malformed response,
      // network glitch) is indistinguishable from "user genuinely has no
      // playlists" if we just collapse both into an empty array — and the
      // dedup logic below treats "missing from result" as "remote gone,"
      // destroying the durable link AND falling through to create a
      // duplicate. A transient blip would then turn into N permanent
      // duplicates on the user's account. We need to differentiate.
      let remotePlaylistsFetchError = null;
      const getRemotePlaylists = async () => {
        if (remotePlaylists !== null) return remotePlaylists;
        if (!provider.fetchPlaylists) return (remotePlaylists = []);
        try {
          const { playlists } = await provider.fetchPlaylists(token, null, refreshTokenCb);
          remotePlaylists = playlists || [];
        } catch (err) {
          console.warn(`[Sync] Could not fetch remote playlists for dedup check on ${providerId}:`, err.message);
          remotePlaylists = [];
          remotePlaylistsFetchError = err.message || 'unknown error';
        }
        return remotePlaylists;
      };

      // -----------------------------------------------------------------
      // Step 0a: ID-based link check (durable, rename-safe).
      //
      // The sync_playlist_links map is an independent source of truth that
      // survives any renderer-side save bug that might strip syncedTo. If
      // we've previously linked this local playlist to a remote, reuse it —
      // but first verify the remote still exists, to handle cases where the
      // user deleted the playlist on the service between syncs.
      // -----------------------------------------------------------------
      if (localPlaylistId) {
        const existingLink = getSyncLinks()[localPlaylistId]?.[providerId];
        if (existingLink?.externalId) {
          const remote = await getRemotePlaylists();
          if (remotePlaylistsFetchError) {
            // parachord#846: fetch failed. We CANNOT tell whether the linked
            // remote is genuinely gone or whether we just couldn't reach
            // the API right now. Treating "missing from empty result" as
            // "remote deleted" would destroy a still-valid durable link
            // AND fall through to creating a duplicate — that's the
            // runaway-duplication failure mode that produced 6,397 fake
            // playlists on the reporter's LB account. Preserve the link
            // and bail with a retryable failure; the next sync cycle will
            // try again.
            console.warn(`[Sync] ${providerId} fetchPlaylists failed (${remotePlaylistsFetchError}); preserving link for local ${localPlaylistId} → ${existingLink.externalId} and skipping create. Will retry next cycle.`);
            return {
              success: false,
              error: `Could not verify ${providerId} remote playlists: ${remotePlaylistsFetchError}. Link preserved; will retry next cycle.`,
              retryable: true
            };
          }
          const match = remote.find(p => p.externalId === existingLink.externalId && p.isOwnedByUser);
          if (match) {
            return await linkToExisting(match, 'id-link');
          }
          // Link is stale (remote gone) — clear it so we don't keep trying
          // to reuse a dead ID on future syncs. Only reached on a
          // SUCCESSFUL fetch that genuinely doesn't contain this ID.
          console.log(`[Sync] Stored link ${providerId}:${existingLink.externalId} for local ${localPlaylistId} no longer exists remotely; clearing and falling through to create`);
          removeSyncLink(localPlaylistId, providerId);
        }
      }

      // -----------------------------------------------------------------
      // Step 0b: Name-based fallback (last-ditch).
      //
      // Catches cases where the ID link is missing entirely: legacy data
      // that predates sync_playlist_links, or installs where migration
      // hadn't run yet. Matches on trimmed-lowercased name among the
      // user's owned playlists. If several match, the richest one wins.
      // -----------------------------------------------------------------
      const remote = await getRemotePlaylists();
      if (remotePlaylistsFetchError) {
        // parachord#846: same rationale as Step 0a — without a confirmed
        // remote list we cannot decide between "no same-named remote
        // exists" and "we couldn't reach the API." Creating blindly here
        // is the OTHER half of the runaway-duplication failure mode
        // (the half for playlists that don't yet have a sync_playlist_links
        // entry — first-time syncs, post-wizard pushes, etc.). Bail rather
        // than risk a duplicate.
        console.warn(`[Sync] ${providerId} fetchPlaylists failed (${remotePlaylistsFetchError}); skipping name-match + create for "${name}". Will retry next cycle.`);
        return {
          success: false,
          error: `Could not verify ${providerId} remote playlists: ${remotePlaylistsFetchError}. Skipped create; will retry next cycle.`,
          retryable: true
        };
      }
      if (remote.length > 0) {
        const normalized = (name || '').trim().toLowerCase();
        const matches = remote.filter(p => p.isOwnedByUser && (p.name || '').trim().toLowerCase() === normalized);
        if (matches.length > 0) {
          matches.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0));
          return await linkToExisting(matches[0], matches.length > 1 ? `name-match (${matches.length} candidates)` : 'name-match');
        }
      }

      // -----------------------------------------------------------------
      // Step 1: Resolve tracks to provider-specific IDs
      // -----------------------------------------------------------------
      let resolved = tracks;
      let unresolved = [];
      if (provider.resolveTracks) {
        const resolveResult = await provider.resolveTracks(tracks, token);
        resolved = resolveResult.resolved;
        unresolved = resolveResult.unresolved;
        console.log(`[Sync] Resolved ${resolved.length}/${tracks.length} tracks for ${providerId} (${unresolved.length} unresolved)`);
      }

      // -----------------------------------------------------------------
      // Step 2: Create the playlist
      // -----------------------------------------------------------------
      const { externalId, snapshotId } = await provider.createPlaylist(name, description, token);
      console.log(`[Sync] Created playlist "${name}" on ${providerId}: ${externalId}`);

      // Record the new link in our durable map immediately — even if Step 3
      // (track push) or the renderer-side syncedTo save fails, the next sync
      // will find this link and avoid a duplicate.
      if (localPlaylistId) {
        setSyncLink(localPlaylistId, providerId, externalId);
      }

      // -----------------------------------------------------------------
      // Step 3: Add tracks — if this fails, the playlist was still created
      // on the provider so we must return success with the externalId.
      // Otherwise syncedTo is never set and the next sync creates a dupe.
      // -----------------------------------------------------------------
      let finalSnapshotId = snapshotId;
      if (resolved.length > 0 && provider.updatePlaylistTracks) {
        try {
          const updateResult = await provider.updatePlaylistTracks(externalId, resolved, token);
          finalSnapshotId = updateResult.snapshotId || snapshotId;
        } catch (trackError) {
          console.warn(`[Sync] Playlist "${name}" created on ${providerId} but failed to add tracks: ${trackError.message}`);
          unresolved = tracks.map(t => ({ artist: t.artist, title: t.title }));
        }
      }

      // Fire-and-forget: tell Achordion about this playlist's mirror set if
      // LB is involved. Either the just-created remote IS the LB MBID, or
      // we have a stored LB link for this local playlist via sync_playlist_links.
      const lbInvolved = providerId === 'listenbrainz'
        || (localPlaylistId && getSyncLinks()[localPlaylistId]?.listenbrainz?.externalId);
      if (lbInvolved) {
        const ctx = buildLocalPlaylistMirrorContext({
          localPlaylistId,
          providerId,
          externalId,
          name,
          tracks,
        });
        // Do NOT await — fire-and-forget.
        pushPlaylistLinksToAchordion(ctx);
      }

      return {
        success: true,
        externalId,
        snapshotId: finalSnapshotId,
        unresolvedTracks: unresolved
      };
    } catch (error) {
      console.error(`[Sync] Failed to create playlist on ${providerId}:`, error.message);
      return { success: false, error: error.message };
    }
  });

  // Resolve local tracks to provider-specific IDs
  ipcMain.handle('sync:resolve-tracks', async (event, providerId, tracks) => {
    const provider = SyncEngine.getProvider(providerId);
    if (!provider?.resolveTracks) {
      return { success: false, error: 'Provider does not support track resolution' };
    }

    let token;
    if (providerId === 'spotify') {
      token = await ensureValidSpotifyToken();
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    } else if (providerId === 'listenbrainz') {
      const cfg = store.get('scrobbler-config-listenbrainz') || {};
      token = cfg.userToken || null;
    }

    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      const result = await provider.resolveTracks(tracks, token);
      return { success: true, resolved: result.resolved, unresolved: result.unresolved };
    } catch (error) {
      return { success: false, error: error.message };
    }
  });

  // Clean up duplicate playlists on a sync provider
  // Groups remote playlists by name and deletes duplicates, keeping the best one
  // (most tracks, or most recently modified as tiebreaker)
  ipcMain.handle('sync:cleanup-duplicate-playlists', async (event, providerId) => {
    const provider = SyncEngine.getProvider(providerId);
    if (!provider || !provider.capabilities.playlists) {
      return { success: false, error: 'Provider does not support playlists' };
    }
    if (!provider.deletePlaylist) {
      return { success: false, error: 'Provider does not support playlist deletion' };
    }

    let token;
    let refreshTokenCb = null;
    if (providerId === 'spotify') {
      token = await ensureValidSpotifyToken();
      refreshTokenCb = async () => {
        const newToken = await ensureValidSpotifyToken(true);
        if (newToken) token = newToken;
        return newToken;
      };
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
      // Apple Music token refresh: try to fetch a fresh user token via the
      // native MusicKit bridge when a 401 occurs (expired user token).
      refreshTokenCb = buildAppleMusicRefreshCb(token, (newToken) => { token = newToken; });
    } else if (providerId === 'listenbrainz') {
      const cfg = store.get('scrobbler-config-listenbrainz') || {};
      token = cfg.userToken || null;
    }

    if (!token) {
      return { success: false, error: 'Not authenticated' };
    }

    try {
      // Fetch all remote playlists
      const { playlists } = await provider.fetchPlaylists(token, null, refreshTokenCb);
      if (!playlists || playlists.length === 0) {
        return { success: true, deleted: 0, groups: [] };
      }

      // Only consider user-owned playlists (don't delete followed/collaborative ones)
      const ownedPlaylists = playlists.filter(p => p.isOwnedByUser !== false);

      // ----------------------------------------------------------------
      // Step 1: Relink orphaned locals first.
      //
      // A local playlist that should be linked to a remote but has lost
      // its syncedTo (through old bugs, crashes, save-path regressions)
      // looks "unlinked" to keeper selection below — we'd pick the
      // wrong keeper based on fallback heuristics. Relinking restores
      // those links so the keeper-selection correctly prefers the copy
      // the user's local is actually synced with.
      //
      // Relink only acts on unambiguous 1:1 name matches. If a local
      // name has multiple remote candidates (the very case cleanup is
      // about to collapse), relink skips and marks ambiguous — keeper
      // selection's link-awareness still falls back to fallback-sort
      // for that group, which is the best we can do when no local
      // reference disambiguates.
      // ----------------------------------------------------------------
      const relinkResult = relinkOrphansFor(providerId, ownedPlaylists);

      // ----------------------------------------------------------------
      // Step 1b: Repair linked-but-empty remotes.
      //
      // Before the relink-sets-locallyModified fix, orphan relink would
      // write syncedTo without flagging the playlist as modified. The
      // push loop needs locallyModified=true to push track content, so
      // those already-linked playlists would stay empty on the remote
      // indefinitely. Detect that state here and flag for push on the
      // next sync. Covers users recovering from a pre-fix cleanup run.
      // ----------------------------------------------------------------
      const remoteByExternalId = new Map(
        ownedPlaylists.map(p => [p.externalId, p])
      );
      const repairLocal = store.get('local_playlists') || [];
      let repairedCount = 0;
      const repairedLocal = repairLocal.map(p => {
        const link = p.syncedTo?.[providerId];
        if (!link?.externalId) return p;
        if (p.locallyModified) return p; // already flagged
        if (!(p.tracks?.length > 0)) return p; // nothing to push
        const remote = remoteByExternalId.get(link.externalId);
        if (!remote) return p; // remote is gone; different problem (pendingAction handles elsewhere)
        if ((remote.trackCount || 0) > 0) return p; // remote isn't empty; don't trigger a push
        repairedCount++;
        return {
          ...p,
          locallyModified: true,
          lastModified: Date.now()
        };
      });
      if (repairedCount > 0) {
        store.set('local_playlists', repairedLocal);
        console.log(`[Sync Cleanup] Flagged ${repairedCount} locally-tracked playlist(s) as modified (linked to empty remote — will populate on next sync)`);
      }

      // Group by normalized name
      const groups = {};
      for (const playlist of ownedPlaylists) {
        const key = (playlist.name || '').trim().toLowerCase();
        if (!groups[key]) groups[key] = [];
        groups[key].push(playlist);
      }

      // Find groups with duplicates
      const duplicateGroups = Object.entries(groups).filter(([, items]) => items.length > 1);
      if (duplicateGroups.length === 0) {
        return {
          success: true,
          deleted: 0,
          unsupported: 0,
          unsupportedManualRemoval: [],
          groups: [],
          ambiguous: [],
          relinked: relinkResult.linked,
          relinkAmbiguous: relinkResult.ambiguous,
          orphanCount: relinkResult.orphanCount,
          repairedEmptyLinks: repairedCount,
          relinkedFromShell: 0
        };
      }

      // ----------------------------------------------------------------
      // Step 2: Build a map of which externalIds in the duplicate groups
      // are referenced by local playlists (via syncedTo, syncedFrom, OR
      // the sync_playlist_links map). This drives keeper selection: we
      // keep the remote that the user's locals are actually linked to,
      // so nobody gets silently re-pointed to a different copy.
      //
      // Note: we re-read local_playlists and links AFTER relink ran so
      // we see the just-written links.
      // ----------------------------------------------------------------
      const groupExternalIds = new Set();
      for (const [, items] of duplicateGroups) {
        for (const item of items) groupExternalIds.add(item.externalId);
      }

      const localPlaylists = store.get('local_playlists') || [];
      const allLinks = getSyncLinks();

      // Map: externalId -> set of localPlaylistIds referencing it.
      // Using a Set dedupes the case where one local has both syncedTo
      // and syncedFrom pointing at the same remote.
      const localsByExternalId = new Map();
      const addLink = (externalId, localId) => {
        if (!externalId || !localId) return;
        if (!groupExternalIds.has(externalId)) return;
        if (!localsByExternalId.has(externalId)) localsByExternalId.set(externalId, new Set());
        localsByExternalId.get(externalId).add(localId);
      };
      for (const local of localPlaylists) {
        addLink(local.syncedTo?.[providerId]?.externalId, local.id);
        if (local.syncedFrom?.resolver === providerId) {
          addLink(local.syncedFrom.externalId, local.id);
        }
      }
      for (const [localId, providers] of Object.entries(allLinks)) {
        addLink(providers[providerId]?.externalId, localId);
      }

      // ----------------------------------------------------------------
      // For each duplicate group, pick a keeper. Preference order:
      //   1. The remote that locals are actually linked to.
      //   2. If multiple remotes in the group have distinct locals
      //      linked (ambiguous — two locals think they own different
      //      copies), skip the group entirely and surface a warning.
      //   3. Otherwise (no locals linked anywhere in the group), fall
      //      back to most-tracks then most-recent-snapshot.
      // ----------------------------------------------------------------
      const cleanableGroups = [];
      const ambiguousGroups = [];

      for (const [name, items] of duplicateGroups) {
        const linkedMembers = items.filter(p => localsByExternalId.has(p.externalId));

        if (linkedMembers.length > 1) {
          // Two or more remotes in this group are each referenced by at
          // least one local. Collapsing them would silently re-point a
          // local to a different playlist's content. Require manual
          // resolution.
          ambiguousGroups.push({
            name,
            linkedMembers: linkedMembers.map(m => ({
              externalId: m.externalId,
              trackCount: m.trackCount || 0,
              localIds: [...localsByExternalId.get(m.externalId)]
            }))
          });
          console.warn(`[Sync Cleanup] Skipping ambiguous group "${name}": ${linkedMembers.length} copies each have local references. User must resolve manually.`);
          continue;
        }

        let keeper;
        let relinkFrom = null; // when we override a linked empty keeper, remember the original external id so we can relink locals
        if (linkedMembers.length === 1) {
          const linked = linkedMembers[0];
          const linkedIsEmpty = (linked.trackCount || 0) === 0;
          // Populated alternatives in the group (not the linked member).
          const populatedAlternatives = items.filter(p => p.externalId !== linked.externalId && (p.trackCount || 0) > 0);
          if (linkedIsEmpty && populatedAlternatives.length > 0) {
            // Linked remote is an empty shell (typically left behind by an
            // earlier buggy relink that never populated it). A populated
            // alternative in the same group is almost certainly what the
            // user actually wants to keep. Pick the richest populated one,
            // and flag that locals linked to the empty shell should be
            // relinked to the new keeper.
            populatedAlternatives.sort((a, b) => (b.trackCount || 0) - (a.trackCount || 0));
            keeper = populatedAlternatives[0];
            relinkFrom = linked.externalId;
            console.log(`[Sync Cleanup] Group "${name}": linked remote ${linked.externalId} is empty; preferring populated alternative ${keeper.externalId} (${keeper.trackCount} tracks) and relinking ${localsByExternalId.get(linked.externalId).size} local(s).`);
          } else {
            keeper = linked;
          }
        } else {
          const sorted = [...items].sort((a, b) => {
            if ((b.trackCount || 0) !== (a.trackCount || 0)) {
              return (b.trackCount || 0) - (a.trackCount || 0);
            }
            return (b.snapshotId || '').localeCompare(a.snapshotId || '');
          });
          keeper = sorted[0];
        }

        const toDelete = items.filter(p => p.externalId !== keeper.externalId);
        cleanableGroups.push({ name, keeper, toDelete, relinkFrom });
      }

      // ----------------------------------------------------------------
      // Perform deletions. The keeper selection above guarantees that
      // no local is currently pointing at any of the toDelete ids (when
      // a local pointed at a group member, that member became the
      // keeper), so there's nothing to relink afterwards. We still prune
      // the link map defensively, in case of split-brain between
      // syncedTo and sync_playlist_links.
      // ----------------------------------------------------------------
      let totalDeleted = 0;
      let totalUnsupported = 0;
      const deletedGroups = [];
      const deletedExternalIds = new Set();
      const unsupportedManualRemoval = []; // remotes the provider couldn't delete

      for (const { name, keeper, toDelete } of cleanableGroups) {
        for (const dup of toDelete) {
          try {
            const result = await provider.deletePlaylist(dup.externalId, token, refreshTokenCb);
            if (result?.success) {
              totalDeleted++;
              deletedExternalIds.add(dup.externalId);
              console.log(`[Sync Cleanup] Deleted duplicate "${dup.name}" (${dup.externalId}, ${dup.trackCount || 0} tracks) — keeping ${keeper.externalId} (${keeper.trackCount || 0} tracks)`);
            } else if (result?.reason === 'endpoint-unsupported') {
              // Provider doesn't support DELETE on its public API (Apple
              // Music). Track so we can surface "manually remove these"
              // guidance; don't treat as failure — the local relink
              // phase still produces correct local state.
              totalUnsupported++;
              unsupportedManualRemoval.push({
                name: dup.name,
                externalId: dup.externalId,
                trackCount: dup.trackCount || 0
              });
              console.log(`[Sync Cleanup] Cannot delete "${dup.name}" (${dup.externalId}) via ${providerId} public API; user must remove manually`);
            } else {
              console.warn(`[Sync Cleanup] Unexpected deletePlaylist result for "${dup.name}":`, result);
            }
            if (provider.getRateLimitDelay) {
              await new Promise(r => setTimeout(r, provider.getRateLimitDelay()));
            }
          } catch (err) {
            console.warn(`[Sync Cleanup] Failed to delete "${dup.name}" (${dup.externalId}): ${err.message}`);
          }
        }
        deletedGroups.push({
          name: keeper.name,
          kept: { externalId: keeper.externalId, trackCount: keeper.trackCount || 0 },
          deleted: toDelete.length
        });
      }

      // ----------------------------------------------------------------
      // Relink locals whose keeper was overridden from an empty shell to
      // a populated alternative. Any local whose syncedTo[provider]
      // points at the old empty shell gets repointed at the new keeper.
      // Also update the sync_playlist_links map. Set locallyModified to
      // false since local's tracks don't match the new remote's tracks
      // (the new keeper was already populated independently) — leaving
      // it as-is would push local content over the richer remote copy.
      // ----------------------------------------------------------------
      const relinkOverrides = cleanableGroups
        .filter(g => g.relinkFrom && g.relinkFrom !== g.keeper.externalId)
        .map(g => ({ from: g.relinkFrom, to: g.keeper.externalId, keeperName: g.keeper.name, keeperSnapshot: g.keeper.snapshotId || null }));
      let relinkedFromOverride = 0;
      if (relinkOverrides.length > 0) {
        const latestLocal = store.get('local_playlists') || [];
        const overrideMap = new Map(relinkOverrides.map(o => [o.from, o]));
        const now = Date.now();
        const updatedLocal = latestLocal.map(p => {
          const link = p.syncedTo?.[providerId];
          if (!link?.externalId) return p;
          const override = overrideMap.get(link.externalId);
          if (!override) return p;
          relinkedFromOverride++;
          return {
            ...p,
            locallyModified: false,
            syncedTo: {
              ...p.syncedTo,
              [providerId]: {
                ...link,
                externalId: override.to,
                snapshotId: override.keeperSnapshot,
                syncedAt: now,
                pendingAction: null
              }
            }
          };
        });
        if (relinkedFromOverride > 0) {
          store.set('local_playlists', updatedLocal);
          // Mirror the change into the sync_playlist_links map so the
          // durable link survives any renderer-side save that might strip
          // syncedTo.
          for (const p of updatedLocal) {
            const link = p.syncedTo?.[providerId];
            if (link?.externalId && overrideMap.has(relinkOverrides.find(o => o.to === link.externalId)?.from)) {
              setSyncLink(p.id, providerId, link.externalId);
            }
          }
          console.log(`[Sync Cleanup] Relinked ${relinkedFromOverride} local playlist(s) from empty shells to populated keepers`);
        }
      }

      // Defensive cleanup of local refs. Keeper selection makes this a
      // no-op in the common case, but a split-brain between syncedTo and
      // sync_playlist_links could still leave dangling pointers.
      if (deletedExternalIds.size > 0) {
        let localCleaned = 0;
        const updatedLocal = localPlaylists.map(p => {
          if (p.syncedTo?.[providerId] && deletedExternalIds.has(p.syncedTo[providerId].externalId)) {
            const newSyncedTo = { ...p.syncedTo };
            delete newSyncedTo[providerId];
            localCleaned++;
            return { ...p, syncedTo: Object.keys(newSyncedTo).length > 0 ? newSyncedTo : undefined };
          }
          if (p.syncedFrom?.resolver === providerId && deletedExternalIds.has(p.syncedFrom.externalId)) {
            localCleaned++;
            return { ...p, syncedFrom: null };
          }
          return p;
        });
        if (localCleaned > 0) {
          store.set('local_playlists', updatedLocal);
          console.warn(`[Sync Cleanup] Cleaned ${localCleaned} stray local ref(s) to deleted duplicates — this should not happen under normal keeper selection, indicates syncedTo/link-map skew.`);
        }

        let linksCleaned = 0;
        const freshLinks = getSyncLinks();
        for (const [localId, providers] of Object.entries(freshLinks)) {
          const link = providers[providerId];
          if (link?.externalId && deletedExternalIds.has(link.externalId)) {
            removeSyncLink(localId, providerId);
            linksCleaned++;
          }
        }
        if (linksCleaned > 0) {
          console.log(`[Sync Cleanup] Pruned ${linksCleaned} sync-link map entries pointing at deleted duplicates`);
        }
      }

      return {
        success: true,
        deleted: totalDeleted,
        unsupported: totalUnsupported,
        unsupportedManualRemoval,
        groups: deletedGroups,
        ambiguous: ambiguousGroups,
        relinked: relinkResult.linked,
        relinkAmbiguous: relinkResult.ambiguous,
        orphanCount: relinkResult.orphanCount,
        repairedEmptyLinks: repairedCount,
        relinkedFromShell: relinkedFromOverride
      };
    } catch (error) {
      console.error(`[Sync Cleanup] Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

  // Standalone relink IPC — useful for testing or if we want to expose a
  // separate UI button in the future. Internally, the cleanup handler also
  // runs relinkOrphansFor before picking keepers, so most users won't need
  // to call this directly.
  ipcMain.handle('sync:relink-orphaned-playlists', async (event, providerId) => {
    const provider = SyncEngine.getProvider(providerId);
    if (!provider || !provider.capabilities.playlists || !provider.fetchPlaylists) {
      return { success: false, error: 'Provider does not support playlists' };
    }

    let token;
    let refreshTokenCb = null;
    if (providerId === 'spotify') {
      token = await ensureValidSpotifyToken();
      refreshTokenCb = async () => {
        const newToken = await ensureValidSpotifyToken(true);
        if (newToken) token = newToken;
        return newToken;
      };
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) await musicKitTokenReady;
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) token = JSON.stringify({ developerToken, userToken });
    } else if (providerId === 'listenbrainz') {
      const cfg = store.get('scrobbler-config-listenbrainz') || {};
      token = cfg.userToken || null;
    }
    if (!token) return { success: false, error: 'Not authenticated' };

    try {
      const { playlists: remote } = await provider.fetchPlaylists(token, null, refreshTokenCb);
      const ownedRemote = (remote || []).filter(p => p.isOwnedByUser !== false);
      const result = relinkOrphansFor(providerId, ownedRemote);
      return { success: true, ...result };
    } catch (error) {
      console.error(`[Sync Relink] Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  });

// Helper: get auth token for a sync provider
function getSyncProviderToken(providerId) {
  if (providerId === 'spotify') {
    return store.get('spotify_token');
  } else if (providerId === 'applemusic') {
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    const userToken = store.get('applemusic_user_token');
    if (developerToken && userToken) {
      return JSON.stringify({ developerToken, userToken });
    }
  } else if (providerId === 'listenbrainz') {
    // LB user token lives in the scrobbler-side config, not a separate
    // sync key. See CLAUDE.md "ListenBrainz auth token auto-attach".
    const cfg = store.get('scrobbler-config-listenbrainz') || {};
    return cfg.userToken || null;
  }
  return null;
}

// Push track changes to sync provider (add to Liked Songs)
ipcMain.handle('sync:save-tracks', async (event, providerId, trackIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.tracks) {
    return { success: false, error: 'Provider does not support track syncing' };
  }

  if (!provider.saveTracks) {
    return { success: false, error: 'Provider does not support saving tracks' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.saveTracks(trackIds, token);
    return { success: true, saved: result.saved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Save albums to sync provider library
ipcMain.handle('sync:save-albums', async (event, providerId, albumIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.albums) {
    return { success: false, error: 'Provider does not support album syncing' };
  }

  if (!provider.saveAlbums) {
    return { success: false, error: 'Provider does not support saving albums' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.saveAlbums(albumIds, token);
    return { success: true, saved: result.saved };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ── Track tombstones (parachord#864) ─────────────────────────────
//
// Renderer-side `removeTrackFromCollection` writes tombstones for
// every (providerId, externalId) on the removed track. Renderer-side
// `addTrackToCollection` clears them when the user re-adds a track.
// `sync:start` filters remote items against the tombstone list before
// diffing. App start runs `pruneExpired` once.

ipcMain.handle('sync:tombstones:add-batch', async (event, entries) => {
  try {
    const written = Tombstones.addTombstones(store, entries);
    return { success: true, written };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:tombstones:clear-batch', async (event, entries) => {
  try {
    const cleared = Tombstones.clearTombstones(store, entries);
    return { success: true, cleared };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('sync:tombstones:list', async () => {
  return store.get(Tombstones.TOMBSTONE_KEY) || {};
});

// Remove tracks from sync provider library
ipcMain.handle('sync:remove-tracks', async (event, providerId, trackIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.tracks) {
    return { success: false, error: 'Provider does not support track syncing' };
  }

  if (!provider.removeTracks) {
    return { success: false, error: 'Provider does not support removing tracks' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.removeTracks(trackIds, token);
    return { success: true, removed: result.removed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Remove albums from sync provider library
ipcMain.handle('sync:remove-albums', async (event, providerId, albumIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.albums) {
    return { success: false, error: 'Provider does not support album syncing' };
  }

  if (!provider.removeAlbums) {
    return { success: false, error: 'Provider does not support removing albums' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.removeAlbums(albumIds, token);
    return { success: true, removed: result.removed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Follow artists on sync provider
ipcMain.handle('sync:follow-artists', async (event, providerId, artistIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.artists) {
    return { success: false, error: 'Provider does not support artist syncing' };
  }

  if (!provider.followArtists) {
    return { success: false, error: 'Provider does not support following artists' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.followArtists(artistIds, token);
    return { success: true, followed: result.followed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Unfollow artists on sync provider
ipcMain.handle('sync:unfollow-artists', async (event, providerId, artistIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.artists) {
    return { success: false, error: 'Provider does not support artist syncing' };
  }

  if (!provider.unfollowArtists) {
    return { success: false, error: 'Provider does not support unfollowing artists' };
  }

  const token = getSyncProviderToken(providerId);
  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const result = await provider.unfollowArtists(artistIds, token);
    return { success: true, unfollowed: result.unfollowed };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ==============================================
// MusicKit (Apple Music) Native Bridge Handlers
// ==============================================

// Cookie-harvesting Apple Music auth window (parachord#834).
//
// Background: Apple's MusicKit JS uses a popup → parent handshake that depends
// on cookies set on *.music.apple.com inside the popup remaining visible to
// the parent window. Under Electron, those cookies are partitioned away from
// any parent that isn't ALSO on a music.apple.com top-level — including our
// `parachord://app` origin. The flag fix we shipped (storage partitioning
// disabled) gets us part of the way; Electron's separate third-party-cookie
// block, which has no public API, gates the rest. So MusicKit's own popup
// flow doesn't reach a working auth state on Linux or Windows.
//
// Cider and Sidra both solve this by NOT using MusicKit's popup. Instead they
// open a dedicated BrowserWindow at https://beta.music.apple.com/, let the
// user sign in directly on Apple's real origin (where cookies set normally),
// then harvest the auth cookies via Electron's main-process cookie API and
// inject them into the main window as `music.ampwebplay.*` localStorage keys.
// MusicKit JS reads those keys on init, so the next reload of the main window
// starts up already-authorized. This handler is our mirror of that flow.
//
// Cookies harvested (Cider's list, byte-identical):
//   itspod, pltvcid, pldfltcid, itua, media-user-token, acn1, dslang
//
// `media-user-token` is the actual carrier; the others are auth-supporting
// (rotation, region, fraud-protection). Renderer-side: `recv-cookies` IPC
// writes them all to localStorage with the `music.ampwebplay.<name>` prefix
// MusicKit JS expects, then triggers a reload so MusicKit picks them up.
//
// All applemusic:* IPC handlers below this comment are part of this flow.

// Safari user-agent — apple.com rejects Electron's default UA on sign-in,
// flagging the request as an automated bot. Setting a real Safari UA on the
// auth window's webContents makes the sign-in form actually render. We use a
// recent Safari/Mac UA regardless of the host platform (the goal is to look
// like a real browser to apple.com, not to match the host OS).
const APPLE_AUTH_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_3_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.4 Safari/605.1.15';

// Cookie list to harvest, in the exact order Cider uses. The renderer-side
// MusicKit JS gates on `music.ampwebplay.media-user-token`, but writing all
// seven matches Cider's known-working configuration.
const APPLE_AUTH_COOKIE_NAMES = [
  'itspod', 'pltvcid', 'pldfltcid', 'itua', 'media-user-token', 'acn1', 'dslang'
];

let appleAuthWindow = null;

ipcMain.handle('applemusic:open-auth-window', async () => {
  // Coalesce repeat clicks while a window is already open.
  if (appleAuthWindow && !appleAuthWindow.isDestroyed()) {
    appleAuthWindow.focus();
    return { success: true, alreadyOpen: true };
  }

  return new Promise((resolve) => {
    appleAuthWindow = new BrowserWindow({
      width: 500,
      height: 700,
      show: false,  // Gated on `applemusic:auth-window-ready` from the preload.
      titleBarStyle: 'default',
      resizable: false,
      parent: mainWindow,
      modal: false,
      title: 'Sign in to Apple Music',
      webPreferences: {
        // Matches Cider — node + ipcRenderer access in the preload lets us
        // poll MusicKit and IPC back without a contextBridge dance.
        contextIsolation: false,
        nodeIntegration: true,
        sandbox: false,
        webSecurity: true,
        preload: path.join(__dirname, 'preload-am-auth.js')
      }
    });

    // NOTE: We deliberately do NOT clearStorageData() on the auth window's
    // session here. The auth window uses defaultSession (no partition), which
    // is shared with the main window — clearing it would wipe Spotify
    // cookies, other resolver state, etc. The trade-off is that a previously-
    // signed-in user gets auto-completed by MusicKit's
    // authorizationStatusDidChange listener firing immediately on the
    // existing cookie state. Harmless: the harvest re-writes the same
    // values to localStorage, the reload picks them up, end-state correct.
    //
    // If we ever need a true "fresh sign-in" flow (e.g. user-initiated
    // sign-out), do a SCOPED cookie-clear targeting `.apple.com` /
    // `.music.apple.com` rather than a blanket clearStorageData.

    // Apple rejects Electron's default UA. Safari UA makes sign-in render.
    appleAuthWindow.webContents.setUserAgent(APPLE_AUTH_USER_AGENT);

    // Defense in depth: the auth window has nodeIntegration: true (required so
    // the preload can poll window.MusicKit + ipcRenderer.send back to main).
    // That means a page in this window has full Node access — fine for
    // apple.com (trusted), but we should not allow navigation away from the
    // Apple auth flow. Block any non-apple.com / non-icloud.com navigation,
    // and deny window.open() entirely (popups to Apple's external help pages
    // can open in the user's default browser via shell.openExternal).
    appleAuthWindow.webContents.on('will-navigate', (event, url) => {
      try {
        const host = new URL(url).host.toLowerCase();
        const allowed = host.endsWith('apple.com') || host.endsWith('icloud.com');
        if (!allowed) {
          console.warn('[AppleMusic Auth] Blocking navigation to non-Apple host:', host);
          event.preventDefault();
        }
      } catch (_e) {
        event.preventDefault();
      }
    });
    appleAuthWindow.webContents.setWindowOpenHandler(({ url }) => {
      try {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          shell.openExternal(url).catch(() => {});
        }
      } catch (_e) {}
      return { action: 'deny' };
    });

    // Stash window-scoped state so the IPC handlers below can find their
    // window. Cleared on close. Using a closure rather than module-scope so
    // a second opener never races with a first.
    const windowState = { resolved: false, resolve };

    // Declared upfront (rather than at the setInterval site below) so the
    // cleanup helper can reference it without hitting a TDZ ReferenceError
    // if cleanup somehow runs between IPC registration and the cookie-poll
    // assignment. Practically unreachable today (the auth window's preload
    // can't IPC before loadURL fires) but explicit beats clever.
    let cookiePoll = null;

    // Cleanup helper: remove IPC listeners + close window. Called from
    // either auth-completed (success) OR window close (user cancel).
    const cleanup = () => {
      if (cookiePoll) clearInterval(cookiePoll);
      ipcMain.removeListener('applemusic:auth-completed', handleAuthCompleted);
      ipcMain.removeListener('applemusic:auth-window-ready', handleAuthWindowReady);
      ipcMain.removeListener('applemusic:auth-debug', handleAuthDebug);
      if (appleAuthWindow && !appleAuthWindow.isDestroyed()) {
        appleAuthWindow.close();
      }
      appleAuthWindow = null;
    };

    const handleAuthWindowReady = (event) => {
      // Only honor the ready signal from OUR auth window (other renderers
      // could in theory send the same IPC; gate on sender).
      if (!appleAuthWindow || event.sender !== appleAuthWindow.webContents) return;
      if (!appleAuthWindow.isVisible()) {
        appleAuthWindow.show();
      }
    };

    // Diagnostic relay — preload-am-auth.js sends progress messages so we
    // can debug detection failures on external testers' machines without
    // requiring DevTools (parachord#834 — added after moop250's Arch Linux
    // trace showed the preload was firing but no auth-completed IPC ever
    // arrived). Logs to main's stdout so testers can capture with
    // terminal-launched builds.
    const handleAuthDebug = (event, msg) => {
      if (!appleAuthWindow || event.sender !== appleAuthWindow.webContents) return;
      console.log(`[AppleMusic Auth][preload] ${msg}`);
    };

    const handleAuthCompleted = async (event) => {
      // The cookie-polling fallback synthesizes a minimal event with
      // `sender: appleAuthWindow.webContents` so this check still passes;
      // see the polling block below.
      if (!appleAuthWindow || event.sender !== appleAuthWindow.webContents) return;
      if (windowState.resolved) return;
      windowState.resolved = true;

      try {
        // Harvest cookies from the auth window's session. Cider does this
        // with a bare `.get({})` and filters in JS; we filter by name in the
        // query to skip the rest of the cookie jar (smaller payload).
        const session = appleAuthWindow.webContents.session;
        const harvested = {};
        for (const name of APPLE_AUTH_COOKIE_NAMES) {
          const cookies = await session.cookies.get({ name });
          // Prefer the cookie set on the broadest apple.com domain — there
          // can be multiple entries for the same name across subdomains.
          if (cookies.length > 0) {
            const cookie = cookies.find(c => c.domain === '.apple.com')
              || cookies.find(c => c.domain === '.music.apple.com')
              || cookies[0];
            harvested[`music.ampwebplay.${name}`] = cookie.value;
          }
        }

        // Sanity check: media-user-token is the actual carrier. Without it
        // the auth handshake didn't really complete.
        if (!harvested['music.ampwebplay.media-user-token']) {
          console.warn('[AppleMusic Auth] auth-completed fired but media-user-token cookie missing');
          cleanup();
          resolve({ success: false, error: 'No user token cookie found after auth' });
          return;
        }

        // Push the harvested cookies to the main window's renderer. The
        // renderer writes them to localStorage and reloads — MusicKit JS
        // reads `music.ampwebplay.*` on init, so the next boot starts
        // already-authorized.
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('applemusic:recv-cookies', harvested);
        }

        cleanup();
        resolve({ success: true });
      } catch (error) {
        console.error('[AppleMusic Auth] Harvest failed:', error);
        cleanup();
        resolve({ success: false, error: error.message });
      }
    };

    ipcMain.on('applemusic:auth-window-ready', handleAuthWindowReady);
    ipcMain.on('applemusic:auth-completed', handleAuthCompleted);
    ipcMain.on('applemusic:auth-debug', handleAuthDebug);

    // Cookie-polling fallback (parachord#834).
    //
    // The preload-side detection depends on MusicKit JS being present on
    // beta.music.apple.com, on the `MusicKit.Events.authorizationStatusDidChange`
    // constant existing under the expected name, AND on `instance.isAuthorized`
    // being readable in our preload's context. Any of those can fail
    // silently — moop250's Arch Linux trace was the first hint, the
    // post-auth navigation hypothesis was the second. Rather than rely on a
    // single detection path, also poll the auth window's cookie jar every
    // 2s. The moment `media-user-token` appears, treat as auth-completed
    // regardless of whether the preload event fired. This is more robust
    // than the MusicKit-JS event because the cookie IS the actual auth
    // carrier — Apple sets it BECAUSE the handshake succeeded, so its
    // presence is direct evidence.
    //
    // Cheap: one cookies.get() every 2s while the auth window is open.
    // Self-terminates on resolve (cleanup() calls clearInterval) or on
    // window close. Both handlers gate on `windowState.resolved` so the
    // preload event and the poll racing each other can't double-fire.
    cookiePoll = setInterval(async () => {
      if (!appleAuthWindow || appleAuthWindow.isDestroyed() || windowState.resolved) {
        clearInterval(cookiePoll);
        return;
      }
      try {
        const cookies = await appleAuthWindow.webContents.session.cookies.get({ name: 'media-user-token' });
        if (cookies.length > 0) {
          console.log('[AppleMusic Auth][poll] media-user-token cookie detected — treating as auth-completed');
          clearInterval(cookiePoll);
          // Synthesize a minimal event so handleAuthCompleted's sender
          // check passes. We're calling it directly (in-process), not via
          // IPC, so no listener-registration concerns.
          handleAuthCompleted({ sender: appleAuthWindow.webContents });
        }
      } catch (_e) {
        // Swallow — next tick will retry.
      }
    }, 2000);

    // User closed the window before completing auth — resolve as cancel.
    appleAuthWindow.on('closed', () => {
      if (!windowState.resolved) {
        windowState.resolved = true;
        if (cookiePoll) clearInterval(cookiePoll);
        ipcMain.removeListener('applemusic:auth-completed', handleAuthCompleted);
        ipcMain.removeListener('applemusic:auth-window-ready', handleAuthWindowReady);
        ipcMain.removeListener('applemusic:auth-debug', handleAuthDebug);
        appleAuthWindow = null;
        resolve({ success: false, cancelled: true });
      }
    });

    appleAuthWindow.loadURL('https://beta.music.apple.com/').catch((err) => {
      console.error('[AppleMusic Auth] Failed to load beta.music.apple.com:', err);
      cleanup();
      resolve({ success: false, error: 'Failed to open Apple Music sign-in page' });
    });
  });
});

// Check if MusicKit helper is available (macOS only)
ipcMain.handle('musickit:available', async () => {
  const bridge = getMusicKitBridge();
  return bridge.isAvailable();
});

// Start the MusicKit helper
ipcMain.handle('musickit:start', async () => {
  const bridge = getMusicKitBridge();
  try {
    const started = await bridge.start();
    return { success: started };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Check authorization status (uses cache by default, faster for repeated calls)
ipcMain.handle('musickit:check-auth', async (event, forceRefresh = false) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.getAuthStatus(forceRefresh);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get cached auth status synchronously (for quick checks)
ipcMain.handle('musickit:get-cached-auth', async () => {
  const bridge = getMusicKitBridge();
  const cached = bridge.getCachedAuthStatus();
  if (cached) {
    return { success: true, cached: true, ...cached };
  }
  return { success: false, cached: false, authorized: false };
});

// Request authorization
ipcMain.handle('musickit:authorize', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.authorize();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Clear native MusicKit auth state (invalidate cache, stop helper)
ipcMain.handle('musickit:unauthorize', async () => {
  const bridge = getMusicKitBridge();
  try {
    bridge.unauthorize();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('musickit:fetch-user-token', async () => {
  const bridge = getMusicKitBridge();
  try {
    // Await .p8 token generation to avoid race with renderer startup
    if (!generatedMusicKitToken) {
      await musicKitTokenReady;
    }
    const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
    if (!developerToken) {
      return { success: false, error: 'No developer token available' };
    }
    const result = await bridge.fetchUserToken(developerToken);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Search for songs
ipcMain.handle('musickit:search', async (event, query, limit = 25) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.search(query, limit);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resolve a track by artist/title
ipcMain.handle('musickit:resolve', async (event, artist, title, album = null) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.resolve(artist, title, album);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Play a song by Apple Music ID
ipcMain.handle('musickit:play', async (event, songId) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.play(songId);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Pause playback
ipcMain.handle('musickit:pause', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.pause();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Resume playback
ipcMain.handle('musickit:resume', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.resume();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Stop playback
ipcMain.handle('musickit:stop', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.stop_playback();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Skip to next
ipcMain.handle('musickit:skip-next', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.skipToNext();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Skip to previous
ipcMain.handle('musickit:skip-previous', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.skipToPrevious();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Seek to position
ipcMain.handle('musickit:seek', async (event, position) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.seek(position);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get playback state
ipcMain.handle('musickit:get-playback-state', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.getPlaybackState();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Get now playing
ipcMain.handle('musickit:get-now-playing', async () => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.getNowPlaying();
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Add to queue
ipcMain.handle('musickit:add-to-queue', async (event, songId) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.addToQueue(songId);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Set volume
ipcMain.handle('musickit:set-volume', async (event, volume) => {
  const bridge = getMusicKitBridge();
  try {
    const result = await bridge.setVolume(volume);
    return { success: true, ...result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Ollama process management
let ollamaProcess = null;

ipcMain.handle('ollama:start', async () => {
  // Check if already running
  if (ollamaProcess && !ollamaProcess.killed) {
    return { success: true, message: 'Ollama is already running' };
  }

  try {
    // First check if ollama is available
    const { spawn, execSync } = require('child_process');

    // Try to find ollama executable
    let ollamaPath = 'ollama';
    try {
      if (process.platform === 'win32') {
        execSync('where ollama', { stdio: 'ignore' });
      } else {
        execSync('which ollama', { stdio: 'ignore' });
      }
    } catch (e) {
      return {
        success: false,
        error: 'Ollama is not installed. Please install it from https://ollama.ai'
      };
    }

    // Try to connect first - maybe it's already running
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        return { success: true, message: 'Ollama is already running' };
      }
    } catch (e) {
      // Not running, proceed to start it
    }

    // Start ollama serve in background
    ollamaProcess = spawn(ollamaPath, ['serve'], {
      detached: true,
      stdio: 'ignore',
      shell: process.platform === 'win32'
    });

    ollamaProcess.unref();

    // Wait a bit for it to start
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Verify it started
    try {
      const response = await fetch('http://localhost:11434/api/tags', {
        signal: AbortSignal.timeout(3000)
      });
      if (response.ok) {
        return { success: true, message: 'Ollama started successfully' };
      }
    } catch (e) {
      return {
        success: false,
        error: 'Ollama started but is not responding. Please try again.'
      };
    }

    return { success: true, message: 'Ollama started' };
  } catch (error) {
    return { success: false, error: error.message || 'Failed to start Ollama' };
  }
});

ipcMain.handle('ollama:check', async () => {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      signal: AbortSignal.timeout(2000)
    });
    if (response.ok) {
      const data = await response.json();
      return {
        running: true,
        models: (data.models || []).map(m => m.name)
      };
    }
    return { running: false };
  } catch (e) {
    return { running: false };
  }
});

// Stop MusicKit helper and system volume monitor on app quit
app.on('will-quit', () => {
  systemVolumeMonitor.stop();
  const bridge = getMusicKitBridge();
  bridge.stop();

  // Clean up Ollama process if we started it
  if (ollamaProcess && !ollamaProcess.killed) {
    try {
      ollamaProcess.kill();
    } catch (e) {
      // Ignore errors during cleanup
    }
  }
});