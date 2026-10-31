/**
 * parachord://friend links ignored ?period= (the view opened at whatever
 * period was last picked), and neither the handler nor Copy Link knew
 * top-albums, so a friend's "Top Albums · Last Month" copied as a bare friend
 * link (#1175). Both directions now go through one module, and every link
 * Copy Link builds parses back to the same tab and period.
 */

const fs = require('fs');
const path = require('path');
const { parseFriendLink, buildFriendLink, FRIEND_LINK_TABS, HISTORY_PERIODS } = require('../../src/renderer/lib/friend-link');

describe('parseFriendLink', () => {
  test('a top tab takes a known period', () => {
    expect(parseFriendLink('top-artists', '1month')).toEqual({ tabKey: 'topArtists', period: '1month' });
    expect(parseFriendLink('top-albums', 'overall')).toEqual({ tabKey: 'topAlbums', period: 'overall' });
  });

  test('an unknown period is dropped, so the view keeps its own', () => {
    expect(parseFriendLink('top-tracks', '2weeks')).toEqual({ tabKey: 'topTracks', period: null });
    expect(parseFriendLink('top-tracks', undefined)).toEqual({ tabKey: 'topTracks', period: null });
  });

  test('recent, no tab and an unknown tab ignore the period', () => {
    expect(parseFriendLink('recent', '1month')).toEqual({ tabKey: 'recent', period: null });
    expect(parseFriendLink(undefined, '1month')).toEqual({ tabKey: undefined, period: null });
    expect(parseFriendLink('loved', '1month')).toEqual({ tabKey: undefined, period: null });
  });
});

describe('buildFriendLink', () => {
  test('a top tab always carries its period, the default included', () => {
    expect(buildFriendLink('jane123', 'topAlbums', '1month')).toBe('parachord://friend/jane123/top-albums?period=1month');
    expect(buildFriendLink('jane123', 'topTracks', '7day')).toBe('parachord://friend/jane123/top-tracks?period=7day');
  });

  test('recent carries no period', () => {
    expect(buildFriendLink('jane123', 'recent', 'overall')).toBe('parachord://friend/jane123/recent');
  });

  test('the id is encoded', () => {
    expect(buildFriendLink('DJ Two/Three', 'recent', '7day')).toBe('parachord://friend/DJ%20Two%2FThree/recent');
  });

  test('every tab and period round-trips through the link', () => {
    for (const tabKey of Object.values(FRIEND_LINK_TABS)) {
      for (const period of HISTORY_PERIODS) {
        const url = new URL(buildFriendLink('jane123', tabKey, period));
        const segment = url.pathname.split('/').filter(Boolean)[1];
        const parsed = parseFriendLink(segment, url.searchParams.get('period') || undefined);
        expect(parsed).toEqual({ tabKey, period: tabKey === 'recent' ? null : period });
      }
    }
  });
});

describe('app.js wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

  test('the friend deep link reads the tab and period through parseFriendLink', () => {
    expect(src).toMatch(/const link = parseFriendLink\(tab, params\.period\);\s*navigateToFriendRef\.current\(friend, link\.tabKey, link\.period\);/);
  });

  test('navigateToFriend sets the period and hands it to the top-tab loaders', () => {
    const start = src.indexOf('const navigateToFriend = (friend, tabKey = \'recent\', period = null) => {');
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('navigateToFriendRef.current = navigateToFriend;', start));
    expect(body).toMatch(/if \(period\) setFriendHistoryPeriod\(period\);/);
    expect(body).toMatch(/loadFriendTopTracks\(friend, topPeriod\)/);
    expect(body).toMatch(/loadFriendTopAlbums\(friend, topPeriod\)/);
    expect(body).toMatch(/loadFriendTopArtists\(friend, topPeriod\)/);
  });

  test('Copy Link on the friend view goes through buildFriendLink', () => {
    expect(src).toMatch(/return buildFriendLink\(id, friendHistoryTab, friendHistoryPeriod\);/);
  });
});
