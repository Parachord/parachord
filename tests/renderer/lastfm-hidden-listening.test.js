/**
 * A Last.fm profile that hides its recent listening (403 + error 17) is
 * recognised as such, not as a broken account, and the friend UI says so.
 * The Last.fm plug-in is driven directly; the app.js / collection-page.js
 * wiring by source markers, because app.js never runs under jest.
 */

const fs = require('fs');
const path = require('path');

// The rule lives in the Last.fm plug-in's getRecentListens (#1539 step 5):
// driven here through the built plug-in, as the app materializes it.
const axe = JSON.parse(fs.readFileSync(path.join(__dirname, '../../plugins/lastfm.axe'), 'utf8'));
const getRecentListens = new Function('return ' + axe.implementation.getRecentListens)();
const recentFails = async (status, body) => {
  global.fetch = async () => ({ ok: status < 300, status, json: async () => body });
  try {
    await getRecentListens({ user: 'someone', limit: 1 }, { apiKey: 'k' });
    return null;
  } catch (error) {
    return error;
  } finally {
    delete global.fetch;
  }
};

describe('the Last.fm plug-in recognises a hidden profile', () => {
  test('403 with error 17 is a hidden profile, and says its status', async () => {
    const error = await recentFails(403, { error: 17, message: 'Login: User required to be logged in' });
    expect(error.hidesListening).toBe(true);
    expect(error.status).toBe(403);
    expect((await recentFails(403, { error: '17' })).hidesListening).toBe(true);
  });

  test('other failures are not', async () => {
    for (const [status, body] of [[403, { error: 10, message: 'Invalid API key' }], [500, { error: 17 }], [403, null], [429, {}]]) {
      const error = await recentFails(status, body);
      expect([status, error.hidesListening]).toEqual([status, undefined]);
      expect(error.status).toBe(status);
    }
  });
});

const src = require('../helpers/renderer-source').appWithPages() /* app.js and the pages moved out of it (#1451) */;
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
    expect(fetchRecent).toContain('if (error && error.hidesListening) return { track: null, hidesListening: true };');
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
    expect(historyLoad).toContain('if (error && error.hidesListening) {');
    expect(historyLoad).toContain("recent: [], recentHidden: true");
    expect(historyLoad).toContain('recentHidden: false');
    expect(src).toContain('friendHistoryData.recentHidden');
  });

  test('the friend card shows it when the friend is not on-air', () => {
    expect(collectionPage).toContain("!onAir && friend.hidesListening && React.createElement('div'");
    expect(collectionPage).toContain("'Listening hidden'");
  });
});
