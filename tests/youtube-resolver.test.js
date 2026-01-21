/**
 * YouTube Resolver Unit Tests
 *
 * Run with: node tests/youtube-resolver.test.js
 *
 * Tests URL pattern matching, video ID extraction, and oEmbed lookup
 */

const fs = require('fs');
const path = require('path');

// Load the YouTube resolver
const resolverPath = path.join(__dirname, '../resolvers/youtube.axe');
const resolverData = JSON.parse(fs.readFileSync(resolverPath, 'utf8'));

// Extract the lookupUrl function
const lookupUrlCode = resolverData.implementation.lookupUrl;

// Create a function from the code string
const createLookupUrl = () => {
  // The function needs fetch - use node-fetch or built-in fetch (Node 18+)
  return eval(`(${lookupUrlCode})`);
};

// Test results tracking
let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    results.push({ name, status: '✅ PASS' });
    console.log(`✅ ${name}`);
  } catch (error) {
    failed++;
    results.push({ name, status: '❌ FAIL', error: error.message });
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message} Expected: ${expected}, Got: ${actual}`);
  }
}

function assertMatch(actual, pattern, message = '') {
  if (!pattern.test(actual)) {
    throw new Error(`${message} Expected to match: ${pattern}, Got: ${actual}`);
  }
}

function assertNotNull(actual, message = '') {
  if (actual === null || actual === undefined) {
    throw new Error(`${message} Expected non-null value, got: ${actual}`);
  }
}

function assertNull(actual, message = '') {
  if (actual !== null) {
    throw new Error(`${message} Expected null, got: ${actual}`);
  }
}

// ============================================
// URL Pattern Matching Tests
// ============================================
console.log('\n📋 URL Pattern Matching Tests\n');

const urlPatterns = resolverData.urlPatterns;

function matchesPattern(url, patterns) {
  return patterns.some(pattern => {
    // Convert glob pattern to regex
    const regexPattern = pattern
      .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // Escape special chars except *
      .replace(/\*/g, '.*');  // Convert * to .*
    const regex = new RegExp(regexPattern);
    return regex.test(url);
  });
}

test('YT-01: Standard watch URL matches', () => {
  const url = 'youtube.com/watch?v=dQw4w9WgXcQ';
  assertEqual(matchesPattern(url, urlPatterns), true, 'Standard URL should match');
});

test('YT-02: Short youtu.be URL matches', () => {
  const url = 'youtu.be/dQw4w9WgXcQ';
  assertEqual(matchesPattern(url, urlPatterns), true, 'Short URL should match');
});

test('YT-03: Music YouTube URL matches', () => {
  const url = 'music.youtube.com/watch?v=xyz123';
  assertEqual(matchesPattern(url, urlPatterns), true, 'Music URL should match');
});

test('YT-04: Mobile YouTube URL matches', () => {
  const url = 'm.youtube.com/watch?v=xyz123';
  assertEqual(matchesPattern(url, urlPatterns), true, 'Mobile URL should match');
});

test('YT-05: URL with extra params matches', () => {
  const url = 'www.youtube.com/watch?v=xyz123&list=PLxyz&t=30';
  assertEqual(matchesPattern(url, urlPatterns), true, 'URL with params should match');
});

test('YT-06: Playlist URL does not match', () => {
  const url = 'youtube.com/playlist?list=PLxyz';
  assertEqual(matchesPattern(url, urlPatterns), false, 'Playlist URL should not match');
});

test('YT-07: Channel URL does not match', () => {
  const url = 'youtube.com/@channelname';
  assertEqual(matchesPattern(url, urlPatterns), false, 'Channel URL should not match');
});

// ============================================
// Video ID Extraction Tests
// ============================================
console.log('\n📋 Video ID Extraction Tests\n');

function extractVideoId(url) {
  // Match the logic from lookupUrl
  let videoId = null;
  if (url.includes('youtu.be/')) {
    const match = url.match(/youtu\.be\/([a-zA-Z0-9_-]+)/);
    if (match) videoId = match[1];
  } else {
    const match = url.match(/[?&]v=([a-zA-Z0-9_-]+)/);
    if (match) videoId = match[1];
  }
  return videoId;
}

test('Extract ID from standard URL', () => {
  const id = extractVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assertEqual(id, 'dQw4w9WgXcQ', 'Should extract correct video ID');
});

test('Extract ID from short URL', () => {
  const id = extractVideoId('https://youtu.be/dQw4w9WgXcQ');
  assertEqual(id, 'dQw4w9WgXcQ', 'Should extract ID from short URL');
});

test('Extract ID from URL with extra params', () => {
  const id = extractVideoId('https://www.youtube.com/watch?v=abc123&list=PLxyz&t=30');
  assertEqual(id, 'abc123', 'Should extract ID ignoring other params');
});

test('Extract ID from music.youtube.com', () => {
  const id = extractVideoId('https://music.youtube.com/watch?v=xyz789');
  assertEqual(id, 'xyz789', 'Should extract ID from music URL');
});

test('Extract ID with underscores and hyphens', () => {
  const id = extractVideoId('https://www.youtube.com/watch?v=a_B-c1D2e3F');
  assertEqual(id, 'a_B-c1D2e3F', 'Should handle underscores and hyphens');
});

test('No ID from playlist URL', () => {
  const id = extractVideoId('https://www.youtube.com/playlist?list=PLxyz');
  assertNull(id, 'Should return null for playlist URL');
});

test('No ID from channel URL', () => {
  const id = extractVideoId('https://www.youtube.com/@channelname');
  assertNull(id, 'Should return null for channel URL');
});

// ============================================
// oEmbed Lookup Tests (requires network)
// ============================================
console.log('\n📋 oEmbed Lookup Tests (network required)\n');

async function runAsyncTests() {
  const lookupUrl = createLookupUrl();

  // Test YT-08: Valid video lookup
  try {
    console.log('Testing YT-08: Valid video lookup...');
    const result = await lookupUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {});

    if (result) {
      passed++;
      console.log('✅ YT-08: Valid video lookup');
      console.log(`   Title: ${result.title}`);
      console.log(`   Artist: ${result.artist}`);
      console.log(`   Album: ${result.album}`);
      console.log(`   YouTube ID: ${result.youtubeId}`);

      // Verify structure
      if (result.youtubeId === 'dQw4w9WgXcQ' && result.album === 'YouTube') {
        passed++;
        console.log('✅ YT-08b: Result structure correct');
      } else {
        failed++;
        console.log('❌ YT-08b: Result structure incorrect');
      }
    } else {
      failed++;
      console.log('❌ YT-08: Valid video lookup returned null');
    }
  } catch (error) {
    failed++;
    console.log(`❌ YT-08: Error - ${error.message}`);
  }

  // Test YT-09: Title parsing (artist - title)
  try {
    console.log('\nTesting YT-09: Title parsing...');
    // Use a video known to have "Artist - Title" format
    const result = await lookupUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {});

    if (result && result.artist && result.title) {
      passed++;
      console.log('✅ YT-09: Title parsing works');
      console.log(`   Parsed Artist: ${result.artist}`);
      console.log(`   Parsed Title: ${result.title}`);
    } else {
      failed++;
      console.log('❌ YT-09: Title parsing failed');
    }
  } catch (error) {
    failed++;
    console.log(`❌ YT-09: Error - ${error.message}`);
  }

  // Test YT-11: Album art thumbnail
  try {
    console.log('\nTesting YT-11: Album art thumbnail...');
    const result = await lookupUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ', {});

    if (result && result.albumArt && result.albumArt.includes('i.ytimg.com')) {
      passed++;
      console.log('✅ YT-11: Album art URL correct');
      console.log(`   Album Art: ${result.albumArt}`);
    } else {
      failed++;
      console.log('❌ YT-11: Album art URL incorrect or missing');
    }
  } catch (error) {
    failed++;
    console.log(`❌ YT-11: Error - ${error.message}`);
  }

  // Test YT-12: Short URL lookup
  try {
    console.log('\nTesting YT-12: Short URL lookup...');
    const result = await lookupUrl('https://youtu.be/dQw4w9WgXcQ', {});

    if (result && result.youtubeId === 'dQw4w9WgXcQ') {
      passed++;
      console.log('✅ YT-12: Short URL lookup works');
    } else {
      failed++;
      console.log('❌ YT-12: Short URL lookup failed');
    }
  } catch (error) {
    failed++;
    console.log(`❌ YT-12: Error - ${error.message}`);
  }

  // Test YT-13: Invalid video ID
  try {
    console.log('\nTesting YT-13: Invalid video ID...');
    const result = await lookupUrl('https://www.youtube.com/watch?v=invalidvideoid123456789', {});

    if (result === null) {
      passed++;
      console.log('✅ YT-13: Invalid video ID returns null');
    } else {
      failed++;
      console.log('❌ YT-13: Invalid video ID should return null');
    }
  } catch (error) {
    // An error is also acceptable for invalid IDs
    passed++;
    console.log('✅ YT-13: Invalid video ID handled (threw error)');
  }

  // Print summary
  console.log('\n========================================');
  console.log('TEST SUMMARY');
  console.log('========================================');
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`Total: ${passed + failed}`);
  console.log('========================================\n');

  process.exit(failed > 0 ? 1 : 0);
}

// Run async tests
runAsyncTests().catch(error => {
  console.error('Test runner error:', error);
  process.exit(1);
});
