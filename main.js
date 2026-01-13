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

const store = new Store();
let mainWindow;
let authServer;

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
      preload: path.join(__dirname, 'preload.js')
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

// Check if token exists
ipcMain.handle('spotify-check-token', () => {
  console.log('=== Spotify Check Token Handler Called ===');
  const token = store.get('spotify_token');
  const expiry = store.get('spotify_token_expiry');
  const refreshToken = store.get('spotify_refresh_token');
  
  console.log('Token exists:', !!token);
  console.log('Expiry:', expiry);
  console.log('Refresh token exists:', !!refreshToken);
  console.log('Current time:', Date.now());
  console.log('Is expired:', expiry && Date.now() >= expiry);
  
  if (token && expiry && Date.now() < expiry) {
    console.log('✓ Returning valid token');
    return { token, expiresAt: expiry };
  }
  
  console.log('✗ No valid token found');
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

// Resolver loading handler
ipcMain.handle('resolvers-load-builtin', async () => {
  console.log('=== Load All Resolvers ===');
  const fs = require('fs').promises;
  const path = require('path');
  
  const resolvers = [];
  
  // Load built-in resolvers
  const builtinFiles = [
    'spotify.axe',
    'bandcamp.axe',
    'qobuz.axe',
    'musicbrainz.axe'
  ];
  
  const builtinDir = path.join(__dirname, 'resolvers', 'builtin');
  console.log('Loading built-in resolvers from:', builtinDir);
  
  for (const filename of builtinFiles) {
    const filepath = path.join(builtinDir, filename);
    try {
      console.log(`  Reading ${filename}...`);
      const content = await fs.readFile(filepath, 'utf8');
      const axe = JSON.parse(content);
      axe._userInstalled = false; // Mark as built-in
      axe._filename = filename;
      resolvers.push(axe);
      console.log(`  ✅ Loaded ${axe.manifest.name}`);
    } catch (error) {
      console.error(`  ❌ Failed to load ${filename}:`, error.message);
    }
  }
  
  // Load user-installed resolvers
  const userDir = path.join(__dirname, 'resolvers', 'user');
  console.log('Loading user resolvers from:', userDir);
  
  try {
    const userFiles = await fs.readdir(userDir);
    const axeFiles = userFiles.filter(f => f.endsWith('.axe'));
    
    for (const filename of axeFiles) {
      const filepath = path.join(userDir, filename);
      try {
        console.log(`  Reading ${filename}...`);
        const content = await fs.readFile(filepath, 'utf8');
        const axe = JSON.parse(content);
        
        // Check for duplicates
        if (resolvers.find(r => r.manifest.id === axe.manifest.id)) {
          console.log(`  ⚠️  Skipping ${axe.manifest.name} (duplicate ID: ${axe.manifest.id})`);
          continue;
        }
        
        axe._userInstalled = true; // Mark as user-installed
        axe._filename = filename;
        resolvers.push(axe);
        console.log(`  ✅ Loaded ${axe.manifest.name} (user-installed)`);
      } catch (error) {
        console.error(`  ❌ Failed to load ${filename}:`, error.message);
      }
    }
  } catch (error) {
    // User directory doesn't exist yet - that's ok
    console.log('  No user resolvers directory (this is normal on first run)');
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
    
    // Create user resolvers directory if it doesn't exist
    const userResolversDir = path.join(__dirname, 'resolvers', 'user');
    await fs.mkdir(userResolversDir, { recursive: true });
    
    // Save to user resolvers directory
    const targetPath = path.join(userResolversDir, filename);
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
    
    const userDir = path.join(__dirname, 'resolvers', 'user');
    
    // Find the .axe file for this resolver
    const userFiles = await fs.readdir(userDir);
    const axeFiles = userFiles.filter(f => f.endsWith('.axe'));
    
    for (const filename of axeFiles) {
      const filepath = path.join(userDir, filename);
      const content = await fs.readFile(filepath, 'utf8');
      const axe = JSON.parse(content);
      
      if (axe.manifest.id === resolverId) {
        await fs.unlink(filepath);
        console.log(`  ✅ Uninstalled: ${filename}`);
        return { success: true, name: axe.manifest.name };
      }
    }
    
    return { success: false, error: 'Resolver not found in user directory' };
  } catch (error) {
    console.error('  ❌ Uninstall failed:', error.message);
    return { success: false, error: error.message };
  }
});

// Show context menu for resolver
ipcMain.handle('resolvers-show-context-menu', async (event, resolverId, isUserInstalled) => {
  console.log('=== Show Resolver Context Menu ===');
  console.log('  Resolver ID:', resolverId);
  console.log('  User installed:', isUserInstalled);
  
  if (!isUserInstalled) {
    console.log('  Built-in resolver - no context menu');
    return null;
  }
  
  const { Menu } = require('electron');
  
  const menu = Menu.buildFromTemplate([
    {
      label: 'Uninstall Resolver',
      click: () => {
        // Send back to renderer via return value
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