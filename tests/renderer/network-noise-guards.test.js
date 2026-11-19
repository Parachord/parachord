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

const app = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'app.js'), 'utf8') +
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'renderer', 'hooks', 'use-playback-engine.js'), 'utf8');

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
    expect(app).toMatch(/if \(resolverId === 'spotify'\) spotifyPlaySentRef\.current = true;\n[\s\S]{0,500}?const success = await resolver\.play\(playSource, config\);/);
    expect(app.match(/spotifyPlaySentRef\.current\)\) \{\n\s*spotifyPlaySentRef\.current = false;/g)).toHaveLength(3);
  });
});

describe('listening context', () => {
  const start = app.indexOf('const fetchListeningContext = async () => {');
  const body = app.slice(start, app.indexOf('// Merge data from every source with deduplication', start));

  test('each period request settles to null instead of rejecting', () => {
    // One source loop for every plug-in (#1539 step 4); every top-items
    // request goes through `ask`, which settles to null.
    expect(body).toContain('const ask = (kind, period, limit) => askTopItems(source.id, { kind, period, limit }).catch(() => null);');
    expect(body.match(/askTopItems\(/g)).toHaveLength(1);
  });

  test('a failed recently-played request does not throw away the periods', () => {
    expect(body).toContain('const recent = await askRecentListens(source.id, { limit: 50 }).catch(() => null);');
    // And a source that throws anyway is left out, not the whole context.
    expect(body).toMatch(/\} catch \(err\) \{\s*console\.error\(`Failed to fetch \$\{pluginName\(source\.id\)\} context:`, err\);\s*return null;/);
  });
});

describe('friend poll', () => {
  test('skips backed-off friends and records each response status', () => {
    expect(app).toMatch(/for \(const friend of friendsToCheck\) \{\n\s*if \(friendPollBackoffRef\.current\.shouldSkip\(friend\.id\)\) continue;/);
    // One plug-in call for every service (#1539 step 5): a success counts
    // as 200, a failure records the status its plug-in's error carries.
    expect(app).toContain('recordFriendPollStatus(friend, 200);');
    expect(app).toContain('if (error && error.status) recordFriendPollStatus(friend, error.status);');
  });

  test('weekly stats are attempted at most once per window', () => {
    expect(app).toMatch(/friendPollBackoffRef\.current\.statsDue\(friend\.id, friend\.cachedWeeklyStats\?\.fetchedAt\)/);
    expect(app).toMatch(/if \(statsStale\) \{\n\s*friendPollBackoffRef\.current\.recordStatsAttempt\(friend\.id\);/);
  });
});
