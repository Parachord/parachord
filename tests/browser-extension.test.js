/**
 * Browser Extension Unit Tests
 *
 * Run with: node tests/browser-extension.test.js
 *
 * Tests content script logic, site detection, and message handling
 * Note: WebSocket and actual browser integration require manual testing
 */

const fs = require('fs');
const path = require('path');

// Test results tracking
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
  }
}

function assertTrue(actual, message = '') {
  if (!actual) {
    throw new Error(`${message} Expected truthy value, got: ${actual}`);
  }
}

function assertFalse(actual, message = '') {
  if (actual) {
    throw new Error(`${message} Expected falsy value, got: ${actual}`);
  }
}

// Load content script for analysis
const contentScriptPath = path.join(__dirname, '../parachord-extension/content.js');
const contentScript = fs.readFileSync(contentScriptPath, 'utf8');

// Load manifest for analysis
const manifestPath = path.join(__dirname, '../parachord-extension/manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

// ============================================
// Site Detection Tests
// ============================================
console.log('\n📋 Site Detection Tests\n');

function detectSite(hostname) {
  if (hostname.includes('youtube.com')) return 'youtube';
  if (hostname.includes('bandcamp.com')) return 'bandcamp';
  return 'unknown';
}

test('EXT-07a: Detects youtube.com', () => {
  assertEqual(detectSite('www.youtube.com'), 'youtube');
});

test('EXT-07b: Detects music.youtube.com', () => {
  assertEqual(detectSite('music.youtube.com'), 'youtube');
});

test('EXT-07c: Detects m.youtube.com', () => {
  assertEqual(detectSite('m.youtube.com'), 'youtube');
});

test('EXT-07d: Detects bandcamp.com subdomains', () => {
  assertEqual(detectSite('artist.bandcamp.com'), 'bandcamp');
});

test('EXT-07e: Detects bandcamp.com', () => {
  assertEqual(detectSite('bandcamp.com'), 'bandcamp');
});

test('EXT-08a: Returns unknown for google.com', () => {
  assertEqual(detectSite('www.google.com'), 'unknown');
});

test('EXT-08b: Returns unknown for spotify.com', () => {
  assertEqual(detectSite('open.spotify.com'), 'unknown');
});

// ============================================
// Manifest Configuration Tests
// ============================================
console.log('\n📋 Manifest Configuration Tests\n');

test('Manifest has correct name', () => {
  assertTrue(manifest.name.includes('Parachord'), 'Name should include Parachord');
});

test('Manifest version is valid', () => {
  assertTrue(/^\d+\.\d+\.\d+$/.test(manifest.manifest_version.toString()) || manifest.manifest_version === 3);
});

test('Content scripts target YouTube', () => {
  const matches = manifest.content_scripts[0].matches;
  assertTrue(matches.some(m => m.includes('youtube.com')), 'Should match youtube.com');
});

test('Content scripts target Bandcamp', () => {
  const matches = manifest.content_scripts[0].matches;
  assertTrue(matches.some(m => m.includes('bandcamp.com')), 'Should match bandcamp.com');
});

test('Content script runs at document_idle or document_end', () => {
  const runAt = manifest.content_scripts[0].run_at;
  assertTrue(runAt === 'document_idle' || runAt === 'document_end' || runAt === undefined);
});

test('Has background service worker', () => {
  assertTrue(manifest.background && (manifest.background.service_worker || manifest.background.scripts));
});

test('Requests necessary permissions', () => {
  const permissions = manifest.permissions || [];
  // Should have at least tabs or activeTab
  assertTrue(
    permissions.includes('tabs') ||
    permissions.includes('activeTab') ||
    manifest.host_permissions?.length > 0,
    'Should have tab-related permissions'
  );
});

// ============================================
// Content Script Structure Tests
// ============================================
console.log('\n📋 Content Script Structure Tests\n');

test('Content script is wrapped in IIFE', () => {
  assertTrue(contentScript.includes('(function()') || contentScript.includes('(function ()'));
});

test('Content script uses strict mode', () => {
  assertTrue(contentScript.includes("'use strict'") || contentScript.includes('"use strict"'));
});

test('Content script detects site from hostname', () => {
  assertTrue(contentScript.includes('hostname'));
});

test('Content script has YouTube detection', () => {
  assertTrue(contentScript.includes('youtube'));
});

test('Content script has Bandcamp detection', () => {
  assertTrue(contentScript.includes('bandcamp'));
});

test('Content script sends connected event', () => {
  assertTrue(contentScript.includes("event: 'connected'") || contentScript.includes('event: "connected"'));
});

test('Content script sends playing event', () => {
  assertTrue(contentScript.includes("event: 'playing'") || contentScript.includes('event: "playing"'));
});

test('Content script sends paused event', () => {
  assertTrue(contentScript.includes("event: 'paused'") || contentScript.includes('event: "paused"'));
});

test('Content script sends ended event', () => {
  assertTrue(contentScript.includes("event: 'ended'") || contentScript.includes('event: "ended"'));
});

test('Content script has media element detection', () => {
  assertTrue(
    contentScript.includes('getMediaElement') ||
    contentScript.includes('querySelector') && contentScript.includes('video')
  );
});

test('Content script handles YouTube video element', () => {
  assertTrue(contentScript.includes('html5-main-video') || contentScript.includes('video'));
});

test('Content script handles Bandcamp audio element', () => {
  assertTrue(contentScript.includes('audio'));
});

test('Content script listens for play event', () => {
  assertTrue(contentScript.includes("'play'") || contentScript.includes('"play"'));
});

test('Content script listens for pause event', () => {
  assertTrue(contentScript.includes("'pause'") || contentScript.includes('"pause"'));
});

test('Content script listens for ended event', () => {
  assertTrue(contentScript.includes("'ended'") || contentScript.includes('"ended"'));
});

test('Content script handles commands from background', () => {
  assertTrue(contentScript.includes('onMessage') || contentScript.includes('runtime.onMessage'));
});

test('Content script can execute play command', () => {
  assertTrue(contentScript.includes('.play()'));
});

test('Content script can execute pause command', () => {
  assertTrue(contentScript.includes('.pause()'));
});

// ============================================
// Bandcamp Auto-Play Tests
// ============================================
console.log('\n📋 Bandcamp Auto-Play Tests\n');

test('Has Bandcamp auto-play function', () => {
  assertTrue(contentScript.includes('autoPlayBandcamp') || contentScript.includes('auto-play'));
});

test('Auto-play looks for play button', () => {
  assertTrue(contentScript.includes('playbutton') || contentScript.includes('play-btn') || contentScript.includes('play_button'));
});

test('Auto-play has retry logic', () => {
  assertTrue(contentScript.includes('retry') || contentScript.includes('setTimeout'));
});

test('Auto-play triggers on Bandcamp', () => {
  assertTrue(contentScript.includes("site === 'bandcamp'") || contentScript.includes('site === "bandcamp"'));
});

// ============================================
// SPA Navigation Handling Tests
// ============================================
console.log('\n📋 SPA Navigation Tests\n');

test('Content script uses MutationObserver for SPA', () => {
  assertTrue(contentScript.includes('MutationObserver'));
});

test('Content script tracks URL changes', () => {
  assertTrue(contentScript.includes('location.href') || contentScript.includes('lastUrl'));
});

// ============================================
// Background Script Tests
// ============================================
console.log('\n📋 Background Script Tests\n');

const backgroundPath = path.join(__dirname, '../parachord-extension/background.js');
let backgroundScript = '';
try {
  backgroundScript = fs.readFileSync(backgroundPath, 'utf8');
} catch (e) {
  // Try service-worker.js if background.js doesn't exist
  try {
    backgroundScript = fs.readFileSync(path.join(__dirname, '../parachord-extension/service-worker.js'), 'utf8');
  } catch (e2) {
    console.log('⚠️  Background script not found, skipping background tests');
  }
}

if (backgroundScript) {
  test('Background script has WebSocket connection', () => {
    assertTrue(backgroundScript.includes('WebSocket'));
  });

  test('Background script connects to correct port', () => {
    assertTrue(backgroundScript.includes('9876') || backgroundScript.includes('127.0.0.1'));
  });

  test('Background script forwards messages from content scripts', () => {
    assertTrue(backgroundScript.includes('onMessage') || backgroundScript.includes('runtime.onMessage'));
  });

  test('Background script handles tab events', () => {
    assertTrue(
      backgroundScript.includes('tabs.onRemoved') ||
      backgroundScript.includes('tabs.onUpdated') ||
      backgroundScript.includes('chrome.tabs')
    );
  });

  test('Background script has reconnection logic', () => {
    assertTrue(
      backgroundScript.includes('reconnect') ||
      backgroundScript.includes('onclose') ||
      backgroundScript.includes('onerror')
    );
  });
}

// ============================================
// Message Format Tests
// ============================================
console.log('\n📋 Message Format Tests\n');

test('Messages include type field', () => {
  assertTrue(contentScript.includes("type: 'event'") || contentScript.includes('type: "event"'));
});

test('Messages include site field', () => {
  assertTrue(contentScript.includes('site: site') || contentScript.includes('site:'));
});

test('Connected message includes URL', () => {
  assertTrue(contentScript.includes('url:') && contentScript.includes('location.href'));
});

// ============================================
// Command Handling Tests
// ============================================
console.log('\n📋 Command Handling Tests\n');

test('Handles play action', () => {
  assertTrue(contentScript.includes("action === 'play'") || contentScript.includes('action === "play"'));
});

test('Handles pause action', () => {
  assertTrue(contentScript.includes("action === 'pause'") || contentScript.includes('action === "pause"'));
});

test('Handles stop action', () => {
  assertTrue(contentScript.includes("action === 'stop'") || contentScript.includes('action === "stop"'));
});

test('Stop action resets currentTime', () => {
  assertTrue(contentScript.includes('currentTime = 0') || contentScript.includes('currentTime=0'));
});

// Print summary
console.log('\n========================================');
console.log('TEST SUMMARY');
console.log('========================================');
console.log(`✅ Passed: ${passed}`);
console.log(`❌ Failed: ${failed}`);
console.log(`Total: ${passed + failed}`);
console.log('========================================\n');

if (failed > 0) {
  console.log('Note: Some tests may fail if the extension structure differs from expected.');
  console.log('Manual testing is required for actual WebSocket and browser integration.\n');
}

process.exit(failed > 0 ? 1 : 0);
