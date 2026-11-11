/**
 * Shuffle during a spinoff or Listen Along (parachord#1319 item 6, the mobile
 * apps' shared rule): refused everywhere. Desktop only greyed out the playbar
 * button; the app menu, MPRIS, parachord://control/shuffle and the DJ tool
 * (chat and MCP) flipped the flag regardless, and without shuffling the
 * queue the way the button does.
 */
const fs = require('fs');
const path = require('path');

const { shuffleAllowed, SHUFFLE_UNAVAILABLE_MESSAGE } = require('../../src/renderer/lib/playback-helpers');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

describe('shuffleAllowed', () => {
  test('refused during a spinoff or Listen Along, allowed otherwise', () => {
    expect(shuffleAllowed({ spinoff: false, listenAlong: false })).toBe(true);
    expect(shuffleAllowed({ spinoff: true, listenAlong: false })).toBe(false);
    expect(shuffleAllowed({ spinoff: false, listenAlong: true })).toBe(false);
    expect(shuffleAllowed({ spinoff: true, listenAlong: true })).toBe(false);
  });

  test('the refusal uses mobile\'s wording', () => {
    expect(SHUFFLE_UNAVAILABLE_MESSAGE).toBe("Shuffle isn't available during a spinoff or Listen Along");
  });
});

describe('every shuffle change goes through requestShuffle', () => {
  test('requestShuffle checks the lock, then changes shuffle through toggleShuffle', () => {
    const start = app.indexOf('const requestShuffle = (want');
    const body = app.slice(start, app.indexOf('requestShuffleRef.current = requestShuffle;', start));
    expect(body).toMatch(/if \(!shuffleAllowed\(\{ spinoff: spinoffModeRef\.current, listenAlong: !!listenAlongFriendRef\.current \}\)\) \{\s*if \(toast\) showToast\(SHUFFLE_UNAVAILABLE_MESSAGE\);\s*return false;/);
    expect(body).toMatch(/const enabled = want === 'toggle' \? !shuffleModeRef\.current : !!want;\s*if \(enabled !== shuffleModeRef\.current\) toggleShuffle\(\);\s*return true;/);
  });

  test('the playbar button, the menu, MPRIS, the link and the DJ tool all use it', () => {
    expect(app).toMatch(/onClick: shuffleDisabled \? undefined : \(\) => requestShuffle\('toggle'\),/);
    expect(app).toMatch(/case 'toggle-shuffle':\s*requestShuffleRef\.current\?\.\('toggle'\);/);
    expect(app).toMatch(/case 'set-shuffle':[\s\S]{0,300}?if \(requestShuffleRef\.current\?\.\(!!event\.value\) === false\) \{\s*window\.electron\.mpris\.updateShuffle/);
    expect(app).toMatch(/if \(requestShuffleRef\.current\?\.\(enabled\)\) showToast\(`Shuffle \$\{enabled \? 'on' : 'off'\}`\);/);
    expect(app).toMatch(/setShuffle: \(enabled\) => requestShuffleRef\.current\(enabled, \{ toast: false \}\),/);
  });

  test('nothing else flips the shuffle flag on the current queue', () => {
    expect(app).not.toMatch(/setShuffleMode\(prev => !prev\)/);
    expect(app).not.toMatch(/setShuffleMode\(!!event\.value\)/);
    expect(app).not.toMatch(/setShuffle: \(enabled\) => setShuffleMode\(enabled\)/);
  });

  test('the DJ tool reports a refusal instead of a shuffle that didn\'t happen', () => {
    expect(app).toMatch(/case 'shuffle': \{[\s\S]{0,200}?if \(context\.setShuffle\(args\.enabled\) === false\) \{\s*return \{ success: false, error: SHUFFLE_UNAVAILABLE_MESSAGE \};/);
  });
});
