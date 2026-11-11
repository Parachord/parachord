/**
 * Listen Along, parachord#1319 items 7-10, matching the mobile apps' shared
 * ListenAlongSession (parachord-mobile shared/.../playback/ListenAlongSession.kt):
 *   7. a failed poll isn't "the friend stopped"; 4 in a row are (desktop
 *      ignored failures, so a session could sit on a dead connection forever);
 *   8. our song ended with the friend's position unknown: wait for the next
 *      poll, which decides (desktop stalled until the friend changed track
 *      again, reading a snapshot taken when the session began);
 *   9. the friend stops while the user has paused: the queue comes back
 *      paused (desktop started it playing by itself);
 *  10. Play does nothing while the session waits after its song ended or
 *      after a friend's track that couldn't play.
 */
const fs = require('fs');
const path = require('path');

const {
  LISTEN_ALONG_FAILED_POLLS_LIMIT, friendTrackKey, listenAlongWaitDecision
} = require('../../src/renderer/lib/playback-helpers');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const engine = fs.readFileSync(path.join(__dirname, '../../src/renderer/hooks/use-playback-engine.js'), 'utf8');
const between = (src, from, to) => {
  const a = src.indexOf(from);
  if (a === -1) throw new Error(`not found: ${from}`);
  return src.slice(a, src.indexOf(to, a + from.length));
};

describe('the rules', () => {
  test('4 failed polls in a row count as the friend stopping, as on mobile', () => {
    expect(LISTEN_ALONG_FAILED_POLLS_LIMIT).toBe(4);
  });

  test('a track is the same song across polls, case-insensitively on name and artist', () => {
    expect(friendTrackKey({ name: 'Flume', artist: 'Bon Iver' })).toBe(friendTrackKey({ title: 'FLUME', artist: 'bon iver' }));
    expect(friendTrackKey({ name: 'Flume', artist: 'Bon Iver' })).not.toBe(friendTrackKey({ name: 'Flume', artist: 'Peter Gabriel' }));
    expect(friendTrackKey(null)).toBeNull();
  });

  test('waiting after our song ended: another track plays, the same one ends the session', () => {
    const played = { name: 'Flume', artist: 'Bon Iver' };
    expect(listenAlongWaitDecision({ waiting: 'song-ended', playedTrack: played, polledTrack: { name: 'Skinny Love', artist: 'Bon Iver' } })).toBe('play');
    expect(listenAlongWaitDecision({ waiting: 'song-ended', playedTrack: played, polledTrack: { name: 'flume', artist: 'bon iver' } })).toBe('not-moved-on');
  });

  test('waiting after their track couldn\'t play here: a change plays, the same track keeps waiting', () => {
    const played = { name: 'Flume', artist: 'Bon Iver' };
    expect(listenAlongWaitDecision({ waiting: 'unplayable', playedTrack: played, polledTrack: { name: 'Skinny Love', artist: 'Bon Iver' } })).toBe('play');
    expect(listenAlongWaitDecision({ waiting: 'unplayable', playedTrack: played, polledTrack: played })).toBe('keep-waiting');
  });
});

describe('7: failed polls', () => {
  const poll = between(app, 'const refreshPinnedFriends = async () => {', 'const fetchTransientFriendNowPlaying');

  test('a failed poll for the Listen Along friend counts, and only the limit ends the session', () => {
    expect(poll).toMatch(/if \(isListenAlongFriend && !recentTrack\) \{[\s\S]{0,400}?listenAlongFailedPollsRef\.current \+= 1;[\s\S]{0,300}?if \(listenAlongFailedPollsRef\.current >= LISTEN_ALONG_FAILED_POLLS_LIMIT\) listenAlongFriendWentQuiet\(friend\);\s*continue;/);
  });

  test('a hidden profile counts as stopped at once, and an answer resets the count', () => {
    expect(poll).toMatch(/if \(hidesListening\) \{\s*listenAlongFriendWentQuiet\(friend\);\s*continue;/);
    expect(poll).toMatch(/if \(isListenAlongFriend\) listenAlongFailedPollsRef\.current = 0;/);
  });
});

describe('8: our song ended and the friend\'s position isn\'t known', () => {
  const next = between(engine, "const handleNext = async (userInitiated = false, { trigger = 'next' } = {}) => {", 'const handlePrevious = async () => {');
  const poll = between(app, 'const refreshPinnedFriends = async () => {', 'const fetchTransientFriendNowPlaying');

  test('handleNext reads the last poll, not the snapshot from when the session began', () => {
    expect(next).toMatch(/const friendTrack = listenAlongLastPollTrackRef\.current;/);
    expect(next).not.toMatch(/const friendTrack = listenAlongFriendNow\.cachedRecentTrack;/);
  });

  test('with nothing held it waits for the next poll', () => {
    expect(next).toMatch(/listenAlongWaitingRef\.current = 'song-ended';\s*setIsPlaying\(false\);\s*return;/);
  });

  test('the next poll decides whether or not the cached track changed', () => {
    expect(poll).toMatch(/const waiting = listenAlongWaitingRef\.current;\s*if \(waiting && !isPlayingRef\.current\) \{\s*const decision = listenAlongWaitDecision\(/);
    expect(poll).toMatch(/if \(decision === 'not-moved-on'\) \{[\s\S]{0,200}?endListenAlongToQueue\(`\$\{friend\.displayName\} hasn't moved on - resuming your queue`\);/);
    expect(poll).toMatch(/if \(decision === 'play'\) \{[\s\S]{0,300}?playListenAlongTrack\(friend, recentTrack\);/);
    // the decision runs before the trackChanged-only path
    expect(poll.indexOf('listenAlongWaitDecision(')).toBeLessThan(poll.indexOf('if (trackChanged && isOnAirNow) {'));
  });

  test('every play of the friend\'s track starts a fresh wait state', () => {
    expect(app).toMatch(/const playListenAlongTrack = \(friend, recentTrack\) => \{\s*listenAlongLastTrackRef\.current = \{ name: recentTrack\.name, artist: recentTrack\.artist \};\s*listenAlongLastPollTrackRef\.current = null;\s*listenAlongWaitingRef\.current = null;\s*handlePlay\(listenAlongTrackFor\(friend, recentTrack\)\);/);
  });
});

describe('9: the friend stops while the user has paused', () => {
  test('the queue comes back paused instead of starting by itself', () => {
    const quiet = between(app, 'const listenAlongFriendWentQuiet = (friend) => {', 'const refreshPinnedFriends');
    expect(quiet).toMatch(/const userPaused = listenAlongUserPausedRef\.current;\s*endListenAlongToQueue\(`\$\{friend\.displayName\} stopped listening`, \{ startPlayback: !userPaused \}\);/);
    const end = between(app, 'const endListenAlongToQueue = (message, { startPlayback = true } = {}) => {', 'const listenAlongFriendWentQuiet');
    expect(end).toMatch(/if \(startPlayback\) handleNextRef\.current\?\.\(\);\s*else holdNextQueueTrackRef\.current\?\.\(\);/);
    // handleNext would otherwise see the session and run its Listen Along branch again
    expect(end).toMatch(/listenAlongFriendRef\.current = null;/);
  });

  test('holdNextQueueTrack puts the queue\'s first playable track on screen, held for Play', () => {
    const hold = between(engine, 'const holdNextQueueTrack = () => {', 'return true;\n  };');
    expect(hold).toMatch(/const index = queue\.findIndex\(t => t\.status !== 'error'\);/);
    expect(hold).toMatch(/holdTrackForPlay\(next\);/);
  });
});

describe('10: Play while the session waits', () => {
  test('Play does nothing until the next poll decides', () => {
    const playPause = between(engine, 'const handlePlayPause = async () => {', 'trackNeedsExplicitStart.current && !trackLoading');
    expect(playPause).toMatch(/if \(!isPlaying && listenAlongWaitingRef\.current\) \{[\s\S]{0,200}?return;/);
  });

  test('a friend\'s track that can\'t play waits (or plays a held newer one) instead of skipping into the queue', () => {
    const skip = between(engine, 'const autoSkipIfAdvancing = (reason', 'if (!(isAdvancingTrackRef.current || spinoffModeRef.current)) {');
    expect(skip).toMatch(/if \(listenAlongFriendRef\.current && trackOrSource\?\._playbackContext\?\.type === 'listenAlong'\) \{/);
    expect(skip).toMatch(/const held = listenAlongPendingTrackRef\.current;/);
    expect(skip).toMatch(/listenAlongWaitingRef\.current = 'unplayable';\s*holdFailedTrack\(\);/);
    expect(skip).not.toMatch(/handleNextRef/);
  });
});

test('a session that ends forgets its wait and poll state', () => {
  expect(app).toMatch(/if \(listenAlongFriend\) return;\s*listenAlongWaitingRef\.current = null;\s*listenAlongLastPollTrackRef\.current = null;\s*listenAlongFailedPollsRef\.current = 0;/);
});
