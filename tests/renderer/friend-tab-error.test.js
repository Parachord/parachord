/**
 * A friend page tab whose load fails (the service unreachable) says so, with
 * Try again, instead of an empty list that reads as "they have none". During a
 * ListenBrainz outage (2026-11-12, its IPv6 endpoint resetting TLS) every
 * recommended ListenBrainz listener's profile showed "No recent listens".
 */
const fs = require('fs');
const path = require('path');

const app = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');
const fn = (name) => {
  const i = app.indexOf(`const ${name} = async`);
  expect(i).toBeGreaterThan(-1);
  return app.slice(i, app.indexOf('\n  };', i));
};

describe('friend page tab errors', () => {
  const loaders = [
    ['loadFriendRecentTracks', 'recent'],
    ['loadFriendTopTracks', 'topTracks'],
    ['loadFriendTopTracksListenBrainz', 'topTracks'],
    ['loadFriendTopArtists', 'topArtists'],
    ['loadFriendTopAlbums', 'topAlbums']
  ];

  test.each(loaders)('%s records a failure for its tab and clears it on success', (name, tab) => {
    const body = fn(name);
    const catchBlock = body.slice(body.indexOf('} catch (error) {'));
    expect(catchBlock).toContain(`setFriendHistoryData(prev => ({ ...prev, ${tab}: [], errors: { ...(prev.errors || {}), ${tab}: true } }));`);
    // No toast on top of the inline error.
    expect(catchBlock).not.toContain('showToast(');
    expect(body.slice(0, body.indexOf('} catch (error) {'))).toContain(`errors: { ...(prev.errors || {}), ${tab}: false }`);
  });

  test('the error replaces the tab, names the service from its plugin, and retries the tab', () => {
    const view = app.slice(app.indexOf("!friendHistoryLoading && friendHistoryData.errors?.[friendHistoryTab] && (() => {"));
    const block = view.slice(0, view.indexOf('// Recent tab content'));
    expect(block).toContain('.find(r => r.id === currentFriend?.service)');
    expect(block).toContain("`Couldn't reach ${serviceName}. Check your connection and try again.`");
    expect(block).toContain("}, 'Try again')");
    expect(block).toContain("if (friendHistoryTab === 'recent') loadFriendRecentTracks(currentFriend);");
    expect(block).not.toMatch(/'lastfm'|'listenbrainz'/);
    for (const tab of ['recent', 'topTracks', 'topAlbums', 'topArtists']) {
      expect(app).toContain(`!friendHistoryLoading && !friendHistoryData.errors?.${tab} && friendHistoryTab === '${tab}'`);
    }
  });

  test('opening a friend starts with no errors', () => {
    const nav = app.slice(app.indexOf('const navigateToFriend = (friend'), app.indexOf('navigateToFriendRef.current = navigateToFriend;'));
    expect(nav).toContain("setFriendHistoryData({ recent: [], topTracks: [], topAlbums: [], topArtists: [] });");
  });
});
