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

const { app, BrowserWindow, ipcMain, globalShortcut, shell, protocol, Menu } = require('electron');
const path = require('path');

// Preserve the userData path before changing app.name, since Electron
// derives the userData directory from app.name. Without this, changing
// the name would move the data directory and lose all user settings.
app.setPath('userData', path.join(app.getPath('appData'), 'parachord-desktop'));
app.name = 'Parachord';

// electron-updater is optional - may not be available in development
let autoUpdater = null;
try {
  autoUpdater = require('electron-updater').autoUpdater;
} catch (err) {
  console.log('Auto-updater not available:', err.message);
}
const fs = require('fs');
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
let wss; // WebSocket server for browser extension
let extensionSocket = null; // Current connected extension
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

function createWindow() {
  console.log('Creating main window...');
  console.log('Preload path:', path.join(__dirname, 'preload.js'));
  
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    titleBarStyle: 'hidden',
    // On Windows, titleBarOverlay provides native window controls and a draggable
    // title bar area without needing -webkit-app-region: drag (which blocks all
    // mouse events including right-click context menus on Windows).
    ...(process.platform === 'win32' ? {
      titleBarOverlay: {
        color: '#f9fafb',
        symbolColor: '#374151',
        height: 32
      }
    } : {}),
    frame: true,
    backgroundColor: '#f3f4f6',
    icon: path.join(__dirname, 'assets/icons/icon512.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: false  // Disabled for security — use BrowserView or iframes instead
    },
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();

    // Send any pending protocol URL that was received before window was ready
    if (global.pendingProtocolUrl) {
      console.log('[Protocol] Sending pending URL:', global.pendingProtocolUrl);
      safeSendToRenderer('protocol-url', global.pendingProtocolUrl);
      global.pendingProtocolUrl = null;
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

// WebSocket server for browser extension communication
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
    console.log(`Extension WebSocket server running on ws://127.0.0.1:${EXTENSION_PORT}`);
  });

  wss = new WebSocket.Server({ server: httpServer });

  wss.on('connection', (ws) => {
    // Track connection type - will be set on first message
    let connectionType = null; // 'extension' or 'embed'

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());

        // Detect connection type from first message
        if (!connectionType) {
          if (message.type === 'embed') {
            connectionType = 'embed';
            embedSockets.add(ws);
            console.log('Embed player connected');
          } else {
            connectionType = 'extension';
            extensionSocket = ws;
            console.log('Browser extension connected');
            safeSendToRenderer('extension-connected');
          }
        }

        // Handle embed player messages
        if (message.type === 'embed') {
          handleEmbedMessage(ws, message);
          return;
        }

        // Handle extension messages (existing behavior)
        console.log('Extension message:', message.type, message.event || message.action || message.url || '');
        safeSendToRenderer('extension-message', message);
        console.log('Forwarded to renderer');
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    ws.on('close', () => {
      if (connectionType === 'embed') {
        embedSockets.delete(ws);
        console.log('Embed player disconnected');
      } else if (connectionType === 'extension') {
        console.log('Browser extension disconnected');
        extensionSocket = null;
        safeSendToRenderer('extension-disconnected');
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
    });
  });

  wss.on('error', (error) => {
    console.error('Extension server error:', error);
  });
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
  startAuthServer();
  startExtensionServer();
  startMcpServer(mainWindow);
  systemVolumeMonitor.start();

  // Set up application menu
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
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
      // Only forward to renderer if the user initiated the check
      if (userInitiatedUpdateCheck) {
        userInitiatedUpdateCheck = false;
        safeSendToRenderer('updater-status', {
          status: 'error',
          error: 'Could not check for updates. Please try again later.'
        });
      }
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

// IPC handlers for storage — restricted to a whitelist of safe keys
const ALLOWED_STORE_KEYS = new Set([
  'active_resolvers', 'ai_chat_histories', 'ai_include_history',
  'applemusic_authorized', 'applemusic_developer_token', 'applemusic_user_token',
  'auto_launch_spotify', 'autoPinnedFriendIds',
  'cache_album_art', 'cache_album_release_ids', 'cache_artist_data',
  'cache_artist_images', 'cache_charts', 'cache_playlist_covers', 'cache_track_sources',
  'discovery_seen_charts', 'discovery_seen_criticsPicks', 'discovery_seen_recommendations',
  'friends', 'last_active_view', 'local_playlists', 'media-key-handling',
  'meta_service_configs', 'pinnedFriendIds', 'playlists_view_mode',
  'recommendation_blocklist', 'remember_queue', 'resolver_blocklist',
  'resolver_order', 'resolver_sync_settings', 'resolver_volume_offsets',
  'saved_playback_context', 'saved_queue', 'saved_shuffle_state',
  'scrobble-failed-queue', 'scrobbler-config-lastfm', 'scrobbler-config-librefm',
  'scrobbler-config-listenbrainz', 'scrobbling-enabled', 'search_history',
  'selected_chat_provider', 'show_discovery_badges',
  'skip_external_prompt', 'skip_unsaved_friend_warning',
  'suppressed_sync_playlists',
  'tutorial_completed', 'uninstalled_resolvers',
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
    'user-library-read',
    'user-follow-read',
    'playlist-read-private',
    'playlist-read-collaborative'
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

  console.log('Token exists:', !!token);
  console.log('Expiry:', expiry);
  console.log('Refresh token exists:', !!refreshToken);
  console.log('Current time:', Date.now());
  console.log('Is expired:', expiry && Date.now() >= expiry);

  // If token is valid and not a forced refresh, return it
  if (!force && token && expiry && Date.now() < expiry) {
    console.log('✓ Returning valid token');
    return { token, expiresAt: expiry };
  }

  // Get credentials with fallback chain: user-stored > env > bundled
  const { clientId, source } = getSpotifyCredentials();

  // If token is expired but we have a refresh token, try to refresh
  if (refreshToken) {
    console.log('🔄 Token expired, attempting automatic refresh using', source, 'credentials...');

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken,
          client_id: clientId
        })
      });

      if (!response.ok) {
        console.error('❌ Token refresh failed:', response.status, response.statusText);
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('✅ Token refreshed successfully');

      // Calculate expiry time (tokens typically last 1 hour)
      const expiresIn = data.expires_in || 3600; // Default to 1 hour
      const newExpiry = Date.now() + (expiresIn * 1000);

      // Save new token
      store.set('spotify_token', data.access_token);
      store.set('spotify_token_expiry', newExpiry);

      // Update refresh token if a new one was provided
      if (data.refresh_token) {
        store.set('spotify_refresh_token', data.refresh_token);
      }

      console.log('New token expiry:', new Date(newExpiry).toISOString());

      return { token: data.access_token, expiresAt: newExpiry };
    } catch (error) {
      console.error('Failed to refresh token:', error);
      // Fall through to return null
    }
  }

  console.log('✗ No valid token found and refresh failed or not available');
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
        // Try to get error details from response body
        let errorDetails = '';
        try {
          const errorBody = await response.json();
          errorDetails = JSON.stringify(errorBody);
          console.error('❌ SoundCloud token refresh failed:', response.status, response.statusText);
          console.error('   Error details:', errorDetails);
        } catch {
          console.error('❌ SoundCloud token refresh failed:', response.status, response.statusText);
        }

        // On 401, the refresh token is invalid/expired - clear tokens so user can re-auth
        if (response.status === 401) {
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
  store.delete('spotify_token');
  store.delete('spotify_refresh_token');
  store.delete('spotify_token_expiry');
  console.log('Spotify tokens cleared');
  return { success: true };
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
      await fs.mkdir(dir, { recursive: true });
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
  if (data.type === 'track' && data.track?.filePath) {
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Edit ID3 Tags',
      click: () => {
        safeSendToRenderer('track-context-menu-action', {
          action: 'edit-id3-tags',
          track: data.track
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

  // Add Smart Link options for tracks, releases, playlists, and collection albums
  if (data.type === 'track' || data.type === 'release' || data.type === 'playlist' || data.type === 'collection-album') {
    menuItems.push({ type: 'separator' });

    if (data.type === 'track') {
      // Single track smart link
      menuItems.push({
        label: 'Publish Smart Link',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'publish-smart-link',
            track: data.track
          });
        }
      });

      menuItems.push({
        label: 'Copy Embed Code',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'copy-embed-code',
            track: data.track
          });
        }
      });
    } else {
      // Album/playlist smart link with tracklist
      const isPlaylist = data.type === 'playlist';
      const collectionArtist = data.album?.artist || data.artist || data.tracks?.[0]?.artist || null;
      const collectionArt = data.album?.art || data.albumArt || data.tracks?.[0]?.albumArt || null;
      const collectionData = {
        title: data.name || data.title || data.album?.title,
        artist: collectionArtist,
        creator: data.creator || null,
        albumArt: collectionArt,
        type: isPlaylist ? 'playlist' : 'album',
        tracks: (data.tracks || []).map((t, i) => ({
          title: t.title || 'Unknown',
          artist: t.artist || collectionArtist || null,
          duration: t.duration || (t.length ? Math.round(t.length / 1000) : null),
          trackNumber: t.trackNumber || t.position || (i + 1)
        }))
      };

      menuItems.push({
        label: 'Publish Smart Link',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'publish-collection-smart-link',
            collection: collectionData
          });
        }
      });

      menuItems.push({
        label: 'Copy Embed Code',
        click: () => {
          safeSendToRenderer('track-context-menu-action', {
            action: 'copy-collection-embed-code',
            collection: collectionData
          });
        }
      });
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

ipcMain.handle('playlists-delete-from-source', async (event, providerId, externalId) => {
  console.log(`=== Delete Playlist from Source: ${providerId}/${externalId} ===`);
  try {
    const providers = {
      spotify: require('./sync-providers/spotify'),
      applemusic: require('./sync-providers/applemusic')
    };

    const provider = providers[providerId];
    if (!provider || !provider.deletePlaylist) {
      return { success: false, error: `Provider ${providerId} does not support playlist deletion` };
    }

    // Get auth token for the provider
    let token;
    if (providerId === 'spotify') {
      token = store.get('spotify_access_token');
    } else if (providerId === 'applemusic') {
      if (!generatedMusicKitToken) {
        await musicKitTokenReady;
      }
      const developerToken = generatedMusicKitToken || process.env.MUSICKIT_DEVELOPER_TOKEN || store.get('applemusic_developer_token');
      const userToken = store.get('applemusic_user_token');
      if (developerToken && userToken) {
        token = JSON.stringify({ developerToken, userToken });
      }
    }

    if (!token) {
      return { success: false, error: 'Not authenticated with provider' };
    }

    await provider.deletePlaylist(externalId, token);
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

// Browser extension IPC handlers
ipcMain.handle('extension-send-command', (event, command) => {
  console.log('=== Send Extension Command ===');
  console.log('  Command:', command.type, command.action || '');

  if (extensionSocket && extensionSocket.readyState === WebSocket.OPEN) {
    extensionSocket.send(JSON.stringify(command));
    return { success: true };
  }

  console.log('  ❌ No extension connected');
  return { success: false, error: 'No extension connected' };
});

ipcMain.handle('extension-get-status', () => {
  return {
    connected: extensionSocket !== null && extensionSocket.readyState === WebSocket.OPEN
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

// MCP server info - expose path for Claude Desktop config UI
ipcMain.handle('mcp-get-info', () => {
  return {
    stdioPath: path.join(__dirname, 'mcp-stdio.js'),
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
    await fsPromises.writeFile(collectionPath, JSON.stringify(collection, null, 2), 'utf8');
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

  // Get token
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
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  // Mark sync as active
  activeSyncs.set(providerId, { startedAt: Date.now(), cancelled: false });

  const sendProgress = (progress) => {
    if (!activeSyncs.get(providerId)?.cancelled) {
      event.sender.send('sync:progress', { providerId, ...progress });
    }
  };

  const fsPromises = require('fs').promises;

  try {
    const results = { tracks: null, albums: null, artists: null, playlists: null };
    const settings = options.settings || {};

    // Load current collection
    const collectionPath = path.join(app.getPath('userData'), 'collection.json');
    let collection;
    try {
      const content = await fsPromises.readFile(collectionPath, 'utf8');
      collection = JSON.parse(content);
      console.log(`[Sync] Loaded collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    } catch {
      collection = { tracks: [], albums: [], artists: [] };
      console.log('[Sync] No existing collection, starting fresh');
    }

    // Sync tracks
    if (settings.syncTracks !== false && provider.capabilities.tracks) {
      sendProgress({ phase: 'fetching', type: 'tracks', message: 'Fetching liked songs...' });
      console.log(`[Sync] Syncing tracks. Input: ${collection.tracks?.length || 0} tracks`);
      const trackResult = await SyncEngine.syncDataType(
        provider,
        token,
        'tracks',
        collection.tracks || [],
        (p) => sendProgress({ phase: 'fetching', type: 'tracks', ...p })
      );
      console.log(`[Sync] Track sync complete. Output: ${trackResult.data.length} tracks. Stats:`, trackResult.stats);
      collection.tracks = trackResult.data;
      results.tracks = trackResult.stats;
    } else {
      console.log(`[Sync] Skipping tracks sync. syncTracks=${settings.syncTracks}, capabilities.tracks=${provider.capabilities.tracks}`);
    }

    // Sync albums
    if (settings.syncAlbums !== false && provider.capabilities.albums) {
      sendProgress({ phase: 'fetching', type: 'albums', message: 'Fetching saved albums...' });
      console.log(`[Sync] Syncing albums. Input: ${collection.albums?.length || 0} albums`);
      const albumResult = await SyncEngine.syncDataType(
        provider,
        token,
        'albums',
        collection.albums || [],
        (p) => sendProgress({ phase: 'fetching', type: 'albums', ...p })
      );
      console.log(`[Sync] Album sync complete. Output: ${albumResult.data.length} albums. Stats:`, albumResult.stats);
      collection.albums = albumResult.data;
      results.albums = albumResult.stats;
    } else {
      console.log(`[Sync] Skipping albums sync. syncAlbums=${settings.syncAlbums}, capabilities.albums=${provider.capabilities.albums}`);
    }

    // Sync artists
    if (settings.syncArtists !== false && provider.capabilities.artists) {
      sendProgress({ phase: 'fetching', type: 'artists', message: 'Fetching followed artists...' });
      console.log(`[Sync] Syncing artists. Input: ${collection.artists?.length || 0} artists`);
      const artistResult = await SyncEngine.syncDataType(
        provider,
        token,
        'artists',
        collection.artists || [],
        (p) => sendProgress({ phase: 'fetching', type: 'artists', ...p })
      );
      console.log(`[Sync] Artist sync complete. Output: ${artistResult.data.length} artists. Stats:`, artistResult.stats);
      collection.artists = artistResult.data;
      results.artists = artistResult.stats;
    } else {
      console.log(`[Sync] Skipping artists sync. syncArtists=${settings.syncArtists}, capabilities.artists=${provider.capabilities.artists}`);
    }

    // Sync playlists
    if (settings.syncPlaylists && settings.selectedPlaylistIds?.length > 0 && provider.capabilities.playlists) {
      // Load current playlists
      const currentPlaylists = store.get('local_playlists') || [];

      // Fetch playlist metadata to check for updates
      sendProgress({ phase: 'playlists', current: 0, total: settings.selectedPlaylistIds.length, providerId });
      const { playlists: remotePlaylists } = await provider.fetchPlaylists(token);
      const suppressedPlaylists = store.get('suppressed_sync_playlists') || {};
      const suppressedForProvider = suppressedPlaylists[providerId] || [];
      const selectedRemote = remotePlaylists.filter(p =>
        settings.selectedPlaylistIds.includes(p.externalId) &&
        !suppressedForProvider.includes(p.externalId)
      );

      let playlistsAdded = 0;
      let playlistsUpdated = 0;

      for (let i = 0; i < selectedRemote.length; i++) {
        const remotePlaylist = selectedRemote[i];
        sendProgress({ phase: 'playlists', current: i + 1, total: selectedRemote.length, providerId });

        // Check for existing playlist by syncedFrom.externalId OR by matching ID pattern
        // This handles both new sync structure and older playlists that may have been synced before
        const localPlaylist = currentPlaylists.find(p =>
          p.syncedFrom?.externalId === remotePlaylist.externalId ||
          p.id === remotePlaylist.id ||
          p.id === `${providerId}-${remotePlaylist.externalId}`
        );

        if (!localPlaylist) {
          // New playlist - fetch tracks and add
          console.log(`[Sync] Importing playlist: ${remotePlaylist.name}`);
          const tracks = await provider.fetchPlaylistTracks(remotePlaylist.externalId, token);

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
              ownerId: remotePlaylist.ownerId
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
            const hasTrackUpdates = localPlaylist.syncedFrom?.snapshotId !== remotePlaylist.snapshotId;
            if (hasTrackUpdates) {
              console.log(`[Sync] Playlist has updates: ${remotePlaylist.name}`);
            }

            // Recalculate createdAt from existing tracks if available
            const existingTracks = currentPlaylists[idx].tracks || [];
            let recalculatedCreatedAt = currentPlaylists[idx].createdAt;
            if (existingTracks.length > 0) {
              const trackDates = existingTracks.map(t => t.addedAt || t.syncSources?.spotify?.addedAt).filter(Boolean);
              if (trackDates.length > 0) {
                recalculatedCreatedAt = Math.min(...trackDates);
              }
            }

            // Always update/backfill metadata fields (creator, source, syncedFrom, createdAt)
            currentPlaylists[idx] = {
              ...currentPlaylists[idx],
              // Backfill creator if not set
              creator: currentPlaylists[idx].creator || remotePlaylist.ownerName || null,
              // Backfill source if not set
              source: currentPlaylists[idx].source || (remotePlaylist.isOwnedByUser ? `${providerId}-sync` : `${providerId}-import`),
              // Update createdAt from track data
              createdAt: recalculatedCreatedAt,
              // Update/backfill syncedFrom structure
              syncedFrom: {
                ...currentPlaylists[idx].syncedFrom,
                resolver: providerId,
                externalId: remotePlaylist.externalId,
                snapshotId: hasTrackUpdates ? currentPlaylists[idx].syncedFrom?.snapshotId : remotePlaylist.snapshotId,
                ownerId: remotePlaylist.ownerId
              },
              hasUpdates: hasTrackUpdates ? true : currentPlaylists[idx].hasUpdates,
              syncSources: {
                ...currentPlaylists[idx].syncSources,
                [providerId]: { ...currentPlaylists[idx].syncSources?.[providerId], syncedAt: Date.now() }
              }
            };

            if (hasTrackUpdates) {
              playlistsUpdated++;
            }
          }
        }
      }

      // Save playlists
      store.set('local_playlists', currentPlaylists);
      results.playlists = { added: playlistsAdded, updated: playlistsUpdated };
      console.log(`[Sync] Playlists synced: ${playlistsAdded} added, ${playlistsUpdated} with updates`);
    }

    // Save collection
    sendProgress({ phase: 'saving', message: 'Saving collection...' });
    console.log(`[Sync] Saving collection: ${collection.tracks?.length || 0} tracks, ${collection.albums?.length || 0} albums, ${collection.artists?.length || 0} artists`);
    await fsPromises.writeFile(collectionPath, JSON.stringify(collection, null, 2), 'utf8');

    // Update sync settings with last sync time
    const syncSettings = store.get('resolver_sync_settings') || {};
    syncSettings[providerId] = {
      ...syncSettings[providerId],
      lastSyncAt: Date.now()
    };
    store.set('resolver_sync_settings', syncSettings);

    sendProgress({ phase: 'complete', message: 'Sync complete!' });

    return { success: true, results, collection };
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
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const { playlists, folders } = await provider.fetchPlaylists(token);
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
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    const tracks = await provider.fetchPlaylistTracks(playlistExternalId, token);
    // Also fetch the current snapshot ID
    const snapshotId = await provider.getPlaylistSnapshot?.(playlistExternalId, token);
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
    token = store.get('spotify_token');
  }

  if (!token) {
    return { success: false, error: 'Not authenticated' };
  }

  try {
    // Check if user owns the playlist (can only push to owned playlists)
    if (provider.checkPlaylistOwnership) {
      const isOwner = await provider.checkPlaylistOwnership(playlistExternalId, token);
      if (!isOwner) {
        return { success: false, error: 'You can only push changes to playlists you own' };
      }
    }

    // Push metadata changes (name, description) if provided
    if (metadata && provider.updatePlaylistDetails) {
      await provider.updatePlaylistDetails(playlistExternalId, metadata, token);
    }

    // Push track changes
    const result = await provider.updatePlaylistTracks(playlistExternalId, tracks, token);
    return { success: true, snapshotId: result.snapshotId };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Push track changes to sync provider (add to Liked Songs)
ipcMain.handle('sync:save-tracks', async (event, providerId, trackIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.tracks) {
    return { success: false, error: 'Provider does not support track syncing' };
  }

  if (!provider.saveTracks) {
    return { success: false, error: 'Provider does not support saving tracks' };
  }

  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

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

// Remove tracks from sync provider library
ipcMain.handle('sync:remove-tracks', async (event, providerId, trackIds) => {
  const provider = SyncEngine.getProvider(providerId);
  if (!provider || !provider.capabilities.tracks) {
    return { success: false, error: 'Provider does not support track syncing' };
  }

  if (!provider.removeTracks) {
    return { success: false, error: 'Provider does not support removing tracks' };
  }

  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

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

  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

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

  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

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

  let token;
  if (providerId === 'spotify') {
    token = store.get('spotify_token');
  }

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