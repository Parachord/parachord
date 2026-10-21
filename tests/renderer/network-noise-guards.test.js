/**
 * Source checks for three console-noise fixes in src/renderer/app.js.
 *
 * - The track-change Spotify pauses key off a Spotify-only "a play was sent"
 *   ref. They used streamingPlaybackActiveRef, which every streaming resolver
 *   sets, so each Apple Music track change also PUT /me/player/pause (a 404
 *   with no active Spotify device).
 * - fetchListeningContext's per-period requests settle to null: they start
 *   before the recently-played request, and when that one threw, the jump to
 *   the catch left them unawaited ("Uncaught (in promise)" x4).
 * - The friend poll skips backed-off friends and rate-limits weekly stats
 *   (the backoff itself is unit-tested in friend-poll-backoff.test.js).
 */

const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8');

describe('Spotify pause on track change', () => {
  const sites = app.split('\n').filter((l) => l.includes("_activeResolver === 'spotify'") && l.includes('spotifyToken &&'));

  test('all three pause sites use the Spotify-only ref', () => {
    expect(sites).toHaveLength(3);
    for (const line of sites) {
      expect(line).toContain('spotifyPlaySentRef.current');
      expect(line).not.toContain('streamingPlaybackActiveRef');
    }
  });

  test('the ref is set right before a Spotify play and cleared by each pause', () => {
    expect(app).toMatch(/if \(resolverId === 'spotify'\) spotifyPlaySentRef\.current = true;\n\s*const success = await resolver\.play\(sourceToPlay, config\);/);
    expect(app.match(/spotifyPlaySentRef\.current\)\) \{\n\s*spotifyPlaySentRef\.current = false;/g)).toHaveLength(3);
  });
});

describe('listening context', () => {
  const start = app.indexOf('const fetchListeningContext = async () => {');
  const body = app.slice(start, app.indexOf('// Merge data from both sources with deduplication', start));

  test('each period request settles to null instead of rejecting', () => {
    const periodBlocks = body.split('const periodPromises = periods.map(async (period) => {').slice(1);
    expect(periodBlocks).toHaveLength(2);
    for (const block of periodBlocks) {
      expect(block).toMatch(/^\s*try \{/);
      const end = block.indexOf('});');
      expect(block.slice(0, end)).toMatch(/\} catch \{\s*return null;\s*\}\s*$/);
    }
  });

  test('a failed recently-played request does not throw away the periods', () => {
    expect(body.match(/listens\?count=50`\)\.catch\(\(\) => null\)/g)).toHaveLength(1);
    expect(body.match(/limit=50`\)\.catch\(\(\) => null\)/g)).toHaveLength(1);
  });
});

describe('friend poll', () => {
  test('skips backed-off friends and records each response status', () => {
    expect(app).toMatch(/for \(const friend of friendsToCheck\) \{\n\s*if \(friendPollBackoffRef\.current\.shouldSkip\(friend\.id\)\) continue;/);
    expect(app.match(/recordFriendPollStatus\(friend, response\.status\);/g)).toHaveLength(2);
  });

  test('weekly stats are attempted at most once per window', () => {
    expect(app).toMatch(/friendPollBackoffRef\.current\.statsDue\(friend\.id, friend\.cachedWeeklyStats\?\.fetchedAt\)/);
    expect(app).toMatch(/if \(statsStale\) \{\n\s*friendPollBackoffRef\.current\.recordStatsAttempt\(friend\.id\);/);
  });
});
