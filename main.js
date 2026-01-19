// Load environment variables from .env file
require('dotenv').config();

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

const { app, BrowserWindow, ipcMain, globalShortcut, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const express = require('express');
const WebSocket = require('ws');

const store = new Store();
let mainWindow;
let authServer;
let wss; // WebSocket server for browser extension
let extensionSocket = null; // Current connected extension

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
        console.log('Extension message:', message.type, message.event || message.action || '');

        // Forward all messages to renderer
        mainWindow?.webContents.send('extension-message', message);
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

app.whenReady().then(() => {
  console.log('=== Electron App Starting ===');

  createWindow();
  startAuthServer();
  startExtensionServer();

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

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (authServer) {
    authServer.close();
  }
  if (wss) {
    wss.close();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
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

  playbackWindow = new BrowserWindow({
    width: options.width || 400,
    height: options.height || 200,
    minWidth: 300,
    minHeight: 150,
    frame: true,
    titleBarStyle: 'default',
    title: options.title || 'Parachord Player',
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
              if (audio) {
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
        if (mainWindow && !mainWindow.isDestroyed()) {
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
    if (mainWindow && !mainWindow.isDestroyed()) {
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

// Proxy fetch handler - bypasses CORS for resolvers that need to fetch external content
ipcMain.handle('proxy-fetch', async (event, url, options = {}) => {
  console.log('=== Proxy Fetch ===');
  console.log('URL:', url);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      headers: options.headers || {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    console.log('Proxy fetch response status:', response.status);

    if (!response.ok) {
      console.log('Proxy fetch failed with status:', response.status);
      return { success: false, status: response.status, error: `HTTP ${response.status}` };
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
      } else {
        menuLabel = 'Add All to Queue (click album first)';
        enabled = false;
      }
      break;
    default:
      menuLabel = 'Add to Queue';
  }

  const menu = Menu.buildFromTemplate([
    {
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
    }
  ]);

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