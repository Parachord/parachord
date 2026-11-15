const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../../src/renderer/app.js'), 'utf8');

const body = (start, endMarker) => {
  const a = src.indexOf(start);
  expect(a).toBeGreaterThan(-1);
  const b = src.indexOf(endMarker, a + start.length);
  return src.slice(a, b);
};

describe('follow a recommended listener', () => {
  test('addFriendCore exists, looks up the exact service, and never touches the modal', () => {
    const core = body('const addFriendCore = async', 'const addFriend = async');
    expect(core).toMatch(/fetchLastfmUserInfo\(username\)/);
    expect(core).toMatch(/fetchListenbrainzUserInfo\(username\)/);
    expect(core).toMatch(/followOnService\(newFriend\)/);
    expect(core).toMatch(/setPinnedFriendIds/);
    expect(core).not.toMatch(/setAddFriendModalOpen|setAddFriendInput|setAddFriendLoading/);
    expect(core).toMatch(/throw userError\(/);
  });

  test('addFriendCore refuses a service that is not a friend service, before any lookup', () => {
    // A third similarUsers plugin must never make Follow look the same name
    // up on ListenBrainz (the old fallback mapped any non-Last.fm service there).
    const core = body('const addFriendCore = async', 'const addFriend = async');
    const guard = core.search(/if \(!FRIEND_SERVICES\.includes\(service\)\) \{\s*throw userError\(/);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(core.indexOf('fetchLastfmUserInfo(username)'));
    expect(core).toMatch(/const finalService = service;/);
    expect(core).not.toMatch(/service === 'lastfm' \? 'lastfm' : 'listenbrainz'/);
    expect(src).toMatch(/const \{[^}]*\bFRIEND_SERVICES\b[^}]*\} = require\('\.\/lib\/recommendation-model'\);/);
  });

  test('only friend-service similar-users providers are asked (the Friends row input)', () => {
    const fn = body('const similarUsersProviders = () => {', 'const recommendationExclusions');
    expect(fn).toMatch(/\.filter\(r => FRIEND_SERVICES\.includes\(r\.id\)\)/);
  });

  test('addFriend delegates to addFriendCore and keeps its modal behavior', () => {
    const fn = body('const addFriend = async', 'const followRecommendedFriend');
    expect(fn).toMatch(/addFriendCore\(/);
    expect(fn).toMatch(/setAddFriendModalOpen\(false\)/);
    // The friend sliding into the sidebar says it (addFriendCore), not a toast.
    expect(fn).not.toMatch(/pinned to sidebar/);
  });

  test('the friend header shows Follow only for a non-friend', () => {
    expect(src).toMatch(/!friends\.some\(f => f\.id === currentFriend\.id\) && React\.createElement\(Button, \{ variant: 'primary'/);
  });

  test('Follow calls the core with the person and adopts the returned friend', () => {
    const fn = body('const followRecommendedFriend', '// Remove a friend completely');
    expect(fn).toMatch(/addFriendCore\(\{ service: person\.service, username: person\.username \}\)/);
    expect(fn).toMatch(/setCurrentFriend\(newFriend\)/);
    // The sidebar slide-in says they were added; no toast repeats it.
    expect(fn).not.toMatch(/`Following /);
    expect(fn).toMatch(/showToast\(errorText\(error, 'Couldn’t follow them\. Try again\.'\), 'error'\)/);
  });

  test('a restored similar: profile lands on Recommendations', () => {
    expect(src).toMatch(/startsWith\('similar:'\)[\s\S]{0,300}setActiveView\('recommendations'\)/);
  });
});
