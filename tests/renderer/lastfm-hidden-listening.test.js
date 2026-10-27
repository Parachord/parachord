/**
 * A Last.fm profile that hides its recent listening (403 + error 17) is
 * recognised as such, not as a broken account, and the friend UI says so.
 * The lib is tested directly; the app.js / collection-page.js wiring by
 * source markers, because app.js never runs under jest.
 */

const fs = require('fs');
const path = require('path');

const { isLastfmHiddenListening, LASTFM_LOGIN_REQUIRED } = require('../../src/renderer/lib/lastfm-hidden-listening');

describe('isLastfmHiddenListening', () => {
  test('403 with error 17 is a hidden profile', () => {
    expect(LASTFM_LOGIN_REQUIRED).toBe(17);
    expect(isLastfmHiddenListening(403, { error: 17, message: 'Login: User required to be logged in' })).toBe(true);
    expect(isLastfmHiddenListening(403, { error: '17' })).toBe(true);
  });

  test('other failures are not', () => {
    expect(isLastfmHiddenListening(403, { error: 10, message: 'Invalid API key' })).toBe(false);
    expect(isLastfmHiddenListening(404, { error: 6, message: 'User not found' })).toBe(false);
    expect(isLastfmHiddenListening(500, { error: 17 })).toBe(false);
    expect(isLastfmHiddenListening(403, null)).toBe(false);
    expect(isLastfmHiddenListening(403, undefined)).toBe(false);
    expect(isLastfmHiddenListening(200, { recenttracks: {} })).toBe(false);
  });
});

const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const collectionPage = fs.readFileSync(path.join(__dirname, '../../src/renderer/components/collection-page.js'), 'utf8');

const body = (startMarker, endMarker) => {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker, start + startMarker.length);
  return start === -1 || end === -1 ? '' : src.slice(start, end);
};

const fetchRecent = body('const fetchFriendRecentTrack = async (friend) => {', '\n  };\n');
const updateHidden = body('const updateFriendHidesListening = (friend, hidesListening) => {', '\n  };\n');
const poll = body('const refreshPinnedFriends = async () => {', '\n  };\n');
const historyLoad = body('const loadFriendRecentTracks = async (friend) => {', '\n  };\n');

describe('hidden-listening wiring', () => {
  test('the markers this test depends on exist', () => {
    for (const part of [fetchRecent, updateHidden, poll, historyLoad]) expect(part.length).toBeGreaterThan(0);
  });

  test('the friend poll reports hidden profiles and records them on the friend', () => {
    expect(fetchRecent).toContain('isLastfmHiddenListening(response.status, body)');
    expect(fetchRecent).toContain('hidesListening: false');
    expect(updateHidden).toContain('if (hidesListening === null || hidesListening === !!friend.hidesListening) return;');
    expect(poll).toContain('const { track: recentTrack, hidesListening } = await fetchFriendRecentTrack(friend);');
    expect(poll).toContain('updateFriendHidesListening(friend, hidesListening);');
  });

  test('every caller destructures the new return shape', () => {
    const calls = src.match(/await fetchFriendRecentTrack\(/g) || [];
    const destructured = src.match(/const \{ track: recentTrack, hidesListening \} = await fetchFriendRecentTrack\(/g) || [];
    expect(destructured.length).toBe(calls.length);
  });

  test('the Recent tab says the listening is hidden instead of toasting a failure', () => {
    expect(historyLoad).toContain("recent: [], recentHidden: true");
    expect(historyLoad).toContain('recentHidden: false');
    expect(src).toContain('friendHistoryData.recentHidden');
  });

  test('the friend card shows it when the friend is not on-air', () => {
    expect(collectionPage).toContain("!onAir && friend.hidesListening && React.createElement('div'");
    expect(collectionPage).toContain("'Listening hidden'");
  });
});
