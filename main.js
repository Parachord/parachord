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

// Debug: Log environment variables on startup
console.log('=== Environment Variables Check ===');
console.log('Working directory:', __dirname);
console.log('SPOTIFY_CLIENT_ID:', process.env.SPOTIFY_CLIENT_ID ? '✅ Loaded' : '❌ MISSING');
console.log('SPOTIFY_CLIENT_SECRET:', process.env.SPOTIFY_CLIENT_SECRET ? '✅ Loaded' : '❌ MISSING');
console.log('SPOTIFY_REDIRECT_URI:', process.env.SPOTIFY_REDIRECT_URI || 'Using default');
if (!process.env.SPOTIFY_CLIENT_ID) {
  console.error('');
  console.error('⚠️  WARNING: .env file not found or SPOTIFY_CLIENT_ID not set!');
  console.error('Expected .env location:', require('path').join(__dirname, '.env'));
  console.error('');
}
console.log('====================================');
console.log('');

const { app, BrowserWindow, ipcMain, globalShortcut, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('electron-store');
const express = require('express');
const WebSocket = require('ws');

const LocalFilesService = require('./local-files');

const store = new Store();
let mainWindow;
let authServer;
let wss; // WebSocket server for browser extension
let extensionSocket = null; // Current connected extension
let localFilesService = null;
let localFilesServiceReady = null; // Promise that resolves when service is ready

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
    frame: true,
    backgroundColor: '#0f172a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webviewTag: true  // Enable webview support for embedded players
    },
    show: false
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    console.log('Window ready to show');
    mainWindow.show();
  });

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('focus', () => {
    localFilesService?.onAppForeground();
  });

  mainWindow.on('blur', () => {
    localFilesService?.onAppBackground();
  });
}

// Spotify OAuth Server
function startAuthServer() {
  if (authServer) return;

  const expressApp = express();
  
  expressApp.get('/callback', (req, res) => {
    const code = req.query.code;
    const error = req.query.error;

    if (error) {
      res.send(`
        <html>
          <body style="background: #1e1b4b; color: white; font-family: system-ui; text-align: center; padding: 50px;">
            <h1>❌ Authentication Failed</h1>
            <p>${error}</p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);
      mainWindow?.webContents.send('spotify-auth-error', error);
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

  authServer = expressApp.listen(8888, '127.0.0.1', () => {
    console.log('Auth server running on http://127.0.0.1:8888');
  });
}

// WebSocket server for browser extension communication
function startExtensionServer() {
  if (wss) return;

  const EXTENSION_PORT = 9876;

  wss = new WebSocket.Server({ port: EXTENSION_PORT, host: '127.0.0.1' });
  console.log(`Extension WebSocket server running on ws://127.0.0.1:${EXTENSION_PORT}`);

  wss.on('connection', (ws) => {
    console.log('Browser extension connected');
    extensionSocket = ws;
    mainWindow?.webContents.send('extension-connected');

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        console.log('Extension message:', message.type, message.event || message.action || message.url || '');

        // Forward all messages to renderer
        mainWindow?.webContents.send('extension-message', message);
        console.log('Forwarded to renderer');
      } catch (error) {
        console.error('Failed to parse extension message:', error);
      }
    });

    ws.on('close', () => {
      console.log('Browser extension disconnected');
      extensionSocket = null;
      mainWindow?.webContents.send('extension-disconnected');
    });

    ws.on('error', (error) => {
      console.error('Extension WebSocket error:', error);
    });
  });

  wss.on('error', (error) => {
    console.error('Extension server error:', error);
  });
}

async function exchangeCodeForToken(code) {
  console.log('=== Exchange Code for Token ===');
  console.log('Code received:', code ? 'Yes' : 'No');
  
  // Get credentials from environment variables
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';

  // Validate credentials exist
  if (!clientId || !clientSecret) {
    console.error('❌ Missing Spotify credentials in .env file!');
    console.error('Please add SPOTIFY_CLIENT_ID and SPOTIFY_CLIENT_SECRET to your .env file');
    throw new Error('Missing Spotify credentials');
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
        client_secret: clientSecret,
      }),
    });

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

      mainWindow?.webContents.send('spotify-auth-success', {
        token: data.access_token,
        expiresIn: data.expires_in
      });
      console.log('Auth success event sent to renderer');
    } else {
      console.error('No access token in response:', data);
    }
  } catch (error) {
    console.error('Token exchange error:', error);
    mainWindow?.webContents.send('spotify-auth-error', error.message);
  }
}

// Register custom protocol scheme for local audio playback
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
  }
]);

app.whenReady().then(() => {
  console.log('=== Electron App Starting ===');

  // Register protocol handler for local audio files
  protocol.handle('local-audio', async (request) => {
    try {
      // URL format: local-audio:///path/to/file.mp3
      const filePath = decodeURIComponent(request.url.replace('local-audio://', ''));
      console.log('[LocalAudio] Requested file:', filePath);

      // Verify file exists and get stats
      const stats = await fs.promises.stat(filePath);
      if (!stats.isFile()) {
        console.error('[LocalAudio] Not a file:', filePath);
        return new Response('Not a file', { status: 404 });
      }

      // Get file extension for MIME type
      const ext = path.extname(filePath).toLowerCase();
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

          const fileHandle = await fs.promises.open(filePath, 'r');
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
      const buffer = await fs.promises.readFile(filePath);
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

  createWindow();
  startAuthServer();
  startExtensionServer();

  // Initialize Local Files service
  localFilesService = new LocalFilesService(app.getPath('userData'));
  localFilesServiceReady = localFilesService.init().then(() => {
    console.log('Local Files service ready');

    // Set up library change notifications
    localFilesService.setLibraryChangedCallback((changes) => {
      mainWindow?.webContents.send('localFiles:libraryChanged', changes);
    });

    return localFilesService;
  }).catch(err => {
    console.error('Failed to initialize Local Files service:', err);
    throw err;
  });

  // Register media key shortcuts
  globalShortcut.register('MediaPlayPause', () => {
    mainWindow?.webContents.send('media-key', 'playpause');
  });

  globalShortcut.register('MediaNextTrack', () => {
    mainWindow?.webContents.send('media-key', 'next');
  });

  globalShortcut.register('MediaPreviousTrack', () => {
    mainWindow?.webContents.send('media-key', 'previous');
  });

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

app.on('before-quit', async (event) => {
  // Pause Spotify before quitting - this is more reliable than beforeunload
  await pauseSpotifyPlayback();
});

app.on('window-all-closed', async () => {
  globalShortcut.unregisterAll();
  if (authServer) {
    authServer.close();
  }
  if (wss) {
    wss.close();
  }
  if (localFilesService) {
    localFilesService.shutdown();
  }
  // Also try to pause Spotify here as a backup
  await pauseSpotifyPlayback();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Crypto utilities for scrobbling (Last.fm requires MD5 signatures)
const crypto = require('crypto');

ipcMain.handle('crypto-md5', (event, input) => {
  return crypto.createHash('md5').update(input).digest('hex');
});

// Scrobbler config - expose Last.fm API credentials from environment
// This provides a dedicated API for scrobbler initialization, returning both key and secret together.
// The secret supports a fallback to LASTFM_SHARED_SECRET for compatibility with different env var naming.
ipcMain.handle('get-scrobbler-config', () => {
  return {
    lastfmApiKey: process.env.LASTFM_API_KEY,
    lastfmApiSecret: process.env.LASTFM_API_SECRET || process.env.LASTFM_SHARED_SECRET
  };
});

// IPC handlers for storage
ipcMain.handle('store-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('store-set', (event, key, value) => {
  store.set(key, value);
  return true;
});

ipcMain.handle('store-delete', (event, key) => {
  store.delete(key);
  return true;
});

// Config handler - expose select environment variables to renderer
// Only expose whitelisted keys for security
const ALLOWED_CONFIG_KEYS = ['LASTFM_API_KEY', 'LASTFM_API_SECRET', 'QOBUZ_APP_ID'];
ipcMain.handle('config-get', (event, key) => {
  if (ALLOWED_CONFIG_KEYS.includes(key)) {
    return process.env[key] || null;
  }
  console.warn(`⚠️ Attempted to access non-whitelisted config key: ${key}`);
  return null;
});

// Spotify OAuth handler
ipcMain.handle('spotify-auth', async () => {
  // Get credentials from environment variables
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const redirectUri = process.env.SPOTIFY_REDIRECT_URI || 'http://127.0.0.1:8888/callback';
  
  // Validate client ID exists
  if (!clientId) {
    console.error('❌ Missing SPOTIFY_CLIENT_ID in .env file!');
    return { success: false, error: 'Missing Spotify Client ID' };
  }
  
  const scopes = [
    'user-read-private',
    'user-read-email',
    'streaming',
    'user-read-playback-state',
    'user-modify-playback-state',
    'user-library-read'
  ].join(' ');

  const authUrl = `https://accounts.spotify.com/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&show_dialog=true`;

  // Open in system browser
  shell.openExternal(authUrl);
  
  return { success: true };
});

// Check if token exists and auto-refresh if expired
ipcMain.handle('spotify-check-token', async () => {
  console.log('=== Spotify Check Token Handler Called ===');
  const token = store.get('spotify_token');
  const expiry = store.get('spotify_token_expiry');
  const refreshToken = store.get('spotify_refresh_token');

  console.log('Token exists:', !!token);
  console.log('Expiry:', expiry);
  console.log('Refresh token exists:', !!refreshToken);
  console.log('Current time:', Date.now());
  console.log('Is expired:', expiry && Date.now() >= expiry);

  // If token is valid, return it
  if (token && expiry && Date.now() < expiry) {
    console.log('✓ Returning valid token');
    return { token, expiresAt: expiry };
  }

  // Get credentials from environment
  const clientId = process.env.SPOTIFY_CLIENT_ID;
  const clientSecret = process.env.SPOTIFY_CLIENT_SECRET;

  // If token is expired but we have a refresh token, try to refresh
  if (refreshToken && clientId && clientSecret) {
    console.log('🔄 Token expired, attempting automatic refresh...');

    try {
      const response = await fetch('https://accounts.spotify.com/api/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': 'Basic ' + Buffer.from(clientId + ':' + clientSecret).toString('base64')
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: refreshToken
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

// Debug handler to inspect store contents
ipcMain.handle('debug-store', () => {
  console.log('=== Debug Store Contents ===');
  const allData = store.store;
  console.log('All store data:', allData);
  return allData;
});

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

// Playback window for external content (Bandcamp, etc.) with autoplay enabled
let playbackWindow = null;

ipcMain.handle('open-playback-window', async (event, url, options = {}) => {
  console.log('=== Open Playback Window ===');
  console.log('URL:', url);

  // Close existing playback window if any
  if (playbackWindow && !playbackWindow.isDestroyed()) {
    playbackWindow.close();
  }

  // Calculate position for upper-right corner of screen
  const { screen } = require('electron');
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth } = primaryDisplay.workAreaSize;
  const windowWidth = options.width || 400;
  const windowHeight = options.height || 200;
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
    backgroundColor: '#1a1a2e',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      autoplayPolicy: 'no-user-gesture-required' // Enable autoplay!
    },
    parent: mainWindow,
    show: false
  });

  playbackWindow.loadURL(url);

  // When page finishes loading, inject script to auto-click play button and set up event listeners
  playbackWindow.webContents.on('did-finish-load', () => {
    console.log('Playback window loaded, injecting auto-play script...');

    // Wait for the embed to load, then click play and set up audio event listeners
    setTimeout(async () => {
      try {
        const result = await playbackWindow.webContents.executeJavaScript(`
          (function() {
            // Click the play button first
            const playBtn = document.querySelector('.embeddedplaybutton') ||
                           document.querySelector('.playbutton') ||
                           document.querySelector('.inline_player');
            if (playBtn) {
              playBtn.click();
            }

            // Wait a bit for audio to be created, then set up event listeners and force play
            setTimeout(() => {
              const audio = document.querySelector('audio');
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

                // Force play
                audio.play().then(() => {
                  console.log('Audio started playing!');
                }).catch(err => {
                  console.log('Audio play failed:', err.message);
                });
              }
            }, 500);

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

    // Listen for console messages from the playback window to catch playback events
    playbackWindow.webContents.on('console-message', (event, level, message) => {
      if (message.startsWith('__PLAYBACK_EVENT__:')) {
        const eventType = message.replace('__PLAYBACK_EVENT__:', '');
        console.log('Playback window event:', eventType);
        // Forward to main renderer
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          mainWindow.webContents.send('playback-window-event', eventType);
        }
      }
    });
  });

  playbackWindow.once('ready-to-show', () => {
    playbackWindow.show();
  });

  playbackWindow.on('closed', () => {
    playbackWindow = null;
    // Notify renderer that playback window was closed
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send('playback-window-closed');
    }
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
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        if (result === 'playing' || result === 'paused') {
          mainWindow.webContents.send('playback-window-event', result);
        }
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

  try {
    const fetchOptions = {
      method: options.method || 'GET',
      headers: options.headers || {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
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
      return { success: false, status: response.status, error: `HTTP ${response.status}`, text: errorText };
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

// Resolver loading handler
ipcMain.handle('resolvers-load-builtin', async () => {
  console.log('=== Load All Resolvers ===');
  const fs = require('fs').promises;
  const path = require('path');

  const resolvers = [];

  // Load all resolvers from resolvers directory
  const resolversDir = path.join(__dirname, 'resolvers');
  console.log('Loading resolvers from:', resolversDir);

  try {
    // Ensure directory exists
    await fs.mkdir(resolversDir, { recursive: true });

    const files = await fs.readdir(resolversDir);
    const axeFiles = files.filter(f => f.endsWith('.axe'));

    for (const filename of axeFiles) {
      const filepath = path.join(resolversDir, filename);
      try {
        console.log(`  Reading ${filename}...`);
        const content = await fs.readFile(filepath, 'utf8');
        const axe = JSON.parse(content);

        // Check for duplicates
        if (resolvers.find(r => r.manifest.id === axe.manifest.id)) {
          console.log(`  ⚠️  Skipping ${axe.manifest.name} (duplicate ID: ${axe.manifest.id})`);
          continue;
        }

        axe._filename = filename;
        resolvers.push(axe);
        console.log(`  ✅ Loaded ${axe.manifest.name}`);
      } catch (error) {
        console.error(`  ❌ Failed to load ${filename}:`, error.message);
      }
    }
  } catch (error) {
    console.error('  ❌ Failed to read resolvers directory:', error.message);
  }

  console.log(`✅ Loaded ${resolvers.length} resolver(s) total`);
  return resolvers;
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

// Install resolver
ipcMain.handle('resolvers-install', async (event, axeContent, filename) => {
  console.log('=== Install Resolver ===');
  console.log('  Installing:', filename);
  
  try {
    const fs = require('fs').promises;
    const path = require('path');
    
    // Validate content
    const axe = JSON.parse(axeContent);
    console.log(`  Resolver: ${axe.manifest.name} v${axe.manifest.version}`);
    
    // Create resolvers directory if it doesn't exist
    const resolversDir = path.join(__dirname, 'resolvers');
    await fs.mkdir(resolversDir, { recursive: true });

    // Save to resolvers directory
    const targetPath = path.join(resolversDir, filename);
    await fs.writeFile(targetPath, axeContent, 'utf8');
    
    console.log(`  ✅ Installed to: ${targetPath}`);
    return { success: true, resolver: axe };
  } catch (error) {
    console.error('  ❌ Installation failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Uninstall resolver
ipcMain.handle('resolvers-uninstall', async (event, resolverId) => {
  console.log('=== Uninstall Resolver ===');
  console.log('  Resolver ID:', resolverId);
  
  try {
    const fs = require('fs').promises;
    const path = require('path');
    
    const resolversDir = path.join(__dirname, 'resolvers');

    // Find the .axe file for this resolver
    const files = await fs.readdir(resolversDir);
    const axeFiles = files.filter(f => f.endsWith('.axe'));

    for (const filename of axeFiles) {
      const filepath = path.join(resolversDir, filename);
      const content = await fs.readFile(filepath, 'utf8');
      const axe = JSON.parse(content);

      if (axe.manifest.id === resolverId) {
        await fs.unlink(filepath);
        console.log(`  ✅ Uninstalled: ${filename}`);
        return { success: true, name: axe.manifest.name };
      }
    }

    return { success: false, error: 'Resolver not found' };
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
        mainWindow.webContents.send('resolver-context-menu-action', {
          action: 'uninstall',
          resolverId: resolverId
        });
      }
    }
  ]);

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
  if (data.type !== 'artist' && data.type !== 'friend') {
    menuItems.push({
      label: menuLabel,
      enabled: enabled,
      click: () => {
        // Send tracks back to renderer
        const tracks = data.type === 'track' ? [data.track] : data.tracks;
        mainWindow.webContents.send('track-context-menu-action', {
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
        mainWindow.webContents.send('track-context-menu-action', {
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
        mainWindow.webContents.send('track-context-menu-action', {
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
        mainWindow.webContents.send('track-context-menu-action', {
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
        mainWindow.webContents.send('track-context-menu-action', {
          action: 'edit-id3-tags',
          track: data.track
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
      menuItems.push({
        label: 'Add to Collection',
        click: () => {
          mainWindow.webContents.send('track-context-menu-action', {
            action: 'add-to-collection',
            type: 'track',
            track: data.track
          });
        }
      });
    } else if (data.type === 'release') {
      menuItems.push({
        label: 'Add Album to Collection',
        click: () => {
          mainWindow.webContents.send('track-context-menu-action', {
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
          mainWindow.webContents.send('track-context-menu-action', {
            action: 'add-to-collection',
            type: 'artist',
            artist: data.artist
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
        mainWindow.webContents.send('track-context-menu-action', {
          action: 'view-friend-history',
          friend: data.friend
        });
      }
    });

    if (data.isPinned) {
      menuItems.push({
        label: 'Unpin from Sidebar',
        click: () => {
          mainWindow.webContents.send('track-context-menu-action', {
            action: 'unpin-friend',
            friendId: data.friend.id
          });
        }
      });
    } else {
      menuItems.push({
        label: 'Pin to Sidebar',
        click: () => {
          mainWindow.webContents.send('track-context-menu-action', {
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
          mainWindow.webContents.send('track-context-menu-action', {
            action: 'save-friend-to-collection',
            friendId: data.friend.id
          });
        }
      });
    } else {
      menuItems.push({
        label: 'Remove from Collection',
        click: () => {
          mainWindow.webContents.send('track-context-menu-action', {
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
          mainWindow.webContents.send('track-context-menu-action', {
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
        mainWindow.webContents.send('track-context-menu-action', {
          action: 'add-to-queue',
          track: data.track
        });
      }
    });
    menuItems.push({
      label: 'Add to Playlist',
      click: () => {
        mainWindow.webContents.send('track-context-menu-action', {
          action: 'add-to-playlist',
          track: data.track
        });
      }
    });
    menuItems.push({
      label: 'Add to Collection',
      click: () => {
        mainWindow.webContents.send('track-context-menu-action', {
          action: 'add-track-to-collection',
          track: data.track
        });
      }
    });
    menuItems.push({ type: 'separator' });
    menuItems.push({
      label: 'Go to Artist',
      click: () => {
        mainWindow.webContents.send('track-context-menu-action', {
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

    console.log(`✅ Loaded ${manifest.resolvers.length} marketplace resolvers`);
    return { success: true, manifest };
  } catch (error) {
    console.error('Failed to load marketplace manifest:', error.message);
    return { success: false, error: error.message, manifest: { version: '1.0.0', resolvers: [] } };
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

    // Generate filename from resolver ID
    const filename = `${axe.manifest.id}.axe`;

    return { success: true, content, filename, resolver: axe };
  } catch (error) {
    console.error('  ❌ Download failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Playlist handlers
ipcMain.handle('playlists-load', async () => {
  console.log('=== Load Playlists ===');
  const fs = require('fs').promises;
  const path = require('path');
  
  const playlistsDir = path.join(__dirname, 'playlists');
  console.log('Loading playlists from:', playlistsDir);
  
  try {
    // Create directory if it doesn't exist
    await fs.mkdir(playlistsDir, { recursive: true });
    
    const files = await fs.readdir(playlistsDir);
    const xspfFiles = files.filter(f => f.endsWith('.xspf'));
    
    console.log(`Found ${xspfFiles.length} .xspf file(s)`);
    
    const playlists = [];
    
    for (const filename of xspfFiles) {
      const filepath = path.join(playlistsDir, filename);
      try {
        const content = await fs.readFile(filepath, 'utf8');
        const id = filename.replace('.xspf', '');
        
        playlists.push({
          id: id,
          filename: filename,
          xspf: content
        });
        
        console.log(`  ✅ Loaded: ${filename}`);
      } catch (error) {
        console.error(`  ❌ Failed to load ${filename}:`, error.message);
      }
    }
    
    console.log(`✅ Loaded ${playlists.length} playlist(s)`);
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

ipcMain.handle('playlists-save', async (event, filename, xspfContent) => {
  console.log('=== Save Playlist ===');
  console.log('  Filename:', filename);
  
  const fs = require('fs').promises;
  const path = require('path');
  
  try {
    const playlistsDir = path.join(__dirname, 'playlists');
    await fs.mkdir(playlistsDir, { recursive: true });
    
    const filepath = path.join(playlistsDir, filename);
    await fs.writeFile(filepath, xspfContent, 'utf8');
    
    console.log('  ✅ Saved to:', filepath);
    return { success: true, filepath };
  } catch (error) {
    console.error('  ❌ Save failed:', error.message);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('playlists-delete', async (event, playlistId) => {
  console.log('=== Delete Playlist ===');
  console.log('  Playlist ID:', playlistId);

  const fs = require('fs').promises;
  const path = require('path');

  try {
    const playlistsDir = path.join(__dirname, 'playlists');
    const files = await fs.readdir(playlistsDir);
    const xspfFiles = files.filter(f => f.endsWith('.xspf'));

    // Find the playlist file by ID
    for (const filename of xspfFiles) {
      const filepath = path.join(playlistsDir, filename);
      const content = await fs.readFile(filepath, 'utf8');

      // Extract the ID from the XSPF content or filename
      // ID is typically the filename without extension, or derived from content
      const filenameId = filename.replace('.xspf', '');

      if (filenameId === playlistId || content.includes(`<identifier>${playlistId}</identifier>`)) {
        await fs.unlink(filepath);
        console.log('  ✅ Deleted:', filepath);
        return { success: true, deletedFile: filename };
      }
    }

    console.log('  ❌ Playlist not found');
    return { success: false, error: 'Playlist not found' };
  } catch (error) {
    console.error('  ❌ Delete failed:', error.message);
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
      mainWindow?.webContents.send('localFiles:scanProgress', { current, total, file });
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
      mainWindow?.webContents.send('localFiles:scanProgress', { current, total, file });
    });
    return { success: true, result };
  } catch (error) {
    console.error('  Error:', error);
    return { success: false, error: error.message };
  }
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